-- Regras de negócio transacionais. O Worker chama estas funções via RPC (service role).
-- Erros de autorização/validação: exceção (rollback total). Resultados de negócio: jsonb {ok, ...}.

-- ---------------------------------------------------------------- utilitários

create function public._fail(p_message text, p_detail text default null)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception using errcode = 'P0001', message = p_message, detail = coalesce(p_detail, '');
end;
$$;

create function public._assert_member(p_household_id uuid, p_member_id uuid, p_error text)
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if p_member_id is null or not exists (
    select 1 from household_members m
    where m.id = p_member_id and m.household_id = p_household_id and m.is_active
  ) then
    perform _fail(p_error);
  end if;
end;
$$;

-- Campos mutáveis de uma tarefa, usados no histórico e no "desfazer".
create function public._task_snapshot(p_task public.tasks)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'title', p_task.title,
    'description', p_task.description,
    'status', p_task.status,
    'priority', p_task.priority,
    'effort', p_task.effort,
    'category', p_task.category,
    'room', p_task.room,
    'assigned_to_member_id', p_task.assigned_to_member_id,
    'due_at', p_task.due_at,
    'completed_at', p_task.completed_at,
    'completed_by_member_id', p_task.completed_by_member_id
  );
$$;

create function public._task_json(p_task public.tasks)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when p_task.id is null then null else
    to_jsonb(p_task) || jsonb_build_object(
      'is_overdue',
      p_task.status in ('pending', 'in_progress') and p_task.due_at is not null and p_task.due_at < now()
    )
  end;
$$;

-- ---------------------------------------------------------------- idempotência

