import type { PGlite } from '@electric-sql/pglite';
import { createAssistant } from '@camarada/assistant';
import {
  createAssistantStateStore,
  createMemberService,
  createTaskService,
  type MemberService,
  type TaskService,
} from '@camarada/db';
import { PgliteDbClient, createFixture, createTestDb, type Fixture } from '@camarada/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTelegramClient,
  handleTelegramWebhook,
  parseUpdate,
  type TelegramDeps,
  type TelegramPort,
} from './telegram.ts';

const SECRET = 'segredo-do-webhook';
const ANA_TG = 7_000_000_001;
const PANEL = 'https://camarada.example.dev';

let pg: PGlite;
let members: MemberService;
let tasks: TaskService;
let f: Fixture;
let sent: { chatId: number; text: string; button?: { text: string; url: string } }[];
let deps: TelegramDeps;
let nextUpdate = 1;

beforeAll(async () => {
  pg = await createTestDb();
  const db = new PgliteDbClient(pg);
  tasks = createTaskService(db);
  members = createMemberService(db);
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await pg.query('update household_members set telegram_user_id = null, telegram_chat_id = null');
  f = await createFixture(pg);
  sent = [];
  const telegram: TelegramPort = {
    async sendMessage(chatId, text, button) {
      sent.push({ chatId, text, ...(button && { button }) });
    },
  };
  deps = {
    members,
    assistant: createAssistant({ tasks, members, state: createAssistantStateStore(db()) }),
    telegram,
    webhookSecret: SECRET,
    panelUrl: PANEL,
  };
});

function db() {
  return new PgliteDbClient(pg);
}

async function linkAna() {
  const { code } = await members.createTelegramLinkCode({
    householdId: f.householdId,
    actorMemberId: f.ownerId,
  });
  await members.linkTelegram({ code, telegramUserId: ANA_TG, chatId: ANA_TG });
  await pg.query(`update household_members set guidance_mode = 'normal' where id = $1`, [
    f.ownerId,
  ]);
}

function update(
  text: string | null,
  o: { userId?: number; type?: string; messageId?: number; isBot?: boolean; photo?: boolean } = {},
) {
  const userId = o.userId ?? ANA_TG;
  return {
    update_id: nextUpdate++,
    message: {
      message_id: o.messageId ?? nextUpdate,
      from: { id: userId, is_bot: o.isBot ?? false },
      chat: { id: userId, type: o.type ?? 'private' },
      ...(text !== null && { text }),
      ...(o.photo && { photo: [{ file_id: 'x' }] }),
    },
  };
}

