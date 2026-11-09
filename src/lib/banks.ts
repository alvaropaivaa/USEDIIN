// Bancos: a lista oficial do Banco Central (460 instituições) e as logos que cada uma publica no
// Open Finance (pacote logos-bancos-br; aviso de marcas em assets/bancos/AVISO.txt).
// As logos aparecem só para identificar o banco de cada conta e cartão (uso nominativo).
//
// - Populares: logo dentro do app (offline) e cores/modelos de cartão parecidos com os reais.
// - Demais: logo baixada quando aparece (public/logos-bancos); lista completa carregada sob demanda.

import { useEffect, useState } from 'react'
import popularList from './bancos-populares.json'
import lazyLogos from './bancos-logos.json'

export interface BankInfo {
  /** ISPB: código único da instituição no Banco Central (é o que fica gravado). */
  ispb: string
  /** Código COMPE (o "número do banco"), quando existe. */
  compe?: string
  name: string
}

/** Modelo visual de um cartão. */
export interface CardSkin {
  id: string
  name: string
  /** Fundo do plástico (CSS). */
  bg: string
  /** Texto e marcas claros (cartão escuro) ou escuros (cartão claro). */
  ink: 'light' | 'dark'
  /** Logo do banco em branco (cartões coloridos/escuros) ou nas cores originais. */
  logo: 'white' | 'color'
  /** Acabamento: fibra de carbono ou metal escovado. */
  finish?: 'carbon' | 'metal'
}

interface Brand {
  /** Cor principal da marca (conta, gráficos). */
  color: string
  skins: CardSkin[]
}

const g = (a: string, b: string, c: string) => `linear-gradient(135deg, ${a} 0%, ${b} 52%, ${c} 100%)`
const black = (name: string, finish: CardSkin['finish'] = 'metal'): CardSkin => ({ id: 'black', name, bg: g('#2b2c30', '#141518', '#060607'), ink: 'light', logo: 'white', finish })

