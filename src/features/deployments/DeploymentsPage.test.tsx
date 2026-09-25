import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/* P17 · Ver la pantalla no verifica ni habilita nada; borrador ≠ fallo. */

const checkHealth = vi.fn();
const invoke = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke }, rpc: vi.fn(), from: vi.fn() },
}));
vi.mock('@/services/mutations', () => ({
  useCheckDeploymentHealth: () => ({ mutateAsync: checkHealth, isPending: false }),
}));
vi.mock('@/services/queries', () => ({
  useDeploymentTargets: () => ({
    isLoading: false,
    error: null,
    data: [
      {
        id: 't-1',
        code: 'qas-shared',
        name: 'Compartido QAS',
        deployment_mode: 'SHARED',
        provider: 'SUPABASE',
        environment: 'SANDBOX',
        status: 'ACTIVE',
        tenant_deployments: [],
        saas_product_id: 'p-1',
      },
    ],
  }),
  useProvisioningTargets: () => ({
    isLoading: false,
    error: null,
    data: [
      {
        deployment_target_id: 't-1',
        code: 'qas-shared',
        product_short_name: 'Producto Uno',
        saas_product_id: 'p-1',
        provisioning_environment: 'QAS',
        provisioning_enabled: false,
        provisioning_status: 'DRAFT',
        health_status: 'UNHEALTHY',
        health_checked_at: '2026-09-20T10:00:00Z',
      },
    ],
  }),
}));
vi.mock('@/hooks/useProvisioningAccess', () => ({
  useProvisioningAccess: () => ({ canForProduct: () => true }),
}));
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => ({ canManagePlatform: false }) }));
vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), push: vi.fn() }),
}));
vi.mock('./ProvisioningDialogs', () => ({ DeploymentProvisioningDialog: () => null }));
vi.mock('./DeploymentDialogs', () => ({ DeploymentTargetDialog: () => null, AttachTenantDialog: () => null }));

import { DeploymentsPage } from './DeploymentsPage';

describe('DeploymentsPage', () => {
  it('un destino en borrador es «No evaluado», no «Caído», y nada se verifica al renderizar', () => {
    render(
      <MemoryRouter>
        <DeploymentsPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Entornos y despliegues' })).toBeInTheDocument();
    expect(screen.queryByText('Caído')).not.toBeInTheDocument();
    expect(screen.getAllByText('No evaluado').length).toBeGreaterThan(0);
    expect(screen.getByText('Entorno: Calidad')).toBeInTheDocument();
    // El código del destino aparece una sola vez (el smoke e2e lo busca en modo estricto).
    expect(screen.getAllByText('qas-shared')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Verificar conexión' })).toBeInTheDocument();
    expect(checkHealth).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
