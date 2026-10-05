import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * P22 · Cliente / partner 360 (spec §11.1, §9.3, E16).
 * - Cada lectura va acotada a la organización (no universos globales).
 * - Un error en una sección no borra las demás ni se ve como «sin movimientos».
 */
const ORG = '30000000-0000-4000-a000-000000000004';
type Q = { data?: unknown; error?: unknown; isLoading?: boolean; isFetching?: boolean; refetch: () => void; dataUpdatedAt?: number };
const q = (data?: unknown, error?: unknown): Q => ({ data, error, isLoading: false, isFetching: false, refetch: vi.fn(), dataUpdatedAt: 1 });

const calls = vi.hoisted(() => ({ scoped: [] as Array<[string, unknown]>, docsError: null as unknown }));

vi.mock('./org360Queries', () => ({
  useOrgSubscriptions: (id: string) => {
    calls.scoped.push(['subs', id]);
    return q([{ subscription_id: 's1', subscription_code: 'SUB-1', product_short_name: 'eSupplier', product_code: 'esupplier', tenant_id: 't1', tenant_name: 'Alpha', collection_method: 'MANUAL', subscription_status: 'ACTIVE' }]);
  },
  useOrgDocuments: (id: string) => {
    calls.scoped.push(['docs', id]);
    return calls.docsError ? q(undefined, calls.docsError) : q([]);
  },
  useOrgTenants: (id: string) => {
    calls.scoped.push(['tenants', id]);
    return q([{ tenant_id: 't1', name: 'Alpha', product_short_name: 'EWM', customer_organization_id: ORG, managing_organization_id: null, status: 'PENDING', tenant_type: 'PRODUCTION', mrr: 0, currency: null, environment: 'QAS' }]);
  },
  useOrgSaasProvisioning: () => q([{ tenant_id: 't1', status: 'ACTIVE', mapping_status: 'ACTIVE', requested_at: '2026-09-24', product_short_name: 'EWM', mapping_metadata: { resources: { adminProvisioningStatus: 'PREPROVISIONED' } } }]),
  useOrgCommissions: () => q([]),
  useOrgInfraRequests: () => q([]),
  useOrgAudit: () => q([]),
}));
vi.mock('@/services/queries', () => ({
  useAccountSeries: (p: { organizationId?: string }) => {
    calls.scoped.push(['series', p.organizationId]);
    return q([]);
  },
  useProvisioningTargets: () => q([]),
  useCurrencies: () => q([]),
}));
vi.mock('@/services/financeRead', () => ({
  useInvoiceSummary: (p: { organizationId?: string }) => {
    calls.scoped.push(['invoices', p.organizationId]);
    return q({ row_count: 0, receivable: {}, overdue: {}, collected: {}, invoiced: {} });
  },
  useInvoicePage: () => q({ rows: [], total: 0 }),
  fetchInvoicePage: vi.fn(),
  useRenewalPipeline: (id?: string) => {
    calls.scoped.push(['renewals', id]);
    return q([]);
  },
  EXPORT_LIMIT: 5000,
  EXPORT_PAGE_SIZE: 500,
  PAGE_SIZES: [10, 25, 50],
}));

import { Org360Contracts, Org360Documents, Org360KpiStrip, Org360Summary, Org360Tenants } from './Organization360';

beforeEach(() => {
  calls.scoped.length = 0;
  calls.docsError = null;
});

const wrap = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);

describe('Organización 360', () => {
  it('todas las lecturas del resumen van acotadas a la organización', () => {
    wrap(
      <>
        <Org360KpiStrip organizationId={ORG} />
        <Org360Summary organizationId={ORG} organizationName="Alpha" capabilities={['CUSTOMER']} />
      </>,
    );
    expect(calls.scoped.map(([k]) => k)).toEqual(expect.arrayContaining(['series', 'invoices', 'renewals', 'subs', 'tenants']));
    for (const [, id] of calls.scoped) expect(id).toBe(ORG);
  });

  it('cabecera 360: sin contratos ni saldo muestra estados explicados, nunca un 0 que parezca dato', () => {
    wrap(<Org360KpiStrip organizationId={ORG} />);
    const strip = screen.getByRole('region', { name: 'Indicadores de la cuenta' });
    expect(within(strip).getByText('Sin contratos recurrentes vigentes')).toBeInTheDocument();
    expect(within(strip).getByText('Sin saldo pendiente')).toBeInTheDocument();
    expect(within(strip).getByText('Sin contratos')).toBeInTheDocument();
    expect(within(strip).queryByText(/^0$/)).toBeNull();
  });

  it('resumen: los datos de la cuenta van en español (capacidades, métodos)', () => {
    wrap(<Org360Summary organizationId={ORG} organizationName="Alpha" capabilities={['CUSTOMER', 'PARTNER']} />);
    expect(screen.getByText('Cliente')).toBeInTheDocument();
    expect(screen.getByText('Partner')).toBeInTheDocument();
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(screen.queryByText('CUSTOMER')).toBeNull();
  });

  it('un error en documentos se ve como error de esa sección; contratos siguen visibles', () => {
    calls.docsError = new Error('permiso de lectura caído');
    wrap(
      <>
        <Org360Contracts organizationId={ORG} organizationName="Alpha" />
        <Org360Documents organizationId={ORG} />
      </>,
    );
    expect(screen.getByText('SUB-1')).toBeInTheDocument();
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('No se pudo leer');
    expect(screen.queryByText(/no exige OS\/OC/)).not.toBeInTheDocument();
  });

  it('tenants: comercial PENDING + alta ACTIVE + admin PREPROVISIONED por separado', () => {
    wrap(<Org360Tenants organizationId={ORG} />);
    const row = screen.getByRole('link', { name: 'Alpha' }).closest('tr') as HTMLElement;
    expect(within(row).getByText('Pendiente de activación comercial')).toBeInTheDocument();
    expect(within(row).getByText('Alta registrada · mapping activo')).toBeInTheDocument();
    expect(within(row).getByText('Administrador preaprovisionado')).toBeInTheDocument();
  });
});
