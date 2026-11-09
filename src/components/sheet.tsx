import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Drawer } from 'vaul'
import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2 } from 'lucide-react'
import clsx from 'clsx'
import { haptic } from '../lib/haptics'
import { useDesktop } from '../lib/media'
import { spring } from './ui'

/**
 * Bottom sheet nativo estilo iOS (arrastar para fechar, fundo que encolhe).
 * No computador vira um painel lateral que abre pela direita.
 */
export function Sheet({ open, onOpenChange, title, children, action }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  const desktop = useDesktop()
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground={!desktop} direction={desktop ? 'right' : 'bottom'}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40 lg:bg-black/25" />
        <Drawer.Content
          className={
            desktop
              ? 'fixed inset-y-0 right-0 z-50 flex w-[540px] max-w-[calc(100vw-48px)] flex-col rounded-l-[24px] bg-bg shadow-[-24px_0_60px_-30px_rgba(0,0,0,0.35)] outline-none'
              : 'fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] max-w-xl flex-col rounded-t-[24px] bg-bg outline-none'
          }
        >
          {!desktop && <div className="mx-auto mt-2 h-[5px] w-9 shrink-0 rounded-full bg-label-3" />}
          <div className={clsx('relative flex shrink-0 items-center justify-center px-4', desktop ? 'h-16' : 'h-12')}>
            <Drawer.Title className="text-[17px] font-semibold">{title}</Drawer.Title>
            <Drawer.Description className="sr-only">{title}</Drawer.Description>
            <div className="absolute left-4">{action}</div>
            <button type="button" onClick={() => onOpenChange(false)} className="absolute right-4 text-[17px] font-semibold text-tint" title={desktop ? 'Fechar (Esc)' : undefined}>
              OK
            </button>
          </div>
          <div className={clsx('no-scrollbar pb-safe overflow-y-auto pb-6', desktop ? 'px-6' : 'px-4')}>{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

/** Tabela compacta para sheets de detalhamento. */
export function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-hidden rounded-[22px] bg-surface">
      <table className="tabular w-full text-[13px]">
        <thead className="glass sticky top-0">
          <tr className="text-label-2">
            {head.map((h, i) => (
              <th key={`${i}-${h}`} className={`px-3 py-2 font-medium ${i ? 'text-right' : 'text-left'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, k) => (
            <tr key={k} className="hairline-t">
              {r.map((c, i) => (
                <td key={i} className={`whitespace-nowrap px-3 py-2 ${i ? 'text-right' : 'text-left text-label-2'}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── HUD de confirmação (como o "Salvo" do iOS) ────────────────

let notify: (msg: string) => void = () => {}
export const toast = (msg: string) => notify(msg)

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    let t = 0
    notify = (m) => {
      haptic('success')
      setMsg(m)
      clearTimeout(t)
      t = window.setTimeout(() => setMsg(null), 1400)
    }
    // desmontou (ex.: saiu da conta): sem timer pendente e sem chamar um Toaster que não existe mais
    return () => {
      clearTimeout(t)
      notify = () => {}
    }
  }, [])
  return createPortal(
    <AnimatePresence>
      {msg && (
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={spring}
          className="glass pointer-events-none fixed left-1/2 top-1/2 z-[60] flex flex-col items-center gap-2 rounded-[22px] px-8 py-6 shadow-2xl"
          style={{ x: '-50%', y: '-50%' }}
        >
          <CheckCircle2 className="size-11 text-label-2" strokeWidth={1.5} />
          <span className="text-[15px] font-semibold">{msg}</span>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
