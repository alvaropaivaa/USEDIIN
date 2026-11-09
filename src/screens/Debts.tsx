import { useMemo } from 'react'
import { motion } from 'motion/react'
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, HandCoins, Plus, Wallet } from 'lucide-react'
import clsx from 'clsx'
import { WhatsAppIcon } from '../components/icons'
import { fmtDate } from '../lib/dates'
import { money } from '../lib/format'
import { debtKindLabel, directionLabel, frequencyLabel } from '../lib/loans'
import { useData, useUI, type DebtFilter } from '../lib/store'
import { haptic } from '../lib/haptics'
import { sendCharge } from '../lib/charge'
import { DebtBadge, useDebts, type DebtItem } from '../components/finance'
import { Avatar, Chips, Empty, IconButton, Progress, Screen, spring } from '../components/ui'

/** Cartão de uma dívida (mesmo desenho dos antigos contratos). */
export function DebtCard({ item, index = 0 }: { item: DebtItem; index?: number }) {
  const { debt, summary } = item
  const settings = useData((s) => s.settings)
  const openDebt = useUI((s) => s.openDebt)
  const next = summary.overdue[0] ?? summary.next
  const late = summary.overdue.length > 0
  const owe = debt.direction === 'pagar'

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: Math.min(index, 8) * 0.03 }}
      whileTap={{ scale: 0.99 }}
      onClick={() => (haptic(), openDebt(debt.id))}
      className="mb-3 cursor-pointer rounded-[24px] bg-surface p-4 shadow-card transition-shadow hover:shadow-[0_0_0_1px_var(--separator),0_14px_32px_-16px_rgba(15,21,18,0.25)] lg:mb-0"
    >
      {/* quem + status */}
      <div className="flex items-center gap-3">
        <Avatar name={debt.person} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold tracking-[-0.01em]">{debt.person}</p>
          <p className="truncate text-[12px] text-label-2">
            {debtKindLabel[debt.kind]} · {frequencyLabel[debt.frequency]} · <span className={owe ? 'text-red' : 'text-green'}>{directionLabel[debt.direction]}</span>
          </p>
        </div>
        <DebtBadge status={summary.status} />
      </div>

      {/* números */}
      <div className="mt-4 grid grid-cols-3 rounded-[16px] bg-fill/60 p-3">
        <div className="min-w-0">
          <p className="text-[11px] text-label-2">{next && next.paid > 0 ? 'Falta da parcela' : 'Parcela'}</p>
          <p className="tabular truncate text-[15px] font-semibold">{money(next?.remaining ?? debt.schedule.at(-1)?.amount ?? 0)}</p>
        </div>
        <div className="min-w-0 border-l border-separator pl-3">
          <p className="text-[11px] text-label-2">Pagas</p>
          <p className="tabular text-[15px] font-semibold">
            {summary.paidCount} de {summary.count}
          </p>
        </div>
        <div className="min-w-0 border-l border-separator pl-3">
          <p className="text-[11px] text-label-2">{summary.status === 'quitado' ? 'Situação' : late ? 'Venceu em' : 'Vence em'}</p>
          <p className={clsx('tabular text-[15px] font-semibold', late && 'text-red')}>{next ? fmtDate(next.due).slice(0, 5) : 'Quitada'}</p>
        </div>
      </div>

      {/* progresso */}
      <div className="mt-3 flex items-center gap-3">
        <Progress value={summary.total ? summary.paid / summary.total : 0} className="flex-1" />
        <span className="tabular shrink-0 text-[12px] text-label-2">
          <span className="font-semibold text-label">{money(summary.open)}</span> em aberto
        </span>
      </div>

      {/* ações */}
      {next &&
        (owe ? (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={(e) => (e.stopPropagation(), haptic(), openDebt(debt.id))}
            className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-fill text-[14px] font-semibold text-label"
          >
            <Wallet className="size-[18px]" /> Pagar parcela
          </motion.button>
        ) : (
          <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={(e) => {
                e.stopPropagation()
                haptic('medium')
                sendCharge(settings, debt, next)
              }}
              className="flex h-11 min-w-0 items-center justify-center gap-2 rounded-full bg-[#1fa855] px-3 text-[14px] font-semibold text-white"
            >
              <WhatsAppIcon className="size-[18px] shrink-0" /> <span className="truncate">Lembrar no WhatsApp</span>
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={(e) => (e.stopPropagation(), haptic(), openDebt(debt.id))}
              className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-fill px-4 text-[14px] font-semibold text-label"
            >
              <CheckCircle2 className="size-[18px]" /> Receber
            </motion.button>
          </div>
        ))}
    </motion.div>
  )
}

