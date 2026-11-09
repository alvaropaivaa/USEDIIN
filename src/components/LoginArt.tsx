// Ilustrações do login: o painel verde do computador (uma ilustração por frase) e o topo verde do celular.
// Tudo desenhado aqui, com os ícones, as cores e as logos do próprio Dinn. Os valores são de exemplo.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, type MotionStyle } from 'motion/react'
import {
  CalendarClock,
  Car,
  Check,
  FileText,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  HeartPulse,
  MessageCircle,
  Plane,
  ShoppingCart,
  Target,
  Umbrella,
  Utensils,
  type LucideIcon,
} from 'lucide-react'
import clsx from 'clsx'
import { bankLogo, popularBanks } from '../lib/banks'
import { aiEnabled } from '../lib/features'
import mascotCloud from '../assets/mascote-nuvem.webp'
import mascotNotices from '../assets/mascote-avisos.webp'
import mascotJars from '../assets/mascote-categorias.webp'
import mascotChat from '../assets/mascote-whatsapp.webp'
import mascotGoals from '../assets/mascote-metas.webp'
import dinnIcon from '../assets/dinn-icone.webp'

const ease = [0.22, 1, 0.36, 1] as const

/** Largura e altura de um elemento, atualizadas quando a janela muda. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

// ─── anel de bancos ───

/**
 * Logos dos bancos em quadradinhos brancos, juntinhos num anel grande que gira bem devagar. O centro do
 * anel fica abaixo da área visível, então só aparece o arco de cima. `tile` é o lado do quadradinho.
 */
function BankRing({ tile, radius, cx, cy }: { tile: number; radius: number; cx: number; cy: number }) {
  // um quadradinho a cada 1,25 lado: o arco fica cheio, com pouco espaço entre eles
  const count = Math.max(12, Math.round((2 * Math.PI * radius) / (tile * 1.25)))
  // com mais lugares do que bancos, a lista recomeça (cada volta ganha a sua chave)
  const banks = Array.from({ length: count }, (_, i) => {
    const b = popularBanks[i % popularBanks.length]
    return { ...b, id: `${b.ispb}-${Math.floor(i / popularBanks.length)}` }
  })
  return (
    <div className="ring-spin absolute size-0" style={{ left: cx, top: cy }} aria-hidden>
      {banks.map((b, i) => {
        const url = bankLogo(b.ispb)
        return (
          <span
            key={b.id}
            className="absolute"
            style={{ left: -tile / 2, top: -tile / 2, width: tile, height: tile, transform: `rotate(${(360 * i) / count}deg) translateY(${-radius}px)` }}
          >
            <motion.span
              className="bank-tile grid size-full place-items-center p-[15%]"
              style={{ borderRadius: tile * 0.28 }}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, ease, delay: 0.05 + (i % 14) * 0.035 }}
            >
              {url ? (
                <img src={url} alt="" draggable={false} className="size-full rounded-[24%] object-contain select-none" />
              ) : (
                <span className="text-[13px] font-semibold text-[#0f1512]">{b.name.slice(0, 2)}</span>
              )}
            </motion.span>
          </span>
        )
      })}
    </div>
  )
}

/**
 * Primeira ilustração: o arco de bancos andando numa trilha e, na frente, o mascote do Dinn na nuvem.
 * Tudo medido em `u` (a largura útil, até 600px): não cresce sem parar em tela grande.
 */
function BanksArt({ w, h, mobile = false }: { w: number; h: number; mobile?: boolean }) {
  // o quadradinho mais alto fica a uns 60px do topo da área; no celular o anel pode passar das bordas
  const u = Math.max(300, Math.min(600, w * (mobile ? 1.1 : 0.86), (h - 60) / 0.568))
  const tile = u * 0.136
  const radius = u * 0.778
  // `base`: onde a montagem se apoia. No computador é o pé da área; no celular, com sobra de altura,
  // a montagem sobe até ficar no meio do espaço livre
  const base = mobile ? Math.min(h, (h + 60 + u * 0.568) / 2) : h
  // centro do anel abaixo do mascote; o mascote logo acima das frases
  const cy = base + u * 0.278
  const fade = 'linear-gradient(180deg, #000 calc(100% - 70px), transparent)'
  return (
    <>
      {/* o pé do anel some num degradê antes das frases */}
      <div className="absolute inset-0 overflow-hidden" style={{ maskImage: fade, WebkitMaskImage: fade }}>
        {[radius - tile * 0.72, radius + tile * 0.72].map((r) => (
          <span key={r} className="orbit absolute" style={{ width: r * 2, height: r * 2, left: w / 2 - r, top: cy - r }} />
        ))}
        <BankRing tile={tile} radius={radius} cx={w / 2} cy={cy} />
      </div>
      <CloudMascot x={w / 2} y={base - u * 0.24} height={u * 0.4} />
    </>
  )
}

