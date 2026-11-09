import { motion, useReducedMotion } from 'motion/react'
import clsx from 'clsx'
import nuvem from '../assets/mascote-nuvem.webp'
import avisos from '../assets/dinn-avisos.webp'
import categorias from '../assets/dinn-categorias.webp'
import whatsapp from '../assets/dinn-whatsapp.webp'
import metas from '../assets/dinn-metas.webp'

// O mascote do Dinn (a seta verde) em poses para cada assunto do app. As imagens têm fundo transparente
// e funcionam no tema claro e no escuro.

export type MascotPose = 'nuvem' | 'avisos' | 'categorias' | 'whatsapp' | 'metas'

const POSES: Record<MascotPose, string> = {
  // na nuvem, com o polegar para cima: contas e boas-vindas
  nuvem,
  // tocando o sino e mostrando um aviso no celular: notificações e vencimentos
  avisos,
  // guardando moedas em potes com ícones de categoria: lançamentos e categorias
  categorias,
  // digitando no celular, com balões de conversa: WhatsApp e assistente
  whatsapp,
  // na escada de moedas com a bandeira e o cofrinho: metas e conquistas
  metas,
}

/** O mascote numa pose, entrando de leve e boiando devagar (parado se o sistema pede menos movimento). */
export function Mascot({ pose, className }: { pose: MascotPose; className?: string }) {
  const still = useReducedMotion()
  return (
    <motion.img
      src={POSES[pose]}
      alt=""
      aria-hidden
      draggable={false}
      className={clsx('pointer-events-none select-none', className)}
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: still ? 0 : [0, -4, 0], scale: 1 }}
      transition={{
        opacity: { duration: 0.4 },
        scale: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
        y: still ? { duration: 0.4 } : { duration: 4, repeat: Infinity, ease: 'easeInOut' },
      }}
    />
  )
}
