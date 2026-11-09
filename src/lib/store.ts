import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { addDays, monthKey, shiftMonth, today } from './dates'
import { buildSchedule, renegotiate, type Debt, type DebtKind, type Direction, type Frequency, type InterestMode, type LateRules, type Terms } from './loans'
import {
  cardIndex,
  horizon,
  invoice,
  invoiceFor,
  materialize,
  splitInstallments,
  type Account,
  type Card,
  type CatType,
  type Category,
  type Contribution,
  type Goal,
  type RecurFrequency,
  type Recurrence,
  type Transaction,
  type TxType,
} from './ledger'
import { DEBT_EXPENSE, DEBT_INCOME, defaultCategories } from './categories'
import { legacyToDebts, type LegacyClient, type LegacyContract } from './legacy'
import type { PixKeyType } from './pix'
import { demoData } from './seed'
import { uid } from './crypto'
import { defaultTemplate } from './whatsapp'
import { defaultAlerts, type AlertType } from './alerts'
import { emit } from './events'

export type Tab = 'home' | 'assistant' | 'transactions' | 'accounts' | 'budget' | 'goals' | 'debts' | 'reports'
export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  owner: string
  /** Chave Pix para receber de quem te deve (vazia = não manda Pix no lembrete). */
  pix: string
  pixType: PixKeyType
  pixName: string
  pixCity: string
  /** Mensagem do lembrete de parcela (dívidas a receber). */
  template: string
  theme: Theme
  /** Multa e juros por atraso nas dívidas a receber. */
  late: LateRules
  /** Meta de economia do mês (0 = sem meta). */
  goal: number
  /** Conta que já vem escolhida nos lançamentos. */
  defaultAccount: string
  /** Limite geral de gastos do mês (0 = soma dos limites das categorias). */
  budgetTotal: number
  /** Aviso ao chegar nesta fração do limite (0,8 = 80%). */
  budgetAlert: number
  /** Esconde valores na tela. */
  privacy: boolean
  /** SHA-256 do PIN de bloqueio (null = sem bloqueio). */
  pinHash: string | null
  /** Quais avisos chegam (vale para todos os aparelhos da conta). */
  alerts: Record<AlertType, boolean>
  /** Hora do aviso diário (0–23). */
  alertHour: number
  /** Foto de perfil (data URL JPEG reduzida; vazia = iniciais). */
  photo: string
  /** Os empréstimos da versão anterior já viraram Dívidas (não converte de novo). */
  legacy: boolean
  /**
   * Cartão "Primeiros passos" do Início. '' = ainda não decidido (decide na primeira vez que o Início abre:
   * conta sem contas, lançamentos e metas vira 'new'); 'new' = conta nova, mostra até fechar ou concluir;
   * 'off' = não mostra. Vale para todos os aparelhos da conta.
   */
  firstSteps: '' | 'new' | 'off'
}

/** Tudo o que a conta guarda além dos ajustes. A sincronização percorre estas listas. */
export const collections = ['accounts', 'cards', 'categories', 'transactions', 'recurrences', 'goals', 'debts'] as const
export type Collection = (typeof collections)[number]

export interface Data {
  accounts: Account[]
  cards: Card[]
  categories: Category[]
  transactions: Transaction[]
  recurrences: Recurrence[]
  goals: Goal[]
  debts: Debt[]
  settings: Settings
}

export type Records = Omit<Data, 'settings'>

export interface Backup extends Records {
  app: 'jurospro'
  version: 2
  exportedAt: string
  settings: Omit<Settings, 'pinHash'>
}

/** O que o formulário de lançamento envia. */
export type TxInput = Omit<Transaction, 'id' | 'createdAt' | 'groupId' | 'installment' | 'invoice'>

export type Repeat = { mode: 'unica' } | { mode: 'parcelada'; count: number } | { mode: 'fixa'; frequency: RecurFrequency }

/** Mudança num lançamento repetido: só neste, neste e nos próximos, ou em toda a série. */
export type Scope = 'one' | 'next' | 'all'

export interface DebtInput extends Terms {
  direction: Direction
  kind: DebtKind
  person: string
  phone?: string
  accountId?: string
  note?: string
  /** Lança o valor recebido (ou emprestado) agora na conta escolhida. */
  register?: boolean
}

