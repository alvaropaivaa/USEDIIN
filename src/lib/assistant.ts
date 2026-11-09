// Assistente dentro do app: a pessoa conversa por texto, áudio, foto ou PDF e ele faz o que for
// preciso no app (lançar, corrigir, apagar, contas, cartões, metas…) pelo store, com as mesmas
// regras das telas (parcelas, faturas e sincronização).
//
// A IA roda no servidor (função supabase/functions/assistente); o app manda junto o resumo das
// finanças, calculado aqui, executa as ferramentas que ela pede (lib/agent.ts) e devolve os
// resultados até ela terminar. Tudo o que uma resposta muda fica guardado nela, para desfazer.
// Sem conta na nuvem (ou com o servidor fora do ar), um modo simples entende texto curto aqui mesmo.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { uid } from './crypto'
import { addDays, monthKey, shiftMonth, today } from './dates'
import { moneyRaw } from './format'
import { balances, byCategory, cardIndex, cardUsage, goalStats, invoice, invoiceFor, limitOf, monthRange, overallBudget, totals, type Transaction } from './ledger'
import { summarize } from './loans'
import { amountIn, parseQuick } from './quick'
import { collections, useData, type Collection, type Settings } from './store'
import { defaultAccountId, launch, runTool } from './agent'
import { simpleAction, simpleAnswer } from './simple'
import { aiEnabled } from './features'
import { LIMITS, type AgentStep, type AgentToolResult, type AssistantContext, type AssistantOps, type AssistantTx, type HistoryTurn } from './assistantContract'

export type { AssistantOps, AssistantTx } from './assistantContract'

// ─── Conversa ────────────────────────────────────────────────

export interface ChatAttachment {
  id?: string
  kind: 'image' | 'audio' | 'pdf'
  name?: string
  /** Miniatura da foto (JPEG pequeno), para o histórico. */
  thumb?: string
  seconds?: number
}

type Item = { id: string }

/** O que uma resposta mudou: o que ela criou e como estava o que ela alterou ou apagou. */
export interface Changes {
  added: Partial<Record<Collection, string[]>>
  before: Partial<Record<Collection, Item[]>>
  settings?: Partial<Pick<Settings, 'budgetTotal' | 'defaultAccount'>>
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: string
  attachments?: ChatAttachment[]
  /** Transcrição do áudio (mostrada no balão de quem falou). */
  transcript?: string
  /** Lançamentos que esta resposta criou ou corrigiu (para mostrar). */
  created?: string[]
  /** Tudo o que esta resposta mudou (para desfazer). */
  changes?: Changes
  /** Respostas antigas: como cada lançamento estava antes da correção. */
  before?: Transaction[]
  /** Esta resposta desfez aquela (desfazer esta devolve aquela). */
  undid?: string
  undone?: boolean
  status?: 'sending' | 'error'
  /** Respondido pelo modo simples (sem o servidor). */
  local?: boolean
  /** Rótulo do lançamento mostrado (Recebido, Pago, Alterado…); sem ele, Lançado ou Corrigido. */
  label?: string
}

interface ChatState {
  /** De quem é a conversa (trocou de conta: começa outra). */
  owner: string
  messages: ChatMessage[]
  add: (m: Omit<ChatMessage, 'id' | 'at'>) => ChatMessage
  update: (id: string, patch: Partial<ChatMessage>) => void
  reset: (owner: string) => void
}