-- Chave no formato "<provider>:<id>" (ex.: "telegram:12345:678"). Retorna o resultado já gravado
-- se a chave foi processada; senão reserva a chave e retorna null.
create function public._idem_begin(p_household_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_provider text;
  v_id text;
  v_household uuid;
  v_result jsonb;
begin
  if p_idempotency_key is null then
    return null;
  end if;
  v_provider := split_part(p_idempotency_key, ':', 1);
  v_id := substr(p_idempotency_key, char_length(v_provider) + 2);
  if v_provider not in ('telegram', 'web', 'system') or v_id = '' then
    perform _fail('invalid_input', 'idempotency_key');
  end if;

  insert into processed_messages (provider, provider_message_id, household_id)
  values (v_provider, v_id, p_household_id)
  on conflict do nothing;
  if found then
    return null;
  end if;

  select household_id, result_reference into v_household, v_result
  from processed_messages
  where provider = v_provider and provider_message_id = v_id;

  if v_household <> p_household_id then
    perform _fail('idempotency_key_conflict');
  end if;
  return coalesce(v_result, '{"ok": false, "error": "in_progress"}'::jsonb)
    || '{"replayed": true}'::jsonb;
end;
$$;

create function public._idem_finish(p_idempotency_key text, p_result jsonb)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_provider text := split_part(p_idempotency_key, ':', 1);
begin
  if p_idempotency_key is null then
    return;
  end if;
  update processed_messages
  set processing_status = 'done', result_reference = p_result
  where provider = v_provider
    and provider_message_id = substr(p_idempotency_key, char_length(v_provider) + 2);
end;
$$;

-- ---------------------------------------------------------------- recorrência

-- Datas contadas a partir de starts_on. Mensal em dia inexistente usa o último dia do mês.
create function public._recurrence_matches(p_rule public.task_recurrence_rules, p_day date)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_months integer;
  v_last_day integer;
begin
  if p_day < p_rule.starts_on then
    return false;
  end if;
  case p_rule.frequency
    when 'daily' then
      return (p_day - p_rule.starts_on) % p_rule.interval_count = 0;
    when 'weekly' then
      return extract(dow from p_day)::smallint = any (p_rule.by_weekday)
        and ((date_trunc('week', p_day)::date - date_trunc('week', p_rule.starts_on)::date) / 7)
          % p_rule.interval_count = 0;
    when 'monthly' then
      v_months := (extract(year from p_day)::integer * 12 + extract(month from p_day)::integer)
        - (extract(year from p_rule.starts_on)::integer * 12
          + extract(month from p_rule.starts_on)::integer);
      v_last_day := extract(day from date_trunc('month', p_day) + interval '1 month - 1 day')::integer;
      return v_months % p_rule.interval_count = 0
        and extract(day from p_day)::integer = least(p_rule.day_of_month, v_last_day);
    else
      return false;
  end case;
end;
$$;

-- Primeira ocorrência estritamente posterior a p_after, no horário local do fuso da casa.
create function public._next_occurrence(
  p_rule public.task_recurrence_rules,
  p_timezone text,
  p_after timestamptz
)
returns timestamptz
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_day date := greatest((p_after at time zone p_timezone)::date, p_rule.starts_on);
  v_candidate timestamptz;
begin
  for i in 0..4000 loop
    if _recurrence_matches(p_rule, v_day) then
      v_candidate := (v_day + p_rule.local_time) at time zone p_timezone;
      if v_candidate > p_after then
        return v_candidate;
      end if;
    end if;
    v_day := v_day + 1;
  end loop;
  return null;
end;
$$;

-- Gera (ou reaproveita) a próxima ocorrência após concluir/cancelar uma ocorrência.
-- A regra é bloqueada (FOR UPDATE), então chamadas concorrentes não duplicam.
create function public._spawn_next_occurrence(p_task public.tasks)
returns public.tasks
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rule task_recurrence_rules;
  v_timezone text;
  v_due timestamptz;
  v_next tasks;
begin
  if p_task.recurrence_rule_id is null then
    return null;
  end if;
  select * into v_rule from task_recurrence_rules where id = p_task.recurrence_rule_id for update;
  if not v_rule.is_active then
    return null;
  end if;
  select timezone into v_timezone from households where id = p_task.household_id;
  v_due := _next_occurrence(v_rule, v_timezone, greatest(coalesce(p_task.due_at, now()), now()));
  if v_due is null then
    return null;
  end if;

  select * into v_next from tasks
  where recurrence_rule_id = v_rule.id and due_at = v_due
  for update;

  if found and v_next.status = 'cancelled' then
    update tasks set status = 'pending', updated_at = now() where id = v_next.id
    returning * into v_next;
    insert into task_events (household_id, task_id, actor_member_id, event_type, old_values, new_values)
    values (v_next.household_id, v_next.id, null, 'reopened',
      '{"status": "cancelled"}'::jsonb, '{"status": "pending"}'::jsonb);
  elsif not found then
    insert into tasks (
      household_id, title, description, priority, effort, is_tutorial, category, room,
      assigned_to_member_id, created_by_member_id, due_at, recurrence_rule_id
    )
    values (
      p_task.household_id, p_task.title, p_task.description, p_task.priority, p_task.effort,
      p_task.is_tutorial, p_task.category, p_task.room, p_task.assigned_to_member_id,
      p_task.created_by_member_id, v_due, v_rule.id
    )
    returning * into v_next;
    insert into task_events (household_id, task_id, actor_member_id, event_type, new_values)
    values (v_next.household_id, v_next.id, null, 'created', _task_snapshot(v_next));
  end if;

  update task_recurrence_rules set next_occurrence_at = v_due where id = v_rule.id;
  return v_next;
end;
$$;

-- ---------------------------------------------------------------- comandos

create function public.create_task(
  p_household_id uuid,
  p_actor_member_id uuid,
  p_title text,
  p_description text default null,
  p_assigned_to_member_id uuid default null,
  p_due_at timestamptz default null,
  p_priority text default 'normal',
  p_effort integer default null,
  p_category text default null,
  p_room text default null,
  p_is_tutorial boolean default false,
  p_recurrence jsonb default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_replay jsonb;
  v_rule task_recurrence_rules;
  v_timezone text;
  v_due timestamptz := p_due_at;
  v_task tasks;
  v_result jsonb;
begin
  perform _assert_member(p_household_id, p_actor_member_id, 'forbidden');
  v_replay := _idem_begin(p_household_id, p_idempotency_key);
  if v_replay is not null then
    return v_replay;
  end if;
  if p_assigned_to_member_id is not null then
    perform _assert_member(p_household_id, p_assigned_to_member_id, 'invalid_assignee');
  end if;

  if p_recurrence is not null then
    if p_due_at is not null then
      perform _fail('invalid_input', 'use due_at ou recorrência, não ambos');
    end if;
    select timezone into v_timezone from households where id = p_household_id;
    insert into task_recurrence_rules (
      household_id, frequency, interval_count, by_weekday, day_of_month, local_time, starts_on
    )
    values (
      p_household_id,
      p_recurrence ->> 'frequency',
      coalesce((p_recurrence ->> 'interval')::smallint, 1),
      case when jsonb_typeof(p_recurrence -> 'by_weekday') = 'array' then
        array(select jsonb_array_elements_text(p_recurrence -> 'by_weekday')::smallint)
      end,
      (p_recurrence ->> 'day_of_month')::smallint,
      (p_recurrence ->> 'local_time')::time,
      coalesce((p_recurrence ->> 'starts_on')::date, (now() at time zone v_timezone)::date)
    )
    returning * into v_rule;
    v_due := _next_occurrence(v_rule, v_timezone, now());
    if v_due is null then
      perform _fail('invalid_input', 'recorrência sem ocorrências');
    end if;
    update task_recurrence_rules set next_occurrence_at = v_due where id = v_rule.id;
  end if;

  insert into tasks (
    household_id, title, description, priority, effort, is_tutorial, category, room,
    assigned_to_member_id, created_by_member_id, due_at, recurrence_rule_id
  )
  values (
    p_household_id, btrim(p_title), nullif(btrim(p_description), ''),
    coalesce(p_priority, 'normal'), p_effort, coalesce(p_is_tutorial, false),
    nullif(btrim(p_category), ''), nullif(btrim(p_room), ''),
    p_assigned_to_member_id, p_actor_member_id, v_due, v_rule.id
  )
  returning * into v_task;

  insert into task_events (household_id, task_id, actor_member_id, event_type, new_values)
  values (p_household_id, v_task.id, p_actor_member_id, 'created', _task_snapshot(v_task));

  v_result := jsonb_build_object('ok', true, 'event', 'task_created', 'task', _task_json(v_task));
  perform _idem_finish(p_idempotency_key, v_result);
  return v_result;
end;
$$;

create function public.complete_task(
  p_household_id uuid,
  p_actor_member_id uuid,
  p_task_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_replay jsonb;
  v_task tasks;
  v_done tasks;
  v_next tasks;
  v_result jsonb;
begin
  perform _assert_member(p_household_id, p_actor_member_id, 'forbidden');
  v_replay := _idem_begin(p_household_id, p_idempotency_key);
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_task from tasks
  where id = p_task_id and household_id = p_household_id
  for update;

  if not found then
    v_result := '{"ok": false, "error": "task_not_found"}'::jsonb;
  elsif v_task.status = 'completed' then
    v_result := jsonb_build_object('ok', true, 'event', 'task_already_completed', 'task', _task_json(v_task));
  elsif v_task.status = 'cancelled' then
    v_result := jsonb_build_object('ok', false, 'error', 'task_cancelled', 'task', _task_json(v_task));
  else
    update tasks
    set status = 'completed', completed_at = now(), completed_by_member_id = p_actor_member_id,
      updated_at = now()
    where id = v_task.id
    returning * into v_done;
    v_next := _spawn_next_occurrence(v_done);

    insert into task_events (household_id, task_id, actor_member_id, event_type, old_values, new_values)
    values (
      p_household_id, v_task.id, p_actor_member_id, 'completed',
      jsonb_build_object('status', v_task.status, 'completed_at', null, 'completed_by_member_id', null),
      jsonb_build_object(
        'status', 'completed', 'completed_at', v_done.completed_at,
        'completed_by_member_id', p_actor_member_id, 'next_task_id', v_next.id
      )
    );
    v_result := jsonb_build_object(
      'ok', true, 'event', 'task_completed',
      'task', _task_json(v_done), 'next_task', _task_json(v_next)
    );
  end if;

  perform _idem_finish(p_idempotency_key, v_result);
  return v_result;
end;
$$;

create function public.reopen_task(
  p_household_id uuid,
  p_actor_member_id uuid,
  p_task_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_replay jsonb;
  v_task tasks;
  v_open tasks;
  v_result jsonb;
begin
  perform _assert_member(p_household_id, p_actor_member_id, 'forbidden');
  v_replay := _idem_begin(p_household_id, p_idempotency_key);
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_task from tasks
  where id = p_task_id and household_id = p_household_id
  for update;

  if not found then
    v_result := '{"ok": false, "error": "task_not_found"}'::jsonb;
  elsif v_task.status in ('pending', 'in_progress') then
    v_result := jsonb_build_object('ok', true, 'event', 'task_already_open', 'task', _task_json(v_task));
  else
    update tasks
    set status = 'pending', completed_at = null, completed_by_member_id = null, updated_at = now()
    where id = v_task.id
    returning * into v_open;
    insert into task_events (household_id, task_id, actor_member_id, event_type, old_values, new_values)
    values (
      p_household_id, v_task.id, p_actor_member_id, 'reopened',
      jsonb_build_object(
        'status', v_task.status, 'completed_at', v_task.completed_at,
        'completed_by_member_id', v_task.completed_by_member_id
      ),
      '{"status": "pending", "completed_at": null, "completed_by_member_id": null}'::jsonb
    );
    v_result := jsonb_build_object('ok', true, 'event', 'task_reopened', 'task', _task_json(v_open));
  end if;

  perform _idem_finish(p_idempotency_key, v_result);
  return v_result;
end;
$$;

-- Cancelar uma ocorrência recorrente gera a próxima; p_stop_recurrence encerra a série.
create function public.cancel_task(
  p_household_id uuid,
  p_actor_member_id uuid,
  p_task_id uuid,
  p_stop_recurrence boolean default false,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_replay jsonb;
  v_task tasks;
  v_cancelled tasks;
  v_next tasks;
  v_stopped boolean := false;
  v_result jsonb;
begin
  perform _assert_member(p_household_id, p_actor_member_id, 'forbidden');
  v_replay := _idem_begin(p_household_id, p_idempotency_key);
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_task from tasks
  where id = p_task_id and household_id = p_household_id
  for update;

  if not found then
    v_result := '{"ok": false, "error": "task_not_found"}'::jsonb;
  elsif v_task.status = 'cancelled' then
    v_result := jsonb_build_object('ok', true, 'event', 'task_already_cancelled', 'task', _task_json(v_task));
  elsif v_task.status = 'completed' then
    v_result := jsonb_build_object('ok', false, 'error', 'task_completed', 'task', _task_json(v_task));
  else
    update tasks set status = 'cancelled', updated_at = now()
    where id = v_task.id
    returning * into v_cancelled;

    if v_task.recurrence_rule_id is not null then
      if coalesce(p_stop_recurrence, false) then
        update task_recurrence_rules set is_active = false where id = v_task.recurrence_rule_id;
        v_stopped := true;
      else
        v_next := _spawn_next_occurrence(v_cancelled);
      end if;
    end if;

    insert into task_events (household_id, task_id, actor_member_id, event_type, old_values, new_values)
    values (
      p_household_id, v_task.id, p_actor_member_id, 'cancelled',
      jsonb_build_object('status', v_task.status),
      jsonb_build_object('status', 'cancelled', 'next_task_id', v_next.id, 'recurrence_stopped', v_stopped)
    );
    v_result := jsonb_build_object(
      'ok', true, 'event', 'task_cancelled', 'task', _task_json(v_cancelled),
      'next_task', _task_json(v_next), 'recurrence_stopped', v_stopped
    );
  end if;

  perform _idem_finish(p_idempotency_key, v_result);
  return v_result;
end;
$$;

-- p_changes: chave ausente = não altera; chave com null = limpa o campo.
create function public.update_task(
  p_household_id uuid,
  p_actor_member_id uuid,
  p_task_id uuid,
  p_changes jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  c_allowed constant text[] := array[
    'title', 'description', 'assigned_to_member_id', 'due_at', 'priority', 'effort', 'category', 'room'
  ];
  v_replay jsonb;
  v_task tasks;
  v_updated tasks;
  v_before jsonb;
  v_after jsonb;
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  v_key text;
  v_result jsonb;
begin
  perform _assert_member(p_household_id, p_actor_member_id, 'forbidden');
  if jsonb_typeof(p_changes) is distinct from 'object' or exists (
    select 1 from jsonb_object_keys(p_changes) k where k <> all (c_allowed)
  ) then
    perform _fail('invalid_input', 'p_changes');
  end if;
  v_replay := _idem_begin(p_household_id, p_idempotency_key);
  if v_replay is not null then
    return v_replay;
  end if;
  if p_changes ? 'assigned_to_member_id' and p_changes ->> 'assigned_to_member_id' is not null then
    perform _assert_member(p_household_id, (p_changes ->> 'assigned_to_member_id')::uuid, 'invalid_assignee');
  end if;

  select * into v_task from tasks
  where id = p_task_id and household_id = p_household_id
  for update;

  if not found then
    v_result := '{"ok": false, "error": "task_not_found"}'::jsonb;
  else
    update tasks set
      title = case when p_changes ? 'title' then btrim(p_changes ->> 'title') else title end,
      description = case when p_changes ? 'description'
        then nullif(btrim(p_changes ->> 'description'), '') else description end,
      assigned_to_member_id = case when p_changes ? 'assigned_to_member_id'
        then (p_changes ->> 'assigned_to_member_id')::uuid else assigned_to_member_id end,
      due_at = case when p_changes ? 'due_at' then (p_changes ->> 'due_at')::timestamptz else due_at end,
      priority = case when p_changes ? 'priority' then p_changes ->> 'priority' else priority end,
      effort = case when p_changes ? 'effort' then (p_changes ->> 'effort')::smallint else effort end,
      category = case when p_changes ? 'category'
        then nullif(btrim(p_changes ->> 'category'), '') else category end,
      room = case when p_changes ? 'room' then nullif(btrim(p_changes ->> 'room'), '') else room end
    where id = v_task.id
    returning * into v_updated;

    v_before := _task_snapshot(v_task);
    v_after := _task_snapshot(v_updated);
    foreach v_key in array c_allowed loop
      if v_before -> v_key is distinct from v_after -> v_key then
        v_old := v_old || jsonb_build_object(v_key, v_before -> v_key);
        v_new := v_new || jsonb_build_object(v_key, v_after -> v_key);
      end if;
    end loop;

    if v_new = '{}'::jsonb then
      v_result := jsonb_build_object('ok', true, 'event', 'task_unchanged', 'task', _task_json(v_task));
    else
      update tasks set updated_at = now() where id = v_task.id returning * into v_updated;
      insert into task_events (household_id, task_id, actor_member_id, event_type, old_values, new_values)
      values (p_household_id, v_task.id, p_actor_member_id, 'updated', v_old, v_new);
      v_result := jsonb_build_object(
        'ok', true, 'event', 'task_updated', 'task', _task_json(v_updated), 'changes', v_new
      );
    end if;
  end if;

  perform _idem_finish(p_idempotency_key, v_result);
  return v_result;
end;
$$;

-- Desfaz a última ação da própria pessoa dentro da janela, com evento compensatório.
-- Nada é apagado: o evento original e o evento "undone" ficam no histórico.
create function public.undo_last_action(
  p_household_id uuid,
  p_actor_member_id uuid,
  p_window_minutes integer default 15,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_replay jsonb;
  v_event task_events;
  v_task tasks;
  v_restored tasks;
  v_restore jsonb;
  v_extra jsonb := '{}'::jsonb;
  v_next tasks;
  v_result jsonb;
begin
  perform _assert_member(p_household_id, p_actor_member_id, 'forbidden');
  v_replay := _idem_begin(p_household_id, p_idempotency_key);
  if v_replay is not null then
    return v_replay;
  end if;

  select e.* into v_event
  from task_events e
  where e.household_id = p_household_id
    and e.actor_member_id = p_actor_member_id
    and e.event_type <> 'undone'
    and not exists (select 1 from task_events u where u.undoes_event_id = e.id)
  order by e.created_at desc
  limit 1;

  if not found
    or v_event.created_at < now() - make_interval(mins => least(greatest(p_window_minutes, 1), 60)) then
    v_result := '{"ok": false, "error": "nothing_to_undo"}'::jsonb;
    perform _idem_finish(p_idempotency_key, v_result);
    return v_result;
  end if;

  select * into v_task from tasks where id = v_event.task_id for update;

  if exists (
    select 1 from task_events later
    where later.task_id = v_event.task_id
      and later.created_at > v_event.created_at
      and later.event_type <> 'undone'
      and not exists (select 1 from task_events u where u.undoes_event_id = later.id)
  ) then
    v_result := jsonb_build_object('ok', false, 'error', 'undo_conflict', 'task', _task_json(v_task));
    perform _idem_finish(p_idempotency_key, v_result);
    return v_result;
  end if;

  v_restore := case v_event.event_type
    when 'created' then '{"status": "cancelled"}'::jsonb
    else v_event.old_values - 'next_task_id' - 'recurrence_stopped'
  end;
  v_restored := jsonb_populate_record(v_task, v_restore);

  update tasks set
    title = v_restored.title,
    description = v_restored.description,
    status = v_restored.status,
    priority = v_restored.priority,
    effort = v_restored.effort,
    category = v_restored.category,
    room = v_restored.room,
    assigned_to_member_id = v_restored.assigned_to_member_id,
    due_at = v_restored.due_at,
    completed_at = v_restored.completed_at,
    completed_by_member_id = v_restored.completed_by_member_id,
    updated_at = now()
  where id = v_task.id
  returning * into v_restored;

  -- Efeitos colaterais: próxima ocorrência gerada automaticamente e série encerrada.
  if v_event.new_values ->> 'next_task_id' is not null then
    select * into v_next from tasks
    where id = (v_event.new_values ->> 'next_task_id')::uuid
    for update;
    if found and v_next.status = 'pending' and not exists (
      select 1 from task_events e
      where e.task_id = v_next.id and (e.actor_member_id is not null or e.event_type not in ('created', 'reopened'))
    ) then
      update tasks set status = 'cancelled', updated_at = now() where id = v_next.id;
      insert into task_events (household_id, task_id, actor_member_id, event_type, old_values, new_values)
      values (p_household_id, v_next.id, null, 'cancelled',
        '{"status": "pending"}'::jsonb, '{"status": "cancelled", "reason": "undo"}'::jsonb);
      v_extra := v_extra || jsonb_build_object('cancelled_next_task_id', v_next.id);
    end if;
  end if;
  if (v_event.new_values ->> 'recurrence_stopped')::boolean
    or (v_event.event_type = 'created' and v_task.recurrence_rule_id is not null) then
    update task_recurrence_rules
    set is_active = (v_event.event_type <> 'created')
    where id = v_task.recurrence_rule_id;
    v_extra := v_extra || jsonb_build_object('recurrence_active', v_event.event_type <> 'created');
  end if;

  insert into task_events (
    household_id, task_id, actor_member_id, event_type, old_values, new_values, undoes_event_id
  )
  values (
    p_household_id, v_task.id, p_actor_member_id, 'undone',
    (select jsonb_object_agg(k, _task_snapshot(v_task) -> k) from jsonb_object_keys(v_restore) k),
    v_restore || v_extra,
    v_event.id
  );

  v_result := jsonb_build_object(
    'ok', true, 'event', 'action_undone', 'undone_event_type', v_event.event_type,
    'task', _task_json(v_restored)
  ) || v_extra;
  perform _idem_finish(p_idempotency_key, v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------- consultas

-- Visões: open | overdue | due (intervalo p_from..p_to) | completed (intervalo opcional) | all.
-- Tarefas de treino (is_tutorial) ficam fora, salvo p_include_tutorial.
create function public.list_tasks(
  p_household_id uuid,
  p_view text default 'open',
  p_assigned_to_member_id uuid default null,
  p_only_shared boolean default false,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_include_tutorial boolean default false,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_tasks jsonb;
begin
  if p_view not in ('open', 'overdue', 'due', 'completed', 'all') then
    perform _fail('invalid_input', 'p_view');
  end if;

  select coalesce(
    jsonb_agg(_task_json(s.t) order by s.ord_completed desc nulls last, (s.t).due_at nulls last,
      (s.t).created_at),
    '[]'::jsonb
  )
  into v_tasks
  from (
    select x as t,
      case when p_view = 'completed' then x.completed_at end as ord_completed
    from tasks x
    where x.household_id = p_household_id
      and (p_include_tutorial or not x.is_tutorial)
      and (p_assigned_to_member_id is null or x.assigned_to_member_id = p_assigned_to_member_id)
      and (not p_only_shared or x.assigned_to_member_id is null)
      and case p_view
        when 'open' then x.status in ('pending', 'in_progress')
        when 'overdue' then x.status in ('pending', 'in_progress') and x.due_at < now()
        when 'due' then x.status in ('pending', 'in_progress')
          and x.due_at >= coalesce(p_from, '-infinity') and x.due_at < coalesce(p_to, 'infinity')
        when 'completed' then x.status = 'completed'
          and x.completed_at >= coalesce(p_from, '-infinity')
          and x.completed_at < coalesce(p_to, 'infinity')
        else true
      end
    order by ord_completed desc nulls last, x.due_at nulls last, x.created_at
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) s;

  return jsonb_build_object('ok', true, 'view', p_view, 'tasks', v_tasks);
end;
$$;

create function public.get_task(p_household_id uuid, p_task_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_task tasks;
begin
  select * into v_task from tasks where id = p_task_id and household_id = p_household_id;
  if not found then
    return '{"ok": false, "error": "task_not_found"}'::jsonb;
  end if;
  return jsonb_build_object(
    'ok', true,
    'task', _task_json(v_task),
    'events', (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at), '[]'::jsonb)
      from task_events e where e.task_id = v_task.id
    )
  );
end;
$$;

-- ---------------------------------------------------------------- permissões

-- Funções só podem ser chamadas pelo backend. No Supabase, anon/authenticated perdem acesso.
revoke execute on all functions in schema public from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon, authenticated;
    revoke execute on all functions in schema public from anon, authenticated;
    alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
    alter default privileges in schema public revoke all on tables from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on all functions in schema public to service_role;
  end if;
end;
$$;
