// Leitura dos webhooks dos provedores de WhatsApp, sem rede: o que chega vira uma mensagem no
// mesmo formato para o resto da função. Também as assinaturas dos webhooks (Web Crypto, que existe
// no Deno e no Node).
//
// - Lure API (formato W-API, número conectado por QR code): https://api.assessorialuredigital.com.br/docs/#webhooks
//   Leitura portada do CheckZap (server/src/whatsapp/lureFormato.ts e lureLeitura.ts).
// - WhatsApp Business Cloud API (Meta): https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks

export type MsgKind = 'texto' | 'audio' | 'imagem' | 'documento' | 'outro'

/** Como baixar a mídia na Lure API (download-media) ou na Meta (id da mídia). */
export type MediaRef =
  | { provider: 'lure'; mediaKey: string; directPath: string; mimetype: string; type: 'image' | 'audio' | 'document' | 'video' | 'sticker' }
  | { provider: 'meta'; id: string; mimetype?: string }

export interface Incoming {
  /** id da mensagem no provedor (evita tratar a mesma duas vezes) */
  msgId: string
  /** telefone de quem mandou: só dígitos, com DDI */
  from: string
  /** nome do perfil no WhatsApp */
  name?: string
  kind: MsgKind
  /** texto (ou toque num botão) */
  text?: string
  /** legenda da foto ou do documento */
  caption?: string
  fileName?: string
  media?: MediaRef
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined)
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const cut = (s: string | undefined, n: number) => (s ? s.slice(0, n) : undefined)

/** Dígitos do telefone de um JID ("5585999998888@s.whatsapp.net" ou só os dígitos); vazio para @lid e grupos. */
export function phoneFromJid(jid?: string) {
  if (!jid) return ''
  const [user = '', domain] = jid.split('@')
  if (domain && domain !== 's.whatsapp.net' && domain !== 'c.us') return ''
  const digits = user.split(':')[0].replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15 ? digits : ''
}

// ─── Lure API ────────────────────────────────────────────────

/** Camadas que só embrulham a mensagem de verdade (temporária, visualização única, editada…). */
const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'editedMessage']

function unwrap(c: Obj, depth = 0): Obj {
  if (depth > 4) return c
  for (const k of WRAPPERS) {
    const inner = obj(obj(c[k])?.message)
    if (inner) return unwrap(inner, depth + 1)
  }
  return c
}

/** Toque num botão ou numa lista: o texto mostrado. */
function tapText(c: Obj) {
  return (
    str(obj(c.buttonsResponseMessage)?.selectedDisplayText) ??
    str(obj(c.templateButtonReplyMessage)?.selectedDisplayText) ??
    str(obj(c.listResponseMessage)?.title) ??
    str(obj(obj(c.interactiveResponseMessage)?.body)?.text)
  )
}

const LURE_MEDIA: [string, MsgKind, Extract<MediaRef, { provider: 'lure' }>['type'], string][] = [
  ['imageMessage', 'imagem', 'image', 'image/jpeg'],
  ['audioMessage', 'audio', 'audio', 'audio/ogg; codecs=opus'],
  ['documentMessage', 'documento', 'document', 'application/octet-stream'],
  ['videoMessage', 'outro', 'video', 'video/mp4'],
  ['stickerMessage', 'outro', 'sticker', 'image/webp'],
]

/**
 * Evento do webhook da Lure API → mensagem; null quando não interessa (eco do próprio número,
 * grupo, histórico, status, conexão, ou sem telefone de quem mandou).
 */
export function parseLure(body: unknown): Incoming | null {
  const ev = obj(body)
  if (!ev || String(ev.event ?? '').toLowerCase() !== 'webhookreceived') return null
  if (ev.fromMe === true || ev.isGroup === true || ev.historical === true) return null
  const msgId = str(ev.messageId)
  if (!msgId) return null
  const chat = obj(ev.chat)
  const sender = obj(ev.sender)
  const chatId = str(chat?.id) ?? ''
  if (chatId.endsWith('@g.us') || chatId === 'status@broadcast') return null
  // conversa pelo LID (número escondido): o telefone pode vir em outro campo
  const from =
    phoneFromJid(str(sender?.id)) ||
    phoneFromJid(chatId) ||
    phoneFromJid(str(sender?.senderPn)) ||
    phoneFromJid(str(sender?.phone)) ||
    phoneFromJid(str(ev.senderPn)) ||
    phoneFromJid(str(ev.phone))
  if (!from) return null
  const name = cut(str(sender?.pushName), 120)
  const c = unwrap(obj(ev.msgContent) ?? {})
  const text = str(c.conversation) ?? str(obj(c.extendedTextMessage)?.text) ?? tapText(c)
  if (text) return { msgId, from, name, kind: 'texto', text: text.slice(0, 4000) }
  for (const [key, kind, type, fallbackMime] of LURE_MEDIA) {
    const m = obj(c[key])
    if (!m) continue
    const mediaKey = str(m.mediaKey)
    const directPath = str(m.directPath)
    const mimetype = str(m.mimetype) ?? fallbackMime
    return {
      msgId,
      from,
      name,
      kind,
      caption: cut(str(m.caption), 1000),
      fileName: cut(str(m.fileName) ?? str(m.title), 200),
      ...(mediaKey && directPath ? { media: { provider: 'lure' as const, mediaKey, directPath, mimetype, type } } : {}),
    }
  }
  return { msgId, from, name, kind: 'outro' }
}

