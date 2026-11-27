import { formatDateTime } from '@camarada/shared';
import type { PersonaIntensity } from './index.ts';
import { actionMessage, isSensitive, type PanelEvent } from './panel.ts';

/** O mínimo de uma tarefa para descrever o resultado (compatível com `Task` de @camarada/db). */
export interface ResultTask {
  title: string;
  status: string;
  due_at: string | null;
  assigned_to_member_id: string | null;
}

/** Resultado de sucesso das funções do banco ({ok: true, event, task, ...}). */
export interface ActionResult {
  event: string;
  task: ResultTask;
  next_task?: ResultTask | null;
  changes?: Record<string, unknown>;
  [extra: string]: unknown;
}

export interface MessageFormat {
  tz: string;
  /** Nome do responsável; `null` = tarefa compartilhada. */
  memberName(id: string | null): string;
}

const NOOP_EVENTS = new Set([
  'task_already_completed',
  'task_already_open',
  'task_already_cancelled',
  'task_unchanged',
  'photo_already_removed',
]);

/** O backend respondeu bem, mas nada mudou (ex.: já estava concluída). */
export function isNoop(event: string): boolean {
  return NOOP_EVENTS.has(event);
}

const PRIORITY: Record<string, string> = { low: 'baixa', normal: 'normal', high: 'alta' };
const EFFORT: Record<string, string> = { '1': 'leve', '2': 'médio', '3': 'pesado' };
const STATUS: Record<string, string> = {
  pending: 'pendente',
  in_progress: 'pendente',
  completed: 'concluída',
  cancelled: 'cancelada',
};

export function factLines(task: ResultTask, fmt: MessageFormat): string[] {
  return [
    `👤 Responsável: ${fmt.memberName(task.assigned_to_member_id)}`,
    `⏰ Prazo: ${task.due_at ? formatDateTime(task.due_at, fmt.tz) : 'sem prazo'}`,
  ];
}

const CHANGE_ORDER = [
  'title',
  'due_at',
  'assigned_to_member_id',
  'priority',
  'effort',
  'category',
  'room',
  'description',
] as const;

/** Uma linha por campo alterado, com o valor novo (as chaves são as colunas do banco). */
export function changeLines(
  changes: Record<string, unknown>,
  fmt: MessageFormat,
  before?: { title: string },
): string[] {
  const lines: string[] = [];
  for (const key of CHANGE_ORDER) {
    if (!(key in changes)) continue;
    const value = changes[key];
    const set = value !== null && value !== undefined && value !== '';
    switch (key) {
      case 'title':
        lines.push(before ? `✏️ Novo nome (antes: "${before.title}").` : '✏️ Novo nome.');
        break;
      case 'due_at':
        lines.push(
          typeof value === 'string'
            ? `⏰ Novo prazo: ${formatDateTime(value, fmt.tz)}.`
            : '⏰ Agora está sem prazo.',
        );
        break;
      case 'assigned_to_member_id':
        lines.push(
          typeof value === 'string'
            ? `👤 Agora está com ${fmt.memberName(value)}.`
            : `👥 Agora é ${fmt.memberName(null).toLowerCase()}.`,
        );
        break;
      case 'priority':
        lines.push(`❗ Prioridade: ${PRIORITY[String(value)] ?? String(value)}.`);
        break;
      case 'effort':
        lines.push(
          set ? `💪 Esforço: ${EFFORT[String(value)] ?? String(value)}.` : '💪 Esforço removido.',
        );
        break;
      case 'category':
        lines.push(set ? `🏷️ Categoria: ${String(value)}.` : '🏷️ Categoria removida.');
        break;
      case 'room':
        lines.push(set ? `🏠 Cômodo: ${String(value)}.` : '🏠 Cômodo removido.');
        break;
      case 'description':
        lines.push(set ? '📝 Descrição atualizada.' : '📝 Descrição removida.');
        break;
    }
  }
  return lines;
}

function undoLines(r: ActionResult, intensity: PersonaIntensity, fmt: MessageFormat): string[] {
  const q = `"${r.task.title}"`;
  const status = STATUS[r.task.status] ?? r.task.status;
  const lines: string[] = [];
  switch (r.undone_event_type) {
    case 'created':
      lines.push(`Criação desfeita: ${q} foi cancelada.`);
      break;
    case 'completed':
      lines.push(`Conclusão desfeita: ${q} voltou a ficar ${status}.`);
      break;
    case 'reopened':
      lines.push(`Reabertura desfeita: ${q} voltou a ficar ${status}.`);
      break;
    case 'cancelled':
      lines.push(`Cancelamento desfeito: ${q} voltou a ficar ${status}.`);
      break;
    case 'updated':
      lines.push(`Alteração desfeita: ${q} voltou a ser como antes.`, ...factLines(r.task, fmt));
      break;
    default:
      lines.push(`Ação desfeita em ${q}.`);
  }
  if (r.cancelled_next_task_id)
    lines.push('🔁 A próxima repetição criada por essa ação foi removida.');
  if (r.recurrence_active === true) lines.push('🔁 As repetições voltaram a valer.');
  if (r.recurrence_active === false) lines.push('🔁 As repetições foram encerradas.');
  if (intensity !== 'off' && !isSensitive(r.task.title)) {
    lines[0] = `Autocrítica aceita. ${lines[0] ?? ''}`;
  }
  return lines;
}

/**
 * Confirmação de uma ação: diz qual tarefa foi afetada e o que mudou.
 * Uma linha por fato; o painel e o bot usam o mesmo texto.
 */
export function resultMessage(
  event: PanelEvent,
  r: ActionResult,
  intensity: PersonaIntensity,
  fmt: MessageFormat,
  before?: { title: string },
): string {
  const q = `"${r.task.title}"`;
  switch (r.event) {
    case 'task_already_completed':
      return `${q} já estava concluída. Nada mudou.`;
    case 'task_already_open':
      return `${q} já estava pendente. Nada mudou.`;
    case 'task_already_cancelled':
      return `${q} já estava cancelada. Nada mudou.`;
    case 'task_unchanged':
      return `Nada mudou em ${q}: os dados já estavam assim.`;
    case 'photo_already_removed':
      return `A foto já tinha sido removida de ${q}.`;
    case 'action_undone':
      return undoLines(r, intensity, fmt).join('\n');
  }
  const lines = [actionMessage(event, r.task.title, intensity)];
  if (event === 'created') lines.push(...factLines(r.task, fmt));
  if (event === 'updated' && r.changes) lines.push(...changeLines(r.changes, fmt, before));
  if (event === 'completed' || event === 'cancelled') {
    if (r.recurrence_stopped === true) lines.push('🔁 As próximas repetições foram encerradas.');
    else if (r.next_task?.due_at) {
      lines.push(`🔁 Próxima: ${formatDateTime(r.next_task.due_at, fmt.tz)}.`);
    }
  }
  return lines.join('\n');
}
