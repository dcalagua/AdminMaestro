import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminUser } from './userModel';

/*
 * M5 · Ficha de usuario: SectionTabs con #hash (U-07), pestañas según rol,
 * rol de consola sin EBIM_SUPER_ADMIN (S-01), provisioning con las RPC
 * existentes, vínculo comercial, actividad, reenvío de invitación y
 * desactivación con motivo.
 */
const ANDINA = '30000000-0000-4000-a000-000000000002';
const U = '10000000-0000-4000-a000-0000000000a1';

const base: AdminUser = {
  id: U, email: 'nora@andina.ebim.test', fullName: 'Nora Nueva', phone: '+51 999', jobTitle: 'Ventas', isActive: true,
  createdAt: '2026-09-01T00:00:00Z', lastSignInAt: '2026-10-01T10:00:00Z', invitedAt: '2026-09-01T00:00:00Z',
  emailConfirmedAt: '2026-09-01T00:00:00Z', banned: false, platformRole: null, platformRoleActive: false,
  organizations: [{ id: 'm1', organization_id: ANDINA, organization_name: 'Consultora Andina', organization_kind: 'COMPANY',
    is_partner: true, role: 'PARTNER_SALES', company_id: null, is_active: true }],
  tenants: [],
  provisioningRoles: [{ id: 'pr1', role: 'PROVISIONING_VIEWER', is_active: true, granted_at: '2026-09-02T00:00:00Z' }],
  productOwnerships: [],
  salesAgent: null,
};

const m = vi.hoisted(() => ({
  user: null as unknown,
  scope: {} as Record<string, unknown>,
  action: vi.fn(),
  grantRole: vi.fn(),
  revokeProv: vi.fn(),
  setOrgActive: vi.fn(),
  link: vi.fn(),
  toastSuccess: vi.fn(),
}));
const rpc = (fn: ReturnType<typeof vi.fn>) => ({ mutateAsync: fn, isPending: false, error: null, reset: vi.fn() });

vi.mock('@/services/queries', () => ({
  useAdminUser: () => ({ data: m.user, isLoading: false, error: null, refetch: vi.fn() }),
  useUserInvitations: () => ({ data: [] }),
  useUserActivity: () => ({
    data: [{ id: 1, action: 'ORG_MEMBERSHIP_GRANTED', entity_type: 'organization_membership', entity_id: 'm1',
             actor_email: 'admin@andina.ebim.test', actor_user_id: 'x', metadata: { role: 'PARTNER_SALES', reason: 'alta' },
             occurred_at: '2026-10-01T10:00:00Z' }],
    isLoading: false, error: null, refetch: vi.fn(),
  }),
  useSalesAgents: () => ({ data: [{ id: 'a3', code: 'equipo-ebim', full_name: 'Equipo Comercial EBIM', user_id: null }], isLoading: false, error: null }),
  useOrganizations: () => ({ data: [{ id: ANDINA, display_name: 'Consultora Andina', kind: 'COMPANY', organization_capabilities: [{ capability: 'PARTNER' }] }], isLoading: false }),
  useTenantOverview: () => ({ data: [], isLoading: false }),
}));
vi.mock('@/services/mutations', () => ({
  useUserAdminAction: () => rpc(m.action),
  useAdminUpdateProfile: () => rpc(vi.fn()),
  useGrantPlatformRole: () => rpc(m.grantRole),
  useRevokePlatformRole: () => rpc(vi.fn()),
  useUpsertOrganizationMembership: () => rpc(vi.fn()),
  useSetOrganizationMembershipActive: () => rpc(m.setOrgActive),
  useUpsertTenantMembership: () => rpc(vi.fn()),
  useSetTenantMembershipActive: () => rpc(vi.fn()),
  useGrantProvisioningRole: () => rpc(vi.fn()),
  useRevokeProvisioningRole: () => rpc(m.revokeProv),
  useLinkUserSalesAgent: () => rpc(m.link),
}));
vi.mock('./useUserAdminScope', () => ({ useUserAdminScope: () => m.scope }));
vi.mock('@/components/ui/toast-context', () => ({
  useToast: () => ({ success: m.toastSuccess, error: vi.fn(), push: vi.fn() }),
}));

import { UserDetailPage } from './UserDetailPage';

const superScope = {
  userId: '10000000-0000-4000-a000-000000000001', isSuperAdmin: true, managePlatform: true, manageCommercial: true,
  adminOrgs: [], canView: true, canInvite: true, adminRoleIn: () => null,
};
const andinaScope = {
  userId: '10000000-0000-4000-a000-000000000004', isSuperAdmin: false, managePlatform: false, manageCommercial: false,
  adminOrgs: [{ organizationId: ANDINA, role: 'PARTNER_ADMIN', displayName: 'Consultora Andina' }],
  canView: true, canInvite: true, adminRoleIn: (id: string) => (id === ANDINA ? 'PARTNER_ADMIN' : null),
};

