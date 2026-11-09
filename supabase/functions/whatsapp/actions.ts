// Aplica as operações do assistente (ops, o mesmo contrato do chat do app) nos dados da pessoa:
// desfaz a última mensagem, corrige o que ela criou, cria os lançamentos novos (como o app) e
// monta a confirmação. Sem rede: devolve o que gravar e o que responder.

import type { AssistantOps, AssistantTx } from '../_shared/assistente/types.ts'
import { accountName, activeCategories, cardName, categoryName, defaultAccountId, payableInvoice, undoTarget, type LogEntry, type LogRecord, type UserData } from './data.ts'
import { UNDO_HINT, ddmm, money, relDay, shortMonth, texts } from './format.ts'
import { addMonths, applyPatch, byCategory, cashDate, limitOf, makeTransactions, monthKey, monthRange, rootOf, splitInstallments, suggestCategory, type Transaction } from './ledger.ts'

export interface Execution {
  /** lançamentos a gravar (novos, corrigidos ou restaurados) */
  upserts: Transaction[]
  /** ids de lançamentos a apagar */
  deletes: string[]
  /** o que esta mensagem mudou (whatsapp_log.records, para o próximo "desfazer") */
  log: LogRecord[]
  /** mensagem desfeita (marcar undone) */
  undoneLog?: number
  reply: string
}

export interface ExecContext {
  today: string
  uid: () => string
  /** últimas mensagens desta pessoa, a mais nova primeiro (sem a atual) */
  recent: LogEntry[]
}

const where = (d: UserData, t: Transaction) => (t.cardId ? `cartão ${cardName(d, t.cardId) ?? ''}`.trim() : accountName(d, t.accountId))

/** Uma linha de confirmação para o que um item criou (as parcelas viram uma linha só). */
function createdLine(d: UserData, txs: Transaction[], today: string) {
  const t = txs[0]
  const total = txs.reduce((s, x) => s + x.amount, 0)
  if (t.type === 'transferencia') {
    if (t.cardId) return `- Fatura ${cardName(d, t.cardId) ?? ''} de ${shortMonth(t.invoice!)} — ${money(t.amount)} pago${t.accountId ? ` com ${accountName(d, t.accountId)}` : ''}${t.date !== today ? ` · ${relDay(t.date, today)}` : ''}`
    return `- Transferência — ${money(t.amount)} de ${accountName(d, t.accountId) ?? '?'} para ${accountName(d, t.toAccountId) ?? '?'}${t.status === 'pendente' ? ` · agendada para ${ddmm(t.date)}` : t.date !== today ? ` · ${relDay(t.date, today)}` : ''}`
  }
  const value = txs.length > 1 ? `${txs.length}x de ${money(t.amount)} (total ${money(total)})` : money(t.amount)
  const parts = [categoryName(d, t.categoryId) ?? 'sem categoria']
  const place = where(d, t)
  if (place) parts.push(place)
  if (t.cardId && t.invoice) parts.push(txs.length > 1 ? `1ª na fatura de ${shortMonth(t.invoice)}` : `fatura de ${shortMonth(t.invoice)}`)
  if (t.status === 'pendente') parts.push(`${t.type === 'receita' ? 'a receber' : 'a pagar'} em ${ddmm(t.date)}`)
  else if (txs.length > 1 && !t.cardId) parts.push(`parcelas mensais a partir de ${ddmm(t.date)}`)
  else if (t.date !== today) parts.push(relDay(t.date, today))
  return `- ${t.description} — ${value}${t.type === 'receita' && t.status === 'pago' ? ' recebido' : ''} · ${parts.join(' · ')}`
}

