import { lazy, Suspense, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BarChart3, Calculator, HandCoins, House, LayoutGrid, MessageCircle, PieChart, Plus, RefreshCw, Settings2, Tags, Target, Wallet } from 'lucide-react'
import clsx from 'clsx'
import { useData, useUI, type Tab } from './lib/store'
import { haptic } from './lib/haptics'
import { Row, Section, spring } from './components/ui'
import { WhatsAppIcon } from './components/icons'
import { Sheet, Toaster, toast } from './components/sheet'
import Home from './screens/Home'
import TransactionSheet from './sheets/TransactionSheet'
import { AccountSheet, CardSheet } from './sheets/AccountSheets'
import CategorySheet from './sheets/CategorySheet'
import GoalSheet from './sheets/GoalSheet'
import DebtSheet from './sheets/DebtSheet'
import NewDebtSheet from './sheets/NewDebtSheet'
import SettingsSheet from './sheets/SettingsSheet'
import InboxSheet from './sheets/InboxSheet'
import CalculatorSheet from './sheets/CalculatorSheet'
import { LockScreen } from './components/Lock'
import Sidebar, { useShortcuts } from './components/Sidebar'
import { money, setPrivacy } from './lib/format'
import { onAppEvent } from './lib/events'
import { useAuth } from './lib/auth'
import { useNotifications } from './lib/notify'
import { applyUpdate, usePWA } from './lib/pwa'
import { aiEnabled } from './lib/features'

// telas fora do Início e o login carregam sob demanda (o service worker já guarda tudo para usar offline)
const Transactions = lazy(() => import('./screens/Transactions'))
const Accounts = lazy(() => import('./screens/Accounts'))
const Budget = lazy(() => import('./screens/Budget'))
const Goals = lazy(() => import('./screens/Goals'))
const Debts = lazy(() => import('./screens/Debts'))
const Reports = lazy(() => import('./screens/Reports'))
const Assistant = lazy(() => import('./screens/Assistant'))
const Login = lazy(() => import('./screens/Login'))

const screens: Record<Tab, React.ComponentType> = { home: Home, assistant: Assistant, transactions: Transactions, accounts: Accounts, budget: Budget, goals: Goals, debts: Debts, reports: Reports }

// a barra mostra as principais; o resto fica no "Mais" (e no menu lateral do computador)
const barTabs: { id: Tab | 'more'; label: string; icon: typeof House }[] = [
  { id: 'home', label: 'Início', icon: House },
  { id: 'transactions', label: 'Lançam.', icon: ArrowLeftRight },
  { id: 'budget', label: 'Orçamento', icon: PieChart },
  { id: 'more', label: 'Mais', icon: LayoutGrid },
]
const moreTabs: Tab[] = ['accounts', 'goals', 'debts', 'reports']

