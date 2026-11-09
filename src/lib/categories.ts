// Categorias: ícones e cores para escolher, e a lista que toda conta nova já ganha.
// Os ids das categorias padrão são fixos ('cat-…'): dois aparelhos começando do zero
// geram as mesmas categorias, sem duplicar na nuvem.
//
// Ícones: o mesmo traço de linha do resto do app (Lucide), em preto sobre um círculo cinza-claro.
// A cor da categoria fica para o que é essencial (gráficos, barras de limite), não para o ícone.
// As chaves ficam gravadas nos dados: renomear uma chave quebra as categorias salvas.

import {
  ArrowLeftRight,
  Baby,
  BadgePercent,
  Banknote,
  BedDouble,
  Beer,
  Bike,
  BookOpen,
  Briefcase,
  BriefcaseMedical,
  Building2,
  Bus,
  Car,
  CarTaxiFront,
  Cat,
  CircleDollarSign,
  Coffee,
  Coins,
  CreditCard,
  Dog,
  Droplet,
  Dumbbell,
  Ellipsis,
  Flower2,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  Hammer,
  HandCoins,
  Handshake,
  Headphones,
  HeartPulse,
  House,
  IdCard,
  Landmark,
  Laptop,
  Lightbulb,
  Motorbike,
  Package,
  PaintRoller,
  PiggyBank,
  Pill,
  Pizza,
  Plane,
  Popcorn,
  Receipt,
  Sandwich,
  Scissors,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Smartphone,
  Smile,
  Sofa,
  Sprout,
  Stethoscope,
  Store,
  Ticket,
  TrainFront,
  TrendingUp,
  Tv,
  Undo2,
  Utensils,
  Vault,
  Volleyball,
  Wallet,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { Category } from './ledger'

/** Ícone de cada chave, na ordem do seletor (agrupada por assunto). Inclui os de uso interno: transferência e ajuste. */
export const categoryIcons: Record<string, LucideIcon> = {
  // casa
  casa: House,
  predio: Building2,
  luz: Lightbulb,
  energia: Zap,
  agua: Droplet,
  internet: Wifi,
  celular: Smartphone,
  sofa: Sofa,
  reforma: PaintRoller,
  planta: Sprout,
  // comida
  mercado: ShoppingCart,
  restaurante: Utensils,
  lanche: Sandwich,
  pizza: Pizza,
  cafe: Coffee,
  bar: Beer,
  // transporte
  carro: Car,
  combustivel: Fuel,
  onibus: Bus,
  trem: TrainFront,
  taxi: CarTaxiFront,
  moto: Motorbike,
  bike: Bike,
  manutencao: Wrench,
  // saúde e cuidados
  saude: HeartPulse,
  remedio: Pill,
  medico: Stethoscope,
  dentista: Smile,
  primeiros: BriefcaseMedical,
  academia: Dumbbell,
  esporte: Volleyball,
  beleza: Flower2,
  cabelo: Scissors,
  // estudo e lazer
  educacao: GraduationCap,
  livro: BookOpen,
  lazer: Popcorn,
  ingresso: Ticket,
  jogos: Gamepad2,
  musica: Headphones,
  streaming: Tv,
  viagem: Plane,
  hotel: BedDouble,
  // compras e família
  roupas: Shirt,
  compras: ShoppingBag,
  pacote: Package,
  pet: Dog,
  gato: Cat,
  filhos: Baby,
  presente: Gift,
  ferramentas: Hammer,
  // dinheiro
  impostos: Receipt,
  documentos: IdCard,
  seguro: ShieldCheck,
  banco: Landmark,
  cartao: CreditCard,
  divida: HandCoins,
  acordo: Handshake,
  salario: Briefcase,
  freela: Laptop,
  loja: Store,
  investimento: TrendingUp,
  rendimento: BadgePercent,
  cofrinho: PiggyBank,
  cofre: Vault,
  dinheiro: Banknote,
  moedas: Coins,
  reembolso: Undo2,
  carteira: Wallet,
  extra: CircleDollarSign,
  outros: Ellipsis,
  // uso interno (não aparecem no seletor)
  transferencia: ArrowLeftRight,
  ajuste: SlidersHorizontal,
}

/** Chaves que a pessoa pode escolher para uma categoria, conta ou meta. */
export const iconKeys = Object.keys(categoryIcons).filter((k) => k !== 'transferencia' && k !== 'ajuste')

/** Cores das categorias, contas e metas (boas no claro e no escuro). */
export const palette = ['#16a34a', '#0d9488', '#0284c7', '#2563eb', '#4f46e5', '#7c3aed', '#c026d3', '#db2777', '#e11d48', '#dc2626', '#ea580c', '#d97706', '#ca8a04', '#65a30d', '#475569', '#78716c']

/** Ícone da chave (chave desconhecida, de dado antigo ou importado, vira "outros"). */
export const iconFor = (key: string | undefined) => categoryIcons[key ?? ''] ?? categoryIcons.outros

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/** Ícone que combina com o nome ("Mercado" → mercado, "Uber" → nada). */
export function suggestIcon(name: string) {
  const words = norm(name).split(/[^a-z0-9]+/).filter((w) => w.length >= 3)
  if (!words.length) return undefined
  return iconKeys.find((k) => words.some((w) => k === w || (w.length >= 4 && (k.startsWith(w) || w.startsWith(k)))))
}

// ─── Categorias padrão ───────────────────────────────────────

type Seed = [id: string, name: string, icon: string, color: string, subs?: [id: string, name: string, icon: string][]]

const expense: Seed[] = [
  ['moradia', 'Moradia', 'casa', '#2563eb', [
    ['aluguel', 'Aluguel ou financiamento', 'predio'],
    ['condominio', 'Condomínio', 'predio'],
    ['luz', 'Luz', 'luz'],
    ['agua', 'Água e gás', 'agua'],
    ['internet', 'Internet e telefone', 'internet'],
    ['manutencao-casa', 'Manutenção e reparos', 'ferramentas'],
  ]],
  ['alimentacao', 'Alimentação', 'restaurante', '#ea580c', [
    ['mercado', 'Mercado', 'mercado'],
    ['restaurantes', 'Restaurantes', 'restaurante'],
    ['delivery', 'Delivery', 'pacote'],
    ['padaria', 'Padaria e café', 'cafe'],
  ]],
  ['transporte', 'Transporte', 'carro', '#0284c7', [
    ['combustivel', 'Combustível', 'combustivel'],
    ['app-transporte', 'Aplicativo e táxi', 'carro'],
    ['transporte-publico', 'Transporte público', 'onibus'],
    ['manutencao-carro', 'Manutenção do carro', 'manutencao'],
    ['estacionamento', 'Estacionamento e pedágio', 'moedas'],
  ]],
  ['saude', 'Saúde', 'saude', '#dc2626', [
    ['farmacia', 'Farmácia', 'remedio'],
    ['plano-saude', 'Plano de saúde', 'medico'],
    ['consultas', 'Consultas e exames', 'medico'],
    ['academia', 'Academia', 'academia'],
  ]],
  ['educacao', 'Educação', 'educacao', '#7c3aed', [
    ['mensalidade', 'Escola e faculdade', 'educacao'],
    ['cursos', 'Cursos', 'livro'],
  ]],
  ['lazer', 'Lazer', 'lazer', '#db2777', [
    ['passeios', 'Passeios e cinema', 'lazer'],
    ['bares', 'Bares e festas', 'bar'],
    ['viagens', 'Viagens', 'viagem'],
    ['jogos', 'Jogos e hobbies', 'jogos'],
  ]],
  ['assinaturas', 'Assinaturas', 'streaming', '#4f46e5'],
  ['compras', 'Compras', 'compras', '#c026d3', [
    ['roupas', 'Roupas e calçados', 'roupas'],
    ['eletronicos', 'Eletrônicos', 'celular'],
    ['casa-decoracao', 'Casa e decoração', 'casa'],
  ]],
  ['cuidados', 'Cuidados pessoais', 'beleza', '#e11d48'],
  ['pets', 'Pets', 'pet', '#d97706'],
  ['filhos', 'Filhos', 'filhos', '#0d9488'],
  ['presentes', 'Presentes e doações', 'presente', '#65a30d'],
  ['impostos', 'Impostos e taxas', 'impostos', '#475569', [
    ['tarifas', 'Tarifas bancárias', 'banco'],
    ['iptu-ipva', 'IPTU e IPVA', 'impostos'],
  ]],
  ['dividas', 'Dívidas e empréstimos', 'divida', '#78716c', [
    ['parcela-divida', 'Parcela de dívida', 'divida'],
    ['juros-multas', 'Juros e multas', 'impostos'],
  ]],
  ['outras-despesas', 'Outras despesas', 'outros', '#64748b'],
]

const income: Seed[] = [
  ['salario', 'Salário', 'salario', '#16a34a', [
    ['salario-mensal', 'Salário mensal', 'salario'],
    ['decimo', '13º e férias', 'presente'],
    ['bonus', 'Bônus e PLR', 'extra'],
  ]],
  ['renda-extra', 'Renda extra', 'freela', '#0d9488', [
    ['freelas', 'Freelas e bicos', 'freela'],
    ['vendas', 'Vendas', 'loja'],
  ]],
  ['investimentos', 'Investimentos', 'investimento', '#0284c7', [
    ['rendimentos', 'Rendimentos', 'rendimento'],
    ['dividendos', 'Dividendos', 'investimento'],
  ]],
  ['reembolsos', 'Reembolsos', 'reembolso', '#7c3aed'],
  ['emprestimos-recebidos', 'Empréstimos recebidos', 'divida', '#ca8a04', [
    ['recebimento-emprestimo', 'Parcela recebida', 'divida'],
  ]],
  ['presentes-recebidos', 'Presentes', 'presente', '#db2777'],
  ['outras-receitas', 'Outras receitas', 'outros', '#64748b'],
]

/** Palavras que sugerem a categoria ao escrever a descrição do lançamento. */
const keywords: Record<string, string[]> = {
  aluguel: ['aluguel', 'financiamento imob', 'prestação da casa'],
  condominio: ['condominio', 'condomínio'],
  luz: ['luz', 'energia', 'enel', 'cemig', 'copel', 'light', 'celesc', 'coelba', 'equatorial'],
  agua: ['água', 'agua', 'sabesp', 'copasa', 'gás', 'gas', 'botijão', 'comgas'],
  internet: ['internet', 'fibra', 'wifi', 'vivo', 'claro', 'tim', 'oi fibra', 'telefone', 'celular'],
  'manutencao-casa': ['reforma', 'conserto', 'encanador', 'eletricista', 'pintura'],
  mercado: ['mercado', 'supermercado', 'atacad', 'assaí', 'assai', 'carrefour', 'pão de açúcar', 'feira', 'hortifruti', 'açougue'],
  restaurantes: ['restaurante', 'almoço', 'almoco', 'jantar', 'lanche', 'lanchonete', 'pizzaria', 'hamburguer', 'churrascaria', 'sushi'],
  delivery: ['ifood', 'delivery', 'rappi', 'aiqfome', 'entrega'],
  padaria: ['padaria', 'café', 'cafe', 'cafeteria', 'starbucks'],
  combustivel: ['gasolina', 'etanol', 'álcool', 'combustível', 'combustivel', 'posto', 'diesel', 'shell', 'ipiranga'],
  'app-transporte': ['uber', '99', 'táxi', 'taxi', 'cabify', 'indriver'],
  'transporte-publico': ['ônibus', 'onibus', 'metrô', 'metro', 'trem', 'bilhete único', 'passagem'],
  'manutencao-carro': ['mecânico', 'mecanico', 'oficina', 'pneu', 'revisão', 'troca de óleo', 'lava-jato', 'lavagem'],
  estacionamento: ['estacionamento', 'pedágio', 'pedagio', 'zona azul', 'sem parar', 'veloe'],
  farmacia: ['farmácia', 'farmacia', 'remédio', 'remedio', 'drogaria', 'droga raia', 'drogasil'],
  'plano-saude': ['plano de saúde', 'plano de saude', 'unimed', 'amil', 'bradesco saúde', 'sulamerica', 'hapvida'],
  consultas: ['consulta', 'médico', 'medico', 'dentista', 'exame', 'laboratório', 'psicólogo', 'terapia'],
  academia: ['academia', 'smart fit', 'crossfit', 'pilates', 'natação', 'personal'],
  mensalidade: ['escola', 'faculdade', 'mensalidade escolar', 'material escolar'],
  cursos: ['curso', 'udemy', 'alura', 'inglês', 'livro'],
  passeios: ['cinema', 'teatro', 'show', 'ingresso', 'passeio', 'parque'],
  bares: ['bar', 'balada', 'festa', 'cerveja', 'happy hour'],
  viagens: ['viagem', 'hotel', 'airbnb', 'passagem aérea', 'latam', 'gol', 'azul', 'booking'],
  jogos: ['jogo', 'steam', 'playstation', 'xbox', 'nintendo', 'hobby'],
  assinaturas: ['netflix', 'spotify', 'prime video', 'disney', 'hbo', 'max', 'globoplay', 'youtube premium', 'deezer', 'icloud', 'google one', 'assinatura', 'streaming'],
  roupas: ['roupa', 'calçado', 'tênis', 'sapato', 'renner', 'riachuelo', 'c&a', 'zara', 'shein'],
  eletronicos: ['celular novo', 'notebook', 'fone', 'eletrônico', 'computador', 'tablet', 'tv'],
  'casa-decoracao': ['móvel', 'movel', 'decoração', 'tok&stok', 'leroy', 'cama mesa'],
  cuidados: ['cabeleireiro', 'barbeiro', 'salão', 'manicure', 'cosmético', 'perfume', 'boticário', 'natura'],
  pets: ['pet', 'ração', 'veterinário', 'petshop', 'banho e tosa', 'cobasi', 'petz'],
  filhos: ['fralda', 'brinquedo', 'babá', 'creche', 'mesada'],
  presentes: ['presente', 'doação', 'dízimo', 'oferta', 'vaquinha'],
  tarifas: ['tarifa', 'anuidade', 'taxa bancária', 'iof'],
  'iptu-ipva': ['iptu', 'ipva', 'licenciamento', 'imposto', 'darf', 'multa de trânsito'],
  'parcela-divida': ['parcela do empréstimo', 'consignado', 'acordo', 'financiamento'],
  'juros-multas': ['juros', 'multa', 'mora'],
  'salario-mensal': ['salário', 'salario', 'pagamento empresa', 'holerite', 'pró-labore', 'pro-labore'],
  decimo: ['13º', 'décimo', 'decimo terceiro', 'férias'],
  bonus: ['bônus', 'bonus', 'plr', 'participação nos lucros', 'comissão'],
  freelas: ['freela', 'freelance', 'bico', 'serviço prestado', 'projeto'],
  vendas: ['venda', 'vendi', 'marketplace', 'olx', 'mercado livre', 'enjoei'],
  rendimentos: ['rendimento', 'cdb', 'tesouro', 'poupança', 'juros recebidos'],
  dividendos: ['dividendo', 'jcp', 'proventos', 'fii'],
  reembolsos: ['reembolso', 'estorno', 'cashback', 'devolução'],
  'recebimento-emprestimo': ['me pagou', 'devolveu', 'pagou a parcela'],
  'presentes-recebidos': ['presente', 'ganhei'],
}

const build = (list: Seed[], type: Category['type']): Category[] =>
  list.flatMap(([id, name, icon, color, subs]) => [
    { id: `cat-${id}`, name, type, icon, color, ...(keywords[id] ? { keywords: keywords[id] } : {}) },
    ...(subs ?? []).map(([sid, sname, sicon]) => ({ id: `cat-${sid}`, name: sname, type, icon: sicon, color, parentId: `cat-${id}`, ...(keywords[sid] ? { keywords: keywords[sid] } : {}) })),
  ])

export const defaultCategories = (): Category[] => [...build(expense, 'despesa'), ...build(income, 'receita')]

/** Categorias usadas pelos pagamentos das dívidas (criadas de novo se a pessoa apagou). */
export const DEBT_EXPENSE = 'cat-parcela-divida'
export const DEBT_INCOME = 'cat-recebimento-emprestimo'
