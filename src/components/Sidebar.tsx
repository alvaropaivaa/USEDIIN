import { useEffect } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import clsx from 'clsx'
import { useData, useUI, type Tab } from '../lib/store'
import { confirmSignOut, useAuth } from '../lib/auth'
import { useNotices } from '../lib/notify'
import { isLate } from '../lib/ledger'
import { useDebts } from './finance'
import { initials } from './ui'
import { SideIcon, type SideIconName } from './SideIcon'

export const sideTabs: { id: Tab; label: string; icon: SideIconName }[] = [
  { id: 'home', label: 'Início', icon: 'home' },
  { id: 'assistant', label: 'Assistente', icon: 'assistant' },
  { id: 'transactions', label: 'Lançamentos', icon: 'transactions' },
  { id: 'accounts', label: 'Contas e cartões', icon: 'accounts' },
  { id: 'budget', label: 'Orçamento', icon: 'budget' },
  { id: 'goals', label: 'Metas', icon: 'goals' },
  { id: 'debts', label: 'Dívidas', icon: 'debts' },
  { id: 'reports', label: 'Relatórios', icon: 'reports' },
]

/** Marca do Dinn: barras de crescimento + nome e o lema. */
function Logo() {
  return (
    <span className="flex items-center gap-3">
      <svg viewBox="0 0 25 25" className="size-[26px]" aria-hidden>
        <defs>
          <linearGradient id="side-bar" x1="0" y1="1" x2="0" y2="0">
            <stop stopColor="#16a34a" />
            <stop offset="1" stopColor="#86efac" />
          </linearGradient>
        </defs>
        <rect x="0" y="14" width="7" height="11" rx="2" fill="url(#side-bar)" />
        <rect x="9" y="8" width="7" height="17" rx="2" fill="url(#side-bar)" />
        <rect x="18" y="0" width="7" height="25" rx="2" fill="url(#side-bar)" />
      </svg>
      <span className="leading-none">
        <span className="font-display block text-[21px] font-extrabold tracking-[-0.05em] text-white">
          Dinn
        </span>
        <span className="mt-0.5 block text-[11px] font-medium text-white/50">Seu dinheiro rende mais</span>
      </span>
    </span>
  )
}

const item = 'relative z-0 flex h-10 w-full items-center gap-3 rounded-[12px] px-3 text-[14px] transition-colors'

/** Atalhos de teclado (computador): 1–7 trocam de tela, D = despesa, R = receita, T = transferência, J = simulador, / ou Ctrl+K = buscar. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const ui = useUI.getState()
      // Ctrl+K / ⌘K: busca de qualquer lugar
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        ui.closeAll()
        setTimeout(() => (ui.setSearchFocus(true), ui.setTab('transactions')), 50)
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey || t.closest('input, textarea, select, [contenteditable]')) return
      // com painel aberto ou app bloqueado, o teclado é deles
      if (ui.busy() || document.querySelector('[data-lock]')) return
      const tab = sideTabs[Number(e.key) - 1]
      if (tab) return (e.preventDefault(), ui.setTab(tab.id))
      if (e.key === '/') return (e.preventDefault(), ui.setSearchFocus(true), ui.setTab('transactions'))
      const k = e.key.toLowerCase()
      if (k === 'd') (e.preventDefault(), ui.openTx(true, { type: 'despesa' }))
      else if (k === 'r') (e.preventDefault(), ui.openTx(true, { type: 'receita' }))
      else if (k === 't') (e.preventDefault(), ui.openTx(true, { type: 'transferencia' }))
      else if (k === 'j') (e.preventDefault(), ui.openCalculator(true))
      else if (k === 'a') (e.preventDefault(), ui.setTab('assistant'))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Menu lateral fixo do computador, verde-escuro (no celular fica a barra inferior). */
