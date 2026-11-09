import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Archive, ArchiveRestore, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Check, ChevronLeft, ChevronRight, CreditCard, FileText, Plus, RotateCcw, Scale, Trash2, Wallet } from 'lucide-react'
import clsx from 'clsx'
import { diffDays, fmtDate, monthLabel, shiftMonth, today } from '../lib/dates'
import { money } from '../lib/format'
import { haptic } from '../lib/haptics'
import { palette } from '../lib/categories'
import { bankColor, cardColor, shortBankName, skinsFor, useBankName, type BankInfo } from '../lib/banks'
import {
  accountKindLabel,
  cardBrandLabel,
  cardUsage,
  invoice,
  invoiceFor,
  invoiceStatusLabel,
  rootOf,
  type Account,
  type AccountKind,
  type Card,
  type CardBrand,
  type InvoiceStatus,
  type Transaction,
} from '../lib/ledger'
import { emptyFilter, useData, useUI } from '../lib/store'
import { AccountIcon, BankField, BankPicker, CreditCard3D, SkinPicker } from '../components/banks'
import { Donut } from '../components/charts'
import { TxRow, useFinance } from '../components/finance'
import { Sheet, toast } from '../components/sheet'
import { Badge, Button, Hero, Money, MoneyField, NumberField, Section, SectionHeader, Segmented, SelectField, TextField, Toggle, spring } from '../components/ui'

// ─── Peças compartilhadas com a tela de Contas e cartões ─────

const kindOptions = (Object.keys(accountKindLabel) as AccountKind[]).map((k) => ({ value: k, label: accountKindLabel[k] }))
const brandOptions = (Object.keys(cardBrandLabel) as CardBrand[]).map((b) => ({ value: b, label: cardBrandLabel[b] }))

/** Bolinhas de cor (contas, cartões). */
export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="relative px-4 py-3">
      <p className="mb-2.5 text-[15px] font-medium text-label-2">Cor</p>
      <div role="radiogroup" aria-label="Cor" className="flex flex-wrap gap-2.5">
        {palette.map((c) => (
          <motion.button
            key={c}
            type="button"
            role="radio"
            aria-checked={c === value}
            aria-label={c}
            whileTap={{ scale: 0.88 }}
            onClick={() => (haptic(), onChange(c))}
            className={clsx('grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-surface transition-shadow', c === value && 'ring-2 ring-label')}
            style={{ background: c }}
          >
            {c === value && <Check className="size-4 text-white" strokeWidth={3} />}
          </motion.button>
        ))}
      </div>
    </div>
  )
}

const healthTone = (ratio: number) => (ratio > 0.8 ? 'red' : ratio > 0.5 ? 'orange' : 'green')
const healthBar = { green: 'bg-tint', orange: 'bg-orange', red: 'bg-red' } as const

/** Status da fatura em pílula: verde paga, vermelho vencida, laranja fechada ou em parte, cinza aberta. */
export function InvoiceBadge({ status }: { status: InvoiceStatus }) {
  if (status === 'fechada' || status === 'parcial')
    return <span className="inline-flex shrink-0 items-center rounded-full bg-orange/15 px-2 py-0.5 text-[11px] font-semibold text-orange">{invoiceStatusLabel[status]}</span>
  return <Badge tone={status === 'paga' ? 'green' : status === 'vencida' ? 'red' : 'gray'}>{invoiceStatusLabel[status]}</Badge>
}

/** "Mastercard · final 4821" */
const cardCaption = (card: Card) => [card.brand ? cardBrandLabel[card.brand] : 'Cartão de crédito', card.last4 && `final ${card.last4}`, card.archived && 'arquivado'].filter(Boolean).join(' · ')

