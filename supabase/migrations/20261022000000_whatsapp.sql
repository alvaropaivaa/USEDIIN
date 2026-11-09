-- Assistente no WhatsApp: a pessoa liga o próprio número à conta e manda texto, áudio, print ou PDF
-- para um número do JurosPro; a função whatsapp (supabase/functions/whatsapp) entende, lança em
-- public.records e responde. O app recebe os lançamentos na hora (Realtime).
--
-- Vínculo: o app pede um código (whatsapp_code) e abre o WhatsApp com ele já escrito; quando a
-- mensagem com o código chega do número da pessoa, a função grava o telefone. Assim só quem tem
-- o celular consegue ligar aquele número a uma conta.

create table public.whatsapp_links (
  user_id uuid primary key references auth.users on delete cascade,
  -- só dígitos, com DDI (5511987654321); vazio até a pessoa mandar o código
  phone text unique check (phone ~ '^[0-9]{10,15}$'),
  -- código de vínculo: 6 caracteres sem os ambíguos (0/O, 1/I/L), vale 30 minutos
  code text unique check (code ~ '^[A-Z2-9]{6}$'),
  code_expires timestamptz,
  linked_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_links enable row level security;

-- a pessoa só lê o próprio vínculo; quem escreve são as funções abaixo e a função whatsapp (service role)
create policy "vínculo do dono" on public.whatsapp_links for select to authenticated
using (user_id = (select auth.uid()));

-- novo código (o anterior deixa de valer); o número já ligado continua ligado até chegar o código
create function public.whatsapp_code() returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  new_code text;
begin
  if auth.uid() is null or not public.has_access() then
    raise exception 'sem acesso' using errcode = '42501';
  end if;
  loop
    select string_agg(substr(alphabet, 1 + (get_byte(b, i) % length(alphabet)), 1), '')
      into new_code
      -- os 6 primeiros bytes de um uuid v4 são aleatórios (sem depender da extensão pgcrypto)
      from (select uuid_send(gen_random_uuid()) as b) r, generate_series(0, 5) i;
    exit when not exists (select 1 from public.whatsapp_links where code = new_code);
  end loop;
  insert into public.whatsapp_links (user_id, code, code_expires, updated_at)
  values (auth.uid(), new_code, now() + interval '30 minutes', now())
  on conflict (user_id) do update set code = excluded.code, code_expires = excluded.code_expires, updated_at = now();
  return new_code;
end
$$;

-- desliga o número da conta (o assistente para de aceitar mensagens dele)
create function public.whatsapp_unlink() returns void
language sql volatile security definer set search_path = ''
as $$
  delete from public.whatsapp_links where user_id = auth.uid();
$$;

revoke execute on function public.whatsapp_code(), public.whatsapp_unlink() from public, anon;
grant execute on function public.whatsapp_code(), public.whatsapp_unlink() to authenticated;

-- Histórico das mensagens tratadas: evita processar a mesma mensagem duas vezes (o WhatsApp
-- reenvia eventos) e guarda o que cada uma criou, para o "desfazer".
create table public.whatsapp_log (
  id bigint generated always as identity primary key,
  -- vazio quando a mensagem veio de um número ainda não ligado
  user_id uuid references auth.users on delete cascade,
  phone text not null,
  -- id da mensagem no provedor do WhatsApp
  msg_id text not null unique,
  kind text not null check (kind in ('texto', 'audio', 'imagem', 'documento', 'outro')),
  -- texto recebido ou transcrição do áudio (cortado em 4 mil caracteres)
  input text check (length(input) <= 4000),
  -- o que a mensagem criou ou mudou: [{ "kind": "transactions", "id": "…" }]
  records jsonb not null default '[]' check (jsonb_typeof(records) = 'array'),
  reply text,
  undone boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.whatsapp_log enable row level security;

create policy "mensagens do dono" on public.whatsapp_log for select to authenticated
using (user_id = (select auth.uid()));

create index whatsapp_log_user_idx on public.whatsapp_log (user_id, created_at desc);

-- o app recebe na hora o que o assistente lançou (respeita a política de public.records)
alter publication supabase_realtime add table public.records;
