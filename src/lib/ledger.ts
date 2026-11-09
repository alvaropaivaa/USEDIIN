// Domínio das finanças pessoais: contas, cartões, categorias, lançamentos, recorrências e metas.
// Tudo aqui é função pura sobre os dados do store: as telas só chamam e desenham.
//
// Regra do cartão de crédito: a compra entra na fatura e conta no mês em que a fatura vence
// (como no extrato do banco). O pagamento da fatura é uma transferência da conta para o cartão,
// então não conta de novo como despesa.

import { addDays, addMonths, diffDays, monthKey, monthLabel, parseISO, shiftMonth, toISO, today } from './dates'
import { monthsForGoal, pmtForGoal } from './finance'

export type TxType = 'receita' | 'despesa' | 'transferencia'
export type TxStatus = 'pago' | 'pendente'
export type CatType = 'receita' | 'despesa'
export type AccountKind = 'corrente' | 'poupanca' | 'carteira' | 'investimento' | 'beneficio' | 'outro'
export type RecurFrequency = 'semanal' | 'mensal' | 'anual'
export type CardBrand = 'visa' | 'mastercard' | 'elo' | 'amex' | 'hipercard' | 'outra'

export const cardBrandLabel: Record<CardBrand, string> = { visa: 'Visa', mastercard: 'Mastercard', elo: 'Elo', amex: 'American Express', hipercard: 'Hipercard', outra: 'Outra' }

export const accountKindLabel: Record<AccountKind, string> = {
  corrente: 'Conta corrente',
  poupanca: 'Poupança',
  carteira: 'Carteira',
  investimento: 'Investimentos',
  beneficio: 'Vale-benefício',
  outro: 'Outra',
}

export const recurLabel: Record<RecurFrequency, string> = { semanal: 'Toda semana', mensal: 'Todo mês', anual: 'Todo ano' }

export interface Account {
  id: string
  name: string
  kind: AccountKind
  /** Banco (ISPB, o código do Banco Central): mostra a logo. Vazio na carteira e afins. */
  bank?: string
  /** Saldo no dia do cadastro. */
  initial: number
  color: string
  /** Fora do saldo total (ex.: conta só de reserva). */
  hidden?: boolean
  archived?: boolean
  createdAt: string
}

export interface Card {
  id: string
  name: string
  brand?: CardBrand
  /** Banco emissor (ISPB): logo e cores do cartão. */
  bank?: string
  /** Modelo visual do cartão (ver cardSkins em lib/banks.ts). */
  skin?: string
  /** Quatro últimos dígitos (só para reconhecer o cartão; opcional). */
  last4?: string
  limit: number
  /** Dia em que a fatura fecha (compras a partir dele vão para a próxima). */
  closingDay: number
  dueDay: number
  /** Conta que costuma pagar a fatura. */
  accountId?: string
  color: string
  archived?: boolean
  createdAt: string
}

export interface Category {
  id: string
  name: string
  type: CatType
  color: string
  /** Chave do ícone (ver categoryIcons). */
  icon: string
  /** Subcategoria de… */
  parentId?: string
  /** Teto de gastos por mês (só despesas; 0 ou vazio = sem limite). */
  budget?: number
  /** Palavras que, na descrição, sugerem esta categoria ("mercado", "ifood"…). */
  keywords?: string[]
  archived?: boolean
}

export interface Transaction {
  id: string
  type: TxType
  description: string
  /** Sempre positivo; o tipo diz se entra ou sai. */
  amount: number
  date: string
  status: TxStatus
  categoryId?: string
  /** Receita/despesa: a conta. Transferência: a conta de origem. */
  accountId?: string
  /** Transferência entre contas: a conta de destino. */
  toAccountId?: string
  /** Despesa: compra no cartão. Transferência: pagamento da fatura deste cartão. */
  cardId?: string
  /** Fatura (AAAA-MM do vencimento) da compra ou do pagamento no cartão. */
  invoice?: string
  tags?: string[]
  note?: string
  /** Liga as parcelas de uma compra ou as repetições de um lançamento fixo. */
  groupId?: string
  installment?: { n: number; count: number }
  /** Pagamento de uma dívida ou empréstimo (aba Dívidas). */
  debtId?: string
  paymentId?: string
  /** Ajuste de saldo da conta: não conta como receita nem despesa. */
  adjust?: boolean
  /** Lançado pelo assistente (no WhatsApp ou no chat do app). */
  via?: 'whatsapp' | 'assistente'
  createdAt: string
}

