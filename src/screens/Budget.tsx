import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Gauge, History, PiggyBank, SlidersHorizontal, Tags } from 'lucide-react'
import clsx from 'clsx'
import { monthKey, monthLabel, parseISO, shiftMonth } from '../lib/dates'
import { money, percent } from '../lib/format'
import { haptic } from '../lib/haptics'
import { budgetLabel, budgetTone, byCategory, limitOf, monthRange, monthTotals, overallBudget } from '../lib/ledger'
import { useData, useUI } from '../lib/store'
import { toast } from '../components/sheet'
import { CategoryIcon, MonthNav, useFinance } from '../components/finance'
import { Button, MoneyField, PercentField, Progress, Screen, Section, spring } from '../components/ui'
import { StatusPill, toneText } from '../sheets/CategorySheet'

export default function Budget() {
  const f = useFinance()
  const settings = useData((s) => s.settings)
  const { setSettings, setBudget } = useData()
  const { month, setMonth, openCategory, openSettings } = useUI()
  const [editing, setEditing] = useState(false)

  const r = useMemo(() => {
    const { from, to } = monthRange(month)
    const t = monthTotals(f.transactions, f.cardsIdx, month)
    const spent = byCategory(f.transactions, f.cardsIdx, f.categories, 'despesa', from, to)
    const mains = f.categories.filter((c) => c.type === 'despesa' && !c.parentId && !c.archived)
    const withLimit = mains
      .map((c) => ({ c, limit: limitOf(c, f.categories), spent: spent.get(c.id) ?? 0 }))
      .filter((x) => x.limit > 0)
      .map((x) => ({ ...x, ratio: x.spent / x.limit }))
      .sort((a, b) => b.ratio - a.ratio)
    const noLimit = mains
      .filter((c) => !limitOf(c, f.categories))
      .map((c) => ({ c, spent: spent.get(c.id) ?? 0 }))
      .sort((a, b) => b.spent - a.spent)
    return { t, withLimit, noLimit, ...overallBudget(f.categories, settings.budgetTotal, f.transactions, f.cardsIdx, month) }
  }, [f.transactions, f.cardsIdx, f.categories, month, settings.budgetTotal])

  const { t, withLimit, limit, spent: overallSpent } = r
  const hasLimit = limit > 0
  // sem nenhum limite: mostra todas as categorias para começar o planejamento
  const noLimit = hasLimit ? r.noLimit.filter((x) => x.spent > 0) : r.noLimit

  // usa o gasto do mês passado (arredondado para cima de 50 em 50) como ponto de partida
  const suggest = () => {
    const prev = shiftMonth(month, -1)
    const { from, to } = monthRange(prev)
    const spent = byCategory(f.transactions, f.cardsIdx, f.categories, 'despesa', from, to)
    const list = f.categories.filter((c) => c.type === 'despesa' && !c.parentId && !c.archived && (spent.get(c.id) ?? 0) > 0)
    if (!list.length) return toast('Sem gastos no mês passado')
    if (!confirm(`Usar o que você gastou em ${monthLabel(prev).split(' ')[0].toLowerCase()} como limite de ${list.length} ${list.length === 1 ? 'categoria' : 'categorias'}?`)) return
    for (const c of list) setBudget(c.id, Math.ceil((spent.get(c.id) ?? 0) / 50) * 50)
    toast('Limites definidos')
  }

  return (
    <Screen title="Orçamento" subtitle="Limites de gastos por categoria, no mês inteiro.">
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] xl:items-start xl:gap-8">
        <div className="xl:sticky xl:top-[116px]">
          <MonthNav month={month} onChange={setMonth} />

          {hasLimit ? (
            <OverallCard month={month} ref_={f.ref} spent={overallSpent} limit={limit} alert={settings.budgetAlert} editing={editing} onEdit={() => setEditing((v) => !v)} />
          ) : (
            <div className="mb-5 rounded-[22px] bg-surface p-5 shadow-card">
              <span className="grad-green grid size-11 place-items-center rounded-full text-white">
                <Gauge className="size-5" />
              </span>
              <p className="mt-3 text-[17px] font-semibold">Vamos começar seu planejamento?</p>
              <p className="mt-1 text-[13px] leading-[18px] text-label-2">Defina quanto pretende gastar no mês e distribua entre as categorias. O app avisa antes do orçamento sair do controle.</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Button onClick={suggest} className="h-11 text-[14px]">
                  <History className="size-[17px]" /> Sugerir pelo mês passado
                </Button>
                <Button variant="tinted" onClick={() => setEditing(true)} className="h-11 text-[14px]">
                  Definir manualmente
                </Button>
              </div>
            </div>
          )}

          <AnimatePresence initial={false}>
            {editing && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring} className="overflow-hidden">
                <Section header="Limite geral" footer="Deixe zerado para usar a soma dos limites das categorias. O aviso vale para o limite geral e para cada categoria.">
                  <MoneyField label="Limite geral" value={settings.budgetTotal} onChange={(budgetTotal) => setSettings({ budgetTotal })} />
                  <PercentField label="Avisar ao chegar em" value={settings.budgetAlert} onChange={(v) => setSettings({ budgetAlert: Math.min(1, Math.max(0.1, v || 0.8)) })} />
                </Section>
              </motion.div>
            )}
          </AnimatePresence>

          {t.income > 0 && hasLimit && <SavingsCard income={t.income} limit={limit} />}

          <button
            onClick={() => (haptic(), openSettings(true, 'categorias'))}
            className="mb-6 flex h-11 w-full items-center gap-2.5 rounded-[16px] bg-surface px-4 text-[14px] font-semibold text-tint shadow-card transition-colors hover:bg-fill/40 xl:mb-0"
          >
            <Tags className="size-[18px]" /> Gerenciar categorias
          </button>
        </div>

        <div className="mt-1 xl:mt-0">
          {withLimit.length > 0 && (
            <Section header="Por categoria">
              {withLimit.map(({ c, limit: max, spent, ratio }) => {
                const tone = budgetTone(ratio, settings.budgetAlert)
                return (
                  <motion.button
                    key={c.id}
                    whileTap={{ backgroundColor: 'var(--fill)' }}
                    onClick={() => (haptic(), openCategory(true, { id: c.id }))}
                    className="relative block w-full px-4 py-3.5 text-left transition-colors hover:bg-fill/50"
                  >
                    <span className="flex items-center gap-3">
                      <CategoryIcon category={c} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{c.name}</span>
                        <span className="tabular block truncate text-[12px] text-label-2">
                          {money(spent)} de {money(max)}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end">
                        <span className={clsx('tabular text-[15px] font-semibold', toneText[tone])}>{Math.round(ratio * 100)}%</span>
                        <span className={clsx('text-[11px] font-semibold', toneText[tone])}>{budgetLabel[tone]}</span>
                      </span>
                    </span>
                    <Progress value={ratio} tone={tone} className="ml-[52px] mt-2.5" />
                    <span className="tabular ml-[52px] mt-1.5 block text-[11.5px] text-label-2">
                      {spent <= max ? `Restam ${money(max - spent)}` : `Passou ${money(spent - max)} do limite`}
                    </span>
                  </motion.button>
                )
              })}
            </Section>
          )}

          {noLimit.length > 0 && (
            <Section header={hasLimit ? 'Sem limite definido' : 'Escolha as categorias'} footer={hasLimit ? 'Categorias com gastos neste mês e sem teto.' : 'Toque numa categoria para definir quanto quer gastar por mês.'}>
              {noLimit.map(({ c, spent }) => (
                <div key={c.id} className="relative flex min-h-14 items-center gap-3 px-4 py-2.5">
                  <CategoryIcon category={c} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{c.name}</span>
                    <span className="tabular block truncate text-[12px] text-label-2">{spent > 0 ? `${money(spent)} gastos no mês` : 'Nada gasto no mês'}</span>
                  </span>
                  <motion.button
                    whileTap={{ scale: 0.94 }}
                    onClick={() => (haptic(), openCategory(true, { id: c.id }))}
                    className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-tint/10 px-3 text-[12.5px] font-semibold text-tint"
                  >
                    <SlidersHorizontal className="size-3.5" /> Definir limite
                  </motion.button>
                </div>
              ))}
            </Section>
          )}
        </div>
      </div>
    </Screen>
  )
}