interface Actions {
  addTransaction: (input: TxInput, repeat?: Repeat) => Transaction
  updateTransaction: (id: string, patch: Partial<TxInput>, scope?: Scope) => void
  removeTransaction: (id: string, scope?: Scope) => void
  setPaid: (id: string, paid: boolean) => void
  addAccount: (a: Omit<Account, 'id' | 'createdAt'>) => Account
  updateAccount: (id: string, patch: Partial<Account>) => void
  /** Sem lançamentos: apaga. Com lançamentos: arquiva (o histórico continua certo). */
  removeAccount: (id: string) => 'removida' | 'arquivada'
  addCard: (c: Omit<Card, 'id' | 'createdAt'>) => Card
  updateCard: (id: string, patch: Partial<Card>) => void
  removeCard: (id: string) => 'removido' | 'arquivado'
  payInvoice: (cardId: string, invoice: string, accountId: string, amount: number, date?: string) => void
  /** Desfaz os pagamentos de uma fatura. */
  reopenInvoice: (cardId: string, invoice: string) => void
  /** Acerta o saldo da conta para `balance` (diferença lançada como ajuste, fora de receitas e despesas). */
  adjustBalance: (accountId: string, current: number, balance: number, date?: string) => void
  /** Volta às categorias padrão (os lançamentos de categorias que somem ficam sem categoria). */
  resetCategories: () => void
  addCategory: (c: Omit<Category, 'id'>) => Category
  updateCategory: (id: string, patch: Partial<Category>) => void
  /** Apaga a categoria (e as subcategorias); os lançamentos passam para `moveTo`. */
  removeCategory: (id: string, moveTo?: string) => void
  setBudget: (categoryId: string, amount: number) => void
  addGoal: (g: Omit<Goal, 'id' | 'createdAt' | 'contributions'> & { initial?: number; accountId?: string }) => Goal
  updateGoal: (id: string, patch: Partial<Goal>) => void
  removeGoal: (id: string) => void
  contribute: (goalId: string, amount: number, accountId?: string, date?: string) => void
  removeContribution: (goalId: string, contributionId: string) => void
  addDebt: (d: DebtInput) => Debt
  updateDebt: (id: string, patch: Partial<Pick<Debt, 'person' | 'phone' | 'note' | 'accountId' | 'kind'>>) => void
  removeDebt: (id: string) => void
  /** Conta vazia ("") registra sem conta; sem informar, usa a conta da dívida. */
  payDebt: (debtId: string, amount: number, fee?: number, date?: string, accountId?: string) => void
  undoDebtPayment: (debtId: string, paymentId: string) => void
  renegotiateDebt: (debtId: string, terms: Omit<Terms, 'principal'>) => void
  /** Gera as repetições dos lançamentos fixos que faltam (até 12 meses à frente). */
  ensureRecurring: () => void
  setSettings: (p: Partial<Settings>) => void
  exportBackup: () => Backup
  importBackup: (b: Backup) => void
  loadDemo: () => void
  clearAll: () => void
}

export const defaultSettings: Settings = {
  owner: '',
  pix: '',
  pixType: 'cpf',
  pixName: '',
  pixCity: '',
  template: defaultTemplate,
  theme: 'light',
  late: { fee: 0.02, daily: 0.0033, grace: 0 },
  goal: 0,
  defaultAccount: '',
  budgetTotal: 0,
  budgetAlert: 0.8,
  privacy: false,
  pinHash: null,
  alerts: defaultAlerts,
  alertHour: 8,
  photo: '',
  legacy: false,
  firstSteps: '',
}

/** Ajustes salvos (aparelho, nuvem ou backup) completados com os padrões; opções que não existem mais ficam de fora. */
export const withDefaults = (saved: Partial<Settings> | undefined): Settings => {
  const s = (saved ?? {}) as Record<string, unknown>
  const picked = Object.fromEntries(Object.keys(defaultSettings).filter((k) => k in s && s[k] !== undefined).map((k) => [k, s[k]])) as Partial<Settings>
  return {
    ...defaultSettings,
    ...picked,
    late: { ...defaultSettings.late, ...picked.late },
    alerts: { ...defaultSettings.alerts, ...picked.alerts },
  }
}

/** Conta nova (ou depois de sair): só as categorias padrão. */
export const emptyRecords = (): Records => ({ accounts: [], cards: [], categories: defaultCategories(), transactions: [], recurrences: [], goals: [], debts: [] })

const round2 = (v: number) => Math.round(v * 100) / 100

