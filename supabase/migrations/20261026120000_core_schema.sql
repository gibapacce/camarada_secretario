-- Esquema principal: casas, membros, tarefas, recorrência, histórico e idempotência.
-- Timestamps em UTC (timestamptz); exibição no fuso da casa.
-- Compatível com Postgres 15+ (Supabase); evite recursos exclusivos de versões novas.

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now()
);

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  auth_user_id uuid unique,
  telegram_user_id bigint unique,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  role text not null default 'member' check (role in ('owner', 'member')),
  is_active boolean not null default true,
  persona_intensity text not null default 'full' check (persona_intensity in ('off', 'light', 'full')),
  guidance_mode text not null default 'guided' check (guidance_mode in ('guided', 'normal')),
  guidance_started_at timestamptz,
  tutorial_step smallint check (tutorial_step between 0 and 10),
  created_at timestamptz not null default now(),
  unique (household_id, id)
);

create table public.task_recurrence_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  interval_count smallint not null default 1 check (interval_count between 1 and 12),
  by_weekday smallint[] check (by_weekday <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  day_of_month smallint check (day_of_month between 1 and 31),
  local_time time not null,
  starts_on date not null,
  next_occurrence_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (household_id, id),
  check (frequency <> 'weekly' or cardinality(by_weekday) between 1 and 7),
  check (frequency <> 'monthly' or day_of_month is not null)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 2000),
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  effort smallint check (effort between 1 and 3),
  is_tutorial boolean not null default false,
  category text check (char_length(category) <= 40),
  room text check (char_length(room) <= 40),
  assigned_to_member_id uuid,
  created_by_member_id uuid,
  due_at timestamptz,
  recurrence_rule_id uuid,
  completed_by_member_id uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, id),
  -- Chaves compostas garantem que pessoas e regras pertencem à mesma casa da tarefa.
  foreign key (household_id, assigned_to_member_id)
    references public.household_members (household_id, id),
  foreign key (household_id, created_by_member_id)
    references public.household_members (household_id, id),
  foreign key (household_id, completed_by_member_id)
    references public.household_members (household_id, id),
  foreign key (household_id, recurrence_rule_id)
    references public.task_recurrence_rules (household_id, id),
  check ((status = 'completed') = (completed_at is not null)),
  check (status = 'completed' or completed_by_member_id is null)
);

-- Uma ocorrência por regra e horário: retries nunca duplicam a próxima ocorrência.
create unique index tasks_recurrence_occurrence_uq
  on public.tasks (recurrence_rule_id, due_at)
  where recurrence_rule_id is not null;

create index tasks_household_status_due_idx on public.tasks (household_id, status, due_at);
create index tasks_household_assignee_idx on public.tasks (household_id, assigned_to_member_id);
create index tasks_household_completed_idx on public.tasks (household_id, completed_at)
  where completed_at is not null;

create table public.task_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  task_id uuid not null,
  actor_member_id uuid,
  event_type text not null check (
    event_type in ('created', 'updated', 'completed', 'reopened', 'cancelled', 'undone')
  ),
  old_values jsonb,
  new_values jsonb,
  undoes_event_id uuid unique references public.task_events (id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (household_id, task_id) references public.tasks (household_id, id) on delete cascade,
  foreign key (household_id, actor_member_id)
    references public.household_members (household_id, id),
  check ((event_type = 'undone') = (undoes_event_id is not null))
);

create index task_events_task_idx on public.task_events (task_id, created_at);
create index task_events_actor_idx on public.task_events (household_id, actor_member_id, created_at);

create table public.processed_messages (
  provider text not null check (provider in ('telegram', 'web', 'system')),
  provider_message_id text not null check (char_length(provider_message_id) between 1 and 200),
  household_id uuid not null references public.households (id) on delete cascade,
  received_at timestamptz not null default now(),
  processing_status text not null default 'processing'
    check (processing_status in ('processing', 'done')),
  result_reference jsonb,
  primary key (provider, provider_message_id)
);

-- RLS ligado e sem políticas: nega tudo a clientes; só o backend (service role) acessa.
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.task_recurrence_rules enable row level security;
alter table public.tasks enable row level security;
alter table public.task_events enable row level security;
alter table public.processed_messages enable row level security;
