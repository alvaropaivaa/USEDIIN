import { useState } from 'react'
import { motion } from 'motion/react'
import {
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  Bell,
  BellRing,
  CalendarClock,
  Clock,
  CreditCard,
  HandCoins,
  KeyRound,
  PieChart,
  Settings2,
  Smartphone,
  Target,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import clsx from 'clsx'
import { useData, useUI } from '../lib/store'
import { diffDays, fmtDate, today, toISO } from '../lib/dates'
import { haptic } from '../lib/haptics'
import { deviceStatus, enableNotifications, maskMoney, openLink, useNotices, type Notice, type NoticeType } from '../lib/notify'
import { Sheet, toast } from '../components/sheet'
import { Empty } from '../components/ui'

/** Ícone e cor de cada tipo de aviso (também usado no painel do computador). */
export const noticeLook: Record<NoticeType, { icon: LucideIcon; cls: string }> = {
  hoje: { icon: CalendarClock, cls: 'bg-blue/10 text-blue' },
  atrasos: { icon: AlertTriangle, cls: 'bg-red/10 text-red' },
  amanha: { icon: Clock, cls: 'bg-orange/15 text-orange' },
  faturas: { icon: CreditCard, cls: 'bg-blue/10 text-blue' },
  lancamentos: { icon: ArrowLeftRight, cls: 'bg-tint/12 text-green' },
  orcamento: { icon: PieChart, cls: 'bg-orange/15 text-orange' },
  metas: { icon: Target, cls: 'bg-tint/12 text-green' },
  dividas: { icon: HandCoins, cls: 'bg-fill text-label-2' },
  resumo: { icon: BarChart3, cls: 'bg-blue/10 text-blue' },
  plano: { icon: KeyRound, cls: 'bg-orange/15 text-orange' },
  teste: { icon: BellRing, cls: 'bg-tint/12 text-green' },
  aviso: { icon: Bell, cls: 'bg-fill text-label-2' },
}

/** Fecha a central e abre Configurações → Notificações. */
const toSettings = () => {
  haptic()
  useUI.getState().openInbox(false)
  setTimeout(() => useUI.getState().openSettings(true, 'notificacoes'), 300)
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** "Hoje", "Ontem" ou a data. */
function dayLabel(iso: string) {
  const d = diffDays(today(), toISO(new Date(iso)))
  return d === 0 ? 'Hoje' : d === 1 ? 'Ontem' : fmtDate(toISO(new Date(iso)))
}

/** Convite para ligar as notificações (some quando já estão ativas). */
function EnableCard() {
  const enabled = useNotices((s) => s.enabled)
  const push = useNotices((s) => s.push)
  const [busy, setBusy] = useState(false)
  const status = deviceStatus({ enabled, push })
  if (status === 'push' || status === 'local' || status === 'unsupported') return null

  const install = status === 'install'
  return (
    <div className="mb-5 rounded-[22px] bg-surface p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className="grad-green grid size-11 shrink-0 place-items-center rounded-full text-white">
          {install ? <Smartphone className="size-5" /> : <BellRing className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">{install ? 'Instale o app para receber avisos' : 'Receba avisos de tudo'}</p>
          <p className="mt-0.5 text-[13px] leading-[18px] text-label-2">
            {install
              ? 'No iPhone, toque em Compartilhar e depois em “Adicionar à Tela de Início”. Abra o Dinn por lá e ative as notificações.'
              : status === 'denied'
                ? 'As notificações estão bloqueadas neste navegador. Libere nas configurações do site e volte aqui.'
                : 'Contas que vencem, faturas, limites de gastos e metas, mesmo com o app fechado.'}
          </p>
        </div>
      </div>
      {!install && status !== 'denied' && (
        <motion.button
          whileTap={{ scale: 0.97 }}
          disabled={busy}
          onClick={async () => {
            haptic('medium')
            setBusy(true)
            const r = await enableNotifications()
            setBusy(false)
            toast(r.ok ? 'Notificações ativadas' : r.message)
          }}
          className="grad-btn mt-3 h-11 w-full rounded-full text-[14px] font-semibold text-white disabled:opacity-70"
        >
          Ativar notificações
        </motion.button>
      )}
      <button onClick={toSettings} className="mt-2 w-full py-1.5 text-[13px] font-semibold text-tint">
        Escolher o que receber
      </button>
    </div>
  )
}

function Item({ n, privacy, onOpen }: { n: Notice; privacy: boolean; onOpen: (n: Notice) => void }) {
  const { icon: Icon, cls } = noticeLook[n.type] ?? noticeLook.aviso
  return (
    <motion.button
      onClick={() => onOpen(n)}
      whileTap={{ backgroundColor: 'var(--fill)' }}
      className="relative flex w-full items-start gap-3 px-4 py-3 text-left"
    >
      <span className={clsx('mt-0.5 grid size-10 shrink-0 place-items-center rounded-full', cls)}>
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={clsx('min-w-0 flex-1 truncate text-[15px]', n.read ? 'font-medium' : 'font-semibold')}>{n.title}</span>
          <span className="tabular shrink-0 text-[12px] text-label-2">{time(n.at)}</span>
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[13px] leading-[18px] text-label-2">{privacy ? maskMoney(n.body) : n.body}</span>
      </span>
      {!n.read && <span aria-label="Não lida" className="mt-2 size-2.5 shrink-0 rounded-full bg-tint" />}
    </motion.button>
  )
}

export default function InboxSheet() {
  const open = useUI((s) => s.inbox)
  const openInbox = useUI((s) => s.openInbox)
  const items = useNotices((s) => s.items)
  const { markRead, readAll, clear } = useNotices()
  const privacy = useData((s) => s.settings.privacy)
  const unread = items.filter((i) => !i.read).length

  // agrupa por dia, mais recentes primeiro
  const groups: { label: string; list: Notice[] }[] = []
  for (const n of items) {
    const label = dayLabel(n.at)
    const g = groups.at(-1)
    if (g?.label === label) g.list.push(n)
    else groups.push({ label, list: [n] })
  }

  const go = (n: Notice) => {
    haptic()
    markRead(n.key)
    // a central fecha e o destino abre por cima
    openLink(n.url)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={openInbox}
      title="Notificações"
      action={
        unread > 0 && (
          <button onClick={() => (haptic(), readAll())} className="text-[15px] font-medium text-tint">
            Ler todas
          </button>
        )
      }
    >
      <EnableCard />

      {items.length === 0 ? (
        <Empty art="avisos" title="Nenhuma notificação" text="Contas a pagar, faturas, limites de gastos e resumos aparecem aqui." />
      ) : (
        groups.map((g) => (
          <section key={g.label} className="mb-5">
            <h3 className="mb-2 px-1 text-[13px] font-semibold text-label-2">{g.label}</h3>
            <div className="overflow-hidden rounded-[22px] bg-surface shadow-card [&>*+*]:before:absolute [&>*+*]:before:left-[68px] [&>*+*]:before:right-0 [&>*+*]:before:top-0 [&>*+*]:before:h-px [&>*+*]:before:scale-y-50 [&>*+*]:before:bg-separator [&>*+*]:before:content-['']">
              {g.list.map((n) => (
                <Item key={n.key} n={n} privacy={privacy} onOpen={go} />
              ))}
            </div>
          </section>
        ))
      )}

      <div className="mt-2 flex items-center justify-center gap-6 pb-2 text-[14px] font-semibold">
        <button onClick={toSettings} className="flex items-center gap-1.5 text-tint">
          <Settings2 className="size-4" /> Configurar
        </button>
        {items.length > 0 && (
          <button
            onClick={() => {
              if (!confirm('Apagar todas as notificações da lista?')) return
              haptic('medium')
              clear()
            }}
            className="flex items-center gap-1.5 text-red"
          >
            <Trash2 className="size-4" /> Limpar
          </button>
        )}
      </div>
    </Sheet>
  )
}
