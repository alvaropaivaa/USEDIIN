// Dívidas, empréstimos e financiamentos: cronograma de parcelas e pagamentos.
// Pagamentos ficam registrados na dívida e são distribuídos nas parcelas em ordem
// de vencimento — isso permite pagamento parcial sem nenhum estado extra.
// Cada pagamento também vira um lançamento (despesa ou receita) na categoria de dívidas.

import { addDays, addMonths, diffDays, today } from './dates'

export type Frequency = 'diaria' | 'semanal' | 'quinzenal' | 'mensal'
export type InterestMode = 'simples' | 'composto'
/** Quem paga: eu (dívida) ou o outro (dinheiro que emprestei). */
export type Direction = 'pagar' | 'receber'
export type DebtKind = 'emprestimo' | 'financiamento' | 'pessoal' | 'acordo'

export const debtKindLabel: Record<DebtKind, string> = { emprestimo: 'Empréstimo', financiamento: 'Financiamento', pessoal: 'Dívida pessoal', acordo: 'Acordo / parcelamento' }
export const directionLabel: Record<Direction, string> = { pagar: 'Eu devo', receber: 'Me devem' }
export const frequencyLabel: Record<Frequency, string> = { diaria: 'Diária', semanal: 'Semanal', quinzenal: 'Quinzenal', mensal: 'Mensal' }

export interface Payment {
  id: string
  date: string
  /** Valor que abate as parcelas. */
  amount: number
  /** Multa/juros por atraso recebidos junto (não abate parcelas). */
  fee?: number
}

export interface Scheduled {
  due: string
  amount: number
}

/** Qualquer coisa paga em parcelas com juros. */
export interface Loan {
  id: string
  principal: number
  /** Juros ao mês, decimal (5% = 0.05). */
  rate: number
  mode: InterestMode
  frequency: Frequency
  createdAt: string
  schedule: Scheduled[]
  payments: Payment[]
  renegotiated?: boolean
}

export interface Debt extends Loan {
  direction: Direction
  kind: DebtKind
  /** Com quem: banco, financeira, parente, amigo… */
  person: string
  /** WhatsApp de quem te deve, para lembrar da parcela. */
  phone?: string
  /** Conta que costuma pagar (ou receber) as parcelas. */
  accountId?: string
  note?: string
}

/** Número curto e estável da dívida (recibo e identificador do Pix). */
export const debtCode = (id: string) => {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return (h % 90000) + 10000
}

export interface Terms {
  principal: number
  rate: number
  mode: InterestMode
  frequency: Frequency
  count: number
  firstDue: string
}

const round2 = (v: number) => Math.round(v * 100) / 100
const EPS = 0.005

/** Fração de mês de cada período, para converter a taxa mensal. */
const periodFraction: Record<Frequency, number> = { diaria: 1 / 30, semanal: 7 / 30, quinzenal: 15 / 30, mensal: 1 }

/** 1º vencimento sugerido: daqui a um período. */
export const firstDueFor = (f: Frequency, from = today()) => (f === 'mensal' ? addMonths(from, 1) : addDays(from, f === 'diaria' ? 1 : f === 'semanal' ? 7 : 15))

export const nthDue = (first: string, frequency: Frequency, k: number) => {
  switch (frequency) {
    case 'diaria':
      return addDays(first, k)
    case 'semanal':
      return addDays(first, 7 * k)
    case 'quinzenal':
      return addDays(first, 15 * k)
    case 'mensal':
      return addMonths(first, k)
  }
}

/** Gera as parcelas. Simples: juros lineares sobre o capital. Composto: Tabela Price. */
export function buildSchedule({ principal, rate, mode, frequency, count, firstDue }: Terms): Scheduled[] {
  const n = Math.max(1, Math.round(count))
  const f = periodFraction[frequency]
  let total: number
  let each: number
  if (mode === 'simples') {
    total = round2(principal * (1 + rate * f * n))
    each = round2(total / n)
  } else {
    const ip = Math.pow(1 + rate, f) - 1
    each = round2(ip === 0 ? principal / n : (principal * ip) / (1 - Math.pow(1 + ip, -n)))
    total = round2(each * n)
  }
  return Array.from({ length: n }, (_, k) => ({
    due: nthDue(firstDue, frequency, k),
    // a última parcela absorve a diferença de arredondamento
    amount: k === n - 1 ? round2(total - each * (n - 1)) : each,
  }))
}

