import { useMemo, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { ChevronLeft, ChevronRight, Repeat, type LucideIcon } from 'lucide-react'
import clsx from 'clsx'
import { useData, useUI } from '../lib/store'
import { addDays, monthLabel, relDay, shiftMonth } from '../lib/dates'
import { money } from '../lib/format'
import { haptic } from '../lib/haptics'
import { iconFor } from '../lib/categories'
import { balances, cardIndex, invoice, invoiceFor, isLate, totalBalance, type Account, type Card, type Category, type Invoice, type Transaction } from '../lib/ledger'
import { contractStatusLabel, summarize, type ContractStatus, type Debt, type Installment, type InstallmentStatus } from '../lib/loans'
import { Badge, type Tone } from './ui'

// ─── Dados derivados ─────────────────────────────────────────

/** Mapas para desenhar um lançamento (categoria, conta, cartão) sem procurar em listas. */
export interface Lookup {
  ref: string
  cats: Map<string, Category>
  accs: Map<string, Account>
  cardsIdx: Map<string, Card>
}

/** Tudo o que as telas precisam, recalculado só quando os dados mudam. */
export function useFinance() {
  const accounts = useData((s) => s.accounts)
  const cards = useData((s) => s.cards)
  const categories = useData((s) => s.categories)
  const transactions = useData((s) => s.transactions)
  const goals = useData((s) => s.goals)
  const debts = useData((s) => s.debts)
  const ref = useUI((s) => s.day)
  return useMemo(() => {
    const cardsIdx = cardIndex(cards)
    const cats = new Map(categories.map((c) => [c.id, c]))
    const accs = new Map(accounts.map((a) => [a.id, a]))
    const bal = balances(accounts, transactions, goals)
    const look: Lookup = { ref, cats, accs, cardsIdx }
    return { ref, accounts, cards, categories, transactions, goals, debts, cardsIdx, cats, accs, bal, total: totalBalance(accounts, bal), look }
  }, [accounts, cards, categories, transactions, goals, debts, ref])
}

export type Finance = ReturnType<typeof useFinance>

/** Dívidas com o resumo das parcelas. */
export function useDebts() {
  const debts = useData((s) => s.debts)
  const ref = useUI((s) => s.day)
  return useMemo(() => ({ ref, items: debts.map((debt) => ({ debt, summary: summarize(debt, ref) })) }), [debts, ref])
}

export type DebtItem = ReturnType<typeof useDebts>['items'][number]

/** Fatura atual de cada cartão ativo. */
export const currentInvoices = (f: Pick<Finance, 'cards' | 'transactions' | 'ref'>) =>
  f.cards.filter((c) => !c.archived).map((c) => invoice(c, invoiceFor(c, f.ref), f.transactions, f.ref))

// ─── Agenda: o que vence (contas, parcelas de dívidas e faturas) ───

export type AgendaStatus = 'atrasada' | 'hoje' | 'proxima'

export interface AgendaItem {
  key: string
  date: string
  title: string
  detail: string
  amount: number
  /** Dinheiro que entra (true) ou sai. */
  income: boolean
  status: AgendaStatus
  source: { tx: Transaction } | { debt: Debt; inst: Installment } | { invoice: Invoice }
}

/** Contas pendentes, parcelas de dívidas e faturas até `days` dias à frente (e tudo o que está atrasado). */
export function agenda(f: Pick<Finance, 'ref' | 'transactions' | 'cards' | 'cats'>, debts: DebtItem[], days = 30): AgendaItem[] {
  const until = addDays(f.ref, days)
  const status = (date: string): AgendaStatus => (date < f.ref ? 'atrasada' : date === f.ref ? 'hoje' : 'proxima')
  const out: AgendaItem[] = []
  for (const t of f.transactions)
    if (t.status === 'pendente' && !t.cardId && t.type !== 'transferencia' && t.date <= until)
      out.push({
        key: `tx:${t.id}`,
        date: t.date,
        title: t.description,
        detail: [f.cats.get(t.categoryId ?? '')?.name, t.installment && `${t.installment.n}/${t.installment.count}`].filter(Boolean).join(' · ') || (t.type === 'receita' ? 'Receita' : 'Despesa'),
        amount: t.amount,
        income: t.type === 'receita',
        status: status(t.date),
        source: { tx: t },
      })
  for (const { debt, summary } of debts)
    for (const inst of summary.list)
      if (inst.status !== 'pago' && inst.due <= until)
        out.push({
          key: `debt:${debt.id}:${inst.n}`,
          date: inst.due,
          title: debt.person,
          detail: `${debt.direction === 'pagar' ? 'Parcela' : 'A receber'} ${inst.n}/${inst.count}`,
          amount: inst.remaining,
          income: debt.direction === 'receber',
          status: status(inst.due),
          source: { debt, inst },
        })
  // cartão arquivado também entra: a fatura em aberto continua sendo uma conta a pagar
  for (const card of f.cards) {
    // faturas que vencem no período (a atual e as anteriores ainda não pagas)
    const keys = new Set(f.transactions.filter((t) => t.cardId === card.id && t.invoice).map((t) => t.invoice!))
    for (const key of keys) {
      const inv = invoice(card, key, f.transactions, f.ref)
      if (inv.open > 0 && inv.due <= until) {
        const detail = inv.status === 'vencida' ? 'Fatura vencida' : inv.status === 'aberta' ? `Fatura aberta · fecha ${relDay(inv.closing, f.ref)}` : 'Fatura fechada'
        out.push({ key: `inv:${card.id}:${key}`, date: inv.due, title: `Fatura ${card.name}`, detail, amount: inv.open, income: false, status: status(inv.due), source: { invoice: inv } })
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || Number(a.income) - Number(b.income))
}

/** Saldo previsto até `until`: o de hoje + o que entra − o que sai (contas pendentes, parcelas de dívidas e faturas). */
export function forecastBalance(total: number, items: AgendaItem[], until: string) {
  const v = items.filter((d) => d.date <= until).reduce((s, d) => s + (d.income ? d.amount : -d.amount), total)
  return Math.round(v * 100) / 100
}

/** Abre o detalhe de um item da agenda. */
export function openAgenda(item: AgendaItem) {
  const ui = useUI.getState()
  const s = item.source
  if ('tx' in s) ui.openTx(true, { id: s.tx.id })
  else if ('debt' in s) ui.openDebt(s.debt.id)
  else ui.openCard(true, s.invoice.card.id, s.invoice.key)
}

export const agendaText: Record<AgendaStatus, { label: string; cls: string }> = {
  atrasada: { label: 'Atrasada', cls: 'text-red' },
  hoje: { label: 'Vence hoje', cls: 'text-blue' },
  proxima: { label: '', cls: 'text-label-2' },
}

// ─── Peças visuais ───────────────────────────────────────────

/**
 * Ícone em traço preto num círculo cinza-claro (como nos apps de banco): a cor fica para o essencial.
 * `onDark`: versão clara, para quando o ícone fica sobre o verde escuro do app.
 */
export function IconTile({ icon: Icon, size = 40, onDark, className }: { icon: LucideIcon; size?: number; onDark?: boolean; className?: string }) {
  const style: CSSProperties = { width: size, height: size }
  return (
    <span className={clsx('grid shrink-0 place-items-center rounded-full', onDark ? 'bg-white/10 text-white' : 'bg-fill text-label', className)} style={style}>
      <Icon style={{ width: Math.round(size * 0.45), height: Math.round(size * 0.45) }} strokeWidth={1.75} aria-hidden />
    </span>
  )
}

/** Ícone da categoria (ou da conta/meta). */
export function CategoryIcon({ category, size = 40, onDark, className }: { category?: (Pick<Category, 'icon'> & { color?: string }) | null; size?: number; onDark?: boolean; className?: string }) {
  return <IconTile icon={iconFor(category?.icon)} size={size} onDark={onDark} className={className} />
}

/** Situação de um lançamento em poucas palavras. */
export function txStatus(t: Transaction, ref: string): { label: string; cls: string } {
  if (t.type === 'transferencia')
    return { label: t.adjust ? 'Ajuste de saldo' : t.status !== 'pago' ? 'Agendada' : t.cardId ? 'Fatura paga' : 'Transferência', cls: 'text-label-2' }
  if (t.cardId) return { label: t.invoice ? `Fatura ${monthLabel(t.invoice).split(' ')[0].toLowerCase().slice(0, 3)}` : 'Cartão', cls: 'text-label-2' }
  if (t.status === 'pago') return { label: t.type === 'receita' ? 'Recebido' : 'Pago', cls: 'text-green' }
  if (isLate(t, ref)) return { label: 'Atrasada', cls: 'text-red' }
  if (t.date === ref) return { label: 'Vence hoje', cls: 'text-blue' }
  return { label: t.type === 'receita' ? 'A receber' : 'A pagar', cls: 'text-label-2' }
}

/** Valor com sinal e cor: receita em verde com "+", despesa com "−", transferência neutra (ajuste de saldo mostra se entrou ou saiu). */
export function signedMoney(t: Pick<Transaction, 'type' | 'amount'> & Partial<Pick<Transaction, 'adjust' | 'toAccountId'>>) {
  if (t.type === 'transferencia' && t.adjust) return `${t.toAccountId ? '+' : '−'} ${money(t.amount)}`
  return t.type === 'receita' ? `+ ${money(t.amount)}` : t.type === 'despesa' ? `− ${money(t.amount)}` : money(t.amount)
}

/** Linha de lançamento (lista agrupada): ícone da categoria, descrição, onde e quanto. */
export function TxRow({ tx, look, onClick, showDate }: { tx: Transaction; look: Lookup; onClick?: () => void; showDate?: boolean }) {
  const cat = look.cats.get(tx.categoryId ?? '')
  const parent = cat?.parentId ? look.cats.get(cat.parentId) : undefined
  const where =
    tx.type === 'transferencia'
      ? [look.accs.get(tx.accountId ?? '')?.name, tx.cardId ? look.cardsIdx.get(tx.cardId)?.name : look.accs.get(tx.toAccountId ?? '')?.name].filter(Boolean).join(' → ')
      : tx.cardId
        ? look.cardsIdx.get(tx.cardId)?.name
        : look.accs.get(tx.accountId ?? '')?.name
  const st = txStatus(tx, look.ref)
  const detail = [showDate && relDay(tx.date, look.ref), cat ? (parent ? `${parent.name} › ${cat.name}` : cat.name) : tx.type === 'transferencia' ? null : 'Sem categoria', where].filter(Boolean).join(' · ')
  const Comp = onClick ? motion.button : motion.div
  return (
    <Comp
      onClick={onClick ? () => (haptic(), onClick()) : undefined}
      whileTap={onClick ? { backgroundColor: 'var(--fill)' } : undefined}
      className={clsx('relative flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left', onClick && 'transition-colors hover:bg-fill/50')}
    >
      {tx.type === 'transferencia' ? (
        <IconTile icon={iconFor(tx.adjust ? 'ajuste' : tx.cardId ? 'cartao' : 'transferencia')} />
      ) : (
        <CategoryIcon category={cat} />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[15px] font-semibold">{tx.description || cat?.name || 'Lançamento'}</span>
          {tx.installment && <span className="tabular shrink-0 rounded-full bg-fill px-1.5 text-[11px] font-semibold text-label-2">{tx.installment.n}/{tx.installment.count}</span>}
          {tx.groupId && !tx.installment && <Repeat className="size-3.5 shrink-0 text-label-3" aria-label="Fixo" />}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-label-2">{detail}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <span className={clsx('tabular text-[15px] font-semibold', tx.type === 'receita' && 'text-green')}>{signedMoney(tx)}</span>
        <span className={clsx('text-[11px] font-semibold', st.cls)}>{st.label}</span>
      </span>
    </Comp>
  )
}

/** Seletor de mês em pílula (Lançamentos, Orçamento, Relatórios). */
export function MonthNav({ month, onChange, className }: { month: string; onChange: (m: string) => void; className?: string }) {
  return (
    <div className={clsx('mb-4 flex items-center justify-between rounded-full bg-surface p-1 shadow-card', className)}>
      <button aria-label="Mês anterior" onClick={() => (haptic(), onChange(shiftMonth(month, -1)))} className="grid size-10 place-items-center rounded-full text-label-2 transition-colors hover:bg-fill active:bg-fill">
        <ChevronLeft className="size-5" />
      </button>
      <span className="text-[15px] font-bold">{monthLabel(month)}</span>
      <button aria-label="Próximo mês" onClick={() => (haptic(), onChange(shiftMonth(month, 1)))} className="grid size-10 place-items-center rounded-full text-label-2 transition-colors hover:bg-fill active:bg-fill">
        <ChevronRight className="size-5" />
      </button>
    </div>
  )
}

// ─── Dívidas (status herdados da gestão de empréstimos) ──────

export const debtTone: Record<ContractStatus, Tone> = { em_dia: 'green', atrasado: 'red', renegociado: 'blue', quitado: 'gray' }

export function DebtBadge({ status }: { status: ContractStatus }) {
  return <Badge tone={debtTone[status]}>{contractStatusLabel[status]}</Badge>
}

export const installmentText: Record<InstallmentStatus, { label: string; cls: string }> = {
  pago: { label: 'Pago ✓', cls: 'text-green' },
  parcial: { label: 'Parcial', cls: 'text-blue' },
  pendente: { label: 'Pendente', cls: 'text-label-2' },
  hoje: { label: 'Vence hoje', cls: 'text-blue' },
  atrasada: { label: 'Atrasada', cls: 'text-red' },
}
