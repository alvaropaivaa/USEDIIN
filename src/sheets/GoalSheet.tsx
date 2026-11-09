import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown, PartyPopper, Pencil, RotateCcw, ShieldCheck, Target, Trash2, X } from 'lucide-react'
import clsx from 'clsx'
import { addMonths, fmtDate, monthLabel, today } from '../lib/dates'
import { money } from '../lib/format'
import { haptic } from '../lib/haptics'
import { palette, suggestIcon } from '../lib/categories'
import { goalStats, goalStatus, shortForecast, type Goal } from '../lib/ledger'
import { useData, useUI } from '../lib/store'
import { Sheet, toast } from '../components/sheet'
import { CategoryIcon, useFinance } from '../components/finance'
import { Button, Hero, Money, MoneyField, PercentField, Progress, Section, SectionHeader, Segmented, SelectField, Stats, TextField, spring } from '../components/ui'
import { ColorPicker, IconPicker, StatusPill } from './CategorySheet'

interface Form {
  name: string
  target: number
  initial: number
  accountId: string
  deadline: string
  monthly: number
  yield: number
  color: string
  icon: string
  iconTouched: boolean
}

const blank = (k: number): Form => ({ name: '', target: 0, initial: 0, accountId: '', deadline: '', monthly: 0, yield: 0, color: palette[(k * 3) % palette.length], icon: 'cofrinho', iconTouched: false })

export default function GoalSheet() {
  const { open, id, reserve: startReserve } = useUI((s) => s.goal)
  const openGoal = useUI((s) => s.openGoal)
  const found = useData((s) => s.goals.find((g) => g.id === id))
  // ao fechar depois de excluir, o painel continua mostrando a meta até sumir
  const [last, setLast] = useState<Goal>()
  useEffect(() => {
    if (found) setLast(found)
  }, [found])
  const goal = found ?? (!open && id ? last : undefined)
  const close = () => openGoal(false, id)

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()} title={goal ? 'Meta' : 'Nova meta'}>
      {goal ? <GoalDetail goal={goal} open={open} onClose={close} /> : <NewGoal open={open} reserveFirst={!!startReserve} onClose={close} />}
    </Sheet>
  )
}

// ─── Campos compartilhados (nova e edição) ───────────────────

function GoalFields({ form, set, withInitial }: { form: Form; set: (p: Partial<Form>) => void; withInitial?: boolean }) {
  const accounts = useData((s) => s.accounts)
  const suggested = suggestIcon(form.name)
  useEffect(() => {
    if (!form.iconTouched && suggested) set({ icon: suggested })
  }, [suggested]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Section>
        <TextField label="O que você quer conquistar?" value={form.name} onChange={(name) => set({ name })} placeholder="Viagem, carro…" />
        <MoneyField label="Quanto precisa juntar?" value={form.target} onChange={(target) => set({ target })} />
      </Section>

      {withInitial && (
        <Section footer="Sem conta escolhida, o valor só entra na meta (não sai do saldo de nenhuma conta).">
          <MoneyField label="Quanto já guardou?" value={form.initial} onChange={(initial) => set({ initial })} />
          {form.initial > 0 && (
            <SelectField
              label="De qual conta saiu?"
              value={form.accountId}
              onChange={(accountId) => set({ accountId })}
              placeholder="Nenhuma"
              options={accounts.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name }))}
            />
          )}
        </Section>
      )}

      <Section footer="Deixe o rendimento zerado para não considerar rendimentos na previsão.">
        <TextField label="Até quando?" type="date" value={form.deadline} onChange={(deadline) => set({ deadline })} />
        <MoneyField label="Guardar por mês" value={form.monthly} onChange={(monthly) => set({ monthly })} />
        <PercentField label="Rendimento ao mês" value={form.yield} onChange={(v) => set({ yield: Math.max(0, Math.min(0.1, v)) })} />
      </Section>
      {form.deadline && (
        <button onClick={() => (haptic(), set({ deadline: '' }))} className="-mt-4 mb-5 flex items-center gap-1 px-1 text-[13px] font-semibold text-tint">
          <X className="size-3.5" /> Remover prazo
        </button>
      )}

      <SectionHeader>Cor</SectionHeader>
      <div className="mb-6 overflow-hidden rounded-[22px] bg-surface shadow-card">
        <ColorPicker value={form.color} onChange={(color) => set({ color })} />
      </div>
      <SectionHeader>Ícone</SectionHeader>
      <div className="mb-6 overflow-hidden rounded-[22px] bg-surface shadow-card">
        <IconPicker value={form.icon} onChange={(icon) => set({ icon, iconTouched: true })} color={form.color} suggested={suggested} />
      </div>
    </>
  )
}

