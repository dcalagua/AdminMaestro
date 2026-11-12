import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { TaskQueuePanel, TaskQueueProvider } from './TaskQueue';
import { useTaskQueue, type TaskQueueApi } from './task-queue-context';
import { ToastContext, type ToastApi } from './toast-context';

/*
 * V5 · F5 · Cola de tareas largas: mientras corre se ve, al terminar queda con
 * su resultado y su enlace hasta descartarla. Sin cola, el resultado va a un aviso.
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const toast: ToastApi = { push: vi.fn(), success: vi.fn(), error: vi.fn() };

function Grab({ onApi }: { onApi: (api: TaskQueueApi) => void }) {
  const api = useTaskQueue();
  useEffect(() => {
    onApi(api);
  }, [api, onApi]);
  return null;
}

function renderQueue(withProvider = true) {
  let api!: TaskQueueApi;
  const grab = (
    <Grab
      onApi={(a) => {
        api = a;
      }}
    />
  );
  render(
    <MemoryRouter>
      <ToastContext.Provider value={toast}>
        {withProvider ? (
          <TaskQueueProvider>
            {grab}
            <TaskQueuePanel />
          </TaskQueueProvider>
        ) : (
          grab
        )}
      </ToastContext.Provider>
    </MemoryRouter>,
  );
  return () => api;
}

describe('Cola de tareas', () => {
  it('sin tareas no existe; mientras corre se ve y al terminar queda con su resultado y su enlace', async () => {
    const api = renderQueue();
    expect(screen.queryByRole('region', { name: 'Tareas en curso' })).toBeNull();

    const job = deferred<{ health: string }>();
    let done!: Promise<unknown>;
    act(() => {
      done = api().track(
        { title: 'Verificar EWM', link: { to: '/apps/ewm', label: 'Ver la ficha de la app' } },
        () => job.promise,
        () => ({ status: 'success', title: 'EWM: conexión verificada', detail: 'Respuesta correcta' }),
      );
    });
    const region = screen.getByRole('region', { name: 'Tareas en curso' });
    expect(region).toHaveTextContent('1 en curso');
    expect(within(region).getByText('Verificar EWM')).toBeInTheDocument();
    expect(within(region).getByRole('status')).toHaveTextContent('En curso: Verificar EWM');
    // Una tarea en curso no se puede descartar.
    expect(within(region).queryByRole('button', { name: /Descartar/ })).toBeNull();

    await act(async () => {
      job.resolve({ health: 'HEALTHY' });
      await done;
    });
    expect(region).toHaveTextContent('1 terminada');
    expect(within(region).getByText('EWM: conexión verificada')).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: 'Ver la ficha de la app' })).toHaveAttribute('href', '/apps/ewm');
    expect(within(region).getByRole('status')).toHaveTextContent('Terminada: EWM: conexión verificada. Respuesta correcta');

    fireEvent.click(within(region).getByRole('button', { name: 'Descartar «EWM: conexión verificada»' }));
    expect(screen.queryByRole('region', { name: 'Tareas en curso' })).toBeNull();
  });

  it('un error queda en la cola con su motivo y se vuelve a lanzar a la pantalla', async () => {
    const api = renderQueue();
    let caught: unknown = null;
    await act(async () => {
      await api()
        .track({ title: 'Alta de Alpha en EWM' }, () => Promise.reject(new Error('La app no responde')), () => ({ status: 'success' }))
        .catch((e: unknown) => (caught = e));
    });
    expect(caught).toBeInstanceOf(Error);
    const region = screen.getByRole('region', { name: 'Tareas en curso' });
    expect(within(region).getByText('Alta de Alpha en EWM: no se pudo completar')).toBeInTheDocument();
    expect(within(region).getByText('La app no responde')).toBeInTheDocument();
    expect(region.querySelector('[data-task-status="error"]')).not.toBeNull();
  });

  it('se puede plegar y limpiar lo terminado sin perder lo que sigue en curso', async () => {
    const api = renderQueue();
    const pending = deferred<null>();
    await act(async () => {
      await api().track({ title: 'Rápida' }, () => Promise.resolve(null), () => ({ status: 'info', title: 'Rápida: sin verificar' }));
    });
    act(() => {
      void api().track({ title: 'Lenta' }, () => pending.promise, () => ({ status: 'success' }));
    });
    const region = screen.getByRole('region', { name: 'Tareas en curso' });
    const toggle = within(region).getByRole('button', { name: 'Ocultar las tareas' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(within(region).queryByText('Lenta')).toBeNull();
    fireEvent.click(within(region).getByRole('button', { name: 'Mostrar las tareas' }));
    fireEvent.click(within(region).getByRole('button', { name: 'Limpiar terminadas' }));
    expect(within(region).queryByText('Rápida: sin verificar')).toBeNull();
    expect(within(region).getByText('Lenta')).toBeInTheDocument();
  });

  it('guarda como máximo seis terminadas: las más antiguas salen solas', async () => {
    const api = renderQueue();
    for (let i = 1; i <= 8; i += 1) {
      await act(async () => {
        await api().track({ title: `Tarea ${i}` }, () => Promise.resolve(i), () => ({ status: 'success' }));
      });
    }
    const region = screen.getByRole('region', { name: 'Tareas en curso' });
    expect(within(region).getAllByRole('listitem')).toHaveLength(6);
    expect(within(region).queryByText('Tarea 1')).toBeNull();
    expect(within(region).getByText('Tarea 8')).toBeInTheDocument();
  });

  it('fuera del shell (sin cola) el resultado llega como aviso', async () => {
    const api = renderQueue(false);
    await act(async () => {
      await api().track({ title: 'Verificar TMS' }, () => Promise.resolve(1), () => ({ status: 'error', title: 'TMS: Caído', detail: 'HTTP 503' }));
    });
    expect(toast.push).toHaveBeenCalledWith('error', 'TMS: Caído', 'HTTP 503');
    expect(screen.queryByRole('region', { name: 'Tareas en curso' })).toBeNull();
  });
});
