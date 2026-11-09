import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as app from '../../../src/lib/ledger'
import { addMonths as appAddMonths, addDays as appAddDays } from '../../../src/lib/dates'
import { defaultCategories as appDefaults } from '../../../src/lib/categories'
import { demoData } from '../../../src/lib/seed'
import { emptyRecords, useData } from '../../../src/lib/store'
import { contextText, sanitizeContext } from '../_shared/assistente/context.ts'
import type { AssistantOps, AssistantTx, InterpretRequest, InterpretResult } from '../_shared/assistente/types.ts'
import { execute } from './actions.ts'
import { assistantContext, historyOf, userData, type LogEntry, type RecordRow, type UserData } from './data.ts'
import { defaultCategories } from './defaults.ts'
import { handle, type Deps, type Link, type Profile, type Store } from './flow.ts'
import { texts } from './format.ts'
import * as srv from './ledger.ts'
import type { Incoming } from './providers.ts'

const TODAY = '2026-10-21'

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 21, 12))
})
afterAll(() => void vi.useRealTimers())

// ─── Igual ao app ────────────────────────────────────────────

describe('contas do servidor iguais às do app', () => {
  it('fatura do cartão em qualquer dia e ciclo', () => {
    for (const [closingDay, dueDay] of [[3, 10], [25, 5], [31, 10], [15, 15], [28, 2]])
      for (let d = '2026-01-01'; d <= '2027-03-01'; d = appAddDays(d, 1)) {
        const card = { closingDay, dueDay }
        const key = app.invoiceFor(card, d)
        expect(srv.invoiceFor(card, d)).toBe(key)
        expect(srv.invoiceDates(card, key)).toEqual(app.invoiceDates(card, key))
      }
  })

  it('soma de meses e parcelas', () => {
    for (const d of ['2026-01-31', '2026-02-28', '2024-02-29', '2026-10-21', '2026-12-31'])
      for (let k = -14; k <= 26; k++) expect(srv.addMonths(d, k)).toBe(appAddMonths(d, k))
    for (const [total, n] of [[1000, 3], [99.99, 7], [0.05, 4], [1234.56, 12]]) expect(srv.splitInstallments(total, n)).toEqual(app.splitInstallments(total, n))
  })

  it('categorias padrão iguais às do app', () => {
    const pick = (c: { id: string; name: string; type: string; parentId?: string; keywords?: string[] }) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId, keywords: c.keywords })
    expect(defaultCategories().map(pick)).toEqual(appDefaults().map(pick))
  })

  it('saldos, totais do mês, categorias, limite geral e sugestão com os dados de exemplo', () => {
    const d = demoData()
    const appCards = app.cardIndex(d.cards)
    const srvCards = new Map(d.cards.map((c) => [c.id, c as unknown as srv.Card]))
    const txs = d.transactions as unknown as srv.Transaction[]
    expect(srv.balances(d.accounts, txs, d.goals)).toEqual(app.balances(d.accounts, d.transactions, d.goals))
    for (const key of ['2026-08', '2026-09', '2026-10', '2026-11']) {
      const { from, to } = app.monthRange(key)
      expect(srv.totals(txs, srvCards, from, to)).toEqual(app.totals(d.transactions, appCards, from, to))
      expect(srv.byCategory(txs, srvCards, d.categories, 'despesa', from, to)).toEqual(app.byCategory(d.transactions, appCards, d.categories, 'despesa', from, to))
      expect(srv.overallBudget(d.categories, 0, txs, srvCards, key)).toEqual(app.overallBudget(d.categories, 0, d.transactions, appCards, key))
    }
    for (const c of d.cards) {
      const key = app.invoiceFor(c, TODAY)
      const a = app.invoice(c, key, d.transactions, TODAY)
      expect(srv.invoice(c as unknown as srv.Card, key, txs, TODAY)).toMatchObject({ total: a.total, paid: a.paid, open: a.open, status: a.status, due: a.due })
    }
    for (const desc of ['Mercado Assaí', 'uber pra casa', 'Netflix', 'salário', 'xyz'])
      for (const type of ['despesa', 'receita'] as const) expect(srv.suggestCategory(desc, type, d.categories, txs)).toBe(app.suggestCategory(desc, type, d.categories, d.transactions))
  })

  it('lançamentos montados como o addTransaction do app', () => {
    const accounts = [{ id: 'a', name: 'Conta', kind: 'corrente' as const, initial: 1000, color: '#000', createdAt: '2026-01-01' }]
    const cards = [{ id: 'c', name: 'Cartão', limit: 5000, closingDay: 3, dueDay: 10, accountId: 'a', color: '#000', createdAt: '2026-01-01' }]
    const strip = (t: object) => {
      const { id: _i, groupId: _g, createdAt: _c, via: _v, ...rest } = t as Record<string, unknown>
      return rest
    }
    const order = (l: { installment?: { n: number } }[]) => [...l].sort((a, b) => (a.installment?.n ?? 0) - (b.installment?.n ?? 0))
    const cases: [srv.TxInput, number][] = [
      [{ type: 'despesa', description: 'Mercado', amount: 230.456, date: TODAY, status: 'pago', accountId: 'a', categoryId: 'cat-mercado' }, 1],
      [{ type: 'despesa', description: 'Tênis', amount: 600, date: TODAY, status: 'pago', cardId: 'c' }, 1],
      [{ type: 'despesa', description: 'Geladeira', amount: 3500, date: '2026-10-02', status: 'pago', cardId: 'c' }, 10],
      [{ type: 'despesa', description: 'Curso', amount: 1000, date: '2026-09-30', status: 'pago', accountId: 'a' }, 3],
      [{ type: 'receita', description: 'Freela', amount: 800, date: '2026-11-05', status: 'pendente', accountId: 'a' }, 1],
    ]
    for (const [input, count] of cases) {
      useData.setState({ ...emptyRecords(), accounts, cards })
      useData.getState().addTransaction(input, count > 1 ? { mode: 'parcelada', count } : { mode: 'unica' })
      let n = 0
      const mine = srv.makeTransactions(input, count, cards, { uid: () => `id-${++n}`, today: TODAY })
      expect(order(mine).map(strip)).toEqual(order(useData.getState().transactions).map(strip))
      expect(mine.every((t) => t.via === 'whatsapp' && t.createdAt === TODAY)).toBe(true)
      if (count > 1) expect(new Set(mine.map((t) => t.groupId)).size).toBe(1)
    }
  })
})

