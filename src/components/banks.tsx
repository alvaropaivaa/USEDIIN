import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react'
import { AnimatePresence, motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring } from 'motion/react'
import { Check, ChevronRight, Search, X } from 'lucide-react'
import clsx from 'clsx'
import { haptic } from '../lib/haptics'
import { allBanks, bankLogo, popularBanks, searchBanks, skinOf, skinsFor, useBankName, type BankInfo, type CardSkin } from '../lib/banks'
import type { Account, AccountKind, CardBrand } from '../lib/ledger'
import { CategoryIcon } from './finance'
import { Section, initials } from './ui'

// ─── Logo do banco ───────────────────────────────────────────

const filler = /^(banco|de|do|da|dos|das|e|s\.?\/?a\.?|ltda\.?|-)$/i

/** Iniciais sem "Banco", "de", "S.A." ("Banco Caixa Geral" → CG); sem nome, a das iniciais comuns. */
const bankInitials = (name: string) => {
  const words = name
    .split(/\s+/)
    .filter((w) => !filler.test(w))
    .map((w) => w.replace(/[^\p{L}\d]/gu, ''))
    .filter(Boolean)
  return (words.length ? words.slice(0, 2).map((w) => w[0].toLocaleUpperCase('pt-BR')).join('') : initials(name)) || '?'
}

/** Logo do banco num círculo branco; sem logo publicada, as iniciais no círculo cinza. */
export function BankLogo({ ispb, name, size = 40, className }: { ispb?: string; name: string; size?: number; className?: string }) {
  const url = bankLogo(ispb)
  const [failed, setFailed] = useState<string>()
  // as logos do Open Finance são quadradas; as poucas que não são ficam inteiras, com respiro
  const [wide, setWide] = useState<string>()
  if (!url || failed === url)
    return (
      <span className={clsx('grid shrink-0 place-items-center rounded-full bg-fill font-semibold text-label', className)} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
        {bankInitials(name)}
      </span>
    )
  return (
    <span className={clsx("relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-white after:pointer-events-none after:absolute after:inset-0 after:rounded-full after:shadow-[inset_0_0_0_1px_rgba(15,21,18,0.08)] after:content-['']", className)} style={{ width: size, height: size }}>
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(url)}
        onLoad={(e) => Math.abs(e.currentTarget.naturalWidth / (e.currentTarget.naturalHeight || 1) - 1) > 0.04 && setWide(url)}
        className={clsx('size-full', wide === url ? 'object-contain p-[18%]' : 'object-cover')}
      />
    </span>
  )
}

const kindIcon: Record<AccountKind, string> = { corrente: 'banco', poupanca: 'cofrinho', carteira: 'carteira', investimento: 'investimento', beneficio: 'restaurante', outro: 'dinheiro' }

/** Ícone de uma conta: a logo do banco ou, sem banco, o ícone do tipo de conta. */
export function AccountIcon({ account, size = 40, onDark }: { account: Pick<Account, 'kind' | 'name' | 'bank'>; size?: number; onDark?: boolean }) {
  if (account.bank) return <BankLogo ispb={account.bank} name={account.name} size={size} />
  return <CategoryIcon category={{ icon: kindIcon[account.kind] }} size={size} onDark={onDark} />
}

// ─── Escolha do banco ────────────────────────────────────────

/** Linha "Banco" de um formulário: logo e nome do escolhido. */
export function BankField({ value, onClick, label = 'Banco' }: { value?: string; onClick: () => void; label?: string }) {
  const name = useBankName(value)
  return (
    <motion.button
      type="button"
      onClick={() => (haptic(), onClick())}
      whileTap={{ backgroundColor: 'var(--fill)' }}
      className="relative flex min-h-[54px] w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-fill/50"
    >
      <span className="shrink-0 text-[15px] font-medium text-label-2">{label}</span>
      <span className="flex min-w-0 flex-1 items-center justify-end gap-2">
        {value ? (
          <>
            <BankLogo ispb={value} name={name ?? ''} size={26} />
            <span className="truncate text-[16px] font-semibold">{name ?? 'Banco'}</span>
          </>
        ) : (
          <span className="truncate text-[16px] font-semibold text-label-3">Escolha</span>
        )}
      </span>
      <ChevronRight className="size-4 shrink-0 text-label-3" strokeWidth={2.5} />
    </motion.button>
  )
}

