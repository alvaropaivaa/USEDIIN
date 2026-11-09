// Espelho das regras de src/lib/ledger.ts e do addTransaction de src/lib/store.ts para o servidor:
// a Edge Function (Deno) não importa o código do app (imports sem extensão), então as contas que o
// assistente precisa ficam aqui, sem imports. Os testes (whatsapp.test.ts) comparam com o app.
//
// Datas são strings 'AAAA-MM-DD' e as contas usam o calendário puro (UTC), sem fuso.

export type TxType = 'receita' | 'despesa' | 'transferencia'
export type TxStatus = 'pago' | 'pendente'
export type CatType = 'receita' | 'despesa'

export interface Account {
  id: string
  name: string
  kind: string
  bank?: string
  initial: number
  hidden?: boolean
  archived?: boolean
}

export interface Card {
  id: string
  name: string
  brand?: string
  last4?: string
  limit: number
  closingDay: number
  dueDay: number
  accountId?: string
  archived?: boolean
}

export interface Category {
  id: string
  name: string
  type: CatType
  parentId?: string
  budget?: number
  keywords?: string[]
  archived?: boolean
}

export interface Transaction {
  id: string
  type: TxType
  description: string
  amount: number
  date: string
  status: TxStatus
  categoryId?: string
  accountId?: string
  toAccountId?: string
  cardId?: string
  invoice?: string
  note?: string
  groupId?: string
  installment?: { n: number; count: number }
  debtId?: string
  adjust?: boolean
  /** Lançado pelo assistente do WhatsApp (o app mostra "Lançado pelo WhatsApp"). */
  via?: 'whatsapp'
  createdAt: string
}

export interface Goal {
  id: string
  name?: string
  contributions?: { amount: number; accountId?: string }[]
  archived?: boolean
}

export const round2 = (v: number) => Math.round(v * 100) / 100
const EPS = 0.005

// ─── Datas ───────────────────────────────────────────────────

const DAY = 86400000
const pad = (n: number) => String(n).padStart(2, '0')

const dayNum = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY)
}
const fromDayNum = (n: number) => new Date(n * DAY).toISOString().slice(0, 10)

export const addDays = (iso: string, days: number) => fromDayNum(dayNum(iso) + days)
export const diffDays = (a: string, b: string) => dayNum(a) - dayNum(b)
export const monthKey = (iso: string) => iso.slice(0, 7)
/** 0 = domingo, 1 = segunda… */
export const weekday = (iso: string) => new Date(dayNum(iso) * DAY).getUTCDay()

/** Último dia do mês (m0 = 0 a 11). */
const lastDay = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()

/** Soma meses mantendo o dia (31/01 + 1 mês = 28/02), como addMonths do app. */
export const addMonths = (iso: string, months: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  const ty = Math.floor(total / 12)
  const tm = total - ty * 12
  return `${ty}-${pad(tm + 1)}-${pad(Math.min(d, lastDay(ty, tm)))}`
}

export const shiftMonth = (key: string, delta: number) => monthKey(addMonths(`${key}-01`, delta))

export const monthRange = (key: string) => ({ from: `${key}-01`, to: addDays(`${shiftMonth(key, 1)}-01`, -1) })

export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromDayNum(dayNum(s)) === s

// ─── Cartão de crédito ───────────────────────────────────────

const clampDay = (key: string, day: number) => {
  const [y, m] = key.split('-').map(Number)
  return `${key}-${pad(Math.min(day, lastDay(y, m - 1)))}`
}

/** Fatura (AAAA-MM do vencimento) em que entra uma compra feita no dia `date`. */
export function invoiceFor(card: Pick<Card, 'closingDay' | 'dueDay'>, date: string) {
  const [y, m, d] = date.split('-').map(Number)
  const closing = d >= Math.min(card.closingDay, lastDay(y, m - 1)) ? shiftMonth(monthKey(date), 1) : monthKey(date)
  return card.dueDay > card.closingDay ? closing : shiftMonth(closing, 1)
}

