# Camarada Ho Chi Miau 🐱🚩

Assistente doméstico para duas pessoas: tarefas persistentes, fotos, responsáveis, prazos,
recorrências, lembretes e painel web, com a personalidade de um gato comunista e bem-humorado.

- Requisitos completos: [docs/plano_assistente_domestico_ia.md](docs/plano_assistente_domestico_ia.md)
- Decisões de arquitetura e limites dos planos gratuitos: [docs/architecture.md](docs/architecture.md)
- Persona e guia de uso: [docs/persona.md](docs/persona.md), [docs/onboarding.md](docs/onboarding.md)
- Bot do Telegram: [docs/telegram.md](docs/telegram.md)

**Princípio central:** o banco de dados é a fonte da verdade. A IA só interpreta mensagens; o
backend valida e executa. A persona é apenas camada de apresentação.

## Estado atual

| Fase                       | Situação                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Viabilidade e decisões   | ✅ Concluída                                                                                                                                |
| 1 Esqueleto e documentação | ✅ Concluída                                                                                                                                |
| 2 Banco e regras           | ✅ Concluída (local, PGlite)                                                                                                                |
| 3 Painel web               | ✅ Concluída localmente (publicação na Fase 9)                                                                                              |
| 4 Fotos                    | ✅ Concluída localmente (bucket privado no Supabase real)                                                                                   |
| 5 Assistente (IA)          | ✅ Concluída localmente (regras primeiro, Workers AI opcional)                                                                              |
| 6 Persona e Modo Aprendiz  | ✅ Concluída localmente, exceto variantes de mensagem e modelos de lembrete (vão com a Fase 8)                                              |
| 7 Telegram                 | 🟡 Código e testes prontos (texto, vinculação, `/painel`); falta criar o bot e publicar o Worker. Veja [docs/telegram.md](docs/telegram.md) |

O projeto Supabase (plano Free, São Paulo) existe, sem o seed. As migrations das fases 2 a 4 foram
aplicadas; **confira se as mais recentes** (`20261026190000_assistant_state.sql`,
`20261112100000_training.sql` e `20261112110000_telegram.sql`) também foram. Cadastro público
desligado, chave de assinatura ES256. O Worker ainda roda só localmente (`wrangler dev`).
Para aplicar migrations novas, rode o executável do Supabase CLI diretamente
(`supabase.exe db push --db-url <url>`). Não use `npx supabase ...` com a senha na URL: o npm 12
repete o comando na tela e no log.

## Estrutura

```text
apps/
  worker/     Cloudflare Worker: API, webhooks, cron; serve o painel como assets estáticos
  web/        Painel React + TypeScript (Vite)
packages/
  shared/     Utilitários e tipos compartilhados (fuso, normalização de texto)
  persona/    Camarada Ho Chi Miau: intensidades, rótulos do painel e mensagens de ação
  assistant/  Conversa: regras em português, IA opcional, Missão de Treino e dicas
  db/         Cliente do banco (Supabase/PostgREST), validação (zod) e serviço de tarefas
supabase/
  migrations/ Esquema e funções SQL transacionais (fonte da verdade)
  seed.sql    Dados fictícios para desenvolvimento
docs/         Plano, arquitetura, persona, guia de uso (onboarding) e Telegram
scripts/      Utilitários de operação (webhook do Telegram)
.github/      CI (formato, lint, tipos, testes, build)
```

## Requisitos

- Node.js 22 ou superior (testado com Node 24) e npm.
- Nenhuma conta em nuvem é necessária para desenvolver nesta fase.

## Primeiros passos

```powershell
npm install
npx wrangler telemetry disable   # opcional: desliga a telemetria anônima do Wrangler
npm run dev                      # gera o painel e sobe o Worker em http://localhost:8787
```

Verificação rápida com o servidor rodando:

- `http://localhost:8787/api/health` → `{"ok":true,"service":"camarada-ho-chi-miau",...}`
- `http://localhost:8787/` → painel

Para desenvolver só o painel com recarga automática: `npm run dev -w apps/web`
(em `http://localhost:5173`, com `/api` redirecionado para o Worker na porta 8787).

### Segredos locais

Copie [.env.example](.env.example) para `apps/worker/.dev.vars` (Worker) e `apps/web/.env.local`
(painel) e preencha apenas o necessário. Os dois arquivos são ignorados pelo Git. Nunca coloque
segredos no código, no painel ou no chat. O painel só recebe a chave publicável (`sb_publishable_`).

### Scripts de instalação

O npm 12 bloqueia scripts de instalação por padrão. Só `esbuild` e `workerd` (usados pelo
Wrangler) estão liberados, fixados por versão em `allowScripts` no `package.json`. Ao atualizar o
Wrangler, revise com `npm install-scripts ls` antes de aprovar.

## Comandos

| Comando             | O que faz                                      |
| ------------------- | ---------------------------------------------- |
| `npm run check`     | Tudo o que o CI roda, na mesma ordem           |
| `npm test`          | Testes (Vitest) de todos os workspaces         |
| `npm run typecheck` | TypeScript estrito (gera os tipos do Worker)   |
| `npm run lint`      | ESLint                                         |
| `npm run format`    | Prettier (corrige); `format:check` só verifica |
| `npm run build`     | Gera o painel em `apps/web/dist`               |
| `npm run dev`       | Painel + Worker local (workerd, sem login)     |

## Custos

Meta: R$ 0 por mês usando planos gratuitos sem cartão (Cloudflare Workers, Supabase, Telegram,
Workers AI). Nenhum recurso pago, faturamento ou publicação é feito sem aprovação explícita.
Detalhes e riscos em [docs/architecture.md](docs/architecture.md).
