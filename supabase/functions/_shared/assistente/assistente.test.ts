import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MODEL, REPLIES, SCHEMA, SYSTEM, interpret, parseResponse, requestParams, type ClaudeLike } from './brain.ts'
import { contextText, sanitizeContext } from './context.ts'
import { hasAccess, todayIn } from './access.ts'
import { base64Size, fromBase64, toBase64, transcribe } from './transcribe.ts'
import type { AssistantContext, AssistantTx, InterpretRequest } from './types.ts'

const TODAY = '2026-10-21'

const context = (p: Partial<AssistantContext> = {}): AssistantContext => ({
  today: TODAY,
  name: 'Marina',
  categories: [
    { id: 'cat-alimentacao', name: 'Alimentação', type: 'despesa', parentId: null },
    { id: 'cat-mercado', name: 'Mercado', type: 'despesa', parentId: 'cat-alimentacao' },
    { id: 'cat-salario', name: 'Salário', type: 'receita', parentId: null },
  ],
  accounts: [
    { id: 'a1', name: 'Nubank', kind: 'corrente', balance: 1200 },
    { id: 'a2', name: 'Carteira', kind: 'carteira', balance: 80 },
  ],
  cards: [{ id: 'c1', name: 'Nubank', closingDay: 3, dueDay: 10, limit: 5000, available: 4600 }],
  defaultAccount: 'a1',
  ...p,
})

const tx = (p: Partial<AssistantTx> = {}): AssistantTx => ({
  type: 'despesa',
  description: 'Mercado',
  amount: 230,
  date: TODAY,
  categoryId: 'cat-mercado',
  accountId: 'a1',
  toAccountId: null,
  cardId: null,
  installments: 1,
  paid: true,
  note: null,
  ...p,
})

const raw = (p: Record<string, unknown>) => JSON.stringify({ create: [], undo: false, correct: null, reply: '', ...p })
const parse = (p: Record<string, unknown>, c = context()) => parseResponse(raw(p), { context: c })!

