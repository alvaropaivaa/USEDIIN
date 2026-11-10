import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { motion, useScroll, useTransform } from 'motion/react'
import NumberFlow from '@number-flow/react'
import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'
import { haptic } from '../lib/haptics'
import { isPrivate } from '../lib/format'
import { Mascot, type MascotPose } from './mascots'

export const spring = { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 } as const

// ─── Tela com cabeçalho centralizado e botões circulares ─────

/** Largura do conteúdo: coluna de celular; no computador, a área toda. */
export const pageWidth = 'mx-auto max-w-xl px-5 lg:max-w-[1200px] lg:px-8'

export function Screen({ title, subtitle, leading, trailing, children }: { title?: string; subtitle?: string; leading?: ReactNode; trailing?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollY } = useScroll({ container: ref })
  const barBg = useTransform(scrollY, [0, 16], [0, 1])

  return (
    <div ref={ref} className="no-scrollbar relative h-full overflow-y-auto overflow-x-hidden">
      {/* computador: faixa verde-escura atrás do título, como na tela inicial (o canto de dentro arredonda o conteúdo) */}
      <div className="band pointer-events-none absolute inset-x-0 top-0 hidden h-[112px] lg:block" />
      <div className="band-corner pointer-events-none absolute left-0 top-[112px] hidden size-8 lg:block" />
      <header className="pt-safe sticky top-0 z-30 lg:static">
        <motion.div style={{ opacity: barBg }} className="glass hairline-b absolute inset-0 lg:hidden" />
        {/* celular: título central pequeno; computador: título grande à esquerda e ações à direita */}
        <div className={clsx('relative flex h-16 items-center justify-center lg:h-[112px] lg:justify-between', pageWidth)}>
          <div className="absolute left-5 flex items-center gap-2 lg:static">{leading}</div>
          {title && (
            <div className="lg:mr-auto">
              <h1 className="text-[17px] font-bold lg:font-display lg:text-[24px] lg:leading-tight lg:tracking-[-0.03em] lg:text-white">{title}</h1>
              {subtitle && <p className="mt-0.5 hidden text-[13.5px] text-white/60 lg:block">{subtitle}</p>}
            </div>
          )}
          <div className="absolute right-5 flex items-center gap-2 lg:static">{trailing}</div>
        </div>
      </header>
      {/* embaixo, folga para a barra (celular) e para o botão flutuante do assistente */}
      <div className={clsx(pageWidth, 'pb-40 pt-2 lg:pb-24 lg:pt-6')}>{children}</div>
    </div>
  )
}

// ─── Lista agrupada (inset grouped) ───────────────────────────

export function SectionHeader({ children, action, onAction }: { children: ReactNode; action?: string; onAction?: () => void }) {
  return (
    <div className="mb-2.5 flex items-center justify-between px-1">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{children}</h2>
      {action && (
        <button onClick={() => (haptic(), onAction?.())} className="text-[13px] font-semibold text-tint">
          {action}
        </button>
      )}
    </div>
  )
}

export function Section({ header, action, onAction, footer, children, className }: { header?: ReactNode; action?: string; onAction?: () => void; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('mb-6', className)}>
      {header && <SectionHeader action={action} onAction={onAction}>{header}</SectionHeader>}
      <div className="overflow-hidden rounded-[22px] bg-surface shadow-card [&>*+*]:before:absolute [&>*+*]:before:left-4 [&>*+*]:before:right-0 [&>*+*]:before:top-0 [&>*+*]:before:h-px [&>*+*]:before:scale-y-50 [&>*+*]:before:bg-separator [&>*+*]:before:content-['']">
        {children}
      </div>
      {footer && <p className="mt-2 px-1 text-[12px] leading-[17px] text-label-2">{footer}</p>}
    </section>
  )
}

