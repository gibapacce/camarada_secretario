export const BOT_NAME = 'Camarada Ho Chi Miau';

export const PERSONA_INTENSITIES = ['off', 'light', 'full'] as const;
export type PersonaIntensity = (typeof PERSONA_INTENSITIES)[number];

export const DEFAULT_PERSONA_INTENSITY: PersonaIntensity = 'full';

export function isPersonaIntensity(value: unknown): value is PersonaIntensity {
  return typeof value === 'string' && (PERSONA_INTENSITIES as readonly string[]).includes(value);
}

export {
  actionMessage,
  errorMessage,
  failureMessage,
  isSensitive,
  panelText,
  type PanelEvent,
  type PanelText,
} from './panel.ts';
export { reminderMessage, type ReminderInput, type ReminderType } from './reminders.ts';
