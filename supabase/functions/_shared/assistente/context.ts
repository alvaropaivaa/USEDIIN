// Contexto da pessoa: conferido (vem do app, então tudo é limitado e tipado de novo) e
// transformado no texto que a IA lê.

import type {
  AssistantAccount,
  AssistantBill,
  AssistantCard,
  AssistantCategory,
  AssistantCategorySpend,
  AssistantContext,
  AssistantDebt,
  AssistantGoal,
  AssistantInvoice,
  AssistantMonth,
  AssistantRecent,
  AssistantTx,
} from './types.ts'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max = 120) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e12 ? Math.round(v * 100) / 100 : undefined)
const int = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined)
const id = (v: unknown) => (typeof v === 'string' && /^[\w:.-]{1,120}$/.test(v) ? v : undefined)
const list = <T>(v: unknown, max: number, read: (o: Obj) => T | undefined): T[] => (Array.isArray(v) ? v.filter(isObj).map(read).filter((x): x is T => x !== undefined).slice(0, max) : [])
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v)
const TX_TYPES = ['receita', 'despesa', 'transferencia'] as const
const txType = (v: unknown) => (TX_TYPES as readonly unknown[]).includes(v) ? (v as AssistantTx['type']) : undefined

function month(v: unknown): AssistantMonth | null {
  if (!isObj(v) || !isMonth(v.key)) return null
  const n = (k: string) => num(v[k]) ?? 0
  return { key: v.key, income: n('income'), incomePaid: n('incomePaid'), incomePending: n('incomePending'), expense: n('expense'), expensePaid: n('expensePaid'), expensePending: n('expensePending'), balance: n('balance') }
}

function tx(o: Obj): AssistantTx | undefined {
  const type = txType(o.type)
  const amount = num(o.amount)
  const description = str(o.description)
  if (!type || !amount || amount <= 0 || !description || !isDay(o.date)) return undefined
  return {
    type,
    description,
    amount,
    date: o.date,
    categoryId: id(o.categoryId) ?? null,
    accountId: id(o.accountId) ?? null,
    toAccountId: id(o.toAccountId) ?? null,
    cardId: id(o.cardId) ?? null,
    installments: int(o.installments, 1, 360) ?? 1,
    paid: o.paid !== false,
    note: str(o.note, 300) ?? null,
  }
}

/**
 * Confere o contexto que chegou (do app): campos com o tipo certo, textos e listas limitados.
 * null = falta o essencial (o dia de hoje).
 */
