import {
  DomainError,
  TASK_VIEWS,
  type MemberContext,
  type MemberService,
  type TaskService,
} from '@camarada/db';
import { AuthUnavailableError, type TokenVerifier } from './auth.ts';

export interface ApiDeps {
  tasks: TaskService;
  members: MemberService;
  verifyToken: TokenVerifier;
}

const MAX_BODY_BYTES = 16 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_BY_ERROR: Record<string, number> = {
  invalid_input: 400,
  invalid_json: 400,
  invalid_assignee: 400,
  idempotency_key_required: 400,
  unauthorized: 401,
  forbidden: 403,
  not_a_member: 403,
  not_found: 404,
  task_not_found: 404,
  method_not_allowed: 405,
  idempotency_key_conflict: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  db_unavailable: 503,
  auth_unavailable: 503,
  not_configured: 503,
};

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
} as const;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function fail(code: string): Response {
  return json({ ok: false, error: code }, STATUS_BY_ERROR[code] ?? 500);
}

/** Resultados de negócio ({ok:false}) viram 404/409; o corpo estruturado é sempre devolvido. */
function result(body: unknown): Response {
  const r = body as { ok?: boolean; error?: string };
  if (r.ok !== false) {
    return json(body);
  }
  return json(body, STATUS_BY_ERROR[r.error ?? ''] ?? 409);
}

class HttpError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new HttpError('unsupported_media_type');
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    throw new HttpError('payload_too_large');
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new HttpError('payload_too_large');
  }
  try {
    const body: unknown = JSON.parse(text);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError('invalid_json');
    }
    return body as Record<string, unknown>;
  } catch {
    throw new HttpError('invalid_json');
  }
}

function idempotencyKey(request: Request): string {
  const key = request.headers.get('idempotency-key') ?? '';
  if (!UUID_RE.test(key)) {
    throw new HttpError('idempotency_key_required');
  }
  return `web:${key.toLowerCase()}`;
}

type Handler = (ctx: {
  request: Request;
  url: URL;
  params: string[];
  deps: ApiDeps;
  member: MemberContext;
}) => Promise<Response>;

interface Route {
  pattern: RegExp;
  methods: Partial<Record<string, Handler>>;
}

const scopeOf = (member: MemberContext) => ({
  householdId: member.member.household_id,
  actorMemberId: member.member.id,
});

const routes: Route[] = [
  {
    pattern: /^\/api\/me$/,
    methods: { GET: async ({ member }) => json(member) },
  },
  {
    pattern: /^\/api\/me\/preferences$/,
    methods: {
      PATCH: async ({ request, deps, member }) =>
        result(await deps.members.updatePreferences(scopeOf(member), await readJson(request))),
    },
  },
  {
    pattern: /^\/api\/tasks$/,
    methods: {
      GET: async ({ url, deps, member }) => {
        const q = url.searchParams;
        const view = q.get('view') ?? 'open';
        if (!(TASK_VIEWS as readonly string[]).includes(view)) {
          throw new HttpError('invalid_input');
        }
        return result(
          await deps.tasks.listTasks({
            householdId: member.member.household_id,
            view: view as (typeof TASK_VIEWS)[number],
            ...(q.get('assignee') && { assignedToMemberId: q.get('assignee') ?? '' }),
            ...(q.get('shared') === 'true' && { onlyShared: true }),
            ...(q.get('from') && { from: q.get('from') ?? '' }),
            ...(q.get('to') && { to: q.get('to') ?? '' }),
            ...(q.get('tutorial') === 'true' && { includeTutorial: true }),
            ...(q.get('limit') && { limit: Number(q.get('limit')) }),
          }),
        );
      },
      POST: async ({ request, deps, member }) => {
        const key = idempotencyKey(request);
        const body = await readJson(request);
        return result(
          await deps.tasks.createTask({
            ...(body as object),
            ...scopeOf(member),
            idempotencyKey: key,
          } as Parameters<TaskService['createTask']>[0]),
        );
      },
    },
  },
  {
    pattern: /^\/api\/tasks\/([^/]+)$/,
    methods: {
      GET: async ({ params, deps, member }) =>
        result(
          await deps.tasks.getTask({
            householdId: member.member.household_id,
            taskId: params[0] ?? '',
          }),
        ),
      PATCH: async ({ request, params, deps, member }) => {
        const key = idempotencyKey(request);
        const body = await readJson(request);
        return result(
          await deps.tasks.updateTask({
            ...scopeOf(member),
            taskId: params[0] ?? '',
            changes: body.changes as Parameters<TaskService['updateTask']>[0]['changes'],
            idempotencyKey: key,
          }),
        );
      },
    },
  },
  {
    pattern: /^\/api\/tasks\/([^/]+)\/(complete|reopen|cancel)$/,
    methods: {
      POST: async ({ request, params, deps, member }) => {
        const key = idempotencyKey(request);
        const action = params[1] as 'complete' | 'reopen' | 'cancel';
        const input = { ...scopeOf(member), taskId: params[0] ?? '', idempotencyKey: key };
        if (action === 'complete') {
          return result(await deps.tasks.completeTask(input));
        }
        if (action === 'reopen') {
          return result(await deps.tasks.reopenTask(input));
        }
        const body = request.headers.get('content-type') ? await readJson(request) : {};
        return result(
          await deps.tasks.cancelTask({ ...input, stopRecurrence: body.stopRecurrence === true }),
        );
      },
    },
  },
  {
    pattern: /^\/api\/undo$/,
    methods: {
      POST: async ({ request, deps, member }) =>
        result(
          await deps.tasks.undoLastAction({
            ...scopeOf(member),
            idempotencyKey: idempotencyKey(request),
          }),
        ),
    },
  },
];

export async function handleApi(request: Request, deps: ApiDeps | null): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/api/health') {
    return request.method === 'GET'
      ? json({ ok: true, service: 'camarada-ho-chi-miau', configured: deps !== null })
      : fail('method_not_allowed');
  }

  let route: Route | undefined;
  let params: string[] = [];
  for (const candidate of routes) {
    const match = candidate.pattern.exec(url.pathname);
    if (match) {
      route = candidate;
      params = match.slice(1);
      break;
    }
  }
  if (!route) {
    return fail('not_found');
  }
  const handler = route.methods[request.method];
  if (!handler) {
    return fail('method_not_allowed');
  }
  if (!deps) {
    return fail('not_configured');
  }

  try {
    const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
    const user = token ? await deps.verifyToken(token) : null;
    if (!user) {
      return fail('unauthorized');
    }
    const member = await deps.members.getContext(user.id);
    if (!member) {
      return fail('not_a_member');
    }
    return await handler({ request, url, params, deps, member });
  } catch (error) {
    if (error instanceof HttpError || error instanceof DomainError) {
      return fail(error.code);
    }
    if (error instanceof AuthUnavailableError) {
      return fail('auth_unavailable');
    }
    console.error('api_error', error instanceof Error ? error.name : 'unknown');
    return fail('internal_error');
  }
}
