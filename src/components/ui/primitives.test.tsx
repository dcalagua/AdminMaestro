import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  KpiTile,
  LoadingState,
  PageContainer,
  StatCard,
} from './primitives';
import { Sparkline } from './Sparkline';
import { PagedList } from './TablePager';
import { ToastProvider } from './Toast';
import { useToast } from './toast-context';

/* Primitivos V2 (VISUAL_SYSTEM_V2 §5.4–5.14). */

describe('KpiTile', () => {
  it('pinta la moneda como prefijo y el valor sin color semántico (A09)', () => {
    render(<KpiTile label="MRR" value="50.1 K" currency="USD" tone="danger" />);
    const value = screen.getByText('50.1 K');
    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(value.className).not.toMatch(/text-(ok|warn|danger)/);
    // El estado viaja como icono + texto, no como color de la cifra.
    expect(screen.getByText('Crítico')).toHaveClass('sr-only');
  });

  it('sin dato muestra «—» y nunca un 0 (A04)', () => {
    render(<KpiTile label="Cobrado" value={null} currency="USD" footer="Sin cobros en el período" />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('USD')).toBeNull();
    expect(screen.getByText('Sin cobros en el período')).toBeInTheDocument();
  });

  it('la variación lleva flecha, signo y tono según si subir es bueno', () => {
    const { rerender } = render(
      <KpiTile label="MRR" value="50 K" delta={{ value: 0.041, comparison: 'vs ago' }} />,
    );
    expect(screen.getByText('+4.1%')).toHaveClass('text-ok');
    expect(screen.getByText('vs ago')).toBeInTheDocument();

    // Cartera vencida que sube = malo.
    rerender(<KpiTile label="Vencida" value="5 K" delta={{ value: 0.12, goodWhen: 'down' }} />);
    expect(screen.getByText('+12.0%')).toHaveClass('text-danger');

    rerender(<KpiTile label="Clientes" value="48" delta={{ value: 0, kind: 'number' }} />);
    expect(screen.getByText('0')).toHaveClass('text-muted');
  });

  it('con tendencia dibuja la sparkline con su descripción accesible', () => {
    render(
      <KpiTile label="MRR" value="50 K" trend={[1, 2, 3, 4]} trendDescription="Tendencia 12 meses: de 1 a 4" />,
    );
    expect(screen.getByTestId('sparkline')).toBeInTheDocument();
    expect(screen.getByText('Tendencia 12 meses: de 1 a 4')).toHaveClass('sr-only');
  });

  it('carga como skeleton ocupado y error con reintento', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { rerender, container } = render(<KpiTile label="MRR" value="1" loading />);
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Cargando MRR…');

    rerender(<KpiTile label="MRR" value="1" error={new Error('x')} onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('No disponible');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('con `to` todo el tile es el enlace al detalle', () => {
    render(
      <MemoryRouter>
        <KpiTile label="Clientes activos" value="48" to="/customers" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /Clientes activos/ })).toHaveAttribute('href', '/customers');
  });

  it('StatCard (compatibilidad) delega en KpiTile con la ayuda como pie', () => {
    render(<StatCard label="Tenants" value="12" hint="Por producto" tone="ok" />);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Por producto')).toBeInTheDocument();
    expect(screen.getByText('En buen estado')).toBeInTheDocument();
  });
});