export const useChat = create<ChatState>()(
  persist(
    (set) => ({
      owner: '',
      messages: [],
      add: (m) => {
        const msg = { ...m, id: uid(), at: new Date().toISOString() }
        set((s) => ({ messages: [...s.messages, msg] }))
        return msg
      },
      update: (id, patch) => set((s) => ({ messages: s.messages.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      reset: (owner) => set({ owner, messages: [] }),
    }),
    {
      name: 'jurospro-chat',
      // guarda as últimas 120 mensagens; uma resposta que ficou "enviando" ao fechar vira erro
      partialize: (s) => ({
        owner: s.owner,
        messages: s.messages.slice(-120).map((m) => (m.status === 'sending' ? { ...m, status: 'error' as const, text: m.text || 'A resposta não chegou.' } : m)),
      }),
    },
  ),
)

/** Última resposta já pronta do assistente (a que está sendo escrita agora não conta). */
const lastReply = () => {
  const list = useChat.getState().messages
  for (let i = list.length - 1; i >= 0; i--) if (list[i].role === 'assistant' && list[i].status !== 'sending') return list[i]
  return undefined
}

/** Última resposta que mudou algo e ainda não foi desfeita (alvo de "desfazer" e de correções). */
const lastApplied = () => {
  const list = useChat.getState().messages
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]
    if (m.role === 'assistant' && (m.created?.length || m.changes) && !m.undone && m.status !== 'sending') return m
  }
  return undefined
}

// ─── O que uma resposta mudou ────────────────────────────────

const SETTINGS_KEYS = ['budgetTotal', 'defaultAccount'] as const

/** Roda uma mudança no store e devolve o que ela mudou (null = nada). */
function track(fn: () => void): Changes | null {
  const prev = useData.getState()
  fn()
  const next = useData.getState()
  const ch: Changes = { added: {}, before: {} }
  let any = false
  for (const k of collections) {
    if (prev[k] === next[k]) continue
    const old = new Map((prev[k] as Item[]).map((x) => [x.id, x]))
    const now = new Map((next[k] as Item[]).map((x) => [x.id, x]))
    const added = [...now.keys()].filter((id) => !old.has(id))
    // o que mudou ou saiu: como estava
    const before = [...old.values()].filter((x) => now.get(x.id) !== x)
    if (added.length) ch.added[k] = added
    if (before.length) ch.before[k] = before
    any ||= added.length > 0 || before.length > 0
  }
  for (const key of SETTINGS_KEYS)
    if (prev.settings[key] !== next.settings[key]) {
      ch.settings = { ...ch.settings, [key]: prev.settings[key] }
      any = true
    }
  return any ? ch : null
}

/** Junta as mudanças de passos seguidos: vale o estado de antes do primeiro. */
function merge(a: Changes | null, b: Changes | null): Changes | null {
  if (!a || !b) return a ?? b
  const out: Changes = { added: { ...a.added }, before: { ...a.before }, ...(a.settings || b.settings ? { settings: { ...b.settings, ...a.settings } } : {}) }
  for (const k of collections) {
    const added = new Set(a.added[k] ?? [])
    const known = new Set((a.before[k] ?? []).map((x) => x.id))
    // o que o primeiro passo criou some ao desfazer; o que ele já tinha mudado fica como estava antes dele
    const fresh = (b.before[k] ?? []).filter((x) => !added.has(x.id) && !known.has(x.id))
    if (fresh.length) out.before[k] = [...(a.before[k] ?? []), ...fresh]
    if (b.added[k]?.length) out.added[k] = [...added, ...b.added[k]!]
  }
  return out
}

/** Lançamentos para mostrar numa resposta: os que ela criou ou mudou e ainda existem. */
function shownTx(ch: Changes | null) {
  if (!ch) return []
  const ids = [...(ch.added.transactions ?? []), ...(ch.before.transactions ?? []).map((t) => t.id)]
  const have = new Set(useData.getState().transactions.map((t) => t.id))
  return [...new Set(ids)].filter((id) => have.has(id))
}

/** Volta o que uma resposta mudou, sem mexer no que veio depois em outros registros. */
function revert(ch: Changes) {
  useData.setState((s) => {
    const patch: Partial<Record<Collection, Item[]>> & { settings?: Settings } = {}
    for (const k of collections) {
      const added = new Set(ch.added[k] ?? [])
      const back = new Map((ch.before[k] ?? []).map((x) => [x.id, x]))
      if (!added.size && !back.size) continue
      const kept = (s[k] as Item[]).filter((x) => !added.has(x.id)).map((x) => back.get(x.id) ?? x)
      const have = new Set(kept.map((x) => x.id))
      patch[k] = [...(ch.before[k] ?? []).filter((x) => !have.has(x.id)), ...kept]
    }
    if (ch.settings) patch.settings = { ...s.settings, ...ch.settings }
    return patch as Partial<typeof s>
  })
}

/** Desfaz uma resposta: apaga o que ela criou e volta o que ela mudou. */
export function undoMessage(m: ChatMessage) {
  if (m.changes) revert(m.changes)
  else {
    // respostas antigas (antes de guardar as mudanças): só lançamentos
    const data = useData.getState()
    const fixed = new Set((m.before ?? []).map((t) => t.id))
    for (const id of m.created ?? []) if (!fixed.has(id)) data.removeTransaction(id)
    if (m.before?.length) {
      const back = new Map(m.before.map((t) => [t.id, t]))
      useData.setState((s) => {
        const kept = s.transactions.map((t) => back.get(t.id) ?? t)
        const have = new Set(kept.map((t) => t.id))
        return { transactions: [...m.before!.filter((t) => !have.has(t.id)), ...kept] }
      })
    }
  }
  const chat = useChat.getState()
  chat.update(m.id, { undone: true })
  // esta resposta tinha desfeito outra: aquela volta a valer
  if (m.undid) chat.update(m.undid, { undone: false })
}

// ─── Resumo das finanças para o assistente ────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100

/** Parcelas viram um item só (valor total, número de parcelas, data e situação da primeira). */
function asItems(txs: Transaction[]): AssistantTx[] {
  const groups = new Map<string, Transaction[]>()
  for (const t of txs) groups.set(t.groupId ?? t.id, [...(groups.get(t.groupId ?? t.id) ?? []), t])
  return [...groups.values()].map((g) => {
    const list = [...g].sort((a, b) => (a.installment?.n ?? 0) - (b.installment?.n ?? 0))
    const t = list[0]
    return {
      type: t.type,
      description: t.description,
      amount: round2(list.reduce((s, x) => s + x.amount, 0)),
      date: t.date,
      categoryId: t.categoryId ?? null,
      accountId: t.accountId ?? null,
      toAccountId: t.toAccountId ?? null,
      cardId: t.cardId ?? null,
      installments: t.installment?.count ?? 1,
      paid: t.status === 'pago',
      note: t.note ?? null,
    }
  })
}

/** Lançamentos (como estão agora) da última resposta que mudou algo. */
const lastTargets = () => {
  const m = lastApplied()
  if (!m) return []
  const ids = new Set(m.created)
  return useData.getState().transactions.filter((t) => ids.has(t.id))
}

/** O contexto do assistente, com as regras do app (o mesmo que o WhatsApp monta no servidor). */
export function buildContext(ref = today()): AssistantContext {
  const d = useData.getState()
  const cards = cardIndex(d.cards)
  const bal = balances(d.accounts, d.transactions, d.goals)
  const accounts = d.accounts.filter((a) => !a.archived)
  const activeCards = d.cards.filter((c) => !c.archived)
  const categories = d.categories.filter((c) => !c.archived)
  const key = monthKey(ref)
  const { from, to } = monthRange(key)
  const prev = shiftMonth(key, -1)
  const pr = monthRange(prev)
  const spent = byCategory(d.transactions, cards, d.categories, 'despesa', from, to)

  const invoices: NonNullable<AssistantContext['invoices']> = []
  for (const c of activeCards) {
    const current = invoiceFor(c, ref)
    const older = [...new Set(d.transactions.filter((t) => t.cardId === c.id && t.type === 'despesa' && t.invoice && t.invoice < current).map((t) => t.invoice!))].sort()
    for (const k of older) {
      const o = invoice(c, k, d.transactions, ref)
      if (o.open > 0.005) invoices.push({ cardId: c.id, key: k, due: o.due, total: o.total, open: o.open, status: o.status })
    }
    const cur = invoice(c, current, d.transactions, ref)
    invoices.push({ cardId: c.id, key: current, due: cur.due, total: cur.total, open: cur.open, status: cur.status })
  }

  const pending = d.transactions.filter((t) => t.status === 'pendente' && !t.cardId && t.type !== 'transferencia')
  const late = pending.filter((t) => t.date < ref).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10)
  const soon = pending.filter((t) => t.date >= ref && t.date <= addDays(ref, 7)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10)
  const overall = overallBudget(d.categories, d.settings.budgetTotal, d.transactions, cards, key)
  const catName = (id?: string) => (id ? d.categories.find((c) => c.id === id)?.name : undefined)
  const accName = (id?: string) => (id ? d.accounts.find((a) => a.id === id)?.name : undefined)
  const where = (t: Transaction) =>
    t.cardId ? `cartão ${cards.get(t.cardId)?.name ?? '?'}` : t.type === 'transferencia' ? `${accName(t.accountId) ?? '?'} → ${accName(t.toAccountId) ?? '?'}` : (accName(t.accountId) ?? null)

  // os mais recentes e, mesmo que mais antigos ou futuros, os da última resposta (uma linha por compra parcelada)
  const lastIds = new Set(lastApplied()?.created ?? [])
  const recent = [...d.transactions]
    .filter((t) => t.date <= ref)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12)
  const seen = new Set(recent.map((t) => t.groupId ?? t.id))
  for (const t of d.transactions
    .filter((x) => lastIds.has(x.id))
    .sort((a, b) => (a.installment?.n ?? 0) - (b.installment?.n ?? 0) || a.date.localeCompare(b.date))) {
    if (seen.has(t.groupId ?? t.id)) continue
    seen.add(t.groupId ?? t.id)
    recent.push(t)
  }

  return {
    today: ref,
    name: d.settings.owner.trim() || null,
    categories: categories.map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId ?? null })),
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind, balance: bal.get(a.id) ?? 0, ...(a.hidden ? { hidden: true } : {}) })),
    cards: activeCards.map((c) => ({
      id: c.id,
      name: c.name,
      ...(c.brand ? { brand: c.brand } : {}),
      ...(c.last4 ? { last4: c.last4 } : {}),
      closingDay: c.closingDay,
      dueDay: c.dueDay,
      limit: c.limit,
      available: cardUsage(c, d.transactions).available,
    })),
    defaultAccount: defaultAccountId() ?? null,
    totalBalance: accounts.length ? round2(accounts.filter((a) => !a.hidden).reduce((s, a) => s + (bal.get(a.id) ?? 0), 0)) : null,
    month: { key, ...totals(d.transactions, cards, from, to) },
    previousMonth: { key: prev, ...totals(d.transactions, cards, pr.from, pr.to) },
    expenseByCategory: [
      ...categories
        .filter((c) => c.type === 'despesa' && !c.parentId)
        .map((c) => ({ categoryId: c.id as string | null, name: c.name, amount: spent.get(c.id) ?? 0, limit: limitOf(c, d.categories) || null }))
        .filter((x) => x.amount > 0 || x.limit)
        .sort((a, b) => b.amount - a.amount),
      ...((spent.get('') ?? 0) > 0 ? [{ categoryId: null, name: 'Sem categoria', amount: spent.get('')!, limit: null }] : []),
    ],
    budget: overall.limit > 0 ? overall : null,
    invoices,
    bills: [...late, ...soon].map((t) => ({ type: t.type as 'receita' | 'despesa', description: t.description, amount: t.amount, date: t.date, late: t.date < ref })),
    recent: recent.slice(0, 30).map((t) => ({
      id: t.id,
      date: t.date,
      type: t.type,
      description: t.description,
      amount: t.amount,
      category: catName(t.categoryId) ?? null,
      where: where(t),
      status: t.status,
      installment: t.installment ? `${t.installment.n}/${t.installment.count}` : null,
      ...(lastIds.has(t.id) ? { last: true } : {}),
    })),
    goals: d.goals
      .filter((g) => !g.archived)
      .slice(0, 50)
      .map((g) => {
        const st = goalStats(g, ref)
        return { id: g.id, name: g.name, target: g.target, saved: st.saved, deadline: g.deadline ?? null, monthly: g.monthly ?? null, ...(g.completedAt || st.done ? { done: true } : {}) }
      }),
    debts: d.debts
      .map((x) => ({ x, sum: summarize(x, ref) }))
      // as quitadas por último
      .sort((a, b) => Number(a.sum.status === 'quitado') - Number(b.sum.status === 'quitado'))
      .slice(0, 50)
      .map(({ x, sum }) => ({
        id: x.id,
        direction: x.direction,
        person: x.person,
        kind: x.kind,
        open: sum.open,
        next: sum.next ? { due: sum.next.due, amount: sum.next.remaining } : null,
        status: sum.status,
      })),
    lastCreated: asItems(lastTargets()),
  }
}

