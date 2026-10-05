import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRoles } from '@/types/domain';
import type { PersonaKind } from '@/features/auth/session';

const auth = vi.hoisted(() => ({
  persona: 'EBIM' as PersonaKind,
  roles: null as SessionRoles | null,
  criticalAlerts: 0,
  signOut: vi.fn(),
  setDensity: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ persona: auth.persona, roles: auth.roles, signOut: auth.signOut, loading: false }),
}));
vi.mock('@/hooks/useAppearance', () => ({
  useAppearance: () => ({ mode: 'light', density: 'equilibrada', toggleMode: vi.fn(), setDensity: auth.setDensity }),
}));
// Solo el conteo del badge; la paleta tiene su propio test con datos.
vi.mock('@/services/queries', () => {
  const idle = { data: undefined, isFetching: false, isError: false };
  return {
    useCriticalBillingAlertCount: ({ enabled }: { enabled: boolean }) => ({
      data: enabled ? auth.criticalAlerts : undefined,
    }),
    useOrganizations: () => idle,
    useTenantOverview: () => idle,
    useSubscriptions: () => idle,
  };
});

import { AppShell } from './AppShell';
import { PageContainer } from '@/components/ui/primitives';

const base: SessionRoles = {
  userId: 'u', email: 'u@ebim.test', fullName: 'Usuaria Prueba', platformRole: null, organizations: [],
  tenantRoles: [], salesAgentId: null, provisioningRoles: [], ownedProductIds: [],
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="*" element={<p>contenido</p>} />
          <Route path="/tenants/:id" element={<PageContainer title="Constructora Alfa · EWM">ficha</PageContainer>} />
          <Route path="/billing" element={<PageContainer title="Facturación y cobros">cobros</PageContainer>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.persona = 'EBIM';
  auth.roles = { ...base, platformRole: 'EBIM_SUPER_ADMIN' };
  auth.criticalAlerts = 0;
  localStorage.clear();
});

