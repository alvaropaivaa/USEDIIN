// Sincroniza contas, cartões, categorias, lançamentos, metas, dívidas e ajustes com o Supabase.
// O app continua lendo e gravando no store local (abre na hora e funciona offline);
// cada mudança é comparada com a anterior e só o que mudou sobe para o banco (tabela public.records).
//
// Regras para não perder nada:
// - nada sobe antes de baixar a nuvem uma vez nesta sessão (senão uma conta ainda vazia na nuvem
//   receberia só um pedaço dos dados e, na próxima entrada, esse pedaço apagaria o resto);
// - a fila do que falta subir fica guardada no aparelho: fechar o app offline não perde as mudanças;
// - ao baixar, o que ainda não subiu é reaplicado por cima do que veio da nuvem.

import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { collections, defaultSettings, emptyRecords, useData, withDefaults, type Collection, type Records, type Settings } from './store'
import { legacyToDebts, type LegacyClient, type LegacyContract } from './legacy'
import { emit } from './events'
import type { Transaction } from './ledger'

// fica só neste aparelho: o PIN tranca o aparelho
type CloudSettings = Omit<Settings, 'pinHash'>

const toCloudSettings = (s: Settings): CloudSettings => {
  const { pinHash: _p, ...rest } = s
  return rest
}

type Item = { id: string }

// ─── Fila de envio ───────────────────────────────────────────

let userId: string | null = null
let applying = false
let unsubscribe: (() => void) | null = null
let timer = 0
let retry = 0
let flushing = false
/** Já baixou a nuvem nesta sessão: só então as mudanças sobem. */
let ready = false
/** Falhas seguidas: a espera entre tentativas cresce até 5 minutos. */
let failures = 0

/** 'coleção:id' → registro (null = apagar). */
const pending = new Map<string, { kind: Collection; id: string; data: Item | null }>()
let pendingSettings = false

const hasPending = () => pending.size > 0 || pendingSettings
const backoff = () => Math.min(300_000, 10_000 * 2 ** Math.max(0, failures - 1))

// ─── Fila guardada no aparelho ───────────────────────────────

const PENDING_KEY = 'jurospro-sync-pendente'

function savePending() {
  try {
    if (!userId || !hasPending()) localStorage.removeItem(PENDING_KEY)
    else localStorage.setItem(PENDING_KEY, JSON.stringify({ user: userId, keys: [...pending.keys()], settings: pendingSettings }))
  } catch {}
}

/** Refaz a fila de uma sessão anterior com os dados que estão no aparelho agora. */
function restorePending(uid: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') as { user: string; keys: string[]; settings: boolean } | null
    if (!saved || saved.user !== uid) return
    const s = useData.getState()
    for (const key of saved.keys) {
      // o id pode ter ':' (repetições de lançamento fixo): a coleção é só o começo
      const i = key.indexOf(':')
      const kind = key.slice(0, i) as Collection
      const id = key.slice(i + 1)
      if (!collections.includes(kind)) continue
      pending.set(key, { kind, id, data: (s[kind] as Item[]).find((x) => x.id === id) ?? null })
    }
    if (saved.settings) pendingSettings = true
  } catch {}
}

function schedule(delay = 700) {
  clearTimeout(timer)
  timer = window.setTimeout(flush, delay)
}

const chunks = <T>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))

async function pushRecords() {
  if (!pending.size || !userId) return
  const batch = new Map(pending)
  pending.clear()
  const now = new Date().toISOString()
  const upserts = [...batch.values()].filter((x) => x.data).map((x) => ({ user_id: userId, kind: x.kind, id: x.id, data: x.data, updated_at: now }))
  const deletes = new Map<Collection, string[]>()
  for (const x of batch.values()) if (!x.data) deletes.set(x.kind, [...(deletes.get(x.kind) ?? []), x.id])
  try {
    for (const part of chunks(upserts, 400)) {
      const { error } = await supabase.from('records').upsert(part)
      if (error) throw error
    }
    for (const [kind, ids] of deletes)
      for (const part of chunks(ids, 200)) {
        const { error } = await supabase.from('records').delete().eq('user_id', userId).eq('kind', kind).in('id', part)
        if (error) throw error
      }
  } catch (e) {
    // devolve à fila o que não foi substituído por uma mudança mais nova
    for (const [k, x] of batch) if (!pending.has(k)) pending.set(k, x)
    throw e
  }
}

