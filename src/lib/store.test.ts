import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyRecords, useData, withDefaults, type TxInput } from './store'
import { DEBT_EXPENSE } from './categories'
import { balances, horizon } from './ledger'
import { summarize } from './loans'

vi.useFakeTimers()
vi.setSystemTime(new Date(2026, 9, 21, 12))
afterAll(() => void vi.useRealTimers())

const s = () => useData.getState()
const base: TxInput = { type: 'despesa', description: 'Teste', amount: 100, date: '2026-10-21', status: 'pago', accountId: 'a' }

beforeEach(() => {
  useData.setState({
    ...emptyRecords(),
    accounts: [{ id: 'a', name: 'Conta', kind: 'corrente', initial: 1000, color: '#000', createdAt: '2026-01-01' }],
    cards: [{ id: 'c', name: 'Cartão', limit: 5000, closingDay: 3, dueDay: 10, accountId: 'a', color: '#000', createdAt: '2026-01-01' }],
  })
})

describe('lançamentos', () => {
  it('parcelado na conta: datas mês a mês, só a 1ª paga, total exato', () => {
    s().addTransaction({ ...base, amount: 1000, date: '2027-01-31' }, { mode: 'parcelada', count: 3 })
    const list = s().transactions.slice().sort((a, b) => a.installment!.n - b.installment!.n)
    expect(list.map((t) => t.date)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31'])
    expect(list.map((t) => t.status)).toEqual(['pago', 'pendente', 'pendente'])
    expect(list.reduce((x, t) => x + t.amount, 0)).toBeCloseTo(1000, 2)
    expect(new Set(list.map((t) => t.groupId)).size).toBe(1)
  })

  it('parcelado antigo: parcelas já vencidas ficam como a primeira', () => {
    s().addTransaction({ ...base, amount: 300, date: '2026-08-21' }, { mode: 'parcelada', count: 4 })
    const list = s().transactions.slice().sort((a, b) => a.installment!.n - b.installment!.n)
    expect(list.map((t) => [t.date, t.status])).toEqual([
      ['2026-08-21', 'pago'],
      ['2026-09-21', 'pago'],
      ['2026-10-21', 'pago'],
      ['2026-11-21', 'pendente'],
    ])
  })

  it('parcelado no cartão: mesma data da compra e uma fatura por mês', () => {
    s().addTransaction({ ...base, amount: 300, cardId: 'c', accountId: undefined, date: '2026-10-21' }, { mode: 'parcelada', count: 3 })
    const list = s().transactions.slice().sort((a, b) => a.installment!.n - b.installment!.n)
    expect(list.map((t) => t.invoice)).toEqual(['2026-11', '2026-12', '2027-01'])
    expect(list.every((t) => t.date === '2026-10-21' && t.status === 'pago')).toBe(true)
  })

  it('fixo: gera 12 meses com ids estáveis e não duplica ao completar de novo', () => {
    s().addTransaction({ ...base, description: 'Aluguel', date: '2026-10-10' }, { mode: 'fixa', frequency: 'mensal' })
    const n = s().transactions.length
    expect(n).toBe(13)
    expect(s().transactions.every((t) => t.id === `${t.groupId}:${t.date}`)).toBe(true)
    expect(s().transactions.filter((t) => t.status === 'pago').map((t) => t.date)).toEqual(['2026-10-10'])
    expect(s().recurrences[0].generated <= horizon()).toBe(true)
    s().ensureRecurring()
    expect(s().transactions).toHaveLength(n)
  })

  it('editar "este e os próximos" muda as repetições futuras e o modelo do fixo', () => {
    s().addTransaction({ ...base, description: 'Internet', date: '2026-10-15' }, { mode: 'fixa', frequency: 'mensal' })
    const dec = s().transactions.find((t) => t.date === '2026-12-15')!
    s().updateTransaction(dec.id, { amount: 150 }, 'next')
    const by = (d: string) => s().transactions.find((t) => t.date === d)!.amount
    expect(by('2026-11-15')).toBe(100)
    expect(by('2026-12-15')).toBe(150)
    expect(by('2027-01-15')).toBe(150)
    expect(s().recurrences[0].template.amount).toBe(150)
    s().updateTransaction(dec.id, { description: 'Fibra' }, 'all')
    expect(s().transactions.every((t) => t.description === 'Fibra')).toBe(true)
  })

  it('excluir "este e os próximos" encerra a repetição; "toda a série" apaga tudo', () => {
    s().addTransaction({ ...base, date: '2026-10-15' }, { mode: 'fixa', frequency: 'mensal' })
    const jan = s().transactions.find((t) => t.date === '2027-01-15')!
    s().removeTransaction(jan.id, 'next')
    expect(s().transactions.map((t) => t.date).sort()).toEqual(['2026-10-15', '2026-11-15', '2026-12-15'])
    expect(s().recurrences[0].until).toBe('2027-01-14')
    s().ensureRecurring()
    expect(s().transactions).toHaveLength(3)
    s().removeTransaction(s().transactions[0].id, 'all')
    expect(s().transactions).toHaveLength(0)
    expect(s().recurrences).toHaveLength(0)
  })

  it('trocar despesa da conta para o cartão calcula a fatura e marca como paga', () => {
    const t = s().addTransaction({ ...base, status: 'pendente', date: '2026-10-21' })
    s().updateTransaction(t.id, { cardId: 'c' })
    expect(s().transactions[0]).toMatchObject({ cardId: 'c', invoice: '2026-11', status: 'pago' })
    s().updateTransaction(t.id, { cardId: undefined, type: 'receita' })
    expect(s().transactions[0].invoice).toBeUndefined()
  })
})

describe('contas, cartões e categorias', () => {
  it('ajuste de saldo leva a conta exatamente ao valor pedido', () => {
    const bal = () => balances(s().accounts, s().transactions, s().goals).get('a')!
    s().adjustBalance('a', bal(), 750)
    expect(bal()).toBe(750)
    s().adjustBalance('a', bal(), 1200.5)
    expect(bal()).toBe(1200.5)
  })

  it('pagar e reabrir fatura', () => {
    s().addTransaction({ ...base, cardId: 'c', accountId: undefined, amount: 250, date: '2026-10-21' })
    s().payInvoice('c', '2026-11', 'a', 250, '2026-11-10')
    expect(balances(s().accounts, s().transactions, s().goals).get('a')).toBe(750)
    s().reopenInvoice('c', '2026-11')
    expect(s().transactions.filter((t) => t.type === 'transferencia')).toHaveLength(0)
  })

  it('conta com lançamentos é arquivada; sem lançamentos, apagada', () => {
    s().addAccount({ name: 'Vazia', kind: 'carteira', initial: 0, color: '#000' })
    const empty = s().accounts.find((a) => a.name === 'Vazia')!
    expect(s().removeAccount(empty.id)).toBe('removida')
    s().addTransaction(base)
    expect(s().removeAccount('a')).toBe('arquivada')
    expect(s().accounts[0].archived).toBe(true)
  })

  it('excluir categoria leva junto as subcategorias e move os lançamentos', () => {
    s().addTransaction({ ...base, categoryId: 'cat-mercado' })
    s().removeCategory('cat-alimentacao', 'cat-outras-despesas')
    expect(s().categories.some((c) => c.id === 'cat-mercado' || c.id === 'cat-alimentacao')).toBe(false)
    expect(s().transactions[0].categoryId).toBe('cat-outras-despesas')
  })
})

describe('dívidas', () => {
  const debt = () =>
    s().addDebt({ direction: 'pagar', kind: 'emprestimo', person: 'Banco', accountId: 'a', principal: 300, rate: 0, mode: 'simples', frequency: 'mensal', count: 3, firstDue: '2026-11-01', register: true })

  it('registrar com entrada lança a receita; pagar parcela vira despesa na categoria de dívidas', () => {
    const d = debt()
    expect(s().transactions.find((t) => t.debtId === d.id && t.type === 'receita')?.amount).toBe(300)
    s().payDebt(d.id, 100, 5, '2026-11-01')
    const pay = s().transactions.find((t) => t.paymentId)!
    expect(pay).toMatchObject({ type: 'despesa', amount: 105, categoryId: DEBT_EXPENSE, accountId: 'a' })
    expect(summarize(s().debts[0], '2026-11-02').paidCount).toBe(1)
  })

  it('apagar o lançamento do pagamento desfaz o pagamento na dívida (e vice-versa)', () => {
    const d = debt()
    s().payDebt(d.id, 100)
    const pay = s().transactions.find((t) => t.paymentId)!
    s().removeTransaction(pay.id)
    expect(s().debts[0].payments).toHaveLength(0)
    s().payDebt(d.id, 100)
    s().undoDebtPayment(d.id, s().debts[0].payments[0].id)
    expect(s().transactions.some((t) => t.paymentId)).toBe(false)
  })

  it('o lançamento de um pagamento só muda pela dívida (valor, data e situação)', () => {
    const d = debt()
    s().payDebt(d.id, 100, 0, '2026-11-01')
    const pay = s().transactions.find((t) => t.paymentId)!
    s().setPaid(pay.id, false)
    s().updateTransaction(pay.id, { amount: 1, date: '2027-01-01', description: 'Parcela do carro' })
    expect(s().transactions.find((t) => t.id === pay.id)).toMatchObject({ status: 'pago', amount: 100, date: '2026-11-01', description: 'Parcela do carro' })
  })

  it('excluir a dívida apaga os lançamentos ligados a ela', () => {
    const d = debt()
    s().payDebt(d.id, 100)
    s().removeDebt(d.id)
    expect(s().transactions.some((t) => t.debtId === d.id)).toBe(false)
  })
})

describe('ajustes e backup', () => {
  it('ajustes antigos ganham os padrões novos e perdem as opções que não existem mais', () => {
    const st = withDefaults({ owner: 'Ana', business: 'Loja', collectors: [], alerts: { hoje: false } } as never)
    expect(st.owner).toBe('Ana')
    expect('business' in st).toBe(false)
    expect('collectors' in st).toBe(false)
    expect(st.alerts.hoje).toBe(false)
    expect(st.alerts.faturas).toBe(true)
    expect(st.budgetAlert).toBe(0.8)
  })

  it('exportar e importar devolve os mesmos dados, sem o PIN', () => {
    s().addTransaction(base)
    s().setSettings({ pinHash: 'segredo', owner: 'Ana' })
    const b = s().exportBackup()
    expect('pinHash' in b.settings).toBe(false)
    useData.setState({ ...emptyRecords() })
    s().importBackup(b)
    expect(s().transactions).toHaveLength(1)
    expect(s().accounts[0].id).toBe('a')
    expect(s().settings).toMatchObject({ owner: 'Ana', pinHash: 'segredo' })
  })
})
