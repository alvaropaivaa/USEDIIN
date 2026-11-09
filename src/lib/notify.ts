import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from './supabase'
import { emptyFilter, useData, useUI, type Tab, type TxStatusFilter } from './store'
import { summarize } from './loans'
import { byCategory, cardIndex, limitOf, cashDate, goalStats, invoice, invoiceFor, monthRange, monthTotals, overallBudget, rootOf, type Transaction } from './ledger'
import { addDays, diffDays, monthKey, parseISO, shiftMonth, today } from './dates'
import { moneyRaw } from './format'
import { onAppEvent, type AppEvent } from './events'
import { isIOS, isStandalone, swReady } from './pwa'
import { pullSync, whenSynced } from './sync'
import { agenda, type AgendaItem } from '../components/finance'
import type { AlertType } from './alerts'

// Notificações do Dinn:
// - central de avisos no app (o sino da tela inicial), guardada neste aparelho;
// - notificação do sistema: push do servidor (chega com o app fechado) ou, sem push, gerada aqui ao abrir o app;
// - o que acontece aqui (lançamento, conta paga…) entra na central e vai por push para os outros aparelhos da conta.

export type NoticeType = AlertType | 'teste' | 'aviso'

export interface Notice {
  /** Identifica o aviso: o mesmo aviso vindo do servidor e daqui entra uma vez só. */
  key: string
  type: NoticeType
  title: string
  body: string
  /** Para onde o toque leva (ex.: '/?n=due:atrasado'). */
  url: string
  /** Data e hora (ISO). */
  at: string
  tag?: string
  read?: boolean
}

interface Device {
  items: Notice[]
  /** Chaves já recebidas: limpar a central não faz o aviso voltar. */
  seen: string[]
  /** Notificações ligadas neste aparelho. */
  enabled: boolean
  /** Inscrito no servidor: os avisos chegam com o app fechado. */
  push: boolean
  endpoint: string
  /** Outros aparelhos da conta que recebem push. */
  others: number
}

interface DeviceActions {
  /** Retorna false se o aviso já tinha chegado. */
  add: (n: Notice) => boolean
  markRead: (key: string) => void
  readAll: () => void
  clear: () => void
}

const MAX_ITEMS = 120
const MAX_SEEN = 400

export const useNotices = create<Device & DeviceActions>()(
  persist(
    (set, get) => ({
      items: [],
      seen: [],
      enabled: false,
      push: false,
      endpoint: '',
      others: 0,
      add: (n) => {
        const { items, seen } = get()
        if (seen.includes(n.key)) return false
        set({
          items: [n, ...items].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_ITEMS),
          seen: [n.key, ...seen].slice(0, MAX_SEEN),
        })
        return true
      },
      markRead: (key) => set((s) => ({ items: s.items.map((i) => (i.key === key && !i.read ? { ...i, read: true } : i)) })),
      readAll: () => set((s) => ({ items: s.items.map((i) => (i.read ? i : { ...i, read: true })) })),
      clear: () => set({ items: [] }),
    }),
    { name: 'jurospro-avisos', version: 1 },
  ),
)

// ─── Textos ──────────────────────────────────────────────────

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
const monthName = (key: string) => new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(parseISO(`${key}-01`))
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/** "Aluguel e Luz" ou "Aluguel, Luz e mais 3". */
const names = (list: string[]) => {
  const u = [...new Set(list)]
  if (u.length <= 2) return u.join(' e ')
  return `${u[0]}, ${u[1]} e mais ${u.length - 2}`
}

/** Modo discreto: troca os valores por R$ ••••. */
export const maskMoney = (text: string) => text.replace(/R\$\s?[\d.,]+/g, 'R$ ••••')

// ─── Resumo do dia (o mesmo que o servidor manda por push) ───

/** Vencimento do acesso, informado ao entrar. */
let account = { expiresAt: '' }
export const setAccount = (a: { expiresAt: string }) => {
  account = a
}

/** Contas pendentes, parcelas de dívidas e faturas (o que a agenda do Início mostra). */
function dueItems(ref: string, days = 7) {
  const { transactions, cards, categories, debts } = useData.getState()
  const cats = new Map(categories.map((c) => [c.id, c]))
  return agenda({ ref, transactions, cards, cats }, debts.map((debt) => ({ debt, summary: summarize(debt, ref) })), days)
}