describe('resposta da IA conferida contra o contexto', () => {
  it('JSON fora do formato não vira resposta', () => {
    expect(parseResponse('{oops', { context: context() })).toBeNull()
    expect(parseResponse('[]', { context: context() })).toBeNull()
    expect(parseResponse('', { context: context() })).toBeNull()
  })

  it('lançamento válido passa como veio', () => {
    const r = parse({ create: [tx({ note: '  dividido com a Ana  ' })], reply: '  ' })
    expect(r).toEqual({ reply: '', ops: { create: [tx({ note: 'dividido com a Ana' })], undo: false, correct: null } })
  })

  it('ids que não existem viram null; receita não vai para cartão nem categoria de despesa', () => {
    const r = parse({
      create: [
        tx({ categoryId: 'cat-inventada', accountId: 'zzz' }),
        tx({ type: 'receita', description: 'Salário', amount: 5000, categoryId: 'cat-mercado', cardId: 'c1' }),
        tx({ cardId: 'c1' }),
      ],
    })
    expect(r.ops.create[0]).toMatchObject({ categoryId: null, accountId: null })
    expect(r.ops.create[1]).toMatchObject({ type: 'receita', cardId: null, categoryId: null, accountId: 'a1' })
    // compra no cartão não sai da conta
    expect(r.ops.create[2]).toMatchObject({ cardId: 'c1', accountId: null, paid: true })
  })

  it('valor inválido, tipo desconhecido e transferência sem destino caem fora', () => {
    const r = parse({
      create: [
        tx({ amount: 0 }),
        tx({ amount: -5 }),
        { ...tx(), amount: 'abc' },
        { ...tx(), type: 'tarifa' },
        tx({ type: 'transferencia', toAccountId: null }),
        tx({ type: 'transferencia', toAccountId: 'a1' }),
        tx({ type: 'transferencia', description: '', toAccountId: 'a2', categoryId: 'cat-mercado', installments: 3 }),
        tx({ type: 'transferencia', description: 'Fatura', cardId: 'c1' }),
      ],
    })
    expect(r.ops.create).toEqual([
      tx({ type: 'transferencia', description: 'Transferência', toAccountId: 'a2', categoryId: null, installments: 1 }),
      tx({ type: 'transferencia', description: 'Fatura', cardId: 'c1', categoryId: null }),
    ])
  })

  it('datas, parcelas e descrição vazia', () => {
    const r = parse({
      create: [
        tx({ date: '2026-11-10' }),
        tx({ date: '2026-11-10', cardId: 'c1' }),
        tx({ date: '2026-02-30' }),
        tx({ date: '2040-01-01' }),
        tx({ installments: 0 }),
        tx({ installments: 500 }),
        tx({ description: '   ' }),
      ],
    })
    expect(r.ops.create.map((t) => [t.date, t.paid, t.installments, t.description])).toEqual([
      ['2026-11-10', false, 1, 'Mercado'],
      ['2026-11-10', true, 1, 'Mercado'],
      [TODAY, true, 1, 'Mercado'],
      [TODAY, true, 1, 'Mercado'],
      [TODAY, true, 1, 'Mercado'],
      [TODAY, true, 72, 'Mercado'],
      [TODAY, true, 1, 'Mercado'],
    ])
  })

  it('no máximo 40 lançamentos por resposta', () => {
    expect(parse({ create: Array.from({ length: 60 }, () => tx()) }).ops.create).toHaveLength(40)
  })

  it('correção e desfazer só existem se a última resposta criou algo', () => {
    const fix = { description: null, amount: 50, date: null, categoryId: null, accountId: null, cardId: 'c1', paid: null }
    expect(parse({ correct: fix, undo: true }).ops).toEqual({ create: [], undo: false, correct: null })
    const c = context({ lastCreated: [tx()] })
    expect(parse({ correct: fix }, c).ops.correct).toEqual({ amount: 50, cardId: 'c1' })
    expect(parse({ undo: true }, c).ops.undo).toBe(true)
    // campos inválidos somem; correção vazia vira null
    expect(parse({ correct: { ...fix, amount: -1, cardId: 'zzz', categoryId: 'cat-salario', date: '2026-13-01', paid: false } }, c).ops.correct).toEqual({ paid: false })
    expect(parse({ correct: { ...fix, amount: null, cardId: null } }, c).ops.correct).toBeNull()
    // receita não vai para cartão
    const r = context({ lastCreated: [tx({ type: 'receita', categoryId: 'cat-salario' })] })
    expect(parse({ correct: { ...fix, amount: null, accountId: 'a2' } }, r).ops.correct).toEqual({ accountId: 'a2' })
  })
})

// ─── Chamada com cliente de mentira ──────────────────────────

function mockClient(reply: { stop_reason: string | null; content: { type: string; text?: string }[] } | Error) {
  const create = vi.fn(async (_params: Record<string, unknown>) => {
    if (reply instanceof Error) throw reply
    return reply
  })
  return { client: { beta: { messages: { create } } } satisfies ClaudeLike, create }
}

const request = (p: Partial<InterpretRequest> = {}): InterpretRequest => ({
  context: context(),
  history: [
    { role: 'user', text: 'uber 20' },
    { role: 'assistant', text: 'Lancei: Uber' },
  ],
  input: { text: 'mercado 230 no nubank', source: 'texto' },
  ...p,
})

