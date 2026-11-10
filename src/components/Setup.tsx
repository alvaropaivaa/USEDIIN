import { useId, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronLeft, Plus, X } from 'lucide-react'
import clsx from 'clsx'
import { useData } from '../lib/store'
import { haptic } from '../lib/haptics'
import { money } from '../lib/format'
import { nextDay, today } from '../lib/dates'
import { bankColor, cardColor, popularBanks, shortBankName, type BankInfo } from '../lib/banks'
import { palette } from '../lib/categories'
import type { Recurrence } from '../lib/ledger'
import { BankLogo, BankPicker } from './banks'
import { CategoryIcon } from './finance'
import { Mascot } from './mascots'
import { MoneyField, Section } from './ui'

// Passo a passo do começo da conta (settings.start = 'setup'): bancos, saldo de cada conta, renda e o dia em
// que cai, cartões de crédito e contas fixas. Cada etapa salva ao tocar em "Continuar"; o que já existe aparece
// como "já cadastrado" e não é criado de novo (dá para abrir o passo a passo outra vez sem duplicar nada).

type Step = 'ola' | 'bancos' | 'saldos' | 'renda' | 'cartoes' | 'faturas' | 'fixas' | 'pronto'

const SECTIONS = ['Contas', 'Renda', 'Cartões', 'Contas fixas']
const sectionOf: Partial<Record<Step, number>> = { bancos: 0, saldos: 0, renda: 1, cartoes: 2, faturas: 2, fixas: 3 }

const CASH = 'carteira'

// contas fixas mais comuns, cada uma na sua categoria padrão
const BILLS = [
  { key: 'aluguel', label: 'Aluguel ou financiamento', name: 'Aluguel', cat: 'cat-aluguel', icon: 'predio' },
  { key: 'condominio', label: 'Condomínio', name: 'Condomínio', cat: 'cat-condominio', icon: 'predio' },
  { key: 'luz', label: 'Luz', name: 'Luz', cat: 'cat-luz', icon: 'luz' },
  { key: 'agua', label: 'Água e gás', name: 'Água e gás', cat: 'cat-agua', icon: 'agua' },
  { key: 'internet', label: 'Internet e celular', name: 'Internet', cat: 'cat-internet', icon: 'internet' },
  { key: 'plano-saude', label: 'Plano de saúde', name: 'Plano de saúde', cat: 'cat-plano-saude', icon: 'medico' },
  { key: 'academia', label: 'Academia', name: 'Academia', cat: 'cat-academia', icon: 'academia' },
  { key: 'mensalidade', label: 'Escola ou faculdade', name: 'Escola ou faculdade', cat: 'cat-mensalidade', icon: 'educacao' },
  { key: 'streaming', label: 'Streaming', name: 'Streaming', cat: 'cat-assinaturas', icon: 'streaming' },
] as const

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
const active = (r: Recurrence) => !r.until || r.until >= today()
const isSalary = (r: Recurrence) => r.template.type === 'receita' && (r.template.categoryId === 'cat-salario-mensal' || r.template.categoryId === 'cat-salario' || /salario/.test(norm(r.template.description)))

/** Fechamento da fatura: uma semana antes do vencimento (dá para ajustar no cartão). */
const closingFor = (due: number) => (due - 7 >= 1 ? due - 7 : due - 7 + 30)

// ─── Peças ───────────────────────────────────────────────────

const cents = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function MoneyInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <input
      inputMode="numeric"
      aria-label={label}
      value={`R$ ${cents.format(value)}`}
      onFocus={(e) => requestAnimationFrame(() => e.target.setSelectionRange(e.target.value.length, e.target.value.length))}
      onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '').slice(0, 13) || 0) / 100)}
      className="tabular w-[46%] min-w-0 bg-transparent text-right text-[16px] font-semibold text-label caret-tint outline-none focus:text-tint"
    />
  )
}

