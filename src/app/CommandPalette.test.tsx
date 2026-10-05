import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRoles } from '@/types/domain';
import type { PersonaKind } from '@/features/auth/session';
import { matchRank, topMatches } from './commandSearch';

const state = vi.hoisted(() => ({
  persona: 'EBIM' as PersonaKind,
  roles: null as SessionRoles | null,
  enabled: { organizations: false, tenants: false, subscriptions: false },
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

vi.mock('@/services/queries', () => {
  const result = (enabled: boolean, rows: unknown[]) =>
    enabled ? { data: rows, isFetching: false, isError: false } : { data: undefined, isFetching: false, isError: false };
  return {
    useCriticalBillingAlertCount: () => ({ data: undefined }),
    useOrganizations: ({ enabled }: { enabled: boolean }) => {
      state.enabled.organizations ||= enabled;
      return result(enabled, ORGS);
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

import { AppShell } from './AppShell';

const base: SessionRoles = {
  userId: 'u', email: 'u@ebim.test', fullName: 'Usuaria Prueba', platformRole: null, organizations: [],
  tenantRoles: [], salesAgentId: null, provisioningRoles: [], ownedProductIds: [],
};

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
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
  state.enabled = { organizations: false, tenants: false, subscriptions: false };
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
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/reconciliation');
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
    expect(state.enabled).toEqual({ organizations: false, tenants: false, subscriptions: false });
    expect(screen.queryByRole('group', { name: 'Organizaciones' })).not.toBeInTheDocument();
  });

  it('busca organizaciones, tenants y contratos (máximo 8 por grupo) y abre la ficha', () => {
    renderShell();
    openWithShortcut();
    type('andes');
    const orgs = screen.getByRole('group', { name: 'Organizaciones' });
    expect(within(orgs).getAllByRole('option')).toHaveLength(8);
    const tenants = screen.getByRole('group', { name: 'Tenants' });
    expect(within(tenants).getByRole('option', { name: /Andes Norte/ })).toBeInTheDocument();
    const subs = screen.getByRole('group', { name: 'Contratos y suscripciones' });
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
    expect(screen.queryByRole('group', { name: 'Contratos y suscripciones' })).not.toBeInTheDocument();
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
