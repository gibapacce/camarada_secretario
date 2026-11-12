-- Telegram: vinculação de uma pessoa ao seu usuário do Telegram por código de uso único.
-- O código vale por 15 minutos, é guardado só como hash e some depois de usado.

alter table public.household_members add column telegram_chat_id bigint;

create table public.telegram_link_codes (
  code_hash text primary key,
  household_id uuid not null,
  member_id uuid not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (household_id, member_id)
    references public.household_members (household_id, id) on delete cascade
);

alter table public.telegram_link_codes enable row level security;

-- Contexto do membro (usado pelo painel e pelo Telegram).
create function public._member_context_json(p_member public.household_members)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_since timestamptz := coalesce(p_member.guidance_started_at, p_member.created_at);
begin
  return jsonb_build_object(
    'ok', true,
    'member', jsonb_build_object(
      'id', p_member.id,
      'household_id', p_member.household_id,
      'display_name', p_member.display_name,
      'role', p_member.role,
      'persona_intensity', p_member.persona_intensity,
      'guidance_mode', p_member.guidance_mode,
      'guidance_since', v_since,
      'guided_actions', (
        select count(*) from task_events e
        join tasks t on t.household_id = e.household_id and t.id = e.task_id
        where e.actor_member_id = p_member.id and e.created_at >= v_since and not t.is_tutorial
      ),
      'tutorial_step', p_member.tutorial_step,
      'tutorial_paused', p_member.tutorial_paused,
      'tips_seen', to_jsonb(p_member.tips_seen),
      'telegram_linked', p_member.telegram_user_id is not null
    ),
    'household', (
      select jsonb_build_object('id', h.id, 'name', h.name, 'timezone', h.timezone)
      from households h where h.id = p_member.household_id
    ),
    'members', (
      select jsonb_agg(
        jsonb_build_object('id', m.id, 'display_name', m.display_name, 'role', m.role)
        order by m.display_name
      )
      from household_members m
      where m.household_id = p_member.household_id and m.is_active
    )
  );
end;
$$;

create or replace function public.get_member_context(p_auth_user_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_member household_members;
begin
  select * into v_member from household_members
  where auth_user_id = p_auth_user_id and is_active;
  if not found then
    return '{"ok": false, "error": "not_a_member"}'::jsonb;
  end if;
  return _member_context_json(v_member);
end;
$$;

create function public.get_member_context_by_telegram(p_telegram_user_id bigint)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_member household_members;
begin
  select * into v_member from household_members
  where telegram_user_id = p_telegram_user_id and is_active;
  if not found then
    return '{"ok": false, "error": "not_a_member"}'::jsonb;
  end if;
  return _member_context_json(v_member);
end;
$$;

-- Gera um código novo (o anterior da mesma pessoa deixa de valer). O texto do código só existe
-- na resposta desta função.
create function public.create_telegram_link_code(p_household_id uuid, p_actor_member_id uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_code text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
begin
  perform _assert_member(p_household_id, p_actor_member_id, 'forbidden');
  delete from telegram_link_codes where expires_at < now() or member_id = p_actor_member_id;
  insert into telegram_link_codes (code_hash, household_id, member_id, expires_at)
  values (
    encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), p_household_id, p_actor_member_id,
    now() + interval '15 minutes'
  );
  return jsonb_build_object('ok', true, 'code', v_code, 'expires_in_minutes', 15);
end;
$$;

-- Usa o código enviado ao bot. Resultados de negócio: invalid_code, telegram_already_linked.
create function public.link_telegram_member(
  p_code text,
  p_telegram_user_id bigint,
  p_telegram_chat_id bigint
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_link telegram_link_codes;
  v_member household_members;
begin
  select * into v_link from telegram_link_codes
  where code_hash = encode(sha256(convert_to(upper(btrim(p_code)), 'UTF8')), 'hex')
    and expires_at > now()
  for update;
  if not found then
    return '{"ok": false, "error": "invalid_code"}'::jsonb;
  end if;

  if exists (
    select 1 from household_members
    where telegram_user_id = p_telegram_user_id and id <> v_link.member_id
  ) then
    return '{"ok": false, "error": "telegram_already_linked"}'::jsonb;
  end if;

  update household_members
  set telegram_user_id = p_telegram_user_id, telegram_chat_id = p_telegram_chat_id
  where id = v_link.member_id and is_active
  returning * into v_member;
  if not found then
    return '{"ok": false, "error": "invalid_code"}'::jsonb;
  end if;

  delete from telegram_link_codes where code_hash = v_link.code_hash;
  return jsonb_build_object(
    'ok', true,
    'event', 'telegram_linked',
    'member', jsonb_build_object(
      'id', v_member.id, 'household_id', v_member.household_id,
      'display_name', v_member.display_name
    )
  );
end;
$$;

create function public.unlink_telegram_member(p_household_id uuid, p_actor_member_id uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform _assert_member(p_household_id, p_actor_member_id, 'forbidden');
  update household_members set telegram_user_id = null, telegram_chat_id = null
  where id = p_actor_member_id;
  delete from telegram_link_codes where member_id = p_actor_member_id;
  return '{"ok": true, "event": "telegram_unlinked"}'::jsonb;
end;
$$;

revoke execute on function public._member_context_json(public.household_members) from public;
revoke execute on function public.get_member_context_by_telegram(bigint) from public;
revoke execute on function public.create_telegram_link_code(uuid, uuid) from public;
revoke execute on function public.link_telegram_member(text, bigint, bigint) from public;
revoke execute on function public.unlink_telegram_member(uuid, uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.telegram_link_codes from anon, authenticated;
    revoke execute on function public._member_context_json(public.household_members)
      from anon, authenticated;
    revoke execute on function public.get_member_context_by_telegram(bigint)
      from anon, authenticated;
    revoke execute on function public.create_telegram_link_code(uuid, uuid)
      from anon, authenticated;
    revoke execute on function public.link_telegram_member(text, bigint, bigint)
      from anon, authenticated;
    revoke execute on function public.unlink_telegram_member(uuid, uuid) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public._member_context_json(public.household_members)
      to service_role;
    grant execute on function public.get_member_context_by_telegram(bigint) to service_role;
    grant execute on function public.create_telegram_link_code(uuid, uuid) to service_role;
    grant execute on function public.link_telegram_member(text, bigint, bigint) to service_role;
    grant execute on function public.unlink_telegram_member(uuid, uuid) to service_role;
  end if;
end;
$$;