// ─── peças comuns das outras ilustrações ───

/** O mascote do Dinn (uma pose por frase), boiando devagar, com a sombra no chão. (x, y) é o centro da imagem. */
function CloudMascot({ x, y, height, delay = 0.25, src = mascotCloud }: { x: number; y: number; height: number; delay?: number; src?: string }) {
  return (
    <>
      <span
        className="pointer-events-none absolute rounded-[50%]"
        style={{ width: height * 1.1, height: height * 0.16, left: x - height * 0.55, top: y + height * 0.4, background: 'radial-gradient(closest-side, rgba(0, 0, 0, 0.4), transparent)' }}
      />
      <motion.img
        src={src}
        alt=""
        draggable={false}
        className="absolute -translate-x-1/2 -translate-y-1/2 select-none"
        style={{ left: x, top: y, height }}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: [0, -5, 0] }}
        transition={{ opacity: { duration: 0.6, delay }, y: { duration: 4.5, repeat: Infinity, ease: 'easeInOut', delay } }}
      />
    </>
  )
}

/** Círculos finos em volta do mascote, como a trilha dos bancos; somem para fora. */
function Ripples({ x, y }: { x: number; y: number }) {
  const size = 600
  const mask = 'radial-gradient(closest-side, #000 40%, transparent)'
  return (
    <div className="pointer-events-none absolute" style={{ left: x - size / 2, top: y - size / 2, width: size, height: size, maskImage: mask, WebkitMaskImage: mask }} aria-hidden>
      {[110, 180, 250].map((r) => (
        <span key={r} className="orbit absolute" style={{ width: r * 2, height: r * 2, left: size / 2 - r, top: size / 2 - r }} />
      ))}
    </div>
  )
}

/** Quadradinho branco com um ícone, boiando devagar. */
function FloatTile({ icon: Icon, size, x, y, r, delay = 0 }: { icon: LucideIcon; size: number; x: number; y: number; r: number; delay?: number }) {
  return (
    <motion.span
      className="float-tile absolute grid place-items-center"
      style={{ left: x, top: y, width: size, height: size, borderRadius: size * 0.29, rotate: r }}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1, y: [0, -8, 0] }}
      transition={{ opacity: { duration: 0.5, delay }, scale: { duration: 0.6, ease, delay }, y: { duration: 5, repeat: Infinity, ease: 'easeInOut', delay: delay + 0.6 } }}
    >
      <Icon style={{ width: size * 0.42, height: size * 0.42 }} strokeWidth={1.75} />
    </motion.span>
  )
}

/** Cartão branco que sobe ao aparecer. */
function Card({ children, className, style, delay = 0 }: { children: ReactNode; className?: string; style?: MotionStyle; delay?: number }) {
  return (
    <motion.div
      className={clsx('absolute rounded-[20px] bg-white text-[#0f1512] shadow-[0_2px_4px_rgba(0,0,0,0.12),0_24px_44px_-20px_rgba(0,0,0,0.6)]', className)}
      style={style}
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease, delay }}
    >
      {children}
    </motion.div>
  )
}

// Cada ilustração é desenhada numa área de 560 × 440 (encolhe para caber), montada como a dos bancos:
// o assunto da frase num arco em cima, o mascote no meio embaixo e os círculos finos em volta dele.
const MID = { x: 280, y: 330 }

// ─── avisos de vencimento ───

const NOTICES = [
  { title: 'Conta de luz vence amanhã', body: 'R$ 182,40 · energia elétrica', when: 'agora', x: 96, y: 6, r: -2.5 },
  { title: 'A fatura do cartão fecha em 3 dias', body: 'Até agora: R$ 1.236,90', when: '9:00', x: 124, y: 106, r: 2 },
]

