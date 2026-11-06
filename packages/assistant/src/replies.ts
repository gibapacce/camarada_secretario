import type { Task } from '@camarada/db';
import { panelText, type PersonaIntensity } from '@camarada/persona';
import { formatDateTime } from '@camarada/shared';
import type { Intent } from './intents.ts';

export interface ReplyContext {
  intensity: PersonaIntensity;
  tz: string;
  names: Map<string, string>;
}

export function who(ctx: ReplyContext, memberId: string | null): string {
  if (!memberId) return panelText(ctx.intensity).shared;
  return ctx.names.get(memberId) ?? 'Ex-membro';
}

export function taskLine(ctx: ReplyContext, t: Task, index?: number): string {
  const parts = [
    `${index === undefined ? '•' : `${index})`} ${t.title}`,
    who(ctx, t.assigned_to_member_id),
  ];
  if (t.due_at) parts.push(formatDateTime(t.due_at, ctx.tz));
  let line = parts.join(' — ');
  if (t.status === 'completed') line += ' ✅';
  else if (t.status === 'cancelled') line += ' (cancelada)';
  else if (t.is_overdue) line += ' ⚠️ atrasada';
  if (t.photo_count > 0) line += ` 📸${t.photo_count}`;
  return line;
}

export function taskFacts(ctx: ReplyContext, t: Task): string {
  return [
    `👤 Responsável: ${who(ctx, t.assigned_to_member_id)}`,
    `⏰ Prazo: ${t.due_at ? formatDateTime(t.due_at, ctx.tz) : 'sem prazo'}`,
  ].join('\n');
}

export function listReply(ctx: ReplyContext, header: string, tasks: Task[], more: boolean): string {
  const text = panelText(ctx.intensity);
  if (tasks.length === 0) return `${header}\n${text.emptyList}`;
  const lines = tasks.map((t, i) => taskLine(ctx, t, i + 1));
  const tail =
    ctx.intensity === 'off'
      ? 'Para concluir: "feito 1".'
      : 'Para concluir, diga "feito 1", camarada.';
  return [header, ...lines, ...(more ? ['…e mais. Use o painel para ver tudo.'] : []), tail].join(
    '\n',
  );
}

const HELP_TOPICS: Record<string, string> = {
  criar: [
    'Criar tarefas:',
    '• "Nova tarefa: lavar a louça amanhã às 20h"',
    '• "Anota: comprar ração pra Deise" (responsável)',
    '• "Tarefa: trocar o filtro, pros dois, urgente"',
    'Sem data, a tarefa fica sem prazo.',
  ].join('\n'),
  consultar: [
    'Consultar:',
    '• "O que falta fazer?"  • "O que está atrasado?"',
    '• "O que vence esta semana?"  • "Quais tarefas estão comigo?"',
    '• "O que foi concluído nesta semana?"  • "Resumo"',
  ].join('\n'),
  concluir: [
    'Concluir e corrigir:',
    '• "Feito 2" (número da última lista) ou "Concluí a louça"',
    '• "Reabrir 2", "Cancelar 3", "Adiar louça para sexta"',
    '• "Desfazer" volta a sua última ação (até 15 minutos).',
  ].join('\n'),
  fotos: 'Fotos: por enquanto, anexe pelo painel, na página da tarefa.',
  lembretes: 'Lembretes automáticos chegam em breve (Fase 8).',
};

export function helpReply(intensity: PersonaIntensity, topic?: string): string {
  if (topic && HELP_TOPICS[topic]) return HELP_TOPICS[topic];
  const head =
    intensity === 'off'
      ? 'Ajuda. Exemplos:'
      : intensity === 'light'
        ? '📚 Círculo de Estudos. Exemplos:'
        : '📚 Círculo de Estudos, camarada! Eu entendo frases normais. Exemplos:';
  return [
    head,
    '• "Nova tarefa: lavar a louça amanhã às 20h"',
    '• "O que falta fazer?"',
    '• "Feito 2" ou "Concluí a louça"',
    '• "Desfazer"  • "Resumo"',
    '• "Modo sério" / "Modo camarada"',
    'Temas: "ajuda criar", "ajuda consultar", "ajuda concluir", "ajuda fotos".',
  ].join('\n');
}

export function describeOption(ctx: ReplyContext, intent: Intent): string {
  switch (intent.type) {
    case 'create_task': {
      const extra = [
        intent.date && intent.time
          ? `${intent.date.split('-').reverse().join('/')} ${intent.time}`
          : (intent.date?.split('-').reverse().join('/') ?? intent.time),
        intent.assignee === 'me'
          ? 'com você'
          : intent.assignee === 'shared'
            ? 'dos dois'
            : intent.assignee
              ? `com ${who(ctx, intent.assignee)}`
              : undefined,
      ].filter(Boolean);
      return `Criar a tarefa "${intent.title}"${extra.length ? ` (${extra.join(', ')})` : ''}`;
    }
    case 'list_tasks':
      return 'Ver as tarefas pendentes';
    case 'help':
      return 'Ver a ajuda';
    default:
      return intent.type;
  }
}

export function unknownReply(ctx: ReplyContext, options: Intent[]): string {
  const head =
    ctx.intensity === 'full'
      ? 'Miau? Não tenho certeza do que você quis dizer. Foi algo assim?'
      : 'Não tenho certeza do que você quis dizer. Foi algo assim?';
  const nums = options.map((_, i) => String(i + 1));
  return [
    head,
    ...options.map((o, i) => `${i + 1}) ${describeOption(ctx, o)}`),
    `Responda ${nums.slice(0, -1).join(', ')}${nums.length > 1 ? ' ou ' : ''}${nums.at(-1)}, ou escreva de outro jeito.`,
  ].join('\n');
}

export function outOfScopeReply(intensity: PersonaIntensity): string {
  return intensity === 'off'
    ? 'Só consigo ajudar com as tarefas da casa. Diga "ajuda" para ver exemplos.'
    : 'Sou um gato de assuntos domésticos. Para o resto, consulte um gato com mais pós-graduação. 🐱 Diga "ajuda" para ver exemplos.';
}

export function modeReply(intensity: PersonaIntensity): string {
  if (intensity === 'off')
    return 'Entendido: modo sério ativado. Sem piadas, só tarefas. Diga "modo camarada" para voltar.';
  if (intensity === 'light') return 'Modo leve ativado. Pouca piada, muito trabalho.';
  return 'Miau! Modo camarada ativado. 🐱🚩 O Comitê Central Felino está de volta.';
}
