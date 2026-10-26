-- Dados fictícios para desenvolvimento local. Nunca use dados reais aqui.
insert into public.households (id, name, timezone)
values ('00000000-0000-4000-8000-000000000001', 'Coletivo de Desenvolvimento', 'America/Sao_Paulo')
on conflict (id) do nothing;

insert into public.household_members (id, household_id, display_name, role, guidance_mode)
values
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'Ana', 'owner', 'normal'),
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', 'Pedro', 'member', 'guided')
on conflict (id) do nothing;

select public.create_task(
  p_household_id => '00000000-0000-4000-8000-000000000001',
  p_actor_member_id => '00000000-0000-4000-8000-000000000011',
  p_title => 'Lavar a louça',
  p_assigned_to_member_id => '00000000-0000-4000-8000-000000000012',
  p_due_at => now() + interval '1 day',
  p_idempotency_key => 'system:seed-lavar-louca'
);

select public.create_task(
  p_household_id => '00000000-0000-4000-8000-000000000001',
  p_actor_member_id => '00000000-0000-4000-8000-000000000012',
  p_title => 'Trocar a roupa de cama',
  p_recurrence => '{"frequency": "weekly", "by_weekday": [6], "local_time": "10:00"}',
  p_idempotency_key => 'system:seed-roupa-de-cama'
);
