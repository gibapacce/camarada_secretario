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

export function createMemberService(db: DbClient) {
  return {
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
