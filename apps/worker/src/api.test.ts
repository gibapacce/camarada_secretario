import type { PGlite } from '@electric-sql/pglite';
import { createMemberService, createTaskService } from '@camarada/db';
import { PgliteDbClient, createFixture, createTestDb, type Fixture } from '@camarada/db/testing';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleApi, type ApiDeps } from './api.ts';
import { AuthUnavailableError, createTokenVerifier } from './auth.ts';

const SUPABASE_URL = 'https://teste.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;

let pg: PGlite;
let deps: ApiDeps;
let signingKey: CryptoKey;
let foreignKey: CryptoKey;
let f: Fixture;
let users: { ana: string; pedro: string; outsider: string };

beforeAll(async () => {
  pg = await createTestDb();
  const db = new PgliteDbClient(pg);
  const pair = await generateKeyPair('ES256');
  signingKey = pair.privateKey;
  foreignKey = (await generateKeyPair('ES256')).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256' };
  deps = {
    tasks: createTaskService(db),
    members: createMemberService(db),
    verifyToken: createTokenVerifier({
      supabaseUrl: SUPABASE_URL,
      keys: createLocalJWKSet({ keys: [jwk] }),
    }),
  };
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  f = await createFixture(pg);
  users = { ana: crypto.randomUUID(), pedro: crypto.randomUUID(), outsider: crypto.randomUUID() };
  await pg.query(
    `update household_members set auth_user_id = case id
       when $1::uuid then $4::uuid when $2::uuid then $5::uuid when $3::uuid then $6::uuid end
     where id in ($1, $2, $3)`,
    [f.ownerId, f.memberId, f.outsiderId, users.ana, users.pedro, users.outsider],
  );
});

interface TokenOptions {
  role?: string;
  issuer?: string;
  expiresAt?: number | string;
  key?: CryptoKey;
}

