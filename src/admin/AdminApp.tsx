import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ExternalLink, LayoutDashboard, LogOut, MessageCircle, Moon, Plus, Settings as SettingsIcon, Sun, UserPlus, Users } from 'lucide-react'
import clsx from 'clsx'
import { useAdmin } from './store'
import { useInstances } from './instances'
import { AdminToaster, Btn, inputCls, Menu } from './ui'
import Overview from './pages/Overview'
import Accesses from './pages/Accesses'
import WhatsApp from './pages/WhatsApp'
import Settings from './pages/Settings'
import { validEmail } from '../lib/auth'

type Page = 'overview' | 'accesses' | 'whatsapp' | 'settings'

const NAV: { id: Page; label: string; icon: typeof Users; title: string; subtitle: string }[] = [
  { id: 'overview', label: 'Início', icon: LayoutDashboard, title: '', subtitle: '' },
  { id: 'accesses', label: 'Acessos', icon: Users, title: 'Acessos', subtitle: 'Quem pode entrar no Dinn.' },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, title: 'WhatsApp', subtitle: 'Os números que enviam os lembretes.' },
  { id: 'settings', label: 'Ajustes', icon: SettingsIcon, title: 'Ajustes', subtitle: 'Servidor de WhatsApp e sua conta.' },
]

const pageFromHash = (): Page => {
  const p = location.hash.replace(/^#\/?(admin\/?)?/, '') as Page
  return NAV.some((n) => n.id === p) ? p : 'overview'
}

function useAdminTheme() {
  const theme = useAdmin((s) => s.theme)
  useEffect(() => {
    const html = document.documentElement
    html.classList.add('adm')
    html.dataset.theme = theme
    document.title = 'Admin · Dinn'
  }, [theme])
}

/** Marca do Dinn: barras de crescimento + nome. */
function Logo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className="flex items-center gap-2">
      <svg viewBox="0 0 25 25" className={size === 'lg' ? 'size-7' : 'size-[22px]'} aria-hidden>
        <rect x="0" y="14" width="7" height="11" rx="2" fill="#22c55e" />
        <rect x="9" y="8" width="7" height="17" rx="2" fill="#16a34a" />
        <rect x="18" y="0" width="7" height="25" rx="2" fill="#15803d" />
      </svg>
      <span className={clsx('font-display font-extrabold tracking-[-0.05em]', size === 'lg' ? 'text-[30px]' : 'text-[19px]')}>
        Dinn
      </span>
    </span>
  )
}

export default function AdminApp() {
  useAdminTheme()
  const session = useAdmin((s) => s.session)
  const ready = useAdmin((s) => s.ready)
  useEffect(() => {
    useAdmin.getState().init()
  }, [])
  return (
    <>
      <AnimatePresence mode="wait">{!ready ? null : session ? <Shell key="shell" /> : <Gate key="gate" />}</AnimatePresence>
      <AdminToaster />
    </>
  )
}

// ─── Login / primeiro acesso ──────────────────────────────────

function Gate() {
  const { hasAdmin, setupAdmin, login } = useAdmin()
  const firstRun = !hasAdmin
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!validEmail(email)) return setError('Digite um e-mail válido.')
    if (pass.length < 8) return setError('A senha precisa ter pelo menos 8 caracteres.')
    if (firstRun && pass !== pass2) return setError('As senhas não conferem.')
    setBusy(true)
    const err = firstRun ? await setupAdmin(email, pass) : await login(email, pass)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <motion.div exit={{ opacity: 0 }} className="fixed inset-0 grid place-items-center overflow-y-auto bg-bg p-6">
      <motion.form onSubmit={submit} noValidate initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }} className="flex w-full max-w-[380px] flex-col items-center">
        <Logo size="lg" />
        <h1 className="font-display mt-10 text-center text-[28px] font-bold tracking-[-0.035em]">{firstRun ? 'Crie seu acesso de administrador' : 'Bem-vindo de volta'}</h1>
        <p className="mt-2 text-center text-[15.5px] text-label-2">{firstRun ? 'É com ele que você entra neste painel.' : 'Entre para gerenciar acessos e WhatsApp.'}</p>

        <div className="mt-9 w-full space-y-3">
          <input className={inputCls} type="email" autoComplete="username" placeholder="E-mail" aria-label="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <input className={inputCls} type="password" autoComplete={firstRun ? 'new-password' : 'current-password'} placeholder="Senha (mín. 8 caracteres)" aria-label="Senha" value={pass} onChange={(e) => setPass(e.target.value)} />
          {firstRun && <input className={inputCls} type="password" autoComplete="new-password" placeholder="Confirmar senha" aria-label="Confirmar senha" value={pass2} onChange={(e) => setPass2(e.target.value)} />}
        </div>

        <AnimatePresence>
          {error && (
            <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-4 w-full text-center text-[14px] font-medium text-red">
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <Btn type="submit" busy={busy} className="mt-7 h-12 w-full text-[16px]">
          {firstRun ? 'Continuar' : 'Entrar'}
        </Btn>
      </motion.form>
    </motion.div>
  )
}

