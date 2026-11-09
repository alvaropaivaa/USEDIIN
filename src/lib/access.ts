// Acesso ao Dinn (perfil no Supabase): usado pelo login do app e pelo painel /admin.

import type { Answers } from './onboarding'

export type Role = 'admin' | 'operador' | 'cobrador'
export type Plan = 'teste' | 'mensal' | 'trimestral' | 'anual' | 'vitalicio'

export interface Access {
  id: string
  name: string
  email: string
  phone: string
  role: Role
  plan: Plan
  blocked: boolean
  /** AAAA-MM-DD; vazio = sem vencimento (vitalício). */
  expiresAt: string
  createdAt: string
  lastLogin: string
  /** Instância de WhatsApp ligada a este acesso. */
  instance: string
  note: string
  /** Respostas do cadastro (clientes, carteira, faturamento…). */
  onboarding?: Answers
}

// data local (como o banco faz com today_br): toISOString() é UTC e, depois das 21h no Brasil, já seria "amanhã"
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const todayIso = () => iso(new Date())
export const addDays = (days: number, from = new Date()) => {
  const d = new Date(from)
  d.setDate(d.getDate() + days)
  return iso(d)
}
export const daysUntil = (date: string) => Math.round((new Date(`${date}T12:00:00`).getTime() - new Date(`${todayIso()}T12:00:00`).getTime()) / 86_400_000)

export type AccessStatus = 'ativo' | 'vencendo' | 'vencido' | 'bloqueado'
export function accessStatus(a: Pick<Access, 'blocked' | 'expiresAt'>): AccessStatus {
  if (a.blocked) return 'bloqueado'
  if (!a.expiresAt) return 'ativo'
  const d = daysUntil(a.expiresAt)
  if (d < 0) return 'vencido'
  if (d <= 7) return 'vencendo'
  return 'ativo'
}

/** Linha da tabela profiles → acesso. */
export const profileToAccess = (r: Record<string, any>): Access => ({
  id: r.id,
  name: r.name ?? '',
  email: r.email ?? '',
  phone: r.phone ?? '',
  role: r.role,
  plan: r.plan,
  blocked: !!r.blocked,
  expiresAt: r.expires_at ?? '',
  createdAt: (r.created_at ?? '').slice(0, 10),
  lastLogin: r.last_login ?? '',
  instance: r.instance ?? '',
  note: r.note ?? '',
  onboarding: r.onboarding ?? {},
})