function NoticesArt() {
  return (
    <>
      <Ripples x={MID.x} y={MID.y} />
      {NOTICES.map((n, i) => (
        <Card key={n.title} className="w-[340px] p-3.5" style={{ left: n.x, top: n.y, rotate: n.r }} delay={0.1 + i * 0.16}>
          <div className="flex gap-3">
            <img src={dinnIcon} alt="" draggable={false} className="size-10 shrink-0 rounded-[11px]" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="font-semibold">Dinn</span>
                <span className="text-[#8a938e]">{n.when}</span>
              </div>
              <p className="mt-0.5 text-[14.5px] leading-snug font-semibold">{n.title}</p>
              <p className="text-[13px] leading-snug text-[#5b6560]">{n.body}</p>
            </div>
          </div>
        </Card>
      ))}
      <FloatTile icon={CalendarClock} size={60} x={44} y={262} r={-10} delay={0.55} />
      <FloatTile icon={CreditCard} size={60} x={456} y={262} r={10} delay={0.65} />
      <CloudMascot src={mascotNotices} x={MID.x} y={MID.y} height={232} delay={0.4} />
    </>
  )
}

// ─── gastos por categoria ───

// cores validadas para daltonismo e contraste (ordem fixa; vizinhas no anel bem diferentes entre si)
const CATEGORIES = [
  { name: 'Mercado', value: 1120, color: '#15803d' },
  { name: 'Casa', value: 860, color: '#eda100' },
  { name: 'Transporte', value: 540, color: '#2a78d6' },
  { name: 'Restaurantes', value: 420, color: '#eb6834' },
  { name: 'Saúde', value: 244, color: '#6250d6' },
]
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

function Donut() {
  const r = 76
  const c = 2 * Math.PI * r
  const total = CATEGORIES.reduce((s, x) => s + x.value, 0)
  // onde cada fatia começa no anel (soma das anteriores)
  const starts = CATEGORIES.map((_, i) => CATEGORIES.slice(0, i).reduce((s, x) => s + (c * x.value) / total, 0))
  return (
    <div className="relative size-[164px] shrink-0">
      <svg viewBox="0 0 200 200" className="size-full -rotate-90" aria-hidden>
        {CATEGORIES.map((x, i) => {
          // 2px de folga branca entre as fatias
          const len = (c * x.value) / total - 2
          const offset = -(starts[i] + 1)
          return (
            <motion.circle
              key={x.name}
              cx="100"
              cy="100"
              r={r}
              fill="none"
              stroke={x.color}
              strokeWidth="28"
              strokeDashoffset={offset}
              initial={{ strokeDasharray: `0 ${c}` }}
              animate={{ strokeDasharray: `${len} ${c - len}` }}
              transition={{ duration: 0.6, ease, delay: 0.25 + i * 0.12 }}
            />
          )
        })}
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <span className="text-[11px] text-[#5b6560]">Gastos do mês</span>
        <span className="text-[19px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">{brl(total)}</span>
      </div>
    </div>
  )
}

function CategoriesArt() {
  return (
    <>
      <Ripples x={MID.x} y={MID.y + 10} />
      <Card className="flex w-[420px] items-center gap-5 p-[18px]" style={{ left: 70, top: 4 }} delay={0.1}>
        <Donut />
        <ul className="min-w-0 flex-1 space-y-2">
          {CATEGORIES.map((x) => (
            <li key={x.name} className="flex items-center gap-2.5 text-[13.5px]">
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: x.color }} />
              <span className="flex-1 truncate">{x.name}</span>
              <span className="text-[#5b6560] tabular-nums">{brl(x.value)}</span>
            </li>
          ))}
        </ul>
      </Card>
      <FloatTile icon={ShoppingCart} size={60} x={44} y={262} r={-10} delay={0.5} />
      <FloatTile icon={Car} size={48} x={88} y={360} r={8} delay={0.6} />
      <FloatTile icon={Utensils} size={60} x={456} y={262} r={10} delay={0.55} />
      <FloatTile icon={HeartPulse} size={48} x={424} y={360} r={-8} delay={0.65} />
      <CloudMascot src={mascotJars} x={MID.x} y={MID.y + 14} height={206} delay={0.4} />
    </>
  )
}

// ─── WhatsApp ───

