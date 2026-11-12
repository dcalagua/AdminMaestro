import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { DetailTabs } from './DetailTabs';
import { resolveDetailTab } from './detailTabRouting';

/*
 * V5 · F3 · Pestañas de ficha con `?tab=`: los enlaces viejos (`#hash` o
 * `?tab=` de pestañas que ya no existen) redirigen a la pestaña nueva y dejan
 * el nombre viejo como ancla de sección.
 */

const LEGACY = { 'payment-portal': 'cobro', billing: 'cobro', view360: 'resumen' };

describe('resolveDetailTab', () => {
  const ids = ['resumen', 'cobro', 'personas'];
  it('una pestaña conocida se muestra tal cual', () => {
    expect(resolveDetailTab(ids, LEGACY, 'cobro', '#billing')).toEqual({ kind: 'show', tab: 'cobro' });
  });
  it('un `?tab=` viejo redirige y deja el nombre viejo como ancla', () => {
    expect(resolveDetailTab(ids, LEGACY, 'billing', '')).toEqual({ kind: 'redirect', tab: 'cobro', anchor: 'billing' });
  });
  it('un `#hash` viejo redirige a `?tab=` con su ancla', () => {
    expect(resolveDetailTab(ids, LEGACY, null, '#payment-portal')).toEqual({ kind: 'redirect', tab: 'cobro', anchor: 'payment-portal' });
  });
  it('un `#hash` con el id nuevo pasa a `?tab=` sin ancla', () => {
    expect(resolveDetailTab(ids, LEGACY, null, '#personas')).toEqual({ kind: 'redirect', tab: 'personas', anchor: null });
  });
  it('lo desconocido no redirige: se abre la primera pestaña', () => {
    expect(resolveDetailTab(ids, LEGACY, 'nada', '')).toEqual({ kind: 'show', tab: null });
    expect(resolveDetailTab(ids, LEGACY, null, '#otra-cosa')).toEqual({ kind: 'show', tab: null });
  });
});

function Probe() {
  const l = useLocation();
  return <output data-testid="url">{`${l.pathname}${l.search}${l.hash}`}</output>;
}

function renderAt(url: string, hidden = false) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/ficha"
          element={
            <>
              <DetailTabs
                legacy={LEGACY}
                tabs={[
                  { id: 'resumen', label: 'Resumen', content: <p>Contenido del resumen</p> },
                  { id: 'cobro', label: 'Contratos y cobranza', hidden, content: <p>Contenido de cobranza</p> },
                  { id: 'personas', label: 'Personas', content: <p>Contenido de personas</p> },
                ]}
              />
              <Probe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DetailTabs', () => {
  it('sin `?tab=` abre la primera pestaña', () => {
    renderAt('/ficha');
    expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Contenido del resumen')).toBeInTheDocument();
  });

  it('`#payment-portal` redirige a `?tab=cobro#payment-portal`', async () => {
    renderAt('/ficha#payment-portal');
    expect(await screen.findByText('Contenido de cobranza')).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent('/ficha?tab=cobro#payment-portal');
  });

  it('`?tab=billing` redirige conservando el resto de la consulta', async () => {
    renderAt('/ficha?tab=billing&q=abc');
    expect(await screen.findByText('Contenido de cobranza')).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent('/ficha?tab=cobro&q=abc#billing');
  });

  it('cambiar de pestaña escribe `?tab=`', async () => {
    renderAt('/ficha');
    await userEvent.click(screen.getByRole('tab', { name: 'Personas' }));
    expect(screen.getByText('Contenido de personas')).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent('/ficha?tab=personas');
  });

  it('una pestaña oculta por permisos no se abre aunque se pida', () => {
    renderAt('/ficha?tab=cobro', true);
    expect(screen.queryByRole('tab', { name: 'Contratos y cobranza' })).toBeNull();
    expect(screen.queryByText('Contenido de cobranza')).toBeNull();
    expect(screen.getByText('Contenido del resumen')).toBeInTheDocument();
  });
});
