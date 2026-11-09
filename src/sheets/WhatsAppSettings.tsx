import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react'
import { AudioLines, CheckCheck, CircleCheck, FileText, HelpCircle, LoaderCircle, MessageSquareText, Play, Repeat, Undo2, Unlink, UserPlus } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { haptic } from '../lib/haptics'
import { toast } from '../components/sheet'
import { WhatsAppIcon } from '../components/icons'
import { Mascot } from '../components/mascots'
import { Row, Section, spring } from '../components/ui'

// Assistente no WhatsApp: a pessoa liga o próprio número e manda gastos e receitas por texto,
// áudio, print ou PDF para o número do Dinn (a função supabase/functions/whatsapp lança e responde).

/** Número do assistente (só dígitos, com DDI), definido no build em VITE_WHATSAPP_NUMBER. */
export const assistantNumber = String(import.meta.env.VITE_WHATSAPP_NUMBER ?? '').replace(/\D/g, '')

/** 5511987654321 → +55 (11) 98765-4321 */
const fmtPhone = (d: string) => {
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/)
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${d}`
}

const chatLink = (text?: string) => `https://wa.me/${assistantNumber}${text ? `?text=${encodeURIComponent(text)}` : ''}`

/** O texto que a função procura para ligar o número (ver supabase/functions/whatsapp). */
const linkMessage = (code: string) => `Meu código do Dinn: ${code}`

interface Link {
  phone: string | null
  code: string | null
  code_expires: string | null
  linked_at: string | null
}

/** Cartão de contato (.vcf) para salvar o número do assistente na agenda. */
function saveContact() {
  const card = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Dinn', 'ORG:Dinn', `TEL;TYPE=CELL:+${assistantNumber}`, 'END:VCARD'].join('\r\n')
  const url = URL.createObjectURL(new Blob([card], { type: 'text/vcard' }))
  Object.assign(document.createElement('a'), { href: url, download: 'Dinn.vcf' }).click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Balão da conversa de exemplo (cores do WhatsApp); os de quem envia têm hora e os dois tiques. */
function Bubble({ me, read, children }: { me?: boolean; read?: boolean; children: ReactNode }) {
  return (
    <div className={clsx('flex', me ? 'justify-end' : 'justify-start')}>
      <div
        className={clsx(
          'max-w-[82%] rounded-[16px] px-3 py-2 text-[13px] leading-[18px] shadow-[0_1px_0.5px_rgba(0,0,0,0.08)]',
          me ? 'rounded-br-[5px] bg-[#d9fdd3] text-[#111b21] dark:bg-[#144d37] dark:text-[#e9edef]' : 'rounded-bl-[5px] bg-surface text-label',
        )}
      >
        {children}
        {me && (
          <span className="ml-2 inline-flex translate-y-[3px] items-center gap-0.5 align-bottom text-[10.5px] leading-none text-[#667781] dark:text-[#8696a0]">
            09:41
            <CheckCheck className={clsx('size-[15px] transition-colors duration-500', read && 'text-[#53bdeb]')} strokeWidth={2} />
          </span>
        )}
      </div>
    </div>
  )
}

/** Anexo de exemplo dentro do balão (print). */
const Attachment = ({ icon: Icon, children }: { icon: typeof FileText; children: ReactNode }) => (
  <span className="inline-flex items-center gap-1.5 align-middle font-medium">
    <Icon className="size-4 shrink-0 opacity-70" strokeWidth={2} /> {children}
  </span>
)

// alturas das barrinhas do áudio de exemplo
const wave = [5, 9, 14, 8, 12, 18, 11, 7, 15, 10, 6, 13, 9, 16, 8, 5, 11, 7].map((h, i) => ({ id: `w${i}`, h, delay: i * 0.035 }))

/** Áudio de exemplo: a onda mexe enquanto ele "toca". */
function VoiceNote({ playing }: { playing: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 align-middle">
      <Play className="size-3.5 shrink-0 fill-current opacity-70" strokeWidth={0} />
      <span className="flex h-5 items-center gap-[2px]">
        {wave.map((b) => (
          <motion.i
            key={b.id}
            className="block w-[2.5px] rounded-full bg-current opacity-60"
            style={{ height: b.h }}
            animate={playing ? { scaleY: [1, 0.35, 1.2, 0.55, 1] } : { scaleY: 1 }}
            transition={playing ? { duration: 0.8, repeat: 1, delay: b.delay, ease: 'easeInOut' } : { duration: 0.2 }}
          />
        ))}
      </span>
      <span className="tabular text-[11.5px] opacity-70">0:06</span>
    </span>
  )
}

/** "Digitando…" do Dinn. */
function TypingBubble() {
  return (
    <div className="flex justify-start">
      <div className="flex h-[34px] items-center gap-1 rounded-[16px] rounded-bl-[5px] bg-surface px-3.5 shadow-[0_1px_0.5px_rgba(0,0,0,0.08)]">
        {[0, 0.15, 0.3].map((delay) => (
          <motion.i key={delay} className="block size-1.5 rounded-full bg-label-3" animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }} transition={{ duration: 0.9, repeat: Infinity, delay }} />
        ))}
      </div>
    </div>
  )
}

