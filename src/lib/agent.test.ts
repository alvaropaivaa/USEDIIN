import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyRecords, useData } from './store'
import { runTool, type ToolContext } from './agent'
import { balances, goalStats, invoiceFor } from './ledger'

vi.useFakeTimers()
vi.setSystemTime(new Date(2026, 9, 21, 12))
afterAll(() => void vi.useRealTimers())

const REF = '2026-10-21'
const s = () => useData.getState()
const ctx: ToolContext = { ref: REF, undo: () => null }
// o real formatado vem com espaço não separável
const run = (name: string, input: unknown) => {
  const out = runTool(name, input, ctx)
  return { ...out, content: out.content.replace(/ /g, ' '), ...(out.say ? { say: out.say.replace(/ /g, ' ') } : {}) }
}
const tx = (id: string) => s().transactions.find((t) => t.id === id)!

beforeEach(() => {
  useData.setState({
    ...emptyRecords(),
    accounts: [
      { id: 'a', name: 'Nubank', kind: 'corrente', initial: 1000, color: '#000', createdAt: '2026-01-01' },
      { id: 'b', name: 'Itaú', kind: 'corrente', initial: 500, color: '#000', createdAt: '2026-01-01' },
    ],
    cards: [{ id: 'c', name: 'Roxinho', limit: 5000, closingDay: 3, dueDay: 10, accountId: 'a', color: '#000', createdAt: '2026-01-01' }],
  })
  s().setSettings({ defaultAccount: 'b', budgetTotal: 0 })
})

/** Lança pelo store e devolve o id (o que já existia antes da conversa). */
const add = (p: Parameters<ReturnType<typeof s>['addTransaction']>[0], repeat?: Parameters<ReturnType<typeof s>['addTransaction']>[1]) => s().addTransaction(p, repeat).id

describe('lançar', () => {
  it('usa a conta padrão, sugere a categoria e devolve o id para a IA', () => {
    const out = run('lancar', { itens: [{ tipo: 'receita', descricao: 'Salário', valor: 2000 }], encerrar: true })
    const t = s().transactions[0]
    expect(t).toMatchObject({ type: 'receita', amount: 2000, accountId: 'b', status: 'pago', date: REF, via: 'assistente' })
    expect(t.categoryId).toMatch(/^cat-salario/)
    expect(out).toMatchObject({ final: true })
    expect(out.content).toContain(`[${t.id}]`)
    // os cartões dos lançamentos já mostram: não precisa de texto para a pessoa
    expect(out.say).toBeUndefined()
  })

  it('parcelado no cartão e lançamento fixo', () => {
    run('lancar', { itens: [{ tipo: 'despesa', descricao: 'TV', valor: 3000, cartao_id: 'c', parcelas: 10 }], encerrar: true })
    expect(s().transactions.filter((t) => t.description === 'TV')).toHaveLength(10)
    run('lancar', { itens: [{ tipo: 'despesa', descricao: 'Aluguel', valor: 1500, repetir: 'mensal' }], encerrar: true })
    expect(s().recurrences).toHaveLength(1)
    expect(s().transactions.filter((t) => t.description === 'Aluguel').length).toBeGreaterThan(10)
  })

  it('id inexistente ou transferência sem destino não entram, e a IA fica sabendo', () => {
    const out = run('lancar', {
      itens: [
        { tipo: 'despesa', descricao: 'Uber', valor: 30, conta_id: 'nao-existe' },
        { tipo: 'transferencia', descricao: 'Reserva', valor: 100, conta_id: 'a' },
        { tipo: 'despesa', descricao: 'Pão', valor: 8 },
      ],
      encerrar: true,
    })
    expect(s().transactions.map((t) => t.description)).toEqual(['Pão'])
    expect(out.content).toContain('Não feito')
    // parte não saiu: volta para a IA explicar
    expect(out.final).toBe(false)
    expect(out.error).toBeUndefined()
  })
})

