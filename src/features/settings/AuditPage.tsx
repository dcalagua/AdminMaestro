import { useEffect, useState } from 'react';
import { useListState } from '@/hooks/useListState';
import { PageContainer, Card, SearchBar, EmptyState, ErrorState, LoadingState } from '@/components/ui/primitives';
import { TablePager } from '@/components/ui/PagedTable';
import { ExportMenu } from '@/components/ui/ExportMenu';
import type { ExportColumn } from '@/lib/export';
import { formatDateTime } from '@/lib/format';
import { fetchAuditPage, useAuditPage, type AuditFilter, type AuditRow, type AuditSort } from './auditQueries';
import { changedFieldsOf, correlationOf, diffOf, metadataOf, redact } from './auditFormat';
import { auditActionLabel, entityTypeLabel } from './auditActions';
import { AuditTimeline } from './AuditTimeline';

const SORTS: AuditSort[] = ['occurred_at', 'action', 'entity_type'];

const EXPORT_COLUMNS: ExportColumn<AuditRow>[] = [
  { header: 'Fecha', value: (r) => r.occurred_at },
  { header: 'Actor', value: (r) => r.actor_email ?? 'Sistema' },
  { header: 'Acción', value: (r) => r.action },
  { header: 'Tipo de entidad', value: (r) => r.entity_type },
  { header: 'ID de entidad', value: (r) => r.entity_id },
  { header: 'Correlación', value: (r) => correlationOf(r.metadata) },
  { header: 'Campos modificados', value: (r) => changedFieldsOf(r.metadata).join(' ') },
  // La metadata completa NO se exporta: puede contener contexto técnico y la
  // exportación es para trazabilidad, no para volcar JSON.
];

/**
 * Bitácora de auditoría.
 *
 * Append-only REAL: `authenticated` no tiene GRANT de UPDATE ni DELETE sobre
 * `audit_logs`, y no existe política que los permita. No es "append-only por
 * convención" — esa distinción es exactamente la lección `esupplier-030`.
 *
 * Tabla paginada en servidor; el JSON técnico sólo aparece en el detalle
 * controlado de un evento, nunca como celda principal (spec §12).
 */
