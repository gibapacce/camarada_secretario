import { z } from 'zod';
import { DomainError, type DbClient } from './client.ts';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high';

export interface Task {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  effort: number | null;
  is_tutorial: boolean;
  category: string | null;
  room: string | null;
  assigned_to_member_id: string | null;
  created_by_member_id: string | null;
  due_at: string | null;
  recurrence_rule_id: string | null;
  completed_by_member_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  is_overdue: boolean;
}

export interface TaskEvent {
  id: string;
  task_id: string;
  actor_member_id: string | null;
  event_type: 'created' | 'updated' | 'completed' | 'reopened' | 'cancelled' | 'undone';
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  undoes_event_id: string | null;
  created_at: string;
}

/** Resultado estruturado consumido pela persona: {ok, event | error, dados}. */
export type TaskResult =
  | {
      ok: true;
      event: string;
      task: Task;
      next_task?: Task | null;
      changes?: Record<string, unknown>;
      replayed?: boolean;
      [extra: string]: unknown;
    }
  | { ok: false; error: string; task?: Task; replayed?: boolean };

export interface TaskListResult {
  ok: true;
  view: TaskView;
  tasks: Task[];
}

export interface TaskDetailsResult {
  ok: boolean;
  error?: string;
  task?: Task;
  events?: TaskEvent[];
}

const id = z.uuid();
const optionalText = (max: number) => z.string().trim().max(max).optional();
const nullableText = (max: number) => z.string().trim().max(max).nullable();
const isoDateTime = z.iso.datetime({ offset: true });
const idempotencyKey = z
  .string()
  .regex(/^(telegram|web|system):\S{1,200}$/)
  .optional();

const actorScope = { householdId: id, actorMemberId: id, idempotencyKey };

export const recurrenceSchema = z
  .object({
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    interval: z.number().int().min(1).max(12).optional(),
    byWeekday: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    startsOn: z.iso.date().optional(),
  })
  .refine((r) => r.frequency !== 'weekly' || r.byWeekday, 'weekly exige byWeekday')
  .refine((r) => r.frequency !== 'monthly' || r.dayOfMonth, 'monthly exige dayOfMonth');

export const createTaskSchema = z
  .object({
    ...actorScope,
    title: z.string().trim().min(1).max(200),
    description: optionalText(2000),
    assignedToMemberId: id.nullable().optional(),
    dueAt: isoDateTime.optional(),
    priority: z.enum(['low', 'normal', 'high']).optional(),
    effort: z.number().int().min(1).max(3).optional(),
    category: optionalText(40),
    room: optionalText(40),
    isTutorial: z.boolean().optional(),
    recurrence: recurrenceSchema.optional(),
  })
  .refine((t) => !(t.dueAt && t.recurrence), 'use dueAt ou recurrence, não ambos');

const taskActionSchema = z.object({ ...actorScope, taskId: id });

export const updateTaskSchema = z.object({
  ...actorScope,
  taskId: id,
  changes: z
    .object({
      title: z.string().trim().min(1).max(200),
      description: nullableText(2000),
      assignedToMemberId: id.nullable(),
      dueAt: isoDateTime.nullable(),
      priority: z.enum(['low', 'normal', 'high']),
      effort: z.number().int().min(1).max(3).nullable(),
      category: nullableText(40),
      room: nullableText(40),
    })
    .partial()
    .strict(),
});

export const TASK_VIEWS = ['open', 'overdue', 'due', 'completed', 'all'] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export const listTasksSchema = z.object({
  householdId: id,
  view: z.enum(TASK_VIEWS).default('open'),
  assignedToMemberId: id.optional(),
  onlyShared: z.boolean().optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  includeTutorial: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new DomainError('invalid_input', z.prettifyError(result.error));
  }
  return result.data;
}

const CHANGE_COLUMNS = {
  title: 'title',
  description: 'description',
  assignedToMemberId: 'assigned_to_member_id',
  dueAt: 'due_at',
  priority: 'priority',
  effort: 'effort',
  category: 'category',
  room: 'room',
} as const;