// ─── Aplicar o que o modo simples entendeu ───────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/

/**
 * Aplica as operações do modo simples (o mesmo contrato do WhatsApp): desfazer, corrigir e lançar.
 * A correção refaz cada item da última resposta com os campos novos (parcelas recalculadas);
 * com vários itens, o valor não muda.
 */
export function applyOps(ops: AssistantOps, ref = today()) {
  const before: Transaction[] = []
  const created: string[] = []
  if (ops.undo) {
    const last = lastApplied()
    if (last) undoMessage(last)
  } else if (ops.correct) {
    const targets = lastTargets().filter((t) => !t.debtId && !(t.type === 'transferencia' && t.cardId))
    const groups = new Map<string, Transaction[]>()
    for (const t of targets) groups.set(t.groupId ?? t.id, [...(groups.get(t.groupId ?? t.id) ?? []), t])
    const fix = { ...ops.correct }
    if (groups.size > 1) delete fix.amount
    for (const group of groups.values()) {
      const [item] = asItems(group)
      const next: AssistantTx = { ...item }
      if (fix.description) next.description = fix.description
      if (fix.amount !== undefined && fix.amount > 0) next.amount = fix.amount
      if (fix.date && ISO.test(fix.date)) next.date = fix.date
      if (fix.categoryId !== undefined) next.categoryId = fix.categoryId
      if (fix.paid !== undefined) next.paid = fix.paid
      if (fix.cardId) {
        next.cardId = fix.cardId
        next.accountId = null
      } else if (fix.accountId) {
        next.accountId = fix.accountId
        next.cardId = null
      }
      before.push(...group)
      for (const t of group) useData.getState().removeTransaction(t.id)
      created.push(...launch(next, ref))
    }
  }
  for (const item of ops.create) created.push(...launch(item, ref))
  return { created, before }
}

