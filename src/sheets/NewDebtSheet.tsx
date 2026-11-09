import { useEffect, useMemo, useState } from 'react'
import { HandCoins } from 'lucide-react'
import { fmtDate } from '../lib/dates'
import { money } from '../lib/format'
import { buildSchedule, firstDueFor, type DebtKind, type Direction, type Frequency, type InterestMode } from '../lib/loans'
import { useData, useUI } from '../lib/store'
import { Sheet, toast } from '../components/sheet'
import { Button, Hero, Money, MoneyField, NumberField, PercentField, Section, Segmented, SelectField, Stats, TextField, Toggle, maskPhone } from '../components/ui'
import { frequencyOptions, kindOptions, modeOptions } from './DebtSheet'

/** Limite de parcelas (50 anos mensais): evita gerar milhares de parcelas por engano. */
const MAX_COUNT = 600

// sugestões de cada tipo (dá para mudar tudo)
const kindDefaults: Record<DebtKind, { rate: number; frequency: Frequency; count: number; mode: InterestMode }> = {
  emprestimo: { rate: 0.035, frequency: 'mensal', count: 12, mode: 'composto' },
  financiamento: { rate: 0.0149, frequency: 'mensal', count: 48, mode: 'composto' },
  pessoal: { rate: 0, frequency: 'mensal', count: 4, mode: 'simples' },
  acordo: { rate: 0, frequency: 'mensal', count: 6, mode: 'simples' },
}

