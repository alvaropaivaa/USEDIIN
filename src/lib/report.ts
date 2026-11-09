// Exportação dos relatórios: planilha CSV (abre no Excel) e PDF pelo diálogo de impressão.
// Arquivos exportados usam moneyRaw: o "esconder valores" vale só para a tela.

import { fmtDate, today } from './dates'
import { moneyRaw, percent } from './format'
import { isLate, rootOf, settled, type Account, type Card, type Category, type Transaction } from './ledger'

export interface ReportLookups {
  ref: string
  cats: Map<string, Category>
  accs: Map<string, Account>
  cardsIdx: Map<string, Card>
  /** Faturas quitadas (paidInvoices): compra no cartão só conta como paga com a fatura paga. */
  paid: Set<string>
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Só cores hexadecimais entram no CSS do PDF (a cor vem dos dados, que podem vir de um backup). */
const safeColor = (c: string) => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : '#94a3b8')

/**
 * Texto em célula de planilha: começar com = + - @ (ou tab/enter) faz o Excel tratar como fórmula
 * ("injeção de CSV"). Um apóstrofo na frente deixa como texto.
 */
const textCell = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v)

/** Situação em texto: pago, a pagar, atrasado, fatura paga… */
export function situation(t: Transaction, look: ReportLookups) {
  const ok = settled(t, look.paid)
  if (t.type === 'despesa' && t.cardId) return ok ? 'Fatura paga' : 'Fatura em aberto'
  if (ok) return t.type === 'receita' ? 'Recebido' : 'Pago'
  if (isLate(t, look.ref)) return 'Atrasado'
  return t.type === 'receita' ? 'A receber' : 'A pagar'
}

/** Categoria principal e subcategoria (nomes). */
function catNames(t: Transaction, look: ReportLookups) {
  const cat = look.cats.get(t.categoryId ?? '')
  const root = rootOf(t.categoryId, look.cats)
  if (!cat || !root) return { main: 'Sem categoria', sub: '' }
  return root.id === cat.id ? { main: cat.name, sub: '' } : { main: root.name, sub: cat.name }
}

const whereOf = (t: Transaction, look: ReportLookups) => (t.cardId ? `Cartão ${look.cardsIdx.get(t.cardId)?.name ?? ''}`.trim() : (look.accs.get(t.accountId ?? '')?.name ?? ''))

/** Fatura "mm/aaaa" de uma compra no cartão. */
const invoiceText = (t: Transaction) => (t.cardId && t.invoice ? `${t.invoice.slice(5, 7)}/${t.invoice.slice(0, 4)}` : '')

const decimal = (v: number) => v.toFixed(2).replace('.', ',')

/** Baixa um arquivo gerado no navegador. */
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  // o Firefox só baixa pelo link se ele estiver no documento
  const a = Object.assign(document.createElement('a'), { href: url, download: filename, hidden: true })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Planilha: separador ";" e vírgula decimal (padrão do Excel em português), despesas negativas. */
export function exportCsv(rows: Transaction[], look: ReportLookups, filename: string) {
  const head = ['Data', 'Tipo', 'Descrição', 'Categoria', 'Subcategoria', 'Conta ou cartão', 'Fatura', 'Situação', 'Valor', 'Tags', 'Observação']
  const lines = rows.map((t) => {
    const { main, sub } = catNames(t, look)
    return [
      fmtDate(t.date),
      t.type === 'receita' ? 'Receita' : 'Despesa',
      textCell(t.description + (t.installment ? ` (${t.installment.n}/${t.installment.count})` : '')),
      textCell(main),
      textCell(sub),
      textCell(whereOf(t, look)),
      invoiceText(t),
      situation(t, look),
      // número de verdade (o sinal negativo é da despesa, não fórmula)
      decimal(t.type === 'despesa' ? -t.amount : t.amount),
      textCell((t.tags ?? []).join(', ')),
      textCell(t.note ?? ''),
    ]
  })
  const csv = [head, ...lines].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n')
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), filename)
}

export interface PdfData {
  /** "Outubro de 2026" ou "01/08/2026 a 31/10/2026". */
  period: string
  /** Filtros aplicados, em texto. */
  filters: string[]
  kpis: { label: string; value: number; kind?: 'money' | 'percent'; tone?: 'green' | 'red' }[]
  categoriesTitle: string
  categories: { name: string; value: number; ratio: number; color: string }[]
  rows: Transaction[]
  look: ReportLookups
}

