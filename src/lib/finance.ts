// Matemática de metas: quanto guardar por mês e em quantos meses se chega lá,
// com juros compostos ao mês sobre o que já está guardado e sobre cada aporte (postecipado).

/** Aporte mensal necessário para atingir uma meta. */
export function pmtForGoal(goal: number, pv: number, i: number, n: number) {
  if (n <= 0) return NaN
  if (i === 0) return (goal - pv) / n
  const g = Math.pow(1 + i, n)
  return ((goal - pv * g) * i) / (g - 1)
}

/** Meses necessários para atingir uma meta. */
export function monthsForGoal(goal: number, pv: number, pmt: number, i: number) {
  if (goal <= pv) return 0
  if (i === 0) return pmt > 0 ? Math.ceil((goal - pv) / pmt) : Infinity
  const num = goal * i + pmt
  const den = pv * i + pmt
  if (den <= 0 || num <= 0) return Infinity
  return Math.ceil(Math.log(num / den) / Math.log(1 + i))
}