/** Registrar uma dívida (eu devo) ou um empréstimo que fiz (me devem). */
export default function NewDebtSheet() {
  const { open, direction: preset, draft } = useUI((s) => s.newDebt)
  const { openNewDebt, openDebt } = useUI()
  const accounts = useData((s) => s.accounts)
  const defaultAccount = useData((s) => s.settings.defaultAccount)
  const addDebt = useData((s) => s.addDebt)

  const [direction, setDirection] = useState<Direction>('pagar')
  const [kind, setKind] = useState<DebtKind>('emprestimo')
  const [person, setPerson] = useState('')
  const [phone, setPhone] = useState('')
  const [principal, setPrincipal] = useState(1000)
  const [rate, setRate] = useState(0.035)
  const [mode, setMode] = useState<InterestMode>('composto')
  const [frequency, setFrequency] = useState<Frequency>('mensal')
  const [count, setCount] = useState(12)
  const [firstDue, setFirstDue] = useState(firstDueFor('mensal'))
  const [accountId, setAccountId] = useState('')
  const [register, setRegister] = useState(false)
  const [note, setNote] = useState('')

  // reinicia o formulário a cada abertura (ou com as condições vindas do simulador)
  useEffect(() => {
    if (!open) return
    const dir = preset ?? 'pagar'
    const k: DebtKind = draft ? 'financiamento' : dir === 'pagar' ? 'emprestimo' : 'pessoal'
    const d = kindDefaults[k]
    setDirection(dir)
    setKind(k)
    setPerson('')
    setPhone('')
    setPrincipal(draft?.principal ?? 1000)
    setRate(draft?.rate ?? d.rate)
    setMode(draft?.mode ?? d.mode)
    setFrequency(draft?.frequency ?? d.frequency)
    setCount(Math.min(MAX_COUNT, Math.max(1, Math.round(draft?.count ?? d.count))))
    setFirstDue(firstDueFor(draft?.frequency ?? d.frequency))
    setAccountId(accounts.some((a) => a.id === defaultAccount && !a.archived) ? defaultAccount : (accounts.find((a) => !a.archived)?.id ?? ''))
    setRegister(false)
    setNote('')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const schedule = useMemo(
    () => buildSchedule({ principal, rate, mode, frequency, count: Math.min(MAX_COUNT, Math.max(1, count)), firstDue }),
    [principal, rate, mode, frequency, count, firstDue],
  )
  const total = schedule.reduce((s, x) => s + x.amount, 0)
  const owe = direction === 'pagar'
  const valid = principal > 0 && count >= 1 && person.trim().length > 1
  const accountName = accounts.find((a) => a.id === accountId)?.name

  const pickKind = (k: DebtKind) => {
    setKind(k)
    const d = kindDefaults[k]
    setRate(d.rate)
    setMode(d.mode)
    setFrequency(d.frequency)
    setCount(d.count)
    setFirstDue(firstDueFor(d.frequency))
  }

  const create = () => {
    if (!valid) return
    const d = addDebt({
      direction,
      kind,
      person,
      phone: !owe && phone ? phone : undefined,
      accountId: accountId || undefined,
      note,
      register: register && !!accountId,
      principal,
      rate,
      mode,
      frequency,
      count: Math.min(MAX_COUNT, Math.max(1, Math.round(count))),
      firstDue,
    })
    openNewDebt(false)
    toast(owe ? 'Dívida registrada' : 'Empréstimo registrado')
    setTimeout(() => openDebt(d.id), 350)
  }

  return (
    <Sheet open={open} onOpenChange={(o) => openNewDebt(o)} title={owe ? 'Nova dívida' : 'Novo empréstimo'}>
      <Segmented
        value={direction}
        onChange={setDirection}
        options={[
          { value: 'pagar', label: 'Eu devo' },
          { value: 'receber', label: 'Me devem' },
        ]}
      />
      <Segmented value={kind} onChange={pickKind} options={kindOptions.map((k) => ({ ...k, label: k.value === 'pessoal' ? 'Pessoal' : k.value === 'acordo' ? 'Acordo' : k.label }))} />

      <Section header="Com quem" footer={owe ? undefined : 'O WhatsApp é usado para lembrar da parcela, com o Pix já no valor.'}>
        <TextField label={owe ? 'Credor' : 'Quem deve'} value={person} onChange={setPerson} placeholder={owe ? 'Banco, financeira, parente…' : 'Nome de quem te deve'} />
        {!owe && <TextField label="WhatsApp" type="tel" inputMode="tel" value={phone} onChange={(v) => setPhone(maskPhone(v))} placeholder="(11) 98765-4321" />}
      </Section>

      <Section header="Condições">
        <MoneyField label={owe ? 'Valor emprestado' : 'Valor que emprestei'} value={principal} onChange={setPrincipal} />
        <PercentField label="Juros (a.m.)" value={rate} onChange={setRate} />
        <NumberField label="Parcelas" value={count} onChange={(v) => setCount(Math.min(MAX_COUNT, Math.max(0, Math.round(v))))} suffix="x" />
        <TextField label="1º vencimento" type="date" value={firstDue} onChange={(v) => v && setFirstDue(v)} />
      </Section>

      <h3 className="mb-2.5 px-1 text-[15px] font-bold">Frequência</h3>
      <Segmented
        value={frequency}
        onChange={(f) => {
          setFrequency(f)
          setFirstDue(firstDueFor(f))
        }}
        options={frequencyOptions}
      />
      {rate > 0 && <Segmented value={mode} onChange={setMode} options={modeOptions} />}

      <Section
        header="Conta"
        footer={owe ? 'As parcelas pagas saem desta conta (dá para trocar a cada pagamento).' : 'As parcelas recebidas entram nesta conta (dá para trocar a cada recebimento).'}
      >
        <SelectField label="Conta" value={accountId} onChange={setAccountId} placeholder="Nenhuma" options={accounts.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name }))} />
        {accountId && (
          <Toggle
            label={owe ? 'Lançar a entrada agora' : 'Lançar a saída agora'}
            detail={`${owe ? 'Entrada' : 'Saída'} de ${money(principal)} em ${accountName}`}
            checked={register}
            onChange={setRegister}
          />
        )}
        <TextField label="Observação" value={note} onChange={setNote} placeholder="Opcional" />
      </Section>

      <Hero label="Valor da parcela" icon={<HandCoins className="size-6" strokeWidth={2} />} caption={<>{schedule.length}x · última em {fmtDate(schedule.at(-1)!.due)}</>}>
        <Money value={schedule[0]?.amount ?? 0} />
      </Hero>
      <Stats
        items={[
          { label: owe ? 'Total a pagar' : 'Total a receber', value: money(total) },
          { label: 'Juros', value: money(total - principal), tone: owe ? undefined : 'green' },
        ]}
      />

      <Button onClick={create} className={valid ? '' : 'pointer-events-none opacity-40'}>
        <HandCoins className="size-[18px]" /> {owe ? 'Registrar dívida' : 'Registrar empréstimo'}
      </Button>
    </Sheet>
  )
}
