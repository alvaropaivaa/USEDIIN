// Ferramentas do assistente do chat: a IA (supabase/functions/_shared/assistente/agent.ts) pede, e o
// app executa aqui, nos dados da pessoa, pelo store (as mesmas regras das telas: parcelas, faturas,
// sincronização). Cada ferramenta confere a entrada e devolve um texto curto para a IA, com os ids
// do que criou ou mudou. Também ficam aqui as regras de lançar que o modo simples usa.

import { addMonths, fmtDate, monthKey, parseISO, shiftMonth, shortMonth, toISO, today } from './dates'
import { moneyRaw as money } from './format'
import {
  accountKindLabel,
  balances,
  byCategory,
  cardIndex,
  goalStats,
  invoice,
  invoiceDates,
  invoiceFor,
  isLate,
  monthRange,
  rootOf,
  suggestCategory,
  totals,
  type AccountKind,
  type Card,
  type Category,
  type RecurFrequency,
  type Transaction,
} from './ledger'
import { firstDueFor, summarize, type DebtKind, type Frequency } from './loans'
import { bankColor, cardColor, popularBanks, shortBankName, skinsFor } from './banks'
import { palette, suggestIcon } from './categories'
import { useData, type Repeat, type Scope, type TxInput } from './store'
import type { AssistantTx } from './assistantContract'

const round2 = (n: number) => Math.round(n * 100) / 100
const ISO = /^\d{4}-\d{2}-\d{2}$/
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

export const active = <T extends { id: string; archived?: boolean }>(list: T[], id?: unknown) => (typeof id === 'string' && id ? list.find((x) => x.id === id && !x.archived) : undefined)

/** Conta padrão: a escolhida nas configurações ou a primeira ativa (de preferência a que entra no total). */
export function defaultAccountId() {
  const { accounts, settings } = useData.getState()
  const list = accounts.filter((a) => !a.archived)
  if (settings.defaultAccount && list.some((a) => a.id === settings.defaultAccount)) return settings.defaultAccount
  return (list.find((a) => !a.hidden) ?? list[0])?.id
}

/** Fatura que a pessoa está pagando: a mais antiga já fechada com valor em aberto; senão a atual. */
export function payableInvoice(card: Card, txs: Transaction[], ref: string) {
  const current = invoiceFor(card, ref)
  const keys = [...new Set(txs.filter((t) => t.cardId === card.id && t.type === 'despesa' && t.invoice && t.invoice <= current).map((t) => t.invoice!))].sort()
  for (const k of keys) {
    const inv = invoice(card, k, txs, ref)
    if (inv.open > 0.005 && (k === current || invoiceDates(card, k).closing <= ref)) return inv
  }
  const cur = invoice(card, current, txs, ref)
  return cur.open > 0.005 ? cur : null
}

/** Roda uma mudança no store e devolve os ids dos lançamentos que ela criou (marcados como do assistente). */
export function capture(fn: () => void) {
  const before = new Set(useData.getState().transactions.map((t) => t.id))
  fn()
  const ids = useData
    .getState()
    .transactions.filter((t) => !before.has(t.id))
    .map((t) => t.id)
  if (ids.length) {
    const fresh = new Set(ids)
    useData.setState((s) => ({ transactions: s.transactions.map((t) => (fresh.has(t.id) ? { ...t, via: 'assistente' as const } : t)) }))
  }
  return ids
}

/** Lança um item do assistente (com as mesmas regras do WhatsApp) e devolve os ids criados. */
export function launch(item: AssistantTx, ref = today(), repeat?: RecurFrequency): string[] {
  const s = useData.getState()
  const amount = round2(item.amount)
  if (!(amount > 0)) return []
  const date = ISO.test(item.date) ? item.date : ref

  // transferência com cartão = pagamento da fatura
  if (item.type === 'transferencia' && item.cardId) {
    const card = active(s.cards, item.cardId)
    const accountId = active(s.accounts, item.accountId)?.id ?? defaultAccountId()
    const inv = card && payableInvoice(card, s.transactions, ref)
    if (!card || !accountId || !inv) return []
    return capture(() => s.payInvoice(card.id, inv.key, accountId, Math.min(amount, inv.open), date))
  }

  const card = item.type === 'despesa' ? active(s.cards, item.cardId) : undefined
  const accountId = card ? undefined : (active(s.accounts, item.accountId)?.id ?? defaultAccountId())
  const toAccountId = item.type === 'transferencia' ? active(s.accounts, item.toAccountId)?.id : undefined
  if (item.type === 'transferencia' && (!accountId || !toAccountId || accountId === toAccountId)) return []
  const description = item.description.trim() || (item.type === 'receita' ? 'Receita' : item.type === 'despesa' ? 'Despesa' : 'Transferência')
  // sem categoria: a sugestão do histórico e das palavras-chave (como no lançamento manual)
  const categoryId =
    item.type === 'transferencia'
      ? undefined
      : (s.categories.find((c) => c.id === item.categoryId && c.type === item.type && !c.archived)?.id ?? suggestCategory(description, item.type, s.categories, s.transactions))
  const input: TxInput = {
    type: item.type,
    description,
    amount,
    date,
    // data futura fica a pagar; compra no cartão o store já marca como paga
    status: item.paid && date <= ref ? 'pago' : 'pendente',
    ...(categoryId ? { categoryId } : {}),
    ...(accountId ? { accountId } : {}),
    ...(toAccountId ? { toAccountId } : {}),
    ...(card ? { cardId: card.id } : {}),
    ...(item.note?.trim() ? { note: item.note.trim() } : {}),
  }
  const count = Math.min(72, Math.max(1, Math.round(item.installments || 1)))
  // a recorrência não guarda a conta de destino: transferência não vira lançamento fixo
  const rep: Repeat =
    repeat && item.type !== 'transferencia' ? { mode: 'fixa', frequency: repeat } : count > 1 && item.type !== 'transferencia' ? { mode: 'parcelada', count } : { mode: 'unica' }
  return capture(() => s.addTransaction(input, rep))
}

