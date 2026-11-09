import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// o chat sem IA não fala com o servidor
vi.mock('./supabase', () => ({ supabase: { auth: { getSession: vi.fn() }, functions: { invoke: vi.fn() } } }))

import { emptyRecords, useData } from './store'
import { localTurn, undoMessage, useChat } from './assistant'

vi.useFakeTimers()
vi.setSystemTime(new Date(2026, 10, 3, 12))
afterAll(() => void vi.useRealTimers())

const REF = '2026-11-03'
const s = () => useData.getState()
const tx = (description: string, date: string) => s().transactions.find((t) => t.description === description && t.date === date)

/** Faz o que a tela do chat faz: a fala da pessoa, a resposta com o que mudou. */
function say(text: string, ref = REF) {
  const chat = useChat.getState()
  chat.add({ role: 'user', text })
  const r = localTurn(text, ref)
  return chat.add({ role: 'assistant', text: r.reply, created: r.created, ...(r.changes ? { changes: r.changes } : {}), ...(r.undid ? { undid: r.undid } : {}), ...(r.label ? { label: r.label } : {}) })
}

beforeEach(() => {
  useChat.getState().reset('teste')
  useData.setState({
    ...emptyRecords(),
    accounts: [
      { id: 'a', name: 'Nubank', kind: 'corrente', initial: 1000, color: '#000', createdAt: '2026-01-01' },
      { id: 'b', name: 'Itaú', kind: 'corrente', initial: 500, color: '#000', createdAt: '2026-01-01' },
    ],
    cards: [{ id: 'c', name: 'Roxinho', limit: 5000, closingDay: 3, dueDay: 10, accountId: 'a', color: '#000', createdAt: '2026-01-01' }],
  })
  s().setSettings({ defaultAccount: 'b' })
  // fixos: salário todo dia 5 e luz todo dia 17 (outubro já foi; novembro em diante, previstos)
  s().addTransaction({ type: 'receita', description: 'Salário', amount: 7400, date: '2026-10-05', status: 'pago', categoryId: 'cat-salario-mensal', accountId: 'b' }, { mode: 'fixa', frequency: 'mensal' })
  s().addTransaction({ type: 'despesa', description: 'Luz', amount: 180, date: '2026-10-17', status: 'pago', categoryId: 'cat-luz', accountId: 'b' }, { mode: 'fixa', frequency: 'mensal' })
})

describe('chat sem IA: dar baixa', () => {
  it('"caiu meu salário" dá baixa no salário previsto, sem lançar outro; desfazer volta como estava', () => {
    const before = s().transactions.length
    const m = say('caiu meu salário')
    expect(m.text).toContain('entrou')
    expect(m.label).toBe('Recebido')
    expect(s().transactions).toHaveLength(before)
    // caiu antes do dia 5: fica com a data de hoje
    const paid = s().transactions.find((t) => t.description === 'Salário' && t.date === REF)!
    expect(paid).toMatchObject({ status: 'pago', amount: 7400 })
    expect(m.created).toEqual([paid.id])
    undoMessage(m)
    expect(tx('Salário', '2026-11-05')).toMatchObject({ status: 'pendente' })
  })

  it('"paguei a luz 192,30": dá baixa com o valor que veio, só neste mês', () => {
    const m = say('paguei a luz 192,30')
    expect(m.label).toBe('Pago')
    expect(tx('Luz', REF)).toMatchObject({ status: 'pago', amount: 192.3 })
    expect(tx('Luz', '2026-12-17')).toMatchObject({ status: 'pendente', amount: 180 })
  })

  it('"foi 7.650" logo depois corrige o valor no próprio lançamento (continua sendo o fixo)', () => {
    say('caiu meu salário')
    const m = say('foi 7.650')
    const t = tx('Salário', REF)!
    expect(t).toMatchObject({ amount: 7650, status: 'pago' })
    expect(t.groupId).toBeTruthy()
    expect(m.text).toContain('7.650')
  })

  it('o salário deste mês já caiu: avisa em vez de lançar de novo', () => {
    say('caiu meu salário')
    const n = s().transactions.length
    const m = say('caiu meu salário')
    expect(m.text).toContain('já está como recebido')
    expect(s().transactions).toHaveLength(n)
  })

  it('no dia 21, o salário do mês que vem não é puxado para este mês', () => {
    s().setPaid(tx('Salário', '2026-11-05')!.id, true)
    const m = say('caiu meu salário', '2026-11-21')
    expect(m.text).toContain('já está como recebido')
    expect(tx('Salário', '2026-12-05')).toMatchObject({ status: 'pendente' })
  })

  it('sem nada previsto, lança igual à última vez; sem histórico, pede o valor', () => {
    useData.setState({ transactions: [], recurrences: [] })
    s().addTransaction({ type: 'receita', description: 'Freela', amount: 900, date: '2026-09-10', status: 'pago', accountId: 'a' })
    const m = say('caiu o freela')
    expect(m.text).toContain('mesmo valor')
    expect(s().transactions.filter((t) => t.description === 'Freela')).toHaveLength(2)
    expect(tx('Freela', REF)).toMatchObject({ amount: 900, accountId: 'a', status: 'pago' })
    expect(say('caiu o bônus').text).toContain('Não achei')
  })

  it('com valor e nada previsto, é um lançamento novo (como antes)', () => {
    const m = say('recebi 300 de reembolso')
    expect(m.text).toContain('Receita lançada')
  })
})

