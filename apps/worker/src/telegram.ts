import type { Assistant } from '@camarada/assistant';
import type { MemberService } from '@camarada/db';

/** Porta para o provedor de mensagens: só o Telegram sabe como enviar. */
export interface TelegramPort {
  sendMessage(chatId: number, text: string, button?: { text: string; url: string }): Promise<void>;
}

export interface TelegramDeps {
  members: MemberService;
  assistant: Assistant;
  telegram: TelegramPort;
  webhookSecret: string;
  /** Endereço público do painel; sem ele o bot diz que o painel ainda não foi publicado. */
  panelUrl?: string;
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TEXT = 1000;
const TELEGRAM_LIMIT = 4096;

export class TelegramSendError extends Error {
  constructor(readonly status: number) {
    super(`telegram_send_failed_${status}`);
  }
}

export function createTelegramClient(options: {
  token: string;
  fetch?: typeof fetch;
}): TelegramPort {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  return {
    async sendMessage(chatId, text, button) {
      const body = {
        chat_id: chatId,
        text: text.slice(0, TELEGRAM_LIMIT),
        // Sem parse_mode: o texto das tarefas é de usuário e nunca é interpretado como formatação.
        link_preview_options: { is_disabled: true },
        ...(button && { reply_markup: { inline_keyboard: [[button]] } }),
      };
      let res: Response;
      try {
        res = await doFetch(`https://api.telegram.org/bot${options.token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch {
        // O erro original pode conter a URL com o token.
        throw new TelegramSendError(0);
      }
      if (!res.ok) {
        throw new TelegramSendError(res.status);
      }
    },
  };
}

interface IncomingMessage {
  updateId: number;
  messageId: number;
  chatId: number;
  userId: number;
  text: string | null;
}

/** Aceita só mensagens de pessoas em conversa privada; o resto é ignorado em silêncio. */
export function parseUpdate(body: unknown): IncomingMessage | null {
  const update = body as {
    update_id?: unknown;
    message?: {
      message_id?: unknown;
      text?: unknown;
      from?: { id?: unknown; is_bot?: unknown };
      chat?: { id?: unknown; type?: unknown };
    };
  } | null;
  const m = update?.message;
  if (
    typeof update?.update_id !== 'number' ||
    !m ||
    m.chat?.type !== 'private' ||
    typeof m.chat.id !== 'number' ||
    typeof m.message_id !== 'number' ||
    typeof m.from?.id !== 'number' ||
    m.from.is_bot === true
  ) {
    return null;
  }
  return {
    updateId: update.update_id,
    messageId: m.message_id,
    chatId: m.chat.id,
    userId: m.from.id,
    text: typeof m.text === 'string' ? m.text : null,
  };
}

function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

const ok = () => new Response('ok', { status: 200 });

const UNKNOWN_SENDER =
  'Ainda não sei quem você é. No painel, em Preferências, gere um código do Telegram e envie aqui: /start CÓDIGO';
const LINK_FAILED =
  'Esse código não vale (venceu, já foi usado ou está errado). Gere um novo no painel, em Preferências.';
const NON_TEXT = 'Por enquanto só entendo texto. Para anexar fotos, use o painel.';

/** Comandos do Telegram chegam como "/pendentes@meu_bot"; o assistente só conhece "/pendentes". */
function cleanCommand(text: string): string {
  return text
    .trim()
    .replace(/^(\/[A-Za-z0-9_]+)@\w+/, '$1')
    .slice(0, MAX_TEXT);
}

const LINK_START = /^\/start\s+([A-Za-z0-9_-]{6,40})$/;
const PANEL_RE = /^(?:\/painel|painel|abrir (?:o )?painel|link do painel)$/i;

export async function handleTelegramWebhook(
  request: Request,
  deps: TelegramDeps | null,
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!deps) {
    return new Response('not configured', { status: 503 });
  }
  const given = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!sameSecret(given, deps.webhookSecret)) {
    return new Response('unauthorized', { status: 401 });
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return new Response('payload too large', { status: 413 });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return new Response('payload too large', { status: 413 });
  }
  let incoming: IncomingMessage | null;
  try {
    incoming = parseUpdate(JSON.parse(raw));
  } catch {
    return new Response('bad request', { status: 400 });
  }
  if (!incoming) {
    return ok();
  }

  try {
    await respond(incoming, deps);
  } catch (error) {
    // Falha de envio ou do banco: 5xx faz o Telegram repetir; o assistente é idempotente por chave.
    console.error('telegram_error', error instanceof Error ? error.name : 'unknown');
    return new Response('error', { status: 502 });
  }
  return ok();
}

async function respond(incoming: IncomingMessage, deps: TelegramDeps): Promise<void> {
  const { chatId, userId } = incoming;
  const send = (text: string, button?: { text: string; url: string }) =>
    deps.telegram.sendMessage(chatId, text, button);

  if (incoming.text === null) {
    if (await deps.members.getContextByTelegram(userId)) await send(NON_TEXT);
    return;
  }
  const text = cleanCommand(incoming.text);
  if (!text) return;

  const member = await deps.members.getContextByTelegram(userId);
  if (!member) {
    const code = LINK_START.exec(text)?.[1];
    if (!code) {
      await send(UNKNOWN_SENDER);
      return;
    }
    const linked = await deps.members.linkTelegram({ code, telegramUserId: userId, chatId });
    if (!linked.ok) {
      await send(
        linked.error === 'telegram_already_linked'
          ? 'Este Telegram já está ligado a outra pessoa.'
          : LINK_FAILED,
      );
      return;
    }
    await send(
      `Pronto, ${linked.member.display_name}! Seu Telegram está vinculado. Envie "ajuda" para ver o que eu faço.`,
    );
    return;
  }

  if (PANEL_RE.test(text)) {
    if (deps.panelUrl) {
      await send('Aqui está o painel:', { text: 'Abrir painel', url: deps.panelUrl });
    } else {
      await send('O painel ainda não foi publicado. Por enquanto, converse comigo por aqui.');
    }
    return;
  }

  // "/start CODIGO" de quem já está vinculado vira o "/start" comum (ajuda).
  const message = LINK_START.test(text) ? '/start' : text;
  const r = await deps.assistant.handle({
    member,
    text: message,
    key: `telegram:${chatId}:${incoming.messageId}`,
  });
  if (r.intent === 'help' && deps.panelUrl) {
    await send(r.reply, { text: 'Abrir painel', url: deps.panelUrl });
  } else {
    await send(r.reply);
  }
}