// a conversa sobe do celular do mascote, em balões alternados
const CHAT = [
  { me: true, text: 'uber 23,50' },
  { me: false, text: 'Lancei R$ 23,50 em Transporte, hoje.' },
  { me: true, text: 'quanto gastei este mês?' },
  { me: false, text: 'R$ 3.184,00 até agora.' },
]

function ChatArt() {
  return (
    <>
      <Ripples x={MID.x} y={MID.y} />
      <div className="absolute flex w-[340px] flex-col gap-2" style={{ left: 110, top: 6 }}>
        {CHAT.map((m, i) => (
          <motion.div
            key={m.text}
            className={clsx(
              'flex max-w-[86%] items-center gap-1.5 rounded-[18px] px-3.5 py-2.5 text-[14px] leading-snug text-[#0f1512] shadow-[0_2px_4px_rgba(0,0,0,0.12),0_16px_28px_-14px_rgba(0,0,0,0.55)]',
              m.me ? 'self-end rounded-br-[6px] bg-[#d9f7e3]' : 'self-start rounded-bl-[6px] bg-white',
            )}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.35, ease, delay: 0.3 + i * 0.3 }}
          >
            {!m.me && <img src={dinnIcon} alt="" draggable={false} className="size-5 shrink-0 rounded-[6px]" />}
            {m.text}
            {i === 1 && <Check className="size-4 shrink-0 text-[#15803d]" strokeWidth={2.6} />}
          </motion.div>
        ))}
      </div>
      <FloatTile icon={MessageCircle} size={60} x={44} y={262} r={-10} delay={0.5} />
      <FloatTile icon={FileText} size={56} x={458} y={264} r={10} delay={0.6} />
      <CloudMascot src={mascotChat} x={MID.x} y={MID.y + 4} height={222} delay={0.4} />
    </>
  )
}

// ─── metas ───

// três metas num arco por cima do mascote: a do meio mais alta, as dos lados giradas para fora
const GOALS = [
  { name: 'Viagem', icon: Plane, saved: 3400, target: 5000, x: 8, y: 58, r: -8 },
  { name: 'Reserva', icon: Umbrella, saved: 4500, target: 10000, x: 196, y: 14, r: 0 },
  { name: 'Carro novo', icon: Car, saved: 8800, target: 40000, x: 384, y: 58, r: 8 },
]

function GoalsArt() {
  return (
    <>
      <Ripples x={MID.x} y={MID.y} />
      {GOALS.map((g, i) => {
        const pct = Math.round((g.saved / g.target) * 100)
        return (
          <Card key={g.name} className="w-[168px] p-3.5" style={{ left: g.x, top: g.y, rotate: g.r }} delay={0.1 + i * 0.12}>
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#f1f4f2] text-[#0f1512]">
                <g.icon className="size-[18px]" strokeWidth={1.75} />
              </span>
              <p className="truncate text-[15px] font-semibold tracking-[-0.01em]">{g.name}</p>
            </div>
            <p className="mt-2.5 text-[12px] text-[#5b6560] tabular-nums">
              {brl(g.saved)} de {brl(g.target)}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#e7ece9]">
                <motion.span
                  className="block h-full rounded-full bg-[#15803d]"
                  style={{ originX: 0 }}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: pct / 100 }}
                  transition={{ duration: 0.9, ease, delay: 0.45 + i * 0.12 }}
                />
              </span>
              <span className="text-[12px] font-semibold tabular-nums">{pct}%</span>
            </div>
          </Card>
        )
      })}
      <FloatTile icon={Target} size={56} x={52} y={272} r={-10} delay={0.55} />
      <CloudMascot src={mascotGoals} x={MID.x} y={MID.y} height={226} delay={0.4} />
    </>
  )
}

// ─── painel do computador ───

// o trecho de baixo de cada frase ganha um risco desenhado à mão; o do WhatsApp só aparece com a IA ligada
const SLIDES: { top: string; mark: string; text: string; art?: () => ReactNode }[] = [
  { top: 'Todos os seus bancos', mark: 'num só lugar', text: 'Cadastre contas e cartões de qualquer banco e acompanhe o saldo de tudo junto.' },
  { top: 'Contas em dia,', mark: 'sem susto', text: 'Um aviso por dia no celular com o que vence hoje, o que atrasou e o que vence amanhã.', art: NoticesArt },
  { top: 'Cada gasto', mark: 'no lugar certo', text: 'Receitas e despesas por categoria, com o orçamento do mês sempre à vista.', art: CategoriesArt },
  ...(aiEnabled ? [{ top: 'Lance gastos', mark: 'pelo WhatsApp', text: 'Mande texto, áudio ou print para o assistente do Dinn e o lançamento cai na sua conta.', art: ChatArt }] : []),
  { top: 'Metas que saem', mark: 'do papel', text: 'Diga quanto quer juntar e acompanhe, mês a mês, quanto falta para chegar lá.', art: GoalsArt },
]