/**
 * Seletor de banco: os mais usados em grade e a busca por nome ou número entre todas as
 * instituições autorizadas pelo Banco Central.
 */
export function BankPicker({ value, onPick, noneLabel }: { value?: string; onPick: (bank: BankInfo | null) => void; noneLabel?: string }) {
  const [q, setQ] = useState('')
  const [list, setList] = useState<BankInfo[] | null>(null)
  const top = useRef<HTMLDivElement>(null)

  useEffect(() => {
    top.current?.scrollIntoView({ block: 'start' })
    let live = true
    void allBanks().then((l) => live && setList(l))
    return () => {
      live = false
    }
  }, [])

  const results = useMemo(() => (list && q.trim() ? searchBanks(list, q) : []), [list, q])
  const pick = (b: BankInfo | null) => (haptic(), onPick(b))

  return (
    // altura fixa no celular: o painel não encolhe e cresce a cada letra da busca
    <div ref={top} className="min-h-[74dvh] scroll-mt-2 lg:min-h-0">
      <label className="mb-5 flex h-11 items-center gap-2 rounded-full bg-surface px-4 shadow-card">
        <Search className="size-[18px] shrink-0 text-label-3" strokeWidth={2.2} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Busque pelo nome ou número"
          aria-label="Buscar banco"
          enterKeyHint="search"
          className="min-w-0 flex-1 bg-transparent text-[16px] font-medium outline-none placeholder:text-label-3"
        />
        {q && (
          <button type="button" aria-label="Limpar busca" onClick={() => setQ('')} className="grid size-6 place-items-center rounded-full bg-fill-2 text-label-2">
            <X className="size-3.5" strokeWidth={2.5} />
          </button>
        )}
      </label>

      {q.trim() ? (
        <Section header={list ? 'Resultados' : 'Carregando…'}>
          {list && results.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-label-2">Nenhuma instituição com esse nome ou número.</p>
          ) : (
            results.map((b) => (
              <motion.button
                key={b.ispb}
                type="button"
                onClick={() => pick(b)}
                whileTap={{ backgroundColor: 'var(--fill)' }}
                className="relative flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-fill/50"
              >
                <BankLogo ispb={b.ispb} name={b.name} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{b.name}</span>
                  {b.compe && <span className="tabular mt-0.5 block text-[12px] text-label-2">Banco {b.compe}</span>}
                </span>
                {b.ispb === value && <Check className="size-[18px] shrink-0 text-tint" strokeWidth={2.5} />}
              </motion.button>
            ))
          )}
        </Section>
      ) : (
        <>
          <Section header="Mais usados">
            <div className="grid grid-cols-4 gap-x-1 gap-y-4 px-2 py-4 min-[420px]:grid-cols-5">
              {popularBanks.map((b) => {
                const on = b.ispb === value
                return (
                  <motion.button key={b.ispb} type="button" whileTap={{ scale: 0.92 }} onClick={() => pick(b)} aria-pressed={on} className="flex min-w-0 flex-col items-center gap-1.5 px-1">
                    <span className={clsx('relative rounded-full ring-offset-2 ring-offset-surface transition-shadow', on && 'ring-2 ring-label')}>
                      <BankLogo ispb={b.ispb} name={b.name} size={48} />
                    </span>
                    <span className={clsx('line-clamp-2 w-full text-center text-[11.5px] leading-[14px]', on ? 'font-semibold text-label' : 'font-medium text-label-2')}>{b.name}</span>
                  </motion.button>
                )
              })}
            </div>
          </Section>
          {noneLabel && (
            <Section>
              <motion.button
                type="button"
                onClick={() => pick(null)}
                whileTap={{ backgroundColor: 'var(--fill)' }}
                className="relative flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-fill/50"
              >
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{noneLabel}</span>
                {!value && <Check className="size-[18px] shrink-0 text-tint" strokeWidth={2.5} />}
              </motion.button>
            </Section>
          )}
          <p className="-mt-3 mb-6 px-1 text-[12px] leading-[17px] text-label-2">
            Não achou? Busque entre as {list?.length ?? 460} instituições autorizadas pelo Banco Central. As logos são das próprias instituições e aparecem só para identificar suas contas.
          </p>
        </>
      )}
    </div>
  )
}

