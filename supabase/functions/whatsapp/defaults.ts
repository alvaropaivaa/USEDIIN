// Categorias padrão do app (src/lib/categories.ts, defaultCategories): a nuvem de uma conta antiga pode
// não ter categorias, e aí o app usa estas; o assistente usa os mesmos ids. Cópia conferida nos testes.

import type { Category } from './ledger.ts'

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
  list.flatMap(([id, name, , , subs]) => [
    { id: `cat-${id}`, name, type, ...(keywords[id] ? { keywords: keywords[id] } : {}) },
    ...(subs ?? []).map(([sid, sname]) => ({ id: `cat-${sid}`, name: sname, type, parentId: `cat-${id}`, ...(keywords[sid] ? { keywords: keywords[sid] } : {}) })),
  ])

export const defaultCategories = (): Category[] => [...build(expense, 'despesa'), ...build(income, 'receita')]
