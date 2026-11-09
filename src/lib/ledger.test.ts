import { describe, expect, it } from 'vitest'
import { addDays, shiftMonth } from './dates'
import {
  balances,
  budgetTone,
  byCategory,
  cardIndex,
  cardUsage,
  cashDate,
  goalStats,
  invoice,
  invoiceDates,
  invoiceFor,
  materialize,
  overallBudget,
  splitInstallments,
  suggestCategory,
  totalBalance,
  totals,
  type Account,
  type Card,
  type Category,
  type Goal,
  type Recurrence,
  type Transaction,
} from './ledger'

const tx = (p: Partial<Transaction> & Pick<Transaction, 'type' | 'amount' | 'date'>): Transaction => ({ id: Math.random().toString(36).slice(2), description: 'x', status: 'pago', createdAt: p.date, ...p })
const card = (p: Partial<Card> = {}): Card => ({ id: 'c1', name: 'Cartão', limit: 1000, closingDay: 3, dueDay: 10, color: '#000', createdAt: '2026-01-01', ...p })
const account = (id: string, initial = 0): Account => ({ id, name: id, kind: 'corrente', initial, color: '#000', createdAt: '2026-01-01' })

describe('faturas do cartão', () => {
  it('compra antes do fechamento fica na fatura do mês; no dia do fechamento vai para a próxima', () => {
    const c = card({ closingDay: 3, dueDay: 10 })
    expect(invoiceFor(c, '2026-02-02')).toBe('2026-02')
    expect(invoiceFor(c, '2026-02-03')).toBe('2026-03')
    expect(invoiceDates(c, '2026-02')).toEqual({ closing: '2026-02-03', due: '2026-02-10' })
  })

  it('vencimento antes do fechamento no calendário vence no mês seguinte', () => {
    const c = card({ closingDay: 25, dueDay: 5 })
    expect(invoiceFor(c, '2026-03-10')).toBe('2026-04')
    expect(invoiceDates(c, '2026-04')).toEqual({ closing: '2026-03-25', due: '2026-04-05' })
  })

  it('fechamento no dia 31 vale como último dia em meses curtos', () => {
    const c = card({ closingDay: 31, dueDay: 10 })
    expect(invoiceFor(c, '2026-02-27')).toBe('2026-03')
    expect(invoiceFor(c, '2026-02-28')).toBe('2026-04')
    expect(invoiceDates(c, '2026-03').closing).toBe('2026-02-28')
  })

  // propriedade: toda compra cai entre o fechamento anterior (inclusive) e o fechamento da sua fatura (exclusive)
  it.each([
    [3, 10],
    [25, 5],
    [31, 10],
    [28, 7],
    [1, 8],
    [15, 15],
  ])('cada dia de 2025–2027 cai no ciclo certo (fecha %i, vence %i)', (closingDay, dueDay) => {
    const c = card({ closingDay, dueDay })
    for (let d = '2025-01-01'; d <= '2027-12-31'; d = addDays(d, 1)) {
      const key = invoiceFor(c, d)
      const { closing, due } = invoiceDates(c, key)
      const prev = invoiceDates(c, shiftMonth(key, -1)).closing
      expect(d < closing, `${d} antes do fechamento ${closing}`).toBe(true)
      expect(d >= prev, `${d} depois do fechamento anterior ${prev}`).toBe(true)
      expect(due > closing || dueDay === closingDay, `vencimento ${due} depois do fechamento ${closing}`).toBe(true)
    }
  })

  it('status: aberta, fechada, paga em parte, paga, vencida e sem gastos', () => {
    const c = card()
    const buy = tx({ type: 'despesa', amount: 300, date: '2026-01-20', cardId: 'c1', invoice: '2026-02' })
    const pay = (amount: number) => tx({ type: 'transferencia', amount, date: '2026-02-08', cardId: 'c1', invoice: '2026-02', accountId: 'a' })
    expect(invoice(c, '2026-02', [buy], '2026-02-01').status).toBe('aberta')
    expect(invoice(c, '2026-02', [buy], '2026-02-05').status).toBe('fechada')
    expect(invoice(c, '2026-02', [buy, pay(100)], '2026-02-05').status).toBe('parcial')
    expect(invoice(c, '2026-02', [buy, pay(300)], '2026-02-20').status).toBe('paga')
    expect(invoice(c, '2026-02', [buy], '2026-02-11').status).toBe('vencida')
    expect(invoice(c, '2026-03', [buy], '2026-02-11').status).toBe('vazia')
    expect(invoice(c, '2026-02', [buy, pay(100)], '2026-02-05').open).toBe(200)
  })

  it('limite usado desconta os pagamentos', () => {
    const c = card({ limit: 1000 })
    const txs = [tx({ type: 'despesa', amount: 700, date: '2026-01-20', cardId: 'c1', invoice: '2026-02' }), tx({ type: 'transferencia', amount: 200, date: '2026-02-10', cardId: 'c1', invoice: '2026-02', accountId: 'a' })]
    expect(cardUsage(c, txs)).toMatchObject({ used: 500, available: 500, ratio: 0.5 })
  })
})

