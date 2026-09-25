import { useEffect, useRef, useState } from 'react';
import { useListState } from '@/hooks/useListState';
import { PageContainer, Card, SearchBar, Badge, EmptyState } from '@/components/ui/primitives';
import { PagedTable, type TableColumn } from '@/components/ui/PagedTable';
import { ExportMenu } from '@/components/ui/ExportMenu';
import type { ExportColumn } from '@/lib/export';
import { formatDateTime } from '@/lib/format';
import { fetchAuditPage, useAuditPage, type AuditFilter, type AuditRow, type AuditSort } from './auditQueries';
import { changedFieldsOf, correlationOf, diffOf, metadataOf, metadataSummary, redact } from './auditFormat';

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
  const [selected, setSelected] = useState<AuditRow | null>(null);
  const detailRef = useRef<HTMLHeadingElement>(null);

  // Búsqueda con pequeña espera: una consulta por término, no por tecla.
  useEffect(() => {
    if (draft === list.search) return;
    const t = window.setTimeout(() => list.setSearch(draft), 300);
    return () => window.clearTimeout(t);
  }, [draft, list]);

  const params = {
    search: list.search,
    page: list.page,
    pageSize: list.pageSize,
    sortBy: list.sortBy,
    sortDir: list.sortDir,
  };
  const page = useAuditPage(params);
  const rows = page.data?.rows ?? [];
  const total = page.data?.total ?? 0;

  function openDetail(row: AuditRow) {
    setSelected(row);
    window.setTimeout(() => detailRef.current?.focus(), 0);
  }

  const columns: TableColumn<AuditRow>[] = [
    {
      id: 'occurred_at',
      header: 'Fecha',
      sortKey: 'occurred_at',
      className: 'whitespace-nowrap text-xs text-muted',
      cell: (r) => <time dateTime={r.occurred_at}>{formatDateTime(r.occurred_at)}</time>,
    },
    {
      id: 'actor',
      header: 'Actor',
      cell: (r) => <span className="break-all">{r.actor_email ?? 'Sistema'}</span>,
    },
    {
      id: 'action',
      header: 'Acción',
      sortKey: 'action',
      cell: (r) => <Badge tone="accent">{r.action}</Badge>,
    },
    {
      id: 'entity',
      header: 'Entidad',
      sortKey: 'entity_type',
      cell: (r) => (
        <span>
          <span className="text-fg">{r.entity_type}</span>
          {r.entity_id ? (
            <span className="block font-mono text-xs text-muted" title={r.entity_id}>
              {r.entity_id.length > 12 ? `${r.entity_id.slice(0, 8)}…` : r.entity_id}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'correlation',
      header: 'Correlación',
      cell: (r) => {
        const c = correlationOf(r.metadata);
        return c ? (
          <span className="font-mono text-xs text-muted" title={c}>
            {c.length > 12 ? `${c.slice(0, 8)}…` : c}
          </span>
        ) : (
          <span className="text-xs text-muted">—</span>
        );
      },
    },
    {
      id: 'detail',
      header: 'Detalle',
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xs text-muted">{metadataSummary(r.metadata)}</span>
          <button
            type="button"
            className="ebim-link text-[13px]"
            aria-controls="audit-detail"
            aria-expanded={selected?.id === r.id}
            onClick={() => (selected?.id === r.id ? setSelected(null) : openDetail(r))}
          >
            {selected?.id === r.id ? 'Ocultar' : 'Ver detalle'}
          </button>
        </span>
      ),
    },
  ];

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
            <ExportMenu
              filenameBase="auditoria"
              columns={EXPORT_COLUMNS}
              pageRows={rows}
              total={total}
              fetchPage={(p, size) => fetchAuditPage({ ...params, page: p, pageSize: size })}
              rowKey={(r) => String(r.id)}
            />
          }
        />
        <PagedTable
          label="Eventos de auditoría"
          columns={columns}
          rows={rows}
          rowKey={(r) => String(r.id)}
          sortBy={list.sortBy}
          sortDir={list.sortDir}
          onSortChange={list.setSort}
          page={list.page}
          pageSize={list.pageSize}
          total={total}
          onPageChange={list.setPage}
          onPageSizeChange={list.setPageSize}
          loading={page.isLoading}
          fetching={page.isFetching}
          error={page.error}
          onRetry={() => void page.refetch()}
          emptyTitle="Sin eventos de auditoría"
          emptyDescription={
            list.search ? 'Ningún evento coincide con la búsqueda.' : 'No hay eventos visibles para tu rol.'
          }
          rowClassName={(r) => (selected?.id === r.id ? 'bg-accent-soft' : undefined)}
        />
      </Card>

      <div id="audit-detail" aria-live="polite" className="mt-4">
        {selected ? (
          <AuditDetail row={selected} headingRef={detailRef} onClose={() => setSelected(null)} />
        ) : null}
      </div>
    </PageContainer>
  );
}

export function AuditDetail({
  row,
  headingRef,
  onClose,
}: {
  row: AuditRow;
  headingRef?: React.Ref<HTMLHeadingElement>;
  onClose?: () => void;
}) {
  const diff = diffOf(row.metadata);
  const metadata = metadataOf(row.metadata);
  const hasMetadata = Object.keys(metadata).length > 0;
  const correlation = correlationOf(row.metadata);

  return (
    <section className="ebim-card" aria-labelledby="audit-detail-title">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 id="audit-detail-title" ref={headingRef} tabIndex={-1} className="text-sm font-bold text-fg">
            Detalle del evento
          </h2>
          <p className="mt-0.5 break-all text-xs text-muted">
            {row.action} · {row.entity_type}
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

      <div className="space-y-4 p-4">
        {diff ? (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Cambios (antes → después)</p>
            {diff.length === 0 ? (
              <p className="text-sm text-muted">Sin diferencias entre los dos estados registrados.</p>
            ) : (
              <div className="overflow-x-auto" role="region" aria-label="Diferencias" tabIndex={0}>
                <table className="w-full border-collapse" aria-label="Diferencias antes y después">
                  <thead className="border-b border-border bg-[color:var(--bg)]">
                    <tr>
                      <th scope="col" className="ebim-th">Campo</th>
                      <th scope="col" className="ebim-th">Antes</th>
                      <th scope="col" className="ebim-th">Después</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {diff.map((d) => (
                      <tr key={d.field}>
                        <td className="ebim-td font-mono text-xs">{d.field}</td>
                        <td className="ebim-td break-all font-mono text-xs text-muted">{d.before}</td>
                        <td className="ebim-td break-all font-mono text-xs">{d.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted" data-testid="audit-no-diff">
            Este evento no registra un estado anterior y uno posterior: se muestra sólo la metadata
            disponible, sin reconstruir un «antes».
          </p>
        )}

        {hasMetadata ? (
          <details className="rounded-field border border-border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-fg">
              Metadata técnica (JSON)
            </summary>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all border-t border-border p-3 font-mono text-xs text-muted">
              {JSON.stringify(redact(metadata), null, 2)}
            </pre>
          </details>
        ) : (
          <EmptyState title="Sin metadata" description="El evento no guarda contexto adicional." />
        )}
      </div>
    </section>
  );
}
