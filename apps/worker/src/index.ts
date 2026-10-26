import { PostgrestDbClient, createMemberService, createTaskService } from '@camarada/db';
import { handleApi, type ApiDeps } from './api.ts';
import { getTokenVerifier } from './auth.ts';

export interface Env {
  ASSETS: Fetcher;
  APP_ENV: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
}

/** Sem SUPABASE_URL/SUPABASE_SECRET_KEY a API responde 503 (exceto /api/health). */
export function buildDeps(env: Env): ApiDeps | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    return null;
  }
  const db = new PostgrestDbClient({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SECRET_KEY });
  return {
    tasks: createTaskService(db),
    members: createMemberService(db),
    verifyToken: getTokenVerifier(env.SUPABASE_URL),
  };
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return handleApi(request, buildDeps(env));
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
