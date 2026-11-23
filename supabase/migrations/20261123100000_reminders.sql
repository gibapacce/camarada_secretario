-- Fase 8: lembretes pelo Telegram, gerados e reservados pelo Cron do Worker.
-- Tipos: before_24h (24 h antes, opcional), due (no prazo) e overdue (atraso, 1 por dia).
-- Cada envio tem uma chave única (tipo + tarefa + pessoa + horário): retries nunca duplicam.

alter table public.households
  add column quiet_start time not null default '21:00',
  add column quiet_end time not null default '09:00',
  add column overdue_reminder_time time not null default '09:00',
  -- 0 = lembra o atraso todo dia, sem limite.
  add column overdue_reminder_days smallint not null default 30
    check (overdue_reminder_days between 0 and 365);

alter table public.household_members
  add column remind_before_24h boolean not null default false,
  add column remind_due boolean not null default true,
  add column remind_overdue boolean not null default true;

create table public.reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  task_id uuid not null,
  member_id uuid not null,
  reminder_type text not null check (reminder_type in ('before_24h', 'due', 'overdue')),
  scheduled_for timestamptz not null,
  -- pending: aguardando (ou retry); sending: reservado por um Cron; sent/failed/cancelled: fim.
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempt_count smallint not null default 0,
  next_attempt_at timestamptz not null,
  last_attempt_at timestamptz,
  last_error text check (char_length(last_error) <= 100),
  sent_at timestamptz,
  deduplication_key text not null unique check (char_length(deduplication_key) <= 200),
  created_at timestamptz not null default now(),
  foreign key (household_id, task_id) references public.tasks (household_id, id) on delete cascade,
  foreign key (household_id, member_id)
    references public.household_members (household_id, id) on delete cascade
);

create index reminder_deliveries_open_idx on public.reminder_deliveries (next_attempt_at)
  where status in ('pending', 'sending');
create index reminder_deliveries_task_idx on public.reminder_deliveries (task_id);

alter table public.reminder_deliveries enable row level security;

-- ---------------------------------------------------------------- horário de silêncio

create function public._in_quiet(p_local time, p_start time, p_end time)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_start = p_end then false
    when p_start < p_end then p_local >= p_start and p_local < p_end
    else p_local >= p_start or p_local < p_end
  end;
$$;

-- O Cron roda a cada 5 minutos: um horário logo antes do silêncio (ex.: 20:59) seria pulado.
-- Por isso, para calcular os horários, o silêncio começa 30 minutos antes.
create function public._quiet_margin_start(p_start time)
returns time
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_start - interval '30 minutes';
$$;

-- Lembrete no prazo que cai no silêncio é antecipado para o fim do silêncio anterior (manhã).
-- Ex.: prazo 23:59 (tarefa só com data) ou 20:45 → 09:00 do mesmo dia.
create function public._quiet_earlier(p_ts timestamptz, p_tz text, p_start time, p_end time)
returns timestamptz
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_local timestamp := p_ts at time zone p_tz;
begin
  if p_start = p_end
    or not _in_quiet(v_local::time, _quiet_margin_start(p_start), p_end) then
    return p_ts;
  end if;
  if v_local::time >= p_end then
    return (v_local::date + p_end) at time zone p_tz;
  end if;
  return (v_local::date - 1 + p_end) at time zone p_tz;
end;
$$;

-- Lembrete de 24 h que cai no silêncio vai para o limite mais próximo: 30 minutos antes do
-- silêncio ou o fim dele.
create function public._quiet_nearest(p_ts timestamptz, p_tz text, p_start time, p_end time)
returns timestamptz
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_local timestamp := p_ts at time zone p_tz;
  v_start time := _quiet_margin_start(p_start);
  v_before timestamptz;
  v_after timestamptz;
begin
  if p_start = p_end or not _in_quiet(v_local::time, v_start, p_end) then
    return p_ts;
  end if;
  v_before := (
    case when v_local::time >= v_start then v_local::date else v_local::date - 1 end + v_start
  ) at time zone p_tz;
  v_after := (
    case when v_local::time < p_end then v_local::date else v_local::date + 1 end + p_end
  ) at time zone p_tz;
  return case when p_ts - v_before <= v_after - p_ts then v_before else v_after end;
