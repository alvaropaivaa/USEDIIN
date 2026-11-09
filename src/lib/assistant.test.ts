import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// o servidor é de mentira: cada teste diz o que a IA responde
const sb = vi.hoisted(() => ({ auth: { getSession: vi.fn() }, functions: { invoke: vi.fn() } }))
vi.mock('./supabase', () => ({ supabase: sb }))

import { emptyRecords, useData } from './store'
import { applyOps, applyTracked, askAgent, buildContext, localReply, undoMessage, useChat } from './assistant'
import type { AgentStep, AssistantContext, AssistantTx, HistoryTurn } from './assistantContract'

// a validação do servidor (Deno): caminho em variável para o tsc do app não exigir o .ts no import
const serverContext = '../../supabase/functions/_shared/assistente/context.ts'
const { sanitizeContext } = (await import(/* @vite-ignore */ serverContext)) as { sanitizeContext: (raw: unknown) => AssistantContext | null }
import { invoiceFor } from './ledger'
import { shiftMonth } from './dates'

vi.useFakeTimers()
vi.setSystemTime(new Date(2026, 9, 21, 12))
afterAll(() => void vi.useRealTimers())

const s = () => useData.getState()
const item = (p: Partial<AssistantTx>): AssistantTx => ({
  type: 'despesa',
  description: 'Mercado',
  amount: 100,
  date: '2026-10-21',
  categoryId: null,
  accountId: null,
  toAccountId: null,
  cardId: null,
  installments: 1,
  paid: true,
  note: null,
  ...p,
})

/** Faz o que a tela do chat faz: aplica e guarda a resposta com o que ela criou. */
function reply(ops: Parameters<typeof applyOps>[0]) {
  const r = applyOps(ops)
  useChat.getState().add({ role: 'assistant', text: 'ok', created: r.created, before: r.before })
  return r
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
})

describe('contexto do assistente', () => {
  it('o servidor aceita o resumo que o app manda, sem perder contas, cartões nem categorias', () => {
    s().loadDemo()
    const ctx = buildContext('2026-10-21')
    const clean = sanitizeContext(JSON.parse(JSON.stringify(ctx)))
    expect(clean).not.toBeNull()
    expect(clean!.accounts.map((a) => a.id)).toEqual(ctx.accounts.map((a) => a.id))
    expect(clean!.cards.map((c) => c.id)).toEqual(ctx.cards.map((c) => c.id))
    expect(clean!.categories.length).toBe(ctx.categories.length)
    expect(clean!.month?.expense).toBeCloseTo(ctx.month!.expense, 2)
    expect(clean!.invoices?.length).toBe(ctx.invoices?.length)
  })

  it('lastCreated traz a última resposta, com as parcelas juntas', () => {
    reply({ create: [item({ cardId: 'c', amount: 300, installments: 3 })], undo: false, correct: null })
    const [last] = buildContext('2026-10-21').lastCreated!
    expect(last).toMatchObject({ amount: 300, installments: 3, cardId: 'c' })
  })
})

