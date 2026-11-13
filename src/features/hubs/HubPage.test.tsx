import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRoles } from '@/types/domain';
import type { PersonaKind } from '@/features/auth/session';
import { PageContainer } from '@/components/ui/primitives';

const auth = vi.hoisted(() => ({
  persona: 'EBIM' as PersonaKind,
  roles: null as SessionRoles | null,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ persona: auth.persona, roles: auth.roles, loading: false }),
}));

import { HubPage, LegacyRedirect, type HubPanels } from './HubPage';

const base: SessionRoles = {
  userId: 'u', email: 'u@ebim.test', fullName: null, platformRole: null, organizations: [],
  tenantRoles: [], salesAgentId: null, provisioningRoles: [], ownedProductIds: [],
};

/** Cada pestaña es una pantalla de siempre, con su propio `PageContainer`. */
const page = (title: string) =>
  function Stub() {
    return (
      <PageContainer title={title} description={`Descripción de ${title}`} actions={<button type="button">Acción</button>}>
        <p>contenido {title}</p>
      </PageContainer>
    );
  };

const PANELS: HubPanels = {
  facturacion: page('Facturación y cobros'),
  renovaciones: page('Renovaciones'),
  conciliacion: page('Conciliación'),
};

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}${l.hash}`}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/cobranza" element={<><HubPage to="/cobranza" panels={PANELS} /><Where /></>} />
        <Route path="/renewals" element={<LegacyRedirect to="/cobranza" tab="renovaciones" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.persona = 'EBIM';
  auth.roles = { ...base, platformRole: 'EBIM_FINANCE' };
});

describe('HubPage (V5 · pantallas fusionadas)', () => {
  it('un solo h1 con el nombre de la entrada; la pestaña no repite encabezado', () => {
    renderAt('/cobranza');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Cobranza');
    // La pantalla incrustada conserva su título como h2 para lectores de pantalla.
    expect(screen.getByRole('heading', { level: 2, name: 'Facturación y cobros' })).toBeInTheDocument();
  });

  it('V6 · T1: cabecera única; la acción de la pestaña sube junto al título y su descripción pasa a «¿Qué es esto?»', () => {
    renderAt('/cobranza');
    const h1 = screen.getByRole('heading', { level: 1 });
    const header = h1.closest('header')!;
    // La acción de la pestaña está en la misma cabecera que el h1, no bajo las pestañas.
    expect(within(header).getByRole('button', { name: 'Acción' })).toBeInTheDocument();
    expect(within(screen.getByRole('tabpanel')).queryByRole('button', { name: 'Acción' })).toBeNull();
    // La descripción no es un párrafo visible bajo las pestañas: va plegada en el «¿Qué es…?» del título.
    const hint = within(header).getByRole('button', { name: 'Qué es «Facturación y cobros»' });
    expect(hint).toHaveAttribute('aria-expanded', 'false');
    const note = screen.getByRole('note', { hidden: true });
    expect(note).toHaveTextContent('Descripción de Facturación y cobros');
    expect(note).not.toBeVisible();
    fireEvent.click(hint);
    expect(hint).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('note')).toBeVisible();
    // Al cambiar de pestaña, la acción y el «¿Qué es…?» son los de la nueva.
    fireEvent.click(within(screen.getByRole('tablist')).getByRole('tab', { name: 'Renovaciones' }));
    expect(within(header).getAllByRole('button', { name: 'Acción' })).toHaveLength(1);
    expect(within(header).getByRole('button', { name: 'Qué es «Renovaciones»' })).toBeInTheDocument();
    expect(within(header).queryByRole('button', { name: 'Qué es «Facturación y cobros»' })).toBeNull();
  });

  it('abre la pestaña pedida por ?tab= y cambiar de pestaña actualiza la URL', () => {
    renderAt('/cobranza?tab=renovaciones&ventana=60');
    const tabs = screen.getByRole('tablist', { name: 'Cobranza' });
    expect(within(tabs).getByRole('tab', { name: 'Renovaciones' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('contenido Renovaciones')).toBeInTheDocument();
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Conciliación' }));
    // Los filtros de la pestaña anterior no se arrastran.
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/cobranza\?tab=conciliacion$/);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('contenido Conciliación');
  });

  it('un partner no ve la pestaña de una pantalla que antes no veía', () => {
    auth.persona = 'PARTNER';
    auth.roles = { ...base, organizations: [{ organizationId: 'o', role: 'PARTNER_ADMIN', displayName: 'Andina' }] };
    renderAt('/cobranza');
    const tabs = screen.getByRole('tablist');
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Facturación y cobros', 'Renovaciones']);
  });

  it('si se pide una pestaña que el rol no ve, lo dice en vez de mostrar otra', () => {
    auth.persona = 'PARTNER';
    auth.roles = { ...base, organizations: [{ organizationId: 'o', role: 'PARTNER_ADMIN', displayName: 'Andina' }] };
    renderAt('/cobranza?tab=conciliacion');
    expect(screen.getByText('Tu rol no tiene acceso a «Conciliación»')).toBeInTheDocument();
    expect(screen.queryByText(/^contenido /)).not.toBeInTheDocument();
  });

  it('el perfil técnico sin finanzas no recibe ninguna pestaña', () => {
    auth.roles = { ...base, ownedProductIds: ['p1'] };
    renderAt('/cobranza');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByText('Tu rol no tiene acceso a esta sección')).toBeInTheDocument();
  });

  it('una pestaña desconocida cae en la primera visible', () => {
    renderAt('/cobranza?tab=nada');
    expect(screen.getByText('contenido Facturación y cobros')).toBeInTheDocument();
  });

  it('la ruta vieja redirige con la pestaña, el resto de la consulta y el #hash', () => {
    renderAt('/renewals?ventana=60#alertas');
    expect(screen.getByTestId('where')).toHaveTextContent('/cobranza?tab=renovaciones&ventana=60#alertas');
    expect(screen.getByText('contenido Renovaciones')).toBeInTheDocument();
  });
});

describe('acción primaria de la entrada (V5 · F4)', () => {
  it('se ve en la cabecera en cualquier pestaña', () => {
    render(
      <MemoryRouter initialEntries={['/cobranza?tab=renovaciones']}>
        <Routes>
          <Route
            path="/cobranza"
            element={<HubPage to="/cobranza" panels={PANELS} actions={<button type="button">Emitir factura</button>} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Emitir factura' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Renovaciones', selected: true })).toBeInTheDocument();
  });
});
