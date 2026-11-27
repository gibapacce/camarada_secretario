import { useCallback, useState } from 'react';
import { PhotoSection } from '../components/PhotoSection.tsx';
import { TaskBadges, priorityLabel, STATUS_LABEL } from '../components/TaskList.tsx';
import { TaskForm } from '../components/TaskForm.tsx';
import { errorText, type TaskEvent } from '../lib/api.ts';
import { useApp, useLoad } from '../lib/app-context.ts';
import { Link } from '../lib/router.tsx';
import { formatDateTime } from '@camarada/shared';

const EVENT_LABEL: Record<TaskEvent['event_type'], string> = {
  created: 'criou',
  updated: 'editou',
  completed: 'concluiu',
  reopened: 'reabriu',
  cancelled: 'cancelou',
  undone: 'desfez a última ação',
};

const FIELD_LABEL: Record<string, string> = {
  title: 'título',
  description: 'descrição',
  assigned_to_member_id: 'responsável',
  due_at: 'prazo',
  priority: 'prioridade',
  effort: 'esforço',
  category: 'categoria',
  room: 'cômodo',
  status: 'situação',
};

export function TaskDetailsPage({ id }: { id: string }) {
  const { api, tz, text, memberName, runAction, version, pending } = useApp();
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    void version;
    return api.getTask(id);
  }, [api, id, version]);
  const { data, error } = useLoad(load);

  if (error !== undefined) {
    return (
      <section>
        <p role="alert">{errorText(error)}</p>
        <Link to="/tarefas">Voltar para a lista</Link>
      </section>
    );
  }
  if (!data?.task) {
    return <p aria-busy="true">Carregando…</p>;
  }

  const task = data.task;
  const open = task.status === 'pending' || task.status === 'in_progress';
  const act = (
    action: 'complete' | 'reopen' | 'cancel',
    event: 'completed' | 'reopened' | 'cancelled',
    stop?: boolean,
  ) =>
    runAction((key) => api.taskAction(task.id, action, key, stop), event, {
      undoable: true,
      title: task.title,
    });

  if (editing) {
    return (
      <section aria-labelledby="edit-title">
        <h1 id="edit-title">Editar: {task.title}</h1>
        <TaskForm
          task={task}
          onCancel={() => setEditing(false)}
          onSubmit={async (d) => {
            if (d.kind !== 'update') return;
            if (Object.keys(d.changes).length === 0) {
              setEditing(false);
              return;
            }
            await runAction((key) => api.updateTask(task.id, d.changes, key), 'updated', {
              undoable: true,
              title: task.title,
              onDone: (r) => r.ok && setEditing(false),
            });
          }}
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="task-title" className="task-details">
      <p>
        <Link to="/tarefas">← {text.tasksTitle}</Link>
      </p>
      <h1 id="task-title">{task.title}</h1>
      <p className="task-meta">
        <TaskBadges task={task} />
      </p>
      {task.description && <p className="description">{task.description}</p>}
      <dl className="details-grid">
        <dt>Situação</dt>
        <dd>{STATUS_LABEL[task.status]}</dd>
        <dt>Responsável</dt>
        <dd>{memberName(task.assigned_to_member_id)}</dd>
        <dt>Prazo</dt>
        <dd>{task.due_at ? formatDateTime(task.due_at, tz) : 'Sem prazo'}</dd>
        <dt>Prioridade</dt>
        <dd>{priorityLabel(task.priority)}</dd>
        {task.effort && (
          <>
            <dt>Esforço</dt>
            <dd>{task.effort}</dd>
          </>
        )}
        {task.category && (
          <>
            <dt>Categoria</dt>
            <dd>{task.category}</dd>
          </>
        )}
        {task.room && (
          <>
            <dt>Cômodo</dt>
            <dd>{task.room}</dd>
          </>
        )}
        <dt>Criada por</dt>
        <dd>
          {task.created_by_member_id ? memberName(task.created_by_member_id) : 'Sistema'} em{' '}
          {formatDateTime(task.created_at, tz)}
        </dd>
        {task.completed_at && (
          <>
            <dt>Concluída por</dt>
            <dd>
              {memberName(task.completed_by_member_id)} em {formatDateTime(task.completed_at, tz)}
            </dd>
          </>
        )}
      </dl>

      <div className="actions">
        {open && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() => act('complete', 'completed')}
          >
            Concluir
          </button>
        )}
        {task.status === 'completed' && (
          <button
            type="button"
            className="btn"
            disabled={pending}
            onClick={() => act('reopen', 'reopened')}
          >
            Reabrir
          </button>
        )}
        {open && (
          <button type="button" className="btn" disabled={pending} onClick={() => setEditing(true)}>
            Editar
          </button>
        )}
        {open && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Cancelar "${task.title}"?`)) return;
              const stop =
                task.recurrence_rule_id !== null &&
                window.confirm('Encerrar também as próximas repetições?');
              void act('cancel', 'cancelled', stop);
            }}
          >
            Cancelar tarefa
          </button>
        )}
      </div>

      <h2>{text.photosTitle}</h2>
      <PhotoSection taskId={task.id} photos={data.photos ?? []} />

      <h2>{text.historyTitle}</h2>
      <ol className="history">
        {(data.events ?? [])
          .slice()
          .reverse()
          .map((e) => (
            <li key={e.id}>
              <time dateTime={e.created_at}>{formatDateTime(e.created_at, tz)}</time>{' '}
              <strong>{e.actor_member_id ? memberName(e.actor_member_id) : 'Sistema'}</strong>{' '}
              {EVENT_LABEL[e.event_type]}
              {e.event_type === 'updated' && e.new_values && (
                <span className="muted">
                  {' '}
                  (
                  {Object.keys(e.new_values)
                    .map((k) => FIELD_LABEL[k] ?? k)
                    .join(', ')}
                  )
                </span>
              )}
            </li>
          ))}
      </ol>
    </section>
  );
}