async function flush() {
  if (!userId || !ready || flushing || !hasPending()) return
  flushing = true
  let failed = false
  try {
    await pushRecords()
    if (pendingSettings) {
      pendingSettings = false
      const { error } = await supabase
        .from('user_settings')
        .upsert({ user_id: userId, settings: toCloudSettings(useData.getState().settings), updated_at: new Date().toISOString() })
      if (error) {
        pendingSettings = true
        throw error
      }
    }
    failures = 0
  } catch (e) {
    failed = true
    failures++
    console.warn('[sync] falhou, tentando de novo', e)
  } finally {
    flushing = false
    savePending()
    // mudanças que chegaram durante o envio saem logo; depois de erro, espera mais a cada falha
    if (hasPending()) schedule(failed ? backoff() : 700)
  }
}

function diff(kind: Collection, next: Item[], prev: Item[]) {
  if (next === prev) return
  const before = new Map(prev.map((x) => [x.id, x]))
  for (const x of next) {
    if (before.get(x.id) !== x) pending.set(`${kind}:${x.id}`, { kind, id: x.id, data: x })
    before.delete(x.id)
  }
  for (const id of before.keys()) pending.set(`${kind}:${id}`, { kind, id, data: null })
}

function watch() {
  unsubscribe?.()
  unsubscribe = useData.subscribe((s, prev) => {
    if (applying || !userId) return
    for (const k of collections) diff(k, s[k], prev[k])
    if (s.settings !== prev.settings && JSON.stringify(toCloudSettings(s.settings)) !== JSON.stringify(toCloudSettings(prev.settings))) pendingSettings = true
    if (hasPending()) (savePending(), schedule())
  })
}

const onOnline = () => (ready ? schedule(0) : bootstrap())
const onHide = () => document.visibilityState === 'hidden' && flush()

// ─── Download ────────────────────────────────────────────────

/** Lê todas as linhas (o Supabase devolve no máximo 1000 por consulta). */
async function readAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999)
    if (error) return { data: out, error }
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return { data: out, error: null }
  }
}

async function download() {
  const [rec, st] = await Promise.all([
    readAll<{ kind: string; id: string; data: Item }>((a, b) => supabase.from('records').select('kind, id, data').order('kind').order('id').range(a, b)),
    supabase.from('user_settings').select('settings').maybeSingle(),
  ])
  const records = emptyRecords()
  const lists = Object.fromEntries(collections.map((k) => [k, [] as Item[]])) as Record<Collection, Item[]>
  for (const r of rec.data) if ((collections as readonly string[]).includes(r.kind) && r.data) lists[r.kind as Collection].push({ ...r.data, id: r.id })
  for (const k of collections) (records as unknown as Record<Collection, Item[]>)[k] = lists[k]
  return { error: rec.error ?? st.error, records, count: rec.data.length, settings: (st.data?.settings ?? null) as Partial<Settings> | null }
}

/** Clientes e contratos da versão de empréstimos (se ainda existirem na nuvem) viram dívidas. */
async function downloadLegacy() {
  const [cl, co] = await Promise.all([supabase.from('clients').select('id, name, phone, note'), supabase.from('contracts').select('*')])
  if (cl.error || co.error) return []
  const contracts = (co.data ?? []).map(
    (r): LegacyContract => ({
      id: r.id,
      clientId: r.client_id,
      kind: r.kind,
      principal: r.principal,
      rate: r.rate,
      mode: r.mode,
      frequency: r.frequency,
      createdAt: r.created_at,
      schedule: r.schedule,
      payments: r.payments,
      renegotiated: r.renegotiated,
    }),
  )
  return legacyToDebts((cl.data ?? []) as LegacyClient[], contracts)
}

