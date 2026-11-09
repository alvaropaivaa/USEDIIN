// Textos das mensagens do assistente: dinheiro, datas e as respostas fixas.

import { diffDays } from './ledger.ts'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** R$ 1.234,56 (espaço comum: o Intl usa o não separável). */
export const money = (v: number) => brl.format(Math.round(v * 100) / 100).replace(/ /g, ' ')

export const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']

/** "outubro de 2026" */
export const monthName = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} de ${key.slice(0, 4)}`
/** "nov/2026" (fatura) */
export const shortMonth = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1].slice(0, 3)}/${key.slice(0, 4)}`

export const weekdayName = (n: number) => WEEKDAYS[n]

/** "hoje", "ontem", "amanhã" ou "dd/mm". */
export function relDay(iso: string, today: string) {
  const d = diffDays(iso, today)
  if (d === 0) return 'hoje'
  if (d === -1) return 'ontem'
  if (d === 1) return 'amanhã'
  return iso.slice(0, 4) === today.slice(0, 4) ? ddmm(iso) : `${ddmm(iso)}/${iso.slice(0, 4)}`
}

export const UNDO_HINT = 'Errou? Responda "desfazer".'

export const texts = {
  welcome: (name: string) =>
    [
      `Pronto${name ? `, ${name}` : ''}! Seu WhatsApp está ligado ao Dinn.`,
      '',
      'É só me mandar o que gastou ou recebeu, do jeito que falaria:',
      '- "mercado 230 no nubank"',
      '- um áudio: "paguei 80 de luz ontem"',
      '- print de comprovante, nota fiscal ou extrato',
      '',
      'Também respondo perguntas como "quanto gastei este mês?" ou "quanto está a fatura do cartão?".',
    ].join('\n'),
  notLinked: (appUrl?: string) =>
    [
      'Oi! Este é o número do assistente do Dinn.',
      'Para usar, ligue seu WhatsApp à sua conta: no app, abra Configurações > WhatsApp e toque em Conectar.',
      ...(appUrl ? [appUrl] : []),
    ].join('\n'),
  alreadyLinked: 'Este WhatsApp já está ligado ao Dinn. É só mandar seus gastos e receitas por aqui.',
  expiredCode: 'Esse código venceu ou já foi usado. No app, abra Configurações > WhatsApp e toque em Conectar para gerar outro.',
  noAccess: 'Seu acesso ao Dinn venceu, então não lancei nada. Renove o plano no app para voltar a usar o assistente.',
  noTranscription: 'Ainda não consigo ouvir áudios por aqui. Pode escrever?',
  badAudio: 'Não consegui entender o áudio. Pode mandar de novo ou escrever?',
  badMedia: 'Não consegui abrir esse arquivo. Pode mandar de novo, ou escrever o que precisa lançar?',
  tooBig: 'Esse arquivo é grande demais para mim. Mande um print ou um PDF menor.',
  unsupported: 'Por aqui eu entendo texto, áudio, foto ou PDF.',
  unsupportedFile: 'Desse tipo de arquivo eu não consigo ler. Mande um print (foto) ou um PDF.',
  failed: 'Tive um problema para entender agora. Tenta de novo em instantes?',
  refused: 'Não consegui tratar essa mensagem. Pode escrever de outro jeito?',
  nothing: 'Não achei nada para lançar nessa mensagem. Me diga o valor e o que foi, por exemplo: "almoço 35 no débito".',
  nothingToUndo: 'Não achei nada recente lançado por aqui para desfazer.',
}