/** Linha "Vence dia" com a lista nativa (no celular vira a roleta do sistema). */
function DayField({ label, value, onChange }: { label: string; value: number; onChange: (d: number) => void }) {
  const id = useId()
  return (
    <div className="relative flex min-h-[54px] items-center gap-3 px-4 py-2">
      <label htmlFor={id} className="flex-1 text-[15px] font-medium text-label-2">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))} className="tabular rounded-full bg-fill px-3.5 py-1.5 text-[15px] font-semibold text-label outline-none">
        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>
            Dia {d}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Os 31 dias em grade, para o dia em que a renda cai. */
function DayGrid({ value, onChange }: { value: number; onChange: (d: number) => void }) {
  return (
    <div className="grid grid-cols-7 gap-1.5" role="radiogroup" aria-label="Dia do mês">
      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={d === value}
          onClick={() => (haptic(), onChange(d))}
          className={clsx('tabular grid h-10 place-items-center rounded-[12px] text-[14px] font-semibold transition-colors', d === value ? 'bg-label text-bg' : 'bg-surface text-label shadow-card')}
        >
          {d}
        </button>
      ))}
    </div>
  )
}

// a grade mostra os 15 mais usados (com o "Outro banco", quatro fileiras); o resto fica na busca
const TOP = popularBanks.slice(0, 15)

/** Bancos mais usados em grade, para marcar vários; os que já existem vêm marcados e travados. */
function BankGrid({ picked, locked, extra, onToggle, onOther }: { picked: Set<string>; locked: Set<string>; extra: BankInfo[]; onToggle: (b: BankInfo) => void; onOther: () => void }) {
  // fora dos 15: os escolhidos pela busca e os já cadastrados também aparecem
  const more = [...extra, ...popularBanks.filter((b) => locked.has(b.ispb))]
  const list = [...TOP, ...more.filter((b, i) => !TOP.some((p) => p.ispb === b.ispb) && more.findIndex((x) => x.ispb === b.ispb) === i)]
  return (
    <div className="grid grid-cols-4 gap-x-1 gap-y-4 rounded-[22px] bg-surface px-2 py-4 shadow-card min-[420px]:grid-cols-5">
      {list.map((b) => {
        const lock = locked.has(b.ispb)
        const on = lock || picked.has(b.ispb)
        return (
          <motion.button
            key={b.ispb}
            type="button"
            whileTap={lock ? undefined : { scale: 0.92 }}
            onClick={() => !lock && (haptic(), onToggle(b))}
            aria-pressed={on}
            disabled={lock}
            className="flex min-w-0 flex-col items-center gap-1.5 px-1"
          >
            <span className={clsx('relative rounded-full ring-offset-2 ring-offset-surface transition-shadow', on && 'ring-2 ring-tint')}>
              <BankLogo ispb={b.ispb} name={b.name} size={48} />
              {on && (
                <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full bg-tint text-white ring-2 ring-surface">
                  <Check className="size-3" strokeWidth={3} />
                </span>
              )}
            </span>
            <span className={clsx('line-clamp-2 w-full text-center text-[11.5px] leading-[14px]', on ? 'font-semibold text-label' : 'font-medium text-label-2')}>{lock ? 'Já cadastrado' : shortBankName(b.name)}</span>
          </motion.button>
        )
      })}
      <motion.button type="button" whileTap={{ scale: 0.92 }} onClick={() => (haptic(), onOther())} className="flex min-w-0 flex-col items-center gap-1.5 px-1">
        <span className="grid size-12 place-items-center rounded-full bg-fill text-label-2">
          <Plus className="size-5" />
        </span>
        <span className="w-full text-center text-[11.5px] font-medium leading-[14px] text-label-2">Outro banco</span>
      </motion.button>
    </div>
  )
}

function Title({ children, text }: { children: ReactNode; text?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.03em]">{children}</h1>
      {text && <p className="mt-2 text-[15px] leading-snug text-label-2">{text}</p>}
    </div>
  )
}

