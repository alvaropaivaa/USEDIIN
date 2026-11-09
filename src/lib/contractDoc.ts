// Contrato + nota promissória em HTML imprimível ("Salvar como PDF" no diálogo de impressão),
// para o dinheiro que você emprestou (dívida a receber).
import { fmtDate, today } from './dates'
import { moneyRaw, percent } from './format'
import { debtCode, debtKindLabel, frequencyLabel, type Debt } from './loans'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Valor por extenso (reais), suficiente para notas promissórias. */
export function extenso(v: number): string {
  const u = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove']
  const d = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa']
  const c = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos']
  const tri = (n: number): string => {
    if (n === 100) return 'cem'
    const parts = []
    if (n >= 100) parts.push(c[Math.floor(n / 100)])
    const r = n % 100
    if (r >= 20) parts.push(d[Math.floor(r / 10)] + (r % 10 ? ` e ${u[r % 10]}` : ''))
    else if (r) parts.push(u[r])
    return parts.join(' e ')
  }
  const totalCents = Math.round(v * 100)
  const int = Math.floor(totalCents / 100)
  const cents = totalCents % 100
  const groups: string[] = []
  const mi = Math.floor(int / 1e6)
  const mil = Math.floor((int % 1e6) / 1000)
  const rest = int % 1000
  if (mi) groups.push(`${tri(mi)} ${mi === 1 ? 'milhão' : 'milhões'}`)
  if (mil) groups.push(mil === 1 ? 'mil' : `${tri(mil)} mil`)
  if (rest) groups.push(tri(rest))
  // "e" só liga o último grupo quando ele é menor que 100 ou centena redonda (mil e quinhentos / mil duzentos e dez)
  let out = groups[0] ?? ''
  for (let i = 1; i < groups.length; i++) {
    const last = i === groups.length - 1
    const value = last && rest ? rest : last ? mil * 1000 : 0
    const useE = last && (value < 100 || value % 100 === 0 || (!rest && !!mil))
    out += useE ? ` e ${groups[i]}` : last ? ` ${groups[i]}` : `, ${groups[i]}`
  }
  out = out ? `${out}${!rest && !mil && mi ? ' de' : ''} ${int === 1 ? 'real' : 'reais'}` : ''
  if (cents) out += `${out ? ' e ' : ''}${tri(cents)} ${cents === 1 ? 'centavo' : 'centavos'}`
  return out || 'zero reais'
}

export function printContract(contract: Debt, lender: { name: string; city: string }) {
  const client = { name: contract.person, phone: contract.phone ?? '' }
  const total = contract.schedule.reduce((s, x) => s + x.amount, 0)
  const rows = contract.schedule
    .map((s, i) => `<tr><td>${i + 1}/${contract.schedule.length}</td><td>${fmtDate(s.due)}</td><td class="r">${moneyRaw(s.amount)}</td></tr>`)
    .join('')
  const credor = esc(lender.name || '________________________')
  const cidade = esc(lender.city || '________________')
  const hoje = fmtDate(today())

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Contrato · ${esc(client.name)}</title>
<style>
  @page { size: A4; margin: 18mm }
  body { font: 13px/1.55 Inter, -apple-system, system-ui, sans-serif; color: #0f1512; margin: 0 }
  h1 { font-size: 20px; margin: 0 0 4px } h2 { font-size: 15px; margin: 28px 0 8px }
  .muted { color: #66706b } .r { text-align: right }
  .box { border: 1px solid #d9dedb; border-radius: 12px; padding: 14px 16px; margin-top: 14px }
  table { width: 100%; border-collapse: collapse; margin-top: 6px } td, th { padding: 6px 8px; border-bottom: 1px solid #eceeed; text-align: left }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #66706b }
  .sign { display: flex; gap: 40px; margin-top: 56px } .sign div { flex: 1; border-top: 1px solid #0f1512; padding-top: 6px; text-align: center }
  .np { page-break-before: always; border: 2px solid #0f1512; border-radius: 14px; padding: 22px 26px }
  .np h1 { display: flex; justify-content: space-between }
</style></head><body>
<h1>Contrato de ${esc(debtKindLabel[contract.kind].toLowerCase())}</h1>
<div class="muted">Emitido em ${hoje} · ${cidade}</div>
<div class="box">
  <b>Credor:</b> ${credor}<br>
  <b>Devedor:</b> ${esc(client.name)} · Tel. ${esc(client.phone || '—')} · Cód. #${debtCode(contract.id)}
</div>
<h2>Condições</h2>
<div class="box">
  Valor principal: <b>${moneyRaw(contract.principal)}</b> (${extenso(contract.principal)})<br>
  Juros: <b>${percent(contract.rate)} ao mês</b> (${contract.mode === 'simples' ? 'juros simples' : 'juros compostos — Tabela Price'})<br>
  Pagamento: <b>${contract.schedule.length} parcela(s) ${frequencyLabel[contract.frequency].toLowerCase()}(is)</b><br>
  Total a pagar: <b>${moneyRaw(total)}</b> (${extenso(total)})
</div>
<h2>Cronograma</h2>
<table><thead><tr><th>Parcela</th><th>Vencimento</th><th class="r">Valor</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Cláusulas</h2>
<ol>
  <li>O devedor reconhece a dívida acima e se compromete a pagá-la nas datas indicadas.</li>
  <li>O atraso no pagamento poderá gerar multa e juros de mora conforme combinado entre as partes.</li>
  <li>Pagamentos parciais serão abatidos das parcelas mais antigas.</li>
  <li>As partes elegem o foro da comarca de ${cidade} para dirimir eventuais dúvidas.</li>
</ol>
<div class="sign"><div>${credor}<br><span class="muted">Credor</span></div><div>${esc(client.name)}<br><span class="muted">Devedor</span></div></div>

<div class="np">
  <h1><span>NOTA PROMISSÓRIA</span><span>${moneyRaw(total)}</span></h1>
  <p>Vencimento final: <b>${fmtDate(contract.schedule.at(-1)!.due)}</b></p>
  <p>Ao(s) dia(s) do vencimento acima, pagarei por esta única via de NOTA PROMISSÓRIA a <b>${credor}</b>
  a quantia de <b>${extenso(total)}</b> (${moneyRaw(total)}), em moeda corrente deste país.</p>
  <p>Emitente: <b>${esc(client.name)}</b> · Tel. ${esc(client.phone || '—')}</p>
  <p>${cidade}, ${hoje}.</p>
  <div class="sign"><div>Assinatura do emitente</div></div>
</div>
<script>window.onload = () => setTimeout(() => window.print(), 300)</script>
</body></html>`

  const w = window.open('', '_blank')
  if (!w) return false
  w.document.write(html)
  w.document.close()
  return true
}