/** Lançamento fixo: gera as repetições sozinho, sempre com 12 meses à frente. */
export interface Recurrence {
  id: string
  frequency: RecurFrequency
  start: string
  /** Parou de repetir depois deste dia. */
  until?: string
  /** Último dia já gerado. */
  generated: string
  template: Pick<Transaction, 'type' | 'description' | 'amount' | 'categoryId' | 'accountId' | 'cardId' | 'tags' | 'note'>
}

export interface Contribution {
  id: string
  date: string
  /** Positivo = guardou; negativo = resgatou. */
  amount: number
  /** Conta de onde saiu (ou para onde voltou) o dinheiro. */
  accountId?: string
  /** Valor que já estava guardado ao criar a meta (não entra no ritmo de aportes). */
  initial?: boolean
}

export interface Goal {
  id: string
  name: string
  target: number
  /** Data alvo (opcional). */
  deadline?: string
  /** Quanto pretende guardar por mês. */
  monthly?: number
  /** Rendimento ao mês do dinheiro guardado (0,008 = 0,8%). */
  yield?: number
  color: string
  icon: string
  contributions: Contribution[]
  /** Dia em que a meta foi concluída (vai para "Concluídas"). */
  completedAt?: string
  archived?: boolean
  createdAt: string
}

const round2 = (v: number) => Math.round(v * 100) / 100
const EPS = 0.005

// ─── Cartão de crédito: faturas ───────────────────────────────

const clampDay = (y: number, m0: number, day: number) => {
  const last = new Date(y, m0 + 1, 0).getDate()
  return toISO(new Date(y, m0, Math.min(day, last)))
}

/** Fatura (AAAA-MM do vencimento) em que entra uma compra feita no dia `date`. */
export function invoiceFor(card: Pick<Card, 'closingDay' | 'dueDay'>, date: string) {
  const d = parseISO(date)
  // a partir do dia do fechamento (dia 31 em fevereiro = dia 28), a compra já vai para o ciclo seguinte
  const closingDay = Math.min(card.closingDay, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())
  const closing = d.getDate() >= closingDay ? addMonths(`${monthKey(date)}-01`, 1) : `${monthKey(date)}-01`
  // vencimento antes do fechamento no calendário: vence no mês seguinte ao fechamento
  return monthKey(card.dueDay > card.closingDay ? closing : addMonths(closing, 1))
}

/** Dias de fechamento e vencimento de uma fatura. */
export function invoiceDates(card: Pick<Card, 'closingDay' | 'dueDay'>, key: string) {
  const [y, m] = key.split('-').map(Number)
  const due = clampDay(y, m - 1, card.dueDay)
  const closingMonth = card.dueDay > card.closingDay ? key : shiftMonth(key, -1)
  const [cy, cm] = closingMonth.split('-').map(Number)
  return { closing: clampDay(cy, cm - 1, card.closingDay), due }
}

export type InvoiceStatus = 'aberta' | 'fechada' | 'parcial' | 'paga' | 'vencida' | 'vazia'

export const invoiceStatusLabel: Record<InvoiceStatus, string> = { aberta: 'Em aberto', fechada: 'Fechada', parcial: 'Paga em parte', paga: 'Paga', vencida: 'Vencida', vazia: 'Sem gastos' }

export interface Invoice {
  card: Card
  key: string
  closing: string
  due: string
  /** Compras da fatura. */
  total: number
  /** Pagamentos já feitos. */
  paid: number
  open: number
  status: InvoiceStatus
  items: Transaction[]
}