/** Cartão na lista: o plástico em miniatura, a fatura atual, o limite usado e o ciclo. */
export function CardTile({ card, txs, day, onClick }: { card: Card; txs: Transaction[]; day: string; onClick?: () => void }) {
  const usage = cardUsage(card, txs)
  const inv = invoice(card, invoiceFor(card, day), txs, day)
  const tone = healthTone(usage.ratio)
  const Comp = onClick ? motion.button : motion.div
  return (
    <Comp
      whileTap={onClick ? { scale: 0.985 } : undefined}
      onClick={onClick ? () => (haptic(), onClick()) : undefined}
      className={clsx('mb-3 block w-full rounded-[22px] bg-surface p-4 text-left shadow-card transition-shadow lg:mb-0', onClick && 'hover:shadow-[0_0_0_1px_var(--separator),0_14px_32px_-16px_rgba(15,21,18,0.25)]', card.archived && 'opacity-60')}
    >
      <div className="flex items-center gap-4">
        <CreditCard3D card={card} interactive={false} bare className="w-[104px] shrink-0" />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold tracking-[-0.01em]">{card.name}</span>
          <span className="block truncate text-[12px] text-label-2">{cardCaption(card)}</span>
          <div className="mt-2 flex items-end justify-between gap-2">
            <span className="min-w-0">
              <span className="block text-[11.5px] text-label-2">Fatura atual</span>
              <span className="tabular block truncate text-[20px] font-semibold leading-tight tracking-[-0.02em]">
                <Money value={inv.open > 0 ? inv.open : inv.total} />
              </span>
            </span>
            <span className="mb-0.5">
              <InvoiceBadge status={inv.status} />
            </span>
          </div>
        </div>
      </div>
      <div className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-fill">
        <motion.div className={clsx('h-full rounded-full', healthBar[tone])} initial={false} animate={{ width: `${Math.min(100, usage.ratio * 100)}%` }} transition={spring} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[11.5px] text-label-2">
        <span className="tabular truncate">Disponível {money(usage.available)}</span>
        <span className="shrink-0">
          Fecha dia {card.closingDay} · vence dia {card.dueDay}
        </span>
      </div>
    </Comp>
  )
}

/** Linha de conta: logo do banco (ou ícone do tipo), nome, tipo e saldo. */
export function AccountRow({ account, balance, isDefault, onClick }: { account: Account; balance: number; isDefault?: boolean; onClick: () => void }) {
  return (
    <motion.button
      onClick={() => (haptic(), onClick())}
      whileTap={{ backgroundColor: 'var(--fill)' }}
      className="relative flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-fill/50"
    >
      <AccountIcon account={account} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[15px] font-semibold">{account.name}</span>
          {isDefault && <Badge tone="green">Padrão</Badge>}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-label-2">
          {accountKindLabel[account.kind]}
          {account.hidden ? ' · fora do total' : ''}
          {account.archived ? ' · arquivada' : ''}
        </span>
      </span>
      <span className={clsx('tabular shrink-0 text-[15px] font-semibold', balance < 0 && 'text-red')}>{money(balance)}</span>
      <ChevronRight className="size-4 shrink-0 text-label-3" strokeWidth={2.5} />
    </motion.button>
  )
}

/** "Voltar" no canto do painel (seletor de banco). */
function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={() => (haptic(), onClick())} className="-ml-1.5 flex items-center text-[17px] font-semibold text-tint">
      <ChevronLeft className="size-5" strokeWidth={2.5} /> Voltar
    </button>
  )
}

/** Fecha o painel e abre outro quando ele termina de fechar. */
const after = (close: () => void, fn: () => void) => {
  close()
  setTimeout(fn, 300)
}

// ─── Conta ───────────────────────────────────────────────────

