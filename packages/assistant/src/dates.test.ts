import { describe, expect, it } from 'vitest';
import { fold, parseWhen } from './dates.ts';

// 26/10/2026 é segunda-feira.
const TODAY = '2026-10-26';

describe('fold', () => {
  it('mantém o comprimento e remove acentos', () => {
    const s = 'Louça às 20h, PÃO';
    expect(fold(s)).toBe('louca as 20h, pao');
    expect(fold(s)).toHaveLength(s.length);
  });
});

describe('parseWhen', () => {
  it.each([
    ['Lavar a louça hoje', { date: '2026-10-26', rest: 'Lavar a louça' }],
    ['Lavar a louça amanhã às 20h', { date: '2026-10-27', time: '20:00', rest: 'Lavar a louça' }],
    ['regar plantas depois de amanhã', { date: '2026-10-28', rest: 'regar plantas' }],
    ['pagar luz até sexta', { date: '2026-10-30', rest: 'pagar luz' }],
    ['faxina no sábado às 9h30', { date: '2026-10-31', time: '09:30', rest: 'faxina' }],
    ['reunião segunda que vem', { date: '2026-11-02', rest: 'reunião' }],
    ['dentista segunda', { date: '2026-10-26', rest: 'dentista' }],
    ['aluguel dia 5', { date: '2026-11-05', rest: 'aluguel' }],
    ['IPVA 15/01', { date: '2027-01-15', rest: 'IPVA' }],
    ['festa 20/12/2026 às 21:15', { date: '2026-12-20', time: '21:15', rest: 'festa' }],
    ['jantar às 8 da noite', { time: '20:00', rest: 'jantar' }],
    ['almoço ao meio-dia', { time: '12:00', rest: 'almoço ao' }],
    ['comprar 2 pacotes de arroz', { rest: 'comprar 2 pacotes de arroz' }],
    ['ligar às 25h', { rest: 'ligar às 25h' }],
    ['data 31/02', { rest: 'data 31/02' }],
  ])('%s', (text, expected) => {
    expect(parseWhen(text, TODAY)).toEqual(expected);
  });
});
