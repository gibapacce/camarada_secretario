# Camarada Ho Chi Miau 🐱🚩

Assistente doméstico para duas pessoas. Guarda tarefas com responsável, prazo, recorrência e fotos,
manda lembretes pelo Telegram e tem um painel web. Tudo com a personalidade de um gato comunista
bem-humorado, que pode ser desligada a qualquer momento.

- **Painel:** <https://camarada-ho-chi-miau.gibapacce.workers.dev>
- **Bot:** [@camarada_ho_chi_miau_bot](https://t.me/camarada_ho_chi_miau_bot) (só para pessoas
  vinculadas)
- **Custo:** R$ 0 por mês, só com planos gratuitos (Cloudflare, Supabase, Telegram)

> **Princípio central:** o banco de dados é a fonte da verdade. A IA só interpreta o que a pessoa
> escreveu; o backend valida e executa. A persona muda apenas o texto, nunca os dados.

## Sumário

- [O que ele faz](#o-que-ele-faz)
- [Como usar](#como-usar)
- [Arquitetura](#arquitetura)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Desenvolvimento local](#desenvolvimento-local)
- [Fluxo de trabalho (branches)](#fluxo-de-trabalho-branches)
- [Testes e qualidade](#testes-e-qualidade)
- [Banco de dados e migrations](#banco-de-dados-e-migrations)
- [Publicação e operação](#publicação-e-operação)
- [Segurança](#segurança)
- [Custos e limites gratuitos](#custos-e-limites-gratuitos)
- [Estado do projeto](#estado-do-projeto)
- [Documentação](#documentação)

## O que ele faz

| Recurso                   | Detalhes                                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tarefas**               | Título, descrição, responsável (uma pessoa ou as duas), prazo, prioridade, esforço, cômodo e categoria. Sem prazo, a tarefa fica sem prazo (nada é inventado). |
| **Linguagem natural**     | "Nova tarefa: lavar a louça amanhã às 20h", "o que está atrasado?", "feito 2". Regras em português primeiro; IA (Workers AI) só como apoio opcional.           |
| **Recorrência**           | Diária, semanal ou mensal. Concluir ou cancelar gera a próxima ocorrência, sem duplicar e sem perder o histórico.                                              |
| **Desfazer**              | Volta a última ação da pessoa em até 15 minutos, sem apagar o histórico.                                                                                       |
| **Fotos**                 | Pelo painel. Bucket privado, tipo real conferido, redução para 1600 px (remove GPS), abertas só por URL temporária.                                            |
| **Lembretes no Telegram** | No prazo, de atraso (1 por dia, por até 30 dias) e 24 h antes (opcional). Silêncio das 21h às 9h. Cada pessoa escolhe os seus no painel.                       |
| **Painel web**            | Resumo, lista com filtros, calendário semanal/mensal, detalhes com histórico, conversa com o assistente, primeiros passos e preferências.                      |
| **Persona**               | Três níveis por pessoa: completo, leve e sério. Assuntos sensíveis (saúde, luto, dívidas) ficam neutros em qualquer nível.                                     |
| **Modo Aprendiz**         | Dicas que aparecem uma vez e uma Missão de Treino de 5 passos, com tarefas de treino que somem sozinhas.                                                       |
| **Idempotência**          | Mensagem repetida, clique duplo ou reenvio do Telegram nunca cria nem conclui nada duas vezes.                                                                 |

## Como usar

### Primeiro acesso

1. Entre no painel com o e-mail e a senha cadastrados no Supabase (não há cadastro público).
2. Em **Preferências → Telegram**, clique em **Gerar código** e envie `/start CÓDIGO` ao bot.
3. Ainda em Preferências, escolha a personalidade e os lembretes que quer receber.

### Frases que o bot entende

| Para…             | Exemplos                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Criar             | `nova tarefa: lavar a louça amanhã às 20h` · `anota: comprar ração pra Deise` · `tarefa: trocar o filtro, pros dois, urgente` |
| Consultar         | `pendentes` · `o que está atrasado?` · `o que vence esta semana?` · `quais tarefas estão comigo?` · `resumo`                  |
| Concluir/corrigir | `feito 2` · `concluí a louça` · `reabrir 2` · `cancelar 3` · `adiar louça para sexta` · `desfazer`                            |
| Ajuda             | `ajuda` · `ajuda criar` · `ajuda lembretes` · `treino` · `/painel`                                                            |
| Personalidade     | `modo sério` · `modo leve` · `modo camarada`                                                                                  |

O número em `feito 2` é a posição na última lista mostrada. Quando há tarefas parecidas, o bot
pergunta qual é, em vez de adivinhar. Mais exemplos em [docs/onboarding.md](docs/onboarding.md).

### Lembretes

| Tipo       | Quando sai                                              | Padrão    |
| ---------- | ------------------------------------------------------- | --------- |
| No prazo   | Na hora do prazo; tarefa só com data avisa às 9h do dia | Ligado    |
| Atraso     | Uma vez por dia, às 9h, por até 30 dias                 | Ligado    |
| 24 h antes | Um dia antes do prazo                                   | Desligado |

Nada sai entre 21h e 9h. Tarefa sem responsável lembra as duas pessoas. Concluir, cancelar ou
mudar o prazo cancela o lembrete pendente.

## Arquitetura

```text
             ┌──────────── Cloudflare Worker (camarada-ho-chi-miau) ────────────┐
Navegador ──>│ /             painel React (assets estáticos)                     │
             │ /api/*        API autenticada (JWT do Supabase Auth via JWKS)     │──RPC──> Supabase Postgres
Telegram ───>│ /telegram/*   webhook com segredo no cabeçalho                    │        (funções SQL
             │ Cron 5 min    lembretes: reserva → texto da persona → Telegram    │         transacionais)
             │ Cron diário   limpeza (histórico de lembretes, treinos)           │──────> Supabase Storage
             └───────────────────────────────────────────────────────────────────┘        (fotos, privado)
                          │ opcional
                          └──> Workers AI (interpretação de frases fora das regras)
```

- **Regras de negócio no banco:** toda alteração passa por funções SQL transacionais
  (`create_task`, `complete_task`, `claim_reminders`...), chamadas só pelo Worker com a chave
  secreta. RLS ligado e sem políticas: clientes não acessam tabelas diretamente.
- **Isolamento por casa:** toda função recebe a casa; chaves estrangeiras compostas impedem
  misturar dados de casas diferentes.
- **Sem IA no caminho crítico:** lembretes, confirmações, ajuda e persona são textos fixos. Se a
  cota de IA acabar, tudo continua funcionando só com as regras.
- **Datas:** gravadas em UTC e exibidas no fuso da casa (`America/Sao_Paulo`). Atraso é calculado,
  nunca gravado.

Decisões e detalhes de cada fase em [docs/architecture.md](docs/architecture.md).

## Estrutura do repositório

```text
apps/
  worker/       Cloudflare Worker: API, webhook do Telegram, Crons; serve o painel
    src/          api.ts, auth.ts, telegram.ts, reminders.ts, storage.ts, index.ts
    wrangler.jsonc  Configuração: assets, variáveis públicas, Workers AI e Crons
  web/          Painel React + TypeScript (Vite)
    src/pages/    Resumo, Tarefas, Calendário, Conversa, Primeiros passos, Preferências
    public/_headers  CSP e cabeçalhos de segurança
packages/
  shared/       Fuso horário e normalização de texto
  persona/      Rótulos do painel, mensagens de ação e textos dos lembretes
  assistant/    Conversa: regras em português, IA opcional, Missão de Treino e dicas
  db/           Cliente PostgREST, validação (zod) e serviços (tarefas, membros, fotos, lembretes)
supabase/
  migrations/   Esquema e funções SQL, em ordem (fonte da verdade)
  seed.sql      Dados fictícios para desenvolvimento
scripts/
  telegram-webhook.mjs  Registra, consulta ou remove o webhook e os comandos do bot
  backup.mjs            Exporta os dados (e fotos) para backups/
docs/           Plano, arquitetura, persona, guia de uso, Telegram e operação
.github/        CI e instruções para assistentes de código
```

## Desenvolvimento local

### Requisitos

- Node.js 22 ou superior (testado com 22 e 24) e npm.
- Para usar dados reais: acesso ao projeto Supabase. Os testes não precisam de nenhuma conta.

### Instalação e execução

```powershell
npm install
npx wrangler telemetry disable   # opcional
npm run dev                      # gera o painel e sobe o Worker em http://localhost:8787
```

- `http://localhost:8787/api/health` → `{"ok":true,"service":"camarada-ho-chi-miau",...}`
- `http://localhost:8787/` → painel

Só o painel, com recarga automática: `npm run dev -w apps/web` (porta 5173, com `/api`
redirecionado para o Worker na 8787).

### Segredos e variáveis

Copie [.env.example](.env.example) para `apps/worker/.dev.vars` (Worker) e `apps/web/.env.local`
(painel). Os dois são ignorados pelo Git.

| Variável                                             | Onde                                         | Secreta? |
| ---------------------------------------------------- | -------------------------------------------- | -------- |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY`                | `.dev.vars` / `wrangler secret put`          | Sim      |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`      | `.dev.vars` / `wrangler secret put`          | Sim      |
| `TELEGRAM_BOT_USERNAME`, `PANEL_URL`                 | `vars` em `apps/worker/wrangler.jsonc`       | Não      |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | `apps/web/.env.local` (vão para o navegador) | Não      |

Nunca coloque segredos no código, no painel, em issues ou no chat. O painel só recebe a chave
publicável (`sb_publishable_`).

### Testar o Cron localmente

```powershell
cd apps/worker
npx wrangler dev --test-scheduled
# em outro terminal:
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

### Comandos

| Comando                            | O que faz                                                 |
| ---------------------------------- | --------------------------------------------------------- |
| `npm run check`                    | Tudo o que o CI roda, na mesma ordem                      |
| `npm test`                         | Testes (Vitest) de todos os workspaces                    |
| `npm run typecheck`                | TypeScript estrito (gera os tipos do Worker)              |
| `npm run lint`                     | ESLint                                                    |
| `npm run format`                   | Prettier (corrige); `format:check` só verifica            |
| `npm run build`                    | Gera o painel em `apps/web/dist`                          |
| `npm run dev`                      | Painel + Worker local                                     |
| `npm run deploy -w apps/worker`    | Publica Worker + painel (`APP_ENV=production`)            |
| `npm run telegram:webhook -- info` | Estado do webhook (também `set <url>` e `delete`)         |
| `npm run backup`                   | Exporta os dados do Supabase (`-- --photos` inclui fotos) |

### Scripts de instalação

O npm 12 bloqueia scripts de instalação por padrão. Só `esbuild` e `workerd` (do Wrangler) estão
liberados, fixados por versão em `allowScripts` no `package.json`. Ao atualizar o Wrangler, revise
com `npm install-scripts ls` antes de aprovar.

## Fluxo de trabalho (branches)

**Toda mudança (funcionalidade, melhoria, correção, documentação ou manutenção) é feita em uma
branch separada.** O `main` só recebe código por merge de uma branch com o CI verde, e representa
sempre o que está (ou pode ir) em produção.

| Tipo de mudança         | Prefixo  | Exemplo                        |
| ----------------------- | -------- | ------------------------------ |
| Funcionalidade/melhoria | `feat/`  | `feat/resumo-semanal-telegram` |
| Correção de bug         | `fix/`   | `fix/lembrete-duplicado`       |
| Documentação            | `docs/`  | `docs/readme-detalhado`        |
| Manutenção/ferramentas  | `chore/` | `chore/atualizar-wrangler`     |

Passo a passo:

```powershell
git switch main
git pull
git switch -c feat/minha-feature     # uma branch por feature ou bug

# ... código, testes e documentação ...
npm run check                        # precisa passar antes de subir

git push -u origin feat/minha-feature
# abra um Pull Request para main no GitHub; o CI roda automaticamente
```

Depois do merge:

```powershell
git switch main
git pull
git branch -d feat/minha-feature
```

Regras:

- Uma branch por assunto. Mudanças sem relação vão em branches diferentes.
- Commits no formato `tipo(escopo): descrição` (ex.: `fix(lembretes): nao repetir atraso`).
- Se a mudança tiver migration, aplique no Supabase **antes** de publicar o Worker.
- Publique em produção só a partir do `main`, depois do merge.
- Ideias e bugs ainda não priorizados ficam no `BACKLOG.MD` (local) ou em issues do GitHub.

## Testes e qualidade

- **Vitest** em todos os pacotes. Os testes de banco rodam as migrations reais num Postgres em
  memória (PGlite), sem Docker e sem conta em nuvem.
- **Cobertura principal:** regras de tarefas, recorrência, desfazer, isolamento por casa,
  idempotência, fotos, vinculação do Telegram, webhook, lembretes (horários, silêncio,
  cancelamento, retry, concorrência) e o painel (jsdom).
- **CI** ([.github/workflows/ci.yml](.github/workflows/ci.yml)): em todo push no `main` e em todo
  Pull Request, roda formatação, lint, tipos, testes e build.

No Windows, a suíte completa às vezes falha ao iniciar os testes do painel por tempo. Se acontecer,
rode `npx vitest run` dentro de `apps/web` separadamente.

## Banco de dados e migrations

- Migrations em [supabase/migrations](supabase/migrations), aplicadas em ordem de nome.
- Toda mudança de esquema é uma **migration nova**; nunca edite uma já aplicada em produção.
- **Aplicar no Supabase real:** cole o arquivo no SQL Editor do painel do Supabase e execute, ou
  use `supabase.exe db push --db-url <url>`. Não use `npx supabase ...` com a senha na URL: o npm
  repete o comando na tela e no log.
- Migrations que recriam funções podem mostrar o aviso "destructive operations"; leia o SQL antes
  de confirmar.
- O Supabase recusa a chave secreta quando o User-Agent parece de navegador (ex.:
  `Invoke-WebRequest` do PowerShell 5.1). Use `curl.exe -A "camarada-ops/1.0"` ou Node.

## Publicação e operação

```powershell
npm run check
# migrations novas → Supabase (SQL Editor) primeiro
npm run build
npm run deploy -w apps/worker
```

- **Rollback:** `npx wrangler deployments list` e `npx wrangler rollback <version-id>` em
  `apps/worker`.
- **Backup:** o Supabase Free não faz backup. Rode `npm run backup` toda semana e guarde a pasta
  `backups/` fora do computador.
- **Logs:** Cloudflare → Workers & Pages → camarada-ho-chi-miau → Logs (eventos `reminders`,
  `cleanup`, `telegram_error`, `api_error`).

Guia completo (recuperação, pausa do Supabase, cotas, checklist): [docs/operacao.md](docs/operacao.md).
Bot do Telegram: [docs/telegram.md](docs/telegram.md).

## Segurança

- Login só por e-mail e senha do Supabase Auth, com cadastro público desligado. A API confere
  assinatura, emissor, audiência e expiração do token; a casa e a pessoa vêm do banco, nunca do
  navegador.
- Webhook do Telegram protegido por segredo no cabeçalho (comparação em tempo constante). Só chats
  privados de pessoas vinculadas chegam ao assistente.
- Vinculação por código de uso único (15 minutos), guardado só como hash.
- Chave secreta do Supabase e token do bot só no Worker; nunca aparecem em logs.
- Textos de usuário enviados ao Telegram sem formatação (sem `parse_mode`).
- Painel com CSP restritiva, `X-Frame-Options: DENY` e `nosniff`.

## Custos e limites gratuitos

| Serviço            | Limite gratuito                                       | Uso esperado (2 pessoas)                |
| ------------------ | ----------------------------------------------------- | --------------------------------------- |
| Cloudflare Workers | 100 mil requisições/dia, 10 ms de CPU por execução    | ~290 execuções de Cron/dia + uso normal |
| Cron Triggers      | 5 por conta                                           | 2                                       |
| Workers AI         | 10.000 neurons/dia                                    | Baixo; sem cota, cai nas regras         |
| Supabase           | 500 MB banco, 1 GB arquivos, pausa após 7 dias parado | Bem abaixo; o Cron evita a pausa        |
| Telegram Bot API   | Gratuito                                              | —                                       |

Nenhum recurso pago, faturamento ou publicação nova é feito sem aprovação explícita. Detalhes e
riscos em [docs/architecture.md](docs/architecture.md).

## Estado do projeto

Todas as fases do plano estão concluídas e em produção:

| Fase                       | Situação |
| -------------------------- | -------- |
| 0 Viabilidade e decisões   | ✅       |
| 1 Esqueleto e documentação | ✅       |
| 2 Banco e regras           | ✅       |
| 3 Painel web               | ✅       |
| 4 Fotos                    | ✅       |
| 5 Assistente (IA)          | ✅       |
| 6 Persona e Modo Aprendiz  | ✅       |
| 7 Telegram                 | ✅       |
| 8 Agendador e lembretes    | ✅       |
| 9 Publicação e operação    | ✅       |

Próximos passos possíveis: resumos diário e semanal pelo Telegram, ajuste do horário de silêncio
pelo painel, fotos pelo Telegram e varredura de fotos órfãs.

## Documentação

| Documento                                                                 | Conteúdo                                                   |
| ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [plano_assistente_domestico_ia.md](docs/plano_assistente_domestico_ia.md) | Requisitos completos e fases                               |
| [architecture.md](docs/architecture.md)                                   | Decisões, modelo de dados, API, fotos, Telegram, lembretes |
| [operacao.md](docs/operacao.md)                                           | Publicação, rollback, backup, recuperação e cotas          |
| [telegram.md](docs/telegram.md)                                           | Configuração do bot e do webhook                           |
| [persona.md](docs/persona.md)                                             | Tom, intensidades e onde ficam os textos                   |
| [onboarding.md](docs/onboarding.md)                                       | Guia de uso, Modo Aprendiz e Missão de Treino              |