export function Row({ icon, label, detail, value, onClick, chevron }: {
  icon?: ReactNode
  label: ReactNode
  detail?: ReactNode
  value?: ReactNode
  onClick?: () => void
  chevron?: boolean
}) {
  const Comp = onClick ? motion.button : motion.div
  return (
    <Comp
      {...(onClick ? { type: 'button' as const } : {})}
      onClick={onClick ? () => (haptic(), onClick()) : undefined}
      whileTap={onClick ? { backgroundColor: 'var(--fill)' } : undefined}
      className={clsx('relative flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left', onClick && 'transition-colors hover:bg-fill/50')}
    >
      {icon && (
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-fill text-label-2">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{label}</span>
        {detail && <span className="mt-0.5 block truncate text-[12px] text-label-2">{detail}</span>}
      </span>
      {value !== undefined && <span className="tabular shrink-0 text-[15px] font-semibold">{value}</span>}
      {chevron && <ChevronRight className="size-4 shrink-0 text-label-3" strokeWidth={2.5} />}
    </Comp>
  )
}

// ─── Campos numéricos ─────────────────────────────────────────

const centsFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function FieldShell({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="relative flex min-h-[54px] items-center gap-3 px-4 py-2">
      <label htmlFor={htmlFor} className="shrink-0 text-[15px] font-medium text-label-2">
        {label}
      </label>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{children}</div>
    </div>
  )
}

const inputCls = 'tabular w-full min-w-0 bg-transparent text-right text-[16px] font-semibold text-label caret-tint outline-none focus:text-tint'

/** Campo monetário com máscara de centavos, como em apps bancários. */
export function MoneyField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const id = useId()
  return (
    <FieldShell label={label} htmlFor={id}>
      <input
        id={id}
        inputMode="numeric"
        className={clsx(inputCls, 'max-w-[62%]')}
        value={`R$ ${centsFmt.format(value)}`}
        onFocus={(e) => requestAnimationFrame(() => e.target.setSelectionRange(e.target.value.length, e.target.value.length))}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 13)
          onChange(Number(digits || 0) / 100)
        }}
      />
    </FieldShell>
  )
}

/** Campo decimal livre (aceita vírgula), sincronizado com o valor externo quando fora de foco. */
function DecimalInput({ id, value, onChange, scale = 1, digits = 4 }: { id: string; value: number; onChange: (v: number) => void; scale?: number; digits?: number }) {
  const fmt = (v: number) => (v * scale).toLocaleString('pt-BR', { maximumFractionDigits: digits })
  const [text, setText] = useState(fmt(value))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(fmt(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <input
      id={id}
      inputMode="decimal"
      className={clsx(inputCls, 'max-w-[45%]')}
      value={text}
      onFocus={(e) => {
        focused.current = true
        e.target.select()
      }}
      onBlur={() => {
        focused.current = false
        setText(fmt(value))
      }}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^\d,.]/g, '')
        setText(raw)
        // com vírgula: ponto é milhar ("1.234,5"); sem vírgula: um único ponto é decimal ("2.5")
        const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : (raw.match(/\./g) ?? []).length > 1 ? raw.replace(/\./g, '') : raw
        const n = parseFloat(normalized)
        onChange(isFinite(n) ? n / scale : 0)
      }}
    />
  )
}

export function PercentField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const id = useId()
  return (
    <FieldShell label={label} htmlFor={id}>
      <DecimalInput id={id} value={value} onChange={onChange} scale={100} />
      <span className="text-[15px] font-medium text-label-3">%</span>
    </FieldShell>
  )
}

export function NumberField({ label, value, onChange, suffix }: { label: string; value: number; onChange: (v: number) => void; suffix?: string }) {
  const id = useId()
  return (
    <FieldShell label={label} htmlFor={id}>
      <DecimalInput id={id} value={value} onChange={onChange} digits={1} />
      {suffix && <span className="text-[15px] font-medium text-label-3">{suffix}</span>}
    </FieldShell>
  )
}

// ─── Controles ────────────────────────────────────────────────

export function Segmented<T extends string>({ value, options, onChange, className }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; className?: string }) {
  const id = useId()
  return (
    <div role="tablist" className={clsx('relative mb-5 flex rounded-full bg-fill p-[3px]', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              if (!active) haptic()
              onChange(o.value)
            }}
            className="relative z-0 flex-1 rounded-full px-2 py-1.5 text-[13px] font-medium"
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                transition={spring}
                className="absolute inset-0 -z-10 rounded-full bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.1),0_0_0_0.5px_rgba(0,0,0,0.04)] dark:bg-surface-2"
              />
            )}
            <span className={clsx('transition-colors', active ? 'font-semibold text-label' : 'text-label-2')}>{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function Toggle({ label, detail, checked, onChange }: { label: string; detail?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => {
        haptic('medium')
        onChange(!checked)
      }}
      className="relative flex min-h-[54px] w-full items-center gap-3 px-4 py-2 text-left"
    >
      <span className="flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        {detail && <span className="block text-[12px] text-label-2">{detail}</span>}
      </span>
      <span className={clsx('relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200', checked ? 'bg-tint' : 'bg-fill-2')}>
        <motion.span
          layout
          transition={spring}
          className="absolute top-[2px] size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_3px_1px_rgba(0,0,0,0.06)]"
          style={{ left: checked ? 22 : 2 }}
        />
      </span>
    </button>
  )
}

