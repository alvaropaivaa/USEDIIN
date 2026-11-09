// Os dados da pessoa (linhas de public.records + ajustes) e o contexto do assistente montado a
// partir deles: saldos, mês, faturas, limites e contas a pagar já calculados com o espelho das
// regras do app (ledger.ts), no formato comum aos canais (_shared/assistente/types.ts).

import type { AssistantContext, AssistantTx } from '../_shared/assistente/types.ts'
import { defaultCategories } from './defaults.ts'
import {
  addDays,
  balances,
  byCategory,
  cardUsage,
  invoice,
  invoiceDates,
  invoiceFor,
  limitOf,
  monthKey,
  monthRange,
  overallBudget,
  round2,
  shiftMonth,
  totals,
  type Account,
  type Card,
  type Category,
  type Goal,
  type Transaction,
} from './ledger.ts'

export interface Settings {
  owner?: string
  defaultAccount?: string
  budgetTotal?: number
  budgetAlert?: number
}

export interface UserData {
  accounts: Account[]
  cards: Card[]
  categories: Category[]
  transactions: Transaction[]
  goals: Goal[]
  settings: Settings
}

export interface RecordRow {
  kind: string
  id: string
  data: unknown
}

/** O que cada mensagem criou ou mudou (whatsapp_log.records); `before` null = criado agora. */
export interface LogRecord {
  kind: 'transactions'
  id: string
  before: Transaction | null
}

export interface LogEntry {
  id: number
  input: string | null
  reply: string | null
  records: LogRecord[]
  undone: boolean
  created_at: string
}

/** Tipos de registro que o assistente lê. */
export const KINDS = ['accounts', 'cards', 'categories', 'transactions', 'goals'] as const

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export function userData(rows: RecordRow[], rawSettings: unknown): UserData {
  const lists: Record<string, Record<string, unknown>[]> = Object.fromEntries(KINDS.map((k) => [k, []]))
  for (const r of rows) if (lists[r.kind] && isObj(r.data)) lists[r.kind].push({ ...r.data, id: r.id })
  const s = isObj(rawSettings) ? rawSettings : {}
  const categories = lists.categories as unknown as Category[]
  return {
    accounts: (lists.accounts as unknown as Account[]).map((a) => ({ ...a, initial: num(a.initial) ?? 0 })),
    cards: (lists.cards as unknown as Card[]).filter((c) => num(c.closingDay) && num(c.dueDay)).map((c) => ({ ...c, limit: num(c.limit) ?? 0 })),
    // conta antiga sem categorias na nuvem: o app usa as padrão (mesmos ids)
    categories: categories.length ? categories : defaultCategories(),
    transactions: (lists.transactions as unknown as Transaction[]).filter((t) => num(t.amount) !== undefined && typeof t.date === 'string'),
    goals: lists.goals as unknown as Goal[],
    settings: {
      owner: typeof s.owner === 'string' ? s.owner.trim() : '',
      defaultAccount: typeof s.defaultAccount === 'string' ? s.defaultAccount : '',
      budgetTotal: num(s.budgetTotal) ?? 0,
      budgetAlert: num(s.budgetAlert) ?? 0.8,
    },
  }
}

export const activeAccounts = (d: UserData) => d.accounts.filter((a) => !a.archived)
export const activeCards = (d: UserData) => d.cards.filter((c) => !c.archived)
export const activeCategories = (d: UserData) => d.categories.filter((c) => !c.archived)

/** Conta que já vem escolhida: a padrão; sem ela, a primeira ativa que entra no total. */
export function defaultAccountId(d: UserData) {
  const active = activeAccounts(d)
  if (d.settings.defaultAccount && active.some((a) => a.id === d.settings.defaultAccount)) return d.settings.defaultAccount
  return (active.find((a) => !a.hidden) ?? active[0])?.id
}

/** Fatura que a pessoa está pagando: a mais antiga já fechada com valor em aberto; senão a atual. */
export function payableInvoice(card: Card, txs: Transaction[], today: string) {
  const current = invoiceFor(card, today)
  const keys = [...new Set(txs.filter((t) => t.cardId === card.id && t.type === 'despesa' && t.invoice && t.invoice <= current).map((t) => t.invoice!))].sort()
  for (const k of keys) {
    const inv = invoice(card, k, txs, today)
    if (inv.open > 0.005 && (k === current || invoiceDates(card, k).closing <= today)) return inv
  }
  const cur = invoice(card, current, txs, today)
  return cur.open > 0.005 ? cur : null
}

export const categoryName = (d: UserData, id: string | undefined) => (id ? d.categories.find((c) => c.id === id)?.name : undefined)
export const accountName = (d: UserData, id: string | undefined) => (id ? d.accounts.find((a) => a.id === id)?.name : undefined)
export const cardName = (d: UserData, id: string | undefined) => (id ? d.cards.find((c) => c.id === id)?.name : undefined)

/** A última mensagem que mudou alguma coisa e ainda não foi desfeita (alvo de "desfazer" e de correções). */
export const undoTarget = (recent: LogEntry[]) => recent.find((e) => !e.undone && e.records.length > 0)

/** Lançamentos (como estão agora) que a última mensagem criou ou mudou. */
export function targetTransactions(d: UserData, recent: LogEntry[]) {
  const target = undoTarget(recent)
  if (!target) return []
  const ids = new Set(target.records.map((r) => r.id))
  return d.transactions.filter((t) => ids.has(t.id))
}

