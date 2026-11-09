import { useEffect, useMemo } from 'react'
import { motion } from 'motion/react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { ChevronRight, CircleCheck } from 'lucide-react'
import clsx from 'clsx'
import { accessStatus, daysUntil, useAdmin } from '../store'
import { useInstances } from '../instances'
import { Avatar, Card, Kpi, timeAgo } from '../ui'
import { expiryText, StatusPill } from './Accesses'
import { connInfo } from './WhatsApp'
import type { ConnState } from '../evolution'

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const STATE_COLOR: Record<ConnState, string> = { open: '#34c759', connecting: '#ff9500', close: '#ff3b30' }

function More({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex shrink-0 items-center gap-0.5 text-[15px] font-medium text-tint hover:opacity-80">
      {children} <ChevronRight className="size-4" strokeWidth={2.4} />
    </button>
  )
}

/** Balão do gráfico de novos acessos (fora do componente: não é recriado a cada render). */
function NewTip({ active, payload, label }: { active?: boolean; payload?: { value?: unknown }[]; label?: string | number }) {
  if (!active || !payload?.length) return null
  const v = Number(payload[0].value ?? 0)
  return (
    <div className="rounded-[14px] bg-surface px-3.5 py-2 text-[14px] shadow-[var(--adm-pop)]">
      <span className="font-semibold capitalize">{label}</span> · {v} {v === 1 ? 'novo' : 'novos'}
    </div>
  )
}

/** Barra arredondada; o mês atual em verde. */
const barShape = (p: unknown) => {
  const b = p as { x: number; y: number; width: number; height: number; payload: { current: boolean } }
  return <rect x={b.x} y={b.y} width={b.width} height={b.height} rx={Math.min(10, b.width / 2, b.height / 2)} fill={b.payload.current ? 'var(--chart-a)' : 'var(--color-fill-2)'} />
}