// ─── Conferência da entrada ──────────────────────────────────

type Input = Record<string, unknown>
const isObj = (v: unknown): v is Input => !!v && typeof v === 'object' && !Array.isArray(v)
/** Campo informado (a IA às vezes manda null no que não quer mudar). */
const has = (i: Input, k: string) => i[k] !== undefined && i[k] !== null
const text = (v: unknown, max = 120) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : undefined)
const positive = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0.01 && v < 1e9 ? round2(v) : undefined)
const number = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e9 ? round2(v) : undefined)
const isDay = (v: unknown): v is string => typeof v === 'string' && ISO.test(v) && toISO(parseISO(v)) === v
const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
const pick = <T extends string>(v: unknown, list: readonly T[]) => ((list as readonly unknown[]).includes(v) ? (v as T) : undefined)
const day = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 31 ? v : undefined)

// ─── Textos dos resultados ───────────────────────────────────

const catName = (id?: string) => (id ? useData.getState().categories.find((c) => c.id === id)?.name : undefined)
const accName = (id?: string) => (id ? useData.getState().accounts.find((a) => a.id === id)?.name : undefined)
const cardName = (id?: string) => (id ? useData.getState().cards.find((c) => c.id === id)?.name : undefined)
const recurring = (t: Transaction) => !!t.groupId && useData.getState().recurrences.some((r) => r.id === t.groupId)

function where(t: Transaction) {
  if (t.adjust) return `ajuste de saldo de ${accName(t.accountId ?? t.toAccountId) ?? '?'}`
  if (t.type === 'transferencia' && t.cardId) return `pagamento da fatura ${cardName(t.cardId) ?? '?'} de ${t.invoice ?? '?'}, saiu de ${accName(t.accountId) ?? '?'}`
  if (t.type === 'transferencia') return `${accName(t.accountId) ?? '?'} → ${accName(t.toAccountId) ?? '?'}`
  if (t.cardId) return `cartão ${cardName(t.cardId) ?? '?'}, fatura ${t.invoice ?? '?'}`
  return accName(t.accountId) ?? 'sem conta'
}

/** Uma linha por lançamento, com o id (a IA usa para corrigir e apagar). */
export const txLine = (t: Transaction) =>
  `[${t.id}] ${fmtDate(t.date)} · ${t.type} · ${t.description}${t.installment ? ` (parcela ${t.installment.n}/${t.installment.count})` : ''}${recurring(t) ? ' (fixo)' : ''} · ${money(t.amount)}${t.type === 'transferencia' ? '' : ` · ${catName(t.categoryId) ?? 'sem categoria'}`} · ${where(t)} · ${t.status}${t.note ? ` · obs: ${t.note}` : ''}`

/** O que um lançamento novo virou (as parcelas e repetições viram uma linha só). */
function createdLines(ids: string[]) {
  const txs = useData.getState().transactions.filter((t) => ids.includes(t.id))
  const groups = new Map<string, Transaction[]>()
  for (const t of txs) groups.set(t.groupId ?? t.id, [...(groups.get(t.groupId ?? t.id) ?? []), t])
  return [...groups.values()].map((g) => {
    const first = [...g].sort((a, b) => (a.installment?.n ?? 0) - (b.installment?.n ?? 0) || a.date.localeCompare(b.date))[0]
    return `${txLine(first)}${g.length > 1 ? ` (+${g.length - 1} ${first.installment ? 'parcelas' : 'repetições'})` : ''}`
  })
}

interface Outcome {
  content: string
  /** nada foi feito */
  error?: boolean
  /** parte não foi feita (a IA precisa ver) */
  partial?: boolean
}

const fail = (content: string): Outcome => ({ content, error: true })
/** Junta o que deu certo e o que não deu (itens de uma ferramenta). */
function report(done: string[], failed: string[]): Outcome {
  const out = [...done, ...(failed.length ? ['Não feito:', ...failed] : [])].join('\n')
  return { content: out || 'Nada a fazer.', ...(failed.length ? (done.length ? { partial: true } : { error: true }) : {}) }
}

// ─── Consultas ───────────────────────────────────────────────

function search(i: Input, ref: string): Outcome {
  const d = useData.getState()
  if (has(i, 'de') && !isDay(i.de)) return fail('"de" precisa ser AAAA-MM-DD.')
  if (has(i, 'ate') && !isDay(i.ate)) return fail('"ate" precisa ser AAAA-MM-DD.')
  if (has(i, 'fatura') && !isMonth(i.fatura)) return fail('"fatura" precisa ser AAAA-MM.')
  const q = text(i.texto) ? norm(text(i.texto)!) : ''
  const tipo = pick(i.tipo, ['receita', 'despesa', 'transferencia'] as const)
  const sit = pick(i.situacao, ['pago', 'pendente', 'atrasado'] as const)
  let cats: Set<string> | undefined
  if (has(i, 'categoria_id')) {
    const c = d.categories.find((x) => x.id === i.categoria_id)
    if (!c) return fail(`Categoria ${String(i.categoria_id)} não existe.`)
    cats = new Set([c.id, ...d.categories.filter((x) => x.parentId === c.id).map((x) => x.id)])
  }
  const limit = Math.min(60, Math.max(1, typeof i.limite === 'number' ? Math.round(i.limite) : 30))
  const found = d.transactions
    .filter(
      (t) =>
        (!has(i, 'de') || t.date >= (i.de as string)) &&
        (!has(i, 'ate') || t.date <= (i.ate as string)) &&
        (!tipo || t.type === tipo) &&
        (!cats || (!!t.categoryId && cats.has(t.categoryId))) &&
        (!has(i, 'conta_id') || t.accountId === i.conta_id || t.toAccountId === i.conta_id) &&
        (!has(i, 'cartao_id') || t.cardId === i.cartao_id) &&
        (!has(i, 'fatura') || (!!t.cardId && t.invoice === i.fatura)) &&
        (!sit || (sit === 'atrasado' ? isLate(t, ref) : t.status === sit)) &&
        (!q || norm(`${t.description} ${t.note ?? ''}`).includes(q)),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  if (!found.length) return { content: 'Nenhum lançamento encontrado.' }
  const sum = (type: string) => round2(found.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0))
  return {
    content: [
      `${found.length} encontrado(s)${found.length > limit ? `, mostrando os ${limit} mais novos` : ''}. Soma: receitas ${money(sum('receita'))}, despesas ${money(sum('despesa'))}.`,
      ...found.slice(0, limit).map(txLine),
    ].join('\n'),
  }
}

