// Utilitários de teste (somente Node): Postgres local via PGlite com as migrations reais.
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_FUNCTIONS, toDomainError, type DbClient, type DbFunction } from './client.ts';

const ROOT = new URL('../../../', import.meta.url);
export const MIGRATIONS_DIR = fileURLToPath(new URL('supabase/migrations/', ROOT).href);
export const SEED_FILE = fileURLToPath(new URL('supabase/seed.sql', ROOT).href);

export async function applyMigrations(pg: PGlite): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    await pg.exec(await readFile(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return files;
}

export async function createTestDb(dataDir?: string): Promise<PGlite> {
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await applyMigrations(pg);
  return pg;
}

/** Mesmo contrato do PostgrestDbClient, executando as funções direto no PGlite. */
export class PgliteDbClient implements DbClient {
  constructor(readonly pg: PGlite) {}

  async call(fn: DbFunction, args: Record<string, unknown>): Promise<unknown> {
    if (!DB_FUNCTIONS.includes(fn)) {
      throw new Error(`Função não permitida: ${fn}`);
    }
    const entries = Object.entries(args).filter(([, v]) => v !== undefined);
    for (const [key] of entries) {
      if (!/^p_[a-z_]+$/.test(key)) {
        throw new Error(`Argumento inválido: ${key}`);
      }
    }
    const placeholders = entries.map(([key], i) => `${key} => $${i + 1}`).join(', ');
    const params = entries.map(([, v]) =>
      v !== null && typeof v === 'object' ? JSON.stringify(v) : v,
    );
    try {
      const res = await this.pg.query<{ result: unknown }>(
        `select public.${fn}(${placeholders}) as result`,
        params,
      );
      return res.rows[0]?.result;
    } catch (error) {
      throw toDomainError(error);
    }
  }
}

export interface Fixture {
  householdId: string;
  ownerId: string;
  memberId: string;
  inactiveMemberId: string;
  otherHouseholdId: string;
  outsiderId: string;
}

/** Cria uma casa nova (com dois membros ativos e um inativo) e uma casa vizinha isolada. */
export async function createFixture(pg: PGlite, timezone = 'America/Sao_Paulo'): Promise<Fixture> {
  const res = await pg.query<Fixture>(
    `with h as (
       insert into households (name, timezone) values ('Coletivo de Teste', $1) returning id
     ), o as (
       insert into households (name) values ('Casa Vizinha') returning id
     ), owner as (
       insert into household_members (household_id, display_name, role)
       select id, 'Ana', 'owner' from h returning id
     ), member as (
       insert into household_members (household_id, display_name)
       select id, 'Pedro' from h returning id
     ), inactive as (
       insert into household_members (household_id, display_name, is_active)
       select id, 'Ex-membro', false from h returning id
     ), outsider as (
       insert into household_members (household_id, display_name)
       select id, 'Vizinho' from o returning id
     )
     select (select id from h) as "householdId", (select id from owner) as "ownerId",
       (select id from member) as "memberId", (select id from inactive) as "inactiveMemberId",
       (select id from o) as "otherHouseholdId", (select id from outsider) as "outsiderId"`,
    [timezone],
  );
  const fixture = res.rows[0];
  if (!fixture) {
    throw new Error('Falha ao criar fixture');
  }
  return fixture;
}
