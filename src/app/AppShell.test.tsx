import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRoles } from '@/types/domain';
import type { PersonaKind } from '@/features/auth/session';

const auth = vi.hoisted(() => ({
  persona: 'EBIM' as PersonaKind,
  roles: null as SessionRoles | null,
  signOut: vi.fn(),
  setDensity: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ persona: auth.persona, roles: auth.roles, signOut: auth.signOut, loading: false }),
}));
vi.mock('@/hooks/useAppearance', () => ({
  useAppearance: () => ({ mode: 'light', density: 'equilibrada', toggleMode: vi.fn(), setDensity: auth.setDensity }),
}));
// La paleta tiene su propio test con datos.
vi.mock('@/services/queries', () => {
  const idle = { data: undefined, isFetching: false, isError: false };
  return {
    useOrganizations: () => idle,
    useTenantOverview: () => idle,
    useSubscriptions: () => idle,
  };
});
// La campana lee la Bandeja; su cálculo y permisos tienen su propio test.
const inbox = vi.hoisted(() => ({ items: [] as unknown[], visible: true, loading: false }));
vi.mock('@/features/inbox/useInbox', () => ({
  useInbox: () => ({
    items: inbox.items,
    loading: inbox.loading,
    audience: { invoice: inbox.visible, alta: false, health: false, confirm: false, document: false, 'billing-alert': false, settlement: false },
  }),
}));

const inboxItem = (n: number, priority: 1 | 2 | 3) => ({
  key: `k-${n}`,
  kind: 'invoice',
  priority,
  title: `Aviso ${n}`,
  account: { name: `Cuenta ${n}` },
  app: 'EWM',
  ageText: 'hace 2 días',
  since: null,
  screen: { label: 'Abrir', to: `/pantalla/${n}` },
  action: { type: 'link', label: 'Hacer', to: `/accion/${n}` },
});

import { AppShell } from './AppShell';
import { mockViewport } from '@/test/matchMedia';
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
          <Route path="/products/:id" element={<PageContainer title="EWM">producto</PageContainer>} />
          <Route path="/cobranza" element={<PageContainer title="Cobranza">cobros</PageContainer>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.persona = 'EBIM';
  auth.roles = { ...base, platformRole: 'EBIM_SUPER_ADMIN' };
  inbox.items = [];
  inbox.visible = true;
  inbox.loading = false;
  localStorage.clear();
});