/** Resumo de um lado (o que devo / o que me devem); tocar filtra a lista. */
function SideCard({ owe, items, active, onClick }: { owe: boolean; items: DebtItem[]; active: boolean; onClick: () => void }) {
  const open = items.reduce((s, i) => s + i.summary.open, 0)
  const overdue = items.reduce((s, i) => s + i.summary.overdueAmount, 0)
  const next = items
    .map((i) => i.summary.overdue[0] ?? i.summary.next)
    .filter((x) => x !== undefined)
    .sort((a, b) => a.due.localeCompare(b.due))[0]
  const Icon = owe ? ArrowUpRight : ArrowDownLeft
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={() => (haptic(), onClick())}
      className={clsx('min-w-0 rounded-[22px] bg-surface p-4 text-left shadow-card transition-shadow', active && 'ring-2 ring-label')}
    >
      <span className="flex items-center gap-2">
        <span className={clsx('grid size-8 shrink-0 place-items-center rounded-full', owe ? 'bg-red/10 text-red' : 'bg-tint/12 text-green')}>
          <Icon className="size-4" strokeWidth={2.2} />
        </span>
        <span className="truncate text-[13px] font-medium text-label-2">{owe ? 'Eu devo' : 'Me devem'}</span>
      </span>
      <p className={clsx('tabular mt-2 truncate text-[19px] font-semibold tracking-[-0.02em]', !owe && open > 0 && 'text-green')}>{money(open)}</p>
      <p className={clsx('mt-0.5 truncate text-[11.5px] font-medium', overdue > 0 ? 'text-red' : 'text-label-2')}>
        {overdue > 0 ? `${money(overdue)} atrasado` : next ? `próxima ${fmtDate(next.due).slice(0, 5)} · ${money(next.remaining)}` : items.length ? 'tudo quitado' : 'nada registrado'}
      </p>
    </motion.button>
  )
}

export default function Debts() {
  const { items } = useDebts()
  const openNewDebt = useUI((s) => s.openNewDebt)
  const filter = useUI((s) => s.debtFilter)
  const setFilter = useUI((s) => s.setDebtFilter)

  const owe = items.filter((i) => i.debt.direction === 'pagar')
  const lent = items.filter((i) => i.debt.direction === 'receber')

  const counts = useMemo(
    () => ({
      todas: items.length,
      pagar: owe.length,
      receber: lent.length,
      atrasado: items.filter((i) => i.summary.status === 'atrasado').length,
      quitado: items.filter((i) => i.summary.status === 'quitado').length,
    }),
    [items, owe.length, lent.length],
  )

  const list = useMemo(() => {
    const order = { atrasado: 0, em_dia: 1, renegociado: 1, quitado: 2 }
    const match = (i: DebtItem) =>
      filter === 'todas' ? true : filter === 'pagar' || filter === 'receber' ? i.debt.direction === filter : i.summary.status === filter
    const nextDue = (i: DebtItem) => (i.summary.overdue[0] ?? i.summary.next)?.due ?? '9'
    return items.filter(match).sort((a, b) => order[a.summary.status] - order[b.summary.status] || nextDue(a).localeCompare(nextDue(b)))
  }, [items, filter])

  const toggle = (f: DebtFilter) => setFilter(filter === f ? 'todas' : f)

  return (
    <Screen
      title="Dívidas e empréstimos"
      subtitle="O que você deve e o que têm a te pagar."
      trailing={
        <IconButton label="Nova dívida" onClick={() => openNewDebt(true)}>
          <Plus className="size-[18px]" strokeWidth={2.5} />
        </IconButton>
      }
    >
      {items.length === 0 ? (
        <div className="rounded-[22px] bg-surface shadow-card">
          <Empty
            art="nuvem"
            title="Nenhuma dívida por aqui"
            text="Registre financiamentos, empréstimos e acordos, ou o dinheiro que você emprestou para alguém."
          />
          <div className="grid grid-cols-2 gap-2 px-4 pb-5">
            <button onClick={() => (haptic(), openNewDebt(true, 'pagar'))} className="grad-btn flex h-11 items-center justify-center gap-1.5 rounded-full text-[14px] font-semibold text-white">
              <ArrowUpRight className="size-4" /> Registrar dívida
            </button>
            <button onClick={() => (haptic(), openNewDebt(true, 'receber'))} className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-fill text-[14px] font-semibold text-label">
              <ArrowDownLeft className="size-4" /> Emprestei dinheiro
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:max-w-2xl">
            <SideCard owe items={owe} active={filter === 'pagar'} onClick={() => toggle('pagar')} />
            <SideCard owe={false} items={lent} active={filter === 'receber'} onClick={() => toggle('receber')} />
          </div>

          <Chips
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'todas', label: 'Todas', count: counts.todas },
              { value: 'pagar', label: 'Eu devo', count: counts.pagar },
              { value: 'receber', label: 'Me devem', count: counts.receber },
              { value: 'atrasado', label: 'Atrasadas', count: counts.atrasado },
              { value: 'quitado', label: 'Quitadas', count: counts.quitado },
            ]}
          />

          {list.length === 0 ? (
            <div className="rounded-[22px] bg-surface shadow-card">
              <Empty icon={<HandCoins className="size-9" strokeWidth={1.5} />} title="Nada neste filtro" text="Escolha outro filtro ou toque no + para registrar." />
            </div>
          ) : (
            // computador: cartões lado a lado
            <div className="lg:grid lg:grid-cols-2 lg:gap-4 2xl:grid-cols-3">
              {list.map((item, k) => (
                <DebtCard key={item.debt.id} item={item} index={k} />
              ))}
            </div>
          )}

          <p className="mt-4 px-1 text-[12px] leading-[17px] text-label-2">
            Cada pagamento vira um lançamento na categoria Dívidas e empréstimos, e entra no saldo da conta escolhida.
          </p>
        </>
      )}
    </Screen>
  )
}
