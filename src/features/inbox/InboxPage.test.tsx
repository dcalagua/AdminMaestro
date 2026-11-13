import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRoles } from '@/types/domain';
import type { PersonaKind } from '@/features/auth/session';

/*
 * V5 · F5 · Bandeja: lo que requiere acción, agrupado por tipo, con su acción
 * directa; filtros; «Hecho» sólo en este navegador; y cada rol ve lo suyo.
 */

const m = vi.hoisted(() => ({
  persona: 'EBIM' as PersonaKind,
  roles: null as SessionRoles | null,
  canProvision: true,
  enabled: {} as Record<string, boolean>,
  provision: vi.fn(),
  checkHealth: vi.fn(),
  setStatus: vi.fn(),
}));

const NOW_ISO = new Date().toISOString();
const DAYS_AGO = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const q = (key: string, enabled: boolean, data: unknown) => {
  m.enabled[key] = enabled;
  return enabled ? { data, isLoading: false, error: null } : { data: undefined, isLoading: false, error: null };
};

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ persona: m.persona, roles: m.roles, loading: false }),
}));
vi.mock('@/hooks/useProvisioningAccess', () => ({
  useProvisioningAccess: () => ({
    hasAnyAccess: m.canProvision,
    canForProduct: () => m.canProvision,
    can: () => m.canProvision,
  }),
}));
vi.mock('@/services/financeRead', () => ({
  useOverdueInvoices: ({ enabled }: { enabled: boolean }) =>
    q('invoices', enabled, {
      total: 1,
      rows: [
        {
          invoice_id: 'inv-1', number: 'F001-12', customer_organization_id: 'o-1', organization_name: 'Constructora Andes',
          due_date: '2026-09-01', days_overdue: 60, balance: 1180, currency: 'PEN',
        },
      ],
    }),
}));
vi.mock('@/services/queries', () => ({
  useSaasProvisioningRequests: ({ enabled }: { enabled: boolean }) =>
    q('requests', enabled, [
      {
        id: 'r-ready', tenant_id: 'tn-1', saas_product_id: 'p-ewm', tenant_name: 'Andes EWM', product_short_name: 'EWM',
        customer_organization_id: 'o-1', customer_organization_name: 'Constructora Andes', status: 'READY_TO_PROVISION',
        attempt_count: 0, max_attempts: 3, requested_at: DAYS_AGO(2), updated_at: DAYS_AGO(2),
      },
      {
        id: 'r-ok', tenant_id: 'tn-2', saas_product_id: 'p-ewm', tenant_name: 'Beta EWM', product_short_name: 'EWM',
        customer_organization_id: 'o-2', customer_organization_name: 'Beta', status: 'ACTIVE',
        attempt_count: 1, max_attempts: 3, requested_at: DAYS_AGO(1), completed_at: DAYS_AGO(1),
      },
    ]),
  useTenantOverview: ({ enabled }: { enabled: boolean }) =>
    q('tenants', enabled, [
      { tenant_id: 'tn-2', name: 'Beta EWM', status: 'PENDING', saas_product_id: 'p-ewm', customer_organization_id: 'o-2', customer_name: 'Beta', product_short_name: 'EWM' },
    ]),
  useProducts: ({ enabled }: { enabled: boolean }) =>
    q('products', enabled, [{ id: 'p-ewm', code: 'ewm', short_name: 'EWM', accent_color: null, sort_order: 1, status: 'ACTIVE' }]),
  useProvisioningTargets: ({ enabled }: { enabled: boolean }) =>
    q('targets', enabled, [
      {
        deployment_target_id: 't-ewm', saas_product_id: 'p-ewm', provisioning_environment: 'PRD', provisioning_enabled: true,
        provisioning_status: 'READY', health_status: 'UNHEALTHY', health_checked_at: NOW_ISO,
      },
    ]),
  useProductIntegrations: ({ enabled }: { enabled: boolean }) => q('integrations', enabled, []),
  useBillingAlerts: (_s: string, { enabled }: { enabled: boolean }) =>
    q('alerts', enabled, [
      {
        id: 'a-1', alert_type: 'RENEWAL_NOTICE', severity: 'INFO', title: 'Renueva en 30 días', message: null, created_at: DAYS_AGO(3),
        due_at: null, invoice_id: null, subscription_id: 's-1', subscriptions: { code: 'SUB-1', organizations: { display_name: 'Constructora Andes' } },
      },
    ]),
  useReceivedCommercialDocuments: ({ enabled }: { enabled: boolean }) =>
    q('documents', enabled, [
      { id: 'd-1', document_type: 'PURCHASE_ORDER', document_number: 'OC-77', received_at: DAYS_AGO(1), requested_at: DAYS_AGO(5), subscription_id: 's-1' },
    ]),
  useSettlements: ({ enabled }: { enabled: boolean }) =>
    q('settlements', enabled, [
      { id: 'st-1', code: 'LQ-1', status: 'APPROVED', total_amount: 500, currency: 'USD', created_at: DAYS_AGO(9), approved_at: DAYS_AGO(4), sales_agents: { full_name: 'Ana Ruiz' } },
    ]),
}));
vi.mock('@/services/mutations', () => ({
  useProvisionTenant: () => ({ mutateAsync: m.provision, isPending: false }),
  useCheckDeploymentHealth: () => ({ mutateAsync: m.checkHealth, isPending: false }),
  useSetTenantStatus: () => ({ mutateAsync: m.setStatus, isPending: false }),
}));
vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), push: vi.fn() }),
}));

