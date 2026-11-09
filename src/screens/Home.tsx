import { useState } from 'react'
import { motion } from 'motion/react'
import { AlertTriangle, ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, Bell, CalendarClock, CalendarDays, Clock, CreditCard, Eye, EyeOff, Minus, Plus, RefreshCw, Search, Settings2, Target, TrendingDown, TrendingUp } from 'lucide-react'
import clsx from 'clsx'
import { relDay } from '../lib/dates'
import { isPrivate, money } from '../lib/format'
import { budgetLabel } from '../lib/ledger'
import { emptyFilter, useData, useUI } from '../lib/store'
import { haptic } from '../lib/haptics'
import { useNotices } from '../lib/notify'
import { useDesktop } from '../lib/media'
import { CashFlowChart, Donut, FlowLegend } from '../components/charts'
import { CategoryIcon, TxRow, agendaText, openAgenda } from '../components/finance'
import { Empty, Progress, Row, Section, SectionHeader, Segmented, initials, spring } from '../components/ui'
import { ddmm, greeting, savingsPct, useHomeData, type HomeData } from './homeData'
import HomeDesktop from './HomeDesktop'

/** Tela inicial: no computador, painel no estilo dashboard; no celular, o layout de sempre. */
export default function Home() {
  return useDesktop() ? <HomeDesktop /> : <HomeMobile />
}

/** Variação contra o mês passado, no mesmo ponto do mês. `good` = subir é bom. */
export function Trend({ now, prev, label, good = true, light }: { now: number; prev: number; label: string; good?: boolean; light?: boolean }) {
  if (prev <= 0 || isPrivate()) return null
  const pct = (now - prev) / prev
  const up = pct >= 0
  const ok = up === good
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
        light ? (ok ? 'bg-white/15 text-[#bbf7d0]' : 'bg-red/25 text-[#fecaca]') : ok ? 'bg-tint/10 text-tint' : 'bg-red/10 text-red',
      )}
    >
      <Icon className="size-3" strokeWidth={2.5} />
      {Math.abs(Math.round(pct * 100))}% vs {label}
    </span>
  )
}

const toneText = { green: 'text-green', orange: 'text-orange', red: 'text-red' } as const

