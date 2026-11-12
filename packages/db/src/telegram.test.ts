import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMemberService, type MemberService } from './members.ts';
import { PgliteDbClient, createFixture, createTestDb, type Fixture } from './testing.ts';

let pg: PGlite;
let members: MemberService;
let f: Fixture;

beforeAll(async () => {
  pg = await createTestDb();
  members = createMemberService(new PgliteDbClient(pg));
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await pg.query('update household_members set telegram_user_id = null, telegram_chat_id = null');
  f = await createFixture(pg);
});

const scope = () => ({ householdId: f.householdId, actorMemberId: f.ownerId });
const TG_USER = 7_000_000_001;

describe('vinculação do Telegram', () => {
  it('vincula com o código, que só vale uma vez', async () => {
    const { code } = await members.createTelegramLinkCode(scope());
    expect(code).toMatch(/^[0-9A-F]{12}$/);

    const linked = await members.linkTelegram({ code, telegramUserId: TG_USER, chatId: TG_USER });
    expect(linked).toMatchObject({ ok: true, member: { id: f.ownerId, display_name: 'Ana' } });

    const ctx = await members.getContextByTelegram(TG_USER);
    expect(ctx?.member).toMatchObject({ id: f.ownerId, telegram_linked: true });
    expect(await members.linkTelegram({ code, telegramUserId: TG_USER + 1, chatId: 1 })).toEqual({
      ok: false,
      error: 'invalid_code',
    });
  });

  it('aceita o código em minúsculas e guarda só o hash', async () => {
    const { code } = await members.createTelegramLinkCode(scope());
    const stored = await pg.query<{ code_hash: string }>(
      'select code_hash from telegram_link_codes',
    );
    expect(stored.rows.map((r) => r.code_hash)).not.toContain(code);
    const r = await members.linkTelegram({
      code: code.toLowerCase(),
      telegramUserId: TG_USER,
      chatId: TG_USER,
    });
    expect(r.ok).toBe(true);
  });

  it('recusa código vencido, inexistente ou malformado', async () => {
    const { code } = await members.createTelegramLinkCode(scope());
    await pg.query(`update telegram_link_codes set expires_at = now() - interval '1 second'`);
    for (const bad of [code, 'ABCDEF123456', '', "x'; drop table tasks;--"]) {
      expect(await members.linkTelegram({ code: bad, telegramUserId: TG_USER, chatId: 1 })).toEqual(
        { ok: false, error: 'invalid_code' },
      );
    }
    expect(await members.getContextByTelegram(TG_USER)).toBeNull();
  });

  it('um código novo invalida o anterior da mesma pessoa', async () => {
    const first = await members.createTelegramLinkCode(scope());
    const second = await members.createTelegramLinkCode(scope());
    expect(
      (await members.linkTelegram({ code: first.code, telegramUserId: TG_USER, chatId: 1 })).ok,
    ).toBe(false);
    expect(
      (await members.linkTelegram({ code: second.code, telegramUserId: TG_USER, chatId: 1 })).ok,
    ).toBe(true);
  });

  it('o mesmo Telegram não pode servir a duas pessoas', async () => {
    const a = await members.createTelegramLinkCode(scope());
    await members.linkTelegram({ code: a.code, telegramUserId: TG_USER, chatId: 1 });
    const b = await members.createTelegramLinkCode({
      householdId: f.householdId,
      actorMemberId: f.memberId,
    });
    expect(
      await members.linkTelegram({ code: b.code, telegramUserId: TG_USER, chatId: 1 }),
    ).toEqual({ ok: false, error: 'telegram_already_linked' });
  });

  it('desvincular remove o acesso; membro inativo ou de outra casa não gera código', async () => {
    const a = await members.createTelegramLinkCode(scope());
    await members.linkTelegram({ code: a.code, telegramUserId: TG_USER, chatId: 1 });
    await members.unlinkTelegram(scope());
    expect(await members.getContextByTelegram(TG_USER)).toBeNull();

    await expect(
      members.createTelegramLinkCode({
        householdId: f.householdId,
        actorMemberId: f.inactiveMemberId,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      members.createTelegramLinkCode({ householdId: f.householdId, actorMemberId: f.outsiderId }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('desativar a pessoa corta o acesso pelo Telegram', async () => {
    const a = await members.createTelegramLinkCode(scope());
    await members.linkTelegram({ code: a.code, telegramUserId: TG_USER, chatId: 1 });
    await pg.query('update household_members set is_active = false where id = $1', [f.ownerId]);
    expect(await members.getContextByTelegram(TG_USER)).toBeNull();
  });
});