export function Button({ children, onClick, variant = 'filled', className }: { children: ReactNode; onClick?: () => void; variant?: 'filled' | 'tinted' | 'plain' | 'danger'; className?: string }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.97, opacity: 0.85 }}
      transition={spring}
      onClick={() => {
        haptic('medium')
        onClick?.()
      }}
      className={clsx(
        'flex h-[50px] w-full items-center justify-center gap-2 rounded-[20px] text-[15px] font-semibold',
        variant === 'filled' && 'grad-btn text-white',
        variant === 'tinted' && 'bg-surface text-label shadow-card',
        variant === 'plain' && 'text-tint',
        variant === 'danger' && 'text-red',
        className,
      )}
    >
      {children}
    </motion.button>
  )
}

export function IconButton({ children, onClick, label }: { children: ReactNode; onClick: () => void; label: string }) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      whileTap={{ scale: 0.88 }}
      onClick={() => {
        haptic()
        onClick()
      }}
      className="grid size-10 place-items-center rounded-full bg-surface text-label shadow-card"
    >
      {children}
    </motion.button>
  )
}

// ─── Resultados ───────────────────────────────────────────────

const currencyFormat = { style: 'currency', currency: 'BRL' } as const

export function Money({ value, className }: { value: number; className?: string }) {
  if (!isFinite(value)) return <span className={className}>—</span>
  if (isPrivate()) return <span className={clsx('tabular', className)}>R$ ••••</span>
  return <NumberFlow value={value} locales="pt-BR" format={currencyFormat} className={clsx('tabular', className)} willChange />
}

/** Cartão de destaque em gradiente verde, como um cartão de saldo. */
export function Hero({ label, children, caption, icon }: { label: string; children: ReactNode; caption?: ReactNode; icon?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="grad-green relative mb-5 overflow-hidden rounded-[24px] p-5 text-white"
    >
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-white/60">{label}</p>
          <div className="tabular mt-1 truncate text-[30px] font-semibold leading-tight tracking-[-0.03em]">{children}</div>
        </div>
        {icon && <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-white/80">{icon}</span>}
      </div>
      {caption && <div className="relative mt-2 text-[13px] text-white/60">{caption}</div>}
    </motion.div>
  )
}

export function Stats({ items }: { items: { label: string; value: ReactNode; tone?: 'green' | 'red' | 'indigo' }[] }) {
  return (
    <div className="mb-7 grid grid-cols-2 gap-3">
      {items.map((it) => (
        <div key={it.label} className="rounded-[22px] bg-surface p-4 shadow-card">
          <p className="text-[12px] font-medium text-label-2">{it.label}</p>
          <p
            className={clsx(
              'mt-1 truncate text-[17px] font-bold',
              it.tone === 'green' && 'text-green',
            )}
          >
            {it.value}
          </p>
        </div>
      ))}
    </div>
  )
}

/** Tela vazia: o mascote numa pose (`art`) ou um ícone cinza, com título e explicação. */
export function Empty({ icon, art, title, text }: { icon?: ReactNode; art?: MascotPose; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center px-8 py-10 text-center">
      {art ? <Mascot pose={art} className="mb-4 h-[128px] w-auto" /> : <div className="mb-3 text-label-3">{icon}</div>}
      <p className="text-[17px] font-semibold">{title}</p>
      <p className="mt-1 text-[15px] text-label-2">{text}</p>
    </div>
  )
}

// ─── Gestão: avatar, status, filtros, campos ──────────────────

/** Iniciais das duas primeiras palavras, ignorando sinais ("Lucas (irmão)" → "LI"). */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w.match(/[\p{L}\p{N}]/u)?.[0])
    .filter(Boolean)
    .slice(0, 2)
    .map((c) => c!.toUpperCase())
    .join('')

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-fill font-semibold text-label-2"
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {initials(name)}
    </span>
  )
}

export type Tone = 'green' | 'red' | 'blue' | 'gray'

const toneCls: Record<Tone, string> = {
  green: 'bg-tint/12 text-green',
  red: 'bg-red/10 text-red',
  blue: 'bg-blue/10 text-blue',
  gray: 'bg-fill text-label-2',
}

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={clsx('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', toneCls[tone])}>{children}</span>
}