end;
$$;

-- ---------------------------------------------------------------- candidatos

-- Lembretes que deveriam existir agora. Uma tarefa coletiva (sem responsável) vai para todas as
-- pessoas ativas com Telegram. Nada é gerado durante o silêncio da casa, para tarefas de treino,
-- concluídas ou canceladas, nem para lembretes anteriores à criação da tarefa.
create function public._reminder_candidates(p_now timestamptz)
returns table (
  household_id uuid,
  task_id uuid,
  member_id uuid,
  reminder_type text,
  scheduled_for timestamptz,
  deduplication_key text
)
language sql
stable
set search_path = public, pg_temp
as $$
  with base as (
    select
      t.household_id, t.id as task_id, t.due_at, t.created_at, m.id as member_id,
      -- O prazo entra na chave: mudar o prazo gera um lembrete novo e cancela o antigo.
      extract(epoch from t.due_at)::bigint as due_epoch,
      m.remind_before_24h, m.remind_due, m.remind_overdue,
      h.timezone as tz, h.quiet_start, h.quiet_end, h.overdue_reminder_time,
      h.overdue_reminder_days,
      (p_now at time zone h.timezone)::date as today,
      _quiet_earlier(t.due_at, h.timezone, h.quiet_start, h.quiet_end) as due_slot,
      _quiet_nearest(t.due_at - interval '24 hours', h.timezone, h.quiet_start, h.quiet_end)
        as before_slot
    from tasks t
    join households h on h.id = t.household_id
    join household_members m
      on m.household_id = t.household_id
      and m.is_active
      and m.telegram_chat_id is not null
      and (t.assigned_to_member_id = m.id or t.assigned_to_member_id is null)
    where t.status in ('pending', 'in_progress')
      and not t.is_tutorial
      and t.due_at is not null
      and t.due_at > p_now - interval '366 days'
      and t.due_at < p_now + interval '2 days'
      and not _in_quiet((p_now at time zone h.timezone)::time, h.quiet_start, h.quiet_end)
  )
  select b.household_id, b.task_id, b.member_id, 'before_24h', b.before_slot,
    'before_24h:' || b.task_id || ':' || b.member_id || ':' || b.due_epoch
  from base b
  where b.remind_before_24h
    and p_now >= b.before_slot and p_now < b.due_at and b.created_at <= b.before_slot
    -- Se o lembrete do prazo sai antes, junto ou já chegou a hora dele, o de 24 h seria repetido.
    and not (b.remind_due and (b.due_slot <= b.before_slot or p_now >= b.due_slot))
  union all
  select b.household_id, b.task_id, b.member_id, 'due', b.due_slot,
    'due:' || b.task_id || ':' || b.member_id || ':' || b.due_epoch
  from base b
  where b.remind_due
    and p_now >= b.due_slot and p_now < b.due_at + interval '2 hours'
    and b.created_at <= b.due_slot
  union all
  select b.household_id, b.task_id, b.member_id, 'overdue',
    (b.today + b.overdue_reminder_time) at time zone b.tz,
    'overdue:' || b.task_id || ':' || b.member_id || ':' || to_char(b.today, 'YYYY-MM-DD')
  from base b
  where b.remind_overdue
    and b.due_at < b.today::timestamp at time zone b.tz
    and (
      b.overdue_reminder_days = 0
      or b.due_at >= (b.today - b.overdue_reminder_days)::timestamp at time zone b.tz
    )
    and p_now >= (b.today + b.overdue_reminder_time) at time zone b.tz;
$$;

-- ---------------------------------------------------------------- reserva e resultado

