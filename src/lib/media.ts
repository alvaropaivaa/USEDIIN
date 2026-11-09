import { useSyncExternalStore } from 'react'

// Computador (tela larga): menu lateral, telas em colunas e painéis abrindo pela direita.
const wide = window.matchMedia('(min-width: 1024px)')

export const useDesktop = () =>
  useSyncExternalStore(
    (onChange) => {
      wide.addEventListener('change', onChange)
      return () => wide.removeEventListener('change', onChange)
    },
    () => wide.matches,
  )
