import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/* V6 · F2 · El diálogo sigue al origen (cliente / partner) y el color de marca es una paleta. */

const upsert = vi.fn().mockResolvedValue('org-1');
vi.mock('@/services/mutations', () => ({
  useUpsertOrganization: () => ({ mutateAsync: upsert, isPending: false, error: null, reset: vi.fn() }),
}));
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => ({ canManagePlatform: true }) }));
vi.mock('@/components/ui/toast-context', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

import { OrganizationFormDialog } from './OrganizationFormDialog';

describe('OrganizationFormDialog', () => {
  it('desde Clientes: «Nuevo cliente» y «Crear cliente»', () => {
    render(<OrganizationFormDialog open defaultCapability="CUSTOMER" onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Nuevo cliente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear cliente' })).toBeInTheDocument();
  });

  it('desde Partners: «Nuevo partner» y «Crear partner»; sin origen, organización', () => {
    const { rerender } = render(<OrganizationFormDialog open defaultCapability="PARTNER" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Crear partner' })).toBeInTheDocument();
    rerender(<OrganizationFormDialog open onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Crear organización' })).toBeInTheDocument();
  });

  it('el color de la marca se elige en una paleta y se envía su hex', async () => {
    render(<OrganizationFormDialog open defaultCapability="CUSTOMER" onClose={vi.fn()} />);
    expect(screen.queryByText(/white-label/)).toBeNull();
    expect(screen.getByRole('radio', { name: 'Sin color' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: /^Azul/ }));
    expect(screen.getByRole('radio', { name: /^Azul/ })).toHaveAttribute('aria-checked', 'true');
    await userEvent.type(screen.getByLabelText(/Nombre comercial/), 'Grupasa');
    await userEvent.type(screen.getByLabelText(/Razón social/), 'Grupasa SAC');
    await userEvent.type(screen.getByLabelText(/^Código/), 'grupasa');
    await userEvent.type(screen.getByLabelText(/^País/), 'PE');
    await userEvent.click(screen.getByRole('button', { name: 'Crear cliente' }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ p_accent_color: '#1F6FB2', p_capabilities: ['CUSTOMER'] }));
  });
});
