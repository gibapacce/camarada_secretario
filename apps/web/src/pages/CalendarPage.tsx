import { useCallback } from 'react';
import type { Task } from '../lib/api.ts';
import { errorText } from '../lib/api.ts';
import { useApp, useLoad } from '../lib/app-context.ts';
import { Link, navigate, useSearch } from '../lib/router.tsx';
import {
  addDays,
  addMonths,
  dayKey,
  dayStartUtc,
  formatDayLabel,
  startOfMonth,
  startOfWeek,
  todayKey,
} from '../lib/time.ts';

const WEEKDAY_HEADERS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

interface DayItem {
  task: Task;
  done: boolean;
}

export function CalendarPage() {
  const { api, tz, text, version } = useApp();
  const search = useSearch();
  const month = search.get('modo') === 'mes';
  const today = todayKey(tz);
  const dateParam = search.get('data');
  const anchor = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;

  const start = month ? startOfWeek(startOfMonth(anchor)) : startOfWeek(anchor);
  const monthEnd = addDays(addMonths(startOfMonth(anchor), 1), -1);
  const end = month ? addDays(startOfWeek(monthEnd), 7) : addDays(start, 7);

  const load = useCallback(async () => {
    void version;
    const from = dayStartUtc(start, tz);
    const to = dayStartUtc(end, tz);
    const [due, done] = await Promise.all([
      api.listTasks({ view: 'due', from, to, limit: 200 }),
      api.listTasks({ view: 'completed', from, to, limit: 200 }),
    ]);
    const byDay = new Map<string, DayItem[]>();
    const add = (key: string, item: DayItem) => byDay.set(key, [...(byDay.get(key) ?? []), item]);
    for (const t of due.tasks) if (t.due_at) add(dayKey(t.due_at, tz), { task: t, done: false });
    for (const t of done.tasks)
      if (t.completed_at) add(dayKey(t.completed_at, tz), { task: t, done: true });
    return byDay;
  }, [api, start, end, tz, version]);
  const { data, error } = useLoad(load);

  const days: string[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) days.push(d);

  const go = (params: { modo?: boolean; data?: string }) => {
    const q = new URLSearchParams();
    if (params.modo ?? month) q.set('modo', 'mes');
    if (params.data && params.data !== today) q.set('data', params.data);
    const qs = q.toString();
    navigate(`/calendario${qs ? `?${qs}` : ''}`, true);
  };
  const step = (dir: 1 | -1) =>
    go({ data: month ? addMonths(startOfMonth(anchor), dir) : addDays(anchor, 7 * dir) });

  const rawTitle = month
    ? formatDayLabel(anchor, { month: 'long', year: 'numeric' })
    : `${formatDayLabel(start, { day: '2-digit', month: 'short' })} – ${formatDayLabel(addDays(end, -1), { day: '2-digit', month: 'short' })}`;
  const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);

  return (
    <section aria-labelledby="cal-title">
      <h1 id="cal-title">{text.calendarTitle}</h1>
      <div className="cal-toolbar">
        <div className="segmented" role="group" aria-label="Visualização">
          <button
            type="button"
            className="btn"
            aria-pressed={!month}
            onClick={() => go({ modo: false, data: anchor })}
          >
            Semana
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={month}
            onClick={() => go({ modo: true, data: anchor })}
          >
            Mês
          </button>
        </div>
        <div className="cal-nav">
          <button type="button" className="btn" onClick={() => step(-1)} aria-label="Anterior">
            ‹
          </button>
          <button type="button" className="btn" onClick={() => go({})}>
            Hoje
          </button>
          <button type="button" className="btn" onClick={() => step(1)} aria-label="Próximo">
            ›
          </button>
        </div>
        <h2 className="cal-title">{title}</h2>
      </div>
      {error !== undefined && <p role="alert">{errorText(error)}</p>}
      <div className={`calendar ${month ? 'calendar-month' : 'calendar-week'}`} aria-busy={!data}>
        {month &&
          WEEKDAY_HEADERS.map((d) => (
            <div key={d} className="cal-head" aria-hidden="true">
              {d}
            </div>
          ))}
        {days.map((key) => {
          const items = data?.get(key) ?? [];
          const outside = month && key.slice(0, 7) !== anchor.slice(0, 7);
          return (
            <div
              key={key}
              className={`cal-day${key === today ? ' is-today' : ''}${outside ? ' is-outside' : ''}`}
            >
              <div className="cal-date">
                {month ? (
                  <>
                    <span className="sr-only">{formatDayLabel(key, { weekday: 'long' })}, </span>
                    {formatDayLabel(key, { day: 'numeric' })}
                  </>
                ) : (
                  formatDayLabel(key, { weekday: 'short', day: '2-digit', month: '2-digit' })
                )}
              </div>
              <ul>
                {items.map(({ task, done }) => (
                  <li
                    key={`${task.id}-${done ? 'd' : 'p'}`}
                    className={`cal-item${done ? ' is-done' : ''}${task.is_overdue ? ' is-overdue' : ''}`}
                  >
                    <Link to={`/tarefas/${task.id}`}>
                      {done ? '✓ ' : ''}
                      {task.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
