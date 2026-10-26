import {
  PostgrestDbClient,
  createMemberService,
  createPhotoService,
  createTaskService,
} from '@camarada/db';
import { handleApi, type ApiDeps } from './api.ts';
import { getTokenVerifier } from './auth.ts';
import { SupabaseStorage } from './storage.ts';

export interface Env {
  ASSETS: Fetcher;
  APP_ENV: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  PHOTO_MAX_BYTES?: string;
}

/** Sem SUPABASE_URL/SUPABASE_SECRET_KEY a API responde 503 (exceto /api/health). */
export function buildDeps(env: Env): ApiDeps | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    return null;
  }
  const db = new PostgrestDbClient({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SECRET_KEY });
  const maxPhotoBytes = Number(env.PHOTO_MAX_BYTES);
  return {
    tasks: createTaskService(db),
    members: createMemberService(db),
    photos: createPhotoService(db),
    storage: new SupabaseStorage({
      url: env.SUPABASE_URL,
      serviceKey: env.SUPABASE_SECRET_KEY,
      bucket: 'task-photos',
    }),
    verifyToken: getTokenVerifier(env.SUPABASE_URL),
    ...(Number.isInteger(maxPhotoBytes) && maxPhotoBytes > 0 && { maxPhotoBytes }),
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
