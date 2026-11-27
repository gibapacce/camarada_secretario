import type { PersonaIntensity } from './index.ts';

export interface PanelText {
  nav: {
    summary: string;
    tasks: string;
    calendar: string;
    chat: string;
    start: string;
    preferences: string;
  };
  summaryTitle: string;
  tasksTitle: string;
  calendarTitle: string;
  chatTitle: string;
  chatIntro: string;
  startTitle: string;
  startIntro: string;
  preferencesTitle: string;
  historyTitle: string;
  photosTitle: string;
  newTask: string;
  shared: string;
  emptyList: string;
  noPhotos: string;
  counters: { open: string; overdue: string; dueWeek: string; completedWeek: string };
  greeting: (name: string) => string | null;
}

const NEUTRAL: PanelText = {
  nav: {
    summary: 'Resumo',
    tasks: 'Tarefas',
    calendar: 'Calendário',
    chat: 'Conversar',
    start: 'Primeiros passos',
    preferences: 'Preferências',
  },
  summaryTitle: 'Resumo',
  tasksTitle: 'Tarefas',
  calendarTitle: 'Calendário',
  chatTitle: 'Conversar',
  chatIntro:
    'Escreva como no chat. Ex.: "nova tarefa: lavar a louça amanhã às 20h", "pendentes", "feito 1".',
  startTitle: 'Primeiros passos',
  startIntro:
    'Exemplos prontos de frases para o assistente. Copie, cole na conversa e troque pelo que você precisa.',
  preferencesTitle: 'Preferências',
  historyTitle: 'Histórico',
  photosTitle: 'Fotos',
  newTask: 'Nova tarefa',
  shared: 'Compartilhada',
  emptyList: 'Nenhuma tarefa aqui.',
  noPhotos: 'Nenhuma foto ainda.',
  counters: {
    open: 'Pendentes',
    overdue: 'Atrasadas',
    dueWeek: 'Vencem em 7 dias',
    completedWeek: 'Concluídas na semana',
  },
  greeting: () => null,
};

const THEMED: PanelText = {
  nav: {
    summary: 'Assembleia',
    tasks: 'Plano Quinquenal',
    calendar: 'Calendário',
    chat: 'Falar com o Camarada',
    start: 'Círculo de Estudos',
    preferences: 'Comitê',
  },
  summaryTitle: 'Assembleia Geral',
  tasksTitle: 'Plano Quinquenal',
  calendarTitle: 'Calendário da Revolução',
  chatTitle: 'Falar com o Camarada',
  chatIntro:
    'Fale como no chat, camarada. Ex.: "nova tarefa: lavar a louça amanhã às 20h", "pendentes", "feito 1".',
  startTitle: 'Círculo de Estudos',
  startIntro:
    'Frases prontas para falar com o Camarada. Copie, cole na conversa e troque pelo que você precisa.',
  preferencesTitle: 'Comitê de Preferências',
  historyTitle: 'Anais do Coletivo',
  photosTitle: 'Arquivo Nacional',
  newTask: 'Nova missão',
  shared: 'Coletiva',
  emptyList: 'Nenhuma missão aqui.',
  noPhotos: 'O Arquivo Nacional desta missão está vazio.',
  counters: {
    open: 'Missões em andamento',
    overdue: 'Desvios de rota',
    dueWeek: 'Próximas lutas (7 dias)',
    completedWeek: 'Vitórias da semana',
  },
  greeting: (name) => `Olá, camarada ${name}!`,
};

const FULL: PanelText = {
  ...THEMED,
  emptyList: 'Nenhuma missão aqui. Soneca estratégica liberada. 😺',
  greeting: (name) => `Miau, camarada ${name}! 🐱🚩 O Plano Quinquenal aguarda.`,
};

/** Rótulos do painel; em `off` são neutros, sem perder nenhuma função. */
export function panelText(intensity: PersonaIntensity): PanelText {
  return intensity === 'off' ? NEUTRAL : intensity === 'light' ? THEMED : FULL;
}

export type PanelEvent =
  | 'created'
  | 'updated'
  | 'completed'
  | 'reopened'
  | 'cancelled'
  | 'undone'
  | 'photo_added'
  | 'photo_removed';

const SENSITIVE =
  /\b(medic[oa]s?|hospita\w*|exames?|consultas?|remedios?|cirurgi\w*|terapia|doen\w*|luto|velorio|enterro|funeral|dividas?|emprestimos?)\b/;

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Assuntos sensíveis (saúde, luto, dívidas) recebem tom neutro em qualquer intensidade. */
export function isSensitive(text: string): boolean {
  return SENSITIVE.test(normalize(text));
}

const NEUTRAL_ACTION: Record<PanelEvent, string> = {
  created: 'Tarefa criada: "{t}".',
  updated: 'Tarefa atualizada: "{t}".',
  completed: 'Tarefa concluída: "{t}".',
  reopened: 'Tarefa reaberta: "{t}".',
  cancelled: 'Tarefa cancelada: "{t}".',
  undone: 'Ação desfeita em "{t}".',
  photo_added: 'Foto anexada a "{t}".',
  photo_removed: 'Foto removida de "{t}".',
};

const THEMED_ACTION: Record<PanelEvent, string> = {
  created: '🚩 Missão registrada: "{t}".',
  updated: 'Missão atualizada: "{t}".',
  completed: '✅ Vitória do proletariado: "{t}" concluída.',
  reopened: 'Missão reaberta: "{t}". A luta continua.',
  cancelled: 'Missão cancelada: "{t}".',
  undone: 'Autocrítica aceita: ação desfeita em "{t}".',
  photo_added: '📸 Prova documental anexada a "{t}".',
  photo_removed: 'Prova documental retirada de "{t}".',
};

