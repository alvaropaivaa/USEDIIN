import { describe, expect, it } from 'vitest'
import { parseQuick } from './quick'
import { defaultCategories } from './categories'
import type { Account, Card } from './ledger'

const accounts: Account[] = [
  { id: 'nu', name: 'Nubank', kind: 'corrente', initial: 0, color: '#000', createdAt: '2026-01-01' },
  { id: 'itau', name: 'Itaú', kind: 'corrente', initial: 0, color: '#000', createdAt: '2026-01-01' },
]
const cards: Card[] = [{ id: 'click', name: 'Itaú Click', limit: 1000, closingDay: 20, dueDay: 28, color: '#000', createdAt: '2026-01-01' }]
const ctx = { categories: defaultCategories(), accounts, cards, history: [], ref: '2026-10-21' }

describe('lançamento rápido', () => {
  it('despesa com valor em reais, data relativa, conta e categoria pela palavra-chave', () => {
    expect(parseQuick('gastei 45,90 no ifood ontem no nubank', ctx)).toMatchObject({ type: 'despesa', amount: 45.9, date: '2026-10-20', accountId: 'nu', categoryId: 'cat-delivery', description: 'Ifood', pending: false })
  })

  it('receita com "mil" e acento na conta', () => {
    expect(parseQuick('recebi 2 mil de salário no itaú', ctx)).toMatchObject({ type: 'receita', amount: 2000, accountId: 'itau', categoryId: 'cat-salario-mensal', description: 'Salário' })
  })

  it('cartão pelo nome (o nome mais longo ganha da conta "Itaú")', () => {
    const q = parseQuick('mercado 312,40 no cartão itaú click dia 3', ctx)
    expect(q).toMatchObject({ amount: 312.4, cardId: 'click', date: '2026-10-03', categoryId: 'cat-mercado' })
    expect(q?.accountId).toBeUndefined()
  })

  it('milhar com ponto, R$ e data dd/mm', () => {
    expect(parseQuick('aluguel R$ 1.750,00 05/11', ctx)).toMatchObject({ amount: 1750, date: '2026-11-05', categoryId: 'cat-aluguel', pending: true })
    expect(parseQuick('notebook 3.490', ctx)?.amount).toBe(3490)
  })

  it('"dia 31" num mês que não tem 31 vale o último dia; sem valor não há lançamento', () => {
    expect(parseQuick('luz 180 dia 31', { ...ctx, ref: '2026-11-10' })?.date).toBe('2026-11-30')
    expect(parseQuick('mercado hoje', ctx)).toBeNull()
  })
})
