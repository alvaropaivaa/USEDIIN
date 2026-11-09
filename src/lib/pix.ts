// Pix "copia e cola" estático (BR Code / EMV), conforme o Manual de Padrões do Bacen.

export type PixKeyType = 'cpf' | 'cnpj' | 'telefone' | 'email' | 'aleatoria'

export const pixKeyLabel: Record<PixKeyType, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  telefone: 'Celular',
  email: 'E-mail',
  aleatoria: 'Aleatória',
}

const tlv = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`

/** CRC16-CCITT (polinômio 0x1021, inicial 0xFFFF), exigido no campo 63. */
function crc16(payload: string) {
  let crc = 0xffff
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1
    crc &= 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** Nome e cidade só aceitam ASCII sem acento. */
const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .trim()
    .toUpperCase()

export function normalizePixKey(key: string, type: PixKeyType) {
  const k = key.trim()
  switch (type) {
    case 'cpf':
    case 'cnpj':
      return k.replace(/\D/g, '')
    case 'telefone': {
      const d = k.replace(/\D/g, '')
      return d.startsWith('55') && d.length > 11 ? `+${d}` : `+55${d}`
    }
    case 'email':
      return k.toLowerCase()
    case 'aleatoria':
      return k.toLowerCase()
  }
}

/** Pix copia e cola; vazio quando a chave está incompleta ou passa de 77 caracteres (o banco recusaria). */
export function pixPayload(opts: { key: string; type: PixKeyType; name: string; city: string; amount?: number; txid?: string }) {
  const key = normalizePixKey(opts.key, opts.type)
  // CPF tem 11 dígitos, CNPJ 14 e celular +55 com DDD (12 ou 13): menos que isso é chave incompleta
  const min = { cpf: 11, cnpj: 14, telefone: 12, email: 0, aleatoria: 0 }[opts.type]
  if (!key || key.length > 77 || key.replace(/\D/g, '').length < min) return ''
  const account = tlv('00', 'br.gov.bcb.pix') + tlv('01', key)
  const txid = (opts.txid ?? '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***'
  let p =
    tlv('00', '01') +
    tlv('26', account) +
    tlv('52', '0000') +
    tlv('53', '986') +
    (opts.amount && opts.amount > 0 ? tlv('54', opts.amount.toFixed(2)) : '') +
    tlv('58', 'BR') +
    tlv('59', plain(opts.name).slice(0, 25).trim() || 'RECEBEDOR') +
    tlv('60', plain(opts.city).slice(0, 15).trim() || 'SAO PAULO') +
    tlv('62', tlv('05', txid))
  p += '6304'
  return p + crc16(p)
}