export function invoice(card: Card, key: string, txs: Transaction[], ref = today()): Invoice {
  const { closing, due } = invoiceDates(card, key)
  const items = txs.filter((t) => t.cardId === card.id && t.type === 'despesa' && t.invoice === key).sort((a, b) => b.date.localeCompare(a.date))
  const total = round2(items.reduce((s, t) => s + t.amount, 0))
  const paid = round2(txs.filter((t) => t.cardId === card.id && t.type === 'transferencia' && t.invoice === key && t.status === 'pago').reduce((s, t) => s + t.amount, 0))
  const open = round2(Math.max(0, total - paid))
  const status: InvoiceStatus = total < EPS ? 'vazia' : open < EPS ? 'paga' : ref < closing ? 'aberta' : ref > due ? 'vencida' : paid > EPS ? 'parcial' : 'fechada'
  return { card, key, closing, due, total, paid, open, status, items }
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
  const ratio = card.limit > 0 ? used / card.limit : 0
  return { used, available: round2(card.limit - used), ratio, health: ratio > 0.8 ? 'Atenção ao limite' : ratio > 0.5 ? 'Uso moderado' : 'Limite saudável' }
}

// ─── Dia em que o dinheiro entra ou sai (para meses, gráficos e saldo previsto) ───

export type CardIndex = Map<string, Card>

export const cardIndex = (cards: Card[]): CardIndex => new Map(cards.map((c) => [c.id, c]))

/** Compra no cartão conta no vencimento da fatura; o resto, na própria data. */
export function cashDate(t: Transaction, cards: CardIndex) {
  if (t.type === 'despesa' && t.cardId && t.invoice) {
    const card = cards.get(t.cardId)
    if (card) return invoiceDates(card, t.invoice).due
  }
  return t.date
}

/** Entra nas contas do mês (receita/despesa). Transferência e pagamento de fatura ficam de fora. */
export const isFlow = (t: Transaction) => t.type !== 'transferencia'

/** Venceu e não foi pago. */
export const isLate = (t: Transaction, ref = today()) => t.status === 'pendente' && !t.cardId && t.date < ref

// ─── Saldos ───────────────────────────────────────────────────

/** Saldo de cada conta: saldo inicial + o que já foi pago/recebido + transferências − guardado em metas. */
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
  for (const g of goals) for (const c of g.contributions) add(c.accountId, -c.amount)
  for (const [id, v] of out) out.set(id, round2(v))
  return out
}

/** Saldo atual: soma das contas ativas que entram no total. */
export function totalBalance(accounts: Account[], bal: Map<string, number>) {
  return round2(accounts.filter((a) => !a.archived && !a.hidden).reduce((s, a) => s + (bal.get(a.id) ?? 0), 0))
}

// ─── Totais por período ───────────────────────────────────────

export interface Totals {
  income: number
  expense: number
  /** Já recebido / já pago. */
  incomePaid: number
  expensePaid: number
  incomePending: number
  expensePending: number
  balance: number
}

/** Faturas já quitadas ('cartão:AAAA-MM'): as compras delas contam como pagas. */
export function paidInvoices(txs: Transaction[]) {
  const sum = new Map<string, number>()
  for (const t of txs) {
    if (!t.cardId || !t.invoice) continue
    const k = `${t.cardId}:${t.invoice}`
    if (t.type === 'despesa') sum.set(k, (sum.get(k) ?? 0) + t.amount)
    else if (t.type === 'transferencia' && t.status === 'pago') sum.set(k, (sum.get(k) ?? 0) - t.amount)
  }
  return new Set([...sum].filter(([, open]) => open < EPS).map(([k]) => k))
}

/** Pago de verdade: compra no cartão só quando a fatura foi paga. */
export const settled = (t: Transaction, paid: Set<string>) => (t.type === 'despesa' && t.cardId ? paid.has(`${t.cardId}:${t.invoice}`) : t.status === 'pago')

/** Quanto de cada fatura já foi pago (0 a 1), por 'cartão:AAAA-MM'. */
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

