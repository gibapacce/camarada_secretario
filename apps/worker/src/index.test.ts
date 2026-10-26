import { describe, expect, it, vi } from 'vitest';
import worker, { type Env } from './index.ts';

function makeEnv(): Env {
  return {
    APP_ENV: 'test',
    ASSETS: { fetch: vi.fn(async () => new Response('<html></html>')) } as unknown as Fetcher,
  };
}

describe('worker fetch', () => {
  it('responde /api/health', async () => {
    const res = await worker.fetch(new Request('http://localhost/api/health'), makeEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true, service: 'camarada-ho-chi-miau', env: 'test' });
  });

  it('recusa método diferente de GET no health', async () => {
    const res = await worker.fetch(
      new Request('http://localhost/api/health', { method: 'POST' }),
      makeEnv(),
    );
    expect(res.status).toBe(405);
  });

  it('retorna 404 JSON para rota de API desconhecida', async () => {
    const res = await worker.fetch(new Request('http://localhost/api/nada'), makeEnv());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: 'not_found' });
  });

  it('delega rotas fora de /api para os assets do painel', async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request('http://localhost/tarefas'), env);
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    expect(await res.text()).toBe('<html></html>');
  });

  it('não confunde /apiario com a API', async () => {
    const env = makeEnv();
    await worker.fetch(new Request('http://localhost/apiario'), env);
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
  });
});