/** Item novo → lançamentos (com a categoria sugerida, a conta padrão e a fatura certa); null = não dá. */
function build(d: UserData, item: AssistantTx, txs: Transaction[], ctx: ExecContext): { created: Transaction[]; note?: string } | null {
  const def = defaultAccountId(d)
  if (item.type === 'transferencia' && item.cardId) {
    const card = d.cards.find((c) => c.id === item.cardId)
    if (!card) return null
    const inv = payableInvoice(card, txs, ctx.today)
    if (!inv) return { created: [], note: `A fatura do ${card.name} não tem valor em aberto, então não lancei o pagamento.` }
    const accountId = item.accountId ?? (card.accountId && d.accounts.some((a) => a.id === card.accountId && !a.archived) ? card.accountId : def)
    const amount = Math.min(item.amount, inv.open)
    const created = makeTransactions(
      { type: 'transferencia', description: `Fatura ${card.name}`, amount, date: item.date, status: 'pago', accountId, cardId: card.id, invoice: inv.key, ...(item.note ? { note: item.note } : {}) },
      1,
      d.cards,
      { uid: ctx.uid, today: ctx.today },
    )
    return { created, note: item.amount > inv.open + 0.005 ? `O pagamento ficou em ${money(inv.open)}, que é o que faltava da fatura de ${shortMonth(inv.key)}.` : undefined }
  }
  const accountId = item.cardId ? undefined : (item.accountId ?? def)
  if (item.type === 'transferencia' && (!accountId || !item.toAccountId || accountId === item.toAccountId)) return null
  // sem categoria da IA: a mesma sugestão do app (histórico e palavras-chave)
  const categoryId = item.type === 'transferencia' ? undefined : (item.categoryId ?? suggestCategory(item.description, item.type, d.categories, d.transactions))
  const created = makeTransactions(
    {
      type: item.type,
      description: item.description,
      amount: item.amount,
      date: item.date,
      status: item.paid ? 'pago' : 'pendente',
      ...(categoryId ? { categoryId } : {}),
      ...(accountId ? { accountId } : {}),
      ...(item.toAccountId ? { toAccountId: item.toAccountId } : {}),
      ...(item.cardId ? { cardId: item.cardId } : {}),
      ...(item.note ? { note: item.note } : {}),
    },
    item.installments,
    d.cards,
    { uid: ctx.uid, today: ctx.today },
  )
  return { created }
}

/** Aviso de limite das categorias em que caíram gastos deste mês. */
function budgetAlerts(d: UserData, txs: Transaction[], created: Transaction[], today: string) {
  const cards = new Map(d.cards.map((c) => [c.id, c]))
  const cats = new Map(d.categories.map((c) => [c.id, c]))
  const key = monthKey(today)
  const roots = new Set<string>()
  for (const t of created) {
    if (t.type !== 'despesa' || monthKey(cashDate(t, cards)) !== key) continue
    const r = rootOf(t.categoryId, cats)
    if (r) roots.add(r.id)
  }
  if (!roots.size) return []
  const { from, to } = monthRange(key)
  const spent = byCategory(txs, cards, d.categories, 'despesa', from, to)
  const alert = d.settings.budgetAlert ?? 0.8
  const out: string[] = []
  for (const id of roots) {
    const c = cats.get(id)!
    const limit = limitOf(c, activeCategories(d))
    const v = spent.get(id) ?? 0
    if (limit <= 0 || v / limit < alert) continue
    out.push(
      v > limit + 0.005
        ? `${c.name} passou do limite do mês: ${money(v)} de ${money(limit)}.`
        : `${c.name} está em ${Math.round((v / limit) * 100)}% do limite do mês (${money(v)} de ${money(limit)}).`,
    )
  }
  return out
}

const byGroup = (txs: Transaction[]) => {
  const groups = new Map<string, Transaction[]>()
  for (const t of txs) groups.set(t.groupId ?? t.id, [...(groups.get(t.groupId ?? t.id) ?? []), t])
  return [...groups.values()].map((g) => [...g].sort((a, b) => (a.installment?.n ?? 0) - (b.installment?.n ?? 0)))
}