/** Põe os dados da nuvem no aparelho, mantendo por cima o que ainda não subiu daqui. */
function apply(records: Records, settings: Partial<Settings> | null) {
  const lists = records as unknown as Record<Collection, Item[]>
  for (const { kind, id, data } of pending.values()) {
    const rest = lists[kind].filter((x) => x.id !== id)
    lists[kind] = data ? [...rest, data] : rest
  }
  applying = true
  useData.setState((s) => ({
    ...records,
    // a nuvem sem categorias (conta antiga) fica com as padrão
    categories: records.categories.length ? records.categories : s.categories.length ? s.categories : emptyRecords().categories,
    settings: settings && !pendingSettings ? { ...withDefaults(settings), pinHash: s.settings.pinHash } : s.settings,
  }))
  applying = false
}

// ─── Mudanças de fora (assistente do WhatsApp, outro aparelho) ───

let channel: RealtimeChannel | null = null
let incoming: { kind: Collection; id: string; data: Item | null }[] = []
let incomingTimer = 0

/**
 * Põe no aparelho os registros que mudaram na nuvem, juntos (um lote por vez, não uma tela
 * por registro). O que mudou aqui e ainda não subiu fica como está aqui; registros iguais
 * aos do aparelho não são trocados (as telas não recalculam à toa).
 */
function applyIncoming() {
  if (!incoming.length) return
  // ainda baixando a nuvem pela primeira vez: espera (o download pode não ter visto estas mudanças)
  if (!ready) return void (incomingTimer = window.setTimeout(applyIncoming, 1000))
  const batch = incoming
  incoming = []
  const s = useData.getState()
  const next: Partial<Record<Collection, Item[]>> = {}
  const arrived: Transaction[] = []
  for (const { kind, id, data } of batch) {
    if (pending.has(`${kind}:${id}`)) continue
    const list = next[kind] ?? (s[kind] as Item[])
    const i = list.findIndex((x) => x.id === id)
    if (!data) {
      if (i >= 0) next[kind] = list.filter((x) => x.id !== id)
      continue
    }
    if (i >= 0 && JSON.stringify(list[i]) === JSON.stringify(data)) continue
    next[kind] = i >= 0 ? list.map((x) => (x.id === id ? data : x)) : [...list, data]
    if (kind === 'transactions' && i < 0 && (data as Transaction).via === 'whatsapp') arrived.push(data as Transaction)
  }
  if (!Object.keys(next).length) return
  applying = true
  useData.setState(next as Partial<Records>)
  applying = false
  if (arrived.length) emit({ type: 'whatsapp', txs: arrived })
}