describe('interpret', () => {
  it('monta o pedido: modelo, recusa com nova tentativa, cache das instruções e formato da resposta', async () => {
    const { client, create } = mockClient({ stop_reason: 'end_turn', content: [{ type: 'thinking' }, { type: 'text', text: raw({ create: [tx()] }) }] })
    const r = await interpret(request(), client)
    expect(r).toEqual({ reply: '', ops: { create: [tx()], undo: false, correct: null }, outcome: 'ok' })
    const params = create.mock.calls[0][0] as ReturnType<typeof requestParams>
    expect(params).toMatchObject({
      model: DEFAULT_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    })
    expect(params).not.toHaveProperty('thinking')
    expect(params).not.toHaveProperty('tool_choice')
    const content = params.messages[0].content
    expect(content).toHaveLength(1)
    const text = (content[0] as { text: string }).text
    expect(text).toContain('- [a1] Nubank · conta corrente · saldo R$ 1.200,00 · conta padrão')
    expect(text).toContain('Conversa recente (mais antiga primeiro):\nPessoa: uber 20\nAssistente: Lancei: Uber')
    expect(text.endsWith('Mensagem de texto:\n"""\nmercado 230 no nubank\n"""')).toBe(true)
  })

  it('modelo sem nova tentativa no servidor não recebe o parâmetro', async () => {
    const { client, create } = mockClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: raw({}) }] })
    await interpret(request(), client, 'claude-haiku-5-5')
    const params = create.mock.calls[0][0]
    expect(params.model).toBe('claude-haiku-5-5')
    expect(params).not.toHaveProperty('fallbacks')
    expect(params).not.toHaveProperty('betas')
  })

  it('fotos e PDF vão antes do texto; áudio é rotulado', async () => {
    const { client, create } = mockClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: raw({}) }] })
    await interpret(
      request({
        history: [],
        input: {
          text: 'paguei a conta de luz',
          source: 'audio',
          images: [
            { base64: 'AAAA', mime: 'image/png' },
            { base64: 'BBBB', mime: 'image/bmp' },
          ],
          pdf: { base64: 'CCCC', name: 'fatura.pdf' },
        },
      }),
      client,
    )
    const content = (create.mock.calls[0][0] as ReturnType<typeof requestParams>).messages[0].content
    expect(content.map((b) => b.type)).toEqual(['image', 'document', 'text'])
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } })
    expect(content[1]).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'CCCC' } })
    const text = (content[2] as { text: string }).text
    expect(text).toContain('Foto ou print em anexo e PDF em anexo ("fatura.pdf"). Áudio (transcrição automática')
    expect(text).not.toContain('Conversa recente')
  })

  it('recusa, resposta fora do formato e erro da API', async () => {
    const refusal = mockClient({ stop_reason: 'refusal', content: [] })
    expect(await interpret(request(), refusal.client)).toEqual({ reply: REPLIES.refused, ops: { create: [], undo: false, correct: null }, outcome: 'refusal' })
    const junk = mockClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'não é json' }] })
    expect(await interpret(request(), junk.client)).toMatchObject({ reply: REPLIES.invalid, outcome: 'invalid' })
    const empty = mockClient({ stop_reason: 'max_tokens', content: [] })
    expect((await interpret(request(), empty.client)).outcome).toBe('invalid')
    const down = mockClient(new Error('overloaded'))
    await expect(interpret(request(), down.client)).rejects.toThrow('overloaded')
  })
})