function post(body: unknown, headers: Record<string, string> = {}, d: TelegramDeps | null = deps) {
  return handleTelegramWebhook(
    new Request('http://localhost/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': SECRET, ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    d,
  );
}

describe('segurança do webhook', () => {
  it('recusa chamadas sem o segredo ou com segredo errado, sem processar nada', async () => {
    await linkAna();
    const body = update('tarefa: varrer');
    expect((await post(body, { 'x-telegram-bot-api-secret-token': 'errado' })).status).toBe(401);
    expect((await post(body, { 'x-telegram-bot-api-secret-token': '' })).status).toBe(401);
    expect(sent).toEqual([]);
    expect((await tasks.listTasks({ householdId: f.householdId })).tasks).toEqual([]);
  });

  it('503 sem configuração e 405 para método diferente de POST', async () => {
    expect((await post(update('oi'), {}, null)).status).toBe(503);
    const res = await handleTelegramWebhook(new Request('http://localhost/telegram/webhook'), deps);
    expect(res.status).toBe(405);
  });

  it('400 para corpo que não é JSON e 413 para corpo grande', async () => {
    expect((await post('{nao json')).status).toBe(400);
    expect((await post('x'.repeat(70_000))).status).toBe(413);
  });

  it('ignora grupos, bots, edições e mensagens sem remetente (200, sem resposta)', async () => {
    await linkAna();
    for (const body of [
      update('tarefa: a', { type: 'group' }),
      update('tarefa: a', { isBot: true }),
      { update_id: 99, edited_message: update('tarefa: a').message },
      { update_id: 100, message: { message_id: 1, chat: { id: 1, type: 'private' }, text: 'x' } },
      { sem: 'update_id' },
    ]) {
      expect((await post(body)).status).toBe(200);
    }
    expect(sent).toEqual([]);
  });
});

describe('quem pode falar com o bot', () => {
  it('desconhecido recebe orientação e nada é gravado', async () => {
    const res = await post(update('tarefa: invasão', { userId: 42 }));
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain('/start CÓDIGO');
    expect((await tasks.listTasks({ householdId: f.householdId })).tasks).toEqual([]);
  });

  it('vincula com o código gerado no painel e depois conversa', async () => {
    const { code } = await members.createTelegramLinkCode({
      householdId: f.householdId,
      actorMemberId: f.ownerId,
    });
    await post(update(`/start ${code}`));
    expect(sent[0]?.text).toContain('Pronto, Ana!');
    await pg.query(`update household_members set guidance_mode = 'normal' where id = $1`, [
      f.ownerId,
    ]);
    await post(update('tarefa: varrer a sala'));
    expect(sent[1]?.text).toContain('"Varrer a sala"');
    expect((await tasks.listTasks({ householdId: f.householdId })).tasks).toHaveLength(1);
  });

  it('código errado ou repetido é recusado com mensagem clara', async () => {
    await post(update('/start ABCDEF123456', { userId: 42 }));
    expect(sent[0]?.text).toContain('Esse código não vale');
    const { code } = await members.createTelegramLinkCode({
      householdId: f.householdId,
      actorMemberId: f.ownerId,
    });
    await post(update(`/start ${code}`, { userId: 43 }));
    await post(update(`/start ${code}`, { userId: 44 }));
    expect(sent[2]?.text).toContain('Esse código não vale');
    expect(await members.getContextByTelegram(44)).toBeNull();
  });

  it('pessoa desativada perde o acesso', async () => {
    await linkAna();
    await pg.query('update household_members set is_active = false where id = $1', [f.ownerId]);
    await post(update('tarefa: x'));
    expect(sent[0]?.text).toContain('Ainda não sei quem você é');
    expect((await tasks.listTasks({ householdId: f.householdId })).tasks).toEqual([]);
  });
});

describe('conversa', () => {
  beforeEach(linkAna);

  it('responde pelo chat da pessoa, com o estado real e sem alterar o texto do usuário', async () => {
    await post(update('tarefa: lavar <b>louça</b> & varrer'));
    expect(sent[0]).toMatchObject({ chatId: ANA_TG });
    expect(sent[0]?.text).toContain('"Lavar <b>louça</b> & varrer"');
  });

  it('a mesma mensagem repetida pelo Telegram não duplica a tarefa', async () => {
    const body = update('tarefa: varrer', { messageId: 555 });
    await post(body);
    await post(body);
    expect((await tasks.listTasks({ householdId: f.householdId })).tasks).toHaveLength(1);
    expect(sent[0]?.text).toBe(sent[1]?.text);
  });

  it('comandos com @bot funcionam', async () => {
    await post(update('tarefa: A'));
    await post(update('/pendentes@camarada_bot'));
    expect(sent[1]?.text).toContain('1) A');
  });

  it('/painel e "painel" mandam o link com botão; /start vira ajuda com botão', async () => {
    await post(update('/painel'));
    expect(sent[0]?.button).toEqual({ text: 'Abrir painel', url: PANEL });
    await post(update('/start'));
    expect(sent[1]?.text).toContain('Exemplos');
    expect(sent[1]?.button?.url).toBe(PANEL);
  });

  it('/start CODIGO de quem já está vinculado só mostra a ajuda', async () => {
    await post(update('/start ABCDEF123456'));
    expect(sent[0]?.text).toContain('Exemplos');
  });

  it('sem painel publicado, avisa em vez de inventar link', async () => {
    const semPainel: TelegramDeps = { ...deps };
    delete semPainel.panelUrl;
    await post(update('/painel'), {}, semPainel);
    expect(sent[0]?.text).toContain('ainda não foi publicado');
    expect(sent[0]?.button).toBeUndefined();
  });

  it('foto ou outro conteúdo sem texto: orienta a usar o painel', async () => {
    await post(update(null, { photo: true }));
    expect(sent[0]?.text).toContain('só entendo texto');
  });

  it('falha ao enviar devolve 502 para o Telegram repetir, sem vazar detalhes', async () => {
    const failing: TelegramDeps = {
      ...deps,
      telegram: {
        sendMessage: async () => {
          throw new Error('token 123:ABC na url');
        },
      },
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await post(update('ajuda'), {}, failing);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('123:ABC');
    expect(JSON.stringify(spy.mock.calls)).not.toContain('123:ABC');
    spy.mockRestore();
  });
});

describe('parseUpdate e cliente', () => {
  it('extrai só o necessário', () => {
    expect(parseUpdate(update('oi', { messageId: 9 }))).toMatchObject({
      messageId: 9,
      chatId: ANA_TG,
      userId: ANA_TG,
      text: 'oi',
    });
    expect(parseUpdate(null)).toBeNull();
  });

  it('envia texto puro (sem parse_mode), com botão opcional, e esconde o token nos erros', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    const client = createTelegramClient({ token: '123:SECRET', fetch: fetchMock as never });
    await client.sendMessage(5, 'olá', { text: 'Abrir', url: PANEL });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('https://api.telegram.org/bot123:SECRET/sendMessage');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toMatchObject({ chat_id: 5, text: 'olá' });
    expect(body).not.toHaveProperty('parse_mode');
    expect(body.reply_markup).toEqual({ inline_keyboard: [[{ text: 'Abrir', url: PANEL }]] });

    const broken = createTelegramClient({
      token: '123:SECRET',
      fetch: (async () => {
        throw new Error('falha em https://api.telegram.org/bot123:SECRET/sendMessage');
      }) as never,
    });
    await expect(broken.sendMessage(1, 'x')).rejects.toSatisfy(
      (e: Error) => !e.message.includes('SECRET'),
    );
    const refused = createTelegramClient({
      token: '123:SECRET',
      fetch: (async () => new Response('{}', { status: 403 })) as never,
    });
    await expect(refused.sendMessage(1, 'x')).rejects.toMatchObject({ status: 403 });
  });

  it('corta mensagens maiores que o limite do Telegram', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    await createTelegramClient({ token: 't', fetch: fetchMock as never }).sendMessage(
      1,
      'a'.repeat(5000),
    );
    const init = (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1];
    expect((JSON.parse(init.body) as { text: string }).text).toHaveLength(4096);
  });
});
