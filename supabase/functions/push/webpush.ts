// Envio de Web Push sem dependências: conteúdo cifrado em aes128gcm (RFC 8291 + RFC 8188)
// e identificação do servidor por VAPID (RFC 8292). Só usa WebCrypto, então roda igual
// no Deno (Edge Function) e no Node (testes).

/** Chaves VAPID em base64url: pública = ponto P-256 sem compressão (65 bytes), privada = d (32 bytes). */
export interface PushKeys {
  publicKey: string
  privateKey: string
  /** mailto: ou https: de contato, exigido pelos serviços de push. */
  subject: string
}

/** Inscrição do aparelho, como vem de PushSubscription.toJSON() (chaves em base64url). */
export interface PushTarget {
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushOptions {
  /** Segundos que o serviço de push guarda a mensagem se o aparelho estiver offline. */
  ttl?: number
  urgency?: 'very-low' | 'low' | 'normal' | 'high'
  /** Mensagem nova com o mesmo tópico substitui a antiga ainda não entregue. */
  topic?: string
}

export interface PushResult {
  ok: boolean
  status: number
  /** Inscrição não existe mais (404/410 ou chaves inválidas): pode apagar. */
  gone: boolean
  text?: string
}

const enc = new TextEncoder()
const RS = 4096
// cabeçalho do aes128gcm: salt(16) + rs(4) + idlen(1) + chave pública efêmera(65)
const HEADER = 86
// o corpo inteiro precisa caber em 4096 bytes (limite dos serviços de push)
const MAX_PAYLOAD = RS - HEADER - 1 - 16

// ─── base64url e bytes ───────────────────────────────────────

export const b64u = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const unb64u = (s: string) => {
  const t = s.trim().replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const hkdf = async (salt: BufferSource, ikm: BufferSource, info: BufferSource, length: number) => {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8))
}

// ─── Cifra (RFC 8291) ────────────────────────────────────────

/** Cifra o texto para a inscrição: um único registro aes128gcm, pronto para o corpo do POST. */
export async function encrypt(target: Pick<PushTarget, 'p256dh' | 'auth'>, payload: string | Uint8Array) {
  const uaPublic = unb64u(target.p256dh)
  const authSecret = unb64u(target.auth)
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('p256dh inválida')
  if (authSecret.length < 16) throw new Error('auth inválida')
  const data = typeof payload === 'string' ? enc.encode(payload) : payload
  if (data.length > MAX_PAYLOAD) throw new Error(`mensagem grande demais (${data.length} bytes)`)

  // par efêmero do servidor, novo a cada mensagem
  const ua = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: ua }, pair.privateKey, 256))

  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic)
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)

  // registro único: texto + delimitador 0x02 (último registro), sem preenchimento
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, concat(data, new Uint8Array([2]))))

  const header = new Uint8Array(21)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, RS)
  header[20] = asPublic.length
  return concat(header, asPublic, cipher)
}

// ─── VAPID (RFC 8292) ────────────────────────────────────────

const signers = new Map<string, Promise<CryptoKey>>()
const tokens = new Map<string, { jwt: string; until: number }>()
// o JWT vale 12 h; reaproveita por alguns minutos para não assinar a cada envio
const REUSE_MS = 10 * 60 * 1000

const signer = (keys: PushKeys) => {
  let key = signers.get(keys.publicKey)
  if (!key) {
    const pub = unb64u(keys.publicKey)
    if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY inválida')
    // a importação em JWK precisa de x e y, que saem da chave pública
    const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: keys.privateKey.trim().replace(/=+$/, '') }
    key = crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
    // se a chave for inválida, tenta de novo na próxima vez
    key.catch(() => signers.delete(keys.publicKey))
    signers.set(keys.publicKey, key)
  }
  return key
}

/** JWT ES256 do VAPID para a origem do serviço de push. */
export async function vapidToken(audience: string, keys: PushKeys, now = Date.now()) {
  const id = `${keys.publicKey}|${keys.subject}|${audience}`
  const hit = tokens.get(id)
  if (hit && hit.until > now) return hit.jwt
  const part = (o: unknown) => b64u(enc.encode(JSON.stringify(o)))
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })}`
  // WebCrypto já devolve a assinatura no formato do JWT (r || s, 64 bytes)
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signer(keys), enc.encode(unsigned)))
  const jwt = `${unsigned}.${b64u(sig)}`
  tokens.set(id, { jwt, until: now + REUSE_MS })
  return jwt
}

// ─── Envio ───────────────────────────────────────────────────

/** Cifra e entrega uma mensagem. Nunca lança: falhas voltam em { ok: false }. */
export async function sendPush(target: PushTarget, payload: string, keys: PushKeys, opts: PushOptions = {}): Promise<PushResult> {
  const data = enc.encode(payload)
  if (data.length > MAX_PAYLOAD) return { ok: false, status: 0, gone: false, text: `mensagem grande demais (${data.length} bytes)` }
  let url: URL
  let body = new Uint8Array(0)
  try {
    url = new URL(target.endpoint)
    if (url.protocol !== 'https:') throw new Error('endpoint sem https')
    body = await encrypt(target, data)
  } catch (e) {
    // inscrição malformada nunca vai funcionar: marca para apagar
    return { ok: false, status: 0, gone: true, text: e instanceof Error ? e.message : String(e) }
  }

  try {
    const jwt = await vapidToken(url.origin, keys)
    const headers: Record<string, string> = {
      Authorization: `vapid t=${jwt}, k=${keys.publicKey.trim().replace(/=+$/, '')}`,
      TTL: String(Math.max(0, Math.round(opts.ttl ?? 86400))),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Urgency: opts.urgency ?? 'normal',
    }
    if (opts.topic) headers.Topic = opts.topic
    const res = await fetch(target.endpoint, { method: 'POST', headers, body })
    // lê a resposta sempre, para liberar a conexão
    const text = await res.text().catch(() => '')
    return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410, ...(res.ok ? {} : { text: text.slice(0, 500) }) }
  } catch (e) {
    return { ok: false, status: 0, gone: false, text: e instanceof Error ? e.message : String(e) }
  }
}