/** Parcelas viram um item só (valor total, número de parcelas, data e situação da primeira). */
export function asItems(txs: Transaction[]): AssistantTx[] {
  const groups = new Map<string, Transaction[]>()
  for (const t of txs) groups.set(t.groupId ?? t.id, [...(groups.get(t.groupId ?? t.id) ?? []), t])
  return [...groups.values()].map((g) => {
    const list = [...g].sort((a, b) => (a.installment?.n ?? 0) - (b.installment?.n ?? 0))
    const t = list[0]
    return {
      type: t.type,
      description: t.description,
      amount: round2(list.reduce((s, x) => s + x.amount, 0)),
      date: t.date,
      categoryId: t.categoryId ?? null,
      accountId: t.accountId ?? null,
      toAccountId: t.toAccountId ?? null,
      cardId: t.cardId ?? null,
      installments: t.installment?.count ?? 1,
      paid: t.status === 'pago',
      note: t.note ?? null,
    }
  })
}

const where = (d: UserData, t: Transaction) =>
  t.cardId ? `cartão ${cardName(d, t.cardId) ?? '?'}` : t.type === 'transferencia' ? `${accountName(d, t.accountId) ?? '?'} → ${accountName(d, t.toAccountId) ?? '?'}` : (accountName(d, t.accountId) ?? null)

/** O contexto do assistente, calculado com as regras do app. */
export function assistantContext(d: UserData, opts: { today: string; name?: string; recent: LogEntry[] }): AssistantContext {
  const { today } = opts
  const cards = new Map(d.cards.map((c) => [c.id, c]))
  const bal = balances(d.accounts, d.transactions, d.goals)
  const accounts = activeAccounts(d)
  const key = monthKey(today)
  const { from, to } = monthRange(key)
  const prev = shiftMonth(key, -1)
  const pr = monthRange(prev)
  const spent = byCategory(d.transactions, cards, d.categories, 'despesa', from, to)

  const invoices: NonNullable<AssistantContext['invoices']> = []
  for (const c of activeCards(d)) {
    const current = invoiceFor(c, today)
    const older = [...new Set(d.transactions.filter((t) => t.cardId === c.id && t.type === 'despesa' && t.invoice && t.invoice < current).map((t) => t.invoice!))].sort()
    for (const k of older) {
      const o = invoice(c, k, d.transactions, today)
      if (o.open > 0.005) invoices.push({ cardId: c.id, key: k, due: o.due, total: o.total, open: o.open, status: o.status })
    }
    const cur = invoice(c, current, d.transactions, today)
    invoices.push({ cardId: c.id, key: current, due: cur.due, total: cur.total, open: cur.open, status: cur.status })
  }

  const pending = d.transactions.filter((t) => t.status === 'pendente' && !t.cardId && t.type !== 'transferencia')
  const late = pending.filter((t) => t.date < today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10)
  const soon = pending.filter((t) => t.date >= today && t.date <= addDays(today, 7)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10)
  const overall = overallBudget(d.categories, d.settings.budgetTotal ?? 0, d.transactions, cards, key)

  return {
    today,
    name: opts.name || null,
    categories: activeCategories(d).map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId ?? null })),
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind, balance: bal.get(a.id) ?? 0, ...(a.hidden ? { hidden: true } : {}) })),
    cards: activeCards(d).map((c) => {
      const use = cardUsage(c, d.transactions)
      return { id: c.id, name: c.name, ...(c.brand ? { brand: c.brand } : {}), ...(c.last4 ? { last4: c.last4 } : {}), closingDay: c.closingDay, dueDay: c.dueDay, limit: c.limit, available: use.available }
    }),
    defaultAccount: defaultAccountId(d) ?? null,
    totalBalance: accounts.length ? round2(accounts.filter((a) => !a.hidden).reduce((s, a) => s + (bal.get(a.id) ?? 0), 0)) : null,
    month: { key, ...totals(d.transactions, cards, from, to) },
    previousMonth: { key: prev, ...totals(d.transactions, cards, pr.from, pr.to) },
    expenseByCategory: [
      ...activeCategories(d)
        .filter((c) => c.type === 'despesa' && !c.parentId)
        .map((c) => ({ categoryId: c.id, name: c.name, amount: spent.get(c.id) ?? 0, limit: limitOf(c, d.categories) || null }))
        .filter((x) => x.amount > 0 || x.limit)
        .sort((a, b) => b.amount - a.amount),
      ...((spent.get('') ?? 0) > 0 ? [{ categoryId: null, name: 'Sem categoria', amount: spent.get('')!, limit: null }] : []),
    ],
    budget: overall.limit > 0 ? overall : null,
    invoices,
    bills: [...late, ...soon].map((t) => ({ type: t.type as 'receita' | 'despesa', description: t.description, amount: t.amount, date: t.date, late: t.date < today })),
    recent: [...d.transactions]
      .filter((t) => t.date <= today)
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      .slice(0, 12)
      .map((t) => ({
        date: t.date,
        type: t.type,
        description: t.description,
        amount: t.amount,
        category: categoryName(d, t.categoryId) ?? null,
        where: where(d, t),
        status: t.status,
        installment: t.installment ? `${t.installment.n}/${t.installment.count}` : null,
      })),
    lastCreated: asItems(targetTransactions(d, opts.recent)),
  }
}

/** A conversa recente no formato do assistente (a mais antiga primeiro). */
export const historyOf = (recent: LogEntry[]) =>
  recent
    .slice(0, 6)
    .toReversed()
    .flatMap((e) => [
      ...(e.input ? [{ role: 'user' as const, text: e.input }] : []),
      ...(e.reply ? [{ role: 'assistant' as const, text: `${e.reply}${e.undone ? ' [depois desfeito]' : ''}` }] : []),
    ])
