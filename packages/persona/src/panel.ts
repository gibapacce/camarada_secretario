import type { PersonaIntensity } from './index.ts';

export interface PanelText {
  nav: { summary: string; tasks: string; calendar: string; preferences: string };
  summaryTitle: string;
  tasksTitle: string;
  calendarTitle: string;
  preferencesTitle: string;
  historyTitle: string;
  photosTitle: string;
  newTask: string;
  shared: string;
  emptyList: string;
  photosSoon: string;
  counters: { open: string; overdue: string; dueWeek: string; completedWeek: string };
  greeting: (name: string) => string | null;
}

const NEUTRAL: PanelText = {
  nav: { summary: 'Resumo', tasks: 'Tarefas', calendar: 'Calendário', preferences: 'Preferências' },
  summaryTitle: 'Resumo',
  tasksTitle: 'Tarefas',
  calendarTitle: 'Calendário',
  preferencesTitle: 'Preferências',
  historyTitle: 'Histórico',
  photosTitle: 'Fotos',
  newTask: 'Nova tarefa',
  shared: 'Compartilhada',
  emptyList: 'Nenhuma tarefa aqui.',
  photosSoon: 'Fotos chegam em breve.',
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
    preferences: 'Comitê',
  },
  summaryTitle: 'Assembleia Geral',
  tasksTitle: 'Plano Quinquenal',
  calendarTitle: 'Calendário da Revolução',
  preferencesTitle: 'Comitê de Preferências',
  historyTitle: 'Anais do Coletivo',
  photosTitle: 'Arquivo Nacional',
  newTask: 'Nova missão',
  shared: 'Coletiva',
  emptyList: 'Nenhuma missão aqui.',
  photosSoon: 'O Arquivo Nacional (fotos) abre em breve.',
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

export type PanelEvent = 'created' | 'updated' | 'completed' | 'reopened' | 'cancelled' | 'undone';

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
};

const THEMED_ACTION: Record<PanelEvent, string> = {
  created: '🚩 Missão registrada: "{t}".',
  updated: 'Missão atualizada: "{t}".',
  completed: '✅ Vitória do proletariado: "{t}" concluída.',
  reopened: 'Missão reaberta: "{t}". A luta continua.',
  cancelled: 'Missão cancelada: "{t}".',
  undone: 'Autocrítica aceita: ação desfeita em "{t}".',
};

const FULL_SPICE: Partial<Record<PanelEvent, string>> = {
  created: ' Que as patas do proletariado façam o seu trabalho. Miau!',
  completed: ' A burguesia da pia treme. 🐱🚩',
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