/** Roteiro da conversa: depois de cada mensagem enviada, quanto tempo esperar; antes de cada resposta, quanto tempo "digitando". */
const script: { id: string; me?: boolean; wait: number; body: (playing: boolean) => ReactNode }[] = [
  { id: 'texto', me: true, wait: 700, body: () => 'gastei 45,90 no ifood no nubank' },
  {
    id: 'ifood',
    wait: 1100,
    body: () => (
      <>
        Lancei: <b>iFood</b> · R$ 45,90 · Alimentação · Nubank
      </>
    ),
  },
  { id: 'audio', me: true, wait: 1800, body: (playing) => <VoiceNote playing={playing} /> },
  {
    id: 'mercado',
    wait: 1400,
    body: () => (
      <>
        Lancei: <b>Mercado</b> · R$ 312,40 em 3x · Itaú Click
      </>
    ),
  },
  { id: 'print', me: true, wait: 900, body: () => <Attachment icon={FileText}>Print do comprovante</Attachment> },
  {
    id: 'luz',
    wait: 1400,
    body: () => (
      <>
        Lancei: <b>Conta de luz</b> · R$ 187,20 · Moradia · pago hoje
      </>
    ),
  },
]

/**
 * Conversa de exemplo que acontece sozinha: a mensagem chega, o Dinn digita e responde,
 * os tiques ficam azuis. Recomeça no fim; só roda com a seção na tela (e fica parada para quem
 * pediu menos movimento ao celular).
 */