-- Chamado pelo Cron. Cria os lembretes que faltam, cancela os que perderam a validade (tarefa
-- concluída, prazo mudou, preferência desligada, Telegram desvinculado...) e reserva um lote
-- para envio. A reserva vale 10 minutos: se o Worker cair, outro Cron retoma.
create function public.claim_reminders(p_now timestamptz default now(), p_limit integer default 20)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_max_attempts constant integer := 5;
  v_result jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    perform _fail('invalid_input');
  end if;

  insert into reminder_deliveries (
    household_id, task_id, member_id, reminder_type, scheduled_for, next_attempt_at,
    deduplication_key
  )
  select c.household_id, c.task_id, c.member_id, c.reminder_type, c.scheduled_for, p_now,
    c.deduplication_key
  from _reminder_candidates(p_now) c
  on conflict (deduplication_key) do nothing;

  -- Fora do silêncio, o que não é mais candidato perdeu a validade.
  update reminder_deliveries d set status = 'cancelled'
  from households h
  where h.id = d.household_id
    and d.status in ('pending', 'sending')
    and d.next_attempt_at <= p_now
    and not _in_quiet((p_now at time zone h.timezone)::time, h.quiet_start, h.quiet_end)
    and d.deduplication_key not in (select c.deduplication_key from _reminder_candidates(p_now) c);

  update reminder_deliveries set status = 'failed', last_error = 'max_attempts'
  where status = 'sending' and next_attempt_at <= p_now and attempt_count >= v_max_attempts;

  with picked as (
    select d.id from reminder_deliveries d
    join households h on h.id = d.household_id
    where d.status in ('pending', 'sending')
      and d.next_attempt_at <= p_now
      and d.attempt_count < v_max_attempts
      and not _in_quiet((p_now at time zone h.timezone)::time, h.quiet_start, h.quiet_end)
    order by d.scheduled_for
    limit p_limit
    for update of d skip locked
  ), claimed as (
    update reminder_deliveries d set
      status = 'sending',
      attempt_count = d.attempt_count + 1,
      last_attempt_at = p_now,
      next_attempt_at = p_now + interval '10 minutes'
    from picked
    where d.id = picked.id
    returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'type', c.reminder_type,
    'key', c.deduplication_key,
    'attempt', c.attempt_count,
    'scheduled_for', c.scheduled_for,
    'attempted_at', c.last_attempt_at,
    'chat_id', m.telegram_chat_id,
    'intensity', m.persona_intensity,
    'timezone', h.timezone,
    'task', jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'due_at', t.due_at,
      'shared', t.assigned_to_member_id is null
    )
  ) order by c.scheduled_for), '[]'::jsonb)
  into v_result
  from claimed c
  join household_members m on m.id = c.member_id
  join households h on h.id = c.household_id
  join tasks t on t.id = c.task_id;

  return v_result;
end;
$$;