describe('contexto', () => {
  it('sem o dia de hoje não vale', () => {
    expect(sanitizeContext(null)).toBeNull()
    expect(sanitizeContext({ categories: [] })).toBeNull()
    expect(sanitizeContext({ today: '21/10/2026' })).toBeNull()
  })

  it('confere tipos, corta textos e listas, e a conta padrão precisa existir', () => {
    const c = sanitizeContext({
      today: TODAY,
      name: `  ${'M'.repeat(100)} `,
      categories: [{ id: 'cat-x', name: 'X', type: 'despesa' }, { id: 'cat-y', name: 'Y', type: 'outra' }, { id: 'bad id!', name: 'Z', type: 'despesa' }, 'lixo'],
      accounts: [{ id: 'a1', name: '  Nubank  ', balance: 10.555, kind: 'corrente', hidden: 'sim' }, { id: 'a2' }],
      cards: [{ id: 'c1', name: 'Cartão', last4: '12345', closingDay: 40, dueDay: 10, limit: 1000 }],
      defaultAccount: 'a9',
      month: { key: '2026-10', income: 10, expense: 'x' },
      recent: Array.from({ length: 50 }, () => ({ date: TODAY, type: 'despesa', description: 'Uber', amount: 10 })),
      lastCreated: [{ ...tx(), installments: 3 }, { type: 'despesa' }],
      extra: 'ignorado',
    })!
    expect(c.name).toHaveLength(60)
    expect(c.categories).toEqual([{ id: 'cat-x', name: 'X', type: 'despesa', parentId: null }])
    expect(c.accounts).toEqual([{ id: 'a1', name: 'Nubank', kind: 'corrente', balance: 10.56 }])
    expect(c.cards).toEqual([{ id: 'c1', name: 'Cartão', dueDay: 10, limit: 1000 }])
    expect(c.defaultAccount).toBeNull()
    expect(c.month).toMatchObject({ key: '2026-10', income: 10, expense: 0 })
    expect(c.recent).toHaveLength(30)
    expect(c.lastCreated).toEqual([tx({ installments: 3 })])
    expect(c).not.toHaveProperty('extra')
  })

  it('texto para a IA com contas, cartões, faturas, categorias e números do mês', () => {
    const text = contextText(
      context({
        invoices: [{ cardId: 'c1', key: '2026-11', due: '2026-11-10', total: 400, open: 400, status: 'aberta' }],
        month: { key: '2026-10', income: 5000, incomePaid: 5000, incomePending: 0, expense: 900, expensePaid: 500, expensePending: 400, balance: 4100 },
        expenseByCategory: [{ categoryId: 'cat-alimentacao', name: 'Alimentação', amount: 300, limit: 500 }],
        budget: { limit: 2000, spent: 900 },
        bills: [{ type: 'despesa', description: 'Luz', amount: 120, date: '2026-10-15', late: true }],
      }),
    )
    expect(text).toContain('Hoje: 2026-10-21 (quarta-feira).')
    expect(text).toContain('- [c1] Nubank · fecha dia 3, vence dia 10 · limite disponível R$ 4.600,00 de R$ 5.000,00')
    expect(text).toContain('  - fatura de nov/2026 (vence 10/11, aberta): total R$ 400,00, em aberto R$ 400,00')
    expect(text).toContain('- cat-alimentacao: Alimentação\n  - cat-mercado: Mercado')
    expect(text).toContain('- Despesas: R$ 900,00 (pago R$ 500,00, a pagar R$ 400,00)')
    expect(text).toContain('Alimentação R$ 300,00 (limite R$ 500,00, 60%)')
    expect(text).toContain('- Limite geral de gastos do mês: R$ 2.000,00, gasto R$ 900,00 (45%)')
    expect(text).toContain('- atrasado: a pagar 15/10: Luz R$ 120,00')
  })
})

describe('transcrição e base64', () => {
  it('manda o áudio como arquivo, em português, e lê o texto', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const form = init!.body as FormData
      expect(form.get('model')).toBe('whisper-1')
      expect(form.get('language')).toBe('pt')
      expect((form.get('file') as File).name).toBe('audio.ogg')
      return new Response(JSON.stringify({ text: ' paguei 80 de luz ' }), { status: 200 })
    })
    const cfg = { url: 'https://api.exemplo/v1/audio/transcriptions', apiKey: 'k', model: 'whisper-1' }
    expect(await transcribe(cfg, new Uint8Array([1, 2]), 'audio/ogg; codecs=opus', fetcher as unknown as typeof fetch)).toBe('paguei 80 de luz')
    expect(fetcher.mock.calls[0][0]).toBe(cfg.url)
    const fail = vi.fn(async () => new Response('limite', { status: 429 }))
    await expect(transcribe(cfg, new Uint8Array([1]), 'audio/ogg', fail as unknown as typeof fetch)).rejects.toThrow('429')
  })

  it('base64 de ida e volta, tamanho sem decodificar', () => {
    const bytes = new Uint8Array(Array.from({ length: 70_000 }, (_, i) => i % 256))
    const b64 = toBase64(bytes)
    expect(fromBase64(b64)).toEqual(bytes)
    expect(fromBase64(`data:image/png;base64,${b64}`)).toEqual(bytes)
    expect(base64Size(b64)).toBe(70_000)
    expect(base64Size('AQ==')).toBe(1)
    expect(fromBase64('não é base64!')).toBeNull()
  })
})

describe('acesso', () => {
  it('bloqueado ou vencido não passa', () => {
    expect(hasAccess({ blocked: false, expires_at: null }, TODAY)).toBe(true)
    expect(hasAccess({ blocked: false, expires_at: TODAY }, TODAY)).toBe(true)
    expect(hasAccess({ blocked: false, expires_at: '2026-10-20' }, TODAY)).toBe(false)
    expect(hasAccess({ blocked: true, expires_at: null }, TODAY)).toBe(false)
    expect(hasAccess(null, TODAY)).toBe(false)
    expect(todayIn('America/Sao_Paulo', new Date('2026-10-22T02:30:00Z'))).toBe('2026-10-21')
  })
})
