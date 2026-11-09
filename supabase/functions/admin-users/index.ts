// Ações do painel que precisam da chave de serviço: criar acesso, trocar senha e excluir.
// Só o administrador (profiles.is_admin) pode chamar.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const FIELDS = ['name', 'phone', 'role', 'plan', 'expires_at', 'instance', 'note'] as const

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: caller } = await admin.auth.getUser(token)
  if (!caller.user) return json({ error: 'Sessão expirada. Entre de novo.' }, 401)
  const { data: me } = await admin.from('profiles').select('is_admin').eq('id', caller.user.id).single()
  if (!me?.is_admin) return json({ error: 'Só o administrador pode fazer isso.' }, 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Pedido inválido.' }, 400)
  }

  switch (body.action) {
    case 'create': {
      const email = String(body.email ?? '').trim().toLowerCase()
      const password = String(body.password ?? '')
      if (!email || password.length < 6) return json({ error: 'E-mail e senha (mín. 6) são obrigatórios.' }, 400)
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: body.name } })
      if (error) return json({ error: /already|registered|exists/i.test(error.message) ? 'Já existe um acesso com este e-mail.' : error.message }, 400)
      // o gatilho cria o perfil; aqui completa com os dados do formulário
      const patch: Record<string, unknown> = {}
      for (const k of FIELDS) if (k in body) patch[k] = body[k] === '' && k === 'expires_at' ? null : body[k]
      const { data: profile, error: e2 } = await admin.from('profiles').update(patch).eq('id', data.user.id).select().single()
      if (e2) return json({ error: e2.message }, 400)
      return json({ profile })
    }
    case 'reset': {
      const password = String(body.password ?? '')
      if (password.length < 6) return json({ error: 'A senha precisa ter pelo menos 6 caracteres.' }, 400)
      const { error } = await admin.auth.admin.updateUserById(String(body.id), { password })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }
    case 'delete': {
      if (body.id === caller.user.id) return json({ error: 'Você não pode excluir a própria conta.' }, 400)
      const { error } = await admin.auth.admin.deleteUser(String(body.id))
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }
    default:
      return json({ error: 'Ação desconhecida.' }, 400)
  }
})