-- Resultado do envio: sent, retry (falha temporária, tenta de novo com espera crescente) ou
-- failed (falha definitiva, ex.: a pessoa bloqueou o bot).
create function public.finish_reminder(
  p_id uuid,
  p_outcome text,
  p_error text default null,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_max_attempts constant integer := 5;
  v_row reminder_deliveries;
begin
  if p_outcome is null or p_outcome not in ('sent', 'retry', 'failed') then
    perform _fail('invalid_input');
  end if;
  update reminder_deliveries d set
    status = case
      when p_outcome = 'sent' then 'sent'
      when p_outcome = 'retry' and d.attempt_count < v_max_attempts then 'pending'
      else 'failed'
    end,
    sent_at = case when p_outcome = 'sent' then p_now end,
    last_error = case when p_outcome = 'sent' then null else left(p_error, 100) end,
    next_attempt_at = case
      when p_outcome = 'retry' then p_now + make_interval(mins => power(2, d.attempt_count)::int)
      else d.next_attempt_at
    end
  where d.id = p_id and d.status = 'sending'
  returning * into v_row;
  if not found then
    return '{"ok": false, "error": "not_claimed"}'::jsonb;
  end if;
  return jsonb_build_object('ok', true, 'status', v_row.status);
end;
$$;

-- Limpeza diária: histórico de lembretes encerrados com mais de 60 dias.
create function public.cleanup_reminders(p_max_age interval default interval '60 days')
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  delete from reminder_deliveries
  where status in ('sent', 'failed', 'cancelled') and created_at < now() - p_max_age;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------- preferências e contexto

drop function public.update_member_preferences(uuid, uuid, text, text);

create function public.update_member_preferences(
  p_household_id uuid,
  p_actor_member_id uuid,
  p_persona_intensity text default null,
  p_guidance_mode text default null,
  p_remind_before_24h boolean default null,
  p_remind_due boolean default null,
  p_remind_overdue boolean default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_member household_members;
begin
  perform _assert_member(p_household_id, p_actor_member_id, 'forbidden');
  update household_members set
    persona_intensity = coalesce(p_persona_intensity, persona_intensity),
    guidance_mode = coalesce(p_guidance_mode, guidance_mode),
    guidance_started_at = case
      when p_guidance_mode = 'guided' and guidance_mode <> 'guided' then now()
      else guidance_started_at
    end,
    remind_before_24h = coalesce(p_remind_before_24h, remind_before_24h),
    remind_due = coalesce(p_remind_due, remind_due),
    remind_overdue = coalesce(p_remind_overdue, remind_overdue)
  where id = p_actor_member_id
  returning * into v_member;

  return jsonb_build_object(
    'ok', true,
    'event', 'preferences_updated',
    'member', jsonb_build_object(
      'id', v_member.id,
      'persona_intensity', v_member.persona_intensity,
      'guidance_mode', v_member.guidance_mode,
      'reminders', jsonb_build_object(
        'before_24h', v_member.remind_before_24h,
        'due', v_member.remind_due,
        'overdue', v_member.remind_overdue
      )
    )
  );
end;
$$;

create or replace function public._member_context_json(p_member public.household_members)
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
      'telegram_linked', p_member.telegram_user_id is not null,
      'reminders', jsonb_build_object(
        'before_24h', p_member.remind_before_24h,
        'due', p_member.remind_due,
        'overdue', p_member.remind_overdue
      )
    ),
    'household', (
      select jsonb_build_object(
        'id', h.id, 'name', h.name, 'timezone', h.timezone,
        'quiet_start', to_char(h.quiet_start, 'HH24:MI'),
        'quiet_end', to_char(h.quiet_end, 'HH24:MI'),
        'overdue_reminder_time', to_char(h.overdue_reminder_time, 'HH24:MI'),
        'overdue_reminder_days', h.overdue_reminder_days
      )
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

-- ---------------------------------------------------------------- permissões

revoke execute on function public._in_quiet(time, time, time) from public;
revoke execute on function public._quiet_margin_start(time) from public;
revoke execute on function public._quiet_earlier(timestamptz, text, time, time) from public;
revoke execute on function public._quiet_nearest(timestamptz, text, time, time) from public;
revoke execute on function public._reminder_candidates(timestamptz) from public;
revoke execute on function public.claim_reminders(timestamptz, integer) from public;
revoke execute on function public.finish_reminder(uuid, text, text, timestamptz) from public;
revoke execute on function public.cleanup_reminders(interval) from public;
revoke execute on function public.update_member_preferences(
  uuid, uuid, text, text, boolean, boolean, boolean
) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.reminder_deliveries from anon, authenticated;
    revoke execute on function public._in_quiet(time, time, time) from anon, authenticated;
    revoke execute on function public._quiet_margin_start(time) from anon, authenticated;
    revoke execute on function public._quiet_earlier(timestamptz, text, time, time)
      from anon, authenticated;
    revoke execute on function public._quiet_nearest(timestamptz, text, time, time)
      from anon, authenticated;
    revoke execute on function public._reminder_candidates(timestamptz) from anon, authenticated;
    revoke execute on function public.claim_reminders(timestamptz, integer)
      from anon, authenticated;
    revoke execute on function public.finish_reminder(uuid, text, text, timestamptz)
      from anon, authenticated;
    revoke execute on function public.cleanup_reminders(interval) from anon, authenticated;
    revoke execute on function public.update_member_preferences(
      uuid, uuid, text, text, boolean, boolean, boolean
    ) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public._in_quiet(time, time, time) to service_role;
    grant execute on function public._quiet_margin_start(time) to service_role;
    grant execute on function public._quiet_earlier(timestamptz, text, time, time)
      to service_role;
    grant execute on function public._quiet_nearest(timestamptz, text, time, time)
      to service_role;
    grant execute on function public._reminder_candidates(timestamptz) to service_role;
    grant execute on function public.claim_reminders(timestamptz, integer) to service_role;
    grant execute on function public.finish_reminder(uuid, text, text, timestamptz)
      to service_role;
    grant execute on function public.cleanup_reminders(interval) to service_role;
    grant execute on function public.update_member_preferences(
      uuid, uuid, text, text, boolean, boolean, boolean
    ) to service_role;
  end if;
end;
$$;