describe('chat sem IA: alterar, apagar, fatura e metas', () => {
  it('"a luz agora é 200" muda este mês e os próximos', () => {
    const m = say('a luz agora é 200')
    expect(m.label).toBe('Alterado')
    expect(tx('Luz', '2026-11-17')!.amount).toBe(200)
    expect(tx('Luz', '2026-12-17')!.amount).toBe(200)
    expect(tx('Luz', '2026-10-17')!.amount).toBe(180)
  })

  it('"muda a luz para 210" muda só este mês; nome que não existe avisa', () => {
    say('muda a luz para 210')
    expect(tx('Luz', '2026-11-17')!.amount).toBe(210)
    expect(tx('Luz', '2026-12-17')!.amount).toBe(180)
    expect(say('muda o aluguel para 1.900').text).toContain('Não achei')
  })

  it('"apaga o uber de ontem" apaga só aquele', () => {
    say('uber 23,50 ontem')
    say('uber 18 hoje')
    say('apaga o uber de ontem')
    const ubers = s().transactions.filter((t) => t.description.toLowerCase() === 'uber')
    expect(ubers).toHaveLength(1)
    expect(ubers[0].amount).toBe(18)
  })

  it('"paguei a fatura do roxinho" paga a fatura em aberto', () => {
    say('mercado 300 no cartão')
    expect(s().transactions.some((t) => t.cardId === 'c' && t.type === 'despesa')).toBe(true)
    const m = say('paguei a fatura do roxinho')
    expect(m.text).toContain('Pago')
    expect(s().transactions.some((t) => t.type === 'transferencia' && t.cardId === 'c' && t.amount === 300)).toBe(true)
  })

  it('"guardei 200 na viagem" guarda na meta', () => {
    s().addGoal({ name: 'Viagem', target: 5000, color: '#000', icon: 'cofrinho' })
    say('guardei 200 na viagem')
    expect(s().goals[0].contributions.reduce((n, c) => n + c.amount, 0)).toBe(200)
  })
})

describe('chat sem IA: perguntas', () => {
  it('"o salário já caiu?" e "o que falta pagar?"', () => {
    expect(say('o salário já caiu?').text).toContain('Ainda não')
    say('caiu meu salário')
    expect(say('o salário já caiu?').text).toContain('Já.')
    const falta = say('o que falta pagar?').text
    expect(falta).toContain('Falta pagar')
    expect(falta).toContain('Luz')
  })
})