function digest(ref: string): Notice[] {
  const { settings, cards, transactions } = useData.getState()
  const tomorrow = addDays(ref, 1)
  const items = dueItems(ref, 1)
  const bills = items.filter((d) => !('invoice' in d.source))
  const line = (list: AgendaItem[], extra?: (d: AgendaItem) => string) => {
    if (list.length === 1) {
      const d = list[0]
      return [d.title, d.detail, moneyRaw(d.amount), extra?.(d)].filter(Boolean).join(' · ')
    }
    return [`${list.length} contas`, moneyRaw(list.reduce((s, d) => s + d.amount, 0)), names(list.map((d) => d.title))].join(' · ')
  }

  const at = new Date().toISOString()
  const out: Notice[] = []
  const late = bills.filter((d) => d.status === 'atrasada' && !d.income)
  if (late.length) {
    const days = (d: AgendaItem) => {
      const n = diffDays(ref, d.date)
      return `${n} ${plural(n, 'dia', 'dias')} de atraso`
    }
    out.push({ type: 'atrasos', key: `atrasos:${ref}`, tag: 'atrasos', title: 'Contas atrasadas', body: line(late, days), url: '/?n=due:atrasado', at })
  }
  const todays = bills.filter((d) => d.status === 'hoje')
  if (todays.length) out.push({ type: 'hoje', key: `hoje:${ref}`, tag: 'hoje', title: 'Vence hoje', body: line(todays), url: '/?n=due:pendente', at })
  const next = bills.filter((d) => d.date === tomorrow)
  if (next.length) out.push({ type: 'amanha', key: `amanha:${ref}`, tag: 'amanha', title: 'Vence amanhã', body: line(next), url: '/?n=due:pendente', at })

  // faturas: fechou hoje, vence amanhã ou hoje
  for (const card of cards) {
    if (card.archived) continue
    const closingNow = invoice(card, invoiceFor(card, addDays(ref, -1)), transactions, ref)
    if (closingNow.closing === ref && closingNow.total > 0)
      out.push({ type: 'faturas', key: `fatura-fechou:${card.id}:${closingNow.key}`, tag: `fatura:${card.id}`, title: `Fatura ${card.name} fechou`, body: `${moneyRaw(closingNow.total)} · vence ${ddmm(closingNow.due)}`, url: `/?n=card:${card.id}:${closingNow.key}`, at })
    for (const inv of items.filter((d) => 'invoice' in d.source && d.source.invoice.card.id === card.id).map((d) => (d.source as { invoice: ReturnType<typeof invoice> }).invoice)) {
      if (inv.due !== ref && inv.due !== tomorrow) continue
      out.push({
        type: 'faturas',
        key: `fatura-vence:${card.id}:${inv.key}:${ref}`,
        tag: `fatura:${card.id}`,
        title: inv.due === ref ? `Fatura ${card.name} vence hoje` : `Fatura ${card.name} vence amanhã`,
        body: `${moneyRaw(inv.open)} em aberto`,
        url: `/?n=card:${card.id}:${inv.key}`,
        at,
      })
    }
  }

  // resumos: segunda-feira (semana) e dia 1º (mês)
  const cardsIdx = cardIndex(cards)
  const flows = (from: string, to: string) => {
    const r = { income: 0, expense: 0 }
    for (const t of transactions) {
      if (t.type === 'transferencia') continue
      const d = cashDate(t, cardsIdx)
      if (d >= from && d <= to) r[t.type === 'receita' ? 'income' : 'expense'] += t.amount
    }
    return r
  }
  if (parseISO(ref).getDay() === 1) {
    const last = flows(addDays(ref, -7), addDays(ref, -1))
    const week = dueItems(ref, 6).filter((d) => !d.income && d.status !== 'atrasada')
    if (last.income || last.expense || week.length)
      out.push({
        type: 'resumo',
        key: `resumo-semana:${ref}`,
        tag: 'resumo',
        title: 'Resumo da semana',
        body: `Semana passada: ${moneyRaw(last.income)} de receitas e ${moneyRaw(last.expense)} de despesas. Esta semana: ${week.length} ${plural(week.length, 'conta', 'contas')} · ${moneyRaw(week.reduce((s, d) => s + d.amount, 0))} a pagar.`,
        url: '/?n=tab:reports',
        at,
      })
  }
  if (ref.endsWith('-01')) {
    const prev = shiftMonth(monthKey(ref), -1)
    const t = monthTotals(transactions, cardsIdx, prev)
    if (t.income || t.expense)
      out.push({
        type: 'resumo',
        key: `resumo-mes:${ref}`,
        tag: 'resumo',
        title: `Fechamento de ${monthName(prev)}`,
        body: `Receitas ${moneyRaw(t.income)} · despesas ${moneyRaw(t.expense)} · ${t.balance >= 0 ? `sobrou ${moneyRaw(t.balance)}` : `faltou ${moneyRaw(-t.balance)}`}.`,
        url: '/?n=tab:reports',
        at,
      })
  }

  if (account.expiresAt) {
    const days = diffDays(account.expiresAt, ref)
    if (days === 3 || days === 1 || days === 0)
      out.push({
        type: 'plano',
        key: `plano:${account.expiresAt}:${days}`,
        tag: 'plano',
        title: days === 3 ? 'Seu acesso vence em 3 dias' : days === 1 ? 'Seu acesso vence amanhã' : 'Seu acesso vence hoje',
        body: 'Fale com o administrador para renovar e continuar usando o Dinn.',
        url: '/',
        at,
      })
  }
  return out.filter((n) => settings.alerts[n.type as AlertType] !== false)
}

