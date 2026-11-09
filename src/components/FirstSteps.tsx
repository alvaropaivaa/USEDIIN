import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Check, ChevronRight, Rocket, X } from 'lucide-react'
import clsx from 'clsx'
import { useData, useUI } from '../lib/store'
import { useNotices } from '../lib/notify'
import { haptic } from '../lib/haptics'

// "Primeiros passos": só para conta nova. Na primeira vez que o Início abre, a conta sem contas, lançamentos e
// metas fica marcada como nova (nos ajustes, que vão para a nuvem: vale em todos os aparelhos); quem já usa o
// app não vê. Some ao fechar, ou na próxima vez que o Início abrir com os cinco passos feitos.

function useFirstSteps() {
  const accounts = useData((s) => s.accounts.length)
  const transactions = useData((s) => s.transactions.length)
  const goals = useData((s) => s.goals.length)
  const budgets = useData((s) => s.categories.some((c) => (c.budget ?? 0) > 0) || s.settings.budgetTotal > 0)
  const mode = useData((s) => s.settings.firstSteps)
  const setSettings = useData((s) => s.setSettings)
  const enabled = useNotices((s) => s.enabled)
  const { openAccount, openTx, setTab, openGoal, openSettings } = useUI()

  const steps = [
    { label: 'Cadastre suas contas', cta: 'Cadastrar', done: accounts > 0, action: () => openAccount(true) },
    { label: 'Registre um lançamento', cta: 'Lançar', done: transactions > 0, action: () => openTx(true, { type: 'despesa' }) },
    { label: 'Defina limites de gastos', cta: 'Definir', done: budgets, action: () => setTab('budget') },
    { label: 'Crie uma meta', cta: 'Criar', done: goals > 0, action: () => openGoal(true) },
    { label: 'Ative as notificações', cta: 'Ativar', done: enabled, action: () => openSettings(true, 'notificacoes') },
  ]
  const done = steps.filter((s) => s.done).length
  const all = done === steps.length
  // com tudo feito ao abrir, encerra: o "Tudo pronto" só aparece na hora em que o último passo é feito
  const [allAtOpen] = useState(all)
  const fresh = accounts + transactions + goals === 0

  useEffect(() => {
    if (mode === '') setSettings({ firstSteps: fresh ? 'new' : 'off' })
    else if (mode === 'new' && allAtOpen) setSettings({ firstSteps: 'off' })
  }, [mode, fresh, allAtOpen, setSettings])

  const close = () => (haptic(), setSettings({ firstSteps: 'off' }))
  return { show: mode === 'new' && !allAtOpen, steps, done, all, close }
}

/** Cartão do Início. Computador: os cinco passos lado a lado; celular (`compact`): um embaixo do outro. */
export function FirstSteps({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { show, steps, done, all, close } = useFirstSteps()
  if (!show) return null

  const bar = (
    <motion.div className="h-full rounded-full bg-tint" initial={{ width: 0 }} animate={{ width: `${(done / steps.length) * 100}%` }} transition={{ duration: 0.8, ease: 'easeOut' }} />
  )
  const closeButton = (
    <button onClick={close} title="Fechar" aria-label="Fechar primeiros passos" className="grid size-8 shrink-0 place-items-center rounded-full text-label-2 hover:bg-fill active:bg-fill">
      <X className="size-4" />
    </button>
  )
  const bubble = (ok: boolean, i: number) => (
    <span className={clsx('grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-bold', ok ? 'bg-tint text-white' : 'bg-surface text-label-2 shadow-card')}>
      {ok ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
    </span>
  )

  if (compact)
    return (
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={clsx('overflow-hidden rounded-[22px] bg-surface shadow-card', className)}>
        <div className="flex items-center gap-3 pl-4 pr-2.5 pt-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-tint/10 text-tint">
            <Rocket className="size-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{all ? 'Tudo pronto' : 'Primeiros passos'}</h2>
            <p className="tabular truncate text-[12px] text-label-2">{all ? 'Agora é só acompanhar.' : `${done} de ${steps.length} · leva poucos minutos`}</p>
          </div>
          {closeButton}
        </div>
        <div className="mx-4 mt-3 h-1.5 overflow-hidden rounded-full bg-fill">{bar}</div>
        <div className="mt-2 [&>*+*]:before:absolute [&>*+*]:before:left-[52px] [&>*+*]:before:right-0 [&>*+*]:before:top-0 [&>*+*]:before:h-px [&>*+*]:before:scale-y-50 [&>*+*]:before:bg-separator [&>*+*]:before:content-['']">
          {steps.map((s, i) => (
            <button
              key={s.label}
              onClick={() => (haptic(), s.action())}
              disabled={s.done}
              className="relative flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-fill/60"
            >
              {bubble(s.done, i)}
              <span className={clsx('min-w-0 flex-1 truncate text-[14px] font-medium', s.done && 'text-label-2 line-through decoration-label-3')}>{s.label}</span>
              {s.done ? (
                <span className="text-[12px] font-semibold text-label-3">Feito</span>
              ) : (
                <span className="flex shrink-0 items-center text-[13px] font-semibold text-tint">
                  {s.cta}
                  <ChevronRight className="size-4" />
                </span>
              )}
            </button>
          ))}
        </div>
      </motion.section>
    )

  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={clsx('rounded-[22px] bg-surface p-5 shadow-card', className)}>
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-tint/10 text-tint">
          <Rocket className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em]">{all ? 'Tudo pronto' : 'Primeiros passos'}</h2>
          <p className="text-[12px] text-label-2">{all ? 'Suas finanças estão organizadas. Agora é só acompanhar.' : 'Deixe suas finanças organizadas em poucos minutos.'}</p>
        </div>
        <span className="tabular text-[12.5px] font-semibold text-label-2">
          {done} de {steps.length}
        </span>
        <div className="h-2 w-36 overflow-hidden rounded-full bg-fill">{bar}</div>
        {closeButton}
      </div>
      <div className="grid grid-cols-3 gap-2.5 xl:grid-cols-5">
        {steps.map((s, i) => (
          <button
            key={s.label}
            onClick={s.action}
            disabled={s.done}
            className={clsx('flex items-start gap-2.5 rounded-[16px] p-3 text-left transition-colors', s.done ? 'bg-tint/[0.07]' : 'bg-fill/50 hover:bg-fill')}
          >
            {bubble(s.done, i)}
            <span className="min-w-0">
              <span className={clsx('block text-[13px] font-semibold leading-tight', s.done && 'text-label-2 line-through decoration-label-3')}>{s.label}</span>
              <span className="mt-1 block text-[12px] font-semibold text-tint">{s.done ? 'Feito' : `${s.cta} →`}</span>
            </span>
          </button>
        ))}
      </div>
    </motion.section>
  )
}
