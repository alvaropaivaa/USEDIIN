const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const brlCompact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 })
const pct = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Modo discreto: o App liga/desliga e remonta a árvore, então basta consultar a flag.
let hidden = false
export const setPrivacy = (on: boolean) => {
  hidden = on
}
export const isPrivate = () => hidden
const MASK = 'R$ ••••'

export const money = (v: number) => (hidden ? MASK : isFinite(v) ? brl.format(v) : '—')
export const moneyCompact = (v: number) => (hidden ? '•••' : isFinite(v) ? brlCompact.format(v) : '—')
/** Valor sem máscara (para mensagens, recibos e Pix). */
export const moneyRaw = (v: number) => (isFinite(v) ? brl.format(v) : '—')
export const percent = (v: number) => (isFinite(v) ? pct.format(v) : '—')

export function duration(months: number) {
  if (!isFinite(months)) return 'Nunca'
  const y = Math.floor(months / 12)
  const m = months % 12
  const parts = []
  if (y) parts.push(`${y} ${y === 1 ? 'ano' : 'anos'}`)
  if (m || !y) parts.push(`${m} ${m === 1 ? 'mês' : 'meses'}`)
  return parts.join(' e ')
}
