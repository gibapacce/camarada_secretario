import type { ReminderJob, ReminderOutcome, ReminderService } from '@camarada/db';
import { reminderMessage } from '@camarada/persona';
import { TelegramSendError, type TelegramPort } from './telegram.ts';

export interface ReminderDeps {
  reminders: ReminderService;
  telegram: TelegramPort;
  /** Com o endereço do painel, o lembrete leva um botão para abrir a tarefa. */
  panelUrl?: string;
}

export interface ReminderRunResult {
  sent: number;
  retry: number;
  failed: number;
}

// Lote pequeno por execução: o Cron roda a cada 5 minutos e o resto fica para a próxima.
const BATCH = 20;

/** 400/403: chat inexistente ou bot bloqueado; tentar de novo não adianta. */
function outcomeOf(error: unknown): ReminderOutcome {
  if (error instanceof TelegramSendError && (error.status === 400 || error.status === 403)) {
    return 'failed';
  }
  return 'retry';
}

function textOf(job: ReminderJob): string {
  return reminderMessage({
    type: job.type,
    key: job.key,
    intensity: job.intensity,
    title: job.task.title,
    dueAt: job.task.due_at,
    sentAt: job.attempted_at,
    timezone: job.timezone,
    shared: job.task.shared,
  });
}

export async function runReminders(deps: ReminderDeps, now?: Date): Promise<ReminderRunResult> {
  const result: ReminderRunResult = { sent: 0, retry: 0, failed: 0 };
  const jobs = await deps.reminders.claim({ limit: BATCH, ...(now && { now }) });
  for (const job of jobs) {
    let outcome: ReminderOutcome = 'sent';
    let error: string | undefined;
    try {
      const button = deps.panelUrl
        ? { text: 'Abrir tarefa', url: `${deps.panelUrl}/tarefas/${job.task.id}` }
        : undefined;
      await deps.telegram.sendMessage(job.chat_id, textOf(job), button);
    } catch (e) {
      outcome = outcomeOf(e);
      error = e instanceof TelegramSendError ? `telegram_${e.status}` : 'send_error';
    }
    result[outcome] += 1;
    try {
      await deps.reminders.finish(job.id, outcome, error, now);
    } catch {
      // Sem registrar o resultado, a reserva vence em 10 minutos e o lembrete volta (pode repetir).
      console.error('reminder_finish_failed');
    }
  }
  return result;
}

export async function runDailyCleanup(
  reminders: ReminderService,
): Promise<{ reminders: number; tutorialTasks: number }> {
  return reminders.cleanup();
}
