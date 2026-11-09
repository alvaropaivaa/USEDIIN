import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { codeCandidates, formatPhone, isUndoCommand, looksLikeLink, phoneVariants, samePhone } from './link.ts'
import { lureSignature, metaSignatureOk, parseLure, parseMeta, phoneFromJid } from './providers.ts'

// exemplo da documentação da Lure API (webhookReceived), o mesmo dos testes do CheckZap
const recebida = {
  event: 'webhookReceived',
  instanceId: '46d91a14-2275-4c1e-9d55-0d3f8a3b7c11',
  connectedPhone: '5511888888888',
  isGroup: false,
  messageId: '3A8317DB58329E0FF357',
  fromMe: false,
  chat: { id: '5511999999999' },
  sender: { id: '5511999999999', senderLid: '1417@lid', pushName: 'Fulano' },
  moment: 1769084192,
  msgContent: { conversation: 'Oi, tudo bem?' } as Record<string, unknown>,
}

describe('webhook da Lure API', () => {
  it('lê o texto (simples e estendido)', () => {
    expect(parseLure(recebida)).toEqual({ msgId: '3A8317DB58329E0FF357', from: '5511999999999', name: 'Fulano', kind: 'texto', text: 'Oi, tudo bem?' })
    expect(parseLure({ ...recebida, msgContent: { extendedTextMessage: { text: 'mercado 50' } } })?.text).toBe('mercado 50')
    expect(parseLure({ ...recebida, msgContent: { buttonsResponseMessage: { selectedDisplayText: 'Sim' } } })?.text).toBe('Sim')
  })

  it('ignora eco, grupo, histórico, outros eventos e remetente sem telefone', () => {
    expect(parseLure({ ...recebida, fromMe: true })).toBeNull()
    expect(parseLure({ ...recebida, isGroup: true })).toBeNull()
    expect(parseLure({ ...recebida, historical: true })).toBeNull()
    expect(parseLure({ ...recebida, event: 'webhookDelivery' })).toBeNull()
    expect(parseLure({ ...recebida, event: 'webhookConnected' })).toBeNull()
    expect(parseLure({ ...recebida, chat: { id: '120363@g.us' } })).toBeNull()
    expect(parseLure({ ...recebida, sender: { id: '1417@lid' }, chat: { id: '1417@lid' } })).toBeNull()
    expect(parseLure({ ...recebida, messageId: undefined })).toBeNull()
    expect(parseLure('lixo')).toBeNull()
  })

  it('conversa pelo LID usa o telefone que vier em outro campo', () => {
    expect(parseLure({ ...recebida, sender: { id: '1417@lid', senderPn: '5511977776666@s.whatsapp.net' }, chat: { id: '1417@lid' } })?.from).toBe('5511977776666')
  })

  it('foto, áudio e PDF vêm com o que o download-media pede', () => {
    const foto = parseLure({ ...recebida, msgContent: { imageMessage: { mediaKey: 'k', directPath: '/v/t62', mimetype: 'image/jpeg', caption: 'almoço' } } })
    expect(foto).toMatchObject({ kind: 'imagem', caption: 'almoço', media: { provider: 'lure', mediaKey: 'k', directPath: '/v/t62', mimetype: 'image/jpeg', type: 'image' } })
    const audio = parseLure({ ...recebida, msgContent: { audioMessage: { mediaKey: 'k', directPath: '/a', mimetype: 'audio/ogg; codecs=opus', seconds: 12 } } })
    expect(audio).toMatchObject({ kind: 'audio', media: { type: 'audio', mimetype: 'audio/ogg; codecs=opus' } })
    const pdf = parseLure({
      ...recebida,
      msgContent: { documentWithCaptionMessage: { message: { documentMessage: { mediaKey: 'k', directPath: '/d', mimetype: 'application/pdf', fileName: 'extrato.pdf', caption: 'outubro' } } } },
    })
    expect(pdf).toMatchObject({ kind: 'documento', fileName: 'extrato.pdf', caption: 'outubro', media: { type: 'document', mimetype: 'application/pdf' } })
    // mensagem temporária: o conteúdo vem embrulhado
    expect(parseLure({ ...recebida, msgContent: { ephemeralMessage: { message: { conversation: 'uber 20' } } } })?.text).toBe('uber 20')
    // sem as chaves não dá para baixar
    const semChave = parseLure({ ...recebida, msgContent: { imageMessage: { caption: 'sem chave' } } })
    expect(semChave?.kind).toBe('imagem')
    expect(semChave?.media).toBeUndefined()
    expect(parseLure({ ...recebida, msgContent: { stickerMessage: { mediaKey: 'k', directPath: '/s' } } })?.kind).toBe('outro')
  })

  it('assinatura da URL igual à do CheckZap (HMAC do instanceId)', async () => {
    const id = recebida.instanceId
    const esperada = createHmac('sha256', 'segredo').update(`lure-webhook:${id}`).digest('base64url').slice(0, 32)
    expect(await lureSignature('segredo', id)).toBe(esperada)
    expect(await lureSignature('outro', id)).not.toBe(esperada)
  })
})

