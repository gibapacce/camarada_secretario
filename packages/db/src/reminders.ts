import { z } from 'zod';
import { DomainError, type DbClient } from './client.ts';
import type { PersonaIntensity } from './members.ts';

export type ReminderType = 'before_24h' | 'due' | 'overdue';
export type ReminderOutcome = 'sent' | 'retry' | 'failed';

/** Lembrete reservado para envio. A chave define a variante de texto (retry = mesmo texto). */
export interface ReminderJob {
  id: string;
  type: ReminderType;
  key: string;
  attempt: number;
  scheduled_for: string;
  /** Momento desta tentativa de envio; "hoje"/"amanhã" no texto são relativos a ele. */
  attempted_at: string;
  chat_id: number;
  intensity: PersonaIntensity;
  timezone: string;
  task: { id: string; title: string; due_at: string; shared: boolean };
}

const claimSchema = z.object({
  now: z.date().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export function createReminderService(db: DbClient) {
  return {
    /** Gera os lembretes devidos, cancela os que perderam a validade e reserva um lote. */
    async claim(options: z.input<typeof claimSchema> = {}): Promise<ReminderJob[]> {
      const parsed = claimSchema.safeParse(options);
      if (!parsed.success) {
        throw new DomainError('invalid_input', z.prettifyError(parsed.error));
      }
      const result = await db.call('claim_reminders', {
        p_now: parsed.data.now?.toISOString(),
        p_limit: parsed.data.limit,
      });
      return (result ?? []) as ReminderJob[];
    },

    async finish(
      id: string,
      outcome: ReminderOutcome,
      error?: string,
      now?: Date,
    ): Promise<{ ok: boolean; status?: string; error?: string }> {
      return (await db.call('finish_reminder', {
        p_id: id,
        p_outcome: outcome,
        p_error: error?.slice(0, 100),
        p_now: now?.toISOString(),
      })) as { ok: boolean; status?: string; error?: string };
    },

    /** Limpeza diária: histórico de lembretes antigo e tarefas de treino abandonadas. */
    async cleanup(): Promise<{ reminders: number; tutorialTasks: number }> {
      const reminders = (await db.call('cleanup_reminders', {})) as number;
      const tutorialTasks = (await db.call('cleanup_tutorial_tasks', {})) as number;
      return { reminders, tutorialTasks };
    },
  };
}

export type ReminderService = ReturnType<typeof createReminderService>;
