import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useAnimationControls } from 'motion/react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Check, Copy, Delete, HandCoins } from 'lucide-react'
import clsx from 'clsx'
import { fmtDate } from '../lib/dates'
import { moneyRaw, percent } from '../lib/format'
import { buildSchedule, firstDueFor, type Frequency, type InterestMode } from '../lib/loans'
import type { Draft } from '../lib/store'
import { openWhatsApp } from '../lib/whatsapp'
import { haptic } from '../lib/haptics'
import { WhatsAppIcon } from './icons'
import { toast } from './sheet'
import { Button, Section, Segmented } from './ui'

// Simulador de financiamento: antes de assinar, veja parcela, juros e custo total e compare prazos.
// Usa o mesmo cálculo das dívidas (buildSchedule), então o que se simula é o que se registra.

/** Última simulação: fica guardada neste aparelho para a próxima consulta. */
export const useCalc = create<Draft & { set: (p: Partial<Draft>) => void }>()(
  persist((set) => ({ principal: 1000, rate: 0.05, mode: 'simples' as InterestMode, frequency: 'mensal' as Frequency, count: 4, set: (p) => set(p) }), {
    name: 'jurospro-calculadora',
  }),
)

// prazos mais comuns em cada frequência, para comparar de uma vez
const terms: Record<Frequency, number[]> = {
  diaria: [10, 15, 20, 24, 30],
  semanal: [2, 4, 6, 8, 12],
  quinzenal: [2, 4, 6, 8, 12],
  mensal: [6, 12, 18, 24, 36, 48],
}

const periodWord: Record<Frequency, [string, string]> = {
  diaria: ['diária', 'diárias'],
  semanal: ['semanal', 'semanais'],
  quinzenal: ['quinzenal', 'quinzenais'],
  mensal: ['mensal', 'mensais'],
}

export function simulate(d: Draft) {
  const schedule = buildSchedule({ ...d, count: Math.max(1, Math.round(d.count)), firstDue: firstDueFor(d.frequency) })
  const total = Math.round(schedule.reduce((s, x) => s + x.amount, 0) * 100) / 100
  return { schedule, each: schedule[0]?.amount ?? 0, total, interest: Math.round((total - d.principal) * 100) / 100 }
}

/** Resumo da simulação para compartilhar (com quem vai dividir a decisão, por exemplo). */
export function simulationText(d: Draft) {
  const { schedule, each, total, interest } = simulate(d)
  const n = schedule.length
  return [
    'Simulação de financiamento:',
    '',
    `💰 Valor: ${moneyRaw(d.principal)}`,
    `📈 Juros: ${percent(d.rate)} ao mês (${d.mode === 'simples' ? 'simples' : 'Tabela Price'})`,
    n === 1 ? `📅 Pagamento único de ${moneyRaw(each)}` : `📅 ${n} parcelas ${periodWord[d.frequency][1]} de ${moneyRaw(each)}`,
    `🧾 Total: ${moneyRaw(total)} (${moneyRaw(interest)} de juros)`,
    `📌 ${n === 1 ? 'Vencimento' : '1º vencimento'}: ${fmtDate(schedule[0].due)}`,
    '',
    'Simulado no Dinn.',
  ].join('\n')
}

// ─── Visor e teclado ─────────────────────────────────────────

type Field = 'valor' | 'juros' | 'parcelas'
const order: Field[] = ['valor', 'juros', 'parcelas']

/** Número → texto do visor ("1000,5"), sem separador de milhar. */
const toBuffer = (v: number, decimals: number) => {
  const r = Math.round(v * 10 ** decimals) / 10 ** decimals
  return String(r).replace('.', ',')
}
const parse = (b: string) => Number((b || '0').replace(',', '.')) || 0

