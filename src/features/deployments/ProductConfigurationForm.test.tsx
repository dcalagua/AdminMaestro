import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/*
 * «Datos de alta en el producto». La forma y la semántica las validan la base y
 * el orquestador; aquí se comprueba que la pantalla sólo aparece para contratos
 * que la piden, precarga lo que sabe y no envía sin los obligatorios.
 */

const mutateAsync = vi.fn();
const tenantHook = vi.fn();
const fullNameHook = vi.fn();
const tenantConfigHook = vi.fn();
const canForProduct = vi.fn();
const toast = { success: vi.fn(), error: vi.fn(), push: vi.fn() };

vi.mock('@/services/queries', () => ({
  useTenant: (...a: unknown[]) => tenantHook(...a),
  useProfileFullNameByEmail: (...a: unknown[]) => fullNameHook(...a),
  useEffectiveTenantConfig: (...a: unknown[]) => tenantConfigHook(...a),
}));
vi.mock('@/services/mutations', () => ({
  useSetProvisioningConfiguration: () => ({ mutateAsync, isPending: false, error: null }),
}));
vi.mock('@/hooks/useProvisioningAccess', () => ({
  useProvisioningAccess: () => ({ canForProduct }),
}));
vi.mock('@/components/ui/toast-context', () => ({ useToast: () => toast }));

import { ProductConfigurationForm } from './ProductConfigurationForm';

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'req-1',
    tenant_id: 't-1',
    saas_product_id: 'p-ewm',
    status: 'READY_TO_PROVISION',
    attempt_count: 0,
    adapter_key: 'EWM_V1',
    capabilities: ['PROVISION', 'GET_STATUS', 'REPLAY_CERTIFICATION'],
    product_configuration: {},
    ...overrides,
  };
}

beforeEach(() => {
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({});
  tenantHook.mockReturnValue({ data: { admin_email: 'ana@cliente.test' } });
  fullNameHook.mockReturnValue({ data: null });
  tenantConfigHook.mockReturnValue({ data: { locale: { timezone: 'America/Lima' } } });
  canForProduct.mockReturnValue(true);
  toast.success.mockReset();
  toast.error.mockReset();
});

describe('ProductConfigurationForm', () => {
  it('GENERIC no renderiza nada', () => {
    const { container } = render(<ProductConfigurationForm request={request({ adapter_key: 'GENERIC' })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('EWM_V1 antes del primer intento muestra los campos de alta', () => {
    render(<ProductConfigurationForm request={request()} />);
    for (const label of [
      /Código de almacén/,
      /Nombre del almacén/,
      /Zona horaria del almacén/,
      /Zona horaria de la organización/,
      /Nombre completo del administrador/,
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Guardar datos de alta' })).toBeInTheDocument();
  });

  it('precarga fullName desde profiles y las zonas desde la cascada', async () => {
    fullNameHook.mockReturnValue({ data: 'Ana Pérez' });
    tenantConfigHook.mockReturnValue({ data: { locale: { timezone: 'America/Bogota' } } });
    render(<ProductConfigurationForm request={request()} />);
    await waitFor(() =>
      expect(screen.getByLabelText(/Nombre completo del administrador/)).toHaveValue('Ana Pérez'),
    );
    expect(screen.getByLabelText(/Zona horaria del almacén/)).toHaveValue('America/Bogota');
    expect(screen.getByLabelText(/Zona horaria de la organización/)).toHaveValue('America/Bogota');
    expect(fullNameHook).toHaveBeenCalledWith('ana@cliente.test');
  });

  it('R2 · sin fullName no envía y muestra «Obligatorio»', async () => {
    render(<ProductConfigurationForm request={request()} />);
    fireEvent.change(screen.getByLabelText(/Código de almacén/), { target: { value: 'WH-001' } });
    fireEvent.change(screen.getByLabelText(/Nombre del almacén/), { target: { value: 'Almacén Principal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar datos de alta' }));
    expect(await screen.findByText('Obligatorio')).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('con los datos completos envía la configuración, sin resolvedCurrency', async () => {
    fullNameHook.mockReturnValue({ data: 'Ana Pérez' });
    render(<ProductConfigurationForm request={request()} />);
    await waitFor(() =>
      expect(screen.getByLabelText(/Nombre completo del administrador/)).toHaveValue('Ana Pérez'),
    );
    fireEvent.change(screen.getByLabelText(/Código de almacén/), { target: { value: 'WH-001' } });
    fireEvent.change(screen.getByLabelText(/Nombre del almacén/), { target: { value: 'Almacén Principal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar datos de alta' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      p_request_id: 'req-1',
      p_configuration: {
        organizationTimezone: 'America/Lima',
        initialWarehouse: {
          code: 'WH-001',
          name: 'Almacén Principal',
          timezone: 'America/Lima',
          erpCode: null,
          address: null,
          is3pl: false,
        },
        admin: { fullName: 'Ana Pérez' },
      },
    });
  });

  it('después del primer intento es sólo lectura, sin «Guardar»', () => {
    render(
      <ProductConfigurationForm
        request={request({
          attempt_count: 1,
          product_configuration: {
            organizationTimezone: 'America/Lima',
            initialWarehouse: { code: 'WH-001', name: 'Almacén Principal', timezone: 'America/Lima' },
            admin: { fullName: 'Ana Pérez' },
            resolvedCurrency: 'PEN',
          },
        })}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Guardar datos de alta' })).not.toBeInTheDocument();
    expect(screen.getByText('WH-001')).toBeInTheDocument();
    expect(screen.getByText('PEN')).toBeInTheDocument();
  });

  it('sin permiso de ejecución es sólo lectura', () => {
    canForProduct.mockReturnValue(false);
    render(<ProductConfigurationForm request={request()} />);
    expect(screen.queryByRole('button', { name: 'Guardar datos de alta' })).not.toBeInTheDocument();
  });
});
