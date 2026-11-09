// Tipos de aviso que a pessoa pode ligar e desligar em Configurações → Notificações.
// Os mesmos nomes são lidos pela função push no servidor (supabase/functions/push).

export type AlertType = 'hoje' | 'atrasos' | 'amanha' | 'faturas' | 'lancamentos' | 'orcamento' | 'metas' | 'dividas' | 'resumo' | 'plano'

export const alertGroups: { title: string; items: { type: AlertType; label: string; detail: string }[] }[] = [
  {
    title: 'Contas a pagar e receber',
    items: [
      { type: 'hoje', label: 'Vencimentos do dia', detail: 'Contas e parcelas que vencem hoje' },
      { type: 'atrasos', label: 'Contas atrasadas', detail: 'O que venceu e ainda não foi pago' },
      { type: 'amanha', label: 'Vencem amanhã', detail: 'Para pagar sem correria' },
      { type: 'faturas', label: 'Faturas do cartão', detail: 'Fechamento e vencimento' },
    ],
  },
  {
    title: 'Movimentações',
    items: [
      { type: 'lancamentos', label: 'Lançamentos', detail: 'Receitas e despesas feitas em outro aparelho' },
      { type: 'orcamento', label: 'Limites de gastos', detail: 'Ao chegar perto ou passar do teto da categoria' },
      { type: 'metas', label: 'Metas', detail: 'Quando uma meta é concluída' },
      { type: 'dividas', label: 'Dívidas', detail: 'Parcelas pagas e dívidas quitadas' },
    ],
  },
  {
    title: 'Resumos e conta',
    items: [
      { type: 'resumo', label: 'Resumos', detail: 'Toda segunda e no dia 1º do mês' },
      { type: 'plano', label: 'Vencimento do acesso', detail: '3 dias antes, na véspera e no dia' },
    ],
  },
]

export const alertTypes = alertGroups.flatMap((g) => g.items.map((i) => i.type))

export const defaultAlerts = Object.fromEntries(alertTypes.map((t) => [t, true])) as Record<AlertType, boolean>
