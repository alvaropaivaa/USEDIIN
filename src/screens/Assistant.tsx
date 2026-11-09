import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUp, AudioLines, ChevronLeft, FileText, Mic, Plus, RotateCcw, SquarePen, Undo2, X } from 'lucide-react'
import clsx from 'clsx'
import { haptic } from '../lib/haptics'
import { uid } from '../lib/crypto'
import { useAuth } from '../lib/auth'
import { useData, useUI } from '../lib/store'
import { askAgent, localTurn, undoMessage, useChat, type AskResult, type ChatAttachment, type ChatMessage, type Outgoing } from '../lib/assistant'
import { aiEnabled } from '../lib/features'
import { TxRow, useFinance } from '../components/finance'
import { toast } from '../components/sheet'
import { spring } from '../components/ui'

// Chat com o assistente: conta o que gastou ou recebeu e ele lança na hora. Com IA: texto, áudio, foto ou PDF.
// Sem IA (plano básico): o modo simples, no aparelho, entende texto ou fala ditada ("caiu meu salário",
// "paguei a luz", "muda o aluguel para 1.900") e lança, dá baixa, corrige e apaga.

const MAX_AUDIO = 120
const MAX_IMAGES = 4
const MAX_PDF = 8 * 1024 * 1024

const suggestions = aiEnabled
  ? ['gastei 45,90 no ifood', 'recebi 2 mil de salário', 'mercado 312,40 no cartão em 3x', 'quanto gastei este mês?']
  : ['caiu meu salário', 'paguei a luz', 'gastei 45,90 no ifood', 'o que falta pagar?']

/** Anexo pronto para enviar. */
interface Pending {
  id: string
  kind: 'image' | 'pdf'
  name: string
  base64: string
  mime: string
  thumb?: string
}

const dataUrlToBase64 = (url: string) => url.slice(url.indexOf(',') + 1)

const readDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.addEventListener('load', () => resolve(String(r.result)))
    r.addEventListener('error', () => reject(r.error))
    r.readAsDataURL(blob)
  })

/** Foto reduzida (o assistente lê bem até 1600px) e a miniatura para o histórico. */
async function prepareImage(file: File): Promise<Pending> {
  const bmp = await createImageBitmap(file)
  const draw = (max: number, quality: number) => {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) })
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', quality)
  }
  const full = draw(1600, 0.85)
  const thumb = draw(360, 0.7)
  bmp.close()
  return { id: uid(), kind: 'image', name: file.name, base64: dataUrlToBase64(full), mime: 'image/jpeg', thumb }
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Gravação de áudio pelo microfone (webm no Android e computador, mp4 no iPhone). */
function useRecorder(onDone: (audio: { blob: Blob; mime: string; seconds: number }) => void) {
  const [seconds, setSeconds] = useState<number | null>(null)
  const rec = useRef<{ media: MediaRecorder; chunks: Blob[]; start: number; cancel: boolean; timer: number } | null>(null)

  const stop = (cancel = false) => {
    const r = rec.current
    if (!r) return
    r.cancel = cancel
    clearInterval(r.timer)
    if (r.media.state !== 'inactive') r.media.stop()
  }

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return toast('Este navegador não grava áudio')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      return toast('Permita o microfone para mandar áudio')
    }
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
    const media = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    const r = { media, chunks: [] as Blob[], start: Date.now(), cancel: false, timer: 0 }
    rec.current = r
    media.ondataavailable = (e) => e.data.size && r.chunks.push(e.data)
    media.onstop = () => {
      for (const t of stream.getTracks()) t.stop()
      rec.current = null
      setSeconds(null)
      const secs = (Date.now() - r.start) / 1000
      if (r.cancel || secs < 0.8) return
      const type = (media.mimeType || mime || 'audio/webm').split(';')[0]
      onDone({ blob: new Blob(r.chunks, { type }), mime: type, seconds: secs })
    }
    media.start(250)
    haptic('medium')
    setSeconds(0)
    r.timer = window.setInterval(() => {
      const secs = (Date.now() - r.start) / 1000
      setSeconds(secs)
      if (secs >= MAX_AUDIO) stop()
    }, 200)
  }

  useEffect(() => () => stop(true), [])
  return { recording: seconds !== null, seconds: seconds ?? 0, start, stop }
}