describe('Sparkline', () => {
  it('no dibuja nada con menos de 2 puntos', () => {
    const { container } = render(<Sparkline data={[5]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('ignora huecos y es decorativa para el lector (aria-hidden)', () => {
    render(<Sparkline data={[1, null, 3, 2]} />);
    const svg = screen.getByTestId('sparkline').querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg.querySelector('path')!.getAttribute('d')!.match(/[ML]/g)).toHaveLength(3);
  });
});

describe('Badge', () => {
  it('con punto mantiene el texto (nunca solo color)', () => {
    render(<Badge tone="ok" dot>Activa</Badge>);
    const badge = screen.getByText('Activa');
    expect(badge.querySelector('[aria-hidden]')).not.toBeNull();
    expect(badge).toHaveClass('bg-ok-soft');
  });
});

describe('LoadingState', () => {
  it('por defecto es un skeleton de tabla ocupado con texto solo para lector', () => {
    const { container } = render(<LoadingState label="Cargando clientes…" />);
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
    expect(container.firstElementChild).toHaveAttribute('data-loading', 'table');
    expect(screen.getByRole('status')).toHaveTextContent('Cargando clientes…');
    expect(screen.getByRole('status')).toHaveClass('sr-only');
    expect(container.querySelectorAll('.ebim-skeleton').length).toBeGreaterThan(6);
  });

  it('las variantes cambian la forma; inline muestra el texto', () => {
    const { container, rerender } = render(<LoadingState variant="chart" />);
    expect(container.firstElementChild).toHaveAttribute('data-loading', 'chart');
    rerender(<LoadingState variant="inline" label="Comprobando…" />);
    expect(screen.getByRole('status')).not.toHaveClass('sr-only');
  });
});

describe('EmptyState y ErrorState', () => {
  it('vacío con ilustración decorativa y acción', () => {
    const { container } = render(
      <EmptyState title="Sin clientes" description="Crea el primero." action={<button type="button">Nuevo cliente</button>} />,
    );
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Sin clientes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo cliente' })).toBeInTheDocument();
  });

  it('el error se traduce y deja el texto técnico plegado (A01)', () => {
    render(
      <ErrorState
        error={{ code: '42501', message: 'permission denied for table organizations' }}
        onRetry={() => undefined}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('No tienes permisos para realizar esta operación.');
    expect(screen.getByText('Detalle técnico')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('un error de negocio pierde el prefijo canónico', () => {
    render(<ErrorState error={new Error('NO_AUTORIZADO: Solo finanzas puede verlo.')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Solo finanzas puede verlo.');
    expect(screen.getByRole('alert').querySelector('p')?.textContent).not.toContain('NO_AUTORIZADO');
  });
});

describe('PageContainer, Card y DataTable', () => {
  it('migas declarativas: la última es la página actual', () => {
    render(
      <MemoryRouter>
        <PageContainer title="Andina SAC" breadcrumbs={[{ label: 'Clientes', to: '/customers' }, { label: 'Andina SAC' }]}>
          <p>cuerpo</p>
        </PageContainer>
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Migas de pan' });
    expect(nav.querySelector('a')).toHaveAttribute('href', '/customers');
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent('Andina SAC');
    expect(screen.getByRole('heading', { level: 1, name: 'Andina SAC' })).toBeInTheDocument();
  });

  it('Card con pie', () => {
    render(
      <Card title="Facturas" footer="1–25 de 832">
        <p>tabla</p>
      </Card>,
    );
    expect(screen.getByRole('heading', { name: 'Facturas' })).toBeInTheDocument();
    expect(screen.getByText('1–25 de 832')).toBeInTheDocument();
  });

  it('DataTable alinea a la derecha las columnas numéricas y nombra la tabla', () => {
    render(
      <DataTable label="Cobros" columns={['Cliente', { label: 'Importe', align: 'right' }, { label: 'Acciones', srOnly: true }]}>
        <tr>
          <td>Andina</td>
          <td>10</td>
          <td />
        </tr>
      </DataTable>,
    );
    expect(screen.getByRole('table', { name: 'Cobros' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Importe' })).toHaveClass('text-right');
    expect(screen.getByText('Acciones')).toHaveClass('sr-only');
  });

  it('DataTable admite caption, ancho mínimo y región de scroll enfocable', () => {
    render(
      <DataTable caption="MRR por mes" label="Matriz" minWidth={860} scrollRegion columns={['Mes']}>
        <tr>
          <th scope="row">ene 2026</th>
        </tr>
      </DataTable>,
    );
    const region = screen.getByRole('region', { name: 'Matriz' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('table', { name: 'Matriz' })).toHaveStyle({ minWidth: '860px' });
    expect(screen.getByText('MRR por mes').tagName).toBe('CAPTION');
    expect(screen.getByRole('rowheader', { name: 'ene 2026' })).toBeInTheDocument();
  });
});

describe('Toast', () => {
  afterEach(() => vi.useRealTimers());

  function Trigger({ n = 1 }: { n?: number }) {
    const toast = useToast();
    return (
      <button type="button" onClick={() => Array.from({ length: n }, (_, i) => toast.success(`Guardado ${i + 1}`))}>
        Disparar
      </button>
    );
  }

  it('se cierra solo a los 6 s, pero no mientras el puntero está encima', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    act(() => screen.getByText('Disparar').click());
    const toast = screen.getByRole('status');
    act(() => {
      toast.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText('Guardado 1')).toBeInTheDocument();
    act(() => {
      toast.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.queryByText('Guardado 1')).toBeNull();
  });

  it('muestra como máximo 3 a la vez', () => {
    render(
      <ToastProvider>
        <Trigger n={5} />
      </ToastProvider>,
    );
    act(() => screen.getByText('Disparar').click());
    expect(screen.getAllByRole('status')).toHaveLength(3);
  });
});

describe('DataTable · paginación en cliente (V5 · F0)', () => {
  function Rows({ n }: { n: number }) {
    return (
      <DataTable label="Tenants" columns={['Nombre']}>
        {Array.from({ length: n }, (_, i) => (
          <tr key={i}>
            <td>Fila {i + 1}</td>
          </tr>
        ))}
      </DataTable>
    );
  }

  it('hasta 25 filas no muestra paginador', () => {
    render(<Rows n={25} />);
    expect(screen.getAllByRole('row')).toHaveLength(26);
    expect(screen.queryByRole('button', { name: 'Página siguiente' })).toBeNull();
  });

  it('con más de 25 filas pinta solo la página y permite avanzar y cambiar el tamaño', async () => {
    const user = userEvent.setup();
    render(<Rows n={60} />);
    expect(screen.getAllByRole('row')).toHaveLength(26);
    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Página siguiente' }));
    expect(screen.getByText('Fila 26')).toBeInTheDocument();
    expect(screen.queryByText('Fila 1')).toBeNull();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filas' }), '100');
    expect(screen.getAllByRole('row')).toHaveLength(61);
  });

  it('vuelve a la primera página cuando cambia el número de filas', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Rows n={60} />);
    await user.click(screen.getByRole('button', { name: 'Página siguiente' }));
    rerender(<Rows n={40} />);
    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument();
    expect(screen.getByText('Fila 1')).toBeInTheDocument();
  });

  it('paginate={false} pinta todas las filas', () => {
    render(
      <DataTable label="Meses" paginate={false} columns={['Mes']}>
        {Array.from({ length: 36 }, (_, i) => (
          <tr key={i}>
            <td>{i}</td>
          </tr>
        ))}
      </DataTable>,
    );
    expect(screen.getAllByRole('row')).toHaveLength(37);
  });
});

describe('PagedList (V5 · F0)', () => {
  it('pagina una lista no tabular con el mismo pie', async () => {
    const user = userEvent.setup();
    render(
      <PagedList items={Array.from({ length: 30 }, (_, i) => `Plan ${i + 1}`)}>
        {(items) => (
          <ul>
            {items.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
      </PagedList>,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(25);
    await user.click(screen.getByRole('button', { name: 'Página siguiente' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });
});