function summary(i: Input): Outcome {
  if (!isDay(i.de) || !isDay(i.ate)) return fail('Informe "de" e "ate" como AAAA-MM-DD.')
  const from = i.de
  const to = i.ate
  if (from > to) return fail('"de" vem depois de "ate".')
  if (addMonths(from, 60) < to) return fail('Período grande demais (no máximo 5 anos).')
  const d = useData.getState()
  const cards = cardIndex(d.cards)
  const t = totals(d.transactions, cards, from, to)
  const L = [
    `De ${fmtDate(from)} a ${fmtDate(to)} (compras no cartão contam no mês do vencimento da fatura):`,
    `Receitas ${money(t.income)} (recebido ${money(t.incomePaid)}, a receber ${money(t.incomePending)})`,
    `Despesas ${money(t.expense)} (pago ${money(t.expensePaid)}, a pagar ${money(t.expensePending)})`,
    `Balanço ${money(t.balance)}`,
  ]
  const cats = new Map(d.categories.map((c) => [c.id, c]))
  for (const type of ['despesa', 'receita'] as const) {
    const by = byCategory(d.transactions, cards, d.categories, type, from, to)
    const roots = [...by.entries()].filter(([id]) => !id || rootOf(id, cats)?.id === id).sort((a, b) => b[1] - a[1])
    if (!roots.length) continue
    const parts = roots.map(([id, v]) => {
      const subs = d.categories
        .filter((c) => id && c.parentId === id && (by.get(c.id) ?? 0) > 0)
        .map((c) => `${c.name} ${money(by.get(c.id)!)}`)
      return `${id ? (cats.get(id)?.name ?? '?') : 'Sem categoria'} ${money(v)}${subs.length ? ` (${subs.join(', ')})` : ''}`
    })
    L.push(`${type === 'despesa' ? 'Despesas' : 'Receitas'} por categoria: ${parts.join('; ')}`)
  }
  if (monthKey(from) !== monthKey(to)) {
    const months: string[] = []
    for (let k = monthKey(from); k <= monthKey(to) && months.length < 60; k = shiftMonth(k, 1)) {
      const r = monthRange(k)
      const m = totals(d.transactions, cards, r.from < from ? from : r.from, r.to > to ? to : r.to)
      months.push(`${k}: receitas ${money(m.income)}, despesas ${money(m.expense)}, balanço ${money(m.balance)}`)
    }
    L.push('Por mês:', ...months)
  }
  return { content: L.join('\n') }
}

// ─── Lançamentos ─────────────────────────────────────────────

const FREQ = ['semanal', 'mensal', 'anual'] as const

function launchTool(i: Input, ref: string): Outcome {
  const items = Array.isArray(i.itens) ? i.itens.slice(0, 40) : []
  if (!items.length) return fail('Mande pelo menos um item em "itens".')
  const s = useData.getState()
  const done: string[] = []
  const failed: string[] = []
  for (const raw of items) {
    if (!isObj(raw)) continue
    const type = pick(raw.tipo, ['despesa', 'receita', 'transferencia'] as const)
    const amount = positive(raw.valor)
    const label = text(raw.descricao) ?? '(sem descrição)'
    if (!type || amount === undefined) {
      failed.push(`${label}: tipo ou valor inválido.`)
      continue
    }
    if (has(raw, 'data') && !isDay(raw.data)) {
      failed.push(`${label}: data inválida (use AAAA-MM-DD).`)
      continue
    }
    const bad = (
      [
        ['conta_id', s.accounts],
        ['para_conta_id', s.accounts],
        ['cartao_id', s.cards],
        ['categoria_id', s.categories],
      ] as const
    ).find(([k, list]) => has(raw, k) && !active(list as { id: string; archived?: boolean }[], raw[k]))
    if (bad) {
      failed.push(`${label}: ${bad[0]} ${String(raw[bad[0]])} não existe.`)
      continue
    }
    if (type === 'transferencia' && !has(raw, 'para_conta_id')) {
      failed.push(`${label}: transferência precisa de para_conta_id (pagamento de fatura: pagar_fatura).`)
      continue
    }
    if (type === 'receita' && has(raw, 'cartao_id')) {
      failed.push(`${label}: receita não vai para cartão de crédito.`)
      continue
    }
    const installments = typeof raw.parcelas === 'number' && Number.isFinite(raw.parcelas) ? Math.min(72, Math.max(1, Math.round(raw.parcelas))) : 1
    const item: AssistantTx = {
      type,
      description: text(raw.descricao) ?? '',
      amount,
      date: isDay(raw.data) ? raw.data : ref,
      categoryId: typeof raw.categoria_id === 'string' ? raw.categoria_id : null,
      accountId: typeof raw.conta_id === 'string' ? raw.conta_id : null,
      toAccountId: typeof raw.para_conta_id === 'string' ? raw.para_conta_id : null,
      cardId: typeof raw.cartao_id === 'string' ? raw.cartao_id : null,
      installments,
      paid: raw.pago !== false,
      note: text(raw.observacao, 300) ?? null,
    }
    const ids = launch(item, ref, pick(raw.repetir, FREQ))
    if (!ids.length) failed.push(`${label}: não deu para lançar (confira as contas e o valor).`)
    else done.push(...createdLines(ids).map((l) => `Lançado: ${l}`))
  }
  return report(done, failed)
}

