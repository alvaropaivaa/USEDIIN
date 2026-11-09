// Telefone e código de vínculo, sem rede.

/**
 * Formas do mesmo telefone: celular brasileiro chega com ou sem o 9 da frente
 * (55 + DDD + 9 dígitos, ou 55 + DDD + 8 dígitos, conforme a conta é antiga).
 * A primeira é a forma completa (com o 9), que é a gravada no vínculo.
 */
export function phoneVariants(phone: string) {
  const d = phone.replace(/\D/g, '')
  if (d.startsWith('55') && d.length === 13 && d[4] === '9') return [d, d.slice(0, 4) + d.slice(5)]
  // 8 dígitos começando em 6–9 é celular sem o 9; 2–5 é fixo (fica como está)
  if (d.startsWith('55') && d.length === 12 && /[6-9]/.test(d[4])) return [`${d.slice(0, 4)}9${d.slice(4)}`, d]
  return [d]
}

/** O mesmo telefone (com ou sem o 9 do celular)? */
export const samePhone = (a: string, b: string) => phoneVariants(a).includes(b.replace(/\D/g, ''))

/** Alfabeto dos códigos (public.whatsapp_code): sem 0/O, 1/I/L. */
const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/

/**
 * Códigos de vínculo possíveis na mensagem (o app manda "Meu código do Dinn: K7M2QX"; versões antigas, "do JurosPro").
 * Se a mensagem fala em "código", vale primeiro o que vem depois da palavra.
 */
export function codeCandidates(text: string | undefined) {
  if (!text) return []
  const upper = text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase()
  const tokens = upper.match(/[A-Z0-9]+/g) ?? []
  const valid = tokens.filter((t) => CODE.test(t))
  const after = /CODIGO[^A-Z0-9]*(?:DO\s+(?:DINN|JUROSPRO))?[^A-Z0-9]*([A-Z0-9]{6})\b/.exec(upper)?.[1]
  const ordered = after && CODE.test(after) ? [after, ...valid.filter((t) => t !== after)] : valid
  return [...new Set(ordered)].slice(0, 5)
}

/** A mensagem é um pedido de vínculo: a do app ("Meu código do Dinn: …"), uma frase curta com "código", ou só o código. */
export const looksLikeLink = (text: string | undefined) =>
  !!text && (/c[oó]digo do (dinn|jurospro)/i.test(text) || (/c[oó]digo/i.test(text) && text.length <= 60) || CODE.test(text.trim().toUpperCase()))

/** "desfazer", "desfaz", "cancela", "apaga" sozinhos: desfaz sem precisar da IA. */
export const isUndoCommand = (text: string | undefined) =>
  !!text &&
  /^(desfa(z|zer|ça)|cancela(r)?|apaga(r)?|exclui(r)?|remove(r)?)( (isso|esse|este|o [uú]ltimo|a [uú]ltima|tudo))?[.!]*$/i.test(
    text
      .trim()
      .normalize('NFC')
      .replace(/\s+/g, ' '),
  )

/** "(11) 98765-4321" a partir de 5511987654321, para as mensagens. */
export function formatPhone(phone: string) {
  const d = phone.replace(/\D/g, '')
  const local = d.startsWith('55') && (d.length === 12 || d.length === 13) ? d.slice(2) : d
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  return `+${d}`
}
