# Arquitetura e decisões

Registro das decisões da Fase 0 (aprovadas em 26/10/2026). Fatos marcados **[C]** foram
confirmados na documentação oficial em 26/10/2026; **[H]** são hipóteses a validar com teste real.
Planos e preços mudam: reconfira antes de cada publicação.

## Decisões

| #   | Decisão                                                                                 | Motivo                                                                                 |
| --- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| D1  | Canal de conversa: **bot do Telegram** (grupo do casal e/ou chats individuais)          | Grupo de WhatsApp oficial inviável para pessoa física; lembretes no WhatsApp são pagos |
| D2  | Backend, webhooks, cron e hospedagem do painel: **Cloudflare Workers** (plano gratuito) | Sem servidor próprio; painel como assets estáticos no mesmo domínio (sem CORS)         |
| D3  | Banco, autenticação e fotos: **Supabase** (plano gratuito)                              | Postgres com transações e RLS, Auth e Storage privado sem cartão                       |
| D4  | IA: regras primeiro; **Workers AI** gratuito; Gemini gratuito só como fallback opcional | Custo zero; Gemini gratuito usa o conteúdo para melhorar produtos [C]                  |
| D5  | Persona e Modo Aprendiz 100% por catálogo e regras                                      | Não gasta cota de IA e funciona com a IA fora do ar                                    |
| D6  | Adaptador de mensageria isolado                                                         | Permite adicionar WhatsApp no futuro sem reescrever regras                             |
| D7  | Sem custos: nenhum recurso que exija cartão (ex.: R2, Workers Paid, Supabase Pro)       | Condição de aprovação do usuário                                                       |

## Fluxo

```text
Telegram ──webhook (secret_token)──> Worker ──> regras pt-BR ──(se preciso)──> Workers AI
Painel (assets do Worker) ─────────> Worker ──> Supabase (Postgres + Auth + Storage privado)
Cron Trigger ──────────────────────> Worker ──> lembretes deduplicados ──> Telegram
Resultado estruturado {ok, event, dados} ──> packages/persona ──> texto final
```

## Limites gratuitos relevantes

| Serviço            | Limite [C]                                                                | Risco                                                               |
| ------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Cloudflare Workers | 100 mil req/dia; **10 ms de CPU por execução**; 5 Cron Triggers por conta | Exceder retorna erro (não cobra). CPU baixa exige código enxuto     |
| Workers AI         | 10.000 neurons/dia                                                        | Ao esgotar, erro → fallback por regras                              |
| Supabase           | 500 MB banco; 1 GB arquivos; 5 GB tráfego; 2 projetos                     | **Pausa após 7 dias de pouca atividade**; **sem backup automático** |
| Telegram Bot API   | Gratuito; download de arquivos até 20 MB                                  | Privacy mode em grupos: bot só vê comandos, menções e respostas     |

Mitigações planejadas:

- Pausa do Supabase: o Cron consulta o banco várias vezes ao dia [H: deve bastar].
- Backup: exportação semanal própria (Fase 9), além de exportação manual documentada.
- CPU de 10 ms: medir no `wrangler dev` e nos logs; evitar trabalho pesado no Worker.

## Modelo de dados e regras (Fase 2)

Migrations em `supabase/migrations/`; testes rodam as mesmas migrations num Postgres local
(PGlite, sem Docker). Toda alteração passa por funções SQL transacionais chamadas pelo Worker via
RPC com a service role. O Postgres de testes é o 18; o código evita recursos exclusivos de versões
novas para continuar compatível com o Supabase.

- **Isolamento por casa:** toda função recebe `household_id`; chaves estrangeiras compostas impedem
  ligar tarefa a pessoa ou regra de outra casa. RLS ligado em todas as tabelas, sem políticas
  (nega tudo a clientes). Funções revogadas de `anon`/`authenticated`.
- **Membros:** `telegram_user_id` substitui o `whatsapp_number` do plano (decisão D1).
- **Idempotência:** cada comando aceita `idempotency_key` no formato `provider:id`
  (ex.: `telegram:<chat>:<message_id>`). A chave fica em `processed_messages` com o resultado;
  repetir a mesma chave devolve o mesmo resultado com `replayed: true`, sem reprocessar.
  Concluir algo já concluído também é inofensivo (`task_already_completed`).
- **Atraso:** nunca é gravado; é calculado (`is_overdue`) quando `due_at < agora` e a tarefa está
  aberta.
