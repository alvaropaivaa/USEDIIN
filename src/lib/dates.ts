// Datas como strings locais 'AAAA-MM-DD' — sem fuso horário, sem surpresas.

const pad = (n: number) => String(n).padStart(2, '0')

export const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const parseISO = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const today = () => toISO(new Date())

export const addDays = (iso: string, days: number) => {
  const d = parseISO(iso)
  d.setDate(d.getDate() + days)
  return toISO(d)
}

/** Soma meses mantendo o dia (limitado ao último dia do mês: 31/01 + 1 → 28/02). */
export const addMonths = (iso: string, months: number) => {
  const d = parseISO(iso)
  const day = d.getDate()
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(day, last))
  return toISO(target)
}

export const monthKey = (iso: string) => iso.slice(0, 7)

export const diffDays = (a: string, b: string) => Math.round((parseISO(a).getTime() - parseISO(b).getTime()) / 86400000)

const monthFmt = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })
const shortMonthFmt = new Intl.DateTimeFormat('pt-BR', { month: 'short' })

export const monthLabel = (key: string) => monthFmt.format(parseISO(`${key}-01`)).replace(/^./, (c) => c.toUpperCase())
export const shortMonth = (key: string) => shortMonthFmt.format(parseISO(`${key}-01`)).replace('.', '').replace(/^./, (c) => c.toUpperCase())

export const shiftMonth = (key: string, delta: number) => monthKey(addMonths(`${key}-01`, delta))

export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/** "hoje", "amanhã", "ontem" ou "dd/mm". */
export const relDay = (iso: string, ref = today()) => {
  const d = diffDays(iso, ref)
  if (d === 0) return 'hoje'
  if (d === 1) return 'amanhã'
  if (d === -1) return 'ontem'
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}

/** Próximo dia `day` do mês a partir de `ref` (hoje conta; no mês mais curto, o último dia dele). */
export function nextDay(day: number, ref = today()) {
  const on = (key: string) => {
    const last = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0).getDate()
    return `${key}-${String(Math.min(day, last)).padStart(2, '0')}`
  }
  const now = on(monthKey(ref))
  return now >= ref ? now : on(shiftMonth(monthKey(ref), 1))
}
