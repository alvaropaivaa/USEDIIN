// Assistente do Dinn no WhatsApp: recebe o webhook do provedor (Lure API ou Meta), responde
// 200 na hora e trata a mensagem em segundo plano (flow.ts). Publicada com --no-verify-jwt: quem
// chama é o provedor, conferido pela assinatura (ver README.md).
//
// Rotas (depois de /functions/v1/whatsapp):
//   POST /lure/<assinatura>  eventos da Lure API (a assinatura é o HMAC do instanceId)
//   GET  /meta               verificação do webhook da Meta (hub.verify_token)
//   POST /meta               eventos da Meta (X-Hub-Signature-256)
//   POST /setup              aponta o webhook da Lure API para cá (cabeçalho x-setup-secret)

import { createClient } from 'npm:@supabase/supabase-js@2'
import { todayIn } from '../_shared/assistente/access.ts'
import { DEFAULT_MODEL, interpret } from '../_shared/assistente/brain.ts'
import { claudeClient } from '../_shared/assistente/claude.ts'
import { transcribe, transcriptionFromEnv } from '../_shared/assistente/transcribe.ts'
import { supabaseStore } from './db.ts'
import { handle, type Deps } from './flow.ts'
import { lureSignature, metaSignatureOk, parseLure, parseMeta, safeEqual, type Incoming } from './providers.ts'
import { lureTransport, metaTransport, setLureWebhook, type Transport } from './transport.ts'

const env = (k: string) => Deno.env.get(k)?.trim() ?? ''

const PROVIDER = env('WHATSAPP_PROVIDER') === 'meta' ? 'meta' : 'lure'
const SECRET = env('WHATSAPP_WEBHOOK_SECRET')
const lure = { apiUrl: (env('LURE_API_URL') || 'https://api.assessorialuredigital.com.br').replace(/\/$/, ''), instanceId: env('LURE_INSTANCE_ID'), token: env('LURE_TOKEN') }
const meta = { graphVersion: env('WHATSAPP_GRAPH_VERSION') || 'v21.0', phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID'), token: env('WHATSAPP_TOKEN') }

const transport: Transport = PROVIDER === 'meta' ? metaTransport(meta) : lureTransport(lure)
const transcription = transcriptionFromEnv((k) => Deno.env.get(k))
const transcribeAudio = transcription ? (bytes: Uint8Array, mime: string) => transcribe(transcription, bytes, mime) : null
const claude = claudeClient(env('ANTHROPIC_API_KEY'))
const model = env('CLAUDE_MODEL') || DEFAULT_MODEL
const store = supabaseStore(createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } }))

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Segue processando depois da resposta (no Supabase); fora dele, só não espera. */
function background(p: Promise<unknown>) {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  if (rt) rt.waitUntil(p)
  else p.catch(() => undefined)
}

function dispatch(msgs: Incoming[]) {
  for (const msg of msgs) {
    const deps: Deps = {
      store,
      today: todayIn(),
      uid: () => crypto.randomUUID(),
      send: transport.send,
      download: transport.download,
      transcribe: transcribeAudio,
      interpret: (req) => interpret(req, claude, model),
      appUrl: env('APP_URL') || undefined,
      log: (message, extra) => console.warn(`[whatsapp] ${message}`, { msgId: msg.msgId, ...extra }),
    }
    background(handle(msg, deps).catch((e) => console.error('[whatsapp] falha', msg.msgId, e)))
  }
}

/** Partes do caminho depois do nome da função ("/whatsapp/lure/abc" → ["lure", "abc"]). */
const route = (url: URL) => {
  const parts = url.pathname.split('/').filter(Boolean)
  const at = parts.indexOf('whatsapp')
  return at >= 0 ? parts.slice(at + 1) : parts
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const [first, second] = route(url)

  if (first === 'meta' && req.method === 'GET') {
    const token = url.searchParams.get('hub.verify_token') ?? ''
    const expected = env('WHATSAPP_VERIFY_TOKEN')
    if (url.searchParams.get('hub.mode') === 'subscribe' && expected && safeEqual(token, expected)) return new Response(url.searchParams.get('hub.challenge') ?? '', { headers: { 'Content-Type': 'text/plain' } })
    return json({ error: 'verificação inválida' }, 403)
  }

  if (req.method !== 'POST') return json({ error: 'não encontrado' }, 404)

  if (first === 'meta') {
    if (PROVIDER !== 'meta') return json({ error: 'provedor desligado' }, 404)
    const secret = env('WHATSAPP_APP_SECRET')
    if (!secret) return json({ error: 'webhook não configurado' }, 503)
    const raw = new Uint8Array(await req.arrayBuffer())
    if (!(await metaSignatureOk(secret, raw, req.headers.get('x-hub-signature-256')))) return json({ error: 'assinatura inválida' }, 401)
    let body: unknown
    try {
      body = JSON.parse(new TextDecoder().decode(raw))
    } catch {
      return json({ error: 'JSON inválido' }, 400)
    }
    dispatch(parseMeta(body, meta.phoneNumberId || undefined))
    return json({ ok: true })
  }

  if (first === 'lure') {
    if (PROVIDER !== 'lure' || !SECRET || !lure.instanceId) return json({ error: 'provedor desligado' }, 404)
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const instanceId = typeof body?.instanceId === 'string' ? body.instanceId : ''
    // só a instância do assistente, e só pela URL assinada
    if (instanceId !== lure.instanceId || !second || !safeEqual(second, await lureSignature(SECRET, instanceId))) return json({ error: 'assinatura inválida' }, 401)
    const msg = parseLure(body)
    if (msg) dispatch([msg])
    return json({ ok: true })
  }

  if (first === 'setup') {
    if (!SECRET || !safeEqual(req.headers.get('x-setup-secret') ?? '', SECRET)) return json({ error: 'não autorizado' }, 401)
    const base = `${env('SUPABASE_URL').replace(/\/$/, '')}/functions/v1/whatsapp`
    if (PROVIDER === 'meta') return json({ provider: 'meta', callback: `${base}/meta`, verifyToken: !!env('WHATSAPP_VERIFY_TOKEN') })
    if (!lure.instanceId || !lure.token) return json({ error: 'LURE_INSTANCE_ID e LURE_TOKEN não configurados' }, 400)
    const webhook = `${base}/lure/${await lureSignature(SECRET, lure.instanceId)}`
    try {
      const { connected } = await setLureWebhook(lure, webhook)
      return json({ provider: 'lure', webhook, connected })
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e), webhook }, 502)
    }
  }

  return json({ error: 'não encontrado' }, 404)
})