/** "1000,5" → "1.000,5" (como se digita numa calculadora). */
const group = (b: string) => {
  const [int, dec] = b.split(',')
  const g = (int || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return dec !== undefined ? `${g},${dec}` : g
}

const freqOptions: { value: Frequency; label: string }[] = [
  { value: 'diaria', label: 'Diária' },
  { value: 'semanal', label: 'Semanal' },
  { value: 'quinzenal', label: 'Quinzenal' },
  { value: 'mensal', label: 'Mensal' },
]
const modeOptions: { value: InterestMode; label: string }[] = [
  { value: 'simples', label: 'Juros simples' },
  { value: 'composto', label: 'Compostos (Price)' },
]

type Key = { k: string; label?: React.ReactNode; kind?: 'num' | 'fn' | 'eq'; span?: number; aria?: string }
const pad: Key[] = [
  { k: '7' },
  { k: '8' },
  { k: '9' },
  { k: 'del', label: <Delete className="size-5" />, kind: 'fn', aria: 'Apagar' },
  { k: '4' },
  { k: '5' },
  { k: '6' },
  { k: 'ac', label: 'AC', kind: 'fn', aria: 'Zerar' },
  { k: '1' },
  { k: '2' },
  { k: '3' },
  { k: ',', kind: 'fn' },
  { k: '00' },
  { k: '0' },
  { k: '=', kind: 'eq', span: 2, aria: 'Confirmar e ir para o próximo' },
]

/** O simulador em si (vai dentro de um painel). `onDebt` mostra o botão de registrar a dívida com estes valores. */
export function Calculator({ onDebt, debtLabel = 'Registrar como dívida' }: { onDebt?: (d: Draft) => void; debtLabel?: string }) {
  const { principal, rate, mode, frequency, count, set } = useCalc()
  const draft: Draft = { principal, rate, mode, frequency, count: Math.max(1, Math.round(count)) }
  const { schedule, each, total, interest } = simulate(draft)
  const n = schedule.length
  const last = schedule.at(-1)!
  const uneven = n > 1 && Math.abs(last.amount - each) >= 0.01

  // registro que o teclado está editando; "fresh" = o próximo dígito substitui o valor (como depois do "=")
  const [field, setField] = useState<Field>('valor')
  const [buffer, setBuffer] = useState(() => toBuffer(principal, 2))
  const [fresh, setFresh] = useState(true)
  const flash = useAnimationControls()

  const current = (f: Field) => (f === 'valor' ? toBuffer(principal, 2) : f === 'juros' ? toBuffer(rate * 100, 4) : String(count))
  const commit = (f: Field, b: string) => {
    if (f === 'valor') set({ principal: Math.min(parse(b), 999_999_999) })
    else if (f === 'juros') set({ rate: Math.min(parse(b), 999) / 100 })
    else set({ count: Math.min(Math.round(parse(b)), 420) })
  }
  const select = (f: Field) => {
    setField(f)
    setBuffer(current(f))
    setFresh(true)
  }

  const press = (key: string) => {
    haptic()
    const base = fresh ? '' : buffer
    let b = base
    if (/^\d+$/.test(key)) {
      const [int, dec] = base.split(',')
      if (dec !== undefined) {
        // casas decimais: 2 no valor e nos juros
        if (field === 'parcelas' || dec.length + key.length > 2) return
        b = base + key
      } else {
        const limit = field === 'valor' ? 9 : 3
        const next = (int === '0' ? '' : int ?? '') + key
        b = next.replace(/^0+(?=\d)/, '').slice(0, limit)
      }
    } else if (key === ',') {
      if (field === 'parcelas' || base.includes(',')) return
      b = (base || '0') + ','
    } else if (key === 'del') {
      b = (fresh ? current(field) : buffer).slice(0, -1)
    } else if (key === 'ac') {
      b = ''
    } else if (key === '=') {
      flash.start({ scale: [1, 1.04, 1], transition: { duration: 0.3 } })
      return select(order[(order.indexOf(field) + 1) % order.length])
    }
    setBuffer(b)
    setFresh(false)
    commit(field, b)
  }

  // teclado do computador também digita no simulador (fora dos campos de texto)
  const pressRef = useRef(press)
  useEffect(() => {
    pressRef.current = press
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
      const map: Record<string, string> = { Backspace: 'del', Delete: 'ac', Enter: '=', '=': '=', '.': ',', ',': ',' }
      const key = /^\d$/.test(e.key) ? e.key : map[e.key]
      if (!key) return
      e.preventDefault()
      pressRef.current(key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // o que o visor mostra em cada registro (o ativo mostra o que está sendo digitado)
  const shown = (f: Field) => {
    const b = f === field && !fresh ? buffer : current(f)
    if (f === 'valor') return `R$ ${group(b || '0')}`
    if (f === 'juros') return `${b || '0'}%`
    return `${b || '0'}x`
  }
  const labels: Record<Field, string> = { valor: 'Valor', juros: 'Juros a.m.', parcelas: 'Parcelas' }

  // outros prazos com o mesmo valor e taxa
  const options = useMemo(() => {
    const list = [...new Set([...terms[frequency], n])].sort((a, b) => a - b)
    return list.map((k) => ({ k, ...simulate({ principal, rate, mode, frequency, count: k }) }))
  }, [principal, rate, mode, frequency, n])

  const text = () => simulationText(draft)
  const send = () => {
    haptic('medium')
    openWhatsApp('', text())
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text())
      toast('Simulação copiada')
    } catch {
      toast('Não deu para copiar')
    }
  }

  return (
    <>
      {/* ─── o simulador: visor verde do app e teclado ─── */}
      <div className="mb-6 rounded-[24px] bg-surface p-3 shadow-card">
        <div className="grad-green rounded-[18px] px-3.5 pb-3.5 pt-3 text-white">
          {/* registros: toque para escolher o que digitar */}
          <div className="grid grid-cols-3 gap-1.5">
            {order.map((f) => {
              const on = f === field
              return (
                <button
                  key={f}
                  onClick={() => (haptic(), select(f))}
                  className={clsx('min-w-0 rounded-[12px] px-2.5 py-1.5 text-left transition-colors', on ? 'bg-white/[0.12] ring-1 ring-white/25' : 'hover:bg-white/[0.06]')}
                >
                  <span className={clsx('block text-[10px] font-semibold uppercase tracking-[0.1em]', on ? 'text-white' : 'text-white/50')}>{labels[f]}</span>
                  <span className="tabular flex items-center text-[15px] font-semibold">
                    <span className="truncate">{shown(f)}</span>
                    {on && <span className="calc-caret ml-0.5 inline-block h-[15px] w-[2px] shrink-0 rounded-full bg-white" />}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="mt-2.5 flex items-end justify-between gap-3 border-t border-white/10 pt-2.5">
            <p className="pb-1 text-[12px] leading-tight text-white/60">
              {n === 1 ? 'Pagamento único' : `${n} parcelas ${periodWord[frequency][1]}`}
              <br />
              {n === 1 ? 'vence' : '1ª'} em {fmtDate(schedule[0].due).slice(0, 5)}
            </p>
            <motion.p animate={flash} className="tabular origin-right truncate text-right text-[30px] font-semibold leading-none tracking-[-0.03em]">
              {moneyRaw(each)}
            </motion.p>
          </div>
          <div className="tabular mt-2.5 flex items-center justify-between gap-2 text-[12px] text-white/60">
            <span className="truncate">
              Total <span className="font-semibold text-white">{moneyRaw(total)}</span>
            </span>
            <span className="truncate">
              Juros <span className="font-semibold text-white">{moneyRaw(interest)}</span>
              {principal > 0 && <span className="text-white/60"> ({percent(interest / principal).replace(',00', '')})</span>}
            </span>
          </div>
          {uneven && <p className="mt-1 text-[11px] text-white/45">Última parcela de {moneyRaw(last.amount)} (ajuste de centavos)</p>}
        </div>

        {/* frequência e tipo de juros */}
        <div className="mt-3 space-y-2">
          <Segmented value={frequency} onChange={(frequency) => set({ frequency })} options={freqOptions} className="!mb-0" />
          <Segmented value={mode} onChange={(mode) => set({ mode })} options={modeOptions} className="!mb-0" />
        </div>

        {/* teclado numérico */}
        <div className="mt-3 grid grid-cols-4 gap-2">
          {pad.map((key) => (
            <motion.button
              key={key.k}
              whileTap={{ scale: 0.94 }}
              aria-label={key.aria ?? key.k}
              onClick={() => press(key.k)}
              className={clsx(
                'tabular grid h-12 place-items-center rounded-[14px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-tint/50',
                key.span === 2 && 'col-span-2',
                key.kind === 'eq'
                  ? 'grad-btn text-[22px] font-semibold text-white'
                  : key.kind === 'fn'
                    ? 'bg-tint/10 text-[17px] font-semibold text-tint hover:bg-tint/15'
                    : 'bg-fill text-[20px] font-medium text-label hover:bg-fill-2',
              )}
            >
              {key.label ?? key.k}
            </motion.button>
          ))}
        </div>
        <p className="mt-2.5 text-center text-[11px] text-label-2">Toque em Valor, Juros ou Parcelas no visor e digite. O “=” passa para o próximo.</p>
      </div>

      {/* ─── comparar prazos e compartilhar ─── */}
      <Section header="Compare prazos" footer="Toque para usar o prazo. Mesmo valor e mesma taxa: quanto mais longo, mais juros no total.">
        {options.map((o) => {
          const on = o.k === n
          return (
            <button
              key={o.k}
              onClick={() => (haptic(), set({ count: o.k }), setFresh(true))}
              className={clsx('relative flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors', on ? 'bg-tint/[0.07]' : 'hover:bg-fill/50')}
            >
              <span className={clsx('tabular w-12 shrink-0 text-[15px] font-semibold', on && 'text-tint')}>{o.k}x</span>
              <span className="tabular min-w-0 flex-1 truncate text-[13px] text-label-2">
                total {moneyRaw(o.total)} · juros {moneyRaw(o.interest)}
              </span>
              <span className={clsx('tabular shrink-0 text-[15px] font-semibold', on && 'text-tint')}>{moneyRaw(o.each)}</span>
              <span className={clsx('grid size-5 shrink-0 place-items-center rounded-full', on ? 'bg-tint text-white' : 'ring-1 ring-fill-2')}>{on && <Check className="size-3" strokeWidth={3.5} />}</span>
            </button>
          )
        })}
      </Section>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <Button variant="tinted" onClick={send}>
          <WhatsAppIcon className="size-[18px] text-[#1fa855]" /> Compartilhar
        </Button>
        <Button variant="tinted" onClick={copy}>
          <Copy className="size-[18px]" /> Copiar
        </Button>
      </div>
      {onDebt && (
        <Button onClick={() => onDebt(draft)} className={principal > 0 ? '' : 'pointer-events-none opacity-40'}>
          <HandCoins className="size-[18px]" /> {debtLabel}
        </Button>
      )}
      <p className="mt-3 px-1 text-[12px] leading-[17px] text-label-2">
        Confira a taxa no contrato do banco ou da loja: o simulador usa juros ao mês. “Compartilhar” abre o WhatsApp para você escolher o contato.
      </p>
    </>
  )
}
