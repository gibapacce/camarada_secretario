import { describe, expect, it } from 'vitest';
import { actionMessage, failureMessage, isSensitive, panelText } from './panel.ts';

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
  it('sempre diz que nada foi registrado', () => {
    for (const level of ['off', 'light', 'full'] as const) {
      expect(failureMessage(level)).toContain('Nada foi registrado.');
    }
  });
});
