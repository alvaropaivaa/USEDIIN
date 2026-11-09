import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import NumberFlow from '@number-flow/react'
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  Clock,
  CreditCard,
  Eye,
  EyeOff,
  Info,
  ListChecks,
  PieChart,
  PiggyBank,
  Plus,
  RefreshCw,
  Rocket,
  Scale,
  Search,
  Target,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import clsx from 'clsx'
import { addDays, parseISO } from '../lib/dates'
import { isPrivate, money, moneyCompact } from '../lib/format'
import { accountKindLabel, budgetLabel, invoiceStatusLabel } from '../lib/ledger'
import { emptyFilter, useData, useUI } from '../lib/store'
import { useNotices } from '../lib/notify'
import { haptic } from '../lib/haptics'
import { AccountIcon, CardThumb } from '../components/banks'
import { CashFlowChart, Donut, FlowLegend } from '../components/charts'
import { Mascot } from '../components/mascots'
import { CategoryIcon, TxRow, agendaText, openAgenda, type AgendaItem } from '../components/finance'
import { initials } from '../components/ui'
import { Trend } from './Home'
import { ddmm, greeting, longDate, savingsPct, useHomeData, type Period } from './homeData'

// Tela inicial do computador: topo verde do app com a saudação, os quatro números do mês,
// o saldo em destaque num cartão verde e cartões brancos com ícone no cabeçalho.

type Data = ReturnType<typeof useHomeData>

const mac = /mac/i.test(navigator.platform)

const toneText = { green: 'text-green', orange: 'text-orange', red: 'text-red' } as const
const toneBar = { green: 'bg-tint', orange: 'bg-orange', red: 'bg-red' } as const

// ─── Peças ───────────────────────────────────────────────────

/** Cartão branco com cabeçalho (ícone, título e link). */
function Card({ icon: Icon, title, subtitle, action, onAction, right, children, className }: {
  icon: LucideIcon
  title: string
  subtitle?: string
  action?: string
  onAction?: () => void
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={clsx('rounded-[22px] bg-surface p-5 shadow-card', className)}>
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-tint/10 text-tint">
          <Icon className="size-[18px]" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-semibold tracking-[-0.01em]">{title}</h2>
          {subtitle && <p className="truncate text-[12px] text-label-2">{subtitle}</p>}
        </div>
        {right}
        {action && (
          <button onClick={onAction} className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-tint hover:underline">
            {action} <ArrowRight className="size-3.5" />
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

/** Valor em reais que sobe animado ao abrir (respeita o "esconder valores"). */
function Amount({ value, cents = true, className }: { value: number; cents?: boolean; className?: string }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setShown(value), 60)
    return () => clearTimeout(t)
  }, [value])
  if (isPrivate()) return <span className={className}>R$ ••••</span>
  return (
    <NumberFlow
      value={shown}
      locales="pt-BR"
      format={{ style: 'currency', currency: 'BRL', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 }}
      className={clsx('tabular', className)}
    />
  )
}

/** Minigráfico dos últimos meses. */
function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(...values, 1)
  const n = values.length
  const pts = values.map((v, i) => [(i / (n - 1)) * 100, 25 - (v / max) * 21])
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className={className} aria-hidden>
      <path d={`${d} L100 28 L0 28 Z`} fill="currentColor" opacity={0.12} />
      <motion.path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1, ease: 'easeOut', delay: 0.2 }}
      />
    </svg>
  )
}

// ─── Primeiros passos ────────────────────────────────────────

const DISMISS = 'jurospro-primeiros-passos'

