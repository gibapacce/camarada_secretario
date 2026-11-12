import type {
  TaskDetailsResult as DbTaskDetails,
  MemberContext,
  Task,
  TaskListResult,
  TaskPhoto,
  TaskResult,
} from '@camarada/db';
import { errorMessage } from '@camarada/persona';

export type { MemberContext, Task, TaskEvent, TaskListResult, TaskResult } from '@camarada/db';

/** Foto como o Worker devolve: sem o caminho interno, com URL temporária (ou null se indisponível). */
export type Photo = Omit<TaskPhoto, 'storage_path'> & { url?: string | null };
export type TaskDetailsResult = Omit<DbTaskDetails, 'photos'> & { photos?: Photo[] };
export type PhotoResult = {
  ok: true;
  event: string;
  task: Task;
  photo: Photo;
  replayed?: boolean;
};

export type PersonaIntensity = MemberContext['member']['persona_intensity'];
export type GuidanceMode = MemberContext['member']['guidance_mode'];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export interface ListParams {
  view: 'open' | 'overdue' | 'due' | 'completed' | 'all';
  assignee?: string;
  shared?: boolean;
  from?: string;
  to?: string;
  limit?: number;
}

export interface RecurrenceInput {
  frequency: 'daily' | 'weekly' | 'monthly';
  byWeekday?: number[];
  dayOfMonth?: number;
  localTime: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  assignedToMemberId?: string | null;
  dueAt?: string;
  priority?: Task['priority'];
  effort?: number;
  category?: string;
  room?: string;
  recurrence?: RecurrenceInput;
}

export interface TaskChanges {
  title?: string;
  description?: string | null;
  assignedToMemberId?: string | null;
  dueAt?: string | null;
  priority?: Task['priority'];
  effort?: number | null;
  category?: string | null;
  room?: string | null;
}

export type TaskAction = 'complete' | 'reopen' | 'cancel';

export interface Api {
  me(): Promise<MemberContext>;
  updatePreferences(p: {
    personaIntensity?: PersonaIntensity;
    guidanceMode?: GuidanceMode;
  }): Promise<unknown>;
  listTasks(params: ListParams): Promise<TaskListResult>;
  getTask(id: string): Promise<TaskDetailsResult>;
  createTask(input: CreateTaskInput, key: string): Promise<TaskResult>;
  updateTask(id: string, changes: TaskChanges, key: string): Promise<TaskResult>;
  taskAction(
    id: string,
    action: TaskAction,
    key: string,
    stopRecurrence?: boolean,
  ): Promise<TaskResult>;
  undo(key: string): Promise<TaskResult>;
  uploadPhoto(taskId: string, file: Blob, caption: string, key: string): Promise<PhotoResult>;
  deletePhoto(photoId: string, key: string): Promise<PhotoResult>;
  assistant(text: string, key: string): Promise<{ ok: true; reply: string; changed: boolean }>;
  createTelegramLink(): Promise<TelegramLink>;
  unlinkTelegram(): Promise<unknown>;
}

export interface TelegramLink {
  ok: true;
  code: string;
  expires_in_minutes: number;
  /** Presente só quando o nome do bot está configurado no Worker. */
  link?: string;
}

export function createApi(
  getToken: () => Promise<string | null>,
  fetchFn: typeof fetch = fetch,
): Api {
  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    key?: string,
  ): Promise<T> {
    const token = await getToken();
    if (!token) {
      throw new ApiError(401, 'unauthorized');
    }
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    const isForm = body instanceof FormData;
    if (body !== undefined && !isForm) {
      headers['content-type'] = 'application/json';
    }
    if (key) {
      headers['idempotency-key'] = key;
    }
    let res: Response;
    try {
      res = await fetchFn(path, {
        method,
        headers,
        ...(body !== undefined && { body: isForm ? body : JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError(0, 'network_error');
    }
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res.ok || data?.ok === false) {
      throw new ApiError(res.status, data?.error ?? 'unexpected_error');
    }
    return data as T;
  }

  const enc = encodeURIComponent;

  return {
    me: () => request('GET', '/api/me'),
    updatePreferences: (p) => request('PATCH', '/api/me/preferences', p),
    listTasks: (p) => {
      const q = new URLSearchParams({ view: p.view });
      if (p.assignee) q.set('assignee', p.assignee);
      if (p.shared) q.set('shared', 'true');
      if (p.from) q.set('from', p.from);
      if (p.to) q.set('to', p.to);
      if (p.limit) q.set('limit', String(p.limit));
      return request('GET', `/api/tasks?${q.toString()}`);
    },
    getTask: (id) => request('GET', `/api/tasks/${enc(id)}`),
    createTask: (input, key) => request('POST', '/api/tasks', input, key),
    updateTask: (id, changes, key) => request('PATCH', `/api/tasks/${enc(id)}`, { changes }, key),
    taskAction: (id, action, key, stopRecurrence) =>
      request(
        'POST',
        `/api/tasks/${enc(id)}/${action}`,
        action === 'cancel' ? { stopRecurrence: stopRecurrence === true } : undefined,
        key,
      ),
    undo: (key) => request('POST', '/api/undo', undefined, key),
    uploadPhoto: (taskId, file, caption, key) => {
      const form = new FormData();
      form.set('file', file, 'foto');
      if (caption.trim()) form.set('caption', caption.trim());
      return request('POST', `/api/tasks/${enc(taskId)}/photos`, form, key);
    },
    deletePhoto: (photoId, key) => request('DELETE', `/api/photos/${enc(photoId)}`, undefined, key),
    assistant: (text, key) => request('POST', '/api/assistant', { text }, key),
    createTelegramLink: () => request('POST', '/api/me/telegram'),
    unlinkTelegram: () => request('DELETE', '/api/me/telegram'),
  };
}

export function errorText(error: unknown): string {
  return errorMessage(error instanceof ApiError ? error.code : 'unexpected_error');
}