describe('saldos e totais', () => {
  const a = account('a', 1000)
  const b = account('b', 0)

  it('saldo: só o que foi pago; cartão não mexe na conta; transferência, ajuste e metas mexem', () => {
    const txs = [
      tx({ type: 'receita', amount: 500, date: '2026-01-05', accountId: 'a' }),
      tx({ type: 'despesa', amount: 200, date: '2026-01-06', accountId: 'a' }),
      tx({ type: 'despesa', amount: 999, date: '2026-01-07', accountId: 'a', status: 'pendente' }),
      tx({ type: 'despesa', amount: 300, date: '2026-01-08', accountId: 'a', cardId: 'c1', invoice: '2026-02' }),
      tx({ type: 'transferencia', amount: 100, date: '2026-01-09', accountId: 'a', toAccountId: 'b' }),
      tx({ type: 'transferencia', amount: 50, date: '2026-01-10', toAccountId: 'b', adjust: true }),
      tx({ type: 'transferencia', amount: 120, date: '2026-02-10', accountId: 'a', cardId: 'c1', invoice: '2026-02' }),
    ]
    const goals: Goal[] = [{ id: 'g', name: 'g', target: 1000, color: '#000', icon: 'cofrinho', createdAt: '2026-01-01', contributions: [{ id: 'k', date: '2026-01-11', amount: 80, accountId: 'a' }] }]
    const bal = balances([a, b], txs, goals)
    expect(bal.get('a')).toBe(1000 + 500 - 200 - 100 - 120 - 80)
    expect(bal.get('b')).toBe(150)
    expect(totalBalance([a, { ...b, hidden: true }], bal)).toBe(1000)
  })

  it('totais: compra no cartão conta no vencimento da fatura e só fica "paga" com a fatura paga', () => {
    const cards = cardIndex([card()])
    const buy = tx({ type: 'despesa', amount: 300, date: '2026-01-20', cardId: 'c1', invoice: '2026-02' })
    expect(cashDate(buy, cards)).toBe('2026-02-10')
    expect(totals([buy], cards, '2026-01-01', '2026-01-31').expense).toBe(0)
    expect(totals([buy], cards, '2026-02-01', '2026-02-28')).toMatchObject({ expense: 300, expensePending: 300, expensePaid: 0 })
    const pay = tx({ type: 'transferencia', amount: 300, date: '2026-02-10', cardId: 'c1', invoice: '2026-02', accountId: 'a' })
    expect(totals([buy, pay], cards, '2026-02-01', '2026-02-28')).toMatchObject({ expense: 300, expensePaid: 300, expensePending: 0, income: 0 })
    const part = tx({ type: 'transferencia', amount: 100, date: '2026-02-10', cardId: 'c1', invoice: '2026-02', accountId: 'a' })
    expect(totals([buy, part], cards, '2026-02-01', '2026-02-28')).toMatchObject({ expensePaid: 100, expensePending: 200 })
  })

  it('subcategoria soma na principal e guarda o próprio total', () => {
    const cats: Category[] = [
      { id: 'food', name: 'Alimentação', type: 'despesa', color: '#000', icon: 'x' },
      { id: 'market', name: 'Mercado', type: 'despesa', color: '#000', icon: 'x', parentId: 'food' },
    ]
    const by = byCategory([tx({ type: 'despesa', amount: 10, date: '2026-01-02', categoryId: 'food' }), tx({ type: 'despesa', amount: 5, date: '2026-01-03', categoryId: 'market' })], new Map(), cats, 'despesa', '2026-01-01', '2026-01-31')
    expect(by.get('food')).toBe(15)
    expect(by.get('market')).toBe(5)
  })
})

