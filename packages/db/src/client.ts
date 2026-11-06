export const DB_FUNCTIONS = [
  'create_task',
  'complete_task',
  'reopen_task',
  'cancel_task',
  'update_task',
  'undo_last_action',
  'list_tasks',
  'get_task',
  'get_member_context',
  'update_member_preferences',
  'add_task_photo',
  'delete_task_photo',
  'get_assistant_state',
  'set_assistant_state',
] as const;
export type DbFunction = (typeof DB_FUNCTIONS)[number];

/** Chama uma função SQL por nome com argumentos nomeados (p_*). */
export interface DbClient {
  call(fn: DbFunction, args: Record<string, unknown>): Promise<unknown>;
}

/** Erro de domínio com código estável, seguro para mostrar ao usuário via persona. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

interface PgErrorLike {
  code?: unknown;
  message?: unknown;
}

/** Converte erros do Postgres/PostgREST em DomainError sem vazar detalhes internos. */
export function toDomainError(error: unknown): DomainError {
  const e = (error ?? {}) as PgErrorLike;
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message : '';
  if (code === 'P0001' && /^[a-z_]+$/.test(message)) {
    return new DomainError(message);
  }
  // Violação de check/not null/fk/formato: entrada inválida que escapou da validação.
  if (/^(23502|23503|23514|22P02|22007|22008|22023)$/.test(code)) {
    return new DomainError('invalid_input');
  }
  return new DomainError('db_error', 'Falha ao acessar o banco de dados');
}

export interface PostgrestOptions {
  url: string;
  serviceKey: string;
  fetch?: typeof fetch;
}

/** Cliente para o Supabase via PostgREST (/rest/v1/rpc). Use somente no servidor. */
export class PostgrestDbClient implements DbClient {
  readonly #url: string;
  readonly #serviceKey: string;
  readonly #fetch: typeof fetch;

  constructor(options: PostgrestOptions) {
    this.#url = options.url.replace(/\/+$/, '');
    this.#serviceKey = options.serviceKey;
    // Wrapper evita "Illegal invocation" ao chamar fetch desacoplado no runtime Workers.
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async call(fn: DbFunction, args: Record<string, unknown>): Promise<unknown> {
    if (!DB_FUNCTIONS.includes(fn)) {
      throw new DomainError('invalid_input', 'Função desconhecida');
    }
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      apikey: this.#serviceKey,
    };
    // Chaves legadas (JWT) também exigem Authorization; chaves novas (sb_secret_) usam só apikey.
    if (this.#serviceKey.startsWith('eyJ')) {
      headers.authorization = `Bearer ${this.#serviceKey}`;
    }

    let response: Response;
    try {
      response = await this.#fetch(`${this.#url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(args),
      });
    } catch {
      throw new DomainError('db_unavailable', 'Banco de dados indisponível');
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw toDomainError(body);
    }
    return body;
  }
}
