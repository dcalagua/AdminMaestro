import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/*
 * CCP fase 07 · Importar un manifiesto llama a `import_capability_manifest`
 * con el JSON tal cual y muestra los conteos y el drift (`missing`) que
 * devuelve la base. La forma del manifiesto la valida la RPC, no la UI.
 */

const mutateAsync = vi.fn();

vi.mock('@/services/queries', () => ({
  useProductCapabilities: () => ({ data: [], isLoading: false, error: null }),
  useProducts: () => ({ data: [{ id: 'prod-ewm', code: 'ewm', short_name: 'EWM' }] }),
}));
vi.mock('@/services/mutations', () => ({
  useImportCapabilityManifest: () => ({ mutateAsync, isPending: false, error: null, reset: vi.fn() }),
}));
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ canManagePlatform: true }),
}));
vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), push: vi.fn() }),
}));

import { CapabilitiesPage } from './CapabilitiesPage';

beforeEach(() => {
  mutateAsync.mockReset();
});

describe('Importar manifiesto', () => {
  it('envía el manifiesto y muestra conteos y drift de registro', async () => {
    const user = userEvent.setup();
    mutateAsync.mockResolvedValue({
      product: 'ewm', inserted: 2, updated: 1, unchanged: 5, aliases: 3,
      missing: ['ewm.legacy_labels'], import_id: 'imp-1',
    });
    render(
      <MemoryRouter>
        <CapabilitiesPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Importar manifiesto' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(screen.getByLabelText(/Producto/), 'ewm');
    const manifest = { schema: 'ebim.capabilities/v1', productCode: 'ewm', capabilities: [] };
    const textarea = screen.getByLabelText(/Manifiesto JSON/);
    await user.click(textarea);
    await user.paste(JSON.stringify(manifest));
    await user.click(screen.getByRole('button', { name: 'Importar' }));

    expect(mutateAsync).toHaveBeenCalledWith({ p_product_code: 'ewm', p_manifest: manifest });
    expect(dialog).not.toBeInTheDocument();
    expect(screen.getByText('Última importación · ewm')).toBeInTheDocument();
    expect(screen.getByText(/Drift de registro: 1 capacidad/)).toBeInTheDocument();
    expect(screen.getByText('ewm.legacy_labels')).toBeInTheDocument();
    expect(screen.getByText('Nuevas').nextSibling).toHaveTextContent('2');
  });

  it('un JSON inválido no llega a la base', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CapabilitiesPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Importar manifiesto' }));
    await user.selectOptions(screen.getByLabelText(/Producto/), 'ewm');
    await user.click(screen.getByLabelText(/Manifiesto JSON/));
    await user.paste('{ no es json');
    await user.click(screen.getByRole('button', { name: 'Importar' }));

    expect(await screen.findByText('No es un JSON válido')).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
