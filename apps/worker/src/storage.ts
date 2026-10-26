import { DomainError } from '@camarada/db';

export interface PhotoStorage {
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  /** URLs temporárias de leitura, por caminho. Caminhos sem URL ficam fora do mapa. */
  sign(paths: string[], expiresInSeconds: number): Promise<Map<string, string>>;
}

export interface SupabaseStorageOptions {
  url: string;
  serviceKey: string;
  bucket: string;
  fetch?: typeof fetch;
}

/** Supabase Storage via REST, com a chave secreta. Use somente no servidor. */
export class SupabaseStorage implements PhotoStorage {
  readonly #base: string;
  readonly #bucket: string;
  readonly #headers: Record<string, string>;
  readonly #fetch: typeof fetch;

  constructor(o: SupabaseStorageOptions) {
    this.#base = `${o.url.replace(/\/+$/, '')}/storage/v1`;
    this.#bucket = o.bucket;
    this.#headers = { apikey: o.serviceKey };
    if (o.serviceKey.startsWith('eyJ')) {
      this.#headers.authorization = `Bearer ${o.serviceKey}`;
    }
    this.#fetch = o.fetch ?? ((input, init) => fetch(input, init));
  }

  async #request(path: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.#fetch(`${this.#base}${path}`, {
        ...init,
        headers: { ...this.#headers, ...(init.headers as Record<string, string>) },
      });
    } catch {
      throw new DomainError('storage_unavailable');
    }
    if (!res.ok) {
      console.warn('storage_error', res.status);
      throw new DomainError('storage_unavailable');
    }
    return res;
  }

  async upload(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.#request(`/object/${this.#bucket}/${path}`, {
      method: 'POST',
      headers: {
        'content-type': contentType,
        'x-upsert': 'false',
        'cache-control': 'max-age=3600',
      },
      body: bytes,
    });
  }

  async remove(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.#request(`/object/${this.#bucket}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefixes: paths }),
    });
  }

  async sign(paths: string[], expiresInSeconds: number): Promise<Map<string, string>> {
    const urls = new Map<string, string>();
    if (paths.length === 0) return urls;
    const res = await this.#request(`/object/sign/${this.#bucket}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expiresIn: expiresInSeconds, paths }),
    });
    const items = (await res.json().catch(() => [])) as {
      path?: string;
      signedURL?: string | null;
    }[];
    for (const item of Array.isArray(items) ? items : []) {
      if (item.path && item.signedURL) {
        urls.set(item.path, `${this.#base}${item.signedURL}`);
      }
    }
    return urls;
  }
}

/** Tipo real pela assinatura dos bytes; o content-type enviado pelo navegador é ignorado. */
export function detectImageType(
  bytes: Uint8Array,
): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const at = (i: number) => bytes[i];
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    return 'image/jpeg';
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => at(i) === b)) {
    return 'image/png';
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}
