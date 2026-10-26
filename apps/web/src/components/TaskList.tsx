import type { Task } from '../lib/api.ts';
import { useApp } from '../lib/app-context.ts';
import { Link } from '../lib/router.tsx';
import { formatDateTime } from '../lib/time.ts';

const PRIORITY_LABEL: Record<Task['priority'], string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
};
export const STATUS_LABEL: Record<Task['status'], string> = {
  pending: 'Pendente',
  in_progress: 'Em andamento',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

export function priorityLabel(p: Task['priority']) {
  return PRIORITY_LABEL[p];
}

export function TaskBadges({ task }: { task: Task }) {
  return (
    <>
      {task.is_overdue && <span className="badge badge-overdue">Atrasada</span>}
      {task.priority === 'high' && <span className="badge badge-high">Prioridade alta</span>}
      {task.recurrence_rule_id && <span className="badge">Recorrente</span>}
      {(task.status === 'completed' || task.status === 'cancelled') && (
        <span className={`badge badge-${task.status}`}>{STATUS_LABEL[task.status]}</span>
      )}
    </>
  );
}

export function TaskList({ tasks }: { tasks: Task[] }) {
  const { text } = useApp();
  if (tasks.length === 0) {
    return <p className="empty">{text.emptyList}</p>;
  }
  return (
    <ul className="task-list">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} />
      ))}
    </ul>
  );
}

function TaskRow({ task }: { task: Task }) {
  const { api, tz, memberName, runAction, pending } = useApp();
  const open = task.status === 'pending' || task.status === 'in_progress';
  return (
    <li className={`task-row${task.is_overdue ? ' is-overdue' : ''}${open ? '' : ' is-closed'}`}>
      <div className="task-main">
        <Link to={`/tarefas/${task.id}`} className="task-title">
          {task.title}
        </Link>
        <div className="task-meta">
          <span>{memberName(task.assigned_to_member_id)}</span>
          {task.due_at && <span>Prazo: {formatDateTime(task.due_at, tz)}</span>}
          <TaskBadges task={task} />
        </div>
      </div>
      {open ? (
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          aria-label={`Concluir "${task.title}"`}
          onClick={() =>
            runAction((key) => api.taskAction(task.id, 'complete', key), 'completed', {
              undoable: true,
            })
          }
        >
          Concluir
        </button>
      ) : task.status === 'completed' ? (
        <button
          type="button"
          className="btn"
          disabled={pending}
          aria-label={`Reabrir "${task.title}"`}
          onClick={() =>
            runAction((key) => api.taskAction(task.id, 'reopen', key), 'reopened', {
              undoable: true,
            })
          }
        >
          Reabrir
        </button>
      ) : null}
    </li>
  );
}