/** Dias de fechamento e vencimento de uma fatura. */
export function invoiceDates(card: Pick<Card, 'closingDay' | 'dueDay'>, key: string) {
  return { closing: clampDay(card.dueDay > card.closingDay ? key : shiftMonth(key, -1), card.closingDay), due: clampDay(key, card.dueDay) }
}

export type InvoiceStatus = 'aberta' | 'fechada' | 'parcial' | 'paga' | 'vencida' | 'vazia'

export function invoice(card: Card, key: string, txs: Transaction[], ref: string) {
  const { closing, due } = invoiceDates(card, key)
  let total = 0
  let paid = 0
  for (const t of txs) {
    if (t.cardId !== card.id || t.invoice !== key) continue
    if (t.type === 'despesa') total += t.amount
    else if (t.type === 'transferencia' && t.status === 'pago') paid += t.amount
  }
  total = round2(total)
  paid = round2(paid)
  const open = round2(Math.max(0, total - paid))
  const status: InvoiceStatus = total < EPS ? 'vazia' : open < EPS ? 'paga' : ref < closing ? 'aberta' : ref > due ? 'vencida' : paid > EPS ? 'parcial' : 'fechada'
  return { key, closing, due, total, paid, open, status }
}

/** Limite usado: compras ainda não pagas (de todas as faturas). */
export function cardUsage(card: Card, txs: Transaction[]) {
  let spent = 0
  let paid = 0
  for (const t of txs) {
    if (t.cardId !== card.id) continue
    if (t.type === 'despesa') spent += t.amount
    else if (t.type === 'transferencia' && t.status === 'pago') paid += t.amount
  }
  const used = round2(Math.max(0, spent - paid))
  return { used, available: round2(card.limit - used) }
}

/** Compra no cartão conta no vencimento da fatura; o resto, na própria data. */
export function cashDate(t: Transaction, cards: Map<string, Card>) {
  if (t.type === 'despesa' && t.cardId && t.invoice) {
    const card = cards.get(t.cardId)
    if (card) return invoiceDates(card, t.invoice).due
  }
  return t.date
}

// ─── Saldos e totais ─────────────────────────────────────────

/** Saldo de cada conta: inicial + o que já foi pago/recebido + transferências − guardado em metas. */
export function balances(accounts: Account[], txs: Transaction[], goals: Goal[]) {
  const out = new Map(accounts.map((a) => [a.id, a.initial]))
  const add = (id: string | undefined, v: number) => {
    if (id && out.has(id)) out.set(id, out.get(id)! + v)
  }
  for (const t of txs) {
    if (t.status !== 'pago') continue
    if (t.type === 'receita') add(t.accountId, t.amount)
    else if (t.type === 'despesa' && !t.cardId) add(t.accountId, -t.amount)
    else if (t.type === 'transferencia') {
      add(t.accountId, -t.amount)
      add(t.toAccountId, t.amount)
    }
  }
  for (const g of goals) for (const c of g.contributions ?? []) add(c.accountId, -c.amount)
  for (const [id, v] of out) out.set(id, round2(v))
  return out
}

export interface Totals {
  income: number
  expense: number
  incomePaid: number
  expensePaid: number
  incomePending: number
  expensePending: number
  balance: number
}

function invoicePaidShare(txs: Transaction[]) {
  const sum = new Map<string, { total: number; paid: number }>()
  for (const t of txs) {
    if (!t.cardId || !t.invoice) continue
    const k = `${t.cardId}:${t.invoice}`
    const v = sum.get(k) ?? { total: 0, paid: 0 }
    if (t.type === 'despesa') v.total += t.amount
    else if (t.type === 'transferencia' && t.status === 'pago') v.paid += t.amount
    sum.set(k, v)
  }
  return new Map([...sum].map(([k, v]) => [k, v.total > 0 ? Math.min(1, v.paid / v.total) : 0]))
}