function token(sub: string, o: TokenOptions = {}) {
  return new SignJWT({ role: o.role ?? 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setSubject(sub)
    .setIssuer(o.issuer ?? ISSUER)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(o.expiresAt ?? '1h')
    .sign(o.key ?? signingKey);
}

interface CallOptions {
  as?: string;
  bearer?: string;
  body?: unknown;
  rawBody?: string;
  contentType?: string;
  key?: string | null;
}

async function call(method: string, path: string, o: CallOptions = {}) {
  const headers = new Headers();
  const bearer = o.bearer ?? (o.as ? await token(o.as) : undefined);
  if (bearer) {
    headers.set('authorization', `Bearer ${bearer}`);
  }
  if (o.key !== null && method !== 'GET') {
    headers.set('idempotency-key', o.key ?? crypto.randomUUID());
  }
  const body = o.rawBody ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
  if (body !== undefined) {
    headers.set('content-type', o.contentType ?? 'application/json');
  }
  const res = await handleApi(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      ...(body !== undefined && { body }),
    }),
    deps,
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe('autenticação', () => {
  it('recusa requisição sem token ou com token malformado', async () => {
    expect((await call('GET', '/api/me')).status).toBe(401);
    expect((await call('GET', '/api/me', { bearer: 'abc.def.ghi' })).status).toBe(401);
  });

  it.each<[string, () => TokenOptions]>([
    ['expirado', () => ({ expiresAt: Math.floor(Date.now() / 1000) - 60 })],
    ['de outro emissor', () => ({ issuer: 'https://outro.supabase.co/auth/v1' })],
    ['assinado com outra chave', () => ({ key: foreignKey })],
    ['com papel anon', () => ({ role: 'anon' })],
  ])('recusa token %s', async (_name, options) => {
    const res = await call('GET', '/api/me', { bearer: await token(users.ana, options()) });
    expect(res).toEqual({ status: 401, body: { ok: false, error: 'unauthorized' } });
  });

  it('recusa usuário autenticado que não é membro ativo', async () => {
    expect((await call('GET', '/api/me', { as: crypto.randomUUID() })).status).toBe(403);
  });

  it('informa indisponibilidade quando as chaves de autenticação não carregam', async () => {
    const res = await handleApi(
      new Request('http://localhost/api/me', { headers: { authorization: 'Bearer x' } }),
      {
        ...deps,
        verifyToken: async () => {
          throw new AuthUnavailableError();
        },
      },
    );
    expect(res.status).toBe(503);
  });

  it('erro inesperado vira 500 genérico, sem detalhes', async () => {
    const res = await handleApi(
      new Request('http://localhost/api/me', {
        headers: { authorization: `Bearer ${await token(users.ana)}` },
      }),
      {
        ...deps,
        members: {
          ...deps.members,
          getContext: async () => {
            throw new Error('segredo interno');
          },
        },
      },
    );
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('segredo');
  });
});

describe('perfil', () => {
  it('retorna a pessoa, a casa e os membros ativos', async () => {
    const { status, body } = await call('GET', '/api/me', { as: users.ana });
    expect(status).toBe(200);
    expect(body.member).toMatchObject({ id: f.ownerId, role: 'owner', persona_intensity: 'full' });
    expect(body.household).toMatchObject({ id: f.householdId, timezone: 'America/Sao_Paulo' });
    expect(body.members.map((m: { display_name: string }) => m.display_name)).toEqual([
      'Ana',
      'Pedro',
    ]);
  });

  it('altera a intensidade da persona e o modo aprendiz da própria pessoa', async () => {
    const res = await call('PATCH', '/api/me/preferences', {
      as: users.pedro,
      body: { personaIntensity: 'off', guidanceMode: 'normal' },
    });
    expect(res.body.member).toMatchObject({ persona_intensity: 'off', guidance_mode: 'normal' });
    const ana = await call('GET', '/api/me', { as: users.ana });
    expect(ana.body.member.persona_intensity).toBe('full');
    expect(
      (
        await call('PATCH', '/api/me/preferences', {
          as: users.ana,
          body: { personaIntensity: 'max' },
        })
      ).status,
    ).toBe(400);
  });
});

describe('tarefas', () => {
  it('fluxo completo: criar, listar, editar, concluir, reabrir, cancelar e desfazer', async () => {
    const created = await call('POST', '/api/tasks', {
      as: users.ana,
      body: { title: 'Lavar a louça', assignedToMemberId: f.memberId },
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ ok: true, event: 'task_created' });
    const id: string = created.body.task.id;

    const list = await call('GET', '/api/tasks?view=open', { as: users.pedro });
    expect(list.body.tasks.map((t: { id: string }) => t.id)).toEqual([id]);

    const edited = await call('PATCH', `/api/tasks/${id}`, {
      as: users.pedro,
      body: { changes: { title: 'Lavar a louça do jantar' } },
    });
    expect(edited.body).toMatchObject({ event: 'task_updated' });

    const done = await call('POST', `/api/tasks/${id}/complete`, { as: users.pedro });
    expect(done.body.task).toMatchObject({
      status: 'completed',
      completed_by_member_id: f.memberId,
    });

    expect((await call('POST', `/api/tasks/${id}/reopen`, { as: users.ana })).body.event).toBe(
      'task_reopened',
    );
    expect((await call('POST', `/api/tasks/${id}/cancel`, { as: users.ana })).body.event).toBe(
      'task_cancelled',
    );
    const undo = await call('POST', '/api/undo', { as: users.ana });
    expect(undo.body).toMatchObject({ ok: true, undone_event_type: 'cancelled' });

    const details = await call('GET', `/api/tasks/${id}`, { as: users.ana });
    expect(details.body.events.map((e: { event_type: string }) => e.event_type)).toEqual([
      'created',
      'updated',
      'completed',
      'reopened',
      'cancelled',
      'undone',
    ]);
  });

  it('exige chave de idempotência e não duplica com a mesma chave', async () => {
    const missing = await call('POST', '/api/tasks', {
      as: users.ana,
      body: { title: 'x' },
      key: null,
    });
    expect(missing).toEqual({
      status: 400,
      body: { ok: false, error: 'idempotency_key_required' },
    });

    const key = crypto.randomUUID();
    const first = await call('POST', '/api/tasks', { as: users.ana, body: { title: 'Pão' }, key });
    const again = await call('POST', '/api/tasks', { as: users.ana, body: { title: 'Pão' }, key });
    expect(again.body.replayed).toBe(true);
    expect(again.body.task.id).toBe(first.body.task.id);
  });

  it('ignora casa e autor enviados pelo navegador', async () => {
    const res = await call('POST', '/api/tasks', {
      as: users.ana,
      body: { title: 'x', householdId: f.otherHouseholdId, actorMemberId: f.outsiderId },
    });
    expect(res.body.task).toMatchObject({
      household_id: f.householdId,
      created_by_member_id: f.ownerId,
    });
  });

  it('isola as casas: vizinho não vê nem altera tarefas do coletivo', async () => {
    const id = (await call('POST', '/api/tasks', { as: users.ana, body: { title: 'Nossa' } })).body
      .task.id;
    expect((await call('GET', `/api/tasks/${id}`, { as: users.outsider })).status).toBe(404);
    expect((await call('POST', `/api/tasks/${id}/complete`, { as: users.outsider })).status).toBe(
      404,
    );
    expect((await call('GET', '/api/tasks?view=all', { as: users.outsider })).body.tasks).toEqual(
      [],
    );
  });

  it('cancelar com encerramento da série recorrente', async () => {
    const created = await call('POST', '/api/tasks', {
      as: users.ana,
      body: {
        title: 'Lixo',
        recurrence: { frequency: 'weekly', byWeekday: [1, 4], localTime: '20:00' },
      },
    });
    const res = await call('POST', `/api/tasks/${created.body.task.id}/cancel`, {
      as: users.ana,
      body: { stopRecurrence: true },
    });
    expect(res.body).toMatchObject({ ok: true, recurrence_stopped: true, next_task: null });
  });

  it('devolve resultado de negócio com status adequado', async () => {
    const id = (await call('POST', '/api/tasks', { as: users.ana, body: { title: 'x' } })).body.task
      .id;
    await call('POST', `/api/tasks/${id}/cancel`, { as: users.ana });
    expect(await call('POST', `/api/tasks/${id}/complete`, { as: users.ana })).toMatchObject({
      status: 409,
      body: { ok: false, error: 'task_cancelled' },
    });
    expect((await call('POST', '/api/undo', { as: users.pedro })).status).toBe(409);
  });
});

describe('validação de requisição', () => {
  it.each<[string, string, CallOptions, number]>([
    ['JSON inválido', '/api/tasks', { rawBody: '{oops' }, 400],
    [
      'tipo de conteúdo errado',
      '/api/tasks',
      { rawBody: 'title=x', contentType: 'text/plain' },
      415,
    ],
    [
      'corpo grande demais',
      '/api/tasks',
      { body: { title: 'x', description: 'a'.repeat(20_000) } },
      413,
    ],
    ['corpo que não é objeto', '/api/tasks', { rawBody: '[1,2]' }, 400],
    ['título vazio', '/api/tasks', { body: { title: '' } }, 400],
    [
      'responsável com id inválido',
      '/api/tasks',
      { body: { title: 'x', assignedToMemberId: '' } },
      400,
    ],
  ])('%s', async (_name, path, options, status) => {
    expect((await call('POST', path, { as: users.ana, ...options })).status).toBe(status);
  });

  it('recusa visão desconhecida e id inválido', async () => {
    expect((await call('GET', '/api/tasks?view=tudo', { as: users.ana })).status).toBe(400);
    expect((await call('GET', '/api/tasks/nao-e-uuid', { as: users.ana })).status).toBe(400);
  });

  it('404 para rota desconhecida e 405 para método errado', async () => {
    expect((await call('GET', '/api/nada', { as: users.ana })).status).toBe(404);
    expect((await call('DELETE', '/api/tasks', { as: users.ana })).status).toBe(405);
  });
});