describe('aplicar o que o assistente entendeu', () => {
  it('sem conta usa a padrão, sem categoria usa a sugestão e marca como do assistente', () => {
    const { created } = reply({ create: [item({ description: 'Supermercado do bairro' })], undo: false, correct: null })
    const t = s().transactions.find((x) => x.id === created[0])!
    expect(t).toMatchObject({ accountId: 'b', status: 'pago', via: 'assistente' })
    expect(t.categoryId).toBeTruthy()
  })

  it('compra parcelada no cartão: uma fatura por parcela', () => {
    const { created } = reply({ create: [item({ cardId: 'c', amount: 300, installments: 3 })], undo: false, correct: null })
    const list = s()
      .transactions.filter((t) => created.includes(t.id))
      .sort((a, b) => a.installment!.n - b.installment!.n)
    expect(list).toHaveLength(3)
    const first = invoiceFor(s().cards[0], '2026-10-21')
    expect(list.map((t) => t.invoice)).toEqual([first, shiftMonth(first, 1), shiftMonth(first, 2)])
    expect(list.reduce((x, t) => x + t.amount, 0)).toBeCloseTo(300, 2)
  })

  it('data futura fica a pagar mesmo se vier como paga', () => {
    const { created } = reply({ create: [item({ date: '2026-11-05', paid: true })], undo: false, correct: null })
    expect(s().transactions.find((t) => t.id === created[0])!.status).toBe('pendente')
  })

  it('transferência sem destino (ou para a mesma conta) não entra', () => {
    const { created } = reply({ create: [item({ type: 'transferencia', accountId: 'a', toAccountId: 'a' }), item({ type: 'transferencia', accountId: 'a' })], undo: false, correct: null })
    expect(created).toHaveLength(0)
  })

  it('pagar a fatura: pagamento preso à fatura e limitado ao que está em aberto', () => {
    s().addTransaction({ type: 'despesa', description: 'Compra', amount: 200, date: '2026-10-01', status: 'pago', cardId: 'c' })
    const { created } = reply({ create: [item({ type: 'transferencia', cardId: 'c', accountId: 'a', amount: 999 })], undo: false, correct: null })
    const pay = s().transactions.find((t) => t.id === created[0])!
    expect(pay).toMatchObject({ type: 'transferencia', cardId: 'c', amount: 200, description: 'Fatura Roxinho', via: 'assistente' })
  })

  it('desfazer apaga o que a última resposta lançou (todas as parcelas)', () => {
    reply({ create: [item({ description: 'Uber' })], undo: false, correct: null })
    reply({ create: [item({ cardId: 'c', amount: 300, installments: 3 })], undo: false, correct: null })
    reply({ create: [], undo: true, correct: null })
    expect(s().transactions.map((t) => t.description)).toEqual(['Uber'])
  })

  it('corrigir o valor refaz as parcelas com o total novo; desfazer volta como estava', () => {
    const first = reply({ create: [item({ cardId: 'c', amount: 300, installments: 3 })], undo: false, correct: null })
    reply({ create: [], undo: false, correct: { amount: 450 } })
    const now = s().transactions
    expect(now).toHaveLength(3)
    expect(now.reduce((x, t) => x + t.amount, 0)).toBeCloseTo(450, 2)
    // desfazer a correção traz de volta as parcelas de antes
    const fix = useChat.getState().messages.at(-1)!
    undoMessage(fix)
    expect(
      s()
        .transactions.map((t) => t.id)
        .sort(),
    ).toEqual([...first.created].sort())
    expect(s().transactions.reduce((x, t) => x + t.amount, 0)).toBeCloseTo(300, 2)
  })

  it('corrigir a conta e a categoria do último lançamento', () => {
    reply({ create: [item({ accountId: 'a' })], undo: false, correct: null })
    reply({ create: [], undo: false, correct: { accountId: 'b', description: 'Feira' } })
    expect(s().transactions).toHaveLength(1)
    expect(s().transactions[0]).toMatchObject({ accountId: 'b', description: 'Feira' })
  })

  it('com vários itens, a correção não mexe no valor', () => {
    reply({ create: [item({ description: 'A', amount: 10 }), item({ description: 'B', amount: 20 })], undo: false, correct: null })
    reply({ create: [], undo: false, correct: { amount: 99, date: '2026-10-20' } })
    expect(s().transactions.map((t) => [t.amount, t.date]).sort()).toEqual([
      [10, '2026-10-20'],
      [20, '2026-10-20'],
    ])
  })
})

describe('modo simples', () => {
  it('lança texto curto e entende "desfazer"', () => {
    const r = localReply('uber 23,50', '2026-10-21')
    expect(r.ops.create[0]).toMatchObject({ type: 'despesa', amount: 23.5, installments: 1 })
    reply(r.ops)
    expect(s().transactions).toHaveLength(1)
    reply(localReply('desfazer', '2026-10-21').ops)
    expect(s().transactions).toHaveLength(0)
  })

  it('responde saldo com as contas do app', () => {
    const r = localReply('qual meu saldo?', '2026-10-21')
    expect(r.ops.create).toHaveLength(0)
    expect(r.reply).toContain('1.500,00')
  })
})