export function execute(ops: AssistantOps, reply: string, d: UserData, ctx: ExecContext): Execution {
  const out: Execution = { upserts: [], deletes: [], log: [], reply: '' }
  const sections: string[] = []
  const notes: string[] = []
  let txs = [...d.transactions]
  const target = undoTarget(ctx.recent)

  // 1. desfazer a última mensagem: apaga o que ela criou e devolve o que ela mudou
  if (ops.undo) {
    if (!target) notes.push(texts.nothingToUndo)
    else {
      const current = new Map(txs.map((t) => [t.id, t]))
      const restored: string[] = []
      const deleted: Transaction[] = []
      // de trás para frente: se a mesma mensagem mexeu duas vezes no mesmo lançamento, vale o primeiro "antes"
      for (const r of target.records.toReversed()) {
        if (r.before) {
          out.upserts = [...out.upserts.filter((t) => t.id !== r.id), r.before]
          txs = [...txs.filter((t) => t.id !== r.id), r.before]
          restored.unshift(`- ${r.before.description} voltou a ser ${money(r.before.amount)}${r.before.date !== ctx.today ? ` (${relDay(r.before.date, ctx.today)})` : ''}`)
        } else {
          out.deletes.push(r.id)
          const gone = current.get(r.id)
          if (gone) deleted.unshift(gone)
          txs = txs.filter((t) => t.id !== r.id)
        }
      }
      const removed = byGroup(deleted).map((g) => `- ${g[0].description} — ${g.length > 1 ? `${g.length} parcelas, ${money(g.reduce((s, t) => s + t.amount, 0))}` : money(g[0].amount)} apagado`)
      out.undoneLog = target.id
      if (removed.length + restored.length) sections.push(['Desfeito:', ...removed, ...restored].join('\n'))
      else notes.push('O último lançamento feito por aqui já tinha sido apagado no app.')
    }
  }

  // 2. correção no que a última mensagem criou (não junto com desfazer)
  if (ops.correct && !ops.undo) {
    const ids = new Set(target?.records.map((r) => r.id) ?? [])
    const groups = byGroup(txs.filter((t) => ids.has(t.id)))
    const fix = ops.correct
    if (!groups.length) notes.push('Não achei o último lançamento para corrigir.')
    else {
      const lines: string[] = []
      if (fix.amount !== undefined && groups.length > 1) notes.push('Para mudar o valor de vários lançamentos de uma vez, responda "desfazer" e mande de novo.')
      for (const g of groups) {
        const amounts = fix.amount !== undefined && groups.length === 1 ? splitInstallments(fix.amount, g.length) : undefined
        const changed = g.map((before, k) => {
          const patch: Parameters<typeof applyPatch>[1] = {}
          if (fix.description) patch.description = fix.description
          if (amounts) patch.amount = amounts[k]
          // parcelas fora do cartão mantêm um mês de distância; no cartão, todas ficam com a data da compra
          if (fix.date) patch.date = before.cardId || !before.installment ? fix.date : addMonths(fix.date, before.installment.n - 1)
          if (fix.categoryId && before.type !== 'transferencia') patch.categoryId = fix.categoryId
          if (fix.cardId && before.type === 'despesa') patch.cardId = fix.cardId
          else if (fix.accountId && before.type !== 'transferencia') patch.accountId = fix.accountId
          // pago: só fora do cartão; nas parcelas, só as que já venceram
          if (fix.paid !== undefined && !(fix.cardId ?? before.cardId)) {
            const date = patch.date ?? before.date
            patch.status = fix.paid && date <= ctx.today ? 'pago' : fix.paid ? before.status : 'pendente'
          }
          return { before, after: applyPatch(before, patch, d.cards) }
        })
        const real = changed.filter((c) => JSON.stringify(c.after) !== JSON.stringify(c.before))
        if (!real.length) continue
        for (const c of real) {
          out.upserts = [...out.upserts.filter((t) => t.id !== c.after.id), c.after]
          txs = txs.map((t) => (t.id === c.after.id ? c.after : t))
          out.log.push({ kind: 'transactions', id: c.after.id, before: c.before })
        }
        const b = g[0]
        const a = changed[0].after
        const total = (list: Transaction[]) => list.reduce((s, t) => s + t.amount, 0)
        const parts: string[] = []
        const before = total(g)
        const after = total(changed.map((c) => c.after))
        if (Math.abs(after - before) > 0.005) parts.push(`${money(after)} (era ${money(before)})`)
        if (a.description !== b.description) parts.push(`"${a.description}"`)
        if (a.date !== b.date) parts.push(relDay(a.date, ctx.today))
        if (a.categoryId !== b.categoryId) parts.push(categoryName(d, a.categoryId) ?? 'sem categoria')
        if (a.cardId !== b.cardId || a.accountId !== b.accountId) parts.push(where(d, a) ?? 'sem conta')
        if (a.status !== b.status) parts.push(a.status === 'pago' ? (a.type === 'receita' ? 'recebido' : 'pago') : a.type === 'receita' ? 'a receber' : 'a pagar')
        lines.push(`- ${b.description} — agora ${parts.join(' · ')}`)
      }
      if (lines.length) sections.push(['Corrigi:', ...lines].join('\n'))
    }
  }

  // 3. lançamentos novos
  const created: Transaction[] = []
  const lines: string[] = []
  for (const item of ops.create) {
    const r = build(d, item, txs, ctx)
    if (!r) continue
    if (r.note) notes.push(r.note)
    if (!r.created.length) continue
    created.push(...r.created)
    txs = [...r.created, ...txs]
    out.upserts.push(...r.created)
    out.log.push(...r.created.map((t) => ({ kind: 'transactions' as const, id: t.id, before: null })))
    lines.push(createdLine(d, r.created, ctx.today))
  }
  if (lines.length) sections.push([lines.length > 1 ? `Lancei ${lines.length} lançamentos:` : 'Lancei:', ...lines].join('\n'))

  const alerts = budgetAlerts(d, txs, created, ctx.today)
  const changed = out.log.length > 0
  const parts = [...sections]
  if (reply) parts.push(reply)
  if (notes.length) parts.push(notes.join('\n'))
  if (alerts.length) parts.push(alerts.join('\n'))
  if (changed) parts.push(UNDO_HINT)
  out.reply = parts.join('\n\n')
  return out
}
