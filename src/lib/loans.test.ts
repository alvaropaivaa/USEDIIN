import { describe, expect, it } from 'vitest'
import { buildSchedule, installments, lateCharges, renegotiate, summarize, type Loan } from './loans'
import { legacyToDebts } from './legacy'

const sum = (xs: { amount: number }[]) => Math.round(xs.reduce((s, x) => s + x.amount, 0) * 100) / 100

describe('parcelas', () => {
  it('juros simples: total = capital × (1 + taxa × n) e a última parcela absorve o arredondamento', () => {
    const s = buildSchedule({ principal: 1000, rate: 0.05, mode: 'simples', frequency: 'mensal', count: 3, firstDue: '2026-01-31' })
    expect(sum(s)).toBe(1150)
    expect(s.map((x) => x.due)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
    expect(s[0].amount).toBe(383.33)
    expect(s[2].amount).toBe(383.34)
  })

  it('Tabela Price: parcela fixa pela fórmula e juros zero divide o capital', () => {
    const s = buildSchedule({ principal: 32000, rate: 0.0149, mode: 'composto', frequency: 'mensal', count: 48, firstDue: '2026-01-10' })
    expect(s[0].amount).toBeCloseTo((32000 * 0.0149) / (1 - Math.pow(1.0149, -48)), 2)
    const zero = buildSchedule({ principal: 900, rate: 0, mode: 'composto', frequency: 'semanal', count: 3, firstDue: '2026-01-01' })
    expect(zero.map((x) => x.amount)).toEqual([300, 300, 300])
    expect(zero.map((x) => x.due)).toEqual(['2026-01-01', '2026-01-08', '2026-01-15'])
  })

  it('parcelas fracionárias ou zero viram pelo menos uma', () => {
    expect(buildSchedule({ principal: 100, rate: 0, mode: 'simples', frequency: 'mensal', count: 0, firstDue: '2026-01-01' })).toHaveLength(1)
    expect(buildSchedule({ principal: 100, rate: 0, mode: 'simples', frequency: 'mensal', count: 2.6, firstDue: '2026-01-01' })).toHaveLength(3)
  })
})

describe('pagamentos', () => {
  const loan: Loan = { id: 'l', principal: 300, rate: 0, mode: 'simples', frequency: 'mensal', createdAt: '2026-01-01', schedule: [{ due: '2026-02-01', amount: 100 }, { due: '2026-03-01', amount: 100 }, { due: '2026-04-01', amount: 100 }], payments: [] }

  it('pagamento parcial abate das parcelas mais antigas e o status acompanha a data', () => {
    const l = { ...loan, payments: [{ id: 'p', date: '2026-02-01', amount: 150 }] }
    const list = installments(l, '2026-03-01')
    expect(list.map((i) => [i.status, i.remaining])).toEqual([
      ['pago', 0],
      ['hoje', 50],
      ['pendente', 100],
    ])
    expect(installments(l, '2026-03-02')[1].status).toBe('atrasada')
    expect(summarize(l, '2026-03-02')).toMatchObject({ paid: 150, open: 150, status: 'atrasado', paidCount: 1 })
  })

  it('quitado e pagamento acima do total não deixa saldo negativo', () => {
    const l = { ...loan, payments: [{ id: 'p', date: '2026-02-01', amount: 999 }] }
    expect(summarize(l, '2026-05-01')).toMatchObject({ open: 0, paid: 300, status: 'quitado' })
  })

  it('renegociação mantém o que foi pago e refaz só o saldo', () => {
    const l = { ...loan, payments: [{ id: 'p', date: '2026-02-01', amount: 150 }] }
    const r = renegotiate(l, { rate: 0.1, mode: 'simples', frequency: 'mensal', count: 2, firstDue: '2026-05-01' })
    expect(r.renegotiated).toBe(true)
    expect(sum(r.schedule.slice(0, 2))).toBe(150)
    expect(sum(r.schedule.slice(2))).toBe(Math.round(150 * 1.2 * 100) / 100)
    expect(summarize(r, '2026-04-01').paid).toBe(150)
  })

  it('multa e juros por atraso respeitam a tolerância', () => {
    const inst = { remaining: 100, due: '2026-01-01', status: 'atrasada' as const }
    expect(lateCharges(inst, { fee: 0.02, daily: 0.01, grace: 3 }, '2026-01-03').total).toBe(0)
    expect(lateCharges(inst, { fee: 0.02, daily: 0.01, grace: 3 }, '2026-01-11')).toMatchObject({ days: 10, fee: 2, interest: 10, total: 12 })
    expect(lateCharges({ ...inst, status: 'pendente' }, { fee: 0.02, daily: 0.01, grace: 0 }, '2026-01-11').total).toBe(0)
  })
})

describe('dados da versão de empréstimos', () => {
  it('contratos viram dívidas a receber, com cliente, telefone e histórico', () => {
    const debts = legacyToDebts(
      [{ id: 'c1', name: 'Ana Souza', phone: '(11) 98765-4321', note: 'vizinha' }],
      [
        { id: 'k1', clientId: 'c1', kind: 'fiado', principal: 640, rate: 0, mode: 'simples', frequency: 'semanal', createdAt: '2026-01-01', schedule: [{ due: '2026-01-08', amount: 640 }], payments: [{ id: 'p', date: '2026-01-08', amount: 640 }] },
        { id: 'k2', clientId: 'sumiu', kind: 'emprestimo', principal: 100, rate: 0.05, mode: 'simples', frequency: 'mensal', createdAt: '2026-01-01', schedule: [], payments: [] },
      ],
    )
    expect(debts).toHaveLength(1)
    expect(debts[0]).toMatchObject({ id: 'k1', direction: 'receber', kind: 'acordo', person: 'Ana Souza', phone: '(11) 98765-4321', note: 'Fiado · vizinha', principal: 640 })
    expect(debts[0].payments).toHaveLength(1)
  })
})
