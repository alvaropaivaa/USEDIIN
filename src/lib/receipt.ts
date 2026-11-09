// Recibo de pagamento (dívida a receber) desenhado em canvas (PNG), pronto para compartilhar no WhatsApp.
import { fmtDate } from './dates'
import { moneyRaw } from './format'

export interface ReceiptData {
  /** Quem recebeu (nome do perfil). */
  owner: string
  /** Quem pagou. */
  person: string
  /** Código da dívida (#12345). */
  code: string
  amount: number
  fee: number
  date: string
  installment: string
  paidTotal: number
  open: number
  kind: string
}

const W = 720
const H = 980

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/** Corta o texto com reticências para caber em `max` pixels (nomes longos não invadem o rótulo). */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

export async function renderReceipt(d: ReceiptData): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  await document.fonts?.ready
  const font = (w: number, s: number) => `${w} ${s}px Inter, -apple-system, system-ui, sans-serif`

  // fundo
  ctx.fillStyle = '#f6f7f6'
  ctx.fillRect(0, 0, W, H)

  // faixa verde superior
  const grad = ctx.createLinearGradient(0, 0, 0, 300)
  grad.addColorStop(0, '#11402f')
  grad.addColorStop(1, '#0c3326')
  ctx.fillStyle = grad
  roundRect(ctx, 0, -40, W, 340, 48)
  ctx.fill()

  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.font = font(500, 24)
  ctx.fillText('Recibo de pagamento', 56, 92)
  ctx.fillStyle = '#ffffff'
  ctx.font = font(600, 30)
  ctx.fillText(fit(ctx, d.owner || 'Dinn', W - 56 - 170), 56, 136)

  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.font = font(500, 22)
  ctx.fillText('Valor recebido', 56, 208)
  ctx.fillStyle = '#ffffff'
  ctx.font = font(600, 64)
  ctx.fillText(moneyRaw(d.amount + d.fee), 56, 272)

  // selo de confirmação
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.beginPath()
  ctx.arc(W - 96, 112, 44, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 6
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(W - 116, 112)
  ctx.lineTo(W - 100, 128)
  ctx.lineTo(W - 74, 98)
  ctx.stroke()

  // cartão de detalhes
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(15,21,18,0.08)'
  ctx.shadowBlur = 24
  roundRect(ctx, 40, 340, W - 80, 520, 32)
  ctx.fill()
  ctx.shadowBlur = 0

  const rows: [string, string][] = [
    ['Recebido de', d.person],
    ['Código', d.code],
    ['Referente a', `${d.kind} · parcela ${d.installment}`],
    ['Data do pagamento', fmtDate(d.date)],
    ...(d.fee > 0 ? ([['Parcela', moneyRaw(d.amount)], ['Multa e juros', moneyRaw(d.fee)]] as [string, string][]) : []),
    ['Total já pago', moneyRaw(d.paidTotal)],
    ['Saldo restante', d.open > 0.004 ? moneyRaw(d.open) : 'Quitado ✓'],
  ]
  let y = 410
  const rowH = (520 - 60) / rows.length
  rows.forEach(([k, v], i) => {
    ctx.fillStyle = '#66706b'
    ctx.font = font(500, 23)
    ctx.fillText(k, 80, y)
    const labelW = ctx.measureText(k).width
    ctx.fillStyle = i === rows.length - 1 ? '#166534' : '#0f1512'
    ctx.font = font(600, 25)
    const text = fit(ctx, v, W - 160 - labelW - 24)
    const tw = ctx.measureText(text).width
    ctx.fillText(text, W - 80 - tw, y)
    if (i < rows.length - 1) {
      ctx.fillStyle = 'rgba(15,21,18,0.07)'
      ctx.fillRect(80, y + rowH / 2 - 6, W - 160, 2)
    }
    y += rowH
  })

  ctx.fillStyle = '#a3aab3'
  ctx.font = font(500, 20)
  const foot = `Gerado pelo Dinn em ${new Date().toLocaleString('pt-BR')}`
  ctx.fillText(foot, (W - ctx.measureText(foot).width) / 2, H - 56)

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('recibo'))), 'image/png'))
}

/** Compartilha (celular) ou baixa (computador) o recibo. Retorna 'shared' | 'downloaded' | 'cancelled'. */
export async function shareReceipt(d: ReceiptData) {
  const blob = await renderReceipt(d)
  // nome do arquivo só com letras e números (o nome da pessoa pode ter acento, barra, emoji…)
  const who = (d.person.split(' ')[0] || 'pagamento').normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'pagamento'
  const file = new File([blob], `recibo-${who}-${d.date}.png`, { type: 'image/png' })
  const text = `Recibo: ${moneyRaw(d.amount + d.fee)} recebido de ${d.person} em ${fmtDate(d.date)}.`
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text })
      return 'shared'
    } catch (e) {
      // fechou a folha de compartilhar; qualquer outro erro cai no download abaixo
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled'
    }
  }
  const url = URL.createObjectURL(blob)
  Object.assign(document.createElement('a'), { href: url, download: file.name }).click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return 'downloaded'
}