/** Meta montada a partir do formulário, para a previsão ao vivo. */
const draftGoal = (form: Form, ref: string, saved: Goal['contributions'] = []): Goal => ({
  id: 'previa',
  name: form.name,
  target: form.target,
  ...(form.deadline ? { deadline: form.deadline } : {}),
  monthly: form.monthly,
  yield: form.yield,
  color: form.color,
  icon: form.icon,
  // o valor inicial fica "antigo": não entra no ritmo dos últimos 3 meses
  contributions: form.initial > 0 ? [...saved, { id: 'inicial', date: addMonths(ref, -12), amount: form.initial }] : saved,
  createdAt: ref,
})

/** Previsão em destaque: quando chega lá ou quanto falta guardar para cumprir o prazo. */
function Projection({ goal, day }: { goal: Goal; day: string }) {
  const st = goalStats(goal, day)
  if (goal.target <= 0) return null
  if (st.done)
    return (
      <Hero label="Valor alcançado" icon={<PartyPopper className="size-6" strokeWidth={2} />} caption="O que já foi guardado cobre a meta inteira.">
        Meta batida
      </Hero>
    )
  if (goal.deadline && !st.onTrack && st.needed !== null)
    return (
      <Hero label="Esse valor não atinge a meta no prazo" icon={<Target className="size-6" strokeWidth={2} />} caption={<>guarde pelo menos isso por mês para chegar até {fmtDate(goal.deadline)}</>}>
        {money(st.needed)}/mês
      </Hero>
    )
  return (
    <Hero
      label={goal.deadline ? 'Você consegue chegar dentro do prazo' : 'Você chega lá em'}
      icon={<Target className="size-6" strokeWidth={2} />}
      caption={st.rate > 0 ? <>guardando {money(st.rate)} por mês{goal.yield ? ' com rendimento' : ''}</> : st.forecast ? 'só com o rendimento do que já está guardado' : 'Informe quanto consegue guardar por mês'}
    >
      {st.forecast ? monthLabel(st.forecast) : 'Sem previsão'}
    </Hero>
  )
}

// ─── Nova meta ───────────────────────────────────────────────

