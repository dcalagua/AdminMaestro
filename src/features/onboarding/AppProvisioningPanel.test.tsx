import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/*
 * V5 · F4 · «Alta en las apps» del flujo guiado: la solicitud se crea en el
 * ambiente del destino habilitado, «Ejecutar alta» usa el orquestador de
 * siempre, el resultado se ve por app y «Reintentar» reutiliza o renueva la
 * solicitud. Nada se ejecuta solo y el permiso es el de provisioning por app.
 */

const m = vi.hoisted(() => ({
  create: vi.fn(),
  provision: vi.fn(),
  retry: vi.fn(),
  canExecute: true,
  requests: [] as unknown[],
}));

const q = (data: unknown) => ({ data, error: null, isLoading: false, refetch: vi.fn() });

vi.mock('@/services/queries', () => ({
  useSaasProvisioningRequests: () => q(m.requests),
  useProvisioningTargets: () =>
    q([
      { saas_product_id: 'p-ewm', provisioning_environment: 'QAS', provisioning_enabled: true, provisioning_status: 'READY' },
      { saas_product_id: 'p-ewm', provisioning_environment: 'DEV', provisioning_enabled: false, provisioning_status: 'READY' },
    ]),
}));
vi.mock('@/services/mutations', () => ({
  useCreateSaasProvisioningRequest: () => ({ mutateAsync: m.create, isPending: false }),
  useProvisionTenant: () => ({ mutateAsync: m.provision, isPending: false }),
  useRetrySaasProvisioning: () => ({ mutateAsync: m.retry, isPending: false }),
}));
vi.mock('@/hooks/useProvisioningAccess', () => ({
  useProvisioningAccess: () => ({ canForProduct: () => m.canExecute }),
}));
vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), push: vi.fn() }),
}));

import { AppProvisioningPanel, type AltaTenant } from './AppProvisioningPanel';
import { TaskQueuePanel, TaskQueueProvider } from '@/components/ui/TaskQueue';

const EWM: AltaTenant = { tenantId: 'tn-1', tenantName: 'Alpha EWM', productId: 'p-ewm', productName: 'EWM', productCode: 'ewm', subscriptionId: 's-1' };
const TMS: AltaTenant = { tenantId: 'tn-2', tenantName: 'Alpha TMS', productId: 'p-tms', productName: 'TMS', productCode: 'tms', subscriptionId: null };

const req = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 'r-1', tenant_id: 'tn-1', saas_product_id: 'p-ewm', status, attempt_count: 1, max_attempts: 3,
  requested_at: '2026-11-01T00:00:00Z', provisioning_environment: 'QAS', last_error_code: null, last_error_message: null, ...extra,
});

function renderPanel(tenants: AltaTenant[] = [EWM]) {
  return render(
    <MemoryRouter>
      <AppProvisioningPanel tenants={tenants} />
    </MemoryRouter>,
  );
}

const row = (app: string) => document.querySelector(`[data-alta-app="${app}"]`) as HTMLElement;

beforeEach(() => {
  m.create.mockReset().mockResolvedValue('r-new');
  m.provision.mockReset().mockResolvedValue({ status: 'ACTIVE', external_tenant_id: 'x-1' });
  m.retry.mockReset().mockResolvedValue('r-1');
  m.canExecute = true;
  m.requests = [];
});