/** Receitas e despesas do período (compra no cartão conta no vencimento da fatura). */
export function totals(txs: Transaction[], cards: Map<string, Card>, from: string, to: string): Totals {
  const r = { income: 0, expense: 0, incomePaid: 0, expensePaid: 0, incomePending: 0, expensePending: 0 }
  const share = invoicePaidShare(txs)
  for (const t of txs) {
    if (t.type === 'transferencia') continue
    const d = cashDate(t, cards)
    if (d < from || d > to) continue
    const paid = t.type === 'despesa' && t.cardId ? (share.get(`${t.cardId}:${t.invoice}`) ?? 0) * t.amount : t.status === 'pago' ? t.amount : 0
    if (t.type === 'receita') {
      r.income += t.amount
      r.incomePaid += paid
      r.incomePending += t.amount - paid
    } else {
      r.expense += t.amount
      r.expensePaid += paid
      r.expensePending += t.amount - paid
    }
  }
  const o = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, round2(v)])) as Omit<Totals, 'balance'>
  return { ...o, balance: round2(o.income - o.expense) }
}

// ─── Categorias e orçamento ──────────────────────────────────

export const rootOf = (id: string | undefined, cats: Map<string, Category>) => {
  const c = id ? cats.get(id) : undefined
  return c?.parentId && cats.has(c.parentId) ? cats.get(c.parentId)! : c
}

/** Quanto foi gasto (ou recebido) em cada categoria no período, somando as subcategorias na principal. */
export function byCategory(txs: Transaction[], cards: Map<string, Card>, categories: Category[], type: CatType, from: string, to: string) {
  const cats = new Map(categories.map((c) => [c.id, c]))
  const out = new Map<string, number>()
  for (const t of txs) {
    if (t.type !== type) continue
    const d = cashDate(t, cards)
    if (d < from || d > to) continue
    const root = rootOf(t.categoryId, cats)
    const key = root?.id ?? ''
    out.set(key, round2((out.get(key) ?? 0) + t.amount))
    if (root && t.categoryId && t.categoryId !== root.id) out.set(t.categoryId, round2((out.get(t.categoryId) ?? 0) + t.amount))
  }
  return out
}

/** Limite da categoria: o dela ou, na principal sem limite próprio, a soma dos limites das subcategorias. */
export function limitOf(c: Category, categories: Category[]) {
  if ((c.budget ?? 0) > 0) return c.budget!
  if (c.parentId) return 0
  return round2(categories.filter((s) => s.parentId === c.id && !s.archived && (s.budget ?? 0) > 0).reduce((t, s) => t + s.budget!, 0))
}