// ─── Dados de teste ──────────────────────────────────────────

const rows = (d: Partial<Record<string, object[]>>): RecordRow[] => Object.entries(d).flatMap(([kind, list]) => (list ?? []).map((x) => ({ kind, id: (x as { id: string }).id, data: x })))

const tx = (p: Partial<srv.Transaction> & Pick<srv.Transaction, 'id' | 'amount'>): srv.Transaction => ({ type: 'despesa', description: 'Algo', date: TODAY, status: 'pago', createdAt: TODAY, ...p })

function sample(extra: srv.Transaction[] = []): UserData {
  const categories = defaultCategories().map((c) => (c.id === 'cat-mercado' ? { ...c, budget: 500 } : c))
  return userData(
    rows({
      accounts: [
        { id: 'a1', name: 'Nubank', kind: 'corrente', initial: 1000 },
        { id: 'a2', name: 'Carteira', kind: 'carteira', initial: 100 },
        { id: 'a3', name: 'Antiga', kind: 'corrente', initial: 0, archived: true },
      ],
      cards: [{ id: 'c1', name: 'Nubank', limit: 5000, closingDay: 3, dueDay: 10, accountId: 'a1' }],
      categories,
      transactions: [tx({ id: 'old1', description: 'Mercado Dia', amount: 300, categoryId: 'cat-mercado', accountId: 'a1', date: '2026-10-05' }), ...extra],
    }),
    { owner: 'Marina Souza', defaultAccount: 'a1', budgetAlert: 0.8 },
  )
}

