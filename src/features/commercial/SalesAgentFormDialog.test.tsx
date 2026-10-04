import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

/*
 * M5 · Selector de usuario al editar un comercial (`p_user_id`).
 * Antes la edición omitía el usuario y la RPC lo dejaba en NULL: editar a un
 * comercial lo desvinculaba de su cuenta sin avisar. Ahora se conserva y se
 * puede cambiar; un usuario ya vinculado a OTRO comercial no se ofrece.
 */
const m = vi.hoisted(() => ({ upsert: vi.fn(), toastSuccess: vi.fn() }));
const q = (data: unknown) => ({ data, isLoading: false, error: null });

vi.mock('@/services/queries', () => ({
  useOrganizations: () => q([]),
  useProducts: () => q([]),
  useCommissionPlans: () => q([]),
  useTenantOverview: () => q([]),
  useCurrencies: () => q([]),
  useSalesAgents: () => q([
    { id: 'a1', code: 'carla-independiente', user_id: 'u-carla' },
    { id: 'a3', code: 'equipo-ebim', user_id: null },
  ]),
  usePlatformPeople: () => q([
    { id: 'u-carla', full_name: 'Carla Comercial', email: 'comercial@indep.ebim.test' },
    { id: 'u-nora', full_name: 'Nora Nueva', email: 'nora@ebim.test' },
  ]),
}));
vi.mock('@/services/mutations', () => ({
  useUpsertSalesAgent: () => ({ mutateAsync: m.upsert, isPending: false, error: null, reset: vi.fn() }),
  useCreateAttribution: () => ({}),
  useUpsertCommissionPlan: () => ({}),
  useUpsertCommissionRule: () => ({}),
}));
vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: m.toastSuccess, error: vi.fn(), push: vi.fn() }),
}));

import { SalesAgentFormDialog } from './CommercialDialogs';

const agent = {
  id: 'a3', code: 'equipo-ebim', full_name: 'Equipo Comercial EBIM', agent_type: 'EBIM_INTERNAL',
  organization_id: null, contact_email: null, user_id: null, status: 'ACTIVE', valid_from: '2026-01-01', valid_to: null,
};

beforeEach(() => {
  m.upsert.mockReset();
  m.upsert.mockResolvedValue('a3');
});

describe('SalesAgentFormDialog · usuario vinculado (M5)', () => {
  it('ofrece solo usuarios libres y envía p_user_id al guardar', async () => {
    render(<SalesAgentFormDialog open agent={agent} onClose={vi.fn()} />);
    const select = screen.getByLabelText('Usuario de la consola');
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Sin usuario (solo plano comercial)', 'Nora Nueva · nora@ebim.test']);
    fireEvent.change(select, { target: { value: 'u-nora' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ p_id: 'a3', p_user_id: 'u-nora' })));
  });

  it('al editar conserva el usuario ya vinculado (no lo desvincula en silencio)', async () => {
    render(<SalesAgentFormDialog open agent={{ ...agent, id: 'a1', code: 'carla-independiente', agent_type: 'INDEPENDENT', user_id: 'u-carla' }} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Usuario de la consola')).toHaveValue('u-carla');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ p_id: 'a1', p_user_id: 'u-carla' })));
  });
});
