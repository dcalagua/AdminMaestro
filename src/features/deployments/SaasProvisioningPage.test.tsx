import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
 * P19 · Abrir o recargar Altas SaaS sólo LEE. Ninguna mutación (alta,
 * reintento, cancelación, consulta de estado) ni Edge Function se dispara al
 * renderizar o al desplegar el detalle; y el detalle se lee como una operación.
 */

const invoke = vi.fn();
const provision = vi.fn();
const retry = vi.fn();
const cancel = vi.fn();
const getStatus = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke }, rpc: vi.fn(), from: vi.fn() },
}));
vi.mock('@/services/mutations', () => ({
  useProvisionTenant: () => ({ mutateAsync: provision, isPending: false }),
  useRetrySaasProvisioning: () => ({ mutateAsync: retry, isPending: false }),
  useCancelSaasProvisioning: () => ({ mutateAsync: cancel, isPending: false }),
  useGetProvisioningStatus: () => ({ mutateAsync: getStatus, isPending: false }),
}));

const REQUEST = {
  id: 'req-1',
  tenant_id: 'ten-1',
  tenant_name: 'Cliente Demo',
  tenant_slug: 'cliente-demo',
  saas_product_id: 'p-1',
  product_short_name: 'Producto Uno',
  provisioning_environment: 'QAS',
  deployment_code: 'qas-shared',
  deployment_mode: 'SHARED',
  status: 'FAILED',
  attempt_count: 1,
  max_attempts: 3,
  requested_by_name: 'Operador',
  requested_at: '2026-09-20T10:00:00Z',
  started_at: '2026-09-20T10:01:00Z',
  correlation_id: 'corr-123',
  idempotency_key: 'idem-123',
  request_version: 1,
  provisioning_policy: 'MANUAL',
  integration_type: 'HTTP_M2M',
  contract_version: 'v1',
  adapter_key: 'GENERIC',
  capabilities: ['PROVISION', 'GET_STATUS'],
  mapping_status: 'FAILED',
  last_error_code: 'PROVIDER_TIMEOUT',
  last_error_message: 'Timeout tras 15000 ms esperando al proveedor',
  provider_http_status: 504,
};

vi.mock('@/services/queries', () => ({
  useSaasProvisioningRequests: () => ({ isLoading: false, error: null, data: [REQUEST] }),
  useSaasProvisioningEvents: () => ({
    isLoading: false,
    error: null,
    data: [
      {
        id: 1,
        status: 'FAILED',
        action: 'PROVISION',
        occurred_at: '2026-09-20T10:01:30Z',
        message: 'El producto no respondió',
        attempt: 1,
        provider_http_status: 504,
        actor_role: 'TECH_LEAD',
      },
    ],
  }),
  useProvisioningPreconditions: () => ({ data: { blockers: [] } }),
}));
vi.mock('@/hooks/useProvisioningAccess', () => ({
  useProvisioningAccess: () => ({ can: () => true, canForProduct: () => true, ownedProductIds: [] }),
}));
vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), push: vi.fn() }),
}));
vi.mock('./ProvisioningDialogs', () => ({
  NewProvisioningRequestDialog: () => null,
  RegisterManualDialog: () => null,
}));
vi.mock('./ProductConfigurationForm', () => ({ ProductConfigurationForm: () => null }));

import { SaasProvisioningPage } from './SaasProvisioningPage';

beforeEach(() => {
  for (const fn of [invoke, provision, retry, cancel, getStatus]) fn.mockReset();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <SaasProvisioningPage />
    </MemoryRouter>,
  );
}

describe('SaasProvisioningPage', () => {
  it('renderizar y abrir el detalle no ejecuta ninguna acción ni Edge Function', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Detalle' }));
    for (const fn of [invoke, provision, retry, cancel, getStatus]) expect(fn).not.toHaveBeenCalled();
  });

  it('el detalle muestra intentos, mapping, error completo y capacidades', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Detalle' }));
    expect(screen.getByText('1 de 3')).toBeInTheDocument();
    expect(screen.getByText('Mapping:')).toBeInTheDocument();
    expect(screen.getByText('Timeout tras 15000 ms esperando al proveedor')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Capacidades del contrato' })).toHaveTextContent('Consulta de estado');
    expect(screen.getByText('Intento 1')).toBeInTheDocument();
    // e2e: estas etiquetas deben ser únicas en la página.
    expect(screen.getAllByText(/Correlación/i)).toHaveLength(1);
    expect(screen.getAllByText(/Idempotencia/i)).toHaveLength(1);
  });
});
