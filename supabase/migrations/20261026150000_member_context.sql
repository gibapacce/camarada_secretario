-- Contexto do membro autenticado e preferências pessoais (persona e Modo Aprendiz).

create function public.get_member_context(p_auth_user_id uuid)
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

  return jsonb_build_object(
    'ok', true,
    'member', jsonb_build_object(
      'id', v_member.id,
      'household_id', v_member.household_id,
      'display_name', v_member.display_name,
      'role', v_member.role,
      'persona_intensity', v_member.persona_intensity,
      'guidance_mode', v_member.guidance_mode
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

create function public.update_member_preferences(
  p_household_id uuid,
  p_actor_member_id uuid,
  p_persona_intensity text default null,
  p_guidance_mode text default null
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
    end
  where id = p_actor_member_id
  returning * into v_member;

  return jsonb_build_object(
    'ok', true,
    'event', 'preferences_updated',
    'member', jsonb_build_object(
      'id', v_member.id,
      'persona_intensity', v_member.persona_intensity,
      'guidance_mode', v_member.guidance_mode
    )
  );
end;
$$;

revoke execute on function public.get_member_context(uuid) from public;
revoke execute on function public.update_member_preferences(uuid, uuid, text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.get_member_context(uuid) from anon, authenticated;
    revoke execute on function public.update_member_preferences(uuid, uuid, text, text)
      from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.get_member_context(uuid) to service_role;
    grant execute on function public.update_member_preferences(uuid, uuid, text, text)
      to service_role;
  end if;
end;
$$;