// ─── Painel ───────────────────────────────────────────────────

const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

function Shell() {
  const [page, setPageState] = useState<Page>(pageFromHash)
  const [newAccess, setNewAccess] = useState(false)
  const [newInstance, setNewInstance] = useState(false)
  const { adminEmail, logout, theme, setTheme, accesses } = useAdmin()
  const { list: instances, loadedAt, refresh } = useInstances()
  useEffect(() => {
    if (!loadedAt) refresh()
  }, [loadedAt, refresh])

  const setPage = (p: Page) => {
    setPageState(p)
    history.replaceState(null, '', `#/${p}`)
    document.getElementById('admin-main')?.scrollTo({ top: 0 })
  }
  useEffect(() => {
    const onHash = () => setPageState(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const offline = instances.filter((i) => i.state === 'close').length
  const current = NAV.find((n) => n.id === page)!
  const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase())

  const primary: ReactNode =
    page === 'whatsapp' ? (
      <Btn onClick={() => setNewInstance(true)}>
        <Plus className="size-[18px]" strokeWidth={2.4} /> Nova instância
      </Btn>
    ) : page !== 'settings' ? (
      <Btn onClick={() => (page === 'overview' && setPage('accesses'), setNewAccess(true))}>
        <UserPlus className="size-[18px]" strokeWidth={2.2} /> Novo acesso
      </Btn>
    ) : null

  // atalhos de teclado (computador): N = novo, / = buscar, 1–4 = trocar de página
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.ctrlKey || e.metaKey || e.altKey || t.closest('input, textarea, select, [role=dialog]')) return
      const idx = Number(e.key) - 1
      if (NAV[idx]) return (e.preventDefault(), setPage(NAV[idx].id))
      if (e.key === '/') {
        const box = document.querySelector<HTMLInputElement>('[data-search]')
        if (box) (e.preventDefault(), box.focus())
      }
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        if (page === 'whatsapp') setNewInstance(true)
        else if (page !== 'settings') (page === 'overview' && setPage('accesses'), setNewAccess(true))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex h-full bg-bg">
      {/* menu lateral claro (computador) */}
      <aside className="hidden w-[264px] shrink-0 flex-col border-r border-separator bg-surface/60 px-4 pb-4 pt-6 backdrop-blur-xl lg:flex">
        <button onClick={() => setPage('overview')} className="px-3">
          <Logo />
        </button>

        <nav className="mt-9 space-y-1">
          {NAV.map((n, k) => {
            const active = n.id === page
            const count = n.id === 'accesses' ? accesses.length : n.id === 'whatsapp' ? instances.length : undefined
            return (
              <button
                key={n.id}
                onClick={() => setPage(n.id)}
                title={`${n.label} (${k + 1})`}
                className={clsx('relative z-0 flex h-11 w-full items-center gap-3 rounded-[12px] px-3 text-[15px] transition-colors', active ? 'font-semibold text-tint' : 'font-medium text-label-2 hover:bg-fill hover:text-label')}
              >
                {active && <motion.span layoutId="side-pill" className="absolute inset-0 -z-10 rounded-[12px] bg-tint/10" transition={{ type: 'spring', stiffness: 460, damping: 36 }} />}
                <n.icon className="size-[20px]" strokeWidth={active ? 2.2 : 1.8} />
                <span className="flex-1 text-left">{n.label}</span>
                {n.id === 'whatsapp' && offline > 0 && <span className="size-2 rounded-full bg-[#ff3b30]" title={`${offline} desconectada(s)`} />}
                {count !== undefined && <span className={clsx('tabular text-[13.5px]', active ? 'text-tint/70' : 'text-label-3')}>{count}</span>}
              </button>
            )
          })}
        </nav>

        <div className="mt-auto space-y-1">
          <button onClick={() => window.open('/', '_blank')} className="flex h-10 w-full items-center gap-3 rounded-[12px] px-3 text-[14.5px] font-medium text-label-2 hover:bg-fill hover:text-label">
            <ExternalLink className="size-[18px]" /> Abrir o app
          </button>
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="flex h-10 w-full items-center gap-3 rounded-[12px] px-3 text-[14.5px] font-medium text-label-2 hover:bg-fill hover:text-label">
            {theme === 'dark' ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />} {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
          </button>
          <div className="!mt-4 flex items-center gap-3 rounded-[16px] bg-fill p-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-tint text-[15px] font-bold uppercase text-white dark:text-black">{adminEmail[0]}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold">Administrador</span>
              <span className="block truncate text-[12.5px] text-label-2">{adminEmail}</span>
            </span>
            <button onClick={logout} title="Sair" aria-label="Sair" className="grid size-9 place-items-center rounded-full text-label-2 hover:bg-fill-2 hover:text-red">
              <LogOut className="size-[18px]" />
            </button>
          </div>
        </div>
      </aside>

      <div id="admin-main" className="min-w-0 flex-1 overflow-y-auto">
        {/* topo (celular/tablet) */}
        <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-2xl lg:hidden">
          <div className="flex h-16 items-center gap-2 px-6">
            <Logo />
            <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="ml-auto grid size-10 place-items-center rounded-full text-label-2 hover:bg-fill" title="Alternar tema">
              {theme === 'dark' ? <Sun className="size-[19px]" /> : <Moon className="size-[19px]" />}
            </button>
            <Menu
              trigger={
                <button className="grid size-10 place-items-center rounded-full bg-tint text-[15px] font-bold uppercase text-white dark:text-black" title={adminEmail}>
                  {adminEmail[0]}
                </button>
              }
              items={[
                { label: 'Abrir o app', icon: <ExternalLink />, onClick: () => window.open('/', '_blank') },
                { label: 'Sair', icon: <LogOut />, onClick: logout, danger: true },
              ]}
            />
          </div>
        </header>

        <main className="mx-auto max-w-[1640px] px-6 pb-32 pt-6 lg:px-12 lg:pb-12 lg:pt-10">
          {/* título da página */}
          <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
            <div className="min-w-0">
              {page === 'overview' ? (
                <>
                  <p className="text-[15px] font-medium text-label-2">{today}</p>
                  <h1 className="font-display mt-1 text-[34px] font-bold leading-tight tracking-[-0.04em] lg:text-[38px]">{greeting()}</h1>
                </>
              ) : (
                <>
                  <h1 className="font-display text-[34px] font-bold leading-tight tracking-[-0.04em] lg:text-[38px]">{current.title}</h1>
                  <p className="mt-1 text-[16px] text-label-2">{current.subtitle}</p>
                </>
              )}
            </div>
            {primary && (
              <div className="flex items-center gap-3">
                <span className="hidden items-center gap-1.5 text-[13px] text-label-3 xl:flex">
                  Atalho <kbd className="grid h-6 min-w-6 place-items-center rounded-md bg-fill px-1.5 font-sans text-[12px] font-semibold text-label-2">N</kbd>
                </span>
                {primary}
              </div>
            )}
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={page} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}>
              {page === 'overview' && <Overview go={setPage} />}
              {page === 'accesses' && <Accesses onNew={{ open: newAccess, set: setNewAccess }} />}
              {page === 'whatsapp' && <WhatsApp onNew={{ open: newInstance, set: setNewInstance }} goSettings={() => setPage('settings')} />}
              {page === 'settings' && <Settings />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* barra inferior (celular) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 bg-bg/85 px-2 pb-[max(var(--sab),10px)] pt-2 backdrop-blur-2xl lg:hidden">
        {NAV.map((n) => {
          const active = n.id === page
          return (
            <button key={n.id} onClick={() => setPage(n.id)} className={clsx('relative flex flex-col items-center gap-1 py-1', active ? 'text-tint' : 'text-label-3')}>
              <n.icon className="size-[23px]" strokeWidth={active ? 2.2 : 1.8} />
              <span className="text-[11px] font-medium">{n.label}</span>
              {n.id === 'whatsapp' && offline > 0 && <span className="absolute right-[calc(50%-16px)] top-0.5 size-2 rounded-full bg-[#ff3b30] ring-2 ring-bg" />}
            </button>
          )
        })}
      </nav>
    </motion.div>
  )
}
