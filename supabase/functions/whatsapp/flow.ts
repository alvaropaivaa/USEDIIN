// O caminho de cada mensagem: não repetir, achar a conta pelo telefone (ou ligar pelo código),
// conferir o acesso, entender (áudio, foto, PDF, texto) com o cérebro comum, gravar e responder.
// Tudo o que fala com a rede chega por `Deps`, então o fluxo inteiro roda nos testes.

import { hasAccess, type ProfileAccess } from '../_shared/assistente/access.ts'
import { toBase64 } from '../_shared/assistente/transcribe.ts'
import { IMAGE_MIMES, LIMITS, type AssistantInput, type InterpretRequest, type InterpretResult } from '../_shared/assistente/types.ts'
import { execute } from './actions.ts'
import { KINDS, assistantContext, historyOf, userData, type LogEntry, type LogRecord, type RecordRow } from './data.ts'
import { texts } from './format.ts'
import type { Transaction } from './ledger.ts'
import { codeCandidates, isUndoCommand, looksLikeLink, phoneVariants } from './link.ts'
import type { Incoming, MediaRef } from './providers.ts'

export interface Link {
  user_id: string
  phone: string | null
}

export interface Profile extends ProfileAccess {
  name?: string | null
}

/** Banco (service role). */
export interface Store {
  /** Registra a mensagem; false se ela já tinha chegado (o provedor reenvia). */
  claim(row: { msg_id: string; phone: string; kind: Incoming['kind'] }): Promise<boolean>
  finish(msgId: string, patch: { user_id?: string; input?: string; records?: LogRecord[]; reply?: string }): Promise<void>
  linkByPhone(phones: string[]): Promise<Link | null>
  /** Código ainda válido (code_expires depois de agora). */
  linkByCode(codes: string[]): Promise<Link | null>
  /** Liga o telefone à conta (e tira as formas dele de qualquer outra conta). */
  link(userId: string, phone: string, variants: string[]): Promise<void>
  profile(userId: string): Promise<Profile | null>
  settings(userId: string): Promise<unknown>
  records(userId: string, kinds: readonly string[]): Promise<RecordRow[]>
  /** Últimas mensagens da pessoa, a mais nova primeiro, sem a atual. */
  recent(userId: string, limit: number, exceptMsgId: string): Promise<LogEntry[]>
  upsert(userId: string, txs: Transaction[]): Promise<void>
  remove(userId: string, ids: string[]): Promise<void>
  markUndone(logId: number): Promise<void>
}

export interface Deps {
  store: Store
  /** hoje (AAAA-MM-DD) no fuso da pessoa */
  today: string
  uid: () => string
  send(to: string, text: string): Promise<void>
  download(media: MediaRef): Promise<{ bytes: Uint8Array; mime: string }>
  /** transcrição de áudio; null quando não configurada */
  transcribe: ((bytes: Uint8Array, mime: string) => Promise<string | null>) | null
  /** o cérebro comum (_shared/assistente/brain.ts interpret, já com o cliente do Claude) */
  interpret(req: InterpretRequest): Promise<InterpretResult>
  appUrl?: string
  log(message: string, extra?: Record<string, unknown>): void
}

const baseMime = (m: string) => m.split(';')[0].trim().toLowerCase()

class Reply extends Error {}

/** Áudio, foto ou PDF → o que vai para a IA; erros viram a resposta certa para a pessoa. */
async function inputOf(msg: Incoming, deps: Deps): Promise<AssistantInput> {
  if (msg.kind === 'texto') return { text: msg.text, source: 'texto' }
  if (msg.kind === 'outro') throw new Reply(texts.unsupported)
  if (!msg.media) throw new Reply(texts.badMedia)
  if (msg.kind === 'audio' && !deps.transcribe) throw new Reply(texts.noTranscription)
  let file: { bytes: Uint8Array; mime: string }
  try {
    file = await deps.download(msg.media)
  } catch (e) {
    deps.log('falha ao baixar mídia', { error: String(e) })
    throw new Reply(texts.badMedia)
  }
  const mime = baseMime(file.mime || msg.media.mimetype || '')
  if (msg.kind === 'audio') {
    const said = await deps.transcribe!(file.bytes, mime || 'audio/ogg').catch((e) => (deps.log('falha na transcrição', { error: String(e) }), null))
    if (!said?.trim()) throw new Reply(texts.badAudio)
    return { text: said.trim().slice(0, LIMITS.text), source: 'audio' }
  }
  const pdf = mime === 'application/pdf' || /\.pdf$/i.test(msg.fileName ?? '')
  const image = (IMAGE_MIMES as readonly string[]).includes(mime) ? mime : msg.kind === 'imagem' ? 'image/jpeg' : undefined
  if (pdf) {
    if (file.bytes.length > LIMITS.pdfBytes) throw new Reply(texts.tooBig)
    return { text: msg.caption, pdf: { base64: toBase64(file.bytes), ...(msg.fileName ? { name: msg.fileName } : {}) } }
  }
  if (image) {
    if (file.bytes.length > LIMITS.imageBytes) throw new Reply(texts.tooBig)
    return { text: msg.caption, images: [{ base64: toBase64(file.bytes), mime: image }] }
  }
  throw new Reply(texts.unsupportedFile)
}

