// Rede dos provedores de WhatsApp: enviar texto e baixar mídia.
// Portado do CheckZap (server/src/whatsapp/lure.ts e meta.ts).

import type { MediaRef } from './providers.ts'

/** Maior arquivo que o assistente baixa. */
export const MAX_DOWNLOAD = 20 * 1024 * 1024

export interface Transport {
  send(to: string, text: string): Promise<void>
  download(media: MediaRef): Promise<{ bytes: Uint8Array; mime: string }>
}

async function readBody(res: Response, what: string) {
  const text = await res.text().catch(() => '')
  let json: Record<string, unknown> = {}
  try {
    const j = text ? JSON.parse(text) : {}
    if (j && typeof j === 'object' && !Array.isArray(j)) json = j
  } catch {
    /* corpo que não é JSON vai no erro */
  }
  if (!res.ok || json.error === true) throw new Error(`${what} respondeu ${res.status}: ${String(json.message ?? json.error ?? text.slice(0, 200))}`)
  return json
}

/** Baixa um link https com teto de tamanho. */
async function fetchFile(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`download respondeu ${res.status}`)
  if (Number(res.headers.get('content-length') ?? 0) > MAX_DOWNLOAD) throw new Error('arquivo grande demais')
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.length > MAX_DOWNLOAD) throw new Error('arquivo grande demais')
  return { bytes: buf, mime: res.headers.get('content-type') ?? '' }
}

// ─── Lure API ────────────────────────────────────────────────

export interface LureConfig {
  apiUrl: string
  instanceId: string
  token: string
}

export function lureTransport(cfg: LureConfig): Transport {
  const call = async (path: string, body: unknown, timeout = 20_000) => {
    const url = new URL(`${cfg.apiUrl}${path}`)
    url.searchParams.set('instanceId', cfg.instanceId)
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    })
    return readBody(res, 'Lure API')
  }
  return {
    async send(to, text) {
      await call('/v1/message/send-text', { phone: to, message: text.slice(0, 4096) })
    },
    async download(media) {
      if (media.provider !== 'lure') throw new Error('mídia de outro provedor')
      // a Lure API devolve um link temporário do arquivo já aberto
      const r = await call('/v1/message/download-media', { mediaKey: media.mediaKey, directPath: media.directPath, mimetype: media.mimetype, type: media.type }, 30_000)
      const link = typeof r.fileLink === 'string' ? r.fileLink : ''
      if (!link.startsWith('https://')) throw new Error('link de mídia inesperado')
      const file = await fetchFile(link)
      return { bytes: file.bytes, mime: media.mimetype || file.mime }
    },
  }
}

/** Aponta o webhook de mensagem recebida da instância para a função (rota de configuração). */
export async function setLureWebhook(cfg: LureConfig, url: string) {
  const api = new URL(`${cfg.apiUrl}/v1/webhook/update-webhook-received`)
  api.searchParams.set('instanceId', cfg.instanceId)
  const res = await fetch(api, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: url }),
    signal: AbortSignal.timeout(20_000),
  })
  await readBody(res, 'Lure API')
  const status = new URL(`${cfg.apiUrl}/v1/instance/status-instance`)
  status.searchParams.set('instanceId', cfg.instanceId)
  const s = await fetch(status, { headers: { Authorization: `Bearer ${cfg.token}` }, signal: AbortSignal.timeout(10_000) })
    .then((r) => readBody(r, 'Lure API'))
    .catch(() => ({}) as Record<string, unknown>)
  return { connected: s.connected === true }
}

// ─── Meta (WhatsApp Business Cloud API) ──────────────────────

export interface MetaConfig {
  graphVersion: string
  phoneNumberId: string
  token: string
}

export function metaTransport(cfg: MetaConfig): Transport {
  const graph = `https://graph.facebook.com/${cfg.graphVersion}`
  const auth = { Authorization: `Bearer ${cfg.token}` }
  return {
    async send(to, text) {
      const res = await fetch(`${graph}/${cfg.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: text.slice(0, 4096) } }),
        signal: AbortSignal.timeout(15_000),
      })
      await readBody(res, 'Meta')
    },
    async download(media) {
      if (media.provider !== 'meta') throw new Error('mídia de outro provedor')
      // duas etapas: os dados da mídia (com o link) e o arquivo, os dois com o token
      const info = await readBody(await fetch(`${graph}/${encodeURIComponent(media.id)}`, { headers: auth, signal: AbortSignal.timeout(15_000) }), 'Meta')
      const url = typeof info.url === 'string' ? info.url : ''
      if (!/^https:\/\/[a-z0-9.-]*(facebook|fbcdn|whatsapp)\.(com|net)\//i.test(url)) throw new Error('link de mídia inesperado')
      const file = await fetchFile(url, auth)
      return { bytes: file.bytes, mime: (typeof info.mime_type === 'string' && info.mime_type) || media.mimetype || file.mime }
    },
  }
}
