// Contrato do assistente do Dinn (chat do app e WhatsApp). Só tipos e limites, sem imports:
// o app espelha este arquivo.

/** Um lançamento que o assistente quer criar. */
export interface AssistantTx {
  type: 'receita' | 'despesa' | 'transferencia'
  description: string
  /** valor TOTAL (parcelado: a soma das parcelas), maior que zero */
  amount: number
  /** AAAA-MM-DD */
  date: string
  categoryId: string | null
  /** receita/despesa: a conta; transferência: de onde saiu (pagamento de fatura: a conta que pagou) */
  accountId: string | null
  /** transferência entre contas: para onde foi */
  toAccountId: string | null
  /** despesa: compra no cartão; transferência: pagamento da fatura deste cartão */
  cardId: string | null
  /** 1 = à vista */
  installments: number
  /** já pago/recebido (compra no cartão: sempre true) */
  paid: boolean
  note: string | null
}

/** O que corrigir no que a última resposta do assistente criou. */
export type AssistantCorrection = Partial<Pick<AssistantTx, 'description' | 'amount' | 'date' | 'categoryId' | 'accountId' | 'cardId' | 'paid'>>

export interface AssistantOps {
  create: AssistantTx[]
  /** desfazer o que a última resposta do assistente criou */
  undo: boolean
  /** correção no que a última resposta criou (só quando ela criou um item, à vista ou parcelado) */
  correct: AssistantCorrection | null
}

export interface AssistantCategory {
  id: string
  name: string
  type: 'receita' | 'despesa'
  parentId: string | null
}

export interface AssistantAccount {
  id: string
  name: string
  /** corrente, poupanca, carteira, investimento, beneficio, outro */
  kind?: string
  /** saldo de hoje */
  balance?: number
  /** fora do saldo total */
  hidden?: boolean
}

export interface AssistantCard {
  id: string
  name: string
  brand?: string
  last4?: string
  closingDay?: number
  dueDay?: number
  limit?: number
  /** limite disponível agora */
  available?: number
}

export interface AssistantMonth {
  /** AAAA-MM */
  key: string
  income: number
  incomePaid: number
  incomePending: number
  expense: number
  expensePaid: number
  expensePending: number
  balance: number
}

/** Fatura com valor (a atual de cada cartão e as anteriores ainda em aberto). */
export interface AssistantInvoice {
  cardId: string
  /** AAAA-MM do vencimento */
  key: string
  /** AAAA-MM-DD */
  due: string
  total: number
  open: number
  /** aberta, fechada, parcial, paga, vencida, vazia */
  status: string
}

/** Gasto do mês numa categoria principal (subcategorias somadas). */
export interface AssistantCategorySpend {
  categoryId: string | null
  name: string
  amount: number
  /** limite do mês; null = sem limite */
  limit: number | null
}

/** Conta a pagar ou a receber fora do cartão (atrasada ou dos próximos dias). */
export interface AssistantBill {
  type: 'receita' | 'despesa'
  description: string
  amount: number
  date: string
  late: boolean
}

/** Lançamento recente (para "qual foi meu último gasto?"). */
export interface AssistantRecent {
  /** id do lançamento (o chat do app manda, para o assistente poder corrigir e apagar) */
  id?: string
  date: string
  type: 'receita' | 'despesa' | 'transferencia'
  description: string
  amount: number
  category?: string | null
  /** conta, cartão ou "Conta A → Conta B" */
  where?: string | null
  status?: 'pago' | 'pendente'
  installment?: string | null
  /** criado ou alterado na última resposta do assistente */
  last?: boolean
}

/** Meta de economia. */
export interface AssistantGoal {
  id: string
  name: string
  target: number
  saved: number
  /** AAAA-MM-DD */
  deadline?: string | null
  /** quanto pretende guardar por mês */
  monthly?: number | null
  done?: boolean
}

/** Dívida ou empréstimo (aba Dívidas). */
export interface AssistantDebt {
  id: string
  /** pagar = a pessoa deve; receber = devem para ela */
  direction: 'pagar' | 'receber'
  person: string
  /** emprestimo, financiamento, pessoal, acordo */
  kind: string
  /** quanto falta pagar ou receber */
  open: number
  /** próxima parcela em aberto */
  next?: { due: string; amount: number } | null
  /** em_dia, atrasado, renegociado, quitado */
  status: string
}

/**
 * Tudo o que o assistente sabe da pessoa, já calculado por quem chama (o app com as funções do
 * ledger; o WhatsApp com o espelho delas no servidor). Os agregados são opcionais.
 */
export interface AssistantContext {
  /** AAAA-MM-DD (dia da pessoa) */
  today: string
  name?: string | null
  categories: AssistantCategory[]
  accounts: AssistantAccount[]
  cards: AssistantCard[]
  defaultAccount: string | null
  totalBalance?: number | null
  month?: AssistantMonth | null
  previousMonth?: AssistantMonth | null
  expenseByCategory?: AssistantCategorySpend[]
  /** limite geral do mês */
  budget?: { limit: number; spent: number } | null
  invoices?: AssistantInvoice[]
  bills?: AssistantBill[]
  recent?: AssistantRecent[]
  goals?: AssistantGoal[]
  debts?: AssistantDebt[]
  /** o que a última resposta do assistente criou (e ainda existe): alvo de `correct` e `undo` */
  lastCreated?: AssistantTx[]
}

export interface HistoryTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface AssistantImage {
  base64: string
  /** image/jpeg, image/png, image/webp ou image/gif */
  mime: string
}

export interface AssistantInput {
  /** texto digitado, transcrição do áudio ou legenda */
  text?: string
  /** de onde veio o texto (só muda o rótulo para a IA) */
  source?: 'texto' | 'audio'
  images?: AssistantImage[]
  pdf?: { base64: string; name?: string }
}

export interface InterpretRequest {
  context: AssistantContext
  history: HistoryTurn[]
  input: AssistantInput
}

export interface InterpretResult {
  reply: string
  ops: AssistantOps
  /** ok; refusal = a IA recusou; invalid = resposta fora do formato (reply é um pedido de desculpas) */
  outcome: 'ok' | 'refusal' | 'invalid'
}

// ─── Agente (chat do app) ────────────────────────────────────
// A IA pede ferramentas; o app executa nos próprios dados e manda os resultados de volta.

/** Resultado de uma ferramenta executada no app. */
export interface AgentToolResult {
  /** id do bloco tool_use */
  id: string
  content: string
  error?: boolean
}

/** Uma volta do agente: os blocos que a IA respondeu (como vieram) e os resultados das ferramentas. */
export interface AgentStep {
  content: unknown[]
  results: AgentToolResult[]
}

/** Limites do que vai para a IA. */
export const LIMITS = {
  text: 4000,
  historyTurns: 12,
  historyText: 2000,
  images: 4,
  /** por imagem (limite da API) */
  imageBytes: 5 * 1024 * 1024,
  pdfBytes: 10 * 1024 * 1024,
  audioBytes: 10 * 1024 * 1024,
  /** soma dos anexos de um pedido */
  totalBytes: 10 * 1024 * 1024,
  createItems: 40,
  installments: 72,
  /** voltas do agente numa mensagem (cada uma é uma chamada à IA) */
  agentSteps: 8,
  /** texto de um resultado de ferramenta */
  toolResult: 12000,
  /** blocos de uma volta (o que a IA respondeu), em JSON */
  stepBytes: 200 * 1024,
} as const

export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
