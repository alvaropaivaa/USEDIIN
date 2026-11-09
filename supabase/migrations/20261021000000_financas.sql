-- JurosPro vira gestão de finanças pessoais: contas, cartões, categorias, lançamentos,
-- lançamentos fixos, metas e dívidas ficam numa tabela só, um registro JSON por item.
-- O app compara e envia só o que mudou (src/lib/sync.ts); os ids vêm do app.
--
-- As tabelas clients e contracts continuam: na primeira vez que a pessoa abre a versão nova,
-- o app converte os contratos em dívidas a receber (e marca settings.legacy = true).

create table public.records (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('accounts', 'cards', 'categories', 'transactions', 'recurrences', 'goals', 'debts')),
  id text not null check (length(id) between 1 and 120),
  -- um item não passa de alguns KB; o limite segura abuso
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 65536),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);

alter table public.records enable row level security;

-- cada um mexe só no que é seu, e só com o acesso em dia
create policy "registros do dono" on public.records for all to authenticated
using (user_id = (select auth.uid()) and (select public.has_access()))
with check (user_id = (select auth.uid()) and (select public.has_access()));
-- a chave primária (user_id, kind, id) já serve de índice para "tudo de um tipo desta pessoa",
-- que é a consulta do app e da função push