export function sanitizeContext(raw: unknown): AssistantContext | null {
  if (!isObj(raw) || !isDay(raw.today)) return null
  const categories = list<AssistantCategory>(raw.categories, 400, (o) => {
    const cid = id(o.id)
    const name = str(o.name)
    const type = o.type === 'receita' || o.type === 'despesa' ? o.type : undefined
    return cid && name && type ? { id: cid, name, type, parentId: id(o.parentId) ?? null } : undefined
  })
  const accounts = list<AssistantAccount>(raw.accounts, 100, (o) => {
    const aid = id(o.id)
    const name = str(o.name)
    if (!aid || !name) return undefined
    const balance = num(o.balance)
    return { id: aid, name, ...(str(o.kind, 20) ? { kind: str(o.kind, 20) } : {}), ...(balance !== undefined ? { balance } : {}), ...(o.hidden === true ? { hidden: true } : {}) }
  })
  const cards = list<AssistantCard>(raw.cards, 50, (o) => {
    const cid = id(o.id)
    const name = str(o.name)
    if (!cid || !name) return undefined
    const c: AssistantCard = { id: cid, name }
    if (str(o.brand, 20)) c.brand = str(o.brand, 20)
    if (typeof o.last4 === 'string' && /^\d{4}$/.test(o.last4)) c.last4 = o.last4
    if (int(o.closingDay, 1, 31)) c.closingDay = int(o.closingDay, 1, 31)
    if (int(o.dueDay, 1, 31)) c.dueDay = int(o.dueDay, 1, 31)
    if (num(o.limit) !== undefined) c.limit = num(o.limit)
    if (num(o.available) !== undefined) c.available = num(o.available)
    return c
  })
  const accountIds = new Set(accounts.map((a) => a.id))
  const budget = isObj(raw.budget) && num(raw.budget.limit) !== undefined ? { limit: num(raw.budget.limit)!, spent: num(raw.budget.spent) ?? 0 } : null
  return {
    today: raw.today,
    name: str(raw.name, 60) ?? null,
    categories,
    accounts,
    cards,
    defaultAccount: typeof raw.defaultAccount === 'string' && accountIds.has(raw.defaultAccount) ? raw.defaultAccount : null,
    totalBalance: num(raw.totalBalance) ?? null,
    month: month(raw.month),
    previousMonth: month(raw.previousMonth),
    expenseByCategory: list<AssistantCategorySpend>(raw.expenseByCategory, 60, (o) => {
      const name = str(o.name)
      const amount = num(o.amount)
      return name && amount !== undefined ? { categoryId: id(o.categoryId) ?? null, name, amount, limit: num(o.limit) ?? null } : undefined
    }),
    budget,
    invoices: list<AssistantInvoice>(raw.invoices, 60, (o) => {
      const cardId = id(o.cardId)
      return cardId && isMonth(o.key) && isDay(o.due) ? { cardId, key: o.key, due: o.due, total: num(o.total) ?? 0, open: num(o.open) ?? 0, status: str(o.status, 20) ?? '' } : undefined
    }),
    bills: list<AssistantBill>(raw.bills, 40, (o) => {
      const description = str(o.description)
      const amount = num(o.amount)
      const type = o.type === 'receita' || o.type === 'despesa' ? o.type : undefined
      return description && amount !== undefined && type && isDay(o.date) ? { type, description, amount, date: o.date, late: o.late === true } : undefined
    }),
    recent: list<AssistantRecent>(raw.recent, 30, (o) => {
      const type = txType(o.type)
      const description = str(o.description)
      const amount = num(o.amount)
      if (!type || !description || amount === undefined || !isDay(o.date)) return undefined
      return {
        ...(id(o.id) ? { id: id(o.id) } : {}),
        date: o.date,
        type,
        description,
        amount,
        category: str(o.category) ?? null,
        where: str(o.where) ?? null,
        ...(o.status === 'pago' || o.status === 'pendente' ? { status: o.status } : {}),
        installment: str(o.installment, 20) ?? null,
        ...(o.last === true ? { last: true } : {}),
      }
    }),
    // metas e dívidas: só o chat do app manda
    ...(Array.isArray(raw.goals) ? { goals: goals(raw.goals) } : {}),
    ...(Array.isArray(raw.debts) ? { debts: debts(raw.debts) } : {}),
    lastCreated: list(raw.lastCreated, 40, tx),
  }
}

const goals = (v: unknown) =>
  list<AssistantGoal>(v, 50, (o) => {
    const gid = id(o.id)
    const name = str(o.name)
    const target = num(o.target)
    if (!gid || !name || target === undefined) return undefined
    return {
      id: gid,
      name,
      target,
      saved: num(o.saved) ?? 0,
      deadline: isDay(o.deadline) ? o.deadline : null,
      monthly: num(o.monthly) ?? null,
      ...(o.done === true ? { done: true } : {}),
    }
  })

const debts = (v: unknown) =>
  list<AssistantDebt>(v, 50, (o) => {
    const did = id(o.id)
    const person = str(o.person, 80)
    const direction = o.direction === 'pagar' || o.direction === 'receber' ? o.direction : undefined
    if (!did || !person || !direction) return undefined
    const next = isObj(o.next) && isDay(o.next.due) && num(o.next.amount) !== undefined ? { due: o.next.due, amount: num(o.next.amount)! } : null
    return { id: did, direction, person, kind: str(o.kind, 20) ?? 'pessoal', open: num(o.open) ?? 0, next, status: str(o.status, 20) ?? '' }
  })

