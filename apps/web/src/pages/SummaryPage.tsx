import { useCallback } from 'react';
import { TaskList } from '../components/TaskList.tsx';
import { errorText } from '../lib/api.ts';
import { useApp, useLoad } from '../lib/app-context.ts';
import { Link } from '../lib/router.tsx';
import { addDays, dayStartUtc, startOfWeek, todayKey } from '@camarada/shared';

export function SummaryPage() {
  const { api, me, text, tz, version } = useApp();

  const load = useCallback(async () => {
    void version;
    const today = todayKey(tz);
    const now = new Date().toISOString();
    const [open, overdue, dueWeek, completedWeek, mine] = await Promise.all([
      api.listTasks({ view: 'open', limit: 200 }),
      api.listTasks({ view: 'overdue', limit: 200 }),
      api.listTasks({ view: 'due', from: now, to: dayStartUtc(addDays(today, 8), tz), limit: 200 }),
      api.listTasks({ view: 'completed', from: dayStartUtc(startOfWeek(today), tz), limit: 200 }),
      api.listTasks({ view: 'open', assignee: me.member.id, limit: 10 }),
    ]);
    return { open, overdue, dueWeek, completedWeek, mine };
  }, [api, me.member.id, tz, version]);

  const { data, error } = useLoad(load);
  const greeting = text.greeting(me.member.display_name);

  return (
    <section aria-labelledby="summary-title">
      <h1 id="summary-title">{text.summaryTitle}</h1>
      {greeting && <p className="greeting">{greeting}</p>}
      {error !== undefined && <p role="alert">{errorText(error)}</p>}
      {!data && error === undefined && <p aria-busy="true">Carregando…</p>}
      {data && (
        <>
          <ul className="counters">
            <Counter label={text.counters.open} value={data.open.tasks.length} to="/tarefas" />
            <Counter
              label={text.counters.overdue}
              value={data.overdue.tasks.length}
              to="/tarefas?view=overdue"
              alert={data.overdue.tasks.length > 0}
            />
            <Counter
              label={text.counters.dueWeek}
              value={data.dueWeek.tasks.length}
              to="/calendario"
            />
            <Counter
              label={text.counters.completedWeek}
              value={data.completedWeek.tasks.length}
              to="/tarefas?view=completed"
            />
          </ul>

          {data.overdue.tasks.length > 0 && (
            <>
              <h2>{text.counters.overdue}</h2>
              <TaskList tasks={data.overdue.tasks.slice(0, 5)} />
            </>
          )}

          <h2>Comigo</h2>
          <TaskList tasks={data.mine.tasks} />
          <p>
            <Link to="/tarefas/nova" className="btn btn-primary">
              {text.newTask}
            </Link>
          </p>
        </>
      )}
    </section>
  );
}

function Counter({
  label,
  value,
  to,
  alert,
}: {
  label: string;
  value: number;
  to: string;
  alert?: boolean;
}) {
  return (
    <li className={`counter${alert ? ' counter-alert' : ''}`}>
      <Link to={to}>
        <span className="counter-value">{value}</span>
        <span className="counter-label">{label}</span>
      </Link>
    </li>
  );
}