export function AccountSheet() {
  const { open, id } = useUI((s) => s.account)
  const openAccount = useUI((s) => s.openAccount)
  const f = useFinance()
  const defaultAccount = useData((s) => s.settings.defaultAccount)
  const account = id ? f.accounts.find((a) => a.id === id) : undefined

  // formulário (conta nova) e campos editáveis (conta existente)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AccountKind>('corrente')
  const [initial, setInitial] = useState(0)
  const [negative, setNegative] = useState(false)
  const [color, setColor] = useState(palette[0])
  const [isDefault, setIsDefault] = useState(false)
  const [inTotal, setInTotal] = useState(true)
  const [bank, setBank] = useState<string>()
  // nome preenchido pelo banco (trocar de banco troca o nome, a menos que a pessoa tenha digitado outro)
  const [autoName, setAutoName] = useState('')
  const [picking, setPicking] = useState(false)
  const [adjust, setAdjust] = useState<{ value: number; negative: boolean } | null>(null)
  const bankName = useBankName(account?.bank)

  useEffect(() => {
    if (!open) return
    setAdjust(null)
    setPicking(false)
    if (account) {
      setName(account.name)
    } else {
      setName('')
      setBank(undefined)
      setAutoName('')
      setKind('corrente')
      setInitial(0)
      setNegative(false)
      setColor(palette[(f.accounts.length * 3) % palette.length])
      setIsDefault(!defaultAccount)
      setInTotal(true)
    }
  }, [open, id]) // eslint-disable-line react-hooks/exhaustive-deps

  const balance = account ? (f.bal.get(account.id) ?? 0) : 0
  const recent = useMemo(
    () =>
      account
        ? f.transactions
            .filter((t) => t.accountId === account.id || t.toAccountId === account.id)
            .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
            .slice(0, 15)
        : [],
    [account, f.transactions],
  )

  const save = () => {
    if (account && name.trim() && name.trim() !== account.name) useData.getState().updateAccount(account.id, { name: name.trim() })
  }
  const close = () => (save(), openAccount(false))
  const go = (fn: () => void) => after(close, fn)

  const create = () => {
    if (!name.trim()) return
    const a = useData.getState().addAccount({ name: name.trim(), kind, initial: negative ? -initial : initial, color, ...(bank ? { bank } : {}), ...(inTotal ? {} : { hidden: true }) })
    if (isDefault) useData.getState().setSettings({ defaultAccount: a.id })
    openAccount(false)
    toast('Conta criada')
  }

  // banco escolhido: o nome (se ainda não foi digitado outro) e a cor vêm do banco
  const pickBank = (b: BankInfo | null) => {
    setPicking(false)
    if (account) {
      useData.getState().updateAccount(account.id, { bank: b?.ispb, ...(b && bankColor(b.ispb) ? { color: bankColor(b.ispb) } : {}) })
      return
    }
    const auto = b ? shortBankName(b.name) : ''
    if (!name.trim() || name.trim() === autoName) setName(auto)
    setAutoName(auto)
    setBank(b?.ispb)
    const c = b && bankColor(b.ispb)
    if (c) setColor(c)
    if (b && kind === 'carteira') setKind('corrente')
  }

  const clearDefault = () => defaultAccount === account?.id && useData.getState().setSettings({ defaultAccount: '' })

  const target = adjust ? (adjust.negative ? -adjust.value : adjust.value) : 0

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? openAccount(true, id) : close())}
      title={picking ? 'Banco' : id ? 'Conta' : 'Nova conta'}
      action={picking ? <BackButton onClick={() => setPicking(false)} /> : undefined}
    >
      {picking ? (
        <BankPicker value={account ? account.bank : bank} onPick={pickBank} noneLabel="Sem banco (carteira, dinheiro, outro)" />
      ) : !id ? (
        <>
          <Section header="Conta">
            <BankField value={bank} onClick={() => setPicking(true)} />
            <TextField label="Nome" value={name} onChange={setName} placeholder="Nubank, Itaú, Carteira…" />
            <SelectField label="Tipo" value={kind} onChange={setKind} options={kindOptions} />
            <MoneyField label="Saldo atual" value={initial} onChange={setInitial} />
          </Section>
          <Segmented
            value={negative ? 'neg' : 'pos'}
            onChange={(v) => setNegative(v === 'neg')}
            options={[
              { value: 'pos', label: 'Positivo' },
              { value: 'neg', label: 'Negativo' },
            ]}
          />
          <Section>
            <ColorPicker value={color} onChange={setColor} />
          </Section>
          <Section footer="A conta padrão já vem escolhida em cada lançamento novo. Contas fora do total (ex.: uma reserva) não entram no saldo da tela inicial.">
            <Toggle label="Conta padrão" checked={isDefault} onChange={setIsDefault} />
            <Toggle label="Somar no saldo total" checked={inTotal} onChange={setInTotal} />
          </Section>
          <Button onClick={create} className={name.trim() ? '' : 'pointer-events-none opacity-40'}>
            <Plus className="size-[18px]" /> Criar conta
          </Button>
        </>
      ) : (
        account && (
          <>
            <div className="mb-4 flex items-center gap-3 px-1">
              <AccountIcon account={account} size={48} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[17px] font-semibold">{account.name}</p>
                <p className="truncate text-[12px] text-label-2">
                  {bankName && bankName !== account.name ? `${bankName} · ` : ''}
                  {accountKindLabel[account.kind]}
                  {defaultAccount === account.id ? ' · conta padrão' : ''}
                  {account.archived ? ' · arquivada' : ''}
                </p>
              </div>
            </div>

            <Hero label="Saldo atual" icon={<Wallet className="size-6" strokeWidth={2} />} caption={account.hidden ? 'Fora do saldo total' : 'Entra no saldo total'}>
              <Money value={balance} />
            </Hero>

            <AnimatePresence initial={false}>
              {adjust && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring} className="overflow-hidden">
                  <Section header="Ajustar saldo" footer="A diferença entra como ajuste de saldo: não conta como receita nem como despesa.">
                    <MoneyField label="Saldo correto" value={adjust.value} onChange={(value) => setAdjust({ ...adjust, value })} />
                  </Section>
                  <Segmented
                    value={adjust.negative ? 'neg' : 'pos'}
                    onChange={(v) => setAdjust({ ...adjust, negative: v === 'neg' })}
                    options={[
                      { value: 'pos', label: 'Positivo' },
                      { value: 'neg', label: 'Negativo' },
                    ]}
                  />
                  <p className="tabular -mt-2 mb-4 px-1 text-[13px] text-label-2">
                    Vai ficar <span className="font-semibold text-label">{money(target)}</span>
                    {Math.abs(target - balance) >= 0.005 && ` · ${target > balance ? '+' : '−'} ${money(Math.abs(target - balance))}`}
                  </p>
                  <div className="mb-6 grid grid-cols-2 gap-3">
                    <Button variant="tinted" onClick={() => setAdjust(null)}>
                      Cancelar
                    </Button>
                    <Button
                      onClick={() => {
                        const changed = Math.abs(target - balance) >= 0.005
                        if (changed) useData.getState().adjustBalance(account.id, balance, target)
                        setAdjust(null)
                        toast(changed ? 'Saldo ajustado' : 'O saldo já está certo')
                      }}
                    >
                      <Check className="size-[18px]" /> Ajustar
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {!account.archived && !adjust && (
              <div className="mb-6 grid grid-cols-2 gap-3">
                <Button variant="tinted" onClick={() => go(() => useUI.getState().openTx(true, { type: 'despesa', preset: { accountId: account.id } }))}>
                  <ArrowUpRight className="size-[18px] text-red" /> Despesa
                </Button>
                <Button variant="tinted" onClick={() => go(() => useUI.getState().openTx(true, { type: 'receita', preset: { accountId: account.id } }))}>
                  <ArrowDownLeft className="size-[18px] text-green" /> Receita
                </Button>
                <Button variant="tinted" onClick={() => go(() => useUI.getState().openTx(true, { type: 'transferencia', preset: { accountId: account.id } }))}>
                  <ArrowLeftRight className="size-[18px]" /> Transferir
                </Button>
                <Button variant="tinted" onClick={() => setAdjust({ value: Math.abs(balance), negative: balance < 0 })}>
                  <Scale className="size-[18px]" /> Ajustar saldo
                </Button>
                <Button
                  variant="tinted"
                  className="col-span-2"
                  onClick={() =>
                    go(() => {
                      const ui = useUI.getState()
                      ui.setTxFilter({ ...emptyFilter, accountId: account.id })
                      ui.setTab('transactions')
                    })
                  }
                >
                  <FileText className="size-[18px]" /> Ver extrato
                </Button>
              </div>
            )}

            <Section header="Últimos lançamentos">
              {recent.length === 0 ? (
                <p className="px-4 py-4 text-[13px] text-label-2">Nenhum lançamento nesta conta ainda.</p>
              ) : (
                recent.map((t) => <TxRow key={t.id} tx={t} look={f.look} showDate onClick={() => go(() => useUI.getState().openTx(true, { id: t.id }))} />)
              )}
            </Section>

            <Section header="Dados da conta">
              <BankField value={account.bank} onClick={() => setPicking(true)} />
              <TextField label="Nome" value={name} onChange={setName} placeholder="Nome da conta" />
              <SelectField label="Tipo" value={account.kind} onChange={(k) => useData.getState().updateAccount(account.id, { kind: k })} options={kindOptions} />
              <ColorPicker value={account.color} onChange={(c) => useData.getState().updateAccount(account.id, { color: c })} />
            </Section>
            <Section>
              {/* conta arquivada não aparece nos lançamentos: não pode ser a padrão */}
              {!account.archived && (
                <Toggle
                  label="Conta padrão"
                  detail="Já vem escolhida nos lançamentos novos"
                  checked={defaultAccount === account.id}
                  onChange={(v) => useData.getState().setSettings({ defaultAccount: v ? account.id : '' })}
                />
              )}
              <Toggle label="Somar no saldo total" checked={!account.hidden} onChange={(v) => useData.getState().updateAccount(account.id, { hidden: !v })} />
            </Section>

            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="tinted"
                onClick={() => {
                  const archived = !account.archived
                  useData.getState().updateAccount(account.id, { archived })
                  if (archived) clearDefault()
                  toast(archived ? 'Conta arquivada' : 'Conta restaurada')
                }}
              >
                {account.archived ? <ArchiveRestore className="size-[18px]" /> : <Archive className="size-[18px]" />} {account.archived ? 'Restaurar' : 'Arquivar'}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (!confirm(`Excluir a conta ${account.name}? Se ela tiver lançamentos, será arquivada para o histórico continuar certo.`)) return
                  clearDefault()
                  const r = useData.getState().removeAccount(account.id)
                  toast(r === 'removida' ? 'Conta excluída' : 'Conta arquivada (tem lançamentos)')
                  if (r === 'removida') openAccount(false)
                }}
              >
                <Trash2 className="size-[18px]" /> Excluir
              </Button>
            </div>
          </>
        )
      )}
    </Sheet>
  )
}

