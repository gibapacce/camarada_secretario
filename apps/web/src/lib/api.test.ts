// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from './api.ts';

function fakeFetch(status: number, body: unknown) {
  return vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

describe('createApi', () => {
  it('envia o token e a chave de idempotência', async () => {
    const f = fakeFetch(200, { ok: true, event: 'task_created', task: { id: 't1', title: 'X' } });
    const api = createApi(() => Promise.resolve('tok'), f);
    await api.createTask({ title: 'X' }, '11111111-1111-4111-8111-111111111111');
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe('/api/tasks');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer tok',
      'idempotency-key': '11111111-1111-4111-8111-111111111111',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual({ title: 'X' });
  });

  it('monta a consulta da lista', async () => {
    const f = fakeFetch(200, { ok: true, view: 'due', tasks: [] });
    const api = createApi(() => Promise.resolve('tok'), f);
    await api.listTasks({ view: 'due', from: '2026-10-26T03:00:00.000Z', shared: true, limit: 50 });
    expect(f.mock.calls[0]?.[0]).toBe(
      '/api/tasks?view=due&shared=true&from=2026-10-26T03%3A00%3A00.000Z&limit=50',
    );
  });

  it('transforma {ok:false} em ApiError com o código', async () => {
    const api = createApi(
      () => Promise.resolve('tok'),
      fakeFetch(409, { ok: false, error: 'undo_conflict' }),
    );
    await expect(api.undo('k')).rejects.toMatchObject({ status: 409, code: 'undo_conflict' });
  });

  it('não chama a API sem sessão', async () => {
    const f = fakeFetch(200, {});
    const api = createApi(() => Promise.resolve(null), f);
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    expect(f).not.toHaveBeenCalled();
  });

  it('cancelar envia stopRecurrence', async () => {
    const f = fakeFetch(200, { ok: true, event: 'task_cancelled', task: { id: 't1', title: 'X' } });
    const api = createApi(() => Promise.resolve('tok'), f);
    await api.taskAction('t1', 'cancel', 'k', true);
    expect(f.mock.calls[0]?.[0]).toBe('/api/tasks/t1/cancel');
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body))).toEqual({ stopRecurrence: true });
  });
});
