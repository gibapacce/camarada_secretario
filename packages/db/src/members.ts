import { z } from 'zod';
import { DomainError, type DbClient } from './client.ts';

export type PersonaIntensity = 'off' | 'light' | 'full';
export type GuidanceMode = 'guided' | 'normal';

export interface MemberContext {
  ok: true;
  member: {
    id: string;
    household_id: string;
    display_name: string;
    role: 'owner' | 'member';
    persona_intensity: PersonaIntensity;
    guidance_mode: GuidanceMode;
    /** Início do Modo Aprendiz (ou da entrada na casa) e ações feitas desde então. */
    guidance_since: string;
    guided_actions: number;
    /** Passo atual da Missão de Treino (1 a 5); nulo quando não há treino. */
    tutorial_step: number | null;
    tutorial_paused: boolean;
    /** Dicas e avisos já mostrados a esta pessoa. */
    tips_seen: string[];
    telegram_linked: boolean;
  };
  household: { id: string; name: string; timezone: string };
  members: { id: string; display_name: string; role: 'owner' | 'member' }[];
}

export const preferencesSchema = z
  .object({
    personaIntensity: z.enum(['off', 'light', 'full']).optional(),
    guidanceMode: z.enum(['guided', 'normal']).optional(),
  })
  .strict()
  .refine((p) => p.personaIntensity || p.guidanceMode, 'nenhuma preferência informada');

export const trainingSchema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['start', 'pause', 'resume', 'finish']) }),
  z.object({ action: z.literal('step'), step: z.number().int().min(1).max(5) }),
  z.object({ action: z.literal('tip'), tip: z.string().regex(/^[a-z_]{1,40}$/) }),
]);

export type TelegramLinkResult =
  | {
      ok: true;
      event: 'telegram_linked';
      member: { id: string; household_id: string; display_name: string };
    }
  | { ok: false; error: 'invalid_code' | 'telegram_already_linked' };

const telegramIds = z.object({
  telegramUserId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  chatId: z.number().int().max(Number.MAX_SAFE_INTEGER),
});

export function createMemberService(db: DbClient) {
  return {
    /** Contexto do membro ativo ligado a um usuário do Telegram, ou null. */
    async getContextByTelegram(telegramUserId: number): Promise<MemberContext | null> {
      if (!telegramIds.shape.telegramUserId.safeParse(telegramUserId).success) {
        return null;
      }
      const result = (await db.call('get_member_context_by_telegram', {
        p_telegram_user_id: telegramUserId,
      })) as MemberContext | { ok: false };
      return result.ok ? result : null;
    },

    /** Gera um código de uso único (15 min) para a pessoa vincular o seu Telegram. */
    async createTelegramLinkCode(scope: {
      householdId: string;
      actorMemberId: string;
    }): Promise<{ ok: true; code: string; expires_in_minutes: number }> {
      return (await db.call('create_telegram_link_code', {
        p_household_id: scope.householdId,
        p_actor_member_id: scope.actorMemberId,
      })) as { ok: true; code: string; expires_in_minutes: number };
    },

    /** Usa o código recebido pelo bot. Códigos inválidos ou vencidos viram `invalid_code`. */
    async linkTelegram(input: {
      code: string;
      telegramUserId: number;
      chatId: number;
    }): Promise<TelegramLinkResult> {
      const ids = telegramIds.safeParse(input);
      const code = input.code.trim();
      if (!ids.success || !/^[A-Za-z0-9]{6,40}$/.test(code)) {
        return { ok: false, error: 'invalid_code' };
      }
      return (await db.call('link_telegram_member', {
        p_code: code,
        p_telegram_user_id: ids.data.telegramUserId,
        p_telegram_chat_id: ids.data.chatId,
      })) as TelegramLinkResult;
    },

    async unlinkTelegram(scope: { householdId: string; actorMemberId: string }): Promise<unknown> {
      return db.call('unlink_telegram_member', {
        p_household_id: scope.householdId,
        p_actor_member_id: scope.actorMemberId,
      });
    },

    /** Retorna o contexto do membro ativo ligado ao usuário autenticado, ou null. */
    async getContext(authUserId: string): Promise<MemberContext | null> {
      if (!z.uuid().safeParse(authUserId).success) {
        return null;
      }
      const result = (await db.call('get_member_context', { p_auth_user_id: authUserId })) as
        MemberContext | { ok: false };
      return result.ok ? result : null;
    },

    async updatePreferences(
      scope: { householdId: string; actorMemberId: string },
      input: unknown,
    ): Promise<unknown> {
      const parsed = preferencesSchema.safeParse(input);
      if (!parsed.success) {
        throw new DomainError('invalid_input', z.prettifyError(parsed.error));
      }
      return db.call('update_member_preferences', {
        p_household_id: scope.householdId,
        p_actor_member_id: scope.actorMemberId,
        p_persona_intensity: parsed.data.personaIntensity,
        p_guidance_mode: parsed.data.guidanceMode,
      });
    },

    /** Missão de Treino e dicas. Finalizar o treino apaga as tarefas de treino da pessoa. */
    async updateTraining(
      scope: { householdId: string; actorMemberId: string },
      input: z.input<typeof trainingSchema>,
    ): Promise<unknown> {
      const parsed = trainingSchema.safeParse(input);
      if (!parsed.success) {
        throw new DomainError('invalid_input', z.prettifyError(parsed.error));
      }
      const d = parsed.data;
      return db.call('update_member_training', {
        p_household_id: scope.householdId,
        p_actor_member_id: scope.actorMemberId,
        p_action: d.action,
        p_step: d.action === 'step' ? d.step : undefined,
        p_tip: d.action === 'tip' ? d.tip : undefined,
      });
    },
  };
}

export type MemberService = ReturnType<typeof createMemberService>;
