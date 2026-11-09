// Dados da versão de gestão de empréstimos (clientes + contratos) viram a aba Dívidas:
// cada contrato é um valor que alguém deve a você, com as parcelas e os pagamentos de antes.

import type { Debt, Frequency, InterestMode, Payment, Scheduled } from './loans'

export interface LegacyClient {
  id: string
  name: string
  phone?: string
  note?: string
}

export interface LegacyContract {
  id: string
  clientId: string
  kind?: string
  principal: number
  rate: number
  mode: InterestMode
  frequency: Frequency
  createdAt: string
  schedule: Scheduled[]
  payments: Payment[]
  renegotiated?: boolean
}

const legacyKind: Record<string, string> = { fiado: 'Fiado', crediario: 'Crediário' }

export function legacyToDebts(clients: LegacyClient[], contracts: LegacyContract[]): Debt[] {
  const byId = new Map(clients.map((c) => [c.id, c]))
  return contracts
    .filter((c) => Array.isArray(c.schedule) && c.schedule.length > 0)
    .map((c) => {
      const client = byId.get(c.clientId)
      const note = [legacyKind[c.kind ?? ''], client?.note].filter(Boolean).join(' · ')
      return {
        id: c.id,
        direction: 'receber',
        kind: c.kind === 'emprestimo' ? 'emprestimo' : 'acordo',
        person: client?.name ?? 'Sem nome',
        ...(client?.phone ? { phone: client.phone } : {}),
        ...(note ? { note } : {}),
        principal: c.principal,
        rate: c.rate,
        mode: c.mode,
        frequency: c.frequency,
        createdAt: c.createdAt,
        schedule: c.schedule,
        payments: Array.isArray(c.payments) ? c.payments : [],
        ...(c.renegotiated ? { renegotiated: true } : {}),
      } satisfies Debt
    })
}