export function totals(txs: Transaction[], cards: CardIndex, from: string, to: string): Totals {
  const r = { income: 0, expense: 0, incomePaid: 0, expensePaid: 0, incomePending: 0, expensePending: 0 }
  const share = invoicePaidShare(txs)
  for (const t of txs) {
    if (!isFlow(t)) continue
    const d = cashDate(t, cards)
    if (d < from || d > to) continue
    // compra no cartão: paga na proporção do que já foi pago da fatura
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

export const monthRange = (key: string) => ({ from: `${key}-01`, to: addDays(`${shiftMonth(key, 1)}-01`, -1) })

export const monthTotals = (txs: Transaction[], cards: CardIndex, key: string) => {
  const { from, to } = monthRange(key)
  return totals(txs, cards, from, to)
}

// ─── Categorias e orçamento ───────────────────────────────────

/** Categoria principal (sobe da subcategoria). */
export const rootOf = (id: string | undefined, cats: Map<string, Category>) => {
  const c = id ? cats.get(id) : undefined
  return c?.parentId && cats.has(c.parentId) ? cats.get(c.parentId)! : c
}

/** Quanto foi gasto (ou recebido) em cada categoria no período, somando as subcategorias na principal. */
export function byCategory(txs: Transaction[], cards: CardIndex, categories: Category[], type: CatType, from: string, to: string) {
  const cats = new Map(categories.map((c) => [c.id, c]))
  const out = new Map<string, number>()
  for (const t of txs) {
    if (t.type !== type) continue
    const d = cashDate(t, cards)
    if (d < from || d > to) continue
    const root = rootOf(t.categoryId, cats)
    const key = root?.id ?? ''
    out.set(key, round2((out.get(key) ?? 0) + t.amount))
    // a subcategoria também guarda o seu total (para o detalhe)
    if (root && t.categoryId && t.categoryId !== root.id) out.set(t.categoryId, round2((out.get(t.categoryId) ?? 0) + t.amount))
  }
  return out
}

export type BudgetTone = 'green' | 'orange' | 'red'

/** Antes do aviso (80% por padrão): no controle; até 100%: em atenção; passou: acima do limite. */
export const budgetTone = (ratio: number, alert = 0.8): BudgetTone => (ratio > 1 + 1e-9 ? 'red' : ratio >= alert ? 'orange' : 'green')

export const budgetLabel: Record<BudgetTone, string> = { green: 'No controle', orange: 'Em atenção', red: 'Acima do limite' }

/**
 * Limite geral do mês e quanto já foi gasto nele.
 * Com um valor definido, vale para todas as despesas; sem ele, é a soma dos limites das categorias
 * principais e conta só o que foi gasto nelas (o aluguel sem limite não "estoura" o orçamento).
 */
export function overallBudget(categories: Category[], total: number, txs: Transaction[], cards: CardIndex, key: string) {
  const { from, to } = monthRange(key)
  if (total > 0) return { limit: total, spent: totals(txs, cards, from, to).expense }
  const budgeted = categories.filter((c) => c.type === 'despesa' && !c.parentId && !c.archived).map((c) => ({ c, limit: limitOf(c, categories) })).filter((x) => x.limit > 0)
  if (!budgeted.length) return { limit: 0, spent: 0 }
  const by = byCategory(txs, cards, categories, 'despesa', from, to)
  return { limit: round2(budgeted.reduce((s, x) => s + x.limit, 0)), spent: round2(budgeted.reduce((s, x) => s + (by.get(x.c.id) ?? 0), 0)) }
}

/** Limite de uma categoria: o dela ou, na principal sem limite próprio, a soma dos limites das subcategorias. */
export function limitOf(c: Category, categories: Category[]) {
  if ((c.budget ?? 0) > 0) return c.budget!
  if (c.parentId) return 0
  return round2(categories.filter((s) => s.parentId === c.id && !s.archived && (s.budget ?? 0) > 0).reduce((t, s) => t + s.budget!, 0))
}

// ─── Sugestão de categoria (sem IA): histórico e palavras-chave ───

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

/**
 * Categoria provável para uma descrição: primeiro o que a pessoa já usou com a mesma descrição,
 * depois as palavras-chave das categorias (a mais específica ganha).
 */
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

// ─── Recorrência e parcelamento ───────────────────────────────

export const nextRecurDate = (start: string, f: RecurFrequency, k: number) =>
  f === 'semanal' ? addDays(start, 7 * k) : f === 'anual' ? addMonths(start, 12 * k) : addMonths(start, k)

/** Até quando os lançamentos fixos ficam gerados. */
export const horizon = (ref = today()) => addMonths(ref, 12)

/**
 * Gera as repetições que faltam dos lançamentos fixos até `until`.
 * Usa a data da última gerada, então apagar uma repetição não faz ela voltar.
 */
export function materialize(rules: Recurrence[], cards: CardIndex, until: string, make: (r: Recurrence, date: string) => Transaction) {
  const created: Transaction[] = []
  const updated: Recurrence[] = []
  for (const r of rules) {
    const end = r.until && r.until < until ? r.until : until
    let k = 0
    let date = r.start
    // pula o que já foi gerado
    while (date <= r.generated) date = nextRecurDate(r.start, r.frequency, ++k)
    let last = r.generated
    while (date <= end) {
      const t = make(r, date)
      if (t.cardId) {
        const card = cards.get(t.cardId)
        if (card) t.invoice = invoiceFor(card, date)
      }
      created.push(t)
      last = date
      date = nextRecurDate(r.start, r.frequency, ++k)
    }
    if (last !== r.generated) updated.push({ ...r, generated: last })
  }
  return { created, updated }
}

/** Divide um valor em parcelas iguais; a última absorve o arredondamento. */
export function splitInstallments(total: number, count: number) {
  const n = Math.max(1, Math.round(count))
  const each = Math.floor((total / n) * 100) / 100
  return Array.from({ length: n }, (_, k) => (k === n - 1 ? round2(total - each * (n - 1)) : each))
}

// ─── Metas ────────────────────────────────────────────────────

export interface GoalStats {
  saved: number
  ratio: number
  left: number
  done: boolean
  /** Média guardada por mês nos últimos 3 meses. */
  pace: number
  /** Ritmo usado na previsão: o planejado ou, sem plano, a média recente. */
  rate: number
  /** Mês previsto para concluir (AAAA-MM), ou null se no ritmo atual não chega. */
  forecast: string | null
  monthsLeft: number
  /** Quanto guardar por mês para chegar até a data alvo. */
  needed: number | null
  /** Situação em relação à data alvo. */
  onTrack: boolean | null
}

export function goalStats(g: Goal, ref = today()): GoalStats {
  const saved = round2(g.contributions.reduce((s, c) => s + c.amount, 0))
  const left = round2(Math.max(0, g.target - saved))
  const done = g.target > 0 && left < EPS
  const from = `${shiftMonth(monthKey(ref), -2)}-01`
  const recent = g.contributions.filter((c) => !c.initial && c.date >= from && c.date <= ref).reduce((s, c) => s + c.amount, 0)
  const pace = round2(Math.max(0, recent / 3))
  const rate = g.monthly && g.monthly > 0 ? g.monthly : pace
  const i = Math.max(0, g.yield ?? 0)
  const months = done ? 0 : monthsForGoal(g.target, saved, rate, i)
  const forecast = done ? monthKey(ref) : isFinite(months) && months < 1200 ? monthKey(addMonths(ref, months)) : null
  let needed: number | null = null
  let onTrack: boolean | null = null
  if (g.deadline && !done) {
    const n = Math.max(1, Math.round(diffDays(g.deadline, ref) / 30.44))
    needed = g.deadline > ref ? round2(Math.max(0, pmtForGoal(g.target, saved, i, n))) : left
    onTrack = forecast !== null && forecast <= monthKey(g.deadline)
  }
  return { saved, ratio: g.target > 0 ? saved / g.target : 0, left, done, pace, rate, forecast, monthsLeft: isFinite(months) ? months : Infinity, needed, onTrack }
}

/** Situação da meta, nos termos do Granazen. */
export function goalStatus(g: Goal, st: GoalStats, ref: string): { label: string; tone: 'green' | 'orange' | 'gray' } {
  if (g.completedAt || st.done) return { label: 'Meta concluída', tone: 'green' }
  if (g.deadline && g.deadline < ref) return { label: 'Prazo vencido', tone: 'orange' }
  if (g.deadline) return st.onTrack ? { label: 'No ritmo', tone: 'green' } : { label: 'Atenção', tone: 'orange' }
  return st.rate > 0 ? { label: 'Em progresso', tone: 'gray' } : { label: 'Sem ritmo', tone: 'gray' }
}

/** "Março de 2027" → "mar/2027". */
export const shortForecast = (key: string) => `${monthLabel(key).split(' ')[0].slice(0, 3).toLowerCase()}/${key.slice(0, 4)}`
