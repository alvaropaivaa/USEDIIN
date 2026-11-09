import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SupabaseClient } from '@supabase/supabase-js'
import { authMessage, createAdminClient } from '../lib/supabase'
import { notifyError } from './ui'
import { addDays, daysUntil, profileToAccess, type Access, type Plan, type Role } from '../lib/access'
import { uid } from '../lib/crypto'

// Painel do administrador: acessos, histórico e configuração do Evolution ficam no Supabase.
// Criar, trocar senha e excluir acesso passam pela Edge Function admin-users (chave de serviço só no servidor).

export * from '../lib/access'

export interface EvolutionConfig {
  url: string
  apiKey: string
}

export interface LogEntry {
  id: string
  at: string
  text: string
  tone: 'green' | 'red' | 'blue' | 'gray'
}

export const PLANS: { value: Plan; label: string; days: number }[] = [
  { value: 'teste', label: 'Teste (7 dias)', days: 7 },
  { value: 'mensal', label: 'Mensal', days: 30 },
  { value: 'trimestral', label: 'Trimestral', days: 90 },
  { value: 'anual', label: 'Anual', days: 365 },
  { value: 'vitalicio', label: 'Vitalício', days: 0 },
]

export const ROLES: { value: Role; label: string }[] = [
  { value: 'admin', label: 'Administrador' },
  { value: 'operador', label: 'Operador' },
  { value: 'cobrador', label: 'Cobrador' },
]

const toProfile = (p: Partial<Access>) => {
  const row: Record<string, unknown> = {}
  if (p.name !== undefined) row.name = p.name
  if (p.phone !== undefined) row.phone = p.phone
  if (p.role !== undefined) row.role = p.role
  if (p.plan !== undefined) row.plan = p.plan
  if (p.blocked !== undefined) row.blocked = p.blocked
  if (p.expiresAt !== undefined) row.expires_at = p.expiresAt || null
  if (p.instance !== undefined) row.instance = p.instance
  if (p.note !== undefined) row.note = p.note
  return row
}

/** Senha legível para mandar ao cliente (sem 0/O, 1/l). */
export function generatePassword(len = 10) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  // descarta os bytes do "resto" (≥ 216): sem isso as primeiras letras saem com mais frequência
  const limit = 256 - (256 % chars.length)
  let out = ''
  while (out.length < len) for (const b of crypto.getRandomValues(new Uint8Array(len * 2))) if (b < limit && out.length < len) out += chars[b % chars.length]
  return out
}

// criado só quando o painel é aberto (o app principal também importa este arquivo)
let client: SupabaseClient | null = null
const db = () => (client ??= createAdminClient())

async function callAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().functions.invoke('admin-users', { body })
  if (error) {
    // a função responde { error } com status 4xx: tenta ler a mensagem dela
    const msg = await (error as { context?: Response }).context?.json?.().then((j: { error?: string }) => j.error).catch(() => null)
    throw new Error(msg || error.message)
  }
  return data as T
}

interface AdminState {
  /** Já conferiu sessão salva e se existe administrador. */
  ready: boolean
  /** Já existe administrador no banco (senão a tela pede para criar). */
  hasAdmin: boolean
  adminEmail: string
  session: boolean
  theme: 'light' | 'dark'
  accesses: Access[]
  evolution: EvolutionConfig
  log: LogEntry[]

  init: () => Promise<void>
  setupAdmin: (email: string, pass: string) => Promise<string | null>
  login: (email: string, pass: string) => Promise<string | null>
  logout: () => void
  setTheme: (t: 'light' | 'dark') => void
  setEvolution: (c: EvolutionConfig) => void

  createAccess: (a: Omit<Access, 'id' | 'createdAt' | 'lastLogin' | 'blocked'> & { password: string }) => Promise<Access | string>
  updateAccess: (id: string, patch: Partial<Access>) => void
  resetPassword: (id: string, password: string) => Promise<string | null>
  renewAccess: (id: string, plan: Plan) => void
  removeAccess: (id: string) => Promise<string | null>
  addLog: (text: string, tone?: LogEntry['tone']) => void
}