// ─── Cartão 3D ───────────────────────────────────────────────

/** Bandeira do cartão, desenhada no canto como no plástico. */
export function NetworkMark({ brand, ink }: { brand?: CardBrand; ink: 'light' | 'dark' }) {
  const fg = ink === 'light' ? '#ffffff' : '#1a1f71'
  if (brand === 'mastercard')
    return (
      <svg viewBox="0 0 40 25" className="h-[8.2cqw] w-auto" aria-label="Mastercard">
        <circle cx="12.5" cy="12.5" r="12.5" fill="#EB001B" />
        <circle cx="27.5" cy="12.5" r="12.5" fill="#F79E1B" />
        <path d="M20 2.5A12.5 12.5 0 0 1 20 22.5A12.5 12.5 0 0 1 20 2.5Z" fill="#FF5F00" />
      </svg>
    )
  if (brand === 'visa')
    return (
      <span className="text-[7.4cqw] font-black italic leading-none tracking-[-0.04em]" style={{ color: fg }} aria-label="Visa">
        VISA
      </span>
    )
  if (brand === 'elo')
    return (
      <span className="flex items-center gap-[1cqw] text-[6.6cqw] font-extrabold leading-none tracking-[-0.03em]" style={{ color: ink === 'light' ? '#fff' : '#111' }} aria-label="Elo">
        <span className="flex flex-col gap-[0.5cqw]">
          <i className="block size-[1.3cqw] rounded-full bg-[#FFCB05]" />
          <i className="block size-[1.3cqw] rounded-full bg-[#00A4E0]" />
          <i className="block size-[1.3cqw] rounded-full bg-[#EF4123]" />
        </span>
        elo
      </span>
    )
  if (brand === 'amex')
    return (
      <span className="grid h-[8.4cqw] place-items-center rounded-[1.2cqw] bg-[#2E77BC] px-[1.8cqw] text-[3.5cqw] font-black leading-none tracking-[0.04em] text-white" aria-label="American Express">
        AMEX
      </span>
    )
  if (brand === 'hipercard')
    return (
      <span className="grid h-[7.4cqw] place-items-center rounded-[1.2cqw] bg-[#B3131B] px-[2cqw] text-[3.6cqw] font-bold italic leading-none text-white" aria-label="Hipercard">
        Hipercard
      </span>
    )
  return null
}

/** Chip EMV dourado. */
function Chip() {
  const id = useId()
  return (
    <svg viewBox="0 0 52 40" className="h-auto w-[12.5cqw]" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6e7b4" />
          <stop offset="0.45" stopColor="#d9b96e" />
          <stop offset="1" stopColor="#a5813a" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="51" height="39" rx="7" fill={`url(#${id})`} stroke="rgba(70,48,10,0.35)" />
      <g fill="none" stroke="rgba(90,62,15,0.5)" strokeWidth="1.1">
        <path d="M0 13.5h17M0 26.5h17M35 13.5h17M35 26.5h17M17 0v40M35 0v40" />
        <rect x="17" y="10" width="18" height="20" rx="4" />
      </g>
    </svg>
  )
}

