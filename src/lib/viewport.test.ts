import { describe, expect, it } from 'vitest'
import { missingHeight } from './viewport'

describe('missingHeight (faixa do iOS 26 no app instalado)', () => {
  it('acha a faixa quando a página recebe a tela menos o topo (iPhone 16 Pro: 812 de 874)', () => {
    expect(missingHeight(402, 874, 812, true)).toBe(62)
  })

  it('não mexe quando a página ocupa a tela toda', () => {
    expect(missingHeight(393, 852, 852, true)).toBe(0)
  })

  it('teclado aberto não conta como faixa', () => {
    expect(missingHeight(393, 852, 520, true)).toBe(0)
  })

  it('deitado não mexe (o iOS não troca largura e altura da tela)', () => {
    expect(missingHeight(393, 852, 393, false)).toBe(0)
  })
})
