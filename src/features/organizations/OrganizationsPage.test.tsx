import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

/*
 * P21/P23/P24 · Clientes, Todas las organizaciones y Partners son vistas del
 * MISMO directorio: cada fila abre la ficha 360 y un fallo de lectura nunca se
 * ve como «sin clientes».
 *
 * V6 · F1: Clientes y Todas las organizaciones son un listado gerencial —apps
 * con su estado, MRR, saldo vencido, salud de cobranza, canal y responsable—
 * con una franja de cifras que filtra la tabla. Lo financiero solo con vista
 * financiera.
 */

const m = vi.hoisted(() => ({
  orgs: vi.fn(),
  tenants: vi.fn(),
  saas: vi.fn(),
  attributions: vi.fn(),
  overdue: vi.fn(),
  renewals: vi.fn(),
  finance: true,
  overdueEnabled: [] as boolean[],
  partnerFinanceEnabled: [] as boolean[],
}));

vi.mock('@/services/queries', () => ({
  useOrganizations: () => m.orgs(),
  useTenantOverview: () => m.tenants(),
  useSaasProvisioningRequests: () => m.saas(),
  useAttributions: () => m.attributions(),
}));
vi.mock('./accountListQueries', () => ({
  useAccountOverdueInvoices: ({ enabled }: { enabled: boolean }) => {
    m.overdueEnabled.push(enabled);
    return enabled ? m.overdue() : { data: undefined, isLoading: false, error: null };
  },
  useAccountRenewalFlags: ({ enabled }: { enabled: boolean }) =>
    enabled ? m.renewals() : { data: undefined, isLoading: false, error: null },
}));
vi.mock('./partnerListQueries', () => ({
  usePartnerListFinance: ({ enabled }: { enabled: boolean }) => {
    m.partnerFinanceEnabled.push(enabled);
    return enabled
      ? { data: [{ organization_id: 'andina', weighted_channel_margin_rate: 0.2, active_agreements: 2 }], isLoading: false, error: null }
      : { data: undefined, isLoading: false, error: null };
  },
  usePartnerListFees: ({ enabled }: { enabled: boolean }) =>
    enabled ? { data: [], isLoading: false, error: null } : { data: undefined, isLoading: false, error: null },
}));
vi.mock('@/app/useNavAccess', () => ({
  useNavAccess: () => ({ persona: 'EBIM', finance: m.finance, superAdmin: false, loading: false }),
}));
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ canManagePlatform: false, canManageOrganization: () => false }),
}));
vi.mock('./OrganizationFormDialog', () => ({ OrganizationFormDialog: () => null }));

import { CustomersPage } from './CustomersPage';
import { PartnersPage } from './PartnersPage';
import { OrganizationsPage } from './OrganizationsPage';

function org(id: string, name: string, caps: string[], status = 'ACTIVE') {
  return {
    id,
    slug: id,
    display_name: name,
    legal_name: `${name} SAC`,
    country_code: 'PE',
    tax_id: id === 'grupasa' ? '20500000001' : null,
    billing_email: null,
    status,
    kind: 'CUSTOMER',
    accent_color: null,
    organization_capabilities: caps.map((capability) => ({ capability })),
  };
}

const ORGS = [
  org('grupasa', 'GRUPASA', ['CUSTOMER']),
  org('andina', 'Consultora Andina', ['PARTNER', 'CUSTOMER']),
  org('canal', 'Canal Sur', ['RESELLER'], 'INACTIVE'),
];

const TENANTS = [
  {
    tenant_id: 't1', name: 'Grupasa EWM', status: 'ACTIVE', customer_organization_id: 'grupasa',
    managing_organization_id: 'andina', managing_name: 'Consultora Andina',
    saas_product_id: 'p-ewm', product_short_name: 'EWM', mrr: 1800, currency: 'USD',
  },
  {
    tenant_id: 't2', name: 'Grupasa eChange', status: 'ACTIVE', customer_organization_id: 'grupasa',
    managing_organization_id: null, managing_name: null,
    saas_product_id: 'p-ech', product_short_name: 'eChange', mrr: 950, currency: 'PEN',
  },
];

