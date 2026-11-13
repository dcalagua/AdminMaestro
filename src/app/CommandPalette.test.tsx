import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRoles } from '@/types/domain';
import type { PersonaKind } from '@/features/auth/session';
import { matchRank, topMatches } from './commandSearch';

const state = vi.hoisted(() => ({
  persona: 'EBIM' as PersonaKind,
  roles: null as SessionRoles | null,
  enabled: { organizations: false, tenants: false, subscriptions: false } as Record<string, boolean>,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ persona: state.persona, roles: state.roles, signOut: vi.fn(), loading: false }),
}));
vi.mock('@/hooks/useAppearance', () => ({
  useAppearance: () => ({ mode: 'light', density: 'equilibrada', toggleMode: vi.fn(), setDensity: vi.fn() }),
}));

const ORGS = Array.from({ length: 12 }, (_, i) => ({
  id: `org-${i}`,
  display_name: i === 0 ? 'Andina Partners' : `Constructora Andes ${i}`,
  legal_name: `Razón ${i} S.A.C.`,
  slug: `org-${i}`,
  tax_id: null,
  country_code: 'PE',
  organization_capabilities: [{ capability: i === 0 ? 'PARTNER' : 'CUSTOMER' }],
}));
const TENANTS = [
  { tenant_id: 't-1', name: 'Andes Norte', slug: 'andes-norte', customer_name: 'Constructora Andes 1', product_short_name: 'EWM' },
];
const SUBS = [
  { id: 's-1', code: 'SUB-ANDES-001', status: 'ACTIVE', organizations: { display_name: 'Constructora Andes 1' }, tenants: { name: 'Andes Norte' }, saas_products: { short_name: 'EWM' } },
];

const INVOICES = [
  { invoice_id: 'inv-1', number: 'F001-ANDES-12', organization_name: 'Constructora Andes 1', total: 1180, currency: 'PEN', status: 'ISSUED' },
];
const PAYMENTS = [
  { payment_id: 'pay-1', invoice_number: 'F001-ANDES-12', reference: 'OP-ANDES-77', organization_name: 'Constructora Andes 1', collected_amount: 500, currency: 'PEN', collected_on: '2026-11-02' },
];
const USERS = [
  { id: 'u-andes', fullName: 'Ana Andes', email: 'ana@andes.pe', platformRole: null, organizations: [{ organization_name: 'Constructora Andes 1' }] },
];
const PRODUCTS = [
  { id: 'p-ewm', code: 'ewm', short_name: 'EWM', lockup_name: 'EWM Andes Warehouse', status: 'ACTIVE' },
  { id: 'p-old', code: 'old', short_name: 'Andes Legacy', lockup_name: null, status: 'ARCHIVED' },
];
const PARTNERS = [
  { id: 'org-p', display_name: 'Andes Partners', legal_name: 'Andes Partners SAC', slug: 'andes-p', tax_id: null, country_code: 'PE', organization_capabilities: [{ capability: 'PARTNER' }] },
];

vi.mock('@/services/financeRead', () => {
  const page = (key: string, enabled: boolean, rows: unknown[]) => {
    state.enabled[key] ||= enabled;
    return enabled ? { data: { rows, total: rows.length }, isFetching: false, isError: false } : { data: undefined, isFetching: false, isError: false };
  };
  return {
    useInvoiceSearch: (_t: string, { enabled }: { enabled: boolean }) => page('invoices', enabled, INVOICES),
    usePaymentSearch: (_t: string, { enabled }: { enabled: boolean }) => page('payments', enabled, PAYMENTS),
  };
});

