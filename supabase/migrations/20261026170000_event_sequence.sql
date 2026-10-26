-- Ordem dos eventos por sequência crescente. Carimbos de tempo podem empatar (resolução do
-- relógio), e o "desfazer" deixava de detectar que outra pessoa mexeu depois na tarefa.

alter table public.task_events add column seq bigint generated always as identity;
alter table public.task_events add constraint task_events_seq_key unique (seq);

drop index public.task_events_task_idx;
drop index public.task_events_actor_idx;
create index task_events_task_idx on public.task_events (task_id, seq);
create index task_events_actor_idx on public.task_events (household_id, actor_member_id, seq);

create or replace function public.undo_last_action(
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
  order by e.seq desc
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
      and later.seq > v_event.seq
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

create or replace function public.get_task(p_household_id uuid, p_task_id uuid)
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
      select coalesce(jsonb_agg(to_jsonb(e) - 'seq' order by e.seq), '[]'::jsonb)
      from task_events e where e.task_id = v_task.id
    )
  );
end;
$$;
