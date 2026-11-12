import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/*
 * V5 · F3 · Ficha 360 de la cuenta.
 * - Cabecera fija: estado, MRR por moneda y saldo vencido (sólo con vista
 *   financiera), apps con el estado del Centro de la suite y responsable comercial.
 * - Cinco pestañas; los enlaces viejos (`#payment-portal`, `?tab=tenants`…)
 *   redirigen a su nueva casa.
 * - Los permisos de siempre: finanzas, partner, técnico y super admin.
 */

const ORG = '30000000-0000-4000-a000-000000000004';
const suspend = vi.fn().mockResolvedValue({});
const q = (data?: unknown, extra: Record<string, unknown> = {}) => ({
  data, error: null, isLoading: false, isFetching: false, refetch: vi.fn(), ...extra,
});

const state = vi.hoisted(() => ({
  persona: 'EBIM' as string,
  platformRole: 'EBIM_SUPER_ADMIN' as string | null,
  orgAdmin: false,
  agreements: [] as unknown[],
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ persona: state.persona, roles: { platformRole: state.platformRole, organizations: [] } }),
}));
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => {
    const r = state.platformRole;
    const platform = r === 'EBIM_PRODUCT_ADMIN' || r === 'EBIM_SUPER_ADMIN';
    const finance = r === 'EBIM_FINANCE' || r === 'EBIM_SUPER_ADMIN';
    return {
      canManagePlatform: platform,
      canReadFinance: finance,
      canManageCommercial: platform || finance,
      isSuperAdmin: r === 'EBIM_SUPER_ADMIN',
      isOrgAdmin: () => state.orgAdmin,
      canManageOrganization: () => platform || state.orgAdmin,
    };
  },
}));
vi.mock('@/features/users/useUserAdminScope', () => ({
  useUserAdminScope: () => ({ canView: false }),
}));
vi.mock('@/components/ui/toast-context', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/services/mutations', () => ({
  useEndProductAgreement: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetTenantStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRequestTenantSuspension: () => ({ mutateAsync: suspend, isPending: false }),
  useRequestTenantResume: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/services/queries', () => ({
  useOrganization: () =>
    q({
      id: ORG, display_name: 'Qhapaq', legal_name: 'Qhapaq SAC', country_code: 'PE', tax_id: null, status: 'ACTIVE',
      billing_email: null, accent_color: null, slug: 'qhapaq', brand_slug: null, white_label: false,
      organization_capabilities: [{ capability: 'CUSTOMER' }], companies: [],
    }),
  useOrganizationAgreements: () => q([]),
  usePartnerAgreements: () => q(state.agreements),
  useAccountSeries: () =>
    q([
      {
        month: '2026-11-01', asOf: '2026-11-12', isPartial: true, reportingCurrency: 'USD', mrr: 1234,
        invoiced: null, collected: null, mrrNative: { PEN: 2660, USD: 450 }, invoicedNative: {}, collectedNative: {},
        complete: true, missingCurrencies: [], fxIsDemo: false,
      },
    ]),
  useAdminUsers: () => q([]),
  useProvisioningTargets: () => q([]),
}));
vi.mock('@/services/financeRead', () => ({
  useInvoiceSummary: () => q({ overdue: { PEN: 800 }, receivable: {}, collected: {}, invoiced: {} }),
  useRenewalPipeline: () => q([{ is_past_due: true, suspension_pending: false }]),
}));
vi.mock('./org360Queries', () => ({
  useOrgTenants: () =>
    q([
      { tenant_id: 't1', name: 'Qhapaq EWM', status: 'PENDING', customer_organization_id: ORG, saas_product_id: 'p-ewm', product_short_name: 'EWM', product_code: 'ewm' },
      { tenant_id: 't2', name: 'Qhapaq TMS', status: 'ACTIVE', customer_organization_id: ORG, saas_product_id: 'p-tms', product_short_name: 'TMS', product_code: 'tms' },
    ]),
  useOrgSaasProvisioning: () =>
    q([
      { id: 'r1', tenant_id: 't1', saas_product_id: 'p-ewm', status: 'ACTIVE', requested_at: '2026-10-01' },
      { id: 'r2', tenant_id: 't2', saas_product_id: 'p-tms', status: 'ACTIVE', requested_at: '2026-10-01' },
    ]),
  useOrgAttributions: () =>
    q([
      { id: 'a1', attribution_pct: 1, status: 'ACTIVE', valid_from: '2026-01-01', valid_to: null, sales_agents: { full_name: 'Rosa Quispe', agent_type: 'INTERNAL' } },
    ]),
  useOrgSalesAgents: () => q([]),
  useOrgPartnerMargin: () => q([]),
}));
// Las secciones tienen sus propios tests: aquí sólo importa en qué pestaña viven.
vi.mock('./Organization360', () => ({
  Org360KpiStrip: () => <div>Franja de indicadores</div>,
  Org360Summary: () => <div>Resumen de la cuenta</div>,
  Org360Apps: () => <div>Tabla de apps y accesos</div>,
  Org360Contracts: () => <div>Cobranza por SaaS</div>,
  Org360Billing: () => <div>Facturas de la organización</div>,
  Org360Documents: () => <div>Documentos comerciales</div>,
  Org360Activity: () => <div>Bitácora de la organización</div>,
}));
vi.mock('./PaymentPortalPanel', () => ({ PaymentPortalPanel: () => <div>Portal de pago de la cuenta</div> }));
vi.mock('./CustomerProgress', () => ({ CustomerProgress: () => <div>Hilo de progreso del cliente</div> }));
vi.mock('./BillingContactPanel', () => ({ BillingContactPanel: () => <div>Datos del titular</div> }));
vi.mock('@/features/partnerFees/PartnerFeeStatementsPanel', () => ({
  PartnerFeeStatementsPanel: () => <div>Estados de tarifa de plataforma</div>,
}));
vi.mock('./AgreementFormDialog', () => ({ AgreementFormDialog: () => null }));
vi.mock('./CompanyFormDialog', () => ({ CompanyFormDialog: () => null }));
vi.mock('@/features/partnerFees/PlatformFeeDialog', () => ({ PlatformFeeDialog: () => null }));

