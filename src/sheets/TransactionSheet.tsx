import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeftRight, Check, CircleCheck, CreditCard, HandCoins, Info, MessageCircle, PencilLine, Plus, Repeat, RotateCcw, Tag, Trash2, Wallet } from 'lucide-react'
import clsx from 'clsx'
import { fmtDate, monthKey, monthLabel, today } from '../lib/dates'
import { money } from '../lib/format'
import { haptic } from '../lib/haptics'
import { parseQuick } from '../lib/quick'
import {
  byCategory,
  cardIndex,
  cashDate,
  invoiceDates,
  invoiceFor,
  monthRange,
  recurLabel,
  rootOf,
  splitInstallments,
  suggestCategory,
  type RecurFrequency,
  type Transaction,
  type TxType,
} from '../lib/ledger'
import { useData, useUI, type Repeat as RepeatInput, type Scope, type TxInput } from '../lib/store'
import { CategoryIcon, useFinance } from '../components/finance'
import { Sheet, toast } from '../components/sheet'
import { WhatsAppIcon } from '../components/icons'
import { Button, MoneyField, NumberField, Row, Section, Segmented, SelectField, TextField, Toggle } from '../components/ui'

// Painel de lançamento: novo (com o lançamento rápido em texto) ou editar.
// Em lançamentos repetidos (parcelas ou fixos), salvar e excluir perguntam o alcance aqui mesmo.

const typeTitle: Record<TxType, [string, string]> = {
  despesa: ['Nova despesa', 'Editar despesa'],
  receita: ['Nova receita', 'Editar receita'],
  transferencia: ['Transferência', 'Editar transferência'],
}

const typeWord: Record<TxType, string> = { despesa: 'Despesa', receita: 'Receita', transferencia: 'Transferência' }

type RepeatMode = RepeatInput['mode']

const monthWord = (key: string) => monthLabel(key).split(' ')[0].toLowerCase()

