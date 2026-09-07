import { createContext, useContext } from 'react';

/**
 * El contexto y el hook viven aparte de `Toast.tsx` para que ese archivo exporte
 * SOLO componentes y Fast Refresh siga funcionando — mismo motivo por el que
 * `auth-context.ts` está separado de `AuthContext.tsx`.
 */
export type ToastTone = 'success' | 'error' | 'info';

export interface ToastApi {
  push: (tone: ToastTone, title: string, detail?: string) => void;
  success: (title: string, detail?: string) => void;
  error: (title: string, detail?: string) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>');
  return ctx;
}