export const useAdmin = create<AdminState>()(
  persist(
    (set, get) => {
      /** Sessão aberta: confere se é admin e carrega tudo. */
      const open = async (email: string): Promise<string | null> => {
        const { data: isAdmin } = await db().rpc('is_admin')
        if (!isAdmin) {
          await db().auth.signOut()
          return 'Esta conta não é de administrador.'
        }
        const [acc, log, cfg] = await Promise.all([
          db().from('profiles').select('*').eq('is_admin', false).order('created_at', { ascending: false }),
          db().from('admin_log').select('*').order('at', { ascending: false }).limit(60),
          db().from('app_config').select('value').eq('key', 'evolution').maybeSingle(),
        ])
        const error = acc.error ?? log.error ?? cfg.error
        if (error) return authMessage(error)
        set({
          session: true,
          hasAdmin: true,
          adminEmail: email,
          accesses: (acc.data ?? []).map(profileToAccess),
          log: (log.data ?? []) as LogEntry[],
          evolution: { url: '', apiKey: '', ...(cfg.data?.value as Partial<EvolutionConfig>) },
        })
        return null
      }

      return {
        ready: false,
        hasAdmin: true,
        adminEmail: '',
        session: false,
        theme: 'light',
        accesses: [],
        evolution: { url: '', apiKey: '' },
        log: [],

        init: async () => {
          const [{ data: exists }, { data: s }] = await Promise.all([db().rpc('admin_exists'), db().auth.getSession()])
          if (s.session?.user.email) await open(s.session.user.email)
          set({ ready: true, hasAdmin: exists !== false })
        },
        setupAdmin: async (rawEmail, pass) => {
          const email = rawEmail.trim().toLowerCase()
          let { data, error } = await db().auth.signUp({ email, password: pass })
          // e-mail já tem conta no app: usa a mesma, se a senha bater
          if (error && /already/i.test(error.message)) ({ data, error } = await db().auth.signInWithPassword({ email, password: pass }))
          if (error) return authMessage(error)
          if (!data.session) return 'Confirme seu e-mail pelo link que enviamos e depois volte aqui para continuar.'
          const { error: e2 } = await db().rpc('claim_admin')
          if (e2) {
            await db().auth.signOut()
            return /admin_exists/.test(e2.message) ? 'Já existe um administrador. Entre com a conta dele.' : authMessage(e2)
          }
          const err = await open(email)
          if (!err) get().addLog('Administrador configurado', 'blue')
          return err
        },
        login: async (rawEmail, pass) => {
          const email = rawEmail.trim().toLowerCase()
          const { error } = await db().auth.signInWithPassword({ email, password: pass })
          if (error) return authMessage(error)
          return open(email)
        },
        logout: () => {
          db().auth.signOut()
          set({ session: false, accesses: [], log: [], evolution: { url: '', apiKey: '' } })
        },
        setTheme: (theme) => set({ theme }),
        setEvolution: (c) => {
          const evolution = { url: c.url.trim().replace(/\/+$/, ''), apiKey: c.apiKey.trim() }
          set({ evolution })
          db()
            .from('app_config')
            .upsert({ key: 'evolution', value: evolution })
            .then(({ error }) => error && notifyError('Não foi possível salvar a configuração.'))
        },

        createAccess: async ({ password, ...a }) => {
          const email = a.email.trim().toLowerCase()
          if (get().accesses.some((x) => x.email === email)) return 'Já existe um acesso com este e-mail.'
          try {
            const { profile } = await callAdmin<{ profile: Record<string, unknown> }>({ action: 'create', email, password, ...toProfile({ ...a, name: a.name.trim() }) })
            const access = profileToAccess(profile)
            set((s) => ({ accesses: [access, ...s.accesses] }))
            get().addLog(`Acesso criado para ${access.name}`, 'green')
            return access
          } catch (e) {
            return (e as Error).message
          }
        },
        updateAccess: (id, patch) => {
          const before = get().accesses
          set({ accesses: before.map((a) => (a.id === id ? { ...a, ...patch } : a)) })
          const row = toProfile(patch)
          if (!Object.keys(row).length) return
          db()
            .from('profiles')
            .update(row)
            .eq('id', id)
            .then(({ error }) => {
              if (!error) return
              set({ accesses: before })
              notifyError('Não foi possível salvar. Tente de novo.')
            })
        },
        resetPassword: async (id, password) => {
          const a = get().accesses.find((x) => x.id === id)
          if (!a) return 'Acesso não encontrado.'
          try {
            await callAdmin({ action: 'reset', id, password })
            get().addLog(`Senha redefinida de ${a.name}`, 'blue')
            return null
          } catch (e) {
            return (e as Error).message
          }
        },
        renewAccess: (id, plan) => {
          const a = get().accesses.find((x) => x.id === id)
          if (!a) return
          const days = PLANS.find((p) => p.value === plan)!.days
          // renova a partir do vencimento atual se ainda não venceu (não perde dias pagos)
          const base = a.expiresAt && daysUntil(a.expiresAt) > 0 ? new Date(`${a.expiresAt}T12:00:00`) : new Date()
          get().updateAccess(id, { plan, blocked: false, expiresAt: days ? addDays(days, base) : '' })
          get().addLog(`${a.name} renovado: ${PLANS.find((p) => p.value === plan)!.label}`, 'green')
        },
        removeAccess: async (id) => {
          const a = get().accesses.find((x) => x.id === id)
          try {
            await callAdmin({ action: 'delete', id })
          } catch (e) {
            return (e as Error).message
          }
          set((s) => ({ accesses: s.accesses.filter((x) => x.id !== id) }))
          if (a) get().addLog(`Acesso de ${a.name} excluído`, 'red')
          return null
        },
        addLog: (text, tone = 'gray') => {
          const entry: LogEntry = { id: uid(), at: new Date().toISOString(), text, tone }
          set((s) => ({ log: [entry, ...s.log].slice(0, 60) }))
          db().from('admin_log').insert({ text, tone }).then(() => {})
        },
      }
    },
    {
      name: 'jurospro-admin',
      // só o tema fica no navegador; o resto vem do banco
      partialize: (s) => ({ theme: s.theme }),
      // versão 0 guardava acessos e senha do admin no navegador: descarta tudo, menos o tema
      version: 1,
      migrate: (p) => ({ theme: (p as { theme?: 'light' | 'dark' })?.theme ?? 'light' }) as AdminState,
    },
  ),
)
