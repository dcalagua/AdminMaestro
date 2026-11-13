import { useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CaretDownIcon, CaretUpIcon, CheckCircleIcon, InfoIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import {
  TaskQueueContext,
  defaultErrorResult,
  type TaskEntry,
  type TaskQueueStore,
  type TaskResult,
  type TaskStatus,
} from './task-queue-context';

/**
 * Cola visible de tareas en curso (V5 · F5), en el shell.
 *
 * Una operación larga deja de ser sólo un aviso que se va a los 6 s: mientras
 * corre se ve aquí, con su nombre; al terminar queda con su resultado y su
 * enlace hasta que la persona la descarta. Las terminadas más antiguas salen
 * solas cuando hay más de `MAX_FINISHED`. Los cambios se anuncian a lectores
 * de pantalla en una región `status`.
 */
const MAX_FINISHED = 6;

export function TaskQueueProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const nextId = useRef(1);

  const finish = useCallback((id: number, result: TaskResult) => {
    setTasks((current) => {
      const next = current.map((t) =>
        t.id === id
          ? {
              ...t,
              status: result.status,
              title: result.title ?? t.title,
              detail: result.detail ?? t.detail,
              link: result.link ?? t.link,
              finishedAt: Date.now(),
            }
          : t,
      );
      const finished = next.filter((t) => t.status !== 'running');
      if (finished.length <= MAX_FINISHED) return next;
      const drop = new Set(
        [...finished].sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0)).slice(0, finished.length - MAX_FINISHED).map((t) => t.id),
      );
      return next.filter((t) => !drop.has(t.id));
    });
  }, []);

  const track = useCallback<TaskQueueStore['track']>(
    async (spec, run, outcome, onError) => {
      const id = nextId.current++;
      setTasks((current) => [...current, { ...spec, id, status: 'running', startedAt: Date.now() }]);
      try {
        const value = await run();
        finish(id, outcome(value));
        return value;
      } catch (error) {
        finish(id, onError ? onError(error) : defaultErrorResult(spec, error));
        throw error;
      }
    },
    [finish],
  );

  const dismiss = useCallback((id: number) => setTasks((current) => current.filter((t) => t.id !== id)), []);
  const clearFinished = useCallback(() => setTasks((current) => current.filter((t) => t.status === 'running')), []);

  const store = useMemo<TaskQueueStore>(() => ({ tasks, track, dismiss, clearFinished }), [tasks, track, dismiss, clearFinished]);
  return <TaskQueueContext.Provider value={store}>{children}</TaskQueueContext.Provider>;
}

const STATUS: Record<Exclude<TaskStatus, 'running'>, { Icon: typeof CheckCircleIcon; cls: string; sr: string }> = {
  success: { Icon: CheckCircleIcon, cls: 'text-ok', sr: 'Terminada' },
  error: { Icon: WarningCircleIcon, cls: 'text-danger', sr: 'Falló' },
  info: { Icon: InfoIcon, cls: 'text-info', sr: 'Terminada con aviso' },
};

function announce(task: TaskEntry): string {
  if (task.status === 'running') return `En curso: ${task.title}`;
  return `${STATUS[task.status].sr}: ${task.title}${task.detail ? `. ${task.detail}` : ''}`;
}

/**
 * Panel de la cola. Sin tareas no existe en el DOM. `className` lo coloca el
 * shell (abajo a la izquierda del contenido, para no tapar los avisos).
 */
export function TaskQueuePanel({ className = '' }: { className?: string }) {
  const store = useContext(TaskQueueContext);
  const [collapsed, setCollapsed] = useState(false);
  if (!store || store.tasks.length === 0) return null;
  const { tasks } = store;

  const running = tasks.filter((t) => t.status === 'running').length;
  const finished = tasks.length - running;
  // Lo último que cambió: lo anuncia la región `status`.
  const latest = [...tasks].sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt))[0];
  const summary = running > 0 ? `${running} en curso` : `${finished} terminada${finished === 1 ? '' : 's'}`;

  return (
    <section
      aria-label="Tareas en curso"
      data-print-hide
      data-task-queue
      className={`ebim-toast fixed bottom-4 z-[55] w-[340px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-card border border-border bg-elevated shadow-pop ${className}`}
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        {running > 0 ? <span className="ebim-spinner text-accent-deep" aria-hidden /> : null}
        <h2 className="min-w-0 flex-1 truncate text-compact font-semibold text-fg">
          Tareas <span className="font-normal text-muted">· {summary}</span>
        </h2>
        {finished > 0 ? (
          <button type="button" className="ebim-btn-ghost ebim-btn-sm" onClick={store.clearFinished}>
            Limpiar terminadas
          </button>
        ) : null}
        <button
          type="button"
          className="ebim-icon-btn h-7 w-7"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Mostrar las tareas' : 'Ocultar las tareas'}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? <CaretUpIcon size={14} aria-hidden /> : <CaretDownIcon size={14} aria-hidden />}
        </button>
      </header>
      {collapsed ? null : (
        <ul className="max-h-[min(320px,50vh)] divide-y divide-border overflow-y-auto">
          {[...tasks].reverse().map((t) => {
            const s = t.status === 'running' ? null : STATUS[t.status];
            return (
              <li key={t.id} className="flex items-start gap-2.5 px-3 py-2.5" data-task-status={t.status}>
                {s ? (
                  <s.Icon size={18} weight="fill" className={`mt-px shrink-0 ${s.cls}`} aria-hidden />
                ) : (
                  <span className="ebim-spinner mt-0.5 text-accent-deep" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-compact font-semibold text-fg">
                    <span className="sr-only">{s ? `${s.sr}: ` : 'En curso: '}</span>
                    {t.title}
                  </p>
                  {t.detail ? <p className="mt-0.5 break-words text-caption text-fg-2">{t.detail}</p> : null}
                  {t.status === 'running' ? <p className="mt-0.5 text-caption text-muted">En curso…</p> : null}
                  {t.link ? (
                    <Link to={t.link.to} className="ebim-link mt-1 inline-block text-caption">
                      {t.link.label}
                    </Link>
                  ) : null}
                </div>
                {t.status === 'running' ? null : (
                  <button
                    type="button"
                    className="ebim-icon-btn h-7 w-7"
                    aria-label={`Descartar «${t.title}»`}
                    onClick={() => store.dismiss(t.id)}
                  >
                    <XIcon size={14} weight="bold" aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div role="status" className="sr-only">
        {latest ? announce(latest) : null}
      </div>
    </section>
  );
}
