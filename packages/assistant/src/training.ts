import type { PersonaIntensity } from '@camarada/persona';

export const TRAINING_STEPS = 5;

/** Dicas contextuais: cada uma aparece uma única vez por pessoa. */
export const TIPS = {
  due_date:
    '💡 Dica: se você disser o dia e a hora ("sábado às 14h"), a tarefa ganha prazo. Esta dica aparece só uma vez.',
  done_number:
    '💡 Dica: depois de pedir a lista, "feito 2" conclui a tarefa número 2. Esta dica aparece só uma vez.',
  undo: '💡 Dica: errou? Diga "desfazer" e a sua última ação volta (por até 15 minutos). Esta dica aparece só uma vez.',
} as const;
export type TipKey = keyof typeof TIPS;

const EXAMPLES = [
  '• "Lavar a louça hoje às 20h"',
  '• "O que falta fazer?"',
  '• "Concluí a louça"',
].join('\n');

export function welcomeText(name: string, intensity: PersonaIntensity): string {
  const head =
    intensity === 'full'
      ? `Miau, Camarada ${name}! 🐱🚩 Sou o Camarada Ho Chi Miau, e vou cuidar do Plano Quinquenal da casa com vocês. É fácil, é só conversar comigo.`
      : `Olá, ${name}! Eu ajudo a cuidar das tarefas da casa. É fácil, é só conversar comigo.`;
  return [
    head,
    'Experimente enviar:',
    EXAMPLES,
    'Quer fazer um treino rápido de 2 minutos? Responda "treino". Para ver todos os exemplos, envie "ajuda".',
  ].join('\n');
}

export function exitOfferText(name: string, intensity: PersonaIntensity): string {
  const head =
    intensity === 'full'
      ? `Camarada ${name}, você já fez bastante coisa comigo! 🎉`
      : `${name}, você já fez bastante coisa comigo.`;
  return `${head} Quer que eu pare de dar dicas e de pedir confirmação? Responda "sim" ou "não". Para ajuda, é só dizer "ajuda".`;
}

const STEP_BODY = [
  'criar uma tarefa. Envie algo como: "Treino: regar as plantas amanhã". (Esta tarefa é só de treino: não aparece nas listas, nem nos resumos e é apagada ao fim.)',
  'ver a lista. Envie "o que falta fazer?" ou "pendentes".',
  'fotos (opcional). Fotos se anexam pelo painel, na página de cada tarefa. Para o treino, responda "próximo".',
  'concluir a tarefa. Envie "feito 1" (o número na lista) ou "concluí" e o nome da tarefa.',
  'ver o resumo. Envie "resumo".',
];

export const TRAINING_CONTROLS = 'Para pausar, diga "depois". Para sair do treino, diga "pular".';

export function stepPrompt(step: number, intensity: PersonaIntensity): string {
  const label = intensity === 'off' ? 'Treino' : 'Missão de Treino';
  const body = STEP_BODY[step - 1] ?? '';
  return `🎓 ${label}, passo ${step} de ${TRAINING_STEPS}: ${body}\n${TRAINING_CONTROLS}`;
}

export function trainingDoneText(intensity: PersonaIntensity): string {
  return intensity === 'off'
    ? '🎉 Treino concluído! As tarefas de treino foram apagadas. Diga "ajuda" quando precisar.'
    : '🎉 Missão de Treino cumprida, camarada! As tarefas de treino foram apagadas. Diga "ajuda" quando precisar.';
}

export const TRAINING_TEXT = {
  paused: 'Treino pausado. Diga "continuar treino" quando quiser retomar.',
  skipped: 'Treino encerrado. As tarefas de treino foram apagadas. Diga "treino" para refazer.',
  none: 'Não há treino em andamento. Diga "treino" para começar.',
  nonePaused: 'Não há treino pausado. Diga "treino" para começar.',
  notNow: 'Esse passo não pede "próximo". Faça o que está pedido, ou diga "pular" para sair.',
} as const;
