import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LeadsPage } from './LeadsPage';

/*
 * Solicitudes de la web: se ven las abiertas, se abren en un panel y se
 * descartan con motivo; convertir abre «Nuevo cliente» con sus datos.
 * Perfil comercial: el comercial las ve todas, pide la prueba (no convierte)
 * y no mueve las que tomó otro.
 */
const m = vi.hoisted(() => ({
  setStatus: vi.fn(),
  runSync: vi.fn(),
  perms: { canManageCommercial: true, isSalesAgent: false },
  roles: null as null | { salesAgentId: string | null },
  draft: null as unknown,
  trialLead: undefined as unknown,
}));

const LEADS = [
  {
    id: 'l1', status: 'NEW', company_name: 'Andina Servicios', contact_name: 'Ana Quispe', email: 'ana@andina.pe',
    phone: '+51 999', team_size: '6-20', plan_code: 'echange-mesa-completa', country_code: 'PE', message: 'Queremos probar.',
    received_at: new Date(Date.now() - 3600_000).toISOString(), organization_id: null, status_note: null,
    saas_products: { code: 'echange', short_name: 'eChange' }, organizations: null,
    owner_sales_agent_id: null, owner: null,
  },
  {
    id: 'l3', status: 'CONTACTED', company_name: 'Tomada SAC', contact_name: 'Tito', email: 't@tomada.pe', phone: null,
    team_size: null, plan_code: null, country_code: 'PE', message: null, received_at: new Date().toISOString(),
    organization_id: null, status_note: null, saas_products: { code: 'echange', short_name: 'eChange' }, organizations: null,
    owner_sales_agent_id: 'sa-otro', owner: null,
  },
  {
    id: 'l2', status: 'DISCARDED', company_name: 'Spam SA', contact_name: 'X', email: 'x@x.com', phone: null, team_size: null,
    plan_code: null, country_code: null, message: null, received_at: new Date().toISOString(), organization_id: null,
    status_note: 'Spam', saas_products: { code: 'echange', short_name: 'eChange' }, organizations: null,
    owner_sales_agent_id: null, owner: null,
  },
];

vi.mock('./leadsApi', () => ({
  useCommercialLeads: () => ({ data: LEADS, isLoading: false, error: null, refetch: vi.fn() }),
  useLeadSyncState: () => ({ data: [{ last_run_at: '2026-11-17T10:00:00Z', last_outcome: 'OK', last_error_code: null }] }),
  useRunLeadSync: () => ({ mutateAsync: m.runSync, isPending: false }),
  useSetLeadStatus: () => ({ mutateAsync: m.setStatus, isPending: false }),
  useLinkLeadOrganization: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRequestTrial: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('./TrialRequestsCard', () => ({ TrialRequestsCard: () => null }));
vi.mock('./RequestTrialDialog', () => ({
  RequestTrialDialog: ({ open, lead }: { open: boolean; lead: unknown }) => {
    m.trialLead = open ? lead : m.trialLead;
    return open ? <div role="dialog" aria-label="Pedir prueba" /> : null;
  },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ roles: m.roles }) }));
vi.mock('@/services/queries', () => ({
  usePlans: () => ({ data: [{ code: 'echange-mesa-completa', name: 'Mesa completa' }] }),
}));
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => m.perms }));
vi.mock('@/components/ui/toast-context', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/features/organizations/OrganizationFormDialog', () => ({
  OrganizationFormDialog: ({ open, initial }: { open: boolean; initial?: unknown }) => {
    m.draft = open ? initial : m.draft;
    return open ? <div role="dialog" aria-label="Nuevo cliente" /> : null;
  },
}));

const renderPage = () => render(<MemoryRouter><LeadsPage /></MemoryRouter>);

beforeEach(() => {
  m.setStatus.mockReset().mockResolvedValue('l1');
  m.perms = { canManageCommercial: true, isSalesAgent: false };
  m.roles = null;
  m.draft = null;
  m.trialLead = undefined;
});

describe('Solicitudes de la web', () => {
  it('muestra las abiertas con su interés, sin las descartadas', () => {
    renderPage();
    expect(screen.getByText('Andina Servicios')).toBeInTheDocument();
    expect(screen.getByText('eChange · Mesa completa')).toBeInTheDocument();
    expect(screen.queryByText('Spam SA')).not.toBeInTheDocument();
  });

  it('el panel muestra lo que escribió y descartar exige motivo', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText('Andina Servicios'));
    const panel = screen.getByRole('dialog', { name: 'Andina Servicios' });
    expect(within(panel).getByText('Queremos probar.')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Descartar' }));
    const confirm = screen.getByRole('dialog', { name: '¿Descartar esta solicitud?' });
    await user.type(within(confirm).getByRole('textbox'), 'No es del rubro');
    await user.click(within(confirm).getByRole('button', { name: 'Descartar' }));
    expect(m.setStatus).toHaveBeenCalledWith({ id: 'l1', status: 'DISCARDED', note: 'No es del rubro' });
  });

  it('convertir abre «Nuevo cliente» con los datos de la solicitud', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText('Andina Servicios'));
    await user.click(screen.getAllByRole('button', { name: 'Crear cliente y nueva venta' })[0]!);
    expect(screen.getByRole('dialog', { name: 'Nuevo cliente' })).toBeInTheDocument();
    expect(m.draft).toMatchObject({ legal_name: 'Andina Servicios', country_code: 'PE', billing_email: 'ana@andina.pe' });
  });

  it('el comercial ve todas, pide la prueba en vez de convertir y no mueve las de otro', async () => {
    const user = userEvent.setup();
    m.perms = { canManageCommercial: false, isSalesAgent: true };
    m.roles = { salesAgentId: 'sa-yo' };
    renderPage();
    expect(screen.getByText('Andina Servicios')).toBeInTheDocument();
    expect(screen.getByText('Tomada por otro comercial')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Traer ahora' })).not.toBeInTheDocument();
    await user.click(screen.getByText('Andina Servicios'));
    const panel = screen.getByRole('dialog', { name: 'Andina Servicios' });
    expect(within(panel).queryByRole('button', { name: 'Crear cliente y nueva venta' })).not.toBeInTheDocument();
    await user.click(within(panel).getAllByRole('button', { name: 'Pedir prueba' })[0]!);
    expect(screen.getByRole('dialog', { name: 'Pedir prueba' })).toBeInTheDocument();
    expect(m.trialLead).toMatchObject({ id: 'l1' });
  });

  it('la solicitud tomada por otro comercial no ofrece acciones', async () => {
    const user = userEvent.setup();
    m.perms = { canManageCommercial: false, isSalesAgent: true };
    m.roles = { salesAgentId: 'sa-yo' };
    renderPage();
    await user.click(screen.getByText('Tomada SAC'));
    const panel = screen.getByRole('dialog', { name: 'Tomada SAC' });
    expect(within(panel).queryByRole('button', { name: 'Pedir prueba' })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Descartar' })).not.toBeInTheDocument();
  });

  it('sin permiso comercial no muestra nada', () => {
    m.perms = { canManageCommercial: false, isSalesAgent: false };
    renderPage();
    expect(screen.getByText('Sin acceso')).toBeInTheDocument();
    expect(screen.queryByText('Andina Servicios')).not.toBeInTheDocument();
  });
});