// ─── Ditado do navegador (sem IA): a fala vira texto no próprio Chrome, Edge ou Safari ───

interface SpeechResults {
  length: number
  [i: number]: { isFinal: boolean; 0: { transcript: string } }
}
interface Speech extends EventTarget {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  abort: () => void
}
const SpeechCtor =
  typeof window === 'undefined'
    ? undefined
    : ((window as unknown as { SpeechRecognition?: new () => Speech; webkitSpeechRecognition?: new () => Speech }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => Speech }).webkitSpeechRecognition)

/** Fala → texto (o que vai ouvindo aparece na hora; ao terminar, `done` com o texto final). */
function useDictation() {
  const [listening, setListening] = useState(false)
  const rec = useRef<{ r: Speech; cancelled: boolean } | null>(null)

  const start = (onText: (text: string, done: boolean) => void) => {
    if (!SpeechCtor || rec.current) return
    const r = new SpeechCtor()
    r.lang = 'pt-BR'
    r.interimResults = true
    r.continuous = false
    const cur = { r, cancelled: false }
    let heard = ''
    r.addEventListener('result', (ev) => {
      if (cur.cancelled) return
      const { results } = ev as unknown as { results: SpeechResults }
      let all = ''
      heard = ''
      for (let i = 0; i < results.length; i++) {
        all += results[i][0].transcript
        if (results[i].isFinal) heard += results[i][0].transcript
      }
      onText(all.trim(), false)
    })
    r.addEventListener('error', (ev) => {
      const { error } = ev as unknown as { error: string }
      if (error === 'not-allowed' || error === 'service-not-allowed') toast('Permita o microfone para falar')
      else if (error === 'no-speech') toast('Não ouvi nada. Tente de novo')
      else if (error !== 'aborted') toast('Não deu para ouvir agora')
    })
    r.addEventListener('end', () => {
      rec.current = null
      setListening(false)
      if (!cur.cancelled) onText(heard.trim(), true)
    })
    rec.current = cur
    try {
      r.start()
    } catch {
      rec.current = null
      return toast('Não deu para usar o microfone agora')
    }
    haptic('medium')
    setListening(true)
  }

  /** Para de ouvir e entrega o que ouviu. */
  const stop = () => rec.current?.r.stop()
  /** Para sem entregar nada. */
  const cancel = () => {
    if (!rec.current) return
    rec.current.cancelled = true
    rec.current.r.abort()
  }

  useEffect(() => () => rec.current?.r.abort(), [])
  return { supported: !!SpeechCtor, listening, start, stop, cancel }
}

