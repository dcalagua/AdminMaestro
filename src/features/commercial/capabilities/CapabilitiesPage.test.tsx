import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
 * CCP fase 07 · Registro de capacidades: lectura agrupada por producto e
 * importación de manifiesto sólo ofrecida a quien administra la plataforma.
 */

const capabilitiesHook = vi.fn();
const permissions = vi.fn();

vi.mock('@/services/queries', () => ({
  useProductCapabilities: () => capabilitiesHook(),
  useProducts: () => ({
    data: [
      { id: 'prod-ewm', code: 'ewm', short_name: 'EWM' },
      { id: 'prod-esup', code: 'esupplier', short_name: 'eSupplier' },
    ],
  }),
}));
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => permissions(),
}));
vi.mock('./ImportManifestDialog', () => ({ ImportManifestDialog: () => null }));

import { CapabilitiesPage } from './CapabilitiesPage';

function capability(overrides: Record<string, unknown>) {
  return {
    id: 'c1',
    code: 'ewm.waves',
    name: 'Olas de picking',
    description: null,
    kind: 'FEATURE',
    is_baseline: false,
    unit: null,
    combine_rule: null,
    scope_level: 'TENANT',
    meter_code: null,
    status: 'ACTIVE',
    saas_product_id: 'prod-ewm',
    aliases: [],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CapabilitiesPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  capabilitiesHook.mockReset();
  permissions.mockReturnValue({ canManagePlatform: false });
});

describe('CapabilitiesPage', () => {
  it('agrupa por producto y muestra tipo, base, alcance, combinación, medidor y alias', () => {
    capabilitiesHook.mockReturnValue({
      data: [
        capability({
          is_baseline: true,
          aliases: [{ id: 'a1', alias_code: 'waves', alias_source: 'LEGACY_FLAG', capability_id: 'c1' }],
        }),
        capability({
          id: 'c2', code: 'ewm.warehouses', name: 'Almacenes', kind: 'LIMIT', combine_rule: 'MAX',
          scope_level: 'COMPANY', unit: 'warehouse', status: 'DRAFT',
        }),
        capability({
          id: 'c3', code: 'esupplier.ai_docs', name: 'Lectura IA', kind: 'ALLOWANCE', combine_rule: 'SUM',
          meter_code: 'esupplier.ai_pages', unit: 'page', saas_product_id: 'prod-esup',
        }),
      ],
      isLoading: false,
      error: null,
    });
    renderPage();

    const ewm = screen.getByRole('region', { name: 'EWM' });
    const waves = within(ewm).getByRole('row', { name: /Olas de picking/ });
    expect(within(waves).getByText('Incluida en base')).toBeInTheDocument();
    expect(within(waves).getByText('waves')).toBeInTheDocument();
    const limit = within(ewm).getByRole('row', { name: /Almacenes/ });
    expect(within(limit).getByText('Límite')).toBeInTheDocument();
    expect(within(limit).getByText('Se toma el mayor')).toBeInTheDocument();
    expect(within(limit).getByText('Sociedad')).toBeInTheDocument();
    expect(within(limit).getByText('Borrador')).toBeInTheDocument();

    const esup = screen.getByRole('region', { name: 'eSupplier' });
    expect(within(esup).getByText('esupplier.ai_pages')).toBeInTheDocument();
    expect(within(esup).getByText('Se suman')).toBeInTheDocument();
  });

  it('sin permiso de plataforma no ofrece «Importar manifiesto»', () => {
    capabilitiesHook.mockReturnValue({ data: [capability({})], isLoading: false, error: null });
    renderPage();
    expect(screen.queryByRole('button', { name: 'Importar manifiesto' })).toBeNull();
  });

  it('con permiso de plataforma ofrece «Importar manifiesto»', () => {
    permissions.mockReturnValue({ canManagePlatform: true });
    capabilitiesHook.mockReturnValue({ data: [capability({})], isLoading: false, error: null });
    renderPage();
    expect(screen.getByRole('button', { name: 'Importar manifiesto' })).toBeInTheDocument();
  });

  it('estado vacío cuando ningún producto importó su manifiesto', () => {
    capabilitiesHook.mockReturnValue({ data: [], isLoading: false, error: null });
    renderPage();
    expect(screen.getByText('Sin capacidades registradas')).toBeInTheDocument();
  });

  it('un error de lectura se muestra como error, no como lista vacía', () => {
    capabilitiesHook.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom'), refetch: vi.fn() });
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar la información');
    expect(screen.queryByText('Sin capacidades registradas')).toBeNull();
  });
});