/** Limite geral do mês: consumo, situação e quanto ainda dá para gastar por dia. */
function OverallCard({ month, ref_, spent, limit, alert, editing, onEdit }: { month: string; ref_: string; spent: number; limit: number; alert: number; editing: boolean; onEdit: () => void }) {
  const ratio = spent / limit
  const tone = budgetTone(ratio, alert)
  const left = limit - spent
  const current = month === monthKey(ref_)
  const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
  const day = parseISO(ref_).getDate()
  const daysLeft = days - day + 1
  const passed = day / days

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="mb-5 rounded-[22px] bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-tint/10 text-tint">
          <Gauge className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">Limite geral do mês</span>
          <span className="block truncate text-[12px] text-label-2">Avisos em {Math.round(alert * 100)}% e 100%</span>
        </span>
        <StatusPill tone={tone}>{budgetLabel[tone]}</StatusPill>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className={clsx('tabular text-[34px] font-semibold leading-none tracking-[-0.03em]', toneText[tone])}>{Math.round(ratio * 100)}%</p>
          <p className="tabular mt-1.5 text-[12.5px] text-label-2">
            {money(spent)} de {money(limit)} consumidos
          </p>
        </div>
        <button onClick={() => (haptic(), onEdit())} className="shrink-0 text-[13px] font-semibold text-tint">
          {editing ? 'Fechar' : 'Ajustar'}
        </button>
      </div>

      {/* marcador de quanto do mês já passou */}
      <div className="relative mt-3">
        <Progress value={ratio} tone={tone} />
        {current && <span className="absolute -top-1 h-4 w-0.5 rounded-full bg-label/70" style={{ left: `calc(${Math.min(100, passed * 100)}% - 1px)` }} aria-hidden />}
      </div>

      <div className="mt-3 grid grid-cols-2 divide-x divide-separator rounded-[16px] bg-fill/50 p-3">
        <div className="pr-3">
          <p className="text-[11px] text-label-2">{left >= 0 ? 'Restante' : 'Excedente'}</p>
          <p className={clsx('tabular truncate text-[16px] font-semibold', left < 0 && 'text-red')}>{money(Math.abs(left))}</p>
        </div>
        <div className="pl-3">
          <p className="text-[11px] text-label-2">{current ? 'Por dia até o fim do mês' : 'Limite total'}</p>
          <p className="tabular truncate text-[16px] font-semibold">{current ? money(Math.max(0, left) / daysLeft) : money(limit)}</p>
        </div>
      </div>

      {current && (
        <p className="mt-3 text-[12.5px] leading-[18px] text-label-2">
          {left >= 0 ? (
            <>
              Você ainda pode gastar <span className="font-semibold text-label">{money(left)}</span> · {money(left / daysLeft)} por dia · {daysLeft} {daysLeft === 1 ? 'dia restante' : 'dias restantes'}.
            </>
          ) : (
            <>
              Você ultrapassou o limite em <span className="font-semibold text-red">{money(-left)}</span>.
            </>
          )}{' '}
          Hoje, dia {day} de {days}: {Math.round(passed * 100)}% do mês já passou.
        </p>
      )}
    </motion.div>
  )
}

/** Economia planejada = receita do mês − limite de gastos. */
function SavingsCard({ income, limit }: { income: number; limit: number }) {
  const planned = income - limit
  return (
    <div className="mb-5 flex items-center gap-3 rounded-[22px] bg-surface p-4 shadow-card">
      <span className={clsx('grid size-10 shrink-0 place-items-center rounded-full', planned >= 0 ? 'bg-tint/10 text-tint' : 'bg-red/10 text-red')}>
        <PiggyBank className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-label-2">Economia planejada</span>
        <span className={clsx('tabular block truncate text-[18px] font-semibold tracking-[-0.02em]', planned >= 0 ? 'text-green' : 'text-red')}>{money(planned)}</span>
        <span className="tabular block truncate text-[11.5px] text-label-2">
          {planned >= 0 ? `${percent(planned / income).replace(',00', '')} da receita do mês (${money(income)})` : `Os limites passam a receita do mês (${money(income)})`}
        </span>
      </span>
    </div>
  )
}
