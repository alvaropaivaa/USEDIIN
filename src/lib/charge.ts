import { today } from './dates'
import { debtCode, lateCharges, type Debt, type Installment } from './loans'
import { pixPayload } from './pix'
import type { Settings } from './store'
import { chargeMessage, openWhatsApp } from './whatsapp'

/** Monta o lembrete de uma parcela a receber: encargos, Pix com valor e a mensagem pronta. */
export function buildCharge(settings: Settings, debt: Pick<Debt, 'id' | 'person'>, inst: Installment, ref = today()) {
  const charges = lateCharges(inst, settings.late, ref).total
  const amount = Math.round((inst.remaining + charges) * 100) / 100
  const pixCode = settings.pix.trim()
    ? pixPayload({
        key: settings.pix,
        type: settings.pixType,
        name: settings.pixName || settings.owner,
        city: settings.pixCity,
        amount,
        txid: `JP${debtCode(debt.id)}P${inst.n}`,
      })
    : ''
  const text = chargeMessage(settings.template, debt, inst, { owner: settings.owner, pixCode, charges })
  return { charges, amount, pixCode, text }
}

/** Abre o WhatsApp de quem te deve com o lembrete da parcela. */
export const sendCharge = (settings: Settings, debt: Pick<Debt, 'id' | 'person' | 'phone'>, inst: Installment) =>
  openWhatsApp(debt.phone ?? '', buildCharge(settings, debt, inst).text)