const item = (p: Partial<AssistantTx> = {}): AssistantTx => ({
  type: 'despesa',
  description: 'Mercado',
  amount: 230,
  date: TODAY,
  categoryId: null,
  accountId: null,
  toAccountId: null,
  cardId: null,
  installments: 1,
  paid: true,
  note: null,
  ...p,
})
const ops = (p: Partial<AssistantOps> = {}): AssistantOps => ({ create: [], undo: false, correct: null, ...p })
const entry = (id: number, records: LogEntry['records'], p: Partial<LogEntry> = {}): LogEntry => ({ id, input: 'mercado 45', reply: 'Lancei', records, undone: false, created_at: '2026-10-21T10:00:00Z', ...p })
const ids = () => {
  let n = 0
  return () => `n${++n}`
}
const run = (o: AssistantOps, d: UserData, recent: LogEntry[] = [], reply = '') => execute(o, reply, d, { today: TODAY, uid: ids(), recent })

describe('aplicar as operações do assistente', () => {
  it('gasto sem conta vai para a padrão; sem categoria, a sugestão do app; confirmação com "desfazer"', () => {
    const r = run(ops({ create: [item({ description: 'Mercado Assaí', note: 'compra do mês' })] }), sample())
    expect(r.upserts).toHaveLength(1)
    expect(r.upserts[0]).toMatchObject({ accountId: 'a1', categoryId: 'cat-mercado', status: 'pago', via: 'whatsapp', amount: 230, note: 'compra do mês' })
    expect(r.log).toEqual([{ kind: 'transactions', id: 'n1', before: null }])
    expect(r.reply).toContain('Lancei:\n- Mercado Assaí — R$ 230,00 · Mercado · Nubank')
    expect(r.reply.endsWith('Errou? Responda "desfazer".')).toBe(true)
  })

  it('compra no cartão entra na fatura certa; parcelado avança a fatura', () => {
    const r = run(ops({ create: [item({ description: 'Tênis', amount: 300, cardId: 'c1', installments: 3 })] }), sample())
    expect(r.upserts.map((t) => [t.date, t.invoice, t.amount, t.status, t.installment?.n])).toEqual([
      [TODAY, '2026-11', 100, 'pago', 1],
      [TODAY, '2026-12', 100, 'pago', 2],
      [TODAY, '2027-01', 100, 'pago', 3],
    ])
    expect(r.reply).toContain('Tênis — 3x de R$ 100,00 (total R$ 300,00)')
    expect(r.reply).toContain('1ª na fatura de nov/2026')
  })

  it('parcelado na conta: um mês por parcela, as futuras ficam a pagar', () => {
    const r = run(ops({ create: [item({ description: 'Curso', amount: 900, installments: 3, accountId: 'a2' })] }), sample())
    expect(r.upserts.map((t) => [t.date, t.status, t.accountId])).toEqual([
      ['2026-10-21', 'pago', 'a2'],
      ['2026-11-21', 'pendente', 'a2'],
      ['2026-12-21', 'pendente', 'a2'],
    ])
  })

  it('transferência entre contas e pagamento de fatura limitado ao que falta', () => {
    const t = run(ops({ create: [item({ type: 'transferencia', description: 'Transferência', amount: 50, accountId: 'a1', toAccountId: 'a2' })] }), sample())
    expect(t.upserts[0]).toMatchObject({ type: 'transferencia', accountId: 'a1', toAccountId: 'a2', amount: 50 })
    expect(t.upserts[0].categoryId).toBeUndefined()

    const d = sample([tx({ id: 'p1', amount: 400, cardId: 'c1', invoice: '2026-10', date: '2026-09-20' })])
    const r = run(ops({ create: [item({ type: 'transferencia', description: 'Fatura', amount: 1000, cardId: 'c1' })] }), d)
    expect(r.upserts).toEqual([expect.objectContaining({ type: 'transferencia', description: 'Fatura Nubank', amount: 400, cardId: 'c1', invoice: '2026-10', accountId: 'a1', status: 'pago' })])
    expect(r.reply).toContain('O pagamento ficou em R$ 400,00')
    const paid = run(ops({ create: [item({ type: 'transferencia', amount: 50, cardId: 'c1' })] }), sample())
    expect(paid.upserts).toEqual([])
    expect(paid.reply).toContain('não tem valor em aberto')
  })

  it('aviso de limite da categoria', () => {
    expect(run(ops({ create: [item({ amount: 150, categoryId: 'cat-mercado' })] }), sample()).reply).toContain('Alimentação está em 90% do limite do mês (R$ 450,00 de R$ 500,00).')
    expect(run(ops({ create: [item({ amount: 400, categoryId: 'cat-mercado' })] }), sample()).reply).toContain('Alimentação passou do limite do mês: R$ 700,00 de R$ 500,00.')
  })

  it('correção vale para o que a última mensagem criou e guarda o antes', () => {
    const t1 = tx({ id: 't1', description: 'Mercado', amount: 45, accountId: 'a1', categoryId: 'cat-mercado' })
    const fixed = run(ops({ correct: { amount: 50, cardId: 'c1' } }), sample([t1]), [entry(1, [{ kind: 'transactions', id: 't1', before: null }])])
    expect(fixed.upserts).toEqual([{ ...t1, amount: 50, cardId: 'c1', invoice: '2026-11', accountId: undefined }].map(({ accountId: _a, ...rest }) => rest))
    expect(fixed.log).toEqual([{ kind: 'transactions', id: 't1', before: t1 }])
    expect(fixed.reply).toContain('Corrigi:\n- Mercado — agora R$ 50,00 (era R$ 45,00) · cartão Nubank')
    expect(fixed.reply).toContain('Errou?')
  })

  it('correção de parcelado: valor total redividido, data e "ainda não paguei"', () => {
    const parts = [1, 2, 3].map((n) => tx({ id: `g${n}`, description: 'Curso', amount: 300, accountId: 'a1', groupId: 'g', installment: { n, count: 3 }, date: srv.addMonths('2026-10-01', n - 1), status: n === 1 ? 'pago' : 'pendente' }))
    const r = run(ops({ correct: { amount: 1000, date: '2026-10-05', paid: false } }), sample(parts), [entry(1, parts.map((t) => ({ kind: 'transactions' as const, id: t.id, before: null })))])
    expect(r.upserts.map((t) => [t.id, t.amount, t.date, t.status])).toEqual([
      ['g1', 333.33, '2026-10-05', 'pendente'],
      ['g2', 333.33, '2026-11-05', 'pendente'],
      ['g3', 333.34, '2026-12-05', 'pendente'],
    ])
    expect(r.reply).toContain('- Curso — agora R$ 1.000,00 (era R$ 900,00)')
  })

  it('correção sem nada recente avisa; valor em vários itens pede para desfazer', () => {
    expect(run(ops({ correct: { amount: 10 } }), sample()).reply).toBe('Não achei o último lançamento para corrigir.')
    const a = tx({ id: 'x1', description: 'Uber', amount: 20, accountId: 'a1' })
    const b = tx({ id: 'x2', description: 'Café', amount: 8, accountId: 'a1' })
    const r = run(ops({ correct: { amount: 10, categoryId: 'cat-padaria' } }), sample([a, b]), [entry(1, [a, b].map((t) => ({ kind: 'transactions' as const, id: t.id, before: null })))])
    expect(r.upserts.map((t) => [t.id, t.amount, t.categoryId])).toEqual([
      ['x1', 20, 'cat-padaria'],
      ['x2', 8, 'cat-padaria'],
    ])
    expect(r.reply).toContain('responda "desfazer" e mande de novo')
  })

  it('desfazer: devolve o corrigido, depois apaga o criado; parcelas numa linha', () => {
    const t1 = tx({ id: 't1', description: 'Mercado', amount: 45, accountId: 'a1', categoryId: 'cat-mercado' })
    const recent = [entry(2, [{ kind: 'transactions', id: 't1', before: t1 }]), entry(1, [{ kind: 'transactions', id: 't1', before: null }])]
    const undo1 = run(ops({ undo: true }), sample([{ ...t1, amount: 50 }]), recent)
    expect(undo1).toMatchObject({ upserts: [t1], deletes: [], undoneLog: 2 })
    expect(undo1.reply).toBe('Desfeito:\n- Mercado voltou a ser R$ 45,00')

    const undo2 = run(ops({ undo: true }), sample([t1]), [{ ...recent[0], undone: true }, recent[1]])
    expect(undo2).toMatchObject({ upserts: [], deletes: ['t1'], undoneLog: 1 })
    expect(undo2.reply).toBe('Desfeito:\n- Mercado — R$ 45,00 apagado')

    expect(run(ops({ undo: true }), sample()).reply).toBe(texts.nothingToUndo)

    const parts = [1, 2, 3].map((n) => tx({ id: `g${n}`, description: 'Tênis', amount: 100, cardId: 'c1', invoice: '2026-11', groupId: 'g', installment: { n, count: 3 } }))
    const r = run(ops({ undo: true }), sample(parts), [entry(5, parts.map((t) => ({ kind: 'transactions' as const, id: t.id, before: null })))])
    expect([...r.deletes].sort()).toEqual(['g1', 'g2', 'g3'])
    expect(r.reply).toBe('Desfeito:\n- Tênis — 3 parcelas, R$ 300,00 apagado')
  })

  it('desfazer e lançar de novo na mesma resposta', () => {
    const t1 = tx({ id: 't1', description: 'Geladeira', amount: 3000, cardId: 'c1', invoice: '2026-11' })
    const r = run(ops({ undo: true, create: [item({ description: 'Geladeira', amount: 3000, cardId: 'c1', installments: 10 })], correct: { amount: 1 } }), sample([t1]), [entry(1, [{ kind: 'transactions', id: 't1', before: null }])])
    expect(r.deletes).toEqual(['t1'])
    expect(r.upserts).toHaveLength(10)
    // a correção não vale junto com desfazer
    expect(r.reply).not.toContain('Corrigi')
  })
})