/** Serviço de tarefas: valida a entrada e delega às funções transacionais do banco. */
export function createTaskService(db: DbClient) {
  const call = async <T>(fn: Parameters<DbClient['call']>[0], args: Record<string, unknown>) =>
    (await db.call(fn, args)) as T;

  return {
    async createTask(input: z.input<typeof createTaskSchema>): Promise<TaskResult> {
      const t = parse(createTaskSchema, input);
      return call('create_task', {
        p_household_id: t.householdId,
        p_actor_member_id: t.actorMemberId,
        p_title: t.title,
        p_description: t.description,
        p_assigned_to_member_id: t.assignedToMemberId,
        p_due_at: t.dueAt,
        p_priority: t.priority,
        p_effort: t.effort,
        p_category: t.category,
        p_room: t.room,
        p_is_tutorial: t.isTutorial,
        p_recurrence: t.recurrence && {
          frequency: t.recurrence.frequency,
          interval: t.recurrence.interval,
          by_weekday: t.recurrence.byWeekday,
          day_of_month: t.recurrence.dayOfMonth,
          local_time: t.recurrence.localTime,
          starts_on: t.recurrence.startsOn,
        },
        p_idempotency_key: t.idempotencyKey,
      });
    },

    async completeTask(input: z.input<typeof taskActionSchema>): Promise<TaskResult> {
      const t = parse(taskActionSchema, input);
      return call('complete_task', taskActionArgs(t));
    },

    async reopenTask(input: z.input<typeof taskActionSchema>): Promise<TaskResult> {
      const t = parse(taskActionSchema, input);
      return call('reopen_task', taskActionArgs(t));
    },

    async cancelTask(
      input: z.input<typeof taskActionSchema> & { stopRecurrence?: boolean },
    ): Promise<TaskResult> {
      const t = parse(taskActionSchema.extend({ stopRecurrence: z.boolean().optional() }), input);
      return call('cancel_task', { ...taskActionArgs(t), p_stop_recurrence: t.stopRecurrence });
    },

    async updateTask(input: z.input<typeof updateTaskSchema>): Promise<TaskResult> {
      const t = parse(updateTaskSchema, input);
      const changes: Record<string, unknown> = {};
      for (const [key, column] of Object.entries(CHANGE_COLUMNS)) {
        if (key in t.changes) {
          changes[column] = t.changes[key as keyof typeof t.changes];
        }
      }
      return call('update_task', { ...taskActionArgs(t), p_changes: changes });
    },

    async undoLastAction(
      input: z.input<z.ZodObject<typeof actorScope>> & { windowMinutes?: number },
    ): Promise<TaskResult> {
      const t = parse(
        z.object({ ...actorScope, windowMinutes: z.number().int().min(1).max(60).optional() }),
        input,
      );
      return call('undo_last_action', {
        p_household_id: t.householdId,
        p_actor_member_id: t.actorMemberId,
        p_window_minutes: t.windowMinutes,
        p_idempotency_key: t.idempotencyKey,
      });
    },

    async listTasks(input: z.input<typeof listTasksSchema>): Promise<TaskListResult> {
      const t = parse(listTasksSchema, input);
      return call('list_tasks', {
        p_household_id: t.householdId,
        p_view: t.view,
        p_assigned_to_member_id: t.assignedToMemberId,
        p_only_shared: t.onlyShared,
        p_from: t.from,
        p_to: t.to,
        p_include_tutorial: t.includeTutorial,
        p_limit: t.limit,
      });
    },

    async getTask(input: { householdId: string; taskId: string }): Promise<TaskDetailsResult> {
      const t = parse(z.object({ householdId: id, taskId: id }), input);
      return call('get_task', { p_household_id: t.householdId, p_task_id: t.taskId });
    },
  };
}

export type TaskService = ReturnType<typeof createTaskService>;

function taskActionArgs(t: {
  householdId: string;
  actorMemberId: string;
  taskId: string;
  idempotencyKey?: string | undefined;
}) {
  return {
    p_household_id: t.householdId,
    p_actor_member_id: t.actorMemberId,
    p_task_id: t.taskId,
    p_idempotency_key: t.idempotencyKey,
  };
}
