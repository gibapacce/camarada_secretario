import {
  DomainError,
  type AssistantStateStore,
  type MemberContext,
  type MemberService,
  type Task,
  type TaskResult,
  type TaskService,
} from '@camarada/db';
import {
  actionMessage,
  errorMessage,
  failureMessage,
  panelText,
  type PanelEvent,
} from '@camarada/persona';
import {
  addDays,
  dayStartUtc,
  formatDayLabel,
  formatDateTime,
  normalizeText,
  startOfWeek,
  todayKey,
  zonedToUtcIso,
} from '@camarada/shared';
import { z } from 'zod';
import { intentSchema, type Intent, type IntentOf, type TaskRef } from './intents.ts';
import type { ChatModel } from './model.ts';
import {
  helpReply,
  listReply,
  modeReply,
  outOfScopeReply,
  taskFacts,
  taskLine,
  unknownReply,
  type ReplyContext,
} from './replies.ts';
import { buildCreate, parseRules } from './rules.ts';

const MAX_LIST = 20;
const ACTIONS = ['complete', 'reopen', 'cancel', 'details', 'update'] as const;
type Action = (typeof ACTIONS)[number];

const stateSchema = z.object({
  list: z.array(z.uuid()).max(MAX_LIST).optional(),
  pending: z
    .discriminatedUnion('kind', [
      z.object({
        kind: z.literal('choose'),
        action: z.enum(ACTIONS),
        ids: z.array(z.uuid()).min(1).max(MAX_LIST),
        update: z.unknown().optional(),
      }),
      z.object({
        kind: z.literal('confirm'),
        action: z.enum(['complete', 'cancel']),
        id: z.uuid(),
      }),
      z.object({ kind: z.literal('suggest'), options: z.array(intentSchema).min(1).max(5) }),
    ])
    .optional(),
});
type State = z.infer<typeof stateSchema>;

export interface AssistantDeps {
  tasks: TaskService;
  members: MemberService;
  state: AssistantStateStore;
  model?: ChatModel | null;
}

export interface AssistantInput {
  member: MemberContext;
  text: string;
  /** Chave de idempotência da mensagem (ex.: "web:<uuid>", "telegram:<chat>:<id>"). */
  key: string;
}

export interface AssistantReply {
  reply: string;
  intent: string;
  usedAi: boolean;
  /** Algo foi gravado (o painel deve recarregar). */
  changed: boolean;
}

interface Turn {
  member: MemberContext;
  key: string;
  today: string;
  rc: ReplyContext;
  state: State;
  next: State;
  changed: boolean;
}

const MAX_TEXT = 1000;