describe('modo simples: correções', () => {
  it('entende a correção do último lançamento, mas não confunde com um gasto novo', () => {
    reply(localReply('recebi 2 mil de salário', '2026-10-21').ops)
    expect(localReply('errei foi 3 mil', '2026-10-21').ops.correct).toEqual({ amount: 3000 })
    expect(localReply('meu salario que caiu foi 3500', '2026-10-21').ops.correct).toEqual({ amount: 3500 })
    expect(localReply('na verdade era 2.500,00', '2026-10-21').ops.correct).toEqual({ amount: 2500 })
    // sem palavra de correção e sem citar o lançamento: é um gasto novo
    expect(localReply('uber foi 30', '2026-10-21').ops.create).toHaveLength(1)
    reply(localReply('errei foi 3 mil', '2026-10-21').ops)
    expect(s().transactions).toHaveLength(1)
    expect(s().transactions[0]).toMatchObject({ amount: 3000, type: 'receita' })
  })

  it('guarda o que mudou: desfazer a correção volta o valor de antes', () => {
    const a = applyTracked(localReply('recebi 2 mil de salário', '2026-10-21').ops)
    useChat.getState().add({ role: 'assistant', text: 'ok', created: a.created, changes: a.changes! })
    const b = applyTracked(localReply('errei foi 3 mil', '2026-10-21').ops)
    const msg = useChat.getState().add({ role: 'assistant', text: 'ok', created: b.created, changes: b.changes! })
    expect(s().transactions[0].amount).toBe(3000)
    undoMessage(msg)
    expect(s().transactions).toHaveLength(1)
    expect(s().transactions[0].amount).toBe(2000)
  })
})