/** Escuta a tabela records desta conta: o que o assistente lança aparece na hora. */
function listen(uid: string) {
  if (channel) void supabase.removeChannel(channel)
  channel = supabase
    .channel(`records:${uid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: `user_id=eq.${uid}` }, (p) => {
      // exclusões chegam só com a chave (e o filtro não vale para elas): confere o dono
      const row = (p.eventType === 'DELETE' ? p.old : p.new) as { user_id?: string; kind?: string; id?: string; data?: Item }
      if (row.user_id !== userId || !row.kind || !row.id || !(collections as readonly string[]).includes(row.kind)) return
      incoming.push({ kind: row.kind as Collection, id: row.id, data: p.eventType === 'DELETE' || !row.data ? null : { ...row.data, id: row.id } })
      clearTimeout(incomingTimer)
      incomingTimer = window.setTimeout(applyIncoming, 150)
    })
    .subscribe()
}

// ─── Entrada e saída ─────────────────────────────────────────

/** Sobe tudo o que está no aparelho (primeira vez desta conta na versão nova). */
function queueAll() {
  const s = useData.getState()
  for (const k of collections) for (const x of s[k] as Item[]) pending.set(`${k}:${x.id}`, { kind: k, id: x.id, data: x })
  pendingSettings = true
}

/**
 * Primeira conversa com a nuvem nesta sessão. Sem rede (ou com a tabela ainda não criada),
 * guarda as mudanças e tenta de novo mais tarde; até dar certo, nada sobe.
 */
async function bootstrap() {
  const uid = userId
  if (!uid || ready) return
  clearTimeout(retry)
  const data = await download()
  if (userId !== uid) return
  if (data.error) {
    failures++
    console.warn('[sync] não foi possível baixar os dados; seguindo com o que está no aparelho', data.error)
    retry = window.setTimeout(bootstrap, backoff())
    return
  }
  failures = 0
  if (data.count > 0) apply(data.records, data.settings)
  else {
    // conta nova (ou vinda da versão de empréstimos): fica com o que está aqui e sobe tudo
    const cloud = data.settings
    if (cloud && !pendingSettings) {
      applying = true
      useData.setState((s) => ({ settings: { ...withDefaults(cloud), pinHash: s.settings.pinHash } }))
      applying = false
    }
    if (!useData.getState().settings.legacy) {
      const debts = await downloadLegacy()
      applying = true
      useData.setState((s) => {
        const have = new Set(s.debts.map((d) => d.id))
        return { debts: [...s.debts, ...debts.filter((d) => !have.has(d.id))], settings: { ...s.settings, legacy: true } }
      })
      applying = false
    }
    queueAll()
  }
  ready = true
  useData.getState().ensureRecurring()
  savePending()
  await flush()
}

/**
 * Chamado ao entrar: baixa os dados da conta e passa a enviar as mudanças.
 * Primeira vez desta conta na nuvem: sobe o que já estava neste aparelho
 * (e converte os empréstimos da versão anterior, uma vez só).
 */
export async function startSync(uid: string) {
  if (userId !== uid) (pending.clear(), (pendingSettings = false))
  userId = uid
  ready = false
  failures = 0
  restorePending(uid)
  watch()
  listen(uid)
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onHide)
  await bootstrap()
  if (!ready) useData.getState().ensureRecurring()
}

/**
 * Outro aparelho mudou algo (chegou uma notificação dele): baixa de novo.
 * Só aplica se nada mudou aqui enquanto baixava, para não apagar o que ainda não subiu.
 */
export async function pullSync() {
  if (!userId || !ready || flushing || hasPending()) return
  const before = useData.getState()
  const data = await download()
  const now = useData.getState()
  if (data.error || data.count === 0 || flushing || hasPending()) return
  if (collections.some((k) => now[k] !== before[k]) || now.settings !== before.settings) return
  apply(data.records, data.settings)
}

/** Espera as mudanças deste aparelho chegarem à nuvem (até `ms`). */
export async function whenSynced(ms = 15_000) {
  const end = Date.now() + ms
  while ((hasPending() || flushing) && Date.now() < end) await new Promise((r) => setTimeout(r, 300))
  return !hasPending() && !flushing
}

/** Mudanças deste aparelho que ainda não chegaram à nuvem (para avisar antes de sair da conta). */
export const unsyncedCount = () => pending.size + (pendingSettings ? 1 : 0)

/** Ao sair: envia o que faltou e limpa os dados deste aparelho. */
export async function stopSync() {
  clearTimeout(timer)
  clearTimeout(retry)
  await flush().catch(() => {})
  unsubscribe?.()
  unsubscribe = null
  if (channel) void supabase.removeChannel(channel)
  channel = null
  clearTimeout(incomingTimer)
  incoming = []
  window.removeEventListener('online', onOnline)
  document.removeEventListener('visibilitychange', onHide)
  userId = null
  ready = false
  pending.clear()
  pendingSettings = false
  savePending()
  const { settings } = useData.getState()
  applying = true
  useData.setState({ ...emptyRecords(), settings: { ...defaultSettings, theme: settings.theme } })
  applying = false
}
