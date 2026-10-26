import type { PanelEvent, PanelText } from '@camarada/persona';
import { createContext, useContext, useEffect, useState } from 'react';
import type { Api, MemberContext, PersonaIntensity, TaskResult } from './api.ts';

export interface ActionOptions {
  undoable?: boolean;
  onDone?: (result: TaskResult) => void;
}

export interface AppContextValue {
  api: Api;
  me: MemberContext;
  text: PanelText;
  intensity: PersonaIntensity;
  tz: string;
  /** Muda depois de cada alteração; inclua nas dependências das consultas. */
  version: number;
  refresh(): void;
  memberName(id: string | null): string;
  /** Verdadeiro enquanto uma alteração está em andamento (desabilita os botões). */
  pending: boolean;
  runAction(
    fn: (key: string) => Promise<TaskResult>,
    event: PanelEvent,
    options?: ActionOptions,
  ): Promise<void>;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('AppContext ausente');
  }
  return ctx;
}

/** Carrega dados quando `load` muda (memorize com useCallback); mantém o último resultado durante a recarga. */
export function useLoad<T>(load: () => Promise<T>) {
  const [state, setState] = useState<{ load: () => Promise<T>; data?: T; error?: unknown } | null>(
    null,
  );

  useEffect(() => {
    let alive = true;
    load().then(
      (data) => alive && setState({ load, data }),
      (error: unknown) =>
        alive &&
        setState((prev) => ({ load, error, ...(prev?.data !== undefined && { data: prev.data }) })),
    );
    return () => {
      alive = false;
    };
  }, [load]);

  const loading = state?.load !== load;
  return { data: state?.data, error: loading ? undefined : state?.error, loading };
}