export function createAssistant(deps: AssistantDeps) {
  const scopeOf = (t: Turn) => ({
    householdId: t.member.member.household_id,
    actorMemberId: t.member.member.id,
  });

  async function loadState(member: MemberContext): Promise<State> {
    try {
      const raw = await deps.state.get({
        householdId: member.member.household_id,
        memberId: member.member.id,
      });
      const parsed = stateSchema.safeParse(raw ?? {});
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  }

  async function handle(input: AssistantInput): Promise<AssistantReply> {
    const { member } = input;
    const tz = member.household.timezone;
    const turn: Turn = {
      member,
      key: input.key,
      today: todayKey(tz),
      rc: {
        intensity: member.member.persona_intensity,
        tz,
        names: new Map(member.members.map((m) => [m.id, m.display_name])),
      },
      state: await loadState(member),
      next: {},
      changed: false,
    };
    const text = input.text.trim().slice(0, MAX_TEXT);
    const ruleCtx = { today: turn.today, members: member.members };

    let intent = text ? parseRules(text, ruleCtx) : ({ type: 'help' } as Intent);
    let usedAi = false;
    if (!intent && deps.model) {
      usedAi = true;
      intent = await deps.model.interpret({
        text,
        today: turn.today,
        weekdayName: formatDayLabel(turn.today, { weekday: 'long' }),
        members: member.members,
        meId: member.member.id,
      });
    }

    let reply: string;
    if (!intent) {
      reply = suggest(turn, text);
    } else {
      // Manter a última lista entre mensagens; a pendência só vale para a resposta seguinte.
      turn.next = { ...(turn.state.list && { list: turn.state.list }) };
      try {
        reply = await dispatch(turn, intent);
      } catch (error) {
        reply =
          error instanceof DomainError && !['db_error', 'db_unavailable'].includes(error.code)
            ? errorMessage(error.code)
            : `${failureMessage(turn.rc.intensity)}${error instanceof DomainError ? ` ${errorMessage(error.code)}` : ''}`;
      }
    }

    await deps.state
      .set({ householdId: member.member.household_id, memberId: member.member.id }, turn.next)
      .catch(() => console.warn('assistant_state_failed'));
    return { reply, intent: intent?.type ?? 'unknown', usedAi, changed: turn.changed };
  }

  function suggest(turn: Turn, text: string): string {
    const create = buildCreate(text, { today: turn.today, members: turn.member.members });
    const options: Intent[] = [
      ...(create && normalizeText(text).split(' ').length <= 12 ? [create] : []),
      { type: 'list_tasks', view: 'open' },
      { type: 'help' },
    ];
    turn.next = {
      ...(turn.state.list && { list: turn.state.list }),
      pending: { kind: 'suggest', options },
    };
    return unknownReply(turn.rc, options);
  }

  async function dispatch(turn: Turn, intent: Intent): Promise<string> {
    switch (intent.type) {
      case 'help':
        return helpReply(turn.rc.intensity, intent.topic);
      case 'out_of_scope':
        return outOfScopeReply(turn.rc.intensity);
      case 'set_persona': {
        await deps.members.updatePreferences(
          { householdId: turn.member.member.household_id, actorMemberId: turn.member.member.id },
          { personaIntensity: intent.intensity },
        );
        turn.changed = true;
        return modeReply(intent.intensity);
      }
      case 'set_guidance': {
        await deps.members.updatePreferences(
          { householdId: turn.member.member.household_id, actorMemberId: turn.member.member.id },
          { guidanceMode: intent.mode },
        );
        turn.changed = true;
        return intent.mode === 'guided'
          ? 'Modo Aprendiz ligado: vou confirmar antes de concluir ou cancelar e dar dicas.'
          : 'Modo Aprendiz desligado. A ajuda continua disponível: diga "ajuda".';
      }
      case 'create_task':
        return createTask(turn, intent);
      case 'list_tasks':
        return listTasks(turn, intent);
      case 'weekly_summary':
        return summary(turn);
      case 'undo': {
        const r = await deps.tasks.undoLastAction({ ...scopeOf(turn), idempotencyKey: turn.key });
        return result(turn, r, 'undone');
      }
      case 'complete_task':
        return withRef(turn, 'complete', intent.ref);
      case 'reopen_task':
        return withRef(turn, 'reopen', intent.ref);
      case 'cancel_task':
        return withRef(turn, 'cancel', intent.ref);
      case 'task_details':
        return withRef(turn, 'details', intent.ref);
      case 'update_task':
        return withRef(turn, 'update', intent.ref, intent);
      case 'choose':
        return choose(turn, intent.index);
      case 'confirm':
        return confirm(turn, intent.yes);
    }
  }

  function dueAt(turn: Turn, date?: string, time?: string): string | undefined {
    if (!date && !time) return undefined;
    const tz = turn.rc.tz;
    if (date) return zonedToUtcIso(date, time ?? '23:59', tz);
    const todayAt = zonedToUtcIso(turn.today, time ?? '23:59', tz);
    return new Date(todayAt) > new Date()
      ? todayAt
      : zonedToUtcIso(addDays(turn.today, 1), time ?? '23:59', tz);
  }

  function assigneeId(turn: Turn, a?: string): string | null | undefined {
    if (a === undefined) return undefined;
    if (a === 'me') return turn.member.member.id;
    if (a === 'shared') return null;
    return turn.member.members.some((m) => m.id === a) ? a : undefined;
  }

  async function createTask(turn: Turn, intent: IntentOf<'create_task'>): Promise<string> {
    const due = dueAt(turn, intent.date, intent.time);
    const assignee = assigneeId(turn, intent.assignee);
    const r = await deps.tasks.createTask({
      ...scopeOf(turn),
      title: intent.title,
      assignedToMemberId: assignee ?? null,
      ...(due && { dueAt: due }),
      ...(intent.priority && { priority: intent.priority }),
      idempotencyKey: turn.key,
    });
    if (!r.ok) return errorMessage(r.error);
    turn.changed = true;
    return `${actionMessage('created', r.task.title, turn.rc.intensity)}\n${taskFacts(turn.rc, r.task)}`;
  }

  async function listTasks(turn: Turn, intent: IntentOf<'list_tasks'>): Promise<string> {
    const hh = turn.member.member.household_id;
    const text = panelText(turn.rc.intensity);
    const weekStart = dayStartUtc(startOfWeek(turn.today), turn.rc.tz);
    const base = { householdId: hh, limit: 200 } as const;
    let header: string;
    let tasks: Task[];
    switch (intent.view) {
      case 'open':
        header = `📋 ${text.tasksTitle}:`;
        tasks = (await deps.tasks.listTasks({ ...base, view: 'open' })).tasks;
        break;
      case 'overdue':
        header = `⚠️ ${text.counters.overdue}:`;
        tasks = (await deps.tasks.listTasks({ ...base, view: 'overdue' })).tasks;
        break;
      case 'due_week':
        header = `⏰ ${text.counters.dueWeek}:`;
        tasks = (
          await deps.tasks.listTasks({
            ...base,
            view: 'due',
            from: new Date().toISOString(),
            to: dayStartUtc(addDays(turn.today, 8), turn.rc.tz),
          })
        ).tasks;
        break;
      case 'completed_week':
        header = `✅ ${text.counters.completedWeek}:`;
        tasks = (await deps.tasks.listTasks({ ...base, view: 'completed', from: weekStart })).tasks;
        break;
      case 'completed_by': {
        const name = turn.rc.names.get(intent.memberId ?? '') ?? '?';
        header = `✅ Concluídas por ${name} nesta semana:`;
        tasks = (
          await deps.tasks.listTasks({ ...base, view: 'completed', from: weekStart })
        ).tasks.filter((t) => t.completed_by_member_id === intent.memberId);
        break;
      }
      case 'mine':
        header = '👤 Com você:';
        tasks = (
          await deps.tasks.listTasks({
            ...base,
            view: 'open',
            assignedToMemberId: turn.member.member.id,
          })
        ).tasks;
        break;
      case 'member': {
        header = `👤 Com ${turn.rc.names.get(intent.memberId ?? '') ?? '?'}:`;
        tasks = intent.memberId
          ? (
              await deps.tasks.listTasks({
                ...base,
                view: 'open',
                assignedToMemberId: intent.memberId,
              })
            ).tasks
          : [];
        break;
      }
      case 'shared':
        header = `👥 ${text.shared}s:`;
        tasks = (await deps.tasks.listTasks({ ...base, view: 'open', onlyShared: true })).tasks;
        break;
      case 'with_photos':
        header = `📸 Com fotos:`;
        tasks = (await deps.tasks.listTasks({ ...base, view: 'all' })).tasks.filter(
          (t) => t.photo_count > 0 && t.status !== 'cancelled',
        );
        break;
    }
    const shown = tasks.slice(0, MAX_LIST);
    turn.next = { list: shown.map((t) => t.id) };
    return listReply(turn.rc, header, shown, tasks.length > shown.length);
  }

  async function summary(turn: Turn): Promise<string> {
    const hh = turn.member.member.household_id;
    const weekStart = dayStartUtc(startOfWeek(turn.today), turn.rc.tz);
    const [open, overdue, done] = await Promise.all([
      deps.tasks.listTasks({ householdId: hh, view: 'open', limit: 200 }),
      deps.tasks.listTasks({ householdId: hh, view: 'overdue', limit: 200 }),
      deps.tasks.listTasks({ householdId: hh, view: 'completed', from: weekStart, limit: 200 }),
    ]);
    const byMember = turn.member.members
      .map(
        (m) =>
          `${m.display_name} ${done.tasks.filter((t) => t.completed_by_member_id === m.id).length}`,
      )
      .join(', ');
    const head =
      turn.rc.intensity === 'off'
        ? '📊 Resumo da semana:'
        : '📊 Balanço do Plano Quinquenal (que dura 7 dias):';
    return [
      head,
      `✅ Concluídas: ${done.tasks.length} | ⏳ Pendentes: ${open.tasks.length} | ⚠️ Atrasadas: ${overdue.tasks.length}`,
      `Conclusões por pessoa: ${byMember}.`,
    ].join('\n');
  }

  type Resolved =
    | { kind: 'one'; task: Task }
    | { kind: 'many'; tasks: Task[] }
    | { kind: 'none' }
    | { kind: 'no_list' };

  async function resolve(turn: Turn, action: Action, ref: TaskRef): Promise<Resolved> {
    const hh = turn.member.member.household_id;
    if (ref.index !== undefined) {
      const id = turn.state.list?.[ref.index - 1];
      if (!turn.state.list) return { kind: 'no_list' };
      if (!id) return { kind: 'none' };
      const d = await deps.tasks.getTask({ householdId: hh, taskId: id });
      return d.ok && d.task ? { kind: 'one', task: d.task } : { kind: 'none' };
    }
    const view = action === 'reopen' ? 'completed' : action === 'details' ? 'all' : 'open';
    const pool = (await deps.tasks.listTasks({ householdId: hh, view, limit: 200 })).tasks;
    const q = normalizeText(ref.query ?? '');
    const tokens = q.split(' ').filter((w) => w.length > 1 && !STOPWORDS.has(w));
    if (tokens.length === 0) return { kind: 'none' };
    const exact = pool.filter((t) => normalizeText(t.title) === q);
    if (exact.length === 1 && exact[0]) return { kind: 'one', task: exact[0] };
    const hits = pool.filter((t) => {
      const words = normalizeText(t.title).split(' ');
      return tokens.every((tok) => words.some((w) => w.startsWith(tok)));
    });
    if (hits.length === 1 && hits[0]) return { kind: 'one', task: hits[0] };
    return hits.length ? { kind: 'many', tasks: hits.slice(0, 5) } : { kind: 'none' };
  }

  async function withRef(
    turn: Turn,
    action: Action,
    ref: TaskRef,
    update?: IntentOf<'update_task'>,
  ): Promise<string> {
    const r = await resolve(turn, action, ref);
    if (r.kind === 'no_list') {
      return 'Primeiro peça a lista ("pendentes") para eu saber qual é o número, ou diga o nome da tarefa.';
    }
    if (r.kind === 'none') {
      return `Não encontrei ${ref.query ? `"${ref.query}"` : `o número ${ref.index}`} entre as tarefas. Diga "pendentes" para ver a lista.`;
    }
    if (r.kind === 'many') {
      turn.next = {
        list: r.tasks.map((t) => t.id),
        pending: {
          kind: 'choose',
          action,
          ids: r.tasks.map((t) => t.id),
          ...(update && { update }),
        },
      };
      const head =
        turn.rc.intensity === 'full'
          ? 'Miau? Encontrei várias parecidas. Qual delas, camarada?'
          : 'Encontrei várias parecidas. Qual delas?';
      return [
        head,
        ...r.tasks.map((t, i) => taskLine(turn.rc, t, i + 1)),
        `Responda com o número.`,
      ].join('\n');
    }
    return act(turn, action, r.task, update);
  }

  async function act(
    turn: Turn,
    action: Action,
    task: Task,
    update?: IntentOf<'update_task'>,
    confirmed = false,
  ): Promise<string> {
    const guided = turn.member.member.guidance_mode === 'guided';
    if (
      guided &&
      !confirmed &&
      (action === 'complete' || action === 'cancel') &&
      task.status !== 'completed'
    ) {
      turn.next = { ...turn.next, pending: { kind: 'confirm', action, id: task.id } };
      return `${action === 'complete' ? 'Concluir' : 'Cancelar'} "${task.title}"? Responda "sim" ou "não".`;
    }
    const scope = { ...scopeOf(turn), taskId: task.id, idempotencyKey: turn.key };
    switch (action) {
      case 'complete':
        return result(turn, await deps.tasks.completeTask(scope), 'completed');
      case 'reopen':
        return result(turn, await deps.tasks.reopenTask(scope), 'reopened');
      case 'cancel':
        return result(turn, await deps.tasks.cancelTask(scope), 'cancelled');
      case 'details': {
        turn.next = { list: [task.id] };
        const lines = [taskLine(turn.rc, task), taskFacts(turn.rc, task)];
        if (task.description) lines.push(`📝 ${task.description}`);
        if (task.completed_at) {
          lines.push(
            `✅ Concluída por ${turn.rc.names.get(task.completed_by_member_id ?? '') ?? '?'} em ${formatDateTime(task.completed_at, turn.rc.tz)}`,
          );
        }
        return lines.join('\n');
      }
      case 'update': {
        const changes: Record<string, unknown> = {};
        if (update?.title) changes.title = update.title;
        if (update?.clearDue) changes.dueAt = null;
        else if (update?.date || update?.time) {
          let date = update.date;
          if (!date && task.due_at) date = todayKey(turn.rc.tz, new Date(task.due_at));
          changes.dueAt = dueAt(turn, date, update.time);
        }
        const a = assigneeId(turn, update?.assignee);
        if (a !== undefined) changes.assignedToMemberId = a;
        if (update?.priority) changes.priority = update.priority;
        if (Object.keys(changes).length === 0)
          return 'O que você quer mudar nessa tarefa? Ex.: "adiar louça para sexta".';
        const r = await deps.tasks.updateTask({ ...scope, changes });
        const text = result(turn, r, 'updated');
        return r.ok ? `${text}\n${taskFacts(turn.rc, r.task)}` : text;
      }
    }
  }

  function result(turn: Turn, r: TaskResult, event: PanelEvent): string {
    if (!r.ok) return errorMessage(r.error);
    if (
      r.event !== 'task_already_completed' &&
      r.event !== 'task_already_open' &&
      r.event !== 'task_already_cancelled'
    ) {
      turn.changed = true;
    }
    if (r.event === 'task_already_completed') return `"${r.task.title}" já estava concluída.`;
    if (r.event === 'task_already_open') return `"${r.task.title}" já estava pendente.`;
    if (r.event === 'task_already_cancelled') return `"${r.task.title}" já estava cancelada.`;
    let text = actionMessage(event, r.task.title, turn.rc.intensity);
    const next = (r as { next_task?: Task | null }).next_task;
    if (next?.due_at) text += `\n🔁 Próxima: ${formatDateTime(next.due_at, turn.rc.tz)}.`;
    return text;
  }

  async function choose(turn: Turn, index: number): Promise<string> {
    const p = turn.state.pending;
    if (p?.kind === 'suggest') {
      const option = p.options[index - 1];
      return option ? dispatch(turn, option) : `Responda um número de 1 a ${p.options.length}.`;
    }
    if (p?.kind === 'choose') {
      const id = p.ids[index - 1];
      if (!id) return `Responda um número de 1 a ${p.ids.length}.`;
      const d = await deps.tasks.getTask({
        householdId: turn.member.member.household_id,
        taskId: id,
      });
      if (!d.ok || !d.task) return errorMessage('task_not_found');
      const update = p.update
        ? (intentSchema.safeParse(p.update).data as IntentOf<'update_task'> | undefined)
        : undefined;
      return act(turn, p.action, d.task, update);
    }
    if (turn.state.list) return withRef(turn, 'details', { index });
    return 'Não há opções em aberto. Diga "pendentes" para ver a lista.';
  }

  async function confirm(turn: Turn, yes: boolean): Promise<string> {
    const p = turn.state.pending;
    if (p?.kind !== 'confirm') {
      return yes ? 'Não há nada para confirmar agora.' : 'Ok.';
    }
    if (!yes) return 'Ok, nada foi feito.';
    const d = await deps.tasks.getTask({
      householdId: turn.member.member.household_id,
      taskId: p.id,
    });
    if (!d.ok || !d.task) return errorMessage('task_not_found');
    return act(turn, p.action, d.task, undefined, true);
  }

  return { handle };
}

const STOPWORDS = new Set([
  'a',
  'o',
  'as',
  'os',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'na',
  'no',
  'em',
  'tarefa',
]);

export type Assistant = ReturnType<typeof createAssistant>;
