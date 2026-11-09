import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { BarChart3, ChevronDown, Download, FileDown, SlidersHorizontal, X } from 'lucide-react'
import clsx from 'clsx'
import { addDays, diffDays, fmtDate, monthKey, monthLabel, shiftMonth, shortMonth } from '../lib/dates'
import { money, percent } from '../lib/format'
import { cashDate, monthRange, paidInvoices, rootOf, settled, type CatType, type Category, type Transaction } from '../lib/ledger'
import { palette } from '../lib/categories'
import { exportCsv, exportPdf, type ReportLookups } from '../lib/report'
import { useUI } from '../lib/store'
import { useDesktop } from '../lib/media'
import { haptic } from '../lib/haptics'
import { CashFlowChart, Donut, FlowLegend, type FlowPoint } from '../components/charts'
import { CategoryIcon, TxRow, useFinance } from '../components/finance'
import { Table, toast } from '../components/sheet'
import { Button, Chips, Empty, Screen, Section, Segmented, SelectField, StatCard, TextField } from '../components/ui'

type Period = 'mes' | 'passado' | '3m' | '6m' | 'ano' | 'custom'
type TypeFilter = 'todos' | CatType
type StatusFilter = 'todos' | 'pago' | 'pendente'

const periodLabel: Record<Period, string> = { mes: 'Este mês', passado: 'Mês passado', '3m': '3 meses', '6m': '6 meses', ano: 'Este ano', custom: 'Personalizado' }

const NO_CAT = { name: 'Sem categoria', color: '#94a3b8', icon: 'outros' }
const PAGE = 60
const count = (n: number) => `${n} ${n === 1 ? 'lançamento' : 'lançamentos'}`

/** Começo e fim do período escolhido. */
function rangeOf(period: Period, ref: string, custom: { from: string; to: string }) {
  const m = monthKey(ref)
  switch (period) {
    case 'mes':
      return monthRange(m)
    case 'passado':
      return monthRange(shiftMonth(m, -1))
    case '3m':
      return { from: `${shiftMonth(m, -2)}-01`, to: monthRange(m).to }
    case '6m':
      return { from: `${shiftMonth(m, -5)}-01`, to: monthRange(m).to }
    case 'ano':
      return { from: `${ref.slice(0, 4)}-01-01`, to: `${ref.slice(0, 4)}-12-31` }
    case 'custom':
      return custom.from <= custom.to ? custom : { from: custom.to, to: custom.from }
  }
}

/** Meses (AAAA-MM) entre duas datas, inclusive. */
const monthsBetween = (from: string, to: string) => {
  const out: string[] = []
  for (let m = monthKey(from); m <= monthKey(to); m = shiftMonth(m, 1)) out.push(m)
  return out
}

