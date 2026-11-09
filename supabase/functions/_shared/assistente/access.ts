// Regras comuns aos canais do assistente: acesso pelo plano e o dia de hoje da pessoa.

export interface ProfileAccess {
  blocked: boolean
  /** AAAA-MM-DD; null = sem vencimento */
  expires_at: string | null
}

/** Acesso liberado no dia: não bloqueado e dentro do vencimento (como public.has_access()). */
export const hasAccess = (p: ProfileAccess | null | undefined, today: string) => !!p && !p.blocked && (!p.expires_at || p.expires_at.slice(0, 10) >= today)

/** Data (AAAA-MM-DD) de hoje no fuso da pessoa (padrão: São Paulo). */
export function todayIn(tz = 'America/Sao_Paulo', now = new Date()) {
  const p: Record<string, string> = {}
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)) p[x.type] = x.value
  return `${p.year}-${p.month}-${p.day}`
}