import { OrganizationDetailPage } from './OrganizationDetailPage';

function Probe() {
  const l = useLocation();
  return <output data-testid="url">{`${l.search}${l.hash}`}</output>;
}

function renderAt(url = `/organizations/${ORG}`) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/organizations/:organizationId"
          element={
            <>
              <OrganizationDetailPage />
              <Probe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const header = () => screen.getByRole('region', { name: 'Resumen de la cuenta' });

beforeEach(() => {
  suspend.mockClear();
  state.persona = 'EBIM';
  state.platformRole = 'EBIM_SUPER_ADMIN';
  state.orgAdmin = false;
  state.agreements = [];
});

describe('cabecera fija', () => {
  it('estado, MRR por moneda sin sumar, saldo vencido, apps con su estado y responsable comercial', () => {
    renderAt();
    const bar = header();
    expect(bar).toHaveAttribute('data-summary-bar');
    expect(within(bar).getByText('Activo')).toBeInTheDocument();
    const mrr = bar.querySelector('[data-mrr]') as HTMLElement;
    expect(mrr.textContent).toMatch(/PEN|S\//);
    expect(mrr.textContent).toMatch(/USD|US\$|\$/);
    // Dos monedas, dos importes: nunca la cifra convertida de la moneda de reporte.
    expect(mrr.textContent).not.toMatch(/1[.,]?234/);
    expect(bar.querySelector('[data-overdue]')?.textContent).toMatch(/800/);
    expect(within(bar).getByText('Con deuda vencida')).toBeInTheDocument();
    const ewm = bar.querySelector('[data-app-chip="EWM"]') as HTMLElement;
    expect(ewm).toHaveAttribute('data-kind', 'PENDING_CONFIRM');
    expect(ewm).toHaveTextContent('EWM · Por confirmar');
    expect(bar.querySelector('[data-app-chip="TMS"]')).toHaveTextContent('TMS · Activo');
    expect(within(bar).getByText('Apps · 1 de 2 activas')).toBeInTheDocument();
    expect(bar.querySelector('[data-owner]')).toHaveTextContent('Rosa Quispe');
  });

  it('un perfil técnico EBIM (sin vista financiera) no ve MRR, saldo vencido ni la franja de indicadores', () => {
    state.platformRole = null;
    renderAt();
    const bar = header();
    expect(bar.querySelector('[data-mrr]')).toBeNull();
    expect(within(bar).queryByText('MRR vigente')).toBeNull();
    expect(within(bar).queryByText('Saldo vencido')).toBeNull();
    // Las apps y el estado sí: no son información financiera.
    expect(bar.querySelector('[data-app-chip="EWM"]')).not.toBeNull();
    expect(screen.queryByText('Franja de indicadores')).toBeNull();
  });

  it('el partner ve los importes de su propia cuenta (RLS decide qué filas llegan)', () => {
    state.persona = 'PARTNER';
    state.platformRole = null;
    renderAt();
    expect(header().querySelector('[data-mrr]')).not.toBeNull();
  });
});

describe('pestañas', () => {
  it('cinco pestañas: Resumen · Apps y accesos · Contratos y cobranza · Personas · Actividad', () => {
    renderAt();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Resumen', 'Apps y accesos', 'Contratos y cobranza', 'Personas', 'Actividad',
    ]);
    expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Resumen de la cuenta')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Identidad y marca' })).toBeInTheDocument();
  });

  it('cada pestaña reubica su contenido anterior', async () => {
    renderAt();
    await userEvent.click(screen.getByRole('tab', { name: 'Apps y accesos' }));
    expect(screen.getByText('Tabla de apps y accesos')).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent('?tab=apps');

    await userEvent.click(screen.getByRole('tab', { name: 'Contratos y cobranza' }));
    for (const text of ['Cobranza por SaaS', 'Facturas de la organización', 'Portal de pago de la cuenta', 'Datos del titular', 'Documentos comerciales']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { name: 'Acuerdos de producto' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Margen de la organización' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Personas' }));
    expect(screen.getByRole('heading', { name: 'Atribución comercial' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Comerciales afiliados' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Actividad' }));
    expect(screen.getByText('Bitácora de la organización')).toBeInTheDocument();
  });
});