- **Tarefas de treino:** `is_tutorial = true` ficam fora das consultas por padrão.
- **Erros:** autorização e entrada inválida geram exceção (nada é gravado). Resultados de negócio
  voltam como `{ok: false, error}` (ex.: `task_not_found`, `task_cancelled`, `undo_conflict`).

### Recorrência

- A regra guarda frequência (`daily`, `weekly`, `monthly`), intervalo (1 a 12), dias da semana,
  dia do mês, hora local e data de início. Cada ocorrência é uma tarefa própria, então o histórico
  das anteriores nunca se perde.
- Ao **concluir** ou **cancelar** uma ocorrência, nasce a próxima: a primeira data da regra
  posterior ao prazo da atual **e** ao momento presente. Ocorrências atrasadas não geram um
  acúmulo de cópias perdidas; a série continua a partir de agora.
- Mensal no dia 29–31 usa o último dia do mês quando ele não existe (ex.: 31 → 28/02).
- O horário é calculado no fuso da casa, inclusive com horário de verão (testado com Lisboa).
  Horários locais inexistentes na troca de horário são ajustados pelo Postgres.
- Índice único `(regra, prazo)` e bloqueio da regra garantem que retries não dupliquem ocorrências.
- Cancelar com `stop_recurrence` encerra a série.

### Desfazer

- Reverte a última ação da própria pessoa (criar, editar, concluir, reabrir, cancelar) em até
  15 minutos (configurável até 60). Pode ser repetido para voltar várias ações.
- É um evento compensatório `undone` no histórico; nada é apagado. Desfazer uma criação cancela a
  tarefa (e encerra a série, se recorrente).
- Se outra pessoa alterou a mesma tarefa depois, o resultado é `undo_conflict` (nada muda).
- Desfazer uma conclusão recorrente cancela a próxima ocorrência gerada, se ninguém mexeu nela.

### Pendências conhecidas

- Tabelas de fotos, lembretes, log da persona e dicas entram nas fases 4, 6 e 8.
- Cliente PostgREST validado com o Supabase real (26/10/2026): login ES256, 401 sem token ou com
  token adulterado, criar/repetir/concluir/desfazer, preferências, isolamento por casa e chave
  pública sem acesso direto às tabelas.
  A documentação confirma que chaves secretas novas (`sb_secret_`) vão no cabeçalho `apikey` [C].
  O Supabase recusa chave secreta quando o User-Agent parece de navegador (ex.: PowerShell 5.1).

## API HTTP (Fase 3)

O painel fala só com o Worker (`/api/*`, mesmo domínio, sem CORS). O Worker usa a chave secreta
do Supabase; o navegador nunca a recebe.

- **Autenticação:** `Authorization: Bearer <access token do Supabase Auth>`. O Worker verifica a
  assinatura com as chaves públicas do projeto (`/auth/v1/.well-known/jwks.json`, via `jose`),
  além de emissor, audiência `authenticated`, papel e expiração [C]. O token só identifica o
  usuário; casa e pessoa vêm de `household_members.auth_user_id` no banco. Dados de casa/autor
  enviados pelo navegador são ignorados.
- **Idempotência:** toda alteração exige o cabeçalho `Idempotency-Key` (UUID gerado pelo painel),
  gravado como `web:<uuid>`. Clique duplo ou reenvio devolvem o mesmo resultado.
- **Rotas:** `GET /api/health` (pública), `GET /api/me`, `PATCH /api/me/preferences`,
  `GET|POST /api/tasks`, `GET|PATCH /api/tasks/:id`, `POST /api/tasks/:id/(complete|reopen|cancel)`,
  `POST /api/undo`.
- **Respostas:** sempre JSON `{ok, ...}` com `cache-control: no-store`. 401 token inválido,
  403 não é membro, 404 tarefa de outra casa ou inexistente, 409 conflito de negócio,
  413/415 corpo inválido (limite de 16 KB), 503 banco ou chaves de autenticação indisponíveis.
  Erros inesperados viram 500 genérico, sem detalhes internos.

## Por que não WhatsApp (por enquanto)

- Groups API exige Official Business Account (verificação de empresa); não concedida a contas de
  teste nem a funcionários; máximo 8 participantes; sem mensagens interativas em grupo [C].
- Fora da janela de 24 h, só modelos aprovados; `utility` é sempre cobrado (desde 01/10/2026, até
  dentro da janela) [C].
- Respostas comuns: 1.000 grátis/mês por número; sem cartão, a Meta para de entregar depois [C].
- O número registrado na Cloud API não pode ser usado no app WhatsApp [C].
- Automação não oficial do WhatsApp não será usada sem aprovação explícita (risco de banimento).
