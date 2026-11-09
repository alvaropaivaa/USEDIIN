import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Plus, ReceiptText, Search, SlidersHorizontal, X } from 'lucide-react'
import clsx from 'clsx'
import { addDays, diffDays, monthKey, monthLabel, parseISO } from '../lib/dates'
import { money } from '../lib/format'
import { haptic } from '../lib/haptics'
import { cashDate, invoice, invoiceStatusLabel, isLate, monthRange, paidInvoices, settled, totals, type Invoice, type InvoiceStatus, type Transaction } from '../lib/ledger'
import { emptyFilter, useUI, type TxStatusFilter, type TxTypeFilter } from '../lib/store'
import { CardThumb } from '../components/banks'
import { MonthNav, TxRow, agenda, forecastBalance, useDebts, useFinance } from '../components/finance'
import { Chips, Empty, Hero, IconButton, Money, Screen, Section, SelectField, StatCard } from '../components/ui'

// Lançamentos do mês: resumo, busca, filtros e a lista agrupada por dia.
// Compras no cartão aparecem como uma linha da fatura (no dia do vencimento), como no extrato do banco.

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/** "45,90", "1.234,5", "1.234" ou "45.9" → número (para buscar pelo valor). */
const numberIn = (q: string) => {
  const raw = q.replace(/r\$|\s/gi, '')
  if (!/^\d[\d.,]*$/.test(raw)) return null
  // com vírgula, o ponto é milhar; sem vírgula, "1.234" é milhar e "45.9" é decimal
  const n = parseFloat(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '') : raw)
  return isFinite(n) ? n : null
}

/** Recuo das subcategorias na lista (espaço inseparável: o comum some no começo da opção). */
const INDENT = String.fromCharCode(160).repeat(3)

const dayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })

function dayLabel(iso: string, ref: string) {
  if (iso === ref) return 'Hoje'
  if (iso === addDays(ref, -1)) return 'Ontem'
  if (iso === addDays(ref, 1)) return 'Amanhã'
  return dayFmt.format(parseISO(iso)).replace(/^./, (c) => c.toUpperCase())
}

const invoiceTone: Record<InvoiceStatus, string> = {
  aberta: 'text-blue',
  fechada: 'text-orange',
  parcial: 'text-orange',
  paga: 'text-green',
  vencida: 'text-red',
  vazia: 'text-label-2',
}

type Item = { kind: 'tx'; date: string; tx: Transaction } | { kind: 'inv'; date: string; inv: Invoice }

const signed = (it: Item) => (it.kind === 'inv' ? -it.inv.total : it.tx.type === 'receita' ? it.tx.amount : it.tx.type === 'despesa' ? -it.tx.amount : 0)

/** Uma linha por fatura do cartão que vence no mês. */
function InvoiceRow({ inv, onClick }: { inv: Invoice; onClick: () => void }) {
  return (
    <motion.button
      onClick={() => (haptic(), onClick())}
      whileTap={{ backgroundColor: 'var(--fill)' }}
      className="relative flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-fill/50"
    >
      <CardThumb card={inv.card} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">Fatura {inv.card.name}</span>
        <span className="mt-0.5 block truncate text-[12px] text-label-2">
          {inv.items.length} {inv.items.length === 1 ? 'compra' : 'compras'} · vence {inv.due.slice(8, 10)}/{inv.due.slice(5, 7)}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <span className="tabular text-[15px] font-semibold">− {money(inv.total)}</span>
        <span className={clsx('text-[11px] font-semibold', invoiceTone[inv.status])}>{invoiceStatusLabel[inv.status]}</span>
      </span>
    </motion.button>
  )
}

