import { actionMessage, failureMessage, panelText, type PanelEvent } from '@camarada/persona';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Mascot } from './components/Mascot.tsx';
import { ApiError, errorText, type Api, type TaskResult } from './lib/api.ts';
import {
  AppContext,
  useApp,
  useLoad,
  type ActionOptions,
  type AppContextValue,
} from './lib/app-context.ts';
import type { AuthPort } from './lib/auth.ts';
import { Link, usePath } from './lib/router.tsx';
import { CalendarPage } from './pages/CalendarPage.tsx';
import { NewTaskPage } from './pages/NewTaskPage.tsx';
import { PreferencesPage } from './pages/PreferencesPage.tsx';
import { SummaryPage } from './pages/SummaryPage.tsx';
import { TaskDetailsPage } from './pages/TaskDetailsPage.tsx';
import { TasksPage } from './pages/TasksPage.tsx';

export interface Services {
  auth: AuthPort;
  api: Api;
}

export function App({ services }: { services: Services | null }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => services?.auth.subscribe(setSignedIn), [services]);

  if (!services) {
    return (
      <main className="center">
        <p role="alert">
          Painel sem configuração do Supabase (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).
        </p>
      </main>
    );
  }
  if (signedIn === null) {
    return (
      <main className="center" aria-busy="true">
        <Mascot size={72} />
      </main>
    );
  }
  return signedIn ? <Shell services={services} /> : <Login auth={services.auth} />;
}

function Login({ auth }: { auth: AuthPort }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const result = await auth.signIn(
      String(data.get('email') ?? ''),
      String(data.get('password') ?? ''),
    );
    setBusy(false);
    setError(result.error);
  }

  return (
    <main className="center">
      <form className="card login" onSubmit={submit}>
        <Mascot size={80} />
        <h1>Camarada Ho Chi Miau</h1>
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" name="email" type="email" autoComplete="username" required />
        </div>
        <div className="field">
          <label htmlFor="password">Senha</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Entrar
        </button>
      </form>
    </main>
  );
}

interface Toast {
  id: number;
  message: string;
  kind: 'ok' | 'error';
  undoable: boolean;
}

function Shell({ services }: { services: Services }) {
  const { api, auth } = services;
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const [pending, setPending] = useState(false);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const loadMe = useCallback(() => {
    void version;
    return api.me();
  }, [api, version]);
  const { data: me, error: meError } = useLoad(loadMe);

  useEffect(() => {
    if (meError instanceof ApiError && meError.status === 401) {
      void auth.signOut();
    }
  }, [meError, auth]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast((t) => (t?.id === toast.id ? null : t)), 10_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const intensity = me?.member.persona_intensity ?? 'full';

  const runAction = useCallback(
    async (
      fn: (key: string) => Promise<TaskResult>,
      event: PanelEvent,
      options: ActionOptions = {},
    ) => {
      setPending(true);
      try {
        const result = await fn(crypto.randomUUID());
        if (result.ok) {
          setToast({
            id: Date.now(),
            kind: 'ok',
            message: actionMessage(event, result.task.title, intensity),
            undoable: options.undoable === true,
          });
        }
        options.onDone?.(result);
        refresh();
      } catch (e) {
        setToast({
          id: Date.now(),
          kind: 'error',
          message: `${failureMessage(intensity)} ${errorText(e)}`,
          undoable: false,
        });
        if (e instanceof ApiError && e.status === 401) void auth.signOut();
      } finally {
        setPending(false);
      }
    },
    [intensity, refresh, auth],
  );

  const ctx = useMemo<AppContextValue | null>(() => {
    if (!me) return null;
    const text = panelText(me.member.persona_intensity);
    const names = new Map(me.members.map((m) => [m.id, m.display_name]));
    return {
      api,
      me,
      text,
      intensity: me.member.persona_intensity,
      tz: me.household.timezone,
      version,
      refresh,
      memberName: (id) => (id ? (names.get(id) ?? 'Ex-membro') : text.shared),
      pending,
      runAction,
    };
  }, [api, me, version, refresh, runAction, pending]);

  if (!ctx) {
    const notMember = meError instanceof ApiError && meError.code === 'not_a_member';
    return (
      <main className="center">
        {meError !== undefined ? (
          <div className="card">
            <p role="alert">{errorText(meError)}</p>
            <div className="actions">
              {!notMember && (
                <button type="button" className="btn" onClick={refresh}>
                  Tentar de novo
                </button>
              )}
              <button type="button" className="btn" onClick={() => void auth.signOut()}>
                Sair
              </button>
            </div>
          </div>
        ) : (
          <div aria-busy="true">
            <Mascot size={72} />
          </div>
        )}
      </main>
    );
  }

  return (
    <AppContext.Provider value={ctx}>
      <div className="app" data-intensity={ctx.intensity}>
        <a href="#conteudo" className="skip-link">
          Pular para o conteúdo
        </a>
        <header className="topbar">
          <Link to="/" className="brand">
            {ctx.intensity !== 'off' && <Mascot size={40} />}
            <span>
              <span className="brand-name">
                {ctx.intensity === 'off' ? 'Tarefas da casa' : 'Camarada Ho Chi Miau'}
              </span>
              <span className="brand-house">{ctx.me.household.name}</span>
            </span>
          </Link>
          <Nav />
          <button type="button" className="btn btn-ghost" onClick={() => void auth.signOut()}>
            Sair
          </button>
        </header>
        <main id="conteudo" tabIndex={-1}>
          <Routes />
        </main>
        <div className="toast-region" role="status" aria-live="polite">
          {toast && (
            <div className={`toast toast-${toast.kind}`}>
              <span>{toast.message}</span>
              {toast.undoable && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={pending}
                  onClick={() => {
                    setToast(null);
                    void runAction((key) => api.undo(key), 'undone');
                  }}
                >
                  Desfazer
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                aria-label="Fechar aviso"
                onClick={() => setToast(null)}
              >
                ×
              </button>
            </div>
          )}
        </div>
      </div>
    </AppContext.Provider>
  );
}

function Nav() {
  const path = usePath();
  const { text } = useApp();
  const items = [
    { to: '/', label: text.nav.summary, active: path === '/' },
    { to: '/tarefas', label: text.nav.tasks, active: path.startsWith('/tarefas') },
    { to: '/calendario', label: text.nav.calendar, active: path.startsWith('/calendario') },
    { to: '/preferencias', label: text.nav.preferences, active: path.startsWith('/preferencias') },
  ];
  return (
    <nav aria-label="Principal">
      <ul className="nav">
        {items.map((i) => (
          <li key={i.to}>
            <Link to={i.to} aria-current={i.active ? 'page' : undefined}>
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Routes() {
  const path = usePath();
  if (path === '/') return <SummaryPage />;
  if (path === '/tarefas') return <TasksPage />;
  if (path === '/tarefas/nova') return <NewTaskPage />;
  const task = /^\/tarefas\/([0-9a-f-]{36})$/i.exec(path);
  if (task?.[1]) return <TaskDetailsPage key={task[1]} id={task[1]} />;
  if (path === '/calendario') return <CalendarPage />;
  if (path === '/preferencias') return <PreferencesPage />;
  return (
    <section>
      <h1>Página não encontrada</h1>
      <Link to="/">Voltar ao início</Link>
    </section>
  );
}
