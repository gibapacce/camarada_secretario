import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTaskService, type Task, type TaskResult, type TaskService } from './tasks.ts';
import { PgliteDbClient, createFixture, createTestDb, type Fixture } from './testing.ts';

let pg: PGlite;
let svc: TaskService;
let f: Fixture;

beforeAll(async () => {
  pg = await createTestDb();
  svc = createTaskService(new PgliteDbClient(pg));
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  f = await createFixture(pg);
});

function okTask(result: TaskResult): Task {
  if (!result.ok) {
    throw new Error(`esperava ok, veio ${result.error}`);
  }
  return result.task;
}

interface RuleInput {
  frequency: 'daily' | 'weekly' | 'monthly';
  interval?: number;
  byWeekday?: string;
  dayOfMonth?: number;
  localTime: string;
  startsOn: string;
}

async function nextOccurrence(rule: RuleInput, after: string, timezone = 'America/Sao_Paulo') {
  const inserted = await pg.query<{ id: string }>(
    `insert into task_recurrence_rules
       (household_id, frequency, interval_count, by_weekday, day_of_month, local_time, starts_on)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      f.householdId,
      rule.frequency,
      rule.interval ?? 1,
      rule.byWeekday ?? null,
      rule.dayOfMonth ?? null,
      rule.localTime,
      rule.startsOn,
    ],
  );
  const res = await pg.query<{ next: Date | null }>(
    `select _next_occurrence(r, $2, $3) as next from task_recurrence_rules r where r.id = $1`,
    [inserted.rows[0]?.id, timezone, after],
  );
  return res.rows[0]?.next?.toISOString() ?? null;
}

describe('cálculo da próxima ocorrência', () => {
  // 26/10/2026 é segunda-feira; São Paulo = UTC-3 (sem horário de verão).
  it.each([
    [
      'diária, ainda hoje',
      { frequency: 'daily', localTime: '08:00', startsOn: '2026-10-01' },
      '2026-10-26T10:00:00Z',
      '2026-10-26T11:00:00.000Z',
    ],
    [
      'diária, já passou hoje',
      { frequency: 'daily', localTime: '08:00', startsOn: '2026-10-01' },
      '2026-10-26T12:00:00Z',
      '2026-10-27T11:00:00.000Z',
    ],
    [
      'a cada 2 dias',
      { frequency: 'daily', interval: 2, localTime: '08:00', startsOn: '2026-10-26' },
      '2026-10-26T12:00:00Z',
      '2026-10-28T11:00:00.000Z',
    ],
    [
      'semanal aos sábados',
      { frequency: 'weekly', byWeekday: '{6}', localTime: '10:00', startsOn: '2026-10-26' },
      '2026-10-26T12:00:00Z',
      '2026-10-31T13:00:00.000Z',
    ],
    [
      'quinzenal às segundas',
      {
        frequency: 'weekly',
        interval: 2,
        byWeekday: '{1}',
        localTime: '08:00',
        startsOn: '2026-10-26',
      },
      '2026-10-26T12:00:00Z',
      '2026-11-09T11:00:00.000Z',
    ],
    [
      'mensal dia 31 em fevereiro usa o último dia',
      { frequency: 'monthly', dayOfMonth: 31, localTime: '09:00', startsOn: '2026-01-31' },
      '2027-02-01T00:00:00Z',
      '2027-02-28T12:00:00.000Z',
    ],
    [
      'trimestral dia 15',
      {
        frequency: 'monthly',
        interval: 3,
        dayOfMonth: 15,
        localTime: '09:00',
        startsOn: '2026-01-15',
      },
      '2026-10-26T00:00:00Z',
      '2027-01-15T12:00:00.000Z',
    ],
  ] as const)('%s', async (_name, rule, after, expected) => {
    expect(await nextOccurrence(rule, after)).toBe(expected);
  });

  it('respeita mudança de horário de verão do fuso da casa', async () => {
    // Lisboa sai do horário de verão em 25/10/2026: 08:00 local passa de 07:00Z para 08:00Z.
    const rule = { frequency: 'daily', localTime: '08:00', startsOn: '2026-10-01' } as const;
    expect(await nextOccurrence(rule, '2026-10-23T12:00:00Z', 'Europe/Lisbon')).toBe(
      '2026-10-24T07:00:00.000Z',
    );
    expect(await nextOccurrence(rule, '2026-10-24T12:00:00Z', 'Europe/Lisbon')).toBe(
      '2026-10-25T08:00:00.000Z',
    );
  });
});

describe('tarefas recorrentes', () => {
  async function createWeekly() {
    return okTask(
      await svc.createTask({
        householdId: f.householdId,
        actorMemberId: f.ownerId,
        title: 'Trocar roupa de cama',
        assignedToMemberId: f.memberId,
        recurrence: { frequency: 'weekly', byWeekday: [6], localTime: '10:00' },
      }),
    );
  }

  async function occurrences(ruleId: string | null) {
    const res = await pg.query<{ id: string; status: string; due_at: Date }>(
      'select id, status, due_at from tasks where recurrence_rule_id = $1 order by due_at',
      [ruleId],
    );
    return res.rows;
  }

  it('calcula o primeiro prazo a partir da regra', async () => {
    const task = await createWeekly();
    expect(task.recurrence_rule_id).not.toBeNull();
    const due = new Date(task.due_at ?? '');
    expect(due.getTime()).toBeGreaterThan(Date.now());
    expect(due.getUTCDay()).toBe(6);
    expect(due.getUTCHours()).toBe(13);
  });

  it('concluir cria a próxima ocorrência uma única vez e mantém o histórico', async () => {
    const task = await createWeekly();
    const scope = {
      householdId: f.householdId,
      actorMemberId: f.memberId,
      taskId: task.id,
      idempotencyKey: 'telegram:rec:1',
    };
    const done = await svc.completeTask(scope);
    await svc.completeTask(scope);
    await svc.completeTask({ ...scope, idempotencyKey: 'telegram:rec:2' });

    expect(done.ok && done.next_task).toMatchObject({
      title: 'Trocar roupa de cama',
      status: 'pending',
      assigned_to_member_id: f.memberId,
    });
    const rows = await occurrences(task.recurrence_rule_id);
    expect(rows.map((r) => r.status)).toEqual(['completed', 'pending']);
    const [first, second] = rows.map((r) => r.due_at.getTime());
    expect((second ?? 0) - (first ?? 0)).toBe(7 * 24 * 3_600_000);
  });

  it('reabrir e concluir de novo uma ocorrência antiga não duplica a próxima', async () => {
    const task = await createWeekly();
    const scope = { householdId: f.householdId, actorMemberId: f.ownerId, taskId: task.id };
    await svc.completeTask(scope);
    await svc.reopenTask(scope);
    await svc.completeTask(scope);
    expect((await occurrences(task.recurrence_rule_id)).map((r) => r.status)).toEqual([
      'completed',
      'pending',
    ]);
  });

  it('cancelar pula a ocorrência; cancelar com encerramento para a série', async () => {
    const task = await createWeekly();
    const skipped = await svc.cancelTask({
      householdId: f.householdId,
      actorMemberId: f.ownerId,
      taskId: task.id,
    });
    const next = skipped.ok ? skipped.next_task : null;
    expect(next?.status).toBe('pending');

    const stopped = await svc.cancelTask({
      householdId: f.householdId,
      actorMemberId: f.ownerId,
      taskId: next?.id ?? '',
      stopRecurrence: true,
    });
    expect(stopped).toMatchObject({ ok: true, next_task: null, recurrence_stopped: true });
    expect((await occurrences(task.recurrence_rule_id)).map((r) => r.status)).toEqual([
      'cancelled',
      'cancelled',
    ]);
  });
});

describe('desfazer', () => {
  const scope = () => ({ householdId: f.householdId, actorMemberId: f.ownerId });

  async function eventTypes(taskId: string) {
    const res = await pg.query<{ event_type: string }>(
      'select event_type from task_events where task_id = $1 order by seq',
      [taskId],
    );
    return res.rows.map((r) => r.event_type);
  }

  it('desfaz a criação cancelando a tarefa, sem apagar o histórico', async () => {
    const task = okTask(await svc.createTask({ ...scope(), title: 'Errei o nome' }));
    const undo = await svc.undoLastAction(scope());
    expect(undo).toMatchObject({ ok: true, event: 'action_undone', undone_event_type: 'created' });
    expect(okTask(undo).status).toBe('cancelled');
    expect(await eventTypes(task.id)).toEqual(['created', 'undone']);
  });

  it('desfaz a conclusão e retira a próxima ocorrência gerada; concluir de novo a reaproveita', async () => {
    const task = okTask(
      await svc.createTask({
        ...scope(),
        title: 'Regar plantas',
        recurrence: { frequency: 'daily', localTime: '07:00' },
      }),
    );
    const done = await svc.completeTask({ ...scope(), taskId: task.id });
    const nextId = done.ok ? done.next_task?.id : undefined;

    const undo = await svc.undoLastAction(scope());
    expect(undo).toMatchObject({
      ok: true,
      undone_event_type: 'completed',
      cancelled_next_task_id: nextId,
    });
    expect(okTask(undo)).toMatchObject({ status: 'pending', completed_at: null });

    const again = await svc.completeTask({ ...scope(), taskId: task.id });
    expect(again.ok && again.next_task?.id).toBe(nextId);
    const open = await pg.query<{ n: number }>(
      `select count(*)::int as n from tasks where recurrence_rule_id = $1 and status = 'pending'`,
      [task.recurrence_rule_id],
    );
    expect(open.rows[0]?.n).toBe(1);
  });

  it('desfaz edição restaurando os valores anteriores', async () => {
    const task = okTask(
      await svc.createTask({
        ...scope(),
        title: 'Limpar banheiro',
        assignedToMemberId: f.memberId,
      }),
    );
    await svc.updateTask({
      ...scope(),
      taskId: task.id,
      changes: { title: 'Limpar banheiro de visitas', assignedToMemberId: null },
    });
    const undo = okTask(await svc.undoLastAction(scope()));
    expect(undo).toMatchObject({ title: 'Limpar banheiro', assigned_to_member_id: f.memberId });
  });

  it('desfaz cancelamento que encerrou a série e reativa a recorrência', async () => {
    const task = okTask(
      await svc.createTask({
        ...scope(),
        title: 'Tirar o lixo',
        recurrence: { frequency: 'daily', localTime: '20:00' },
      }),
    );
    await svc.cancelTask({ ...scope(), taskId: task.id, stopRecurrence: true });
    const undo = await svc.undoLastAction(scope());
    expect(undo).toMatchObject({ ok: true, recurrence_active: true });
    expect(okTask(undo).status).toBe('pending');
  });

  it('desfaz em sequência as últimas ações da pessoa', async () => {
    const task = okTask(await svc.createTask({ ...scope(), title: 'A' }));
    await svc.updateTask({ ...scope(), taskId: task.id, changes: { title: 'B' } });
    expect(okTask(await svc.undoLastAction(scope())).title).toBe('A');
    expect(okTask(await svc.undoLastAction(scope())).status).toBe('cancelled');
    expect(await svc.undoLastAction(scope())).toEqual({ ok: false, error: 'nothing_to_undo' });
  });

  it('não desfaz fora da janela de tempo', async () => {
    const task = okTask(await svc.createTask({ ...scope(), title: 'Antiga' }));
    await pg.query(
      `update task_events set created_at = created_at - interval '20 minutes' where task_id = $1`,
      [task.id],
    );
    expect(await svc.undoLastAction(scope())).toEqual({ ok: false, error: 'nothing_to_undo' });
  });

  it('não desfaz se outra pessoa mexeu depois na mesma tarefa', async () => {
    const task = okTask(await svc.createTask({ ...scope(), title: 'Compartilhada' }));
    await svc.completeTask({
      householdId: f.householdId,
      actorMemberId: f.memberId,
      taskId: task.id,
    });
    expect(await svc.undoLastAction(scope())).toMatchObject({ ok: false, error: 'undo_conflict' });
  });

  it('detecta a alteração de outra pessoa mesmo com horários empatados', async () => {
    const task = okTask(await svc.createTask({ ...scope(), title: 'Mesmo instante' }));
    await svc.completeTask({
      householdId: f.householdId,
      actorMemberId: f.memberId,
      taskId: task.id,
    });
    await pg.query(
      `update task_events set created_at = (select min(created_at) from task_events where task_id = $1)
       where task_id = $1`,
      [task.id],
    );
    expect(await svc.undoLastAction(scope())).toMatchObject({ ok: false, error: 'undo_conflict' });
  });

  it('cada pessoa só desfaz as próprias ações', async () => {
    await svc.createTask({ ...scope(), title: 'Da Ana' });
    expect(
      await svc.undoLastAction({ householdId: f.householdId, actorMemberId: f.memberId }),
    ).toEqual({ ok: false, error: 'nothing_to_undo' });
  });

  it('repetir o mesmo "desfazer" não desfaz duas vezes', async () => {
    const task = okTask(await svc.createTask({ ...scope(), title: 'A' }));
    await svc.updateTask({ ...scope(), taskId: task.id, changes: { title: 'B' } });
    const input = { ...scope(), idempotencyKey: 'telegram:undo:1' };
    const first = await svc.undoLastAction(input);
    const replay = await svc.undoLastAction(input);
    expect(replay).toEqual({ ...first, replayed: true });
    expect(await eventTypes(task.id)).toEqual(['created', 'updated', 'undone']);
  });
});
