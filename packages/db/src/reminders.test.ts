import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMemberService, type MemberService } from './members.ts';
import { createReminderService, type ReminderService } from './reminders.ts';
import { PgliteDbClient, createFixture, createTestDb, type Fixture } from './testing.ts';

let pg: PGlite;
let reminders: ReminderService;
let members: MemberService;
let f: Fixture;

beforeAll(async () => {
  pg = await createTestDb();
  const db = new PgliteDbClient(pg);
  reminders = createReminderService(db);
  members = createMemberService(db);
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await pg.query('delete from reminder_deliveries');
  await pg.query('delete from tasks');
  await pg.query('update household_members set telegram_user_id = null, telegram_chat_id = null');
  f = await createFixture(pg);
  await pg.query(
    `update household_members set telegram_user_id = $2, telegram_chat_id = $2 where id = $1`,
    [f.ownerId, 101],
  );
  await pg.query(
    `update household_members set telegram_user_id = $2, telegram_chat_id = $2 where id = $1`,
    [f.memberId, 202],
  );
});

/** Horário local de São Paulo (UTC-3, sem horário de verão). */
const at = (local: string) => new Date(`${local.replace(' ', 'T')}:00-03:00`);

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('valor esperado ausente');
  return value;
}

async function task(opts: {
  title?: string;
  due: string;
  assignee?: string | null;
  created?: string;
  tutorial?: boolean;
}): Promise<string> {
  const res = await pg.query<{ id: string }>(
    `insert into tasks (household_id, title, due_at, assigned_to_member_id, created_at, is_tutorial)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      f.householdId,
      opts.title ?? 'Lavar a louça',
      at(opts.due).toISOString(),
      opts.assignee === undefined ? f.ownerId : opts.assignee,
      at(opts.created ?? '2026-11-01 08:00').toISOString(),
      opts.tutorial ?? false,
    ],
  );
  return must(res.rows[0]).id;
}

const claim = (local: string) => reminders.claim({ now: at(local) });

async function sendAll(local: string) {
  const jobs = await claim(local);
  for (const j of jobs) await reminders.finish(j.id, 'sent', undefined, at(local));
  return jobs;
}

describe('lembrete no prazo', () => {
  it('sai na hora do prazo, só para o responsável, e uma única vez', async () => {
    await task({ due: '2026-11-20 15:00' });
    expect(await claim('2026-11-20 14:59')).toEqual([]);

    const jobs = await sendAll('2026-11-20 15:00');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      type: 'due',
      chat_id: 101,
      intensity: 'full',
      timezone: 'America/Sao_Paulo',
      attempt: 1,
      task: { title: 'Lavar a louça', shared: false },
    });
    expect(await claim('2026-11-20 15:05')).toEqual([]);
  });

  it('prazo no silêncio (tarefa só com data, 23:59) é antecipado para as 9h do mesmo dia', async () => {
    await task({ due: '2026-11-20 23:59' });
    expect(await claim('2026-11-20 08:59')).toEqual([]);
    const jobs = await claim('2026-11-20 09:00');
    expect(jobs).toHaveLength(1);
    expect(new Date(must(jobs[0]).scheduled_for)).toEqual(at('2026-11-20 09:00'));
  });

  it('tarefa criada depois do horário do lembrete não recebe o lembrete', async () => {
    await task({ due: '2026-11-20 23:59', created: '2026-11-20 14:00' });
    expect(await claim('2026-11-20 14:05')).toEqual([]);
  });

  it('prazo logo antes do silêncio (20:45) também é antecipado, para não ser pulado', async () => {
    await task({ due: '2026-11-20 20:45' });
    const [job] = await claim('2026-11-20 09:00');
    expect(job).toMatchObject({ type: 'due', attempted_at: expect.any(String) });
  });

  it('tarefa coletiva lembra as duas pessoas com Telegram, e não o inativo', async () => {
    await pg.query(`update household_members set telegram_chat_id = 303 where id = $1`, [
      f.inactiveMemberId,
    ]);
    await task({ due: '2026-11-20 15:00', assignee: null });
    const jobs = await claim('2026-11-20 15:00');
    expect(jobs.map((j) => j.chat_id).sort()).toEqual([101, 202]);
    expect(jobs.every((j) => j.task.shared)).toBe(true);
  });

  it('sem Telegram vinculado, tarefa de treino ou fora da janela de 2 h: nada', async () => {
    await task({ due: '2026-11-20 15:00', assignee: f.inactiveMemberId });
    await task({ due: '2026-11-20 15:00', tutorial: true });
    await task({ due: '2026-11-20 10:00' });
    expect(await claim('2026-11-20 15:00')).toEqual([]);
  });
});

describe('cancelamento', () => {
  it('concluir a tarefa cancela o lembrete pendente (inclusive em retry)', async () => {
    const id = await task({ due: '2026-11-20 15:00' });
    const [job] = await claim('2026-11-20 15:00');
    await reminders.finish(must(job).id, 'retry', 'telegram_429', at('2026-11-20 15:00'));
    await pg.query(
      `update tasks set status = 'completed', completed_at = now(), completed_by_member_id = $2
       where id = $1`,
      [id, f.ownerId],
    );
    expect(await claim('2026-11-20 15:10')).toEqual([]);
    const st = await pg.query<{ status: string }>('select status from reminder_deliveries');
    expect(st.rows).toEqual([{ status: 'cancelled' }]);
  });

  it('mudar o prazo cancela o lembrete antigo e gera outro para o novo prazo', async () => {
    const id = await task({ due: '2026-11-20 15:00' });
    const [old] = await claim('2026-11-20 15:00');
    await reminders.finish(must(old).id, 'retry', 'x', at('2026-11-20 15:00'));
    await pg.query(`update tasks set due_at = $2 where id = $1`, [
      id,
      at('2026-11-20 16:00').toISOString(),
    ]);
    expect(await claim('2026-11-20 15:30')).toEqual([]);
    const [fresh] = await claim('2026-11-20 16:00');
    expect(must(fresh).key).not.toBe(must(old).key);
  });

  it('desligar a preferência cancela e impede novos lembretes', async () => {
    await task({ due: '2026-11-20 15:00' });
    await members.updatePreferences(
      { householdId: f.householdId, actorMemberId: f.ownerId },
      { reminders: { due: false } },
    );
    expect(await claim('2026-11-20 15:00')).toEqual([]);
  });
});

describe('lembrete de atraso', () => {
  it('uma vez por dia às 9h, até 30 dias de atraso', async () => {
    await task({ due: '2026-11-19 18:00' });
    await sendAll('2026-11-19 18:00');

    expect(await claim('2026-11-20 08:59')).toEqual([]);
    const [day1] = await sendAll('2026-11-20 09:00');
    expect(day1).toMatchObject({ type: 'overdue' });
    expect(await claim('2026-11-20 15:00')).toEqual([]);

    const [day2] = await sendAll('2026-11-21 09:30');
    expect(must(day2).key).not.toBe(must(day1).key);

    expect(await claim('2026-12-19 09:00')).toHaveLength(1);
    expect(await claim('2026-12-20 09:00')).toEqual([]);
  });

  it('não sai no horário de silêncio', async () => {
    await task({ due: '2026-11-19 18:00' });
    await sendAll('2026-11-19 18:00');
    expect(await claim('2026-11-20 21:00')).toEqual([]);
    expect(await claim('2026-11-21 08:00')).toEqual([]);
  });
});

describe('lembrete de 24 h (opcional)', () => {
  beforeEach(async () => {
    await members.updatePreferences(
      { householdId: f.householdId, actorMemberId: f.ownerId },
      { reminders: { before24h: true } },
    );
  });

  it('sai 24 h antes quando ligado', async () => {
    await task({ due: '2026-11-21 15:00' });
    expect(await claim('2026-11-20 14:59')).toEqual([]);
    const [job] = await claim('2026-11-20 15:00');
    expect(job).toMatchObject({ type: 'before_24h' });
  });

  it('cai no silêncio: vai para o limite mais próximo (prazo 23:59 → 20:30 da véspera)', async () => {
    await task({ due: '2026-11-21 23:59' });
    expect(await claim('2026-11-20 20:25')).toEqual([]);
    const [job] = await claim('2026-11-20 20:30');
    expect(job).toMatchObject({ type: 'before_24h' });
  });

  it('nunca sai atrasado junto com o do prazo (sem Cron entre 20:30 e 21:00)', async () => {
    await task({ due: '2026-11-21 23:59' });
    const jobs = await claim('2026-11-21 09:00');
    expect(jobs.map((j) => j.type)).toEqual(['due']);
  });

  it('não repete quando o lembrete do prazo sai junto (prazo 07:00 → ambos às 9h da véspera)', async () => {
    await task({ due: '2026-11-21 07:00' });
    const jobs = await claim('2026-11-20 09:00');
    expect(jobs.map((j) => j.type)).toEqual(['due']);
  });
});

describe('entrega', () => {
  it('retry usa espera crescente, a mesma chave e desiste após 5 tentativas', async () => {
    await task({ due: '2026-11-20 15:00' });
    let now = at('2026-11-20 15:00');
    const [first] = await reminders.claim({ now });
    await reminders.finish(must(first).id, 'retry', 'telegram_500', now);

    expect(await reminders.claim({ now: new Date(now.getTime() + 60_000) })).toEqual([]);
    for (let attempt = 2; attempt <= 5; attempt++) {
      now = new Date(now.getTime() + 2 ** (attempt - 1) * 60_000);
      const [again] = await reminders.claim({ now });
      expect(again).toMatchObject({ id: must(first).id, key: must(first).key, attempt });
      await reminders.finish(must(again).id, 'retry', 'telegram_500', now);
    }
    const st = await pg.query<{ status: string; last_error: string }>(
      'select status, last_error from reminder_deliveries',
    );
    expect(st.rows).toEqual([{ status: 'failed', last_error: 'telegram_500' }]);
  });

  it('reserva abandonada (Worker caiu) volta depois de 10 minutos; dois Crons não pegam o mesmo', async () => {
    await task({ due: '2026-11-20 15:00' });
    expect(await claim('2026-11-20 15:00')).toHaveLength(1);
    expect(await claim('2026-11-20 15:01')).toEqual([]);
    const [again] = await claim('2026-11-20 15:10');
    expect(again).toMatchObject({ attempt: 2 });
  });

  it('falha definitiva não tenta de novo; resultado de lembrete não reservado é recusado', async () => {
    await task({ due: '2026-11-20 15:00' });
    const [job] = await claim('2026-11-20 15:00');
    expect(await reminders.finish(must(job).id, 'failed', 'telegram_403')).toMatchObject({
      status: 'failed',
    });
    expect(await claim('2026-11-20 15:30')).toEqual([]);
    expect(await reminders.finish(must(job).id, 'sent')).toEqual({
      ok: false,
      error: 'not_claimed',
    });
  });
});

describe('preferências de lembrete', () => {
  it('aparecem no contexto com o horário de silêncio da casa', async () => {
    await members.updatePreferences(
      { householdId: f.householdId, actorMemberId: f.ownerId },
      { reminders: { before24h: true, overdue: false } },
    );
    const ctx = await members.getContextByTelegram(101);
    expect(ctx?.member.reminders).toEqual({ before_24h: true, due: true, overdue: false });
    expect(ctx?.household).toMatchObject({
      quiet_start: '21:00',
      quiet_end: '09:00',
      overdue_reminder_time: '09:00',
      overdue_reminder_days: 30,
    });
  });

  it('recusa preferência vazia ou desconhecida', async () => {
    const scope = { householdId: f.householdId, actorMemberId: f.ownerId };
    await expect(members.updatePreferences(scope, { reminders: {} })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(
      members.updatePreferences(scope, { reminders: { daily: true } }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
