# BACKLOG — Chatbot de Tarefas Domésticas

Categorias: `[BUG]` · `[BACKEND]` · `[IA]` · `[FEAT]` · `[UX]`
Regra: faça agora só se bloqueia o que estou construindo, ou se leva ~15 min no código em que já estou mexendo. O resto fica aqui.
Revisão: 1x por semana. Apague o que não faz mais sentido.
Cada item vira uma branch própria (`feat/`, `fix/`, `docs/`, `chore/`) quando sair do backlog; nenhuma mudança vai direto no `main`.

## 🔥 Agora (máx. 3)

- [ ] **[BUG] Tornar o backup restaurável e detectar cópias incompletas** — o roteiro atual não trata `task_events.seq` (`GENERATED ALWAYS AS IDENTITY`), e o script termina com sucesso mesmo se fotos solicitadas falharem. Aceite: restaurar uma cópia com tarefas recorrentes, histórico e fotos em ambiente descartável; preservar a ordem dos eventos e garantir que o próximo evento não colida com a sequência restaurada; sinalizar cópia parcial com saída diferente de zero. ([script de backup](scripts/backup.mjs), [roteiro de recuperação](docs/operacao.md), [migração da sequência](supabase/migrations/20261026170000_event_sequence.sql))
- [ ] **[BUG] Fazer o botão “Desfazer” reverter a ação exibida no aviso** — hoje ele desfaz a última ação da pessoa, que pode já ser outra feita no Telegram ou em outra aba. Aceite: se o aviso se refere à tarefa A e depois a pessoa altera B em outro canal, clicar em “Desfazer” nunca altera B; a ação original é revertida se ainda for válida, ou o painel explica o conflito. O comando genérico do bot continua desfazendo a última ação. ([painel](apps/web/src/App.tsx), [regra de desfazer](supabase/migrations/20261026170000_event_sequence.sql))

## 📥 Próximos

Ordem sugerida: maior ganho no dia a dia primeiro.

- [ ] **[BUG] Mostrar totais corretos no resumo do painel e do bot** — os contadores usam o tamanho de listas limitadas a 200, e o painel busca cinco listas para montar o resumo. Aceite: calcular os totais com uma consulta agregada por casa, manter as prévias limitadas e validar com mais de 200 tarefas, usando o fuso da casa para as janelas de prazo e conclusão. ([resumo do painel](apps/web/src/pages/SummaryPage.tsx), [resumo do bot](packages/assistant/src/engine.ts))
- [ ] **[UX] Botões no lembrete do Telegram: "✅ Concluir", "⏰ Adiar 1 h", "📅 Amanhã"** — resolver o lembrete com um toque; adiar só a notificação da pessoa, sem mudar o prazo nem a recorrência. Aceite: toque repetido não duplica ações; um lembrete antigo informa que a tarefa mudou ou já foi concluída. ([webhook](apps/worker/src/telegram.ts), [envio de lembretes](apps/worker/src/reminders.ts))
- [ ] **[BACKEND] Repetir ações do painel sem duplicar alterações** — o painel e o chat geram outra chave a cada tentativa e podem afirmar que nada foi registrado mesmo quando só a resposta se perdeu. Aceite: ao perder a resposta de uma criação aceita pelo servidor, oferecer reenvio com a mesma chave, sem gerar outra tarefa e sem perder os dados digitados. ([painel](apps/web/src/App.tsx), [conversa](apps/web/src/pages/ChatPage.tsx), [cliente da API](apps/web/src/lib/api.ts))
- [ ] **[UX] Busca, filtros e paginação na lista de tarefas** — situação e responsável já existem; adicionar busca por texto (incluindo equivalência com e sem acentos), filtros por cômodo/categoria e ordenação por prazo ou prioridade. Aceite: filtros ficam na URL, a busca encontra resultados além dos 200 primeiros e voltar dos detalhes preserva a lista filtrada. ([lista](apps/web/src/pages/TasksPage.tsx), [consulta atual](supabase/migrations/20261026120100_task_functions.sql))
- [ ] **[FEAT] Configurar e editar séries recorrentes no painel** — exibir a regra nos detalhes e distinguir “só esta ocorrência” de “esta e as próximas”. Aceite: mudar dia ou horário da série não altera ocorrências concluídas nem apaga o histórico; mostrar a próxima data antes de salvar. ([detalhes da tarefa](apps/web/src/pages/TaskDetailsPage.tsx), [formulário](apps/web/src/components/TaskForm.tsx))
- [ ] **[BACKEND] Fazer a fila de lembretes respeitar a tentativa atual e os limites do Telegram** — hoje o término identifica o envio só pelo ID do lembrete, e a espera exponencial não considera o intervalo recomendado pelo Telegram em respostas 429. Aceite: uma tentativa cuja reserva expirou não pode sobrescrever a mais recente; respeitar `retry_after` quando informado e registrar falhas sem conteúdo das tarefas. ([entrega](apps/worker/src/reminders.ts), [fila no banco](supabase/migrations/20261123100000_reminders.sql))
- [ ] **[FEAT] Envio automático dos resumos diário e semanal pelo Telegram** — o resumo semanal sob demanda já existe. Permitir adesão e horário por pessoa; respeitar o fuso e o silêncio da casa e evitar reenvio do mesmo período após nova execução do cron. ([regras do assistente](packages/assistant/src/rules.ts), [arquitetura dos lembretes](docs/architecture.md))
- [ ] **[FEAT] Avisar a outra pessoa pelo Telegram** — quando uma tarefa for atribuída a ela, ou quando uma tarefa coletiva for concluída ("Deise concluiu: lavar a louça")
- [ ] **[FEAT] Criar tarefa recorrente pela conversa** — "toda segunda lavar o banheiro", "todo dia 5 pagar a internet"; começar por padrões determinísticos e confirmar a frequência e a primeira data antes de gravar.
- [ ] **[UX] "Esqueci minha senha" na tela de login** — hoje quem esquece depende de alguém mexer no Supabase
- [ ] **[UX] Painel instalável no celular (PWA)** — manifest, ícone do mascote e favicon; abre em tela cheia como app
- [ ] **[FEAT] Ajustar horário de silêncio e do lembrete de atraso pelo painel** — hoje só por SQL (`households`)
- [ ] **[BACKEND] Limpar fotos órfãs e dados transitórios vencidos** — aproveitar o cron diário para limpar em lotes. Começar a limpeza de fotos em modo de simulação e só remover arquivos antigos sem registro ativo, sem interferir em uploads em andamento. Definir prazo de retenção das chaves de idempotência antes de apagá-las, preservando a janela de reenvio. ([limpeza atual](apps/worker/src/reminders.ts), [arquitetura de fotos](docs/architecture.md))
- [ ] **[BACKEND] Cobrir fluxos principais com teste de navegador na CI** — complementar os testes React e PGlite existentes com um fluxo de login → criação → conclusão → desfazer, e outro de resposta perdida → reenvio, usando dados locais ou simulados, sem gravar no Supabase de produção. ([CI atual](.github/workflows/ci.yml), [testes do painel](apps/web/src/App.test.tsx))

