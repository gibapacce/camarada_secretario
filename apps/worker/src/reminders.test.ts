import type { PGlite } from '@electric-sql/pglite';
import { createReminderService, type ReminderService } from '@camarada/db';
import { PgliteDbClient, createFixture, createTestDb, type Fixture } from '@camarada/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runReminders } from './reminders.ts';
import { TelegramSendError, type TelegramPort } from './telegram.ts';

const PANEL = 'https://camarada.example.dev';
const at = (local: string) => new Date(`${local.replace(' ', 'T')}:00-03:00`);

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('valor esperado ausente');
  return value;
}

let pg: PGlite;
let reminders: ReminderService;
let f: Fixture;
let taskId: string;
let sent: { chatId: number; text: string; button?: { text: string; url: string } }[];
let failWith: number | null;

const telegram: TelegramPort = {
  async sendMessage(chatId, text, button) {
    if (failWith !== null) throw new TelegramSendError(failWith);
    sent.push({ chatId, text, ...(button && { button }) });
  },
};

beforeAll(async () => {
  pg = await createTestDb();
  reminders = createReminderService(new PgliteDbClient(pg));
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await pg.query('delete from tasks');
  await pg.query('update household_members set telegram_user_id = null, telegram_chat_id = null');
  f = await createFixture(pg);
  sent = [];
  failWith = null;
  await pg.query(
    `update household_members set telegram_user_id = 55, telegram_chat_id = 55,
       persona_intensity = 'off' where id = $1`,
    [f.ownerId],
  );
  const res = await pg.query<{ id: string }>(
    `insert into tasks (household_id, title, due_at, assigned_to_member_id, created_at)
     values ($1, 'Levar o lixo', $2, $3, $4) returning id`,
    [f.householdId, at('2026-11-20 15:00').toISOString(), f.ownerId, at('2026-11-01 08:00')],
  );
  taskId = must(res.rows[0]).id;
});

const run = (local: string) => runReminders({ reminders, telegram, panelUrl: PANEL }, at(local));

describe('runReminders', () => {
  it('envia o lembrete com o texto da persona e o botão da tarefa, uma única vez', async () => {
    expect(await run('2026-11-20 15:00')).toEqual({ sent: 1, retry: 0, failed: 0 });
    expect(sent).toEqual([
      {
        chatId: 55,
        text: 'Lembrete: "Levar o lixo" vence hoje às 15:00.',
        button: { text: 'Abrir tarefa', url: `${PANEL}/tarefas/${taskId}` },
      },
    ]);
    expect(await run('2026-11-20 15:05')).toEqual({ sent: 0, retry: 0, failed: 0 });
  });

  it('falha temporária tenta de novo depois, com o mesmo texto', async () => {
    failWith = 429;
    expect(await run('2026-11-20 15:00')).toEqual({ sent: 0, retry: 1, failed: 0 });
    failWith = null;
    expect((await run('2026-11-20 15:01')).sent).toBe(0);
    expect(await run('2026-11-20 15:02')).toEqual({ sent: 1, retry: 0, failed: 0 });
    expect(sent[0]?.text).toBe('Lembrete: "Levar o lixo" vence hoje às 15:00.');
  });

  it('bot bloqueado (403) é falha definitiva', async () => {
    failWith = 403;
    expect(await run('2026-11-20 15:00')).toEqual({ sent: 0, retry: 0, failed: 1 });
    failWith = null;
    expect(await run('2026-11-20 15:30')).toEqual({ sent: 0, retry: 0, failed: 0 });
  });
});
