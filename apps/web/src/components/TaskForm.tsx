import { useState, type FormEvent } from 'react';
import type { CreateTaskInput, Task, TaskChanges } from '../lib/api.ts';
import { useApp } from '../lib/app-context.ts';
import { utcToZonedInput, zonedToUtcIso } from '@camarada/shared';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

type Repeat = 'none' | 'daily' | 'weekly' | 'monthly';

interface FormState {
  title: string;
  description: string;
  assignee: string;
  dueDate: string;
  dueTime: string;
  priority: Task['priority'];
  effort: string;
  category: string;
  room: string;
  repeat: Repeat;
  weekdays: number[];
  dayOfMonth: string;
  repeatTime: string;
}

function initialState(task: Task | undefined, tz: string): FormState {
  const due = task?.due_at ? utcToZonedInput(task.due_at, tz) : null;
  return {
    title: task?.title ?? '',
    description: task?.description ?? '',
    assignee: task?.assigned_to_member_id ?? '',
    dueDate: due?.date ?? '',
    dueTime: due?.time ?? '',
    priority: task?.priority ?? 'normal',
    effort: task?.effort ? String(task.effort) : '',
    category: task?.category ?? '',
    room: task?.room ?? '',
    repeat: 'none',
    weekdays: [],
    dayOfMonth: '',
    repeatTime: '09:00',
  };
}

export type TaskFormSubmit =
  { kind: 'create'; input: CreateTaskInput } | { kind: 'update'; changes: TaskChanges };