function editOne(e: Input): string {
  const s = useData.getState()
  const t = s.transactions.find((x) => x.id === e.id)
  if (!t) throw new Error(`Lançamento ${String(e.id)} não existe (procure com buscar_lancamentos).`)
  if (t.adjust) throw new Error('É um ajuste de saldo: use ajustar_saldo.')
  const scope: Scope = pick(e.escopo, ['one', 'next', 'all'] as const) ?? 'one'
  const patch: Partial<TxInput> = {}
  if (has(e, 'descricao')) {
    const v = text(e.descricao)
    if (!v) throw new Error('Descrição vazia.')
    patch.description = v
  }
  if (has(e, 'valor')) {
    const v = positive(e.valor)
    if (v === undefined) throw new Error('Valor inválido.')
    patch.amount = v
  }
  if (has(e, 'data')) {
    if (!isDay(e.data)) throw new Error('Data inválida (use AAAA-MM-DD).')
    patch.date = e.data
  }
  let type = t.type
  if (has(e, 'tipo') && e.tipo !== t.type) {
    const v = pick(e.tipo, ['despesa', 'receita'] as const)
    if (!v || t.type === 'transferencia') throw new Error('O tipo só troca entre despesa e receita.')
    type = v
    patch.type = v
    // a categoria é de um tipo só; receita não fica no cartão
    if (!has(e, 'categoria_id')) patch.categoryId = undefined
    if (v === 'receita' && t.cardId) Object.assign(patch, { cardId: undefined, accountId: t.accountId ?? defaultAccountId() })
  }
  if (has(e, 'categoria_id')) {
    if (type === 'transferencia') throw new Error('Transferência não tem categoria.')
    if (e.categoria_id === '') patch.categoryId = undefined
    else {
      const c = active(s.categories, e.categoria_id)
      if (!c || c.type !== type) throw new Error(`Categoria ${String(e.categoria_id)} não existe ou não é de ${type}.`)
      patch.categoryId = c.id
    }
  }
  if (has(e, 'cartao_id')) {
    if (type !== 'despesa') throw new Error('Só despesa vai para o cartão de crédito.')
    const c = active(s.cards, e.cartao_id)
    if (!c) throw new Error(`Cartão ${String(e.cartao_id)} não existe.`)
    Object.assign(patch, { cardId: c.id, accountId: undefined })
  } else if (has(e, 'conta_id')) {
    const a = active(s.accounts, e.conta_id)
    if (!a) throw new Error(`Conta ${String(e.conta_id)} não existe.`)
    patch.accountId = a.id
    // sai do cartão (pagamento de fatura continua preso ao cartão)
    if (t.cardId && t.type !== 'transferencia') patch.cardId = undefined
  }
  if (has(e, 'para_conta_id')) {
    if (t.type !== 'transferencia' || t.cardId) throw new Error('Só transferência entre contas tem conta de destino.')
    const a = active(s.accounts, e.para_conta_id)
    if (!a) throw new Error(`Conta ${String(e.para_conta_id)} não existe.`)
    patch.toAccountId = a.id
  }
  if (has(e, 'observacao')) patch.note = text(e.observacao, 300)
  if (t.debtId && (patch.amount !== undefined || patch.date || patch.type)) throw new Error('É o pagamento de uma dívida: valor e data mudam pela dívida (dividas).')
  const paid = typeof e.pago === 'boolean' ? e.pago : undefined
  if (!Object.keys(patch).length && paid === undefined) throw new Error('Nada para mudar.')
  if (Object.keys(patch).length) s.updateTransaction(t.id, patch, scope)
  const notes: string[] = []
  if (paid !== undefined) {
    if (t.cardId && type === 'despesa' && !patch.accountId) notes.push('compra no cartão fica paga junto com a fatura')
    else if (t.debtId) notes.push('a situação do pagamento de dívida muda pela dívida')
    else useData.getState().setPaid(t.id, paid)
  }
  const after = useData.getState().transactions.find((x) => x.id === t.id)!
  const was = [
    t.description !== after.description && `descrição "${t.description}"`,
    t.amount !== after.amount && `valor ${money(t.amount)}`,
    t.date !== after.date && `data ${fmtDate(t.date)}`,
    t.categoryId !== after.categoryId && `categoria ${catName(t.categoryId) ?? 'nenhuma'}`,
    where(t) !== where(after) && where(t),
    t.status !== after.status && t.status,
  ].filter(Boolean)
  const group = scope !== 'one' && t.groupId ? ` (e ${scope === 'all' ? 'as outras' : 'as próximas'} da série)` : ''
  return `Alterado${group}: ${txLine(after)}${was.length ? ` · antes: ${was.join(', ')}` : ''}${notes.length ? ` · ${notes.join('; ')}` : ''}`
}

