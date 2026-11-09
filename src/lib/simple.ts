// Modo simples do chat (sem IA): pedidos curtos que mexem no que já existe, por regras, no aparelho.
//   "caiu meu salário"            → dá baixa no salário previsto (ou lança igual ao último)
//   "paguei a luz 192,30"         → dá baixa na conta de luz com o valor que veio
//   "paguei a fatura do nubank"   → paga a fatura em aberto
//   "muda o aluguel para 1.900"   → altera (com "a partir de agora", os próximos também)
//   "apaga o uber de ontem"       → apaga (com "cancela", para de repetir)
//   "guardei 200 na viagem"       → guarda na meta
//   "o salário já caiu?", "o que falta pagar?" → responde
// O chat roda cada ação guardando o que mudou, para o botão Desfazer.

import { addDays, diffDays, monthKey } from './dates'
import { moneyRaw as money } from './format'
import { goalStats, monthRange, type Category, type Transaction } from './ledger'
import { amountIn, dateIn } from './quick'
import { useData, type Scope, type TxInput } from './store'
import { launch, payableInvoice, runTool } from './agent'

export interface SimpleAction {
  reply: string
  /** O que fazer nos dados; se devolver texto, ele vira a resposta (o resultado decide). */
  act?: () => string | void
  /** Rótulo do lançamento mostrado na resposta (Recebido, Pago, Alterado). */
  label?: string
}

export const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const tokens = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean)
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const low = (s: string) => (s === s.toUpperCase() ? s : s.charAt(0).toLowerCase() + s.slice(1))

// ─── Palavras ────────────────────────────────────────────────

const RECEIVED = /\b(caiu|cairam|entrou|entraram|recebi|recebido|recebida|chegou|chegaram|pingou|depositaram|depositou|creditou|creditaram|me pagou|me pagaram|pagaram)\b/
const PAID = /\b(paguei|pago|paga|pagos|pagas|quitei|quitado|quitada|debitou|debitaram|descontou|descontaram)\b/
const EDIT = /\b(muda|mude|mudar|altera|altere|alterar|troca|troque|trocar|corrige|corrija|corrigir|ajusta|ajuste|ajustar|edita|edite|editar|atualiza|atualize|atualizar|aumentou|subiu|baixou|diminuiu)\b|\bagora (e|sao|vai ser|fica|ficou)\b/
const REMOVE = /\b(apaga|apague|apagar|exclui|exclua|excluir|remove|remova|remover|deleta|delete|deletar|tira|tire|tirar|cancela|cancele|cancelar)\b/
/** Vale para as próximas repetições também. */
const ONWARD = /\b(agora|a partir|daqui (pra|para) frente|todo mes|todos os meses|sempre|proximos|proximas|de vez|aumentou|subiu|baixou|diminuiu)\b/
const SAVE = /\b(guardei|guarda|guardar|juntei|poupei|separei|coloquei|depositei|aportei|investi)\b/
const WITHDRAW = /\b(tirei|tira|tirar|retirei|retira|resgatei|resgata|resgatar|saquei|usei)\b/
const INVOICE = /\bfaturas?\b/
const PENDING_Q = /\b(falta|faltam|a pagar|a receber|pendentes?|atrasad\w*|vence|vencem|vencendo|vencer|em aberto)\b/

const VERBS = [RECEIVED, PAID, EDIT, REMOVE, ONWARD, SAVE, WITHDRAW, INVOICE].map((r) => new RegExp(r.source, 'g'))

// palavras que não dizem qual é o lançamento
const NOISE = new Set(
  (
    'meu minha meus minhas seu sua o a os as um uma uns umas de do da dos das no na nos nas em pra pro pras pros para com que ja hoje ontem anteontem amanha ' +
    'esse essa este esta isso isto aquele aquela ele ela eu voce vc conta contas boleto boletos pagamento valor reais real rs mil mes dia vez vezes ' +
    'foi era e ta tava ainda nao sim todo todos toda todas sempre daqui frente partir proximo proxima proximos proximas ultimo ultima ' +
    'quanto qual quais como quando cade se tem tenho por favor pfv pfvr ok certo entao mas tambem so ai la aqui ' +
    'cartao credito debito pix dinheiro meta metas lancamento lancamentos'
  ).split(' '),
)