export default function Overview({ go }: { go: (page: 'accesses' | 'whatsapp') => void }) {
  const accesses = useAdmin((s) => s.accesses)
  const log = useAdmin((s) => s.log)
  const { list, refresh, loadedAt } = useInstances()

  useEffect(() => {
    if (!loadedAt) refresh()
  }, [loadedAt, refresh])

  const st = useMemo(() => {
    const c = { ativo: 0, vencendo: 0, vencido: 0, bloqueado: 0 }
    accesses.forEach((a) => c[accessStatus(a)]++)
    return c
  }, [accesses])

  // novos acessos por mês (últimos 6 meses)
  const series = useMemo(() => {
    const now = new Date()
    return Array.from({ length: 6 }, (_, k) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + k, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      return { label: MONTHS[d.getMonth()], value: accesses.filter((a) => a.createdAt.startsWith(key)).length, current: k === 5 }
    })
  }, [accesses])

  const conn = (s: ConnState) => list.filter((i) => i.state === s).length
  const messages = list.reduce((sum, i) => sum + i.messages, 0)
  const attention = accesses
    .filter((a) => a.expiresAt && !a.blocked && daysUntil(a.expiresAt) <= 7)
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
    .slice(0, 5)

  return (
    <div className="grid gap-5 xl:grid-cols-12">
      {/* destaque: cartão verde da marca */}
      <motion.button
        onClick={() => go('accesses')}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
        className="adm-brand relative flex flex-col overflow-hidden rounded-[28px] p-8 text-left text-white xl:col-span-5"
      >
        <p className="text-[15px] font-medium text-white/60">Acessos ativos</p>
        <p className="tabular font-display mt-2 text-[72px] font-extrabold leading-none tracking-[-0.05em]">{st.ativo + st.vencendo}</p>
        <p className="mt-3 text-[15px] text-white/60">de {accesses.length} cadastrados</p>
        <div className="relative mt-auto grid grid-cols-3 gap-4 border-t border-white/10 pt-6 max-xl:mt-10">
          {[
            ['Novos no mês', series[5].value],
            ['A renovar', st.vencendo + st.vencido],
            ['Bloqueados', st.bloqueado],
          ].map(([l, v]) => (
            <div key={l}>
              <p className="tabular font-display text-[28px] font-bold leading-none tracking-[-0.03em]">{v}</p>
              <p className="mt-1.5 text-[13.5px] text-white/55">{l}</p>
            </div>
          ))}
        </div>
        {/* barras do logo ao fundo */}
        <svg viewBox="0 0 25 25" className="pointer-events-none absolute right-8 top-8 size-24 opacity-[0.08]" aria-hidden>
          <rect x="0" y="14" width="7" height="11" rx="2" fill="white" />
          <rect x="9" y="8" width="7" height="17" rx="2" fill="white" />
          <rect x="18" y="0" width="7" height="25" rx="2" fill="white" />
        </svg>
      </motion.button>

      <div className="grid grid-cols-2 gap-5 xl:col-span-4">
        <Kpi label="Ativos" value={st.ativo} dot={STATE_COLOR.open} hint="Em dia" />
        <Kpi label="Vencendo" value={st.vencendo} dot={STATE_COLOR.connecting} hint="Próximos 7 dias" delay={0.04} />
        <Kpi label="Vencidos" value={st.vencido} dot={STATE_COLOR.close} hint="Sem acesso" delay={0.08} />
        <Kpi label="Mensagens" value={messages.toLocaleString('pt-BR')} dot="#007aff" hint="Todas as instâncias" delay={0.12} />
      </div>

      <Card title="WhatsApp" action={<More onClick={() => go('whatsapp')}>Ver tudo</More>} className="xl:col-span-3">
        <p className="tabular font-display text-[52px] font-extrabold leading-none tracking-[-0.05em]">
          {conn('open')}
          <span className="text-label-3">/{list.length}</span>
        </p>
        <p className="mt-2 text-[14.5px] text-label-2">{conn('close') ? `${conn('close')} desconectada${conn('close') > 1 ? 's' : ''}` : 'Todas online'}</p>
        <ul className="mt-5 space-y-3">
          {list.slice(0, 4).map((i) => (
            <li key={i.name} className="flex items-center gap-3" title={connInfo[i.state].label}>
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: STATE_COLOR[i.state] }} />
              <span className="flex-1 truncate text-[15px]">{i.name}</span>
            </li>
          ))}
          {!list.length && <li className="text-[15px] text-label-2">Nenhuma instância ainda.</li>}
        </ul>
      </Card>

      <Card title="Precisa de atenção" subtitle="Vencem em até 7 dias ou já venceram" pad={false} action={<More onClick={() => go('accesses')}>Acessos</More>} className="xl:col-span-5">
        <ul className="px-3 pb-3">
          {attention.map((a) => (
            <li key={a.id} className="flex items-center gap-4 rounded-[16px] px-4 py-3 transition-colors hover:bg-fill">
              <Avatar name={a.name} size={44} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold">{a.name}</span>
                <span className={clsx('block text-[14px]', daysUntil(a.expiresAt) < 0 ? 'text-red' : 'text-label-2')}>{expiryText(a)}</span>
              </span>
              <StatusPill a={a} />
            </li>
          ))}
          {!attention.length && (
            <li className="flex flex-col items-center px-5 py-14 text-center">
              <CircleCheck className="size-10 text-tint" strokeWidth={1.5} />
              <p className="font-display mt-2 text-[19px] font-bold tracking-[-0.02em]">Tudo em dia</p>
              <p className="mt-1 text-[15px] text-label-2">Ninguém vence nos próximos 7 dias.</p>
            </li>
          )}
        </ul>
      </Card>

      <Card title="Novos acessos" subtitle="Últimos 6 meses" className="xl:col-span-4">
        <div className="h-[230px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 8, right: 0, left: 0, bottom: 0 }} barCategoryGap="22%">
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--color-label-2)', fontSize: 13 }} dy={8} />
              <Tooltip cursor={false} content={<NewTip />} />
              <Bar dataKey="value" minPointSize={6} shape={barShape} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="Atividade" pad={false} className="xl:col-span-3">
        <ul className="px-7 pb-5">
          {log.slice(0, 6).map((l) => (
            <li key={l.id} className="flex gap-3 border-b border-separator py-3 last:border-0">
              <span className={clsx('mt-[7px] size-2 shrink-0 rounded-full', l.tone === 'green' ? 'bg-[#34c759]' : l.tone === 'red' ? 'bg-[#ff3b30]' : l.tone === 'blue' ? 'bg-[#007aff]' : 'bg-label-3')} />
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] leading-snug">{l.text}</span>
                <span className="block text-[13px] text-label-3">{timeAgo(l.at)}</span>
              </span>
            </li>
          ))}
          {!log.length && <li className="py-6 text-[15px] text-label-2">Nada registrado ainda.</li>}
        </ul>
      </Card>
    </div>
  )
}
