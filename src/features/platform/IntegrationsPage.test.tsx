import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
 * P26 · La matriz de integraciones resume la salud POR ENTORNO, sólo con
 * destinos habilitados, con la fecha de observación, y renderizarla no llama a
 * ningún producto ni Edge Function.
 */

const invoke = vi.fn();
const checkHealth = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke }, rpc: vi.fn(), from: vi.fn() },
}));
vi.mock('@/services/mutations', () => ({
  useCheckDeploymentHealth: () => ({ mutateAsync: checkHealth, mutate: checkHealth, isPending: false }),
}));
vi.mock('@/services/queries', () => ({
  useProductIntegrations: () => ({
    isLoading: false,
    error: null,
    data: [
      {
        id: 'int-1',
        code: 'ewm-provisioning-v1',
        name: 'EWM provisioning',
        integration_type: 'HTTP_M2M',
        contract_version: 'v1',
        status: 'READY',
        enabled: true,
        cutover_state_entitlements: 'SHADOW',
        cutover_state_billing: 'BILLING_LEGACY',
        owner_name: 'Equipo EWM',
        saas_product_id: 'p-ewm',
        saas_products: { code: 'EWM', short_name: 'EWM' },
        profiles: null,
      },
    ],
  }),
  useProvisioningTargets: () => ({
    isLoading: false,
    error: null,
    data: [
      {
        deployment_target_id: 't-qas',
        product_integration_id: 'int-1',
        provisioning_environment: 'QAS',
        provisioning_enabled: true,
        provisioning_status: 'READY',
        health_status: 'HEALTHY',
        health_checked_at: '2026-09-20T15:30:00Z',
      },
      {
        deployment_target_id: 't-prd',
        product_integration_id: 'int-1',
        provisioning_environment: 'PRD',
        provisioning_enabled: false,
        provisioning_status: 'DRAFT',
        health_status: 'UNHEALTHY',
        health_checked_at: '2026-09-21T15:30:00Z',
      },
    ],
  }),
  useProductOwners: () => ({ data: [] }),
}));
vi.mock('@/hooks/useProvisioningAccess', () => ({
  useProvisioningAccess: () => ({ can: () => false, canForProduct: () => false }),
}));
vi.mock('./IntegrationDialogs', () => ({ IntegrationDialog: () => null }));

import { IntegrationsPage } from './IntegrationsPage';

function renderPage(path = '/integrations') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <IntegrationsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  invoke.mockReset();
  checkHealth.mockReset();
});

describe('IntegrationsPage (V6 · F1: tabla densa)', () => {
  it('resume por entorno en una línea: QAS sano con su fecha en el tooltip; PRD en borrador «No evaluado», nunca «Caído»', () => {
    renderPage();
    const list = screen.getByRole('list', { name: 'Salud por entorno de EWM provisioning' });
    const items = within(list).getAllByRole('listitem');
    const qas = items.find((li) => li.dataset.environment === 'QAS')!;
    const prd = items.find((li) => li.dataset.environment === 'PRD')!;

    expect(within(qas).getByText('Saludable')).toBeInTheDocument();
    expect(qas.getAttribute('title')).toMatch(/^Calidad: Saludable · observado el /);

    expect(within(prd).getByText('No evaluado')).toBeInTheDocument();
    // El destino deshabilitado no contamina nada: ningún «Caído» en la página.
    expect(screen.queryByText('Caído')).not.toBeInTheDocument();
  });

  it('una fila por integración: estado de negocio único, código al tooltip y migraciones sin jerga ni etiquetas encimadas', () => {
    renderPage();
    const row = document.querySelector('[data-integration="ewm-provisioning-v1"]') as HTMLElement;
    const link = within(row).getByRole('link', { name: 'EWM provisioning' });
    expect(link).toHaveAttribute('href', '/integrations/int-1');
    expect(link.getAttribute('title')).toContain('Código: ewm-provisioning-v1');
    // «Lista» + «Habilitada» pasan a una sola insignia.
    expect(within(row).getByText('Operativa')).toBeInTheDocument();
    expect(within(row).queryByText('Habilitada')).toBeNull();
    // Cada migración pinta solo el nombre de su etapa actual.
    const visible = [...row.querySelectorAll('[data-stepper] p')].map((p) => p.textContent);
    expect(visible).toEqual(['En comparación', 'Cobra la app']);
    expect(row.textContent).not.toMatch(/Legacy|Paso \d de|MasterAdmin|Propietarios técnicos/);
  });

  it('el detalle completo va en un panel lateral, con la salud y sus fechas', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Acciones de EWM provisioning' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ver resumen' }));
    const drawer = screen.getByRole('dialog', { name: 'EWM provisioning' });
    const list = within(drawer).getByRole('list', { name: 'Salud observada por entorno' });
    const qas = within(list).getAllByRole('listitem').find((li) => li.dataset.environment === 'QAS')!;
    expect(within(qas).getByText(/Observado el/)).toBeInTheDocument();
    expect(qas.querySelector('time')?.getAttribute('dateTime')).toBe('2026-09-20T15:30:00Z');
    expect(within(drawer).getByRole('link', { name: 'Abrir ficha' })).toHaveAttribute('href', '/integrations/int-1');
  });

  it('la franja dice lo útil: operativas, destinos evaluados, incidencias y salud desactualizada', () => {
    renderPage();
    const strip = screen.getByRole('region', { name: 'Resumen de integraciones' });
    expect(within(strip).getByText('1 de 1')).toBeInTheDocument();
    expect(strip.querySelector('[data-stat-cell="Destinos evaluados"]')).toHaveTextContent('1 de 2');
    expect(strip.querySelector('[data-stat-cell="Con incidencia"]')).toHaveTextContent('0');
  });

  it('con el filtro de entorno sólo se ve ese entorno', () => {
    renderPage('/integrations?entorno=QAS');
    const list = screen.getByRole('list', { name: 'Salud por entorno de EWM provisioning' });
    const envs = within(list).getAllByRole('listitem').map((li) => li.dataset.environment);
    expect(envs).toEqual(['QAS']);
  });

  it('no afirma certificación sin fuente verificable', () => {
    renderPage();
    expect(screen.queryByText(/^Certificad[oa]$/)).not.toBeInTheDocument();
    expect(screen.getByText(/no dispone de una fuente verificable/)).toBeInTheDocument();
  });

  it('renderizar no verifica salud ni invoca Edge Functions', () => {
    renderPage();
    expect(checkHealth).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