/** As palavras que dizem qual é o lançamento ("caiu meu salário no itaú" → salario, itau). */
export function terms(t: string) {
  let s = t
  for (const r of VERBS) s = s.replace(r, ' ')
  return [...new Set(tokens(s).filter((w) => w.length >= 3 && !NOISE.has(w) && !/^\d/.test(w)))]
}

/** As mesmas palavras com a grafia que a pessoa usou (para repetir na resposta). */
const spoken = (input: string, words: string[]) => {
  const keep = new Set(words)
  const out = input.split(/\s+/).filter((w) => keep.has(norm(w).replace(/[^a-z0-9]/g, '')))
  return (out.length ? out : words).join(' ')
}

const same = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)))

/** Quanto o lançamento combina com as palavras: a descrição vale mais que a categoria. */
function score(t: Transaction, words: string[], cats: Map<string, Category>) {
  const desc = tokens(t.description)
  const cat = t.categoryId ? cats.get(t.categoryId) : undefined
  const parent = cat?.parentId ? cats.get(cat.parentId) : undefined
  // palavras-chave de uma palavra só ("energia" acha a Luz); as compostas ("prestação da casa") trariam palavras soltas demais
  const catWords = [cat, parent].flatMap((c) => (c ? [...tokens(c.name), ...(c.keywords ?? []).filter((k) => !/\s/.test(k.trim())).flatMap(tokens)] : []))
  let s = 0
  for (const w of words) {
    if (desc.some((d) => same(d, w))) s += 2
    else if (catWords.some((d) => same(d, w))) s += 1
  }
  return s
}

interface Hit {
  t: Transaction
  /** Mais de um lançamento diferente combina igual: perguntar qual. */
  others?: Transaction[]
}

/** O lançamento que mais combina; empate entre repetições fica com o mais perto de hoje (o passado antes). */
function best(list: Transaction[], words: string[], ref: string): Hit | null {
  const cats = new Map(useData.getState().categories.map((c) => [c.id, c]))
  let top = 0
  let hits: Transaction[] = []
  for (const t of list) {
    const s = score(t, words, cats)
    if (s > top) {
      top = s
      hits = [t]
    } else if (s && s === top) hits.push(t)
  }
  if (!top) return null
  const near = (t: Transaction) => Math.abs(diffDays(t.date, ref)) + (t.date > ref ? 0.5 : 0)
  hits.sort((a, b) => near(a) - near(b))
  const byName = new Map<string, Transaction>()
  for (const t of hits) if (!byName.has(norm(t.description))) byName.set(norm(t.description), t)
  return { t: hits[0], ...(byName.size > 1 ? { others: [...byName.values()].slice(0, 4) } : {}) }
}

const ask = (list: Transaction[], verb: string): SimpleAction => ({
  reply: `Achei mais de um: ${list.map((t) => `${t.description} (${dm(t.date)})`).join(', ')}. Qual deles? Diga, por exemplo, “${verb} ${low(list[0].description)}”.`,
})

const isRecurring = (t: Transaction) => !!t.groupId && useData.getState().recurrences.some((r) => r.id === t.groupId)

// ─── Dar baixa: "caiu meu salário", "paguei a luz" ───────────

function settleOne(t: Transaction, amount: number | undefined, date: string | undefined, ref: string): SimpleAction {
  const patch: Partial<TxInput> = {}
  if (amount && Math.abs(amount - t.amount) >= 0.005) patch.amount = amount
  // chegou antes do previsto: fica com a data de hoje (ou a que a pessoa disse)
  const day = date ?? (t.date > ref ? ref : undefined)
  if (day && day !== t.date) patch.date = day
  const got = t.type === 'receita'
  return {
    reply: `Pronto, ${got ? 'entrou' : 'pago'}: ${t.description} · ${money(patch.amount ?? t.amount)}${patch.amount ? ` (o previsto era ${money(t.amount)})` : ''}${patch.date ? `, em ${dm(patch.date)}` : ''}.`,
    act: () => {
      if (Object.keys(patch).length) useData.getState().updateTransaction(t.id, patch, 'one')
      useData.getState().setPaid(t.id, true)
    },
    label: got ? 'Recebido' : 'Pago',
  }
}