/** Filtros em pílulas roláveis. */
export function Chips<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; count?: number }[]; onChange: (v: T) => void }) {
  return (
    <div className="no-scrollbar -mx-5 mb-4 flex gap-2 overflow-x-auto px-5">
      {options.map((o) => {
        const active = o.value === value
        return (
          <motion.button
            key={o.value}
            type="button"
            whileTap={{ scale: 0.94 }}
            onClick={() => {
              if (!active) haptic()
              onChange(o.value)
            }}
            className={clsx(
              'shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors',
              active ? 'bg-label text-bg' : 'bg-surface text-label-2 shadow-card',
            )}
          >
            {o.label}
            {o.count !== undefined && <span className={clsx('ml-1.5', active ? 'opacity-60' : 'text-label-3')}>{o.count}</span>}
          </motion.button>
        )
      })}
    </div>
  )
}

export function TextField({ label, value, onChange, placeholder, type = 'text', inputMode }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: 'text' | 'tel' | 'date' | 'month'
  inputMode?: 'text' | 'tel'
}) {
  const id = useId()
  return (
    <FieldShell label={label} htmlFor={id}>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={clsx(inputCls, 'max-w-[65%] placeholder:font-medium placeholder:text-label-3', type === 'date' && 'appearance-none')}
      />
    </FieldShell>
  )
}

/** Escolha numa lista, no mesmo formato dos outros campos (rótulo à esquerda, valor à direita). */
export function SelectField<T extends string>({ label, value, onChange, options, placeholder }: {
  label: string
  value: T | ''
  onChange: (v: T) => void
  options: { value: T; label: string; group?: string }[]
  placeholder?: string
}) {
  const id = useId()
  const groups = [...new Set(options.map((o) => o.group ?? ''))]
  const render = (list: typeof options) =>
    list.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))
  return (
    <FieldShell label={label} htmlFor={id}>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={clsx('min-w-0 flex-1 appearance-none truncate bg-transparent text-right text-[16px] font-semibold outline-none', value ? 'text-label' : 'text-label-3')}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {groups.length > 1
          ? groups.map((g) => (
              <optgroup key={g} label={g}>
                {render(options.filter((o) => (o.group ?? '') === g))}
              </optgroup>
            ))
          : render(options)}
      </select>
      <ChevronRight className="size-4 shrink-0 rotate-90 text-label-3" strokeWidth={2.5} />
    </FieldShell>
  )
}

/** Máscara de telefone brasileiro: (11) 98765-4321. */
export const maskPhone = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

const progressCls = { green: 'bg-tint', orange: 'bg-orange', red: 'bg-red' } as const

/** Barra de progresso; `tone` muda a cor (teto de gastos: verde → laranja → vermelho). */
export function Progress({ value, className, tone = 'green' }: { value: number; className?: string; tone?: keyof typeof progressCls }) {
  return (
    <div className={clsx('h-1.5 overflow-hidden rounded-full bg-fill', className)}>
      <motion.div
        className={clsx('h-full rounded-full transition-colors', progressCls[tone])}
        initial={false}
        // 0 ÷ 0 (sem limite, sem meta) vira barra vazia, não "NaN%"
        animate={{ width: `${isFinite(value) ? Math.min(100, Math.max(0, value * 100)) : 0}%` }}
        transition={spring}
      />
    </div>
  )
}

/** Cartão pequeno de métrica (grade 2×2 da tela inicial). */
export function StatCard({ label, value, hint, tone, onClick }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; onClick?: () => void }) {
  const Comp = onClick ? motion.button : motion.div
  return (
    <Comp
      {...(onClick ? { type: 'button' as const } : {})}
      whileTap={onClick ? { scale: 0.97 } : undefined}
      onClick={onClick ? () => (haptic(), onClick()) : undefined}
      className="min-w-0 rounded-[22px] bg-surface p-4 text-left shadow-card"
    >
      <p className="text-[12px] font-medium text-label-2">{label}</p>
      <p
        className={clsx(
          'tabular mt-1 truncate text-[17px] font-semibold tracking-[-0.02em]',
          tone === 'green' && 'text-green',
          tone === 'red' && 'text-red',
          tone === 'blue' && 'text-blue',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 truncate text-[11px] font-medium text-label-2">{hint}</p>}
    </Comp>
  )
}
