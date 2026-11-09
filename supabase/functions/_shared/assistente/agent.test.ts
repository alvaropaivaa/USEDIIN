import { describe, expect, it, vi } from 'vitest'
import { AGENT_SYSTEM, TOOLS, TOOL_NAMES, agentParams, agentTurn, echoable } from './agent.ts'
import { REPLIES, type ClaudeLike } from './brain.ts'
import { contextText } from './context.ts'
import type { AgentStep, AssistantContext, InterpretRequest } from './types.ts'

const context: AssistantContext = {
  today: '2026-10-21',
  categories: [{ id: 'cat-salario', name: 'Salário', type: 'receita', parentId: null }],
  accounts: [{ id: 'a1', name: 'Nubank', kind: 'corrente', balance: 1200 }],
  cards: [],
  defaultAccount: 'a1',
  recent: [{ id: 'tx1', date: '2026-10-21', type: 'receita', description: 'Salário', amount: 2000, category: 'Salário', where: 'Nubank', status: 'pago', installment: null, last: true }],
  goals: [{ id: 'g1', name: 'Viagem', target: 5000, saved: 500, deadline: '2027-06-30', monthly: 300 }],
  debts: [{ id: 'd1', direction: 'pagar', person: 'Banco X', kind: 'emprestimo', open: 800, next: { due: '2026-11-10', amount: 270 }, status: 'em_dia' }],
}
const req: InterpretRequest = { context, history: [{ role: 'user', text: 'recebi 2 mil de salário' }], input: { text: 'errei, foi 3 mil' } }
const step: AgentStep = {
  content: [
    { type: 'thinking', thinking: '', signature: 'sig' },
    { type: 'tool_use', id: 'tu1', name: 'buscar_lancamentos', input: {} },
  ],
  results: [{ id: 'tu1', content: 'Nenhum lançamento encontrado.' }],
}

describe('ferramentas', () => {
  it('nomes únicos, esquemas fechados e o que é obrigatório existe', () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOLS.length)
    for (const t of TOOLS) {
      expect(t.input_schema.additionalProperties).toBe(false)
      for (const r of t.input_schema.required) expect(Object.keys(t.input_schema.properties)).toContain(r)
    }
  })

  it('toda ferramenta que muda algo pede "encerrar"; consultas não', () => {
    for (const t of TOOLS) expect(t.input_schema.required.includes('encerrar')).toBe(!['buscar_lancamentos', 'resumo'].includes(t.name))
  })

  it('as instruções citam só ferramentas que existem', () => {
    const cited = AGENT_SYSTEM.match(/\b[a-z]+_[a-z_]+\b/g) ?? []
    for (const name of cited.filter((n) => !['conta_id', 'cartao_id'].includes(n))) expect(TOOL_NAMES).toContain(name)
  })
})

describe('pedido do agente', () => {
  it('instruções, ferramentas e a mensagem ficam em cache; a escolha da ferramenta é livre', () => {
    const p = agentParams(req, [])
    expect(p.system[0]).toMatchObject({ text: AGENT_SYSTEM, cache_control: { type: 'ephemeral' } })
    expect(p.tools).toBe(TOOLS)
    expect(p.tool_choice).toEqual({ type: 'auto' })
    expect(p.messages).toHaveLength(1)
    const first = p.messages[0].content as { type: string; text?: string; cache_control?: unknown }[]
    expect(first.at(-1)).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } })
    expect(first.at(-1)!.text).toContain('errei, foi 3 mil')
    expect(p).toMatchObject({ model: 'claude-opus-5-5', betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort: 'low' } })
  })

  it('as voltas entram como resposta da IA e resultados das ferramentas, com o começo igual', () => {
    const one = agentParams(req, [])
    const two = agentParams(req, [step, { ...step, results: [{ id: 'tu1', content: 'erro', error: true }] }])
    expect(two.messages[0]).toEqual(one.messages[0])
    expect(two.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
    expect(two.messages[1].content).toEqual(step.content)
    expect(two.messages[2].content).toEqual([{ type: 'tool_result', tool_use_id: 'tu1', content: 'Nenhum lançamento encontrado.' }])
    // a última volta entra no cache e leva o erro
    expect(two.messages[4].content).toEqual([{ type: 'tool_result', tool_use_id: 'tu1', content: 'erro', is_error: true, cache_control: { type: 'ephemeral' } }])
  })

  it('outro modelo e outro esforço', () => {
    const p = agentParams(req, [], 'claude-haiku-5-5', 'medium')
    expect(p).not.toHaveProperty('fallbacks')
    expect(p.output_config).toEqual({ effort: 'medium' })
  })

  it('o contexto mostra ids, a última resposta, metas e dívidas', () => {
    const text = contextText(context)
    expect(text).toContain('- [tx1] 21/10/2026 · receita · Salário')
    expect(text).toContain('da sua última resposta')
    expect(text).toContain('- [g1] Viagem · guardado')
    expect(text).toContain('- [d1] Devo a Banco X (emprestimo) · falta')
  })
})

describe('troca de modelo no meio da resposta', () => {
  it('antes do bloco fallback só o texto volta; depois, tudo', () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 'a' },
      { type: 'text', text: 'Vou ver' },
      { type: 'tool_use', id: 'x', name: 'resumo', input: {} },
      { type: 'algo_novo' },
      { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
      { type: 'thinking', thinking: '', signature: 'b' },
      { type: 'tool_use', id: 'y', name: 'resumo', input: {} },
    ]
    expect(echoable(content)).toEqual([content[1], content[5], content[6]])
    expect(echoable(step.content)).toEqual(step.content)
  })
})

describe('chamada', () => {
  const client = (res: Awaited<ReturnType<ClaudeLike['beta']['messages']['create']>>) => ({ beta: { messages: { create: vi.fn(async () => res) } } })

  it('devolve os blocos como vieram e o motivo da parada', async () => {
    const c = client({ stop_reason: 'tool_use', content: step.content as { type: string }[] })
    expect(await agentTurn(req, [], c)).toEqual({ content: step.content, stop: 'tool_use' })
    expect(c.beta.messages.create).toHaveBeenCalledWith(agentParams(req, []))
  })

  it('recusa vira texto para a pessoa, sem blocos', async () => {
    expect(await agentTurn(req, [], client({ stop_reason: 'refusal', content: [] }))).toEqual({ content: [], stop: 'refusal', reply: REPLIES.refused })
  })
})
