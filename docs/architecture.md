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
- **Tarefas de treino:** `is_tutorial = true` ficam fora das consultas por padrão. Só quem está
  em treino as vê, e só as próprias. Terminar o treino as apaga; `cleanup_tutorial_tasks()` apaga
  as de mais de 24 h.
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
  "Depois" usa a sequência `task_events.seq`, não o horário: carimbos de tempo podem empatar.
- Desfazer uma conclusão recorrente cancela a próxima ocorrência gerada, se ninguém mexeu nela.

### Pendências conhecidas

- Lembretes: ver "Lembretes (Fase 8)" abaixo. O log de variantes da persona
  (`persona_message_log`) não foi criado: nos lembretes a variante vem da chave. O estado do treino
  e as dicas já
  existem (`household_members.tutorial_step`, `tutorial_paused`, `tips_seen`; ver
  [onboarding.md](onboarding.md)).
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
  `POST /api/undo`, `POST /api/tasks/:id/photos` (multipart: `file`, `caption`) e
  `DELETE /api/photos/:id`.
- **Respostas:** sempre JSON `{ok, ...}` com `cache-control: no-store`. 401 token inválido,
  403 não é membro, 404 tarefa de outra casa ou inexistente, 409 conflito de negócio,
  413/415 corpo inválido (limite de 16 KB), 503 banco ou chaves de autenticação indisponíveis.
  Erros inesperados viram 500 genérico, sem detalhes internos.

## Painel web (Fase 3)

- **Login:** e-mail e senha pelo Supabase Auth (`@supabase/auth-js`, só o módulo de autenticação).
  A sessão fica no `localStorage` com renovação automática; o painel só conhece a chave
  publicável. Todo dado passa pela API do Worker.
- **Páginas:** resumo (`/`), lista com filtros (`/tarefas`), nova tarefa (`/tarefas/nova`),
  detalhes com ações e histórico (`/tarefas/:id`), calendário semanal/mensal (`/calendario`) e
  preferências (`/preferencias`). Roteamento próprio (History API), sem biblioteca.
- **Fuso:** datas exibidas e digitadas no fuso da casa (`households.timezone`), convertidas para
  UTC antes de enviar. Prazo sem hora vira 23:59 do dia; sem data, a tarefa fica sem prazo.
- **Ações:** cada clique gera um `Idempotency-Key` novo; os botões ficam desabilitados durante a
  operação. O aviso mostra o título exato e o que mudou (ex.: novo prazo) e oferece "Desfazer"
  (usa `POST /api/undo`) só quando algo mudou. Se o servidor recusou, o aviso diz o motivo e que
  nada foi alterado; se a resposta não chegou (rede ou 5xx), diz que não conseguiu confirmar,
  recarrega a tela e pede para conferir antes de repetir (`outcomeUnknown`, em `lib/api.ts`).
- **Persona:** rótulos e avisos vêm de `@camarada/persona` (`panelText`, `resultMessage`,
  `failureMessage`), os mesmos usados pelo bot.
  Em `off` os textos são neutros e o mascote some; assuntos sensíveis (saúde, luto, dívidas) usam
  tom neutro em qualquer nível.
- **Segurança:** `apps/web/public/_headers` define CSP (`connect-src 'self' https://*.supabase.co`,
  sem scripts ou estilos inline), `frame-ancestors 'none'`, `nosniff` e `Referrer-Policy`.
- **Validado no navegador** com o Supabase real (26/10/2026): login, resumo, criar com acentos,
  concluir, desfazer, calendário, modo sério e cabeçalhos de segurança.

## Fotos (Fase 4)

- **Armazenamento:** bucket privado `task-photos` (criado pela migration; limite de 5 MB e só
  `image/jpeg`, `image/png`, `image/webp`). Caminho `<casa>/<tarefa>/<foto>.<ext>`, conferido pelo
  banco. Sem políticas de acesso em `storage.objects`: só o Worker (chave secreta) lê e grava.
- **Envio:** o painel reduz a foto para no máximo 1600 px e regrava em JPEG (economiza cota e
  remove metadados como GPS). O Worker valida tamanho (`PHOTO_MAX_BYTES`, padrão 5 MB) e o tipo
  **real** pelos primeiros bytes, ignorando o tipo declarado. Envia ao bucket e só então grava o
  registro (`add_task_photo`); se o registro falhar ou for repetição, o arquivo novo é apagado.
- **Leitura:** `GET /api/tasks/:id` devolve as fotos com URL assinada de 15 minutos (uma chamada
  em lote). O caminho interno nunca sai do Worker. CSP libera `img-src https://*.supabase.co`.
- **Limites e retenção:** até 10 fotos por tarefa. Remover marca `deleted_at`/`deleted_by` (fica
  o registro de quem removeu) e apaga o arquivo do bucket na hora. Se o bucket falhar na remoção,
  sobra um arquivo órfão; a varredura periódica ainda não existe (está no backlog). Fotos de tarefas
  canceladas ou concluídas ficam guardadas; apagar a casa apaga os registros em cascata.