// ─── Acontecimentos deste aparelho ───────────────────────────

/** Passou do aviso (80%) ou do limite da categoria (ou do limite geral) com esta despesa. */
function budgetNotices(tx: Transaction, at: string): Notice[] {
  const { categories, transactions, cards, settings } = useData.getState()
  if (tx.type !== 'despesa') return []
  const cardsIdx = cardIndex(cards)
  const m = monthKey(cashDate(tx, cardsIdx))
  const { from, to } = monthRange(m)
  const out: Notice[] = []
  const level = (ratio: number) => (ratio > 1 ? 100 : ratio >= settings.budgetAlert ? Math.round(settings.budgetAlert * 100) : 0)
  const notice = (key: string, name: string, spent: number, limit: number) => {
    const ratio = spent / limit
    const lv = level(ratio)
    if (!lv) return
    out.push({
      type: 'orcamento',
      key: `orcamento:${m}:${key}:${lv}`,
      tag: `orcamento:${key}`,
      title: lv === 100 ? `${name} passou do limite` : `${name} chegou a ${Math.round(ratio * 100)}% do limite`,
      body: lv === 100 ? `${moneyRaw(spent)} de ${moneyRaw(limit)} em ${monthName(m)} · ${moneyRaw(spent - limit)} acima.` : `${moneyRaw(spent)} de ${moneyRaw(limit)} · você ainda pode gastar ${moneyRaw(limit - spent)}.`,
      url: '/?n=tab:budget',
      at,
    })
  }
  const cats = new Map(categories.map((c) => [c.id, c]))
  const root = rootOf(tx.categoryId, cats)
  const by = byCategory(transactions, cardsIdx, categories, 'despesa', from, to)
  const rootLimit = root ? limitOf(root, categories) : 0
  if (root && rootLimit) notice(root.id, root.name, by.get(root.id) ?? 0, rootLimit)
  // a subcategoria com limite próprio também avisa
  const sub = tx.categoryId ? cats.get(tx.categoryId) : undefined
  if (sub?.parentId && sub.budget) notice(sub.id, sub.name, by.get(sub.id) ?? 0, sub.budget)
  const overall = overallBudget(categories, settings.budgetTotal, transactions, cardsIdx, m)
  if (overall.limit > 0) notice('geral', 'O limite geral do mês', overall.spent, overall.limit)
  return out
}

