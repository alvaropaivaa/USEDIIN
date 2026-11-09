// Notificações push do Dinn: resumo diário (cron de hora em hora), teste e avisos
// entre os aparelhos do mesmo usuário. Publicada com --no-verify-jwt: o cron entra com
// o cabeçalho x-cron-secret e o app com o token da sessão.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendPush, type PushKeys, type PushOptions } from './webpush.ts'
import { alertHour, buildDigest, hasAccess, localNow, type CardRow, type CategoryRow, type DebtRow, type Digest, type ProfileRow, type TxRow } from './digest.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const keys: PushKeys = {
  publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
  privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
  subject: Deno.env.get('VAPID_SUBJECT') || 'mailto:contato@jurospro.app',
}
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''

// cliente com a chave de serviço (ignora o RLS)
const connect = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
type Admin = ReturnType<typeof connect>

interface Sub {
  endpoint: string
  user_id: string
  p256dh: string
  auth: string
  tz: string
  last_digest: string | null
}

interface Message {
  type: string
  title: string
  body: string
  url: string
  tag: string
  key: string
  badge?: number
}

// o que o service worker recebe
const payload = (m: Message) =>
  JSON.stringify({ type: m.type, title: m.title, body: m.body, url: m.url, tag: m.tag, key: m.key, at: new Date().toISOString(), ...(m.badge != null ? { badge: m.badge } : {}) })

// ─── Utilitários ─────────────────────────────────────────────

/** Roda `fn` em todos os itens, no máximo `limit` ao mesmo tempo. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

const chunks = <T>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))

// o PostgREST devolve no máximo 1000 linhas por consulta (padrão do Supabase)
const PAGE = 1000

async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>) {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw error
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE) return out
  }
}

// o endpoint é um segredo do aparelho: nos logs vai só o host
const host = (endpoint: string) => {
  try {
    return new URL(endpoint).host
  } catch {
    return '?'
  }
}

/** Compara o segredo do cron sem vazar nada pelo tempo de resposta. */
async function sameSecret(a: string, b: string) {
  if (!a || !b) return false
  const hash = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const [x, y] = await Promise.all([hash(a), hash(b)])
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

async function caller(admin: Admin, req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data } = await admin.auth.getUser(token)
  return data.user
}

// ─── Entrega ─────────────────────────────────────────────────

interface Job {
  sub: Pick<Sub, 'endpoint' | 'p256dh' | 'auth'>
  messages: { payload: string; opts: PushOptions }[]
}

/** Envia (em ordem por aparelho, vários aparelhos em paralelo) e apaga as inscrições que sumiram. */
async function deliver(admin: Admin, jobs: Job[]) {
  let sent = 0
  const gone: string[] = []
  await pool(jobs, 6, async ({ sub, messages }) => {
    for (const m of messages) {
      const r = await sendPush(sub, m.payload, keys, m.opts)
      if (r.ok) sent++
      else if (r.gone) {
        gone.push(sub.endpoint)
        return
      } else console.warn('[push] falhou', host(sub.endpoint), r.status, r.text ?? '')
    }
  })
  for (const part of chunks(gone, 20)) {
    const { error } = await admin.from('push_subscriptions').delete().in('endpoint', part)
    if (error) console.warn('[push] não apagou inscrições', error.message)
  }
  return { sent, removed: gone.length }
}

// ─── Resumo diário ───────────────────────────────────────────

const DIGEST_TTL = 12 * 3600

