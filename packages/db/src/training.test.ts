import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMemberService, type MemberService } from './members.ts';
import { createTaskService, type TaskService } from './tasks.ts';
import { PgliteDbClient, createFixture, createTestDb, type Fixture } from './testing.ts';

let pg: PGlite;
let members: MemberService;
let tasks: TaskService;
let f: Fixture;

beforeAll(async () => {
  pg = await createTestDb();
  const db = new PgliteDbClient(pg);
  members = createMemberService(db);
  tasks = createTaskService(db);
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  f = await createFixture(pg);
});

const scope = () => ({ householdId: f.householdId, actorMemberId: f.ownerId });
const training = async () =>
  (
    await pg.query<{ tutorial_step: number | null; tutorial_paused: boolean; tips_seen: string[] }>(
      'select tutorial_step, tutorial_paused, tips_seen from household_members where id = $1',
      [f.ownerId],
    )
  ).rows[0];
const tutorialCount = async () =>
  (await pg.query(`select 1 from tasks where is_tutorial and household_id = $1`, [f.householdId]))
    .rows.length;

describe('treino do Modo Aprendiz', () => {
  it('começa, avança, pausa, retoma e termina', async () => {
    await members.updateTraining(scope(), { action: 'start' });
    expect(await training()).toMatchObject({ tutorial_step: 1, tutorial_paused: false });
    await members.updateTraining(scope(), { action: 'step', step: 3 });
    await members.updateTraining(scope(), { action: 'pause' });
    expect(await training()).toMatchObject({ tutorial_step: 3, tutorial_paused: true });
    await members.updateTraining(scope(), { action: 'resume' });
    await members.updateTraining(scope(), { action: 'finish' });
    expect(await training()).toMatchObject({ tutorial_step: null, tutorial_paused: false });
  });

  it('não avança nem pausa quando não há treino', async () => {
    await members.updateTraining(scope(), { action: 'step', step: 4 });
    await members.updateTraining(scope(), { action: 'pause' });
    expect(await training()).toMatchObject({ tutorial_step: null, tutorial_paused: false });
  });

  it('terminar apaga só as tarefas de treino da própria pessoa', async () => {
    const create = (actorMemberId: string, title: string, isTutorial: boolean) =>
      tasks.createTask({ householdId: f.householdId, actorMemberId, title, isTutorial });
    await create(f.ownerId, 'Treino da Ana', true);
    await create(f.memberId, 'Treino do Pedro', true);
    await create(f.ownerId, 'Tarefa de verdade', false);
    await members.updateTraining(scope(), { action: 'finish' });
    const left = await pg.query<{ title: string }>(
      'select title from tasks where household_id = $1 order by title',
      [f.householdId],
    );
    expect(left.rows.map((r) => r.title)).toEqual(['Tarefa de verdade', 'Treino do Pedro']);
  });

  it('apaga tarefas de treino com mais de 24 horas', async () => {
    await tasks.createTask({
      householdId: f.householdId,
      actorMemberId: f.memberId,
      title: 'Treino antigo',
      isTutorial: true,
    });
    await pg.query(`update tasks set created_at = now() - interval '25 hours' where is_tutorial`);
    await members.updateTraining(scope(), { action: 'tip', tip: 'welcome' });
    expect(await tutorialCount()).toBe(0);
  });

  it('registra cada dica uma única vez', async () => {
    await members.updateTraining(scope(), { action: 'tip', tip: 'undo' });
    await members.updateTraining(scope(), { action: 'tip', tip: 'undo' });
    expect((await training())?.tips_seen).toEqual(['undo']);
  });

  it('expõe o estado do treino no contexto do membro', async () => {
    const authId = crypto.randomUUID();
    await pg.query('update household_members set auth_user_id = $1 where id = $2', [
      authId,
      f.ownerId,
    ]);
    await members.updateTraining(scope(), { action: 'start' });
    await members.updateTraining(scope(), { action: 'tip', tip: 'welcome' });
    await tasks.createTask({ ...scope(), title: 'A' });
    await tasks.createTask({ ...scope(), title: 'Treino', isTutorial: true });
    const ctx = await members.getContext(authId);
    expect(ctx?.member).toMatchObject({
      tutorial_step: 1,
      tutorial_paused: false,
      tips_seen: ['welcome'],
      guided_actions: 1,
    });
  });

  it('recusa ação, passo e dica inválidos e membro de outra casa', async () => {
    await expect(members.updateTraining(scope(), { action: 'x' } as never)).rejects.toThrow();
    await expect(members.updateTraining(scope(), { action: 'step', step: 9 })).rejects.toThrow();
    await expect(
      members.updateTraining(scope(), { action: 'tip', tip: 'Dica Inválida!' }),
    ).rejects.toThrow();
    await expect(
      members.updateTraining(
        { householdId: f.householdId, actorMemberId: f.outsiderId },
        { action: 'start' },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