function eventNotices(e: AppEvent): Notice[] {
  const at = new Date().toISOString()
  switch (e.type) {
    case 'lancamento': {
      const t = e.tx
      const title = t.type === 'receita' ? 'Nova receita' : t.type === 'despesa' ? 'Nova despesa' : 'Transferência'
      const extra = e.count > 1 ? (t.installment ? ` · ${e.count}x` : ' · lançamento fixo') : ''
      return [
        { type: 'lancamentos', key: `lancamento:${t.id}`, title, body: `${t.description} · ${moneyRaw(t.amount)}${extra}`, url: `/?n=tx:${t.id}`, at },
        ...budgetNotices(t, at),
      ]
    }
    case 'pago': {
      const t = e.tx
      const title = t.type === 'transferencia' && t.cardId ? 'Fatura paga' : t.type === 'receita' ? 'Receita recebida' : 'Conta paga'
      return [{ type: 'lancamentos', key: `pago:${t.id}`, title, body: `${t.description} · ${moneyRaw(t.amount)}`, url: `/?n=tx:${t.id}`, at }]
    }
    case 'whatsapp':
      // parcelas da mesma compra viram um aviso só (o da primeira)
      return e.txs.flatMap((t) =>
        t.installment && t.installment.n > 1
          ? []
          : [
              {
                type: 'lancamentos' as const,
                key: `lancamento:${t.id}`,
                title: 'Lançado pelo WhatsApp',
                body: `${t.description} · ${moneyRaw(t.amount)}${t.installment ? ` · ${t.installment.count}x` : ''}`,
                url: `/?n=tx:${t.id}`,
                at,
              },
              ...budgetNotices(t, at),
            ],
      )
    case 'divida':
      return [
        {
          type: 'dividas',
          key: `divida:${e.debt.id}`,
          title: e.debt.direction === 'pagar' ? 'Nova dívida registrada' : 'Novo empréstimo a receber',
          body: `${e.debt.person} · ${moneyRaw(e.debt.principal)} em ${e.debt.schedule.length}x de ${moneyRaw(e.debt.schedule[0]?.amount ?? 0)}`,
          url: `/?n=debt:${e.debt.id}`,
          at,
        },
      ]
    case 'divida-pagamento': {
      const { debt, before, payment } = e
      const s = summarize(debt)
      const url = `/?n=debt:${debt.id}`
      const pagar = debt.direction === 'pagar'
      const out: Notice[] = [
        {
          type: 'dividas',
          key: `divida-pagamento:${payment.id}`,
          title: pagar ? 'Parcela paga' : 'Parcela recebida',
          body: `${debt.person} · ${moneyRaw(payment.amount + (payment.fee ?? 0))} · ${s.paidCount} de ${s.count} ${plural(s.count, 'parcela', 'parcelas')}`,
          url,
          at,
        },
      ]
      if (s.status === 'quitado' && summarize(before).status !== 'quitado')
        out.push({ type: 'dividas', key: `quitado:${payment.id}`, title: pagar ? 'Dívida quitada' : 'Empréstimo recebido por inteiro', body: `${debt.person} · ${moneyRaw(s.total)} no total.`, url, at })
      return out
    }
    case 'divida-estorno':
      return [{ type: 'dividas', key: `divida-estorno:${e.payment.id}`, title: 'Pagamento desfeito', body: `${e.debt.person} · ${moneyRaw(e.payment.amount + (e.payment.fee ?? 0))}`, url: `/?n=debt:${e.debt.id}`, at }]
    case 'meta-aporte': {
      if (!goalStats(e.goal).done || goalStats(e.before).done) return []
      return [{ type: 'metas', key: `meta:${e.goal.id}`, title: 'Meta concluída', body: `${e.goal.name}: você juntou ${moneyRaw(goalStats(e.goal).saved)}.`, url: `/?n=goal:${e.goal.id}`, at }]
    }
  }
}

// avisos importantes também aparecem como notificação aqui; o resto você acabou de fazer
const CELEBRATE: NoticeType[] = ['orcamento', 'metas']

async function onEvent(e: AppEvent) {
  const { alerts } = useData.getState().settings
  for (const n of eventNotices(e)) {
    if (alerts[n.type as AlertType] === false) continue
    // foi feito aqui: entra na central já lido (menos os alertas, que pedem atenção)
    if (!useNotices.getState().add({ ...n, read: !CELEBRATE.includes(n.type) })) continue
    if (CELEBRATE.includes(n.type) && useNotices.getState().enabled) showSystem(n)
    broadcast(n)
  }
}

