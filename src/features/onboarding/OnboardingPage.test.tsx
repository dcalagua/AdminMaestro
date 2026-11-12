import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/*
 * V5 · F4 · Flujo guiado de alta.
 * - Venta: hilo de seis fases, de la cuenta al alta en las apps.
 * - «Nuevo tenant» (`?modo=app`): cuenta existente → tenant con create_tenant →
 *   alta en esa app, en la misma pantalla; nada se ejecuta solo.
 */
const ORG = '30000000-0000-4000-a000-000000000004';
const q = (data: unknown) => ({ data, error: null, isLoading: false, refetch: vi.fn() });

const m = vi.hoisted(() => ({
  createTenant: vi.fn(),
  onboard: vi.fn(),
  platform: true,
  commercial: true,
}));

vi.mock('@/services/queries', () => ({
  useProducts: () => q([{ id: 'p-ewm', code: 'ewm', short_name: 'EWM', lockup_name: 'EBIM EWM', status: 'ACTIVE' }]),
  useOrganizations: () => q([{ id: ORG, display_name: 'Alpha', country_code: 'PE', billing_email: 'pagos@alpha.pe' }]),
  usePlans: () => q([]),
  usePartnerAgreements: () => q([]),
  useSalesAgents: () => q([]),
  useCommissionPlans: () => q([]),
  useDeploymentTargets: () => q([]),
  useMarkets: () => q([]),
  usePlanPriceCatalog: () => q([]),
}));
vi.mock('@/services/mutations', () => ({
  useOnboardCustomer: () => ({ mutateAsync: m.onboard, isPending: false, error: null }),
  useCreateTenant: () => ({ mutateAsync: m.createTenant, isPending: false, error: null }),
}));
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ canManagePlatform: m.platform, canManageCommercial: m.commercial, canReadFinance: false }),
}));
vi.mock('@/components/ui/toast-context', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), push: vi.fn() }) }));
vi.mock('./steps/AfterSaleSteps', () => ({
  FirstInvoiceStep: () => <div>Paso primera factura</div>,
  PaymentLinkStep: () => <div>Paso enlace de pago</div>,
  AppsStep: ({ created, onlyThisTenant }: { created: { tenantName: string; productName: string }; onlyThisTenant: boolean }) => (
    <div>
      Alta de {created.tenantName} en {created.productName}
      {onlyThisTenant ? ' (sólo esta app)' : ''}
    </div>
  ),
}));

import { OnboardingPage } from './OnboardingPage';

function Probe() {
  const l = useLocation();
  return <output data-testid="url">{l.pathname}</output>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const phases = () =>
  within(screen.getByRole('navigation', { name: 'Pasos del alta' }))
    .getAllByRole('button')
    .map((b) => b.textContent?.replace(/^\d+/, '').replace(/^(Completado|Paso actual|Pendiente):\s*/, '').trim());

beforeEach(() => {
  m.createTenant.mockReset().mockResolvedValue('tn-new');
  m.onboard.mockReset();
  m.platform = true;
  m.commercial = true;
});

describe('venta', () => {
  it('el hilo va de la cuenta al alta en las apps', () => {
    renderAt('/onboarding');
    expect(screen.getByRole('heading', { level: 1, name: 'Nueva venta / alta de cliente' })).toBeInTheDocument();
    expect(phases()).toEqual(['Cuenta', 'Plan y precio', 'Contrato', 'Primera factura', 'Enlace de pago', 'Alta en las apps']);
    expect(screen.getByRole('navigation', { name: 'Pasos del alta' })).toHaveTextContent('Paso 1 de 6 · Cuenta · Cliente, mercado y producto');
    // Descripción en lenguaje de negocio, sin la jerga del envío atómico.
    expect(screen.queryByText(/en un solo envío|solicitud de infraestructura/)).toBeNull();
    expect(screen.getByLabelText(/País \/ mercado de la venta/)).toBeInTheDocument();
  });

  it('«Nueva venta para esta cuenta» llega con la cuenta elegida', () => {
    renderAt(`/onboarding?cuenta=${ORG}`);
    expect(screen.getByLabelText(/Organización cliente/)).toHaveValue(ORG);
  });
});

describe('«Nuevo tenant»: sólo el alta en una app', () => {
  it('cuenta → tenant → alta en la app, con create_tenant y sin contrato', async () => {
    renderAt(`/onboarding?modo=app&cuenta=${ORG}`);
    expect(screen.getByRole('heading', { level: 1, name: 'Nuevo tenant' })).toBeInTheDocument();
    expect(phases()).toEqual(['Cuenta y app', 'Tenant', 'Alta en la app']);
    // Cuenta existente ya elegida; no se pide mercado.
    expect(screen.getByLabelText(/Organización cliente/)).toHaveValue(ORG);
    expect(screen.queryByLabelText(/País \/ mercado/)).toBeNull();

    // Sin app no avanza.
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByText(/Falta 1 dato para continuar/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/Producto SaaS/), 'ewm');
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(screen.queryByLabelText(/Margen del canal/)).toBeNull();
    await userEvent.type(screen.getByLabelText(/Nombre del tenant/), 'Alpha EWM');
    await userEvent.type(screen.getByLabelText(/^Código/), 'alpha-ewm');
    await userEvent.type(screen.getByLabelText(/Correo del administrador/), 'admin@alpha.pe');
    await userEvent.click(screen.getByRole('button', { name: 'Crear tenant' }));

    expect(m.createTenant).toHaveBeenCalledWith({
      p_saas_product_code: 'ewm',
      p_customer_organization_id: ORG,
      p_slug: 'alpha-ewm',
      p_name: 'Alpha EWM',
      p_admin_email: 'admin@alpha.pe',
      p_tenant_type: 'PRODUCTION',
      p_deployment_mode: 'SHARED',
      p_managing_organization_id: undefined,
    });
    expect(m.onboard).not.toHaveBeenCalled();

    // Sigue en la misma pantalla, en el alta de esa app.
    expect(await screen.findByText('Alta de Alpha EWM en EWM (sólo esta app)')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Pasos del alta' })).toHaveTextContent('Paso 3 de 3 · Alta en la app');
    expect(screen.getByRole('link', { name: 'Ir a la ficha del tenant' })).toHaveAttribute('href', '/tenants/tn-new');
    // Ya creado: no se vuelve a la cuenta ni al tenant.
    expect(screen.getByRole('button', { name: /Completado: Tenant/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('link', { name: 'Terminar' }));
    expect(screen.getByTestId('url')).toHaveTextContent(`/organizations/${ORG}`);
  });

  it('sin permiso de plataforma no se ofrece', () => {
    m.platform = false;
    renderAt('/onboarding?modo=app');
    expect(screen.getByText('Tu rol no puede crear tenants')).toBeInTheDocument();
  });
});
