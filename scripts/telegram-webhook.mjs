// Configura o webhook do bot do Telegram. Uso:
//   node scripts/telegram-webhook.mjs set https://SEU-WORKER/telegram/webhook
//   node scripts/telegram-webhook.mjs info
//   node scripts/telegram-webhook.mjs delete
// Lê TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET do ambiente ou de apps/worker/.dev.vars.
// Nunca imprime o token nem o segredo.
/* eslint-disable no-console */
import { readFileSync } from 'node:fs';

function loadVars() {
  const vars = {};
  try {
    const file = new URL('../apps/worker/.dev.vars', import.meta.url);
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // Sem .dev.vars: usa só o ambiente.
  }
  return { ...vars, ...process.env };
}

const COMMANDS = [
  { command: 'ajuda', description: 'Ver exemplos do que eu entendo' },
  { command: 'pendentes', description: 'O que falta fazer' },
  { command: 'resumo', description: 'Resumo da semana' },
  { command: 'desfazer', description: 'Desfazer a última ação' },
  { command: 'treino', description: 'Missão de Treino (2 minutos)' },
  { command: 'painel', description: 'Abrir o painel visual' },
];

const [action, url] = process.argv.slice(2);
const vars = loadVars();
const token = vars.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('Defina TELEGRAM_BOT_TOKEN (ambiente ou apps/worker/.dev.vars).');
  process.exit(1);
}

async function api(method, body) {
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new Error('Sem conexão com o Telegram.');
  }
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description ?? `Erro ${res.status} do Telegram.`);
  return data.result;
}

try {
  if (action === 'set') {
    const secret = vars.TELEGRAM_WEBHOOK_SECRET;
    if (!url?.startsWith('https://') || !url.endsWith('/telegram/webhook')) {
      throw new Error('Informe a URL https terminada em /telegram/webhook.');
    }
    if (!secret || !/^[A-Za-z0-9_-]{16,256}$/.test(secret)) {
      throw new Error(
        'TELEGRAM_WEBHOOK_SECRET precisa ter de 16 a 256 caracteres (letras, números, _ ou -).',
      );
    }
    await api('setWebhook', { url, secret_token: secret, allowed_updates: ['message'] });
    await api('setMyCommands', { commands: COMMANDS });
    console.log(`Webhook configurado em ${url} e comandos do bot atualizados.`);
  } else if (action === 'info') {
    const info = await api('getWebhookInfo');
    console.log({
      url: info.url || '(nenhum)',
      pendentes: info.pending_update_count,
      ultimo_erro: info.last_error_message ?? '(nenhum)',
    });
  } else if (action === 'delete') {
    await api('deleteWebhook');
    console.log('Webhook removido.');
  } else {
    throw new Error('Use: set <url> | info | delete');
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