/** Repetição de um lançamento fixo: id estável (mesmo id em todo aparelho que gerar). */
const occurrence = (r: Recurrence, date: string, status: Transaction['status'] = 'pendente'): Transaction => ({
  ...r.template,
  id: `${r.id}:${date}`,
  date,
  status: r.template.cardId ? 'pago' : status,
  groupId: r.id,
  createdAt: today(),
})

export const useData = create<Data & Actions>()(
  persist(
    (set, get) => ({
      ...emptyRecords(),
      settings: defaultSettings,

      // ─── Lançamentos ───────────────────────────────────────
      addTransaction: (input, repeat = { mode: 'unica' }) => {
        const { cards } = get()
        const card = input.cardId ? cards.find((c) => c.id === input.cardId) : undefined
        // compra no cartão é paga junto com a fatura
        const base = { ...input, amount: round2(input.amount), status: card && input.type === 'despesa' ? ('pago' as const) : input.status, createdAt: today() }
        const invoiceAt = (date: string, k = 0) => (card ? { invoice: shiftMonth(invoiceFor(card, date), k) } : {})

        let created: Transaction[]
        let rule: Recurrence | undefined
        if (repeat.mode === 'parcelada' && repeat.count > 1) {
          const groupId = uid()
          const first = invoiceAt(input.date)
          created = splitInstallments(base.amount, repeat.count).map((amount, k) => ({
            ...base,
            id: uid(),
            amount,
            // no cartão, todas as parcelas ficam com a data da compra (a fatura diz o mês)
            date: card ? input.date : addMonthsKeepDay(input.date, k),
            // parcelas que já venceram ficam como a primeira (compra antiga lançada agora); as futuras, pendentes
            status: card || k === 0 || addMonthsKeepDay(input.date, k) <= today() ? base.status : 'pendente',
            ...(card ? { invoice: shiftMonth(first.invoice!, k) } : {}),
            groupId,
            installment: { n: k + 1, count: repeat.count },
          }))
        } else if (repeat.mode === 'fixa') {
          const id = uid()
          const { type, description, amount, categoryId, accountId, cardId, tags, note } = base
          rule = { id, frequency: repeat.frequency, start: input.date, generated: '', template: { type, description, amount, categoryId, accountId, cardId, tags, note } }
          const { created: list, updated } = materialize([rule], cardIndex(cards), horizon(), (r, date) => occurrence(r, date, date === input.date ? base.status : 'pendente'))
          created = list
          rule = updated[0] ?? rule
        } else {
          created = [{ ...base, id: uid(), ...invoiceAt(input.date) }]
        }
        set((s) => ({ transactions: [...created, ...s.transactions], recurrences: rule ? [...s.recurrences, rule] : s.recurrences }))
        emit({ type: 'lancamento', tx: created[0], count: created.length })
        return created[0]
      },

      updateTransaction: (id, patch, scope = 'one') => {
        const { transactions, cards, recurrences } = get()
        const t = transactions.find((x) => x.id === id)
        if (!t) return
        // pagamento de dívida: valor, tipo, data e situação são da dívida (desfazer lá)
        if (t.debtId) {
          const { amount: _a, type: _t, date: _d, status: _s, ...rest } = patch
          patch = rest
        }
        const cardOf = (cid?: string) => (cid ? cards.find((c) => c.id === cid) : undefined)
        // campos que valem para as próximas (a data só muda neste)
        const { date: _date, status: _status, ...shared } = patch
        const fix = (x: Transaction, p: Partial<TxInput>): Transaction => {
          const next: Transaction = { ...x, ...p }
          if (p.amount !== undefined) next.amount = round2(p.amount)
          if (next.type !== 'transferencia') delete next.toAccountId
          if (next.type === 'receita') (delete next.cardId, delete next.invoice)
          if (next.type === 'despesa') {
            const card = cardOf(next.cardId)
            if (!card) (delete next.cardId, delete next.invoice)
            else {
              next.status = 'pago'
              // trocou de cartão ou de data: recalcula a fatura (parcelas mantêm a distância da primeira)
              if (next.cardId !== x.cardId || next.date !== x.date || !x.invoice) next.invoice = shiftMonth(invoiceFor(card, next.date), x.installment ? x.installment.n - 1 : 0)
            }
          }
          return next
        }
        const inScope = (x: Transaction) =>
          x.id === id ||
          (scope !== 'one' && !!t.groupId && x.groupId === t.groupId && (scope === 'all' || (t.installment ? (x.installment?.n ?? 0) > t.installment.n : x.date > t.date)))
        set((s) => ({
          transactions: s.transactions.map((x) => (inScope(x) ? fix(x, x.id === id ? patch : shared) : x)),
          // lançamento fixo: as próximas repetições já nascem com os valores novos
          recurrences:
            scope !== 'one' && t.groupId && recurrences.some((r) => r.id === t.groupId)
              ? s.recurrences.map((r) => {
                  if (r.id !== t.groupId) return r
                  const tpl = { ...r.template }
                  for (const k of ['type', 'description', 'amount', 'categoryId', 'accountId', 'cardId', 'tags', 'note'] as const)
                    if (k in shared) (tpl as Record<string, unknown>)[k] = (shared as Record<string, unknown>)[k]
                  return { ...r, template: tpl }
                })
              : s.recurrences,
        }))
      },

      removeTransaction: (id, scope = 'one') => {
        const { transactions, debts } = get()
        const t = transactions.find((x) => x.id === id)
        if (!t) return
        const gone = new Set(
          transactions
            .filter(
              (x) =>
                x.id === id ||
                (scope !== 'one' && !!t.groupId && x.groupId === t.groupId && (scope === 'all' || (t.installment ? (x.installment?.n ?? 0) >= t.installment.n : x.date >= t.date))),
            )
            .map((x) => x.id),
        )
        // pagamento de dívida apagado aqui também sai da dívida
        const debtFix = new Map<string, string[]>()
        for (const x of transactions) if (gone.has(x.id) && x.debtId && x.paymentId) debtFix.set(x.debtId, [...(debtFix.get(x.debtId) ?? []), x.paymentId])
        set((s) => ({
          transactions: s.transactions.filter((x) => !gone.has(x.id)),
          // parar a repetição: "toda a série" (ou a partir da primeira) apaga a regra; "próximas" encerra antes deste
          recurrences:
            scope !== 'one' && t.groupId
              ? s.recurrences.flatMap((r) => (r.id !== t.groupId ? [r] : scope === 'all' || t.date <= r.start ? [] : [{ ...r, until: addDays(t.date, -1) }]))
              : s.recurrences,
          debts: debtFix.size ? debts.map((d) => (debtFix.has(d.id) ? { ...d, payments: d.payments.filter((p) => !debtFix.get(d.id)!.includes(p.id)) } : d)) : s.debts,
        }))
      },

      setPaid: (id, paid) => {
        const t = get().transactions.find((x) => x.id === id)
        if (!t || t.debtId || (t.status === 'pago') === paid) return
        const next: Transaction = { ...t, status: paid ? 'pago' : 'pendente' }
        set((s) => ({ transactions: s.transactions.map((x) => (x.id === id ? next : x)) }))
        if (paid) emit({ type: 'pago', tx: next })
      },

      // ─── Contas e cartões ──────────────────────────────────
      addAccount: (a) => {
        const account: Account = { ...a, id: uid(), initial: round2(a.initial), createdAt: today() }
        set((s) => ({ accounts: [...s.accounts, account] }))
        return account
      },
      updateAccount: (id, patch) => set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
      removeAccount: (id) => {
        const { transactions, goals } = get()
        const { recurrences } = get()
        const used =
          transactions.some((t) => t.accountId === id || t.toAccountId === id) ||
          goals.some((g) => g.contributions.some((c) => c.accountId === id)) ||
          recurrences.some((r) => r.template.accountId === id)
        if (used) {
          set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, archived: true } : a)) }))
          return 'arquivada'
        }
        set((s) => ({ accounts: s.accounts.filter((a) => a.id !== id), cards: s.cards.map((c) => (c.accountId === id ? { ...c, accountId: undefined } : c)) }))
        return 'removida'
      },
      addCard: (c) => {
        const card: Card = { ...c, id: uid(), limit: round2(c.limit), createdAt: today() }
        set((s) => ({ cards: [...s.cards, card] }))
        return card
      },
      updateCard: (id, patch) => {
        const before = get().cards.find((c) => c.id === id)
        if (!before) return
        const card = { ...before, ...patch }
        const cycle = card.closingDay !== before.closingDay || card.dueDay !== before.dueDay
        set((s) => ({
          cards: s.cards.map((c) => (c.id === id ? card : c)),
          // mudou o fechamento: as compras de faturas ainda não pagas mudam de fatura
          transactions: cycle
            ? s.transactions.map((t) => (t.cardId === id && t.type === 'despesa' && !t.installment && (t.invoice ?? '') >= monthKey(today()) ? { ...t, invoice: invoiceFor(card, t.date) } : t))
            : s.transactions,
        }))
      },
      removeCard: (id) => {
        if (get().transactions.some((t) => t.cardId === id)) {
          set((s) => ({ cards: s.cards.map((c) => (c.id === id ? { ...c, archived: true } : c)) }))
          return 'arquivado'
        }
        set((s) => ({ cards: s.cards.filter((c) => c.id !== id), recurrences: s.recurrences.filter((r) => r.template.cardId !== id) }))
        return 'removido'
      },
      payInvoice: (cardId, invoiceKey, accountId, amount, date = today()) => {
        const card = get().cards.find((c) => c.id === cardId)
        // não paga além do que está em aberto: o pagamento fica preso a esta fatura
        const open = card ? invoice(card, invoiceKey, get().transactions).open : 0
        amount = Math.min(round2(amount), open)
        if (!card || amount <= 0) return
        const tx: Transaction = {
          id: uid(),
          type: 'transferencia',
          description: `Fatura ${card.name}`,
          amount: round2(amount),
          date,
          status: 'pago',
          accountId,
          cardId,
          invoice: invoiceKey,
          createdAt: today(),
        }
        set((s) => ({ transactions: [tx, ...s.transactions] }))
        emit({ type: 'pago', tx })
      },

      reopenInvoice: (cardId, invoice) =>
        set((s) => ({ transactions: s.transactions.filter((t) => !(t.type === 'transferencia' && t.cardId === cardId && t.invoice === invoice)) })),
      adjustBalance: (accountId, current, balance, date = today()) => {
        const diff = round2(balance - current)
        if (Math.abs(diff) < 0.005) return
        const tx: Transaction = {
          id: uid(),
          type: 'transferencia',
          description: 'Ajuste de saldo',
          amount: Math.abs(diff),
          date,
          status: 'pago',
          // entra (para) ou sai (de) da conta, sem contrapartida
          ...(diff > 0 ? { toAccountId: accountId } : { accountId }),
          adjust: true,
          createdAt: today(),
        }
        set((s) => ({ transactions: [tx, ...s.transactions] }))
      },

      // ─── Categorias e orçamento ─────────────────────────────
      addCategory: (c) => {
        const cat: Category = { ...c, id: uid() }
        set((s) => ({ categories: [...s.categories, cat] }))
        return cat
      },
      updateCategory: (id, patch) =>
        set((s) => ({
          categories: s.categories.map((c) => {
            if (c.id === id) return { ...c, ...patch }
            // a cor da principal desce para as subcategorias
            if (c.parentId === id && patch.color) return { ...c, color: patch.color }
            return c
          }),
        })),
      removeCategory: (id, moveTo) => {
        const gone = new Set([id, ...get().categories.filter((c) => c.parentId === id).map((c) => c.id)])
        const target = moveTo && !gone.has(moveTo) ? moveTo : undefined
        set((s) => ({
          categories: s.categories.filter((c) => !gone.has(c.id)),
          transactions: s.transactions.map((t) => (t.categoryId && gone.has(t.categoryId) ? { ...t, categoryId: target } : t)),
          recurrences: s.recurrences.map((r) => (r.template.categoryId && gone.has(r.template.categoryId) ? { ...r, template: { ...r.template, categoryId: target } } : r)),
        }))
      },
      resetCategories: () => {
        const fresh = defaultCategories()
        const ids = new Set(fresh.map((c) => c.id))
        set((s) => ({
          categories: fresh,
          transactions: s.transactions.map((t) => (t.categoryId && !ids.has(t.categoryId) ? { ...t, categoryId: undefined } : t)),
          recurrences: s.recurrences.map((r) => (r.template.categoryId && !ids.has(r.template.categoryId) ? { ...r, template: { ...r.template, categoryId: undefined } } : r)),
        }))
      },
      setBudget: (categoryId, amount) =>
        set((s) => ({ categories: s.categories.map((c) => (c.id === categoryId ? { ...c, budget: amount > 0 ? round2(amount) : undefined } : c)) })),

      // ─── Metas ─────────────────────────────────────────────
      addGoal: ({ initial, accountId, ...g }) => {
        const goal: Goal = {
          ...g,
          id: uid(),
          target: round2(g.target),
          createdAt: today(),
          // o que já estava guardado não conta no ritmo de aportes da previsão
          contributions: initial && initial > 0 ? [{ id: uid(), date: today(), amount: round2(initial), initial: true, ...(accountId ? { accountId } : {}) }] : [],
        }
        set((s) => ({ goals: [...s.goals, goal] }))
        return goal
      },
      updateGoal: (id, patch) => set((s) => ({ goals: s.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) })),
      removeGoal: (id) => set((s) => ({ goals: s.goals.filter((g) => g.id !== id) })),
      contribute: (goalId, amount, accountId, date = today()) => {
        const before = get().goals.find((g) => g.id === goalId)
        if (!before || !amount) return
        const c: Contribution = { id: uid(), date, amount: round2(amount), ...(accountId ? { accountId } : {}) }
        const goal = { ...before, contributions: [...before.contributions, c] }
        set((s) => ({ goals: s.goals.map((g) => (g.id === goalId ? goal : g)) }))
        emit({ type: 'meta-aporte', before, goal, amount: c.amount })
      },
      removeContribution: (goalId, cid) =>
        set((s) => ({ goals: s.goals.map((g) => (g.id === goalId ? { ...g, contributions: g.contributions.filter((c) => c.id !== cid) } : g)) })),

      // ─── Dívidas e empréstimos ──────────────────────────────
      addDebt: ({ direction, kind, person, phone, accountId, note, register, ...terms }) => {
        const debt: Debt = {
          id: uid(),
          direction,
          kind,
          person: person.trim(),
          ...(phone ? { phone } : {}),
          ...(accountId ? { accountId } : {}),
          ...(note?.trim() ? { note: note.trim() } : {}),
          principal: round2(terms.principal),
          rate: terms.rate,
          mode: terms.mode,
          frequency: terms.frequency,
          createdAt: today(),
          schedule: buildSchedule(terms),
          payments: [],
        }
        // o dinheiro entrou (peguei emprestado) ou saiu (emprestei) da conta agora
        const tx: Transaction | null =
          register && accountId
            ? {
                id: uid(),
                type: direction === 'pagar' ? 'receita' : 'despesa',
                description: direction === 'pagar' ? `${debtKindWord(kind)} · ${debt.person}` : `Empréstimo para ${debt.person}`,
                amount: debt.principal,
                date: today(),
                status: 'pago',
                categoryId: direction === 'pagar' ? 'cat-emprestimos-recebidos' : 'cat-dividas',
                accountId,
                debtId: debt.id,
                createdAt: today(),
              }
            : null
        set((s) => ({ debts: [debt, ...s.debts], transactions: tx ? [tx, ...s.transactions] : s.transactions }))
        emit({ type: 'divida', debt })
        return debt
      },
      updateDebt: (id, patch) => set((s) => ({ debts: s.debts.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),
      removeDebt: (id) => set((s) => ({ debts: s.debts.filter((d) => d.id !== id), transactions: s.transactions.filter((t) => t.debtId !== id) })),
      payDebt: (debtId, amount, fee = 0, date = today(), accountId) => {
        const before = get().debts.find((d) => d.id === debtId)
        if (!before || amount <= 0) return
        const payment = { id: uid(), date, amount: round2(amount), ...(fee > 0 ? { fee: round2(fee) } : {}) }
        const debt = { ...before, payments: [...before.payments, payment] }
        // sem informar: a conta da dívida; vazio (""): sem conta
        const account = accountId === undefined ? before.accountId : accountId || undefined
        const total = round2(amount + fee)
        const tx: Transaction = {
          id: uid(),
          type: before.direction === 'pagar' ? 'despesa' : 'receita',
          description: before.direction === 'pagar' ? `${debtKindWord(before.kind)} · ${before.person}` : `Parcela de ${before.person}`,
          amount: total,
          date,
          status: 'pago',
          categoryId: before.direction === 'pagar' ? DEBT_EXPENSE : DEBT_INCOME,
          ...(account ? { accountId: account } : {}),
          ...(fee > 0 ? { note: `Inclui multa e juros por atraso` } : {}),
          debtId,
          paymentId: payment.id,
          createdAt: today(),
        }
        set((s) => ({ debts: s.debts.map((d) => (d.id === debtId ? debt : d)), transactions: [tx, ...s.transactions] }))
        emit({ type: 'divida-pagamento', before, debt, payment })
      },
      undoDebtPayment: (debtId, paymentId) => {
        const before = get().debts.find((d) => d.id === debtId)
        const payment = before?.payments.find((p) => p.id === paymentId)
        if (!before || !payment) return
        const debt = { ...before, payments: before.payments.filter((p) => p.id !== paymentId) }
        set((s) => ({
          debts: s.debts.map((d) => (d.id === debtId ? debt : d)),
          transactions: s.transactions.filter((t) => !(t.debtId === debtId && t.paymentId === paymentId)),
        }))
        emit({ type: 'divida-estorno', debt, payment })
      },
      renegotiateDebt: (debtId, terms) => {
        const before = get().debts.find((d) => d.id === debtId)
        if (!before) return
        set((s) => ({ debts: s.debts.map((d) => (d.id === debtId ? renegotiate(before, terms) : d)) }))
      },

      ensureRecurring: () => {
        const { recurrences, cards, transactions } = get()
        const active = recurrences.filter((r) => !r.until || r.until > r.generated)
        if (!active.length) return
        const { created, updated } = materialize(active, cardIndex(cards), horizon(), (r, date) => occurrence(r, date))
        if (!updated.length) return
        // id estável: outro aparelho pode ter gerado a mesma repetição
        const have = new Set(transactions.map((t) => t.id))
        const fresh = created.filter((t) => !have.has(t.id))
        const byId = new Map(updated.map((r) => [r.id, r]))
        set((s) => ({ transactions: fresh.length ? [...fresh, ...s.transactions] : s.transactions, recurrences: s.recurrences.map((r) => byId.get(r.id) ?? r) }))
      },

      setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
      exportBackup: () => {
        const { settings, ...rest } = get()
        const { pinHash: _pin, ...safe } = settings
        const records = Object.fromEntries(collections.map((k) => [k, rest[k]])) as unknown as Records
        return { app: 'jurospro', version: 2, exportedAt: new Date().toISOString(), ...records, settings: safe }
      },
      importBackup: (b) =>
        set((s) => ({
          ...Object.fromEntries(collections.map((k) => [k, Array.isArray(b[k]) ? b[k] : []])),
          categories: Array.isArray(b.categories) && b.categories.length ? b.categories : defaultCategories(),
          settings: { ...withDefaults(b.settings), pinHash: s.settings.pinHash, legacy: true },
        })),
      loadDemo: () => set(demoData()),
      clearAll: () => set(emptyRecords()),
    }),
    {
      name: 'jurospro-gestao',
      version: 3,
      // configurações novas ganham o valor padrão sem perder o que já foi salvo
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Data>
        const lists = Object.fromEntries(collections.map((k) => [k, Array.isArray(p[k]) ? p[k] : current[k]]))
        return { ...current, ...lists, settings: withDefaults(p.settings) }
      },
      // versão de empréstimos (clientes + contratos): os contratos viram dívidas a receber
      migrate: (persisted, version) => {
        const old = (persisted ?? {}) as Record<string, unknown>
        if (version >= 3) return old as unknown as Data
        const debts = legacyToDebts((old.clients as LegacyClient[]) ?? [], (old.contracts as LegacyContract[]) ?? [])
        return { ...emptyRecords(), debts, settings: { ...withDefaults(old.settings as Partial<Settings>), legacy: true } } as Data
      },
    },
  ),
)

