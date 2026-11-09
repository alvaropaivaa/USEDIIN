// Resumo diário das notificações: monta os avisos do dia de um usuário a partir dos dados
// da nuvem (tabela public.records). Função pura, sem imports, para rodar na Edge Function e nos testes (Node).

export interface ScheduledRow {
  due: string
  amount: number
}

export interface PaymentRow {
  id?: string
  date: string
  amount: number
  fee?: number
}

/** records.data de um lançamento (só o que o resumo usa). */
export interface TxRow {
  id: string
  type: 'receita' | 'despesa' | 'transferencia'
  description?: string
  amount: number
  date: string
  status: 'pago' | 'pendente'
  categoryId?: string
  cardId?: string
  invoice?: string
  installment?: { n: number; count: number }
}

/** records.data de uma dívida (só o que o resumo usa). */
export interface DebtRow {
  id: string
  direction: 'pagar' | 'receber'
  person?: string
  schedule: ScheduledRow[] | null
  payments: PaymentRow[] | null
}

/** records.data de um cartão (só o que o resumo usa). */
export interface CardRow {
  id: string
  name?: string
  closingDay: number
  dueDay: number
  archived?: boolean
}

/** records.data de uma categoria (só o nome, para o texto). */
export interface CategoryRow {
  id: string
  name?: string
}

/** Linha de public.profiles (só o que o resumo usa). */
export interface ProfileRow {
  blocked: boolean
  /** null = sem vencimento */
  expires_at: string | null
}

export interface DigestInput {
  /** Data local do aparelho, AAAA-MM-DD. */
  date: string
  /** user_settings.settings (objeto Settings do app). */
  settings: Record<string, unknown> | null
  profile: ProfileRow | null
  transactions: TxRow[]
  debts: DebtRow[]
  cards: CardRow[]
  categories: CategoryRow[]
}

export type AlertKey = 'hoje' | 'atrasos' | 'amanha' | 'faturas' | 'lancamentos' | 'orcamento' | 'metas' | 'dividas' | 'resumo' | 'plano'

export interface Notice {
  type: AlertKey
  title: string
  body: string
  url: string
  tag: string
  key: string
  urgency: 'normal' | 'high'
}

export interface Digest {
  /** Sem acesso (bloqueado, vencido ou sem perfil): nada é enviado. */
  skipped: boolean
  /** Contas a pagar atrasadas + de hoje, para o selo do ícone do app. */
  badge: number
  notices: Notice[]
}

// ─── Datas (strings AAAA-MM-DD, sem fuso) ────────────────────

const DAY = 86400000

const dayNum = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY)
}
const fromDayNum = (n: number) => new Date(n * DAY).toISOString().slice(0, 10)
export const addDays = (iso: string, days: number) => fromDayNum(dayNum(iso) + days)
export const diffDays = (a: string, b: string) => dayNum(a) - dayNum(b)
/** 0 = domingo, 1 = segunda… */
const weekday = (iso: string) => new Date(dayNum(iso) * DAY).getUTCDay()

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export const FALLBACK_TZ = 'America/Sao_Paulo'
const clocks = new Map<string, Intl.DateTimeFormat>()

const clock = (tz: string) => {
  let f = clocks.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    clocks.set(tz, f)
  }
  return f
}

/** Data (AAAA-MM-DD) e hora (0–23) locais no fuso do aparelho; fuso inválido cai em São Paulo. */
export function localNow(tz: string | null | undefined, now = new Date()) {
  let f: Intl.DateTimeFormat
  try {
    f = clock(tz || FALLBACK_TZ)
  } catch {
    f = clock(FALLBACK_TZ)
  }
  const p: Record<string, string> = {}
  for (const x of f.formatToParts(now)) p[x.type] = x.value
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 }
}

// ─── Ajustes ─────────────────────────────────────────────────

/** Alerta ligado? Chave ausente conta como ligado. */
export const alertOn = (settings: Record<string, unknown> | null | undefined, key: AlertKey) => {
  const alerts = settings?.alerts
  return !(alerts && typeof alerts === 'object' && (alerts as Record<string, unknown>)[key] === false)
}

/** Hora do resumo (0–23); padrão 8 h. */
export const alertHour = (settings: Record<string, unknown> | null | undefined) => {
  const h = settings?.alertHour
  return typeof h === 'number' && Number.isInteger(h) && h >= 0 && h <= 23 ? h : 8
}

/** Acesso liberado no dia: não bloqueado e dentro do vencimento (como has_access() no banco). */
export const hasAccess = (profile: ProfileRow | null, date: string) =>
  !!profile && !profile.blocked && (!profile.expires_at || profile.expires_at.slice(0, 10) >= date)