function editTool(i: Input): Outcome {
  const list = Array.isArray(i.edicoes) ? i.edicoes.filter(isObj).slice(0, 40) : []
  if (!list.length) return fail('Mande pelo menos uma edição em "edicoes".')
  const done: string[] = []
  const failed: string[] = []
  for (const e of list) {
    try {
      done.push(editOne(e))
    } catch (err) {
      failed.push(`[${String(e.id)}] ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return report(done, failed)
}

function removeTool(i: Input): Outcome {
  const list = Array.isArray(i.itens) ? i.itens.filter(isObj).slice(0, 60) : []
  if (!list.length) return fail('Mande pelo menos um item em "itens".')
  const done: string[] = []
  const failed: string[] = []
  for (const it of list) {
    const s = useData.getState()
    const t = s.transactions.find((x) => x.id === it.id)
    if (!t) {
      failed.push(`[${String(it.id)}] não existe (talvez já tenha sido apagado).`)
      continue
    }
    const before = s.transactions.length
    s.removeTransaction(t.id, pick(it.escopo, ['one', 'next', 'all'] as const) ?? 'one')
    const n = before - useData.getState().transactions.length
    done.push(`Apagado: ${t.description} · ${money(t.amount)} · ${fmtDate(t.date)}${n > 1 ? ` (${n} lançamentos da série)` : ''}`)
  }
  return report(done, failed)
}

function payInvoiceTool(i: Input, ref: string): Outcome {
  const s = useData.getState()
  const card = active(s.cards, i.cartao_id)
  if (!card) return fail(`Cartão ${String(i.cartao_id)} não existe.`)
  if (has(i, 'fatura') && !isMonth(i.fatura)) return fail('"fatura" precisa ser AAAA-MM.')
  if (has(i, 'data') && !isDay(i.data)) return fail('Data inválida (use AAAA-MM-DD).')
  const inv = has(i, 'fatura') ? invoice(card, i.fatura as string, s.transactions, ref) : payableInvoice(card, s.transactions, ref)
  if (!inv || inv.open < 0.005) return fail(`A fatura do ${card.name}${inv ? ` de ${shortMonth(inv.key)}` : ''} não tem valor em aberto.`)
  if (has(i, 'conta_id') && !active(s.accounts, i.conta_id)) return fail(`Conta ${String(i.conta_id)} não existe.`)
  const accountId = has(i, 'conta_id') ? (i.conta_id as string) : (active(s.accounts, card.accountId)?.id ?? defaultAccountId())
  if (!accountId) return fail('Não há conta para pagar a fatura: crie uma conta antes.')
  const asked = has(i, 'valor') ? positive(i.valor) : inv.open
  if (asked === undefined) return fail('Valor inválido.')
  const value = Math.min(asked, inv.open)
  const ids = capture(() => s.payInvoice(card.id, inv.key, accountId, value, isDay(i.data) ? i.data : ref))
  if (!ids.length) return fail('Não deu para registrar o pagamento.')
  return {
    content: `Pago: fatura do ${card.name} de ${shortMonth(inv.key)} (vence ${fmtDate(inv.due)}), ${money(value)} saindo de ${accName(accountId)}${asked > inv.open + 0.005 ? `; ficou no que faltava, não em ${money(asked)}` : ''}${value < inv.open - 0.005 ? `; ainda faltam ${money(round2(inv.open - value))}` : ''} [${ids[0]}]`,
  }
}

// ─── Contas, cartões e categorias ────────────────────────────

/** Banco popular pelo nome ("Conta do Nubank" → Nubank). */
function bankByName(name: string) {
  const q = ` ${norm(name).replace(/[^a-z0-9]+/g, ' ')} `
  return popularBanks.find((b) => {
    const n = norm(shortBankName(b.name)).replace(/[^a-z0-9]+/g, ' ').trim()
    return n.length >= 2 && q.includes(` ${n} `)
  })?.ispb
}

const KINDS = ['corrente', 'poupanca', 'carteira', 'investimento', 'beneficio', 'outro'] as const

function accountsTool(i: Input): Outcome {
  const s = useData.getState()
  const acao = pick(i.acao, ['criar', 'editar', 'arquivar', 'padrao'] as const)
  if (acao === 'criar') {
    const name = text(i.nome, 60)
    if (!name) return fail('Diga o nome da conta.')
    const kind: AccountKind = pick(i.tipo, KINDS) ?? (/carteira|dinheiro/.test(norm(name)) ? 'carteira' : 'corrente')
    const bank = kind === 'carteira' ? undefined : bankByName(name)
    const initial = number(i.saldo_inicial) ?? 0
    const a = s.addAccount({
      name,
      kind,
      initial,
      color: bankColor(bank) ?? palette[s.accounts.length % palette.length],
      ...(bank ? { bank } : {}),
      ...(i.fora_do_total === true ? { hidden: true } : {}),
    })
    return { content: `Conta criada [${a.id}]: ${a.name} · ${accountKindLabel[kind]} · saldo ${money(initial)}` }
  }
  const a = active(s.accounts, i.id)
  if (!acao) return fail('"acao" precisa ser criar, editar, arquivar ou padrao.')
  if (!a) return fail(`Conta ${String(i.id)} não existe.`)
  if (acao === 'padrao') {
    s.setSettings({ defaultAccount: a.id })
    return { content: `${a.name} agora é a conta padrão.` }
  }
  if (acao === 'arquivar') {
    const r = s.removeAccount(a.id)
    if (s.settings.defaultAccount === a.id) s.setSettings({ defaultAccount: '' })
    return { content: r === 'removida' ? `Conta ${a.name} apagada (não tinha lançamentos).` : `Conta ${a.name} arquivada (os lançamentos continuam).` }
  }
  const patch: Partial<typeof a> = {}
  if (text(i.nome, 60)) patch.name = text(i.nome, 60)
  if (pick(i.tipo, KINDS)) patch.kind = pick(i.tipo, KINDS)
  if (typeof i.fora_do_total === 'boolean') patch.hidden = i.fora_do_total || undefined
  if (has(i, 'saldo_inicial')) return fail('Para mudar o saldo use ajustar_saldo.')
  if (!Object.keys(patch).length) return fail('Nada para mudar.')
  s.updateAccount(a.id, patch)
  return { content: `Conta atualizada [${a.id}]: ${patch.name ?? a.name}${patch.kind ? ` · ${accountKindLabel[patch.kind]}` : ''}${'hidden' in patch ? (patch.hidden ? ' · fora do saldo total' : ' · entra no saldo total') : ''}` }
}

function adjustTool(i: Input, ref: string): Outcome {
  const s = useData.getState()
  const a = active(s.accounts, i.conta_id)
  if (!a) return fail(`Conta ${String(i.conta_id)} não existe.`)
  const target = number(i.saldo)
  if (target === undefined) return fail('Saldo inválido.')
  if (has(i, 'data') && !isDay(i.data)) return fail('Data inválida (use AAAA-MM-DD).')
  const current = balances(s.accounts, s.transactions, s.goals).get(a.id) ?? 0
  if (Math.abs(current - target) < 0.005) return { content: `O saldo de ${a.name} já é ${money(target)}.` }
  const ids = capture(() => s.adjustBalance(a.id, current, target, isDay(i.data) ? i.data : ref))
  return { content: `Saldo de ${a.name}: de ${money(current)} para ${money(target)} (ajuste [${ids[0]}]).` }
}

function cardsTool(i: Input): Outcome {
  const s = useData.getState()
  const acao = pick(i.acao, ['criar', 'editar', 'arquivar'] as const)
  if (has(i, 'conta_id') && !active(s.accounts, i.conta_id)) return fail(`Conta ${String(i.conta_id)} não existe.`)
  const last4 = typeof i.final === 'string' && /^\d{4}$/.test(i.final) ? i.final : undefined
  if (acao === 'criar') {
    const name = text(i.nome, 60)
    const limit = positive(i.limite)
    const closingDay = day(i.fechamento)
    const dueDay = day(i.vencimento)
    if (!name || limit === undefined || !closingDay || !dueDay) return fail('Para criar o cartão preciso do nome, do limite e dos dias de fechamento e de vencimento da fatura.')
    const bank = bankByName(name)
    const skin = skinsFor(bank)[0]?.id
    const c = s.addCard({
      name,
      limit,
      closingDay,
      dueDay,
      ...(bank ? { bank } : {}),
      ...(skin ? { skin } : {}),
      ...(last4 ? { last4 } : {}),
      ...(has(i, 'conta_id') ? { accountId: i.conta_id as string } : {}),
      color: cardColor({ bank, skin }),
    })
    return { content: `Cartão criado [${c.id}]: ${c.name} · limite ${money(limit)} · fecha dia ${closingDay}, vence dia ${dueDay}` }
  }
  if (!acao) return fail('"acao" precisa ser criar, editar ou arquivar.')
  const c = active(s.cards, i.id)
  if (!c) return fail(`Cartão ${String(i.id)} não existe.`)
  if (acao === 'arquivar') {
    const r = s.removeCard(c.id)
    return { content: r === 'removido' ? `Cartão ${c.name} apagado (não tinha compras).` : `Cartão ${c.name} arquivado (as compras continuam).` }
  }
  const patch: Partial<Card> = {}
  if (text(i.nome, 60)) patch.name = text(i.nome, 60)
  if (positive(i.limite) !== undefined) patch.limit = positive(i.limite)
  if (day(i.fechamento)) patch.closingDay = day(i.fechamento)
  if (day(i.vencimento)) patch.dueDay = day(i.vencimento)
  if (has(i, 'conta_id')) patch.accountId = i.conta_id as string
  if (last4) patch.last4 = last4
  if (!Object.keys(patch).length) return fail('Nada para mudar.')
  s.updateCard(c.id, patch)
  const n = { ...c, ...patch }
  return { content: `Cartão atualizado [${c.id}]: ${n.name} · limite ${money(n.limit)} · fecha dia ${n.closingDay}, vence dia ${n.dueDay}` }
}

function categoriesTool(i: Input): Outcome {
  const s = useData.getState()
  const acao = pick(i.acao, ['criar', 'editar', 'apagar'] as const)
  if (acao === 'criar') {
    const name = text(i.nome, 40)
    if (!name) return fail('Diga o nome da categoria.')
    let parent: Category | undefined
    if (has(i, 'pai_id')) {
      parent = active(s.categories, i.pai_id)
      if (!parent || parent.parentId) return fail(`Categoria principal ${String(i.pai_id)} não existe (subcategoria não tem subcategoria).`)
    }
    const type = parent?.type ?? pick(i.tipo, ['despesa', 'receita'] as const)
    if (!type) return fail('Diga se a categoria é de despesa ou de receita.')
    const twin = s.categories.find((c) => !c.archived && c.type === type && (c.parentId ?? '') === (parent?.id ?? '') && norm(c.name) === norm(name))
    if (twin) return fail(`Já existe a categoria ${twin.name} [${twin.id}].`)
    const c = s.addCategory({
      name,
      type,
      color: parent?.color ?? palette[s.categories.length % palette.length],
      icon: suggestIcon(name) ?? parent?.icon ?? 'outros',
      ...(parent ? { parentId: parent.id } : {}),
    })
    return { content: `Categoria criada [${c.id}]: ${parent ? `${parent.name} › ` : ''}${c.name} (${type})` }
  }
  if (!acao) return fail('"acao" precisa ser criar, editar ou apagar.')
  const c = active(s.categories, i.id)
  if (!c) return fail(`Categoria ${String(i.id)} não existe.`)
  if (acao === 'apagar') {
    let target: Category | undefined
    if (has(i, 'mover_para')) {
      target = active(s.categories, i.mover_para)
      if (!target || target.type !== c.type || target.id === c.id || target.parentId === c.id) return fail(`Não dá para mover para ${String(i.mover_para)}: precisa ser outra categoria de ${c.type}.`)
    }
    const used = s.transactions.filter((t) => t.categoryId === c.id || s.categories.some((x) => x.parentId === c.id && x.id === t.categoryId)).length
    s.removeCategory(c.id, target?.id)
    return { content: `Categoria ${c.name} apagada${used ? `; ${used} lançamento(s) ${target ? `foram para ${target.name}` : 'ficaram sem categoria'}` : ''}.` }
  }
  const name = text(i.nome, 40)
  if (!name) return fail('Diga o novo nome.')
  s.updateCategory(c.id, { name })
  return { content: `Categoria renomeada [${c.id}]: ${c.name} → ${name}` }
}

function budgetTool(i: Input): Outcome {
  const s = useData.getState()
  const value = number(i.valor)
  if (value === undefined || value < 0) return fail('Valor inválido (0 tira o limite).')
  if (!has(i, 'categoria_id')) {
    s.setSettings({ budgetTotal: value })
    return { content: value > 0 ? `Limite geral do mês: ${money(value)}.` : 'Sem limite geral (vale a soma dos limites das categorias).' }
  }
  const c = active(s.categories, i.categoria_id)
  if (!c || c.type !== 'despesa') return fail(`Categoria de despesa ${String(i.categoria_id)} não existe.`)
  s.setBudget(c.id, value)
  return { content: value > 0 ? `Limite de ${c.name}: ${money(value)} por mês.` : `${c.name} ficou sem limite.` }
}

// ─── Metas e dívidas ─────────────────────────────────────────

function goalsTool(i: Input, ref: string): Outcome {
  const s = useData.getState()
  const acao = pick(i.acao, ['criar', 'editar', 'apagar', 'guardar', 'resgatar', 'concluir', 'reabrir'] as const)
  if (has(i, 'conta_id') && !active(s.accounts, i.conta_id)) return fail(`Conta ${String(i.conta_id)} não existe.`)
  if (has(i, 'prazo') && i.prazo !== '' && !isDay(i.prazo)) return fail('Prazo inválido (use AAAA-MM-DD).')
  if (has(i, 'data') && !isDay(i.data)) return fail('Data inválida (use AAAA-MM-DD).')
  const accountId = has(i, 'conta_id') ? (i.conta_id as string) : undefined
  if (acao === 'criar') {
    const name = text(i.nome, 60)
    const target = positive(i.valor_alvo)
    if (!name || target === undefined) return fail('Para criar a meta preciso do nome e de quanto quer juntar.')
    const initial = positive(i.valor)
    const g = s.addGoal({
      name,
      target,
      color: palette[(s.goals.length * 3) % palette.length],
      icon: suggestIcon(name) ?? 'cofrinho',
      ...(isDay(i.prazo) ? { deadline: i.prazo } : {}),
      ...(positive(i.mensal) !== undefined ? { monthly: positive(i.mensal) } : {}),
      ...(initial ? { initial } : {}),
      ...(accountId ? { accountId } : {}),
    })
    return { content: `Meta criada [${g.id}]: ${g.name} · alvo ${money(target)}${initial ? ` · já guardado ${money(initial)}` : ''}${g.deadline ? ` · até ${fmtDate(g.deadline)}` : ''}` }
  }
  if (!acao) return fail('"acao" inválida.')
  const g = active(s.goals, i.id)
  if (!g) return fail(`Meta ${String(i.id)} não existe.`)
  const saved = goalStats(g, ref).saved
  switch (acao) {
    case 'apagar':
      s.removeGoal(g.id)
      return { content: `Meta ${g.name} apagada.` }
    case 'concluir':
      s.updateGoal(g.id, { completedAt: ref })
      return { content: `Meta ${g.name} concluída.` }
    case 'reabrir':
      s.updateGoal(g.id, { completedAt: undefined })
      return { content: `Meta ${g.name} reaberta.` }
    case 'guardar':
    case 'resgatar': {
      const v = positive(i.valor)
      if (v === undefined) return fail('Diga o valor.')
      if (acao === 'resgatar' && v > saved + 0.005) return fail(`Só há ${money(saved)} guardado em ${g.name}.`)
      s.contribute(g.id, acao === 'guardar' ? v : -v, accountId, isDay(i.data) ? i.data : ref)
      const now = goalStats(useData.getState().goals.find((x) => x.id === g.id)!, ref)
      return { content: `${acao === 'guardar' ? 'Guardado' : 'Resgatado'} ${money(v)} ${acao === 'guardar' ? 'em' : 'de'} ${g.name}${accountId ? ` (${acao === 'guardar' ? 'saiu de' : 'voltou para'} ${accName(accountId)})` : ''} · agora ${money(now.saved)} de ${money(g.target)}` }
    }
    case 'editar': {
      const patch: Partial<typeof g> = {}
      if (text(i.nome, 60)) patch.name = text(i.nome, 60)
      if (positive(i.valor_alvo) !== undefined) patch.target = positive(i.valor_alvo)
      if (has(i, 'prazo')) patch.deadline = isDay(i.prazo) ? i.prazo : undefined
      if (has(i, 'mensal')) patch.monthly = positive(i.mensal)
      if (!Object.keys(patch).length) return fail('Nada para mudar.')
      s.updateGoal(g.id, patch)
      const n = { ...g, ...patch }
      return { content: `Meta atualizada [${g.id}]: ${n.name} · alvo ${money(n.target)}${n.deadline ? ` · até ${fmtDate(n.deadline)}` : ''}${n.monthly ? ` · ${money(n.monthly)} por mês` : ''}` }
    }
  }
}

function debtsTool(i: Input, ref: string): Outcome {
  const s = useData.getState()
  const acao = pick(i.acao, ['criar', 'pagar', 'editar', 'apagar'] as const)
  if (has(i, 'conta_id') && !active(s.accounts, i.conta_id)) return fail(`Conta ${String(i.conta_id)} não existe.`)
  if (has(i, 'data') && !isDay(i.data)) return fail('Data inválida (use AAAA-MM-DD).')
  const accountId = has(i, 'conta_id') ? (i.conta_id as string) : undefined
  const kind = pick(i.tipo, ['emprestimo', 'financiamento', 'pessoal', 'acordo'] as const) as DebtKind | undefined
  if (acao === 'criar') {
    const direction = pick(i.direcao, ['pagar', 'receber'] as const)
    const person = text(i.pessoa, 80)
    const principal = positive(i.valor)
    if (!direction || !person || principal === undefined) return fail('Para criar preciso saber quem deve a quem (direcao), com quem (pessoa) e o valor.')
    if (has(i, 'primeiro_vencimento') && !isDay(i.primeiro_vencimento)) return fail('primeiro_vencimento inválido (use AAAA-MM-DD).')
    const frequency: Frequency = pick(i.frequencia, ['diaria', 'semanal', 'quinzenal', 'mensal'] as const) ?? 'mensal'
    const rate = Math.max(0, number(i.juros) ?? 0) / 100
    const count = typeof i.parcelas === 'number' && Number.isFinite(i.parcelas) ? Math.min(360, Math.max(1, Math.round(i.parcelas))) : 1
    const debt = s.addDebt({
      direction,
      kind: kind ?? (direction === 'receber' ? 'pessoal' : 'emprestimo'),
      person,
      principal,
      rate,
      mode: i.juros_compostos === true ? 'composto' : 'simples',
      frequency,
      count,
      firstDue: isDay(i.primeiro_vencimento) ? i.primeiro_vencimento : firstDueFor(frequency, ref),
      ...(accountId ? { accountId } : {}),
      ...(text(i.observacao, 300) ? { note: text(i.observacao, 300) } : {}),
      ...(i.registrar_dinheiro === true && accountId ? { register: true } : {}),
    })
    const sum = summarize(debt, ref)
    return {
      content: `Dívida criada [${debt.id}]: ${direction === 'pagar' ? `devo a ${person}` : `${person} me deve`} · ${count}x de ${money(debt.schedule[0].amount)} (total ${money(sum.total)}) · 1ª em ${fmtDate(debt.schedule[0].due)}${i.registrar_dinheiro === true && !accountId ? ' · não lancei o dinheiro na conta (falta conta_id)' : ''}`,
    }
  }
  if (!acao) return fail('"acao" precisa ser criar, pagar, editar ou apagar.')
  const debt = s.debts.find((d) => d.id === i.id)
  if (!debt) return fail(`Dívida ${String(i.id)} não existe.`)
  if (acao === 'apagar') {
    s.removeDebt(debt.id)
    return { content: `Dívida com ${debt.person} apagada (com os pagamentos lançados).` }
  }
  if (acao === 'pagar') {
    const v = positive(i.valor)
    if (v === undefined) return fail('Diga o valor pago.')
    capture(() => s.payDebt(debt.id, v, 0, isDay(i.data) ? i.data : ref, accountId))
    const sum = summarize(useData.getState().debts.find((d) => d.id === debt.id)!, ref)
    return { content: `Pagamento de ${money(v)} registrado na dívida com ${debt.person} · falta ${money(sum.open)}${sum.next ? ` · próxima parcela ${fmtDate(sum.next.due)}` : ' · quitada'}` }
  }
  const patch: Parameters<typeof s.updateDebt>[1] = {}
  if (text(i.pessoa, 80)) patch.person = text(i.pessoa, 80)
  if (kind) patch.kind = kind
  if (accountId) patch.accountId = accountId
  if (has(i, 'observacao')) patch.note = text(i.observacao, 300)
  if (!Object.keys(patch).length) return fail('Nada para mudar (valores e parcelas mudam renegociando na tela da dívida).')
  s.updateDebt(debt.id, patch)
  return { content: `Dívida atualizada [${debt.id}]: ${patch.person ?? debt.person}` }
}

// ─── Execução ────────────────────────────────────────────────

export interface ToolContext {
  /** dia de hoje (AAAA-MM-DD) */
  ref: string
  /** desfaz a última resposta do assistente; devolve o que foi desfeito ou null */
  undo: () => string | null
}

export interface ToolOutcome {
  content: string
  error?: boolean
  /** a IA disse que acabou e deu tudo certo: não precisa voltar a ela */
  final: boolean
  /** o resultado em texto para a pessoa (sem ids), quando a conversa para sem a IA responder */
  say?: string
}

const RUN: Record<string, (i: Input, ctx: ToolContext) => Outcome> = {
  buscar_lancamentos: (i, c) => search(i, c.ref),
  resumo: (i) => summary(i),
  lancar: (i, c) => launchTool(i, c.ref),
  editar_lancamentos: (i) => editTool(i),
  apagar_lancamentos: (i) => removeTool(i),
  pagar_fatura: (i, c) => payInvoiceTool(i, c.ref),
  desfazer: (_i, c) => {
    const what = c.undo()
    return what ? { content: `Desfeito: ${what}` } : { content: 'Não há nada seu para desfazer.' }
  },
  contas: (i) => accountsTool(i),
  ajustar_saldo: (i, c) => adjustTool(i, c.ref),
  cartoes: (i) => cardsTool(i),
  categorias: (i) => categoriesTool(i),
  orcamento: (i) => budgetTool(i),
  metas: (i, c) => goalsTool(i, c.ref),
  dividas: (i, c) => debtsTool(i, c.ref),
}

const READ = new Set(['buscar_lancamentos', 'resumo'])
/** Os cartões dos lançamentos já mostram o que estas fizeram. */
const SHOWN = new Set(['lancar', 'editar_lancamentos'])
const plain = (s: string) => s.replace(/\s*\[[^\]\s]+\]/g, '')

/** Executa uma ferramenta pedida pela IA. Entrada inválida volta como erro, para a IA corrigir. */
export function runTool(name: string, input: unknown, ctx: ToolContext): ToolOutcome {
  const fn = RUN[name]
  if (!fn) return { content: `Ferramenta desconhecida: ${name}.`, error: true, final: false }
  const i = isObj(input) ? input : {}
  try {
    const out = fn(i, ctx)
    return {
      content: out.content,
      ...(out.error ? { error: true } : {}),
      final: !READ.has(name) && !out.error && !out.partial && i.encerrar === true,
      ...(READ.has(name) || SHOWN.has(name) ? {} : { say: plain(out.content) }),
    }
  } catch (e) {
    console.warn('[assistente] ferramenta falhou', name, e)
    return { content: `Não deu para executar: ${e instanceof Error ? e.message : String(e)}`, error: true, final: false }
  }
}
