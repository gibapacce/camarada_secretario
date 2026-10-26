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

## Por que não WhatsApp (por enquanto)

- Groups API exige Official Business Account (verificação de empresa); não concedida a contas de
  teste nem a funcionários; máximo 8 participantes; sem mensagens interativas em grupo [C].
- Fora da janela de 24 h, só modelos aprovados; `utility` é sempre cobrado (desde 01/10/2026, até
  dentro da janela) [C].
- Respostas comuns: 1.000 grátis/mês por número; sem cartão, a Meta para de entregar depois [C].
- O número registrado na Cloud API não pode ser usado no app WhatsApp [C].
- Automação não oficial do WhatsApp não será usada sem aprovação explícita (risco de banimento).
