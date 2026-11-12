import { createContext, useContext, useMemo } from 'react';
import { useToast } from './toast-context';
import { businessErrorMessage } from '@/lib/pgError';

/**
 * Cola de tareas en curso (V5 · F5): las operaciones largas (ejecutar un alta,
 * verificar la salud de una app) se ven mientras corren y, al terminar, se
 * quedan con su resultado y su enlace hasta que alguien las descarta.
 *
 * El contexto y el hook viven aparte de `TaskQueue.tsx` (mismo motivo que
 * `toast-context.ts`: Fast Refresh). Fuera del shell, sin proveedor, el hook
 * cae a un aviso (toast) con el resultado, así una pantalla suelta o un test
 * siguen funcionando igual que antes.
 */
export type TaskStatus = 'running' | 'success' | 'error' | 'info';

export interface TaskLink {
  to: string;
  label: string;
}

export interface TaskResult {
  status: Exclude<TaskStatus, 'running'>;
  /** Título final; si falta, se conserva el de la tarea. */
  title?: string;
  detail?: string;
  link?: TaskLink;
}

export interface TaskSpec {
  title: string;
  detail?: string;
  /** Dónde ver el resultado (también mientras corre). */
  link?: TaskLink;
}

export interface TaskEntry extends TaskSpec {
  id: number;
  status: TaskStatus;
  startedAt: number;
  finishedAt?: number;
}

export interface TaskQueueApi {
  /**
   * Ejecuta `run` como una tarea visible. El resultado se describe con
   * `outcome`; un error queda en la cola (o con `onError`) y se vuelve a lanzar
   * para que la pantalla pueda reaccionar (p. ej. marcar la fila).
   */
  track: <T>(
    spec: TaskSpec,
    run: () => Promise<T>,
    outcome: (value: T) => TaskResult,
    onError?: (error: unknown) => TaskResult,
  ) => Promise<T>;
}

export interface TaskQueueStore extends TaskQueueApi {
  tasks: TaskEntry[];
  dismiss: (id: number) => void;
  clearFinished: () => void;
}

export const TaskQueueContext = createContext<TaskQueueStore | null>(null);

export function defaultErrorResult(spec: TaskSpec, error: unknown): TaskResult {
  return { status: 'error', title: `${spec.title}: no se pudo completar`, detail: businessErrorMessage(error) };
}

export function useTaskQueue(): TaskQueueApi {
  const queue = useContext(TaskQueueContext);
  // Siempre se pide (regla de hooks); las pantallas viven dentro de <ToastProvider>.
  const toast = useToast();
  return useMemo<TaskQueueApi>(() => {
    if (queue) return queue;
    // Sin cola (pantalla fuera del shell): el resultado llega como aviso.
    return {
      track: async (spec, run, outcome, onError) => {
        try {
          const value = await run();
          const r = outcome(value);
          toast.push(r.status, r.title ?? spec.title, r.detail);
          return value;
        } catch (error) {
          const r = onError ? onError(error) : defaultErrorResult(spec, error);
          toast.push(r.status, r.title ?? spec.title, r.detail);
          throw error;
        }
      },
    };
  }, [queue, toast]);
}