function settle(t: string, input: string, ref: string): SimpleAction | null {
  const type = PAID.test(t) ? 'despesa' : RECEIVED.test(t) ? 'receita' : null
  if (!type) return null
  const words = terms(t)
  if (!words.length) return null
  const got = type === 'receita'
  const amount = amountIn(t)?.value
  const when = dateIn(t, ref)
  const usable = useData.getState().transactions.filter((x) => x.type === type && !x.adjust && !x.debtId)

  // o que estava previsto: atrasado, deste mês ou dos próximos 7 dias (salário que caiu adiantado);
  // o do mês que vem, mais longe que isso, não (o deste mês já caiu)
  const until = [addDays(ref, 7), monthRange(monthKey(ref)).to].sort()[1]
  const pending = best(
    usable.filter((x) => x.status === 'pendente' && !x.cardId && x.date <= until),
    words,
    ref,
  )
  if (pending?.others) return ask(pending.others, got ? 'caiu' : 'paguei')
  if (pending) return settleOne(pending.t, amount, when?.date, ref)
  // com valor e nada previsto: é um lançamento novo (o modo simples lança)
  if (amount) return null

  const recent = best(
    usable.filter((x) => x.status === 'pago' && Math.abs(diffDays(x.date, ref)) <= 25),
    words,
    ref,
  )
  if (recent && !recent.others) {
    const x = recent.t
    return {
      reply: `${x.description} de ${dm(x.date)} já está como ${got ? 'recebido' : 'pago'} (${money(x.amount)}). Se ${got ? 'entrou' : 'saiu'} outro, diga com o valor, como “${got ? 'recebi' : 'paguei'} 500 de ${low(x.description)}”.`,
    }
  }

  // nada previsto: lança igual à última vez
  const last = best(
    usable.filter((x) => x.date <= ref),
    words,
    ref,
  )
  if (last && !last.others) {
    const x = last.t
    return {
      reply: `Lancei ${x.description} de ${money(x.amount)}, o mesmo valor da última vez (${dm(x.date)}). Se veio diferente, diga “foi ${got ? '3.500' : '150'}”.`,
      act: () => {
        launch(
          {
            type,
            description: x.description,
            amount: x.amount,
            date: when?.date ?? ref,
            categoryId: x.categoryId ?? null,
            accountId: x.accountId ?? null,
            toAccountId: null,
            cardId: x.cardId ?? null,
            installments: 1,
            paid: true,
            note: null,
          },
          ref,
        )
      },
    }
  }
  return {
    reply: `Não achei “${spoken(input, words)}” ${got ? 'a receber' : 'a pagar'}. Diga com o valor, como “${got ? 'caiu o salário 3.500' : 'paguei a luz 180'}”, que eu lanço.`,
  }
}

// ─── Fatura do cartão ────────────────────────────────────────