// ─── Texto para a IA ─────────────────────────────────────────

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const money = (v: number) => brl.format(v).replace(/ /g, ' ')
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const monthName = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} de ${key.slice(0, 4)}`
const shortMonth = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1].slice(0, 3)}/${key.slice(0, 4)}`
const weekday = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}
const KIND: Record<string, string> = { corrente: 'conta corrente', poupanca: 'poupança', carteira: 'carteira', investimento: 'investimentos', beneficio: 'vale-benefício', outro: 'outra' }

/** O contexto em texto: contas, cartões, categorias e os números já somados. */
export function contextText(c: AssistantContext) {
  const L: string[] = [`Hoje: ${c.today} (${weekday(c.today)}).`]
  if (c.name) L.push(`Nome da pessoa: ${c.name}.`)
  const catName = new Map(c.categories.map((x) => [x.id, x.name]))
  const accName = new Map(c.accounts.map((x) => [x.id, x.name]))
  const cardName = new Map(c.cards.map((x) => [x.id, x.name]))

  L.push('', 'Contas:')
  if (!c.accounts.length) L.push('- nenhuma conta cadastrada')
  for (const a of c.accounts)
    L.push(
      `- [${a.id}] ${a.name}${a.kind ? ` · ${KIND[a.kind] ?? a.kind}` : ''}${a.balance !== undefined ? ` · saldo ${money(a.balance)}` : ''}${a.id === c.defaultAccount ? ' · conta padrão' : ''}${a.hidden ? ' · fora do saldo total' : ''}`,
    )
  if (c.totalBalance != null) L.push(`Saldo total: ${money(c.totalBalance)}`)

  L.push('', 'Cartões de crédito:')
  if (!c.cards.length) L.push('- nenhum cartão cadastrado')
  for (const k of c.cards) {
    const info = [k.brand && k.brand !== 'outra' ? k.brand : '', k.last4 ? `final ${k.last4}` : ''].filter(Boolean).join(' ')
    const cycle = k.closingDay && k.dueDay ? ` · fecha dia ${k.closingDay}, vence dia ${k.dueDay}` : ''
    const limit = k.available !== undefined && k.limit !== undefined ? ` · limite disponível ${money(k.available)} de ${money(k.limit)}` : ''
    L.push(`- [${k.id}] ${k.name}${info ? ` ${info}` : ''}${cycle}${limit}`)
    for (const inv of (c.invoices ?? []).filter((i) => i.cardId === k.id))
      L.push(`  - fatura de ${shortMonth(inv.key)} (vence ${ddmm(inv.due)}${inv.status ? `, ${inv.status}` : ''}): total ${money(inv.total)}, em aberto ${money(inv.open)}`)
  }

  const tree = (type: 'despesa' | 'receita') => {
    const all = c.categories.filter((x) => x.type === type)
    const ids = new Set(all.map((x) => x.id))
    const out: string[] = []
    for (const root of all.filter((x) => !x.parentId || !ids.has(x.parentId))) {
      out.push(`- ${root.id}: ${root.name}`)
      for (const sub of all.filter((x) => x.parentId === root.id)) out.push(`  - ${sub.id}: ${sub.name}`)
    }
    return out.length ? out : ['- nenhuma']
  }
  L.push('', 'Categorias de despesa (id: nome):', ...tree('despesa'))
  L.push('', 'Categorias de receita (id: nome):', ...tree('receita'))

  if (c.month) {
    const m = c.month
    L.push(
      '',
      `Mês de ${monthName(m.key)} (compras no cartão contam no mês do vencimento da fatura):`,
      `- Receitas: ${money(m.income)} (recebido ${money(m.incomePaid)}, a receber ${money(m.incomePending)})`,
      `- Despesas: ${money(m.expense)} (pago ${money(m.expensePaid)}, a pagar ${money(m.expensePending)})`,
      `- Balanço do mês: ${money(m.balance)}`,
    )
  }
  if (c.expenseByCategory?.length)
    L.push(`- Despesas por categoria: ${c.expenseByCategory.map((x) => `${x.name} ${money(x.amount)}${x.limit ? ` (limite ${money(x.limit)}, ${Math.round((x.amount / x.limit) * 100)}%)` : ''}`).join('; ')}`)
  if (c.budget && c.budget.limit > 0) L.push(`- Limite geral de gastos do mês: ${money(c.budget.limit)}, gasto ${money(c.budget.spent)} (${Math.round((c.budget.spent / c.budget.limit) * 100)}%)`)
  if (c.previousMonth) L.push(`Mês passado (${monthName(c.previousMonth.key)}): receitas ${money(c.previousMonth.income)}, despesas ${money(c.previousMonth.expense)}, balanço ${money(c.previousMonth.balance)}.`)

  if (c.bills?.length) {
    L.push('', 'A pagar e a receber:')
    for (const b of c.bills) L.push(`- ${b.late ? 'atrasado: ' : ''}${b.type === 'receita' ? 'a receber' : 'a pagar'} ${ddmm(b.date)}: ${b.description} ${money(b.amount)}`)
  }

  if (c.recent?.length) {
    L.push('', 'Últimos lançamentos (mais novos primeiro):')
    for (const t of c.recent)
      L.push(
        `- ${t.id ? `[${t.id}] ` : ''}${ddmm(t.date)}/${t.date.slice(0, 4)} · ${t.type} · ${t.description}${t.installment ? ` (parcela ${t.installment})` : ''} · ${money(t.amount)} · ${t.category ?? 'sem categoria'}${t.where ? ` · ${t.where}` : ''}${t.status ? ` · ${t.status}` : ''}${t.last ? ' · da sua última resposta' : ''}`,
      )
  }

  if (c.goals?.length) {
    L.push('', 'Metas:')
    for (const g of c.goals)
      L.push(
        `- [${g.id}] ${g.name} · guardado ${money(g.saved)} de ${money(g.target)}${g.deadline ? ` · até ${ddmm(g.deadline)}/${g.deadline.slice(0, 4)}` : ''}${g.monthly ? ` · plano de ${money(g.monthly)} por mês` : ''}${g.done ? ' · concluída' : ''}`,
      )
  }

  if (c.debts?.length) {
    L.push('', 'Dívidas e empréstimos:')
    for (const d of c.debts)
      L.push(
        `- [${d.id}] ${d.direction === 'pagar' ? `Devo a ${d.person}` : `${d.person} me deve`} (${d.kind}) · falta ${money(d.open)}${d.next ? ` · próxima parcela ${ddmm(d.next.due)}/${d.next.due.slice(0, 4)} de ${money(d.next.amount)}` : ''}${d.status ? ` · ${d.status.replace('_', ' ')}` : ''}`,
      )
  }

  if (c.lastCreated?.length) {
    L.push('', 'Criado na sua última resposta (alvo de "correct" e "undo"):')
    for (const t of c.lastCreated) {
      const where = t.cardId ? `cartão ${cardName.get(t.cardId) ?? t.cardId}` : t.type === 'transferencia' ? `${accName.get(t.accountId ?? '') ?? '?'} → ${accName.get(t.toAccountId ?? '') ?? '?'}` : (accName.get(t.accountId ?? '') ?? 'sem conta')
      L.push(`- ${t.type} · ${t.description} · ${money(t.amount)}${t.installments > 1 ? ` em ${t.installments}x` : ''} · ${t.date} · ${catName.get(t.categoryId ?? '') ?? 'sem categoria'} · ${where}${t.paid ? '' : ' · a pagar/receber'}`)
    }
  }
  return L.join('\n')
}