/** Limite geral do mês e quanto já foi gasto nele (mesma regra do app). */
export function overallBudget(categories: Category[], total: number, txs: Transaction[], cards: Map<string, Card>, key: string) {
  const { from, to } = monthRange(key)
  if (total > 0) return { limit: total, spent: totals(txs, cards, from, to).expense }
  const budgeted = categories.filter((c) => c.type === 'despesa' && !c.parentId && !c.archived).map((c) => ({ c, limit: limitOf(c, categories) })).filter((x) => x.limit > 0)
  if (!budgeted.length) return { limit: 0, spent: 0 }
  const by = byCategory(txs, cards, categories, 'despesa', from, to)
  return { limit: round2(budgeted.reduce((s, x) => s + x.limit, 0)), spent: round2(budgeted.reduce((s, x) => s + (by.get(x.c.id) ?? 0), 0)) }
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

/** Categoria provável: o que a pessoa já usou com a mesma descrição, depois as palavras-chave. */
export function suggestCategory(description: string, type: CatType, categories: Category[], history: Transaction[]) {
  const d = norm(description)
  if (d.length < 3) return undefined
  const valid = new Set(categories.filter((c) => c.type === type && !c.archived).map((c) => c.id))
  const same = history.find((t) => t.type === type && t.categoryId && valid.has(t.categoryId) && norm(t.description) === d)
  if (same) return same.categoryId
  let best: { id: string; len: number } | undefined
  for (const c of categories) {
    if (!valid.has(c.id)) continue
    for (const k of c.keywords ?? []) {
      const w = norm(k)
      if (w.length >= 3 && d.includes(w) && (!best || w.length > best.len || (w.length === best.len && c.parentId))) best = { id: c.id, len: w.length }
    }
  }
  return best?.id
}

// ─── Lançamentos (como addTransaction do app) ────────────────

/** Divide um valor em parcelas iguais; a última absorve o arredondamento. */
export function splitInstallments(total: number, count: number) {
  const n = Math.max(1, Math.round(count))
  const each = Math.floor((total / n) * 100) / 100
  return Array.from({ length: n }, (_, k) => (k === n - 1 ? round2(total - each * (n - 1)) : each))
}

export interface TxInput {
  type: TxType
  description: string
  amount: number
  date: string
  status: TxStatus
  categoryId?: string
  accountId?: string
  toAccountId?: string
  cardId?: string
  note?: string
  /** Pagamento de fatura: qual fatura (AAAA-MM). */
  invoice?: string
}

/**
 * Cria os lançamentos como o app: compra no cartão já entra paga e na fatura do dia; parcelado
 * no cartão mantém a data e avança a fatura; parcelado fora do cartão avança o mês e as parcelas
 * futuras ficam pendentes.
 */
export function makeTransactions(input: TxInput, count: number, cards: Card[], ids: { uid: () => string; today: string }): Transaction[] {
  const card = input.cardId ? cards.find((c) => c.id === input.cardId) : undefined
  const purchase = !!card && input.type === 'despesa'
  const base: Transaction = {
    id: '',
    type: input.type,
    description: input.description,
    amount: round2(input.amount),
    date: input.date,
    status: purchase ? 'pago' : input.status,
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(input.toAccountId ? { toAccountId: input.toAccountId } : {}),
    ...(input.cardId ? { cardId: input.cardId } : {}),
    ...(input.note ? { note: input.note } : {}),
    via: 'whatsapp',
    createdAt: ids.today,
  }
  // pagamento de fatura: a fatura escolhida; compra: a do dia
  const firstInvoice = card ? (input.type === 'transferencia' ? (input.invoice ?? invoiceFor(card, input.date)) : invoiceFor(card, input.date)) : undefined
  if (count > 1 && input.type !== 'transferencia') {
    const groupId = ids.uid()
    return splitInstallments(base.amount, count).map((amount, k) => {
      const date = card ? input.date : addMonths(input.date, k)
      return {
        ...base,
        id: ids.uid(),
        amount,
        date,
        status: card || k === 0 || date <= ids.today ? base.status : 'pendente',
        ...(card ? { invoice: shiftMonth(firstInvoice!, k) } : {}),
        groupId,
        installment: { n: k + 1, count },
      }
    })
  }
  return [{ ...base, id: ids.uid(), ...(firstInvoice ? { invoice: firstInvoice } : {}) }]
}

/** Correção num lançamento (como updateTransaction "só neste" do app). */
export function applyPatch(t: Transaction, patch: Partial<Pick<Transaction, 'description' | 'amount' | 'date' | 'status' | 'categoryId' | 'accountId' | 'cardId'>>, cards: Card[]): Transaction {
  const next: Transaction = { ...t, ...patch }
  if (patch.amount !== undefined) next.amount = round2(patch.amount)
  // trocou para a conta: deixa de ser do cartão (e vice-versa)
  if (patch.accountId && t.type === 'despesa' && patch.cardId === undefined) delete next.cardId
  if (patch.cardId && t.type === 'despesa' && patch.accountId === undefined) delete next.accountId
  if (next.type === 'receita') (delete next.cardId, delete next.invoice)
  if (next.type === 'despesa') {
    const card = next.cardId ? cards.find((c) => c.id === next.cardId) : undefined
    if (!card) (delete next.cardId, delete next.invoice)
    else {
      next.status = 'pago'
      if (next.cardId !== t.cardId || next.date !== t.date || !t.invoice) next.invoice = shiftMonth(invoiceFor(card, next.date), t.installment ? t.installment.n - 1 : 0)
    }
  }
  return next
}