- **Validado com o Supabase real** (26/10/2026): bucket privado e limites, envio, URL temporária,
  sem acesso por endereço público, chave pública, login do usuário ou token adulterado, arquivo
  falso recusado, outra casa sem acesso e remoção apagando o arquivo.

## Telegram (Fase 7)

- **Canal e painel convivem:** o painel continua como acesso visual; o bot manda o link no comando
  `/painel`. O assistente é o mesmo nos dois canais (chave `web:<id>` ou `telegram:<chat>:<id>`).
- **Entrada:** `POST /telegram/webhook`, fora de `/api`, protegida pelo cabeçalho
  `X-Telegram-Bot-Api-Secret-Token` (comparação em tempo constante). Só mensagens de chat privado
  de pessoas vinculadas chegam ao assistente.
- **Vinculação:** código de 12 caracteres hexadecimais, 15 minutos, uso único, guardado só como
  hash SHA-256 em `telegram_link_codes`. Um Telegram não serve a duas pessoas. Desativar o membro
  ou desvincular corta o acesso.
- **Isolamento:** o adaptador (`apps/worker/src/telegram.ts`) é a única parte que conhece a API do
  Telegram (`TelegramPort`). O token nunca aparece em logs.
- Passo a passo e limites: [telegram.md](telegram.md).

## Lembretes (Fase 8)

- **Agendador:** dois Cron Triggers do Worker (`wrangler.jsonc`). A cada 5 minutos,
  `claim_reminders` gera os lembretes devidos, cancela os que perderam a validade e reserva um lote
  de até 20. O Worker monta o texto, envia pelo Telegram e grava o resultado com `finish_reminder`.
  Às 06:00 UTC, a limpeza apaga o histórico de lembretes com mais de 60 dias e os treinos
  abandonados (`cleanup_tutorial_tasks`). O Cron também mantém o Supabase Free ativo.
- **Tipos:** `due` (no prazo; ligado por padrão), `overdue` (atraso, um por dia às 09:00, por até
  30 dias; ligado) e `before_24h` (24 h antes; desligado). Cada pessoa escolhe no painel, em
  Preferências (`household_members.remind_*`).
- **Destinatário:** o responsável, ou todas as pessoas ativas com Telegram quando a tarefa é
  coletiva. Tarefas de treino, concluídas, canceladas ou sem prazo não geram lembrete.
- **Silêncio:** nada sai entre `households.quiet_start` e `quiet_end` (21:00 às 09:00). Para
  calcular horários, o silêncio começa 30 minutos antes (20:30): com o Cron de 5 em 5 minutos, um
  horário como 20:59 seria pulado. Prazo nessa faixa antecipa o lembrete para o fim do silêncio
  anterior (tarefa só com data, 23:59, avisa às 09:00 do dia). O de 24 h vai para o limite mais
  próximo (20:30 ou 09:00) e é omitido se o do prazo sair antes, junto ou já tiver chegado a hora
  dele. Lembretes anteriores à criação da tarefa não são enviados. O lembrete do prazo vale até
  2 h depois; após uma queda longa, os perdidos são descartados, não acumulados.
- **Deduplicação:** `reminder_deliveries.deduplication_key` única por tipo, tarefa, pessoa e prazo
  (ou dia, no atraso). Mudar o prazo gera chave nova e cancela a antiga.
- **Concorrência e retry:** a reserva usa `for update skip locked` e vale 10 minutos (se o Worker
  cair, outro Cron retoma). Falha temporária (429, 5xx, rede) tenta de novo com espera de 2, 4, 8
  e 16 minutos, até 5 tentativas. 400/403 (chat inexistente, bot bloqueado) é falha definitiva.
  Se o envio funcionar e a gravação do resultado falhar, o lembrete pode repetir uma vez.
- **Texto:** `reminderMessage` (`packages/persona/src/reminders.ts`) escolhe a variante pela chave
  (FNV-1a), então um retry usa a mesma frase; "hoje"/"amanhã" e os dias de atraso são calculados
  no momento do envio. O lembrete leva o botão "Abrir tarefa".
- **Ajustes da casa** (sem tela no painel por enquanto; altere por SQL): `quiet_start`,
  `quiet_end`, `overdue_reminder_time` e `overdue_reminder_days` (0 = todo dia, até 1 ano).

## Por que não WhatsApp (por enquanto)

- Groups API exige Official Business Account (verificação de empresa); não concedida a contas de
  teste nem a funcionários; máximo 8 participantes; sem mensagens interativas em grupo [C].
- Fora da janela de 24 h, só modelos aprovados; `utility` é sempre cobrado (desde 01/10/2026, até
  dentro da janela) [C].
- Respostas comuns: 1.000 grátis/mês por número; sem cartão, a Meta para de entregar depois [C].
- O número registrado na Cloud API não pode ser usado no app WhatsApp [C].
- Automação não oficial do WhatsApp não será usada sem aprovação explícita (risco de banimento).
