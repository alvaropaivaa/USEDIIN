import { useMemo, useState } from 'react'
import { addDays, diffDays, monthKey, parseISO, shiftMonth, shortMonth } from '../lib/dates'
import { percent } from '../lib/format'
import { budgetTone, byCategory, limitOf, cashDate, goalStats, isFlow, monthRange, monthTotals, overallBudget, totals, type Transaction } from '../lib/ledger'
import { useData } from '../lib/store'
import { agenda, currentInvoices, forecastBalance, useDebts, useFinance } from '../components/finance'
import type { FlowPoint } from '../components/charts'

// Números da tela inicial: o celular e o computador mostram o mesmo, cada um no seu layout.

export type Period = 'semana' | 'mes' | 'semestre'

const weekDays = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

export const longDate = () => new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase())

export function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

const round2 = (v: number) => Math.round(v * 100) / 100

export function useHomeData() {
  const f = useFinance()
  const { items: debts } = useDebts()
  const settings = useData((s) => s.settings)
  const [period, setPeriod] = useState<Period>('mes')
  const { ref, transactions, cardsIdx, categories } = f

  // ─── Mês atual × mês passado (até o mesmo dia) ─────────────
  const month = useMemo(() => {
    const key = monthKey(ref)
    const prev = shiftMonth(key, -1)
    const prevEnd = monthRange(prev).to
    const prevSame = `${prev}-${ref.slice(8, 10)}`
    const now = monthTotals(transactions, cardsIdx, key)
    const toDate = totals(transactions, cardsIdx, `${key}-01`, ref)
    const before = totals(transactions, cardsIdx, `${prev}-01`, prevSame > prevEnd ? prevEnd : prevSame)
    const series = Array.from({ length: 6 }, (_, k) => monthTotals(transactions, cardsIdx, shiftMonth(key, k - 5)))
    const { limit, spent } = overallBudget(categories, settings.budgetTotal, transactions, cardsIdx, key)
    const ratio = limit > 0 ? spent / limit : 0
    return {
      key,
      label: shortMonth(prev).toLowerCase(),
      now,
      toDate,
      before,
      income: series.map((s) => s.income),
      expense: series.map((s) => s.expense),
      limit,
      spent,
      ratio,
      tone: limit > 0 ? budgetTone(ratio, settings.budgetAlert) : null,
      savings: now.income > 0 ? now.balance / now.income : null,
    }
  }, [transactions, cardsIdx, categories, ref, settings.budgetTotal, settings.budgetAlert])

  // ─── Contas a pagar e receber ──────────────────────────────
  const end = monthRange(monthKey(ref)).to
  const due = useMemo(() => agenda(f, debts, Math.max(30, diffDays(end, ref))), [f, debts, end, ref])
  // saldo de hoje + o que entra − o que sai até o fim do mês (contas, parcelas e faturas)
  const forecast = useMemo(() => forecastBalance(f.total, due, end), [due, end, f.total])
  const counts = {
    hoje: due.filter((d) => d.status === 'hoje').length,
    atrasadas: due.filter((d) => d.status === 'atrasada').length,
    semana: due.filter((d) => d.status === 'proxima' && d.date <= addDays(ref, 7)).length,
    pagar: round2(due.filter((d) => !d.income && d.date <= end).reduce((s, d) => s + d.amount, 0)),
  }

  // ─── Fluxo de caixa ────────────────────────────────────────
  const flow = useMemo(() => {
    let buckets: { label: string; from: string; to: string; current: boolean }[]
    let range: string
    if (period === 'semana') {
      const start = addDays(ref, -parseISO(ref).getDay())
      buckets = weekDays.map((label, k) => {
        const d = addDays(start, k)
        return { label, from: d, to: d, current: d === ref }
      })
      range = `${start.slice(8, 10)}/${start.slice(5, 7)} – ${addDays(start, 6).slice(8, 10)}/${addDays(start, 6).slice(5, 7)}`
    } else if (period === 'mes') {
      const { from, to } = monthRange(monthKey(ref))
      const n = Number(to.slice(8, 10))
      buckets = Array.from({ length: n }, (_, k) => {
        const d = addDays(from, k)
        return { label: String(k + 1), from: d, to: d, current: d === ref }
      })
      range = shortMonth(monthKey(ref)) + ' ' + ref.slice(0, 4)
    } else {
      buckets = Array.from({ length: 6 }, (_, k) => {
        const m = shiftMonth(monthKey(ref), k - 5)
        return { label: shortMonth(m), ...monthRange(m), current: k === 5 }
      })
      range = `${buckets[0].label} – ${buckets[5].label}`
    }
    // cada lançamento cai no seu dia de caixa (compra no cartão: vencimento da fatura)
    const dated = transactions.filter(isFlow).map((t) => ({ t, d: cashDate(t, cardsIdx) }))
    const sum = (from: string, to: string, type: Transaction['type']) => round2(dated.filter(({ t, d }) => t.type === type && d >= from && d <= to).reduce((s, { t }) => s + t.amount, 0))
    const data: FlowPoint[] = buckets.map((b) => ({ label: b.label, date: b.from, current: b.current, income: sum(b.from, b.to, 'receita'), expense: sum(b.from, b.to, 'despesa') }))
    const income = round2(data.reduce((s, d) => s + d.income, 0))
    const expense = round2(data.reduce((s, d) => s + d.expense, 0))
    return { data, range, income, expense, balance: round2(income - expense) }
  }, [transactions, cardsIdx, ref, period])

  // ─── Despesas por categoria e orçamento do mês ────────────
  const spending = useMemo(() => {
    const { from, to } = monthRange(monthKey(ref))
    const by = byCategory(transactions, cardsIdx, categories, 'despesa', from, to)
    const roots = categories.filter((c) => c.type === 'despesa' && !c.parentId)
    const list = roots.map((c) => ({ cat: c, value: by.get(c.id) ?? 0 })).filter((x) => x.value > 0)
    const uncategorized = by.get('') ?? 0
    const sorted = list.sort((a, b) => b.value - a.value)
    const budgets = roots
      .filter((c) => !c.archived && limitOf(c, categories) > 0)
      .map((c) => {
        const spent = by.get(c.id) ?? 0
        const limit = limitOf(c, categories)
        const ratio = spent / limit
        return { cat: c, spent, limit, ratio, tone: budgetTone(ratio, settings.budgetAlert) }
      })
      .sort((a, b) => b.ratio - a.ratio)
    return { sorted, uncategorized, total: round2(sorted.reduce((s, x) => s + x.value, 0) + uncategorized), budgets }
  }, [transactions, cardsIdx, categories, ref, settings.budgetAlert])

  const goals = useMemo(
    () =>
      f.goals
        .filter((g) => !g.archived && !g.completedAt)
        .map((g) => ({ goal: g, stats: goalStats(g, ref) }))
        .filter((x) => !x.stats.done)
        .sort((a, b) => b.stats.ratio - a.stats.ratio),
    [f.goals, ref],
  )

  const invoices = useMemo(() => currentInvoices(f), [f])

  // últimos lançamentos (até hoje), do mais novo para o mais antigo
  const recent = useMemo(
    () => transactions.filter((t) => t.date <= ref && !t.adjust).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 8),
    [transactions, ref],
  )

  return { f, settings, ref, debts, month, due, forecast, counts, end, period, setPeriod, flow, spending, goals, invoices, recent }
}

export type HomeData = ReturnType<typeof useHomeData>

/** "dd/mm" de uma data. */
export const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/** Fração das receitas em "16,99%" (sem ",00"); até 999%, para não estourar o cartão. */
export const savingsPct = (v: number) => percent(Math.min(9.99, v)).replace(',00', '')