/** Aplica as operações do modo simples guardando tudo o que mudou (para desfazer). */
export function applyTracked(ops: AssistantOps, ref = today()) {
  let undid: string | undefined
  const changes = track(() => {
    if (ops.undo) undid = lastApplied()?.id
    applyOps(ops, ref)
  })
  return { changes, created: shownTx(changes), ...(undid ? { undid } : {}) }
}

// ─── Modo simples (sem servidor) ─────────────────────────────

export interface Reply {
  reply: string
  ops: AssistantOps
  /** Mudança fora do contrato do WhatsApp (dar baixa, alterar, apagar…); se devolver texto, ele vira a resposta. */
  act?: () => string | void
  label?: string
}

const UNDO = /^\s*(desfaz(er)?|desfa[cç]a|apaga( isso)?|cancela( isso)?|errei)\s*[.!]?\s*$/i
const QUESTION = /\?\s*$|^\s*(quanto|qual|quais|como|cad[eê]|o que|tenho|falta|faltam|me (diz|fala|mostra))\b/i
const FIX = /\b(errei|erro|me enganei|na verdade|corrig\w*|digitei errado|o certo|o correto|nao foi|nao era)\b/
const WAS = /\b(foi|era|eram|caiu|veio|deu|sao|e)\b/
/** Só o valor novo: "foi 3.500", "veio 192,30". */
const BARE = /^(foi|era|eram|veio|caiu|deu|entrou|saiu|na verdade|o certo e|o valor e|o valor foi|valor)$/
const plainNorm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const say = (reply: string, ops: Partial<AssistantOps> = {}): Reply => ({ reply, ops: { create: [], undo: false, correct: null, ...ops } })