import { InboxPage } from './InboxPage';
import { resetInboxDismissalsCache } from './inboxDismissals';
import { TaskQueuePanel, TaskQueueProvider } from '@/components/ui/TaskQueue';

const base: SessionRoles = {
  userId: 'u-1', email: 'u@ebim.test', fullName: 'Usuaria', platformRole: null, organizations: [],
  tenantRoles: [], salesAgentId: null, provisioningRoles: [], ownedProductIds: [],
};

function renderInbox() {
  return render(
    <MemoryRouter>
      <TaskQueueProvider>
        <InboxPage />
        <TaskQueuePanel />
      </TaskQueueProvider>
    </MemoryRouter>,
  );
}

const group = (name: string) => screen.getByRole('region', { name: new RegExp(`^${name}`) });
const itemByTitle = (title: string) => screen.getByText(title).closest('li') as HTMLElement;

beforeEach(() => {
  m.persona = 'EBIM';
  m.roles = { ...base, platformRole: 'EBIM_SUPER_ADMIN' };
  m.canProvision = true;
  m.enabled = {};
  m.provision.mockReset().mockResolvedValue({ status: 'ACTIVE' });
  m.checkHealth.mockReset().mockResolvedValue({ health: 'HEALTHY' });
  m.setStatus.mockReset().mockResolvedValue(null);
  localStorage.clear();
  resetInboxDismissalsCache();
});