describe('contexto do assistente montado no servidor', () => {
  it('saldos, faturas, mês, limites e o que a última mensagem criou', () => {
    const t1 = tx({ id: 't1', description: 'Uber', amount: 23.5, accountId: 'a1', categoryId: 'cat-app-transporte' })
    const d = sample([tx({ id: 'p1', amount: 400, cardId: 'c1', invoice: '2026-11', date: '2026-10-10' }), tx({ id: 'r1', type: 'receita', amount: 5000, accountId: 'a1', categoryId: 'cat-salario' }), t1])
    const c = assistantContext(d, { today: TODAY, name: 'Marina', recent: [entry(1, [{ kind: 'transactions', id: 't1', before: null }])] })
    expect(c.accounts).toEqual([
      { id: 'a1', name: 'Nubank', kind: 'corrente', balance: 5676.5 },
      { id: 'a2', name: 'Carteira', kind: 'carteira', balance: 100 },
    ])
    expect(c.defaultAccount).toBe('a1')
    expect(c.totalBalance).toBe(5776.5)
    expect(c.cards[0]).toMatchObject({ id: 'c1', available: 4600, limit: 5000 })
    expect(c.invoices).toEqual([{ cardId: 'c1', key: '2026-11', due: '2026-11-10', total: 400, open: 400, status: 'aberta' }])
    expect(c.month).toMatchObject({ key: '2026-10', income: 5000, expense: 323.5 })
    expect(c.expenseByCategory?.find((x) => x.categoryId === 'cat-alimentacao')).toEqual({ categoryId: 'cat-alimentacao', name: 'Alimentação', amount: 300, limit: 500 })
    expect(c.lastCreated).toEqual([item({ description: 'Uber', amount: 23.5, accountId: 'a1', categoryId: 'cat-app-transporte' })])
    expect(c.categories.find((x) => x.id === 'cat-mercado')).toEqual({ id: 'cat-mercado', name: 'Mercado', type: 'despesa', parentId: 'cat-alimentacao' })
    // o contexto do servidor passa pela mesma conferência do contexto que vem do app
    expect(sanitizeContext(JSON.parse(JSON.stringify(c)))).toEqual(c)
    const text = contextText(c)
    expect(text).toContain('- [a1] Nubank · conta corrente · saldo R$ 5.676,50 · conta padrão')
    expect(text).toContain('Criado na sua última resposta')
  })

  it('a conversa recente vira o histórico (a mais antiga primeiro)', () => {
    expect(historyOf([entry(2, [], { input: 'e o uber?', reply: 'Lancei uber' }), entry(1, [], { input: 'mercado 45', reply: 'Lancei mercado', undone: true })])).toEqual([
      { role: 'user', text: 'mercado 45' },
      { role: 'assistant', text: 'Lancei mercado [depois desfeito]' },
      { role: 'user', text: 'e o uber?' },
      { role: 'assistant', text: 'Lancei uber' },
    ])
  })
})

