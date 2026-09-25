import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { diffOf, redact, REDACTED } from './auditFormat';

/*
 * P28 · La metadata JSON sólo existe dentro del detalle controlado; el diff
 * aparece sólo con ambos lados; nunca se inventa un «antes» ni se ve un secreto.
 */

const ROWS = [
  {
    id: 2,
    occurred_at: '2026-09-20T10:00:00Z',
    actor_email: 'ops@ebim.test',
    action: 'product_integration.update',
    entity_type: 'product_integration',
    entity_id: '11111111-2222-3333-4444-555555555555',
    organization_id: null,
    tenant_id: null,
    actor_user_id: null,
    metadata: {
      before: { audience: 'old.aud', token_ttl_seconds: 120 },
      after: { audience: 'new.aud', token_ttl_seconds: 120 },
      changed_fields: ['audience'],
      correlation_id: 'corr-abc',
    },
  },
  {
    id: 1,
    occurred_at: '2026-09-19T10:00:00Z',
    actor_email: null,
    action: 'tenant.create',
    entity_type: 'tenant',
    entity_id: 't-1',
    organization_id: null,
    tenant_id: null,
    actor_user_id: null,
    metadata: { after: { name: 'Nuevo' }, secret_ref: 'VAULT_NAME' },
  },
];

vi.mock('./auditQueries', () => ({
  useAuditPage: () => ({
    isLoading: false,
    isFetching: false,
    error: null,
    data: { rows: ROWS, total: ROWS.length },
    refetch: vi.fn(),
  }),
  fetchAuditPage: vi.fn(),
}));

import { AuditPage } from './AuditPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <AuditPage />
    </MemoryRouter>,
  );
}

describe('AuditPage', () => {
  it('la tabla no muestra JSON como celda principal', () => {
    renderPage();
    const table = screen.getByRole('table', { name: 'Eventos de auditoría' });
    expect(table.textContent).not.toMatch(/[{}]/);
    expect(within(table).getByText('1 campo modificado')).toBeInTheDocument();
    expect(within(table).getByText('corr-abc')).toBeInTheDocument();
    expect(screen.queryByText(/Metadata técnica/)).not.toBeInTheDocument();
  });

  it('con antes y después muestra el diff; el JSON queda en un detalle plegado', () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver detalle' })[0]!);
    const diff = screen.getByRole('table', { name: 'Diferencias antes y después' });
    expect(within(diff).getByText('old.aud')).toBeInTheDocument();
    expect(within(diff).getByText('new.aud')).toBeInTheDocument();
    const details = screen.getByText('Metadata técnica (JSON)').closest('details')!;
    expect(details.open).toBe(false);
  });

  it('sin «antes» no fabrica un diff y oculta la referencia de secreto', () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver detalle' })[1]!);
    expect(screen.queryByRole('table', { name: 'Diferencias antes y después' })).not.toBeInTheDocument();
    expect(screen.getByTestId('audit-no-diff')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('VAULT_NAME');
    expect(document.body.textContent).toContain(REDACTED);
  });
});

describe('auditFormat', () => {
  it('diffOf devuelve null si falta un lado o está vacío', () => {
    expect(diffOf({ after: { a: 1 } })).toBeNull();
    expect(diffOf({ before: {}, after: { a: 1 } })).toBeNull();
    expect(diffOf({ before: { a: 1 }, after: { a: 2 } })).toEqual([{ field: 'a', before: '1', after: '2' }]);
  });

  it('redact oculta claves con forma de secreto, no sus metadatos', () => {
    expect(redact({ secret_ref: 'X', nested: { api_key: 'Y' }, token_ttl_seconds: 60, secret_configured: true })).toEqual({
      secret_ref: REDACTED,
      nested: { api_key: REDACTED },
      token_ttl_seconds: 60,
      secret_configured: true,
    });
  });
});
