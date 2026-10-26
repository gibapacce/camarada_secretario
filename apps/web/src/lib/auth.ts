import { AuthClient } from '@supabase/auth-js';

export interface AuthPort {
  getAccessToken(): Promise<string | null>;
  /** Chama `cb` com o estado atual e a cada mudança; retorna a função de cancelamento. */
  subscribe(cb: (signedIn: boolean) => void): () => void;
  signIn(email: string, password: string): Promise<{ error: string | null }>;
  signOut(): Promise<void>;
}

export function createSupabaseAuth(url: string, publishableKey: string): AuthPort {
  const client = new AuthClient({
    url: `${url.replace(/\/+$/, '')}/auth/v1`,
    headers: { apikey: publishableKey },
    storageKey: 'camarada-auth',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  });

  return {
    async getAccessToken() {
      const { data } = await client.getSession();
      return data.session?.access_token ?? null;
    },
    subscribe(cb) {
      const { data } = client.onAuthStateChange((_event, session) => cb(session !== null));
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      const { error } = await client.signInWithPassword({ email, password });
      if (!error) {
        return { error: null };
      }
      return {
        error:
          error.status === 400
            ? 'E-mail ou senha incorretos.'
            : 'Não foi possível entrar agora. Tente de novo.',
      };
    },
    async signOut() {
      await client.signOut();
    },
  };
}
