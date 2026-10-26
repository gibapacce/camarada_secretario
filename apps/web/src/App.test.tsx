import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, type Services } from './App.tsx';
import {
  ApiError,
  type Api,
  type MemberContext,
  type PersonaIntensity,
  type Task,
} from './lib/api.ts';
import type { AuthPort } from './lib/auth.ts';

const ME = '00000000-0000-4000-8000-000000000011';
const OTHER = '00000000-0000-4000-8000-000000000012';
const HOUSE = '00000000-0000-4000-8000-000000000001';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function task(over: Partial<Task> = {}): Task {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    household_id: HOUSE,
    title: 'Lavar a louça',
    description: null,
    status: 'pending',
    priority: 'normal',
    effort: null,
    is_tutorial: false,
    category: null,
    room: null,
    assigned_to_member_id: ME,
    created_by_member_id: OTHER,
    due_at: '2026-10-27T17:00:00Z',
    recurrence_rule_id: null,
    completed_by_member_id: null,
    completed_at: null,
    created_at: '2026-10-26T12:00:00Z',
    updated_at: '2026-10-26T12:00:00Z',
    is_overdue: false,
    ...over,
  };
}

function context(intensity: PersonaIntensity): MemberContext {
  return {
    ok: true,
    member: {
      id: ME,
      household_id: HOUSE,
      display_name: 'Giba',
      role: 'owner',
      persona_intensity: intensity,
      guidance_mode: 'guided',
    },
    household: { id: HOUSE, name: 'Casa Teste', timezone: 'America/Sao_Paulo' },
    members: [
      { id: OTHER, display_name: 'Deise', role: 'member' },
      { id: ME, display_name: 'Giba', role: 'owner' },
    ],
  };
}

function fakeApi(intensity: PersonaIntensity = 'full') {
  const pending = task();
  const overdue = task({
    id: '00000000-0000-4000-8000-0000000000a2',
    title: 'Levar o lixo',
    is_overdue: true,
  });
  const ok = <T extends object>(body: T) => Promise.resolve({ ok: true as const, ...body });
  return {
    me: vi.fn(() => Promise.resolve(context(intensity))),
    updatePreferences: vi.fn((_p: unknown) => Promise.resolve({ ok: true })),
    listTasks: vi.fn((p: { view: string }) =>
      ok({
        view: 'open' as const,
        tasks: p.view === 'overdue' ? [overdue] : p.view === 'completed' ? [] : [pending, overdue],
      }),
    ),
    getTask: vi.fn((_id: string) => ok({ task: pending, events: [] })),
    createTask: vi.fn((input: { title: string }, _key: string) =>
      ok({
        event: 'task_created',
        task: task({ id: '00000000-0000-4000-8000-0000000000b1', title: input.title }),
      }),
    ),
    updateTask: vi.fn((_id: string, _c: unknown, _key: string) =>
      ok({ event: 'task_updated', task: pending }),
    ),
    taskAction: vi.fn((_id: string, _a: string, _key: string, _stop?: boolean) =>
      ok({ event: 'task_completed', task: { ...pending, status: 'completed' as const } }),
    ),
    undo: vi.fn((_key: string) => ok({ event: 'action_undone', task: pending })),
  } satisfies Api;
}

function fakeAuth(signedIn: boolean) {
  return {
    getAccessToken: () => Promise.resolve(signedIn ? 'tok' : null),
    subscribe: (cb: (signedIn: boolean) => void) => {
      queueMicrotask(() => cb(signedIn));
      return () => undefined;
    },
    signIn: vi.fn((_e: string, _p: string) =>
      Promise.resolve({ error: 'E-mail ou senha incorretos.' }),
    ),
    signOut: vi.fn(() => Promise.resolve()),
  } satisfies AuthPort;
}

function renderApp(services: Services, path = '/') {
  window.history.replaceState(null, '', path);
  return render(<App services={services} />);
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
});

