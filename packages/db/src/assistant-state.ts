import { z } from 'zod';
import { DomainError, type DbClient } from './client.ts';

const id = z.uuid();

/** Contexto curto da conversa (por membro, com validade). O conteúdo é validado por quem lê. */
export function createAssistantStateStore(db: DbClient) {
  const scope = (s: { householdId: string; memberId: string }) => {
    const parsed = z.object({ householdId: id, memberId: id }).safeParse(s);
    if (!parsed.success) throw new DomainError('invalid_input');
    return { p_household_id: parsed.data.householdId, p_member_id: parsed.data.memberId };
  };
  return {
    async get(s: { householdId: string; memberId: string }): Promise<unknown> {
      const r = (await db.call('get_assistant_state', scope(s))) as { state?: unknown };
      return r.state ?? null;
    },
    async set(
      s: { householdId: string; memberId: string },
      payload: unknown,
      ttlMinutes = 30,
    ): Promise<void> {
      await db.call('set_assistant_state', {
        ...scope(s),
        p_payload: payload ?? null,
        p_ttl_minutes: ttlMinutes,
      });
    },
  };
}

export type AssistantStateStore = ReturnType<typeof createAssistantStateStore>;
