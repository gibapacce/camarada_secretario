# Guia de uso e Modo Aprendiz

Para quem vai usar o assistente sem querer decorar comandos. O **Modo Aprendiz** é uma opção por
pessoa (Preferências, ou "modo aprendiz" / "modo normal" na conversa). Ele só ajuda: nunca bloqueia
uma ação válida.

## Primeira vez

Na primeira mensagem, o Camarada dá as boas-vindas com três exemplos para copiar e oferece o
treino. Para ver os exemplos a qualquer momento, envie **ajuda**. O painel tem a página
**Primeiros passos** (Círculo de Estudos, com a persona ligada), com os mesmos exemplos e um botão
de copiar.

## Pedir ajuda

Funciona em qualquer modo, com ou sem persona: "ajuda", "/ajuda", "menu", "me ensina",
"não sei usar", "exemplos", "o que você faz".

Temas: "ajuda criar", "ajuda consultar", "ajuda concluir", "ajuda fotos", "ajuda lembretes",
"ajuda treino".

## Missão de Treino (5 passos, ~2 minutos)

Envie **treino** (ou use o botão em Primeiros passos).

| Passo | O que fazer                   | Exemplo                           |
| ----- | ----------------------------- | --------------------------------- |
| 1     | Criar uma tarefa              | `Treino: regar as plantas amanhã` |
| 2     | Ver a lista                   | `o que falta fazer?`              |
| 3     | Fotos (opcional; pelo painel) | `próximo`                         |
| 4     | Concluir a tarefa             | `feito 1`                         |
| 5     | Ver o resumo                  | `resumo`                          |

Durante o treino:

- **"depois"** pausa; **"continuar treino"** retoma; **"pular"** sai; **"reiniciar treino"**
  recomeça.
- As tarefas de treino **não aparecem** em listas, resumos, balanços nem lembretes de ninguém, nem
  no painel. Durante o treino elas aparecem só para quem está treinando.
- Elas são **apagadas** ao terminar, ao pular, ao reiniciar ou depois de 24 horas.
- Se você pausar, o bot volta a funcionar normalmente e as tarefas que criar são de verdade.

## Dicas e outros apoios

- **Dica contextual:** depois de algumas ações o bot sugere algo útil (dizer prazo, usar
  "feito 2", usar "desfazer"). Cada dica aparece **uma única vez** por pessoa e no máximo uma por
  mensagem.
- **Frase que o bot não entendeu:** ele nunca responde só "não entendi". Mostra até três opções
  numeradas; responda com o número.
- **Mais confirmações:** no Modo Aprendiz, o bot pergunta antes de concluir ou cancelar.
- **Desfazer:** "desfazer" ou "errei" reverte a sua última ação em até 15 minutos. Fica no
  histórico, nada é apagado. Vale para todos, não só no Modo Aprendiz.
- **Sair do Modo Aprendiz:** depois de 10 ações ou 14 dias, o bot pergunta uma vez se você quer
  parar de receber dicas. "Sim" desliga o modo; "não" mantém. A ajuda continua disponível.

## Privacidade

O painel mostra só o estado do modo, nunca o conteúdo das conversas. O bot guarda apenas um
contexto curto (a última lista e uma pergunta pendente, por até 30 minutos), nunca o texto das
mensagens.

## Para quem mantém o projeto

- Estado por pessoa em `household_members`: `tutorial_step` (1 a 5, nulo = sem treino),
  `tutorial_paused` e `tips_seen` (dicas já mostradas). Alterações passam por
  `update_member_training`.
- `cleanup_tutorial_tasks()` apaga treinos com mais de 24 h; é chamada junto das ações de treino e
  pela limpeza diária do Cron.
- Limiares da oferta de saída: `EXIT_AFTER_ACTIONS` e `EXIT_AFTER_DAYS` em
  [engine.ts](../packages/assistant/src/engine.ts).
- Textos: [training.ts](../packages/assistant/src/training.ts). Veja também
  [persona.md](persona.md).
