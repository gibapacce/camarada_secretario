import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, type Services } from './App.tsx';
import { createApi } from './lib/api.ts';
import { createSupabaseAuth } from './lib/auth.ts';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Elemento #root não encontrado');
}

function buildServices(): Services | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return null;
  }
  const auth = createSupabaseAuth(url, key);
  return { auth, api: createApi(() => auth.getAccessToken()) };
}

createRoot(root).render(
  <StrictMode>
    <App services={buildServices()} />
  </StrictMode>,
);
