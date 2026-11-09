import { createClient, type SupportedStorage } from '@supabase/supabase-js'

// A chave publicável pode ficar no app: quem protege os dados são as regras (RLS) do banco.
const URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://giraspzazfuhyuvttlpe.supabase.co'
const KEY = import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_IepUCrK5lXusTRG2ulAG8A_kmqfeYaX'

const REMEMBER_KEY = 'jurospro-remember'

const safe = <T>(fn: () => T, fallback: T) => {
  try {
    return fn()
  } catch {
    return fallback
  }
}

/** "Manter conectado": a sessão vai para o localStorage; desmarcado, some ao fechar o navegador. */
export const setRemember = (remember: boolean) => safe(() => localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0'), undefined)
const remembering = () => safe(() => localStorage.getItem(REMEMBER_KEY) !== '0', true)

const storage: SupportedStorage = {
  getItem: (k) => safe(() => localStorage.getItem(k) ?? sessionStorage.getItem(k), null),
  setItem: (k, v) =>
    safe(() => {
      const [keep, drop] = remembering() ? [localStorage, sessionStorage] : [sessionStorage, localStorage]
      drop.removeItem(k)
      keep.setItem(k, v)
    }, undefined),
  removeItem: (k) => safe(() => (localStorage.removeItem(k), sessionStorage.removeItem(k)), undefined),
}

/** Link de "redefinir senha" aberto: o app mostra o campo de nova senha em vez de entrar direto. */
export const recoveringPassword = /type=recovery/.test(location.hash)

export const supabase = createClient(URL, KEY, { auth: { storage, storageKey: 'jurospro-auth' } })

/** Cliente separado do painel /admin: sair de um não derruba o outro. */
export const createAdminClient = () => createClient(URL, KEY, { auth: { storageKey: 'jurospro-admin-auth' } })

const messages: [RegExp, string][] = [
  [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
  [/email not confirmed/i, 'Confirme seu e-mail pelo link que enviamos antes de entrar.'],
  [/already registered|already been registered|already exists/i, 'Já existe uma conta com este e-mail.'],
  [/password should be at least/i, 'A senha precisa ter pelo menos 6 caracteres.'],
  [/rate limit|too many/i, 'Muitas tentativas. Aguarde um pouco e tente de novo.'],
  [/provider is not enabled|unsupported provider/i, 'O login com Google ainda não foi ativado.'],
  [/failed to fetch|network/i, 'Sem conexão com o servidor. Verifique a internet.'],
]

/** Traduz os erros do Supabase para mensagens da tela. */
export const authMessage = (e: { message?: string } | null | undefined) => {
  const m = e?.message ?? ''
  return messages.find(([re]) => re.test(m))?.[1] ?? (m || 'Algo deu errado. Tente de novo.')
}
