import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, CircleCheck, Loader2, X } from 'lucide-react'
import clsx from 'clsx'

const ease = [0.32, 0.72, 0, 1] as const
const pop = { type: 'spring', stiffness: 460, damping: 36 } as const

// ─── Blocos ───────────────────────────────────────────────────

export function Card({ title, subtitle, action, children, className, pad = true }: {
  title?: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  pad?: boolean
}) {
  return (
    <section className={clsx('overflow-hidden rounded-[24px] bg-surface shadow-card', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 px-7 pt-6">
          <div className="min-w-0">
            {title && <h3 className="text-[19px] font-semibold tracking-[-0.022em]">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-[14px] text-label-2">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={clsx(pad ? 'p-7' : 'pt-3', pad && (title || action) && 'pt-5')}>{children}</div>
    </section>
  )
}

/** Número grande com rótulo — o centro de cada métrica. */
export function Kpi({ label, value, hint, dot, delay = 0 }: { label: string; value: ReactNode; hint?: ReactNode; dot?: string; delay?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease, delay }} className="rounded-[24px] bg-surface p-6 shadow-card">
      <p className="flex items-center gap-2 text-[14px] font-medium text-label-2">
        {dot && <span className="size-2 rounded-full" style={{ background: dot }} />}
        {label}
      </p>
      <p className="tabular font-display mt-3 text-[40px] font-bold leading-none tracking-[-0.04em]">{value}</p>
      {hint && <p className="mt-3 text-[13.5px] text-label-2">{hint}</p>}
    </motion.div>
  )
}

export type PillTone = 'green' | 'red' | 'blue' | 'orange' | 'gray'
const pillCls: Record<PillTone, string> = {
  green: 'bg-[#34c759]/12 text-[#1f8a3b] dark:text-[#30d158]',
  red: 'bg-[#ff3b30]/10 text-[#d70015] dark:text-[#ff6961]',
  blue: 'bg-[#007aff]/10 text-[#0062cc] dark:text-[#64a8ff]',
  orange: 'bg-[#ff9500]/12 text-[#c93400] dark:text-[#ffb340]',
  gray: 'bg-fill text-label-2',
}
export function Pill({ tone, children, dot, pulse }: { tone: PillTone; children: ReactNode; dot?: boolean; pulse?: boolean }) {
  return (
    <span className={clsx('inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold', pillCls[tone])}>
      {dot && (
        <span className="relative flex size-[7px]">
          {pulse && <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-40" />}
          <span className="relative size-[7px] rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  )
}

/** Avatar com iniciais e cor estável por nome (tons suaves). */
const HUES = [145, 210, 265, 330, 25, 45, 180, 290]
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const hue = HUES[h % HUES.length]
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.36, background: `hsl(${hue} 65% 50% / 0.13)`, color: `hsl(${hue} 55% 38%)` }}
    >
      <span className="dark:brightness-[1.9]">{ini}</span>
    </span>
  )
}

export function Btn({ children, onClick, variant = 'primary', size = 'md', busy, disabled, type = 'button', className, title, form }: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  busy?: boolean
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
  title?: string
  form?: string
}) {
  return (
    <motion.button
      type={type}
      form={form}
      title={title}
      whileTap={{ scale: 0.97 }}
      transition={pop}
      disabled={disabled || busy}
      onClick={onClick}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold transition-colors disabled:opacity-50',
        size === 'md' ? 'h-11 px-5 text-[15px]' : 'h-9 px-4 text-[14px]',
        variant === 'primary' && 'bg-tint text-white hover:brightness-110 dark:text-black',
        variant === 'secondary' && 'bg-fill text-label hover:bg-fill-2',
        variant === 'ghost' && 'text-tint hover:bg-fill',
        variant === 'danger' && 'bg-[#ff3b30] text-white hover:brightness-110',
        className,
      )}
    >
      {busy && <Loader2 className="size-4 animate-spin" />}
      {children}
    </motion.button>
  )
}

