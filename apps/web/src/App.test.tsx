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
    photo_count: 0,
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
      guidance_since: '2026-10-26T12:00:00Z',
      guided_actions: 0,
      tutorial_step: null,
      tutorial_paused: false,
      tips_seen: [],
      telegram_linked: false,
      reminders: { before_24h: false, due: true, overdue: true },
    },
    household: {
      id: HOUSE,
      name: 'Casa Teste',
      timezone: 'America/Sao_Paulo',
      quiet_start: '21:00',
      quiet_end: '09:00',
      overdue_reminder_time: '09:00',
      overdue_reminder_days: 30,
    },
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
    getTask: vi.fn((_id: string) =>
      ok({
        task: { ...pending, photo_count: 1 },
        events: [],
        photos: [
          {
            id: '00000000-0000-4000-8000-0000000000f1',
            task_id: pending.id,
            content_type: 'image/jpeg' as const,
            size_bytes: 1000,
            caption: 'Antes da faxina',
            uploaded_by_member_id: OTHER,
            created_at: '2026-10-26T12:00:00Z',
            url: 'https://x.supabase.co/storage/v1/object/sign/task-photos/a.jpg?token=t',
          },
        ],
      }),
    ),
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
    uploadPhoto: vi.fn((_taskId: string, _file: Blob, caption: string, _key: string) =>
      ok({
        event: 'photo_added',
        task: pending,
        photo: {
          id: '00000000-0000-4000-8000-0000000000f2',
          task_id: pending.id,
          content_type: 'image/jpeg' as const,
          size_bytes: 10,
          caption,
          uploaded_by_member_id: ME,
          created_at: '2026-10-26T13:00:00Z',
        },
      }),
    ),
    deletePhoto: vi.fn((_photoId: string, _key: string) =>
      ok({
        event: 'photo_removed',
        task: pending,
        photo: {
          id: '00000000-0000-4000-8000-0000000000f1',
          task_id: pending.id,
          content_type: 'image/jpeg' as const,
          size_bytes: 10,
          caption: null,
          uploaded_by_member_id: ME,
          created_at: '2026-10-26T13:00:00Z',
        },
      }),
    ),
    assistant: vi.fn((text: string, _key: string) =>
      ok({ reply: `Eco: ${text}`, changed: text.startsWith('tarefa') }),
    ),
    createTelegramLink: vi.fn(() =>
      ok({
        code: 'ABC123DEF456',
        expires_in_minutes: 15,
        link: 'https://t.me/camarada_bot?start=ABC123DEF456',
      }),
    ),
    unlinkTelegram: vi.fn(() => Promise.resolve({ ok: true })),
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

  it('liga o lembrete de 24 h e mostra o horário de silêncio da casa', async () => {
    const api = fakeApi('full');
    renderApp({ auth: fakeAuth(true), api }, '/preferencias');
    expect(await screen.findByText(/Silêncio das 21h às 9h/)).toBeDefined();
    fireEvent.click(screen.getByLabelText(/24 h antes/));
    await waitFor(() =>
      expect(api.updatePreferences).toHaveBeenCalledWith({ reminders: { before24h: true } }),
    );
  });

  it('mostra as fotos da tarefa com URL temporária e legenda', async () => {
    renderApp({ auth: fakeAuth(true), api: fakeApi('full') }, `/tarefas/${task().id}`);
    const img = await screen.findByRole('img', { name: 'Antes da faxina' });
    expect(img.getAttribute('src')).toContain('token=t');
    expect(screen.getByRole('heading', { name: 'Arquivo Nacional' })).toBeDefined();
  });

  it('anexa foto com chave de idempotência e avisa com o título exato', async () => {
    const api = fakeApi('full');
    renderApp({ auth: fakeAuth(true), api }, `/tarefas/${task().id}`);
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'f.jpg', { type: 'image/jpeg' });
    fireEvent.change(await screen.findByLabelText('Foto'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('Legenda (opcional)'), { target: { value: 'Depois' } });
    fireEvent.click(screen.getByRole('button', { name: 'Anexar foto' }));
    await waitFor(() => expect(api.uploadPhoto).toHaveBeenCalledTimes(1));
    const [taskId, blob, caption, key] = api.uploadPhoto.mock.calls[0] ?? [];
    expect([taskId, blob, caption]).toEqual([task().id, file, 'Depois']);
    expect(key).toMatch(UUID_RE);
    const toast = await screen.findByRole('status');
    await waitFor(() =>
      expect(toast.textContent).toContain('📸 Prova documental anexada a "Lavar a louça".'),
    );
  });

  it('recusa arquivo que não é imagem antes de enviar', async () => {
    const api = fakeApi('off');
    renderApp({ auth: fakeAuth(true), api }, `/tarefas/${task().id}`);
    const file = new File(['oi'], 'nota.txt', { type: 'text/plain' });
    fireEvent.change(await screen.findByLabelText('Foto'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Anexar foto' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'O arquivo precisa ser uma imagem.',
    );
    expect(api.uploadPhoto).not.toHaveBeenCalled();
  });

  it('conversa com o assistente e recarrega os dados quando algo muda', async () => {
    const api = fakeApi('full');
    renderApp({ auth: fakeAuth(true), api }, '/conversar');
    expect(await screen.findByRole('heading', { name: 'Falar com o Camarada' })).toBeDefined();
    const meCalls = api.me.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'tarefa: varrer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Eco: tarefa: varrer')).toBeDefined();
    const [text, key] = api.assistant.mock.calls[0] ?? [];
    expect(text).toBe('tarefa: varrer');
    expect(key).toMatch(UUID_RE);
    await waitFor(() => expect(api.me.mock.calls.length).toBeGreaterThan(meCalls));
  });

  it('Primeiros passos: copia um exemplo e rotula neutro no modo sério', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderApp({ auth: fakeAuth(true), api: fakeApi('off') }, '/primeiros-passos');
    expect(await screen.findByRole('heading', { name: 'Primeiros passos' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar: O que falta fazer?' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('O que falta fazer?'));
    expect(await screen.findByText('Copiado!')).toBeDefined();
  });

  it('Preferências: gera o código do Telegram e mostra o link do bot', async () => {
    const api = fakeApi('full');
    renderApp({ auth: fakeAuth(true), api }, '/preferencias');
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar código' }));
    expect(await screen.findByText('/start ABC123DEF456')).toBeDefined();
    const link = screen.getByRole('link', { name: /abra o bot/ });
    expect(link.getAttribute('href')).toBe('https://t.me/camarada_bot?start=ABC123DEF456');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('o atalho do treino abre a conversa e envia "treino" uma única vez', async () => {
    const api = fakeApi('full');
    renderApp({ auth: fakeAuth(true), api }, '/primeiros-passos');
    fireEvent.click(await screen.findByRole('link', { name: 'Começar o treino' }));
    expect(await screen.findByText('Eco: treino')).toBeDefined();
    expect(api.assistant).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('');
  });
});
