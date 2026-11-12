import { describe, expect, it } from 'vitest';
import { parseRules, type RuleContext } from './rules.ts';

const GIBA = '00000000-0000-4000-8000-000000000011';
const DEISE = '00000000-0000-4000-8000-000000000012';
const ctx: RuleContext = {
  today: '2026-10-26',
  members: [
    { id: GIBA, display_name: 'Giba' },
    { id: DEISE, display_name: 'Deise' },
  ],
};

describe('parseRules', () => {
  it.each([
    ['ajuda', { type: 'help' }],
    ['/ajuda', { type: 'help' }],
    ['Me ensina', { type: 'help' }],
    ['não sei usar', { type: 'help' }],
    ['ajuda fotos', { type: 'help', topic: 'fotos' }],
    ['Modo sério', { type: 'set_persona', intensity: 'off' }],
    ['sem piada', { type: 'set_persona', intensity: 'off' }],
    ['modo camarada', { type: 'set_persona', intensity: 'full' }],
    ['modo aprendiz', { type: 'set_guidance', mode: 'guided' }],
    ['desfazer', { type: 'undo' }],
    ['Errei!', { type: 'undo' }],
    ['resumo da semana', { type: 'weekly_summary' }],
    ['O que falta fazer?', { type: 'list_tasks', view: 'open' }],
    ['pendentes', { type: 'list_tasks', view: 'open' }],
    ['O que está atrasado?', { type: 'list_tasks', view: 'overdue' }],
    ['O que vence esta semana?', { type: 'list_tasks', view: 'due_week' }],
    ['Quais tarefas estão comigo?', { type: 'list_tasks', view: 'mine' }],
    ['O que foi concluído nesta semana?', { type: 'list_tasks', view: 'completed_week' }],
    ['Mostre as tarefas com fotos', { type: 'list_tasks', view: 'with_photos' }],
    ['O que a Deise concluiu?', { type: 'list_tasks', view: 'completed_by', memberId: DEISE }],
    ['tarefas da Deise', { type: 'list_tasks', view: 'member', memberId: DEISE }],
    ['feito 2', { type: 'complete_task', ref: { index: 2 } }],
    ['Concluí a louça', { type: 'complete_task', ref: { query: 'louca' } }],
    ['louça feita', { type: 'complete_task', ref: { query: 'louca' } }],
    ['reabrir 1', { type: 'reopen_task', ref: { index: 1 } }],
    ['cancelar lixo', { type: 'cancel_task', ref: { query: 'lixo' } }],
    ['detalhes 3', { type: 'task_details', ref: { index: 3 } }],
    ['2', { type: 'choose', index: 2 }],
    ['sim', { type: 'confirm', yes: true }],
    ['não', { type: 'confirm', yes: false }],
    [
      'adiar louça para sexta',
      { type: 'update_task', ref: { query: 'louca' }, date: '2026-10-30' },
    ],
  ])('%s', (text, expected) => {
    expect(parseRules(text, ctx)).toEqual(expected);
  });

  it('cria tarefa com data, hora e responsável', () => {
    expect(parseRules('Nova tarefa: lavar a louça amanhã às 20h pra Deise', ctx)).toEqual({
      type: 'create_task',
      title: 'Lavar a louça',
      date: '2026-10-27',
      time: '20:00',
      assignee: DEISE,
    });
  });

  it('cria tarefa sem prazo, compartilhada e urgente', () => {
    expect(parseRules('anota: trocar o filtro, pros dois, urgente', ctx)).toEqual({
      type: 'create_task',
      title: 'Trocar o filtro',
      assignee: 'shared',
      priority: 'high',
    });
  });

  it('"preciso que a Deise ..." atribui à Deise', () => {
    expect(parseRules('preciso que a Deise passe o aspirador no sábado', ctx)).toMatchObject({
      type: 'create_task',
      title: 'Passe o aspirador',
      date: '2026-10-31',
      assignee: DEISE,
    });
  });

  it('"pra mim" vira o próprio membro', () => {
    expect(parseRules('criar regar plantas sábado comigo', ctx)).toMatchObject({
      title: 'Regar plantas',
      date: '2026-10-31',
      assignee: 'me',
    });
  });

  it('não confunde "tarefas" (lista) com criação', () => {
    expect(parseRules('tarefas', ctx)).toEqual({ type: 'list_tasks', view: 'open' });
  });

  it('texto livre fica para a IA ou para as sugestões', () => {
    expect(parseRules('lavar a louça amanhã', ctx)).toBeNull();
    expect(parseRules('qual a capital da França?', ctx)).toBeNull();
  });

  describe('Missão de Treino', () => {
    const active = { ...ctx, training: 'active' as const };
    const paused = { ...ctx, training: 'paused' as const };

    it.each([
      ['treino', { type: 'training', action: 'start' }],
      ['Reiniciar treino', { type: 'training', action: 'restart' }],
      ['continuar treino', { type: 'training', action: 'resume' }],
      ['sair do treino', { type: 'training', action: 'skip' }],
      ['pausar treino', { type: 'training', action: 'pause' }],
      ['ajuda treino', { type: 'help', topic: 'treino' }],
    ])('%s vale a qualquer momento', (text, expected) => {
      expect(parseRules(text, ctx)).toEqual(expected);
    });

    it('comandos curtos só valem com o treino em curso', () => {
      for (const word of ['depois', 'pular', 'próximo']) {
        expect(parseRules(word, ctx)).toBeNull();
      }
      expect(parseRules('depois', active)).toEqual({ type: 'training', action: 'pause' });
      expect(parseRules('Pular', active)).toEqual({ type: 'training', action: 'skip' });
      expect(parseRules('próximo', active)).toEqual({ type: 'training', action: 'next' });
      expect(parseRules('continuar', paused)).toEqual({ type: 'training', action: 'resume' });
      expect(parseRules('continuar', active)).toBeNull();
    });

    it('"Treino: ..." cria a tarefa de treino só durante o treino', () => {
      expect(parseRules('Treino: regar as plantas amanhã', active)).toEqual({
        type: 'create_task',
        title: 'Regar as plantas',
        date: '2026-10-27',
      });
      expect(parseRules('Treino: regar as plantas amanhã', ctx)).toBeNull();
    });
  });
});