/** Conta nova: o que falta para começar a organizar. Some quando tudo estiver feito (ou ao fechar). */
function OnboardingCard() {
  const accounts = useData((s) => s.accounts.length)
  const transactions = useData((s) => s.transactions.length)
  const budgets = useData((s) => s.categories.some((c) => (c.budget ?? 0) > 0) || s.settings.budgetTotal > 0)
  const goals = useData((s) => s.goals.length)
  const enabled = useNotices((s) => s.enabled)
  const { openAccount, openTx, setTab, openGoal, openSettings } = useUI()
  const [closed, setClosed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS) === '1'
    } catch {
      return false
    }
  })

  const steps = [
    { label: 'Cadastre suas contas', cta: 'Cadastrar', done: accounts > 0, action: () => openAccount(true) },
    { label: 'Registre um lançamento', cta: 'Lançar', done: transactions > 0, action: () => openTx(true, { type: 'despesa' }) },
    { label: 'Defina limites de gastos', cta: 'Definir', done: budgets, action: () => setTab('budget') },
    { label: 'Crie uma meta', cta: 'Criar', done: goals > 0, action: () => openGoal(true) },
    { label: 'Ative as notificações', cta: 'Ativar', done: enabled, action: () => openSettings(true, 'notificacoes') },
  ]
  const done = steps.filter((s) => s.done).length
  // quem abriu o app com tudo pronto nem vê o cartão
  const [started] = useState(() => done < steps.length)
  if (closed || !started) return null
  const all = done === steps.length
  const close = () => {
    try {
      localStorage.setItem(DISMISS, '1')
    } catch {}
    setClosed(true)
  }

  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-[22px] bg-surface p-5 shadow-card">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-tint/10 text-tint">
          <Rocket className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em]">{all ? 'Tudo pronto' : 'Primeiros passos'}</h2>
          <p className="text-[12px] text-label-2">{all ? 'Suas finanças estão organizadas. Agora é só acompanhar.' : 'Deixe suas finanças organizadas em poucos minutos.'}</p>
        </div>
        <span className="tabular text-[12.5px] font-semibold text-label-2">
          {done} de {steps.length}
        </span>
        <div className="h-2 w-36 overflow-hidden rounded-full bg-fill">
          <motion.div className="h-full rounded-full bg-tint" initial={{ width: 0 }} animate={{ width: `${(done / steps.length) * 100}%` }} transition={{ duration: 0.8, ease: 'easeOut' }} />
        </div>
        <button onClick={close} title="Fechar" aria-label="Fechar primeiros passos" className="grid size-8 place-items-center rounded-full text-label-2 hover:bg-fill">
          <X className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2.5 xl:grid-cols-5">
        {steps.map((s, i) => (
          <button
            key={s.label}
            onClick={s.action}
            disabled={s.done}
            className={clsx('flex items-start gap-2.5 rounded-[16px] p-3 text-left transition-colors', s.done ? 'bg-tint/[0.07]' : 'bg-fill/50 hover:bg-fill')}
          >
            <span className={clsx('grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-bold', s.done ? 'bg-tint text-white' : 'bg-surface text-label-2 shadow-card')}>
              {s.done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className={clsx('block text-[13px] font-semibold leading-tight', s.done && 'text-label-2 line-through decoration-label-3')}>{s.label}</span>
              <span className="mt-1 block text-[12px] font-semibold text-tint">{s.done ? 'Feito' : `${s.cta} →`}</span>
            </span>
          </button>
        ))}
      </div>
    </motion.section>
  )
}

// ─── Os quatro números do mês ────────────────────────────────

function KpiCard({ icon: Icon, iconCls, label, value, valueCls, children, spark, sparkCls, onClick }: {
  icon: LucideIcon
  iconCls: string
  label: string
  value: number
  valueCls?: string
  children?: ReactNode
  spark?: number[]
  sparkCls?: string
  onClick?: () => void
}) {
  const Comp = onClick ? motion.button : motion.div
  return (
    <Comp
      onClick={onClick}
      whileTap={onClick ? { scale: 0.98 } : undefined}
      className={clsx('relative min-w-0 overflow-hidden rounded-[22px] bg-surface p-4 text-left shadow-card', onClick && 'transition-shadow hover:shadow-[0_0_0_1px_var(--separator),0_14px_32px_-16px_rgba(15,21,18,0.25)]')}
    >
      <div className="flex items-center gap-2">
        <span className={clsx('grid size-8 shrink-0 place-items-center rounded-full', iconCls)}>
          <Icon className="size-4" strokeWidth={2.2} />
        </span>
        <span className="truncate text-[13px] font-medium text-label-2">{label}</span>
      </div>
      <Amount value={value} className={clsx('mt-2 block truncate text-[22px] font-semibold tracking-[-0.02em]', valueCls)} />
      <div className="relative mt-1 min-h-[34px] text-[12px] text-label-2">{children}</div>
      {spark && spark.some((v) => v > 0) && <Sparkline values={spark} className={clsx('absolute bottom-3 right-3 h-7 w-20 opacity-80', sparkCls)} />}
    </Comp>
  )
}

