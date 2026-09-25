import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

/*
 * P21/P23/P24 · Clientes y Partners son vistas del MISMO directorio: cada fila
 * abre la ficha 360 y un fallo de lectura nunca se ve como «sin clientes».
 */

const orgsHook = vi.fn();

vi.mock('@/services/queries', () => ({
  useOrganizations: () => orgsHook(),
}));
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ canManagePlatform: false, canManageOrganization: () => false }),
}));
vi.mock('./OrganizationFormDialog', () => ({ OrganizationFormDialog: () => null }));

import { CustomersPage } from './CustomersPage';
import { PartnersPage } from './PartnersPage';
import { OrganizationsPage } from './OrganizationsPage';

function org(id: string, name: string, caps: string[], status = 'ACTIVE') {
  return {
    id,
    slug: id,
    display_name: name,
    legal_name: `${name} SAC`,
    country_code: 'PE',
    tax_id: null,
    billing_email: null,
    status,
    kind: 'CUSTOMER',
    accent_color: null,
    organization_capabilities: caps.map((capability) => ({ capability })),
  };
}

const ORGS = [
  org('grupasa', 'GRUPASA', ['CUSTOMER']),
  org('andina', 'Consultora Andina', ['PARTNER', 'CUSTOMER']),
  org('canal', 'Canal Sur', ['RESELLER'], 'INACTIVE'),
];

function renderWith(node: ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
  orgsHook.mockReturnValue({ data: ORGS, isLoading: false, error: null });
});

describe('Directorio corporativo', () => {
  it('Clientes: un error de lectura es un estado de error con reintento, no una lista vacía', () => {
    const refetch = vi.fn();
    orgsHook.mockReturnValue({ data: undefined, isLoading: false, error: new Error('timeout'), refetch });
    renderWith(<CustomersPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar la información');
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(screen.queryByText('Sin clientes')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('Clientes: sólo filas con capacidad cliente, cada una enlazada a su ficha 360', () => {
    renderWith(<CustomersPage />);
    expect(screen.getByRole('heading', { name: 'Clientes' })).toBeInTheDocument();
    expect(screen.queryByText('Canal Sur')).toBeNull();
    const row = screen.getByRole('row', { name: /GRUPASA/ });
    expect(within(row).getByRole('link', { name: 'GRUPASA' })).toHaveAttribute('href', '/organizations/grupasa');
    expect(within(row).getByRole('link', { name: 'Ver detalle' })).toHaveAttribute('href', '/organizations/grupasa');
  });

  it('Partners: misma vista del directorio, con pestañas de estado y sin agregados globales', () => {
    renderWith(<PartnersPage />);
    expect(screen.getByText('Consultora Andina')).toBeInTheDocument();
    expect(screen.getByText('Canal Sur')).toBeInTheDocument();
    expect(screen.queryByText('GRUPASA')).toBeNull();
    expect(screen.getByRole('tab', { name: /Activos\s*1/ })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/MRR|Cobrado|EBIM total/i);
  });

  it('Directorio: pestañas de capacidad con conteos del alcance visible', () => {
    renderWith(<OrganizationsPage />);
    expect(screen.getByRole('heading', { name: 'Directorio corporativo' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Todas\s*3/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Partners\s*2/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Clientes\s*2/ })).toBeInTheDocument();
  });
});
