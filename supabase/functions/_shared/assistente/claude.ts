// Cliente do Claude (SDK oficial) no formato que o cérebro usa. Só este arquivo importa o SDK:
// o resto roda nos testes com um cliente de mentira.

import Anthropic from 'npm:@anthropic-ai/sdk@0.132.1'
import type { ClaudeLike, requestParams } from './brain.ts'

type Params = ReturnType<typeof requestParams>

export function claudeClient(apiKey: string): ClaudeLike {
  // a função tem tempo limitado: uma nova tentativa no máximo
  const sdk = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 })
  return {
    beta: {
      messages: {
        // os parâmetros saem de requestParams (conferidos contra os tipos do SDK abaixo)
        create: (params) => sdk.beta.messages.create(params as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming),
      },
    },
  }
}

/** Conferência em tempo de compilação: o que requestParams monta é um pedido válido para o SDK. */
export const checkParams = (p: Params): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming => p