export default function Reports() {
  const f = useFinance()
  const openTx = useUI((s) => s.openTx)
  const desktop = useDesktop()

  const [period, setPeriod] = useState<Period>('mes')
  const [custom, setCustom] = useState(() => monthRange(monthKey(f.ref)))
  const [type, setType] = useState<TypeFilter>('todos')
  const [categoryId, setCategoryId] = useState('')
  const [where, setWhere] = useState('')
  const [tag, setTag] = useState('')
  const [status, setStatus] = useState<StatusFilter>('todos')
  const [view, setView] = useState<CatType>('despesa')
  const [showFilters, setShowFilters] = useState(false)
  const [limit, setLimit] = useState(PAGE)

  const { from, to } = rangeOf(period, f.ref, custom)
  const look: ReportLookups = useMemo(() => ({ ...f.look, paid: paidInvoices(f.transactions) }), [f.look, f.transactions])
  const selected = f.cats.get(categoryId)
  // com receitas (ou despesas) filtradas, a quebra por categoria segue o filtro
  const catView: CatType = type === 'todos' ? (selected?.type ?? view) : type

  // ─── Lançamentos do período, com os filtros ────────────────
  const rows = useMemo(() => {
    return f.transactions
      .filter((t) => t.type !== 'transferencia' && !t.adjust)
      .map((t) => ({ t, day: cashDate(t, f.cardsIdx) }))
      .filter(({ t, day }) => {
        if (day < from || day > to) return false
        if (type !== 'todos' && t.type !== type) return false
        if (categoryId) {
          if (selected?.parentId ? t.categoryId !== categoryId : rootOf(t.categoryId, f.cats)?.id !== categoryId) return false
        }
        if (where) {
          if (where.startsWith('card:') ? t.cardId !== where.slice(5) : t.cardId || t.accountId !== where) return false
        }
        if (tag && !t.tags?.includes(tag)) return false
        if (status !== 'todos' && settled(t, look.paid) !== (status === 'pago')) return false
        return true
      })
      .sort((a, b) => b.day.localeCompare(a.day) || b.t.date.localeCompare(a.t.date))
  }, [f.transactions, f.cardsIdx, f.cats, from, to, type, categoryId, selected, where, tag, status, look.paid])

  const list = useMemo(() => rows.map((r) => r.t), [rows])

  // ─── Números ───────────────────────────────────────────────
  const kpi = useMemo(() => {
    let income = 0
    let expense = 0
    for (const t of list) t.type === 'receita' ? (income += t.amount) : (expense += t.amount)
    const balance = income - expense
    return { income, expense, balance, rate: income > 0 ? balance / income : NaN }
  }, [list])

  // fluxo de caixa: por dia até um mês; por mês nos períodos maiores
  const days = diffDays(to, from) + 1
  const flow = useMemo((): FlowPoint[] => {
    if (days <= 31) {
      const byDay = new Map<string, FlowPoint>()
      for (let k = 0; k < days; k++) {
        const d = addDays(from, k)
        byDay.set(d, { label: String(Number(d.slice(8, 10))), date: d, income: 0, expense: 0, current: d === f.ref })
      }
      for (const { t, day } of rows) {
        const p = byDay.get(day)
        if (p) t.type === 'receita' ? (p.income += t.amount) : (p.expense += t.amount)
      }
      return [...byDay.values()]
    }
    const months = monthsBetween(from, to)
    const years = new Set(months.map((m) => m.slice(0, 4))).size > 1
    const byMonth = new Map(months.map((m) => [m, { label: shortMonth(m) + (years ? `/${m.slice(2, 4)}` : ''), date: `${m}-01`, income: 0, expense: 0, current: m === monthKey(f.ref) }]))
    for (const { t, day } of rows) {
      const p = byMonth.get(monthKey(day))
      if (p) t.type === 'receita' ? (p.income += t.amount) : (p.expense += t.amount)
    }
    return [...byMonth.values()]
  }, [rows, from, to, days, f.ref])

  // por categoria: as principais; com uma principal filtrada, as subcategorias dela
  const breakdown = useMemo(() => {
    const byRoot = !selected || !!selected.parentId
    const sums = new Map<string, number>()
    for (const t of list) {
      if (t.type !== catView) continue
      const key = byRoot ? (rootOf(t.categoryId, f.cats)?.id ?? '') : (t.categoryId ?? '')
      sums.set(key, (sums.get(key) ?? 0) + t.amount)
    }
    const total = [...sums.values()].reduce((s, v) => s + v, 0)
    const items = [...sums]
      .map(([id, value], i) => {
        const cat: Pick<Category, 'name' | 'color' | 'icon'> = (id === categoryId && !byRoot ? { ...selected!, name: `${selected!.name} (geral)` } : f.cats.get(id)) ?? NO_CAT
        // subcategorias herdam a cor da principal: na quebra delas, cores da paleta
        const color = byRoot ? cat.color : palette[i % palette.length]
        return { id, name: cat.name, icon: cat.icon, color, value, ratio: total ? value / total : 0 }
      })
      .sort((a, b) => b.value - a.value)
    return { items, total }
  }, [list, catView, selected, categoryId, f.cats])

  const slices = useMemo(() => {
    const top = breakdown.items.slice(0, 5).map((x) => ({ label: x.name, value: x.value, color: x.color }))
    const rest = breakdown.items.slice(5).reduce((s, x) => s + x.value, 0)
    return rest > 0 ? [...top, { label: 'Outras', value: rest, color: 'var(--fill-2)' }] : top
  }, [breakdown])

  // demonstrativo: categorias principais de despesa × meses (últimos 12 do período)
  const statement = useMemo(() => {
    const all = monthsBetween(from, to)
    const months = all.slice(-12)
    const years = new Set(months.map((m) => m.slice(0, 4))).size > 1
    const grid = new Map<string, number[]>()
    for (const { t, day } of rows) {
      if (t.type !== 'despesa') continue
      const k = months.indexOf(monthKey(day))
      if (k < 0) continue
      const id = rootOf(t.categoryId, f.cats)?.id ?? ''
      const line = grid.get(id) ?? months.map(() => 0)
      line[k] += t.amount
      grid.set(id, line)
    }
    const lines = [...grid].map(([id, values]) => ({ name: (f.cats.get(id) ?? NO_CAT).name, values, total: values.reduce((s, v) => s + v, 0) })).sort((a, b) => b.total - a.total)
    const totals = months.map((_, k) => lines.reduce((s, l) => s + l.values[k], 0))
    const cell = (v: number) => (v ? money(v) : '—')
    return {
      head: ['Categoria', ...months.map((m) => shortMonth(m) + (years ? `/${m.slice(2, 4)}` : '')), 'Total'],
      rows: [...lines.map((l) => [l.name, ...l.values.map(cell), money(l.total)]), ['Total', ...totals.map(cell), money(totals.reduce((s, v) => s + v, 0))]],
      empty: lines.length === 0,
      cut: all.length > months.length,
    }
  }, [rows, from, to, f.cats])

  // ─── Opções dos filtros ────────────────────────────────────
  const catOptions = useMemo(() => {
    // a categoria escolhida continua na lista mesmo arquivada (senão o filtro fica "invisível")
    const active = f.categories.filter((c) => (!c.archived || c.id === categoryId) && (type === 'todos' || c.type === type))
    const roots = active.filter((c) => !c.parentId).sort((a, b) => a.name.localeCompare(b.name))
    return roots.flatMap((r) => [
      { value: r.id, label: r.name, group: r.type === 'receita' ? 'Receitas' : 'Despesas' },
      ...active.filter((c) => c.parentId === r.id).map((c) => ({ value: c.id, label: `  ${c.name}`, group: r.type === 'receita' ? 'Receitas' : 'Despesas' })),
    ])
  }, [f.categories, type, categoryId])
  const whereOptions = [
    ...f.accounts.filter((a) => !a.archived || a.id === where).map((a) => ({ value: a.id, label: a.name, group: 'Contas' })),
    ...f.cards.filter((c) => !c.archived || `card:${c.id}` === where).map((c) => ({ value: `card:${c.id}`, label: c.name, group: 'Cartões' })),
  ]
  const tags = useMemo(() => [...new Set(f.transactions.flatMap((t) => t.tags ?? []))].sort((a, b) => a.localeCompare(b)), [f.transactions])

  const filterText = [
    type !== 'todos' && (type === 'receita' ? 'Receitas' : 'Despesas'),
    selected && selected.name,
    where && (where.startsWith('card:') ? `Cartão ${f.cardsIdx.get(where.slice(5))?.name ?? ''}` : f.accs.get(where)?.name),
    tag && `#${tag}`,
    status !== 'todos' && (status === 'pago' ? 'Pagos' : 'Pendentes'),
  ].filter((x): x is string => !!x)
  const clear = () => (haptic(), setType('todos'), setCategoryId(''), setWhere(''), setTag(''), setStatus('todos'))
  const periodText = period === 'mes' || period === 'passado' ? monthLabel(monthKey(from)) : `${fmtDate(from)} a ${fmtDate(to)}`

  const doCsv = () => {
    if (!list.length) return toast('Nada para exportar')
    exportCsv(list, look, `dinn-extrato-${from}-a-${to}.csv`)
    toast('Exportado')
  }
  const doPdf = () => {
    if (!list.length) return toast('Nada para exportar')
    const ok = exportPdf({
      period: periodText,
      filters: filterText,
      kpis: [
        { label: 'Receitas', value: kpi.income, tone: 'green' },
        { label: 'Despesas', value: kpi.expense, tone: 'red' },
        { label: 'Balanço', value: kpi.balance, tone: kpi.balance >= 0 ? 'green' : 'red' },
        { label: 'Taxa de economia', value: kpi.rate, kind: 'percent' },
      ],
      categoriesTitle: catView === 'despesa' ? 'Despesas por categoria' : 'Receitas por categoria',
      categories: breakdown.items.map((x) => ({ name: x.name, value: x.value, ratio: x.ratio, color: x.color.startsWith('var(') ? '#94a3b8' : x.color })),
      rows: list,
      look,
    })
    toast(ok ? 'Exportado' : 'Permita pop-ups para gerar o PDF')
  }

  const exportButtons = (
    <div className="grid grid-cols-2 gap-3">
      <Button variant="tinted" onClick={doPdf}>
        <FileDown className="size-[18px]" /> Exportar PDF
      </Button>
      <Button variant="tinted" onClick={doCsv}>
        <Download className="size-[18px]" /> Planilha (CSV)
      </Button>
    </div>
  )

  const filtersOpen = desktop || showFilters

  return (
    <Screen title="Relatórios" subtitle="Filtros, gráficos e extrato para exportar.">
      {/* computador largo: período e filtros fixos à esquerda, resultados à direita */}
      <div className="xl:grid xl:grid-cols-[340px_minmax(0,1fr)] xl:items-start xl:gap-8">
        <div className="xl:sticky xl:top-[116px]">
          <Chips value={period} onChange={(p) => (setPeriod(p), setLimit(PAGE))} options={(Object.keys(periodLabel) as Period[]).map((p) => ({ value: p, label: periodLabel[p] }))} />
          {period === 'custom' && (
            <Section>
              <TextField label="De" type="date" value={custom.from} onChange={(v) => v && setCustom((c) => ({ ...c, from: v }))} />
              <TextField label="Até" type="date" value={custom.to} onChange={(v) => v && setCustom((c) => ({ ...c, to: v }))} />
            </Section>
          )}

          {/* celular: filtros num bloco que abre e fecha */}
          <div className="mb-6 rounded-[22px] bg-surface shadow-card">
            <div className="flex items-center gap-2 pr-4">
              <button
                onClick={() => !desktop && (haptic(), setShowFilters((v) => !v))}
                aria-expanded={filtersOpen}
                className={clsx('flex min-w-0 flex-1 items-center gap-3 py-3.5 pl-4 text-left', desktop && 'cursor-default')}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-tint/10 text-tint">
                  <SlidersHorizontal className="size-[17px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">Filtros</span>
                  <span className="block truncate text-[12px] text-label-2">{filterText.length ? filterText.join(' · ') : 'Todos os lançamentos'}</span>
                </span>
                {!desktop && <ChevronDown className={clsx('size-4 shrink-0 text-label-3 transition-transform', showFilters && 'rotate-180')} strokeWidth={2.5} />}
              </button>
              {filterText.length > 0 && (
                <button
                  aria-label="Limpar filtros"
                  onClick={clear}
                  className="flex shrink-0 items-center gap-1 rounded-full bg-fill px-2.5 py-1 text-[12px] font-semibold text-label-2 transition-colors hover:text-label"
                >
                  <X className="size-3.5" /> Limpar
                </button>
              )}
            </div>
            <AnimatePresence initial={false}>
              {filtersOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                  <div className="px-4 pt-1">
                    <Segmented
                      value={type}
                      onChange={(v) => (setType(v), v !== 'todos' && selected && selected.type !== v && setCategoryId(''))}
                      className="mb-3"
                      options={[
                        { value: 'todos', label: 'Todos' },
                        { value: 'receita', label: 'Receitas' },
                        { value: 'despesa', label: 'Despesas' },
                      ]}
                    />
                    <Segmented
                      value={status}
                      onChange={setStatus}
                      className="mb-1"
                      options={[
                        { value: 'todos', label: 'Todos' },
                        { value: 'pago', label: 'Pagos' },
                        { value: 'pendente', label: 'Pendentes' },
                      ]}
                    />
                  </div>
                  <div className="[&>*+*]:border-t [&>*+*]:border-separator">
                    <SelectField label="Categoria" value={categoryId} onChange={setCategoryId} options={catOptions} placeholder="Todas" />
                    <SelectField label="Conta" value={where} onChange={setWhere} options={whereOptions} placeholder="Todas" />
                    {tags.length > 0 && <SelectField label="Tag" value={tag} onChange={setTag} options={tags.map((t) => ({ value: t, label: `#${t}` }))} placeholder="Todas" />}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="hidden xl:block">{exportButtons}</div>
        </div>

        <div className="min-w-0">
          <p className="mb-3 px-1 text-[13px] font-semibold text-label-2">{periodText}</p>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Receitas" value={money(kpi.income)} tone="green" hint={count(list.filter((t) => t.type === 'receita').length)} />
            <StatCard label="Despesas" value={money(kpi.expense)} tone="red" hint={count(list.filter((t) => t.type === 'despesa').length)} />
            <StatCard label="Balanço" value={money(kpi.balance)} tone={kpi.balance >= 0 ? 'green' : 'red'} hint={kpi.balance >= 0 ? 'sobrou no período' : 'faltou no período'} />
            <StatCard label="Taxa de economia" value={isFinite(kpi.rate) ? percent(kpi.rate) : '—'} tone={isFinite(kpi.rate) ? (kpi.rate >= 0 ? 'green' : 'red') : undefined} hint="do que entrou, guardou" />
          </div>

          {list.length === 0 ? (
            <div className="mb-6 rounded-[22px] bg-surface shadow-card">
              <Empty icon={<BarChart3 className="size-9" strokeWidth={1.5} />} title="Nada neste período" text="Mude o período ou os filtros." />
            </div>
          ) : (
            <>
              <section className="mb-6 rounded-[22px] bg-surface p-4 shadow-card lg:p-5">
                <div className="mb-3 px-1">
                  <h2 className="text-[15px] font-semibold">Fluxo de caixa</h2>
                  <p className="text-[12px] text-label-2">Entradas e saídas {days <= 31 ? 'por dia' : 'por mês'}</p>
                </div>
                <CashFlowChart data={flow} tall={desktop} />
                <FlowLegend balance={desktop && flow.length <= 12} />
              </section>

              <section className="mb-6 rounded-[22px] bg-surface p-4 shadow-card lg:p-5">
                <div className="mb-4 flex items-center justify-between gap-3 px-1">
                  <h2 className="text-[15px] font-semibold">
                    {catView === 'despesa' ? 'Despesas' : 'Receitas'} por {selected && !selected.parentId ? 'subcategoria' : 'categoria'}
                  </h2>
                  {type === 'todos' && !selected && (
                    <Segmented
                      value={view}
                      onChange={setView}
                      className="mb-0 w-48 shrink-0"
                      options={[
                        { value: 'despesa', label: 'Despesas' },
                        { value: 'receita', label: 'Receitas' },
                      ]}
                    />
                  )}
                </div>
                {breakdown.items.length === 0 ? (
                  <p className="rounded-[16px] bg-fill/50 p-3.5 text-[13px] text-label-2">Nenhuma {catView === 'despesa' ? 'despesa' : 'receita'} com estes filtros.</p>
                ) : (
                  <>
                    <Donut slices={slices} center={money(breakdown.total)} caption={catView === 'despesa' ? 'despesas' : 'receitas'} />
                    <h3 className="mb-1 mt-5 px-1 text-[13px] font-semibold text-label-2">Detalhes</h3>
                    <div className="-mx-2">
                      {breakdown.items.map((x) => (
                        <button
                          key={x.id || 'none'}
                          disabled={!x.id || x.id === categoryId}
                          onClick={() => (haptic(), setCategoryId(x.id), setLimit(PAGE))}
                          className="flex w-full items-center gap-3 rounded-[14px] px-2 py-2 text-left transition-colors enabled:hover:bg-fill/60"
                        >
                          <CategoryIcon category={{ icon: x.icon, color: x.color.startsWith('var(') ? '#94a3b8' : x.color }} size={36} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-[14px] font-semibold">{x.name}</span>
                              <span className="tabular shrink-0 text-[14px] font-semibold">{money(x.value)}</span>
                            </span>
                            <span className="mt-1 flex items-center gap-2">
                              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill">
                                <motion.span
                                  className="block h-full rounded-full"
                                  style={{ background: x.color }}
                                  initial={{ width: 0 }}
                                  animate={{ width: `${Math.max(1, x.ratio * 100)}%` }}
                                  transition={{ duration: 0.6, ease: 'easeOut' }}
                                />
                              </span>
                              <span className="tabular w-12 shrink-0 text-right text-[12px] text-label-2">{percent(x.ratio).replace(/,\d+/, '')}</span>
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </section>

              {!statement.empty && (
                <section className="mb-6 hidden xl:block">
                  <h2 className="mb-2.5 px-1 text-[15px] font-semibold">
                    Demonstrativo de despesas
                    {statement.cut && <span className="ml-2 text-[12px] font-medium text-label-2">últimos 12 meses do período</span>}
                  </h2>
                  <div className="no-scrollbar overflow-x-auto rounded-[22px] shadow-card">
                    <Table head={statement.head} rows={statement.rows} />
                  </div>
                </section>
              )}

              <Section header={`Extrato · ${list.length} ${list.length === 1 ? 'lançamento' : 'lançamentos'}`}>
                {list.slice(0, limit).map((t: Transaction) => (
                  <TxRow key={t.id} tx={t} look={f.look} showDate onClick={() => openTx(true, { id: t.id })} />
                ))}
              </Section>
              {list.length > limit && (
                <Button variant="plain" className="-mt-3 mb-4" onClick={() => setLimit((n) => n + PAGE)}>
                  Mostrar mais ({list.length - limit})
                </Button>
              )}
            </>
          )}

          <div className="xl:hidden">{exportButtons}</div>
        </div>
      </div>
    </Screen>
  )
}
