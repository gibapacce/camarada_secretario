import { describe, expect, it } from 'vitest';
import { actionMessage, failureMessage, isSensitive, panelText } from './panel.ts';
import { isNoop, resultMessage } from './results.ts';

describe('panelText', () => {
  it('usa rótulos neutros em off', () => {
    const t = panelText('off');
    expect(t.tasksTitle).toBe('Tarefas');
    expect(t.photosTitle).toBe('Fotos');
    expect(t.greeting('Ana')).toBeNull();
  });

  it('usa o vocabulário do Camarada em light e full', () => {
    expect(panelText('light').tasksTitle).toBe('Plano Quinquenal');
    expect(panelText('full').summaryTitle).toBe('Assembleia Geral');
    expect(panelText('full').greeting('Ana')).toContain('camarada Ana');
  });

  it('mantém as mesmas chaves em todos os níveis', () => {
    const keys = Object.keys(panelText('off')).sort();
    expect(Object.keys(panelText('light')).sort()).toEqual(keys);
    expect(Object.keys(panelText('full')).sort()).toEqual(keys);
  });
});

describe('actionMessage', () => {
  it('mostra o título exato em todos os níveis', () => {
    const title = 'Lavar a louça $& {t}';
    for (const level of ['off', 'light', 'full'] as const) {
      expect(actionMessage('completed', title, level)).toContain(`"${title}"`);
    }
  });

  it('off é direto, full tem tempero', () => {
    expect(actionMessage('created', 'Varrer', 'off')).toBe('Tarefa criada: "Varrer".');
    expect(actionMessage('created', 'Varrer', 'light')).toBe('🚩 Missão registrada: "Varrer".');
    expect(actionMessage('created', 'Varrer', 'full')).toMatch(
      /^🚩 Missão registrada: "Varrer"\. .*Miau!$/,
    );
  });

  it('usa tom neutro em assuntos sensíveis mesmo em full', () => {
    expect(actionMessage('created', 'Marcar consulta no médico', 'full')).toBe(
      'Tarefa criada: "Marcar consulta no médico".',
    );
  });
});

describe('isSensitive', () => {
  it.each(['Ir ao HOSPITAL', 'pagar dívida do cartão', 'Remédio da tarde', 'velório da tia'])(
    'detecta "%s"',
    (text) => expect(isSensitive(text)).toBe(true),
  );

  it.each(['Lavar a louça', 'Consertar a pia', 'Comprar sachê'])('ignora "%s"', (text) =>
    expect(isSensitive(text)).toBe(false),
  );
});

describe('failureMessage', () => {
  it('falha certa: diz o que não foi feito, o motivo e que nada mudou', () => {
    expect(
      failureMessage('off', { event: 'completed', title: 'Varrer', code: 'task_cancelled' }),
    ).toBe('Não consegui concluir a tarefa "Varrer". A tarefa está cancelada. Nada foi alterado.');
    for (const level of ['off', 'light', 'full'] as const) {
      expect(failureMessage(level)).toContain('Nada foi alterado; pode tentar de novo.');
    }
  });

  it('resultado incerto: não diz que nada mudou e pede para conferir antes de repetir', () => {
    const panel = failureMessage('off', {
      event: 'created',
      title: 'Varrer',
      code: 'network_error',
      uncertain: true,
    });
    expect(panel).toBe(
      'Não consegui confirmar se a tarefa "Varrer" foi criada. A conexão caiu antes da resposta. Confira na tela antes de tentar de novo, para não criar em dobro.',
    );
    expect(
      failureMessage('full', { event: 'completed', uncertain: true, channel: 'chat' }),
    ).toMatch(/^😿 Não consegui confirmar se a tarefa foi concluída\..*"pendentes"/);
  });
});

const fmt = {
  tz: 'America/Sao_Paulo',
  memberName: (id: string | null) => (id ? 'Deise' : 'Compartilhada'),
};
const base = {
  title: 'Lavar a louça',
  status: 'pending',
  due_at: '2026-11-13T23:00:00Z',
  assigned_to_member_id: null,
};

describe('resultMessage', () => {
  it('ao editar, diz a tarefa e só o que mudou', () => {
    const r = {
      event: 'task_updated',
      task: base,
      changes: { due_at: '2026-11-14T21:00:00+00:00', assigned_to_member_id: 'x' },
    };
    expect(resultMessage('updated', r, 'off', fmt)).toBe(
      'Tarefa atualizada: "Lavar a louça".\n⏰ Novo prazo: sáb., 14/11, 18:00.\n👤 Agora está com Deise.',
    );
    expect(
      resultMessage('updated', { ...r, changes: { title: 'Lavar a louça' } }, 'off', fmt, {
        title: 'Louça',
      }),
    ).toContain('✏️ Novo nome (antes: "Louça").');
  });

  it('não finge mudança quando nada mudou', () => {
    expect(resultMessage('updated', { event: 'task_unchanged', task: base }, 'full', fmt)).toBe(
      'Nada mudou em "Lavar a louça": os dados já estavam assim.',
    );
    expect(isNoop('task_already_completed')).toBe(true);
    expect(isNoop('task_completed')).toBe(false);
  });

  it('mostra a próxima repetição ou o fim da série', () => {
    const next = { ...base, due_at: '2026-11-20T23:00:00Z' };
    expect(
      resultMessage(
        'completed',
        { event: 'task_completed', task: base, next_task: next },
        'off',
        fmt,
      ),
    ).toBe('Tarefa concluída: "Lavar a louça".\n🔁 Próxima: sex., 20/11, 20:00.');
    expect(
      resultMessage(
        'cancelled',
        { event: 'task_cancelled', task: base, recurrence_stopped: true },
        'off',
        fmt,
      ),
    ).toContain('🔁 As próximas repetições foram encerradas.');
  });

  it('ao desfazer, diz o que foi desfeito e o estado atual', () => {
    const r = {
      event: 'action_undone',
      undone_event_type: 'completed',
      task: base,
      cancelled_next_task_id: 'n',
    };
    expect(resultMessage('undone', r, 'off', fmt)).toBe(
      'Conclusão desfeita: "Lavar a louça" voltou a ficar pendente.\n🔁 A próxima repetição criada por essa ação foi removida.',
    );
    expect(resultMessage('undone', r, 'light', fmt)).toMatch(/^Autocrítica aceita\. Conclusão/);
  });
});