/** Cores e cartões dos bancos populares (por ISPB). */
const brands: Record<string, Brand> = {
  '18236120': {
    color: '#820AD1',
    skins: [
      { id: 'roxinho', name: 'Nubank', bg: g('#9c1fe8', '#820ad1', '#6407a8'), ink: 'light', logo: 'white' },
      { id: 'ultravioleta', name: 'Ultravioleta', bg: g('#2a1240', '#120819', '#040206'), ink: 'light', logo: 'white', finish: 'metal' },
    ],
  },
  '60701190': {
    color: '#EC7000',
    skins: [
      { id: 'click', name: 'Itaú Click', bg: g('#ff8a1f', '#ec7000', '#c45800'), ink: 'light', logo: 'white' },
      { id: 'uniclass', name: 'Uniclass', bg: g('#2457c7', '#0b3a9a', '#06286c'), ink: 'light', logo: 'white' },
      black('Personnalité'),
    ],
  },
  '60746948': {
    color: '#CC092F',
    skins: [{ id: 'classico', name: 'Bradesco', bg: g('#e3163d', '#cc092f', '#9a0021'), ink: 'light', logo: 'white' }, black('Visa Infinite')],
  },
  '00000000': {
    color: '#0038A8',
    skins: [
      { id: 'ourocard', name: 'Ourocard', bg: g('#1c50c8', '#0038a8', '#00267a'), ink: 'light', logo: 'color' },
      { id: 'amarelo', name: 'Ourocard Amarelo', bg: g('#fff36a', '#fcf000', '#e8cf00'), ink: 'dark', logo: 'color' },
      black('Ourocard Estilo'),
    ],
  },
  '00360305': { color: '#005CA9', skins: [{ id: 'caixa', name: 'Caixa', bg: g('#1a75c4', '#005ca9', '#00427d'), ink: 'light', logo: 'white' }, black('Caixa Infinite')] },
  '90400888': { color: '#EC0000', skins: [{ id: 'santander', name: 'Santander', bg: g('#ff2a2a', '#ec0000', '#b30000'), ink: 'light', logo: 'white' }, black('Unlimited')] },
  '00416968': { color: '#FF7A00', skins: [{ id: 'gold', name: 'Inter Gold', bg: g('#ff9333', '#ff7a00', '#e05f00'), ink: 'light', logo: 'white' }, black('Inter Black')] },
  '31872495': {
    color: '#242424',
    skins: [
      { id: 'c6', name: 'C6 Bank', bg: g('#3a3a3c', '#242424', '#121212'), ink: 'light', logo: 'white' },
      { id: 'carbon', name: 'C6 Carbon', bg: g('#1c1c1e', '#0d0d0e', '#000000'), ink: 'light', logo: 'white', finish: 'carbon' },
    ],
  },
  '22896431': { color: '#21C25E', skins: [{ id: 'picpay', name: 'PicPay', bg: g('#3bd273', '#21c25e', '#139a45'), ink: 'light', logo: 'white' }] },
  '10573521': { color: '#00A3E0', skins: [{ id: 'mp', name: 'Mercado Pago', bg: g('#2bb8f0', '#00a3e0', '#0077b6'), ink: 'light', logo: 'white' }] },
  '08561701': { color: '#1A1A1A', skins: [{ id: 'pagbank', name: 'PagBank', bg: g('#ffd84d', '#ffc800', '#e6a800'), ink: 'dark', logo: 'color' }, black('PagBank Black')] },
  '30306294': { color: '#0E1C36', skins: [{ id: 'btg', name: 'BTG Pactual', bg: g('#1b2f56', '#0e1c36', '#060d1c'), ink: 'light', logo: 'white', finish: 'metal' }] },
  '02332886': { color: '#111111', skins: [black('XP Visa Infinite')] },
  '20855875': { color: '#0B6CF0', skins: [{ id: 'neon', name: 'Neon', bg: g('#1a2f6b', '#0b1d45', '#050f26'), ink: 'light', logo: 'white' }] },
  '59285411': { color: '#009EE2', skins: [{ id: 'pan', name: 'Banco Pan', bg: g('#22b2ee', '#009ee2', '#0077b0'), ink: 'light', logo: 'white' }] },
  '02038232': { color: '#003641', skins: [{ id: 'sicoob', name: 'Sicoob', bg: g('#0b5260', '#003641', '#001d24'), ink: 'light', logo: 'white' }] },
  '01181521': { color: '#3FA110', skins: [{ id: 'sicredi', name: 'Sicredi', bg: g('#5bb82c', '#3fa110', '#2c7a08'), ink: 'light', logo: 'white' }] },
  '92702067': { color: '#0063AF', skins: [{ id: 'banrisul', name: 'Banrisul', bg: g('#1f7bc4', '#0063af', '#00447d'), ink: 'light', logo: 'white' }] },
  '58160789': { color: '#0F2348', skins: [{ id: 'safra', name: 'Safra', bg: g('#1d3768', '#0f2348', '#071229'), ink: 'light', logo: 'white', finish: 'metal' }] },
  '92894922': { color: '#00A651', skins: [{ id: 'original', name: 'Original', bg: g('#1fbd6a', '#00a651', '#007a3b'), ink: 'light', logo: 'white' }] },
  '61186680': { color: '#FF6D00', skins: [{ id: 'bmg', name: 'BMG', bg: g('#ff8a33', '#ff6d00', '#d95700'), ink: 'light', logo: 'white' }] },
  '10664513': { color: '#0B5FD9', skins: [{ id: 'agibank', name: 'Agibank', bg: g('#2a78ea', '#0b5fd9', '#0745a3'), ink: 'light', logo: 'white' }] },
  '16501555': { color: '#00A868', skins: [{ id: 'stone', name: 'Stone', bg: g('#17bd7d', '#00a868', '#007a4b'), ink: 'light', logo: 'white' }] },
  '18189547': { color: '#141414', skins: [{ id: 'infinitepay', name: 'InfinitePay', bg: g('#262626', '#141414', '#050505'), ink: 'light', logo: 'white' }] },
  '37880206': { color: '#FE3E6D', skins: [{ id: 'cora', name: 'Cora', bg: g('#ff5c85', '#fe3e6d', '#e01f52'), ink: 'light', logo: 'white' }] },
  '24313102': { color: '#FFDD00', skins: [{ id: '99pay', name: '99Pay', bg: g('#ffe94d', '#ffdd00', '#f0c400'), ink: 'dark', logo: 'color' }] },
  '00000208': { color: '#003D7C', skins: [{ id: 'brb', name: 'BRB', bg: g('#13559b', '#003d7c', '#002a57'), ink: 'light', logo: 'white' }] },
  '07237373': { color: '#A6192E', skins: [{ id: 'bnb', name: 'Banco do Nordeste', bg: g('#bf2f45', '#a6192e', '#7c0f20'), ink: 'light', logo: 'white' }] },
  '17184037': { color: '#0B2C6B', skins: [{ id: 'mercantil', name: 'Mercantil', bg: g('#1a3f8a', '#0b2c6b', '#061c47'), ink: 'light', logo: 'white' }] },
  '28127603': { color: '#004B87', skins: [{ id: 'banestes', name: 'Banestes', bg: g('#1663a3', '#004b87', '#003360'), ink: 'light', logo: 'white' }] },
  '60889128': { color: '#00897B', skins: [{ id: 'sofisa', name: 'Sofisa', bg: g('#1aa394', '#00897b', '#00665c'), ink: 'light', logo: 'white' }] },
  '59588111': { color: '#0B3D91', skins: [{ id: 'bv', name: 'BV', bg: g('#1d52ad', '#0b3d91', '#062a68'), ink: 'light', logo: 'white' }] },
  '62232889': { color: '#002F5F', skins: [{ id: 'daycoval', name: 'Daycoval', bg: g('#0f4580', '#002f5f', '#001c3b'), ink: 'light', logo: 'white' }] },
}

