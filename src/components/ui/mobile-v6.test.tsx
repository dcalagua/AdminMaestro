import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockViewport } from '@/test/matchMedia';
import { StatusTabs, TabStrip, statusTabsFitMobile, tabStripFits } from './SectionTabs';
import { SubSections } from './SubSections';
import { DataTable } from './primitives';
import { ActionMenu } from './ActionMenu';
import { SummaryBar, SummaryItem } from './SummaryBar';

/* V6 · F5 · Pase móvil de los componentes compartidos. */

let restore: () => void = () => {};
afterEach(() => {
  restore();
  window.location.hash = '';
});

const MANY = [
  { id: 'ALL', label: 'Todas', count: 29 },
  { id: 'P', label: 'Partners', count: 2 },
  { id: 'C', label: 'Clientes', count: 27 },
  { id: 'X', label: 'Archivadas', count: 0 },
];

describe('StatusTabs en móvil', () => {
  it('si no caben en una fila, son un select con el mismo nombre y los contadores', () => {
    restore = mockViewport('mobile');
    const onChange = vi.fn();
    render(<StatusTabs label="Tipo" value="ALL" onChange={onChange} options={MANY} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    const select = screen.getByRole('combobox', { name: 'Tipo' });
    expect(within(select).getByRole('option', { name: 'Partners (2)' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'C' } });
    expect(onChange).toHaveBeenCalledWith('C');
  });

  it('si caben (o en escritorio), siguen siendo pestañas', () => {
    restore = mockViewport('mobile');
    const short = [
      { id: 'A', label: 'Abiertos' },
      { id: 'B', label: 'Cerrados' },
    ];
    expect(statusTabsFitMobile(short)).toBe(true);
    const { unmount } = render(<StatusTabs label="Estado" value="A" onChange={() => {}} options={short} />);
    expect(screen.getByRole('tablist', { name: 'Estado' })).toBeInTheDocument();
    unmount();
    restore();
    restore = mockViewport('desktop');
    render(<StatusTabs label="Tipo" value="ALL" onChange={() => {}} options={MANY} />);
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });
});

describe('TabStrip en móvil', () => {
  const tabs = [
    { id: 'por-cobrar', label: 'Por cobrar' },
    { id: 'facturacion', label: 'Facturación y cobros' },
    { id: 'renovaciones', label: 'Renovaciones' },
    { id: 'conciliacion', label: 'Conciliación' },
  ];

  it('una fila que no cabe a 390 px se vuelve un select (nada recortado por el borde)', () => {
    expect(tabStripFits(tabs, 390)).toBe(false);
    expect(tabStripFits(tabs.slice(0, 2), 390)).toBe(true);
    const restoreViewport = mockViewport('mobile');
    const width = window.innerWidth;
    window.innerWidth = 390;
    restore = () => {
      restoreViewport();
      window.innerWidth = width;
    };
    const onSelect = vi.fn();
    render(<TabStrip tabs={tabs} activeId="renovaciones" onSelect={onSelect} label="Secciones de Cobranza" />);
    const select = screen.getByRole('combobox', { name: 'Secciones de Cobranza' });
    expect(select).toHaveValue('renovaciones');
    fireEvent.change(select, { target: { value: 'conciliacion' } });
    expect(onSelect).toHaveBeenCalledWith('conciliacion');
  });
});

describe('SubSections (une SubSections y SegmentedSections)', () => {
  it('control segmentado con #hash sin entrada de historial y `aside` a la derecha', () => {
    window.location.hash = '#b';
    render(
      <SubSections
        label="Vista"
        aside={<span>Nota corta</span>}
        tabs={[
          { id: 'a', label: 'Uno', content: <p>contenido uno</p> },
          { id: 'b', label: 'Dos', content: <p>contenido dos</p> },
        ]}
      />,
    );
    expect(screen.getByRole('tabpanel', { name: 'Dos' })).toHaveTextContent('contenido dos');
    expect(screen.getByText('Nota corta')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Uno' }));
    expect(window.location.hash).toBe('#a');
    expect(screen.getByRole('tabpanel', { name: 'Uno' })).toHaveTextContent('contenido uno');
  });
});

describe('tarjetas móviles', () => {
  it('el menú «⋯» va junto al título, sin fila de pie propia', () => {
    restore = mockViewport('mobile');
    render(
      <MemoryRouter>
        <DataTable label="Cuentas" columns={['Cuenta', 'País', { label: 'Acciones', srOnly: true }]}>
          <tr key="a">
            <td className="ebim-td">Andina</td>
            <td className="ebim-td">Perú</td>
            <td className="ebim-td">
              <ActionMenu label="Acciones de Andina" items={[{ label: 'Abrir', onSelect: () => {} }]} />
            </td>
          </tr>
        </DataTable>
      </MemoryRouter>,
    );
    const card = within(screen.getByRole('list', { name: 'Cuentas' })).getAllByRole('listitem')[0]!;
    const menu = within(card).getByRole('button', { name: 'Acciones de Andina' });
    // Comparte contenedor con el título (no está en el pie, tras la lista «etiqueta: valor»).
    expect(menu.closest('dl')).toBeNull();
    expect(card.firstElementChild).toContainElement(menu);
    expect(card.firstElementChild).toHaveTextContent('Andina');
  });
});

describe('SummaryBar', () => {
  it('en móvil es una grilla de 2 columnas; `grow` ocupa el ancho', () => {
    render(
      <SummaryBar label="Resumen">
        <SummaryItem label="Estado">Activo</SummaryItem>
        <SummaryItem label="Apps" grow>
          eChange
        </SummaryItem>
      </SummaryBar>,
    );
    const dl = screen.getByRole('region', { name: 'Resumen' }).querySelector('dl')!;
    expect(dl).toHaveClass('grid-cols-2');
    expect(dl.querySelector('[data-summary-item="Apps"]')).toHaveClass('col-span-2');
  });
});
