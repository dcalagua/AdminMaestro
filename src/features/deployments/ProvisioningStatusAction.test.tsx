import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mutateAsync = vi.fn();
const canForProduct = vi.fn();
const toast = { success: vi.fn(), error: vi.fn(), push: vi.fn() };

vi.mock('@/services/mutations', () => ({
  useGetProvisioningStatus: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('@/hooks/useProvisioningAccess', () => ({
  useProvisioningAccess: () => ({ canForProduct }),
}));
vi.mock('@/components/ui/toast-context', () => ({ useToast: () => toast }));

import { ProvisioningStatusAction } from './ProvisioningStatusAction';

function request(capabilities: string[]): Record<string, unknown> {
  return { id: 'req-1', saas_product_id: 'p-ewm', capabilities };
}

const REMOTE = {
  status: 'ACTIVE',
  externalTenantId: 'co-1',
  externalOrganizationId: 'org-1',
  externalCompanyId: 'co-1',
  resources: { adminProvisioningStatus: 'PREPROVISIONED', initialWarehouseId: 'wh-1' },
};

beforeEach(() => {
  mutateAsync.mockReset();
  canForProduct.mockReset();
  canForProduct.mockReturnValue(true);
  toast.error.mockReset();
});

describe('ProvisioningStatusAction', () => {
  it('sin la capacidad GET_STATUS no hay botón', () => {
    render(<ProvisioningStatusAction request={request(['PROVISION'])} />);
    expect(screen.queryByRole('button', { name: 'Consultar estado' })).not.toBeInTheDocument();
  });

  it('sin permiso de lectura no hay botón', () => {
    canForProduct.mockReturnValue(false);
    render(<ProvisioningStatusAction request={request(['PROVISION', 'GET_STATUS'])} />);
    expect(screen.queryByRole('button', { name: 'Consultar estado' })).not.toBeInTheDocument();
    expect(canForProduct).toHaveBeenCalledWith('platform.provisioning.read', 'p-ewm');
  });

  it('con capacidad y permiso consulta y muestra el admin preaprovisionado', async () => {
    mutateAsync.mockResolvedValue({ found: true, remote: REMOTE, mapping_consistent: true, provider_http_status: 200 });
    render(<ProvisioningStatusAction request={request(['PROVISION', 'GET_STATUS'])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar estado' }));
    expect(mutateAsync).toHaveBeenCalledWith('req-1');
    expect(await screen.findByText('Preaprovisionado')).toBeInTheDocument();
    expect(screen.getByText('Coincide con el mapping')).toBeInTheDocument();
  });

  it('avisa cuando el producto no coincide con el mapping', async () => {
    mutateAsync.mockResolvedValue({ found: true, remote: REMOTE, mapping_consistent: false, provider_http_status: 200 });
    render(<ProvisioningStatusAction request={request(['PROVISION', 'GET_STATUS'])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar estado' }));
    expect(await screen.findByText('No coincide con el mapping')).toBeInTheDocument();
  });

  it('no encontrado: muestra el código del proveedor', async () => {
    mutateAsync.mockResolvedValue({
      found: false,
      remote: null,
      mapping_consistent: true,
      provider_http_status: 404,
      provider_code: 'RESOURCE_NOT_FOUND',
    });
    render(<ProvisioningStatusAction request={request(['PROVISION', 'GET_STATUS'])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar estado' }));
    expect(await screen.findByText(/no tiene este tenant/)).toBeInTheDocument();
    expect(screen.getByText(/RESOURCE_NOT_FOUND/)).toBeInTheDocument();
  });
});
