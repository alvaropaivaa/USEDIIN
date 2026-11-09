// Atualiza os bancos do app a partir do pacote logos-bancos-br (lista do Banco Central + logos do Open Finance):
// - logos dos bancos populares em src/assets/bancos (vão no pacote do app e funcionam offline);
// - logos dos demais em public/logos-bancos (baixadas só quando aparecem) e o índice em src/lib/bancos-logos.json;
// - lista compacta de todas as instituições em src/lib/bancos.json e os populares em src/lib/bancos-populares.json;
// - o aviso de marcas do pacote junto das logos.
//
// Uso (numa pasta temporária, fora do projeto):
//   npm pack logos-bancos-br && tar -xzf logos-bancos-br-*.tgz
//   node <projeto>/scripts/bancos.mjs ./package <projeto>
// Cores e modelos de cartão dos populares ficam em src/lib/banks.ts (por ISPB).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const [, , PKG, ROOT] = process.argv
if (!PKG || !ROOT) throw new Error('Uso: node scripts/bancos.mjs <pasta-do-pacote> <pasta-do-projeto>')
const { banks } = JSON.parse(readFileSync(join(PKG, 'data/bancos.json'), 'utf8'))

// bancos em destaque no seletor, na ordem em que aparecem (código COMPE)
const POPULAR = ['260', '341', '237', '001', '104', '033', '077', '336', '380', '323', '290', '208', '102', '536', '623', '756', '748', '041', '422', '212', '318', '121', '197', '542', '403', '769', '070', '004', '389', '021', '637', '655', '707']

const nice = (b) => (b.displayName || b.name || b.shortName || '').trim()
const ext = (b) => (b.logo?.svg ? 'svg' : b.logo?.png ? 'png' : null)

const bundled = join(ROOT, 'src/assets/bancos')
const lazy = join(ROOT, 'public/logos-bancos')
for (const d of [bundled, lazy]) {
  if (existsSync(d)) rmSync(d, { recursive: true })
  mkdirSync(d, { recursive: true })
}

const popular = []
for (const compe of POPULAR) {
  const b = banks.find((x) => x.compe === compe)
  if (!b) throw new Error(`COMPE ${compe} não encontrado`)
  const e = ext(b)
  if (e) copyFileSync(join(PKG, b.logo[e]), join(bundled, `${b.ispb}.${e}`))
  popular.push({ compe, ispb: b.ispb, name: nice(b), logo: e })
}

const popularIspb = new Set(popular.map((p) => p.ispb))
const lazyIndex = {}
const list = banks
  .filter((b) => b.ispb && nice(b))
  .map((b) => {
    const e = ext(b)
    if (e && !popularIspb.has(b.ispb)) {
      copyFileSync(join(PKG, b.logo[e]), join(lazy, `${b.ispb}.${e}`))
      lazyIndex[b.ispb] = e
    }
    return { i: b.ispb, c: b.compe || undefined, n: nice(b), ...(e ? { l: e } : {}) }
  })
  .sort((a, b) => a.n.localeCompare(b.n, 'pt-BR'))

writeFileSync(join(ROOT, 'src/lib/bancos.json'), JSON.stringify(list))
writeFileSync(join(ROOT, 'src/lib/bancos-logos.json'), JSON.stringify(lazyIndex))
writeFileSync(join(ROOT, 'src/lib/bancos-populares.json'), JSON.stringify(popular, null, 1))
const notice = `Logos das instituições financeiras: pacote "logos-bancos-br" (https://github.com/rzmt/logos-bancos-br),
que reúne a arte publicada pelas próprias instituições no diretório do Open Finance Brasil (Banco Central).

As logos são marcas registradas das respectivas instituições, não são licenciadas pelo Dinn nem pelo pacote,
e aparecem só para identificar o banco de cada conta e cartão da pessoa (uso nominativo).
Nenhuma afiliação, patrocínio ou endosso é sugerido.

${readFileSync(join(PKG, 'DISCLAIMER.md'), 'utf8')}`
writeFileSync(join(bundled, 'AVISO.txt'), notice)
writeFileSync(join(lazy, 'AVISO.txt'), notice)
console.log(`populares: ${popular.length} (${popular.filter((p) => p.logo).length} com logo) · todas: ${list.length} (${list.filter((b) => b.l).length} com logo, ${Object.keys(lazyIndex).length} sob demanda)`)
