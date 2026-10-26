import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DomainError } from './client.ts';
import { createTaskService, type Task, type TaskResult, type TaskService } from './tasks.ts';
import { PgliteDbClient, createFixture, createTestDb, type Fixture } from './testing.ts';

let pg: PGlite;
let db: PgliteDbClient;
let svc: TaskService;
let f: Fixture;

beforeAll(async () => {
  pg = await createTestDb();
  db = new PgliteDbClient(pg);
  svc = createTaskService(db);
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  f = await createFixture(pg);
});

const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function okTask(result: TaskResult): Task {
  if (!result.ok) {
    throw new Error(`esperava ok, veio ${result.error}`);
  }
  return result.task;
}

async function create(
  title: string,
  extra: Partial<Parameters<TaskService['createTask']>[0]> = {},
) {
  return okTask(
    await svc.createTask({ householdId: f.householdId, actorMemberId: f.ownerId, title, ...extra }),
  );
}

async function events(taskId: string) {
  const res = await pg.query<{ event_type: string; actor_member_id: string | null }>(
    'select event_type, actor_member_id from task_events where task_id = $1 order by seq',
    [taskId],
  );
  return res.rows;
}

async function count(sql: string, params: unknown[]) {
  const res = await pg.query<{ n: number }>(`select count(*)::int as n from ${sql}`, params);
  return res.rows[0]?.n;
}

async function expectDomainError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e) => e instanceof DomainError && e.code === code);
}

describe('criar tarefa', () => {
  it('cria sem prazo quando nenhum foi informado e registra o evento', async () => {
    const task = await create('Organizar o armário');
    expect(task).toMatchObject({
      title: 'Organizar o armário',
      status: 'pending',
      due_at: null,
      assigned_to_member_id: null,
      created_by_member_id: f.ownerId,
      is_overdue: false,
    });
    expect(await events(task.id)).toEqual([{ event_type: 'created', actor_member_id: f.ownerId }]);
  });

  it('atribui a cada membro e a ambos (sem responsável)', async () => {
    const ana = await create('A', { assignedToMemberId: f.ownerId });
    const pedro = await create('B', { assignedToMemberId: f.memberId });
    const shared = await create('C');
    expect([ana, pedro, shared].map((t) => t.assigned_to_member_id)).toEqual([
      f.ownerId,
      f.memberId,
      null,
    ]);
  });

  it('recusa responsável de outra casa ou inativo', async () => {
    await expectDomainError(create('x', { assignedToMemberId: f.outsiderId }), 'invalid_assignee');
    await expectDomainError(
      create('x', { assignedToMemberId: f.inactiveMemberId }),
      'invalid_assignee',
    );
    expect(await count('tasks where household_id = $1', [f.householdId])).toBe(0);
  });

  it('recusa autor inativo ou de outra casa', async () => {
    const base = { householdId: f.householdId, title: 'x' };
    await expectDomainError(
      svc.createTask({ ...base, actorMemberId: f.inactiveMemberId }),
      'forbidden',
    );
    await expectDomainError(svc.createTask({ ...base, actorMemberId: f.outsiderId }), 'forbidden');
  });

  it('valida a entrada antes de chegar ao banco', async () => {
    await expectDomainError(create('   '), 'invalid_input');
    await expectDomainError(create('x', { effort: 5 }), 'invalid_input');
    await expectDomainError(
      create('x', {
        dueAt: iso(HOUR),
        recurrence: { frequency: 'daily', localTime: '08:00' },
      }),
      'invalid_input',
    );
  });

  it('repetir a mesma mensagem não cria duplicata', async () => {
    const input = {
      householdId: f.householdId,
      actorMemberId: f.ownerId,
      title: 'Comprar pão',
      idempotencyKey: `telegram:${f.householdId}:1`,
    };
    const first = await svc.createTask(input);
    const second = await svc.createTask(input);
    expect(first.ok && second.ok).toBe(true);
    expect(second.replayed).toBe(true);
    expect(okTask(second).id).toBe(okTask(first).id);
    expect(await count('tasks where household_id = $1', [f.householdId])).toBe(1);
  });

  it('não reaproveita chave de idempotência de outra casa', async () => {
    const key = `telegram:${f.householdId}:shared`;
    await svc.createTask({
      householdId: f.householdId,
      actorMemberId: f.ownerId,
      title: 'x',
      idempotencyKey: key,
    });
    await expectDomainError(
      svc.createTask({
        householdId: f.otherHouseholdId,
        actorMemberId: f.outsiderId,
        title: 'x',
        idempotencyKey: key,
      }),
      'idempotency_key_conflict',
    );
  });
});

