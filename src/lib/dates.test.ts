import { describe, expect, it } from 'vitest'
import { nextDay } from './dates'

describe('nextDay (salário e contas fixas do passo a passo)', () => {
  it('dia ainda por vir no mês: este mês', () => expect(nextDay(17, '2026-11-10')).toBe('2026-11-17'))
  it('o próprio dia de hoje conta', () => expect(nextDay(10, '2026-11-10')).toBe('2026-11-10'))
  it('dia que já passou: mês que vem', () => expect(nextDay(5, '2026-11-10')).toBe('2026-12-05'))
  it('virada do ano', () => expect(nextDay(5, '2026-12-20')).toBe('2027-01-05'))
  it('dia 31 em novembro: o último dia do mês', () => expect(nextDay(31, '2026-11-10')).toBe('2026-11-30'))
  it('dia 30 em fevereiro: o último dia de fevereiro', () => expect(nextDay(30, '2027-01-31')).toBe('2027-02-28'))
})
