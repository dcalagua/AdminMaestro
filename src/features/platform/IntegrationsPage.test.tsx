import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
 * P26 · La matriz de integraciones resume la salud POR ENTORNO, sólo con
 * destinos habilitados, con la fecha de observación, y renderizarla no llama a
 * ningún producto ni Edge Function.
 */

const invoke = vi.fn();
const checkHealth = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke }, rpc: vi.fn(), from: vi.fn() },
}));
vi.mock('@/services/mutations', () => ({
  useCheckDeploymentHealth: () => ({ mutateAsync: checkHealth, mutate: checkHealth, isPending: false }),
}));
vi.mock('@/services/queries', () => ({
  useProductIntegrations: () => ({
    isLoading: false,
    error: null,
    data: [
      {
        id: 'int-1',
        code: 'ewm-provisioning-v1',
        name: 'EWM provisioning',
        integration_type: 'HTTP_M2M',
        contract_version: 'v1',
        status: 'READY',
        enabled: true,
        owner_name: 'Equipo EWM',
        saas_product_id: 'p-ewm',
        saas_products: { code: 'EWM', short_name: 'EWM' },
        profiles: null,
      },
    ],
  }),
  useProvisioningTargets: () => ({
    isLoading: false,
    error: null,
    data: [
      {
        deployment_target_id: 't-qas',
        product_integration_id: 'int-1',
        provisioning_environment: 'QAS',
        provisioning_enabled: true,
        provisioning_status: 'READY',
        health_status: 'HEALTHY',
        health_checked_at: '2026-09-20T15:30:00Z',
      },
      {
        deployment_target_id: 't-prd',
        product_integration_id: 'int-1',
        provisioning_environment: 'PRD',
        provisioning_enabled: false,
        provisioning_status: 'DRAFT',
        health_status: 'UNHEALTHY',
        health_checked_at: '2026-09-21T15:30:00Z',
      },
    ],
  }),
  useProductOwners: () => ({ data: [] }),
}));
vi.mock('@/hooks/useProvisioningAccess', () => ({
  useProvisioningAccess: () => ({ can: () => false, canForProduct: () => false }),
}));
vi.mock('./IntegrationDialogs', () => ({ IntegrationDialog: () => null }));

import { IntegrationsPage } from './IntegrationsPage';

function renderPage(path = '/integrations') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <IntegrationsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  invoke.mockReset();
  checkHealth.mockReset();
});

describe('IntegrationsPage', () => {
  it('resume por entorno: QAS sano con fecha; PRD en borrador «No evaluado», nunca «Caído»', () => {
    renderPage();
    const list = screen.getByRole('list', { name: 'Salud observada por entorno' });
    const items = within(list).getAllByRole('listitem');
    const qas = items.find((li) => li.dataset.environment === 'QAS')!;
    const prd = items.find((li) => li.dataset.environment === 'PRD')!;

    expect(within(qas).getByText('Saludable')).toBeInTheDocument();
    expect(within(qas).getByText(/Observado el/)).toBeInTheDocument();
    expect(qas.querySelector('time')?.getAttribute('dateTime')).toBe('2026-09-20T15:30:00Z');

    expect(within(prd).getByText('No evaluado')).toBeInTheDocument();
    // El destino deshabilitado no contamina nada: ningún «Caído» en la página.
    expect(screen.queryByText('Caído')).not.toBeInTheDocument();
  });

  it('con el filtro de entorno sólo se ve ese entorno', () => {
    renderPage('/integrations?entorno=QAS');
    const list = screen.getByRole('list', { name: 'Salud observada por entorno' });
    const envs = within(list).getAllByRole('listitem').map((li) => li.dataset.environment);
    expect(envs).toEqual(['QAS']);
  });

  it('no afirma certificación sin fuente verificable', () => {
    renderPage();
    expect(screen.queryByText(/^Certificad[oa]$/)).not.toBeInTheDocument();
    expect(screen.getByText(/no dispone de una fuente verificable/)).toBeInTheDocument();
  });

  it('renderizar no verifica salud ni invoca Edge Functions', () => {
    renderPage();
    expect(checkHealth).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