function renderAt(hash = '') {
  window.history.replaceState(null, '', `/users/${U}${hash}`);
  return render(
    <MemoryRouter initialEntries={[`/users/${U}`]}>
      <Routes>
        <Route path="/users/:userId" element={<UserDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent);

beforeEach(() => {
  Object.values(m).forEach((f) => (typeof f === 'function' && 'mockReset' in f ? (f as ReturnType<typeof vi.fn>).mockReset() : undefined));
  m.user = base;
  m.scope = superScope;
  [m.action, m.grantRole, m.revokeProv, m.setOrgActive, m.link].forEach((f) => f.mockResolvedValue({}));
});

describe('UserDetailPage', () => {
  it('el super admin ve todas las pestañas y el #hash abre la indicada', () => {
    renderAt('#organizaciones');
    expect(tabNames()).toEqual(['Perfil', 'Rol de consola', 'Organizaciones', 'Tenants', 'Provisioning', 'Vendedor', 'Actividad']);
    expect(screen.getByRole('tab', { name: 'Organizaciones' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Consultora Andina');
  });

  it('rol de consola: nunca ofrece Super Admin y asigna el elegido', async () => {
    renderAt('#consola');
    const select = screen.getByLabelText('Rol');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Admin de Producto', 'Finanzas']);
    fireEvent.change(select, { target: { value: 'EBIM_FINANCE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Asignar rol' }));
    await waitFor(() => expect(m.grantRole).toHaveBeenCalledWith(expect.objectContaining({ p_user_id: U, p_role: 'EBIM_FINANCE' })));
  });

  it('el super admin único no es modificable ni desactivable', () => {
    m.user = { ...base, email: 'dcalagua@ebim.pe', platformRole: 'EBIM_SUPER_ADMIN', platformRoleActive: true };
    renderAt('#consola');
    expect(screen.getByText(/no se asigna, no se transfiere/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument();
  });

  it('desactivar exige motivo y llama a la Edge Function (ban)', async () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar' }));
    const dialog = screen.getByRole('dialog', { name: /Desactivar a Nora Nueva/ });
    // Motivo obligatorio: sin él no se envía (validación nativa + la del diálogo).
    expect(within(dialog).getByLabelText(/Motivo/)).toBeRequired();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Desactivar' }));
    expect(m.action).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: 'salida de la empresa' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Desactivar' }));
    await waitFor(() => expect(m.action).toHaveBeenCalledWith({ action: 'ban', user_id: U, reason: 'salida de la empresa' }));
  });

  it('un admin de partner no ve consola, provisioning ni vendedor, ni puede desactivar', () => {
    m.scope = andinaScope;
    renderAt();
    expect(tabNames()).toEqual(['Perfil', 'Organizaciones', 'Tenants', 'Actividad']);
    expect(screen.queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument();
  });

  it('provisioning: revoca con la RPC existente', async () => {
    renderAt('#provisioning');
    fireEvent.click(screen.getByRole('button', { name: 'Revocar' }));
    await waitFor(() => expect(m.revokeProv).toHaveBeenCalledWith({ p_id: 'pr1' }));
  });

  it('vendedor: vincula la cuenta a un comercial libre', async () => {
    renderAt('#vendedor');
    fireEvent.change(screen.getByLabelText(/Comercial/), { target: { value: 'a3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));
    await waitFor(() => expect(m.link).toHaveBeenCalledWith(expect.objectContaining({ p_sales_agent_id: 'a3', p_user_id: U })));
  });

  it('actividad: acciones de auditoría en lenguaje de negocio', () => {
    renderAt('#actividad');
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('Agregado a una organización')).toBeInTheDocument();
    expect(within(panel).getByText('PARTNER_SALES · alta')).toBeInTheDocument();
  });

  it('invitación pendiente: reenviar muestra el enlace si no hay correo', async () => {
    m.user = { ...base, emailConfirmedAt: null, lastSignInAt: null };
    m.action.mockResolvedValue({ status: 'RESENT', user_id: U, delivery: 'LINK', action_link: 'http://x/verify?t=1' });
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar invitación' }));
    await waitFor(() => expect(m.action).toHaveBeenCalledWith({ action: 'resend', user_id: U }));
    expect(await screen.findByLabelText('Enlace de invitación')).toHaveValue('http://x/verify?t=1');
  });

  it('fuera de alcance: estado vacío explicativo', () => {
    m.user = null;
    renderAt();
    expect(screen.getByText('No existe o está fuera de tu alcance')).toBeInTheDocument();
  });

  it('si Auth quedó desalineado ofrece reintentar el bloqueo de ingreso', async () => {
    m.user = { ...base, isActive: false, banned: false };
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Bloquear ingreso' }));
    const dialog = screen.getByRole('dialog', { name: /Desactivar a Nora Nueva/ });
    fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: 'reintento' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Desactivar' }));
    await waitFor(() => expect(m.action).toHaveBeenCalledWith({ action: 'ban', user_id: U, reason: 'reintento' }));
  });
});