export default function Sidebar() {
  const { tab, setTab, openInbox, openSettings, openCalculator } = useUI()
  const settings = useData((s) => s.settings)
  const email = useAuth((s) => s.email)
  const unread = useNotices((s) => s.items.some((i) => !i.read))
  const day = useUI((s) => s.day)
  const late = useData((s) => s.transactions.reduce((n, t) => n + (isLate(t, day) ? 1 : 0), 0))
  const { items } = useDebts()
  const badges: Partial<Record<Tab, number>> = { transactions: late, debts: items.reduce((n, i) => n + i.summary.overdue.length, 0) }
  const owner = settings.owner.trim()
  const muted = 'font-medium text-white/70 hover:bg-white/[0.06] hover:text-white'
  // o ícone se mexe com o mouse em cima do botão (SideIcon); sem isso para quem pediu menos movimento
  const reduce = useReducedMotion()
  const hover = { initial: 'rest', animate: 'rest', ...(reduce ? {} : { whileHover: 'hover' }) }

  return (
    <aside className="side-dark hidden w-[236px] shrink-0 flex-col px-3 pb-4 pt-6 text-white lg:flex">
      <button onClick={() => setTab('home')} className="px-3 text-left" title="Início (1)">
        <Logo />
      </button>
      <div className="mx-3 my-5 h-px bg-white/10" />

      <nav className="space-y-1">
        {sideTabs.map((t, k) => {
          const on = t.id === tab
          return (
            <motion.button
              key={t.id}
              {...hover}
              onClick={() => setTab(t.id)}
              title={`${t.label} (${k + 1})`}
              aria-current={on ? 'page' : undefined}
              className={clsx(item, on ? 'font-semibold text-white' : muted)}
            >
              {on && (
                <motion.span
                  layoutId="app-side-pill"
                  className="absolute inset-0 -z-10 rounded-[12px] bg-white/[0.12]"
                  transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                />
              )}
              <SideIcon name={t.icon} className="size-[18px]" strokeWidth={on ? 2.2 : 1.8} />
              <span className="flex-1 text-left">{t.label}</span>
              {!!badges[t.id] && (
                <span title="Atrasadas" className="tabular grid h-5 min-w-5 place-items-center rounded-full bg-red px-1.5 text-[11px] font-semibold text-white">
                  {badges[t.id]}
                </span>
              )}
            </motion.button>
          )
        })}
      </nav>
      <div className="mx-3 my-5 h-px bg-white/10" />

      <div className="space-y-1">
        <motion.button {...hover} onClick={() => openCalculator(true)} title="Simulador de financiamento (J)" className={clsx(item, muted)}>
          <SideIcon name="calculator" className="size-[18px]" /> Simulador
        </motion.button>
        <motion.button {...hover} onClick={() => openInbox(true)} className={clsx(item, muted)}>
          <SideIcon name="bell" className="size-[18px]" />
          Notificações
          {unread && <span className="size-2 rounded-full bg-red" />}
        </motion.button>
        <motion.button {...hover} onClick={() => openSettings(true)} className={clsx(item, muted)}>
          <SideIcon name="settings" className="size-[18px]" /> Configurações
        </motion.button>
      </div>

      <div className="mt-auto flex items-center gap-2.5 rounded-[16px] bg-white/[0.06] p-2.5 ring-1 ring-white/10">
        <button
          onClick={() => openSettings(true, 'perfil')}
          title="Perfil"
          className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-white/10 text-[13px] font-semibold text-white ring-1 ring-white/20"
        >
          {settings.photo ? <img src={settings.photo} alt="" className="size-full object-cover" /> : owner ? initials(owner) : 'JP'}
        </button>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold">{owner || 'Seu perfil'}</span>
          <span className="block truncate text-[11.5px] text-white/50">{email}</span>
        </span>
        <motion.button
          {...hover}
          onClick={() => {
            if (!confirmSignOut('Sair da conta neste computador?')) return
            useUI.getState().closeAll()
            useAuth.getState().signOut()
          }}
          title="Sair"
          aria-label="Sair"
          className="grid size-8 shrink-0 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <SideIcon name="logout" className="size-4" strokeWidth={2} />
        </motion.button>
      </div>
    </aside>
  )
}