/** Símbolo de pagamento por aproximação. */
function Contactless({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-auto w-[5.8cqw]" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M8.5 9a4.5 4.5 0 0 1 0 6M12 6.5a8 8 0 0 1 0 11M15.5 4a11.5 11.5 0 0 1 0 16" opacity="0.9" />
      <path d="M5 11a1.5 1.5 0 0 1 0 2" opacity="0.9" />
    </svg>
  )
}

const grain = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0.55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`

const finishBg: Record<NonNullable<CardSkin['finish']>, string> = {
  carbon: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.045) 0 1.5px, transparent 1.5px 4px), repeating-linear-gradient(-45deg, rgba(0,0,0,0.35) 0 1.5px, transparent 1.5px 4px)',
  metal: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 3px), linear-gradient(100deg, transparent 20%, rgba(255,255,255,0.08) 45%, transparent 70%)',
}

export interface CardLook {
  name: string
  bank?: string
  skin?: string
  brand?: CardBrand
  last4?: string
  holder?: string
  /** Cor antiga do cartão (escolhe o modelo genérico parecido quando não há modelo). */
  color?: string
}

/**
 * Cartão de crédito em 3D: o plástico com as cores do banco, chip, aproximação, bandeira e
 * os quatro últimos dígitos. Inclina acompanhando o dedo ou o mouse e reflete a luz.
 * `bare` desenha só o plástico (miniaturas).
 */
export function CreditCard3D({ card, interactive = true, bare, className }: { card: CardLook; interactive?: boolean; bare?: boolean; className?: string }) {
  const skin = skinOf(card)
  const reduce = useReducedMotion()
  const tilt = interactive && !reduce
  const rx = useSpring(0, { stiffness: 180, damping: 18 })
  const ry = useSpring(tilt ? -16 : 0, { stiffness: 120, damping: 16 })
  const lx = useMotionValue(30)
  const ly = useMotionValue(20)
  const glow = useSpring(0, { stiffness: 200, damping: 30 })
  const sheen = useMotionTemplate`radial-gradient(75% 95% at ${lx}% ${ly}%, rgba(255,255,255,0.28), rgba(255,255,255,0) 62%)`

  // chega girando de leve na primeira vez
  useEffect(() => {
    if (tilt) ry.set(0)
  }, [tilt, ry])

  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!tilt) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    ry.set((x - 0.5) * 20)
    rx.set((0.5 - y) * 16)
    lx.set(x * 100)
    ly.set(y * 100)
    glow.set(1)
  }
  const leave = () => {
    rx.set(0)
    ry.set(0)
    lx.set(30)
    ly.set(20)
    glow.set(0)
  }

  const light = skin.ink === 'light'
  const text = light ? '#ffffff' : '#17181a'
  const logo = bankLogo(card.bank)

  return (
    // a largura vem de quem usa (bloco ocupa a linha; em flex, passe uma largura em className)
    <div className={clsx('@container relative select-none', className)} style={{ perspective: 1100 }}>
      <motion.div
        onPointerMove={move}
        onPointerLeave={leave}
        onPointerCancel={leave}
        style={{ rotateX: rx, rotateY: ry, transformStyle: 'preserve-3d', aspectRatio: '85.6 / 53.98' }}
        className="relative w-full"
      >
        {/* plástico */}
        <div
          className="absolute inset-0 overflow-hidden rounded-[4.6cqw]"
          style={{
            boxShadow: bare
              ? '0 1px 2px rgba(0,0,0,0.18), 0 6px 14px -8px rgba(0,0,0,0.45)'
              : '0 1px 2px rgba(0,0,0,0.2), 0 22px 40px -18px rgba(0,0,0,0.55), 0 10px 18px -12px rgba(0,0,0,0.35)',
          }}
        >
          <AnimatePresence initial={false}>
            <motion.div key={skin.id} className="absolute inset-0" style={{ background: skin.bg }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} />
          </AnimatePresence>
          {skin.finish && <div className="absolute inset-0" style={{ background: finishBg[skin.finish], backgroundSize: skin.finish === 'carbon' ? '6px 6px, 6px 6px, auto' : undefined }} />}
          {/* luz fixa vinda do alto e granulado do plástico */}
          <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 0% 0%, rgba(255,255,255,0.16), rgba(255,255,255,0) 55%)' }} />
          <div className="absolute inset-0 opacity-[0.22] mix-blend-overlay" style={{ backgroundImage: grain }} />
          {/* reflexo que acompanha o ponteiro */}
          {tilt && <motion.div className="absolute inset-0 mix-blend-soft-light" style={{ background: sheen, opacity: glow }} />}
          <div
            className="absolute inset-0 rounded-[4.6cqw]"
            style={{ boxShadow: light ? 'inset 0 0 0 1px rgba(255,255,255,0.10), inset 0 1px 0 rgba(255,255,255,0.22)' : 'inset 0 0 0 1px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.6)' }}
          />
        </div>

        {/* impressão, um pouco à frente do plástico */}
        <div className="absolute inset-0 flex flex-col p-[6.4cqw]" style={{ transform: 'translateZ(10px)', color: text }}>
          <div className="flex items-center gap-[2.6cqw]">
            {logo && (
              <span className="grid size-[9.6cqw] shrink-0 place-items-center overflow-hidden rounded-[2.4cqw] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)]">
                <img src={logo} alt="" draggable={false} className="size-full object-cover" />
              </span>
            )}
            {!bare && <span className="min-w-0 flex-1 truncate text-[4.6cqw] font-semibold tracking-[-0.01em]">{card.name || 'Seu cartão'}</span>}
            {bare && <span className="flex-1" />}
            <Contactless color={light ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.6)'} />
          </div>

          <div className="mt-[6.5cqw]">
            <Chip />
          </div>

          <div className="mt-auto flex items-end justify-between gap-[3cqw]">
            {!bare ? (
              <div className="min-w-0">
                <p
                  className="tabular whitespace-nowrap text-[4.5cqw] font-semibold tracking-[0.14em]"
                  style={{ textShadow: light ? '0 -1px 0 rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.12)' : '0 1px 0 rgba(255,255,255,0.5)' }}
                >
                  •••• {card.last4 || '••••'}
                </p>
                {card.holder && <p className="mt-[1.2cqw] truncate text-[3cqw] font-medium uppercase tracking-[0.12em] opacity-80">{card.holder}</p>}
              </div>
            ) : (
              <span />
            )}
            <span className="shrink-0">
              <NetworkMark brand={card.brand} ink={skin.ink} />
            </span>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

/** Miniatura do plástico para listas (faturas, agenda). */
export function CardThumb({ card, width = 40 }: { card: CardLook; width?: number }) {
  return (
    <span className="block shrink-0" style={{ width }}>
      <CreditCard3D card={card} interactive={false} bare />
    </span>
  )
}

/** Modelos de cartão do banco escolhido (e os genéricos), em miniatura. */
export function SkinPicker({ card, onChange }: { card: CardLook; onChange: (skin: string) => void }) {
  const skins = skinsFor(card.bank)
  const current = skinOf(card).id
  return (
    <div className="relative py-3">
      <p className="mb-2.5 px-4 text-[15px] font-medium text-label-2">Modelo do cartão</p>
      <div role="radiogroup" aria-label="Modelo do cartão" className="no-scrollbar flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 pt-1">
        {skins.map((s) => {
          const on = s.id === current
          return (
            <motion.button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={on}
              whileTap={{ scale: 0.95 }}
              onClick={() => (haptic(), onChange(s.id))}
              className="flex w-[96px] shrink-0 snap-start flex-col items-center gap-1.5"
            >
              <span className={clsx('block w-full rounded-[5px] ring-offset-2 ring-offset-surface transition-shadow', on && 'ring-2 ring-label')}>
                <CreditCard3D card={{ ...card, skin: s.id }} interactive={false} bare />
              </span>
              <span className={clsx('w-full truncate text-center text-[11.5px]', on ? 'font-semibold text-label' : 'font-medium text-label-2')}>{s.name}</span>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
