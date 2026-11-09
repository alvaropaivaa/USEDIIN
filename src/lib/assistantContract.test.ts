import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// O contrato do assistente vive no servidor (supabase/functions/_shared/assistente/types.ts);
// o app guarda uma cópia. Se um lado mudar sem o outro, o chat e o servidor deixam de se entender.
describe('contrato do assistente', () => {
  it('a cópia do app é igual à do servidor', () => {
    const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    expect(read('./assistantContract.ts')).toBe(read('../../supabase/functions/_shared/assistente/types.ts'))
  })
})