export function AuditPage() {
  const list = useListState<AuditFilter, AuditSort>({
    filter: 'ALL',
    filters: ['ALL'],
    sortBy: 'occurred_at',
    sorts: SORTS,
    sortDir: 'desc',
  });
  const [draft, setDraft] = useState(list.search);

  // Búsqueda con pequeña espera: una consulta por término, no por tecla.
  useEffect(() => {
    if (draft === list.search) return;
    const t = window.setTimeout(() => list.setSearch(draft), 300);
    return () => window.clearTimeout(t);
  }, [draft, list]);

  // La línea de tiempo se agrupa por día: siempre ordenada por fecha (la URL
  // antigua con orden por acción o entidad cae en «más recientes»).
  const sortDir = list.sortBy === 'occurred_at' ? list.sortDir : 'desc';
  const params = {
    search: list.search,
    page: list.page,
    pageSize: list.pageSize,
    sortBy: 'occurred_at' as const,
    sortDir,
  };
  const page = useAuditPage(params);
  const rows = page.data?.rows ?? [];
  const total = page.data?.total ?? 0;

  return (
    <PageContainer
      title="Auditoría"
      description="Acciones administrativas sensibles. La bitácora no se puede editar ni borrar desde la aplicación: el enforcement está en los GRANT, no en una convención."
    >
      <Card>
        <SearchBar
          value={draft}
          onChange={setDraft}
          placeholder="Buscar por acción, actor o entidad…"
          right={
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-caption text-muted">
                Orden
                <select
                  className="h-8 rounded-md border border-border-strong bg-card px-2 text-caption text-fg hover:border-fg-2"
                  value={sortDir}
                  onChange={(e) => list.setSort('occurred_at', e.target.value === 'asc' ? 'asc' : 'desc')}
                >
                  <option value="desc">Más recientes primero</option>
                  <option value="asc">Más antiguos primero</option>
                </select>
              </label>
              <ExportMenu
                filenameBase="auditoria"
                columns={EXPORT_COLUMNS}
                pageRows={rows}
                total={total}
                fetchPage={(p, size) => fetchAuditPage({ ...params, page: p, pageSize: size })}
                rowKey={(r) => String(r.id)}
              />
            </div>
          }
        />
        {page.isLoading ? (
          <LoadingState label="Cargando la bitácora…" />
        ) : page.error ? (
          <ErrorState error={page.error} onRetry={() => void page.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Sin eventos de auditoría"
            illustration={list.search ? 'search' : 'empty'}
            description={list.search ? 'Ningún evento coincide con la búsqueda.' : 'No hay eventos visibles para tu rol.'}
          />
        ) : (
          <div aria-busy={page.isFetching || undefined}>
            <AuditTimeline
              label="Eventos de auditoría"
              rows={rows}
              renderDetail={(row) => <AuditDetail row={row} embedded />}
            />
            <TablePager
              page={list.page}
              pageSize={list.pageSize}
              total={total}
              shown={rows.length}
              onPageChange={list.setPage}
              onPageSizeChange={list.setPageSize}
            />
          </div>
        )}
      </Card>
    </PageContainer>
  );
}

export function AuditDetail({
  row,
  headingRef,
  onClose,
  embedded = false,
}: {
  row: AuditRow;
  headingRef?: React.Ref<HTMLHeadingElement>;
  onClose?: () => void;
  /** Dentro de la línea de tiempo: sin cabecera (quién/qué/cuándo ya están en el evento). */
  embedded?: boolean;
}) {
  const diff = diffOf(row.metadata);
  const metadata = metadataOf(row.metadata);
  const hasMetadata = Object.keys(metadata).length > 0;
  const correlation = correlationOf(row.metadata);

  const body = (
    <div className={embedded ? 'space-y-4' : 'space-y-4 p-4'}>
      {diff ? (
        <div>
          <p className="mb-2 text-micro text-muted">Cambios (antes → después)</p>
          {diff.length === 0 ? (
            <p className="text-body text-muted">Sin diferencias entre los dos estados registrados.</p>
          ) : (
            <div
              className="relative overflow-x-auto rounded-field border border-border bg-card"
              role="region"
              aria-label="Diferencias"
              tabIndex={0}
            >
              <table className="w-full border-collapse" aria-label="Diferencias antes y después">
                <thead className="border-b border-border bg-sunken">
                  <tr>
                    <th scope="col" className="ebim-th">Campo</th>
                    <th scope="col" className="ebim-th">Antes</th>
                    <th scope="col" className="ebim-th">Después</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {diff.map((d) => (
                    <tr key={d.field}>
                      <td className="ebim-td font-mono text-caption">{d.field}</td>
                      <td className="ebim-td break-all font-mono text-caption text-muted line-through">
                        {d.before}
                      </td>
                      <td className="ebim-td break-all font-mono text-caption font-semibold">{d.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <p className="text-compact text-muted" data-testid="audit-no-diff">
          Este evento no registra un estado anterior y uno posterior: se muestra sólo la metadata
          disponible, sin reconstruir un «antes».
        </p>
      )}

      {hasMetadata ? (
        <details className="rounded-field border border-border bg-card">
          <summary className="cursor-pointer px-3 py-2 text-compact font-semibold text-fg">
            Metadata técnica (JSON)
          </summary>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all border-t border-border p-3 font-mono text-caption text-muted">
            {JSON.stringify(redact(metadata), null, 2)}
          </pre>
        </details>
      ) : (
        <EmptyState title="Sin metadata" illustration="none" description="El evento no guarda contexto adicional." />
      )}
    </div>
  );

  if (embedded) return body;

  const human = auditActionLabel(row.action);
  return (
    <section className="ebim-card" aria-labelledby="audit-detail-title">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 id="audit-detail-title" ref={headingRef} tabIndex={-1} className="text-h3 text-fg focus:outline-none">
            {human ?? 'Detalle del evento'}
          </h2>
          <p className="mt-0.5 break-all text-caption text-muted">
            {row.action} · {entityTypeLabel(row.entity_type)}
            {row.entity_id ? ` · ${row.entity_id}` : ''} · {formatDateTime(row.occurred_at)} ·{' '}
            {row.actor_email ?? 'Sistema'}
            {correlation ? ` · correlación ${correlation}` : ''}
          </p>
        </div>
        {onClose ? (
          <button type="button" className="ebim-btn-ghost" onClick={onClose}>
            Cerrar detalle
          </button>
        ) : null}
      </div>
      {body}
    </section>
  );
}
