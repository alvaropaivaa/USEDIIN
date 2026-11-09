-- Perguntas do cadastro (clientes, carteira, faturamento…): respostas no perfil, visíveis no painel /admin.

alter table public.profiles add column onboarding jsonb not null default '{}';

-- cadastro pelo app: o app manda nome, WhatsApp e respostas nos metadados do usuário
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  answers jsonb := new.raw_user_meta_data -> 'onboarding';
begin
  insert into public.profiles (id, email, name, phone, onboarding, expires_at)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name', ''),
    left(coalesce(new.raw_user_meta_data ->> 'phone', ''), 30),
    case when jsonb_typeof(answers) = 'object' and pg_column_size(answers) < 4000 then answers else '{}'::jsonb end,
    public.today_br() + 7
  );
  return new;
end;
$$;

-- conta criada sem as respostas (Google, ou antes desta versão): o app envia depois, uma vez só
create function public.save_onboarding(p_answers jsonb, p_phone text default '') returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if jsonb_typeof(p_answers) <> 'object' or pg_column_size(p_answers) >= 4000 then raise exception 'invalid_answers'; end if;
  update public.profiles
  set onboarding = p_answers,
      phone = case when phone = '' then left(coalesce(p_phone, ''), 30) else phone end
  where id = auth.uid() and onboarding = '{}'::jsonb;
end;
$$;

revoke execute on function public.save_onboarding(jsonb, text) from public, anon;
grant execute on function public.save_onboarding(jsonb, text) to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
