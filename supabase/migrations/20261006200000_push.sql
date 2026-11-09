-- JurosPro: notificações push (inscrições dos aparelhos e resumo diário pelo cron).
--
-- Passo manual, uma vez, depois de aplicar (SQL Editor), com o CRON_SECRET de supabase/functions/.env:
--   select vault.create_secret('<CRON_SECRET do supabase/functions/.env>', 'push_cron_secret');
-- Sem esse segredo o cron chama a função sem x-cron-secret e ela responde 401.
-- Para trocar depois: select vault.update_secret(id, '<novo>') from vault.secrets where name = 'push_cron_secret';

-- ─── Inscrições ──────────────────────────────────────────────

create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users on delete cascade,
  p256dh text not null,
  auth text not null,
  tz text not null default 'America/Sao_Paulo',
  device text not null default '',
  -- dia (local do aparelho) do último resumo enviado
  last_digest date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- o app lê e remove as próprias; gravar só pelas funções abaixo
create policy "push: o próprio lê" on public.push_subscriptions
for select to authenticated using (user_id = (select auth.uid()));

create policy "push: o próprio remove" on public.push_subscriptions
for delete to authenticated using (user_id = (select auth.uid()));

-- ─── Funções chamadas pelo app ───────────────────────────────

-- inscreve (ou atualiza) este aparelho; se outra conta usou o navegador antes, passa para quem chamou
create function public.push_register(p_endpoint text, p_p256dh text, p_auth text, p_tz text, p_device text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  -- só serviços de push conhecidos (Chrome/Android, Firefox, Edge, Safari/iPhone)
  if p_endpoint is null or length(p_endpoint) > 1000
    or p_endpoint !~* '^https://([a-z0-9-]+\.)*(googleapis\.com|google\.com|mozilla\.com|windows\.com|apple\.com)(:[0-9]+)?/' then
    raise exception 'invalid_endpoint';
  end if;
  if coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_+/=-]{80,100}$' or coalesce(p_auth, '') !~ '^[A-Za-z0-9_+/=-]{16,40}$' then
    raise exception 'invalid_keys';
  end if;

  insert into public.push_subscriptions as s (endpoint, user_id, p256dh, auth, tz, device)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(coalesce(nullif(p_tz, ''), 'America/Sao_Paulo'), 64), left(coalesce(p_device, ''), 120))
  on conflict (endpoint) do update set
    user_id = excluded.user_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    tz = excluded.tz,
    device = excluded.device,
    -- outra conta: o resumo de hoje ainda não foi para ela
    last_digest = case when s.user_id = excluded.user_id then s.last_digest end,
    updated_at = now();
end;
$$;

create function public.push_unregister(p_endpoint text) returns void
language sql security definer set search_path = ''
as $$ delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid() $$;

revoke execute on function public.push_register(text, text, text, text, text), public.push_unregister(text) from public, anon;
grant execute on function public.push_register(text, text, text, text, text), public.push_unregister(text) to authenticated;

-- ─── Cron: resumo diário ─────────────────────────────────────
-- roda toda hora cheia; a função manda o resumo para quem está na hora escolhida (Ajustes)

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- cron.schedule com o mesmo nome atualiza o job existente, então reaplicar não duplica
select cron.schedule(
  'jurospro-push',
  '0 * * * *',
  $cron$
  select net.http_post(
    url := 'https://giraspzazfuhyuvttlpe.supabase.co/functions/v1/push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret'), '')
    ),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 60000
  )
  $cron$
);
