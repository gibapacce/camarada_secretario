import { createAssistant, createWorkersAiModel, type AiBinding } from '@camarada/assistant';
import {
  PostgrestDbClient,
  createAssistantStateStore,
  createMemberService,
  createPhotoService,
  createReminderService,
  createTaskService,
} from '@camarada/db';
import { handleApi, type ApiDeps } from './api.ts';
import { getTokenVerifier } from './auth.ts';
import { runDailyCleanup, runReminders } from './reminders.ts';
import { SupabaseStorage } from './storage.ts';
import { createTelegramClient, handleTelegramWebhook, type TelegramDeps } from './telegram.ts';

export interface Env {
  ASSETS: Fetcher;
  APP_ENV: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  PHOTO_MAX_BYTES?: string;
  /** Telegram (segredos via `wrangler secret put`). Sem eles o webhook responde 503. */
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  /** Nome público do bot (sem @), usado no link "t.me/<bot>?start=<código>". */
  TELEGRAM_BOT_USERNAME?: string;
  /** Endereço público do painel (https://...), enviado pelo bot no comando /painel. */
  PANEL_URL?: string;
  /** Workers AI (opcional): sem o binding, o assistente funciona só com regras. */
  AI?: AiBinding;
}

const BOT_USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

/** Sem SUPABASE_URL/SUPABASE_SECRET_KEY a API responde 503 (exceto /api/health). */
export function buildDeps(env: Env): ApiDeps | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    return null;
  }
  const db = new PostgrestDbClient({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SECRET_KEY });
  const maxPhotoBytes = Number(env.PHOTO_MAX_BYTES);
  const tasks = createTaskService(db);
  const members = createMemberService(db);
  return {
    tasks,
    members,
    photos: createPhotoService(db),
    storage: new SupabaseStorage({
      url: env.SUPABASE_URL,
      serviceKey: env.SUPABASE_SECRET_KEY,
      bucket: 'task-photos',
    }),
    assistant: createAssistant({
      tasks,
      members,
      state: createAssistantStateStore(db),
      model: env.AI ? createWorkersAiModel({ binding: env.AI }) : null,
    }),
    verifyToken: getTokenVerifier(env.SUPABASE_URL),
    ...(Number.isInteger(maxPhotoBytes) && maxPhotoBytes > 0 && { maxPhotoBytes }),
    ...(env.TELEGRAM_BOT_USERNAME &&
      BOT_USERNAME_RE.test(env.TELEGRAM_BOT_USERNAME) && {
        telegramBotUsername: env.TELEGRAM_BOT_USERNAME,
      }),
  };
}

export function buildTelegramDeps(env: Env, api: ApiDeps | null): TelegramDeps | null {
  if (!api || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
    return null;
  }
  return {
    members: api.members,
    assistant: api.assistant,
    telegram: createTelegramClient({ token: env.TELEGRAM_BOT_TOKEN }),
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    ...(env.PANEL_URL?.startsWith('https://') && { panelUrl: env.PANEL_URL }),
  };
}

/** Cron diário de limpeza (06:00 UTC = 03:00 em São Paulo); o outro Cron envia os lembretes. */
export const CLEANUP_CRON = '0 6 * * *';

/** Execução do Cron. Sem banco não faz nada; sem o token do bot só faz a limpeza. */
export async function runScheduled(cron: string, env: Env, now?: Date): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    console.warn('cron_not_configured');
    return;
  }
  const reminders = createReminderService(
    new PostgrestDbClient({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SECRET_KEY }),
  );
  if (cron === CLEANUP_CRON) {
    console.warn('cleanup', await runDailyCleanup(reminders));
    return;
  }
  if (!env.TELEGRAM_BOT_TOKEN) {
    return;
  }
  const result = await runReminders(
    {
      reminders,
      telegram: createTelegramClient({ token: env.TELEGRAM_BOT_TOKEN }),
      ...(env.PANEL_URL?.startsWith('https://') && { panelUrl: env.PANEL_URL }),
    },
    now,
  );
  if (result.sent + result.retry + result.failed > 0) {
    console.warn('reminders', result);
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return handleApi(request, buildDeps(env));
    }
    if (pathname === '/telegram/webhook') {
      return handleTelegramWebhook(request, buildTelegramDeps(env, buildDeps(env)));
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(controller.cron, env));
  },
} satisfies ExportedHandler<Env>;