/** Roda de hora em hora: manda o resumo para os aparelhos em que agora é a hora escolhida. */
async function digest(admin: Admin) {
  const now = new Date()
  const subs = await readAll<Sub>((a, b) =>
    admin.from('push_subscriptions').select('endpoint, user_id, p256dh, auth, tz, last_digest').order('endpoint').range(a, b),
  )

  // aparelhos que ainda não receberam o resumo do dia local, por usuário
  const byUser = new Map<string, (Sub & { date: string; hour: number })[]>()
  for (const s of subs) {
    const { date, hour } = localNow(s.tz, now)
    if (s.last_digest === date) continue
    const list = byUser.get(s.user_id) ?? []
    list.push({ ...s, date, hour })
    byUser.set(s.user_id, list)
  }

  // a hora do resumo está nos ajustes: busca de todos de uma vez
  const settings = new Map<string, Record<string, unknown>>()
  for (const ids of chunks([...byUser.keys()], 100)) {
    const { data, error } = await admin.from('user_settings').select('user_id, settings').in('user_id', ids)
    if (error) throw error
    for (const r of (data ?? []) as { user_id: string; settings: Record<string, unknown> | null }[]) settings.set(r.user_id, r.settings ?? {})
  }

  const due = [...byUser].flatMap(([id, list]) => {
    const s = settings.get(id) ?? null
    const ready = list.filter((x) => x.hour === alertHour(s))
    return ready.length ? [{ id, settings: s, subs: ready }] : []
  })

  const totals = { users: 0, sent: 0, removed: 0 }
  await pool(due, 4, async (u) => {
    try {
      const { data, error } = await admin.from('profiles').select('blocked, expires_at').eq('id', u.id).maybeSingle()
      if (error) throw error
      const profile = data as ProfileRow | null
      // sem acesso (teste vencido, bloqueado) não precisa nem ler os dados
      const records = u.subs.some((s) => hasAccess(profile, s.date))
        ? await readAll<{ kind: string; id: string; data: Record<string, unknown> }>((a, b) =>
            admin.from('records').select('kind, id, data').eq('user_id', u.id).in('kind', ['transactions', 'debts', 'cards', 'categories']).order('kind').order('id').range(a, b),
          )
        : []
      const of = <T,>(kind: string) => records.filter((r) => r.kind === kind && r.data && typeof r.data === 'object').map((r) => ({ ...r.data, id: r.id }) as T)
      const transactions = of<TxRow>('transactions')
      const debts = of<DebtRow>('debts')
      const cards = of<CardRow>('cards')
      const categories = of<CategoryRow>('categories')

      // aparelhos em fusos diferentes podem estar em dias diferentes
      const byDate = new Map<string, Digest>()
      const jobs: Job[] = []
      for (const sub of u.subs) {
        let d = byDate.get(sub.date)
        if (!d) byDate.set(sub.date, (d = buildDigest({ date: sub.date, settings: u.settings, profile, transactions, debts, cards, categories })))
        const badge = d.badge
        if (d.notices.length)
          jobs.push({ sub, messages: d.notices.map(({ urgency, ...n }) => ({ payload: payload({ ...n, badge }), opts: { ttl: DIGEST_TTL, urgency } })) })
      }
      const r = await deliver(admin, jobs)

      // marca o dia como feito mesmo sem avisos, para não recalcular toda hora
      for (const date of byDate.keys()) {
        const endpoints = u.subs.filter((s) => s.date === date).map((s) => s.endpoint)
        const { error } = await admin.from('push_subscriptions').update({ last_digest: date }).in('endpoint', endpoints)
        if (error) console.warn('[push] não marcou o resumo', error.message)
      }

      totals.users++
      totals.sent += r.sent
      totals.removed += r.removed
    } catch (e) {
      console.error('[push] resumo falhou', u.id, e)
    }
  })
  return totals
}

// ─── Avisos do app ───────────────────────────────────────────

const LIMITS = { type: 80, title: 120, body: 400, url: 400, tag: 80, key: 80 } as const

/** Aviso mandado pelo app (pagamento, contrato novo…): valida antes de repassar. */
function readMessage(v: unknown): Message | null {
  if (!v || typeof v !== 'object') return null
  const n = v as Record<string, unknown>
  for (const k of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const s = n[k]
    if (typeof s !== 'string' || s.length > LIMITS[k]) return null
    if (k !== 'body' && !s.trim()) return null
  }
  // só caminhos do próprio app (nada de //outro-site)
  if (!/^\/(?![/\\])/.test(n.url as string)) return null
  const badge = n.badge
  if (badge !== undefined && !(typeof badge === 'number' && Number.isInteger(badge) && badge >= 0 && badge <= 9999)) return null
  const m = n as unknown as Message
  return { type: m.type, title: m.title, body: m.body, url: m.url, tag: m.tag, key: m.key, ...(badge !== undefined ? { badge: badge as number } : {}) }
}

const mySubs = async (admin: Admin, userId: string) => {
  const { data, error } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', userId)
  if (error) throw error
  return (data ?? []) as Job['sub'][]
}

// ─── Servidor ────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)
  if (!keys.publicKey || !keys.privateKey) return json({ error: 'Notificações não configuradas no servidor.' }, 500)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Pedido inválido.' }, 400)
  }

  const admin = connect()

  try {
    if (body.action === 'cron') {
      if (!(await sameSecret(req.headers.get('x-cron-secret') ?? '', CRON_SECRET))) return json({ error: 'Não autorizado.' }, 401)
      const r = await digest(admin)
      console.log('[push] resumo', r)
      return json(r)
    }

    const user = await caller(admin, req)
    if (!user) return json({ error: 'Sessão expirada. Entre de novo.' }, 401)

    switch (body.action) {
      case 'test': {
        const only = typeof body.endpoint === 'string' && body.endpoint ? body.endpoint : null
        const subs = (await mySubs(admin, user.id)).filter((s) => !only || s.endpoint === only)
        if (!subs.length) return json({ error: 'Nenhum aparelho inscrito.' }, 404)
        const msg = payload({ type: 'teste', title: 'Notificações ativadas', body: 'É assim que os avisos do Dinn vão chegar.', url: '/', tag: 'teste', key: `teste:${Date.now()}` })
        return json(await deliver(admin, subs.map((sub) => ({ sub, messages: [{ payload: msg, opts: { ttl: 600, urgency: 'high' } }] }))))
      }
      case 'event': {
        const m = readMessage(body.notification)
        if (!m) return json({ error: 'Aviso inválido.' }, 400)
        const except = typeof body.except === 'string' ? body.except : ''
        const subs = (await mySubs(admin, user.id)).filter((s) => s.endpoint !== except)
        const msg = payload(m)
        return json(await deliver(admin, subs.map((sub) => ({ sub, messages: [{ payload: msg, opts: { ttl: 86400, urgency: 'normal' } }] }))))
      }
      default:
        return json({ error: 'Ação desconhecida.' }, 400)
    }
  } catch (e) {
    console.error('[push] erro', e)
    return json({ error: 'Não foi possível enviar as notificações.' }, 500)
  }
})