describe('corrigir e apagar', () => {
  it('"errei, foi 3 mil": muda o valor do salário que já existe', () => {
    const id = add({ type: 'receita', description: 'Salário', amount: 2000, date: REF, status: 'pago', accountId: 'b', categoryId: 'cat-salario' })
    const out = run('editar_lancamentos', { edicoes: [{ id, valor: 3000 }], encerrar: true })
    expect(s().transactions).toHaveLength(1)
    expect(tx(id).amount).toBe(3000)
    expect(out.final).toBe(true)
    expect(out.content).toContain('antes: valor R$')
  })

  it('null no que não muda não apaga nada; vazio tira a categoria', () => {
    const id = add({ type: 'despesa', description: 'Mercado', amount: 100, date: REF, status: 'pago', accountId: 'b', categoryId: 'cat-mercado' })
    run('editar_lancamentos', { edicoes: [{ id, valor: 120, categoria_id: null, observacao: null, data: null }], encerrar: true })
    expect(tx(id)).toMatchObject({ amount: 120, categoryId: 'cat-mercado', date: REF })
    run('editar_lancamentos', { edicoes: [{ id, categoria_id: '' }], encerrar: true })
    expect(tx(id).categoryId).toBeUndefined()
  })

  it('passa da conta para o cartão (fatura certa) e volta', () => {
    const id = add({ type: 'despesa', description: 'Mercado', amount: 100, date: REF, status: 'pago', accountId: 'b' })
    run('editar_lancamentos', { edicoes: [{ id, cartao_id: 'c' }], encerrar: true })
    expect(tx(id)).toMatchObject({ cardId: 'c', invoice: invoiceFor(s().cards[0], REF) })
    expect(tx(id).accountId).toBeUndefined()
    run('editar_lancamentos', { edicoes: [{ id, conta_id: 'a' }], encerrar: true })
    expect(tx(id)).toMatchObject({ accountId: 'a' })
    expect(tx(id).cardId).toBeUndefined()
  })

  it('marca como pago e troca entre despesa e receita', () => {
    const id = add({ type: 'despesa', description: 'Luz', amount: 180, date: '2026-10-25', status: 'pendente', accountId: 'b', categoryId: 'cat-energia' })
    run('editar_lancamentos', { edicoes: [{ id, pago: true }], encerrar: true })
    expect(tx(id).status).toBe('pago')
    run('editar_lancamentos', { edicoes: [{ id, tipo: 'receita' }], encerrar: true })
    expect(tx(id)).toMatchObject({ type: 'receita' })
    // a categoria era de despesa: sai
    expect(tx(id).categoryId).toBeUndefined()
  })

  it('parcelas: escopo all muda todas; erros voltam para a IA', () => {
    const first = add({ type: 'despesa', description: 'Curso', amount: 300, date: REF, status: 'pago', accountId: 'b' }, { mode: 'parcelada', count: 3 })
    run('editar_lancamentos', { edicoes: [{ id: first, escopo: 'all', descricao: 'Curso de inglês' }], encerrar: true })
    expect(s().transactions.every((t) => t.description === 'Curso de inglês')).toBe(true)
    const bad = run('editar_lancamentos', { edicoes: [{ id: 'x', valor: 10 }], encerrar: true })
    expect(bad).toMatchObject({ error: true, final: false })
    expect(run('editar_lancamentos', { edicoes: [{ id: first, valor: -5 }], encerrar: true }).error).toBe(true)
  })

  it('apaga um lançamento ou a série inteira', () => {
    const one = add({ type: 'despesa', description: 'Uber', amount: 20, date: REF, status: 'pago', accountId: 'b' })
    const first = add({ type: 'despesa', description: 'Curso', amount: 300, date: REF, status: 'pago', accountId: 'b' }, { mode: 'parcelada', count: 3 })
    const out = run('apagar_lancamentos', { itens: [{ id: one }, { id: first, escopo: 'all' }], encerrar: true })
    expect(s().transactions).toHaveLength(0)
    expect(out.say).toContain('Apagado: Uber')
    expect(out.say).toContain('3 lançamentos da série')
  })
})

describe('fatura, contas e saldo', () => {
  it('paga a fatura em aberto, limitada ao que falta', () => {
    add({ type: 'despesa', description: 'Compra', amount: 200, date: '2026-10-01', status: 'pago', cardId: 'c' })
    const out = run('pagar_fatura', { cartao_id: 'c', valor: 999, encerrar: true })
    const pay = s().transactions.find((t) => t.type === 'transferencia')!
    // sem conta: a conta do cartão
    expect(pay).toMatchObject({ cardId: 'c', amount: 200, accountId: 'a' })
    expect(out.content).toContain('ficou no que faltava')
    expect(run('pagar_fatura', { cartao_id: 'c', encerrar: true }).error).toBe(true)
  })

  it('cria conta reconhecendo o banco, define como padrão e ajusta o saldo', () => {
    const out = run('contas', { acao: 'criar', nome: 'Conta do Inter', saldo_inicial: 300, encerrar: false })
    const acc = s().accounts.find((a) => a.name === 'Conta do Inter')!
    expect(acc).toMatchObject({ kind: 'corrente', bank: '00416968', initial: 300 })
    expect(out.content).toContain(`[${acc.id}]`)
    expect(out.say).not.toContain(acc.id)
    run('contas', { acao: 'padrao', id: acc.id, encerrar: true })
    expect(s().settings.defaultAccount).toBe(acc.id)
    run('ajustar_saldo', { conta_id: 'a', saldo: 1234.5, encerrar: true })
    expect(balances(s().accounts, s().transactions, s().goals).get('a')).toBeCloseTo(1234.5, 2)
  })

  it('cartão precisa de limite e dos dias da fatura', () => {
    expect(run('cartoes', { acao: 'criar', nome: 'Nubank', encerrar: true }).error).toBe(true)
    run('cartoes', { acao: 'criar', nome: 'Nubank', limite: 2000, fechamento: 5, vencimento: 12, encerrar: true })
    expect(s().cards.find((c) => c.name === 'Nubank')).toMatchObject({ bank: '18236120', closingDay: 5, dueDay: 12 })
  })
})