describe('AppShell', () => {
  it('no muestra la ruta técnica; el encabezado de la ficha lleva migas grupo → listado → nombre', () => {
    renderAt('/tenants/50000000-0000-4000-a000-000000000001');
    const crumbs = screen.getByRole('navigation', { name: 'Migas de pan' });
    expect(crumbs).toHaveTextContent('Productos y contratos');
    expect(within(crumbs).getByRole('link', { name: 'Tenants' })).toHaveAttribute('href', '/tenants');
    expect(within(crumbs).getByText('Constructora Alfa · EWM')).toHaveAttribute('aria-current', 'page');
    expect(document.body).not.toHaveTextContent('50000000-0000-4000-a000-000000000001');
    expect(document.title).toBe('Tenant 360 · Admin Maestro · EBIM');
  });

  it('un listado lleva el grupo como miga y el título como página actual', () => {
    renderAt('/billing');
    const crumbs = screen.getByRole('navigation', { name: 'Migas de pan' });
    expect(crumbs).toHaveTextContent('Finanzas');
    expect(within(crumbs).getByText('Facturación y cobros')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1, name: 'Facturación y cobros' })).toBeInTheDocument();
  });

  it('al navegar, el foco va al h1 de la página nueva', async () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Facturación y cobros' }));
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Facturación y cobros' });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(document.activeElement).toBe(h1);
  });

  it('marca el ítem activo y muestra el lockup Admin Maestro', () => {
    renderAt('/billing');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(within(nav).getByRole('link', { name: 'Facturación y cobros' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Clientes' })).not.toHaveAttribute('aria-current');
    expect(screen.getAllByText('Admin Maestro').length).toBeGreaterThan(0);
  });

  it('super admin ve los seis grupos de negocio', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    for (const g of ['Inicio', 'Clientes y canales', 'Productos y contratos', 'Finanzas', 'Operación SaaS', 'Gobierno']) {
      expect(within(nav).getByRole('button', { name: g })).toBeInTheDocument();
    }
  });

  it('usuario técnico EBIM no recibe el grupo Finanzas', () => {
    auth.roles = { ...base, ownedProductIds: ['p1'] };
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(within(nav).queryByRole('button', { name: 'Finanzas' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Facturación y cobros' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Altas SaaS' })).toBeInTheDocument();
  });

  it('un partner no ve Costos ni Integraciones', () => {
    auth.persona = 'PARTNER';
    auth.roles = { ...base, organizations: [{ organizationId: 'o', role: 'PARTNER_ADMIN', displayName: 'Andina' }] };
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(within(nav).queryByRole('link', { name: 'Costos y margen' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Integraciones' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Facturación y cobros' })).toBeInTheDocument();
  });

  it('grupos plegables con aria-expanded; el grupo activo no se oculta', () => {
    renderAt('/billing');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    const clientes = within(nav).getByRole('button', { name: 'Clientes y canales' });
    expect(clientes).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(clientes);
    expect(clientes).toHaveAttribute('aria-expanded', 'false');
    expect(within(nav).queryByRole('link', { name: 'Clientes' })).not.toBeInTheDocument();
    const finanzas = within(nav).getByRole('button', { name: 'Finanzas' });
    fireEvent.click(finanzas);
    expect(within(nav).getByRole('link', { name: 'Facturación y cobros' })).toBeVisible();
  });

  it('menú móvil: panel modal que se cierra con Escape y no deja capa invisible', () => {
    renderAt('/');
    expect(screen.queryByRole('dialog', { name: 'Menú de navegación' })).not.toBeInTheDocument();
    const opener = screen.getByRole('button', { name: 'Abrir menú' });
    fireEvent.click(opener);
    const panel = screen.getByRole('dialog', { name: 'Menú de navegación' });
    expect(panel).toBeInTheDocument();
    expect(panel.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Menú de navegación' })).not.toBeInTheDocument();
    expect(document.querySelector('.ebim-scrim')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('el entorno viene de la configuración, no de la rama', () => {
    renderAt('/');
    expect(screen.getByTitle(/VITE_APP_ENV/)).toHaveTextContent('Entorno local');
  });

  it('modo iconos: se guarda en localStorage, deja nombre accesible y tooltip', () => {
    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: 'Reducir menú lateral a iconos' }));
    expect(localStorage.getItem('ebim-cp-sidebar-rail')).toBe('true');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    const link = within(nav).getByRole('link', { name: 'Clientes' });
    expect(link).not.toHaveTextContent('Clientes');
    fireEvent.mouseEnter(link);
    expect(document.querySelector('.ebim-tooltip')).toHaveTextContent('Clientes');
    fireEvent.mouseLeave(link);
    expect(document.querySelector('.ebim-tooltip')).toBeNull();
  });

  it('modo iconos persistido: arranca reducido y se puede expandir', () => {
    localStorage.setItem('ebim-cp-sidebar-rail', 'true');
    renderAt('/');
    const expand = screen.getByRole('button', { name: 'Expandir menú lateral' });
    expect(expand).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(expand);
    expect(localStorage.getItem('ebim-cp-sidebar-rail')).toBe('false');
  });

  it('localStorage inaccesible no rompe el shell', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: 'Reducir menú lateral a iconos' }));
    expect(screen.getByRole('button', { name: 'Expandir menú lateral' })).toBeInTheDocument();
    spy.mockRestore();
    setSpy.mockRestore();
  });

  it('badge de alertas críticas en Renovaciones, con texto accesible', () => {
    auth.criticalAlerts = 7;
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    const link = within(nav).getByRole('link', { name: 'Renovaciones (7 alertas críticas abiertas)' });
    expect(link).toHaveTextContent('7');
  });

  it('sin vista financiera no hay badge de cobranza (ni consulta)', () => {
    auth.criticalAlerts = 7;
    auth.roles = { ...base, ownedProductIds: ['p1'] };
    renderAt('/');
    expect(screen.queryByText(/alertas críticas/)).not.toBeInTheDocument();
  });

  it('iniciales del avatar sin paréntesis ni símbolos', () => {
    auth.roles = { ...base, platformRole: 'EBIM_SUPER_ADMIN', fullName: 'Dennis Calagua (Operador)' };
    renderAt('/');
    expect(screen.getByRole('button', { name: 'Menú de cuenta' })).toHaveTextContent(/^DC/);
  });

  it('menú de cuenta: Mi perfil, densidad y Salir', () => {
    renderAt('/');
    const button = screen.getByRole('button', { name: 'Menú de cuenta' });
    expect(button).toHaveTextContent('UP');
    expect(button).toHaveTextContent('Usuaria Prueba');
    fireEvent.click(button);
    const menu = screen.getByRole('menu', { name: 'Cuenta' });
    expect(within(menu).getByRole('menuitem', { name: 'Mi perfil' })).toHaveFocus();
    expect(within(menu).getByRole('menuitemradio', { name: 'Equilibrada' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Compacta' }));
    expect(auth.setDensity).toHaveBeenCalledWith('compacta');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Salir' }));
    expect(auth.signOut).toHaveBeenCalled();
  });
});