function renderWith(node: ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

const ok = <T,>(data: T) => ({ data, isLoading: false, error: null, refetch: vi.fn() });

beforeEach(() => {
  m.finance = true;
  m.overdueEnabled = [];
  m.partnerFinanceEnabled = [];
  m.orgs.mockReturnValue(ok(ORGS));
  m.tenants.mockReturnValue(ok(TENANTS));
  m.saas.mockReturnValue(
    ok([
      { tenant_id: 't1', saas_product_id: 'p-ewm', status: 'ACTIVE', requested_at: '2026-10-01' },
      { tenant_id: 't2', saas_product_id: 'p-ech', status: 'FAILED', requested_at: '2026-10-02' },
    ]),
  );
  m.attributions.mockReturnValue(
    ok([
      {
        customer_organization_id: 'grupasa', attribution_pct: 100, status: 'ACTIVE', valid_from: '2026-01-01', valid_to: null,
        sales_agents: { full_name: 'Beto Ríos' },
      },
    ]),
  );
  m.overdue.mockReturnValue(
    ok([
      { customer_organization_id: 'grupasa', currency: 'USD', balance: 1800, days_overdue: 45 },
      { customer_organization_id: 'grupasa', currency: 'USD', balance: 200, days_overdue: 10 },
    ]),
  );
  m.renewals.mockReturnValue(ok([{ billed_organization_id: 'grupasa', is_past_due: true, suspension_pending: false }]));
});

describe('Cuentas · Clientes (V6 · F1)', () => {
  it('un error de lectura es un estado de error con reintento, no una lista vacía', () => {
    m.orgs.mockReturnValue({ data: undefined, isLoading: false, error: new Error('timeout'), refetch: vi.fn() });
    renderWith(<CustomersPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar la información');
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(screen.queryByText('Sin clientes')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('solo clientes; cada fila enlaza a su ficha 360 con las columnas de negocio', () => {
    renderWith(<CustomersPage />);
    expect(screen.getByRole('heading', { name: 'Clientes' })).toBeInTheDocument();
    expect(screen.queryByText('Canal Sur')).toBeNull();
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Cuenta', 'Apps', 'MRR', 'Saldo vencido', 'Cobranza', 'Canal', 'Responsable', 'Acciones']);
    const row = screen.getByRole('row', { name: /GRUPASA/ });
    expect(within(row).getByRole('link', { name: 'GRUPASA' })).toHaveAttribute('href', '/organizations/grupasa');
    // País y RUC en la segunda línea, no como columnas.
    expect(within(row).getByText('20500000001')).toHaveClass('font-mono');
    // Apps con su estado (el del Centro de la suite), lo que pide atención primero.
    const apps = within(row).getByRole('list', { name: 'Apps de GRUPASA' });
    expect(within(apps).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'eChange: Alta fallida',
      'EWM: Activo',
    ]);
    // Dinero por moneda, nunca sumado; vencido con facturas y antigüedad.
    expect(within(row).getByTitle(/USD\s1,800\.00/)).toBeInTheDocument();
    expect(within(row).getByTitle(/PEN\s950\.00/)).toBeInTheDocument();
    expect(within(row).getByText('2 facturas · 45 días')).toBeInTheDocument();
    expect(within(row).getByText('Con deuda')).toBeInTheDocument();
    expect(within(row).getByText('Vía Consultora Andina')).toBeInTheDocument();
    expect(within(row).getByText('Beto Ríos')).toBeInTheDocument();
    // Acciones secundarias en el menú de la fila (A12).
    expect(within(row).getByRole('button', { name: 'Acciones de GRUPASA' })).toBeInTheDocument();
  });

  it('la franja resume la cartera y cada cifra filtra la tabla', () => {
    renderWith(<CustomersPage />);
    const strip = screen.getByRole('region', { name: 'Resumen de clientes' });
    expect(within(strip).getByText('Clientes activos')).toBeInTheDocument();
    const debt = within(strip).getByRole('button', { name: /Saldo vencido/ });
    expect(debt).toHaveTextContent('2 facturas · 1 cuenta');
    fireEvent.click(debt);
    expect(debt).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('tab', { name: /Con deuda/, selected: true })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /GRUPASA/ })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /^Consultora Andina/ })).toBeNull();
    // Volver a pulsar quita el filtro.
    fireEvent.click(debt);
    expect(screen.getByRole('row', { name: /^Consultora Andina/ })).toBeInTheDocument();
  });

  it('sin vista financiera no pide ni muestra MRR, vencido ni cobranza', () => {
    m.finance = false;
    renderWith(<CustomersPage />);
    expect(m.overdueEnabled.every((e) => e === false)).toBe(true);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Cuenta', 'Apps', 'Canal', 'Responsable', 'Acciones']);
    expect(document.body.textContent).not.toMatch(/MRR|Saldo vencido/);
  });

  it('si no se pueden leer los tenants, la columna de apps lo dice y la tabla sigue', () => {
    m.tenants.mockReturnValue({ data: undefined, isLoading: false, error: new Error('x') });
    renderWith(<CustomersPage />);
    const row = screen.getByRole('row', { name: /GRUPASA/ });
    expect(within(row).getByText('No disponible')).toBeInTheDocument();
  });

  it('una búsqueda sin resultados ofrece limpiarla', () => {
    renderWith(<CustomersPage />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(screen.getByText('Ningún resultado para «zzz»')).toBeInTheDocument();
    const empty = document.querySelector('[data-empty-variant="no-results"]') as HTMLElement;
    fireEvent.click(within(empty).getByRole('button', { name: 'Limpiar búsqueda' }));
    expect(screen.getByRole('row', { name: /GRUPASA/ })).toBeInTheDocument();
  });
});

