import { useState } from 'react'
import { motion } from 'motion/react'
import { BellRing, ChevronDown, Download, Send, Share, SquarePlus } from 'lucide-react'
import clsx from 'clsx'
import { alertGroups } from '../lib/alerts'
import { useData } from '../lib/store'
import { haptic } from '../lib/haptics'
import { deviceStatus, disableNotifications, enableNotifications, sendTest, useNotices, type DeviceStatus } from '../lib/notify'
import { promptInstall, usePWA } from '../lib/pwa'
import { toast } from '../components/sheet'
import { Row, Section, Toggle } from '../components/ui'

export const statusText: Record<DeviceStatus, string> = {
  push: 'Ativas · chegam com o app fechado',
  local: 'Ativas com o app aberto',
  off: 'Desativadas',
  denied: 'Bloqueadas no navegador',
  install: 'Instale o app para ativar',
  unsupported: 'Sem suporte neste navegador',
}

const statusHelp: Record<DeviceStatus, string> = {
  push: 'Os avisos chegam no horário mesmo com o Dinn fechado.',
  local: 'Os avisos aparecem quando você abre o Dinn. Com o app fechado, só depois que o servidor de notificações estiver ativo.',
  off: 'Ative para receber vencimentos, atrasos, pagamentos e resumos.',
  denied: 'Libere as notificações nas configurações do site (o cadeado ao lado do endereço) e volte aqui.',
  install: 'No iPhone, as notificações só funcionam com o Dinn instalado na Tela de Início.',
  unsupported: 'Use o Chrome, o Edge, o Firefox ou o Safari atualizado.',
}

const hours = Array.from({ length: 17 }, (_, i) => i + 6)
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`

/** Passo a passo para instalar no iPhone (o Safari não tem botão de instalar). */
function IOSInstall() {
  const steps = [
    { icon: Share, text: 'Toque em Compartilhar, na barra do Safari' },
    { icon: SquarePlus, text: 'Escolha “Adicionar à Tela de Início”' },
    { icon: BellRing, text: 'Abra o Dinn pelo ícone e ative aqui' },
  ]
  return (
    <Section header="Instalar no iPhone">
      {steps.map((s, i) => (
        <div key={i} className="relative flex min-h-14 items-center gap-3 px-4 py-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-tint/12 text-green">
            <s.icon className="size-[18px]" />
          </span>
          <span className="text-[14px] font-medium">
            <span className="text-label-2">{i + 1}. </span>
            {s.text}
          </span>
        </div>
      ))}
    </Section>
  )
}

export default function NotificationSettings() {
  const enabled = useNotices((s) => s.enabled)
  const push = useNotices((s) => s.push)
  const others = useNotices((s) => s.others)
  const settings = useData((s) => s.settings)
  const setSettings = useData((s) => s.setSettings)
  const { canInstall, installed } = usePWA()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const status = deviceStatus({ enabled, push })
  const on = status === 'push' || status === 'local'

  const toggle = async (want: boolean) => {
    if (busy) return
    setBusy(true)
    setNote('')
    if (want) {
      const r = await enableNotifications()
      if (r.ok && r.message === 'Notificações ativadas') toast(r.message)
      else setNote(r.message)
    } else {
      await disableNotifications()
      toast('Notificações desativadas')
    }
    setBusy(false)
  }

  return (
    <>
      <div className="mb-6 mt-1 flex items-center gap-3 rounded-[22px] bg-surface p-4 shadow-card">
        <span className={clsx('grid size-12 shrink-0 place-items-center rounded-full', on ? 'grad-green text-white' : 'bg-fill text-label-2')}>
          <BellRing className="size-[22px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold">Neste aparelho</span>
          <span className={clsx('block text-[13px]', on ? 'font-medium text-green' : 'text-label-2')}>{statusText[status]}</span>
        </span>
      </div>

      {status === 'install' ? (
        <IOSInstall />
      ) : (
        <Section footer={note || statusHelp[status]}>
          <Toggle label="Receber notificações" detail={busy ? 'Um instante…' : 'Vale só para este aparelho'} checked={on} onChange={toggle} />
          {on && <Row icon={<Send className="size-[18px]" />} label="Enviar notificação de teste" onClick={async () => toast(await sendTest())} />}
        </Section>
      )}

      {canInstall && !installed && (
        <Section footer="Abre como um app, sem a barra do navegador, e funciona sem internet.">
          <Row icon={<Download className="size-[18px]" />} label="Instalar o Dinn" detail="Ícone na tela inicial" onClick={async () => (await promptInstall()) && toast('App instalado')} />
        </Section>
      )}

      <Section header="Aviso diário" footer="Vencimentos de hoje, atrasos e os de amanhã chegam juntos nesse horário. Resumos saem às segundas e no dia 1º.">
        <label className="relative flex min-h-[54px] items-center gap-3 px-4 py-2">
          <span className="flex-1 text-[15px] font-medium">Horário</span>
          <span className="tabular text-[15px] font-semibold text-tint">{hh(settings.alertHour)}</span>
          <ChevronDown className="size-4 text-label-3" strokeWidth={2.5} />
          <select
            aria-label="Horário do aviso diário"
            value={settings.alertHour}
            onChange={(e) => (haptic(), setSettings({ alertHour: Number(e.target.value) }))}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            {hours.map((h) => (
              <option key={h} value={h}>
                {hh(h)}
              </option>
            ))}
          </select>
        </label>
      </Section>

      {alertGroups.map((g, gi) => (
        <Section
          key={g.title}
          header={g.title}
          footer={
            gi === alertGroups.length - 1
              ? `Valem para todos os aparelhos da conta.${others ? ` Também chegam em mais ${others} ${others === 1 ? 'aparelho' : 'aparelhos'}.` : ''}`
              : undefined
          }
        >
          {g.items.map((i) => (
            <Toggle
              key={i.type}
              label={i.label}
              detail={i.detail}
              checked={settings.alerts[i.type] !== false}
              onChange={(v) => setSettings({ alerts: { ...settings.alerts, [i.type]: v } })}
            />
          ))}
        </Section>
      ))}

      {!on && status !== 'install' && status !== 'unsupported' && status !== 'denied' && (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="-mt-3 mb-4 px-1 text-[12px] text-label-2">
          Mesmo desativadas aqui, as notificações continuam na central do sino.
        </motion.p>
      )}
    </>
  )
}
