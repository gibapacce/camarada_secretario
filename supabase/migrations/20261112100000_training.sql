-- Missão de Treino e dicas do Modo Aprendiz (por pessoa).
-- tutorial_step (já existente): nulo = sem treino; 1 a 5 = passo atual.
-- tutorial_paused: treino pausado. tips_seen: dicas e avisos já mostrados (cada um uma vez).

alter table public.household_members
  add column tutorial_paused boolean not null default false,
  add column tips_seen text[] not null default '{}'
    check (cardinality(tips_seen) <= 20);

-- Apaga tarefas de treino antigas (24 h por padrão). O Cron da Fase 8 também deve chamá-la.
create function public.cleanup_tutorial_tasks(p_max_age interval default interval '24 hours')
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  delete from tasks where is_tutorial and created_at < now() - p_max_age;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Ações: start (começa do passo 1), step (vai ao passo p_step), pause, resume, finish
-- (encerra e apaga as tarefas de treino da pessoa) e tip (marca uma dica como mostrada).
create function public.update_member_training(
  p_household_id uuid,
  p_actor_member_id uuid,
  p_action text,
  p_step integer default null,
  p_tip text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_member household_members;
begin
  perform _assert_member(p_household_id, p_actor_member_id, 'forbidden');
  if p_action not in ('start', 'step', 'pause', 'resume', 'finish', 'tip') then
    perform _fail('invalid_input', 'p_action');
  end if;

  perform cleanup_tutorial_tasks();

  if p_action in ('start', 'finish') then
    delete from tasks
    where is_tutorial and household_id = p_household_id and created_by_member_id = p_actor_member_id;
  end if;

  if p_action = 'start' then
    update household_members set tutorial_step = 1, tutorial_paused = false
    where id = p_actor_member_id;
  elsif p_action = 'finish' then
    update household_members set tutorial_step = null, tutorial_paused = false
    where id = p_actor_member_id;
  elsif p_action = 'step' then
    if p_step is null or p_step not between 1 and 5 then
      perform _fail('invalid_input', 'p_step');
    end if;
    update household_members set tutorial_step = p_step
    where id = p_actor_member_id and tutorial_step is not null;
  elsif p_action = 'pause' then
    update household_members set tutorial_paused = true
    where id = p_actor_member_id and tutorial_step is not null;
  elsif p_action = 'resume' then
    update household_members set tutorial_paused = false where id = p_actor_member_id;
  else
    if p_tip is null or p_tip !~ '^[a-z_]{1,40}$' then
      perform _fail('invalid_input', 'p_tip');
    end if;
    update household_members set tips_seen = array_append(tips_seen, p_tip)
    where id = p_actor_member_id and not (p_tip = any (tips_seen));
  end if;

  select * into v_member from household_members where id = p_actor_member_id;
  return jsonb_build_object(
    'ok', true,
    'event', 'training_updated',
    'training', jsonb_build_object(
      'tutorial_step', v_member.tutorial_step,
      'tutorial_paused', v_member.tutorial_paused,
      'tips_seen', v_member.tips_seen
    )
  );
end;
$$;

-- Contexto do membro, agora com o estado do treino e o uso do Modo Aprendiz.
create or replace function public.get_member_context(p_auth_user_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_member household_members;
  v_since timestamptz;
begin
  select * into v_member from household_members
  where auth_user_id = p_auth_user_id and is_active;
  if not found then
    return '{"ok": false, "error": "not_a_member"}'::jsonb;
  end if;
  v_since := coalesce(v_member.guidance_started_at, v_member.created_at);

  return jsonb_build_object(
    'ok', true,
    'member', jsonb_build_object(
      'id', v_member.id,
      'household_id', v_member.household_id,
      'display_name', v_member.display_name,
      'role', v_member.role,
      'persona_intensity', v_member.persona_intensity,
      'guidance_mode', v_member.guidance_mode,
      'guidance_since', v_since,
      'guided_actions', (
        select count(*) from task_events e
        join tasks t on t.household_id = e.household_id and t.id = e.task_id
        where e.actor_member_id = v_member.id and e.created_at >= v_since and not t.is_tutorial
      ),
      'tutorial_step', v_member.tutorial_step,
      'tutorial_paused', v_member.tutorial_paused,
      'tips_seen', to_jsonb(v_member.tips_seen)
    ),
    'household', (
      select jsonb_build_object('id', h.id, 'name', h.name, 'timezone', h.timezone)
      from households h where h.id = v_member.household_id
    ),
    'members', (
      select jsonb_agg(
        jsonb_build_object('id', m.id, 'display_name', m.display_name, 'role', m.role)
        order by m.display_name
      )
      from household_members m
      where m.household_id = v_member.household_id and m.is_active
    )
  );
end;
$$;

revoke execute on function public.cleanup_tutorial_tasks(interval) from public;
revoke execute on function public.update_member_training(uuid, uuid, text, integer, text)
  from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.cleanup_tutorial_tasks(interval) from anon, authenticated;
    revoke execute on function public.update_member_training(uuid, uuid, text, integer, text)
      from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.cleanup_tutorial_tasks(interval) to service_role;
    grant execute on function public.update_member_training(uuid, uuid, text, integer, text)
      to service_role;
  end if;
end;
$$;
