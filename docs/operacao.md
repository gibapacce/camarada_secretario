# Operação: publicação, backup e recuperação

Tudo aqui roda nos planos gratuitos (Cloudflare Workers, Supabase Free, Telegram). Reconfira
limites e preços antes de cada publicação ([architecture.md](architecture.md)).

## Ambientes

| Ambiente | Onde roda                                   | Dados                          |
| -------- | ------------------------------------------- | ------------------------------ |
| Local    | `npm run dev` (Worker em `wrangler dev`)    | Supabase real, via `.dev.vars` |
| Produção | Worker `camarada-ho-chi-miau` (workers.dev) | O mesmo projeto Supabase       |

Não há ambiente de homologação: o plano Free do Supabase permite 2 projetos, mas manter um segundo
banco só para testes não vale a manutenção para duas pessoas. Os testes automatizados rodam as
migrations num Postgres local (PGlite), então toda mudança de esquema é validada antes de ir ao
banco real.

## Segredos e variáveis

| Nome                                            | Onde fica                                                   |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY`           | Segredos do Worker (`npx wrangler secret put NOME`)         |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | Segredos do Worker                                          |
| `TELEGRAM_BOT_USERNAME`, `PANEL_URL`            | `vars` em `apps/worker/wrangler.jsonc` (não secretos)       |
| `VITE_SUPABASE_*`                               | `apps/web/.env.local`, embutidos no painel na hora do build |

Para enviar um segredo sem digitá-lo na tela, leia-o do `.dev.vars` e passe por pipe:
`$v | npx wrangler secret put NOME`. Nunca imprima o valor.

## Publicar

```powershell
npm run check                       # formato, lint, tipos, testes e build
supabase.exe db push --db-url <url> # só se houver migration nova (ou use o SQL Editor do Supabase)
npm run build                       # gera apps/web/dist com as chaves públicas
npm run deploy -w apps/worker       # envia o painel + Worker e marca APP_ENV=production
```

Aplique as migrations **antes** do deploy: o Worker novo pode depender de colunas e funções novas.

Verificação depois do deploy (troque pela sua URL):

```powershell
curl https://camarada-ho-chi-miau.SEU-SUBDOMINIO.workers.dev/api/health   # {"ok":true,...}
curl -i .../api/me                                                         # 401 sem login
curl -i -X POST .../telegram/webhook                                       # 401/403 sem o segredo
```

O HTTPS é da própria Cloudflare. Em uma conta nova, o certificado de `*.SEU-SUBDOMINIO.workers.dev`
pode levar alguns minutos para existir (erro de handshake TLS até lá).

No Supabase (Authentication → URL Configuration), coloque a URL do painel em **Site URL** para o
login funcionar em produção.

## Rollback

- **Worker/painel:** `npx wrangler deployments list` e `npx wrangler rollback <version-id>` (dentro
  de `apps/worker`). Painel e Worker vão juntos, então voltam juntos.
- **Migrations:** não há "desfazer" automático. Escreva uma migration nova que corrija. Antes de
  qualquer migration destrutiva, faça backup (abaixo).
- **Telegram:** `npm run telegram:webhook -- delete` desliga o bot sem apagar nada.

## Backup, exportação e recuperação

O Supabase Free **não faz backup automático**. Rode semanalmente:

```powershell
npm run backup            # tabelas em backups/<data>/*.json
npm run backup -- --photos  # inclui os arquivos das fotos
```

A pasta `backups/` é ignorada pelo Git. Copie-a para outro lugar seguro (disco externo ou nuvem
pessoal): ela contém dados da casa. O mesmo comando serve como exportação dos dados.

**Recuperar num projeto Supabase vazio:**

1. Aplique todas as migrations em ordem (`supabase/migrations/`).
2. Crie as pessoas de novo em Authentication e atualize `household_members.auth_user_id`.
3. No SQL Editor, carregue cada JSON, nesta ordem (por causa das chaves estrangeiras):
   `households`, `household_members`, `task_recurrence_rules`, `tasks`, `task_events`,
   `task_photos`. Exemplo:

   ```sql
   insert into public.tasks
   select * from jsonb_populate_recordset(null::public.tasks, '<conteúdo de tasks.json>'::jsonb);
   ```

4. Reenvie as fotos para o bucket `task-photos` com o mesmo caminho (`storage_path`).
5. Atualize `SUPABASE_URL` e `SUPABASE_SECRET_KEY` no Worker, refaça o build do painel com as novas
   chaves públicas e publique.

Teste a recuperação num projeto descartável pelo menos uma vez antes de precisar dela.

## Pausa do Supabase Free

O projeto pausa após 7 dias sem atividade. O Cron dos lembretes consulta o banco a cada 5 minutos,
o que mantém o projeto ativo sem ninguém abrir o painel. Se o Cron for desligado, abra o painel ou
rode `npm run backup` ao menos uma vez por semana.

## Lembretes (Cron)

- **Ver se está rodando:** Cloudflare → Workers & Pages → camarada-ho-chi-miau → Settings →
  Trigger Events (dois Crons) e a aba Logs (eventos `reminders` e `cleanup`). Localmente:
  `npx wrangler dev --test-scheduled` e acesse `/__scheduled?cron=*/5+*+*+*+*`.
- **Ver o que saiu:** no SQL Editor do Supabase,
  `select reminder_type, status, attempt_count, last_error, scheduled_for from reminder_deliveries order by created_at desc limit 20;`
- **Pausar os lembretes:** remova `TELEGRAM_BOT_TOKEN` do Worker ou o bloco `triggers` do
  `wrangler.jsonc` e publique. Nada se perde; lembretes perdidos durante a pausa são descartados.

## Cotas gratuitas: o que acompanhar

| Recurso               | Limite                                 | Onde ver                                              |
| --------------------- | -------------------------------------- | ----------------------------------------------------- |
| Workers (requisições) | 100 mil/dia                            | Cloudflare → Workers & Pages → camarada-ho-chi-miau   |
| CPU por requisição    | 10 ms                                  | Mesma tela (CPU time); `observability` já está ligada |
| Workers AI            | 10.000 neurons/dia                     | Cloudflare → AI → Workers AI                          |
| Supabase              | 500 MB banco, 1 GB fotos, 5 GB tráfego | Supabase → Settings → Usage                           |

Consumo esperado para duas pessoas fica muito abaixo desses limites. Se a IA esgotar a cota, o
assistente cai nas regras (sem erro para a pessoa).

## Checklist de segurança (conferido na publicação)

- API sem login responde 401; webhook sem o segredo é recusado.
- Cabeçalhos do painel: CSP restritiva, `X-Frame-Options: DENY`, `nosniff` (`apps/web/public/_headers`).
- Chave `sb_secret_` só no Worker; o painel recebe só a chave publicável.
- Cadastro público do Supabase desligado.
- Fotos em bucket privado, abertas só por URL temporária.
- Segredos fora do Git (`.dev.vars`, `.env*`, `backups/` ignorados).
