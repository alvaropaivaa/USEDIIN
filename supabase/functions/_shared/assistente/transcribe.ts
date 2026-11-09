// Transcrição de áudio por um endpoint compatível com /v1/audio/transcriptions (OpenAI, Groq…),
// como no CheckZap (server/src/conversa/transcricao.ts).

export interface TranscriptionConfig {
  url: string
  apiKey: string
  /** ex.: whisper-1 (OpenAI) ou whisper-large-v3-turbo (Groq) */
  model: string
}

const EXT: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/amr': 'amr',
}

/** Configuração pelas variáveis TRANSCRICAO_*; null quando falta alguma (sem áudio). */
export function transcriptionFromEnv(get: (k: string) => string | undefined): TranscriptionConfig | null {
  const url = get('TRANSCRICAO_URL')?.trim()
  const apiKey = get('TRANSCRICAO_API_KEY')?.trim()
  return url && apiKey ? { url, apiKey, model: get('TRANSCRICAO_MODELO')?.trim() || 'whisper-1' } : null
}

/** Transcreve em português; null se o serviço não devolver texto. */
export async function transcribe(cfg: TranscriptionConfig, bytes: Uint8Array, mime: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const base = mime.split(';')[0].trim().toLowerCase() || 'audio/ogg'
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type: base }), `audio.${EXT[base] ?? 'ogg'}`)
  form.append('model', cfg.model)
  form.append('language', 'pt')
  const res = await fetcher(cfg.url, { method: 'POST', headers: { Authorization: `Bearer ${cfg.apiKey}` }, body: form, signal: AbortSignal.timeout(60_000) })
  const body = await res.text().catch(() => '')
  if (!res.ok) throw new Error(`transcrição respondeu ${res.status}: ${body.slice(0, 200)}`)
  try {
    const j = JSON.parse(body) as { text?: unknown }
    return typeof j.text === 'string' && j.text.trim() ? j.text.trim() : null
  } catch {
    return null
  }
}

/** Bytes de um base64 (sem o prefixo data:); null se não for base64 válido. */
export function fromBase64(b64: string): Uint8Array | null {
  const clean = b64.replace(/^data:[^,]*,/, '').replace(/\s/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) return null
  try {
    const bin = atob(clean)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/** Base64 sem estourar a pilha em arquivos grandes. */
export function toBase64(bytes: Uint8Array) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Tamanho em bytes de um base64 sem decodificar. */
export const base64Size = (b64: string) => {
  const clean = b64.replace(/^data:[^,]*,/, '').replace(/\s/g, '')
  return Math.floor((clean.length * 3) / 4) - (clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0)
}
