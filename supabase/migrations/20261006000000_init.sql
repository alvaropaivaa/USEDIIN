-- JurosPro: acessos (perfis), dados de cada usuário e painel do administrador.

-- ─── Perfis / acessos ────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  name text not null default '',
  phone text not null default '',
  role text not null default 'operador' check (role in ('admin', 'operador', 'cobrador')),
  plan text not null default 'teste' check (plan in ('teste', 'mensal', 'trimestral', 'anual', 'vitalicio')),
  blocked boolean not null default false,
  -- vazio = sem vencimento (vitalício)
  expires_at date,
  instance text not null default '',
  note text not null default '',
  -- dono do painel /admin
  is_admin boolean not null default false,
  last_login timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- data de hoje no fuso do Brasil (vencimentos são por dia)
create function public.today_br() returns date
language sql stable set search_path = ''
as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select is_admin from public.profiles where id = auth.uid()), false) $$;

-- acesso liberado: não bloqueado e dentro do vencimento
create function public.has_access() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select not blocked and (expires_at is null or expires_at >= public.today_br())
    from public.profiles where id = auth.uid()
  ), false)
$$;

-- cadastro (pelo app, Google ou painel): cria o perfil com 7 dias de teste
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name, expires_at)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name', ''),
    public.today_br() + 7
  );
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create policy "perfil: o próprio ou admin lê" on public.profiles
for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));

create policy "perfil: só admin altera" on public.profiles
for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ─── Funções chamadas pelo app ───────────────────────────────

create function public.admin_exists() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles where is_admin) $$;

-- primeiro acesso ao painel: quem chamar primeiro vira administrador
create function public.claim_admin() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  perform pg_advisory_xact_lock(hashtext('jurospro_claim_admin'));
  if exists (select 1 from public.profiles where is_admin) then raise exception 'admin_exists'; end if;
  update public.profiles set is_admin = true, role = 'admin', plan = 'vitalicio', expires_at = null where id = auth.uid();
end;
$$;

create function public.touch_login() returns void
language sql security definer set search_path = ''
as $$ update public.profiles set last_login = now() where id = auth.uid() $$;

revoke execute on function public.claim_admin(), public.touch_login() from public, anon;
grant execute on function public.admin_exists() to anon, authenticated;
grant execute on function public.claim_admin(), public.touch_login() to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ─── Dados de cada usuário ───────────────────────────────────
-- ids vêm do app (uuid ou de backups antigos), por isso a chave inclui o dono

create table public.clients (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  code integer not null,
  name text not null,
  phone text not null default '',
  note text,
  collector_id text,
  created_at date not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.contracts (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  client_id text not null,
  kind text not null,
  principal double precision not null,
  rate double precision not null,
  mode text not null,
  frequency text not null,
  created_at date not null,
  schedule jsonb not null default '[]',
  payments jsonb not null default '[]',
  renegotiated boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index contracts_client_idx on public.contracts (user_id, client_id);

create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  settings jsonb not null default '{}',
  next_code integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.clients enable row level security;
alter table public.contracts enable row level security;
alter table public.user_settings enable row level security;

-- cada um mexe só no que é seu, e só com o acesso em dia
create policy "clientes do dono" on public.clients for all to authenticated
using (user_id = (select auth.uid()) and (select public.has_access()))
with check (user_id = (select auth.uid()) and (select public.has_access()));

create policy "contratos do dono" on public.contracts for all to authenticated
using (user_id = (select auth.uid()) and (select public.has_access()))
with check (user_id = (select auth.uid()) and (select public.has_access()));

create policy "ajustes do dono" on public.user_settings for all to authenticated
using (user_id = (select auth.uid()) and (select public.has_access()))
with check (user_id = (select auth.uid()) and (select public.has_access()));

-- ─── Painel do administrador ─────────────────────────────────

create table public.admin_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  text text not null,
  tone text not null default 'gray' check (tone in ('green', 'red', 'blue', 'gray'))
);

create index admin_log_at_idx on public.admin_log (at desc);

create table public.app_config (
  key text primary key,
  value jsonb not null default '{}'
);

alter table public.admin_log enable row level security;
alter table public.app_config enable row level security;

create policy "histórico: só admin" on public.admin_log for all to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "config: só admin" on public.app_config for all to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));

-- anônimo só precisa saber se já existe admin (tela de primeiro acesso do painel)
revoke execute on function public.is_admin(), public.has_access(), public.today_br() from public, anon;
grant execute on function public.is_admin(), public.has_access(), public.today_br() to authenticated;
