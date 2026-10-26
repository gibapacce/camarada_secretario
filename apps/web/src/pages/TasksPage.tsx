import { useCallback } from 'react';
import { TaskList } from '../components/TaskList.tsx';
import { errorText, type ListParams } from '../lib/api.ts';
import { useApp, useLoad } from '../lib/app-context.ts';
import { Link, navigate, useSearch } from '../lib/router.tsx';

const VIEWS: { value: ListParams['view']; label: string }[] = [
  { value: 'open', label: 'Pendentes' },
  { value: 'overdue', label: 'Atrasadas' },
  { value: 'completed', label: 'Concluídas' },
  { value: 'all', label: 'Todas' },
];

export function TasksPage() {
  const { api, me, text, version } = useApp();
  const search = useSearch();
  const viewParam = search.get('view');
  const view = VIEWS.some((v) => v.value === viewParam)
    ? (viewParam as ListParams['view'])
    : 'open';
  const who = search.get('who') ?? '';

  const load = useCallback(() => {
    void version;
    return api.listTasks({
      view,
      limit: 200,
      ...(who === 'shared' ? { shared: true } : who ? { assignee: who } : {}),
    });
  }, [api, view, who, version]);
  const { data, error, loading } = useLoad(load);

  const update = (key: string, value: string) => {
    const q = new URLSearchParams(search);
    if (value) q.set(key, value);
    else q.delete(key);
    const qs = q.toString();
    navigate(`/tarefas${qs ? `?${qs}` : ''}`, true);
  };

  return (
    <section aria-labelledby="tasks-title">
      <div className="page-head">
        <h1 id="tasks-title">{text.tasksTitle}</h1>
        <Link to="/tarefas/nova" className="btn btn-primary">
          {text.newTask}
        </Link>
      </div>
      <div className="filters">
        <div className="field">
          <label htmlFor="f-view">Situação</label>
          <select
            id="f-view"
            value={view}
            onChange={(e) => update('view', e.target.value === 'open' ? '' : e.target.value)}
          >
            {VIEWS.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-who">Responsável</label>
          <select id="f-who" value={who} onChange={(e) => update('who', e.target.value)}>
            <option value="">Todos</option>
            {me.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
            <option value="shared">{text.shared}</option>
          </select>
        </div>
      </div>
      {error !== undefined && <p role="alert">{errorText(error)}</p>}
      {data ? (
        <div aria-busy={loading}>
          <TaskList tasks={data.tasks} />
        </div>
      ) : (
        error === undefined && <p aria-busy="true">Carregando…</p>
      )}
    </section>
  );
}
