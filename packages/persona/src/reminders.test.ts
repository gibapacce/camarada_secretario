import { describe, expect, it } from 'vitest';
import { reminderMessage, type ReminderInput } from './reminders.ts';

const tz = 'America/Sao_Paulo';
const base: ReminderInput = {
  type: 'due',
  key: 'due:t1:m1:1',
  intensity: 'off',
  title: 'Lavar a louça',
  dueAt: '2026-11-20T18:00:00.000Z', // 15:00 em São Paulo
  sentAt: '2026-11-20T18:00:00.000Z',
  timezone: tz,
  shared: false,
};

describe('reminderMessage', () => {
  it('modo sério: fato direto, com hoje/amanhã e hora no fuso da casa', () => {
    expect(reminderMessage(base)).toBe('Lembrete: "Lavar a louça" vence hoje às 15:00.');
    expect(
      reminderMessage({
        ...base,
        type: 'before_24h',
        dueAt: '2026-11-21T18:00:00.000Z',
        shared: true,
      }),
    ).toBe('Lembrete: "Lavar a louça" (compartilhada) vence amanhã às 15:00.');
  });

  it('tarefa só com data (23:59) não mostra a hora', () => {
    expect(
      reminderMessage({
        ...base,
        dueAt: '2026-11-21T02:59:00.000Z',
        sentAt: '2026-11-20T12:00:00.000Z',
      }),
    ).toBe('Lembrete: "Lavar a louça" vence hoje.');
  });

  it('atraso conta os dias pelo calendário da casa', () => {
    const overdue = { ...base, type: 'overdue' as const };
    expect(reminderMessage({ ...overdue, sentAt: '2026-11-21T12:00:00.000Z' })).toContain(
      'venceu ontem',
    );
    expect(reminderMessage({ ...overdue, sentAt: '2026-11-24T12:00:00.000Z' })).toContain(
      'está atrasada há 4 dias',
    );
  });

  it('a mesma chave gera sempre o mesmo texto; chaves diferentes variam', () => {
    const full = { ...base, intensity: 'full' as const };
    expect(reminderMessage(full)).toBe(reminderMessage(full));
    const texts = new Set(
      Array.from({ length: 30 }, (_, i) => reminderMessage({ ...full, key: `due:t${i}:m1:1` })),
    );
    expect(texts.size).toBeGreaterThan(1);
    for (const t of texts) expect(t).toContain('"Lavar a louça" vence hoje às 15:00');
  });

  it('assunto sensível fica neutro mesmo no modo camarada; o título nunca é alterado', () => {
    const title = 'Consulta no médico {due} $&';
    expect(reminderMessage({ ...base, intensity: 'full', title })).toBe(
      `Lembrete: "${title}" vence hoje às 15:00.`,
    );
  });
});