function NewGoal({ open, reserveFirst, onClose }: { open: boolean; reserveFirst: boolean; onClose: () => void }) {
  const f = useFinance()
  const addGoal = useData((s) => s.addGoal)
  const [form, setForm] = useState<Form>(blank(0))
  const set = (p: Partial<Form>) => setForm((s) => ({ ...s, ...p }))
  const [reserve, setReserve] = useState(false)
  const [cost, setCost] = useState(0)
  const [months, setMonths] = useState<'6' | '12'>('6')

  useEffect(() => {
    if (!open) return
    setForm(blank(f.goals.length))
    setReserve(reserveFirst)
    setCost(0)
    setMonths('6')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // reserva de emergência: custo fixo × 6 (CLT) ou × 12 (autônomo/PJ)
  useEffect(() => {
    if (reserve && cost > 0) set({ name: form.name || 'Reserva de emergência', target: Math.round(cost * Number(months) * 100) / 100, icon: 'cofrinho', iconTouched: true })
  }, [reserve, cost, months]) // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(() => draftGoal(form, f.ref), [form, f.ref])
  const valid = form.name.trim().length >= 2 && form.target > 0

  const create = () => {
    if (!valid) return toast(form.target > 0 ? 'Dê um nome para a meta' : 'Informe quanto precisa juntar')
    if (form.deadline && form.deadline <= f.ref) return toast('Escolha uma data futura para o prazo')
    addGoal({
      name: form.name.trim(),
      target: form.target,
      ...(form.deadline ? { deadline: form.deadline } : {}),
      ...(form.monthly > 0 ? { monthly: form.monthly } : {}),
      ...(form.yield > 0 ? { yield: form.yield } : {}),
      color: form.color,
      icon: form.icon,
      initial: form.initial,
      ...(form.accountId ? { accountId: form.accountId } : {}),
    })
    toast('Meta criada com sucesso!')
    onClose()
  }

  return (
    <>
      <div className="mb-6 overflow-hidden rounded-[22px] bg-surface shadow-card">
        <button onClick={() => (haptic(), setReserve((v) => !v))} aria-expanded={reserve} className="flex w-full items-center gap-3 p-4 text-left">
          <span className="grad-green grid size-10 shrink-0 place-items-center rounded-full text-white">
            <ShieldCheck className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Reserva de emergência</span>
            <span className="block text-[12px] text-label-2">Calcule quanto guardar a partir do seu custo fixo</span>
          </span>
          <ChevronDown className={clsx('size-[18px] shrink-0 text-label-3 transition-transform', reserve && 'rotate-180')} strokeWidth={2.5} />
        </button>
        <AnimatePresence initial={false}>
          {reserve && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring} className="overflow-hidden">
              <div className="hairline-t">
                <MoneyField label="Custo fixo mensal" value={cost} onChange={setCost} />
              </div>
              <div className="px-4 pb-1">
                <Segmented
                  value={months}
                  onChange={setMonths}
                  options={[
                    { value: '6', label: 'CLT (6 meses)' },
                    { value: '12', label: 'Autônomo ou PJ (12 meses)' },
                  ]}
                />
              </div>
              <p className="-mt-2 px-4 pb-4 text-[12px] leading-[17px] text-label-2">
                {cost > 0 ? `Sua reserva: ${money(cost * Number(months))} (${months} meses do custo fixo). O cálculo não considera rendimentos.` : 'Some aluguel, contas, mercado e o que mais for fixo no mês.'}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mb-5 flex flex-col items-center">
        <CategoryIcon category={form} size={60} />
        <p className="mt-2 text-[17px] font-semibold">{form.name.trim() || 'Nova meta'}</p>
      </div>

      <GoalFields form={form} set={set} withInitial />
      <Projection goal={preview} day={f.ref} />

      <Button onClick={create} className={valid ? '' : 'pointer-events-none opacity-40'}>
        <Target className="size-[18px]" /> Criar meta
      </Button>
    </>
  )
}

// ─── Meta existente ──────────────────────────────────────────

function GoalDetail({ goal, open, onClose }: { goal: Goal; open: boolean; onClose: () => void }) {
  const f = useFinance()
  const { contribute, removeContribution, updateGoal, removeGoal } = useData()
  const st = goalStats(goal, f.ref)
  const status = goalStatus(goal, st, f.ref)
  const finished = !!goal.completedAt || st.done
  const late = !!goal.deadline && goal.deadline < f.ref

  const [move, setMove] = useState<null | 'guardar' | 'resgatar'>(null)
  const [amount, setAmount] = useState(0)
  const [accountId, setAccountId] = useState('')
  const [date, setDate] = useState(today())
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Form>(blank(0))
  const set = (p: Partial<Form>) => setForm((s) => ({ ...s, ...p }))

  const fromGoal = (g: Goal): Form => ({ name: g.name, target: g.target, initial: 0, accountId: '', deadline: g.deadline ?? '', monthly: g.monthly ?? 0, yield: g.yield ?? 0, color: g.color, icon: g.icon, iconTouched: true })

  // reinicia a cada abertura
  useEffect(() => {
    if (!open) return
    setMove(null)
    setEditing(false)
    setForm(fromGoal(goal))
  }, [open, goal.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const startMove = (m: 'guardar' | 'resgatar') => {
    haptic()
    setMove(move === m ? null : m)
    setAmount(m === 'guardar' ? (goal.monthly ?? 0) : 0)
    setAccountId('')
    setDate(today())
  }

  const doMove = () => {
    if (amount <= 0 || !move) return
    if (move === 'resgatar' && amount > st.saved + 0.005) return toast('Mais do que está guardado')
    contribute(goal.id, move === 'guardar' ? amount : -amount, accountId || undefined, date || today())
    toast(move === 'guardar' ? 'Aporte registrado' : 'Resgate registrado')
    setMove(null)
  }

  const save = () => {
    if (form.name.trim().length < 2 || form.target <= 0) return toast('Confira o nome e o valor da meta')
    // prazo novo no passado não faz sentido (o antigo, já vencido, pode ficar)
    if (form.deadline && form.deadline !== (goal.deadline ?? '') && form.deadline <= f.ref) return toast('Escolha uma data futura para o prazo')
    updateGoal(goal.id, {
      name: form.name.trim(),
      target: form.target,
      deadline: form.deadline || undefined,
      monthly: form.monthly > 0 ? form.monthly : undefined,
      yield: form.yield > 0 ? form.yield : undefined,
      color: form.color,
      icon: form.icon,
    })
    setEditing(false)
    toast('Meta atualizada')
  }

  const accounts = new Map(f.accounts.map((a) => [a.id, a.name]))
  const history = [...goal.contributions].sort((a, b) => b.date.localeCompare(a.date))

  // o texto de situação, como no Granazen
  const note = finished
    ? 'Meta concluída. Você pode reabrir se quiser continuar guardando.'
    : late
      ? `O prazo de ${fmtDate(goal.deadline!)} já passou e faltam ${money(st.left)}. Escolha uma nova data em "Editar meta" ou conclua a meta.`
      : goal.deadline && st.needed !== null
      ? st.onTrack
        ? `No ritmo: guardando ${money(st.rate)} por mês você chega lá em ${monthLabel(st.forecast!).toLowerCase()}, antes de ${fmtDate(goal.deadline)}.`
        : `Seu ritmo recente está em ${money(st.pace)} por mês. Para chegar até ${fmtDate(goal.deadline)}, ajuste para cerca de ${money(st.needed)}.`
      : st.rate > 0 && st.forecast
        ? `Mantendo ${money(st.rate)} por mês${goal.yield ? ' com rendimento' : ''}, você conclui em ${monthLabel(st.forecast).toLowerCase()}.`
        : 'Sem aportes nos últimos 3 meses. Guarde um valor para ver a previsão.'

  return (
    <>
      <div className="mb-4 flex items-center gap-3 px-1">
        <CategoryIcon category={editing ? form : goal} size={52} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-semibold">{goal.name}</p>
          <p className="truncate text-[12px] text-label-2">
            {goal.deadline ? `Até ${fmtDate(goal.deadline)}` : 'Sem prazo'}
            {goal.monthly ? ` · ${money(goal.monthly)} por mês` : ''}
          </p>
        </div>
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
      </div>

      <Hero label="Guardado" icon={<Target className="size-6" strokeWidth={2} />} caption={<>de {money(goal.target)} · {Math.min(999, Math.round(st.ratio * 100))}%</>}>
        <Money value={st.saved} />
      </Hero>
      <Progress value={st.ratio} className="-mt-2 mb-5" />

      <Stats
        items={[
          { label: 'Falta', value: money(st.left) },
          { label: 'Ritmo recente', value: `${money(st.pace)}/mês` },
          { label: 'Previsão', value: finished ? 'Concluída' : st.forecast ? shortForecast(st.forecast) : '—', tone: st.onTrack ? 'green' : undefined },
          { label: 'Aporte planejado', value: goal.monthly ? money(goal.monthly) : '—' },
        ]}
      />

      <p className="-mt-3 mb-6 rounded-[22px] bg-surface p-4 text-[13px] leading-[19px] text-label-2 shadow-card">{note}</p>

      {/* meta alcançada ainda pode ser resgatada (é a hora de usar o dinheiro) */}
      {(!finished || st.saved > 0) && (
        <div className={clsx('mb-3 grid gap-3', !finished && st.saved > 0 ? 'grid-cols-2' : 'grid-cols-1')}>
          {!finished && (
            <Button onClick={() => startMove('guardar')} variant={move === 'guardar' ? 'filled' : 'tinted'}>
              <ArrowDownLeft className="size-[18px]" /> Guardar
            </Button>
          )}
          {st.saved > 0 && (
            <Button onClick={() => startMove('resgatar')} variant={move === 'resgatar' ? 'filled' : 'tinted'}>
              <ArrowUpRight className="size-[18px]" /> Resgatar
            </Button>
          )}
        </div>
      )}
      <AnimatePresence initial={false}>
        {move && (
          <motion.div key={move} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring} className="overflow-hidden">
            <Section
              header={move === 'guardar' ? 'Guardar dinheiro' : 'Resgatar dinheiro'}
              footer={move === 'guardar' ? 'Com uma conta escolhida, o valor sai do saldo dela.' : 'Com uma conta escolhida, o valor volta para o saldo dela.'}
            >
              <MoneyField label="Valor" value={amount} onChange={setAmount} />
              <SelectField
                label={move === 'guardar' ? 'Saiu da conta' : 'Voltou para a conta'}
                value={accountId}
                onChange={setAccountId}
                placeholder="Nenhuma"
                options={f.accounts.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name }))}
              />
              <TextField label="Data" type="date" value={date} onChange={(v) => v && setDate(v)} />
            </Section>
            <Button onClick={doMove} className={clsx('-mt-3 mb-6', amount <= 0 && 'pointer-events-none opacity-40')}>
              <Check className="size-[18px]" /> {move === 'guardar' ? `Guardar ${money(amount)}` : `Resgatar ${money(amount)}`}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {history.length > 0 && (
        <Section header="Movimentos">
          {history.map((c) => (
            <div key={c.id} className="relative flex min-h-[52px] items-center gap-3 px-4 py-2">
              <span className={clsx('grid size-8 shrink-0 place-items-center rounded-full', c.amount >= 0 ? 'bg-tint/10 text-green' : 'bg-orange/15 text-orange')}>
                {c.amount >= 0 ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium">{fmtDate(c.date)}</span>
                <span className="block truncate text-[12px] text-label-2">{[c.amount >= 0 ? 'Aplicação' : 'Resgate', c.accountId && accounts.get(c.accountId)].filter(Boolean).join(' · ')}</span>
              </span>
              <span className={clsx('tabular text-right text-[15px] font-semibold', c.amount >= 0 && 'text-green')}>
                {c.amount >= 0 ? '+' : '−'} {money(Math.abs(c.amount))}
              </span>
              <button
                aria-label="Desfazer movimento"
                onClick={() => {
                  // tirar um aporte não pode deixar a meta com saldo negativo (houve resgate depois)
                  if (st.saved - c.amount < -0.005) return toast('Desfaça antes o resgate')
                  if (!confirm('Desfazer este movimento?')) return
                  haptic('medium')
                  removeContribution(goal.id, c.id)
                }}
                className="grid size-8 shrink-0 place-items-center rounded-full bg-red/10 text-red"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </Section>
      )}

      <Button variant="tinted" className="mb-3" onClick={() => (haptic(), setEditing((v) => !v), setForm(fromGoal(goal)))}>
        <Pencil className="size-[18px]" /> {editing ? 'Cancelar edição' : 'Editar meta'}
      </Button>
      <AnimatePresence initial={false}>
        {editing && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring} className="overflow-hidden pt-3">
            <GoalFields form={form} set={set} />
            <Projection goal={{ ...draftGoal(form, f.ref, goal.contributions), id: goal.id }} day={f.ref} />
            <Button onClick={save} className="mb-6">
              <Check className="size-[18px]" /> Salvar alterações
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <Button
        variant="tinted"
        className="mb-3"
        onClick={() => {
          updateGoal(goal.id, { completedAt: goal.completedAt ? undefined : today() })
          toast(goal.completedAt ? 'Meta reaberta' : 'Meta concluída')
        }}
      >
        {goal.completedAt ? <RotateCcw className="size-[18px]" /> : <PartyPopper className="size-[18px]" />} {goal.completedAt ? 'Reabrir meta' : 'Concluir meta'}
      </Button>
      <Button
        variant="danger"
        onClick={() => {
          if (!confirm(`Excluir a meta "${goal.name}"? O histórico de aportes também some e o dinheiro volta para o saldo das contas usadas.`)) return
          removeGoal(goal.id)
          toast('Meta excluída')
          onClose()
        }}
      >
        <Trash2 className="size-[18px]" /> Excluir meta
      </Button>
    </>
  )
}
