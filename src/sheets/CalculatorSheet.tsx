import { useUI } from '../lib/store'
import { Calculator } from '../components/Calculator'
import { Sheet } from '../components/sheet'

/** Simulador de financiamento em painel: aberto pelo botão Novo, pelo menu "Mais" ou pelo menu lateral. */
export default function CalculatorSheet() {
  const open = useUI((s) => s.calculator)
  const { openCalculator, openNewDebt } = useUI()

  return (
    <Sheet open={open} onOpenChange={openCalculator} title="Simulador de financiamento">
      <p className="mb-4 px-1 text-[13px] leading-[18px] text-label-2">Veja a parcela, os juros e o custo total antes de assinar, e compare prazos.</p>
      <Calculator
        onDebt={(draft) => {
          openCalculator(false)
          setTimeout(() => openNewDebt(true, 'pagar', draft), 300)
        }}
      />
    </Sheet>
  )
}