describe('enlaces viejos', () => {
  it.each([
    ['#payment-portal', 'Contratos y cobranza', '?tab=contratos#payment-portal'],
    ['#view360', 'Resumen', '?tab=resumen#view360'],
    ['#tenants', 'Apps y accesos', '?tab=apps#tenants'],
    ['#commercials', 'Personas', '?tab=personas#commercials'],
    ['#activity', 'Actividad', '?tab=actividad#activity'],
    ['?tab=billing', 'Contratos y cobranza', '?tab=contratos#billing'],
    ['?tab=margin', 'Contratos y cobranza', '?tab=contratos#margin'],
    ['?tab=overview', 'Resumen', '?tab=resumen#overview'],
  ])('%s abre «%s»', async (suffix, tab, url) => {
    renderAt(`/organizations/${ORG}${suffix}`);
    expect(await screen.findByRole('tab', { name: tab, selected: true })).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent(url);
  });
});

describe('permisos', () => {
  it('sin finanzas: ni portal de pago ni margen; el resto de la cobranza sigue', () => {
    state.platformRole = null;
    renderAt(`/organizations/${ORG}?tab=contratos`);
    expect(screen.getByText('Cobranza por SaaS')).toBeInTheDocument();
    expect(screen.queryByText('Portal de pago de la cuenta')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Margen de la organización' })).toBeNull();
  });

  it('finanzas ve portal y margen, pero no administra acuerdos', () => {
    state.platformRole = 'EBIM_FINANCE';
    renderAt(`/organizations/${ORG}?tab=contratos`);
    expect(screen.getByText('Portal de pago de la cuenta')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Margen de la organización' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear el primer acuerdo' })).toBeNull();
  });

  it('el admin del partner ve su tarifa de plataforma; un partner ajeno no', () => {
    state.persona = 'PARTNER';
    state.platformRole = null;
    state.agreements = [{ agreement_id: 'ag-1', product_short_name: 'EWM', status: 'ACTIVE' }];
    state.orgAdmin = true;
    const { unmount } = renderAt(`/organizations/${ORG}?tab=contratos`);
    expect(screen.getByText('Estados de tarifa de plataforma')).toBeInTheDocument();
    expect(screen.queryByText('Portal de pago de la cuenta')).toBeNull();
    unmount();
    state.orgAdmin = false;
    renderAt(`/organizations/${ORG}?tab=contratos`);
    expect(screen.queryByText('Estados de tarifa de plataforma')).toBeNull();
  });

  it('el responsable comercial es información, no acceso: se ve sin pedir más permisos', () => {
    state.persona = 'SALES_AGENT';
    state.platformRole = null;
    renderAt();
    expect(header().querySelector('[data-owner]')).toHaveTextContent('Rosa Quispe');
    expect(screen.queryByRole('button', { name: /Más acciones/ })).toBeNull();
  });
});

describe('suspender el servicio de la cuenta (V5 · F4)', () => {
  it('lista las apps afectadas, omite los tenants que no cambian y suspende uno a uno con el motivo', async () => {
    renderAt();
    expect(screen.getByText('Hilo de progreso del cliente')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Más acciones de Qhapaq' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Suspender el servicio' }));
    const dialog = screen.getByRole('dialog', { name: 'Suspender el servicio de Qhapaq' });
    const impact = dialog.querySelector('[data-lifecycle-impact]') as HTMLElement;
    // TMS está activo: cambia. EWM está pendiente: no admite la suspensión.
    expect(impact.querySelector('[data-impact-app="TMS"]')).not.toBeNull();
    expect(impact.querySelector('[data-impact-app="EWM"]')).toBeNull();
    expect(within(dialog).getByText(/1 tenant no cambia \(Qhapaq EWM\)/)).toBeInTheDocument();
    expect(within(dialog).getByText('La app aún no aplica la suspensión: canal pendiente.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), 'Mora');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspender' }));
    expect(suspend).toHaveBeenCalledTimes(1);
    expect(suspend).toHaveBeenCalledWith({ p_tenant_id: 't2', p_reason: 'Mora' });
  });

  it('sin permiso de plataforma no se ofrece', async () => {
    state.platformRole = 'EBIM_FINANCE';
    renderAt();
    expect(screen.queryByRole('button', { name: 'Más acciones de Qhapaq' })).toBeNull();
  });
});
