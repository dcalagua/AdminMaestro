import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AdminUser } from './userModel';

/*
 * M5 · «Usuarios y accesos»: buscador único + pestañas (U-06), estados, e
 * «Invitar usuario» con el resultado (correo enviado o enlace para copiar).
 * Roles: S-01 nunca ofrece EBIM_SUPER_ADMIN; un admin de partner solo su familia.
 */
const ANDINA = '30000000-0000-4000-a000-000000000002';
const ALPHA = '30000000-0000-4000-a000-000000000004';

function user(p: Partial<AdminUser>): AdminUser {
  return {
    id: 'u', email: 'x@ebim.test', fullName: 'X', phone: null, jobTitle: null, isActive: true,
    createdAt: '2026-09-01T00:00:00Z', lastSignInAt: '2026-10-01T10:00:00Z', invitedAt: null,
    emailConfirmedAt: '2026-09-01T00:00:00Z', banned: false, platformRole: null, platformRoleActive: false,
    organizations: [], tenants: [], provisioningRoles: [], productOwnerships: [], salesAgent: null, ...p,
  };
}

const USERS: AdminUser[] = [
  user({ id: 'u1', email: 'dcalagua@ebim.pe', fullName: 'Dennis Calagua', platformRole: 'EBIM_SUPER_ADMIN', platformRoleActive: true }),
  user({ id: 'u2', email: 'admin@andina.ebim.test', fullName: 'Ana Andina', organizations: [
    { id: 'm1', organization_id: ANDINA, organization_name: 'Consultora Andina', organization_kind: 'COMPANY', is_partner: true, role: 'PARTNER_ADMIN', company_id: null, is_active: true },
  ] }),
  user({ id: 'u3', email: 'admin@alpha.ebim.test', fullName: 'Alicia Alpha', organizations: [
    { id: 'm2', organization_id: ALPHA, organization_name: 'Empresa Alpha', organization_kind: 'COMPANY', is_partner: false, role: 'ORG_ADMIN', company_id: null, is_active: true },
  ] }),
  user({ id: 'u4', email: 'nuevo@ebim.test', fullName: 'Nora Nueva', invitedAt: '2026-10-03T00:00:00Z', emailConfirmedAt: null, lastSignInAt: null, organizations: [
    { id: 'm3', organization_id: ALPHA, organization_name: 'Empresa Alpha', organization_kind: 'COMPANY', is_partner: false, role: 'ORG_VIEWER', company_id: null, is_active: true },
  ] }),
  user({ id: 'u5', email: 'baja@ebim.test', fullName: 'Bruno Baja', isActive: false }),
];

const m = vi.hoisted(() => ({
  invite: vi.fn(),
  scope: {} as Record<string, unknown>,
}));

vi.mock('@/services/queries', () => ({
  useAdminUsers: () => ({ data: USERS, isLoading: false, error: null, refetch: vi.fn() }),
  useOrganizations: () => ({
    data: [
      { id: '30000000-0000-4000-a000-000000000001', display_name: 'EBIM', kind: 'PLATFORM', organization_capabilities: [] },
      { id: ANDINA, display_name: 'Consultora Andina', kind: 'COMPANY', organization_capabilities: [{ capability: 'PARTNER' }] },
      { id: ALPHA, display_name: 'Empresa Alpha', kind: 'COMPANY', organization_capabilities: [{ capability: 'CUSTOMER' }] },
    ],
    isLoading: false,
  }),
  useTenantOverview: () => ({
    data: [{ tenant_id: '50000000-0000-4000-a000-000000000001', name: 'Alpha · eSupplier', slug: 'alpha', product_short_name: 'eSupplier',
             customer_organization_id: ALPHA, managing_organization_id: null }],
    isLoading: false,
  }),
}));
vi.mock('@/services/mutations', () => ({
  useUserAdminAction: () => ({ mutateAsync: m.invite, isPending: false, error: null, reset: vi.fn() }),
}));
vi.mock('./useUserAdminScope', () => ({ useUserAdminScope: () => m.scope }));

import { UsersPage } from './UsersPage';

const superScope = {
  userId: 'u1', isSuperAdmin: true, managePlatform: true, manageCommercial: true, adminOrgs: [],
  canView: true, canInvite: true, adminRoleIn: () => null,
};
const andinaScope = {
  userId: 'u2', isSuperAdmin: false, managePlatform: false, manageCommercial: false,
  adminOrgs: [{ organizationId: ANDINA, role: 'PARTNER_ADMIN', displayName: 'Consultora Andina' }],
  canView: true, canInvite: true, adminRoleIn: (id: string) => (id === ANDINA ? 'PARTNER_ADMIN' : null),
};

function renderPage() {
  return render(
    <MemoryRouter>
      <UsersPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  m.invite.mockReset();
  m.scope = superScope;
});