// tamanho de desenho das ilustrações (fora o anel de bancos); encolhem para caber na tela
const ART_W = 560
const ART_H = 440

function Marked({ children }: { children: ReactNode }) {
  return (
    <span className="relative inline-block">
      {children}
      <svg viewBox="0 0 240 12" preserveAspectRatio="none" className="absolute -bottom-[7px] -left-[3%] h-3 w-[106%] overflow-visible" aria-hidden>
        <motion.path
          d="M3 8 C 40 3, 78 11, 118 6 S 196 3, 237 7"
          fill="none"
          stroke="#4ade80"
          strokeWidth="3"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, delay: 0.3, ease: 'easeOut' }}
        />
      </svg>
    </span>
  )
}

/** Metade direita no computador: logo no alto, a ilustração da frase atual, a frase e as setas com bolinhas. */
/**
 * O painel com as cinco frases e as ilustrações animadas. Computador: metade direita da tela.
 * Celular (`mobile`): ocupa o alto da tela de entrada, com os botões numa folha branca embaixo, e as frases
 * também passam arrastando o dedo para o lado.
 */
export function Showcase({ mobile = false }: { mobile?: boolean }) {
  const [at, setAt] = useState(0)
  // troca sozinha a cada 7s; tocar numa seta ou bolinha recomeça a contagem
  useEffect(() => {
    const t = setTimeout(() => setAt((i) => (i + 1) % SLIDES.length), 7000)
    return () => clearTimeout(t)
  }, [at])
  const go = (i: number) => setAt((i + SLIDES.length) % SLIDES.length)
  const [stage, { w, h }] = useSize<HTMLDivElement>()
  // nada fica no alto: as ilustrações usam a área toda, com uma folga em cima (40px; 16px no celular)
  const reserve = mobile ? 16 : 40
  // espaço livre para a ilustração, com 24px de folga embaixo antes das frases (16px no celular)
  const room = h - reserve - (mobile ? 16 : 24)
  const scale = Math.min(0.84, (w - (mobile ? 20 : 64)) / ART_W, room / ART_H)
  // arrastar o dedo (ou o mouse) para o lado troca a frase
  const swipe = useRef<number | null>(null)
  const slide = SLIDES[at]
  const Art = slide.art
  const arrow = 'grid size-8 place-items-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white'

  return (
    // computador: a ilustração ocupa os 60% de cima; as frases e as bolinhas vêm logo abaixo, no meio da tela.
    // celular: a ilustração pega o espaço que sobra; a folha branca dos botões sobe 28px por cima do pé
    <aside
      className={clsx(
        'brand-panel relative flex flex-col items-center overflow-hidden text-white',
        mobile ? 'pt-safe min-h-0 flex-1 touch-pan-y pb-[52px]' : 'h-full',
      )}
      onPointerDown={(e) => (swipe.current = e.clientX)}
      onPointerUp={(e) => {
        if (swipe.current === null) return
        const dx = e.clientX - swipe.current
        swipe.current = null
        if (Math.abs(dx) > 40) go(at + (dx < 0 ? 1 : -1))
      }}
    >
      <div ref={stage} className={clsx('relative w-full', mobile ? 'min-h-[240px] flex-1' : 'h-[60%] min-h-[380px] shrink-0')} aria-hidden>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={at} className="absolute inset-0" exit={{ opacity: 0, transition: { duration: 0.25 } }}>
            {w > 0 &&
              (Art ? (
                <div className="absolute left-1/2" style={{ top: reserve + room / 2, width: ART_W, height: ART_H, translate: '-50% -50%', scale: Math.max(0.5, scale) }}>
                  <Art />
                </div>
              ) : (
                <BanksArt w={w} h={h} mobile={mobile} />
              ))}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className={clsx('relative z-10 w-full px-6 text-center', mobile ? 'h-[136px] max-w-[380px]' : 'h-[172px] max-w-[460px]')} aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={at} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.35, ease: 'easeOut' }}>
            <h2 className={clsx('leading-[1.25] font-semibold tracking-[-0.03em]', mobile ? 'text-[23px]' : 'text-[27px]')}>
              {slide.top}
              <br />
              <Marked>{slide.mark}</Marked>
            </h2>
            <p className={clsx('mx-auto max-w-[380px] leading-relaxed text-white/70', mobile ? 'mt-3 text-[14px]' : 'mt-[18px] text-[14.5px]')}>{slide.text}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="relative z-10 mt-1 flex items-center gap-3.5">
        <button type="button" onClick={() => go(at - 1)} aria-label="Frase anterior" className={arrow}>
          <ChevronLeft className="size-4" />
        </button>
        <div className="flex gap-1.5">
          {SLIDES.map((s, i) => (
            <button
              key={s.mark}
              type="button"
              onClick={() => go(i)}
              aria-label={`Frase ${i + 1}`}
              aria-current={i === at}
              className={clsx('h-2 rounded-full transition-all duration-300', i === at ? 'w-8 bg-[#4ade80]' : 'w-2 bg-white/25 hover:bg-white/40')}
            />
          ))}
        </div>
        <button type="button" onClick={() => go(at + 1)} aria-label="Próxima frase" className={arrow}>
          <ChevronRight className="size-4" />
        </button>
      </div>
    </aside>
  )
}