describe('categorias, orçamento, metas e dívidas', () => {
  it('cria subcategoria (tipo e cor da principal) e apaga movendo os lançamentos', () => {
    run('categorias', { acao: 'criar', nome: 'Padaria', pai_id: 'cat-alimentacao', encerrar: true })
    const sub = s().categories.find((c) => c.name === 'Padaria')!
    expect(sub).toMatchObject({ type: 'despesa', parentId: 'cat-alimentacao' })
    const id = add({ type: 'despesa', description: 'Pão', amount: 8, date: REF, status: 'pago', accountId: 'b', categoryId: sub.id })
    run('categorias', { acao: 'apagar', id: sub.id, mover_para: 'cat-mercado', encerrar: true })
    expect(tx(id).categoryId).toBe('cat-mercado')
    expect(run('categorias', { acao: 'criar', nome: 'mercado', pai_id: 'cat-alimentacao', encerrar: true }).error).toBe(true)
  })

  it('limite da categoria e limite geral', () => {
    run('orcamento', { categoria_id: 'cat-mercado', valor: 800, encerrar: true })
    run('orcamento', { valor: 3000, encerrar: true })
    expect(s().categories.find((c) => c.id === 'cat-mercado')!.budget).toBe(800)
    expect(s().settings.budgetTotal).toBe(3000)
    expect(run('orcamento', { categoria_id: 'cat-salario', valor: 10, encerrar: true }).error).toBe(true)
  })

  it('meta: cria, guarda e não resgata mais do que tem', () => {
    run('metas', { acao: 'criar', nome: 'Viagem', valor_alvo: 5000, valor: 200, encerrar: false })
    const g = s().goals[0]
    run('metas', { acao: 'guardar', id: g.id, valor: 300, conta_id: 'a', encerrar: true })
    expect(goalStats(s().goals[0], REF).saved).toBe(500)
    expect(run('metas', { acao: 'resgatar', id: g.id, valor: 900, encerrar: true }).error).toBe(true)
  })

  it('dívida: cria com juros e registra pagamento', () => {
    const out = run('dividas', { acao: 'criar', direcao: 'pagar', pessoa: 'Banco X', valor: 1000, juros: 2, parcelas: 4, conta_id: 'a', registrar_dinheiro: true, encerrar: false })
    const d = s().debts[0]
    expect(d).toMatchObject({ direction: 'pagar', person: 'Banco X', rate: 0.02, principal: 1000 })
    expect(d.schedule).toHaveLength(4)
    expect(s().transactions.some((t) => t.debtId === d.id && t.type === 'receita')).toBe(true)
    expect(out.content).toContain(`[${d.id}]`)
    run('dividas', { acao: 'pagar', id: d.id, valor: 270, encerrar: true })
    expect(s().debts[0].payments).toHaveLength(1)
  })
})

describe('consultas e regras do agente', () => {
  it('buscar devolve ids, soma e respeita os filtros', () => {
    add({ type: 'despesa', description: 'iFood', amount: 40, date: '2026-10-10', status: 'pago', accountId: 'b', categoryId: 'cat-delivery' })
    add({ type: 'despesa', description: 'iFood', amount: 60, date: '2026-09-10', status: 'pago', accountId: 'b', categoryId: 'cat-delivery' })
    add({ type: 'receita', description: 'Salário', amount: 2000, date: '2026-10-05', status: 'pago', accountId: 'b' })
    const out = run('buscar_lancamentos', { texto: 'ifood', de: '2026-10-01' })
    expect(out.content).toContain('1 encontrado')
    expect(out.content).toContain('despesas R$ 40,00')
    expect(out).toMatchObject({ final: false })
    expect(run('buscar_lancamentos', { categoria_id: 'cat-alimentacao' }).content).toContain('2 encontrado')
    expect(run('buscar_lancamentos', { de: '10/10/2026' }).error).toBe(true)
  })

  it('resumo do período: totais, categorias e meses', () => {
    add({ type: 'despesa', description: 'Mercado', amount: 300, date: '2026-09-10', status: 'pago', accountId: 'b', categoryId: 'cat-mercado' })
    add({ type: 'receita', description: 'Salário', amount: 2000, date: '2026-10-05', status: 'pago', accountId: 'b', categoryId: 'cat-salario' })
    const out = run('resumo', { de: '2026-09-01', ate: '2026-10-31' }).content
    expect(out).toContain('Receitas R$ 2.000,00')
    expect(out).toContain('Alimentação R$ 300,00 (Mercado R$ 300,00)')
    expect(out).toContain('2026-09: receitas R$ 0,00, despesas R$ 300,00')
  })

  it('sem "encerrar", ou com ferramenta desconhecida, a IA continua', () => {
    expect(run('lancar', { itens: [{ tipo: 'despesa', descricao: 'Pão', valor: 8 }] }).final).toBe(false)
    expect(run('voar', {})).toMatchObject({ error: true, final: false })
  })

  it('desfazer chama quem cuida da conversa', () => {
    const undo = vi.fn(() => '1 lançamento')
    const out = runTool('desfazer', { encerrar: true }, { ref: REF, undo })
    expect(undo).toHaveBeenCalled()
    expect(out).toMatchObject({ final: true, say: 'Desfeito: 1 lançamento' })
  })
})