describe('Bandeja', () => {
  it('agrupa por tipo, con prioridad, cuenta/app, antigüedad y la acción directa', () => {
    renderInbox();
    expect(screen.getByRole('heading', { level: 1, name: 'Bandeja' })).toBeInTheDocument();
    for (const name of [
      'Facturas vencidas', 'Salud de las apps', 'Altas en las apps', 'Tenants por confirmar',
      'Renovaciones y alertas de cobranza', 'Documentos por aprobar', 'Liquidaciones de comisión',
    ]) {
      expect(group(name)).toBeInTheDocument();
    }
    const invoice = itemByTitle('Factura F001-12 vencida');
    expect(invoice).toHaveTextContent('Urgente');
    expect(invoice).toHaveTextContent('vencida hace 60 días');
    expect(within(invoice).getByRole('link', { name: 'Constructora Andes' })).toHaveAttribute('href', '/organizations/o-1');
    expect(within(invoice).getByRole('link', { name: /Gestionar el cobro/ })).toHaveAttribute('href', '/cobranza?tab=por-cobrar&pcq=F001-12');

    const settlement = itemByTitle('Liquidación LQ-1 por pagar');
    expect(within(settlement).getByRole('link', { name: /Registrar pago…/ })).toHaveAttribute('href', '/commissions?tab=comisiones#liquidaciones');
    // Lo urgente va primero.
    const first = screen.getAllByRole('listitem')[0]!;
    expect(first).toHaveAttribute('data-priority', '1');
    expect(screen.getByText(/2 urgentes/)).toBeInTheDocument();
  });

  it('filtra por tipo, por prioridad y por texto', async () => {
    renderInbox();
    await userEvent.click(screen.getByRole('tab', { name: /Liquidaciones de comisión/ }));
    expect(screen.queryByText('Factura F001-12 vencida')).toBeNull();
    expect(screen.getByText('Liquidación LQ-1 por pagar')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /^Todo/ }));
    await userEvent.click(screen.getByRole('tab', { name: 'Urgentes' }));
    expect(screen.getByText('Factura F001-12 vencida')).toBeInTheDocument();
    expect(screen.queryByText('Liquidación LQ-1 por pagar')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'Todas' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'oc-77' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Orden de compra OC-77 por aprobar')).toBeInTheDocument();
  });

  it('«Hecho» lo oculta solo en este navegador, por usuario, y se puede devolver', async () => {
    renderInbox();
    expect(screen.getByText(/solo en este navegador/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como hecho: Liquidación LQ-1 por pagar' }));
    expect(screen.queryByText('Liquidación LQ-1 por pagar')).toBeNull();
    expect(JSON.parse(localStorage.getItem('ebim-cp-inbox-done:u-1') ?? '{}')).toHaveProperty(['settlement:st-1:APPROVED']);

    await userEvent.click(screen.getByRole('button', { name: 'Ver marcados como hechos (1)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Devolver a la bandeja: Liquidación LQ-1 por pagar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Volver a los pendientes' }));
    expect(screen.getByText('Liquidación LQ-1 por pagar')).toBeInTheDocument();
  });

  it('sin almacenamiento del navegador sigue funcionando y lo dice', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    renderInbox();
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como hecho: Liquidación LQ-1 por pagar' }));
    expect(screen.queryByText('Liquidación LQ-1 por pagar')).toBeNull();
    expect(screen.getByText(/mientras dure esta pestaña/)).toBeInTheDocument();
    spy.mockRestore();
  });

  it('acciones en el sitio: confirmar un tenant, ejecutar un alta (en la cola) y verificar una app', async () => {
    renderInbox();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar como activo: Confirmar Beta EWM como activo' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirmar el tenant como activo' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar como activo' }));
    expect(m.setStatus).toHaveBeenCalledWith(expect.objectContaining({ p_tenant_id: 'tn-2', p_status: 'ACTIVE' }));

    let finish!: (v: unknown) => void;
    m.provision.mockReturnValue(new Promise((res) => (finish = res)));
    await userEvent.click(screen.getByRole('button', { name: /^Ejecutar alta: Alta de Andes EWM/ }));
    expect(m.provision).toHaveBeenCalledWith('r-ready');
    const queue = screen.getByRole('region', { name: 'Tareas en curso' });
    expect(queue).toHaveTextContent('Alta de Andes EWM en EWM');
    await act(async () => finish({ status: 'ACTIVE' }));
    expect(queue).toHaveTextContent('Alta activa en EWM');

    await userEvent.click(screen.getByRole('button', { name: 'Verificar ahora: EWM: caído' }));
    expect(m.checkHealth).toHaveBeenCalledWith('t-ewm');
  });

  it('un partner ve sus facturas, alertas y altas; nunca liquidaciones, documentos, salud ni confirmaciones', () => {
    m.persona = 'PARTNER';
    m.roles = { ...base, organizations: [{ organizationId: 'o-p', role: 'PARTNER_ADMIN', displayName: 'Andina' }] };
    m.canProvision = false;
    renderInbox();
    expect(group('Facturas vencidas')).toBeInTheDocument();
    expect(group('Altas en las apps')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Liquidaciones/ })).toBeNull();
    expect(screen.queryByRole('region', { name: /Documentos/ })).toBeNull();
    expect(screen.queryByRole('region', { name: /Salud/ })).toBeNull();
    expect(m.enabled).toMatchObject({ settlements: false, documents: false, products: false, targets: false });
    // Sin permiso de ejecución: el ítem lleva a la pantalla, no ejecuta.
    const alta = itemByTitle('Alta de Andes EWM en EWM lista para ejecutar');
    expect(within(alta).queryByRole('button', { name: /Ejecutar alta/ })).toBeNull();
    expect(within(alta).getByRole('link', { name: 'Abrir Altas en las apps' })).toHaveAttribute('href', '/apps?tab=altas');
  });

  it('un comercial no recibe avisos operativos y ninguna consulta se dispara', () => {
    m.persona = 'SALES_AGENT';
    m.roles = { ...base, salesAgentId: 'sa-1' };
    m.canProvision = false;
    renderInbox();
    expect(screen.getByText('Nada que atender desde tu rol')).toBeInTheDocument();
    expect(Object.values(m.enabled).every((v) => v === false)).toBe(true);
  });
});