// ─── Cartão de crédito ───────────────────────────────────────

/** "Fatura de outubro" (com o ano quando não é o deste ano). */
const invoiceTitle = (key: string, ref: string) => {
  const [m, y] = monthLabel(key).toLowerCase().split(' de ')
  return `Fatura de ${m}${key.slice(0, 4) !== ref.slice(0, 4) ? ` de ${y}` : ''}`
}

function Stat({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('min-w-0', className)}>
      <p className="text-[11px] text-label-2">{label}</p>
      <p className="tabular truncate text-[14px] font-semibold min-[400px]:text-[15px]">{children}</p>
    </div>
  )
}

export function CardSheet() {
  const { open, id, invoice: startKey } = useUI((s) => s.card)
  const openCard = useUI((s) => s.openCard)
  const f = useFinance()
  const defaultAccount = useData((s) => s.settings.defaultAccount)
  const owner = useData((s) => s.settings.owner)
  const card = id ? f.cards.find((c) => c.id === id) : undefined
  const activeAccounts = f.accounts.filter((a) => !a.archived)
  const accountOptions = activeAccounts.map((a) => ({ value: a.id, label: a.name }))

  const [name, setName] = useState('')
  const [brand, setBrand] = useState<CardBrand | ''>('')
  const [bank, setBank] = useState<string>()
  const [skin, setSkin] = useState<string>()
  const [last4, setLast4] = useState('')
  const [autoName, setAutoName] = useState('')
  const [picking, setPicking] = useState(false)
  const [limit, setLimit] = useState(0)
  const [closingDay, setClosingDay] = useState(1)
  const [dueDay, setDueDay] = useState(10)
  const [accountId, setAccountId] = useState('')
  const [key, setKey] = useState('')
  const [paying, setPaying] = useState<{ amount: number; accountId: string; date: string } | null>(null)

  useEffect(() => {
    if (!open) return
    setPaying(null)
    setPicking(false)
    if (card) {
      setName(card.name)
      setLast4(card.last4 ?? '')
      setLimit(card.limit)
      setClosingDay(card.closingDay)
      setDueDay(card.dueDay)
      setKey(startKey ?? invoiceFor(card, f.ref))
    } else {
      setName('')
      setBrand('')
      setBank(undefined)
      setSkin(undefined)
      setLast4('')
      setAutoName('')
      setLimit(0)
      setClosingDay(1)
      setDueDay(10)
      setAccountId(defaultAccount && activeAccounts.some((a) => a.id === defaultAccount) ? defaultAccount : (activeAccounts[0]?.id ?? ''))
    }
  }, [open, id, startKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // banco escolhido: modelo do próprio banco, nome (se não foi digitado outro) e a conta do mesmo banco para pagar
  const pickBank = (b: BankInfo | null) => {
    setPicking(false)
    const firstSkin = skinsFor(b?.ispb)[0].id
    if (card) {
      useData.getState().updateCard(card.id, { bank: b?.ispb, skin: firstSkin, color: cardColor({ bank: b?.ispb, skin: firstSkin }) })
      return
    }
    const auto = b ? shortBankName(b.name) : ''
    if (!name.trim() || name.trim() === autoName) setName(auto)
    setAutoName(auto)
    setBank(b?.ispb)
    setSkin(firstSkin)
    const same = b && activeAccounts.find((a) => a.bank === b.ispb)
    if (same) setAccountId(same.id)
  }
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 4)

  const day = (v: number) => Math.min(31, Math.max(1, Math.round(v) || 1))
  const inv = card && key ? invoice(card, key, f.transactions, f.ref) : null
  const usage = card ? cardUsage(card, f.transactions) : null

  // gastos da fatura por categoria principal
  const slices = useMemo(() => {
    if (!inv) return []
    const sum = new Map<string, { label: string; value: number; color: string }>()
    for (const t of inv.items) {
      const root = rootOf(t.categoryId, f.cats)
      const k = root?.id ?? ''
      const row = sum.get(k) ?? { label: root?.name ?? 'Sem categoria', value: 0, color: root?.color ?? 'var(--label-3)' }
      row.value += t.amount
      sum.set(k, row)
    }
    const list = [...sum.values()].sort((a, b) => b.value - a.value)
    if (list.length <= 6) return list
    const rest = list.slice(5).reduce((s, x) => s + x.value, 0)
    return [...list.slice(0, 5), { label: 'Outras', value: rest, color: 'var(--label-3)' }]
  }, [inv, f.cats])

  const save = () => {
    if (!card) return
    const patch: Partial<Card> = {}
    if (name.trim() && name.trim() !== card.name) patch.name = name.trim()
    // limite zerado deixaria o cartão sem uso possível: mantém o anterior
    if (limit > 0 && limit !== card.limit) patch.limit = Math.round(limit * 100) / 100
    if (day(closingDay) !== card.closingDay) patch.closingDay = day(closingDay)
    if (day(dueDay) !== card.dueDay) patch.dueDay = day(dueDay)
    if (last4 !== (card.last4 ?? '') && (last4.length === 4 || !last4)) patch.last4 = last4 || undefined
    if (Object.keys(patch).length) useData.getState().updateCard(card.id, patch)
  }
  const close = () => (save(), openCard(false))
  const go = (fn: () => void) => after(close, fn)

  const valid = name.trim().length > 0 && limit > 0
  const create = () => {
    if (!valid) return
    useData.getState().addCard({
      name: name.trim(),
      ...(brand ? { brand } : {}),
      ...(bank ? { bank } : {}),
      ...(skin ? { skin } : {}),
      ...(last4.length === 4 ? { last4 } : {}),
      limit,
      closingDay: day(closingDay),
      dueDay: day(dueDay),
      ...(accountId ? { accountId } : {}),
      color: cardColor({ bank, skin }),
    })
    openCard(false)
    toast('Cartão criado')
  }

  const dueText = (() => {
    if (!inv || inv.status === 'paga' || inv.status === 'vazia') return null
    const d = diffDays(inv.due, f.ref)
    if (d === 0) return { text: 'Vence hoje', cls: 'text-blue' }
    if (d > 0) return { text: `Vence em ${d} ${d === 1 ? 'dia' : 'dias'}`, cls: 'text-label-2' }
    return { text: `Venceu há ${-d} ${d === -1 ? 'dia' : 'dias'}`, cls: 'text-red' }
  })()

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? openCard(true, id, startKey) : close())}
      title={picking ? 'Banco emissor' : id ? 'Cartão' : 'Novo cartão'}
      action={picking ? <BackButton onClick={() => setPicking(false)} /> : undefined}
    >
      {picking ? (
        <BankPicker value={card ? card.bank : bank} onPick={pickBank} noneLabel="Sem banco (só o modelo do cartão)" />
      ) : !id ? (
        <>
          <CreditCard3D card={{ name: name.trim(), bank, skin, brand: brand || undefined, last4, holder: owner }} className="mx-auto mb-6 mt-1 max-w-[360px]" />
          <Section header="Cartão">
            <BankField label="Banco emissor" value={bank} onClick={() => setPicking(true)} />
            <TextField label="Nome" value={name} onChange={setName} placeholder="Nubank, Itaú Click…" />
            <SelectField label="Bandeira" value={brand} onChange={setBrand} options={brandOptions} placeholder="Escolha" />
            <TextField label="Final do cartão" value={last4} onChange={(v) => setLast4(digits(v))} placeholder="Opcional" inputMode="tel" />
          </Section>
          <Section>
            <SkinPicker card={{ name, bank, skin, brand: brand || undefined }} onChange={setSkin} />
          </Section>
          <Section header="Limite e fatura" footer={`Compras a partir do dia ${day(closingDay)} entram na fatura seguinte.`}>
            <MoneyField label="Limite total" value={limit} onChange={setLimit} />
            <NumberField label="Fecha dia" value={closingDay} onChange={(v) => setClosingDay(Math.min(31, Math.max(0, Math.round(v))))} />
            <NumberField label="Vence dia" value={dueDay} onChange={(v) => setDueDay(Math.min(31, Math.max(0, Math.round(v))))} />
          </Section>
          {accountOptions.length > 0 ? (
            <Section footer="A fatura sai desta conta quando você marca como paga.">
              <SelectField label="Paga com" value={accountId} onChange={setAccountId} options={accountOptions} placeholder="Nenhuma" />
            </Section>
          ) : (
            <p className="-mt-3 mb-6 px-1 text-[12px] leading-[17px] text-label-2">Cadastre uma conta para registrar o pagamento da fatura.</p>
          )}
          <Button onClick={create} className={valid ? '' : 'pointer-events-none opacity-40'}>
            <CreditCard className="size-[18px]" /> Criar cartão
          </Button>
        </>
      ) : (
        card &&
        inv &&
        usage && (
          <>
            <CreditCard3D card={{ ...card, last4, holder: owner }}className="mx-auto mb-5 mt-1 max-w-[360px]" />

            <div className="mb-5 rounded-[22px] bg-surface p-4 shadow-card">
              <div className="mb-2 flex items-center justify-between text-[13px]">
                <span className="text-label-2">{Math.round(usage.ratio * 100)}% do limite usado</span>
                <span className={clsx('font-semibold', usage.ratio > 0.8 ? 'text-red' : usage.ratio > 0.5 ? 'text-orange' : 'text-green')}>{usage.health}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-fill">
                <motion.div
                  className={clsx('h-full rounded-full', { green: 'bg-tint', orange: 'bg-orange', red: 'bg-red' }[healthTone(usage.ratio)])}
                  initial={false}
                  animate={{ width: `${Math.min(100, usage.ratio * 100)}%` }}
                  transition={spring}
                />
              </div>
              <div className="mt-3 grid grid-cols-3 rounded-[16px] bg-fill/60 p-3">
                <Stat label="Limite usado">{money(usage.used)}</Stat>
                <Stat label="Disponível" className="border-l border-separator pl-3">
                  <span className={usage.available < 0 ? 'text-red' : ''}>{money(usage.available)}</span>
                </Stat>
                <Stat label="Limite total" className="border-l border-separator pl-3">
                  {money(card.limit)}
                </Stat>
              </div>
            </div>

            {/* faturas: anterior / próxima */}
            <div className="mb-4 flex items-center justify-between rounded-full bg-surface p-1 shadow-card">
              <button aria-label="Fatura anterior" onClick={() => (haptic(), setPaying(null), setKey(shiftMonth(key, -1)))} className="grid size-10 place-items-center rounded-full text-label-2 transition-colors hover:bg-fill active:bg-fill">
                <ChevronLeft className="size-5" />
              </button>
              <span className="text-[15px] font-bold">{invoiceTitle(key, f.ref)}</span>
              <button aria-label="Próxima fatura" onClick={() => (haptic(), setPaying(null), setKey(shiftMonth(key, 1)))} className="grid size-10 place-items-center rounded-full text-label-2 transition-colors hover:bg-fill active:bg-fill">
                <ChevronRight className="size-5" />
              </button>
            </div>

            <motion.div key={key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
              <div className="mb-5 rounded-[22px] bg-surface p-4 shadow-card">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13px] text-label-2">Total da fatura</p>
                  <InvoiceBadge status={inv.status} />
                </div>
                <p className="tabular mt-1 truncate text-[28px] font-semibold leading-tight tracking-[-0.03em]">
                  <Money value={inv.total} />
                </p>
                <p className="tabular mt-1 text-[12.5px] text-label-2">
                  Fecha {fmtDate(inv.closing).slice(0, 5)} · Vence {fmtDate(inv.due).slice(0, 5)}
                  {dueText && <span className={clsx('font-semibold', dueText.cls)}> · {dueText.text}</span>}
                </p>
                {inv.paid > 0 && (
                  <p className="tabular mt-1 text-[12.5px] text-label-2">
                    Pago {money(inv.paid)}
                    {inv.open > 0 ? ` · falta ${money(inv.open)}` : ''}
                  </p>
                )}
              </div>

              <AnimatePresence initial={false}>
                {paying && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={spring} className="overflow-hidden">
                    <Section
                      header="Pagar fatura"
                      footer={
                        accountOptions.length
                          ? `O valor sai da conta escolhida e não conta de novo como despesa: as compras já estão na fatura. Em aberto: ${money(inv.open)}.`
                          : 'Cadastre uma conta para registrar de onde saiu o pagamento da fatura.'
                      }
                    >
                      {/* pagar mais que o aberto não abate outra fatura: o valor fica limitado ao que falta */}
                      <MoneyField label="Valor" value={paying.amount} onChange={(amount) => setPaying({ ...paying, amount: Math.min(amount, inv.open) })} />
                      {accountOptions.length > 0 && <SelectField label="Conta" value={paying.accountId} onChange={(a) => setPaying({ ...paying, accountId: a })} options={accountOptions} placeholder="Escolha" />}
                      <TextField label="Data" type="date" value={paying.date} onChange={(date) => date && setPaying({ ...paying, date })} />
                    </Section>
                    <div className="mb-6 grid grid-cols-2 gap-3">
                      <Button variant="tinted" onClick={() => setPaying(null)}>
                        Cancelar
                      </Button>
                      <Button
                        className={paying.amount > 0 && paying.accountId ? '' : 'pointer-events-none opacity-40'}
                        onClick={() => {
                          if (!(paying.amount > 0 && paying.accountId)) return
                          useData.getState().payInvoice(card.id, key, paying.accountId, Math.min(paying.amount, inv.open), paying.date)
                          setPaying(null)
                          toast('Fatura paga')
                        }}
                      >
                        <Check className="size-[18px]" /> Pagar
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {!paying && (
                <div className="mb-6 grid grid-cols-2 gap-3">
                  {!card.archived && (
                    <Button variant="tinted" className={inv.open > 0 || inv.paid > 0 ? '' : 'col-span-2'} onClick={() => go(() => useUI.getState().openTx(true, { type: 'despesa', preset: { cardId: card.id } }))}>
                      <Plus className="size-[18px]" /> Lançar no cartão
                    </Button>
                  )}
                  {inv.open > 0 && (
                    <Button
                      onClick={() => {
                        const acc = card.accountId && activeAccounts.some((a) => a.id === card.accountId) ? card.accountId : (activeAccounts[0]?.id ?? '')
                        setPaying({ amount: inv.open, accountId: acc, date: today() })
                      }}
                    >
                      <Check className="size-[18px]" /> Pagar fatura
                    </Button>
                  )}
                  {inv.paid > 0 && (
                    <Button
                      variant="tinted"
                      className={inv.open > 0 ? 'col-span-2' : ''}
                      onClick={() => {
                        if (!confirm('Reabrir a fatura? Os pagamentos registrados nela serão desfeitos e o valor volta para a conta.')) return
                        useData.getState().reopenInvoice(card.id, key)
                        toast('Fatura reaberta')
                      }}
                    >
                      <RotateCcw className="size-[18px]" /> Reabrir fatura
                    </Button>
                  )}
                </div>
              )}

              {slices.length > 0 && (
                <>
                  <SectionHeader>Gastos por categoria</SectionHeader>
                  <div className="mb-6 rounded-[22px] bg-surface p-4 shadow-card">
                    <Donut slices={slices} center={money(inv.total)} caption="na fatura" />
                  </div>
                </>
              )}

              <Section header={`Compras · ${inv.items.length}`}>
                {inv.items.length === 0 ? (
                  <p className="px-4 py-4 text-[13px] text-label-2">Nenhuma compra nesta fatura.</p>
                ) : (
                  inv.items.map((t) => <TxRow key={t.id} tx={t} look={f.look} showDate onClick={() => go(() => useUI.getState().openTx(true, { id: t.id }))} />)
                )}
              </Section>
            </motion.div>

            <Section header="Dados do cartão">
              <BankField label="Banco emissor" value={card.bank} onClick={() => setPicking(true)} />
              <TextField label="Nome" value={name} onChange={setName} placeholder="Nome do cartão" />
              <SelectField label="Bandeira" value={card.brand ?? ''} onChange={(b) => useData.getState().updateCard(card.id, { brand: b })} options={brandOptions} placeholder="Escolha" />
              <TextField label="Final do cartão" value={last4} onChange={(v) => setLast4(digits(v))} placeholder="Opcional" inputMode="tel" />
            </Section>
            <Section>
              <SkinPicker card={card} onChange={(s) => useData.getState().updateCard(card.id, { skin: s, color: cardColor({ bank: card.bank, skin: s }) })} />
            </Section>
            <Section header="Limite e fatura" footer={`Compras a partir do dia ${day(closingDay)} entram na fatura seguinte.`}>
              <MoneyField label="Limite total" value={limit} onChange={setLimit} />
              <NumberField label="Fecha dia" value={closingDay} onChange={(v) => setClosingDay(Math.min(31, Math.max(0, Math.round(v))))} />
              <NumberField label="Vence dia" value={dueDay} onChange={(v) => setDueDay(Math.min(31, Math.max(0, Math.round(v))))} />
              {accountOptions.length > 0 && (
                <SelectField label="Paga com" value={card.accountId ?? ''} onChange={(a) => useData.getState().updateCard(card.id, { accountId: a || undefined })} options={accountOptions} placeholder="Nenhuma" />
              )}
            </Section>

            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="tinted"
                onClick={() => {
                  const archived = !card.archived
                  useData.getState().updateCard(card.id, { archived })
                  toast(archived ? 'Cartão arquivado' : 'Cartão restaurado')
                }}
              >
                {card.archived ? <ArchiveRestore className="size-[18px]" /> : <Archive className="size-[18px]" />} {card.archived ? 'Restaurar' : 'Arquivar'}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (!confirm(`Excluir o cartão ${card.name}? Se ele tiver compras, será arquivado para o histórico continuar certo.`)) return
                  const r = useData.getState().removeCard(card.id)
                  toast(r === 'removido' ? 'Cartão excluído' : 'Cartão arquivado (tem compras)')
                  if (r === 'removido') openCard(false)
                }}
              >
                <Trash2 className="size-[18px]" /> Excluir
              </Button>
            </div>
          </>
        )
      )}
    </Sheet>
  )
}