/** Perguntas simples respondidas com as contas do próprio app: saldo, gastos, receitas e faturas. */
function localAnswer(text: string, ref: string): Reply | null {
  const t = plainNorm(text)
  const c = buildContext(ref)
  const top = (rows: { name: string; amount: number }[]) =>
    rows
      .filter((r) => r.amount > 0)
      .slice(0, 3)
      .map((r) => `${r.name} ${moneyRaw(r.amount)}`)
      .join(', ')
  if (/\bsaldo|quanto (eu )?tenho\b/.test(t)) {
    const named = c.accounts.filter((a) => t.includes(plainNorm(a.name)))
    if (named.length) return say(named.map((a) => `Saldo de ${a.name}: ${moneyRaw(a.balance ?? 0)}.`).join('\n'))
    return say(`Seu saldo total é ${moneyRaw(c.totalBalance ?? 0)}.${c.accounts.length > 1 ? `\n${c.accounts.map((a) => `${a.name}: ${moneyRaw(a.balance ?? 0)}`).join('\n')}` : ''}`)
  }
  if (/\b(recebi|ganhei|receitas?|entrou|entrada)\b/.test(t)) return say(`Este mês entraram ${moneyRaw(c.month?.income ?? 0)}.`)
  if (/\b(gastei|gasto|gastos|despesas?|saiu|paguei)\b/.test(t)) {
    const biggest = top(c.expenseByCategory ?? [])
    return say(`Este mês você gastou ${moneyRaw(c.month?.expense ?? 0)}.${biggest ? ` Maiores gastos: ${biggest}.` : ''}`)
  }
  if (/\b(fatura|cartao)\b/.test(t) && c.cards.length) {
    const current = (c.invoices ?? []).filter((i) => i.key === invoiceFor(useData.getState().cards.find((k) => k.id === i.cardId)!, ref))
    return say(current.map((i) => `Fatura de ${c.cards.find((k) => k.id === i.cardId)?.name}: ${moneyRaw(i.open > 0 ? i.open : i.total)} (vence ${i.due.slice(8, 10)}/${i.due.slice(5, 7)}).`).join('\n'))
  }
  return null
}

