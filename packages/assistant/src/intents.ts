import { z } from 'zod';

const ref = z.object({
  index: z.number().int().min(1).max(50).optional(),
  query: z.string().trim().min(1).max(200).optional(),
});
export type TaskRef = z.infer<typeof ref>;

/** "me" | "shared" | id do membro. */
const assignee = z.union([z.literal('me'), z.literal('shared'), z.uuid()]);

export const LIST_VIEWS = [
  'open',
  'overdue',
  'due_week',
  'completed_week',
  'mine',
  'shared',
  'member',
  'completed_by',
  'with_photos',
] as const;

export const intentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_task'),
    title: z.string().trim().min(1).max(200),
    date: z.iso.date().optional(),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    assignee: assignee.optional(),
    priority: z.enum(['low', 'normal', 'high']).optional(),
  }),
  z.object({
    type: z.literal('list_tasks'),
    view: z.enum(LIST_VIEWS),
    memberId: z.uuid().optional(),
  }),
  z.object({ type: z.literal('complete_task'), ref }),
  z.object({ type: z.literal('reopen_task'), ref }),
  z.object({ type: z.literal('cancel_task'), ref }),
  z.object({ type: z.literal('task_details'), ref }),
  z.object({
    type: z.literal('update_task'),
    ref,
    title: z.string().trim().min(1).max(200).optional(),
    date: z.iso.date().optional(),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    clearDue: z.boolean().optional(),
    assignee: assignee.optional(),
    priority: z.enum(['low', 'normal', 'high']).optional(),
  }),
  z.object({ type: z.literal('weekly_summary') }),
  z.object({ type: z.literal('undo') }),
  z.object({
    type: z.literal('help'),
    topic: z.enum(['criar', 'consultar', 'concluir', 'fotos', 'lembretes', 'treino']).optional(),
  }),
  z.object({
    type: z.literal('training'),
    action: z.enum(['start', 'restart', 'pause', 'resume', 'skip', 'next']),
  }),
  z.object({ type: z.literal('set_persona'), intensity: z.enum(['off', 'light', 'full']) }),
  z.object({ type: z.literal('set_guidance'), mode: z.enum(['guided', 'normal']) }),
  z.object({ type: z.literal('choose'), index: z.number().int().min(1).max(50) }),
  z.object({ type: z.literal('confirm'), yes: z.boolean() }),
  z.object({ type: z.literal('out_of_scope') }),
]);

export type Intent = z.infer<typeof intentSchema>;
export type IntentOf<T extends Intent['type']> = Extract<Intent, { type: T }>;
