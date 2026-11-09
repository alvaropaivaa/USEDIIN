import { create } from 'zustand'
import { accessStatus, profileToAccess } from './access'
import { authMessage, recoveringPassword, setRemember, supabase } from './supabase'
import { startSync, stopSync, unsyncedCount } from './sync'
import { resetNotifications, setAccount } from './notify'
import { clearPending, loadPending, type Answers } from './onboarding'

// Contas no Supabase Auth. O perfil (plano, vencimento, bloqueio) é controlado pelo painel /admin.

export const normEmail = (e: string) => e.trim().toLowerCase()
export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())

/** Confirma a saída; com mudanças que ainda não subiram (sem internet), avisa que elas se perdem. */
export function confirmSignOut(question = 'Sair da conta neste aparelho?') {
  const n = unsyncedCount()
  if (!n) return confirm(question)
  return confirm(
    n === 1
      ? '1 mudança ainda não foi enviada para a nuvem (sem internet?). Se sair agora, ela se perde. Sair mesmo assim?'
      : `${n} mudanças ainda não foram enviadas para a nuvem (sem internet?). Se sair agora, elas se perdem. Sair mesmo assim?`,
  )
}

/** Retorno do cadastro quando o Supabase pede confirmação por e-mail (não é erro). */
export const CONFIRM_EMAIL = 'Conta criada! Confirme pelo link que enviamos ao seu e-mail e depois entre.'

interface AuthState {
  /** Já conferiu se havia sessão salva (até lá o app não desenha nada). */
  ready: boolean
  email: string | null
  /** Abriu o link de redefinir senha: o login pede a nova senha. */
  recovery: boolean
  signIn: (email: string, pass: string, remember: boolean) => Promise<string | null>
  signUp: (name: string, email: string, pass: string, about?: { phone: string; answers: Answers }) => Promise<string | null>
  /** Leva para o Google; volta ao app já logado. Retorna erro se não deu para sair. */
  signInGoogle: () => Promise<string | null>
  sendReset: (email: string) => Promise<string | null>
  setNewPassword: (pass: string) => Promise<string | null>
  /** Abre o app depois que a sessão foi criada (o login mostra "Tudo certo" antes). */
  enter: (origin?: { x: number; y: number }) => void
  /** Ponto da tela de onde o app abre (o botão tocado no login). */
  origin: { x: number; y: number } | null
  signOut: () => Promise<void>
}

const GOOGLE_DEMO_KEY = 'jurospro-google-demo'
const GOOGLE_DEMO_EMAIL = 'conta.google@dinn.app'
const safe = (fn: () => void) => {
  try {
    fn()
  } catch {}
}
const googleDemo = () => {
  try {
    return localStorage.getItem(GOOGLE_DEMO_KEY) === '1'
  } catch {
    return false
  }
}

/** Confere plano e bloqueio, registra o acesso e baixa os dados. Retorna o erro, ou null. */
async function admit(userId: string): Promise<string | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
  if (error || !data) {
    await supabase.auth.signOut()
    return error ? authMessage(error) : 'Conta não encontrada.'
  }
  const st = accessStatus(profileToAccess(data))
  if (st === 'bloqueado' || st === 'vencido') {
    await supabase.auth.signOut()
    return st === 'bloqueado' ? 'Seu acesso está bloqueado. Fale com o administrador.' : 'Seu acesso venceu. Fale com o administrador para renovar.'
  }
  supabase.rpc('touch_login').then(() => {})
  setAccount({ expiresAt: data.expires_at ?? '' })
  saveOnboarding(data)
  await startSync(userId)
  return null
}

/** Respostas do cadastro que ainda não chegaram ao perfil (conta criada pelo Google ou antes desta versão). */
function saveOnboarding(profile: Record<string, any>) {
  const pending = loadPending()
  if (!pending) return
  if (profile.onboarding && Object.keys(profile.onboarding).length) return clearPending()
  supabase.rpc('save_onboarding', { p_answers: pending.answers, p_phone: pending.phone }).then(({ error }) => !error && clearPending())
}

/** Retorna a mensagem de erro, ou null quando deu certo. */
export const useAuth = create<AuthState>((set) => ({
  ready: false,
  email: null,
  recovery: recoveringPassword,
  signIn: async (rawEmail, pass, remember) => {
    setRemember(remember)
    const { data, error } = await supabase.auth.signInWithPassword({ email: normEmail(rawEmail), password: pass })
    if (error) return authMessage(error)
    return admit(data.user.id)
  },
  signUp: async (name, rawEmail, pass, about) => {
    setRemember(true)
    const { data, error } = await supabase.auth.signUp({
      email: normEmail(rawEmail),
      password: pass,
      // o gatilho do banco copia telefone e respostas para o perfil
      options: { data: { name: name.trim(), phone: about?.phone ?? '', onboarding: about?.answers ?? {} }, emailRedirectTo: location.origin },
    })
    if (error) return authMessage(error)
    // com confirmação de e-mail ligada no Supabase, a sessão só nasce depois do link
    if (!data.session) return CONFIRM_EMAIL
    return admit(data.user!.id)
  },
  // provisório até ativar o Google no Supabase: entra numa sessão local (dados só neste aparelho, sem nuvem).
  // Para o Google de verdade: supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin } })
  signInGoogle: async () => {
    await new Promise((r) => setTimeout(r, 1200))
    safe(() => localStorage.setItem(GOOGLE_DEMO_KEY, '1'))
    return null
  },
  sendReset: async (rawEmail) => {
    const { error } = await supabase.auth.resetPasswordForEmail(normEmail(rawEmail), { redirectTo: location.origin })
    return error ? authMessage(error) : null
  },
  setNewPassword: async (pass) => {
    const { data, error } = await supabase.auth.updateUser({ password: pass })
    if (error) return authMessage(error)
    history.replaceState(null, '', location.pathname + location.search)
    const err = await admit(data.user.id)
    if (!err) set({ recovery: false })
    return err
  },
  origin: null,
  enter: (origin) =>
    supabase.auth.getSession().then(({ data }) => set({ email: data.session?.user.email ?? (googleDemo() ? GOOGLE_DEMO_EMAIL : null), origin: origin ?? null })),
  signOut: async () => {
    safe(() => localStorage.removeItem(GOOGLE_DEMO_KEY))
    // antes de encerrar a sessão: tira este aparelho da lista de push
    await resetNotifications()
    await stopSync()
    await supabase.auth.signOut()
    set({ email: null })
  },
}))

// sessão salva (ou volta do Google): confere o acesso e entra direto, sem a animação do login
supabase.auth.getSession().then(async ({ data }) => {
  const user = data.session?.user
  if (!user && googleDemo() && !recoveringPassword) return useAuth.setState({ ready: true, email: GOOGLE_DEMO_EMAIL })
  if (!user || recoveringPassword) return useAuth.setState({ ready: true })
  const err = await admit(user.id)
  useAuth.setState({ ready: true, email: err ? null : (user.email ?? null) })
})

// sessão encerrada por fora (senha trocada, conta excluída, token expirado)
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && useAuth.getState().email) {
    resetNotifications()
    stopSync()
    useAuth.setState({ email: null })
  }
})
