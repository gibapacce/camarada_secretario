# Persona: Camarada Ho Chi Miau

Personagem de apresentação: um gato comunista bem-humorado. A persona **só muda o texto**. Ela
nunca decide, altera dados nem afirma algo que o backend não confirmou. O código fica em
[packages/persona](../packages/persona/src) (painel e mensagens de ação) e
[packages/assistant](../packages/assistant/src) (respostas do bot).

## Intensidade

Cada pessoa escolhe a sua, no painel (Preferências) ou na conversa. O padrão é `full`.

| Nível   | Comando na conversa        | Efeito                                                              |
| ------- | -------------------------- | ------------------------------------------------------------------- |
| `off`   | "modo sério", "sem piadas" | Textos neutros, sem piadas, sem mascote. Nenhuma função some.       |
| `light` | "modo leve"                | Vocabulário do Camarada ("missão", "Plano Quinquenal"), sem exagero |
| `full`  | "modo camarada"            | Personagem completo, com miados e piadas curtas                     |

## Regras de tom

- **Fato primeiro, tempero depois.** O título da tarefa, o prazo e o responsável aparecem exatos,
  vindos do banco. A piada vem depois e é opcional.
- **Assuntos sensíveis** (saúde, luto, dívidas) usam tom neutro em qualquer nível
  (`isSensitive`, em `panel.ts`).
- **Nunca confirmar o que não aconteceu.** Em erro, o texto diz que nada foi registrado.
- **Tudo funciona com a persona desligada.** As mensagens de ajuda, treino e dicas existem nas duas
  versões.
- Sem imagens ou textos protegidos por direitos autorais; o mascote é um SVG próprio.

## Onde cada texto mora

| O quê                                        | Arquivo                                              |
| -------------------------------------------- | ---------------------------------------------------- |
| Rótulos do painel e avisos de ação           | [panel.ts](../packages/persona/src/panel.ts)         |
| Mensagens de erro com códigos estáveis       | `errorMessage`, em `panel.ts`                        |
| Ajuda, sugestões numeradas e modos           | [replies.ts](../packages/assistant/src/replies.ts)   |
| Boas-vindas, passos do treino, dicas e saída | [training.ts](../packages/assistant/src/training.ts) |

Esses textos são fixos e baseados em regras, **sem IA**: não gastam a cota gratuita e funcionam
com a IA fora do ar. A IA só interpreta o que a pessoa escreveu; o backend valida e executa.

## Glossário

| Termo do painel               | Termo neutro (`off`) |
| ----------------------------- | -------------------- |
| Plano Quinquenal              | Tarefas              |
| Assembleia Geral              | Resumo               |
| Missão                        | Tarefa               |
| Arquivo Nacional              | Fotos                |
| Comitê de Preferências        | Preferências         |
| Círculo de Estudos            | Primeiros passos     |
| Autocrítica aceita (desfazer) | Ação desfeita        |

## Como acrescentar ou mudar um texto

1. Altere o catálogo no arquivo da tabela acima e mantenha a versão neutra equivalente.
2. Os textos de ação têm o título entre aspas (`"{t}"`); não remova.
3. Rode `npm run check`. Os testes cobrem os textos usados nos fluxos principais.

## Lembretes

Os textos de lembrete ficam em [reminders.ts](../packages/persona/src/reminders.ts): um texto
neutro por tipo (`off`), 2 variantes no modo leve e 5 no completo. A variante é escolhida pela
chave do lembrete, então uma nova tentativa de envio repete a mesma frase. Título e prazo vêm
exatos do banco; assuntos sensíveis ficam neutros; atraso é cobrado com leveza, sem zombar.

## Ainda por fazer

Sorteio anti-repetição nas respostas da conversa (`persona_message_log`).
