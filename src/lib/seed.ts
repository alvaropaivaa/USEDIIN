// Dados de exemplo relativos à data de hoje, para o app abrir "vivo": três meses de uma família
// com duas contas, dois cartões, contas fixas, uma compra parcelada, orçamento, metas e dívidas.
import { addDays, addMonths, monthKey, shiftMonth, toISO, today } from './dates'
import { buildSchedule } from './loans'
import { cardIndex, horizon, invoiceDates, invoiceFor, materialize, splitInstallments, type Account, type Card, type Goal, type Recurrence, type Transaction } from './ledger'
import { DEBT_EXPENSE, DEBT_INCOME, defaultCategories } from './categories'
import type { Records } from './store'
import { uid } from './crypto'

/** Dia `d` do mês `key` (limitado ao fim do mês). */
const dayOf = (key: string, d: number) => {
  const [y, m] = key.split('-').map(Number)
  return toISO(new Date(y, m - 1, Math.min(d, new Date(y, m, 0).getDate())))
}

export function demoData(): Records {
  const t = today()
  const now = monthKey(t)
  const months = [shiftMonth(now, -2), shiftMonth(now, -1), now]
  const created = addMonths(t, -3)

  const acc = (name: string, kind: Account['kind'], initial: number, color: string, bank?: string): Account => ({ id: uid(), name, kind, initial, color, ...(bank ? { bank } : {}), createdAt: created })
  // bancos pelo ISPB (lib/banks.ts): mostram a logo e as cores do cartão
  const nubank = acc('Nubank', 'corrente', 1850, '#820AD1', '18236120')
  const itau = acc('Itaú', 'corrente', 3200, '#EC7000', '60701190')
  const wallet = acc('Carteira', 'carteira', 160, '#16a34a')
  const invest = acc('Investimentos', 'investimento', 6400, '#0284c7')
  const accounts = [nubank, itau, wallet, invest]

  const roxinho: Card = { id: uid(), name: 'Nubank', bank: '18236120', skin: 'roxinho', brand: 'mastercard', last4: '4821', limit: 6000, closingDay: 3, dueDay: 10, accountId: nubank.id, color: '#820AD1', createdAt: created }
  const click: Card = { id: uid(), name: 'Itaú Click', bank: '60701190', skin: 'click', brand: 'visa', last4: '0937', limit: 3500, closingDay: 20, dueDay: 28, accountId: itau.id, color: '#EC7000', createdAt: created }
  const cards = [roxinho, click]
  const cardsIdx = cardIndex(cards)

  const categories = defaultCategories().map((c) => {
    const budget: Record<string, number> = { 'cat-alimentacao': 1500, 'cat-transporte': 650, 'cat-lazer': 450, 'cat-compras': 600, 'cat-assinaturas': 120, 'cat-cuidados': 150 }
    return budget[c.id] ? { ...c, budget: budget[c.id] } : c
  })

  const txs: Transaction[] = []
  const tx = (p: Omit<Transaction, 'id' | 'createdAt' | 'status'> & { status?: Transaction['status'] }) => {
    const card = p.cardId ? cardsIdx.get(p.cardId) : undefined
    const item: Transaction = { status: 'pago', ...p, ...(card && p.type === 'despesa' && !p.invoice ? { invoice: invoiceFor(card, p.date) } : {}), id: uid(), createdAt: p.date < t ? p.date : t }
    // conta do mês que ainda não chegou: pendente
    if (item.date > t && !item.cardId) item.status = 'pendente'
    txs.push(item)
    return item
  }

  // ─── Fixos (salário, moradia, assinaturas) ───────────────────
  const start = (d: number) => dayOf(months[0], d)
  const rules: Recurrence[] = [
    { type: 'receita', description: 'Salário', amount: 7400, categoryId: 'cat-salario-mensal', accountId: itau.id, d: 5 },
    { type: 'despesa', description: 'Aluguel', amount: 1750, categoryId: 'cat-aluguel', accountId: itau.id, d: 10 },
    { type: 'despesa', description: 'Condomínio', amount: 480, categoryId: 'cat-condominio', accountId: itau.id, d: 10 },
    { type: 'despesa', description: 'Internet fibra', amount: 119.9, categoryId: 'cat-internet', accountId: nubank.id, d: 15 },
    { type: 'despesa', description: 'Academia', amount: 99.9, categoryId: 'cat-academia', accountId: nubank.id, d: 8 },
    { type: 'despesa', description: 'Streaming de filmes', amount: 55.9, categoryId: 'cat-assinaturas', cardId: roxinho.id, d: 12 },
    { type: 'despesa', description: 'Música', amount: 21.9, categoryId: 'cat-assinaturas', cardId: roxinho.id, d: 18 },
  ].map(({ d, ...template }) => ({ id: uid(), frequency: 'mensal' as const, start: start(d), generated: '', template: template as Recurrence['template'] }))
  const gen = materialize(rules, cardsIdx, horizon(t), (r, date) => ({
    ...r.template,
    id: `${r.id}:${date}`,
    date,
    status: r.template.cardId || date <= t ? 'pago' : 'pendente',
    groupId: r.id,
    createdAt: date < t ? date : t,
  }))
  txs.push(...gen.created)
  const recurrences = rules.map((r) => gen.updated.find((u) => u.id === r.id) ?? r)

  // ─── Gastos do dia a dia ─────────────────────────────────────
  const daily: [day: number, desc: string, amount: number, cat: string, where: { cardId?: string; accountId?: string }][] = [
    [2, 'Supermercado', 386.4, 'cat-mercado', { cardId: roxinho.id }],
    [4, 'Padaria', 32.5, 'cat-padaria', { accountId: wallet.id }],
    [6, 'Posto Shell', 210, 'cat-combustivel', { cardId: click.id }],
    [9, 'Restaurante japonês', 148, 'cat-restaurantes', { cardId: roxinho.id }],
    [11, 'Farmácia', 76.8, 'cat-farmacia', { accountId: nubank.id }],
    [13, 'Delivery de pizza', 89.9, 'cat-delivery', { cardId: roxinho.id }],
    [14, 'Uber', 34.6, 'cat-app-transporte', { cardId: click.id }],
    [16, 'Supermercado', 412.3, 'cat-mercado', { cardId: roxinho.id }],
    [17, 'Luz', 186.7, 'cat-luz', { accountId: itau.id }],
    [19, 'Cinema', 64, 'cat-passeios', { cardId: roxinho.id }],
    [21, 'Posto Shell', 190, 'cat-combustivel', { cardId: click.id }],
    [22, 'Água e gás', 92.4, 'cat-agua', { accountId: itau.id }],
    [24, 'Roupas', 239.9, 'cat-roupas', { cardId: click.id }],
    [25, 'Cabeleireiro', 70, 'cat-cuidados', { accountId: nubank.id }],
    [27, 'Feira', 58, 'cat-mercado', { accountId: wallet.id }],
    [28, 'Bar com amigos', 112, 'cat-bares', { cardId: roxinho.id }],
  ]
  months.forEach((m, i) => {
    for (const [d, description, amount, categoryId, where] of daily) {
      const date = dayOf(m, d)
      // no mês atual, só o que já aconteceu (as contas de casa ficam pendentes)
      if (date > t && !(categoryId === 'cat-luz' || categoryId === 'cat-agua')) continue
      tx({ type: 'despesa', description, amount: Math.round(amount * (0.9 + ((i + d) % 5) * 0.05) * 100) / 100, date, categoryId, ...where })
    }
  })
  tx({ type: 'receita', description: 'Freela de design', amount: 1200, date: dayOf(months[1], 18), categoryId: 'cat-freelas', accountId: nubank.id })
  tx({ type: 'receita', description: 'Rendimento da reserva', amount: 58.4, date: dayOf(months[1], 28), categoryId: 'cat-rendimentos', accountId: invest.id })
  tx({ type: 'receita', description: 'Venda no marketplace', amount: 350, date: dayOf(months[0], 22), categoryId: 'cat-vendas', accountId: nubank.id })
  // todo mês: parte do salário vai para o Nubank (que paga a fatura) e um saque para a carteira
  for (const m of months) {
    if (dayOf(m, 6) <= t) tx({ type: 'transferencia', description: 'Transferência', amount: 1900, date: dayOf(m, 6), accountId: itau.id, toAccountId: nubank.id })
    if (dayOf(m, 7) <= t) tx({ type: 'transferencia', description: 'Saque', amount: 300, date: dayOf(m, 7), accountId: itau.id, toAccountId: wallet.id })
  }
  tx({ type: 'transferencia', description: 'Aplicação', amount: 500, date: dayOf(months[0], 6), accountId: itau.id, toAccountId: invest.id })

  // compra parcelada no cartão: 10x
  const groupId = uid()
  const first = invoiceFor(roxinho, dayOf(months[0], 20))
  splitInstallments(3490, 10).forEach((amount, k) =>
    tx({ type: 'despesa', description: 'Notebook', amount, date: dayOf(months[0], 20), categoryId: 'cat-eletronicos', cardId: roxinho.id, invoice: shiftMonth(first, k), groupId, installment: { n: k + 1, count: 10 } }),
  )

  // ─── Faturas já fechadas: pagas pela conta do cartão ─────────
  for (const card of cards)
    for (let k = -3; k <= 0; k++) {
      const key = shiftMonth(now, k)
      const { due } = invoiceDates(card, key)
      if (due >= t) continue
      const total = txs.filter((x) => x.cardId === card.id && x.type === 'despesa' && x.invoice === key).reduce((s, x) => s + x.amount, 0)
      if (total > 0) tx({ type: 'transferencia', description: `Fatura ${card.name}`, amount: Math.round(total * 100) / 100, date: due, accountId: card.accountId, cardId: card.id, invoice: key })
    }

  // ─── Metas ───────────────────────────────────────────────────
  const contrib = (amounts: number[], accountId?: string) =>
    amounts.map((amount, k) => ({ id: uid(), date: dayOf(shiftMonth(now, k - amounts.length + 1), 6), amount, ...(accountId ? { accountId } : {}) }))
  const goals: Goal[] = [
    { id: uid(), name: 'Reserva de emergência', target: 24000, monthly: 600, yield: 0.008, color: '#16a34a', icon: 'cofrinho', contributions: [{ id: uid(), date: addMonths(t, -4), amount: 9000 }, ...contrib([600, 600, 600], itau.id)], createdAt: addMonths(t, -4) },
    { id: uid(), name: 'Viagem para o Nordeste', target: 7500, deadline: addMonths(t, 8), color: '#0284c7', icon: 'viagem', contributions: contrib([700, 500, 450], nubank.id), createdAt: addMonths(t, -3) },
    { id: uid(), name: 'Trocar de carro', target: 40000, monthly: 900, color: '#ea580c', icon: 'carro', contributions: [{ id: uid(), date: addMonths(t, -5), amount: 5200 }], createdAt: addMonths(t, -5) },
  ]

  // ─── Dívidas ─────────────────────────────────────────────────
  const firstDueCar = addDays(addMonths(t, -9), -3)
  const carSchedule = buildSchedule({ principal: 32000, rate: 0.0149, mode: 'composto', frequency: 'mensal', count: 48, firstDue: firstDueCar })
  const carPayments = carSchedule.filter((s) => s.due < t).map((s) => ({ id: uid(), date: s.due, amount: s.amount }))
  const car = { id: uid(), direction: 'pagar' as const, kind: 'financiamento' as const, person: 'Banco do Brasil', accountId: itau.id, note: 'Financiamento do carro', principal: 32000, rate: 0.0149, mode: 'composto' as const, frequency: 'mensal' as const, createdAt: addMonths(firstDueCar, -1), schedule: carSchedule, payments: carPayments }

  const firstDueBro = addDays(addMonths(t, -3), 2)
  const broSchedule = buildSchedule({ principal: 1500, rate: 0, mode: 'simples', frequency: 'mensal', count: 5, firstDue: firstDueBro })
  // pagou as duas primeiras; a terceira está atrasada
  const broPayments = broSchedule.slice(0, 2).map((s) => ({ id: uid(), date: s.due, amount: s.amount }))
  const bro = { id: uid(), direction: 'receber' as const, kind: 'pessoal' as const, person: 'Lucas (irmão)', phone: '(11) 98765-4321', accountId: nubank.id, principal: 1500, rate: 0, mode: 'simples' as const, frequency: 'mensal' as const, createdAt: addMonths(firstDueBro, -1), schedule: broSchedule, payments: broPayments }

  // os pagamentos dos últimos meses também estão nos lançamentos
  const from = `${months[0]}-01`
  for (const p of carPayments.filter((p) => p.date >= from))
    tx({ type: 'despesa', description: 'Financiamento · Banco do Brasil', amount: p.amount, date: p.date, categoryId: DEBT_EXPENSE, accountId: itau.id, debtId: car.id, paymentId: p.id })
  for (const p of broPayments.filter((p) => p.date >= from))
    tx({ type: 'receita', description: 'Parcela de Lucas (irmão)', amount: p.amount, date: p.date, categoryId: DEBT_INCOME, accountId: nubank.id, debtId: bro.id, paymentId: p.id })

  return { accounts, cards, categories, transactions: txs, recurrences, goals, debts: [car, bro] }
}