export function IconBtn({ children, onClick, label, tone }: { children: ReactNode; onClick: () => void; label: string; tone?: 'danger' }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={clsx('grid size-9 place-items-center rounded-full text-label-2 transition-colors hover:bg-fill', tone === 'danger' ? 'hover:text-red' : 'hover:text-label')}
    >
      {children}
    </button>
  )
}

// ─── Formulário ───────────────────────────────────────────────

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[14px] font-medium text-label-2">
        {label}
      </label>
      {children(id)}
      {hint && <p className="mt-2 text-[13px] text-label-3">{hint}</p>}
    </div>
  )
}

export const inputCls =
  'h-12 w-full rounded-[14px] bg-fill px-4 text-[15.5px] text-label outline-none ring-tint/0 transition-[box-shadow,background] placeholder:text-label-3 focus:bg-surface focus:shadow-[0_0_0_2px_var(--color-tint),0_0_0_6px_color-mix(in_srgb,var(--color-tint)_14%,transparent)] disabled:opacity-60'

export function Input({ label, hint, ...props }: { label: string; hint?: ReactNode } & React.ComponentProps<'input'>) {
  return <Field label={label} hint={hint}>{(id) => <input id={id} {...props} className={clsx(inputCls, props.className)} />}</Field>
}

export function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <Field label={label}>
      {(id) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className={clsx(inputCls, 'appearance-none bg-[length:18px] bg-[right_14px_center] bg-no-repeat pr-10')} style={{ backgroundImage: CHEVRON }}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}
const CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23a1a1a6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`

/** Controle segmentado (filtros), como no iOS/macOS. */
export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; count?: number }[]; onChange: (v: T) => void }) {
  const id = useId()
  return (
    <div className="no-scrollbar inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-fill p-1">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button key={o.value} onClick={() => onChange(o.value)} className="relative z-0 flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium">
            {active && <motion.span layoutId={`tabs-${id}`} transition={pop} className="absolute inset-0 -z-10 rounded-full bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.1),0_1px_1px_rgba(0,0,0,0.04)] dark:bg-fill-2" />}
            <span className={active ? 'font-semibold text-label' : 'text-label-2'}>{o.label}</span>
            {o.count !== undefined && <span className={clsx('tabular text-[13px]', active ? 'text-label-2' : 'text-label-3')}>{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function SearchBox({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <label className={clsx('flex h-11 items-center gap-2.5 rounded-full bg-fill px-4 transition-[box-shadow,background] focus-within:bg-surface focus-within:shadow-[0_0_0_2px_var(--color-tint)]', className)}>
      <svg viewBox="0 0 24 24" className="size-[18px] shrink-0 text-label-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input data-search value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-label-3" />
      <kbd className="hidden h-6 min-w-6 place-items-center rounded-md bg-surface px-1.5 font-sans text-[12px] font-semibold text-label-3 shadow-[0_0_0_1px_var(--color-separator)] lg:grid">/</kbd>
    </label>
  )
}

/** Barra da lista: filtros à esquerda, busca e ações à direita. */
export function Toolbar({ tabs, children }: { tabs: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      {tabs}
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  )
}

// ─── Janela (modal) ───────────────────────────────────────────

export function Modal({ open, onClose, title, subtitle, children, footer, width = 540 }: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="absolute inset-0 bg-black/25 backdrop-blur-md dark:bg-black/60" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal
            aria-label={title}
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ duration: 0.28, ease }}
            className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-surface shadow-[var(--adm-pop)] sm:rounded-[28px]"
            style={{ maxWidth: width }}
          >
            <header className="flex items-start justify-between gap-4 px-8 pt-7">
              <div>
                <h2 className="font-display text-[24px] font-bold tracking-[-0.03em]">{title}</h2>
                {subtitle && <p className="mt-1 text-[14.5px] text-label-2">{subtitle}</p>}
              </div>
              <button onClick={onClose} aria-label="Fechar" className="grid size-8 shrink-0 place-items-center rounded-full bg-fill text-label-2 hover:bg-fill-2 hover:text-label">
                <X className="size-4" strokeWidth={2.5} />
              </button>
            </header>
            <div className="no-scrollbar overflow-y-auto px-8 pb-8 pt-6">{children}</div>
            {footer && <footer className="flex justify-end gap-2 px-8 pb-7">{footer}</footer>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** Confirmação para ações destrutivas. */
export function Confirm({ open, title, text, action = 'Confirmar', onConfirm, onClose }: { open: boolean; title: string; text: ReactNode; action?: string; onConfirm: () => Promise<void> | void; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={440}
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn
            variant="danger"
            busy={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
                onClose()
              } finally {
                setBusy(false)
              }
            }}
          >
            {action}
          </Btn>
        </>
      }
    >
      <p className="text-[15px] leading-relaxed text-label-2">{text}</p>
    </Modal>
  )
}

// ─── Menu suspenso ────────────────────────────────────────────

export function Menu({ trigger, items }: { trigger: ReactNode; items: ({ label: string; icon: ReactNode; onClick: () => void; danger?: boolean } | false)[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  const list = items.filter(Boolean) as Exclude<(typeof items)[number], false>[]
  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.16, ease }}
            className="absolute right-0 top-full z-30 mt-2 min-w-[230px] origin-top-right overflow-hidden rounded-[18px] bg-surface/95 p-1.5 shadow-[var(--adm-pop)] backdrop-blur-xl"
          >
            {list.map((i, k) => (
              <div key={i.label}>
                {i.danger && k > 0 && <div className="mx-3 my-1 h-px bg-separator" />}
                <button
                  onClick={() => (setOpen(false), i.onClick())}
                  className={clsx('flex h-10 w-full items-center gap-3 rounded-[12px] px-3 text-left text-[14.5px]', i.danger ? 'text-red hover:bg-red/8' : 'text-label hover:bg-fill')}
                >
                  <span className={clsx('[&>svg]:size-[17px]', !i.danger && 'text-label-2')}>{i.icon}</span>
                  {i.label}
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Aviso flutuante ──────────────────────────────────────────

let push: (msg: string, error?: boolean) => void = () => {}
export const notify = (msg: string) => push(msg)
export const notifyError = (msg: string) => push(msg, true)

export function AdminToaster() {
  const [items, setItems] = useState<{ id: number; msg: string; error?: boolean }[]>([])
  useEffect(() => {
    push = (msg, error) => {
      const id = Date.now() + Math.random()
      setItems((l) => [...l.slice(-2), { id, msg, error }])
      setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), error ? 5000 : 2600)
    }
  }, [])
  return createPortal(
    <div className="pointer-events-none fixed left-1/2 top-5 z-[70] flex w-[min(92vw,380px)] -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={pop}
            className="flex items-center gap-2.5 rounded-full bg-surface/95 py-2.5 pl-3 pr-5 text-[14.5px] font-medium shadow-[var(--adm-pop)] backdrop-blur-xl"
          >
            {t.error ? <CircleAlert className="size-5 shrink-0 text-red" /> : <CircleCheck className="size-5 shrink-0 text-tint" />}
            {t.msg}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  )
}

export function copy(text: string, msg = 'Copiado') {
  navigator.clipboard?.writeText(text).then(
    () => notify(msg),
    () => notifyError('Não foi possível copiar.'),
  )
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-20 text-center">
      <span className="mb-5 grid size-16 place-items-center rounded-full bg-tint/10 text-tint [&>svg]:size-7">{icon}</span>
      <p className="font-display text-[22px] font-bold tracking-[-0.03em]">{title}</p>
      <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-label-2">{text}</p>
      {action && <div className="mt-7">{action}</div>}
    </div>
  )
}

export const fmtDay = (iso: string) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '') : '—')

export function timeAgo(iso: string) {
  if (!iso) return 'nunca'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'agora'
  if (s < 3600) return `há ${Math.floor(s / 60)} min`
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`
  const d = Math.floor(s / 86400)
  return d === 1 ? 'ontem' : `há ${d} dias`
}
