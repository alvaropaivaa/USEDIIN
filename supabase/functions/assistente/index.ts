// Assistente do chat do app: o agente (_shared/assistente/agent.ts), sem gravar nada aqui.
// O app manda a mensagem (texto, áudio, fotos ou PDF), a conversa recente, o contexto já
// calculado e as voltas anteriores; recebe o que a IA respondeu, executa as ferramentas no próprio
// store (que sincroniza) e chama de novo com os resultados enquanto a IA ainda tiver o que fazer.
// Publicada COM verificação de JWT: só usuários logados, e com o plano em dia.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { hasAccess, todayIn } from '../_shared/assistente/access.ts'
import { agentTurn } from '../_shared/assistente/agent.ts'
import { DEFAULT_MODEL } from '../_shared/assistente/brain.ts'
import { claudeClient } from '../_shared/assistente/claude.ts'
import { fromBase64, transcribe, transcriptionFromEnv } from '../_shared/assistente/transcribe.ts'
import { MAX_BODY, checkRequest } from './request.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const env = (k: string) => Deno.env.get(k)?.trim() ?? ''
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const claude = claudeClient(env('ANTHROPIC_API_KEY'))
const model = env('CLAUDE_MODEL') || DEFAULT_MODEL
const effort = (['low', 'medium', 'high'] as const).find((e) => e === env('CLAUDE_EFFORT')) ?? 'low'
const transcription = transcriptionFromEnv((k) => Deno.env.get(k))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  // quem é (o gateway já conferiu a assinatura do JWT) e se o plano está em dia
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: auth } = await admin.auth.getUser(token)
  if (!auth?.user) return json({ error: 'Sessão inválida. Entre de novo.' }, 401)
  const { data: profile } = await admin.from('profiles').select('blocked, expires_at').eq('id', auth.user.id).maybeSingle()
  if (!hasAccess(profile, todayIn())) return json({ error: 'Seu acesso venceu. Renove o plano para usar o assistente.' }, 403)

  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return json({ error: 'Os anexos passam de 10 MB juntos.' }, 413)
  const raw = await req.text()
  if (raw.length > MAX_BODY) return json({ error: 'Os anexos passam de 10 MB juntos.' }, 413)
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return json({ error: 'Pedido inválido.' }, 400)
  }
  const checked = checkRequest(body)
  if (!checked.ok) return json({ error: checked.error }, checked.status)
  const { text, audio, images, pdf, history, context, steps } = checked.value

  // áudio: vira texto antes da IA (nas voltas seguintes o app manda a transcrição)
  let transcript = checked.value.transcript
  if (audio) {
    if (!transcription) return json({ error: 'O assistente ainda não entende áudio. Escreva a mensagem.' }, 422)
    try {
      transcript = (await transcribe(transcription, fromBase64(audio.base64)!, audio.mime)) ?? undefined
    } catch (e) {
      console.warn('[assistente] falha na transcrição', e instanceof Error ? e.message : e)
      return json({ error: 'Não consegui ouvir o áudio agora. Tente de novo ou escreva.' }, 502)
    }
    if (!transcript) return json({ error: 'Não entendi o áudio. Pode gravar de novo ou escrever?' }, 422)
  }

  try {
    const turn = await agentTurn(
      {
        context,
        history,
        input: {
          text: [transcript, text].filter(Boolean).join('\n') || undefined,
          source: transcript ? 'audio' : 'texto',
          ...(images.length ? { images } : {}),
          ...(pdf ? { pdf } : {}),
        },
      },
      steps,
      claude,
      model,
      effort,
    )
    return json({ ...turn, ...(audio && transcript ? { transcript } : {}) })
  } catch (e) {
    console.error('[assistente] falha na IA', e instanceof Error ? e.message : e)
    return json({ error: 'O assistente não respondeu agora. Tente de novo em instantes.' }, 502)
  }
})