/**
 * Correção do que a última resposta lançou ou mudou: "errei, foi 3 mil", "na verdade era 50",
 * "o salário que caiu foi 3500", "foi 3.500". Só logo depois dela; precisa de uma palavra de
 * correção, de citar o lançamento junto com "foi"/"era", ou de vir só o valor (senão "uber foi 30"
 * seria um gasto novo).
 */
function localFix(text: string): Reply | null {
  const last = lastApplied()
  if (!last || last !== lastReply()) return null
  const targets = lastTargets()
  const items = asItems(targets)
  if (items.length !== 1) return null
  const t = plainNorm(text)
  const amount = amountIn(t)
  if (!amount) return null
  const rest = t.replace(amount.match, ' ').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
  const words = plainNorm(items[0].description)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4)
  const named = words.some((w) => t.includes(w))
  if (!FIX.test(t) && !(named && WAS.test(t)) && !BARE.test(rest)) return null
  const item = items[0]
  const value = amount.value
  const reply = `Corrigi: ${item.description} agora é ${moneyRaw(value)}${item.installments > 1 ? ` em ${item.installments}x` : ''}.`
  // o lançamento já existia (baixa ou alteração pelo chat): muda o valor nele mesmo, sem refazer
  const known = new Set((last.changes?.before.transactions ?? []).map((x) => x.id))
  if (targets.length === 1 && known.has(targets[0].id)) {
    const id = targets[0].id
    return { ...say(reply), act: () => useData.getState().updateTransaction(id, { amount: value }, 'one'), label: 'Corrigido' }
  }
  return say(reply, { correct: { amount: value } })
}

/**
 * Entende texto curto no próprio aparelho: "uber 23,50", "recebi 2 mil de salário", "caiu meu salário",
 * "paguei a luz", "muda o aluguel para 1.900", "apaga o uber de ontem", "errei, foi 3 mil", "desfazer",
 * "qual meu saldo?", "o que falta pagar?".
 */
