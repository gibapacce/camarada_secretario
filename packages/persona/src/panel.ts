import type { PersonaIntensity } from './index.ts';

export interface PanelText {
  nav: { summary: string; tasks: string; calendar: string; chat: string; preferences: string };
  summaryTitle: string;
  tasksTitle: string;
  calendarTitle: string;
  chatTitle: string;
  chatIntro: string;
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
    preferences: 'Preferências',
  },
  summaryTitle: 'Resumo',
  tasksTitle: 'Tarefas',
  calendarTitle: 'Calendário',
  chatTitle: 'Conversar',
  chatIntro:
    'Escreva como no chat. Ex.: "nova tarefa: lavar a louça amanhã às 20h", "pendentes", "feito 1".',
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
    preferences: 'Comitê',
  },
  summaryTitle: 'Assembleia Geral',
  tasksTitle: 'Plano Quinquenal',
  calendarTitle: 'Calendário da Revolução',
  chatTitle: 'Falar com o Camarada',
  chatIntro:
    'Fale como no chat, camarada. Ex.: "nova tarefa: lavar a louça amanhã às 20h", "pendentes", "feito 1".',
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

export function failureMessage(intensity: PersonaIntensity): string {
  const base = 'Não consegui concluir a operação. Nada foi registrado.';
  return intensity === 'full' ? `😿 ${base} (O imperialismo da internet ataca outra vez.)` : base;
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
