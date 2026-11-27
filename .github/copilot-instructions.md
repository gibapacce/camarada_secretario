# Instruções para assistentes de código

Projeto: Camarada Ho Chi Miau (monorepo npm: Cloudflare Worker, painel React, Supabase). Visão
geral e comandos no [README.md](../README.md).

## Branches (obrigatório)

- **Nunca faça commit direto no `main`.** Toda mudança (funcionalidade, melhoria, correção,
  documentação ou manutenção) começa em uma branch própria, criada a partir do `main` atualizado:
  - `feat/<descricao-curta>` para funcionalidade nova ou melhoria
  - `fix/<descricao-curta>` para correção de bug
  - `docs/<descricao-curta>` para documentação
  - `chore/<descricao-curta>` para manutenção e ferramentas
- Uma branch por assunto. Se surgir outro bug ou feature no meio do trabalho, anote no
  `BACKLOG.md` ou crie outra branch depois; não misture.
- Antes de subir: `npm run check` precisa passar.
- Suba a branch (`git push -u origin <branch>`) e peça para a pessoa abrir o Pull Request para o
  `main`. Não faça merge no `main` nem publique (`npm run deploy -w apps/worker`) sem pedido
  explícito.
- Commits: `tipo(escopo): descrição` em português, sem acentos na mensagem.

## Regras do projeto

- O banco é a fonte da verdade: regras de negócio em funções SQL (`supabase/migrations`), chamadas
  pelo Worker. Mudança de esquema = migration nova; nunca edite uma já aplicada.
- Migrations novas precisam ser aplicadas no Supabase real (SQL Editor) antes do deploy do Worker.
- Nunca imprima nem faça commit de segredos (`apps/worker/.dev.vars`, `apps/web/.env.local`).
- Textos da persona ficam em `packages/persona` e `packages/assistant`; sempre com versão neutra.
- Nada pago: só planos gratuitos, sem aprovação explícita.