function DemoChat() {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.4 })
  const [shown, setShown] = useState(reduce ? script.length : 0)
  const [typing, setTyping] = useState(false)

  useEffect(() => {
    if (reduce || !inView) return
    // a conversa vira uma linha do tempo de timers; ao sair da tela, todos são cancelados
    const timers: number[] = []
    const at = (ms: number, fn: () => void) => void timers.push(window.setTimeout(fn, ms))
    const cycle = (start: number) => {
      let t = start
      at(t, () => (setShown(0), setTyping(false)))
      t += 500
      script.forEach((line, i) => {
        if (!line.me) {
          at(t, () => setTyping(true))
          t += line.wait
        }
        at(t, () => (setTyping(false), setShown(i + 1)))
        t += line.me ? line.wait : 650
      })
      at(t + 3800, () => cycle(0))
    }
    cycle(250)
    return () => timers.forEach((id) => clearTimeout(id))
  }, [inView, reduce])

  return (
    <div ref={ref} className="grid bg-[#efeae2] px-3 py-3.5 dark:bg-[#0b141a]">
      {/* a conversa inteira reserva o espaço: nada pula enquanto as mensagens entram */}
      <div aria-hidden className="invisible space-y-1.5 [grid-area:1/1]">
        {script.map((l) => (
          <Bubble key={l.id} me={l.me}>
            {l.body(false)}
          </Bubble>
        ))}
      </div>
      <div className="space-y-1.5 [grid-area:1/1]">
        <AnimatePresence initial={false}>
          {script.slice(0, shown).map((l, i) => (
            <motion.div
              key={l.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.3 } }}
              transition={spring}
              style={{ originX: l.me ? 1 : 0, originY: 1 }}
            >
              <Bubble me={l.me} read={shown > i + 1}>
                {l.body(!!l.me && shown === i + 1 && !typing)}
              </Bubble>
            </motion.div>
          ))}
          {typing && (
            <motion.div key="digitando" layout initial={{ opacity: 0, y: 8, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }} transition={spring} style={{ originX: 0, originY: 1 }}>
              <TypingBubble />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/** Hora atual, atualizada de tempos em tempos. */
function useClock(ms: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export default function WhatsAppSettings() {
  // null = conferindo; false = sessão local (sem nuvem, o assistente não tem onde gravar)
  const [cloud, setCloud] = useState<boolean | null>(null)
  const [link, setLink] = useState<Link | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('whatsapp_links').select('phone, code, code_expires, linked_at').maybeSingle()
    if (!error) setLink(data as Link | null)
    return data as Link | null
  }, [])

  useEffect(() => {
    let live = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!live) return
      setCloud(!!data.session)
      if (data.session) void load()
    })
    return () => {
      live = false
    }
  }, [load])

  // o código vence em 30 minutos: a tela confere o relógio a cada 15 segundos
  const now = useClock(15_000)
  const waiting = !!link?.code && !!link.code_expires && new Date(link.code_expires).getTime() > now

  // esperando a mensagem com o código: confere a cada 3 segundos até o número aparecer
  useEffect(() => {
    if (!waiting) return
    const before = link?.phone
    const t = setInterval(async () => {
      const fresh = await load()
      if (fresh && !fresh.code && fresh.phone) {
        haptic()
        toast(before && before !== fresh.phone ? 'Número trocado' : 'WhatsApp conectado')
      }
    }, 3000)
    return () => clearInterval(t)
  }, [waiting, load, link?.phone])

  const newCode = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('whatsapp_code')
    setBusy(false)
    if (error || typeof data !== 'string') return toast('Não deu para gerar o código. Tente de novo.')
    haptic()
    setLink((l) => ({ phone: l?.phone ?? null, linked_at: l?.linked_at ?? null, code: data, code_expires: new Date(Date.now() + 30 * 60_000).toISOString() }))
  }

  const unlink = async () => {
    if (!confirm('Desconectar o WhatsApp? O assistente para de aceitar mensagens deste número.')) return
    const { error } = await supabase.rpc('whatsapp_unlink')
    if (error) return toast('Não deu para desconectar. Tente de novo.')
    setLink(null)
    toast('WhatsApp desconectado')
  }

  const linked = !!link?.phone

  return (
    <>
      <div className="mb-6 mt-1 overflow-hidden rounded-[22px] bg-surface shadow-card">
        <div className="flex items-center gap-3 p-4 pb-3">
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-semibold tracking-[-0.01em]">Lance pelo WhatsApp</p>
            <p className="mt-0.5 text-[13px] leading-[18px] text-label-2">Mande gastos e receitas por texto, áudio, print ou PDF. O Dinn lança sozinho e te responde na hora.</p>
          </div>
          <Mascot pose="whatsapp" className="-my-1 h-[88px] w-auto shrink-0" />
        </div>
        {/* conversa de exemplo, animada */}
        <DemoChat />
      </div>

      {!assistantNumber ? (
        <Section footer="Quem administra o Dinn precisa definir o número do assistente (VITE_WHATSAPP_NUMBER).">
          <Row icon={<WhatsAppIcon className="size-[18px]" />} label="Em breve" detail="O número do assistente ainda não foi definido" />
        </Section>
      ) : cloud === false ? (
        <Section footer="O assistente grava os lançamentos na sua conta na nuvem. No modo local, os dados ficam só neste aparelho.">
          <Row icon={<WhatsAppIcon className="size-[18px]" />} label="Entre com sua conta" detail="Disponível para contas com login" />
        </Section>
      ) : cloud === null ? (
        <div className="mb-6 grid h-24 place-items-center rounded-[22px] bg-surface shadow-card">
          <LoaderCircle className="size-5 animate-spin text-label-3" />
        </div>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={waiting ? 'codigo' : linked ? 'ligado' : 'novo'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={spring}>
            {waiting ? (
              <Section header={linked ? 'Trocar de número' : 'Conectar'} footer="Abra o WhatsApp no celular do número que vai usar e envie a mensagem como está. O código vale 30 minutos.">
                <div className="px-4 pb-4 pt-3.5 text-center">
                  <p className="text-[12px] font-medium text-label-2">Seu código</p>
                  <p className="tabular mt-1 text-[32px] font-semibold tracking-[0.18em]">{link?.code}</p>
                  <a
                    href={chatLink(linkMessage(link!.code!))}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => haptic()}
                    className="mt-3 flex h-[50px] w-full items-center justify-center gap-2 rounded-full bg-[#25d366] text-[16px] font-semibold text-white transition-transform active:scale-[0.98]"
                  >
                    <WhatsAppIcon className="size-5" /> Enviar código pelo WhatsApp
                  </a>
                  <p className="mt-3 flex items-center justify-center gap-1.5 text-[12.5px] text-label-2">
                    <LoaderCircle className="size-3.5 animate-spin" /> Esperando sua mensagem…
                  </p>
                </div>
              </Section>
            ) : linked ? (
              <>
                <Section header="Seu WhatsApp">
                  <Row icon={<CircleCheck className="size-[18px] text-green" />} label="Conectado" detail={fmtPhone(link!.phone!)} />
                  <a
                    href={chatLink()}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => haptic()}
                    className="relative flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-fill/50 active:bg-fill"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#25d366] text-white">
                      <WhatsAppIcon className="size-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">Abrir conversa</span>
                      <span className="mt-0.5 block truncate text-[12px] text-label-2">Assistente: {fmtPhone(assistantNumber)}</span>
                    </span>
                  </a>
                  <Row icon={<UserPlus className="size-[18px]" />} label="Salvar nos contatos" detail="Para achar o assistente rápido" onClick={saveContact} />
                </Section>
                <Section>
                  <Row icon={<Repeat className="size-[18px]" />} label="Trocar de número" onClick={newCode} />
                  <Row icon={<Unlink className="size-[18px] text-red" />} label={<span className="text-red">Desconectar</span>} onClick={unlink} />
                </Section>
              </>
            ) : (
              <Section header="Conectar" footer="Só o número conectado consegue lançar na sua conta.">
                <ol className="space-y-2.5 px-4 py-4 text-[14px] leading-[19px]">
                  {['Toque em Conectar para receber um código.', 'Envie o código pelo WhatsApp para o número do Dinn.', 'Pronto: é só mandar seus gastos para esse número.'].map((t, k) => (
                    <li key={t} className="flex gap-3">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-fill text-[12px] font-semibold">{k + 1}</span>
                      <span className="pt-0.5 text-label-2">{t}</span>
                    </li>
                  ))}
                </ol>
                <div className="px-4 pb-4">
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.98 }}
                    onClick={newCode}
                    disabled={busy}
                    className="flex h-[50px] w-full items-center justify-center gap-2 rounded-full bg-[#25d366] text-[16px] font-semibold text-white disabled:opacity-60"
                  >
                    {busy ? <LoaderCircle className="size-5 animate-spin" /> : <WhatsAppIcon className="size-5" />} Conectar meu WhatsApp
                  </motion.button>
                </div>
              </Section>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      <Section header="O que dá para mandar">
        <Row icon={<MessageSquareText className="size-[18px]" />} label="Texto" detail="“uber 23,50” · “recebi 2 mil de salário”" />
        <Row icon={<AudioLines className="size-[18px]" />} label="Áudio" detail="Fale do seu jeito, como falaria com alguém" />
        <Row icon={<FileText className="size-[18px]" />} label="Print ou PDF" detail="Comprovante, Pix, nota fiscal, fatura" />
        <Row icon={<HelpCircle className="size-[18px]" />} label="Perguntas" detail="“quanto gastei este mês?” · “saldo do Nubank”" />
        <Row icon={<Undo2 className="size-[18px]" />} label="Desfazer" detail="Responda “desfazer” e o último lançamento sai" />
      </Section>
    </>
  )
}
