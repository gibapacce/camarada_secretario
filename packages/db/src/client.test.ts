import { describe, expect, it, vi } from 'vitest';
import { DomainError, PostgrestDbClient, toDomainError } from './client.ts';

const SECRET = 'sb_secret_TESTE_nao_e_real';
const JWT_KEY = 'eyJhbGciOiJIUzI1NiJ9.teste.assinatura';

function mockFetch(status: number, body: unknown) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
}

describe('PostgrestDbClient', () => {
  it('chama /rest/v1/rpc com argumentos nomeados e chave nova só em apikey', async () => {
    const fetchMock = mockFetch(200, { ok: true });
    const client = new PostgrestDbClient({
      url: 'https://exemplo.supabase.co/',
      serviceKey: SECRET,
      fetch: fetchMock,
    });

    expect(await client.call('get_task', { p_household_id: 'h', p_task_id: 't' })).toEqual({
      ok: true,
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://exemplo.supabase.co/rest/v1/rpc/get_task');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'content-type': 'application/json', apikey: SECRET });
    expect(JSON.parse(String(init?.body))).toEqual({ p_household_id: 'h', p_task_id: 't' });
  });

  it('envia Authorization apenas para chave legada (JWT)', async () => {
    const fetchMock = mockFetch(200, {});
    await new PostgrestDbClient({ url: 'https://x', serviceKey: JWT_KEY, fetch: fetchMock }).call(
      'list_tasks',
      {},
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: `Bearer ${JWT_KEY}`,
    });
  });

  it('omite argumentos undefined para usar os padrões do SQL', async () => {
    const fetchMock = mockFetch(200, {});
    await new PostgrestDbClient({ url: 'https://x', serviceKey: SECRET, fetch: fetchMock }).call(
      'list_tasks',
      { p_household_id: 'h', p_view: undefined },
    );
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toBe('{"p_household_id":"h"}');
  });

  it('converte erro de negócio do banco em DomainError', async () => {
    const client = new PostgrestDbClient({
      url: 'https://x',
      serviceKey: SECRET,
      fetch: mockFetch(400, { code: 'P0001', message: 'forbidden', details: '' }),
    });
    await expect(client.call('create_task', {})).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('não vaza detalhes internos nem a chave em erros inesperados', async () => {
    const client = new PostgrestDbClient({
      url: 'https://x',
      serviceKey: SECRET,
      fetch: mockFetch(500, { code: 'XX000', message: `internal ${SECRET}` }),
    });
    const error = await client.call('create_task', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: 'db_error' });
    expect(String((error as Error).message)).not.toContain(SECRET);
  });

  it('informa indisponibilidade quando a rede falha', async () => {
    const client = new PostgrestDbClient({
      url: 'https://x',
      serviceKey: SECRET,
      fetch: vi.fn<typeof fetch>(async () => {
        throw new TypeError('network down');
      }),
    });
    await expect(client.call('list_tasks', {})).rejects.toMatchObject({ code: 'db_unavailable' });
  });

  it('recusa função fora da lista permitida', async () => {
    const fetchMock = mockFetch(200, {});
    const client = new PostgrestDbClient({
      url: 'https://x',
      serviceKey: SECRET,
      fetch: fetchMock,
    });
    await expect(client.call('drop_everything' as never, {})).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('toDomainError', () => {
  it.each([
    [{ code: 'P0001', message: 'invalid_assignee' }, 'invalid_assignee'],
    [{ code: 'P0001', message: 'Mensagem com espaços' }, 'db_error'],
    [{ code: '23514', message: 'check' }, 'invalid_input'],
    [{ code: '22P02', message: 'uuid' }, 'invalid_input'],
    [null, 'db_error'],
  ])('%j → %s', (input, code) => {
    expect(toDomainError(input).code).toBe(code);
  });
});