export default function TransactionSheet() {
  const { open, id, type: presetType, preset } = useUI((s) => s.tx)
  const { openTx, openAccount, openCategory, openCard, openDebt } = useUI()
  const f = useFinance()
  const settings = useData((s) => s.settings)
  const recurrences = useData((s) => s.recurrences)

  // o id fica guardado depois de fechar, para o painel não "virar" outro formulário na animação de saída
  const [editId, setEditId] = useState<string>()
  const live = editId ? f.transactions.find((t) => t.id === editId) : undefined
  // excluído agora: mostra o último estado enquanto o painel fecha
  const last = useRef<Transaction>(undefined)
  if (live) last.current = live
  const editing = live ?? (editId ? last.current : undefined)

  const [type, setType] = useState<TxType>('despesa')
  const [amount, setAmount] = useState(0)
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(today())
  const [categoryId, setCategoryId] = useState('')
  const [source, setSource] = useState('')
  const [to, setTo] = useState('')
  const [paid, setPaid] = useState(true)
  const [paidTouched, setPaidTouched] = useState(false)
  const [repeat, setRepeat] = useState<RepeatMode>('unica')
  const [count, setCount] = useState(2)
  const [freq, setFreq] = useState<RecurFrequency>('mensal')
  const [tags, setTags] = useState('')
  const [note, setNote] = useState('')
  const [quick, setQuick] = useState('')
  const [quickFilled, setQuickFilled] = useState(false)
  /** Etapa de alcance (lançamento repetido): salvar ou excluir. */
  const [step, setStep] = useState<null | 'save' | 'delete'>(null)

  const activeAccounts = f.accounts.filter((a) => !a.archived)
  const defaultAccount = () => (activeAccounts.some((a) => a.id === settings.defaultAccount) ? settings.defaultAccount : (activeAccounts[0]?.id ?? ''))

  // reinicia o formulário a cada abertura (antes de pintar: não aparece o lançamento anterior por um instante)
  useLayoutEffect(() => {
    if (!open) return
    setStep(null)
    setQuick('')
    setQuickFilled(false)
    setRepeat('unica')
    setCount(2)
    setFreq('mensal')
    const t = id ? useData.getState().transactions.find((x) => x.id === id) : undefined
    setEditId(t?.id)
    if (t) {
      setType(t.type)
      setAmount(t.amount)
      setDescription(t.description)
      setDate(t.date)
      setCategoryId(t.categoryId ?? '')
      setSource(t.cardId && t.type === 'despesa' ? `card:${t.cardId}` : (t.accountId ?? ''))
      setTo(t.toAccountId ?? '')
      setPaid(t.status === 'pago')
      setPaidTouched(true)
      setTags((t.tags ?? []).join(', '))
      setNote(t.note ?? '')
      return
    }
    const kind = presetType ?? preset?.type ?? 'despesa'
    const from = preset?.accountId ?? defaultAccount()
    setType(kind)
    setAmount(preset?.amount ?? 0)
    setDescription(preset?.description ?? '')
    setDate(preset?.date ?? today())
    setCategoryId(preset?.categoryId ?? '')
    setSource(preset?.cardId ? `card:${preset.cardId}` : from)
    setTo(preset?.toAccountId ?? (kind === 'transferencia' ? (activeAccounts.find((a) => a.id !== from)?.id ?? '') : ''))
    setPaid(preset?.status ? preset.status === 'pago' : true)
    setPaidTouched(!!preset?.status)
    setTags((preset?.tags ?? []).join(', '))
    setNote(preset?.note ?? '')
  }, [open, id]) // eslint-disable-line react-hooks/exhaustive-deps

  const ref = f.ref
  const cardId = type === 'despesa' && source.startsWith('card:') ? source.slice(5) : ''
  const card = cardId ? f.cardsIdx.get(cardId) : undefined
  const accountId = cardId ? '' : source
  // sem mexer no "Foi pago": pago se a data já chegou
  const isPaid = paidTouched ? paid : date <= ref
  const debt = editing?.debtId ? f.debts.find((d) => d.id === editing.debtId) : undefined
  const locked = !!editing?.debtId
  const readOnly = !!editing && editing.type === 'transferencia' && (!!editing.cardId || !!editing.adjust)
  const rule = editing?.groupId ? recurrences.find((r) => r.id === editing.groupId) : undefined
  const grouped = !!editing?.groupId

  // ─── Categoria: escolhida ou sugerida pela descrição ──────
  const suggested = useMemo(
    () => (type !== 'transferencia' && !categoryId && description.trim() ? suggestCategory(description, type, f.categories, f.transactions) : undefined),
    [type, categoryId, description, f.categories, f.transactions],
  )
  const effCat = categoryId || suggested || ''
  const root = rootOf(effCat, f.cats)
  const mains = f.categories.filter((c) => c.type === type && !c.parentId && (!c.archived || c.id === root?.id))
  const subs = root ? f.categories.filter((c) => c.parentId === root.id && (!c.archived || c.id === effCat)) : []

  const parsedTags = [...new Set(tags.split(',').map((t) => t.trim()).filter(Boolean))]

  const changeType = (t: TxType) => {
    setType(t)
    if (categoryId && f.cats.get(categoryId)?.type !== t) setCategoryId('')
    if (t !== 'despesa' && source.startsWith('card:')) setSource(defaultAccount())
    if (t === 'transferencia') {
      setRepeat('unica')
      const from = source.startsWith('card:') || !source ? defaultAccount() : source
      setSource(from)
      if (!to || to === from) setTo(activeAccounts.find((a) => a.id !== from)?.id ?? '')
    }
  }

  const fillQuick = () => {
    const r = parseQuick(quick, { categories: f.categories, accounts: f.accounts, cards: f.cards, history: f.transactions, ref })
    if (!r) return toast('Não achei o valor no texto')
    haptic('medium')
    setType(r.type)
    setAmount(r.amount)
    setDescription(r.description)
    setDate(r.date)
    setCategoryId(r.categoryId ?? '')
    setSource(r.cardId ? `card:${r.cardId}` : (r.accountId ?? defaultAccount()))
    setPaid(!r.pending)
    setPaidTouched(true)
    setQuickFilled(true)
  }

  // ─── Opções de conta ─────────────────────────────────────
  const keep = (archived: boolean | undefined, value: string) => !archived || value === source || value === to
  const accountOptions = f.accounts.filter((a) => keep(a.archived, a.id)).map((a) => ({ value: a.id, label: a.name, group: 'Contas' }))
  const payOptions = [...accountOptions, ...f.cards.filter((c) => keep(c.archived, `card:${c.id}`)).map((c) => ({ value: `card:${c.id}`, label: c.name, group: 'Cartões de crédito' }))]

  // fatura em que a compra entra
  const invoiceKey = card ? invoiceFor(card, date) : ''
  const invoiceDue = card ? invoiceDates(card, invoiceKey).due : ''

  const close = () => openTx(false)
  const after = (fn: () => void) => (close(), setTimeout(fn, 300))

  const input = (): TxInput => ({
    type,
    description: description.trim() || (type !== 'transferencia' ? f.cats.get(effCat)?.name : '') || typeWord[type],
    amount,
    date,
    status: card ? 'pago' : isPaid ? 'pago' : 'pendente',
    categoryId: type === 'transferencia' ? undefined : effCat || undefined,
    accountId: type === 'transferencia' ? source : accountId || undefined,
    toAccountId: type === 'transferencia' ? to : undefined,
    cardId: cardId || undefined,
    tags: parsedTags.length ? parsedTags : undefined,
    note: note.trim() || undefined,
  })

  const valid = () => {
    if (!(amount > 0)) return toast('Informe o valor'), false
    if (type === 'transferencia' && (!source || !to)) return toast('Escolha as duas contas'), false
    if (type === 'transferencia' && source === to) return toast('Escolha contas diferentes'), false
    if (!editing && repeat === 'parcelada' && count < 2) return toast('Informe as parcelas'), false
    return true
  }

  /** Avisa se a despesa passou (ou chegou perto) do limite da categoria no mês dela. */
  const budgetToast = (txId: string | undefined, fallback: string) => {
    const s = useData.getState()
    const t = s.transactions.find((x) => x.id === txId)
    const cats = new Map(s.categories.map((c) => [c.id, c]))
    const main = t?.type === 'despesa' ? rootOf(t.categoryId, cats) : undefined
    if (!t || !main?.budget) return toast(fallback)
    const idx = cardIndex(s.cards)
    const range = monthRange(monthKey(cashDate(t, idx)))
    const spent = byCategory(s.transactions, idx, s.categories, 'despesa', range.from, range.to).get(main.id) ?? 0
    const ratio = spent / main.budget
    if (ratio > 1 + 1e-9) toast(`Atenção: você passou do limite de ${main.name}`)
    else if (ratio >= s.settings.budgetAlert) toast(`${main.name}: ${Math.round(ratio * 100)}% do limite usado`)
    else toast(fallback)
  }

  const save = (scope: Scope = 'one') => {
    if (!valid()) return
    const s = useData.getState()
    if (editing) {
      const { type: t, amount: a, date: d, status: st, ...rest } = input()
      // pagamento de dívida: valor, tipo, data e situação vêm da dívida (desmarcar deixaria a dívida e o saldo diferentes)
      const patch: Partial<TxInput> = locked ? rest : { type: t, amount: a, date: d, status: st, ...rest }
      s.updateTransaction(editing.id, patch, scope)
      close()
      budgetToast(editing.id, 'Lançamento salvo')
      return
    }
    const r: RepeatInput = type === 'transferencia' || repeat === 'unica' ? { mode: 'unica' } : repeat === 'parcelada' ? { mode: 'parcelada', count } : { mode: 'fixa', frequency: freq }
    const created = s.addTransaction(input(), r)
    close()
    budgetToast(created.id, r.mode === 'parcelada' ? `${count} parcelas lançadas` : r.mode === 'fixa' ? 'Lançamento fixo criado' : 'Lançamento salvo')
  }

  const remove = (scope: Scope = 'one') => {
    if (!editing) return
    useData.getState().removeTransaction(editing.id, scope)
    close()
    toast(scope === 'one' ? 'Lançamento excluído' : 'Lançamentos excluídos')
  }

  const askSave = () => (grouped ? valid() && (haptic(), setStep('save')) : save())
  const askRemove = () => {
    if (grouped) return haptic(), setStep('delete')
    if (confirm(editing?.debtId ? 'Excluir este pagamento? Ele também sai da dívida.' : 'Excluir este lançamento?')) remove()
  }

  const title = typeTitle[type][editing ? 1 : 0]
  const installmentLabel = editing?.installment ? 'parcela' : 'lançamento'

  // ─── Somente leitura: pagamento de fatura e ajuste de saldo ───
  if (editing && readOnly) {
    const cardOf = editing.cardId ? f.cardsIdx.get(editing.cardId) : undefined
    const acc = f.accs.get(editing.accountId ?? editing.toAccountId ?? '')
    const isInvoice = !!editing.cardId
    return (
      <Sheet open={open} onOpenChange={(o) => !o && close()} title={isInvoice ? 'Pagamento de fatura' : 'Ajuste de saldo'}>
        <div className="mb-5 flex flex-col items-center px-4 pt-2 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-fill text-label-2">{isInvoice ? <CreditCard className="size-6" /> : <Wallet className="size-6" />}</span>
          <p className="tabular mt-3 text-[28px] font-semibold tracking-[-0.03em]">
            {isInvoice ? money(editing.amount) : `${editing.toAccountId ? '+' : '−'} ${money(editing.amount)}`}
          </p>
          <p className="mt-1 text-[13px] text-label-2">
            {isInvoice
              ? `Fatura ${cardOf?.name ?? ''} de ${editing.invoice ? monthWord(editing.invoice) : ''}, paga com ${acc?.name ?? 'conta'} em ${fmtDate(editing.date)}.`
              : `Saldo de ${acc?.name ?? 'conta'} acertado em ${fmtDate(editing.date)}. Não conta como receita nem despesa.`}
          </p>
        </div>
        {isInvoice && cardOf && (
          <Section>
            <Row icon={<CreditCard className="size-[18px]" />} label="Ver fatura" detail={cardOf.name} chevron onClick={() => after(() => openCard(true, cardOf.id, editing.invoice))} />
          </Section>
        )}
        <Button
          variant="danger"
          onClick={() => {
            if (!confirm(isInvoice ? 'Desfazer o pagamento desta fatura?' : 'Desfazer este ajuste de saldo?')) return
            remove()
          }}
        >
          <RotateCcw className="size-[18px]" /> {isInvoice ? 'Desfazer pagamento da fatura' : 'Desfazer ajuste'}
        </Button>
      </Sheet>
    )
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()} title={title}>
      <AnimatePresence mode="wait" initial={false}>
        {step ? (
          // ─── Alcance: só este, este e os próximos, toda a série ───
          <motion.div key="scope" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.16 }}>
            <div className="mb-5 flex flex-col items-center px-4 pt-2 text-center">
              <span className={clsx('grid size-14 place-items-center rounded-full', step === 'delete' ? 'bg-red/10 text-red' : 'bg-tint/10 text-tint')}>
                {step === 'delete' ? <Trash2 className="size-6" /> : <Repeat className="size-6" />}
              </span>
              <p className="mt-3 text-[17px] font-semibold">{step === 'delete' ? `Excluir ${installmentLabel} repetido` : `Alterar ${installmentLabel} repetido`}</p>
              <p className="mt-1 text-[13px] text-label-2">
                {editing?.installment
                  ? `Esta é a parcela ${editing.installment.n} de ${editing.installment.count}.`
                  : step === 'delete'
                    ? 'Excluir a partir deste para de repetir o lançamento fixo.'
                    : 'As datas das outras repetições não mudam.'}
              </p>
            </div>
            <Section>
              {(
                [
                  ['one', editing?.installment ? 'Só esta parcela' : 'Só este', 'As outras ficam como estão'],
                  ['next', editing?.installment ? 'Esta e as próximas' : 'Este e os próximos', 'As anteriores ficam como estão'],
                  ['all', editing?.installment ? 'Todas as parcelas' : 'Toda a série', 'Inclusive as anteriores'],
                ] as [Scope, string, string][]
              ).map(([scope, label, detail]) => (
                <Row
                  key={scope}
                  icon={step === 'delete' ? <Trash2 className="size-[18px] text-red" /> : <Check className="size-[18px]" />}
                  label={<span className={step === 'delete' ? 'text-red' : undefined}>{label}</span>}
                  detail={detail}
                  chevron
                  onClick={() => (step === 'delete' ? remove(scope) : save(scope))}
                />
              ))}
            </Section>
            <Button variant="plain" onClick={() => setStep(null)}>
              Cancelar
            </Button>
          </motion.div>
        ) : (
          <motion.div key="form" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.16 }}>
            {/* ─── Lançamento rápido: escreve como falaria ─── */}
            {!editing && (
              <form
                className="mb-5"
                onSubmit={(e) => {
                  e.preventDefault()
                  fillQuick()
                }}
              >
                <label className="flex h-12 items-center gap-2 rounded-full bg-surface pl-4 pr-1.5 shadow-card">
                  <PencilLine className="size-[18px] shrink-0 text-label-2" strokeWidth={1.75} />
                  <input
                    value={quick}
                    onChange={(e) => setQuick(e.target.value)}
                    placeholder='Escreva do seu jeito: "mercado 120 no cartão"'
                    aria-label="Lançamento rápido: escreva do seu jeito"
                    enterKeyHint="done"
                    className="min-w-0 flex-1 bg-transparent text-[15px] font-medium outline-none placeholder:font-normal placeholder:text-label-3"
                  />
                  {quick.trim() && (
                    <button type="submit" className="grad-btn h-9 shrink-0 rounded-full px-3.5 text-[13px] font-semibold text-white">
                      Preencher
                    </button>
                  )}
                </label>
                <p className={clsx('mt-1.5 px-3 text-[12px]', quickFilled ? 'font-medium text-tint' : 'text-label-2')}>
                  {quickFilled ? 'Preenchido a partir do texto. Confira antes de salvar.' : 'Ex.: "gastei 45 no ifood ontem", "recebi 2 mil de salário no Itaú".'}
                </p>
              </form>
            )}

            {/* ─── Vínculos (editar) ─── */}
            {editing && (editing.installment || rule || debt) && (
              <div className="mb-5 flex items-center gap-3 rounded-[20px] bg-surface p-3 pl-4 shadow-card">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-fill text-label-2">
                  {debt ? <HandCoins className="size-[18px]" /> : editing.installment ? <CreditCard className="size-[18px]" /> : <Repeat className="size-[18px]" />}
                </span>
                <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-label-2">
                  {debt ? (
                    <>
                      Lançado pela dívida <span className="font-semibold text-label">{debt.person}</span>. Valor e data vêm de lá.
                    </>
                  ) : editing.installment ? (
                    <>
                      Parcela <span className="font-semibold text-label">{editing.installment.n} de {editing.installment.count}</span>
                    </>
                  ) : (
                    <>
                      Lançamento fixo <span className="font-semibold text-label">({rule ? recurLabel[rule.frequency].toLowerCase() : 'repetido'})</span>
                    </>
                  )}
                </p>
                {debt && (
                  <button onClick={() => after(() => openDebt(debt.id))} className="shrink-0 rounded-full bg-fill px-3 py-1.5 text-[12.5px] font-semibold text-tint">
                    Abrir dívida
                  </button>
                )}
              </div>
            )}

            {/* tipo: no editar, só receita ↔ despesa; transferência não troca */}
            {!locked && (!editing || editing.type !== 'transferencia') && (
              <Segmented<TxType>
                value={type}
                onChange={changeType}
                options={
                  editing
                    ? [
                        { value: 'despesa', label: 'Despesa' },
                        { value: 'receita', label: 'Receita' },
                      ]
                    : [
                        { value: 'despesa', label: 'Despesa' },
                        { value: 'receita', label: 'Receita' },
                        { value: 'transferencia', label: 'Transferência' },
                      ]
                }
              />
            )}

            <Section>
              {locked ? <Row label="Valor" value={money(amount)} /> : <MoneyField label={repeat === 'parcelada' && !editing && type !== 'transferencia' ? 'Valor total' : 'Valor'} value={amount} onChange={setAmount} />}
              <TextField label="Descrição" value={description} onChange={setDescription} placeholder={type === 'receita' ? 'Ex.: Salário' : type === 'despesa' ? 'Ex.: Supermercado' : 'Ex.: Para a reserva'} />
              {locked ? <Row label="Data" value={fmtDate(date)} /> : <TextField label="Data" type="date" value={date} onChange={(v) => v && setDate(v)} />}
            </Section>

            {/* ─── Categoria ─── */}
            {type !== 'transferencia' && (
              <section className="mb-6">
                <div className="mb-2.5 flex items-center justify-between px-1">
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Categoria</h2>
                  <button onClick={() => after(() => openCategory(true, { type }))} className="flex items-center gap-1 text-[13px] font-semibold text-tint">
                    <Plus className="size-3.5" strokeWidth={2.6} /> Nova categoria
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-2 rounded-[22px] bg-surface p-3 shadow-card sm:grid-cols-5">
                  {mains.map((c) => {
                    const on = root?.id === c.id
                    return (
                      <motion.button
                        key={c.id}
                        whileTap={{ scale: 0.94 }}
                        onClick={() => (haptic(), setCategoryId(on && categoryId ? '' : c.id))}
                        className={clsx('flex min-w-0 flex-col items-center gap-1.5 rounded-[16px] px-1 py-2 transition-colors', on ? 'bg-tint/[0.08] ring-2 ring-tint' : 'hover:bg-fill/60')}
                      >
                        <CategoryIcon category={c} size={36} />
                        <span className={clsx('w-full truncate text-center text-[11px] leading-tight', on ? 'font-semibold text-label' : 'font-medium text-label-2')}>{c.name}</span>
                      </motion.button>
                    )
                  })}
                </div>
                {subs.length > 0 && (
                  <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
                    {[{ id: root!.id, name: 'Geral' }, ...subs].map((c) => {
                      const on = effCat === c.id
                      return (
                        <motion.button
                          key={c.id}
                          whileTap={{ scale: 0.94 }}
                          onClick={() => (haptic(), setCategoryId(c.id))}
                          className={clsx('shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors', on ? 'bg-label text-bg' : 'bg-surface text-label-2 shadow-card')}
                        >
                          {c.name}
                        </motion.button>
                      )
                    })}
                  </div>
                )}
                {suggested && !categoryId && (
                  <p className="mt-2 flex items-center gap-1.5 px-1 text-[12px] font-medium text-tint">
                    <Tag className="size-3.5" /> Categoria sugerida. Confira se está correta.
                  </p>
                )}
              </section>
            )}

            {/* ─── Conta, cartão ou contas da transferência ─── */}
            {!editing && activeAccounts.length === 0 && type !== 'transferencia' && !f.cards.some((c) => !c.archived) ? (
              <NoAccount text="Cadastre uma conta para acompanhar o saldo. Dá para salvar sem conta." onAdd={() => after(() => openAccount(true))} />
            ) : !editing && type === 'transferencia' && activeAccounts.length < 2 ? (
              <NoAccount text="Para transferir, cadastre pelo menos duas contas." onAdd={() => after(() => openAccount(true))} />
            ) : (
              <Section
                footer={
                  card
                    ? `Entra na fatura de ${monthWord(invoiceKey)} · vence ${fmtDate(invoiceDue).slice(0, 5)}.`
                    : type === 'transferencia'
                      ? 'Transferência não conta como receita nem despesa.'
                      : undefined
                }
              >
                {type === 'transferencia' ? (
                  <>
                    <SelectField label="De" value={source} options={accountOptions} placeholder={source ? undefined : 'Escolha'} onChange={setSource} />
                    <SelectField label="Para" value={to} options={accountOptions.filter((a) => a.value !== source)} placeholder={to ? undefined : 'Escolha'} onChange={setTo} />
                  </>
                ) : (
                  <SelectField
                    label={type === 'despesa' ? 'Pagar com' : 'Receber em'}
                    value={source}
                    options={type === 'despesa' && !locked ? payOptions : accountOptions}
                    placeholder="Nenhuma"
                    onChange={setSource}
                  />
                )}
                {!card && !locked && (
                  <Toggle
                    label={type === 'receita' ? 'Foi recebido' : type === 'transferencia' ? 'Já foi feita' : 'Foi pago'}
                    detail={
                      isPaid && date > ref
                        ? `Data no futuro. Se ainda não ${type === 'receita' ? 'recebeu' : 'pagou'}, desligue “${type === 'receita' ? 'Foi recebido' : 'Foi pago'}”.`
                        : isPaid
                          ? 'Já mexe no saldo da conta'
                          : `Fica em “${type === 'receita' ? 'a receber' : 'a pagar'}” até você marcar`
                    }
                    checked={isPaid}
                    onChange={(v) => (setPaid(v), setPaidTouched(true))}
                  />
                )}
              </Section>
            )}

            {/* ─── Repetição (só ao criar) ─── */}
            {!editing && type !== 'transferencia' && (
              <>
                <h3 className="mb-2.5 px-1 text-[15px] font-semibold tracking-[-0.01em]">Repetição</h3>
                <Segmented<RepeatMode>
                  value={repeat}
                  onChange={setRepeat}
                  options={[
                    { value: 'unica', label: 'Única' },
                    { value: 'parcelada', label: card ? 'Compra parcelada' : 'Parcelada' },
                    { value: 'fixa', label: 'Fixa' },
                  ]}
                />
                {repeat === 'parcelada' && (
                  <Section footer={amount > 0 ? `${count}x de ${money(splitInstallments(amount, count)[0])} · o valor informado é o total.` : 'O valor informado é o total da compra.'}>
                    <NumberField label="Parcelas" value={count} onChange={(v) => setCount(Math.min(120, Math.max(2, Math.round(v) || 2)))} suffix="x" />
                  </Section>
                )}
                {repeat === 'fixa' && (
                  <>
                    <Segmented<RecurFrequency>
                      value={freq}
                      onChange={setFreq}
                      options={(['semanal', 'mensal', 'anual'] as RecurFrequency[]).map((v) => ({ value: v, label: recurLabel[v] }))}
                    />
                    <p className="-mt-3 mb-6 px-1 text-[12px] leading-[17px] text-label-2">Gera os próximos 12 meses e continua sozinho. As próximas ficam como “{type === 'receita' ? 'a receber' : 'a pagar'}”.</p>
                  </>
                )}
              </>
            )}

            {/* ─── Detalhes ─── */}
            <Section footer={parsedTags.length ? undefined : 'Tags ajudam a juntar gastos de um assunto (ex.: viagem, reforma).'}>
              <TextField label="Tags" value={tags} onChange={setTags} placeholder="viagem, casa" />
              <TextField label="Observação" value={note} onChange={setNote} placeholder="Opcional" />
            </Section>
            {parsedTags.length > 0 && (
              <div className="-mt-4 mb-6 flex flex-wrap gap-1.5 px-1">
                {parsedTags.map((t) => (
                  <span key={t} className="rounded-full bg-tint/10 px-2.5 py-0.5 text-[12px] font-semibold text-green">
                    #{t}
                  </span>
                ))}
              </div>
            )}

            {/* ─── Ações ─── */}
            <Button onClick={askSave}>
              <CircleCheck className="size-[18px]" /> {editing ? 'Salvar alterações' : repeat === 'parcelada' && type !== 'transferencia' ? `Lançar ${count} parcelas` : 'Salvar'}
            </Button>

            {editing && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                {editing.type !== 'transferencia' && !editing.cardId && !editing.debtId ? (
                  <Button
                    variant="tinted"
                    onClick={() => {
                      const now = editing.status !== 'pago'
                      useData.getState().setPaid(editing.id, now)
                      close()
                      toast(now ? (editing.type === 'receita' ? 'Marcado como recebido' : 'Marcado como pago') : 'Marcado como não pago')
                    }}
                  >
                    {editing.status === 'pago' ? (
                      <>
                        <RotateCcw className="size-[18px]" /> Não {editing.type === 'receita' ? 'recebido' : 'pago'}
                      </>
                    ) : (
                      <>
                        <Check className="size-[18px] text-green" /> {editing.type === 'receita' ? 'Recebido' : 'Pago'}
                      </>
                    )}
                  </Button>
                ) : editing.cardId && editing.type === 'despesa' ? (
                  <Button variant="tinted" onClick={() => after(() => openCard(true, editing.cardId, editing.invoice))}>
                    <CreditCard className="size-[18px]" /> Ver fatura
                  </Button>
                ) : editing.debtId ? (
                  <Button variant="tinted" onClick={() => after(() => openDebt(editing.debtId!))}>
                    <HandCoins className="size-[18px]" /> Abrir dívida
                  </Button>
                ) : (
                  <Button variant="tinted" onClick={() => after(() => openAccount(true, editing.accountId ?? editing.toAccountId))}>
                    <ArrowLeftRight className="size-[18px]" /> Ver conta
                  </Button>
                )}
                <Button variant="tinted" className="text-red" onClick={askRemove}>
                  <Trash2 className="size-[18px]" /> Excluir
                </Button>
              </div>
            )}
            {editing?.via && (
              <p className="mt-3 flex items-center gap-1.5 px-1 text-[12px] text-label-2">
                {editing.via === 'whatsapp' ? <WhatsAppIcon className="size-3.5 shrink-0" /> : <MessageCircle className="size-3.5 shrink-0" />}
                {editing.via === 'whatsapp' ? 'Lançado pelo assistente do WhatsApp' : 'Lançado pelo assistente'}
              </p>
            )}
            {editing && !editing.cardId && !editing.debtId && editing.type !== 'transferencia' && (
              <p className="mt-3 flex items-start gap-1.5 px-1 text-[12px] leading-[17px] text-label-2">
                <Info className="mt-px size-3.5 shrink-0" />
                {editing.status === 'pago' ? 'Desmarcar volta o valor para “a pagar” e tira do saldo da conta.' : 'Marcar como pago já tira (ou soma) o valor no saldo da conta.'}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  )
}

/** Sem conta cadastrada: convite para cadastrar. */
function NoAccount({ text, onAdd }: { text: string; onAdd: () => void }) {
  return (
    <div className="mb-6 flex items-center gap-3 rounded-[22px] bg-surface p-4 shadow-card">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-tint/10 text-tint">
        <Wallet className="size-[18px]" />
      </span>
      <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-label-2">{text}</p>
      <button onClick={onAdd} className="grad-btn shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold text-white">
        Cadastrar conta
      </button>
    </div>
  )
}