function Kpis({ d }: { d: Data }) {
  const { f, month, forecast, end, settings } = d
  const { setTab, setTxFilter } = useUI()
  const setSettings = useData((s) => s.setSettings)
  const show = (type: 'receita' | 'despesa') => (setTxFilter({ ...emptyFilter, type }), setTab('transactions'))
  return (
    <div className="grid grid-cols-2 gap-4 2xl:grid-cols-4">
      <KpiCard icon={Wallet} iconCls="bg-blue/10 text-blue" label="Saldo atual" value={f.total} valueCls={f.total < 0 ? 'text-red' : undefined}>
        <span className="flex items-center gap-1.5">
          Previsto até {ddmm(end)}: <span className={clsx('tabular font-semibold', forecast < 0 ? 'text-red' : 'text-label')}>{money(forecast)}</span>
          <button
            onClick={() => setSettings({ privacy: !settings.privacy })}
            aria-label={settings.privacy ? 'Mostrar valores' : 'Esconder valores'}
            title={settings.privacy ? 'Mostrar valores' : 'Esconder valores'}
            className="ml-auto grid size-6 place-items-center rounded-full hover:bg-fill hover:text-label"
          >
            {settings.privacy ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        </span>
        <button onClick={() => setTab('accounts')} className="mt-0.5 flex items-center gap-1 font-semibold text-tint hover:underline">
          Ver contas <ArrowRight className="size-3" />
        </button>
      </KpiCard>
      <KpiCard icon={ArrowDownLeft} iconCls="bg-tint/10 text-tint" label="Receitas do mês" value={month.now.income} valueCls="text-green" spark={month.income} sparkCls="text-tint" onClick={() => show('receita')}>
        <span className="block truncate">
          Recebido <span className="tabular font-semibold text-label">{money(month.now.incomePaid)}</span> · a receber <span className="tabular font-semibold text-label">{money(month.now.incomePending)}</span>
        </span>
        <Trend now={month.toDate.income} prev={month.before.income} label={month.label} />
      </KpiCard>
      <KpiCard icon={ArrowUpRight} iconCls="bg-red/10 text-red" label="Despesas do mês" value={month.now.expense} spark={month.expense} sparkCls="text-red" onClick={() => show('despesa')}>
        <span className="block truncate">
          Pago <span className="tabular font-semibold text-label">{money(month.now.expensePaid)}</span> · a pagar <span className="tabular font-semibold text-label">{money(month.now.expensePending)}</span>
        </span>
        {month.tone ? (
          <span className={clsx('inline-flex items-center gap-1 text-[11px] font-semibold', toneText[month.tone])}>
            <span className={clsx('size-1.5 rounded-full', toneBar[month.tone])} />
            {budgetLabel[month.tone]} · {Math.round(month.ratio * 100)}% do limite
          </span>
        ) : (
          <Trend now={month.toDate.expense} prev={month.before.expense} label={month.label} good={false} />
        )}
      </KpiCard>
      <KpiCard icon={Scale} iconCls="bg-orange/15 text-orange" label="Balanço do mês" value={month.now.balance} valueCls={month.now.balance < 0 ? 'text-red' : 'text-green'} onClick={() => setTab('reports')}>
        <span className="block truncate">
          {month.savings === null ? 'Receitas − despesas do mês' : month.savings >= 0 ? `Você economizou ${savingsPct(month.savings)} das receitas` : `Gastou ${savingsPct(-month.savings)} a mais do que recebeu`}
        </span>
        {settings.goal > 0 && (
          <span className="mt-1 flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill">
              <motion.span className="block h-full rounded-full bg-tint" initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, (month.now.balance / settings.goal) * 100))}%` }} transition={{ duration: 1, ease: 'easeOut' }} />
            </span>
            <span className="tabular shrink-0 text-[11px]">meta {moneyCompact(settings.goal)}</span>
          </span>
        )}
      </KpiCard>
    </div>
  )
}

// ─── Saldo e contas (cartão verde) ───────────────────────────

function BalanceCard({ d }: { d: Data }) {
  const { f, forecast, end } = d
  const { openTx, openAccount, setTab } = useUI()
  const accounts = f.accounts.filter((a) => !a.archived)

  return (
    <section className="grad-green relative overflow-hidden rounded-[22px] p-5 text-white shadow-[0_20px_40px_-24px_rgba(12,51,38,0.75)] ring-1 ring-white/10">
      <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-white/[0.04]" />
      <div className="relative flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-full bg-white/10 ring-1 ring-white/15">
          <Wallet className="size-[17px]" />
        </span>
        <button onClick={() => setTab('accounts')} className="flex items-center gap-1.5 text-[15px] font-semibold hover:underline">
          Minhas contas <ArrowRight className="size-3.5" />
        </button>
        <span className="ml-auto text-[12px] text-white/60">
          Previsto até {ddmm(end)}: <span className="tabular font-semibold text-white">{money(forecast)}</span>
        </span>
      </div>

      {accounts.length ? (
        <>
          <div className="relative mt-4">
            <p className="text-[11.5px] text-white/60">Saldo atual</p>
            <Amount value={f.total} className="block truncate text-[30px] font-semibold leading-tight tracking-[-0.03em]" />
          </div>
          <div className="relative mt-3 grid grid-cols-2 gap-2">
            {accounts.slice(0, 6).map((a) => {
              const v = f.bal.get(a.id) ?? 0
              return (
                <button key={a.id} onClick={() => openAccount(true, a.id)} className="flex min-w-0 items-center gap-2.5 rounded-[14px] bg-white/[0.07] p-2.5 text-left transition-colors hover:bg-white/[0.11]">
                  <AccountIcon account={a} size={32} onDark />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{a.name}</span>
                    <span className="block truncate text-[11px] text-white/55">{accountKindLabel[a.kind]}</span>
                  </span>
                  <span className={clsx('tabular shrink-0 text-[13px] font-semibold', v < 0 && 'text-[#fca5a5]')}>{money(v)}</span>
                </button>
              )
            })}
          </div>
          <div className="relative mt-4 grid grid-cols-[1fr_1fr_auto] gap-2">
            <motion.button whileTap={{ scale: 0.97 }} onClick={() => openTx(true, { type: 'receita' })} className="flex h-10 items-center justify-center gap-1.5 rounded-full bg-white text-[14px] font-semibold text-[#0f3b2c] hover:bg-white/90">
              <ArrowDownLeft className="size-[17px]" /> Nova receita
            </motion.button>
            <motion.button whileTap={{ scale: 0.97 }} onClick={() => openTx(true, { type: 'despesa' })} className="flex h-10 items-center justify-center gap-1.5 rounded-full bg-white/[0.12] text-[14px] font-semibold ring-1 ring-white/15 hover:bg-white/[0.18]">
              <ArrowUpRight className="size-[17px]" /> Nova despesa
            </motion.button>
            <motion.button whileTap={{ scale: 0.97 }} onClick={() => openTx(true, { type: 'transferencia' })} title="Transferência entre contas" className="flex h-10 items-center gap-1.5 rounded-full bg-white/[0.12] px-4 text-[14px] font-semibold ring-1 ring-white/15 hover:bg-white/[0.18]">
              <ArrowLeftRight className="size-[17px]" /> Transferir
            </motion.button>
          </div>
        </>
      ) : (
        <>
          <div className="relative mt-3 pr-40">
            <p className="text-[20px] font-semibold leading-tight tracking-[-0.02em]">Comece pelas suas contas</p>
            <p className="mt-1 text-[13px] text-white/65">Cadastre conta, carteira e investimentos para ver o saldo de tudo num lugar só.</p>
            <motion.button whileTap={{ scale: 0.97 }} onClick={() => openAccount(true)} className="mt-4 flex h-10 items-center gap-1.5 rounded-full bg-white px-5 text-[13.5px] font-semibold text-[#0f3b2c] hover:bg-white/90">
              <Plus className="size-4" strokeWidth={2.6} /> Nova conta
            </motion.button>
          </div>
          {/* o mascote na nuvem, com o polegar para cima, no canto do cartão */}
          <div className="pointer-events-none absolute right-5 bottom-3">
            <Mascot pose="nuvem" className="w-[160px]" />
          </div>
        </>
      )}
    </section>
  )
}

// ─── Agenda: contas a pagar e receber ────────────────────────

const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' })
const dayTitle = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })

/** Os próximos 7 dias (e as atrasadas): quanto sai em cada dia; clicar mostra a lista do dia. */
function AgendaCard({ d }: { d: Data }) {
  const { due, ref } = d
  const { setTab, setTxFilter } = useUI()
  const overdue = due.filter((x) => x.status === 'atrasada')
  const days = Array.from({ length: 7 }, (_, i) => addDays(ref, i))
  const byDay = new Map(days.map((day) => [day, due.filter((x) => x.date === day)]))
  // a escolha volta para hoje quando o dia vira ou as atrasadas acabam
  const [picked, setSel] = useState<string>(ref)
  const sel = picked === 'atrasadas' ? (overdue.length ? picked : ref) : days.includes(picked) ? picked : ref
  const list: AgendaItem[] = sel === 'atrasadas' ? overdue : (byDay.get(sel) ?? [])
  const net = (l: AgendaItem[]) => l.reduce((s, x) => s + (x.income ? 0 : x.amount), 0)

  const tiles = [
    ...(overdue.length ? [{ key: 'atrasadas', top: 'Atrasadas', big: String(overdue.length), list: overdue, alert: true }] : []),
    ...days.map((day, i) => ({
      key: day,
      top: i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : weekday.format(parseISO(day)).replace('.', ''),
      big: String(Number(day.slice(8, 10))),
      list: byDay.get(day) ?? [],
      alert: false,
    })),
  ]
  const title = sel === 'atrasadas' ? 'Contas atrasadas' : dayTitle.format(parseISO(sel)).replace(/^./, (c) => c.toUpperCase())

  return (
    <Card
      icon={CalendarDays}
      title="Contas a pagar e receber"
      subtitle="Contas, parcelas de dívidas e faturas"
      action="Pendentes"
      onAction={() => (setTxFilter({ ...emptyFilter, status: 'pendente' }), setTab('transactions'))}
    >
      <div className="flex gap-1.5">
        {tiles.map((t) => {
          const on = sel === t.key
          const n = t.list.length
          return (
            <motion.button
              key={t.key}
              whileTap={{ scale: 0.95 }}
              onClick={() => (haptic(), setSel(t.key))}
              className={clsx(
                'relative flex min-w-0 flex-1 flex-col items-center rounded-[14px] px-1 py-2.5 transition-colors',
                on ? (t.alert ? 'bg-red text-white' : 'bg-tint text-white') : t.alert ? 'bg-red/[0.07] hover:bg-red/10' : 'bg-fill/50 hover:bg-fill',
              )}
            >
              <span className={clsx('text-[11px] font-semibold capitalize', on ? 'text-white/80' : t.alert ? 'text-red' : 'text-label-2')}>{t.top}</span>
              <span className={clsx('tabular mt-0.5 text-[19px] font-semibold leading-tight', !on && t.alert && 'text-red')}>{t.big}</span>
              <span className={clsx('tabular mt-0.5 w-full truncate text-center text-[10.5px]', on ? 'text-white/80' : 'text-label-2')}>
                {n ? moneyCompact(net(t.list) || t.list.reduce((s, x) => s + x.amount, 0)) : 'livre'}
              </span>
              {!t.alert && n > 0 && <span className={clsx('absolute right-1.5 top-1.5 size-1.5 rounded-full', on ? 'bg-white' : 'bg-tint')} />}
            </motion.button>
          )
        })}
      </div>

      <div className="mt-4 flex items-baseline justify-between gap-3 px-1">
        <p className="truncate text-[13px] font-semibold">{title}</p>
        <p className="tabular shrink-0 text-[12.5px] text-label-2">{list.length ? `${list.length} ${list.length === 1 ? 'item' : 'itens'} · ${money(list.reduce((s, x) => s + x.amount, 0))}` : 'nada vence'}</p>
      </div>
      <motion.div key={sel} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="-mx-2 mt-1.5">
        {list.length === 0 ? (
          <p className="mx-2 rounded-[14px] bg-fill/50 px-3.5 py-3 text-[12.5px] text-label-2">Nenhuma conta {sel === 'atrasadas' ? 'atrasada' : 'neste dia'}.</p>
        ) : (
          list.slice(0, 5).map((it) => (
            <button key={it.key} onClick={() => openAgenda(it)} className="flex w-full items-center gap-2.5 rounded-[14px] px-2 py-1.5 text-left transition-colors hover:bg-fill/60">
              <span className={clsx('grid size-8 shrink-0 place-items-center rounded-full', it.income ? 'bg-tint/10 text-tint' : 'bg-fill text-label-2')}>
                {it.income ? <ArrowDownLeft className="size-4" /> : 'invoice' in it.source ? <CreditCard className="size-4" /> : <ArrowUpRight className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold">{it.title}</span>
                <span className="block truncate text-[11.5px] text-label-2">
                  {it.detail}
                  {it.status === 'atrasada' && ` · venceu ${ddmm(it.date)}`}
                </span>
              </span>
              <span className={clsx('tabular shrink-0 text-[13.5px] font-semibold', it.status === 'atrasada' ? 'text-red' : it.income && 'text-green')}>
                {it.income ? '+ ' : ''}
                {money(it.amount)}
              </span>
              <span className={clsx('w-16 shrink-0 text-right text-[11px] font-semibold', agendaText[it.status].cls)}>{agendaText[it.status].label || (it.income ? 'A receber' : 'A pagar')}</span>
            </button>
          ))
        )}
        {list.length > 5 && (
          <button onClick={() => (setTxFilter({ ...emptyFilter, status: sel === 'atrasadas' ? 'atrasado' : 'pendente' }), setTab('transactions'))} className="mx-2 mt-1 text-[12.5px] font-semibold text-tint hover:underline">
            Ver os {list.length} itens →
          </button>
        )}
      </motion.div>
    </Card>
  )
}

// ─── Últimos lançamentos ─────────────────────────────────────

function RecentCard({ d }: { d: Data }) {
  const { openTx, setTab } = useUI()
  return (
    <Card icon={ListChecks} title="Últimos lançamentos" action={d.recent.length ? 'Ver todos' : undefined} onAction={() => setTab('transactions')}>
      {d.recent.length === 0 ? (
        <p className="rounded-[16px] bg-fill/50 p-3.5 text-[13px] text-label-2">Receitas, despesas e transferências aparecem aqui conforme você lança. Use os botões do cartão verde ou as teclas D, R e T.</p>
      ) : (
        <div className="-mx-5 -mb-2 [&>*+*]:before:absolute [&>*+*]:before:left-[72px] [&>*+*]:before:right-5 [&>*+*]:before:top-0 [&>*+*]:before:h-px [&>*+*]:before:scale-y-50 [&>*+*]:before:bg-separator [&>*+*]:before:content-['']">
          {d.recent.slice(0, 6).map((t) => (
            <div key={t.id} className="relative px-1">
              <TxRow tx={t} look={d.f.look} showDate onClick={() => openTx(true, { id: t.id })} />
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ─── Fluxo de caixa ──────────────────────────────────────────

const periodText: Record<Period, string> = {
  semana: 'Esta semana',
  mes: 'Dia a dia do mês',
  semestre: 'Últimos 6 meses',
}

function FlowCard({ d }: { d: Data }) {
  const { flow, period, setPeriod } = d
  const kpis: { label: string; value: number; icon: LucideIcon; cls: string; valueCls?: string }[] = [
    { label: 'Entradas', value: flow.income, icon: ArrowDownLeft, cls: 'bg-tint/10 text-tint', valueCls: 'text-green' },
    { label: 'Saídas', value: flow.expense, icon: ArrowUpRight, cls: 'bg-red/10 text-red' },
    { label: 'Balanço', value: flow.balance, icon: Scale, cls: 'bg-fill text-label-2', valueCls: flow.balance < 0 ? 'text-red' : undefined },
  ]
  return (
    <Card
      icon={ArrowLeftRight}
      title="Fluxo de caixa"
      subtitle={`Entradas × saídas · ${periodText[period]} · ${flow.range}`}
      right={
        <div role="tablist" className="flex shrink-0 rounded-full bg-fill p-[3px]">
          {(
            [
              ['semana', 'Semana'],
              ['mes', 'Mês'],
              ['semestre', '6 meses'],
            ] as [Period, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              role="tab"
              aria-selected={period === v}
              onClick={() => setPeriod(v)}
              className={clsx('relative z-0 rounded-full px-3 py-1 text-[12.5px] transition-colors', period === v ? 'font-semibold text-label' : 'font-medium text-label-2 hover:text-label')}
            >
              {period === v && (
                <motion.span
                  layoutId="period-pill"
                  className="absolute inset-0 -z-10 rounded-full bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.1),0_0_0_0.5px_rgba(0,0,0,0.04)] dark:bg-surface-2"
                  transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                />
              )}
              {label}
            </button>
          ))}
        </div>
      }
    >
      <div className="mb-4 grid grid-cols-3 divide-x divide-separator">
        {kpis.map((k, i) => (
          <div key={k.label} className={clsx('flex items-center gap-2.5', i === 0 ? 'pr-3' : 'px-3')}>
            <span className={clsx('grid size-8 shrink-0 place-items-center rounded-full', k.cls)}>
              <k.icon className="size-4" strokeWidth={2.2} />
            </span>
            <span className="min-w-0">
              <Amount value={k.value} cents={false} className={clsx('block whitespace-nowrap text-[16px] font-semibold tracking-[-0.01em]', k.valueCls)} />
              <span className="block text-[11.5px] text-label-2">{k.label}</span>
            </span>
          </div>
        ))}
      </div>
      <CashFlowChart data={flow.data} tall />
      <FlowLegend balance={flow.data.length <= 12} />
    </Card>
  )
}

// ─── Despesas por categoria ──────────────────────────────────

function CategoriesCard({ d }: { d: Data }) {
  const { spending } = d
  const { setTab, openCategory } = useUI()
  const top = spending.sorted.slice(0, 6)
  return (
    <Card icon={PieChart} title="Despesas por categoria" subtitle="Para onde foi o dinheiro este mês" action="Relatório" onAction={() => setTab('reports')}>
      {spending.total === 0 ? (
        <p className="rounded-[16px] bg-fill/50 p-3.5 text-[13px] text-label-2">Quando você lançar despesas, o gráfico mostra quais categorias mais pesam no mês.</p>
      ) : (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-5">
          <div className="w-[220px]">
            <Donut
              slices={[
                ...spending.sorted.slice(0, 5).map((x) => ({ label: x.cat.name, value: x.value, color: x.cat.color })),
                ...(spending.sorted.length > 5 || spending.uncategorized ? [{ label: 'Outras', value: spending.sorted.slice(5).reduce((s, x) => s + x.value, 0) + spending.uncategorized, color: 'var(--label-3)' }] : []),
              ]}
              center={money(spending.total).replace(/,\d{2}$/, '')}
              caption="no mês"
            />
          </div>
          <div className="space-y-2.5">
            {top.map((x) => (
              <button key={x.cat.id} onClick={() => openCategory(true, { id: x.cat.id })} className="flex w-full items-center gap-2.5 text-left">
                <CategoryIcon category={x.cat} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="truncate font-semibold">{x.cat.name}</span>
                    <span className="tabular shrink-0 font-semibold">{money(x.value)}</span>
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill">
                      <motion.span className="block h-full rounded-full" style={{ background: x.cat.color }} initial={{ width: 0 }} animate={{ width: `${(x.value / spending.total) * 100}%` }} transition={{ duration: 0.9, ease: 'easeOut' }} />
                    </span>
                    <span className="tabular w-9 shrink-0 text-right text-[11px] text-label-2">{Math.round((x.value / spending.total) * 100)}%</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── Limites de gastos ───────────────────────────────────────

function BudgetCard({ d }: { d: Data }) {
  const { month, spending } = d
  const { setTab, openCategory } = useUI()
  if (!month.limit && !spending.budgets.length)
    return (
      <Card icon={Target} title="Limites de gastos" action="Planejar" onAction={() => setTab('budget')}>
        <button onClick={() => setTab('budget')} className="flex h-10 w-full items-center gap-2.5 rounded-[14px] bg-fill/50 px-3.5 text-[13px] text-label-2 transition-colors hover:bg-fill">
          <Info className="size-4" />
          <span className="flex-1 text-left">Defina quanto quer gastar por categoria e receba avisos antes de estourar</span>
          <ChevronRight className="size-4" />
        </button>
      </Card>
    )
  return (
    <Card icon={Target} title="Limites de gastos" subtitle={month.tone ? `${budgetLabel[month.tone]} · ${Math.round(month.ratio * 100)}% do limite geral` : undefined} action="Orçamento" onAction={() => setTab('budget')}>
      {month.limit > 0 && month.tone && (
        <div className="mb-3 rounded-[16px] bg-fill/50 p-3.5">
          <div className="mb-2 flex items-center justify-between text-[12.5px]">
            <span className="text-label-2">Limite geral do mês</span>
            <span className={clsx('tabular font-semibold', toneText[month.tone])}>{Math.round(month.ratio * 100)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-fill">
            <motion.div className={clsx('h-full rounded-full', toneBar[month.tone])} initial={{ width: 0 }} animate={{ width: `${Math.min(100, month.ratio * 100)}%` }} transition={{ duration: 1, ease: 'easeOut' }} />
          </div>
          <p className="tabular mt-1.5 text-[12px] text-label-2">
            {money(month.spent)} de {money(month.limit)} · {month.ratio <= 1 ? `você ainda pode gastar ${money(month.limit - month.spent)}` : `passou ${money(month.spent - month.limit)}`}
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        {spending.budgets.slice(0, 4).map((b) => (
          <button key={b.cat.id} onClick={() => openCategory(true, { id: b.cat.id })} className="flex min-w-0 items-start gap-2.5 rounded-[16px] bg-fill/50 p-3 text-left transition-colors hover:bg-fill">
            <CategoryIcon category={b.cat} size={30} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2 text-[13px]">
                <span className="truncate font-semibold">{b.cat.name}</span>
                <span className={clsx('tabular shrink-0 text-[12px] font-semibold', toneText[b.tone])}>{Math.round(b.ratio * 100)}%</span>
              </span>
              <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-fill">
                <motion.span className={clsx('block h-full rounded-full', toneBar[b.tone])} initial={{ width: 0 }} animate={{ width: `${Math.min(100, b.ratio * 100)}%` }} transition={{ duration: 0.9, ease: 'easeOut' }} />
              </span>
              <span className="tabular mt-1 block truncate text-[11.5px] text-label-2">
                {money(b.spent)} de {money(b.limit)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </Card>
  )
}

// ─── Metas e cartões ─────────────────────────────────────────

function GoalsCard({ d }: { d: Data }) {
  const { setTab, openGoal } = useUI()
  const saved = d.goals.reduce((s, g) => s + g.stats.saved, 0)
  return (
    <Card icon={PiggyBank} title="Minhas metas" subtitle={d.goals.length ? `${money(saved)} guardados` : undefined} action={d.goals.length ? 'Ver metas' : 'Criar meta'} onAction={() => (d.goals.length ? setTab('goals') : openGoal(true))}>
      {d.goals.length === 0 ? (
        <p className="rounded-[16px] bg-fill/50 p-3.5 text-[13px] text-label-2">Reserva de emergência, viagem, carro novo: crie uma meta e veja quando você chega lá.</p>
      ) : (
        <div className="space-y-3">
          {d.goals.slice(0, 3).map(({ goal, stats }) => (
            <button key={goal.id} onClick={() => openGoal(true, goal.id)} className="flex w-full items-center gap-3 text-left">
              <CategoryIcon category={goal} size={36} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2 text-[13.5px]">
                  <span className="truncate font-semibold">{goal.name}</span>
                  <span className="tabular shrink-0 text-[12px] text-label-2">
                    {money(stats.saved)} de {money(goal.target)}
                  </span>
                </span>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-fill">
                  <motion.span className="block h-full rounded-full" style={{ background: goal.color }} initial={{ width: 0 }} animate={{ width: `${Math.min(100, stats.ratio * 100)}%` }} transition={{ duration: 0.9, ease: 'easeOut' }} />
                </span>
                <span className="mt-1 block truncate text-[11.5px] text-label-2">
                  {Math.round(stats.ratio * 100)}% · {stats.forecast ? `previsão ${new Date(`${stats.forecast}-15`).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '')}` : 'sem aportes recentes'}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Card>
  )
}

function CardsCard({ d }: { d: Data }) {
  const { openCard, setTab } = useUI()
  if (!d.invoices.length) return null
  return (
    <Card icon={CreditCard} title="Faturas dos cartões" action="Cartões" onAction={() => setTab('accounts')}>
      <div className="-mx-2">
        {d.invoices.map((inv) => (
          <button key={inv.card.id} onClick={() => openCard(true, inv.card.id, inv.key)} className="flex w-full items-center gap-2.5 rounded-[14px] px-2 py-2 text-left transition-colors hover:bg-fill/60">
            <CardThumb card={inv.card} width={44} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold">{inv.card.name}</span>
              <span className="block truncate text-[12px] text-label-2">
                {invoiceStatusLabel[inv.status]} · fecha {ddmm(inv.closing)} · vence {ddmm(inv.due)}
              </span>
            </span>
            <span className="tabular shrink-0 text-[14px] font-semibold">{money(inv.total)}</span>
          </button>
        ))}
      </div>
    </Card>
  )
}

// ─── Tela ────────────────────────────────────────────────────

export default function HomeDesktop() {
  const d = useHomeData()
  const { setTab, setSearchFocus, openInbox, openSettings, refreshDay } = useUI()
  const unread = useNotices((s) => s.items.reduce((n, i) => n + (i.read ? 0 : 1), 0))
  const [updatedAt, setUpdatedAt] = useState(() => new Date())
  const [spin, setSpin] = useState(0)
  const owner = d.settings.owner.trim()
  const first = owner.split(' ')[0]
  const late = useMemo(() => d.due.filter((x) => x.status === 'atrasada'), [d.due])

  return (
    <div className="no-scrollbar h-full overflow-y-auto overflow-x-hidden">
      <div className="relative">
        {/* topo verde do app, que desce atrás dos primeiros cartões */}
        <div className="band pointer-events-none absolute inset-x-0 top-0 h-[212px] overflow-hidden">
          <div className="absolute -right-20 -top-24 size-80 rounded-full bg-white/[0.04]" />
          <div className="absolute right-64 top-28 size-48 rounded-full bg-white/[0.03]" />
        </div>
        <div className="band-corner pointer-events-none absolute left-0 top-[212px] size-8" />

        <div className="relative mx-auto max-w-[1200px] px-8 pb-10 pt-6">
          <header className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-white/60">{longDate()}</p>
              <h1 className="font-display truncate text-[24px] font-bold leading-tight tracking-[-0.03em] text-white">
                {greeting()}
                {first ? `, ${first}` : ''}
              </h1>
              <p className="text-[13.5px] text-white/60">Aqui está o resumo das suas finanças.</p>
            </div>
            <button
              onClick={() => (setSearchFocus(true), setTab('transactions'))}
              title="Buscar"
              className="flex h-10 w-[300px] shrink items-center gap-2.5 rounded-full bg-white/[0.07] px-4 text-left text-[13px] text-white/60 ring-1 ring-white/15 transition-colors hover:bg-white/[0.12]"
            >
              <Search className="size-4 shrink-0 text-white/80" />
              <span className="flex-1 truncate">Buscar lançamento, valor…</span>
              <kbd className="grid h-5 place-items-center rounded-md bg-white/10 px-1.5 font-sans text-[11px] font-semibold text-white/70">{mac ? '⌘K' : 'Ctrl K'}</kbd>
            </button>
            <button
              onClick={() => openInbox(true)}
              aria-label={unread ? `Notificações, ${unread} não lidas` : 'Notificações'}
              title="Notificações"
              className="relative grid size-10 shrink-0 place-items-center rounded-full bg-white/[0.07] text-white ring-1 ring-white/15 transition-colors hover:bg-white/[0.12]"
            >
              <Bell className="size-[18px]" />
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-red px-1 text-[11px] font-semibold text-white ring-2 ring-[#0f3b2c]">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
            <button
              onClick={() => openSettings(true, 'perfil')}
              title="Perfil"
              className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-white/10 text-[13px] font-semibold text-white ring-1 ring-white/20"
            >
              {d.settings.photo ? <img src={d.settings.photo} alt="" className="size-full object-cover" /> : owner ? initials(owner) : 'JP'}
            </button>
          </header>

          <div className="mt-6 space-y-5">
            <Kpis d={d} />
            <div className="flex items-center justify-between px-2 text-[12px] text-label-2">
              <span className="flex items-center gap-1.5">
                <Clock className="size-3.5" />
                Atualizado hoje às {String(updatedAt.getHours()).padStart(2, '0')}h{String(updatedAt.getMinutes()).padStart(2, '0')}
                {late.length > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 font-semibold text-red">
                    <AlertTriangle className="size-3.5" /> {late.length} {late.length === 1 ? 'conta atrasada' : 'contas atrasadas'}
                  </span>
                )}
              </span>
              <motion.button
                aria-label="Atualizar"
                title="Atualizar"
                animate={{ rotate: spin * 360 }}
                transition={{ duration: 0.6 }}
                onClick={() => (refreshDay(), setSpin((s) => s + 1), setUpdatedAt(new Date()))}
                className="grid size-7 place-items-center rounded-full hover:bg-fill"
              >
                <RefreshCw className="size-[15px]" />
              </motion.button>
            </div>
            <OnboardingCard />
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] xl:items-start">
              <div className="min-w-0 space-y-5">
                <BalanceCard d={d} />
                <AgendaCard d={d} />
                <RecentCard d={d} />
              </div>
              <div className="min-w-0 space-y-5">
                <FlowCard d={d} />
                <CategoriesCard d={d} />
                <BudgetCard d={d} />
                <GoalsCard d={d} />
                <CardsCard d={d} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