function Attachments({ items }: { items: ChatAttachment[] }) {
  const images = items.filter((a) => a.kind === 'image')
  const others = items.filter((a) => a.kind !== 'image')
  return (
    <div className="space-y-1.5">
      {images.length > 0 && (
        <div className={clsx('grid gap-1', images.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {images.map((a) =>
            a.thumb ? (
              <img key={a.id ?? a.thumb} src={a.thumb} alt={a.name ?? 'Foto'} className="max-h-56 w-full rounded-[14px] object-cover" />
            ) : (
              <span key={a.id ?? a.name} className="block rounded-[14px] bg-fill px-3 py-2 text-[13px]">
                Foto
              </span>
            ),
          )}
        </div>
      )}
      {others.map((a) => (
        <span key={a.id ?? `${a.kind}-${a.name ?? a.seconds}`} className="flex items-center gap-1.5 text-[14px] font-medium text-label">
          {a.kind === 'audio' ? <AudioLines className="size-4 shrink-0 opacity-80" /> : <FileText className="size-4 shrink-0 opacity-80" />}
          {a.kind === 'audio' ? `Áudio · ${clock(a.seconds ?? 0)}` : (a.name ?? 'PDF')}
        </span>
      ))}
    </div>
  )
}

/** As barras do Dinn ao lado de cada resposta; um anel gira enquanto ele pensa. */
function Mark({ busy }: { busy?: boolean }) {
  const id = useId()
  return (
    <span className="relative grid size-8 shrink-0 place-items-center">
      {busy && (
        <motion.span
          className="absolute inset-0 rounded-full border-2 border-transparent border-r-tint/30 border-t-tint"
          animate={{ rotate: 360 }}
          transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
        />
      )}
      <svg viewBox="0 0 25 25" className="size-[17px]" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="1" x2="0" y2="0">
            <stop stopColor="#16a34a" />
            <stop offset="1" stopColor="#86efac" />
          </linearGradient>
        </defs>
        <rect x="0" y="14" width="7" height="11" rx="2" fill={`url(#${id})`} />
        <rect x="9" y="8" width="7" height="17" rx="2" fill={`url(#${id})`} />
        <rect x="18" y="0" width="7" height="25" rx="2" fill={`url(#${id})`} />
      </svg>
    </span>
  )
}

/** "Pensando…" (ou o que o assistente está fazendo) com um brilho que passa pelo texto. */
function Thinking({ label }: { label?: string }) {
  return (
    <motion.span
      className="inline-block bg-[linear-gradient(90deg,var(--label-3)_0%,var(--label)_50%,var(--label-3)_100%)] bg-[length:200%_100%] bg-clip-text text-[15.5px] leading-[24px] text-transparent"
      animate={{ backgroundPosition: ['100% 0%', '-100% 0%'] }}
      transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
    >
      {label || 'Pensando…'}
    </motion.span>
  )
}

function Message({ m, onRetry, showLocal }: { m: ChatMessage; onRetry?: () => void; showLocal?: boolean }) {
  const f = useFinance()
  const openTx = useUI((s) => s.openTx)
  // parcelas e repetições do mesmo lançamento aparecem uma vez só (a primeira da resposta)
  const txs = useMemo(() => {
    const ids = new Set(m.created ?? [])
    const seen = new Set<string>()
    return f.transactions
      .filter((t) => ids.has(t.id))
      .sort((a, b) => (a.installment?.n ?? 0) - (b.installment?.n ?? 0) || a.date.localeCompare(b.date))
      .filter((t) => !seen.has(t.groupId ?? t.id) && !!seen.add(t.groupId ?? t.id))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [m.created, f.transactions])
  // mudou ou trocou lançamentos que já existiam
  const fixed = m.changes ? !!m.changes.before.transactions?.length : !!m.before?.length
  const undo = () => {
    haptic()
    undoMessage(m)
    toast('Desfeito')
  }

  if (m.role === 'user')
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%] space-y-1.5 rounded-[22px] rounded-br-[8px] bg-surface px-4 py-2.5 text-[15.5px] leading-[23px] text-label shadow-card">
          {m.attachments?.length ? <Attachments items={m.attachments} /> : null}
          {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
          {m.transcript && <p className="text-[13.5px] italic leading-[19px] text-label-2">“{m.transcript}”</p>}
        </div>
      </div>
    )

  return (
    <div className="flex gap-3">
      <Mark busy={m.status === 'sending'} />
      <div className="min-w-0 flex-1 pt-1">
        {m.status === 'sending' ? (
          <Thinking label={m.text} />
        ) : (
          <p className={clsx('whitespace-pre-wrap break-words text-[15.5px] leading-[24px]', m.status === 'error' ? 'text-red' : 'text-label')}>{m.text}</p>
        )}
        {m.status === 'error' && onRetry && (
          <button type="button" onClick={() => (haptic(), onRetry())} className="mt-2 flex items-center gap-1.5 rounded-full bg-fill px-3 py-1.5 text-[13px] font-medium text-label hover:bg-fill-2">
            <RotateCcw className="size-3.5" /> Tentar de novo
          </button>
        )}
        {txs.length > 0 && (
          <div className={clsx('mt-3 w-full max-w-[460px] overflow-hidden rounded-[18px] bg-surface shadow-card', m.undone && 'opacity-50')}>
            <div className={clsx(m.undone && 'pointer-events-none line-through decoration-label-3')}>
              {txs.map((t) => (
                <TxRow key={t.id} tx={t} look={f.look} showDate onClick={() => openTx(true, { id: t.id })} />
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-separator px-4 py-2">
              <span className="text-[12px] text-label-2">{m.undone ? 'Desfeito' : (m.label ?? (fixed ? 'Corrigido' : txs.length === 1 ? 'Lançado' : `${txs.length} lançamentos`))}</span>
              {!m.undone && (
                <button type="button" onClick={undo} className="flex items-center gap-1 text-[13px] font-semibold text-tint">
                  <Undo2 className="size-3.5" /> Desfazer
                </button>
              )}
            </div>
          </div>
        )}
        {/* mudou algo que não aparece como lançamento (conta, meta, apagado…): só o botão */}
        {!txs.length && m.changes && !m.undone && m.status !== 'sending' && (
          <button type="button" onClick={undo} className="mt-2 flex items-center gap-1 text-[13px] font-semibold text-tint">
            <Undo2 className="size-3.5" /> Desfazer
          </button>
        )}
        {m.undone && !txs.length && (m.created?.length || m.changes) ? <p className="mt-1 text-[12px] text-label-2">Desfeito</p> : null}
        {showLocal && <p className="mt-2 text-[11.5px] leading-[16px] text-label-3">Modo simples · áudio, fotos e perguntas mais livres chegam quando o assistente for ativado</p>}
      </div>
    </div>
  )
}

export default function Assistant() {
  const email = useAuth((s) => s.email) ?? ''
  const { messages, owner, reset } = useChat()
  const setTab = useUI((s) => s.setTab)
  const first = useData((s) => s.settings.owner).trim().split(/\s+/)[0]
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Pending[]>([])
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  // o que cada resposta com erro tentou enviar (para "Tentar de novo"; não fica salvo)
  const retries = useRef(new Map<string, { out: Outgoing; userId: string }>())
  const [retryable, setRetryable] = useState<ReadonlySet<string>>(new Set())
  const markRetry = (id: string, on: boolean) =>
    setRetryable((s) => {
      const next = new Set(s)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  // outra conta neste aparelho: a conversa anterior não aparece
  useEffect(() => {
    if (owner !== email) reset(email)
  }, [owner, email, reset])

  // desce até a última mensagem
  const lastStatus = messages.at(-1)?.status
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: messages.length > 1 ? 'smooth' : 'auto' })
  }, [messages.length, lastStatus])

  const busy = lastStatus === 'sending'
  // o aviso do modo simples aparece só na última resposta dele
  const lastLocal = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].local) return messages[i].id
    return undefined
  }, [messages])

  /** Envia para o assistente (que já aplica o que fizer); sem IA ou sem servidor, o modo simples entende texto curto. */
  const run = async (out: Outgoing, userId: string, replyId: string) => {
    const chat = useChat.getState()
    let res: AskResult = aiEnabled
      ? await askAgent(out, { skip: userId, progress: (label) => chat.update(replyId, { text: label }) })
      : { ok: false, reason: 'local', message: 'Escreva o que aconteceu.' }
    let local: ReturnType<typeof localTurn> | undefined
    if (!res.ok && (res.reason === 'local' || res.reason === 'offline') && out.text && !out.audio && !out.images?.length && !out.pdf) {
      local = localTurn(out.text)
      res = { ok: true, ...local }
    }
    if (!res.ok) {
      retries.current.set(replyId, { out, userId })
      markRetry(replyId, true)
      chat.update(replyId, { status: 'error', text: res.reason === 'local' || res.reason === 'offline' ? `${res.message} Por enquanto, escreva o gasto, como “mercado 120”.` : res.message })
      return
    }
    retries.current.delete(replyId)
    markRetry(replyId, false)
    if (res.transcript) chat.update(userId, { transcript: res.transcript })
    chat.update(replyId, {
      status: undefined,
      text: res.reply,
      created: res.created,
      ...(res.changes ? { changes: res.changes } : {}),
      ...(res.undid ? { undid: res.undid } : {}),
      ...(local ? { local: true } : {}),
      ...(local?.label ? { label: local.label } : {}),
    })
    if (res.changes) haptic('success')
  }

  const send = async (msg: { text?: string; files?: Pending[]; audio?: { blob: Blob; mime: string; seconds: number } }) => {
    const body = msg.text?.trim() ?? ''
    const list = msg.files ?? []
    if (busy || (!body && !list.length && !msg.audio)) return
    haptic()
    const attachments: ChatAttachment[] = [
      ...list.map((p) => ({ id: p.id, kind: p.kind, name: p.name, ...(p.thumb ? { thumb: p.thumb } : {}) })),
      ...(msg.audio ? [{ id: uid(), kind: 'audio' as const, seconds: msg.audio.seconds }] : []),
    ]
    const chat = useChat.getState()
    const user = chat.add({ role: 'user', text: body, ...(attachments.length ? { attachments } : {}) })
    const reply = chat.add({ role: 'assistant', text: '', status: 'sending' })
    setText('')
    setFiles([])
    const images = list.filter((p) => p.kind === 'image').map((p) => ({ base64: p.base64, mime: p.mime }))
    const pdf = list.find((p) => p.kind === 'pdf')
    const out: Outgoing = {
      ...(body ? { text: body } : {}),
      ...(images.length ? { images } : {}),
      ...(pdf ? { pdf: { base64: pdf.base64 } } : {}),
      ...(msg.audio ? { audio: { base64: dataUrlToBase64(await readDataUrl(msg.audio.blob)), mime: msg.audio.mime } } : {}),
    }
    await run(out, user.id, reply.id)
  }

  const retry = (replyId: string) => {
    const r = retries.current.get(replyId)
    if (!r) return
    useChat.getState().update(replyId, { status: 'sending', text: '' })
    void run(r.out, r.userId, replyId)
  }

  const recorder = useRecorder((audio) => void send({ audio }))
  const dictation = useDictation()
  const listen = () =>
    dictation.start((heard, done) => {
      if (!done) return setText(heard)
      if (heard) void send({ text: heard })
      else setText('')
    })

  const pick = async (list: FileList | null) => {
    if (!list?.length) return
    // confere os limites antes de abrir os arquivos
    let images = files.filter((p) => p.kind === 'image').length
    let hasPdf = files.some((p) => p.kind === 'pdf')
    const accepted: File[] = []
    for (const file of Array.from(list)) {
      if (file.type === 'application/pdf') {
        if (file.size > MAX_PDF) toast('PDF grande demais (máximo 8 MB)')
        else if (hasPdf) toast('Um PDF por mensagem')
        else {
          accepted.push(file)
          hasPdf = true
        }
      } else if (file.type.startsWith('image/')) {
        if (images >= MAX_IMAGES) toast(`Até ${MAX_IMAGES} fotos por mensagem`)
        else {
          accepted.push(file)
          images++
        }
      } else toast('Mande foto ou PDF')
    }
    const ready = await Promise.all(
      accepted.map(async (file): Promise<Pending | null> => {
        try {
          if (file.type !== 'application/pdf') return await prepareImage(file)
          return { id: uid(), kind: 'pdf', name: file.name, base64: dataUrlToBase64(await readDataUrl(file)), mime: 'application/pdf' }
        } catch {
          toast('Não deu para abrir o arquivo')
          return null
        }
      }),
    )
    setFiles((now) => [...now, ...ready.filter((p): p is Pending => !!p)])
    input.current?.focus()
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && matchMedia('(pointer: fine)').matches) {
      e.preventDefault()
      void send({ text, files })
    }
  }

  // a caixa de texto cresce até 5 linhas
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 5 * 21 + 20)}px`
  }, [text])

  const canSend = !!text.trim() || files.length > 0
  const empty = messages.length === 0

  const composer = (
    <motion.div
      layoutId="assistente-caixa"
      transition={spring}
      className="rounded-[28px] bg-surface shadow-[0_0_0_1px_var(--separator),0_18px_48px_-24px_rgba(15,21,18,0.35)] transition-shadow focus-within:shadow-[0_0_0_1.5px_color-mix(in_srgb,var(--tint)_55%,transparent),0_18px_48px_-24px_rgba(15,21,18,0.35)]"
    >
      <AnimatePresence initial={false}>
        {files.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="no-scrollbar flex gap-2 overflow-x-auto px-3 pb-1 pt-3">
              {files.map((p) => (
                <span key={p.id} className="relative shrink-0">
                  {p.thumb ? (
                    <img src={p.thumb} alt={p.name} className="size-16 rounded-[14px] object-cover" />
                  ) : (
                    <span className="flex h-16 w-40 items-center gap-2 rounded-[14px] bg-fill px-3 text-[12.5px] font-medium text-label">
                      <FileText className="size-5 shrink-0 text-label-2" />
                      <span className="line-clamp-2 break-all">{p.name}</span>
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label="Tirar anexo"
                    onClick={() => setFiles(files.filter((x) => x.id !== p.id))}
                    className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-label text-bg shadow"
                  >
                    <X className="size-3" strokeWidth={3} />
                  </button>
                </span>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-end gap-1 p-2">
        {dictation.listening ? (
          <>
            <button type="button" aria-label="Cancelar" onClick={() => (haptic(), dictation.cancel(), setText(''))} className="grid size-10 shrink-0 place-items-center rounded-full text-label-2 hover:bg-fill">
              <X className="size-5" />
            </button>
            <div className="flex min-h-10 flex-1 items-center gap-2.5 px-1 py-[9px] text-[15px] leading-[22px] text-label">
              <motion.i className="block size-2.5 shrink-0 rounded-full bg-red" animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
              <span className={clsx('line-clamp-3', !text && 'text-label-2')}>{text || 'Ouvindo… fale, por exemplo, “caiu meu salário”'}</span>
            </div>
            <motion.button type="button" aria-label="Enviar" whileTap={{ scale: 0.9 }} onClick={() => dictation.stop()} className="grad-btn grid size-10 shrink-0 place-items-center rounded-full text-white">
              <ArrowUp className="size-5" strokeWidth={2.4} />
            </motion.button>
          </>
        ) : recorder.recording ? (
          <>
            <button type="button" aria-label="Cancelar áudio" onClick={() => (haptic(), recorder.stop(true))} className="grid size-10 shrink-0 place-items-center rounded-full text-label-2 hover:bg-fill">
              <X className="size-5" />
            </button>
            <div className="flex h-10 flex-1 items-center gap-2.5 px-1 text-[15px] text-label">
              <motion.i className="block size-2.5 rounded-full bg-red" animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
              <span className="tabular font-semibold">{clock(recorder.seconds)}</span>
              <span className="truncate text-label-2">Gravando…</span>
            </div>
            <motion.button type="button" aria-label="Enviar áudio" whileTap={{ scale: 0.9 }} onClick={() => recorder.stop()} className="grad-btn grid size-10 shrink-0 place-items-center rounded-full text-white">
              <ArrowUp className="size-5" strokeWidth={2.4} />
            </motion.button>
          </>
        ) : (
          <>
            {aiEnabled ? (
              <button type="button" aria-label="Anexar foto ou PDF" onClick={() => (haptic(), picker.current?.click())} className="grid size-10 shrink-0 place-items-center rounded-full text-label-2 transition-colors hover:bg-fill">
                <Plus className="size-[22px]" strokeWidth={1.8} />
              </button>
            ) : (
              <span className="w-2 shrink-0" />
            )}
            <textarea
              ref={input}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              placeholder={aiEnabled ? 'Lance um gasto ou pergunte algo' : 'Ex.: caiu meu salário'}
              aria-label="Mensagem para o assistente"
              enterKeyHint="send"
              className="max-h-[150px] min-h-10 flex-1 resize-none bg-transparent px-1.5 py-[9px] text-[16px] leading-[22px] text-label caret-tint outline-none placeholder:text-label-3"
            />
            {canSend ? (
              <motion.button
                type="button"
                aria-label="Enviar"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                whileTap={{ scale: 0.9 }}
                disabled={busy}
                onClick={() => void send({ text, files })}
                className="grad-btn grid size-10 shrink-0 place-items-center rounded-full text-white disabled:opacity-50"
              >
                <ArrowUp className="size-5" strokeWidth={2.4} />
              </motion.button>
            ) : aiEnabled || dictation.supported ? (
              <motion.button
                type="button"
                aria-label={aiEnabled ? 'Gravar áudio' : 'Falar'}
                whileTap={{ scale: 0.9 }}
                disabled={busy}
                onClick={() => (aiEnabled ? void recorder.start() : listen())}
                className="grid size-10 shrink-0 place-items-center rounded-full text-label-2 transition-colors hover:bg-fill disabled:opacity-50"
              >
                <Mic className="size-5" strokeWidth={1.9} />
              </motion.button>
            ) : (
              <span aria-hidden className="grad-btn grid size-10 shrink-0 place-items-center rounded-full text-white opacity-40">
                <ArrowUp className="size-5" strokeWidth={2.4} />
              </span>
            )}
          </>
        )}
      </div>
    </motion.div>
  )

  return (
    // jeito do Gemini (pergunta no centro, brilho ao fundo) com as cores do sistema; o verde fica nos detalhes
    <div className="relative flex h-full flex-col overflow-hidden bg-bg text-label">
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        initial={false}
        animate={{ opacity: empty ? 1 : 0.4, scale: empty ? 1 : 1.2 }}
        transition={{ duration: 0.9, ease: [0.32, 0.72, 0, 1] }}
        style={{ background: 'radial-gradient(44% 36% at 50% 56%, color-mix(in srgb, var(--tint) 11%, transparent) 0%, color-mix(in srgb, var(--tint) 4%, transparent) 45%, transparent 75%)' }}
      />

      <header className="pt-safe relative z-10 shrink-0">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-2 lg:h-16 lg:px-6">
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Voltar" onClick={() => (haptic(), setTab('home'))} className="grid size-10 place-items-center rounded-full text-label hover:bg-fill lg:hidden">
              <ChevronLeft className="size-6" strokeWidth={2} />
            </button>
            <span className="px-1 text-[17px] font-semibold tracking-[-0.01em] text-label lg:px-0">Assistente</span>
          </div>
          {!empty && (
            <button
              type="button"
              onClick={() => {
                if (!confirm('Começar uma conversa nova? Os lançamentos continuam no app.')) return
                haptic()
                retries.current.clear()
                setRetryable(new Set())
                reset(email)
              }}
              className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-medium text-label-2 transition-colors hover:bg-fill hover:text-label"
            >
              <SquarePen className="size-4" strokeWidth={2} /> Nova conversa
            </button>
          )}
        </div>
      </header>

      {empty ? (
        <div className="relative z-[1] flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-[10vh]">
          {first && (
            <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: 0.05 }} className="text-[16px] text-label-2">
              Oi, {first}
            </motion.p>
          )}
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.1 }}
            className="mt-1 text-center text-[28px] font-normal leading-tight tracking-[-0.025em] text-label lg:text-[36px]"
          >
            Por onde começamos?
          </motion.h2>
          <div className="mt-8 w-full max-w-[720px]">{composer}</div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }} className="mt-5 flex max-w-[720px] flex-wrap justify-center gap-2">
            {suggestions.map((s) => (
              <motion.button
                key={s}
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={() => (haptic(), void send({ text: s }))}
                className="rounded-full bg-surface px-4 py-2 text-[13.5px] text-label-2 shadow-card transition-colors hover:text-label"
              >
                {s}
              </motion.button>
            ))}
          </motion.div>
          <p className="mt-6 max-w-[420px] text-center text-[12.5px] leading-[18px] text-label-3">
            {aiEnabled
              ? 'Mande texto, áudio, a foto do comprovante ou um PDF. Eu lanço, corrijo, apago e respondo sobre as suas finanças, e tudo dá para desfazer.'
              : `Escreva do seu jeito${dictation.supported ? ' ou fale pelo microfone' : ''}. Eu lanço, dou baixa no que caiu ou foi pago, corrijo e apago, e tudo dá para desfazer.`}
          </p>
        </div>
      ) : (
        <>
          <div ref={scroller} className="no-scrollbar relative z-[1] min-h-0 flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_28px)]">
            <div className="mx-auto flex min-h-full max-w-[760px] flex-col px-4 pb-6 pt-2 lg:px-6">
              <div className="mt-auto space-y-6">
                {messages.map((m) => (
                  <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
                    <Message m={m} onRetry={retryable.has(m.id) ? () => retry(m.id) : undefined} showLocal={aiEnabled && m.id === lastLocal} />
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
          <div className="pb-safe relative z-[1] shrink-0">
            <div className="mx-auto max-w-[760px] px-3 pb-3 lg:px-6 lg:pb-6">{composer}</div>
          </div>
        </>
      )}
      <input ref={picker} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => (void pick(e.target.files), (e.target.value = ''))} />
    </div>
  )
}
