import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, FileText, QrCode, RefreshCw, Send, Trash2, Wallet, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { fmtDate, relDay, today } from '../lib/dates'
import { money, percent } from '../lib/format'
import {
  buildSchedule,
  debtCode,
  debtKindLabel,
  firstDueFor,
  frequencyLabel,
  lateCharges,
  summarize,
  type DebtKind,
  type Frequency,
  type InterestMode,
} from '../lib/loans'
import { useData, useUI } from '../lib/store'
import { haptic } from '../lib/haptics'
import { buildCharge, sendCharge } from '../lib/charge'
import { shareReceipt, type ReceiptData } from '../lib/receipt'
import { printContract } from '../lib/contractDoc'
import { PixQR } from '../components/PixQR'
import { WhatsAppIcon } from '../components/icons'
import { Sheet, toast } from '../components/sheet'
import { DebtBadge, installmentText } from '../components/finance'
import {
  Avatar,
  Button,
  Hero,
  Money,
  MoneyField,
  NumberField,
  PercentField,
  Progress,
  Row,
  Section,
  Segmented,
  SelectField,
  Stats,
  TextField,
  Toggle,
  maskPhone,
  spring,
} from '../components/ui'

export const frequencyOptions = (['diaria', 'semanal', 'quinzenal', 'mensal'] as Frequency[]).map((f) => ({ value: f, label: frequencyLabel[f] }))
export const modeOptions: { value: InterestMode; label: string }[] = [
  { value: 'simples', label: 'Juros simples' },
  { value: 'composto', label: 'Compostos (Price)' },
]
export const kindOptions = (Object.keys(debtKindLabel) as DebtKind[]).map((k) => ({ value: k, label: debtKindLabel[k] }))

