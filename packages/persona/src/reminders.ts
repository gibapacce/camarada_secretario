import { addDays, dayKey, formatDayLabel, utcToZonedInput } from '@camarada/shared';
import type { PersonaIntensity } from './index.ts';
import { isSensitive } from './panel.ts';

export type ReminderType = 'before_24h' | 'due' | 'overdue';

export interface ReminderInput {
  type: ReminderType;
  /** Chave de deduplicação: escolhe a variante, então um retry reenvia o mesmo texto. */
  key: string;
  intensity: PersonaIntensity;
  title: string;
  dueAt: string;
  /** Momento do envio; "hoje", "amanhã" e os dias de atraso são relativos a ele. */
  sentAt: string;
  timezone: string;
  shared: boolean;
}

// {t} = título entre aspas (+ "coletiva"), {due} = "hoje às 18:00", {late} = "venceu ontem".
const NEUTRAL: Record<ReminderType, string> = {
  before_24h: 'Lembrete: {t} vence {due}.',
  due: 'Lembrete: {t} vence {due}.',
  overdue: 'Tarefa atrasada: {t} {late}. Conclua ou defina uma nova data.',
};

const LIGHT: Record<ReminderType, string[]> = {
  before_24h: [
    '🚩 Comunicado do Comitê Central: {t} vence {due}.',
    '⏰ Aviso do Comitê: {t} vence {due}.',
  ],
  due: ['⏰ Chegou a hora: {t} vence {due}.', '🚩 Comunicado do Comitê Central: {t} vence {due}.'],
  overdue: [
    '⚠️ Desvio de rota: {t} {late}. Conclua ou defina uma nova data.',
    '⚠️ Comunicado do Comitê: {t} {late}. Conclua ou defina uma nova data.',
  ],
};

const FULL: Record<ReminderType, string[]> = {
  before_24h: [
    '🚩 Comunicado do Comitê Central Felino: {t} vence {due}. Procrastinar é coisa da burguesia.',
    '⏰ Camarada, {t} vence {due}. O Plano Quinquenal conta com as suas patas. 🐱',
    '📢 Comunicado oficial: {t} vence {due}. Até a revolução precisa de cronograma. Miau!',
    '🚩 Atenção, camarada! {t} vence {due}. Prepare as patas.',
    '⏰ {t} vence {due}. O coletivo agradece a organização. 🐱🚩',
  ],
  due: [
    '⏰ Chegou a hora, camarada: {t} vence {due}. Às patas! 🐱🚩',
    '🚩 Comunicado do Comitê Central Felino: {t} vence {due}. A luta é agora.',
    '📢 Camarada, {t} vence {due}. A burguesia da pia não vai se derrotar sozinha.',
    '⏰ Miau! {t} vence {due}. O Plano Quinquenal confia em você.',
    '🚩 Hora da missão: {t} vence {due}. Avante, camarada! 🐱',
  ],
  overdue: [
    '⚠️ Camarada, {t} {late}. Não é acusação, é análise materialista. Conclua ou me dê uma nova data.',
    '⚠️ Desvio de rota: {t} {late}. Sem drama: conclua ou escolha uma nova data. 🐱',
    '😿 {t} {late}. O Comitê sugere uma autocrítica leve: conclua ou marque uma nova data.',
    '⚠️ Comunicado do Comitê Central Felino: {t} {late}. Uma nova data também é vitória.',
    '🐱 Miau... {t} {late}. Conclua ou me diga uma nova data, camarada.',
  ],
};

/** FNV-1a de 32 bits: estável entre execuções e plataformas. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pick(list: string[], key: string): string {
  return list[hash(key) % list.length] ?? list[0] ?? '';
}

function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function dueLabel(dueAt: string, ref: string, tz: string): string {
  const dueDay = dayKey(dueAt, tz);
  const refDay = dayKey(ref, tz);
  const { time } = utcToZonedInput(dueAt, tz);
  const day =
    dueDay === refDay
      ? 'hoje'
      : dueDay === addDays(refDay, 1)
        ? 'amanhã'
        : formatDayLabel(dueDay, { weekday: 'short', day: '2-digit', month: '2-digit' });
  // Tarefa só com data fica com prazo 23:59: não vale mostrar a hora.
  return time === '23:59' ? day : `${day} às ${time}`;
}

function lateLabel(dueAt: string, ref: string, tz: string): string {
  const days = dayDiff(dayKey(dueAt, tz), dayKey(ref, tz));
  return days <= 1 ? 'venceu ontem' : `está atrasada há ${days} dias`;
}

/** Texto do lembrete: fato primeiro (título e prazo exatos), tempero depois. */
export function reminderMessage(input: ReminderInput): string {
  const level = isSensitive(input.title) ? 'off' : input.intensity;
  const template =
    level === 'off'
      ? NEUTRAL[input.type]
      : pick(level === 'light' ? LIGHT[input.type] : FULL[input.type], input.key);
  const suffix = input.shared ? (level === 'off' ? ' (compartilhada)' : ' (coletiva)') : '';
  const values: Record<string, string> = {
    t: `"${input.title}"${suffix}`,
    due: dueLabel(input.dueAt, input.sentAt, input.timezone),
    late: lateLabel(input.dueAt, input.sentAt, input.timezone),
  };
  return template.replace(/\{(t|due|late)\}/g, (_, k: string) => values[k] ?? '');
}