describe('AppProvisioningPanel', () => {
  it('sin alta: crea la solicitud en el ambiente del destino habilitado, con el contrato', async () => {
    renderPanel([EWM, TMS]);
    expect(row('EWM')).toHaveAttribute('data-alta-outcome', 'NONE');
    expect(within(row('EWM')).getByText('Calidad')).toBeInTheDocument();
    // TMS no tiene destino habilitado: no se puede pedir el alta.
    expect(within(row('TMS')).getByText('Sin destino habilitado')).toBeInTheDocument();
    expect(within(row('TMS')).queryByRole('button', { name: 'Solicitar alta' })).toBeNull();
    // Abrir el panel no crea ni ejecuta nada.
    expect(m.create).not.toHaveBeenCalled();
    await userEvent.click(within(row('EWM')).getByRole('button', { name: 'Solicitar alta' }));
    expect(m.create).toHaveBeenCalledWith({ p_tenant_id: 'tn-1', p_environment: 'QAS', p_subscription_id: 's-1' });
    expect(m.provision).not.toHaveBeenCalled();
  });

  it('lista: «Ejecutar alta» usa el orquestador y muestra el motivo si la app la rechaza', async () => {
    m.requests = [req('READY_TO_PROVISION')];
    m.provision.mockResolvedValue({ status: 'FAILED', error_code: 'X', message: 'La app no responde' });
    renderPanel();
    await userEvent.click(within(row('EWM')).getByRole('button', { name: 'Ejecutar alta' }));
    expect(m.provision).toHaveBeenCalledWith('r-1');
    expect(within(row('EWM')).getByRole('alert')).toHaveTextContent('X');
  });

  it('«Ejecutar alta» se ve en la cola de tareas mientras corre y queda con su resultado y el enlace al tenant', async () => {
    m.requests = [req('READY_TO_PROVISION')];
    let finish!: (v: unknown) => void;
    m.provision.mockReturnValue(new Promise((res) => (finish = res)));
    render(
      <MemoryRouter>
        <TaskQueueProvider>
          <AppProvisioningPanel tenants={[EWM]} />
          <TaskQueuePanel />
        </TaskQueueProvider>
      </MemoryRouter>,
    );
    await userEvent.click(within(row('EWM')).getByRole('button', { name: 'Ejecutar alta' }));
    const queue = screen.getByRole('region', { name: 'Tareas en curso' });
    expect(queue).toHaveTextContent('Alta de Alpha EWM en EWM');
    expect(queue).toHaveTextContent('En curso…');
    await act(async () => finish({ status: 'ACTIVE', external_tenant_id: 'x-1' }));
    expect(queue).toHaveTextContent('Alta activa en EWM');
    expect(within(queue).getByRole('link', { name: 'Ver el tenant' })).toHaveAttribute('href', '/tenants/tn-1');
  });

  it('resultado por app: activo, pendiente con su porqué y falló con motivo', () => {
    m.requests = [req('FAILED', { last_error_message: 'Timeout de la app' }), { ...req('PENDING'), id: 'r-2', tenant_id: 'tn-2', saas_product_id: 'p-tms' }];
    renderPanel([EWM, TMS]);
    expect(within(row('EWM')).getByText('Falló')).toBeInTheDocument();
    expect(within(row('EWM')).getByText('Timeout de la app')).toBeInTheDocument();
    expect(within(row('TMS')).getByText('Pendiente')).toBeInTheDocument();
    expect(within(row('TMS')).getByText(/política de alta/)).toBeInTheDocument();
  });

  it('reintentar con intentos: reabre la MISMA solicitud y la ejecuta', async () => {
    m.requests = [req('FAILED')];
    renderPanel();
    await userEvent.click(within(row('EWM')).getByRole('button', { name: 'Reintentar' }));
    expect(m.retry).toHaveBeenCalledWith({ p_request_id: 'r-1' });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.provision).toHaveBeenCalledWith('r-1');
  });

  it('reintentar sin intentos: pide una solicitud nueva y la ejecuta', async () => {
    m.requests = [req('FAILED', { attempt_count: 3 })];
    renderPanel();
    await userEvent.click(within(row('EWM')).getByRole('button', { name: 'Reintentar' }));
    expect(m.retry).not.toHaveBeenCalled();
    expect(m.create).toHaveBeenCalledWith({ p_tenant_id: 'tn-1', p_environment: 'QAS', p_subscription_id: 's-1' });
    expect(m.provision).toHaveBeenCalledWith('r-new');
  });

  it('sin permiso de provisioning en la app: ve el estado, no las acciones', () => {
    m.canExecute = false;
    m.requests = [req('READY_TO_PROVISION')];
    renderPanel();
    expect(within(row('EWM')).getByText('Tu rol no ejecuta altas en esta app')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ejecutar alta' })).toBeNull();
  });
});
