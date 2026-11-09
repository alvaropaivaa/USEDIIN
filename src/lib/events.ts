// Acontecimentos do app (lançamento novo, conta paga, aporte…) para quem quiser reagir, como as notificações.
// O store só avisa; não sabe quem está ouvindo.

import type { Goal, Transaction } from './ledger'
import type { Debt, Payment } from './loans'

export type AppEvent =
  | { type: 'lancamento'; tx: Transaction; count: number }
  | { type: 'pago'; tx: Transaction }
  | { type: 'divida'; debt: Debt }
  | { type: 'divida-pagamento'; before: Debt; debt: Debt; payment: Payment }
  | { type: 'divida-estorno'; debt: Debt; payment: Payment }
  | { type: 'meta-aporte'; before: Goal; goal: Goal; amount: number }
  /** O assistente do WhatsApp lançou (chegou da nuvem com o app aberto). */
  | { type: 'whatsapp'; txs: Transaction[] }

const listeners = new Set<(e: AppEvent) => void>()

export const onAppEvent = (fn: (e: AppEvent) => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export const emit = (e: AppEvent) => {
  for (const fn of listeners)
    try {
      fn(e)
    } catch (err) {
      console.warn('[eventos]', err)
    }
}
