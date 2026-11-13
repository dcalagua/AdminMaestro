import { useEffect, useState } from 'react';
import { useListState } from '@/hooks/useListState';
import { PageContainer, Card, SearchBar, EmptyState, ErrorState, LoadingState, DataTable } from '@/components/ui/primitives';
import { TablePager } from '@/components/ui/PagedTable';
import { ExportMenu } from '@/components/ui/ExportMenu';
import type { ExportColumn } from '@/lib/export';
import { formatDateTime } from '@/lib/format';
import { fetchAuditPage, useAuditPage, type AuditFilter, type AuditRow, type AuditSort } from './auditQueries';
import { changedFieldsOf, correlationOf, diffOf, metadataOf, redact } from './auditFormat';
import { auditActionLabel, entityTypeLabel } from './auditActions';
import { AuditTimeline } from './AuditTimeline';
import { useAuditEntityResolver } from './auditEntities';
import { SelectInput } from '@/components/ui/fields';

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
 * Cada evento se lee con su nombre de negocio y el de su entidad (V6 · F4); el
 * código y los ids quedan en el detalle.
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
  const entityOf = useAuditEntityResolver();
  const rows = page.data?.rows ?? [];
  const total = page.data?.total ?? 0;

  return (
    <PageContainer
      title="Auditoría"
      description="Acciones administrativas sensibles: quién hizo qué, sobre qué y cuándo. La bitácora no se puede editar ni borrar."
    >
      <Card>
        <SearchBar
          value={draft}
          onChange={setDraft}
          placeholder="Buscar por acción, actor o entidad…"
          right={
            <div className="flex items-center gap-2">
              <SelectInput
                label="Orden"
                labelDisplay="inline"
                size="sm"
                selectClassName="w-auto"
                value={sortDir}
                onChange={(v) => list.setSort('occurred_at', v === 'asc' ? 'asc' : 'desc')}
                options={[
                  { value: 'desc', label: 'Más recientes primero' },
                  { value: 'asc', label: 'Más antiguos primero' },
                ]}
              />
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
              entityOf={entityOf}
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
      {embedded ? (
        // V6 · F4: el código y los identificadores salen de la línea del evento y quedan aquí.
        <dl className="grid gap-x-6 gap-y-1 text-caption sm:grid-cols-[auto_minmax(0,1fr)]" data-audit-reference>
          <dt className="text-muted">Código</dt>
          <dd className="break-all font-mono text-fg-2">{row.action}</dd>
          <dt className="text-muted">Entidad</dt>
          <dd className="break-all text-fg-2">
            {entityTypeLabel(row.entity_type)}
            {row.entity_id ? <span className="ml-1 font-mono">{row.entity_id}</span> : null}
          </dd>
          {correlation ? (
            <>
              <dt className="text-muted">Correlación</dt>
              <dd className="break-all font-mono text-fg-2">{correlation}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {diff ? (
        <div>
          <p className="mb-2 text-micro text-muted">Cambios (antes → después)</p>
          {diff.length === 0 ? (
            <p className="text-body text-muted">Sin diferencias entre los dos estados registrados.</p>
          ) : (
            <div className="overflow-hidden rounded-field border border-border bg-card">
              <DataTable label="Diferencias antes y después" paginate={false} columns={['Campo', 'Antes', 'Después']} scrollRegion>
                {diff.map((d) => (
                  <tr key={d.field}>
                    <td className="ebim-td font-mono text-caption">{d.field}</td>
                    <td className="ebim-td break-all font-mono text-caption text-muted line-through">
                      {d.before}
                    </td>
                    <td className="ebim-td break-all font-mono text-caption font-semibold">{d.after}</td>
                  </tr>
                ))}
              </DataTable>
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
