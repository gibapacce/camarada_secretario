import { normalizeText } from '@camarada/shared';
import { fold, parseWhen } from './dates.ts';
import type { Intent, TaskRef } from './intents.ts';

export interface RuleContext {
  today: string;
  members: { id: string; display_name: string }[];
  /** Estado da Missão de Treino; comandos curtos como "depois" só valem durante o treino. */
  training?: 'active' | 'paused' | undefined;
}

const CREATE_RE =
  /^(?:\/nova|criar(?:\s+(?:uma\s+)?tarefa)?|crie|cria|nova\s+tarefa|tarefa|adicionar|adiciona|add|anotar?|lembrar\s+de|preciso|precisamos|temos\s+que|tenho\s+que)\s*:?\s+/;

function refFrom(rest: string): TaskRef {
  const r = rest.replace(/^(?:a|o|as|os|da|do|tarefa|missao|numero|n)\s+/, '').trim();
  return /^\d{1,2}$/.test(r) ? { index: Number(r) } : { query: r };
}

function firstName(name: string) {
  return normalizeText(name).split(' ')[0] ?? '';
}

function memberByName(name: string, ctx: RuleContext) {
  const n = normalizeText(name);
  return ctx.members.find(
    (m) => firstName(m.display_name) === n || normalizeText(m.display_name) === n,
  );
}