/** Relatório em HTML imprimível ("Salvar como PDF" no diálogo de impressão). Retorna false se o pop-up foi bloqueado. */
export function exportPdf(d: PdfData) {
  const kpi = d.kpis
    .map(
      (k) =>
        `<div class="kpi"><span>${esc(k.label)}</span><b class="${k.tone ?? ''}">${esc(k.kind === 'percent' ? (isFinite(k.value) ? percent(k.value) : '—') : moneyRaw(k.value))}</b></div>`,
    )
    .join('')
  const cats = d.categories
    .map(
      (c) =>
        `<tr><td><i style="background:${safeColor(c.color)}"></i>${esc(c.name)}</td><td class="r">${moneyRaw(c.value)}</td><td class="r">${percent(c.ratio)}</td><td class="bar"><span style="width:${Math.min(100, Math.max(1, Math.round(c.ratio * 100)))}%;background:${safeColor(c.color)}"></span></td></tr>`,
    )
    .join('')
  const rows = d.rows
    .map((t) => {
      const { main, sub } = catNames(t, d.look)
      const value = t.type === 'despesa' ? `− ${moneyRaw(t.amount)}` : `+ ${moneyRaw(t.amount)}`
      const desc = t.description + (t.installment ? ` (${t.installment.n}/${t.installment.count})` : '')
      return `<tr><td>${fmtDate(t.date)}</td><td>${esc(desc)}</td><td>${esc(sub ? `${main} › ${sub}` : main)}</td><td>${esc(whereOf(t, d.look))}</td><td>${esc(situation(t, d.look))}</td><td class="r ${t.type === 'receita' ? 'green' : 'red'}">${value}</td></tr>`
    })
    .join('')

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório financeiro · ${esc(d.period)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Inter, -apple-system, system-ui, sans-serif; color: #0f1512; font-size: 11.5px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  header { background: #0f3b2c; color: #fff; padding: 18px 22px; border-radius: 14px; }
  header small { color: rgba(255,255,255,.65); font-weight: 600; letter-spacing: .14em; text-transform: uppercase; font-size: 10px; }
  header h1 { margin: 4px 0 2px; font-size: 22px; letter-spacing: -.02em; }
  header p { margin: 0; color: rgba(255,255,255,.75); }
  .filters { margin: 10px 2px 0; color: #66706b; }
  .kpis { display: grid; grid-template-columns: repeat(${d.kpis.length}, 1fr); gap: 8px; margin: 16px 0; }
  .kpi { border: 1px solid #e5e8e6; border-radius: 12px; padding: 10px 12px; }
  .kpi span { display: block; color: #66706b; font-size: 10.5px; }
  .kpi b { display: block; font-size: 15px; margin-top: 2px; }
  h2 { font-size: 13px; margin: 18px 2px 8px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { text-align: left; color: #66706b; font-weight: 600; font-size: 10.5px; border-bottom: 1px solid #d9dedb; padding: 6px; }
  td { padding: 5px 6px; border-bottom: 1px solid #eef0ef; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .r { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .green { color: #15803d; } .red { color: #dc2626; }
  td i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .bar { width: 28%; } .bar span { display: block; height: 6px; border-radius: 3px; }
  footer { margin-top: 18px; color: #a3aab3; font-size: 10px; text-align: center; }
</style></head><body>
<header><small>Dinn · Finanças pessoais</small><h1>Relatório financeiro</h1><p>${esc(d.period)}</p></header>
${d.filters.length ? `<p class="filters">Filtros: ${esc(d.filters.join(' · '))}</p>` : ''}
<div class="kpis">${kpi}</div>
${cats ? `<h2>${esc(d.categoriesTitle)}</h2><table><thead><tr><th>Categoria</th><th class="r">Valor</th><th class="r">%</th><th></th></tr></thead><tbody>${cats}</tbody></table>` : ''}
<h2>Extrato · ${d.rows.length} ${d.rows.length === 1 ? 'lançamento' : 'lançamentos'}</h2>
${rows ? `<table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Conta ou cartão</th><th>Situação</th><th class="r">Valor</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="filters">Nenhum lançamento no período.</p>'}
<footer>Gerado pelo Dinn em ${fmtDate(today())}</footer>
<script>window.onload = () => setTimeout(() => window.print(), 300)</script>
</body></html>`

  const w = window.open('', '_blank')
  if (!w) return false
  // a janela nova não precisa mexer no app
  w.opener = null
  w.document.write(html)
  w.document.close()
  return true
}