describe('webhook da Meta', () => {
  const corpo = (messages: unknown[], phone = '111') => ({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: { metadata: { phone_number_id: phone }, contacts: [{ wa_id: '5511987654321', profile: { name: 'Ana' } }], messages } }] }],
  })

  it('texto, foto, áudio, documento e toque em botão', () => {
    const msgs = parseMeta(
      corpo([
        { id: 'w1', from: '5511987654321', type: 'text', text: { body: 'mercado 120' } },
        { id: 'w2', from: '5511987654321', type: 'image', image: { id: 'm1', caption: 'nota', mime_type: 'image/jpeg' } },
        { id: 'w3', from: '5511987654321', type: 'audio', audio: { id: 'm2', mime_type: 'audio/ogg; codecs=opus', voice: true } },
        { id: 'w4', from: '5511987654321', type: 'document', document: { id: 'm3', filename: 'fatura.pdf', mime_type: 'application/pdf' } },
        { id: 'w5', from: '5511987654321', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'x', title: 'Desfazer' } } },
        { id: 'w6', from: '5511987654321', type: 'sticker', sticker: { id: 'm4' } },
      ]),
      '111',
    )
    expect(msgs.map((m) => [m.msgId, m.kind, m.name])).toEqual([
      ['w1', 'texto', 'Ana'],
      ['w2', 'imagem', 'Ana'],
      ['w3', 'audio', 'Ana'],
      ['w4', 'documento', 'Ana'],
      ['w5', 'texto', 'Ana'],
      ['w6', 'outro', 'Ana'],
    ])
    expect(msgs[0].text).toBe('mercado 120')
    expect(msgs[1]).toMatchObject({ caption: 'nota', media: { provider: 'meta', id: 'm1' } })
    expect(msgs[3]).toMatchObject({ fileName: 'fatura.pdf', media: { id: 'm3', mimetype: 'application/pdf' } })
    expect(msgs[4].text).toBe('Desfazer')
  })

  it('status de entrega, outro número e objeto estranho não viram mensagem', () => {
    expect(parseMeta({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: '111' }, statuses: [{ id: 'x', status: 'read' }] } }] }] })).toEqual([])
    expect(parseMeta(corpo([{ id: 'w1', from: '5511987654321', type: 'text', text: { body: 'oi' } }], '222'), '111')).toEqual([])
    expect(parseMeta({ object: 'page' })).toEqual([])
  })

  it('confere o X-Hub-Signature-256', async () => {
    const raw = new TextEncoder().encode('{"object":"whatsapp_business_account"}')
    const sig = `sha256=${createHmac('sha256', 'app-secret').update(raw).digest('hex')}`
    expect(await metaSignatureOk('app-secret', raw, sig)).toBe(true)
    expect(await metaSignatureOk('outro', raw, sig)).toBe(false)
    expect(await metaSignatureOk('app-secret', raw, null)).toBe(false)
    expect(await metaSignatureOk('app-secret', raw, 'sha256=00')).toBe(false)
  })
})

describe('telefone e código', () => {
  it('celular com e sem o 9 é o mesmo número', () => {
    expect(phoneVariants('5511987654321')).toEqual(['5511987654321', '551187654321'])
    expect(phoneVariants('551187654321')).toEqual(['5511987654321', '551187654321'])
    expect(samePhone('+55 (11) 98765-4321', '551187654321')).toBe(true)
    // fixo (começa com 2 a 5) e número de fora ficam como estão
    expect(phoneVariants('551132654321')).toEqual(['551132654321'])
    expect(phoneVariants('14155552671')).toEqual(['14155552671'])
    expect(phoneFromJid('5511987654321:12@s.whatsapp.net')).toBe('5511987654321')
    expect(phoneFromJid('1417@lid')).toBe('')
    expect(formatPhone('5511987654321')).toBe('(11) 98765-4321')
  })

  it('acha o código na mensagem do app (sem 0, O, 1, I, L)', () => {
    expect(codeCandidates('Meu código do Dinn: K7M2QX')[0]).toBe('K7M2QX')
    expect(codeCandidates('meu codigo do dinn: k7m2qx')[0]).toBe('K7M2QX')
    // mensagem das versões com o nome antigo
    expect(codeCandidates('Meu código do JurosPro: K7M2QX')[0]).toBe('K7M2QX')
    expect(codeCandidates('meu codigo do jurospro: k7m2qx')[0]).toBe('K7M2QX')
    expect(codeCandidates('K7M2QX')).toEqual(['K7M2QX'])
    expect(codeCandidates('Meu código do Dinn: ABC123')).not.toContain('ABC123')
    expect(codeCandidates('Meu código do JurosPro: ABC123')).not.toContain('ABC123')
    // palavra de 6 letras do alfabeto vira candidata, mas só vale se existir como código no banco
    expect(codeCandidates('mercado 230 no nubank')).toEqual(['NUBANK'])
    expect(codeCandidates('almoço 35 no débito')).toEqual([])
    expect(codeCandidates(undefined)).toEqual([])
    expect(looksLikeLink('Meu código do Dinn: K7M2QX')).toBe(true)
    expect(looksLikeLink('Meu código do JurosPro: K7M2QX')).toBe(true)
    expect(looksLikeLink('k7m2qx')).toBe(true)
    expect(looksLikeLink('paguei 50 de mercado')).toBe(false)
  })

  it('"desfazer" sozinho é comando; frase com mais coisa vai para a IA', () => {
    for (const t of ['desfazer', 'Desfaz', 'desfaça', 'cancela', 'apaga isso', 'desfazer o último', 'Desfazer!']) expect(isUndoCommand(t)).toBe(true)
    for (const t of ['desfazer o mercado e lançar 50', 'apaga o uber de ontem', 'mercado 50', undefined]) expect(isUndoCommand(t)).toBe(false)
  })
})
