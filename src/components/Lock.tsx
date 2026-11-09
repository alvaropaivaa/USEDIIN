import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Delete, Lock as LockIcon } from 'lucide-react'
import clsx from 'clsx'
import { haptic } from '../lib/haptics'
import { createPortal } from 'react-dom'
import { useData, useUI } from '../lib/store'
import { sha256 } from '../lib/crypto'

export async function hashPin(pin: string) {
  return sha256(`jurospro:${pin}`)
}

/** Teclado numérico de PIN (4 dígitos), estilo tela de bloqueio do iPhone. Aceita o teclado do computador. */
export function PinPad({ title, subtitle, onComplete, error, disabled }: { title: string; subtitle?: string; onComplete: (pin: string) => void; error?: string; disabled?: boolean }) {
  const [pin, setPin] = useState('')
  const [shake, setShake] = useState(0)

  useEffect(() => {
    if (error) {
      setShake((s) => s + 1)
      setPin('')
    }
  }, [error])

  // atualização funcional: toques rápidos não perdem dígitos
  const press = (d: string) => {
    if (disabled) return
    haptic()
    setPin((p) => (p.length < 4 ? p + d : p))
  }
  const erase = () => setPin((p) => p.slice(0, -1))

  useEffect(() => {
    if (pin.length !== 4) return
    const t = setTimeout(() => {
      onComplete(pin)
      setPin('')
    }, 120)
    return () => clearTimeout(t)
  }, [pin]) // eslint-disable-line react-hooks/exhaustive-deps

  // computador: números e Backspace digitam no PIN
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (/^\d$/.test(e.key)) (e.preventDefault(), !disabled && setPin((p) => (p.length < 4 ? p + e.key : p)))
      else if (e.key === 'Backspace') (e.preventDefault(), setPin((p) => p.slice(0, -1)))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [disabled])

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-white">
      <span className="mb-5 grid size-14 place-items-center rounded-full bg-white/10">
        <LockIcon className="size-6" />
      </span>
      <p className="text-[19px] font-semibold">{title}</p>
      <p role="status" className={clsx('mt-1 h-5 text-[13px]', error ? 'text-[#fca5a5]' : 'text-white/55')}>
        {error || subtitle}
      </p>
      <motion.div key={shake} animate={shake ? { x: [0, -10, 10, -8, 8, 0] } : {}} transition={{ duration: 0.35 }} className="my-8 flex gap-4" aria-label={`${pin.length} de 4 dígitos`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={clsx('size-3.5 rounded-full border border-white/60 transition-colors', i < pin.length && 'bg-white')} />
        ))}
      </motion.div>
      <div className={clsx('grid grid-cols-3 gap-4 transition-opacity', disabled && 'pointer-events-none opacity-40')}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) =>
          k === '' ? (
            <span key={i} />
          ) : (
            <motion.button
              key={i}
              whileTap={{ scale: 0.9, backgroundColor: 'rgba(255,255,255,0.3)' }}
              onClick={() => (k === '⌫' ? erase() : press(k))}
              disabled={disabled}
              aria-label={k === '⌫' ? 'Apagar' : k}
              className={clsx('grid size-[72px] place-items-center rounded-full text-[28px] font-light', k === '⌫' ? 'text-white/80' : 'bg-white/10')}
            >
              {k === '⌫' ? <Delete className="size-6" /> : k}
            </motion.button>
          ),
        )}
      </div>
    </div>
  )
}

// Erros seguidos ficam guardados no aparelho (recarregar a página não zera):
// a partir do 5º erro, espera 30 s, depois 1 min, 2 min… até 15 min.
const TRIES = 'jurospro-pin-tentativas'
const FREE_TRIES = 5

const readTries = (): { n: number; until: number } => {
  try {
    const v = JSON.parse(localStorage.getItem(TRIES) ?? 'null')
    return v && typeof v.n === 'number' && typeof v.until === 'number' ? v : { n: 0, until: 0 }
  } catch {
    return { n: 0, until: 0 }
  }
}
const writeTries = (v: { n: number; until: number } | null) => {
  try {
    if (v) localStorage.setItem(TRIES, JSON.stringify(v))
    else localStorage.removeItem(TRIES)
  } catch {
    /* sem armazenamento: a espera vale só nesta sessão */
  }
}

/** Tela de bloqueio: aparece ao abrir e ao voltar depois de 1 minuto fora do app. */
export function LockScreen() {
  const pinHash = useData((s) => s.settings.pinHash)
  const [locked, setLocked] = useState(!!pinHash)
  const [error, setError] = useState('')
  const [until, setUntil] = useState(() => readTries().until)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!pinHash) return setLocked(false)
    let hiddenAt = 0
    const onVis = () => {
      if (document.hidden) hiddenAt = Date.now()
      else if (hiddenAt && Date.now() - hiddenAt > 60_000) {
        useUI.getState().closeAll()
        setLocked(true)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [pinHash])

  // contagem regressiva da espera
  const waiting = locked && until > now
  useEffect(() => {
    if (!locked || until <= Date.now()) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [locked, until])
  const left = Math.ceil((until - now) / 1000)
  const waitText = left >= 60 ? `${Math.ceil(left / 60)} min` : `${left} s`

  return createPortal(
    <AnimatePresence>
      {locked && pinHash && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 0.3 }}
          data-lock=""
          className="grad-green pt-safe pointer-events-auto fixed inset-0 z-[100]"
        >
          <PinPad
            title="Dinn bloqueado"
            subtitle={waiting ? `Muitas tentativas. Tente de novo em ${waitText}` : 'Digite seu PIN'}
            error={waiting ? undefined : error}
            disabled={waiting}
            onComplete={async (pin) => {
              if (readTries().until > Date.now()) return
              if ((await hashPin(pin)) === pinHash) {
                haptic('success')
                writeTries(null)
                setError('')
                setLocked(false)
                return
              }
              const n = readTries().n + 1
              const wait = n >= FREE_TRIES ? Math.min(15 * 60_000, 30_000 * 2 ** (n - FREE_TRIES)) : 0
              writeTries({ n, until: wait ? Date.now() + wait : 0 })
              setNow(Date.now())
              setUntil(wait ? Date.now() + wait : 0)
              // começou a espera: o aviso de espera substitui o erro (e não volta a tremer quando ela acaba)
              setError(wait ? '' : `PIN incorreto · ${new Date().toLocaleTimeString('pt-BR')}`)
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