// ─── Meta (WhatsApp Business Cloud API) ──────────────────────

interface MetaMessage {
  id?: string
  from?: string
  type?: string
  text?: { body?: string }
  image?: { id?: string; caption?: string; mime_type?: string }
  audio?: { id?: string; mime_type?: string }
  document?: { id?: string; caption?: string; filename?: string; mime_type?: string }
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } }
  button?: { text?: string }
}

/** Corpo do webhook da Meta → mensagens (pode trazer várias; status de entrega e leitura ficam de fora). */
export function parseMeta(body: unknown, phoneNumberId?: string): Incoming[] {
  const b = obj(body)
  if (!b || b.object !== 'whatsapp_business_account') return []
  const out: Incoming[] = []
  for (const entry of (Array.isArray(b.entry) ? b.entry : []) as Obj[]) {
    for (const change of (Array.isArray(entry?.changes) ? entry.changes : []) as Obj[]) {
      const value = obj(change?.value)
      if (!value) continue
      // outro número da mesma conta Meta: não é com este assistente
      if (phoneNumberId && str(obj(value.metadata)?.phone_number_id) !== phoneNumberId) continue
      const names = new Map(((Array.isArray(value.contacts) ? value.contacts : []) as Obj[]).map((c) => [str(c?.wa_id) ?? '', str(obj(c?.profile)?.name) ?? '']))
      for (const m of (Array.isArray(value.messages) ? value.messages : []) as MetaMessage[]) {
        const msgId = str(m?.id)
        const from = (m?.from ?? '').replace(/\D/g, '')
        if (!msgId || from.length < 10) continue
        const name = cut(names.get(m.from ?? '') || undefined, 120)
        const base = { msgId, from, name }
        const tap = str(m.interactive?.button_reply?.title) ?? str(m.interactive?.list_reply?.title) ?? str(m.button?.text)
        if (m.type === 'text' && str(m.text?.body)) out.push({ ...base, kind: 'texto', text: m.text!.body!.trim().slice(0, 4000) })
        else if (tap) out.push({ ...base, kind: 'texto', text: tap.slice(0, 4000) })
        else if (m.type === 'image' && m.image?.id) out.push({ ...base, kind: 'imagem', caption: cut(str(m.image.caption), 1000), media: { provider: 'meta', id: m.image.id, mimetype: m.image.mime_type } })
        else if (m.type === 'audio' && m.audio?.id) out.push({ ...base, kind: 'audio', media: { provider: 'meta', id: m.audio.id, mimetype: m.audio.mime_type } })
        else if (m.type === 'document' && m.document?.id)
          out.push({ ...base, kind: 'documento', caption: cut(str(m.document.caption), 1000), fileName: cut(str(m.document.filename), 200), media: { provider: 'meta', id: m.document.id, mimetype: m.document.mime_type } })
        else out.push({ ...base, kind: 'outro' })
      }
    }
  }
  return out
}

// ─── Assinaturas ─────────────────────────────────────────────

const enc = new TextEncoder()

async function hmac(secret: string, data: Uint8Array<ArrayBuffer> | string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, typeof data === 'string' ? enc.encode(data) : data))
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const base64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Comparação em tempo constante (não vaza quantos caracteres batem). */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Assinatura que vai na URL do webhook da Lure API (os eventos dela não vêm assinados): só quem
 * tem o segredo monta a URL que aceita eventos daquela instância. Mesmo formato do CheckZap.
 */
export const lureSignature = async (secret: string, instanceId: string) => base64url(await hmac(secret, `lure-webhook:${instanceId}`)).slice(0, 32)

/** Confere o X-Hub-Signature-256 da Meta (HMAC-SHA256 do corpo bruto com o App Secret). */
export async function metaSignatureOk(appSecret: string, rawBody: Uint8Array<ArrayBuffer>, header: string | null) {
  if (!header?.startsWith('sha256=')) return false
  return safeEqual(header, `sha256=${hex(await hmac(appSecret, rawBody))}`)
}