const debtKindWord = (k: DebtKind) => ({ emprestimo: 'Empréstimo', financiamento: 'Financiamento', pessoal: 'Dívida', acordo: 'Acordo' })[k]

/** Soma meses mantendo o dia (31/01 + 1 → 28/02), para as parcelas fora do cartão. */
const addMonthsKeepDay = (iso: string, k: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  const target = new Date(y, m - 1 + k, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(d, last))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`
}

// ─── Estado de interface (não persistido) ─────────────────────

/** Condições já escolhidas (ex.: vindas do simulador) para abrir a dívida preenchida. */
export interface Draft {
  principal: number
  rate: number
  mode: InterestMode
  frequency: Frequency
  count: number
}

export type TxTypeFilter = 'todos' | TxType
export type TxStatusFilter = 'todos' | 'pago' | 'pendente' | 'atrasado'

export interface TxFilter {
  type: TxTypeFilter
  status: TxStatusFilter
  categoryId: string
  accountId: string
  tag: string
  q: string
}

export const emptyFilter: TxFilter = { type: 'todos', status: 'todos', categoryId: '', accountId: '', tag: '', q: '' }

export type DebtFilter = 'todas' | 'pagar' | 'receber' | 'atrasado' | 'quitado'

interface UI {
  /** Data de referência (atualiza à meia-noite, ao voltar ao app e no botão Atualizar). */
  day: string
  refreshDay: () => void
  tab: Tab
  setTab: (t: Tab) => void
  /** Mês aberto em Lançamentos e Orçamento (AAAA-MM). */
  month: string
  setMonth: (m: string) => void
  txFilter: TxFilter
  setTxFilter: (p: Partial<TxFilter>) => void
  debtFilter: DebtFilter
  setDebtFilter: (f: DebtFilter) => void
  /** Lançamento: novo (com tipo e campos sugeridos) ou editar (id). */
  tx: { open: boolean; id?: string; type?: TxType; preset?: Partial<TxInput> }
  openTx: (open: boolean, opts?: { id?: string; type?: TxType; preset?: Partial<TxInput> }) => void
  /** Conta: nova (sem id) ou detalhe/edição. */
  account: { open: boolean; id?: string }
  openAccount: (open: boolean, id?: string) => void
  /** Cartão: novo (sem id) ou faturas; `invoice` abre numa fatura. */
  card: { open: boolean; id?: string; invoice?: string }
  openCard: (open: boolean, id?: string, invoice?: string) => void
  category: { open: boolean; id?: string; type?: CatType; parentId?: string }
  openCategory: (open: boolean, opts?: { id?: string; type?: CatType; parentId?: string }) => void
  /** Meta: nova (sem id; `reserve` já abre o atalho da reserva de emergência) ou detalhe. */
  goal: { open: boolean; id?: string; reserve?: boolean }
  openGoal: (open: boolean, id?: string, reserve?: boolean) => void
  /** Detalhe de uma dívida. */
  debtId: string | null
  openDebt: (id: string | null) => void
  newDebt: { open: boolean; direction?: Direction; draft?: Draft }
  openNewDebt: (open: boolean, direction?: Direction, draft?: Draft) => void
  calculator: boolean
  openCalculator: (open: boolean) => void
  settings: boolean
  /** Página de Configurações para abrir direto (ex.: vindo da central de notificações). */
  settingsPage: string | null
  openSettings: (open: boolean, page?: string) => void
  inbox: boolean
  openInbox: (open: boolean) => void
  /** Celular: menu "Mais" da barra inferior. */
  more: boolean
  openMore: (open: boolean) => void
  /** Abre Lançamentos com a busca focada. */
  searchFocus: boolean
  setSearchFocus: (v: boolean) => void
  /** Fecha todos os painéis (usado ao bloquear o app). */
  closeAll: () => void
  /** Algum painel aberto (o teclado e os avisos esperam ele fechar). */
  busy: () => boolean
}

const closed = {
  tx: { open: false },
  account: { open: false },
  card: { open: false },
  category: { open: false },
  goal: { open: false },
  debtId: null,
  newDebt: { open: false },
  calculator: false,
  settings: false,
  inbox: false,
  more: false,
}

export const useUI = create<UI>()((set, get) => ({
  day: today(),
  refreshDay: () => set({ day: today() }),
  tab: 'home',
  setTab: (tab) => set({ tab }),
  month: monthKey(today()),
  setMonth: (month) => set({ month }),
  txFilter: emptyFilter,
  setTxFilter: (p) => set((s) => ({ txFilter: { ...s.txFilter, ...p } })),
  debtFilter: 'todas',
  setDebtFilter: (debtFilter) => set({ debtFilter }),
  ...closed,
  openTx: (open, opts) => set({ tx: { open, ...opts } }),
  openAccount: (open, id) => set({ account: { open, id } }),
  openCard: (open, id, invoice) => set({ card: { open, id, invoice } }),
  openCategory: (open, opts) => set({ category: { open, ...opts } }),
  openGoal: (open, id, reserve) => set({ goal: { open, id, reserve } }),
  openDebt: (debtId) => set({ debtId }),
  openNewDebt: (open, direction, draft) => set({ newDebt: { open, direction, draft } }),
  openCalculator: (calculator) => set({ calculator }),
  settingsPage: null,
  openSettings: (settings, page) => set({ settings, settingsPage: page ?? null }),
  openInbox: (inbox) => set({ inbox }),
  openMore: (more) => set({ more }),
  searchFocus: false,
  setSearchFocus: (searchFocus) => set({ searchFocus }),
  closeAll: () => set(closed),
  busy: () => {
    const s = get()
    return s.tx.open || s.account.open || s.card.open || s.category.open || s.goal.open || !!s.debtId || s.newDebt.open || s.calculator || s.settings || s.inbox || s.more
  },
}))