describe('Cuentas · Todas las organizaciones y Partners', () => {
  it('Todas: pestañas de capacidad con conteos; capacidades en la segunda línea y tenants propios · administrados', () => {
    renderWith(<OrganizationsPage />);
    expect(screen.getByRole('heading', { name: 'Todas las organizaciones' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Todas\s*3/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Partners\s*2/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Clientes\s*2/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Estado' })).toHaveDisplayValue('Todos (3)');
    const andina = screen.getByRole('row', { name: /^Consultora Andina/ });
    expect(within(andina).getByText('Partner')).toBeInTheDocument();
    expect(within(andina).getByTitle('Propios · que administra como canal')).toHaveTextContent('0 · 1 como canal');
  });

  it('Partners: solo canales, con su cartera administrada y la franja de cifras', () => {
    renderWith(<PartnersPage />);
    expect(screen.getByText('Consultora Andina')).toBeInTheDocument();
    expect(screen.getByText('Canal Sur')).toBeInTheDocument();
    expect(screen.queryByText('GRUPASA')).toBeNull();
    expect(screen.getByRole('tab', { name: /Activos\s*1/ })).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Consultora Andina/ });
    // Administra 1 tenant de 1 cliente (GRUPASA) en EWM, con su MRR en USD.
    expect(within(row).getAllByRole('cell', { name: '1' })[0]).toHaveClass('ebim-num');
    expect(within(row).getByText('EWM')).toBeInTheDocument();
    expect(within(row).getByTitle('USD 1,800.00')).toBeInTheDocument();
    // «Cliente» se marca porque también compra; «Partner» es lo normal aquí.
    expect(within(row).getByText('Cliente')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Resumen de partners' })).toHaveTextContent('MRR administrado');
  });

  it('Partners sin vista financiera: ni MRR, ni margen, ni tarifa', () => {
    m.finance = false;
    renderWith(<PartnersPage />);
    expect(screen.getByText('Consultora Andina')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/MRR|Margen|Tarifa/i);
    expect(m.partnerFinanceEnabled).toEqual([false]);
  });
});
