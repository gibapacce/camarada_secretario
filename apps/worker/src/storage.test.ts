import { describe, expect, it, vi } from 'vitest';
import { SupabaseStorage, detectImageType } from './storage.ts';

describe('detectImageType', () => {
  it.each([
    ['JPEG', [0xff, 0xd8, 0xff, 0xdb], 'image/jpeg'],
    ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png'],
    [
      'WEBP',
      [...'RIFF']
        .map((c) => c.charCodeAt(0))
        .concat(
          [0, 0, 0, 0],
          [...'WEBP'].map((c) => c.charCodeAt(0)),
        ),
      'image/webp',
    ],
    ['GIF', [...'GIF89a'].map((c) => c.charCodeAt(0)), null],
    ['SVG', [...'<svg xmlns'].map((c) => c.charCodeAt(0)), null],
    ['vazio', [], null],
  ])('%s', (_name, bytes, expected) => {
    expect(detectImageType(new Uint8Array(bytes))).toBe(expected);
  });
});

describe('SupabaseStorage', () => {
  function setup(responses: Response[]) {
    const f = vi.fn<typeof fetch>(() => Promise.resolve(responses.shift() ?? new Response('{}')));
    const s = new SupabaseStorage({
      url: 'https://abc.supabase.co/',
      serviceKey: 'sb_secret_x',
      bucket: 'task-photos',
      fetch: f,
    });
    return { s, f };
  }

  it('envia sem sobrescrever, com a chave só no cabeçalho apikey', async () => {
    const { s, f } = setup([new Response('{}')]);
    await s.upload('h/t/p.jpg', new Uint8Array([1]), 'image/jpeg');
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe('https://abc.supabase.co/storage/v1/object/task-photos/h/t/p.jpg');
    expect(init?.headers).toMatchObject({
      apikey: 'sb_secret_x',
      'content-type': 'image/jpeg',
      'x-upsert': 'false',
    });
    expect(init?.headers).not.toHaveProperty('authorization');
  });

  it('assina vários caminhos em uma chamada', async () => {
    const { s, f } = setup([
      Response.json([
        { path: 'a.jpg', signedURL: '/object/sign/task-photos/a.jpg?token=1', error: null },
        { path: 'b.jpg', signedURL: null, error: 'Not found' },
      ]),
    ]);
    const urls = await s.sign(['a.jpg', 'b.jpg'], 900);
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body))).toEqual({
      expiresIn: 900,
      paths: ['a.jpg', 'b.jpg'],
    });
    expect([...urls]).toEqual([
      ['a.jpg', 'https://abc.supabase.co/storage/v1/object/sign/task-photos/a.jpg?token=1'],
    ]);
  });

  it('remove por lista de caminhos', async () => {
    const { s, f } = setup([Response.json([])]);
    await s.remove(['a.jpg']);
    expect(f.mock.calls[0]?.[0]).toBe('https://abc.supabase.co/storage/v1/object/task-photos');
    expect(f.mock.calls[0]?.[1]?.method).toBe('DELETE');
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body))).toEqual({ prefixes: ['a.jpg'] });
  });

  it('falhas viram storage_unavailable', async () => {
    const { s } = setup([new Response('erro', { status: 500 })]);
    await expect(s.upload('x.jpg', new Uint8Array([1]), 'image/jpeg')).rejects.toMatchObject({
      code: 'storage_unavailable',
    });
  });
});