// ─── Fluxo inteiro com banco e rede de mentira ───────────────

interface LinkRow {
  user_id: string
  phone: string | null
  code: string | null
  code_expires: number
}

function fakeStore(opts: { links?: LinkRow[]; profile?: Profile | null; data?: UserData; settings?: unknown; recent?: LogEntry[] } = {}) {
  const links = opts.links ?? []
  const logged = new Map<string, Record<string, unknown>>()
  const calls: { upsert: srv.Transaction[][]; remove: string[][]; undone: number[]; link: [string, string][] } = { upsert: [], remove: [], undone: [], link: [] }
  const d = opts.data ?? sample()
  const store: Store = {
    async claim(row) {
      if (logged.has(row.msg_id)) return false
      logged.set(row.msg_id, { ...row })
      return true
    },
    async finish(msgId, patch) {
      Object.assign(logged.get(msgId)!, patch)
    },
    async linkByPhone(phones) {
      const l = links.find((x) => x.phone && phones.includes(x.phone))
      return l ? ({ user_id: l.user_id, phone: l.phone } as Link) : null
    },
    async linkByCode(codes) {
      const l = links.find((x) => x.code && codes.includes(x.code) && x.code_expires > Date.now())
      return l ? { user_id: l.user_id, phone: l.phone } : null
    },
    async link(userId, phone, variants) {
      calls.link.push([userId, phone])
      for (const l of links) if (l.phone && variants.includes(l.phone) && l.user_id !== userId) l.phone = null
      Object.assign(links.find((x) => x.user_id === userId)!, { phone, code: null })
    },
    async profile() {
      return opts.profile === undefined ? { blocked: false, expires_at: null, name: 'Marina S.' } : opts.profile
    },
    async settings() {
      return opts.settings ?? { owner: 'Marina Souza', defaultAccount: 'a1' }
    },
    async records() {
      return rows({ accounts: d.accounts, cards: d.cards, categories: d.categories, transactions: d.transactions, goals: d.goals })
    },
    async recent() {
      return opts.recent ?? []
    },
    async upsert(_u, txs) {
      calls.upsert.push(txs)
    },
    async remove(_u, list) {
      calls.remove.push(list)
    },
    async markUndone(id) {
      calls.undone.push(id)
    },
  }
  return { store, logged, calls }
}