/** Modelos para qualquer banco (ou cartão sem banco escolhido). */
export const genericSkins: CardSkin[] = [
  { id: 'grafite', name: 'Grafite', bg: g('#3a3d42', '#24272b', '#121417'), ink: 'light', logo: 'white' },
  { ...black('Black'), id: 'preto' },
  { id: 'verde', name: 'Verde', bg: g('#15553f', '#0f3b2c', '#082319'), ink: 'light', logo: 'white' },
  { id: 'azul', name: 'Azul', bg: g('#2559c9', '#163e9e', '#0b2a70'), ink: 'light', logo: 'white' },
  { id: 'roxo', name: 'Roxo', bg: g('#7a3fe0', '#5b24b8', '#3d1584'), ink: 'light', logo: 'white' },
  { id: 'vermelho', name: 'Vermelho', bg: g('#e0364b', '#b81d33', '#86101f'), ink: 'light', logo: 'white' },
  { id: 'dourado', name: 'Dourado', bg: g('#e9d29a', '#c9a75c', '#9c7a35'), ink: 'dark', logo: 'color', finish: 'metal' },
  { id: 'prata', name: 'Prata', bg: g('#f2f3f5', '#cfd3d9', '#a9afb8'), ink: 'dark', logo: 'color', finish: 'metal' },
]

/** Bancos em destaque no seletor (com logo dentro do app). */
export const popularBanks: BankInfo[] = (popularList as { ispb: string; compe: string; name: string }[]).map(({ ispb, compe, name }) => ({ ispb, compe, name }))

const popularIds = new Set(popularBanks.map((b) => b.ispb))

// arquivos próprios (não embutidos no JavaScript): o navegador baixa e guarda cada logo uma vez
const bundled = import.meta.glob<string>('../assets/bancos/*.{svg,png}', { eager: true, query: '?no-inline', import: 'default' })
const bundledByIspb = new Map(Object.entries(bundled).map(([path, url]) => [path.replace(/^.*\/(\d+)\.\w+$/, '$1'), url]))
const lazyExt = lazyLogos as Record<string, string>

/** Endereço da logo do banco (ou undefined: a instituição não publicou logo). */
export function bankLogo(ispb: string | undefined) {
  if (!ispb) return undefined
  const url = bundledByIspb.get(ispb)
  if (url) return url
  const ext = lazyExt[ispb]
  return ext ? `/logos-bancos/${ispb}.${ext}` : undefined
}

/** Cor da marca do banco (para a conta e os gráficos), quando conhecida. */
export const bankColor = (ispb: string | undefined) => (ispb ? brands[ispb]?.color : undefined)

/** Modelos de cartão para o banco: os do próprio banco primeiro, depois os genéricos. */
export const skinsFor = (ispb: string | undefined) => {
  const own = (ispb && brands[ispb]?.skins) || []
  // o preto genérico é igual ao black do próprio banco: fica só o do banco
  return [...own, ...genericSkins.filter((s) => s.id !== 'preto' || !own.some((o) => o.id === 'black'))]
}

