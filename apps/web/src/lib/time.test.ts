// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dayKey,
  dayStartUtc,
  startOfMonth,
  startOfWeek,
  utcToZonedInput,
  weekday,
  zonedToUtcIso,
} from './time.ts';

const SP = 'America/Sao_Paulo';

describe('fuso da casa', () => {
  it('converte hora local de São Paulo para UTC (UTC-3)', () => {
    expect(zonedToUtcIso('2026-10-26', '14:00', SP)).toBe('2026-10-26T17:00:00.000Z');
    expect(dayStartUtc('2026-10-27', SP)).toBe('2026-10-27T03:00:00.000Z');
  });

  it('faz o caminho inverso', () => {
    expect(utcToZonedInput('2026-10-26T17:00:00Z', SP)).toEqual({
      date: '2026-10-26',
      time: '14:00',
    });
  });

  it('usa o dia local, não o UTC', () => {
    expect(dayKey('2026-10-27T02:30:00Z', SP)).toBe('2026-10-26');
  });

  it('respeita horário de verão em outros fusos', () => {
    expect(zonedToUtcIso('2026-07-01', '12:00', 'Europe/Lisbon')).toBe('2026-07-01T11:00:00.000Z');
    expect(zonedToUtcIso('2026-01-01', '12:00', 'Europe/Lisbon')).toBe('2026-01-01T12:00:00.000Z');
  });
});

describe('aritmética de dias', () => {
  it('soma dias atravessando meses', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('semana começa no domingo', () => {
    expect(weekday('2026-10-26')).toBe(1);
    expect(startOfWeek('2026-10-26')).toBe('2026-10-25');
    expect(startOfWeek('2026-10-25')).toBe('2026-10-25');
  });

  it('navega por meses', () => {
    expect(startOfMonth('2026-10-26')).toBe('2026-10-01');
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
  });
});