/** Responsável dito na frase ("pra mim", "pra Deise", "pros dois") e o texto sem essa parte. */
export function parseAssignee(text: string, ctx: RuleContext): { assignee?: string; rest: string } {
  const f = fold(text);
  const cut = (m: RegExpExecArray) =>
    `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ').trim();

  const me = /\b(?:(?:pra|para)\s+mim|comigo)\b/.exec(f);
  if (me) return { assignee: 'me', rest: cut(me) };
  const shared =
    /\b(?:(?:pra|para|pros|pras|com|entre)\s+(?:os\s+|as\s+|nos\s+)?(?:dois|duas|todos|ambos|casal)|compartilhad[ao])\b/.exec(
      f,
    );
  if (shared) return { assignee: 'shared', rest: cut(shared) };
  for (const m of ctx.members) {
    const name = firstName(m.display_name);
    if (!name) continue;
    const re = new RegExp(String.raw`\b(?:pra|para|com|que)\s+(?:a\s+|o\s+)?${name}\b`);
    const hit = re.exec(f);
    if (hit) return { assignee: m.id, rest: cut(hit) };
  }
  return { rest: text };
}

function tidyTitle(text: string): string {
  const t = text
    .replace(/^[\s:,;-]+|[\s:,;-]+$/g, '')
    .replace(/\s+(?:e|,)$/i, '')
    .trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Monta uma criação de tarefa a partir de texto livre (título, data, hora, responsável). */
export function buildCreate(text: string, ctx: RuleContext): Intent | null {
  let raw = text;
  let priority: 'high' | undefined;
  const urgent = /\burgente\b/.exec(fold(raw));
  if (urgent) {
    priority = 'high';
    raw = `${raw.slice(0, urgent.index)}${raw.slice(urgent.index + urgent[0].length)}`;
  }
  const when = parseWhen(raw, ctx.today);
  const who = parseAssignee(when.rest, ctx);
  const title = tidyTitle(who.rest);
  if (!title) return null;
  return {
    type: 'create_task',
    title: title.slice(0, 200),
    ...(when.date && { date: when.date }),
    ...(when.time && { time: when.time }),
    ...(who.assignee && { assignee: who.assignee }),
    ...(priority && { priority }),
  } as Intent;
}

/** Comandos da Missão de Treino. Os curtos ("depois", "pular") só valem com o treino em curso. */
function parseTraining(n: string, ctx: RuleContext): Intent | null {
  const running = ctx.training !== undefined;
  if (/^(?:treino|missao de treino|(?:fazer|iniciar|comecar) (?:o )?treino|treinar)$/.test(n)) {
    return { type: 'training', action: 'start' };
  }
  if (/^(?:reiniciar|recomecar|refazer) (?:o )?treino$/.test(n)) {
    return { type: 'training', action: 'restart' };
  }
  if (/^(?:continuar|continua|retomar|retoma) (?:o )?treino$/.test(n)) {
    return { type: 'training', action: 'resume' };
  }
  if (ctx.training === 'paused' && /^(?:continuar|continua|retomar|retoma)$/.test(n)) {
    return { type: 'training', action: 'resume' };
  }
  if (
    /^(?:pausar|pausa) (?:o )?treino$/.test(n) ||
    (running && /^(?:depois|mais tarde)$/.test(n))
  ) {
    return { type: 'training', action: 'pause' };
  }
  if (
    /^(?:pular|sair d[oe]|parar|encerrar|cancelar) (?:o )?treino$/.test(n) ||
    (running && n === 'pular')
  ) {
    return { type: 'training', action: 'skip' };
  }
  if (running && /^(?:proximo|proxima|seguinte|avancar)(?: passo)?$/.test(n)) {
    return { type: 'training', action: 'next' };
  }
  return null;
}

/** Entende comandos comuns sem IA. Retorna null quando não reconhece. */
export function parseRules(text: string, ctx: RuleContext): Intent | null {
  const n = normalizeText(text);
  if (!n) return null;

  if (/^\d{1,2}$/.test(n)) return { type: 'choose', index: Number(n) };
  if (/^(?:sim|s|isso|confirmo|confirma|pode|pode sim|ok|claro|bora)$/.test(n)) {
    return { type: 'confirm', yes: true };
  }
  if (/^(?:nao|n|deixa|deixa pra la|esquece|cancela|nao precisa)$/.test(n)) {
    return { type: 'confirm', yes: false };
  }

  const help =
    /^(?:\/?ajuda|\/start|\/help|menu|me ensina|nao sei usar|o que voce faz|exemplos|como (?:faco|funciona)(?: .*)?)(?: (criar|consultar|concluir|fotos|lembretes|treino))?$/.exec(
      n,
    );
  if (help) {
    const topic = help[1] as 'criar' | undefined;
    return topic ? { type: 'help', topic } : { type: 'help' };
  }

  const training = parseTraining(n, ctx);
  if (training) return training;
  if (ctx.training === 'active' && /^\s*treino\s*:\s*\S/.test(fold(text))) {
    return buildCreate(text.slice(text.indexOf(':') + 1).trim(), ctx);
  }

  if (/^(?:modo serio|sem piadas?|\/serio)$/.test(n))
    return { type: 'set_persona', intensity: 'off' };
  if (/^(?:modo camarada|\/camarada)$/.test(n)) return { type: 'set_persona', intensity: 'full' };
  if (/^modo leve$/.test(n)) return { type: 'set_persona', intensity: 'light' };
  if (/^modo aprendiz$/.test(n)) return { type: 'set_guidance', mode: 'guided' };
  if (/^modo normal$/.test(n)) return { type: 'set_guidance', mode: 'normal' };

  if (/^(?:\/?desfazer|desfaz|errei|volta|voltar)$/.test(n)) return { type: 'undo' };
  if (/^(?:\/?resumo|balanco|assembleia)(?: da semana)?$/.test(n))
    return { type: 'weekly_summary' };

  if (
    /^(?:\/?pendentes|o que falta(?: fazer)?|o que tem (?:pra|para) fazer|tarefas|lista|plano|missoes|\/lista)$/.test(
      n,
    )
  ) {
    return { type: 'list_tasks', view: 'open' };
  }
  if (/^(?:\/?atrasadas?|o que (?:esta|ta) atrasado|tem algo atrasado)$/.test(n)) {
    return { type: 'list_tasks', view: 'overdue' };
  }
  if (/^(?:o que )?vence (?:essa|esta|nesta|na) semana$|^(?:da|na) semana$|^\/semana$/.test(n)) {
    return { type: 'list_tasks', view: 'due_week' };
  }
  if (
    /^(?:\/?concluidas|o que foi (?:feito|concluido)(?: (?:essa|esta|nesta) semana)?|vitorias)$/.test(
      n,
    )
  ) {
    return { type: 'list_tasks', view: 'completed_week' };
  }
  if (
    /^(?:\/?minhas(?: tarefas)?|o que (?:esta|ta) comigo|quais tarefas estao comigo|comigo)$/.test(
      n,
    )
  ) {
    return { type: 'list_tasks', view: 'mine' };
  }
  if (/^(?:tarefas )?(?:compartilhadas|dos dois|de todos)$/.test(n)) {
    return { type: 'list_tasks', view: 'shared' };
  }
  if (/^(?:tarefas |mostre as tarefas |o que tem )?com fotos?$/.test(n)) {
    return { type: 'list_tasks', view: 'with_photos' };
  }
  const by =
    /^o que (?:a |o )?(\S+) (?:concluiu|fez|terminou)(?: (?:essa|esta|nesta) semana)?$/.exec(n);
  if (by?.[1]) {
    const m = memberByName(by[1], ctx);
    if (m) return { type: 'list_tasks', view: 'completed_by', memberId: m.id };
  }
  const of = /^(?:tarefas|o que esta|o que ta) (?:da|do|com a|com o|com) (\S+)$/.exec(n);
  if (of?.[1]) {
    const m = memberByName(of[1], ctx);
    if (m) return { type: 'list_tasks', view: 'member', memberId: m.id };
  }

  const done =
    /^(?:\/?feito|feita|fiz|conclui|concluir|concluida|concluido|terminei|terminar|pronto|check)\s+(.+)$/.exec(
      n,
    );
  if (done?.[1]) return { type: 'complete_task', ref: refFrom(done[1]) };
  const doneAfter = /^(.+?)\s+(?:feita|feito|concluida|concluido|pronta|pronto|ok)$/.exec(n);
  if (doneAfter?.[1]) return { type: 'complete_task', ref: refFrom(doneAfter[1]) };

  const reopen = /^(?:\/?reabrir|reabre|reabra)\s+(.+)$/.exec(n);
  if (reopen?.[1]) return { type: 'reopen_task', ref: refFrom(reopen[1]) };
  const cancel =
    /^(?:\/?cancelar|cancela|cancele|apagar|apaga|remover|remove|excluir|exclui)\s+(.+)$/.exec(n);
  if (cancel?.[1]) return { type: 'cancel_task', ref: refFrom(cancel[1]) };
  const details = /^(?:\/?detalhes|ver|mostrar|mostra|abrir|abre)\s+(.+)$/.exec(n);
  if (details?.[1]) return { type: 'task_details', ref: refFrom(details[1]) };

  const postpone = /^(?:adiar|adia|passar|passa|mudar|muda)\s+(.+?)\s+(?:para|pra)\s+(.+)$/.exec(n);
  if (postpone?.[1] && postpone[2]) {
    const when = parseWhen(postpone[2], ctx.today);
    if (when.date || when.time) {
      return {
        type: 'update_task',
        ref: refFrom(postpone[1].replace(/^(?:o )?prazo (?:de |da |do )?/, '')),
        ...(when.date && { date: when.date }),
        ...(when.time && { time: when.time }),
      };
    }
  }

  const create = CREATE_RE.exec(fold(text.trim()));
  if (create) return buildCreate(text.trim().slice(create[0].length), ctx);

  return null;
}
