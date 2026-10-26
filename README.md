# Camarada Ho Chi Miau 🐱🚩

Assistente doméstico para duas pessoas: tarefas persistentes, fotos, responsáveis, prazos,
recorrências, lembretes e painel web, com a personalidade de um gato comunista e bem-humorado.

- Requisitos completos: [docs/plano_assistente_domestico_ia.md](docs/plano_assistente_domestico_ia.md)
- Decisões de arquitetura e limites dos planos gratuitos: [docs/architecture.md](docs/architecture.md)

**Princípio central:** o banco de dados é a fonte da verdade. A IA só interpreta mensagens; o
backend valida e executa. A persona é apenas camada de apresentação.

## Estado atual

| Fase                       | Situação     |
| -------------------------- | ------------ |
| 0 Viabilidade e decisões   | ✅ Concluída |
| 1 Esqueleto e documentação | ✅ Concluída |
| 2 Banco e regras           | ⏳ Próxima   |

Nenhum serviço em nuvem foi criado ainda. Tudo roda localmente.

## Estrutura

```text
apps/
  worker/     Cloudflare Worker: API, webhooks, cron; serve o painel como assets estáticos
  web/        Painel React + TypeScript (Vite)
packages/
  shared/     Utilitários e tipos compartilhados (fuso, normalização de texto)
  persona/    Camarada Ho Chi Miau: intensidades, catálogo de mensagens, Modo Aprendiz
docs/         Plano, arquitetura e guias
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

Copie [.env.example](.env.example) para `apps/worker/.dev.vars` e preencha apenas o necessário.
Esse arquivo é ignorado pelo Git. Nunca coloque segredos no código, no painel ou no chat.

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