describe('concluir, reabrir e cancelar', () => {
  it('grava quem concluiu e quando, uma única vez', async () => {
    const task = await create('Lavar a louça');
    const before = Date.now();
    const done = await svc.completeTask({
      householdId: f.householdId,
      actorMemberId: f.memberId,
      taskId: task.id,
    });
    const again = await svc.completeTask({
      householdId: f.householdId,
      actorMemberId: f.ownerId,
      taskId: task.id,
    });

    const t = okTask(done);
    expect(done).toMatchObject({ event: 'task_completed', next_task: null });
    expect(t.completed_by_member_id).toBe(f.memberId);
    expect(new Date(t.completed_at ?? 0).getTime()).toBeGreaterThanOrEqual(before - 5_000);
    expect(again).toMatchObject({ ok: true, event: 'task_already_completed' });
    expect(okTask(again).completed_by_member_id).toBe(f.memberId);
    expect((await events(task.id)).map((e) => e.event_type)).toEqual(['created', 'completed']);
  });

  it('reenvio da mesma mensagem devolve o mesmo resultado sem reprocessar', async () => {
    const task = await create('x');
    const input = {
      householdId: f.householdId,
      actorMemberId: f.ownerId,
      taskId: task.id,
      idempotencyKey: 'telegram:777:42',
    };
    const first = await svc.completeTask(input);
    const replay = await svc.completeTask(input);
    expect(replay).toEqual({ ...first, replayed: true });
  });

  it('isola casas: ninguém conclui tarefa de outra casa', async () => {
    const task = await create('Segredo do coletivo');
    expect(
      await svc.completeTask({
        householdId: f.otherHouseholdId,
        actorMemberId: f.outsiderId,
        taskId: task.id,
      }),
    ).toEqual({ ok: false, error: 'task_not_found' });
    await expectDomainError(
      svc.completeTask({
        householdId: f.householdId,
        actorMemberId: f.outsiderId,
        taskId: task.id,
      }),
      'forbidden',
    );
    expect(await svc.getTask({ householdId: f.otherHouseholdId, taskId: task.id })).toEqual({
      ok: false,
      error: 'task_not_found',
    });
  });

  it('reabre limpando dados de conclusão e não conclui tarefa cancelada', async () => {
    const task = await create('x');
    const scope = { householdId: f.householdId, actorMemberId: f.ownerId, taskId: task.id };
    await svc.completeTask(scope);
    const reopened = okTask(await svc.reopenTask(scope));
    expect(reopened).toMatchObject({
      status: 'pending',
      completed_at: null,
      completed_by_member_id: null,
    });
    expect(await svc.reopenTask(scope)).toMatchObject({ ok: true, event: 'task_already_open' });

    expect(await svc.cancelTask(scope)).toMatchObject({ ok: true, event: 'task_cancelled' });
    expect(await svc.completeTask(scope)).toMatchObject({ ok: false, error: 'task_cancelled' });
  });

  it('não cancela tarefa já concluída', async () => {
    const task = await create('x');
    const scope = { householdId: f.householdId, actorMemberId: f.ownerId, taskId: task.id };
    await svc.completeTask(scope);
    expect(await svc.cancelTask(scope)).toMatchObject({ ok: false, error: 'task_completed' });
  });
});