export function localReply(text: string, ref = today()): Reply {
  if (UNDO.test(text)) return say(lastApplied() ? 'Pronto, desfiz o último lançamento.' : 'Não tem lançamento meu para desfazer.', { undo: true })
  const fix = localFix(text)
  if (fix) return fix
  if (QUESTION.test(text)) {
    const answer = simpleAnswer(text, ref)
    if (answer) return say(answer)
    return (
      localAnswer(text, ref) ??
      say(
        aiEnabled
          ? 'No modo simples eu respondo sobre saldo, gastos, receitas e faturas do mês. Perguntas mais elaboradas chegam quando o assistente for ativado.'
          : 'Eu respondo sobre saldo, gastos e receitas do mês, faturas e o que falta pagar. Pergunte, por exemplo, “qual meu saldo?” ou “o que falta pagar?”.',
      )
    )
  }
  // mexe no que já existe: dar baixa, fatura, meta, alterar, apagar
  const action = simpleAction(text, ref)
  if (action) return { ...say(action.reply), ...(action.act ? { act: action.act } : {}), ...(action.label ? { label: action.label } : {}) }
  const s = useData.getState()
  const q = parseQuick(text, { categories: s.categories, accounts: s.accounts, cards: s.cards, history: s.transactions, ref })
  if (!q) return say('Não entendi. Escreva do seu jeito, como “mercado 120”, “caiu meu salário” ou “paguei a luz”.')
  // sem dizer a conta: a mesma da última vez que lançou isso
  const key = plainNorm(q.description)
  const prev =
    !q.accountId && !q.cardId
      ? s.transactions.find((t) => t.type === q.type && !t.cardId && t.accountId && plainNorm(t.description) === key && s.accounts.some((a) => a.id === t.accountId && !a.archived))
      : undefined
  return say(`${q.type === 'receita' ? 'Receita lançada' : 'Despesa lançada'}: ${q.description} · ${moneyRaw(q.amount)}.`, {
    create: [
      {
        type: q.type,
        description: q.description,
        amount: q.amount,
        date: q.date,
        categoryId: q.categoryId ?? null,
        accountId: q.accountId ?? prev?.accountId ?? null,
        toAccountId: null,
        cardId: q.cardId ?? null,
        installments: 1,
        paid: !q.pending,
        note: null,
      },
    ],
  })
}

/** Uma volta completa do modo simples: entende, aplica e guarda o que mudou (para desfazer). */
export function localTurn(text: string, ref = today()) {
  const r = localReply(text, ref)
  let reply = r.reply
  let undid: string | undefined
  const changes = track(() => {
    if (r.ops.undo) undid = lastApplied()?.id
    applyOps(r.ops, ref)
    const said = r.act?.()
    if (said) reply = said
  })
  return {
    reply: reply || (changes ? 'Pronto.' : 'Certo.'),
    changes,
    created: shownTx(changes),
    ...(undid ? { undid } : {}),
    ...(r.label && changes ? { label: r.label } : {}),
  }
}

// ─── Servidor: o agente ──────────────────────────────────────

export interface Outgoing {
  text?: string
  audio?: { base64: string; mime: string }
  images?: { base64: string; mime: string }[]
  pdf?: { base64: string; name?: string }
}

export type AskResult =
  | { ok: true; reply: string; transcript?: string; changes: Changes | null; created: string[]; undid?: string }
  | { ok: false; reason: 'offline' | 'local' | 'access' | 'error'; message: string }

type Failure = Extract<AskResult, { ok: false }>

/** Conversa até aqui, só o texto (as últimas 12 falas), sem a mensagem que está indo agora. */
const history = (skip?: string): HistoryTurn[] =>
  useChat
    .getState()
    .messages.filter((m) => !m.status && m.id !== skip && (m.text || m.transcript))
    .slice(-12)
    .map((m) => ({ role: m.role, text: `${m.role === 'user' ? (m.transcript ?? m.text) : m.text}${m.undone ? ' [depois desfeito]' : ''}`.slice(0, 2000) }))

/** Uma chamada à função do assistente. */
async function call(body: Record<string, unknown>): Promise<{ ok: true; data: unknown } | Failure> {
  const { data, error } = await supabase.functions.invoke('assistente', { body })
  if (!error) return { ok: true, data }
  const res = error instanceof FunctionsHttpError ? (error.context as Response) : null
  const status = res?.status ?? 0
  if (!status || status === 404) return { ok: false, reason: 'offline', message: 'O assistente ainda não está ativado no servidor.' }
  let message = status === 401 || status === 403 ? 'Seu acesso não permite usar o assistente agora.' : 'Não deu para falar com o assistente agora.'
  try {
    const b = (await res!.json()) as { error?: string }
    if (b.error) message = b.error
  } catch {}
  return { ok: false, reason: status === 401 || status === 403 ? 'access' : 'error', message }
}