// ─── Visões derivadas ─────────────────────────────────────────

export type InstallmentStatus = 'pago' | 'parcial' | 'pendente' | 'hoje' | 'atrasada'

export interface Installment {
  n: number
  count: number
  due: string
  amount: number
  paid: number
  remaining: number
  status: InstallmentStatus
}

export function installments(c: Loan, ref = today()): Installment[] {
  let pool = c.payments.reduce((s, p) => s + p.amount, 0)
  return c.schedule.map((s, i) => {
    const paid = round2(Math.min(s.amount, Math.max(0, pool)))
    pool -= paid
    const remaining = round2(s.amount - paid)
    let status: InstallmentStatus
    if (remaining < EPS) status = 'pago'
    else if (s.due < ref) status = 'atrasada'
    else if (s.due === ref) status = 'hoje'
    else status = paid > EPS ? 'parcial' : 'pendente'
    return { n: i + 1, count: c.schedule.length, due: s.due, amount: s.amount, paid, remaining, status }
  })
}

export type ContractStatus = 'em_dia' | 'atrasado' | 'renegociado' | 'quitado'

export const contractStatusLabel: Record<ContractStatus, string> = {
  em_dia: 'Em dia',
  atrasado: 'Atrasado',
  renegociado: 'Renegociado',
  quitado: 'Quitado',
}

export interface Summary {
  total: number
  paid: number
  open: number
  interest: number
  paidCount: number
  count: number
  next?: Installment
  overdue: Installment[]
  overdueAmount: number
  status: ContractStatus
  list: Installment[]
}

export function summarize(c: Loan, ref = today()): Summary {
  const list = installments(c, ref)
  const total = round2(c.schedule.reduce((s, x) => s + x.amount, 0))
  const paid = round2(Math.min(total, c.payments.reduce((s, p) => s + p.amount, 0)))
  const overdue = list.filter((i) => i.status === 'atrasada')
  const open = round2(total - paid)
  const status: ContractStatus = open < EPS ? 'quitado' : overdue.length ? 'atrasado' : c.renegotiated ? 'renegociado' : 'em_dia'
  return {
    total,
    paid,
    open,
    interest: round2(total - c.principal),
    paidCount: list.filter((i) => i.status === 'pago').length,
    count: list.length,
    next: list.find((i) => i.status !== 'pago'),
    overdue,
    overdueAmount: round2(overdue.reduce((s, i) => s + i.remaining, 0)),
    status,
    list,
  }
}

/**
 * Renegocia o saldo em aberto: mantém o que já foi pago e substitui o restante
 * por um novo cronograma calculado sobre o saldo devedor.
 */
export function renegotiate<T extends Loan>(c: T, terms: Omit<Terms, 'principal'>): T {
  let pool = c.payments.reduce((s, p) => s + p.amount, 0)
  const kept: Scheduled[] = []
  for (const s of c.schedule) {
    if (pool < EPS) break
    const part = round2(Math.min(s.amount, pool))
    kept.push({ due: s.due, amount: part })
    pool -= part
  }
  const open = round2(c.schedule.reduce((s, x) => s + x.amount, 0) - kept.reduce((s, x) => s + x.amount, 0))
  return {
    ...c,
    rate: terms.rate,
    mode: terms.mode,
    frequency: terms.frequency,
    schedule: [...kept, ...buildSchedule({ ...terms, principal: open })],
    renegotiated: true,
  }
}

// ─── Encargos por atraso ──────────────────────────────────────

export interface LateRules {
  /** Multa única sobre o valor em atraso (0.02 = 2%). */
  fee: number
  /** Juros de mora por dia de atraso (0.0033 = 0,33%/dia ≈ 10%/mês). */
  daily: number
  /** Dias de tolerância antes de cobrar encargos. */
  grace: number
}

export function lateCharges(inst: Pick<Installment, 'remaining' | 'due' | 'status'>, rules: LateRules, ref = today()) {
  if (inst.status !== 'atrasada' || inst.remaining <= 0) return { days: 0, fee: 0, interest: 0, total: 0 }
  const days = diffDays(ref, inst.due)
  if (days <= rules.grace) return { days, fee: 0, interest: 0, total: 0 }
  const fee = round2(inst.remaining * rules.fee)
  const interest = round2(inst.remaining * rules.daily * days)
  return { days, fee, interest, total: round2(fee + interest) }
}
