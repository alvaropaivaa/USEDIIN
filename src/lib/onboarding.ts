// Perguntas feitas antes de criar a conta (como a pessoa cuida do dinheiro). As respostas vão para profiles.onboarding
// e aparecem no painel /admin. Guardamos o texto da opção, para ler direto no banco sem tabela de códigos.

export interface Question {
  id: string
  title: string
  hint: string
  options: string[]
  /** Aceita mais de uma resposta. */
  multi?: boolean
}

export const questions: Question[] = [
  {
    id: 'uso',
    title: 'Como você vai usar o Dinn?',
    hint: 'Dá para mudar o jeito de usar depois.',
    options: ['Só para mim', 'Com meu par', 'Com a família', 'Pessoal e do meu negócio'],
  },
  {
    id: 'objetivo',
    title: 'O que você quer conquistar?',
    hint: 'Pode marcar mais de um.',
    options: ['Saber para onde vai meu dinheiro', 'Sair das dívidas', 'Montar uma reserva de emergência', 'Juntar para um sonho', 'Gastar menos no cartão'],
    multi: true,
  },
  {
    id: 'renda',
    title: 'Qual a renda mensal da casa?',
    hint: 'Fica só entre você e o Dinn.',
    options: ['Até R$ 3 mil', 'De R$ 3 mil a R$ 7 mil', 'De R$ 7 mil a R$ 15 mil', 'Mais de R$ 15 mil'],
  },
  {
    id: 'dividas',
    title: 'Hoje você tem dívidas ou parcelas?',
    hint: 'Empréstimo, financiamento, cartão parcelado…',
    options: ['Não tenho', 'Tenho, mas sob controle', 'Estou no aperto', 'Também empresto dinheiro'],
  },
  {
    id: 'controle',
    title: 'Como você controla hoje?',
    hint: 'Sem julgamento, todo mundo começa de algum jeito.',
    options: ['Caderno', 'Planilha', 'Outro aplicativo', 'De cabeça'],
  },
  {
    id: 'cartoes',
    title: 'Quantos cartões de crédito você usa?',
    hint: 'Cada um ganha a própria fatura no app.',
    options: ['Nenhum', '1', '2 ou 3', '4 ou mais'],
  },
]

export type Answers = Record<string, string | string[]>

/** Rótulo curto de cada pergunta (painel do administrador), inclusive as do cadastro antigo. */
export const questionLabel: Record<string, string> = {
  uso: 'Vai usar',
  objetivo: 'Objetivo',
  renda: 'Renda da casa',
  dividas: 'Dívidas',
  controle: 'Controla hoje com',
  cartoes: 'Cartões de crédito',
  clientes: 'Clientes',
  carteira: 'Emprestado na rua',
  faturamento: 'Recebe por mês',
  modalidades: 'Trabalha com',
  equipe: 'Cobranças',
}

// as respostas ficam guardadas até a conta existir (e-mail a confirmar ou login pelo Google)
const KEY = 'jurospro-onboarding'

export const savePending = (data: { answers: Answers; phone: string }) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {}
}

export const loadPending = (): { answers: Answers; phone: string } | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null')
  } catch {
    return null
  }
}

export const clearPending = () => {
  try {
    localStorage.removeItem(KEY)
  } catch {}
}
