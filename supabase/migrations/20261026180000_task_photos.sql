-- Fotos das tarefas: metadados no banco; arquivos no bucket privado "task-photos" do Supabase Storage.
-- Só o Worker (service role) acessa. URLs de leitura são assinadas e temporárias.

create table public.task_photos (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  task_id uuid not null,
  storage_path text not null unique check (char_length(storage_path) between 1 and 300),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  caption text check (char_length(caption) <= 200),
  uploaded_by_member_id uuid not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by_member_id uuid,
  foreign key (household_id, task_id) references public.tasks (household_id, id) on delete cascade,
  foreign key (household_id, uploaded_by_member_id)
    references public.household_members (household_id, id),
  foreign key (household_id, deleted_by_member_id)
    references public.household_members (household_id, id),
  check ((deleted_at is null) = (deleted_by_member_id is null))
);

create index task_photos_task_idx on public.task_photos (task_id, created_at)
  where deleted_at is null;

alter table public.task_photos enable row level security;

create function public._photo_json(p_photo public.task_photos)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', p_photo.id,
    'task_id', p_photo.task_id,
    'storage_path', p_photo.storage_path,
    'content_type', p_photo.content_type,
    'size_bytes', p_photo.size_bytes,
    'caption', p_photo.caption,
    'uploaded_by_member_id', p_photo.uploaded_by_member_id,
    'created_at', p_photo.created_at
  );
$$;

create or replace function public._task_json(p_task public.tasks)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when p_task.id is null then null else
    to_jsonb(p_task) || jsonb_build_object(
      'is_overdue',
      p_task.status in ('pending', 'in_progress') and p_task.due_at is not null and p_task.due_at < now(),
      'photo_count',
      (select count(*)::int from task_photos p where p.task_id = p_task.id and p.deleted_at is null)
    )
  end;
$$;

-- O caminho segue "<casa>/<tarefa>/<foto>.<ext>" para isolar arquivos por casa.
create function public.add_task_photo(
  p_household_id uuid,
  p_actor_member_id uuid,
  p_task_id uuid,
  p_photo_id uuid,
  p_storage_path text,
  p_content_type text,
  p_size_bytes integer,
  p_caption text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_replay jsonb;
  v_task tasks;
  v_photo task_photos;
  v_result jsonb;
begin
  perform _assert_member(p_household_id, p_actor_member_id, 'forbidden');
  if p_photo_id is null
    or p_storage_path is distinct from
      format('%s/%s/%s.%s', p_household_id, p_task_id, p_photo_id,
        case p_content_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
          when 'image/webp' then 'webp' end) then
    perform _fail('invalid_input', 'storage_path');
  end if;
  v_replay := _idem_begin(p_household_id, p_idempotency_key);
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_task from tasks
  where id = p_task_id and household_id = p_household_id
  for update;
  if not found then
    v_result := '{"ok": false, "error": "task_not_found"}'::jsonb;
  elsif (select count(*) from task_photos where task_id = p_task_id and deleted_at is null) >= 10 then
    v_result := jsonb_build_object('ok', false, 'error', 'photo_limit', 'task', _task_json(v_task));
  else
    insert into task_photos (
      id, household_id, task_id, storage_path, content_type, size_bytes, caption,
      uploaded_by_member_id
    )
    values (
      p_photo_id, p_household_id, p_task_id, p_storage_path, p_content_type, p_size_bytes,
      nullif(btrim(p_caption), ''), p_actor_member_id
    )
    returning * into v_photo;
    v_result := jsonb_build_object(
      'ok', true, 'event', 'photo_added', 'task', _task_json(v_task), 'photo', _photo_json(v_photo)
    );
  end if;

  perform _idem_finish(p_idempotency_key, v_result);
  return v_result;
end;
$$;

-- Remoção lógica: o registro fica para o histórico; o Worker apaga o arquivo do bucket.
create function public.delete_task_photo(
  p_household_id uuid,
  p_actor_member_id uuid,
  p_photo_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_replay jsonb;
  v_photo task_photos;
  v_task tasks;
  v_result jsonb;
begin
  perform _assert_member(p_household_id, p_actor_member_id, 'forbidden');
  v_replay := _idem_begin(p_household_id, p_idempotency_key);
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_photo from task_photos
  where id = p_photo_id and household_id = p_household_id
  for update;
  if not found then
    v_result := '{"ok": false, "error": "photo_not_found"}'::jsonb;
  else
    select * into v_task from tasks where id = v_photo.task_id;
    if v_photo.deleted_at is not null then
      v_result := jsonb_build_object(
        'ok', true, 'event', 'photo_already_removed', 'task', _task_json(v_task),
        'photo', _photo_json(v_photo)
      );
    else
      update task_photos set deleted_at = now(), deleted_by_member_id = p_actor_member_id
      where id = v_photo.id
      returning * into v_photo;
      v_result := jsonb_build_object(
        'ok', true, 'event', 'photo_removed', 'task', _task_json(v_task),
        'photo', _photo_json(v_photo)
      );
    end if;
  end if;

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
    ),
    'photos', (
      select coalesce(jsonb_agg(_photo_json(p) order by p.created_at, p.id), '[]'::jsonb)
      from task_photos p where p.task_id = v_task.id and p.deleted_at is null
    )
  );
end;
$$;

revoke execute on function public._photo_json(public.task_photos) from public;
revoke execute on function public.add_task_photo(uuid, uuid, uuid, uuid, text, text, integer, text, text)
  from public;
revoke execute on function public.delete_task_photo(uuid, uuid, uuid, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.task_photos from anon, authenticated;
    revoke execute on function public._photo_json(public.task_photos) from anon, authenticated;
    revoke execute on function
      public.add_task_photo(uuid, uuid, uuid, uuid, text, text, integer, text, text)
      from anon, authenticated;
    revoke execute on function public.delete_task_photo(uuid, uuid, uuid, text)
      from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public._photo_json(public.task_photos) to service_role;
    grant execute on function
      public.add_task_photo(uuid, uuid, uuid, uuid, text, text, integer, text, text)
      to service_role;
    grant execute on function public.delete_task_photo(uuid, uuid, uuid, text) to service_role;
  end if;
end;
$$;

-- Bucket privado (só existe no Supabase; o Postgres local dos testes não tem o schema storage).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('task-photos', 'task-photos', false, 5242880,
      array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set
      public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  end if;
end;
$$;