describe('AppShell', () => {
  it('no muestra la ruta técnica; el encabezado de la ficha lleva migas grupo → listado → nombre', () => {
    renderAt('/tenants/50000000-0000-4000-a000-000000000001');
    const crumbs = screen.getByRole('navigation', { name: 'Migas de pan' });
    expect(crumbs).toHaveTextContent('Suite');
    expect(within(crumbs).getByRole('link', { name: 'Tenants' })).toHaveAttribute('href', '/tenants');
    expect(within(crumbs).getByText('Constructora Alfa · EWM')).toHaveAttribute('aria-current', 'page');
    expect(document.body).not.toHaveTextContent('50000000-0000-4000-a000-000000000001');
    expect(document.title).toBe('Tenant 360 · Admin Maestro · EBIM');
  });

  it('un listado lleva el grupo como miga y el título como página actual', () => {
    renderAt('/cobranza');
    const crumbs = screen.getByRole('navigation', { name: 'Migas de pan' });
    expect(crumbs).toHaveTextContent('Finanzas');
    expect(within(crumbs).getByText('Cobranza')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1, name: 'Cobranza' })).toBeInTheDocument();
  });

  it('la ficha de una pantalla fusionada vuelve a su pestaña y marca la entrada dueña', () => {
    renderAt('/products/p-1');
    const crumbs = screen.getByRole('navigation', { name: 'Migas de pan' });
    expect(crumbs).toHaveTextContent('Comercial');
    expect(within(crumbs).getByRole('link', { name: 'Catálogo' })).toHaveAttribute('href', '/catalogo?tab=productos');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(within(nav).getByRole('link', { name: 'Catálogo' }).className).toContain('font-semibold');
    expect(document.title).toBe('Ficha de producto · Admin Maestro · EBIM');
  });

  it('al navegar, el foco va al h1 de la página nueva', async () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Cobranza' }));
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Cobranza' });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(document.activeElement).toBe(h1);
  });

  it('V6 · T10: la ficha de app marca solo su entrada dueña (Centro de la suite), no también «Apps»', () => {
    renderAt('/apps/ewm');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(within(nav).getByRole('link', { name: 'Centro de la suite' }).className).toContain('font-semibold');
    const apps = within(nav).getByRole('link', { name: 'Apps' });
    expect(apps).not.toHaveAttribute('aria-current');
    expect(apps.className).not.toContain('font-semibold');
  });

  it('marca el ítem activo y muestra el lockup Admin Maestro', () => {
    renderAt('/cobranza');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(within(nav).getByRole('link', { name: 'Cobranza' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Cuentas' })).not.toHaveAttribute('aria-current');
    expect(screen.getAllByText('Admin Maestro').length).toBeGreaterThan(0);
  });

  it('super admin ve los seis grupos y las 19 entradas del menú (V5 + Correos enviados)', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    for (const g of ['Inicio', 'Clientes', 'Suite', 'Comercial', 'Finanzas', 'Gobierno']) {
      expect(within(nav).getByRole('button', { name: g })).toBeInTheDocument();
    }
    expect(within(nav).getAllByRole('link')).toHaveLength(19);
  });

  it('usuario técnico EBIM no recibe el grupo Finanzas', () => {
    auth.roles = { ...base, ownedProductIds: ['p1'] };
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(within(nav).queryByRole('button', { name: 'Finanzas' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Cobranza' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Contratos' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Apps' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Centro de la suite' })).toBeInTheDocument();
  });

  it('un partner no ve Costos, Nueva venta ni el Centro de la suite', () => {
    auth.persona = 'PARTNER';
    auth.roles = { ...base, organizations: [{ organizationId: 'o', role: 'PARTNER_ADMIN', displayName: 'Andina' }] };
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(within(nav).queryByRole('link', { name: 'Costos y margen' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Nueva venta' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Centro de la suite' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Cobranza' })).toBeInTheDocument();
    expect(within(nav).getAllByRole('link').length).toBeLessThan(18);
  });

  it('grupos plegables con aria-expanded; el grupo activo no se oculta', () => {
    renderAt('/cobranza');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    const clientes = within(nav).getByRole('button', { name: 'Clientes' });
    expect(clientes).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(clientes);
    expect(clientes).toHaveAttribute('aria-expanded', 'false');
    expect(within(nav).queryByRole('link', { name: 'Cuentas' })).not.toBeInTheDocument();
    const finanzas = within(nav).getByRole('button', { name: 'Finanzas' });
    fireEvent.click(finanzas);
    expect(within(nav).getByRole('link', { name: 'Cobranza' })).toBeVisible();
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
    const link = within(nav).getByRole('link', { name: 'Cuentas' });
    expect(link).not.toHaveTextContent('Cuentas');
    fireEvent.mouseEnter(link);
    expect(document.querySelector('.ebim-tooltip')).toHaveTextContent('Cuentas');
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

  it('tableta (md–lg): menú lateral en modo iconos que se despliega encima y no se guarda', () => {
    const restore = mockViewport('tablet');
    try {
      renderAt('/');
      const aside = document.querySelector('aside[data-sidebar]')!;
      expect(aside).toHaveAttribute('data-sidebar', 'rail');
      const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
      expect(within(nav).getByRole('link', { name: 'Cuentas' })).not.toHaveTextContent('Cuentas');
      fireEvent.click(screen.getByRole('button', { name: 'Expandir menú lateral' }));
      expect(aside).toHaveAttribute('data-sidebar', 'full');
      expect(within(nav).getByRole('link', { name: 'Cuentas' })).toHaveTextContent('Cuentas');
      expect(localStorage.getItem('ebim-cp-sidebar-rail')).toBeNull();
      // Escape lo vuelve a iconos.
      fireEvent.keyDown(within(nav).getByRole('link', { name: 'Cuentas' }), { key: 'Escape' });
      expect(aside).toHaveAttribute('data-sidebar', 'rail');
    } finally {
      restore();
    }
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

  it('campana: contador de la Bandeja con nombre accesible; reemplaza el badge de Cobranza', async () => {
    inbox.items = [inboxItem(1, 1), inboxItem(2, 2), inboxItem(3, 3)];
    renderAt('/');
    const bell = await screen.findByRole('button', { name: 'Bandeja: 3 pendientes, 1 urgente' });
    expect(bell).toHaveTextContent('3');
    expect(bell).toHaveAttribute('aria-expanded', 'false');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(within(nav).getByRole('link', { name: 'Cobranza' })).not.toHaveTextContent(/\d/);
  });

  it('campana: el panel muestra los 5 más urgentes y «Ver todo»; Escape lo cierra y devuelve el foco', async () => {
    inbox.items = Array.from({ length: 7 }, (_, i) => inboxItem(i + 1, 2));
    renderAt('/');
    const bell = await screen.findByRole('button', { name: /^Bandeja: 7 pendientes/ });
    fireEvent.click(bell);
    expect(bell).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('dialog', { name: 'Lo más urgente' });
    expect(bell).toHaveAttribute('aria-controls', panel.id);
    const links = within(panel).getAllByRole('link');
    expect(links).toHaveLength(6);
    expect(links[0]).toHaveTextContent('Aviso 1');
    expect(links[0]).toHaveAttribute('href', '/accion/1');
    expect(document.activeElement).toBe(links[0]);
    expect(panel).toHaveTextContent('y 2 más');
    expect(within(panel).getByRole('link', { name: 'Ver todo' })).toHaveAttribute('href', '/bandeja');

    fireEvent.keyDown(links[0]!, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Lo más urgente' })).toBeNull();
    expect(document.activeElement).toBe(bell);
  });

  it('campana: un clic fuera cierra el panel; sin pendientes lo dice', async () => {
    renderAt('/');
    const bell = await screen.findByRole('button', { name: 'Bandeja: nada pendiente' });
    fireEvent.click(bell);
    expect(screen.getByRole('dialog', { name: 'Lo más urgente' })).toHaveTextContent('Nada pendiente');
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Lo más urgente' })).toBeNull();
  });

  it('campana: un rol sin avisos posibles no la ve', async () => {
    inbox.visible = false;
    renderAt('/');
    // La campana llega en diferido: se espera a que su módulo cargue.
    await act(async () => {
      await import('@/features/inbox/InboxBell');
    });
    expect(screen.queryByRole('button', { name: /^Bandeja:/ })).toBeNull();
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
