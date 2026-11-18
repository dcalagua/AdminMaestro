import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LeadsPage } from './LeadsPage';

/*
 * Solicitudes de la web: se ven las abiertas, se abren en un panel y se
 * descartan con motivo; convertir abre «Nuevo cliente» con sus datos.
 */
const m = vi.hoisted(() => ({
  setStatus: vi.fn(),
  runSync: vi.fn(),
  perms: { canManageCommercial: true },
  draft: null as unknown,
}));

const LEADS = [
  {
    id: 'l1', status: 'NEW', company_name: 'Andina Servicios', contact_name: 'Ana Quispe', email: 'ana@andina.pe',
    phone: '+51 999', team_size: '6-20', plan_code: 'echange-mesa-completa', country_code: 'PE', message: 'Queremos probar.',
    received_at: new Date(Date.now() - 3600_000).toISOString(), organization_id: null, status_note: null,
    saas_products: { code: 'echange', short_name: 'eChange' }, organizations: null,
  },
  {
    id: 'l2', status: 'DISCARDED', company_name: 'Spam SA', contact_name: 'X', email: 'x@x.com', phone: null, team_size: null,
    plan_code: null, country_code: null, message: null, received_at: new Date().toISOString(), organization_id: null,
    status_note: 'Spam', saas_products: { code: 'echange', short_name: 'eChange' }, organizations: null,
  },
];

vi.mock('./leadsApi', () => ({
  useCommercialLeads: () => ({ data: LEADS, isLoading: false, error: null, refetch: vi.fn() }),
  useLeadSyncState: () => ({ data: [{ last_run_at: '2026-11-17T10:00:00Z', last_outcome: 'OK', last_error_code: null }] }),
  useRunLeadSync: () => ({ mutateAsync: m.runSync, isPending: false }),
  useSetLeadStatus: () => ({ mutateAsync: m.setStatus, isPending: false }),
  useLinkLeadOrganization: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
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
  m.perms = { canManageCommercial: true };
  m.draft = null;
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

  it('sin permiso comercial no muestra nada', () => {
    m.perms = { canManageCommercial: false };
    renderPage();
    expect(screen.getByText('Sin acceso')).toBeInTheDocument();
    expect(screen.queryByText('Andina Servicios')).not.toBeInTheDocument();
  });
});