describe('orçamento', () => {
  it('tons: no controle, em atenção (a partir do aviso) e acima do limite', () => {
    expect(budgetTone(0.79)).toBe('green')
    expect(budgetTone(0.8)).toBe('orange')
    expect(budgetTone(1)).toBe('orange')
    expect(budgetTone(1.01)).toBe('red')
    expect(budgetTone(0.6, 0.5)).toBe('orange')
  })

  it('limite geral: valor definido conta tudo; soma das categorias conta só as categorias com limite', () => {
    const cats: Category[] = [
      { id: 'food', name: 'Alimentação', type: 'despesa', color: '#000', icon: 'x', budget: 500 },
      { id: 'home', name: 'Moradia', type: 'despesa', color: '#000', icon: 'x' },
    ]
    const txs = [tx({ type: 'despesa', amount: 100, date: '2026-01-02', categoryId: 'food' }), tx({ type: 'despesa', amount: 2000, date: '2026-01-03', categoryId: 'home' })]
    expect(overallBudget(cats, 0, txs, new Map(), '2026-01')).toEqual({ limit: 500, spent: 100 })
    expect(overallBudget(cats, 3000, txs, new Map(), '2026-01')).toEqual({ limit: 3000, spent: 2100 })
    expect(overallBudget([], 0, txs, new Map(), '2026-01')).toEqual({ limit: 0, spent: 0 })
  })
})

describe('sugestão de categoria', () => {
  const cats: Category[] = [
    { id: 'food', name: 'Alimentação', type: 'despesa', color: '#000', icon: 'x', keywords: ['restaurante'] },
    { id: 'delivery', name: 'Delivery', type: 'despesa', color: '#000', icon: 'x', parentId: 'food', keywords: ['ifood'] },
    { id: 'gift', name: 'Presentes', type: 'receita', color: '#000', icon: 'x', keywords: ['ifood'] },
  ]
  it('usa o histórico antes das palavras-chave, e respeita o tipo', () => {
    expect(suggestCategory('Pedido iFood', 'despesa', cats, [])).toBe('delivery')
    expect(suggestCategory('Pedido iFood', 'receita', cats, [])).toBe('gift')
    expect(suggestCategory('Pedido iFood', 'despesa', cats, [tx({ type: 'despesa', amount: 1, date: '2026-01-01', description: 'pedido ifood', categoryId: 'food' })])).toBe('food')
    expect(suggestCategory('ab', 'despesa', cats, [])).toBeUndefined()
  })
})

describe('repetição e parcelas', () => {
  it('lançamento fixo gera até o horizonte, sem repetir o que já foi gerado', () => {
    const rule: Recurrence = { id: 'r', frequency: 'mensal', start: '2026-01-31', generated: '', template: { type: 'despesa', description: 'Aluguel', amount: 100 } }
    const make = (r: Recurrence, date: string) => tx({ id: `${r.id}:${date}`, type: 'despesa', amount: 100, date })
    const first = materialize([rule], new Map(), '2026-04-30', make)
    expect(first.created.map((t) => t.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
    const again = materialize(first.updated, new Map(), '2026-04-30', make)
    expect(again.created).toHaveLength(0)
    const ended = materialize([{ ...rule, until: '2026-02-15' }], new Map(), '2026-04-30', make)
    expect(ended.created.map((t) => t.date)).toEqual(['2026-01-31'])
  })

  it('parcelas somam exatamente o total', () => {
    for (const [total, n] of [[100, 3], [3490, 10], [0.05, 2], [1000, 7]] as const) {
      const parts = splitInstallments(total, n)
      expect(parts).toHaveLength(n)
      expect(Math.round(parts.reduce((s, x) => s + x, 0) * 100) / 100).toBe(total)
    }
  })
})

describe('metas', () => {
  const goal = (p: Partial<Goal>): Goal => ({ id: 'g', name: 'g', target: 1200, color: '#000', icon: 'x', createdAt: '2026-01-01', contributions: [], ...p })
  it('concluída, previsão pelo plano e quanto guardar até o prazo', () => {
    expect(goalStats(goal({ contributions: [{ id: '1', date: '2026-01-01', amount: 1200 }] }), '2026-02-01').done).toBe(true)
    const st = goalStats(goal({ monthly: 100, contributions: [{ id: '1', date: '2026-01-01', amount: 200 }] }), '2026-01-15')
    expect(st.left).toBe(1000)
    expect(st.forecast).toBe('2026-11')
    const dl = goalStats(goal({ deadline: '2026-07-15', contributions: [] }), '2026-01-15')
    expect(dl.needed).toBeCloseTo(200, 0)
    expect(dl.onTrack).toBe(false)
  })
  it('sem ritmo não tem previsão', () => {
    expect(goalStats(goal({}), '2026-01-15').forecast).toBeNull()
  })
})