vi.mock('@/services/queries', () => {
  const result = (enabled: boolean, rows: unknown[]) =>
    enabled ? { data: rows, isFetching: false, isError: false } : { data: undefined, isFetching: false, isError: false };
  return {
    useAdminUsers: (_scope: unknown, { enabled }: { enabled: boolean }) => {
      state.enabled.users ||= enabled;
      return result(enabled, USERS);
    },
    useProducts: ({ enabled }: { enabled: boolean }) => {
      state.enabled.apps ||= enabled;
      return result(enabled, PRODUCTS);
    },
    useOrganizations: ({ enabled }: { enabled: boolean }) => {
      state.enabled.organizations ||= enabled;
      return result(enabled, [...ORGS, ...PARTNERS]);
    },
    useTenantOverview: ({ enabled }: { enabled: boolean }) => {
      state.enabled.tenants ||= enabled;
      return result(enabled, TENANTS);
    },
    useSubscriptions: ({ enabled }: { enabled: boolean }) => {
      state.enabled.subscriptions ||= enabled;
      return result(enabled, SUBS);
    },
  };
});

vi.mock('@/features/inbox/useInbox', () => ({
  useInbox: () => ({ items: [], loading: false, audience: {} }),
}));

import { AppShell } from './AppShell';

const base: SessionRoles = {
  userId: 'u', email: 'u@ebim.test', fullName: 'Usuaria Prueba', platformRole: null, organizations: [],
  tenantRoles: [], salesAgentId: null, provisioningRoles: [], ownedProductIds: [],
};

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderShell(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="*" element={<Where />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function openWithShortcut(init: KeyboardEventInit = { ctrlKey: true }) {
  fireEvent.keyDown(document, { key: 'k', ...init });
  return screen.getByRole('dialog', { name: 'Buscar y navegar' });
}

function type(value: string) {
  fireEvent.change(screen.getByRole('combobox'), { target: { value } });
  act(() => {
    vi.advanceTimersByTime(250);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  state.persona = 'EBIM';
  state.roles = { ...base, platformRole: 'EBIM_SUPER_ADMIN' };
  state.enabled = {};
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Paleta de comandos ⌘K', () => {
  it('abre con Ctrl+K y con ⌘K, enfoca el buscador y cierra con Escape devolviendo el foco', () => {
    renderShell();
    const trigger = screen.getByRole('button', { name: 'Buscar y navegar' });
    trigger.focus();
    const dialog = openWithShortcut();
    expect(screen.getByRole('combobox')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dialog).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    openWithShortcut({ metaKey: true });
    expect(screen.getByRole('dialog', { name: 'Buscar y navegar' })).toBeInTheDocument();
    // El mismo atajo la cierra.
    fireEvent.keyDown(document, { key: 'K', metaKey: true });
    expect(screen.queryByRole('dialog', { name: 'Buscar y navegar' })).not.toBeInTheDocument();
  });

  it('también abre desde el buscador del topbar', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Buscar y navegar' }));
    expect(screen.getByRole('dialog', { name: 'Buscar y navegar' })).toBeInTheDocument();
  });

  it('filtra rutas sin tildes y navega con flechas + Enter', () => {
    renderShell();
    openWithShortcut();
    type('conciliacion');
    const list = screen.getByRole('listbox');
    const options = within(list).getAllByRole('option');
    expect(options[0]).toHaveTextContent('Conciliación');
    expect(options[0]).toHaveTextContent('Cobranza · Finanzas');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/cobranza?tab=conciliacion');
  });

  it('sin término ofrece las entradas del menú; los nombres anteriores siguen encontrando su pestaña', () => {
    renderShell();
    openWithShortcut();
    const first = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(first[0]).toHaveTextContent('Resumen');
    expect(first.some((o) => o.textContent?.includes('Conciliación'))).toBe(false);
    type('entitlements');
    const option = within(screen.getByRole('listbox')).getAllByRole('option')[0]!;
    expect(option).toHaveTextContent('Módulos habilitados');
    fireEvent.click(option);
    expect(screen.getByTestId('where')).toHaveTextContent('/apps?tab=sincronizacion');
  });

  it('un partner no encuentra las pestañas que no ve', () => {
    state.persona = 'PARTNER';
    state.roles = { ...base, organizations: [{ organizationId: 'o', role: 'PARTNER_ADMIN', displayName: 'Andina' }] };
    renderShell();
    openWithShortcut();
    type('conciliacion');
    expect(screen.queryByRole('option', { name: /Conciliación/ })).not.toBeInTheDocument();
    type('renovaciones');
    expect(screen.getByRole('option', { name: /Renovaciones/ })).toBeInTheDocument();
  });

  it('las flechas mueven la opción activa (aria-activedescendant)', () => {
    renderShell();
    openWithShortcut();
    const input = screen.getByRole('combobox');
    const first = within(screen.getByRole('listbox')).getAllByRole('option')[0]!;
    expect(input).toHaveAttribute('aria-activedescendant', first.id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const second = within(screen.getByRole('listbox')).getAllByRole('option')[1]!;
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', second.id);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options[options.length - 1]).toHaveAttribute('aria-selected', 'true');
  });

  it('no lee organizaciones, tenants ni contratos hasta tener 2 letras', () => {
    renderShell();
    openWithShortcut();
    type('a');
    expect(Object.values(state.enabled).every((v) => v === false)).toBe(true);
    expect(Object.keys(state.enabled).sort()).toEqual(['apps', 'invoices', 'organizations', 'payments', 'subscriptions', 'tenants', 'users']);
    expect(screen.queryByRole('group', { name: 'Organizaciones' })).not.toBeInTheDocument();
  });

  it('busca organizaciones, tenants y contratos (máximo 8 por grupo) y abre la ficha', () => {
    renderShell();
    openWithShortcut();
    type('andes');
    const orgs = screen.getByRole('group', { name: 'Organizaciones' });
    expect(within(orgs).getAllByRole('option')).toHaveLength(8);
    // Los partners van en su propio grupo, no se repiten en Organizaciones.
    expect(within(orgs).queryByRole('option', { name: /Andes Partners/ })).toBeNull();
    const tenants = screen.getByRole('group', { name: 'Tenants' });
    expect(within(tenants).getByRole('option', { name: /Andes Norte/ })).toBeInTheDocument();
    const subs = screen.getByRole('group', { name: 'Contratos' });
    expect(within(subs).getByRole('option', { name: /SUB-ANDES-001/ })).toHaveTextContent('Activa');
    fireEvent.click(within(subs).getByRole('option', { name: /SUB-ANDES-001/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/subscriptions/s-1');
  });

  it('un usuario técnico sin finanzas no busca contratos ni ve rutas financieras', () => {
    state.roles = { ...base, ownedProductIds: ['p1'] };
    renderShell();
    openWithShortcut();
    type('fact');
    expect(screen.queryByRole('option', { name: /Facturación y cobros/ })).not.toBeInTheDocument();
    type('andes');
    expect(state.enabled.subscriptions).toBe(false);
    expect(screen.queryByRole('group', { name: 'Contratos' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Tenants' })).toBeInTheDocument();
  });

  it('sin resultados lo dice en español', () => {
    renderShell();
    openWithShortcut();
    type('zzzz');
    expect(screen.getByText(/Sin resultados para «zzzz»\. Prueba con el nombre/)).toBeInTheDocument();
    // Y lo anuncia a lectores de pantalla.
    const dialog = screen.getByRole('dialog', { name: 'Buscar y navegar' });
    expect(within(dialog).getByRole('status')).toHaveTextContent('Sin resultados para «zzzz»');
  });

  it('acciones: sin término se ofrecen tras «Ir a», sin duplicar la entrada del menú, y llevan a la acción', () => {
    renderShell();
    openWithShortcut();
    const actions = screen.getByRole('group', { name: 'Acciones' });
    expect(within(actions).getAllByRole('option').map((o) => o.textContent?.replace(/\s+/g, ' '))).toEqual([
      expect.stringContaining('Emitir factura…'),
      expect.stringContaining('Nueva venta'),
      expect.stringContaining('Nuevo tenant'),
      expect.stringContaining('Verificar salud de las apps'),
      expect.stringContaining('Ir a Bandeja'),
    ]);
    const nav = screen.getByRole('group', { name: 'Ir a' });
    expect(within(nav).queryByRole('option', { name: /^Nueva venta/ })).toBeNull();
    expect(within(nav).queryByRole('option', { name: /^Bandeja/ })).toBeNull();
    type('emitir');
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(screen.getByTestId('where')).toHaveTextContent('/cobranza?accion=emitir-factura');
  });

  it('acciones según el permiso: un técnico sólo verifica salud y va a la Bandeja; un partner no vende ni crea tenants', () => {
    state.roles = { ...base, ownedProductIds: ['p1'] };
    const { unmount } = renderShell();
    openWithShortcut();
    let labels = within(screen.getByRole('group', { name: 'Acciones' })).getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual([expect.stringContaining('Verificar salud de las apps'), expect.stringContaining('Ir a Bandeja')]);
    unmount();

    state.persona = 'PARTNER';
    state.roles = { ...base, organizations: [{ organizationId: 'o', role: 'PARTNER_ADMIN', displayName: 'Andina' }] };
    renderShell();
    openWithShortcut();
    labels = within(screen.getByRole('group', { name: 'Acciones' })).getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual([expect.stringContaining('Ir a Bandeja')]);
  });

  it('busca facturas, cobros, usuarios, partners y apps (2+ letras) y abre su pantalla', () => {
    renderShell();
    openWithShortcut();
    type('andes');
    expect(state.enabled).toMatchObject({ invoices: true, payments: true, users: true, apps: true });
    const invoices = screen.getByRole('group', { name: 'Facturas' });
    expect(within(invoices).getByRole('option', { name: /F001-ANDES-12/ })).toHaveTextContent('Emitida');
    expect(within(screen.getByRole('group', { name: 'Cobros' })).getByRole('option', { name: /OP-ANDES-77/ })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Usuarios' })).getByRole('option', { name: /Ana Andes/ })).toHaveTextContent('ana@andes.pe');
    expect(within(screen.getByRole('group', { name: 'Partners' })).getByRole('option', { name: /Andes Partners/ })).toBeInTheDocument();
    // Las apps archivadas no se ofrecen.
    const apps = screen.getByRole('group', { name: 'Apps' });
    expect(within(apps).getAllByRole('option')).toHaveLength(1);
    fireEvent.click(within(apps).getByRole('option', { name: /EWM/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/apps/ewm');

    openWithShortcut();
    type('andes');
    fireEvent.click(within(screen.getByRole('group', { name: 'Facturas' })).getByRole('option', { name: /F001-ANDES-12/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/cobranza?tab=facturacion&q=F001-ANDES-12');
  });

  it('sin finanzas no busca facturas ni cobros; sin rol de consola ni de admin no busca usuarios', () => {
    state.roles = { ...base, ownedProductIds: ['p1'] };
    renderShell();
    openWithShortcut();
    type('andes');
    expect(state.enabled).toMatchObject({ invoices: false, payments: false, users: false });
    expect(screen.queryByRole('group', { name: 'Facturas' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Usuarios' })).toBeNull();
  });

  it('no se abre encima de otro diálogo modal (menú móvil)', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog', { name: 'Buscar y navegar' })).not.toBeInTheDocument();
  });
});

describe('commandSearch', () => {
  it('ignora tildes y mayúsculas y prioriza el inicio del campo principal', () => {
    expect(matchRank('CONCILIA', ['Conciliación'])).toBe(0);
    expect(matchRank('cobros', ['Facturación y cobros'])).toBe(1);
    expect(matchRank('turac', ['Facturación y cobros'])).toBe(2);
    expect(matchRank('xyz', ['Facturación y cobros', null])).toBeNull();
    const rows = ['Mi Andes', 'Andes Sur', 'Los andes'];
    expect(topMatches(rows, 'andes', (r) => [r])).toEqual(['Andes Sur', 'Mi Andes', 'Los andes']);
    expect(topMatches(Array.from({ length: 20 }, (_, i) => `x${i}`), 'x', (r) => [r])).toHaveLength(8);
  });
});
