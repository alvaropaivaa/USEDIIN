import { fmtDate } from './dates'
import { moneyRaw } from './format'
import type { Debt, Installment } from './loans'

export const defaultTemplate =
  'Oi, {nome}! Tudo bem? 😊\n\nPassando para lembrar da parcela {parcela} de {valor}, {situacao} {vencimento}.\n{pix}\nQualquer coisa, me chama!\n{empresa}'

/** Normaliza o telefone para o formato do wa.me (DDI 55 quando faltar; tira o 0 de operadora/DDD na frente). */
export const waPhone = (phone: string) => {
  const digits = phone.replace(/\D/g, '').replace(/^0+/, '')
  return digits.length <= 11 ? `55${digits}` : digits
}

export interface ChargeExtras {
  /** Quem assina a mensagem (o nome do perfil). */
  owner: string
  /** Pix copia e cola já gerado com o valor (vazio = sem Pix). */
  pixCode?: string
  /** Multa e juros por atraso somados ao valor. */
  charges?: number
}

/** Lembrete de parcela para quem te deve, a partir do modelo das Configurações. */
export function chargeMessage(template: string, debt: Pick<Debt, 'person'>, inst: Installment, extras: ChargeExtras) {
  const late = inst.status === 'atrasada'
  const charges = extras.charges ?? 0
  const value = charges > 0 ? `${moneyRaw(inst.remaining + charges)} (já com ${moneyRaw(charges)} de multa e juros por atraso)` : moneyRaw(inst.remaining)
  const pix = extras.pixCode ? `\nDá para pagar com Pix copia e cola:\n${extras.pixCode}\n` : ''
  // o texto entra por função: "$&", "$1"… no nome ou na assinatura não viram padrões de substituição
  const fill: Record<string, string> = {
    '{nome}': debt.person.trim().split(/\s+/)[0] ?? '',
    '{parcela}': `${inst.n}/${inst.count}`,
    '{valor}': value,
    '{situacao}': late ? 'que venceu em' : 'com vencimento em',
    '{vencimento}': fmtDate(inst.due),
    '{pix}': pix,
    '{empresa}': extras.owner,
  }
  return template
    .replace(/\{(nome|parcela|valor|situacao|vencimento|pix|empresa)\}/g, (m) => fill[m])
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function openWhatsApp(phone: string, text: string) {
  const url = phone.replace(/\D/g, '') ? `https://wa.me/${waPhone(phone)}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`
  window.open(url, '_blank', 'noopener')
}