// ─── Parcelas das dívidas ────────────────────────────────────

const round2 = (v: number) => Math.round(v * 100) / 100
const EPS = 0.005

type Status = 'pago' | 'parcial' | 'pendente' | 'hoje' | 'atrasada'

interface Installment {
  n: number
  count: number
  due: string
  amount: number
  paid: number
  remaining: number
  status: Status
}

interface Loan {
  schedule: ScheduledRow[]
  payments: PaymentRow[]
}

// espelha installments() de src/lib/loans.ts — se mudar lá, mude aqui também
export function installments(c: Loan, ref: string): Installment[] {
  let pool = c.payments.reduce((s, p) => s + p.amount, 0)
  return c.schedule.map((s, i) => {
    const paid = round2(Math.min(s.amount, Math.max(0, pool)))
    pool -= paid
    const remaining = round2(s.amount - paid)
    let status: Status
    if (remaining < EPS) status = 'pago'
    else if (s.due < ref) status = 'atrasada'
    else if (s.due === ref) status = 'hoje'
    else status = paid > EPS ? 'parcial' : 'pendente'
    return { n: i + 1, count: c.schedule.length, due: s.due, amount: s.amount, paid, remaining, status }
  })
}

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const str = (v: unknown) => (typeof v === 'string' ? v : '')

// o jsonb vem do app; aqui só garante números e listas
const normalize = (r: DebtRow): Loan => ({
  schedule: (Array.isArray(r.schedule) ? r.schedule : []).map((s) => ({ due: str(s?.due), amount: num(s?.amount) })),
  payments: (Array.isArray(r.payments) ? r.payments : []).map((p) => ({ date: str(p?.date).slice(0, 10), amount: num(p?.amount), fee: num(p?.fee) })),
})

// ─── Cartão de crédito (espelha invoiceFor/invoiceDates de src/lib/ledger.ts) ───

const pad = (n: number) => String(n).padStart(2, '0')
const lastDay = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()
const shiftMonth = (key: string, k: number) => {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + k, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}
const clampDay = (key: string, day: number) => {
  const [y, m] = key.split('-').map(Number)
  return `${key}-${pad(Math.min(day, lastDay(y, m - 1)))}`
}

export function invoiceFor(card: CardRow, date: string) {
  const [y, m, d] = date.split('-').map(Number)
  const closing = d >= Math.min(card.closingDay, lastDay(y, m - 1)) ? shiftMonth(date.slice(0, 7), 1) : date.slice(0, 7)
  return card.dueDay > card.closingDay ? closing : shiftMonth(closing, 1)
}

export function invoiceDates(card: CardRow, key: string) {
  return { due: clampDay(key, card.dueDay), closing: clampDay(card.dueDay > card.closingDay ? key : shiftMonth(key, -1), card.closingDay) }
}

/** Dia em que o dinheiro sai: compra no cartão sai no vencimento da fatura. */
const cashDate = (t: TxRow, cards: Map<string, CardRow>) => {
  const card = t.type === 'despesa' && t.cardId && t.invoice ? cards.get(t.cardId) : undefined
  return card ? invoiceDates(card, t.invoice!).due : t.date
}

// ─── Textos ──────────────────────────────────────────────────

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const money = (v: number) => brl.format(round2(v))
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/** Uma conta, parcela ou fatura que vence. */
interface Item {
  title: string
  detail: string
  date: string
  amount: number
  income: boolean
}

/** "Aluguel", "Aluguel e Luz" ou "Aluguel, Luz e mais 3" (na ordem da lista). */
function names(items: Item[]) {
  const list = [...new Set(items.map((i) => i.title.trim() || 'Conta'))]
  if (list.length <= 2) return list.join(' e ')
  return `${list[0]}, ${list[1]} e mais ${list.length - 2}`
}

/** Uma conta: "Aluguel · Moradia · R$ 1.750,00"; várias: "5 contas · R$ 2.300,00 · Aluguel, Luz e mais 3". */
function describe(items: Item[], date: string, privacy: boolean, late: boolean) {
  if (items.length === 1) {
    const i = items[0]
    const parts = [i.title.trim() || 'Conta', i.detail]
    if (!privacy) parts.push(money(i.amount))
    if (late) parts.push(`${plural(diffDays(date, i.date), 'dia', 'dias')} de atraso`)
    return parts.filter(Boolean).join(' · ')
  }
  const parts = [`${items.length} contas`]
  if (!privacy) parts.push(money(items.reduce((s, i) => s + i.amount, 0)))
  parts.push(names(items))
  return parts.join(' · ')
}