const ok = (p: Partial<InterpretResult> = {}): InterpretResult => ({ reply: '', ops: ops({ create: [item({ categoryId: 'cat-mercado' })] }), outcome: 'ok', ...p })

function deps(store: Store, p: Partial<Deps> = {}) {
  const sent: [string, string][] = []
  const asks: InterpretRequest[] = []
  const d: Deps = {
    store,
    today: TODAY,
    uid: ids(),
    send: async (to, text) => void sent.push([to, text]),
    download: async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg' }),
    transcribe: null,
    interpret: async (req) => (asks.push(req), ok()),
    log: () => undefined,
    ...p,
  }
  return { d, sent, asks }
}

let seq = 0
const msg = (p: Partial<Incoming>): Incoming => ({ msgId: `m${++seq}`, from: '5511987654321', name: 'Mari', kind: 'texto', text: 'mercado 230', ...p })
const linked = (): LinkRow[] => [{ user_id: 'u1', phone: '5511987654321', code: null, code_expires: 0 }]

describe('mensagem do começo ao fim', () => {
  it('número desconhecido recebe como ligar', async () => {
    const { store } = fakeStore()
    const { d, sent, asks } = deps(store, { appUrl: 'https://app.jurospro.com' })
    await handle(msg({}), d)
    expect(sent).toEqual([['5511987654321', texts.notLinked('https://app.jurospro.com')]])
    expect(asks).toHaveLength(0)
  })

  it('código do app liga o número (mesmo chegando sem o 9) e dá as boas-vindas', async () => {
    const links: LinkRow[] = [
      { user_id: 'u1', phone: null, code: 'K7M2QX', code_expires: Date.now() + 60_000 },
      { user_id: 'u2', phone: '5511987654321', code: null, code_expires: 0 },
    ]
    const { store, calls, logged } = fakeStore({ links })
    const { d, sent } = deps(store)
    const m = msg({ from: '551187654321', text: 'Meu código do Dinn: K7M2QX' })
    await handle(m, d)
    expect(calls.link).toEqual([['u1', '5511987654321']])
    expect(links[1].phone).toBeNull()
    expect(sent[0][1]).toBe(texts.welcome('Marina'))
    expect(logged.get(m.msgId)).toMatchObject({ user_id: 'u1', reply: texts.welcome('Marina') })
  })

  it('código vencido avisa; número já ligado é avisado', async () => {
    const { store } = fakeStore({ links: [{ user_id: 'u1', phone: null, code: 'K7M2QX', code_expires: Date.now() - 1 }] })
    const { d, sent } = deps(store)
    await handle(msg({ text: 'Meu código do Dinn: K7M2QX' }), d)
    expect(sent[0][1]).toBe(texts.expiredCode)

    const other = fakeStore({ links: linked() })
    const o = deps(other.store)
    await handle(msg({ text: 'Meu código do Dinn: K7M2QX' }), o.d)
    expect(o.sent[0][1]).toBe(texts.alreadyLinked)
  })

  it('mensagem repetida pelo provedor é tratada uma vez só', async () => {
    const { store, calls } = fakeStore({ links: linked() })
    const { d, sent } = deps(store)
    const m = msg({ msgId: 'fixo' })
    await handle(m, d)
    await handle(m, d)
    expect(sent).toHaveLength(1)
    expect(calls.upsert).toHaveLength(1)
  })

  it('acesso vencido não lança', async () => {
    const { store, calls } = fakeStore({ links: linked(), profile: { blocked: false, expires_at: '2026-10-20' } })
    const { d, sent, asks } = deps(store)
    await handle(msg({}), d)
    expect(sent[0][1]).toBe(texts.noAccess)
    expect(asks).toHaveLength(0)
    expect(calls.upsert).toHaveLength(0)
  })

  it('texto vira lançamento gravado, confirmado e guardado no histórico', async () => {
    const t1 = tx({ id: 't1', description: 'Uber', amount: 20, accountId: 'a1' })
    const { store, calls, logged } = fakeStore({ links: linked(), data: sample([t1]), recent: [entry(4, [{ kind: 'transactions', id: 't1', before: null }], { input: 'uber 20', reply: 'Lancei uber' })] })
    const { d, sent, asks } = deps(store)
    const m = msg({ text: 'mercado 230' })
    await handle(m, d)
    expect(asks[0].input).toEqual({ text: 'mercado 230', source: 'texto' })
    expect(asks[0].context.today).toBe(TODAY)
    expect(asks[0].context.name).toBe('Marina Souza')
    expect(asks[0].context.lastCreated).toEqual([item({ description: 'Uber', amount: 20, accountId: 'a1' })])
    expect(asks[0].history).toEqual([
      { role: 'user', text: 'uber 20' },
      { role: 'assistant', text: 'Lancei uber' },
    ])
    expect(calls.upsert[0]).toEqual([expect.objectContaining({ description: 'Mercado', amount: 230, accountId: 'a1', categoryId: 'cat-mercado', via: 'whatsapp' })])
    expect(sent[0][1]).toContain('Lancei:')
    expect(logged.get(m.msgId)).toMatchObject({ user_id: 'u1', input: 'mercado 230', records: [{ kind: 'transactions', id: calls.upsert[0][0].id, before: null }] })
  })

  it('"desfazer" não chama a IA', async () => {
    const data = sample([tx({ id: 't1', description: 'Mercado', amount: 45, accountId: 'a1' })])
    const { store, calls } = fakeStore({ links: linked(), data, recent: [entry(3, [{ kind: 'transactions', id: 't1', before: null }])] })
    const { d, sent, asks } = deps(store)
    await handle(msg({ text: 'desfazer' }), d)
    expect(asks).toHaveLength(0)
    expect(calls.remove).toEqual([['t1']])
    expect(calls.undone).toEqual([3])
    expect(sent[0][1]).toContain('Desfeito:')
  })

  it('áudio: sem transcrição pede texto; com transcrição vai para a IA como áudio', async () => {
    const a = fakeStore({ links: linked() })
    const x = deps(a.store)
    await handle(msg({ kind: 'audio', text: undefined, media: { provider: 'meta', id: 'm1' } }), x.d)
    expect(x.sent[0][1]).toBe(texts.noTranscription)

    const b = fakeStore({ links: linked() })
    const y = deps(b.store, { transcribe: async () => 'paguei oitenta de luz ontem' })
    await handle(msg({ kind: 'audio', text: undefined, media: { provider: 'meta', id: 'm1' } }), y.d)
    expect(y.asks[0].input).toEqual({ text: 'paguei oitenta de luz ontem', source: 'audio' })
    expect(b.calls.upsert).toHaveLength(1)
  })

  it('foto e PDF vão como anexo; arquivo de outro tipo não', async () => {
    const a = fakeStore({ links: linked() })
    const x = deps(a.store)
    await handle(msg({ kind: 'imagem', text: undefined, caption: 'almoço', media: { provider: 'meta', id: 'm1' } }), x.d)
    expect(x.asks[0].input).toEqual({ text: 'almoço', images: [{ base64: 'AQID', mime: 'image/jpeg' }] })

    const y = deps(a.store, { download: async () => ({ bytes: new Uint8Array([1]), mime: 'application/pdf' }) })
    await handle(msg({ kind: 'documento', text: undefined, fileName: 'extrato.pdf', media: { provider: 'meta', id: 'm2' } }), y.d)
    expect(y.asks[0].input.pdf).toEqual({ base64: 'AQ==', name: 'extrato.pdf' })

    const z = deps(a.store, { download: async () => ({ bytes: new Uint8Array([1]), mime: 'application/zip' }) })
    await handle(msg({ kind: 'documento', text: undefined, fileName: 'x.zip', media: { provider: 'meta', id: 'm3' } }), z.d)
    expect(z.sent[0][1]).toBe(texts.unsupportedFile)
    expect(z.asks).toHaveLength(0)
  })

  it('recusa, resposta fora do formato e erro da IA viram mensagens gentis', async () => {
    const a = fakeStore({ links: linked() })
    const x = deps(a.store, { interpret: async () => ok({ reply: 'recusei', ops: ops(), outcome: 'refusal' }) })
    await handle(msg({}), x.d)
    expect(x.sent[0][1]).toBe('recusei')
    const z = deps(a.store, {
      interpret: async () => {
        throw new Error('timeout')
      },
    })
    await handle(msg({}), z.d)
    expect(z.sent[0][1]).toBe(texts.failed)
    expect(a.calls.upsert).toHaveLength(0)
  })

  it('pergunta sem lançamento devolve a resposta da IA', async () => {
    const a = fakeStore({ links: linked() })
    const x = deps(a.store, { interpret: async () => ok({ reply: 'Este mês você gastou *R$ 300,00*.', ops: ops() }) })
    await handle(msg({ text: 'quanto gastei?' }), x.d)
    expect(x.sent[0][1]).toBe('Este mês você gastou *R$ 300,00*.')
    expect(a.calls.upsert).toHaveLength(0)
  })
})
