import { Fragment, useMemo, useState } from 'react';
import { USAGE_LIST_LIMIT, useUsageIngestRejections } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';
import { REJECTION_CODE } from './usageLabels';
import { useLookups } from './useLookups';

/**
 * Rechazos del ingest agrupados por código (bitácora append-only, sin contenido
 * del evento). `CONFLICT` es la alerta de integridad: mismo eventId con otro
 * contenido; se investiga el productor.
 */
export function RejectionsTab() {
  const rejections = useUsageIngestRejections();
  const lookups = useLookups();
  const [open, setOpen] = useState<string | null>(null);

  const { term, setTerm, filtered } = useSearchFilter(rejections.data, (r) => [
    r.code, REJECTION_CODE[r.code], r.meter_code, r.event_id, lookups.productName(r.saas_product_id), r.environment,
  ]);

  const groups = useMemo(() => {
    const map = new Map<string, { code: string; rows: typeof filtered; products: Set<string>; last: string }>();
    for (const r of filtered) {
      const g = map.get(r.code) ?? { code: r.code, rows: [], products: new Set<string>(), last: r.created_at };
      g.rows.push(r);
      g.products.add(lookups.productName(r.saas_product_id));
      if (r.created_at > g.last) g.last = r.created_at;
      map.set(r.code, g);
    }
    return Array.from(map.values()).sort((a, b) => b.rows.length - a.rows.length);
  }, [filtered, lookups]);
  const hasAny = (rejections.data ?? []).length > 0;

  return (
    <Card
      title="Rechazos del ingest"
      description={`Agrupados por código sobre los últimos ${USAGE_LIST_LIMIT} rechazos. Un evento rechazado no aborta su lote.`}
    >
      <SearchBar value={term} onChange={setTerm} placeholder="Buscar por código, producto, medidor o eventId…" />
      {rejections.isLoading ? (
        <LoadingState label="Cargando rechazos…" />
      ) : rejections.error ? (
        <ErrorState error={rejections.error} onRetry={() => void rejections.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState
          title={hasAny ? 'Ningún rechazo coincide' : 'Sin rechazos'}
          description={hasAny ? 'Prueba con otra búsqueda.' : 'El ingest no ha rechazado eventos (o sigue apagado hasta D-12).'}
        />
      ) : (
        <DataTable columns={['Código', 'Rechazos', 'Productos', 'Último', '']}>
          {groups.map((g) => (
            <Fragment key={g.code}>
              <tr>
                <td className="ebim-td">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold">{g.code}</span>
                    {g.code === 'CONFLICT' ? <Badge tone="danger">Integridad</Badge> : null}
                  </div>
                  <div className="text-[11px] text-muted">{REJECTION_CODE[g.code] ?? 'Código del ingest'}</div>
                </td>
                <td className="ebim-td text-sm font-semibold tabular-nums">{g.rows.length}</td>
                <td className="ebim-td text-xs">{Array.from(g.products).join(', ')}</td>
                <td className="ebim-td whitespace-nowrap text-xs text-muted">{formatDateTime(g.last)}</td>
                <td className="ebim-td text-right">
                  <button
                    type="button"
                    className="ebim-link text-[13px]"
                    aria-expanded={open === g.code}
                    onClick={() => setOpen(open === g.code ? null : g.code)}
                  >
                    {open === g.code ? 'Ocultar' : 'Ver detalle'}
                  </button>
                </td>
              </tr>
              {open === g.code ? (
                <tr>
                  <td colSpan={5} className="bg-[color:var(--bg)] px-4 py-2">
                    <ul className="space-y-1 text-xs" aria-label={`Rechazos ${g.code}`}>
                      {g.rows.slice(0, 50).map((r) => (
                        <li key={r.id} className="flex flex-wrap gap-x-3">
                          <span className="text-muted">{formatDateTime(r.created_at)}</span>
                          <span>{lookups.productName(r.saas_product_id)} · {r.environment}</span>
                          <span className="font-mono">{r.meter_code ?? '—'}</span>
                          <span className="font-mono text-muted">evento {r.event_id ?? '—'}</span>
                          {r.tenant_id ? <span>tenant {lookups.tenantName(r.tenant_id)}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </DataTable>
      )}
    </Card>
  );
}