## 🧊 Ideias

### Telegram

- [ ] **[FEAT] Fotos pelo Telegram** — anexar foto a uma tarefa (ou como prova ao concluir) direto na conversa; hoje só pelo painel
- [ ] **[IA] Mensagens de voz** — transcrever áudio com Workers AI (Whisper) e tratar como texto; verificar cota gratuita
- [ ] **[FEAT] Grupo do casal no Telegram** — bot no grupo respondendo a menções e comandos, além do chat privado
- [ ] **[UX] Comando "/hoje"** — só o que vence hoje e o que está atrasado, em uma mensagem curta

### Painel

- [ ] **[UX] Manter a conversa ao trocar de aba** — hoje o histórico da página "Conversar" some; manter rascunho e mensagens na sessão do painel, com botão para limpar e sem mostrar o histórico ao trocar de conta no mesmo aparelho. ([página de conversa](apps/web/src/pages/ChatPage.tsx))
- [ ] **[UX] Modo escuro** — seguir a preferência do sistema (`prefers-color-scheme`)
- [ ] **[UX] Concluir direto do calendário** — hoje é preciso abrir a tarefa
- [ ] **[UX] Oferecer visão de agenda no celular** — permitir ler os títulos completos em uma lista por dia e navegar com teclado. Aceite: o botão “Hoje” mantém o modo escolhido, e erro de carregamento oferece “Tentar novamente” sem parecer um calendário vazio. ([calendário](apps/web/src/pages/CalendarPage.tsx))
- [ ] **[UX] Recuperar fotos com link expirado sem recarregar a página** — hoje as URLs das fotos são temporárias e a galeria não trata falha ao carregar uma imagem com URL. Aceite: renovar o link ao tentar novamente e mostrar um estado de erro com ação acessível se a imagem continuar indisponível. ([galeria](apps/web/src/components/PhotoSection.tsx), [arquitetura de fotos](docs/architecture.md))
- [ ] **[FEAT] Histórico de lembretes enviados** — em Preferências ou na tarefa: o que saiu, quando, e falhas (transparência e depuração)
- [ ] **[FEAT] Gerenciar pessoas da casa** — dono convida, renomeia e desativa membros pelo painel; hoje é por SQL
- [ ] **[FEAT] Exportar dados pelo painel** — botão de download (JSON/CSV) do backup, sem precisar rodar script

### Tarefas

- [ ] **[FEAT] Balanço justo do coletivo** — esforço e tarefas concluídas por pessoa na semana/mês, com o tom da persona (o campo `effort` já existe)
- [ ] **[FEAT] Checklist dentro da tarefa** — subitens (ex.: "Faxina: banheiro, cozinha, quartos") marcados um a um
- [ ] **[FEAT] Atalhos para tarefas frequentes** — modelos com responsável, esforço e cômodo prontos
- [ ] **[FEAT] Lista de compras** — itens rápidos, marcar como comprado, pelo bot ("comprar leite") e pelo painel
- [ ] **[FEAT] Calendário no Google/Apple (feed iCal)** — link privado e assinado com as tarefas com prazo

### IA

- [ ] **[IA] Sugerir responsável e prazo** — com base no histórico (quem costuma fazer, de quanto em quanto tempo), sempre como sugestão confirmável

## ✅ Concluídos

- [x] **[UX] Melhorar a clareza das mensagens e da conversa com o bot** — 27/11/2026, branch `feat/clareza-mensagens`. Confirmações no Telegram e no painel citam a tarefa e o que mudou (novo prazo, responsável, próxima repetição, o que foi desfeito); "já estava" / "nada mudou" não oferecem "Desfazer". O bot diz quando ainda não fez nada (confirmação, escolha entre parecidas, dado faltando). Falha recusada diz o motivo e que nada foi alterado; resposta perdida não afirma nada e orienta a conferir antes de repetir. ([confirmações](packages/persona/src/results.ts), [falhas](packages/persona/src/panel.ts), [motor do bot](packages/assistant/src/engine.ts))
