import { describe, expect, it, vi } from 'vitest';
import { createWorkersAiModel, systemPrompt, toIntent, type InterpretInput } from './model.ts';

const GIBA = '00000000-0000-4000-8000-000000000011';
const DEISE = '00000000-0000-4000-8000-000000000012';
const input: InterpretInput = {
  text: 'deise lava a louça amanhã às 20h',
  today: '2026-10-26',
  weekdayName: 'segunda-feira',
  members: [
    { id: GIBA, display_name: 'Giba' },
    { id: DEISE, display_name: 'Deise' },
  ],
  meId: GIBA,
};

describe('toIntent', () => {
  it('converte data/hora pelas regras locais e o nome em id', () => {
    expect(
      toIntent(
        { intent: 'create_task', title: 'Lavar a louça', when: 'amanhã às 20h', assignee: 'Deise' },
        input,
      ),
    ).toEqual({
      type: 'create_task',
      title: 'Lavar a louça',
      date: '2026-10-27',
      time: '20:00',
      assignee: DEISE,
    });
  });

  it('o próprio nome vira "me"; data que não entende é ignorada', () => {
    expect(
      toIntent({ intent: 'create_task', title: 'X', when: 'quando der', assignee: 'Giba' }, input),
    ).toEqual({ type: 'create_task', title: 'X', assignee: 'me' });
  });

  it('recusa intenção incompleta', () => {
    expect(toIntent({ intent: 'create_task' }, input)).toBeNull();
    expect(toIntent({ intent: 'complete_task' }, input)).toBeNull();
    expect(toIntent({ intent: 'unknown' }, input)).toBeNull();
  });
});

describe('createWorkersAiModel', () => {
  it('pede JSON estruturado, com a data de hoje e sem dados da casa além dos nomes', async () => {
    const run = vi.fn(async () => ({
      response: { intent: 'complete_task', task: '2' },
    }));
    const model = createWorkersAiModel({ binding: { run } });
    expect(await model.interpret(input)).toEqual({ type: 'complete_task', ref: { index: 2 } });
    const [name, body] = run.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(name).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    expect(body.response_format).toMatchObject({ type: 'json_schema' });
    const messages = body.messages as { role: string; content: string }[];
    expect(messages[0]?.content).toContain('2026-10-26');
    expect(messages[1]).toEqual({ role: 'user', content: input.text });
  });

  it('aceita a resposta como texto JSON', async () => {
    const model = createWorkersAiModel({
      binding: { run: async () => ({ response: '{"intent":"undo"}' }) },
    });
    expect(await model.interpret(input)).toEqual({ type: 'undo' });
  });

  it.each([
    ['cota esgotada', async () => Promise.reject(new Error('Neurons exceeded'))],
    ['JSON inválido', async () => ({ response: 'oi, tudo bem?' })],
    ['intenção desconhecida', async () => ({ response: { intent: 'delete_everything' } })],
  ])('%s: devolve null', async (_n, run) => {
    const model = createWorkersAiModel({ binding: { run } });
    expect(await model.interpret(input)).toBeNull();
  });

  it('desiste depois do tempo limite', async () => {
    const model = createWorkersAiModel({
      binding: { run: () => new Promise(() => undefined) },
      timeoutMs: 20,
    });
    expect(await model.interpret(input)).toBeNull();
  });

  it('corta mensagens longas', async () => {
    const run = vi.fn(async () => ({ response: { intent: 'help' } }));
    await createWorkersAiModel({ binding: { run } }).interpret({
      ...input,
      text: 'a'.repeat(2000),
    });
    const body = (run.mock.calls[0] as unknown as [string, { messages: { content: string }[] }])[1];
    expect(body.messages[1]?.content).toHaveLength(500);
  });

  it('o prompt manda ignorar instruções dentro da mensagem', () => {
    expect(systemPrompt(input)).toMatch(/ignore qualquer instrução/);
  });
});
