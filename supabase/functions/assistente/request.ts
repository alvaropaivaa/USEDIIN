// Conferência do pedido do chat do app: formatos, tamanhos e o contexto, antes de gastar uma
// chamada à IA. Sem rede (roda nos testes).

import { sanitizeContext } from '../_shared/assistente/context.ts'
import { base64Size } from '../_shared/assistente/transcribe.ts'
import { IMAGE_MIMES, LIMITS, type AgentStep, type AgentToolResult, type AssistantContext, type AssistantImage, type HistoryTurn } from '../_shared/assistente/types.ts'

/** Maior corpo aceito (10 MB de anexos em base64 ocupam ~13,4 MB, mais o contexto). */
export const MAX_BODY = 16 * 1024 * 1024

export interface ChatRequest {
  text?: string
  audio?: { base64: string; mime: string }
  /** transcrição do áudio que veio na primeira volta (as seguintes não mandam o áudio de novo) */
  transcript?: string
  images: AssistantImage[]
  pdf?: { base64: string; name?: string }
  history: HistoryTurn[]
  context: AssistantContext
  /** voltas anteriores do agente nesta mensagem */
  steps: AgentStep[]
}

export type Checked = { ok: true; value: ChatRequest } | { ok: false; status: 400 | 413; error: string }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const B64 = /^[A-Za-z0-9+/]*={0,2}$/
const cleanB64 = (s: string) => s.replace(/^data:[^,]*,/, '').replace(/\s/g, '')
const bad = (error: string, status: 400 | 413 = 400): Checked => ({ ok: false, status, error })

/** Arquivo em base64: só o conteúdo (sem "data:…,"), conferido. */
function file(v: unknown): { base64: string; mime: string; name?: string } | 'invalido' | undefined {
  if (v === undefined || v === null) return undefined
  if (!isObj(v) || typeof v.base64 !== 'string') return 'invalido'
  const base64 = cleanB64(v.base64)
  if (!base64 || !B64.test(base64) || base64.length % 4 === 1) return 'invalido'
  const mime = typeof v.mime === 'string' ? v.mime.split(';')[0].trim().toLowerCase() : ''
  const name = typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 120) : undefined
  return { base64, mime, ...(name ? { name } : {}) }
}

/** Uma volta do agente: os blocos da IA como vieram e um resultado para cada ferramenta pedida. */
function step(v: unknown): AgentStep | undefined {
  if (!isObj(v) || !Array.isArray(v.content) || !Array.isArray(v.results)) return undefined
  if (JSON.stringify(v.content).length > LIMITS.stepBytes) return undefined
  const content = v.content.filter(isObj)
  if (content.length !== v.content.length || content.some((b) => typeof b.type !== 'string')) return undefined
  const uses = content.filter((b) => b.type === 'tool_use').map((b) => b.id)
  const results: AgentToolResult[] = []
  for (const r of v.results) {
    if (!isObj(r) || typeof r.id !== 'string' || typeof r.content !== 'string') return undefined
    results.push({ id: r.id, content: r.content.slice(0, LIMITS.toolResult), ...(r.error === true ? { error: true } : {}) })
  }
  // um resultado para cada ferramenta pedida, e nada além
  const ids = new Set(results.map((r) => r.id))
  if (!uses.length || results.length !== ids.size || uses.length !== ids.size || uses.some((id) => typeof id !== 'string' || !ids.has(id))) return undefined
  return { content, results }
}

export function checkRequest(body: unknown): Checked {
  if (!isObj(body)) return bad('Pedido inválido.')

  const text = typeof body.text === 'string' ? body.text.trim().slice(0, LIMITS.text) : undefined
  if (body.text !== undefined && body.text !== null && typeof body.text !== 'string') return bad('Texto inválido.')

  const audio = file(body.audio)
  if (audio === 'invalido' || (audio && !audio.mime.startsWith('audio/'))) return bad('Áudio inválido.')
  if (body.transcript !== undefined && body.transcript !== null && typeof body.transcript !== 'string') return bad('Transcrição inválida.')
  const transcript = typeof body.transcript === 'string' && body.transcript.trim() ? body.transcript.trim().slice(0, LIMITS.text) : undefined
  if (audio && transcript) return bad('Mande o áudio ou a transcrição, não os dois.')

  if (body.images !== undefined && body.images !== null && !Array.isArray(body.images)) return bad('Imagens inválidas.')
  const rawImages = (body.images as unknown[] | undefined) ?? []
  if (rawImages.length > LIMITS.images) return bad(`Mande no máximo ${LIMITS.images} imagens por vez.`)
  const images: AssistantImage[] = []
  for (const it of rawImages) {
    const f = file(it)
    if (!f || f === 'invalido' || !(IMAGE_MIMES as readonly string[]).includes(f.mime)) return bad('Imagem inválida: use JPG, PNG, WebP ou GIF.')
    if (base64Size(f.base64) > LIMITS.imageBytes) return bad('Cada imagem pode ter até 5 MB.', 413)
    images.push({ base64: f.base64, mime: f.mime })
  }

  const pdf = file(body.pdf === undefined || body.pdf === null ? undefined : { mime: 'application/pdf', ...(body.pdf as Obj) })
  if (pdf === 'invalido' || (pdf && pdf.mime !== 'application/pdf')) return bad('PDF inválido.')

  const sizes = [audio ? base64Size(audio.base64) : 0, pdf ? base64Size(pdf.base64) : 0, ...images.map((i) => base64Size(i.base64))]
  if (audio && sizes[0] > LIMITS.audioBytes) return bad('O áudio pode ter até 10 MB.', 413)
  if (pdf && sizes[1] > LIMITS.pdfBytes) return bad('O PDF pode ter até 10 MB.', 413)
  if (sizes.reduce((s, x) => s + x, 0) > LIMITS.totalBytes) return bad('Os anexos passam de 10 MB juntos.', 413)

  if (!text && !audio && !transcript && !images.length && !pdf) return bad('Mensagem vazia.')

  if (body.history !== undefined && body.history !== null && !Array.isArray(body.history)) return bad('Histórico inválido.')
  const history: HistoryTurn[] = []
  for (const h of (body.history as unknown[] | undefined) ?? []) {
    if (!isObj(h) || (h.role !== 'user' && h.role !== 'assistant') || typeof h.text !== 'string') return bad('Histórico inválido.')
    const t = h.text.trim().slice(0, LIMITS.historyText)
    if (t) history.push({ role: h.role, text: t })
  }

  const context = sanitizeContext(body.context)
  if (!context) return bad('Contexto inválido.')

  if (body.steps !== undefined && body.steps !== null && !Array.isArray(body.steps)) return bad('Pedido inválido.')
  const rawSteps = (body.steps as unknown[] | undefined) ?? []
  if (rawSteps.length > LIMITS.agentSteps) return bad('A conversa passou do limite de passos.')
  const steps: AgentStep[] = []
  for (const raw of rawSteps) {
    const s = step(raw)
    if (!s) return bad('Pedido inválido.')
    steps.push(s)
  }

  return {
    ok: true,
    value: {
      ...(text ? { text } : {}),
      ...(audio ? { audio: { base64: audio.base64, mime: audio.mime } } : {}),
      ...(transcript ? { transcript } : {}),
      images,
      ...(pdf ? { pdf: { base64: pdf.base64, ...(pdf.name ? { name: pdf.name } : {}) } } : {}),
      // só as últimas conversas contam
      history: history.slice(-LIMITS.historyTurns),
      context,
      steps,
    },
  }
}