const rgb = (hex: string) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) || 0)
const midTone = (s: CardSkin) => s.bg.match(/#[0-9a-f]{6}/gi)?.[1] ?? '#24272b'

/**
 * Modelo do cartão: o escolhido, ou o primeiro do banco. Cartões antigos (sem banco nem modelo)
 * ficam com o modelo genérico mais parecido com a cor que tinham.
 */
export const skinOf = (card: { bank?: string; skin?: string; color?: string }) => {
  const list = skinsFor(card.bank)
  const chosen = list.find((s) => s.id === card.skin)
  if (chosen) return chosen
  if (card.bank || !card.color || !/^#[0-9a-f]{6}$/i.test(card.color)) return list[0]
  const [r, g2, b] = rgb(card.color)
  const dist = (s: CardSkin) => {
    const [r2, g3, b2] = rgb(midTone(s))
    return (r - r2) ** 2 + (g2 - g3) ** 2 + (b - b2) ** 2
  }
  return genericSkins.reduce((best, s) => (dist(s) < dist(best) ? s : best))
}

const lower = new Set(['de', 'do', 'da', 'dos', 'das', 'e', 'em', 'para'])
const acronyms = new Set(['S.A.', 'S/A', 'SA', 'DTVM', 'CTVM', 'SCD', 'SCM', 'SCFI', 'CCB', 'BRB', 'BNB', 'BTG', 'XP', 'BS2', 'ABC', 'HSBC', 'UBS', 'BV', 'BR', 'IP', 'MS', 'JP', 'GS', 'CNH', 'BMW', 'BNP', 'CIT', 'ICBC', 'KDB', 'MUFG', 'BOFA', 'CSF', 'NBC', 'OK', 'FIDC', 'CEF', 'II', 'III'])

/** Nomes que o Banco Central publica em maiúsculas ficam em caixa normal ("Banco Xyz S.A."). */
const prettyName = (n: string) =>
  n !== n.toLocaleUpperCase('pt-BR')
    ? n
    : n
        .split(/\s+/)
        .map((w, k) => {
          const l = w.toLocaleLowerCase('pt-BR')
          if (acronyms.has(w) || /[\d.]/.test(w)) return w
          if (k > 0 && lower.has(l)) return l
          return l.charAt(0).toLocaleUpperCase('pt-BR') + l.slice(1)
        })
        .join(' ')

/** Nome para a conta ou cartão novo: sem "S.A." e afins no fim. */
export const shortBankName = (name: string) => name.replace(/\s*(-\s*)?(S\.?\/?A\.?|Ltda\.?)$/i, '').trim()

/** Cor do cartão para gráficos e listas: o tom do meio do plástico escolhido. */
export const cardColor = (card: { bank?: string; skin?: string }) => midTone(skinOf(card))

let all: Promise<BankInfo[]> | null = null

/** Todas as instituições do Banco Central (carregadas só quando a busca é usada). */
export function allBanks() {
  all ??= import('./bancos.json').then((m) =>
    (m.default as { i: string; c?: string; n: string }[]).map((b) => ({ ispb: b.i, ...(b.c ? { compe: b.c } : {}), name: prettyName(b.n) })),
  )
  return all
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/** Busca por nome ou número do banco ("nubank", "260", "caixa econ"). */
export function searchBanks(list: BankInfo[], q: string, max = 40) {
  const t = norm(q.trim())
  if (!t) return []
  const digits = t.replace(/\D/g, '')
  // os populares primeiro, depois quem começa com o termo, depois os nomes mais curtos
  const rank = (b: BankInfo) => (popularIds.has(b.ispb) ? 0 : 2) + (norm(b.name).startsWith(t) || b.compe === digits ? 0 : 1)
  return list
    .filter((b) => norm(b.name).includes(t) || (digits && digits === t && (b.compe ?? '').includes(digits)))
    .sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length)
    .slice(0, max)
}

/** Nome curto do banco a partir do ISPB (populares; os demais vêm da lista completa). */
export const popularName = (ispb: string | undefined) => popularBanks.find((b) => b.ispb === ispb)?.name

/** Nome do banco pelo ISPB (os populares na hora; os demais quando a lista completa carrega). */
export function useBankName(ispb: string | undefined) {
  const quick = popularName(ispb)
  const [name, setName] = useState<string>()
  useEffect(() => {
    if (!ispb || quick) return
    let live = true
    void allBanks().then((list) => live && setName(list.find((b) => b.ispb === ispb)?.name))
    return () => {
      live = false
    }
  }, [ispb, quick])
  return ispb ? (quick ?? name) : undefined
}
