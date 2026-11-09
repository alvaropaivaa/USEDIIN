// Ícones do menu lateral que se mexem ao passar o mouse. O desenho é o mesmo do Lucide (mesmos
// traços do resto do app); só uma parte de cada um se mexe, com mola, e volta devagar quando o
// mouse sai: as barras crescem, a fatia da pizza se destaca, as setas se afastam, o sino toca…
// Quem anima é o botão: <motion.button initial="rest" animate="rest" whileHover="hover">.

import type { ReactNode } from 'react'
import { motion, type Transition, type Variants } from 'motion/react'

export type SideIconName = 'home' | 'assistant' | 'transactions' | 'accounts' | 'budget' | 'goals' | 'debts' | 'reports' | 'calculator' | 'bell' | 'settings' | 'logout'

/** Indo: mola viva; voltando: mola mansa, sem pular. */
const go: Transition = { type: 'spring', stiffness: 420, damping: 18 }
const back: Transition = { type: 'spring', stiffness: 260, damping: 26 }

/** Vai para `to` ao passar o mouse e volta ao normal ao sair. */
const shift = (to: Record<string, number | string>, from: Record<string, number | string>, delay = 0): Variants => ({
  rest: { ...from, transition: back },
  hover: { ...to, transition: { ...go, delay } },
})
const still = { x: 0, y: 0, rotate: 0, scale: 1 }
const move = (to: Partial<typeof still>, delay = 0) => shift(to, still, delay)

/** Pisca uma vez (as teclas da calculadora, em sequência). */
const blink = (delay: number): Variants => ({
  rest: { opacity: 1, transition: { duration: 0.15 } },
  hover: { opacity: [1, 0.25, 1], transition: { duration: 0.4, delay } },
})

/** O traço se desenha de novo, do começo ao fim. */
const draw = (delay = 0): Variants => ({
  rest: { pathLength: 1, opacity: 1, transition: { duration: 0.2 } },
  hover: { pathLength: [0, 1], opacity: [0, 1], transition: { duration: 0.45, delay, ease: [0.3, 0.7, 0.4, 1] } },
})

const ICONS: Record<SideIconName, ReactNode> = {
  // a porta se desenha, como quem entra
  home: (
    <>
      <motion.path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" variants={draw()} />
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>
  ),
  // o balão se inclina e aparecem os pontinhos de "digitando"
  assistant: (
    <>
      <motion.path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" variants={move({ rotate: -8, scale: 1.04 })} />
      {[8, 12, 16].map((cx, k) => (
        <motion.circle key={cx} cx={cx} cy={12} r={1} fill="currentColor" stroke="none" variants={shift({ opacity: 1, scale: 1 }, { opacity: 0, scale: 0.4 }, 0.05 + k * 0.06)} />
      ))}
    </>
  ),
  // as setas se afastam, cada uma para o seu lado
  transactions: (
    <>
      <motion.g variants={move({ x: -2 })}>
        <path d="M8 3 4 7l4 4" />
        <path d="M4 7h16" />
      </motion.g>
      <motion.g variants={move({ x: 2 }, 0.04)}>
        <path d="m16 21 4-4-4-4" />
        <path d="M20 17H4" />
      </motion.g>
    </>
  ),
  // a carteira se inclina, como se fosse abrir
  accounts: (
    <motion.g variants={move({ rotate: -8, y: -1 })}>
      <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
      <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
    </motion.g>
  ),
  // a fatia sai do gráfico
  budget: (
    <>
      <motion.path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z" variants={move({ x: 1.6, y: -1.6 })} />
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
    </>
  ),
  // o centro cresce e o anel do meio se abre, como um alvo acertado
  goals: (
    <>
      <circle cx="12" cy="12" r="10" />
      <motion.circle cx="12" cy="12" r="6" variants={move({ scale: 1.12 }, 0.04)} />
      <motion.circle cx="12" cy="12" r="2" variants={move({ scale: 1.45 })} />
    </>
  ),
  // as moedas sobem da mão
  debts: (
    <>
      <path d="M11 15h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 17" />
      <path d="m7 21 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9" />
      <path d="m2 16 6 6" />
      <motion.circle cx="16" cy="9" r="2.9" variants={move({ y: -2 })} />
      <motion.circle cx="6" cy="5" r="3" variants={move({ y: -2 }, 0.07)} />
    </>
  ),
  // as barras crescem de baixo para cima, uma depois da outra
  reports: (
    <>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <motion.path d="M8 17v-3" variants={draw()} />
      <motion.path d="M13 17V5" variants={draw(0.08)} />
      <motion.path d="M18 17V9" variants={draw(0.16)} />
    </>
  ),
  // o visor se desenha e as teclas piscam em sequência
  calculator: (
    <>
      <rect width="16" height="20" x="4" y="2" rx="2" />
      <motion.line x1="8" x2="16" y1="6" y2="6" variants={draw()} />
      {['M8 10h.01', 'M12 10h.01', 'M16 10h.01', 'M8 14h.01', 'M12 14h.01', 'M8 18h.01', 'M12 18h.01'].map((d, k) => (
        <motion.path key={d} d={d} variants={blink(0.1 + k * 0.04)} />
      ))}
      <line x1="16" x2="16" y1="14" y2="18" />
    </>
  ),
  // o sino balança preso no alto e o badalo vai junto
  bell: (
    <>
      <motion.path
        d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"
        style={{ originY: 0 }}
        variants={{ rest: { rotate: 0, transition: back }, hover: { rotate: [0, 12, -9, 5, -2, 0], transition: { duration: 0.7, ease: 'easeInOut' } } }}
      />
      <motion.path d="M10.268 21a2 2 0 0 0 3.464 0" variants={{ rest: { x: 0, transition: back }, hover: { x: [0, -1.6, 1.4, -0.8, 0], transition: { duration: 0.7, delay: 0.05, ease: 'easeInOut' } } }} />
    </>
  ),
  // os botões deslizam pelos trilhos
  settings: (
    <>
      <motion.path d="M14 17H5" variants={shift({ d: 'M11 17H5' }, { d: 'M14 17H5' })} />
      <motion.circle cx="17" cy="17" r="3" variants={shift({ cx: 14 }, { cx: 17 })} />
      <motion.path d="M19 7h-9" variants={shift({ d: 'M19 7h-6' }, { d: 'M19 7h-9' }, 0.05)} />
      <motion.circle cx="7" cy="7" r="3" variants={shift({ cx: 10 }, { cx: 7 }, 0.05)} />
    </>
  ),
  // a seta sai pela porta
  logout: (
    <>
      <motion.g variants={move({ x: 2 })}>
        <path d="m16 17 5-5-5-5" />
        <path d="M21 12H9" />
      </motion.g>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    </>
  ),
}

/** Ícone do menu (traço do Lucide), pronto para se mexer quando o botão em volta estiver em "hover". */
export function SideIcon({ name, className, strokeWidth = 1.8 }: { name: SideIconName; className?: string; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {ICONS[name]}
    </svg>
  )
}
