-- Contexto curto da conversa com o assistente (última lista mostrada, pergunta pendente).
-- Uma linha por membro; expira sozinho. Nunca guarda o texto das mensagens.

create table public.assistant_state (
  member_id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  payload jsonb not null check (pg_column_size(payload) <= 8192),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  foreign key (household_id, member_id)
    references public.household_members (household_id, id) on delete cascade
);

alter table public.assistant_state enable row level security;

create function public.get_assistant_state(p_household_id uuid, p_member_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb;
begin
  perform _assert_member(p_household_id, p_member_id, 'forbidden');
  select payload into v_payload from assistant_state
  where member_id = p_member_id and household_id = p_household_id and expires_at > now();
  return jsonb_build_object('ok', true, 'state', v_payload);
end;
$$;

-- p_payload nulo apaga o contexto.
create function public.set_assistant_state(
  p_household_id uuid,
  p_member_id uuid,
  p_payload jsonb,
  p_ttl_minutes integer default 30
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform _assert_member(p_household_id, p_member_id, 'forbidden');
  if p_payload is null then
    delete from assistant_state where member_id = p_member_id;
  else
    insert into assistant_state (member_id, household_id, payload, expires_at)
    values (p_member_id, p_household_id, p_payload,
      now() + make_interval(mins => least(greatest(coalesce(p_ttl_minutes, 30), 1), 1440)))
    on conflict (member_id) do update set
      payload = excluded.payload,
      expires_at = excluded.expires_at,
      updated_at = now();
  end if;
  return '{"ok": true}'::jsonb;
end;
$$;

revoke execute on function public.get_assistant_state(uuid, uuid) from public;
revoke execute on function public.set_assistant_state(uuid, uuid, jsonb, integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.assistant_state from anon, authenticated;
    revoke execute on function public.get_assistant_state(uuid, uuid) from anon, authenticated;
    revoke execute on function public.set_assistant_state(uuid, uuid, jsonb, integer)
      from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.get_assistant_state(uuid, uuid) to service_role;
    grant execute on function public.set_assistant_state(uuid, uuid, jsonb, integer)
      to service_role;
  end if;
end;
$$;
