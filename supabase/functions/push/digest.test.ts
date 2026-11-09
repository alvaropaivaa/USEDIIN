import { describe, expect, it } from 'vitest'
import { buildDigest, invoiceDates as serverDates, invoiceFor as serverInvoice, type DigestInput } from './digest.ts'
import { addDays } from '../../../src/lib/dates'
import { invoiceDates, invoiceFor } from '../../../src/lib/ledger'

/** O Intl separa "R$" do número com espaço não separável. */
const sp = (s: string | undefined) => s?.replace(/\u00a0/g, ' ')

const input = (p: Partial<DigestInput>): DigestInput => ({
  date: '2026-10-21',
  settings: {},
  profile: { blocked: false, expires_at: null },
  transactions: [],
  debts: [],
  cards: [],
  categories: [],
  ...p,
})

describe('resumo diário do servidor', () => {
  it('a conta da fatura no servidor é a mesma do app em qualquer dia', () => {
    for (const [closingDay, dueDay] of [[3, 10], [25, 5], [31, 10], [15, 15]])
      for (let d = '2026-01-01'; d <= '2026-12-31'; d = addDays(d, 1)) {
        const card = { id: 'c', closingDay, dueDay }
        const key = invoiceFor(card, d)
        expect(serverInvoice(card, d)).toBe(key)
        expect(serverDates(card, key)).toEqual(invoiceDates(card, key))
      }
  })

  it('atrasadas, de hoje e de amanhã, com parcelas de dívidas e selo do ícone', () => {
    const d = buildDigest(
      input({
        categories: [{ id: 'cat-luz', name: 'Luz' }],
        transactions: [
          { id: '1', type: 'despesa', description: 'Luz', amount: 180, date: '2026-10-15', status: 'pendente', categoryId: 'cat-luz' },
          { id: '2', type: 'despesa', description: 'Internet', amount: 99.9, date: '2026-10-21', status: 'pendente' },
          { id: '3', type: 'receita', description: 'Freela', amount: 500, date: '2026-10-22', status: 'pendente' },
          { id: '4', type: 'despesa', description: 'Já paga', amount: 10, date: '2026-10-21', status: 'pago' },
        ],
        debts: [{ id: 'd', direction: 'pagar', person: 'Banco', schedule: [{ due: '2026-10-20', amount: 300 }], payments: [] }],
      }),
    )
    expect(d.skipped).toBe(false)
    expect(d.notices.map((n) => n.type)).toEqual(['atrasos', 'hoje', 'amanha'])
    expect(d.notices[0]).toMatchObject({ title: 'Contas atrasadas', key: 'atrasos:2026-10-21', url: '/?n=due:atrasado' })
    expect(d.notices[0].body).toContain('2 contas')
    expect(sp(d.notices[1].body)).toBe('Internet · Despesa · R$ 99,90')
    expect(d.badge).toBe(3)
  })

  it('fatura que fechou hoje e fatura que vence amanhã', () => {
    const card = { id: 'c', name: 'Nubank', closingDay: 21, dueDay: 28 }
    const d = buildDigest(
      input({
        cards: [card],
        transactions: [
          { id: '1', type: 'despesa', amount: 200, date: '2026-10-10', status: 'pago', cardId: 'c', invoice: '2026-10' },
          { id: '2', type: 'despesa', amount: 50, date: '2026-09-10', status: 'pago', cardId: 'c', invoice: '2026-09' },
        ],
      }),
    )
    expect(sp(d.notices.find((n) => n.key === 'fatura-fechou:c:2026-10')?.body)).toBe('R$ 200,00 · vence 28/10')
    const late = buildDigest(input({ date: '2026-10-27', cards: [card], transactions: [{ id: '1', type: 'despesa', amount: 200, date: '2026-10-10', status: 'pago', cardId: 'c', invoice: '2026-10' }] }))
    expect(late.notices.find((n) => n.type === 'faturas')?.title).toBe('Fatura Nubank vence amanhã')
  })

  it('modo discreto não manda valores; sem acesso não manda nada; alerta desligado some', () => {
    const tx = { id: '1', type: 'despesa' as const, description: 'Luz', amount: 180, date: '2026-10-21', status: 'pendente' as const }
    expect(buildDigest(input({ settings: { privacy: true }, transactions: [tx] })).notices[0].body).not.toContain('R$')
    expect(buildDigest(input({ profile: { blocked: true, expires_at: null }, transactions: [tx] })).skipped).toBe(true)
    expect(buildDigest(input({ profile: { blocked: false, expires_at: '2026-10-20' }, transactions: [tx] })).skipped).toBe(true)
    expect(buildDigest(input({ settings: { alerts: { hoje: false } }, transactions: [tx] })).notices).toHaveLength(0)
  })

  it('resumo de segunda-feira e fechamento do mês', () => {
    const txs = [
      { id: '1', type: 'receita' as const, amount: 1000, date: '2026-10-14', status: 'pago' as const },
      { id: '2', type: 'despesa' as const, amount: 400, date: '2026-10-15', status: 'pago' as const },
    ]
    const monday = buildDigest(input({ date: '2026-10-19', transactions: txs }))
    expect(sp(monday.notices.find((n) => n.key === 'resumo-semana:2026-10-19')?.body)).toContain('R$ 1.000,00 de receitas e R$ 400,00 de despesas')
    const first = buildDigest(input({ date: '2026-11-01', transactions: txs }))
    const month = first.notices.find((n) => n.type === 'resumo')
    expect(month?.title).toBe('Fechamento de outubro')
    expect(sp(month?.body)).toBe('Receitas R$ 1.000,00 · despesas R$ 400,00 · sobrou R$ 600,00.')
  })
})
