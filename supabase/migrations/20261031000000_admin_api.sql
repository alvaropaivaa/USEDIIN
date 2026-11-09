-- Painel administrativo (Dinn Adm): clientes, plano e uso numa consulta só.
-- Chamada direto do navegador pelo administrador logado (profiles.is_admin) ou pela chave de serviço;
-- qualquer outra conta recebe "forbidden".
--
-- Aguenta tabelas que ainda não existem (records, whatsapp_*, push_subscriptions vêm de migrações
-- que podem não ter sido aplicadas): a coluna correspondente volta nula e o painel mostra "—".
create or replace function public.admin_clients()
returns table (
  id uuid,
  email text,
  name text,
  phone text,
  plan text,
  blocked boolean,
  expires_at date,
  note text,
  created_at timestamptz,
  last_login timestamptz,
  transactions int,
  last_activity timestamptz,
  whatsapp_phone text,
  whatsapp_linked_at timestamptz,
  whatsapp_msgs_30d int,
  whatsapp_last_at timestamptz,
  push_devices int
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() and coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query execute
    'select p.id, p.email, p.name, p.phone, p.plan, p.blocked, p.expires_at, p.note, p.created_at, p.last_login, '
    || case when to_regclass('public.records') is null then 'null::int, null::timestamptz'
       else '(select count(*)::int from public.records r where r.user_id = p.id and r.kind = ''transactions''),
             (select max(r.updated_at) from public.records r where r.user_id = p.id)' end
    || ', '
    || case when to_regclass('public.whatsapp_links') is null or to_regclass('public.whatsapp_log') is null
         then 'null::text, null::timestamptz, null::int, null::timestamptz'
       else '(select w.phone from public.whatsapp_links w where w.user_id = p.id),
             (select w.linked_at from public.whatsapp_links w where w.user_id = p.id),
             (select count(*)::int from public.whatsapp_log l where l.user_id = p.id and l.created_at > now() - interval ''30 days''),
             (select max(l.created_at) from public.whatsapp_log l where l.user_id = p.id)' end
    || ', '
    || case when to_regclass('public.push_subscriptions') is null then 'null::int'
       else '(select count(*)::int from public.push_subscriptions s where s.user_id = p.id)' end
    || ' from public.profiles p where not p.is_admin order by p.created_at desc';
end;
$$;

revoke execute on function public.admin_clients() from public, anon;
grant execute on function public.admin_clients() to authenticated, service_role;