/** Detalhe de uma dívida: pagar (ou receber) parcelas, renegociar, lembrar e editar. */
export default function DebtSheet() {
  const id = useUI((s) => s.debtId)
  const close = useUI((s) => s.openDebt)
  const day = useUI((s) => s.day)
  const debt = useData((s) => s.debts.find((d) => d.id === id))
  const accounts = useData((s) => s.accounts)
  const settings = useData((s) => s.settings)
  // lançamentos ligados (pagamentos e a entrada/saída do valor): saem junto se a dívida for excluída
  const linked = useData((s) => (id ? s.transactions.filter((t) => t.debtId === id).length : 0))
  const { payDebt, undoDebtPayment, removeDebt, renegotiateDebt, updateDebt } = useData()

  const summary = useMemo(() => (debt ? summarize(debt, day) : null), [debt, day])
  const [amount, setAmount] = useState(0)
  const [extra, setExtra] = useState(0)
  const [date, setDate] = useState(today())
  const [accountId, setAccountId] = useState('')
  const [mode, setMode] = useState<'detail' | 'reneg'>('detail')
  const [reneg, setReneg] = useState({ rate: 0.05, mode: 'simples' as InterestMode, frequency: 'mensal' as Frequency, count: 4, firstDue: today() })
  const [withFees, setWithFees] = useState(true)
  const [showPix, setShowPix] = useState(false)
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)
  const [person, setPerson] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')

  // ao abrir (ou após pagar), sugere o valor da próxima parcela em aberto
  const suggested = summary?.overdue[0]?.remaining ?? summary?.next?.remaining ?? 0
  useEffect(() => {
    setAmount(suggested)
  }, [suggested, id])
  useEffect(() => {
    setReceipt(null)
    setShowPix(false)
    setWithFees(true)
    setExtra(0)
    setDate(today())
    if (!id) setMode('detail')
    else if (debt) {
      setReneg((r) => ({ ...r, rate: debt.rate, mode: debt.mode, frequency: debt.frequency, firstDue: firstDueFor(debt.frequency, day) }))
      // conta da dívida (mesmo arquivada) ou a padrão, desde que ainda exista
      const usable = (a?: string) => (a && accounts.some((x) => x.id === a) ? a : '')
      setAccountId(usable(debt.accountId) || (accounts.some((x) => x.id === settings.defaultAccount && !x.archived) ? settings.defaultAccount : ''))
      setPerson(debt.person)
      setPhone(debt.phone ?? '')
      setNote(debt.note ?? '')
    }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const renegPreview = useMemo(() => (summary ? buildSchedule({ ...reneg, principal: summary.open }) : []), [reneg, summary])

  if (!debt || !summary) return <Sheet open={false} onOpenChange={() => close(null)} title="">{null}</Sheet>

  const owe = debt.direction === 'pagar'
  const code = `#${debtCode(debt.id)}`
  const charge = summary.overdue[0] ?? summary.next
  // multa e juros só das parcelas atrasadas que este valor alcança (o pagamento abate das mais antigas)
  const feesFor = (value: number) => {
    let left = Math.min(value, summary.open)
    let total = 0
    for (const inst of summary.overdue) {
      if (left <= 0.004) break
      total += lateCharges(inst, settings.late, day).total
      left -= inst.remaining
    }
    return Math.round(total * 100) / 100
  }
  const charges = owe ? 0 : feesFor(amount)
  const fee = owe ? extra : withFees ? charges : 0
  const built = !owe && charge && settings.pix.trim() ? buildCharge(settings, debt, charge, day) : null
  // chave Pix incompleta: sem QR Code (o banco recusaria o código)
  const pix = built?.pixCode ? built : null
  const active = accounts.filter((a) => !a.archived || a.id === accountId)
  const accountName = accounts.find((a) => a.id === accountId)?.name

  // dados editáveis: salvos ao fechar o painel
  const save = () => {
    const patch = { person: person.trim() || debt.person, phone: phone || undefined, note: note.trim() || undefined }
    if (patch.person !== debt.person || patch.phone !== debt.phone || patch.note !== debt.note) updateDebt(debt.id, patch)
  }

  const doPay = (value: number, extraValue = 0) => {
    const v = Math.round(Math.min(value, summary.open) * 100) / 100
    if (v <= 0) return toast('Digite o valor')
    payDebt(debt.id, v, extraValue, date, accountId)
    setExtra(0)
    if (!owe) {
      // parcelas cobertas por este recebimento, para o recibo
      const covered: number[] = []
      let left = v
      for (const i of summary.list) {
        if (i.status === 'pago' || left <= 0.004) continue
        covered.push(i.n)
        left -= i.remaining
      }
      setReceipt({
        owner: settings.owner,
        person: debt.person,
        code,
        amount: v,
        fee: extraValue,
        date,
        installment: covered.length > 1 ? `${covered[0]}–${covered.at(-1)}/${summary.count}` : `${covered[0]}/${summary.count}`,
        paidTotal: summary.paid + v,
        open: summary.open - v,
        kind: debtKindLabel[debt.kind],
      })
    }
    toast(`${money(v + extraValue)} ${owe ? 'pago' : 'recebido'}`)
  }

  const sendReceipt = async () => {
    if (!receipt) return
    try {
      const r = await shareReceipt(receipt)
      if (r === 'downloaded') toast('Recibo baixado')
      if (r !== 'cancelled') setReceipt(null)
    } catch {
      toast('Não deu para gerar o recibo')
    }
  }

  const lateDays = summary.overdue[0] ? lateCharges(summary.overdue[0], settings.late, day).days : 0

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && (save(), close(null))} title={mode === 'reneg' ? 'Renegociar' : owe ? 'Dívida' : 'Empréstimo'}>
      <div className="mb-4 flex items-center gap-3 px-1">
        <Avatar name={debt.person} size={48} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-semibold">{debt.person}</p>
          <p className="truncate text-[12px] text-label-2">
            {code} · {debtKindLabel[debt.kind]} · {frequencyLabel[debt.frequency]} · {percent(debt.rate)} a.m.
          </p>
        </div>
        <DebtBadge status={summary.status} />
      </div>

      {mode === 'reneg' ? (
        <>
          <Hero label="Saldo a renegociar" icon={<RefreshCw className="size-6" strokeWidth={2} />} caption={`Já pago: ${money(summary.paid)} (fica no histórico)`}>
            <Money value={summary.open} />
          </Hero>
          <Section header="Novas condições">
            <PercentField label="Juros (a.m.)" value={reneg.rate} onChange={(rate) => setReneg({ ...reneg, rate })} />
            <NumberField label="Parcelas" value={reneg.count} onChange={(count) => setReneg({ ...reneg, count: Math.min(600, Math.max(1, Math.round(count))) })} suffix="x" />
            <TextField label="1º vencimento" type="date" value={reneg.firstDue} onChange={(firstDue) => firstDue && setReneg({ ...reneg, firstDue })} />
          </Section>
          <Segmented value={reneg.frequency} onChange={(frequency) => setReneg({ ...reneg, frequency })} options={frequencyOptions} />
          <Segmented value={reneg.mode} onChange={(m) => setReneg({ ...reneg, mode: m })} options={modeOptions} />
          <Stats
            items={[
              { label: 'Nova parcela', value: money(renegPreview[0]?.amount ?? 0), tone: 'green' },
              { label: 'Novo total', value: money(renegPreview.reduce((s, x) => s + x.amount, 0)) },
            ]}
          />
          <Button
            onClick={() => {
              renegotiateDebt(debt.id, reneg)
              setMode('detail')
              toast('Renegociado')
            }}
          >
            <RefreshCw className="size-[18px]" /> Confirmar renegociação
          </Button>
          <Button variant="plain" className="mt-1" onClick={() => setMode('detail')}>
            Cancelar
          </Button>
        </>
      ) : (
        <>
          <Hero
            label={owe ? 'Saldo devedor' : 'Falta receber'}
            icon={<Wallet className="size-6" strokeWidth={2} />}
            caption={
              <>
                {owe ? 'Pago' : 'Recebido'} {money(summary.paid)} de {money(summary.total)}
                {summary.interest > 0 && ` · ${money(summary.interest)} de juros no total`}
              </>
            }
          >
            <Money value={summary.open} />
          </Hero>
          <Progress value={summary.total ? summary.paid / summary.total : 0} className="-mt-2 mb-5" />

          <AnimatePresence>
            {receipt && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={spring}
                className="overflow-hidden"
              >
                <div className="mb-5 flex items-center gap-3 rounded-[22px] bg-surface p-3 pl-4 shadow-card">
                  <CheckCircle2 className="size-6 shrink-0 text-green" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold">{money(receipt.amount + receipt.fee)} recebido</p>
                    <p className="text-[12px] text-label-2">Envie o recibo para {debt.person.split(' ')[0]}</p>
                  </div>
                  <button onClick={sendReceipt} className="grad-btn flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-white">
                    <Send className="size-4" /> Recibo
                  </button>
                  <button aria-label="Fechar" onClick={() => setReceipt(null)} className="grid size-8 place-items-center rounded-full text-label-3">
                    <X className="size-4" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {summary.status !== 'quitado' && (
            <>
              <Section
                header={owe ? 'Registrar pagamento' : 'Registrar recebimento'}
                footer={`Aceita valor parcial: ele abate das parcelas mais antigas primeiro. Vira um lançamento${accountName ? ` em ${accountName}` : ''}.`}
              >
                <MoneyField label={owe ? 'Valor pago' : 'Valor recebido'} value={amount} onChange={setAmount} />
                {owe ? (
                  <MoneyField label="Juros e multa pagos" value={extra} onChange={setExtra} />
                ) : (
                  charges > 0 && (
                    <Toggle
                      label="Cobrar multa e juros"
                      detail={`+ ${money(charges)} por atraso (${lateDays} ${lateDays === 1 ? 'dia' : 'dias'})`}
                      checked={withFees}
                      onChange={setWithFees}
                    />
                  )
                )}
                <SelectField
                  label="Conta"
                  value={accountId}
                  onChange={setAccountId}
                  placeholder="Nenhuma"
                  options={active.map((a) => ({ value: a.id, label: a.name }))}
                />
                <TextField label="Data" type="date" value={date} onChange={(v) => v && setDate(v)} />
              </Section>
              <div className="-mt-3 mb-5 flex gap-2">
                <Button className="flex-1" onClick={() => doPay(amount, fee)}>
                  <CheckCircle2 className="size-[18px]" /> {owe ? 'Pagar' : 'Receber'} {money(Math.min(amount, summary.open) + fee)}
                </Button>
              </div>
              <div className="mb-6 grid grid-cols-2 gap-3">
                {!owe && charge && (
                  <Button variant="tinted" onClick={() => sendCharge(settings, debt, charge)}>
                    <WhatsAppIcon className="size-[18px] text-[#1fa855]" /> Lembrar
                  </Button>
                )}
                <Button variant="tinted" className={owe ? 'col-span-2' : ''} onClick={() => setMode('reneg')}>
                  <RefreshCw className="size-[18px]" /> Renegociar
                </Button>
                {pix && (
                  <Button variant="tinted" onClick={() => setShowPix((v) => !v)}>
                    <QrCode className="size-[18px]" /> {showPix ? 'Ocultar Pix' : 'Pix QR Code'}
                  </Button>
                )}
                {!owe && (
                  <Button
                    variant="tinted"
                    className={pix ? '' : 'col-span-2'}
                    onClick={() => {
                      if (!printContract(debt, { name: settings.owner, city: settings.pixCity })) toast('Permita pop-ups')
                    }}
                  >
                    <FileText className="size-[18px]" /> Documento PDF
                  </Button>
                )}
              </div>
              {showPix && pix && <PixQR code={pix.pixCode} amount={pix.amount} />}
            </>
          )}

          <Section header={`Parcelas · ${summary.paidCount}/${summary.count} pagas`}>
            {summary.list.map((inst) => {
              const late = owe ? 0 : lateCharges(inst, settings.late, day).total
              return (
                <Row
                  key={inst.n}
                  label={`Parcela ${inst.n}/${inst.count}`}
                  detail={`${fmtDate(inst.due)}${/[a-z]/.test(relDay(inst.due, day)) ? ` · ${relDay(inst.due, day)}` : ''}${inst.status === 'parcial' || (inst.paid > 0 && inst.status !== 'pago') ? ` · pago ${money(inst.paid)}` : ''}${late ? ` · +${money(late)} encargos` : ''}`}
                  value={
                    <span className="flex flex-col items-end">
                      {money(inst.status === 'pago' ? inst.amount : inst.remaining)}
                      <span className={`text-[11px] font-semibold ${installmentText[inst.status].cls}`}>{installmentText[inst.status].label}</span>
                    </span>
                  }
                  onClick={inst.status === 'pago' ? undefined : () => doPay(inst.remaining)}
                />
              )
            })}
          </Section>

          {debt.payments.length > 0 && (
            <Section header={owe ? 'Pagamentos feitos' : 'Recebimentos'}>
              {[...debt.payments].reverse().map((p) => (
                <div key={p.id} className="relative flex min-h-[52px] items-center gap-3 px-4 py-2">
                  <CheckCircle2 className="size-5 shrink-0 text-green" />
                  <span className="flex-1 text-[14px] font-medium">{fmtDate(p.date)}</span>
                  <span className="tabular text-right text-[15px] font-semibold">
                    {money(p.amount)}
                    {p.fee ? <span className="block text-[11px] font-medium text-label-2">+ {money(p.fee)} juros e multa</span> : null}
                  </span>
                  <button
                    aria-label="Desfazer pagamento"
                    onClick={() => {
                      haptic('medium')
                      if (confirm(`Desfazer o ${owe ? 'pagamento' : 'recebimento'} de ${money(p.amount + (p.fee ?? 0))} em ${fmtDate(p.date)}? O lançamento dele também sai.`)) undoDebtPayment(debt.id, p.id)
                    }}
                    className="grid size-8 place-items-center rounded-full bg-red/10 text-red"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </Section>
          )}

          <Section header="Dados" footer={owe ? undefined : 'O WhatsApp é usado no botão Lembrar para mandar a parcela com o Pix.'}>
            <TextField label={owe ? 'Com quem' : 'Quem deve'} value={person} onChange={setPerson} placeholder={owe ? 'Banco, financeira, parente…' : 'Nome de quem te deve'} />
            {!owe && <TextField label="WhatsApp" type="tel" inputMode="tel" value={phone} onChange={(v) => setPhone(maskPhone(v))} placeholder="(11) 98765-4321" />}
            <SelectField label="Tipo" value={debt.kind} onChange={(kind) => updateDebt(debt.id, { kind })} options={kindOptions} />
            <SelectField
              label="Conta"
              value={debt.accountId ?? ''}
              onChange={(v) => updateDebt(debt.id, { accountId: v || undefined })}
              placeholder="Nenhuma"
              options={accounts.filter((a) => !a.archived || a.id === debt.accountId).map((a) => ({ value: a.id, label: a.name }))}
            />
            <TextField label="Observação" value={note} onChange={setNote} placeholder="Opcional" />
          </Section>

          <Button
            variant="danger"
            onClick={() => {
              const extraText = linked ? ` ${linked === 1 ? 'O lançamento ligado a ela também sai' : `Os ${linked} lançamentos ligados a ela (pagamentos e entrada do valor) também saem`}.` : ''
              if (confirm(`Excluir ${owe ? 'a dívida com' : 'o empréstimo para'} ${debt.person}?${extraText} Essa ação não pode ser desfeita.`)) {
                removeDebt(debt.id)
                close(null)
              }
            }}
          >
            <Trash2 className="size-[18px]" /> Excluir {owe ? 'dívida' : 'empréstimo'}
          </Button>
        </>
      )}
    </Sheet>
  )
}
