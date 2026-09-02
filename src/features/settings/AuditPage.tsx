import { useAuditLogs } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';

/**
 * Bitácora de auditoría.
 *
 * Append-only REAL: `authenticated` no tiene GRANT de UPDATE ni DELETE sobre
 * `audit_logs`, y no existe política que los permita. No es "append-only por
 * convención" — esa distinción es exactamente la lección `esupplier-030`.
 */
export function AuditPage() {
  const logs = useAuditLogs();
  const { term, setTerm, filtered } = useSearchFilter(logs.data, (l) => [
    l.action, l.actor_email, l.entity_type, l.entity_id,
  ]);

  return (
    <PageContainer
      title="Auditoría"
      description="Acciones administrativas sensibles. La bitácora no se puede editar ni borrar desde la aplicación: el enforcement está en los GRANT, no en una convención."
    >
      <Card>
        <SearchBar value={term} onChange={setTerm} placeholder="Buscar por acción, actor o entidad…" />
        {logs.isLoading ? (
          <LoadingState />
        ) : logs.error ? (
          <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState title="Sin eventos de auditoría" description="No hay eventos visibles para tu rol." />
        ) : (
          <DataTable columns={['Fecha', 'Actor', 'Acción', 'Entidad', 'Referencia', 'Metadata']}>
            {filtered.map((l) => (
              <tr key={String(l.id)}>
                <td className="ebim-td whitespace-nowrap text-xs text-muted">
                  {formatDateTime(l.occurred_at)}
                </td>
                <td className="ebim-td">{l.actor_email ?? 'Sistema'}</td>
                <td className="ebim-td">
                  <Badge tone="accent">{l.action}</Badge>
                </td>
                <td className="ebim-td text-muted">{l.entity_type}</td>
                <td className="ebim-td font-mono text-xs text-muted">
                  {l.entity_id ? `${String(l.entity_id).slice(0, 8)}…` : '—'}
                </td>
                <td className="ebim-td font-mono text-xs text-muted">
                  {Object.keys((l.metadata as Record<string, unknown>) ?? {}).length > 0
                    ? JSON.stringify(l.metadata)
                    : '—'}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
    </PageContainer>
  );
}
