import { Area, Bar, CartesianGrid, Cell, ComposedChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { money, moneyCompact } from '../lib/format'

function Tip({ active, payload, title }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; title: (p: unknown) => string }) {
  if (!active || !payload?.length) return null
  const row = (payload[0] as unknown as { payload: unknown }).payload
  return (
    <div className="glass min-w-40 rounded-[20px] px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
      <p className="mb-1 text-[12px] font-semibold text-label-2">{title(row)}</p>
      {payload.map((p) => (
        <p key={p.name} className="tabular flex items-center justify-between gap-3 text-[13px]">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-semibold">{money(p.value)}</span>
        </p>
      ))}
    </div>
  )
}

const axis = { tick: { fill: 'var(--label-2)', fontSize: 11 }, axisLine: false, tickLine: false } as const

/** Rosca com total no centro e legenda com percentuais ao lado. */
export function Donut({ slices, center, caption }: { slices: { label: string; value: number; color: string }[]; center: string; caption: string }) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0)
  return (
    <div className="flex items-center gap-4">
      <div className="relative size-36 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices.filter((x) => x.value > 0)}
              dataKey="value"
              nameKey="label"
              innerRadius="72%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              paddingAngle={2}
              cornerRadius={6}
              stroke="none"
              animationDuration={700}
            >
              {/* duas categorias podem ter o mesmo nome: a chave leva a posição */}
              {slices.filter((x) => x.value > 0).map((x, i) => (
                <Cell key={`${i}-${x.label}`} fill={x.color} />
              ))}
            </Pie>
            <Tooltip content={<DonutTip total={total} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="tabular text-[14px] font-semibold">{center}</span>
          <span className="text-[10px] text-label-2">{caption}</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-2.5">
        {slices.map((x, i) => (
          <li key={`${i}-${x.label}`} className="flex items-center gap-2 text-[13px]">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: x.color }} />
            <span className="flex-1 truncate text-label-2">{x.label}</span>
            <span className="tabular font-bold">{total ? Math.round((Math.max(0, x.value) / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DonutTip({ active, payload, total }: { active?: boolean; payload?: { name: string; value: number }[]; total: number }) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return (
    <div className="glass rounded-[20px] px-3 py-2 text-[12px] shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
      <p className="font-semibold">{p.name}</p>
      <p className="tabular text-label-2">
        {money(p.value)} · {total ? Math.round((p.value / total) * 100) : 0}%
      </p>
    </div>
  )
}

export interface FlowPoint {
  label: string
  /** Dia (AAAA-MM-DD) do começo do período, para a data embaixo do rótulo. */
  date?: string
  income: number
  expense: number
  current?: boolean
}

/**
 * Fluxo de caixa: entradas (verde) × saídas (vermelho) lado a lado, e o balanço do período em linha.
 * `tall` = computador (eixo em reais e rótulos em duas linhas).
 */
export function CashFlowChart({ data, tall }: { data: FlowPoint[]; tall?: boolean }) {
  const dense = data.length > 12
  const rows = data.map((d) => ({ ...d, balance: Math.round((d.income - d.expense) * 100) / 100 }))
  const bars = data.length <= 7 ? 14 : dense ? undefined : 18
  return (
    <div className={tall ? 'h-72' : 'h-44 xl:h-64'}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 10, right: tall ? 12 : 0, left: tall ? 4 : 0, bottom: 0 }} barCategoryGap={dense ? '8%' : '26%'} barGap={dense ? 0 : 2}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          {tall ? (
            <XAxis dataKey="label" interval={dense ? 2 : 0} height={dense ? 24 : 40} tick={<TwoLineTick data={data} />} axisLine={false} tickLine={false} />
          ) : (
            <XAxis dataKey="label" interval={dense ? 4 : 0} {...axis} />
          )}
          {tall ? <YAxis tickFormatter={(v) => moneyCompact(v)} width={68} {...axis} /> : <YAxis hide />}
          <Tooltip cursor={{ fill: 'var(--fill)' }} content={<Tip title={(p) => (p as FlowPoint).label} />} />
          <Bar dataKey="income" name="Entradas" fill="var(--chart-a)" radius={[5, 5, 0, 0]} maxBarSize={bars} animationDuration={500} />
          <Bar dataKey="expense" name="Saídas" fill="var(--red)" fillOpacity={0.78} radius={[5, 5, 0, 0]} maxBarSize={bars} animationDuration={500} />
          {tall && !dense && (
            <Area
              type="monotone"
              dataKey="balance"
              name="Balanço"
              stroke="var(--label-2)"
              strokeWidth={2}
              strokeDasharray="4 4"
              fill="none"
              dot={{ r: 3, fill: 'var(--surface)', stroke: 'var(--label-2)', strokeWidth: 2 }}
              activeDot={{ r: 5 }}
              animationDuration={600}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export function FlowLegend({ balance }: { balance?: boolean }) {
  return (
    <div className="mt-2 flex justify-center gap-5 text-[12px] text-label-2">
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-[var(--chart-a)]" /> Entradas
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-red/80" /> Saídas
      </span>
      {balance && (
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full bg-label-2" /> Balanço
        </span>
      )}
    </div>
  )
}

/** Rótulo do eixo em duas linhas: dia da semana e data (computador). */
function TwoLineTick({ x, y, payload, data }: { x?: number; y?: number; payload?: { value: string; index: number }; data: Pick<FlowPoint, 'label' | 'date'>[] }) {
  const d = payload ? data[payload.index] : undefined
  const sub = d?.date && data.length <= 7 ? `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}` : ''
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={12} textAnchor="middle" fill="var(--label-2)" fontSize={12}>
        {payload?.value}
      </text>
      {sub && (
        <text dy={27} textAnchor="middle" fill="var(--label-3)" fontSize={11}>
          {sub}
        </text>
      )}
    </g>
  )
}
