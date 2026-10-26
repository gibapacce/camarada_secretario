import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface AuthUser {
  id: string;
}

/** Retorna o usuário se o token for válido, ou null. Lança erro só se as chaves estiverem indisponíveis. */
export type TokenVerifier = (token: string) => Promise<AuthUser | null>;

export class AuthUnavailableError extends Error {
  override name = 'AuthUnavailableError';
}

export function createTokenVerifier(options: {
  supabaseUrl: string;
  keys?: JWTVerifyGetKey;
}): TokenVerifier {
  const issuer = `${options.supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
  const keys = options.keys ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer,
        audience: 'authenticated',
        algorithms: ['ES256', 'RS256'],
      });
      if (payload.role !== 'authenticated' || typeof payload.sub !== 'string') {
        return null;
      }
      return { id: payload.sub };
    } catch (error) {
      if (error instanceof errors.JWKSTimeout || !(error instanceof errors.JOSEError)) {
        throw new AuthUnavailableError('Chaves de autenticação indisponíveis');
      }
      return null;
    }
  };
}

const verifiers = new Map<string, TokenVerifier>();

/** Reaproveita o verificador (e o cache das chaves públicas) entre requisições do mesmo isolate. */
export function getTokenVerifier(supabaseUrl: string): TokenVerifier {
  let verifier = verifiers.get(supabaseUrl);
  if (!verifier) {
    verifier = createTokenVerifier({ supabaseUrl });
    verifiers.set(supabaseUrl, verifier);
  }
  return verifier;
}