type Block = Record<string, unknown>
const isBlock = (v: unknown): v is Block => !!v && typeof v === 'object' && !Array.isArray(v)

/** O que aparece no lugar de "Pensando…" enquanto as ferramentas rodam. */
const PROGRESS: Record<string, string> = { buscar_lancamentos: 'Procurando lançamentos…', resumo: 'Somando o período…' }

/**
 * Manda a mensagem para o agente e executa aqui as ferramentas que ele pedir, até ele terminar.
 * As mudanças já valem no store quando a resposta chega (e ficam juntas, para desfazer).
 */
export async function askAgent(out: Outgoing, opts: { skip?: string; progress?: (label: string) => void } = {}): Promise<AskResult> {
  const { data: session } = await supabase.auth.getSession()
  if (!session.session) return { ok: false, reason: 'local', message: 'Entre com sua conta para usar áudio, fotos e perguntas.' }
  const ref = today()
  // o começo da conversa não muda entre as voltas (o servidor guarda em cache)
  const { lastCreated: _old, ...context } = buildContext(ref)
  const base = { ...out, history: history(opts.skip), context }
  const steps: AgentStep[] = []
  const says: string[] = []
  let transcript: string | undefined
  let changes: Changes | null = null
  let undid: string | undefined

  const finish = (text: string): AskResult => {
    const created = shownTx(changes)
    const fallback = says.length ? says.join('\n') : !changes ? 'Certo.' : changes.before.transactions?.some((t) => created.includes(t.id)) ? 'Pronto, corrigi.' : created.length ? 'Pronto, lancei.' : 'Pronto.'
    return { ok: true, reply: text.trim() || fallback, ...(transcript ? { transcript } : {}), changes, created, ...(undid ? { undid } : {}) }
  }

  const undo = () => {
    const last = lastApplied()
    if (!last) return null
    const shown = last.created?.length ?? 0
    undoMessage(last)
    undid = last.id
    return shown ? `${shown} lançamento(s) da sua última resposta voltaram ao que eram (os novos foram apagados)` : 'o que a sua última resposta mudou voltou ao que era'
  }

  for (;;) {
    // nas voltas seguintes o áudio não vai de novo: vai a transcrição
    const { audio: _a, ...rest } = base
    // cada volta depende do resultado da anterior
    // eslint-disable-next-line no-await-in-loop
    const res = await call(transcript && out.audio ? { ...rest, transcript, steps } : { ...base, steps })
    if (!res.ok) return changes ? finish(`Fiz uma parte, mas parei no meio: ${res.message}`) : res
    const r = (isBlock(res.data) ? res.data : {}) as { content?: unknown; stop?: string; reply?: string; transcript?: string }
    if (typeof r.transcript === 'string') transcript = r.transcript
    if (r.stop === 'refusal') return finish(r.reply ?? 'Não consegui tratar essa mensagem. Pode escrever de outro jeito?')
    const content = Array.isArray(r.content) ? r.content.filter(isBlock) : []
    const texts = content.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => (b.text as string).trim())
    const uses = content.filter((b) => b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string')
    if (r.stop !== 'tool_use' || !uses.length) return finish(r.stop === 'max_tokens' ? 'A resposta ficou longa demais e foi cortada. Pode pedir por partes?' : texts.join('\n\n'))
    if (steps.length >= LIMITS.agentSteps) return finish('Essa ficou comprida demais para uma mensagem só. Pode pedir o resto em outra?')

    opts.progress?.(uses.map((u) => PROGRESS[u.name as string]).find(Boolean) ?? 'Fazendo as mudanças…')
    const results: AgentToolResult[] = []
    let final = true
    for (const u of uses) {
      let outcome: ReturnType<typeof runTool> | undefined
      changes = merge(changes, track(() => (outcome = runTool(u.name as string, u.input, { ref, undo }))))
      results.push({ id: u.id as string, content: outcome!.content.slice(0, LIMITS.toolResult), ...(outcome!.error ? { error: true } : {}) })
      if (outcome!.say) says.push(outcome!.say)
      final &&= outcome!.final
    }
    // a IA disse que acabou e tudo deu certo: a confirmação é do app, sem mais uma chamada
    if (final) return finish(texts.join('\n\n'))
    steps.push({ content, results })
  }
}