// ─── Passo a passo ───────────────────────────────────────────

export function Setup() {
  const accounts = useData((s) => s.accounts)
  const cardsNow = useData((s) => s.cards)
  const recurrences = useData((s) => s.recurrences)
  const categories = useData((s) => s.categories)
  const defaultAccount = useData((s) => s.settings.defaultAccount)
  const setSettings = useData((s) => s.setSettings)

  const [step, setStep] = useState<Step>('ola')
  const [trail, setTrail] = useState<Step[]>([])
  const [dir, setDir] = useState(1)
  const [searching, setSearching] = useState<'bancos' | 'cartoes' | null>(null)

  // contas
  const [banks, setBanks] = useState<BankInfo[]>([])
  const [cash, setCash] = useState(false)
  const [balances, setBalances] = useState<Record<string, number>>({})
  // renda
  const [income, setIncome] = useState(0)
  const [payday, setPayday] = useState(5)
  const [incomeAccount, setIncomeAccount] = useState('')
  // cartões
  const [cards, setCards] = useState<BankInfo[]>([])
  const [cardInfo, setCardInfo] = useState<Record<string, { due: number; limit: number }>>({})
  // contas fixas
  const [bills, setBills] = useState<Record<string, { on: boolean; amount: number; day: number }>>({})
  // o que este passo a passo criou (para o resumo do fim)
  const [made, setMade] = useState({ accounts: 0, income: 0, payday: 0, cards: 0, bills: 0 })

  const live = accounts.filter((a) => !a.archived)
  const haveBanks = new Set(live.flatMap((a) => (a.bank ? [a.bank] : [])))
  const haveCash = live.some((a) => a.kind === 'carteira')
  const haveCards = new Set(cardsNow.filter((c) => !c.archived).flatMap((c) => (c.bank ? [c.bank] : [])))
  const salary = recurrences.find((r) => active(r) && isSalary(r))
  const billExists = (b: (typeof BILLS)[number]) =>
    recurrences.some((r) => active(r) && r.template.type === 'despesa' && (b.key === 'streaming' ? norm(r.template.description) === 'streaming' : r.template.categoryId === b.cat))
  const catOr = (id: string) => (categories.some((c) => c.id === id) ? id : undefined)
  // conta que recebe e paga por padrão
  const mainAccount = (live.find((a) => a.id === defaultAccount) ?? live[0])?.id ?? ''

  const newBanks = banks.filter((b) => !haveBanks.has(b.ispb))
  const newCash = cash && !haveCash
  const newCards = cards.filter((b) => !haveCards.has(b.ispb))

  const go = (next: Step) => {
    haptic()
    setDir(1)
    setTrail((t) => [...t, step])
    setStep(next)
  }
  const back = () => {
    haptic()
    setDir(-1)
    setStep(trail.at(-1) ?? 'ola')
    setTrail((t) => t.slice(0, -1))
  }
  const finish = () => (haptic('medium'), setSettings({ start: 'steps' }))

  const toggle = (list: BankInfo[], set: (l: BankInfo[]) => void) => (b: BankInfo) =>
    set(list.some((x) => x.ispb === b.ispb) ? list.filter((x) => x.ispb !== b.ispb) : [...list, b])

  // ─── o que cada etapa salva ───
  const saveAccounts = () => {
    const st = useData.getState()
    let first = ''
    newBanks.forEach((b, i) => {
      const a = st.addAccount({ name: shortBankName(b.name), kind: 'corrente', initial: balances[b.ispb] ?? 0, color: bankColor(b.ispb) ?? palette[(i * 3) % palette.length], bank: b.ispb })
      first ||= a.id
    })
    if (newCash) {
      const a = st.addAccount({ name: 'Carteira', kind: 'carteira', initial: balances[CASH] ?? 0, color: '#65a30d' })
      first ||= a.id
    }
    if (first && !st.settings.defaultAccount) st.setSettings({ defaultAccount: first })
    setMade((m) => ({ ...m, accounts: m.accounts + newBanks.length + (newCash ? 1 : 0) }))
    setBanks([])
    setCash(false)
  }

  const saveIncome = () => {
    if (salary || income <= 0) return
    const accountId = incomeAccount || mainAccount
    useData.getState().addTransaction(
      { type: 'receita', description: 'Salário', amount: income, date: nextDay(payday), status: 'pendente', categoryId: catOr('cat-salario-mensal'), ...(accountId ? { accountId } : {}) },
      { mode: 'fixa', frequency: 'mensal' },
    )
    setMade((m) => ({ ...m, income, payday }))
  }

  const saveCards = () => {
    const st = useData.getState()
    for (const b of newCards) {
      const { due, limit } = cardInfo[b.ispb] ?? { due: 10, limit: 0 }
      // a fatura costuma sair da conta do mesmo banco
      const pay = live.find((a) => a.bank === b.ispb)?.id ?? mainAccount
      st.addCard({ name: shortBankName(b.name), bank: b.ispb, limit, closingDay: closingFor(due), dueDay: due, ...(pay ? { accountId: pay } : {}), color: cardColor({ bank: b.ispb }) })
    }
    setMade((m) => ({ ...m, cards: m.cards + newCards.length }))
    setCards([])
  }

  const saveBills = () => {
    const st = useData.getState()
    let n = 0
    for (const b of BILLS) {
      const x = bills[b.key]
      if (!x?.on || x.amount <= 0 || billExists(b)) continue
      st.addTransaction(
        { type: 'despesa', description: b.name, amount: x.amount, date: nextDay(x.day), status: 'pendente', categoryId: catOr(b.cat), ...(mainAccount ? { accountId: mainAccount } : {}) },
        { mode: 'fixa', frequency: 'mensal' },
      )
      n++
    }
    setMade((m) => ({ ...m, bills: m.bills + n }))
    setBills({})
  }

  // ─── telas ───
  const section = sectionOf[step]
  const mainName = live.find((a) => a.id === mainAccount)?.name

  let body: ReactNode
  let primary: { label: string; onClick: () => void; disabled?: boolean } | null = null
  let secondary: { label: string; onClick: () => void } | null = null

  if (step === 'ola') {
    body = (
      <div className="flex min-h-full flex-col items-center justify-center pb-10 text-center">
        <Mascot pose="nuvem" className="mb-6 h-44" />
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em]">Vamos montar o seu Dinn</h1>
        <p className="mt-3 max-w-[340px] text-[15px] leading-snug text-label-2">
          Umas perguntas rápidas e o app já começa com os seus bancos, a sua renda e o que você paga todo mês. Leva uns 2 minutos.
        </p>
      </div>
    )
    primary = { label: 'Começar', onClick: () => go('bancos') }
    secondary = { label: 'Fazer depois', onClick: finish }
  } else if (step === 'bancos') {
    const count = haveBanks.size + newBanks.length + (haveCash || cash ? 1 : 0)
    body = (
      <>
        <Title text="Marque todos. Cada um vira uma conta no app, com o saldo de cada um.">Em quais bancos você tem conta?</Title>
        <BankGrid picked={new Set(banks.map((b) => b.ispb))} locked={haveBanks} extra={banks} onToggle={toggle(banks, setBanks)} onOther={() => setSearching('bancos')} />
        <Section className="mt-3">
          <button type="button" disabled={haveCash} onClick={() => (haptic(), setCash((v) => !v))} aria-pressed={haveCash || cash} className="relative flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left">
            <CategoryIcon category={{ icon: 'carteira' }} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">Dinheiro em espécie</span>
              <span className="block text-[12px] text-label-2">{haveCash ? 'Já cadastrado' : 'Uma carteira para o dinheiro vivo'}</span>
            </span>
            <span className={clsx('grid size-6 shrink-0 place-items-center rounded-full', haveCash || cash ? 'bg-tint text-white' : 'ring-2 ring-separator')}>{(haveCash || cash) && <Check className="size-3.5" strokeWidth={3} />}</span>
          </button>
        </Section>
        <p className="tabular -mt-3 px-1 text-[13px] text-label-2">{count === 0 ? 'Nenhuma conta marcada' : `${count} ${count === 1 ? 'conta' : 'contas'}`}</p>
      </>
    )
    primary = { label: 'Continuar', onClick: () => go(newBanks.length || newCash ? 'saldos' : 'renda') }
  } else if (step === 'saldos') {
    body = (
      <>
        <Title text="Pode ser aproximado. Não sabe agora? Deixe zero e acerte depois.">Quanto tem em cada uma hoje?</Title>
        <Section>
          {newBanks.map((b) => (
            <div key={b.ispb} className="relative flex min-h-[58px] items-center gap-3 px-4 py-2">
              <BankLogo ispb={b.ispb} name={b.name} size={36} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{shortBankName(b.name)}</span>
              <MoneyInput label={`Saldo em ${shortBankName(b.name)}`} value={balances[b.ispb] ?? 0} onChange={(v) => setBalances((x) => ({ ...x, [b.ispb]: v }))} />
            </div>
          ))}
          {newCash && (
            <div className="relative flex min-h-[58px] items-center gap-3 px-4 py-2">
              <CategoryIcon category={{ icon: 'carteira' }} size={36} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">Carteira</span>
              <MoneyInput label="Dinheiro na carteira" value={balances[CASH] ?? 0} onChange={(v) => setBalances((x) => ({ ...x, [CASH]: v }))} />
            </div>
          )}
        </Section>
      </>
    )
    primary = { label: 'Continuar', onClick: () => (saveAccounts(), go('renda')) }
  } else if (step === 'renda') {
    body = salary ? (
      <>
        <Title text="Você já tem a renda do mês cadastrada como lançamento fixo.">Sua renda</Title>
        <Section footer="Para mudar o valor ou o dia, abra o salário em Lançamentos.">
          <div className="relative flex min-h-14 items-center gap-3 px-4 py-2.5">
            <CategoryIcon category={{ icon: 'salario' }} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold">{salary.template.description}</span>
              <span className="tabular block text-[12px] text-label-2">Todo dia {Number(salary.start.slice(8, 10))}</span>
            </span>
            <span className="tabular text-[15px] font-semibold text-green">{money(salary.template.amount)}</span>
          </div>
        </Section>
      </>
    ) : (
      <>
        <Title text="O salário vira um lançamento fixo: todo mês ele aparece como a receber, e você só dá baixa quando cair.">Quanto você recebe por mês?</Title>
        <Section>
          <MoneyField label="Salário" value={income} onChange={setIncome} />
        </Section>
        <p className="mb-2.5 px-1 text-[15px] font-semibold">Em que dia cai?</p>
        <DayGrid value={payday} onChange={setPayday} />
        {live.length > 1 && (
          <>
            <p className="mb-2.5 mt-6 px-1 text-[15px] font-semibold">Em qual conta?</p>
            <div className="flex flex-wrap gap-2">
              {live.map((a) => {
                const on = (incomeAccount || mainAccount) === a.id
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => (haptic(), setIncomeAccount(a.id))}
                    aria-pressed={on}
                    className={clsx('rounded-full px-3.5 py-2 text-[14px] font-medium transition-colors', on ? 'bg-label text-bg' : 'bg-surface text-label-2 shadow-card')}
                  >
                    {a.name}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </>
    )
    primary = { label: 'Continuar', onClick: () => (saveIncome(), go('cartoes')), disabled: !salary && income <= 0 }
    if (!salary) secondary = { label: 'Não tenho renda fixa', onClick: () => go('cartoes') }
  } else if (step === 'cartoes') {
    body = (
      <>
        <Title text="Marque os cartões de crédito que você usa. Cada um ganha a própria fatura, que fecha e vence sozinha.">Tem cartão de crédito?</Title>
        <BankGrid picked={new Set(cards.map((b) => b.ispb))} locked={haveCards} extra={cards} onToggle={toggle(cards, setCards)} onOther={() => setSearching('cartoes')} />
      </>
    )
    primary = { label: 'Continuar', onClick: () => go(newCards.length ? 'faturas' : 'fixas') }
    if (!newCards.length) secondary = { label: 'Não tenho cartão', onClick: () => go('fixas') }
  } else if (step === 'faturas') {
    body = (
      <>
        <Title text="A fatura fecha uma semana antes do vencimento; dá para ajustar depois no cartão.">Quando vence cada fatura?</Title>
        {newCards.map((b) => {
          const info = cardInfo[b.ispb] ?? { due: 10, limit: 0 }
          const set = (p: Partial<typeof info>) => setCardInfo((x) => ({ ...x, [b.ispb]: { ...info, ...p } }))
          return (
            <Section
              key={b.ispb}
              header={
                <span className="flex items-center gap-2">
                  <BankLogo ispb={b.ispb} name={b.name} size={24} /> {shortBankName(b.name)}
                </span>
              }
            >
              <DayField label="Vence dia" value={info.due} onChange={(due) => set({ due })} />
              <MoneyField label="Limite" value={info.limit} onChange={(limit) => set({ limit })} />
            </Section>
          )
        })}
      </>
    )
    primary = { label: 'Continuar', onClick: () => (saveCards(), go('fixas')) }
  } else if (step === 'fixas') {
    body = (
      <>
        <Title text={`Marque e diga o valor e o dia. Todo mês cada uma aparece como a pagar${mainName ? `, saindo de ${mainName}` : ''}.`}>O que você paga todo mês?</Title>
        <Section>
          {BILLS.map((b) => {
            const exists = billExists(b)
            const x = bills[b.key] ?? { on: false, amount: 0, day: 10 }
            const set = (p: Partial<typeof x>) => setBills((all) => ({ ...all, [b.key]: { ...x, ...p } }))
            const on = exists || x.on
            return (
              <div key={b.key} className="relative">
                <button type="button" disabled={exists} onClick={() => (haptic(), set({ on: !x.on }))} aria-expanded={x.on} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left">
                  <CategoryIcon category={{ icon: b.icon }} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{b.label}</span>
                    {exists && <span className="block text-[12px] text-label-2">Já cadastrada</span>}
                  </span>
                  <span className={clsx('grid size-6 shrink-0 place-items-center rounded-full', on ? 'bg-tint text-white' : 'ring-2 ring-separator')}>{on && <Check className="size-3.5" strokeWidth={3} />}</span>
                </button>
                <AnimatePresence initial={false}>
                  {x.on && !exists && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="mx-4 mb-3 overflow-hidden rounded-[16px] bg-fill/50">
                        <MoneyField label="Valor" value={x.amount} onChange={(amount) => set({ amount })} />
                        <DayField label="Vence dia" value={x.day} onChange={(day) => set({ day })} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </Section>
      </>
    )
    primary = { label: 'Concluir', onClick: () => (saveBills(), go('pronto')) }
  } else {
    const lines = [
      made.accounts > 0 && `${made.accounts} ${made.accounts === 1 ? 'conta cadastrada' : 'contas cadastradas'}`,
      made.income > 0 && `Salário de ${money(made.income)} todo dia ${made.payday}`,
      made.cards > 0 && `${made.cards} ${made.cards === 1 ? 'cartão de crédito' : 'cartões de crédito'}`,
      made.bills > 0 && `${made.bills} ${made.bills === 1 ? 'conta fixa por mês' : 'contas fixas por mês'}`,
    ].filter(Boolean) as string[]
    body = (
      <div className="flex min-h-full flex-col items-center justify-center pb-10 text-center">
        <Mascot pose="metas" className="mb-6 h-44" />
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em]">Pronto, seu Dinn está montado</h1>
        {lines.length ? (
          <ul className="mt-6 w-full max-w-[360px] space-y-2.5 text-left">
            {lines.map((l) => (
              <li key={l} className="flex items-center gap-3 rounded-[16px] bg-surface px-4 py-3 text-[15px] font-medium shadow-card">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-tint text-white">
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
                {l}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 max-w-[340px] text-[15px] leading-snug text-label-2">Tudo bem. Dá para cadastrar contas, cartões e contas fixas depois, pelo botão +.</p>
        )}
      </div>
    )
    primary = { label: 'Ir para o início', onClick: finish }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="pt-safe fixed inset-0 z-[60] flex flex-col bg-bg" role="dialog" aria-modal aria-label="Montar o Dinn">
      {/* topo: voltar, as quatro partes e sair */}
      <div className="mx-auto flex h-14 w-full max-w-xl shrink-0 items-center gap-3 px-3">
        <span className="w-24">
          {trail.length > 0 && step !== 'pronto' && (
            <button type="button" onClick={back} aria-label="Voltar" className="grid size-10 place-items-center rounded-full text-label active:bg-fill">
              <ChevronLeft className="size-6" />
            </button>
          )}
        </span>
        <div className="flex flex-1 justify-center gap-1.5" aria-hidden={section === undefined}>
          {section !== undefined &&
            SECTIONS.map((s, i) => (
              <span key={s} title={s} className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill">
                <motion.span className="block h-full rounded-full bg-tint" initial={false} animate={{ width: i <= section ? '100%' : '0%' }} transition={{ duration: 0.4 }} />
              </span>
            ))}
        </div>
        <span className="flex w-24 justify-end">
          {step !== 'ola' && step !== 'pronto' && (
            <button type="button" onClick={finish} className="whitespace-nowrap px-1 py-2 text-[14px] font-semibold text-label-2">
              Fazer depois
            </button>
          )}
        </span>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={step}
            custom={dir}
            initial={{ opacity: 0, x: 24 * dir }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 * dir }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            className="mx-auto h-full w-full max-w-xl px-5 pb-6 pt-4"
          >
            {body}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* rodapé: a ação principal e, quando cabe, a alternativa */}
      <div className="mx-auto w-full max-w-xl shrink-0 px-5 pb-[max(var(--sab),16px)] pt-3">
        {primary && (
          <motion.button
            type="button"
            whileTap={primary.disabled ? undefined : { scale: 0.97 }}
            disabled={primary.disabled}
            onClick={() => (haptic('medium'), primary.onClick())}
            className="grad-btn flex h-[52px] w-full items-center justify-center rounded-[20px] text-[16px] font-semibold text-white transition-opacity disabled:opacity-40"
          >
            {primary.label}
          </motion.button>
        )}
        {secondary && (
          <button type="button" onClick={secondary.onClick} className="mt-1 h-11 w-full text-[15px] font-semibold text-tint">
            {secondary.label}
          </button>
        )}
      </div>

      {/* outro banco: a busca entre todas as instituições */}
      <AnimatePresence>
        {searching && (
          <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }} className="pt-safe absolute inset-0 z-10 flex flex-col bg-bg">
            <div className="mx-auto flex h-14 w-full max-w-xl shrink-0 items-center justify-between px-5">
              <h2 className="text-[17px] font-semibold">Escolha o banco</h2>
              <button type="button" onClick={() => setSearching(null)} aria-label="Fechar" className="grid size-9 place-items-center rounded-full bg-fill text-label-2">
                <X className="size-4" />
              </button>
            </div>
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-xl px-5 pt-2">
                <BankPicker
                  onPick={(b) => {
                    if (b) {
                      const [list, set] = searching === 'bancos' ? [banks, setBanks] : [cards, setCards]
                      if (!list.some((x) => x.ispb === b.ispb)) set([...list, b])
                    }
                    setSearching(null)
                  }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