describe('App', () => {
  it('avisa quando falta configuração', () => {
    render(<App services={null} />);
    expect(screen.getByRole('alert').textContent).toContain('VITE_SUPABASE_URL');
  });

  it('mostra o login e repassa e-mail e senha', async () => {
    const auth = fakeAuth(false);
    renderApp({ auth, api: fakeApi() });
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'segredo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('E-mail ou senha incorretos.');
    expect(auth.signIn).toHaveBeenCalledWith('a@b.com', 'segredo');
  });

  it('resumo com a persona completa', async () => {
    renderApp({ auth: fakeAuth(true), api: fakeApi('full') });
    expect(await screen.findByRole('heading', { name: 'Assembleia Geral' })).toBeDefined();
    expect(screen.getByText(/Miau, camarada Giba!/)).toBeDefined();
    const counter = await screen.findByText('Missões em andamento');
    expect(counter.previousElementSibling?.textContent).toBe('2');
    expect(screen.getByRole('link', { name: 'Plano Quinquenal' })).toBeDefined();
  });

  it('modo sério usa rótulos neutros sem perder funções', async () => {
    renderApp({ auth: fakeAuth(true), api: fakeApi('off') });
    expect(await screen.findByRole('heading', { name: 'Resumo' })).toBeDefined();
    expect(await screen.findByText('Pendentes')).toBeDefined();
    expect(screen.queryByText(/camarada/i)).toBeNull();
    expect(screen.getByRole('link', { name: 'Tarefas' })).toBeDefined();
    expect(screen.getAllByRole('button', { name: /^Concluir/ }).length).toBeGreaterThan(0);
  });

  it('cria tarefa com chave de idempotência e sem inventar prazo', async () => {
    const api = fakeApi('off');
    renderApp({ auth: fakeAuth(true), api }, '/tarefas/nova');
    fireEvent.change(await screen.findByLabelText('Título'), {
      target: { value: 'Varrer a sala' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalledTimes(1));
    const [input, key] = api.createTask.mock.calls[0] ?? [];
    expect(input).toEqual({ title: 'Varrer a sala', priority: 'normal', assignedToMemberId: null });
    expect(key).toMatch(UUID_RE);
    expect(await screen.findByText('Tarefa criada: "Varrer a sala".')).toBeDefined();
    expect(window.location.pathname).toBe('/tarefas/00000000-0000-4000-8000-0000000000b1');
  });

  it('converte o prazo do fuso da casa para UTC', async () => {
    const api = fakeApi('off');
    renderApp({ auth: fakeAuth(true), api }, '/tarefas/nova');
    fireEvent.change(await screen.findByLabelText('Título'), { target: { value: 'Pagar luz' } });
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-11-05' } });
    fireEvent.change(screen.getByLabelText('Hora'), { target: { value: '18:30' } });
    fireEvent.change(screen.getByLabelText('Responsável'), { target: { value: OTHER } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(api.createTask).toHaveBeenCalled());
    expect(api.createTask.mock.calls[0]?.[0]).toMatchObject({
      dueAt: '2026-11-05T21:30:00.000Z',
      assignedToMemberId: OTHER,
    });
  });

  it('conclui pela lista e permite desfazer', async () => {
    const api = fakeApi('full');
    renderApp({ auth: fakeAuth(true), api }, '/tarefas');
    fireEvent.click(await screen.findByRole('button', { name: 'Concluir "Lavar a louça"' }));
    await waitFor(() => expect(api.taskAction).toHaveBeenCalled());
    expect(api.taskAction.mock.calls[0]?.slice(0, 2)).toEqual([
      '00000000-0000-4000-8000-0000000000a1',
      'complete',
    ]);
    const toast = await screen.findByRole('status');
    await waitFor(() =>
      expect(toast.textContent).toContain('Vitória do proletariado: "Lavar a louça" concluída.'),
    );
    fireEvent.click(within(toast).getByRole('button', { name: 'Desfazer' }));
    await waitFor(() => expect(api.undo).toHaveBeenCalledTimes(1));
    expect(api.undo.mock.calls[0]?.[0]).toMatch(UUID_RE);
  });

  it('em falha diz claramente que nada foi registrado', async () => {
    const api = fakeApi('full');
    api.createTask.mockImplementation(() => Promise.reject(new ApiError(503, 'db_unavailable')));
    renderApp({ auth: fakeAuth(true), api }, '/tarefas/nova');
    fireEvent.change(await screen.findByLabelText('Título'), { target: { value: 'Varrer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
    const toast = await screen.findByRole('status');
    await waitFor(() => expect(toast.textContent).toContain('Nada foi registrado.'));
    expect(toast.textContent).toContain('O banco está indisponível.');
    expect(window.location.pathname).toBe('/tarefas/nova');
  });

  it('login sem casa vinculada mostra aviso', async () => {
    const api = fakeApi();
    api.me.mockImplementation(() => Promise.reject(new ApiError(403, 'not_a_member')));
    renderApp({ auth: fakeAuth(true), api });
    expect(await screen.findByText('Este login não está ligado a nenhuma casa.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
  });

  it('troca a intensidade da persona e recarrega o perfil', async () => {
    const api = fakeApi('full');
    renderApp({ auth: fakeAuth(true), api }, '/preferencias');
    fireEvent.click(await screen.findByLabelText(/Modo sério/));
    await waitFor(() =>
      expect(api.updatePreferences).toHaveBeenCalledWith({ personaIntensity: 'off' }),
    );
    await act(() => Promise.resolve());
    await waitFor(() => expect(api.me.mock.calls.length).toBeGreaterThan(1));
  });
});