/** Avisa os outros aparelhos da conta (depois que a mudança chegou à nuvem, para eles já verem os dados novos). */
async function broadcast(n: Notice) {
  if (!useNotices.getState().others) return
  await whenSynced()
  const { endpoint } = useNotices.getState()
  const body = useData.getState().settings.privacy ? maskMoney(n.body) : n.body
  const notification = { type: n.type, title: n.title, body, url: n.url, tag: n.tag ?? n.key, key: n.key }
  supabase.functions.invoke('push', { body: { action: 'event', except: endpoint, notification } }).catch(() => {})
}

// ─── Notificação do sistema ──────────────────────────────────

async function showSystem(n: Notice) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const options: NotificationOptions = {
    body: useData.getState().settings.privacy ? maskMoney(n.body) : n.body,
    tag: n.tag ?? n.key,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    lang: 'pt-BR',
    data: { url: n.url, key: n.key },
  }
  try {
    // no Android só o service worker pode mostrar notificação
    const reg = await swReady(1500)
    if (reg) await reg.showNotification(n.title, options)
    else new Notification(n.title, options)
  } catch (e) {
    console.warn('[notificação]', e)
  }
}

/** Número no ícone do app: contas a pagar atrasadas + que vencem hoje. */
function updateBadge() {
  if (!('setAppBadge' in navigator)) return
  const count = useNotices.getState().enabled ? dueItems(today(), 0).filter((d) => !d.income && d.status !== 'proxima').length : 0
  ;(count ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => {})
}

/** Resumo do dia na central (e no sistema, quando não há push), a partir da hora escolhida. */
function checkDaily() {
  updateBadge()
  const { alertHour } = useData.getState().settings
  if (new Date().getHours() < alertHour) return
  // de trás para frente: na central (mais novo em cima) os atrasos ficam no topo
  for (const n of digest(today()).reverse()) {
    const st = useNotices.getState()
    // com push, o servidor já manda no horário
    if (st.add(n) && st.enabled && !st.push) showSystem(n)
  }
}

// ─── Push (servidor) ─────────────────────────────────────────

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? 'BIDRl2I1hhVqX8GHhVPkZXctRKiOOgDlvAVUzH_wV6cq_ICnDxMzvbD-EbgFDgcUuXNrE2AJP8-M-0QJc3wEwGc'

const fromB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0))
const sameKey = (a: ArrayBuffer | null, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i])

const deviceName = () => {
  const ua = navigator.userAgent
  const os = /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad' : /android/i.test(ua) ? 'Android' : /windows/i.test(ua) ? 'Windows' : /mac/i.test(ua) ? 'Mac' : 'Computador'
  const browser = /edg\//i.test(ua) ? 'Edge' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : ''
  return isStandalone() ? `${os} · app` : [os, browser].filter(Boolean).join(' · ')
}