const FULL_SPICE: Partial<Record<PanelEvent, string>> = {
  created: ' Que as patas do proletariado façam o seu trabalho. Miau!',
  completed: ' A burguesia da pia treme. 🐱🚩',
  photo_added: ' Arquivada no Arquivo Nacional, em segurança.',
};

/** Fato primeiro (título exato), tempero depois. */
export function actionMessage(
  event: PanelEvent,
  title: string,
  intensity: PersonaIntensity,
): string {
  const level = isSensitive(title) ? 'off' : intensity;
  const template = level === 'off' ? NEUTRAL_ACTION[event] : THEMED_ACTION[event];
  const base = template.replace('{t}', () => title);
  return level === 'full' ? base + (FULL_SPICE[event] ?? '') : base;
}

const ATTEMPT: Record<PanelEvent, { attempt: string; outcome: string }> = {
  created: { attempt: 'criar a tarefa{t}', outcome: 'a tarefa{t} foi criada' },
  updated: {
    attempt: 'salvar as mudanças na tarefa{t}',
    outcome: 'as mudanças na tarefa{t} foram salvas',
  },
  completed: { attempt: 'concluir a tarefa{t}', outcome: 'a tarefa{t} foi concluída' },
  reopened: { attempt: 'reabrir a tarefa{t}', outcome: 'a tarefa{t} foi reaberta' },
  cancelled: { attempt: 'cancelar a tarefa{t}', outcome: 'a tarefa{t} foi cancelada' },
  undone: { attempt: 'desfazer a última ação', outcome: 'a última ação foi desfeita' },
  photo_added: { attempt: 'anexar a foto à tarefa{t}', outcome: 'a foto foi anexada à tarefa{t}' },
  photo_removed: {
    attempt: 'remover a foto da tarefa{t}',
    outcome: 'a foto foi removida da tarefa{t}',
  },
};

export interface FailureOptions {
  /** O que se tentou fazer; sem ele o texto fica genérico. */
  event?: PanelEvent;
  title?: string;
  /** Código de erro estável (ver `errorMessage`). */
  code?: string;
  /**
   * A resposta não chegou ou veio quebrada: a ação pode ter sido gravada.
   * Nesse caso o texto não diz que nada mudou; pede para conferir antes de repetir.
   */
  uncertain?: boolean;
  /** Onde a pessoa confere o resultado: na tela do painel ou pedindo a lista na conversa. */
  channel?: 'panel' | 'chat';
}

/** Falha sem dar a ação como feita: diz o que não deu certo e o próximo passo. */
export function failureMessage(intensity: PersonaIntensity, o: FailureOptions = {}): string {
  const t = o.title ? ` "${o.title}"` : '';
  const phrase = o.event ? ATTEMPT[o.event] : { attempt: 'fazer isso', outcome: 'deu certo' };
  const fill = (s: string) => s.replace('{t}', () => t);
  let text: string;
  if (o.uncertain) {
    const why =
      o.code === 'network_error'
        ? ' A conexão caiu antes da resposta.'
        : o.code === 'db_unavailable'
          ? ' O banco de dados não respondeu.'
          : ' A resposta não chegou completa.';
    const check =
      o.channel === 'chat'
        ? 'Diga "pendentes" para conferir antes de repetir'
        : 'Confira na tela antes de tentar de novo';
    const twice = o.event === 'created' ? ', para não criar em dobro' : '';
    text = `Não consegui confirmar se ${fill(phrase.outcome)}.${why} ${check}${twice}.`;
  } else {
    const known = o.code !== undefined && o.code in ERROR_TEXT;
    text = known
      ? `Não consegui ${fill(phrase.attempt)}. ${errorMessage(o.code ?? '')} Nada foi alterado.`
      : `Não consegui ${fill(phrase.attempt)}. Nada foi alterado; pode tentar de novo.`;
  }
  return intensity === 'full' && !(o.title && isSensitive(o.title)) ? `😿 ${text}` : text;
}

const ERROR_TEXT: Record<string, string> = {
  network_error: 'Sem conexão com o servidor.',
  unauthorized: 'Sua sessão expirou. Entre de novo.',
  not_a_member: 'Este login não está ligado a nenhuma casa.',
  task_not_found: 'Tarefa não encontrada.',
  task_cancelled: 'A tarefa está cancelada.',
  task_completed: 'A tarefa já foi concluída.',
  nothing_to_undo: 'Não há ação recente para desfazer.',
  undo_conflict: 'Outra pessoa mexeu nessa tarefa depois; não dá para desfazer.',
  invalid_input: 'Dados inválidos. Confira os campos.',
  invalid_assignee: 'Responsável inválido.',
  db_unavailable: 'O banco está indisponível. Tente em instantes.',
  auth_unavailable: 'O login está indisponível. Tente em instantes.',
  storage_unavailable: 'O arquivo de fotos está indisponível. Tente em instantes.',
  unsupported_image: 'Formato não suportado. Use JPEG, PNG ou WEBP.',
  photo_too_large: 'Foto grande demais.',
  photo_limit: 'Limite de 10 fotos por tarefa.',
  photo_not_found: 'Foto não encontrada.',
};

/** Texto curto e sem detalhes internos para um código de erro estável. */
export function errorMessage(code: string): string {
  return ERROR_TEXT[code] ?? 'Erro inesperado.';
}
