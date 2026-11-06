import type { Assistant } from '@camarada/assistant';
import {
  DomainError,
  TASK_VIEWS,
  photoPath,
  type MemberContext,
  type MemberService,
  type PhotoResult,
  type PhotoService,
  type TaskPhoto,
  type TaskService,
} from '@camarada/db';
import { AuthUnavailableError, type TokenVerifier } from './auth.ts';
import { detectImageType, type PhotoStorage } from './storage.ts';

export interface ApiDeps {
  tasks: TaskService;
  members: MemberService;
  photos: PhotoService;
  storage: PhotoStorage;
  assistant: Assistant;
  verifyToken: TokenVerifier;
  maxPhotoBytes?: number;
}

const MAX_BODY_BYTES = 16 * 1024;
export const DEFAULT_MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_SECONDS = 15 * 60;
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
  photo_not_found: 404,
  method_not_allowed: 405,
  idempotency_key_conflict: 409,
  photo_limit: 409,
  payload_too_large: 413,
  photo_too_large: 413,
  unsupported_media_type: 415,
  unsupported_image: 415,
  db_unavailable: 503,
  storage_unavailable: 503,
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

/** O caminho interno do arquivo nunca sai do Worker. */
function publicPhoto({ storage_path: _path, ...photo }: TaskPhoto, url?: string | null) {
  return url === undefined ? photo : { ...photo, url };
}

function publicPhotoResult(r: PhotoResult) {
  return r.ok ? { ...r, photo: publicPhoto(r.photo) } : r;
}

async function removeQuietly(storage: PhotoStorage, paths: string[]) {
  try {
    await storage.remove(paths);
  } catch {
    console.warn('photo_remove_failed');
  }
}

async function uploadPhoto(
  request: Request,
  taskId: string,
  deps: ApiDeps,
  member: MemberContext,
): Promise<Response> {
  const key = idempotencyKey(request);
  if (!UUID_RE.test(taskId)) {
    throw new HttpError('task_not_found');
  }
  const max = deps.maxPhotoBytes ?? DEFAULT_MAX_PHOTO_BYTES;
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    throw new HttpError('unsupported_media_type');
  }
  if (Number(request.headers.get('content-length') ?? 0) > max + 64 * 1024) {
    throw new HttpError('photo_too_large');
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError('invalid_input');
  }
  const file = form.get('file');
  if (file === null || typeof file === 'string') {
    throw new HttpError('invalid_input');
  }
  if (file.size > max) {
    throw new HttpError('photo_too_large');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = detectImageType(bytes);
  if (!contentType) {
    throw new HttpError('unsupported_image');
  }
  const caption = form.get('caption');
  const scope = scopeOf(member);
  const photoId = crypto.randomUUID();
  const path = photoPath(scope.householdId, taskId, photoId, contentType);

  await deps.storage.upload(path, bytes, contentType);
  let r: PhotoResult;
  try {
    r = await deps.photos.addPhoto({
      ...scope,
      taskId,
      photoId,
      contentType,
      sizeBytes: bytes.byteLength,
      ...(typeof caption === 'string' && caption.trim() && { caption }),
      idempotencyKey: key,
    });
  } catch (error) {
    await removeQuietly(deps.storage, [path]);
    throw error;
  }
  // Repetição ou recusa: o arquivo recém-enviado não ficou ligado a nenhum registro.
  if (!r.ok || r.replayed) {
    await removeQuietly(deps.storage, [path]);
  }
  return result(publicPhotoResult(r));
}

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
      GET: async ({ params, deps, member }) => {
        const r = await deps.tasks.getTask({
          householdId: member.member.household_id,
          taskId: params[0] ?? '',
        });
        if (!r.ok || !r.photos) {
          return result(r);
        }
        let urls = new Map<string, string>();
        if (r.photos.length > 0) {
          try {
            urls = await deps.storage.sign(
              r.photos.map((p) => p.storage_path),
              SIGNED_URL_SECONDS,
            );
          } catch {
            console.warn('photo_sign_failed');
          }
        }
        return json({
          ...r,
          photos: r.photos.map((p) => publicPhoto(p, urls.get(p.storage_path) ?? null)),
        });
      },
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
    pattern: /^\/api\/tasks\/([^/]+)\/photos$/,
    methods: {
      POST: ({ request, params, deps, member }) =>
        uploadPhoto(request, params[0] ?? '', deps, member),
    },
  },
  {
    pattern: /^\/api\/photos\/([^/]+)$/,
    methods: {
      DELETE: async ({ request, params, deps, member }) => {
        const r = await deps.photos.deletePhoto({
          ...scopeOf(member),
          photoId: params[0] ?? '',
          idempotencyKey: idempotencyKey(request),
        });
        if (r.ok && r.event === 'photo_removed') {
          await removeQuietly(deps.storage, [r.photo.storage_path]);
        }
        return result(publicPhotoResult(r));
      },
    },
  },
  {
    pattern: /^\/api\/assistant$/,
    methods: {
      POST: async ({ request, deps, member }) => {
        const key = idempotencyKey(request);
        const body = await readJson(request);
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text || text.length > 1000) {
          throw new HttpError('invalid_input');
        }
        const r = await deps.assistant.handle({ member, text, key });
        return json({ ok: true, reply: r.reply, changed: r.changed });
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
