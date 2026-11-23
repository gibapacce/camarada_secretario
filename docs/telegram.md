# Telegram: configuração do bot

O bot conversa só em **chat privado** com pessoas vinculadas a um membro da casa. O painel segue
disponível como acesso visual: o comando `/painel` manda o link.

## Como funciona

```text
Telegram ──POST /telegram/webhook (cabeçalho com o segredo)──> Worker
  1. confere o segredo (constante no tempo) e o tamanho do corpo
  2. ignora o que não é mensagem em chat privado (grupos, bots, edições)
  3. descobre a pessoa pelo id do Telegram (`household_members.telegram_user_id`)
  4. desconhecido: só aceita "/start CÓDIGO"; qualquer outra coisa recebe orientação
  5. conhecido: o assistente responde, com a chave `telegram:<chat>:<mensagem>`
```

- **Idempotência:** a chave por mensagem vem do assistente. Se o Telegram repetir o envio, a
  tarefa não duplica e a resposta é a mesma. Falha ao enviar a resposta devolve 502 para o
  Telegram tentar de novo.
- **Segurança:** o token nunca vai em log (erros de envio perdem a URL), o texto é enviado sem
  formatação (nenhum `parse_mode`), e quem não estiver vinculado não grava nada. Desativar a pessoa
  em `household_members.is_active` corta o acesso na hora.
- **Vinculação:** no painel, em Preferências, "Gerar código". O código tem 12 caracteres, vale
  15 minutos, serve uma vez e só o hash fica no banco. A pessoa envia `/start CÓDIGO` ao bot (ou
  toca no link `t.me/<bot>?start=<código>`).
- **Fotos:** por enquanto o bot só entende texto; para fotos ele orienta a usar o painel.

## Passo a passo

1. **Criar o bot:** no Telegram, converse com `@BotFather`, envie `/newbot` e siga as perguntas.
   Guarde o token e o nome de usuário do bot (termina em `bot`). O token é um segredo: não envie em
   chat, issue ou commit.
2. **Segredos locais:** copie o modelo de [.env.example](../.env.example) para
   `apps/worker/.dev.vars` e preencha `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (invente um
   texto aleatório de 16 a 256 caracteres, só letras, números, `_` e `-`), `TELEGRAM_BOT_USERNAME`
   (sem `@`) e, depois da publicação, `PANEL_URL` (https).
3. **Publicar o Worker** (Fase 9). Em produção, use `npx wrangler secret put TELEGRAM_BOT_TOKEN` e
   o mesmo para `TELEGRAM_WEBHOOK_SECRET`.
4. **Registrar o webhook e os comandos do bot:**

   ```powershell
   npm run telegram:webhook -- set https://SEU-WORKER.workers.dev/telegram/webhook
   npm run telegram:webhook -- info
   ```

   O script lê os segredos de `apps/worker/.dev.vars` ou do ambiente e nunca os imprime.

5. **Vincular cada pessoa:** painel → Preferências → Telegram → "Gerar código" → enviar ao bot.

`npm run telegram:webhook -- delete` remove o webhook.

## Testar sem publicar

O webhook exige HTTPS público para o Telegram chamar. Sem publicar, os testes automatizados
(`apps/worker/src/telegram.test.ts`) cobrem o fluxo inteiro com um Telegram simulado. Para um teste
manual com o Worker local (`npm run dev`), envie uma atualização falsa:

```powershell
$h = @{ 'x-telegram-bot-api-secret-token' = $env:TELEGRAM_WEBHOOK_SECRET }
$body = '{"update_id":1,"message":{"message_id":1,"from":{"id":1,"is_bot":false},"chat":{"id":1,"type":"private"},"text":"ajuda"}}'
Invoke-WebRequest http://localhost:8787/telegram/webhook -Method Post -Headers $h -ContentType 'application/json' -Body $body
```

Sem vinculação, o Worker tentará responder ao Telegram de verdade e o envio falha (502).

## Limites conhecidos

- Só chat privado (grupos ficam para depois; com o modo de privacidade o bot só veria comandos).
- Sem fotos, sem áudio.
- Lembretes: no prazo, de atraso e 24 h antes, configuráveis por pessoa no painel (veja
  "Lembretes (Fase 8)" em [architecture.md](architecture.md)). Exigem `telegram_chat_id`, gravado
  na vinculação.
- Mensagens repetidas pelo Telegram após uma falha podem gerar a mesma resposta duas vezes; os
  dados nunca duplicam.