describe('UsersPage', () => {
  it('lista con estados, buscador único y pestañas de estado', () => {
    renderPage();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(USERS.length + 1);
    expect(within(table).getByText('Invitación pendiente')).toBeInTheDocument();
    expect(within(table).getByText('Desactivado')).toBeInTheDocument();
    expect(within(table).getByText('Super Admin EBIM')).toBeInTheDocument();
    expect(within(table).getAllByRole('link', { name: 'Ver ficha' })[0]).toHaveAttribute('href', '/users/u1');

    const tabs = screen.getByRole('tablist', { name: 'Filtro de estado' });
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Todos 5', 'EBIM 1', 'Partners 1', 'Clientes 2', 'Inactivos 1',
    ]);
    fireEvent.click(within(tabs).getByRole('tab', { name: /Clientes/ }));
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3);

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'alpha' } });
    expect(within(screen.getByRole('table')).getByText('Alicia Alpha')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).queryByText('Ana Andina')).not.toBeInTheDocument();
  });

  it('el super admin invita con rol de consola, sin ofrecer EBIM_SUPER_ADMIN, y ve el enlace si no hay correo', async () => {
    m.invite.mockResolvedValue({ status: 'INVITED', user_id: 'n1', delivery: 'LINK', action_link: 'http://127.0.0.1:54721/auth/v1/verify?x', grant_applied: true });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Invitar usuario' }));
    const dialog = screen.getByRole('dialog', { name: 'Invitar usuario' });
    fireEvent.change(within(dialog).getByLabelText(/Correo/), { target: { value: 'Nuevo@EBIM.test' } });
    fireEvent.change(within(dialog).getByLabelText('Tipo de acceso'), { target: { value: 'PLATFORM_ROLE' } });
    const roleSelect = within(dialog).getByLabelText('Rol de consola');
    expect(within(roleSelect).queryByRole('option', { name: 'Super Admin EBIM' })).not.toBeInTheDocument();
    fireEvent.change(roleSelect, { target: { value: 'EBIM_FINANCE' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Invitar' }));

    await waitFor(() => expect(m.invite).toHaveBeenCalledWith({
      action: 'invite', email: 'nuevo@ebim.test', full_name: undefined,
      grant: { kind: 'PLATFORM_ROLE', role: 'EBIM_FINANCE' },
    }));
    const result = await screen.findByRole('dialog', { name: 'Invitación creada' });
    expect(within(result).getByLabelText('Enlace de invitación')).toHaveValue('http://127.0.0.1:54721/auth/v1/verify?x');
    expect(within(result).getByText(/no se volverá a mostrar/)).toBeInTheDocument();
  });

  it('con correo configurado confirma «Invitación enviada»', async () => {
    m.invite.mockResolvedValue({ status: 'INVITED', user_id: 'n1', delivery: 'EMAIL', grant_applied: true });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Invitar usuario' }));
    const dialog = screen.getByRole('dialog', { name: 'Invitar usuario' });
    fireEvent.change(within(dialog).getByLabelText(/Correo/), { target: { value: 'cliente@alpha.ebim.test' } });
    fireEvent.change(within(dialog).getByLabelText(/Organización/), { target: { value: ALPHA } });
    const roles = within(dialog).getByLabelText(/^Rol/);
    // Alpha es solo cliente: no se ofrecen roles PARTNER_*.
    expect(within(roles).queryByRole('option', { name: 'Admin de Partner' })).not.toBeInTheDocument();
    fireEvent.change(roles, { target: { value: 'ORG_VIEWER' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Invitar' }));
    expect(await screen.findByText(/Invitación enviada a/)).toBeInTheDocument();
    expect(m.invite.mock.calls[0]![0].grant).toEqual({ kind: 'ORG_MEMBERSHIP', role: 'ORG_VIEWER', organization_id: ALPHA });
  });

  it('un admin de partner solo invita a su organización y con roles de su familia', () => {
    m.scope = andinaScope;
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Invitar usuario' }));
    const dialog = screen.getByRole('dialog', { name: 'Invitar usuario' });
    const kinds = within(within(dialog).getByLabelText('Tipo de acceso')).getAllByRole('option').map((o) => o.textContent);
    expect(kinds).not.toContain('Rol de consola (personal EBIM)');
    const orgSelect = within(dialog).getByLabelText(/Organización/);
    expect(within(orgSelect).getAllByRole('option').map((o) => o.textContent)).toEqual(['Elige la organización', 'Consultora Andina']);
    fireEvent.change(orgSelect, { target: { value: ANDINA } });
    expect(within(within(dialog).getByLabelText(/^Rol/)).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Elige el rol', 'Admin de Partner', 'Comercial de Partner', 'Soporte de Partner',
    ]);
  });

  it('valida el correo antes de llamar a la Edge Function', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Invitar usuario' }));
    const dialog = screen.getByRole('dialog', { name: 'Invitar usuario' });
    fireEvent.change(within(dialog).getByLabelText(/Correo/), { target: { value: 'nadie@dominio' } });
    fireEvent.change(within(dialog).getByLabelText(/Organización/), { target: { value: ALPHA } });
    fireEvent.change(within(dialog).getByLabelText(/^Rol/), { target: { value: 'ORG_VIEWER' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Invitar' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('indica un correo válido');
    expect(m.invite).not.toHaveBeenCalled();
  });

  it('sin rol administrador muestra un estado vacío explicativo', () => {
    m.scope = { ...andinaScope, adminOrgs: [], canView: false, canInvite: false };
    renderPage();
    expect(screen.getByText('Tu rol no administra usuarios')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invitar usuario' })).not.toBeInTheDocument();
  });
});