/** Inscreve este aparelho no servidor. Retorna o motivo quando não deu (os avisos seguem com o app aberto). */
async function subscribe(): Promise<string | null> {
  const reg = await swReady()
  if (!reg || !('pushManager' in reg)) return 'Este navegador só mostra avisos com o app aberto.'
  const { data } = await supabase.auth.getSession()
  if (!data.session) return 'Entre com e-mail e senha para receber avisos com o app fechado.'
  try {
    const key = fromB64(VAPID)
    let sub = await reg.pushManager.getSubscription()
    // inscrição antiga com outra chave do servidor: refaz
    if (sub && !sameKey(sub.options.applicationServerKey, key)) {
      await sub.unsubscribe()
      sub = null
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    const { keys } = sub.toJSON()
    const { error } = await supabase.rpc('push_register', {
      p_endpoint: sub.endpoint,
      p_p256dh: keys?.p256dh,
      p_auth: keys?.auth,
      p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
      p_device: deviceName(),
    })
    if (error) throw error
    useNotices.setState({ push: true, endpoint: sub.endpoint })
    return null
  } catch (e) {
    console.warn('[push] inscrição falhou', e)
    useNotices.setState({ push: false })
    return 'Os avisos com o app fechado ainda não estão disponíveis. Por enquanto eles aparecem ao abrir o app.'
  }
}

async function unsubscribe() {
  const reg = await swReady(1500)
  const sub = await reg?.pushManager?.getSubscription().catch(() => null)
  const endpoint = sub?.endpoint || useNotices.getState().endpoint
  if (endpoint) await supabase.rpc('push_unregister', { p_endpoint: endpoint }).then(() => {}, () => {})
  await sub?.unsubscribe().catch(() => {})
  useNotices.setState({ push: false, endpoint: '' })
}

/** Quantos outros aparelhos da conta recebem push (para saber se vale avisar). */
async function refreshDevices() {
  const { data: s } = await supabase.auth.getSession()
  if (!s.session) return
  const { data, error } = await supabase.from('push_subscriptions').select('endpoint')
  if (!error && data) useNotices.setState({ others: data.filter((r) => r.endpoint !== useNotices.getState().endpoint).length })
}

// ─── O que a tela usa ────────────────────────────────────────

export type DeviceStatus = 'install' | 'unsupported' | 'denied' | 'off' | 'local' | 'push'

/** Situação das notificações neste aparelho. */
export function deviceStatus(st: Pick<Device, 'enabled' | 'push'>): DeviceStatus {
  if (isIOS && !isStandalone()) return 'install'
  if (!('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  if (!st.enabled || Notification.permission !== 'granted') return 'off'
  return st.push ? 'push' : 'local'
}

export async function enableNotifications(): Promise<{ ok: boolean; message: string }> {
  if (isIOS && !isStandalone()) return { ok: false, message: 'No iPhone, instale o app na Tela de Início para receber notificações.' }
  if (!('Notification' in window)) return { ok: false, message: 'Este navegador não mostra notificações.' }
  const perm = await Notification.requestPermission()
  if (perm !== 'granted')
    return { ok: false, message: perm === 'denied' ? 'As notificações estão bloqueadas. Libere nas configurações do navegador.' : 'Permissão não concedida.' }
  useNotices.setState({ enabled: true })
  const warning = await subscribe()
  updateBadge()
  refreshDevices()
  return { ok: true, message: warning ?? 'Notificações ativadas' }
}

export async function disableNotifications() {
  useNotices.setState({ enabled: false })
  await unsubscribe()
  navigator.clearAppBadge?.().catch(() => {})
}

/** Manda uma notificação de exemplo (pelo servidor, quando há push). */
export async function sendTest() {
  const { push, endpoint } = useNotices.getState()
  if (push) {
    const { error } = await supabase.functions.invoke('push', { body: { action: 'test', endpoint } })
    if (!error) return 'Enviada pelo servidor'
  }
  await showSystem({ type: 'teste', key: `teste:${Date.now()}`, title: 'Notificações ativadas', body: 'É assim que os lembretes de contas e limites do Dinn vão chegar.', url: '/', at: new Date().toISOString() })
  return 'Enviada'
}

/** Ao sair da conta: este aparelho para de receber e a central é apagada. */
export async function resetNotifications() {
  await unsubscribe().catch(() => {})
  useNotices.setState({ items: [], seen: [], enabled: false, push: false, endpoint: '', others: 0 })
  navigator.clearAppBadge?.().catch(() => {})
}

/** Abre o destino de um aviso: '/?n=due:atrasado', '/?n=tx:<id>', '/?n=card:<id>:<fatura>', '/?n=tab:reports'… */
export function openLink(url: string) {
  let n: string | null = null
  try {
    n = new URL(url, location.origin).searchParams.get('n')
  } catch {}
  if (!n) return
  const i = n.indexOf(':')
  const kind = i < 0 ? n : n.slice(0, i)
  const arg = i < 0 ? '' : n.slice(i + 1)
  const ui = useUI.getState()
  const { transactions, debts, cards, goals } = useData.getState()
  const busy = ui.busy()
  ui.closeAll()
  const tabs: Tab[] = ['home', 'assistant', 'transactions', 'accounts', 'budget', 'goals', 'debts', 'reports']
  const go = () => {
    switch (kind) {
      case 'due': {
        // links antigos (versão de empréstimos): hoje/atrasadas/abertas
        const status = ({ hoje: 'pendente', atrasadas: 'atrasado', abertas: 'pendente' } as Record<string, TxStatusFilter>)[arg] ?? (arg as TxStatusFilter)
        ui.setTxFilter({ ...emptyFilter, status: ['todos', 'pago', 'pendente', 'atrasado'].includes(status) ? status : 'pendente' })
        return ui.setTab('transactions')
      }
      case 'tab':
        if (tabs.includes(arg as Tab)) ui.setTab(arg as Tab)
        return
      case 'tx':
        return transactions.some((t) => t.id === arg) ? ui.openTx(true, { id: arg }) : ui.setTab('transactions')
      case 'debt':
        return debts.some((d) => d.id === arg) ? ui.openDebt(arg) : ui.setTab('debts')
      case 'card': {
        const [id, invoice] = arg.split(':')
        return cards.some((c) => c.id === id) ? ui.openCard(true, id, invoice || undefined) : ui.setTab('accounts')
      }
      case 'goal':
        return goals.some((g) => g.id === arg) ? ui.openGoal(true, arg) : ui.setTab('goals')
      case 'new':
        return ui.openTx(true, { type: arg === 'receita' ? 'receita' : arg === 'transferencia' ? 'transferencia' : 'despesa' })
      case 'inbox':
        return ui.openInbox(true)
      // avisos antigos (contratos e clientes) levam às dívidas
      case 'contract':
        return debts.some((d) => d.id === arg) ? ui.openDebt(arg) : ui.setTab('debts')
      case 'client':
        return ui.setTab('debts')
    }
  }
  // espera o painel aberto terminar de fechar
  if (busy) setTimeout(go, 350)
  else go()
}

// ─── Caixa do service worker (push que chegou com o app fechado) ───

function drainSW(): Promise<Notice[]> {
  return new Promise((resolve) => {
    if (!('indexedDB' in window)) return resolve([])
    const open = indexedDB.open('jurospro-sw', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('inbox', { keyPath: 'key' })
    open.onerror = () => resolve([])
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('inbox', 'readwrite')
      const store = tx.objectStore('inbox')
      const all = store.getAll()
      all.onsuccess = () => store.clear()
      tx.oncomplete = () => (db.close(), resolve((all.result ?? []) as Notice[]))
      tx.onerror = () => (db.close(), resolve([]))
    }
  })
}

// avisos de outro aparelho que mudam os dados: baixa de novo para a tela ficar igual
const CHANGES_DATA: NoticeType[] = ['lancamentos', 'dividas', 'metas', 'orcamento']

function receive(list: Notice[]) {
  let changed = false
  for (const n of list) if (useNotices.getState().add({ ...n, read: false }) && CHANGES_DATA.includes(n.type)) changed = true
  if (changed) pullSync().then(updateBadge)
}

/** Liga tudo enquanto o app está aberto e logado. */
export function useNotifications() {
  useEffect(() => {
    const off = onAppEvent(onEvent)

    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'push') drainSW().then(receive)
      if (e.data?.type === 'open') openLink(e.data.url)
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)

    const wake = async () => {
      if (document.hidden) return
      receive(await drainSW())
      checkDaily()
      refreshDevices()
    }

    ;(async () => {
      receive(await drainSW())
      // aberto por uma notificação ou atalho do ícone
      const params = new URLSearchParams(location.search)
      if (params.has('n')) {
        openLink(location.href)
        params.delete('n')
        params.delete('source')
        history.replaceState(null, '', location.pathname + (params.size ? `?${params}` : ''))
      }
      // confirma a inscrição a cada abertura (fuso, troca de conta, inscrição renovada pelo navegador)
      const st = useNotices.getState()
      if (st.enabled && 'Notification' in window && Notification.permission !== 'granted') useNotices.setState({ enabled: false, push: false })
      else if (st.enabled) await subscribe()
      checkDaily()
      refreshDevices()
    })()

    document.addEventListener('visibilitychange', wake)
    const timer = setInterval(checkDaily, 5 * 60_000)
    // o número no ícone acompanha os pagamentos
    let badgeTimer = 0
    const unsub = useData.subscribe((s, p) => {
      if (s.transactions === p.transactions && s.debts === p.debts && s.cards === p.cards) return
      clearTimeout(badgeTimer)
      badgeTimer = window.setTimeout(updateBadge, 800)
    })
    return () => {
      off()
      unsub()
      clearInterval(timer)
      clearTimeout(badgeTimer)
      document.removeEventListener('visibilitychange', wake)
      navigator.serviceWorker?.removeEventListener('message', onMessage)
    }
  }, [])
}