// mais antigas primeiro; no mesmo dia, as despesas e as maiores
const byDue = (a: Item, b: Item) => a.date.localeCompare(b.date) || Number(a.income) - Number(b.income) || b.amount - a.amount

// ─── Resumo do dia ───────────────────────────────────────────

/** Avisos do dia `date` para um usuário, na ordem de envio (os mesmos que o app monta em src/lib/notify.ts). */
export function buildDigest({ date, settings, profile, transactions, debts, cards: cardRows, categories }: DigestInput): Digest {
  // sem acesso não recebe nada (o aviso de plano só vale até o vencimento)
  if (!profile || !hasAccess(profile, date)) return { skipped: true, badge: 0, notices: [] }

  const privacy = settings?.privacy === true
  const on = (k: AlertKey) => alertOn(settings, k)
  const tomorrow = addDays(date, 1)
  const catName = new Map(categories.map((c) => [c.id, str(c.name)]))
  const cards = new Map(cardRows.filter((c) => num(c.closingDay) > 0 && num(c.dueDay) > 0).map((c) => [c.id, c]))

  // contas pendentes e parcelas das dívidas que vencem até amanhã (e as atrasadas)
  const bills: Item[] = []
  for (const t of transactions) {
    if (t.status !== 'pendente' || t.cardId || t.type === 'transferencia' || !t.date || t.date > tomorrow) continue
    const detail = [catName.get(t.categoryId ?? ''), t.installment && `${t.installment.n}/${t.installment.count}`].filter(Boolean).join(' · ') || (t.type === 'receita' ? 'Receita' : 'Despesa')
    bills.push({ title: str(t.description), detail, date: t.date, amount: num(t.amount), income: t.type === 'receita' })
  }
  for (const d of debts)
    for (const i of installments(normalize(d), date))
      if (i.status !== 'pago' && i.due <= tomorrow)
        bills.push({ title: str(d.person), detail: `${d.direction === 'pagar' ? 'Parcela' : 'A receber'} ${i.n}/${i.count}`, date: i.due, amount: i.remaining, income: d.direction === 'receber' })
  bills.sort(byDue)
  const overdue = bills.filter((b) => b.date < date && !b.income)
  const today = bills.filter((b) => b.date === date)
  const nextDay = bills.filter((b) => b.date === tomorrow)

  // faturas: total das compras − pagamentos, por cartão e mês de vencimento
  const invoices = new Map<string, { card: CardRow; key: string; total: number; paid: number }>()
  for (const t of transactions) {
    const card = t.cardId ? cards.get(t.cardId) : undefined
    if (!card || !t.invoice) continue
    const k = `${card.id}:${t.invoice}`
    const inv = invoices.get(k) ?? { card, key: t.invoice, total: 0, paid: 0 }
    if (t.type === 'despesa') inv.total += num(t.amount)
    else if (t.type === 'transferencia' && t.status === 'pago') inv.paid += num(t.amount)
    invoices.set(k, inv)
  }
  const unpaid = [...invoices.values()].map((i) => ({ ...i, ...invoiceDates(i.card, i.key), open: round2(Math.max(0, i.total - i.paid)) })).filter((i) => i.open > EPS)

  const notices: Notice[] = []
  const add = (n: Omit<Notice, 'urgency'>, urgency: Notice['urgency'] = 'normal') => notices.push({ ...n, urgency })

  if (on('atrasos') && overdue.length)
    add({ type: 'atrasos', title: 'Contas atrasadas', body: describe(overdue, date, privacy, true), url: '/?n=due:atrasado', tag: 'atrasos', key: `atrasos:${date}` }, 'high')
  if (on('hoje') && today.length) add({ type: 'hoje', title: 'Vence hoje', body: describe(today, date, privacy, false), url: '/?n=due:pendente', tag: 'hoje', key: `hoje:${date}` }, 'high')
  if (on('amanha') && nextDay.length) add({ type: 'amanha', title: 'Vence amanhã', body: describe(nextDay, date, privacy, false), url: '/?n=due:pendente', tag: 'amanha', key: `amanha:${date}` })

  if (on('faturas'))
    for (const card of cards.values()) {
      if (card.archived) continue
      // a fatura que fechou hoje (compras até ontem)
      const key = invoiceFor(card, addDays(date, -1))
      const closed = invoices.get(`${card.id}:${key}`)
      const { closing, due } = invoiceDates(card, key)
      if (closing === date && closed && closed.total > EPS)
        add({ type: 'faturas', title: `Fatura ${str(card.name)} fechou`, body: privacy ? `Vence ${ddmm(due)}` : `${money(closed.total)} · vence ${ddmm(due)}`, url: `/?n=card:${card.id}:${key}`, tag: `fatura:${card.id}`, key: `fatura-fechou:${card.id}:${key}` })
      for (const inv of unpaid.filter((i) => i.card.id === card.id && (i.due === date || i.due === tomorrow)))
        add(
          {
            type: 'faturas',
            title: inv.due === date ? `Fatura ${str(card.name)} vence hoje` : `Fatura ${str(card.name)} vence amanhã`,
            body: privacy ? 'Fatura em aberto' : `${money(inv.open)} em aberto`,
            url: `/?n=card:${card.id}:${inv.key}`,
            tag: `fatura:${card.id}`,
            key: `fatura-vence:${card.id}:${inv.key}:${date}`,
          },
          inv.due === date ? 'high' : 'normal',
        )
    }

  if (on('resumo')) {
    const flows = (from: string, to: string) => {
      const r = { income: 0, expense: 0 }
      for (const t of transactions) {
        if (t.type === 'transferencia' || !t.date) continue
        const d = cashDate(t, cards)
        if (d >= from && d <= to) r[t.type === 'receita' ? 'income' : 'expense'] += num(t.amount)
      }
      return r
    }
    if (weekday(date) === 1) {
      const last = flows(addDays(date, -7), addDays(date, -1))
      // contas desta semana: pendentes, parcelas e faturas (sem as atrasadas)
      const end = addDays(date, 6)
      const week: Item[] = [
        ...transactions
          .filter((t) => t.status === 'pendente' && !t.cardId && t.type === 'despesa' && t.date >= date && t.date <= end)
          .map((t) => ({ title: str(t.description), detail: '', date: t.date, amount: num(t.amount), income: false })),
        ...debts.filter((d) => d.direction === 'pagar').flatMap((d) => installments(normalize(d), date).filter((i) => i.status !== 'pago' && i.status !== 'atrasada' && i.due <= end).map((i) => ({ title: str(d.person), detail: '', date: i.due, amount: i.remaining, income: false }))),
        ...unpaid.filter((i) => i.due >= date && i.due <= end).map((i) => ({ title: str(i.card.name), detail: '', date: i.due, amount: i.open, income: false })),
      ]
      if (last.income || last.expense || week.length) {
        const past = privacy ? 'veja receitas e despesas no app' : `${money(last.income)} de receitas e ${money(last.expense)} de despesas`
        const next = privacy ? plural(week.length, 'conta', 'contas') : `${plural(week.length, 'conta', 'contas')} · ${money(week.reduce((s, i) => s + i.amount, 0))} a pagar`
        add({ type: 'resumo', title: 'Resumo da semana', body: `Semana passada: ${past}. Esta semana: ${next}.`, url: '/?n=tab:reports', tag: 'resumo', key: `resumo-semana:${date}` })
      }
    }
    if (date.slice(8, 10) === '01') {
      const m = Number(date.slice(5, 7))
      const prevKey = shiftMonth(date.slice(0, 7), -1)
      const t = flows(`${prevKey}-01`, addDays(date, -1))
      if (t.income || t.expense) {
        const balance = round2(t.income - t.expense)
        const body = privacy
          ? `O mês fechou ${balance >= 0 ? 'no azul' : 'no vermelho'}. Veja o resumo no app.`
          : `Receitas ${money(t.income)} · despesas ${money(t.expense)} · ${balance >= 0 ? `sobrou ${money(balance)}` : `faltou ${money(-balance)}`}.`
        add({ type: 'resumo', title: `Fechamento de ${MONTHS[(m + 10) % 12]}`, body, url: '/?n=tab:reports', tag: 'resumo', key: `resumo-mes:${date}` })
      }
    }
  }

  if (on('plano') && profile.expires_at) {
    const days = diffDays(profile.expires_at.slice(0, 10), date)
    const title = days === 3 ? 'Seu acesso vence em 3 dias' : days === 1 ? 'Seu acesso vence amanhã' : days === 0 ? 'Seu acesso vence hoje' : ''
    if (title)
      add({ type: 'plano', title, body: 'Fale com o administrador para renovar e continuar usando o Dinn.', url: '/', tag: 'plano', key: `plano:${profile.expires_at.slice(0, 10)}:${days}` })
  }

  // selo do ícone: contas a pagar atrasadas + o que vence hoje (contas, parcelas e faturas)
  const badge = overdue.length + today.filter((b) => !b.income).length + unpaid.filter((i) => i.due <= date).length
  return { skipped: false, badge, notices }
}