function useTheme() {
  const theme = useData((s) => s.settings.theme)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      // a cor da barra inferior: o iPhone pode usar a cor do tema para pintar a faixa de baixo (ver viewport.ts)
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#17191A' : '#FFFFFF'))
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

/** Versão nova do app baixada: oferece recarregar (sem interromper quem está no meio de algo). */
function UpdateBanner() {
  const update = usePWA((s) => s.update)
  return (
    <AnimatePresence>
      {update && (
        <motion.div
          initial={{ y: -90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -90, opacity: 0 }}
          transition={spring}
          className="pointer-events-none fixed inset-x-0 top-[max(var(--sat),10px)] z-[70] flex justify-center px-4"
        >
          <button
            onClick={() => (haptic('medium'), applyUpdate())}
            className="glass pointer-events-auto flex items-center gap-2 rounded-full py-2.5 pl-3.5 pr-4 text-[13px] font-medium shadow-[0_8px_28px_-8px_rgba(15,21,18,0.35)]"
          >
            <RefreshCw className="size-4 text-tint" />
            Nova versão disponível
            <span className="font-semibold text-tint">Atualizar</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Avisa quando o assistente do WhatsApp lança algo com o app aberto. */
function useWhatsAppToasts() {
  useEffect(
    () =>
      onAppEvent((e) => {
        if (e.type !== 'whatsapp') return
        const [first] = e.txs
        toast(e.txs.length === 1 ? `Pelo WhatsApp: ${first.description} · ${money(first.amount)}` : `${e.txs.length} lançamentos chegaram pelo WhatsApp`)
      }),
    [],
  )
}

/** Mantém a data de referência atual (meia-noite, volta ao app). */
function useDayRollover() {
  const refreshDay = useUI((s) => s.refreshDay)
  const day = useUI((s) => s.day)
  // lançamentos fixos: mantém 12 meses gerados à frente
  useEffect(() => useData.getState().ensureRecurring(), [day])
  useEffect(() => {
    const onVis = () => !document.hidden && refreshDay()
    const timer = setInterval(refreshDay, 60_000)
    document.addEventListener('visibilitychange', onVis)
    return () => (clearInterval(timer), document.removeEventListener('visibilitychange', onVis))
  }, [refreshDay])
}

/** Login primeiro; ao entrar, o login some e o app aparece suavemente. */
export default function App() {
  useTheme()
  const ready = useAuth((s) => s.ready)
  const signedIn = useAuth((s) => !!s.email)
  const origin = useAuth((s) => s.origin)
  const [revealed, setRevealed] = useState(false)
  // saiu da conta: o próximo login anima a abertura de novo
  useEffect(() => {
    if (!signedIn) setRevealed(false)
  }, [signedIn])
  const at = origin ? `${origin.x}px ${origin.y}px` : '50% 50%'
  // conferindo a sessão salva: não pisca o login para quem já está conectado
  if (!ready) return null
  return (
    <AnimatePresence>
      {signedIn ? (
        <motion.div
          key="app"
          className="relative z-10 h-full"
          initial={origin ? { clipPath: `circle(0px at ${at})` } : false}
          animate={revealed || !origin ? { clipPath: 'none', transition: { duration: 0 } } : { clipPath: `circle(150vmax at ${at})` }}
          transition={{ duration: 0.75, ease: [0.65, 0, 0.35, 1] }}
          onAnimationComplete={() => setRevealed(true)}
        >
          <MainApp />
        </motion.div>
      ) : (
        <motion.div key="login" exit={{ opacity: 0, transition: { delay: 0.6, duration: 0.2 } }} className="fixed inset-0">
          <Suspense>
            <Login />
          </Suspense>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function MainApp() {
  useDayRollover()
  useNotifications()
  useWhatsAppToasts()
  useShortcuts()
  const privacy = useData((s) => s.settings.privacy)
  setPrivacy(privacy)
  const { tab, setTab, openTx, openGoal, openNewDebt, openCalculator, openSettings, more, openMore } = useUI()
  const [create, setCreate] = useState(false)
  const Active = screens[tab]

  const after = (close: () => void, fn: () => void) => {
    close()
    setTimeout(fn, 300)
  }
  const fromCreate = (fn: () => void) => after(() => setCreate(false), fn)
  const fromMore = (fn: () => void) => after(() => openMore(false), fn)

  return (
    <>
    <div vaul-drawer-wrapper="" className="relative flex h-full overflow-hidden bg-bg">
      {/* computador: menu lateral; celular: barra inferior */}
      <Sidebar />
      <div className="relative min-w-0 flex-1">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.main
            key={`${tab}-${privacy}`}
            initial={{ opacity: 0, scale: 0.985, filter: 'blur(4px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.985, filter: 'blur(4px)' }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            className="absolute inset-0"
          >
            <Suspense>
              <Active />
            </Suspense>
          </motion.main>
        </AnimatePresence>
      </div>

      {/* Barra inferior com botão central de criação */}
      <nav className={clsx('pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center lg:hidden', tab === 'assistant' && 'hidden')}>
        <div className="glass pointer-events-auto relative grid w-full max-w-xl grid-cols-5 items-end rounded-t-[28px] px-2 pb-[max(var(--sab),10px)] pt-2 shadow-[0_-1px_0_var(--separator),0_-12px_32px_-18px_rgba(15,21,18,0.18)]">
          {/* a barra continua para baixo da tela: no iOS 26 (app instalado) a página termina antes do fim
              do aparelho, e onde der para desenhar a faixa que sobra fica com a cor da barra (ver viewport.ts) */}
          <span aria-hidden className="pointer-events-none absolute inset-x-0 top-full h-[120px] bg-[var(--bar)]" />
          {[...barTabs.slice(0, 2), null, ...barTabs.slice(2)].map((t) => {
            if (!t)
              return (
                <div key="fab" className="flex flex-col items-center gap-1 pb-1.5">
                  <motion.button
                    aria-label="Novo"
                    whileTap={{ scale: 0.9 }}
                    transition={spring}
                    onClick={() => (haptic('medium'), setCreate(true))}
                    className="grad-btn -mt-5 grid size-12 place-items-center rounded-[22px] text-white shadow-[0_4px_12px_rgba(21,128,61,0.3)]"
                  >
                    <Plus className="size-6" strokeWidth={2.2} />
                  </motion.button>
                  <span className="text-[10px] font-semibold text-label">Novo</span>
                </div>
              )
            const on = t.id === 'more' ? moreTabs.includes(tab) : t.id === tab
            return (
              <button
                key={t.id}
                aria-label={t.label}
                aria-current={on ? 'page' : undefined}
                onClick={() => {
                  haptic()
                  if (t.id === 'more') openMore(true)
                  else setTab(t.id)
                }}
                className={clsx('relative flex flex-col items-center gap-1 py-1.5 transition-colors', on ? 'text-tint' : 'text-label-3')}
              >
                <t.icon className="size-[22px]" strokeWidth={on ? 2.2 : 1.7} fill={on ? 'currentColor' : 'none'} fillOpacity={on ? 0.18 : 0} />
                <span className={clsx('text-[10px]', on ? 'font-semibold' : 'font-medium')}>{t.label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      <Sheet open={create} onOpenChange={setCreate} title="Novo">
        <Section>
          <Row
            icon={<MessageCircle className="size-[18px]" />}
            label="Falar com o assistente"
            detail={aiEnabled ? 'Lance por texto, áudio, foto ou PDF' : 'Escreva “caiu meu salário” ou “paguei a luz”'}
            chevron
            onClick={() => fromCreate(() => setTab('assistant'))}
          />
        </Section>
        <Section>
          <Row icon={<ArrowUpRight className="size-[18px] text-red" />} label="Nova despesa" detail="Conta, compra no débito, Pix ou cartão" chevron onClick={() => fromCreate(() => openTx(true, { type: 'despesa' }))} />
          <Row icon={<ArrowDownLeft className="size-[18px] text-green" />} label="Nova receita" detail="Salário, freela, venda ou rendimento" chevron onClick={() => fromCreate(() => openTx(true, { type: 'receita' }))} />
          <Row icon={<ArrowLeftRight className="size-[18px]" />} label="Transferência" detail="Entre as suas contas" chevron onClick={() => fromCreate(() => openTx(true, { type: 'transferencia' }))} />
        </Section>
        <Section>
          <Row icon={<Target className="size-[18px]" />} label="Nova meta" detail="Reserva, viagem, carro novo…" chevron onClick={() => fromCreate(() => openGoal(true))} />
          <Row icon={<HandCoins className="size-[18px]" />} label="Nova dívida ou empréstimo" detail="O que você deve ou tem a receber" chevron onClick={() => fromCreate(() => openNewDebt(true))} />
          <Row icon={<Calculator className="size-[18px]" />} label="Simular financiamento" detail="Parcelas, juros e custo total" chevron onClick={() => fromCreate(() => openCalculator(true))} />
        </Section>
      </Sheet>

      <Sheet open={more} onOpenChange={openMore} title="Mais">
        <Section>
          <Row icon={<Wallet className="size-[18px]" />} label="Contas e cartões" detail="Saldos, limites e faturas" chevron onClick={() => fromMore(() => setTab('accounts'))} />
          <Row icon={<Target className="size-[18px]" />} label="Metas" detail="Objetivos e quanto falta" chevron onClick={() => fromMore(() => setTab('goals'))} />
          <Row icon={<HandCoins className="size-[18px]" />} label="Dívidas e empréstimos" detail="O que você deve e tem a receber" chevron onClick={() => fromMore(() => setTab('debts'))} />
          <Row icon={<BarChart3 className="size-[18px]" />} label="Relatórios" detail="Filtros, gráficos, PDF e planilha" chevron onClick={() => fromMore(() => setTab('reports'))} />
        </Section>
        <Section>
          <Row
            icon={<MessageCircle className="size-[18px]" />}
            label="Assistente"
            detail={aiEnabled ? 'Converse e lance por texto, áudio ou foto' : 'Lance, dê baixa e corrija conversando'}
            chevron
            onClick={() => fromMore(() => setTab('assistant'))}
          />
          {aiEnabled && <Row icon={<WhatsAppIcon className="size-[18px]" />} label="Assistente no WhatsApp" detail="Lance por texto, áudio ou print" chevron onClick={() => fromMore(() => openSettings(true, 'whatsapp'))} />}
          <Row icon={<Tags className="size-[18px]" />} label="Categorias" detail="Cores, ícones e subcategorias" chevron onClick={() => fromMore(() => openSettings(true, 'categorias'))} />
          <Row icon={<Calculator className="size-[18px]" />} label="Simulador de financiamento" detail="Compare prazos antes de assinar" chevron onClick={() => fromMore(() => openCalculator(true))} />
          <Row icon={<Settings2 className="size-[18px]" />} label="Configurações" detail="Perfil, notificações, segurança e backup" chevron onClick={() => fromMore(() => openSettings(true))} />
        </Section>
      </Sheet>

      <TransactionSheet />
      <AccountSheet />
      <CardSheet />
      <CategorySheet />
      <GoalSheet />
      <DebtSheet />
      <NewDebtSheet />
      <SettingsSheet />
      <InboxSheet />
      <CalculatorSheet />
    </div>
    {/* fora do wrapper: o vaul escala o wrapper e prenderia estes overlays atrás dos painéis */}
    <Toaster />
    <UpdateBanner />
    <LockScreen />
    </>
  )
}