/** O que fica no histórico como entrada (texto, transcrição ou a indicação do anexo). */
const inputLog = (msg: Incoming, input?: AssistantInput) => {
  const tag = msg.kind === 'imagem' ? '[foto] ' : msg.kind === 'documento' ? `[arquivo${msg.fileName ? ` ${msg.fileName}` : ''}] ` : msg.kind === 'audio' ? '[áudio] ' : ''
  return `${tag}${input?.text ?? msg.text ?? msg.caption ?? ''}`.trim().slice(0, 4000)
}

export async function handle(msg: Incoming, deps: Deps): Promise<void> {
  const { store } = deps
  if (!(await store.claim({ msg_id: msg.msgId, phone: msg.from, kind: msg.kind }))) return
  const variants = phoneVariants(msg.from)
  let userId: string | undefined
  let input: AssistantInput | undefined
  let records: LogRecord[] = []
  let reply = ''
  try {
    const linked = await store.linkByPhone(variants)

    // vínculo: número novo mandando o código, ou um número ligado trocando de conta
    if (!linked || looksLikeLink(msg.text)) {
      const codes = msg.kind === 'texto' ? codeCandidates(msg.text) : []
      const found = codes.length ? await store.linkByCode(codes) : null
      if (found) {
        await store.link(found.user_id, variants[0], variants)
        userId = found.user_id
        const [settings, profile] = await Promise.all([store.settings(found.user_id), store.profile(found.user_id)])
        const owner = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).owner : undefined
        const name = (typeof owner === 'string' && owner.trim()) || profile?.name?.trim() || msg.name || ''
        reply = texts.welcome(name.split(/\s+/)[0])
        return
      }
      if (!linked) {
        reply = looksLikeLink(msg.text) && codes.length ? texts.expiredCode : texts.notLinked(deps.appUrl)
        return
      }
      if (codes.length) {
        userId = linked.user_id
        reply = texts.alreadyLinked
        return
      }
    }

    userId = linked.user_id
    if (!hasAccess(await store.profile(userId), deps.today)) {
      reply = texts.noAccess
      return
    }

    const [rows, settings, recent] = await Promise.all([store.records(userId, KINDS), store.settings(userId), store.recent(userId, 6, msg.msgId)])
    const data = userData(rows, settings)

    let result: Pick<InterpretResult, 'reply' | 'ops'>
    if (msg.kind === 'texto' && isUndoCommand(msg.text)) {
      // "desfazer" sozinho não precisa da IA
      result = { reply: '', ops: { create: [], undo: true, correct: null } }
    } else {
      input = await inputOf(msg, deps)
      const name = data.settings.owner || msg.name
      const r = await deps.interpret({ context: assistantContext(data, { today: deps.today, name, recent }), history: historyOf(recent), input })
      if (r.outcome !== 'ok') {
        if (r.outcome === 'invalid') deps.log('resposta da IA fora do formato')
        reply = r.reply
        return
      }
      result = r
    }

    const run = execute(result.ops, result.reply, data, { today: deps.today, uid: deps.uid, recent })
    if (run.deletes.length) await store.remove(userId, run.deletes)
    if (run.upserts.length) await store.upsert(userId, run.upserts)
    if (run.undoneLog !== undefined) await store.markUndone(run.undoneLog)
    records = run.log
    reply = run.reply || texts.nothing
  } catch (e) {
    if (e instanceof Reply) reply = e.message
    else {
      deps.log('falha ao tratar mensagem', { error: e instanceof Error ? e.message : String(e) })
      reply = texts.failed
    }
  } finally {
    if (reply) await deps.send(msg.from, reply).catch((e) => deps.log('falha ao responder', { error: String(e) }))
    await store.finish(msg.msgId, { ...(userId ? { user_id: userId } : {}), input: inputLog(msg, input), records, reply }).catch((e) => deps.log('falha ao gravar o histórico', { error: String(e) }))
  }
}