export default function Transactions() {
  const f = useFinance()
  const { month, setMonth, txFilter: flt, setTxFilter, searchFocus, setSearchFocus, openTx, openCard } = useUI()
  const [showFilters, setShowFilters] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!searchFocus) return
    searchRef.current?.focus()
    setSearchFocus(false)
  }, [searchFocus, setSearchFocus])

  const { from, to } = monthRange(month)
  const current = monthKey(f.ref)

  // ─── Resumo do mês ───────────────────────────────────────
  const sum = useMemo(() => totals(f.transactions, f.cardsIdx, from, to), [f.transactions, f.cardsIdx, from, to])
  // previsto no fim do mês: saldo de hoje + o que ainda entra − o que ainda sai (inclusive o que já atrasou)
  const { items: debts } = useDebts()
  const forecast = useMemo(() => {
    if (month < current) return null
    return forecastBalance(f.total, agenda(f, debts, Math.max(0, diffDays(to, f.ref))), to)
  }, [f, debts, to, month, current])

  const late = useMemo(() => f.transactions.filter((t) => isLate(t, f.ref)), [f.transactions, f.ref])
  // faturas vencidas e não pagas, de qualquer mês (entram em "atrasados" junto com as contas)
  const lateInvoices = useMemo(
    () =>
      f.cards.flatMap((card) => {
        const keys = new Set(f.transactions.filter((t) => t.cardId === card.id && t.type === 'despesa' && t.invoice).map((t) => t.invoice!))
        return [...keys].map((k) => invoice(card, k, f.transactions, f.ref)).filter((inv) => inv.status === 'vencida')
      }),
    [f.cards, f.transactions, f.ref],
  )
  const lateCount = late.length + lateInvoices.length
  const lateSum = late.reduce((s, t) => s + t.amount, 0) + lateInvoices.reduce((s, inv) => s + inv.open, 0)

  // ─── Filtros ─────────────────────────────────────────────
  const q = norm(flt.q.trim())
  const qNum = numberIn(flt.q.trim())
  const cardFilter = flt.accountId.startsWith('card:') ? flt.accountId.slice(5) : ''
  const accountFilter = cardFilter ? '' : flt.accountId
  const scopedLate = flt.status === 'atrasado'
  // com cartão, busca, categoria ou tag escolhidos, as compras do cartão aparecem uma a uma
  const detail = !!cardFilter || !!q || !!flt.categoryId || !!flt.tag
  const extraCount = [flt.categoryId, flt.accountId, flt.tag].filter(Boolean).length
  const active = extraCount > 0 || flt.type !== 'todos' || flt.status !== 'todos' || !!q

  const tags = useMemo(() => [...new Set(f.transactions.flatMap((t) => t.tags ?? []))].sort((a, b) => a.localeCompare(b)), [f.transactions])

  const items = useMemo(() => {
    const closed = paidInvoices(f.transactions)
    const cats = flt.categoryId ? new Set([flt.categoryId, ...f.categories.filter((c) => c.parentId === flt.categoryId).map((c) => c.id)]) : null
    const okStatus = (t: Transaction) => {
      if (flt.status === 'todos') return true
      if (flt.status === 'atrasado') return isLate(t, f.ref)
      const paid = settled(t, closed)
      return flt.status === 'pago' ? paid : !paid
    }
    const okText = (t: Transaction) => {
      if (!q) return true
      if (qNum !== null && Math.abs(t.amount - qNum) < 0.005) return true
      const cat = f.cats.get(t.categoryId ?? '')
      return norm(t.description).includes(q) || norm(t.note ?? '').includes(q) || (!!cat && norm(cat.name).includes(q)) || (t.tags ?? []).some((g) => norm(g).includes(q))
    }
    const out: Item[] = []
    for (const t of f.transactions) {
      const card = t.type === 'despesa' && t.cardId
      if (card && !detail) continue
      const date = cashDate(t, f.cardsIdx)
      // "atrasados" mostra tudo o que venceu, de qualquer mês
      if (!scopedLate && (date < from || date > to)) continue
      if (flt.type !== 'todos' && t.type !== flt.type) continue
      if (!okStatus(t)) continue
      if (cats && !cats.has(t.categoryId ?? '')) continue
      if (cardFilter && t.cardId !== cardFilter) continue
      if (accountFilter && t.accountId !== accountFilter && t.toAccountId !== accountFilter) continue
      if (flt.tag && !(t.tags ?? []).includes(flt.tag)) continue
      if (!okText(t)) continue
      out.push({ kind: 'tx', date, tx: t })
    }
    // faturas do cartão que vencem no mês (sem filtro de conta, categoria ou tag); em "atrasados", as vencidas de qualquer mês
    if (!detail && !accountFilter && (flt.type === 'todos' || flt.type === 'despesa')) {
      if (scopedLate) for (const inv of lateInvoices) out.push({ kind: 'inv', date: inv.due, inv })
      else
        for (const card of f.cards) {
          const inv = invoice(card, month, f.transactions, f.ref)
          if (inv.total <= 0) continue
          if (flt.status === 'pago' ? inv.status !== 'paga' : flt.status === 'pendente' ? inv.open <= 0 : false) continue
          out.push({ kind: 'inv', date: inv.due, inv })
        }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date) || (a.kind === 'tx' && b.kind === 'tx' ? b.tx.createdAt.localeCompare(a.tx.createdAt) : 0))
  }, [f, flt, q, qNum, detail, cardFilter, accountFilter, scopedLate, from, to, month, lateInvoices])

  // agrupa por dia, mais recentes primeiro
  const groups = useMemo(() => {
    const out: { date: string; list: Item[]; total: number }[] = []
    for (const it of items) {
      const g = out.at(-1)
      if (g?.date === it.date) (g.list.push(it), (g.total += signed(it)))
      else out.push({ date: it.date, list: [it], total: signed(it) })
    }
    return out
  }, [items])

  // ─── Opções dos filtros ──────────────────────────────────
  const catOptions = useMemo(() => {
    const mains = f.categories.filter((c) => !c.parentId && !c.archived).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
    return mains.flatMap((m) => [
      { value: m.id, label: m.name, group: m.type === 'despesa' ? 'Despesas' : 'Receitas' },
      // espaço inseparável: o espaço comum some no início do texto da opção
      ...f.categories.filter((c) => c.parentId === m.id && !c.archived).map((c) => ({ value: c.id, label: `${INDENT}${c.name}`, group: m.type === 'despesa' ? 'Despesas' : 'Receitas' })),
    ])
  }, [f.categories])
  const sourceOptions = useMemo(
    () => [
      ...f.accounts.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name, group: 'Contas' })),
      ...f.cards.filter((c) => !c.archived).map((c) => ({ value: `card:${c.id}`, label: c.name, group: 'Cartões de crédito' })),
    ],
    [f.accounts, f.cards],
  )

  const summary = (
    <>
      <Hero
        label={`Balanço de ${monthLabel(month).split(' ')[0].toLowerCase()}`}
        icon={<ArrowLeftRight className="size-6" strokeWidth={2} />}
        caption={forecast !== null ? <>Previsto no fim do mês: {money(forecast)}</> : <>Entradas {money(sum.income)} · saídas {money(sum.expense)}</>}
      >
        <Money value={sum.balance} />
      </Hero>
      {/* celular: só o balanço; os quatro números ficam no computador (no celular, os filtros fazem esse papel) */}
      <div className="mb-5 hidden grid-cols-2 gap-3 lg:grid">
        <StatCard label="Recebidos" value={money(sum.incomePaid)} tone="green" hint={`de ${money(sum.income)} em receitas`} onClick={() => setTxFilter({ type: 'receita', status: 'pago' })} />
        <StatCard label="A receber" value={money(sum.incomePending)} tone={sum.incomePending > 0 ? 'blue' : undefined} hint="receitas pendentes" onClick={() => setTxFilter({ type: 'receita', status: 'pendente' })} />
        <StatCard label="Pagos" value={money(sum.expensePaid)} hint={`de ${money(sum.expense)} em despesas`} onClick={() => setTxFilter({ type: 'despesa', status: 'pago' })} />
        <StatCard label="A pagar" value={money(sum.expensePending)} tone={sum.expensePending > 0 ? 'red' : undefined} hint="contas e faturas" onClick={() => setTxFilter({ type: 'despesa', status: 'pendente' })} />
      </div>
    </>
  )

  const statusChips = (
    <Chips<TxStatusFilter>
      value={flt.status}
      onChange={(status) => setTxFilter({ status })}
      options={[
        { value: 'todos', label: 'Todos' },
        { value: 'pago', label: 'Pagos' },
        { value: 'pendente', label: 'Pendentes' },
        { value: 'atrasado', label: 'Atrasados', count: lateCount || undefined },
      ]}
    />
  )
  // no celular o botão de filtros conta também a situação (pago, pendente, atrasado), que fica dentro dele
  const mobileCount = extraCount + (flt.status !== 'todos' ? 1 : 0)

  const extraFilters = (
    <Section footer={detail && !cardFilter ? 'Com estes filtros, as compras no cartão aparecem uma a uma.' : undefined}>
      <SelectField label="Categoria" value={flt.categoryId} placeholder="Todas" options={catOptions} onChange={(categoryId) => setTxFilter({ categoryId })} />
      <SelectField label="Conta ou cartão" value={flt.accountId} placeholder="Todos" options={sourceOptions} onChange={(accountId) => setTxFilter({ accountId })} />
      {tags.length > 0 && <SelectField label="Tag" value={flt.tag} placeholder="Todas" options={tags.map((t) => ({ value: t, label: t }))} onChange={(tag) => setTxFilter({ tag })} />}
    </Section>
  )

  return (
    <Screen
      title="Lançamentos"
      subtitle="Receitas, despesas e transferências do mês."
      trailing={
        <>
          <div className="hidden items-center gap-2 lg:flex">
            {(
              [
                ['receita', 'Receita', ArrowDownLeft, 'text-green'],
                ['despesa', 'Despesa', ArrowUpRight, 'text-red'],
              ] as const
            ).map(([type, label, Icon, cls]) => (
              <motion.button
                key={type}
                whileTap={{ scale: 0.95 }}
                onClick={() => (haptic(), openTx(true, { type }))}
                className="flex h-10 items-center gap-1.5 rounded-full bg-white px-4 text-[13.5px] font-semibold text-[#0f3b2c] transition-colors hover:bg-white/90"
              >
                <Icon className={clsx('size-4', cls)} strokeWidth={2.4} /> {label}
              </motion.button>
            ))}
            <IconButton label="Transferência (T)" onClick={() => openTx(true, { type: 'transferencia' })}>
              <ArrowLeftRight className="size-[18px]" strokeWidth={2.2} />
            </IconButton>
          </div>
          <div className="lg:hidden">
            <IconButton label="Novo lançamento" onClick={() => openTx(true, { type: 'despesa' })}>
              <Plus className="size-[18px]" strokeWidth={2.5} />
            </IconButton>
          </div>
        </>
      }
    >
      {/* computador largo: resumo e filtros fixos à esquerda, lista à direita */}
      <div className="xl:grid xl:grid-cols-[360px_minmax(0,1fr)] xl:items-start xl:gap-8">
        <div className="xl:sticky xl:top-[116px]">
          <MonthNav month={month} onChange={setMonth} />
          {summary}

          <label className="mb-4 flex h-12 items-center gap-2 rounded-full bg-surface px-4 shadow-card">
            <Search className="size-[18px] shrink-0 text-label-3" />
            <input
              ref={searchRef}
              value={flt.q}
              onChange={(e) => setTxFilter({ q: e.target.value })}
              placeholder="Buscar por descrição ou valor"
              className="min-w-0 flex-1 bg-transparent text-[15px] font-medium outline-none placeholder:text-label-3"
            />
            {flt.q && (
              <button type="button" aria-label="Limpar busca" onClick={() => (haptic(), setTxFilter({ q: '' }))} className="grid size-7 place-items-center rounded-full bg-fill text-label-2">
                <X className="size-3.5" />
              </button>
            )}
            {/* celular: os filtros moram neste botão */}
            <button
              type="button"
              aria-label={mobileCount ? `Filtros, ${mobileCount} ativos` : 'Filtros'}
              aria-expanded={showFilters}
              onClick={() => (haptic(), setShowFilters((v) => !v))}
              className={clsx('relative -mr-2 grid size-9 shrink-0 place-items-center rounded-full xl:hidden', showFilters || mobileCount ? 'bg-label text-bg' : 'bg-fill text-label-2')}
            >
              <SlidersHorizontal className="size-4" />
              {mobileCount > 0 && <span className="tabular absolute -right-1 -top-1 grid size-[18px] place-items-center rounded-full bg-tint text-[10px] font-semibold text-white ring-2 ring-surface">{mobileCount}</span>}
            </button>
          </label>

          <Chips<TxTypeFilter>
            value={flt.type}
            onChange={(type) => setTxFilter({ type })}
            options={[
              { value: 'todos', label: 'Todos' },
              { value: 'receita', label: 'Receitas' },
              { value: 'despesa', label: 'Despesas' },
              { value: 'transferencia', label: 'Transferências' },
            ]}
          />
          {/* celular: situação e filtros extras recolhidos no botão da busca; computador largo: sempre à mostra */}
          <AnimatePresence initial={false}>
            {showFilters && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden xl:hidden">
                <p className="mb-2 px-1 text-[13px] font-semibold text-label-2">Situação</p>
                {statusChips}
                {extraFilters}
              </motion.div>
            )}
          </AnimatePresence>
          <div className="hidden xl:block">
            {statusChips}
            {extraFilters}
          </div>

          {active && (
            <button onClick={() => (haptic(), setTxFilter(emptyFilter))} className="-mt-2 mb-5 flex items-center gap-1.5 px-1 text-[13px] font-semibold text-tint">
              <X className="size-4" /> Limpar filtros
            </button>
          )}
        </div>

        <div>
          {lateCount > 0 && !scopedLate && (
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => (haptic(), setTxFilter({ status: 'atrasado' }))}
              className="mb-4 flex w-full items-center gap-3 rounded-[20px] bg-red/[0.08] px-4 py-3 text-left ring-1 ring-red/15 xl:mt-0"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-red/10 text-red">
                <AlertTriangle className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-red">
                  {lateCount} {lateCount === 1 ? 'conta atrasada' : 'contas atrasadas'} · {money(lateSum)}
                </span>
                <span className="block text-[12px] text-label-2">Toque para ver e marcar o que já foi pago</span>
              </span>
            </motion.button>
          )}

          {scopedLate && (
            <p className="mb-3 px-1 text-[13px] font-semibold text-label-2">
              Todas as contas atrasadas ·{' '}
              <button className="text-tint" onClick={() => setTxFilter({ status: 'todos' })}>
                limpar filtro
              </button>
            </p>
          )}

          {groups.length === 0 ? (
            <div className="rounded-[22px] bg-surface shadow-card">
              <Empty icon={<ReceiptText className="size-9" strokeWidth={1.5} />} title="Nenhum lançamento encontrado" text="Altere o mês, a busca ou os filtros, ou toque no + para lançar." />
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.date} className="mb-5">
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <h2 className="text-[13px] font-semibold text-label-2">{dayLabel(g.date, f.ref)}</h2>
                  {g.total !== 0 && <span className={clsx('tabular text-[12.5px] font-semibold', g.total > 0 ? 'text-green' : 'text-label-2')}>{g.total > 0 ? `+ ${money(g.total)}` : `− ${money(-g.total)}`}</span>}
                </div>
                <Section className="mb-0!">
                  {g.list.map((it) =>
                    it.kind === 'tx' ? (
                      <TxRow key={it.tx.id} tx={it.tx} look={f.look} showDate={scopedLate} onClick={() => openTx(true, { id: it.tx.id })} />
                    ) : (
                      <InvoiceRow key={`inv-${it.inv.card.id}-${it.inv.key}`} inv={it.inv} onClick={() => openCard(true, it.inv.card.id, it.inv.key)} />
                    ),
                  )}
                </Section>
              </section>
            ))
          )}
        </div>
      </div>
    </Screen>
  )
}
