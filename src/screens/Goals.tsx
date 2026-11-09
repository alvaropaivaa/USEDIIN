import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { PiggyBank, Plus, ShieldCheck } from 'lucide-react'
import { fmtDate } from '../lib/dates'
import { money, percent } from '../lib/format'
import { haptic } from '../lib/haptics'
import { goalStats, goalStatus, shortForecast, type Goal, type GoalStats } from '../lib/ledger'
import { useUI } from '../lib/store'
import { CategoryIcon, useFinance } from '../components/finance'
import { Mascot } from '../components/mascots'
import { Button, Chips, Hero, IconButton, Money, Progress, Screen, spring } from '../components/ui'
import { StatusPill } from '../sheets/CategorySheet'

type Filter = 'andamento' | 'concluidas'

export default function Goals() {
  const f = useFinance()
  const openGoal = useUI((s) => s.openGoal)
  const [filter, setFilter] = useState<Filter>('andamento')

  const items = useMemo(
    () => f.goals.filter((g) => !g.archived).map((g) => ({ g, st: goalStats(g, f.ref) })),
    [f.goals, f.ref],
  )
  const done = (x: (typeof items)[number]) => !!x.g.completedAt || x.st.done
  const list = items.filter((x) => (filter === 'concluidas' ? done(x) : !done(x)))
  const saved = items.reduce((s, x) => s + x.st.saved, 0)
  const target = items.reduce((s, x) => s + x.g.target, 0)

  return (
    <Screen
      title="Metas"
      subtitle="Objetivos, aportes e previsão de conclusão."
      trailing={
        <IconButton label="Nova meta" onClick={() => openGoal(true)}>
          <Plus className="size-[18px]" strokeWidth={2.5} />
        </IconButton>
      }
    >
      {items.length === 0 ? (
        <div className="rounded-[22px] bg-surface p-6 text-center shadow-card lg:mx-auto lg:max-w-lg">
          <Mascot pose="metas" className="mx-auto h-[136px] w-auto" />
          <p className="mt-4 text-[17px] font-semibold">Você ainda não tem metas criadas.</p>
          <p className="mt-1 text-[14px] leading-5 text-label-2">Reserva de emergência, viagem, carro novo… defina o valor e acompanhe cada aporte.</p>
          <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
            <Button onClick={() => openGoal(true)}>
              <Plus className="size-[18px]" /> Criar meta
            </Button>
            <Button variant="tinted" onClick={() => openGoal(true, undefined, true)}>
              <ShieldCheck className="size-[18px]" /> Reserva de emergência
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
            <Hero
              label="Guardado nas metas"
              icon={<PiggyBank className="size-6" strokeWidth={2} />}
              caption={<>de {money(target)} em objetivos · {percent(target ? saved / target : 0).replace(',00', '')}</>}
            >
              <Money value={saved} />
            </Hero>
            <div className="lg:pt-1">
              <Chips
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'andamento', label: 'Em andamento', count: items.filter((x) => !done(x)).length },
                  { value: 'concluidas', label: 'Concluídas', count: items.filter(done).length },
                ]}
              />
            </div>
          </div>

          {list.length === 0 ? (
            <p className="rounded-[22px] bg-surface px-5 py-6 text-center text-[14px] text-label-2 shadow-card">
              {filter === 'concluidas' ? 'Nenhuma meta concluída ainda. Cada aporte conta!' : 'Todas as metas foram concluídas. Que tal criar a próxima?'}
            </p>
          ) : (
            <div className="lg:grid lg:grid-cols-2 lg:gap-4 2xl:grid-cols-3">
              {list.map(({ g, st }, k) => (
                <GoalCard key={g.id} g={g} st={st} day={f.ref} index={k} onOpen={() => openGoal(true, g.id)} />
              ))}
            </div>
          )}
        </>
      )}
    </Screen>
  )
}

function GoalCard({ g, st, day, index, onOpen }: { g: Goal; st: GoalStats; day: string; index: number; onOpen: () => void }) {
  const status = goalStatus(g, st, day)
  const late = !!g.deadline && g.deadline < day
  const finished = !!g.completedAt || st.done
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: Math.min(index, 8) * 0.03 }}
      whileTap={{ scale: 0.985 }}
      onClick={() => (haptic(), onOpen())}
      className="mb-3 block w-full rounded-[22px] bg-surface p-4 text-left shadow-card transition-shadow hover:shadow-[0_0_0_1px_var(--separator),0_14px_32px_-16px_rgba(15,21,18,0.25)] lg:mb-0"
    >
      <div className="flex items-center gap-3">
        <CategoryIcon category={g} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold tracking-[-0.01em]">{g.name}</p>
          <p className="truncate text-[12px] text-label-2">{g.deadline ? `Até ${fmtDate(g.deadline)}` : g.monthly ? `${money(g.monthly)} por mês` : 'Sem prazo'}</p>
        </div>
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <p className="tabular min-w-0 truncate text-[20px] font-semibold tracking-[-0.02em]">{money(st.saved)}</p>
        <p className="tabular shrink-0 text-[12px] text-label-2">
          de {money(g.target)} · <span className="font-semibold text-label">{Math.min(999, Math.round(st.ratio * 100))}%</span>
        </p>
      </div>
      <Progress value={st.ratio} className="mt-2" />

      <p className="mt-3 truncate text-[12px] text-label-2">
        {finished
          ? g.completedAt
            ? `Concluída em ${fmtDate(g.completedAt)}`
            : 'Valor alcançado'
          : st.forecast
            ? `Previsão: ${shortForecast(st.forecast)} · faltam ${money(st.left)}`
            : `Sem aportes recentes · faltam ${money(st.left)}`}
      </p>
      {!finished && g.deadline && st.needed !== null && (
        <p className={`mt-0.5 text-[12px] font-medium leading-[16px] ${st.onTrack && !late ? 'text-green' : 'text-orange'}`}>
          {late ? `O prazo de ${fmtDate(g.deadline)} já passou. Ajuste a data ou conclua a meta.` : `Para chegar até ${fmtDate(g.deadline)}, guarde cerca de ${money(st.needed)}/mês`}
        </p>
      )}
    </motion.button>
  )
}
