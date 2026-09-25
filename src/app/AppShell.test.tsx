import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRoles } from '@/types/domain';
import type { PersonaKind } from '@/features/auth/session';

const auth = vi.hoisted(() => ({
  persona: 'EBIM' as PersonaKind,
  roles: null as SessionRoles | null,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ persona: auth.persona, roles: auth.roles, signOut: vi.fn(), loading: false }),
}));
vi.mock('@/hooks/useAppearance', () => ({
  useAppearance: () => ({ mode: 'light', density: 'equilibrada', toggleMode: vi.fn(), setDensity: vi.fn() }),
}));

import { AppShell } from './AppShell';

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
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.persona = 'EBIM';
  auth.roles = { ...base, platformRole: 'EBIM_SUPER_ADMIN' };
  localStorage.clear();
});

describe('AppShell', () => {
  it('no muestra la ruta técnica; muestra migas y título humano en una ficha', () => {
    renderAt('/tenants/50000000-0000-4000-a000-000000000001');
    const crumbs = screen.getByRole('navigation', { name: 'Migas de pan' });
    expect(crumbs).toHaveTextContent('Productos y contratos');
    expect(within(crumbs).getByRole('link', { name: 'Tenants' })).toHaveAttribute('href', '/tenants');
    expect(within(crumbs).getByText('Tenant 360')).toHaveAttribute('aria-current', 'page');
    expect(document.body).not.toHaveTextContent('50000000-0000-4000-a000-000000000001');
    expect(document.title).toBe('Tenant 360 · EBIM Control Plane');
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
    expect(document.querySelector('.bg-black\\/40')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('el entorno viene de la configuración, no de la rama', () => {
    renderAt('/');
    expect(screen.getByTitle(/VITE_APP_ENV/)).toHaveTextContent('Entorno local');
  });
});