describe('agente (servidor de mentira)', () => {
  const calls: Record<string, unknown>[] = []
  const use = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input })
  /** O servidor responde estas voltas da IA, em ordem. */
  const server = (...turns: { content: unknown[]; stop: string; transcript?: string }[]) => {
    calls.length = 0
    sb.functions.invoke.mockImplementation(async (_name: string, { body }: { body: Record<string, unknown> }) => {
      calls.push(JSON.parse(JSON.stringify(body)))
      return { data: turns[calls.length - 1], error: null }
    })
  }
  /** Faz o que a tela faz: manda a mensagem e guarda a resposta com o que ela mudou. */
  async function ask(text: string) {
    const chat = useChat.getState()
    const user = chat.add({ role: 'user', text })
    const r = await askAgent({ text }, { skip: user.id })
    if (!r.ok) throw new Error(r.message)
    chat.add({ role: 'assistant', text: r.reply, created: r.created, ...(r.changes ? { changes: r.changes } : {}), ...(r.undid ? { undid: r.undid } : {}) })
    return r
  }

  beforeEach(() => {
    sb.auth.getSession.mockResolvedValue({ data: { session: { access_token: 't' } } })
    sb.functions.invoke.mockReset()
  })

  it('sem conta na nuvem fica no modo simples', async () => {
    sb.auth.getSession.mockResolvedValue({ data: { session: null } })
    expect(await askAgent({ text: 'oi' })).toMatchObject({ ok: false, reason: 'local' })
  })

  it('"errei, foi 3 mil": a IA vê o salário da última resposta, corrige numa chamada só e dá para desfazer', async () => {
    server({ content: [use('t1', 'lancar', { itens: [{ tipo: 'receita', descricao: 'Salário', valor: 2000 }], encerrar: true })], stop: 'tool_use' })
    await ask('recebi 2 mil de salário')
    const id = s().transactions[0].id
    server({ content: [use('t2', 'editar_lancamentos', { edicoes: [{ id, valor: 3000 }], encerrar: true })], stop: 'tool_use' })
    const r = await ask('errei foi 3 mil')
    const ctx = calls[0].context as AssistantContext
    expect(ctx.recent?.find((t) => t.id === id)).toMatchObject({ last: true, amount: 2000 })
    expect(ctx).not.toHaveProperty('lastCreated')
    // a mensagem que está indo não entra no histórico (ela vai como a mensagem)
    expect((calls[0].history as HistoryTurn[]).map((h) => h.text)).toEqual(['recebi 2 mil de salário', 'Pronto, lancei.'])
    expect(calls).toHaveLength(1)
    expect(s().transactions).toHaveLength(1)
    expect(s().transactions[0].amount).toBe(3000)
    expect(r).toMatchObject({ reply: 'Pronto, corrigi.', created: [id] })
    undoMessage(useChat.getState().messages.at(-1)!)
    expect(s().transactions[0].amount).toBe(2000)
  })

  it('consulta e responde: devolve os resultados com o mesmo começo de conversa', async () => {
    s().addTransaction({ type: 'despesa', description: 'iFood', amount: 40, date: '2026-10-10', status: 'pago', accountId: 'b' })
    server(
      { content: [{ type: 'thinking', thinking: '', signature: 'sig' }, use('t1', 'buscar_lancamentos', { texto: 'ifood' })], stop: 'tool_use' },
      { content: [{ type: 'text', text: 'Você gastou R$ 40,00 com iFood.' }], stop: 'end_turn' },
    )
    const r = await ask('quanto gastei de ifood?')
    expect(r).toMatchObject({ reply: 'Você gastou R$ 40,00 com iFood.', changes: null })
    expect(calls).toHaveLength(2)
    expect(calls[1].context).toEqual(calls[0].context)
    expect(calls[1].history).toEqual(calls[0].history)
    const [step] = calls[1].steps as AgentStep[]
    // os blocos voltam como vieram (a assinatura do raciocínio junto)
    expect(step.content[0]).toEqual({ type: 'thinking', thinking: '', signature: 'sig' })
    expect(step.results[0]).toMatchObject({ id: 't1' })
    expect(step.results[0].content).toContain('1 encontrado')
  })

  it('áudio: transcreve uma vez; as voltas seguintes mandam a transcrição', async () => {
    server(
      { content: [use('t1', 'resumo', { de: '2026-10-01', ate: '2026-10-31' })], stop: 'tool_use', transcript: 'quanto gastei' },
      { content: [{ type: 'text', text: 'Nada ainda.' }], stop: 'end_turn' },
    )
    const r = await askAgent({ audio: { base64: 'AAAA', mime: 'audio/webm' } })
    expect(r).toMatchObject({ ok: true, transcript: 'quanto gastei', reply: 'Nada ainda.' })
    expect(calls[0].audio).toBeTruthy()
    expect(calls[1].audio).toBeUndefined()
    expect(calls[1].transcript).toBe('quanto gastei')
  })

  it('desfazer pela conversa, e desfazer o desfazer', async () => {
    server({ content: [use('t1', 'metas', { acao: 'criar', nome: 'Viagem', valor_alvo: 5000, encerrar: true })], stop: 'tool_use' })
    const made = await ask('cria uma meta de viagem de 5 mil')
    expect(s().goals).toHaveLength(1)
    expect(made.reply).toContain('Meta criada: Viagem')
    server({ content: [use('t2', 'desfazer', { encerrar: true })], stop: 'tool_use' })
    await ask('desfaz')
    expect(s().goals).toHaveLength(0)
    const [meta, undo] = useChat.getState().messages.filter((m) => m.role === 'assistant')
    expect(meta.undone).toBe(true)
    expect(undo.undid).toBe(meta.id)
    undoMessage(undo)
    expect(s().goals).toHaveLength(1)
    expect(useChat.getState().messages.find((m) => m.id === meta.id)!.undone).toBe(false)
  })

  it('o servidor cai no meio: o que já foi feito fica e a resposta avisa', async () => {
    let n = 0
    sb.functions.invoke.mockImplementation(async () =>
      ++n === 1
        ? { data: { content: [use('t1', 'lancar', { itens: [{ tipo: 'despesa', descricao: 'Pão', valor: 8 }], encerrar: false })], stop: 'tool_use' }, error: null }
        : { data: null, error: new Error('rede') },
    )
    const r = await askAgent({ text: 'pão 8 e me diz o saldo' })
    expect(s().transactions).toHaveLength(1)
    expect(r).toMatchObject({ ok: true })
    if (r.ok) {
      expect(r.reply).toContain('Fiz uma parte')
      expect(r.changes?.added.transactions).toHaveLength(1)
    }
  })

  it('para depois do limite de voltas', async () => {
    let n = 0
    sb.functions.invoke.mockImplementation(async () => ({ data: { content: [use(`t${++n}`, 'buscar_lancamentos', {})], stop: 'tool_use' }, error: null }))
    const r = await askAgent({ text: 'procura tudo' })
    expect(r).toMatchObject({ ok: true })
    if (r.ok) expect(r.reply).toContain('comprida demais')
    expect(sb.functions.invoke).toHaveBeenCalledTimes(9)
  })
})