function payInvoice(t: string, ref: string): SimpleAction | null {
  if (!PAID.test(t)) return null
  const d = useData.getState()
  const cards = d.cards.filter((c) => !c.archived)
  const cardWords = new Set(cards.flatMap((c) => tokens(c.name)))
  // "paguei o cartão" (sem dizer o que comprou) também é a fatura
  if (!INVOICE.test(t) && !(/\bcartao\b/.test(t) && terms(t).every((w) => cardWords.has(w)))) return null
  if (!cards.length) return { reply: 'Você ainda não tem cartão cadastrado.' }
  const words = new Set(terms(t))
  const named = cards
    .map((c) => ({ c, n: tokens(c.name).filter((w) => w.length >= 3 && words.has(w)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
  let card = named[0]?.c
  if (!card) {
    const open = cards.filter((c) => payableInvoice(c, d.transactions, ref))
    if (!open.length) return { reply: 'Não tem fatura em aberto agora.' }
    if (open.length > 1) return { reply: `Qual fatura: ${open.map((c) => c.name).join(' ou ')}? Diga, por exemplo, “paguei a fatura do ${open[0].name}”.` }
    card = open[0]
  }
  const amount = amountIn(t)?.value
  const when = dateIn(t, ref)
  const id = card.id
  return {
    reply: '',
    act: () => {
      const o = runTool('pagar_fatura', { cartao_id: id, ...(amount ? { valor: amount } : {}), ...(when ? { data: when.date } : {}) }, { ref, undo: () => null })
      return o.say ?? o.content
    },
    label: 'Pago',
  }
}

// ─── Metas: "guardei 200 na viagem" ──────────────────────────

function goal(t: string, ref: string): SimpleAction | null {
  const out = WITHDRAW.test(t) && !SAVE.test(t)
  if (!out && !SAVE.test(t)) return null
  const amount = amountIn(t)?.value
  if (!amount) return null
  const goals = useData.getState().goals.filter((g) => !g.archived && !g.completedAt)
  if (!goals.length) return null
  const words = terms(t)
  const named = goals
    .map((g) => ({ g, n: words.filter((w) => tokens(g.name).some((x) => same(x, w))).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
  // sem dizer qual: só quando há uma meta (e "tirei" sem meta é outra coisa)
  const g = named[0]?.g ?? (!out && goals.length === 1 && /\b(guardei|juntei|poupei|separei|aportei)\b/.test(t) ? goals[0] : undefined)
  if (!g) return null
  if (out && amount > goalStats(g, ref).saved + 0.005) return { reply: `Só tem ${money(goalStats(g, ref).saved)} guardado em ${g.name}.` }
  const when = dateIn(t, ref)
  return {
    reply: '',
    act: () => {
      const o = runTool('metas', { acao: out ? 'resgatar' : 'guardar', id: g.id, valor: amount, ...(when ? { data: when.date } : {}) }, { ref, undo: () => null })
      return o.say ?? o.content
    },
  }
}

// ─── Alterar: "muda o aluguel para 1.900" ────────────────────

function edit(t: string, input: string, ref: string): SimpleAction | null {
  if (!EDIT.test(t)) return null
  const amount = amountIn(t)?.value
  const when = dateIn(t, ref)
  if (!amount && !when) return null
  const words = terms(t)
  if (!words.length) return null
  const list = useData.getState().transactions.filter((x) => !x.adjust && !x.debtId && !(x.type === 'transferencia' && x.cardId))
  // com valor, a data diz qual é ("corrige o mercado de ontem para 150"); sem valor, é a data nova
  const onDay = amount && when ? list.filter((x) => x.date === when.date) : []
  const hit = best(onDay.length ? onDay : list, words, ref)
  if (!hit) return { reply: `Não achei “${spoken(input, words)}” nos lançamentos.` }
  if (hit.others) return ask(hit.others, 'muda')
  const x = hit.t
  const patch: Partial<TxInput> = {}
  if (amount && Math.abs(amount - x.amount) >= 0.005) patch.amount = amount
  if (!amount && when && when.date !== x.date) patch.date = when.date
  if (!Object.keys(patch).length) return { reply: `${x.description} de ${dm(x.date)} já está assim (${money(x.amount)}).` }
  const fixed = isRecurring(x)
  const scope: Scope = fixed && ONWARD.test(t) ? 'next' : 'one'
  const what = [patch.amount !== undefined && `${money(x.amount)} → ${money(patch.amount)}`, patch.date && `agora em ${dm(patch.date)}`].filter(Boolean).join(', ')
  return {
    reply: `Alterei ${x.description} de ${dm(x.date)}: ${what}${scope === 'next' ? ', e os próximos meses também' : ''}.${fixed && scope === 'one' ? ' Só este; para os próximos também, diga “a partir de agora”.' : ''}`,
    act: () => useData.getState().updateTransaction(x.id, patch, scope),
    label: 'Alterado',
  }
}

// ─── Apagar: "apaga o uber de ontem" ─────────────────────────

function remove(t: string, input: string, ref: string): SimpleAction | null {
  if (!REMOVE.test(t)) return null
  const words = terms(t)
  if (!words.length) return null
  const amount = amountIn(t)?.value
  const when = dateIn(t, ref)
  const list = useData
    .getState()
    .transactions.filter((x) => !x.adjust && (!when || x.date === when.date) && (!amount || Math.abs(x.amount - amount) < 0.005))
  const hit = best(list, words, ref)
  if (!hit) return { reply: `Não achei “${spoken(input, words)}” para apagar.` }
  if (hit.others) return ask(hit.others, 'apaga')
  const x = hit.t
  const scope: Scope = isRecurring(x) && (ONWARD.test(t) || /\bcancel/.test(t)) ? 'next' : 'one'
  return {
    reply: `Apaguei ${x.description} · ${money(x.amount)} de ${dm(x.date)}${scope === 'next' ? ' e parei as próximas repetições' : ''}.`,
    act: () => useData.getState().removeTransaction(x.id, scope),
  }
}

/** Pedidos que mexem no que já existe. null = não é com isto (o modo simples tenta lançar). */
export function simpleAction(input: string, ref: string): SimpleAction | null {
  const t = norm(input).replace(/\s+/g, ' ').trim()
  return payInvoice(t, ref) ?? goal(t, ref) ?? edit(t, input, ref) ?? remove(t, input, ref) ?? settle(t, input, ref)
}

// ─── Perguntas: "o salário já caiu?", "o que falta pagar?" ───

function pendingList(t: string, ref: string) {
  const d = useData.getState()
  const income = /\breceber\b/.test(t)
  const end = monthRange(monthKey(ref)).to
  const rows = d.transactions
    .filter((x) => x.status === 'pendente' && !x.cardId && !x.adjust && x.type === (income ? 'receita' : 'despesa') && x.date <= end)
    .map((x) => ({ name: x.description, amount: x.amount, date: x.date }))
  if (!income)
    for (const c of d.cards.filter((k) => !k.archived)) {
      const inv = payableInvoice(c, d.transactions, ref)
      if (inv && inv.due <= end) rows.push({ name: `Fatura ${c.name}`, amount: inv.open, date: inv.due })
    }
  rows.sort((a, b) => a.date.localeCompare(b.date))
  if (!rows.length) return income ? 'Nada a receber até o fim do mês.' : 'Nada a pagar até o fim do mês.'
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const lines = rows.slice(0, 8).map((r) => `${r.name} · ${money(r.amount)} · ${r.date < ref ? 'venceu' : 'vence'} ${dm(r.date)}`)
  return `${income ? 'A receber' : 'Falta pagar'} até o fim do mês: ${money(total)}\n${lines.join('\n')}${rows.length > 8 ? `\ne mais ${rows.length - 8}` : ''}`
}

/** Responde se algo já caiu ou foi pago, e o que falta pagar ou receber. */
export function simpleAnswer(input: string, ref: string): string | null {
  const t = norm(input).replace(/\s+/g, ' ').trim()
  const type = PAID.test(t) ? 'despesa' : RECEIVED.test(t) ? 'receita' : null
  const words = type ? terms(t) : []
  if (type && words.length) {
    const hit = best(
      useData.getState().transactions.filter((x) => x.type === type && !x.adjust && Math.abs(diffDays(x.date, ref)) <= 35),
      words,
      ref,
    )
    if (hit && !hit.others) {
      const x = hit.t
      if (x.status === 'pago') return `Já. ${x.description} de ${money(x.amount)} ${type === 'receita' ? 'entrou' : 'foi pago'} em ${dm(x.date)}.`
      return `Ainda não. ${x.description} de ${money(x.amount)} ${x.date < ref ? 'venceu' : 'está previsto para'} ${dm(x.date)}. Quando ${type === 'receita' ? 'cair' : 'pagar'}, me avise: “${type === 'receita' ? 'caiu' : 'paguei'} ${low(x.description)}”.`
    }
  }
  if (PENDING_Q.test(t)) return pendingList(t, ref)
  return null
}