/** Formulário de criar/editar. Na edição, só envia os campos alterados. */
export function TaskForm({
  task,
  onSubmit,
  onCancel,
}: {
  task?: Task;
  onSubmit: (data: TaskFormSubmit) => Promise<void>;
  onCancel: () => void;
}) {
  const { me, tz, text } = useApp();
  const [form, setForm] = useState(() => initialState(task, tz));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = task !== undefined;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  function dueIso(): string | null | 'invalid' {
    if (!form.dueDate) {
      return form.dueTime ? 'invalid' : null;
    }
    return zonedToUtcIso(form.dueDate, form.dueTime || '23:59', tz);
  }

  function build(): TaskFormSubmit | string {
    const title = form.title.trim();
    if (!title) {
      return 'Informe o título.';
    }
    const due = dueIso();
    if (due === 'invalid') {
      return 'Informe a data do prazo ou apague a hora.';
    }
    const effort = form.effort ? Number(form.effort) : null;

    if (!editing) {
      const input: CreateTaskInput = { title, priority: form.priority };
      if (form.description.trim()) input.description = form.description.trim();
      input.assignedToMemberId = form.assignee || null;
      if (effort) input.effort = effort;
      if (form.category.trim()) input.category = form.category.trim();
      if (form.room.trim()) input.room = form.room.trim();
      if (form.repeat !== 'none') {
        if (due) {
          return 'Tarefa recorrente usa o horário da repetição, não um prazo. Apague o prazo.';
        }
        if (form.repeat === 'weekly' && form.weekdays.length === 0) {
          return 'Escolha ao menos um dia da semana.';
        }
        const day = Number(form.dayOfMonth);
        if (form.repeat === 'monthly' && !(day >= 1 && day <= 31)) {
          return 'Informe o dia do mês (1 a 31).';
        }
        input.recurrence = {
          frequency: form.repeat,
          localTime: form.repeatTime,
          ...(form.repeat === 'weekly' && { byWeekday: [...form.weekdays].sort() }),
          ...(form.repeat === 'monthly' && { dayOfMonth: day }),
        };
      } else if (due) {
        input.dueAt = due;
      }
      return { kind: 'create', input };
    }

    const changes: TaskChanges = {};
    const orNull = (s: string) => (s.trim() ? s.trim() : null);
    if (title !== task.title) changes.title = title;
    if (orNull(form.description) !== (task.description ?? null))
      changes.description = orNull(form.description);
    if ((form.assignee || null) !== task.assigned_to_member_id)
      changes.assignedToMemberId = form.assignee || null;
    const oldDue = task.due_at ? new Date(task.due_at).getTime() : null;
    const newDue = due ? new Date(due).getTime() : null;
    if (oldDue !== newDue) changes.dueAt = due;
    if (form.priority !== task.priority) changes.priority = form.priority;
    if (effort !== task.effort) changes.effort = effort;
    if (orNull(form.category) !== (task.category ?? null)) changes.category = orNull(form.category);
    if (orNull(form.room) !== (task.room ?? null)) changes.room = orNull(form.room);
    return { kind: 'update', changes };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const result = build();
    if (typeof result === 'string') {
      setError(result);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSubmit(result);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card task-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="tf-title">Título</label>
        <input
          id="tf-title"
          value={form.title}
          maxLength={200}
          required
          onChange={(e) => set('title', e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="tf-desc">Descrição (opcional)</label>
        <textarea
          id="tf-desc"
          value={form.description}
          maxLength={2000}
          rows={3}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="tf-assignee">Responsável</label>
          <select
            id="tf-assignee"
            value={form.assignee}
            onChange={(e) => set('assignee', e.target.value)}
          >
            <option value="">{text.shared} (todos)</option>
            {me.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="tf-priority">Prioridade</label>
          <select
            id="tf-priority"
            value={form.priority}
            onChange={(e) => set('priority', e.target.value as Task['priority'])}
          >
            <option value="low">Baixa</option>
            <option value="normal">Normal</option>
            <option value="high">Alta</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="tf-effort">Esforço</label>
          <select
            id="tf-effort"
            value={form.effort}
            onChange={(e) => set('effort', e.target.value)}
          >
            <option value="">Não informado</option>
            <option value="1">1 (leve)</option>
            <option value="2">2 (médio)</option>
            <option value="3">3 (pesado)</option>
          </select>
        </div>
      </div>

      {form.repeat === 'none' && (
        <fieldset className="field-row">
          <legend>Prazo (opcional)</legend>
          <div className="field">
            <label htmlFor="tf-date">Data</label>
            <input
              id="tf-date"
              type="date"
              value={form.dueDate}
              onChange={(e) => set('dueDate', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="tf-time">Hora</label>
            <input
              id="tf-time"
              type="time"
              value={form.dueTime}
              onChange={(e) => set('dueTime', e.target.value)}
            />
          </div>
          {(form.dueDate || form.dueTime) && (
            <button
              type="button"
              className="btn btn-link"
              onClick={() => setForm((f) => ({ ...f, dueDate: '', dueTime: '' }))}
            >
              Remover prazo
            </button>
          )}
        </fieldset>
      )}

      {!editing && (
        <fieldset>
          <legend>Repetição</legend>
          <div className="field-row">
            <div className="field">
              <label htmlFor="tf-repeat">Repetir</label>
              <select
                id="tf-repeat"
                value={form.repeat}
                onChange={(e) => set('repeat', e.target.value as Repeat)}
              >
                <option value="none">Não repetir</option>
                <option value="daily">Todo dia</option>
                <option value="weekly">Toda semana</option>
                <option value="monthly">Todo mês</option>
              </select>
            </div>
            {form.repeat !== 'none' && (
              <div className="field">
                <label htmlFor="tf-repeat-time">Horário</label>
                <input
                  id="tf-repeat-time"
                  type="time"
                  value={form.repeatTime}
                  required
                  onChange={(e) => set('repeatTime', e.target.value)}
                />
              </div>
            )}
            {form.repeat === 'monthly' && (
              <div className="field">
                <label htmlFor="tf-dom">Dia do mês</label>
                <input
                  id="tf-dom"
                  type="number"
                  min={1}
                  max={31}
                  value={form.dayOfMonth}
                  onChange={(e) => set('dayOfMonth', e.target.value)}
                />
              </div>
            )}
          </div>
          {form.repeat === 'weekly' && (
            <div className="weekday-picker" role="group" aria-label="Dias da semana">
              {WEEKDAYS.map((label, i) => (
                <label key={label} className="chip-check">
                  <input
                    type="checkbox"
                    checked={form.weekdays.includes(i)}
                    onChange={(e) =>
                      set(
                        'weekdays',
                        e.target.checked
                          ? [...form.weekdays, i]
                          : form.weekdays.filter((d) => d !== i),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}

      <div className="field-row">
        <div className="field">
          <label htmlFor="tf-category">Categoria (opcional)</label>
          <input
            id="tf-category"
            value={form.category}
            maxLength={40}
            onChange={(e) => set('category', e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="tf-room">Cômodo (opcional)</label>
          <input
            id="tf-room"
            value={form.room}
            maxLength={40}
            onChange={(e) => set('room', e.target.value)}
          />
        </div>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {editing ? 'Salvar' : 'Criar'}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Voltar
        </button>
      </div>
    </form>
  );
}