describe('editar', () => {
  it('registra só os campos alterados e permite voltar a responsabilidade compartilhada', async () => {
    const task = await create('Passar roupa', { assignedToMemberId: f.memberId });
    const result = await svc.updateTask({
      householdId: f.householdId,
      actorMemberId: f.ownerId,
      taskId: task.id,
      changes: { title: 'Passar roupa social', assignedToMemberId: null, priority: 'normal' },
    });
    expect(result).toMatchObject({
      ok: true,
      event: 'task_updated',
      changes: { title: 'Passar roupa social', assigned_to_member_id: null },
    });
    const ev = await pg.query<{ old_values: unknown; new_values: unknown }>(
      `select old_values, new_values from task_events where task_id = $1 and event_type = 'updated'`,
      [task.id],
    );
    expect(ev.rows[0]).toEqual({
      old_values: { title: 'Passar roupa', assigned_to_member_id: f.memberId },
      new_values: { title: 'Passar roupa social', assigned_to_member_id: null },
    });
  });

  it('não gera evento quando nada muda e recusa campos desconhecidos', async () => {
    const task = await create('x');
    const scope = { householdId: f.householdId, actorMemberId: f.ownerId, taskId: task.id };
    expect(await svc.updateTask({ ...scope, changes: { title: 'x' } })).toMatchObject({
      event: 'task_unchanged',
    });
    await expectDomainError(
      svc.updateTask({ ...scope, changes: { status: 'completed' } as never }),
      'invalid_input',
    );
    await expectDomainError(
      db.call('update_task', {
        p_household_id: f.householdId,
        p_actor_member_id: f.ownerId,
        p_task_id: task.id,
        p_changes: { status: 'completed' },
      }),
      'invalid_input',
    );
    expect(await events(task.id)).toHaveLength(1);
  });
});

describe('consultas', () => {
  it('separa pendentes, atrasadas, por prazo, concluídas, por pessoa e de treino', async () => {
    const overdue = await create('Atrasada', {
      dueAt: iso(-2 * HOUR),
      assignedToMemberId: f.memberId,
    });
    const soon = await create('Vence amanhã', { dueAt: iso(20 * HOUR) });
    const later = await create('Vence mês que vem', { dueAt: iso(30 * 24 * HOUR) });
    const done = await create('Feita');
    await create('Treino: regar plantas', { isTutorial: true });
    await svc.completeTask({
      householdId: f.householdId,
      actorMemberId: f.memberId,
      taskId: done.id,
    });

    const titles = async (input: Omit<Parameters<TaskService['listTasks']>[0], 'householdId'>) =>
      (await svc.listTasks({ householdId: f.householdId, ...input })).tasks.map((t) => t.title);

    expect(await titles({ view: 'open' })).toEqual([overdue.title, soon.title, later.title]);
    expect(await titles({ view: 'overdue' })).toEqual([overdue.title]);
    expect(await titles({ view: 'due', from: iso(0), to: iso(7 * 24 * HOUR) })).toEqual([
      soon.title,
    ]);
    expect(await titles({ view: 'completed', from: iso(-HOUR) })).toEqual([done.title]);
    expect(await titles({ view: 'open', assignedToMemberId: f.memberId })).toEqual([overdue.title]);
    expect(await titles({ view: 'open', onlyShared: true })).toEqual([soon.title, later.title]);
    expect(await titles({ view: 'all', includeTutorial: true })).toContain('Treino: regar plantas');

    const list = await svc.listTasks({ householdId: f.householdId, view: 'overdue' });
    expect(list.tasks[0]?.is_overdue).toBe(true);
  });

  it('detalhes trazem o histórico em ordem', async () => {
    const task = await create('x');
    await svc.completeTask({
      householdId: f.householdId,
      actorMemberId: f.memberId,
      taskId: task.id,
    });
    const details = await svc.getTask({ householdId: f.householdId, taskId: task.id });
    expect(details.events?.map((e) => [e.event_type, e.actor_member_id])).toEqual([
      ['created', f.ownerId],
      ['completed', f.memberId],
    ]);
  });
});