/** Poses do mascote no celular: uma para cada passo da entrada. `wide`: a da nuvem é mais larga. */
export type Pose = 'nuvem' | 'avisos' | 'categorias' | 'whatsapp' | 'metas'
const POSES: Record<Pose, { src: string; wide: boolean }> = {
  nuvem: { src: mascotCloud, wide: true },
  avisos: { src: mascotNotices, wide: false },
  categorias: { src: mascotJars, wide: false },
  whatsapp: { src: mascotChat, wide: false },
  metas: { src: mascotGoals, wide: false },
}

/**
 * Topo verde no celular: o arco de bancos girando devagar e o mascote embaixo, sentado na beirada da
 * folha branca do formulário (fica por cima dela). A pose muda conforme o passo.
 */
export function MobileHero({ pose = 'nuvem' }: { pose?: Pose }) {
  const [box, { w, h }] = useSize<HTMLDivElement>()
  const tile = 50
  const cy = h + 40
  const radius = Math.min(w * 0.7, cy - tile / 2 - 18)
  const { src, wide } = POSES[pose]
  const tall = wide ? Math.min(186, h * 0.6) : Math.min(208, h * 0.68)
  // a folha branca sobe 28px por cima do topo; o pé do mascote entra 22px nela
  const bottom = h - 6
  return (
    <div className="brand-panel-top pt-safe relative shrink-0">
      <div ref={box} className="relative h-[clamp(250px,36svh,320px)]">
        <div className="absolute inset-x-0 top-0 -bottom-7 overflow-hidden" aria-hidden>
          {w > 0 && <BankRing tile={tile} radius={radius} cx={w / 2} cy={cy} />}
        </div>
        {h > 0 && (
          <>
            {/* sombra leve na folha, embaixo do mascote */}
            <span
              className="pointer-events-none absolute z-30 rounded-[50%]"
              style={{ width: tall * 1.05, height: tall * 0.12, left: w / 2 - tall * 0.525, top: bottom - tall * 0.08, background: 'radial-gradient(closest-side, rgba(0, 0, 0, 0.16), transparent)' }}
            />
            <AnimatePresence mode="wait" initial={false}>
              <motion.img
                key={pose}
                src={src}
                alt=""
                draggable={false}
                className="absolute left-1/2 z-30 -translate-x-1/2 select-none"
                style={{ height: tall, top: bottom - tall }}
                initial={{ opacity: 0, y: 12, scale: 0.94 }}
                animate={{ opacity: 1, y: [0, -4, 0], scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.94, transition: { duration: 0.18 } }}
                transition={{ opacity: { duration: 0.4 }, scale: { duration: 0.45, ease }, y: { duration: 4, repeat: Infinity, ease: 'easeInOut' } }}
              />
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  )
}
