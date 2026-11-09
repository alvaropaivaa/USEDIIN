// Lançamento rápido: a pessoa escreve do jeito que falaria ("gastei 45 no mercado ontem no nubank")
// e o formulário já vem preenchido (tipo, valor, data, conta ou cartão, descrição e categoria).
// Tudo local, sem IA: regras simples e as palavras-chave das categorias.

import { addDays, monthKey, toISO } from './dates'
import { suggestCategory, type Account, type Card, type Category, type Transaction } from './ledger'

export interface Quick {
  type: 'receita' | 'despesa'
  amount: number
  description: string
  date: string
  categoryId?: string
  accountId?: string
  cardId?: string
  /** Escreveu que ainda vai pagar ("vou pagar", "a pagar", "vence"). */
  pending: boolean
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

// verbo de gasto manda: "paguei o salário da diarista" é despesa
const EXPENSE = /\b(gastei|paguei|comprei|pago|transferi|emprestei)\b/
const INCOME = /\b(recebi|ganhei|entrou|caiu|vendi|rendeu|rendimento|salario|me pagou|devolveu|reembolso)\b/
const PENDING = /\b(vou pagar|a pagar|pendente|vence|vencimento|boleto)\b/
const FILLER = /\b(gastei|paguei|comprei|pago|recebi|ganhei|entrou|caiu|vendi|rendeu|foi|de|do|da|no|na|nos|nas|em|com|pra|para|o|a|os|as|um|uma|reais|real|conto|contos|pila|r\$|hoje|ontem|anteontem|amanha|cartao|credito|debito|pix|dinheiro|vou pagar|a pagar|pendente|vence)\b/g

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A palavra (ou nome) inteira no texto: a conta "Oi" não casa com "boi" nem com "oito". */
const wordRe = (w: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(w)}(?=$|[^\\p{L}\\p{N}])`, 'u')

/** "1.234,56", "45,9", "45.90", "2 mil" → número. */
export function amountIn(text: string): { value: number; match: string } | null {
  const mil = text.match(/(?<![\d/.,])(\d+(?:[.,]\d+)?)\s*mil\b/)
  if (mil) return { value: parseFloat(mil[1].replace(',', '.')) * 1000, match: mil[0] }
  // sem dígito, barra ou separador antes: "12/10" é data, não o valor 10
  for (const m of text.matchAll(/(?:r\$\s*)?(?<![\d/.,])(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d/])/g)) {
    const before = text.slice(0, m.index).trimEnd()
    // "dia 12" é data, não valor
    if (/\bdia$/.test(before)) continue
    const raw = m[1]
    const value = raw.includes(',') ? parseFloat(raw.replace(/\./g, '').replace(',', '.')) : /\.\d{3}$/.test(raw) ? parseFloat(raw.replace(/\./g, '')) : parseFloat(raw)
    if (value > 0) return { value: Math.round(value * 100) / 100, match: m[0] }
  }
  return null
}

export function dateIn(text: string, ref: string): { date: string; match: string } | null {
  if (/\banteontem\b/.test(text)) return { date: addDays(ref, -2), match: 'anteontem' }
  if (/\bontem\b/.test(text)) return { date: addDays(ref, -1), match: 'ontem' }
  if (/\bamanha\b/.test(text)) return { date: addDays(ref, 1), match: 'amanha' }
  const full = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)
  if (full) {
    const y = full[3] ? Number(full[3].length === 2 ? `20${full[3]}` : full[3]) : Number(ref.slice(0, 4))
    const d = new Date(y, Number(full[2]) - 1, Number(full[1]))
    if (!isNaN(d.getTime()) && d.getDate() === Number(full[1])) return { date: toISO(d), match: full[0] }
  }
  const day = text.match(/\bdia (\d{1,2})\b/)
  if (day && Number(day[1]) >= 1 && Number(day[1]) <= 31) {
    // "dia 31" em mês de 30 dias (ou fevereiro) vira o último dia do mês
    const [y, m] = monthKey(ref).split('-').map(Number)
    const last = new Date(y, m, 0).getDate()
    return { date: toISO(new Date(y, m - 1, Math.min(Number(day[1]), last))), match: day[0] }
  }
  return null
}

export function parseQuick(input: string, ctx: { categories: Category[]; accounts: Account[]; cards: Card[]; history: Transaction[]; ref: string }): Quick | null {
  let text = norm(input).replace(/\s+/g, ' ').trim()
  const amount = amountIn(text)
  if (!amount) return null
  text = text.replace(amount.match, ' ')
  const type = !EXPENSE.test(text) && INCOME.test(text) ? 'receita' : 'despesa'
  const pending = PENDING.test(text)
  const when = dateIn(text, ctx.ref)
  if (when) text = text.replace(when.match, ' ')

  // conta ou cartão pelo nome inteiro ("no nubank", "no cartão itaú")
  const byName = <T extends { name: string; archived?: boolean }>(list: T[]) =>
    list
      .filter((x) => !x.archived && norm(x.name).trim().length >= 2)
      .sort((a, b) => b.name.length - a.name.length)
      .find((x) => wordRe(norm(x.name).trim()).test(text))
  const wantsCard = /\b(cartao|credito)\b/.test(text)
  const card = type === 'despesa' ? byName(ctx.cards) : undefined
  const account = byName(ctx.accounts)
  const useCard = card && (wantsCard || !account)
  const cardId = useCard ? card.id : type === 'despesa' && wantsCard ? ctx.cards.find((c) => !c.archived)?.id : undefined
  const accountId = !cardId ? account?.id : undefined
  for (const x of [useCard ? card : undefined, accountId ? account : undefined]) if (x) text = text.replace(wordRe(norm(x.name).trim()), '$1 ')

  const words = text.replace(FILLER, ' ').replace(/[^\p{L}\p{N}&\s-]/gu, ' ').replace(/\s+/g, ' ').trim()
  // a descrição volta com a grafia original (acentos e maiúsculas) de cada palavra que sobrou
  const keep = new Set(words.split(' ').filter(Boolean))
  const original = input
    .split(/\s+/)
    .filter((w) => keep.has(norm(w).replace(/[^\p{L}\p{N}&-]/gu, '')))
    .join(' ')
  const description = (original || words || (type === 'receita' ? 'Receita' : 'Despesa')).replace(/^./, (c) => c.toUpperCase())
  const categoryId = suggestCategory(words || input, type, ctx.categories, ctx.history) ?? suggestCategory(input, type, ctx.categories, ctx.history)
  const date = when?.date ?? ctx.ref
  return { type, amount: amount.value, description, date, categoryId, accountId, cardId, pending: pending || (date > ctx.ref && !cardId) }
}