function HomeMobile() {
  const d = useHomeData()
  const { f, settings, month, counts, forecast, end, due, period, setPeriod, flow, spending, goals, recent } = d
  const { setTab, openSettings, setSearchFocus, openInbox, refreshDay, openTx, setTxFilter, openGoal, openCategory } = useUI()
  const unread = useNotices((s) => s.items.reduce((n, i) => n + (i.read ? 0 : 1), 0))
  const setSettings = useData((s) => s.setSettings)
  const [updatedAt, setUpdatedAt] = useState(() => new Date())
  const [spin, setSpin] = useState(0)
  const owner = settings.owner.trim()
  const showType = (type: 'receita' | 'despesa') => (haptic(), setTxFilter({ ...emptyFilter, type }), setTab('transactions'))

  const tiles: { label: string; value: string; icon: typeof Clock; alert?: boolean; onClick: () => void }[] = [
    { label: 'Hoje', value: String(counts.hoje), icon: CalendarClock, onClick: () => (setTxFilter({ ...emptyFilter, status: 'pendente' }), setTab('transactions')) },
    { label: 'Atrasadas', value: String(counts.atrasadas), icon: AlertTriangle, alert: counts.atrasadas > 0, onClick: () => (setTxFilter({ ...emptyFilter, status: 'atrasado' }), setTab('transactions')) },
    { label: '7 dias', value: String(counts.semana), icon: CalendarDays, onClick: () => (setTxFilter({ ...emptyFilter, status: 'pendente' }), setTab('transactions')) },
    { label: 'Faturas', value: String(d.invoices.filter((i) => i.open > 0).length), icon: CreditCard, onClick: () => setTab('accounts') },
  ]

  return (
    <div className="no-scrollbar h-full overflow-y-auto overflow-x-hidden">
      {/* ─── Topo verde: termina no meio do cartão, que "flutua" sobre ele ─── */}
      <div className="relative">
        <div className="grad-green pointer-events-none absolute inset-x-0 top-0 h-[calc(var(--sat)+270px)] overflow-hidden rounded-b-[32px]">
          <div className="absolute -left-24 top-24 size-72 rounded-full bg-white/[0.04]" />
          <div className="absolute -right-20 -top-16 size-64 rounded-full bg-white/[0.05]" />
          <div className="absolute right-10 top-40 size-40 rounded-full bg-white/[0.03]" />
        </div>

        <div className="pt-safe relative mx-auto max-w-xl px-5 pb-40">
          <div className="flex items-center gap-2.5 pt-3">
            <button onClick={() => (haptic(), openSettings(true, 'perfil'))} aria-label="Perfil" className="shrink-0">
              <span className="grid size-11 place-items-center overflow-hidden rounded-full bg-white/10 text-[13px] font-semibold text-white ring-1 ring-white/15">
                {settings.photo ? <img src={settings.photo} alt="" className="size-full object-cover" /> : owner ? initials(owner) : 'JP'}
              </span>
            </button>
            <button
              onClick={() => (haptic(), setSearchFocus(true), setTab('transactions'))}
              className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-white/[0.07] px-4 text-left text-[14px] text-white/60 ring-1 ring-white/15"
            >
              <Search className="size-[18px] shrink-0 text-white/80" />
              <span className="truncate">Buscar lançamento, valor…</span>
            </button>
            <button
              aria-label="Configurações"
              onClick={() => (haptic(), openSettings(true))}
              className="grid size-11 shrink-0 place-items-center rounded-full bg-white/[0.07] text-white ring-1 ring-white/15"
            >
              <Settings2 className="size-[18px]" />
            </button>
            <button
              aria-label={unread ? `Notificações, ${unread} não lidas` : 'Notificações'}
              onClick={() => (haptic(), openInbox(true))}
              className="relative grid size-11 shrink-0 place-items-center rounded-full bg-white/[0.07] text-white ring-1 ring-white/15"
            >
              <Bell className="size-[18px]" />
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-red px-1 text-[11px] font-semibold text-white ring-2 ring-[#0f3b2c]">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
          </div>

          <p className="mt-5 text-[14px] text-white/60">
            {greeting()}
            {owner ? `, ${owner.split(' ')[0]}` : ''}
          </p>

          {/* ─── Saldo atual ─── */}
          <section>
            <div className="mb-3 mt-0.5 flex items-center justify-between gap-3">
              <h1 className="truncate text-[20px] font-semibold tracking-[-0.03em] text-white min-[380px]:text-[22px]">Saldo atual</h1>
              <motion.button
                whileTap={{ scale: 0.94 }}
                onClick={() => (haptic('medium'), setTab('accounts'))}
                className="flex shrink-0 items-center gap-1 rounded-full bg-white py-1.5 pl-2.5 pr-2.5 text-[12px] font-semibold text-[#0f3b2c] shadow-[0_4px_14px_rgba(0,0,0,0.15)]"
              >
                {f.accounts.filter((a) => !a.archived).length} {f.accounts.filter((a) => !a.archived).length === 1 ? 'conta' : 'contas'}
                <ArrowRight className="size-3.5 opacity-60" />
              </motion.button>
            </div>

            <motion.div layout transition={spring} className="rounded-[22px] bg-surface p-4 shadow-[0_1px_2px_rgba(15,21,18,0.06),0_14px_32px_-16px_rgba(15,21,18,0.22)]">
              <div className="flex items-center gap-1">
                <p className="text-[12px] text-label-2">Disponível nas contas</p>
                <button
                  aria-label={settings.privacy ? 'Mostrar valores' : 'Esconder valores'}
                  onClick={() => (haptic(), setSettings({ privacy: !settings.privacy }))}
                  className="-m-1.5 grid size-7 place-items-center rounded-full text-label-2 active:bg-fill"
                >
                  {settings.privacy ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
              <p className={clsx('tabular truncate text-[30px] font-semibold leading-tight tracking-[-0.03em]', f.total < 0 && 'text-red')}>{money(f.total)}</p>
              <p className="tabular truncate text-[12px] text-label-2">
                Previsto até {ddmm(end)}: <span className={clsx('font-semibold', forecast < 0 ? 'text-red' : 'text-label')}>{money(forecast)}</span>
              </p>

              {/* receitas e despesas do mês */}
              <div className="mt-4 grid grid-cols-2 gap-3 rounded-[16px] bg-fill/60 p-3">
                <button onClick={() => showType('receita')} className="min-w-0 text-left">
                  <p className="flex items-center gap-1 text-[11px] text-label-2">
                    <ArrowDownLeft className="size-3.5 text-green" /> Receitas do mês
                  </p>
                  <p className="tabular truncate text-[17px] font-semibold leading-tight tracking-[-0.02em] text-green">{money(month.now.income)}</p>
                  <p className="tabular truncate text-[11px] text-label-2">{month.now.incomePending > 0 ? `${money(month.now.incomePending)} a receber` : 'tudo recebido'}</p>
                </button>
                <button onClick={() => showType('despesa')} className="min-w-0 border-l border-separator pl-3 text-left">
                  <p className="flex items-center gap-1 text-[11px] text-label-2">
                    <ArrowUpRight className="size-3.5 text-red" /> Despesas do mês
                  </p>
                  <p className="tabular truncate text-[17px] font-semibold leading-tight tracking-[-0.02em]">{money(month.now.expense)}</p>
                  <p className="tabular truncate text-[11px] text-label-2">{month.now.expensePending > 0 ? `${money(month.now.expensePending)} a pagar` : 'tudo pago'}</p>
                </button>
              </div>

              {/* ações rápidas */}
              <div className="mt-4 grid grid-cols-[1fr_1fr_auto] gap-2">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => (haptic('medium'), openTx(true, { type: 'receita' }))}
                  className="grad-btn flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-full px-3 text-[14px] font-semibold text-white"
                >
                  <Plus className="size-[18px] shrink-0" strokeWidth={2.4} /> Receita
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => (haptic('medium'), openTx(true, { type: 'despesa' }))}
                  className="flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-full bg-red/10 px-3 text-[14px] font-semibold text-red"
                >
                  <Minus className="size-[18px] shrink-0" strokeWidth={2.4} /> Despesa
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  aria-label="Transferência entre contas"
                  onClick={() => (haptic(), openTx(true, { type: 'transferencia' }))}
                  className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-fill px-4 text-[14px] font-semibold text-label"
                >
                  <ArrowLeftRight className="size-[18px]" />
                  <span className="hidden min-[400px]:inline">Transferir</span>
                </motion.button>
              </div>
            </motion.div>

            <div className="mt-3 flex items-center justify-between px-1 text-[13px] text-label-2">
              <span className="flex items-center gap-1.5">
                <Clock className="size-4" />
                Atualizado hoje às {String(updatedAt.getHours()).padStart(2, '0')}h{String(updatedAt.getMinutes()).padStart(2, '0')}
              </span>
              <motion.button
                aria-label="Atualizar"
                animate={{ rotate: spin * 360 }}
                transition={{ duration: 0.6 }}
                onClick={() => (haptic(), refreshDay(), setSpin((s) => s + 1), setUpdatedAt(new Date()))}
                className="grid size-8 place-items-center rounded-full"
              >
                <RefreshCw className="size-[18px]" />
              </motion.button>
            </div>
          </section>

          {/* ─── Resumo do mês ─── */}
          <section className="mt-5">
            <SectionHeader action="Relatórios →" onAction={() => setTab('reports')}>
              Resumo do mês
            </SectionHeader>
            <div className="mb-6 grid grid-cols-2 gap-3">
              <MonthTile label="Receitas" value={money(month.now.income)} tone="green" hint={<Trend now={month.toDate.income} prev={month.before.income} label={month.label} />} fallback="recebido + a receber" onClick={() => showType('receita')} />
              <MonthTile
                label="Despesas"
                value={money(month.now.expense)}
                hint={month.tone && <span className={clsx('text-[11px] font-semibold', toneText[month.tone])}>{budgetLabel[month.tone]} · {Math.round(month.ratio * 100)}% do limite</span>}
                fallback={<Trend now={month.toDate.expense} prev={month.before.expense} label={month.label} good={false} />}
                onClick={() => showType('despesa')}
              />
              <MonthTile
                label="Balanço"
                value={money(month.now.balance)}
                tone={month.now.balance < 0 ? 'red' : 'green'}
                hint={month.savings === null ? undefined : month.savings >= 0 ? `economia de ${savingsPct(month.savings)}` : `${savingsPct(-month.savings)} acima das receitas`}
                fallback="receitas − despesas"
              />
              <MonthTile label="A pagar no mês" value={money(counts.pagar)} hint={counts.atrasadas ? <span className="text-[11px] font-semibold text-red">{counts.atrasadas} atrasada{counts.atrasadas > 1 ? 's' : ''}</span> : undefined} fallback="contas, parcelas e faturas" onClick={() => (setTxFilter({ ...emptyFilter, status: 'pendente' }), setTab('transactions'))} />
            </div>
            {settings.goal > 0 && (
              <button onClick={() => openSettings(true, 'meta')} className="-mt-3 mb-6 block w-full rounded-[22px] bg-surface p-4 text-left shadow-card">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[13px] text-label-2">
                    <Target className="size-4" /> Meta de economia do mês
                  </span>
                  <span className="tabular text-[13px] font-semibold">{Math.max(0, Math.min(999, Math.round((month.now.balance / settings.goal) * 100)))}%</span>
                </div>
                <Progress value={month.now.balance / settings.goal} />
                <p className="tabular mt-2 text-[12px] text-label-2">
                  {money(Math.max(0, month.now.balance))} de {money(settings.goal)}
                  {month.now.balance < settings.goal ? ` · faltam ${money(settings.goal - Math.max(0, month.now.balance))}` : ' · meta batida ✓'}
                </p>
              </button>
            )}
          </section>

          {/* ─── Contas a pagar e receber ─── */}
          <section>
            <div className="mb-3 flex items-end justify-between px-1">
              <h2 className="text-[20px] font-semibold tracking-[-0.02em]">A pagar e receber</h2>
              <button onClick={() => (haptic(), setTxFilter({ ...emptyFilter, status: 'pendente' }), setTab('transactions'))} className="flex items-center gap-1 text-[14px] font-semibold text-tint">
                Ver pendentes <ArrowRight className="size-4" />
              </button>
            </div>
            <div className="mb-3 grid grid-cols-4 gap-2.5">
              {tiles.map((t) => (
                <motion.button
                  key={t.label}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => (haptic(), t.onClick())}
                  className="flex h-[104px] flex-col items-center justify-center rounded-[20px] bg-surface px-1 text-center shadow-card"
                >
                  <span className={clsx('grid size-8 place-items-center rounded-full', t.alert ? 'bg-red/10 text-red' : 'bg-fill text-label-2')}>
                    <t.icon className="size-4" strokeWidth={2} />
                  </span>
                  <span className={clsx('tabular mt-2 text-[20px] font-semibold leading-none tracking-[-0.02em]', t.alert ? 'text-red' : 'text-label')}>{t.value}</span>
                  <span className="mt-1.5 w-full truncate text-[11px] leading-none text-label-2">{t.label}</span>
                </motion.button>
              ))}
            </div>
            <Section>
              {due.length === 0 ? (
                <Empty icon={<CalendarClock className="size-9" strokeWidth={1.5} />} title="Nada para pagar" text="Contas pendentes, parcelas e faturas aparecem aqui." />
              ) : (
                due.slice(0, 5).map((it) => (
                  <Row
                    key={it.key}
                    icon={it.income ? <ArrowDownLeft className="size-[18px] text-green" /> : 'invoice' in it.source ? <CreditCard className="size-[18px]" /> : <ArrowUpRight className="size-[18px]" />}
                    label={it.title}
                    detail={`${it.detail} · ${relDay(it.date)}`}
                    value={
                      <span className="flex flex-col items-end">
                        <span className={clsx(it.income && 'text-green')}>{money(it.amount)}</span>
                        <span className={`text-[11px] font-semibold ${agendaText[it.status].cls}`}>{agendaText[it.status].label || (it.income ? 'A receber' : 'A pagar')}</span>
                      </span>
                    }
                    onClick={() => openAgenda(it)}
                  />
                ))
              )}
            </Section>
          </section>

          {/* ─── Fluxo de caixa ─── */}
          <section>
            <div className="mb-6 rounded-[24px] bg-surface p-4 shadow-card">
              <Segmented
                value={period}
                onChange={setPeriod}
                options={[
                  { value: 'semana', label: 'Semana' },
                  { value: 'mes', label: 'Mês' },
                  { value: 'semestre', label: '6 meses' },
                ]}
              />
              <div className="mb-4 px-1">
                <p className="text-[15px] font-semibold">Fluxo de caixa</p>
                <p className="tabular text-[12px] text-label-2">Entradas × saídas · {flow.range}</p>
              </div>
              <div className="mb-4 grid grid-cols-3 divide-x divide-separator">
                <div className="pr-3">
                  <p className="tabular truncate text-[17px] font-semibold text-green">{money(flow.income).replace(/,\d{2}$/, '')}</p>
                  <p className="text-[11px] text-label-2">entradas</p>
                </div>
                <div className="px-3">
                  <p className="tabular truncate text-[17px] font-semibold">{money(flow.expense).replace(/,\d{2}$/, '')}</p>
                  <p className="text-[11px] text-label-2">saídas</p>
                </div>
                <div className="pl-3">
                  <p className={clsx('tabular truncate text-[17px] font-semibold', flow.balance < 0 && 'text-red')}>{money(flow.balance).replace(/,\d{2}$/, '')}</p>
                  <p className="text-[11px] text-label-2">balanço</p>
                </div>
              </div>
              <CashFlowChart data={flow.data} />
              <FlowLegend />
            </div>
          </section>

          {/* ─── Despesas por categoria ─── */}
          <section>
            <SectionHeader action="Ver relatório" onAction={() => setTab('reports')}>
              Despesas por categoria
            </SectionHeader>
            <div className="mb-6 rounded-[22px] bg-surface p-4 shadow-card">
              {spending.total > 0 ? (
                <Donut
                  slices={[
                    ...spending.sorted.slice(0, 5).map((x) => ({ label: x.cat.name, value: x.value, color: x.cat.color })),
                    ...(spending.sorted.length > 5 || spending.uncategorized
                      ? [{ label: 'Outras', value: spending.sorted.slice(5).reduce((s, x) => s + x.value, 0) + spending.uncategorized, color: 'var(--label-3)' }]
                      : []),
                  ]}
                  center={money(spending.total).replace(/,\d{2}$/, '')}
                  caption="no mês"
                />
              ) : (
                <p className="py-4 text-center text-[13px] text-label-2">As despesas do mês aparecem aqui, separadas por categoria.</p>
              )}
            </div>
          </section>

          {/* ─── Limites de gastos ─── */}
          <section>
            <SectionHeader action="Orçamento →" onAction={() => setTab('budget')}>
              Limites de gastos
            </SectionHeader>
            {month.limit > 0 || spending.budgets.length ? (
              <Section>
                {month.limit > 0 && month.tone && (
                  <div className="relative px-4 py-3.5">
                    <div className="mb-2 flex items-center justify-between text-[13px]">
                      <span className="font-semibold">Limite geral</span>
                      <span className={clsx('font-semibold', toneText[month.tone])}>{budgetLabel[month.tone]}</span>
                    </div>
                    <Progress value={month.ratio} tone={month.tone} />
                    <p className="tabular mt-1.5 text-[12px] text-label-2">
                      {money(month.spent)} de {money(month.limit)} · {month.ratio <= 1 ? `restam ${money(month.limit - month.spent)}` : `passou ${money(month.spent - month.limit)}`}
                    </p>
                  </div>
                )}
                {spending.budgets.slice(0, 4).map((b) => (
                  <button key={b.cat.id} onClick={() => (haptic(), openCategory(true, { id: b.cat.id }))} className="relative flex w-full items-center gap-3 px-4 py-3 text-left">
                    <CategoryIcon category={b.cat} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2 text-[14px]">
                        <span className="truncate font-semibold">{b.cat.name}</span>
                        <span className={clsx('tabular shrink-0 text-[12px] font-semibold', toneText[b.tone])}>{Math.round(b.ratio * 100)}%</span>
                      </span>
                      <Progress value={b.ratio} tone={b.tone} className="mt-1.5" />
                      <span className="tabular mt-1 block truncate text-[11px] text-label-2">
                        {money(b.spent)} de {money(b.limit)}
                      </span>
                    </span>
                  </button>
                ))}
              </Section>
            ) : (
              <button onClick={() => setTab('budget')} className="mb-6 flex w-full items-center gap-2 rounded-[22px] border border-dashed border-separator px-4 py-3 text-[13px] text-label-2">
                <Target className="size-4" /> Definir quanto quer gastar por categoria
              </button>
            )}
          </section>

          {/* ─── Metas ─── */}
          {goals.length > 0 && (
            <section>
              <Section header="Minhas metas" action="Ver todas" onAction={() => setTab('goals')}>
                {goals.slice(0, 3).map(({ goal, stats }) => (
                  <button key={goal.id} onClick={() => (haptic(), openGoal(true, goal.id))} className="relative flex w-full items-center gap-3 px-4 py-3 text-left">
                    <CategoryIcon category={goal} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2 text-[14px]">
                        <span className="truncate font-semibold">{goal.name}</span>
                        <span className="tabular shrink-0 text-[12px] font-semibold text-label-2">{Math.round(stats.ratio * 100)}%</span>
                      </span>
                      <Progress value={stats.ratio} className="mt-1.5" />
                      <span className="tabular mt-1 block truncate text-[11px] text-label-2">
                        {money(stats.saved)} de {money(goal.target)}
                      </span>
                    </span>
                  </button>
                ))}
              </Section>
            </section>
          )}

          {/* ─── Últimos lançamentos ─── */}
          <section>
            <Section header="Últimos lançamentos" action="Ver todos" onAction={() => setTab('transactions')}>
              {recent.length === 0 ? (
                <Empty art="categorias" title="Nenhum lançamento ainda" text="Toque no + para registrar a primeira receita ou despesa." />
              ) : (
                recent.slice(0, 5).map((t) => <TxRow key={t.id} tx={t} look={f.look} showDate onClick={() => openTx(true, { id: t.id })} />)
              )}
            </Section>
          </section>
        </div>
      </div>
    </div>
  )
}

/** Cartão pequeno do resumo do mês (grade 2×2). */
function MonthTile({ label, value, hint, fallback, tone, onClick }: { label: string; value: string; hint?: React.ReactNode; fallback?: React.ReactNode; tone?: 'green' | 'red'; onClick?: () => void }) {
  const Comp = onClick ? motion.button : motion.div
  return (
    <Comp whileTap={onClick ? { scale: 0.97 } : undefined} onClick={onClick ? () => (haptic(), onClick()) : undefined} className="min-w-0 rounded-[22px] bg-surface p-4 text-left shadow-card">
      <p className="text-[12px] font-medium text-label-2">{label}</p>
      <p className={clsx('tabular mt-1 truncate text-[17px] font-semibold tracking-[-0.02em]', tone === 'green' && 'text-green', tone === 'red' && 'text-red')}>{value}</p>
      <div className="mt-0.5 truncate text-[11px] font-medium text-label-2">{hint || fallback}</div>
    </Comp>
  )
}

export type { HomeData }
