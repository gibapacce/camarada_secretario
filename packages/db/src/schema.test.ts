import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTaskService } from './tasks.ts';
import {
  PgliteDbClient,
  SEED_FILE,
  applyMigrations,
  createFixture,
  createTestDb,
  type Fixture,
} from './testing.ts';

let pg: PGlite;
let f: Fixture;

beforeAll(async () => {
  pg = await createTestDb();
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  f = await createFixture(pg);
});

describe('esquema', () => {
  it('liga RLS em todas as tabelas públicas', async () => {
    const res = await pg.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );
    expect(res.rows.length).toBeGreaterThanOrEqual(6);
    expect(res.rows.filter((r) => !r.relrowsecurity)).toEqual([]);
  });

  it('impede atribuir tarefa a pessoa de outra casa (chave composta)', async () => {
    await expect(
      pg.query(
        `insert into tasks (household_id, title, created_by_member_id, assigned_to_member_id)
         values ($1, 'x', $2, $3)`,
        [f.householdId, f.ownerId, f.outsiderId],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('exige completed_at quando a tarefa está concluída', async () => {
    await expect(
      pg.query(
        `insert into tasks (household_id, title, created_by_member_id, status)
         values ($1, 'x', $2, 'completed')`,
        [f.householdId, f.ownerId],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('aplica o seed de desenvolvimento sem erros e de forma repetível', async () => {
    const seed = await readFile(SEED_FILE, 'utf8');
    await pg.exec(seed);
    await pg.exec(seed);
    const res = await pg.query<{ n: number }>(
      `select count(*)::int as n from tasks where household_id = '00000000-0000-4000-8000-000000000001'`,
    );
    expect(res.rows[0]?.n).toBe(2);
  });
});

describe('persistência', () => {
  it('mantém as tarefas após fechar e reabrir o banco', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'camarada-db-'));
    try {
      const first = await createTestDb(dir);
      const fx = await createFixture(first);
      const created = await createTaskService(new PgliteDbClient(first)).createTask({
        householdId: fx.householdId,
        actorMemberId: fx.ownerId,
        title: 'Levar o lixo',
      });
      await first.close();

      const reopened = new PGlite(dir);
      const list = await createTaskService(new PgliteDbClient(reopened)).listTasks({
        householdId: fx.householdId,
      });
      expect(created.ok).toBe(true);
      expect(list.tasks.map((t) => t.title)).toEqual(['Levar o lixo']);
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('migrations não podem ser aplicadas duas vezes por engano', async () => {
    const fresh = await createTestDb();
    await expect(applyMigrations(fresh)).rejects.toThrow(/already exists/);
    await fresh.close();
  });
});
