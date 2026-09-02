import { useState } from 'react';
import { useProvisioningRequests } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  PageContainer, Card, DataTable, SearchBar, StatCard, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';
import { PROVISIONING_STATUS_LABEL } from '@/types/domain';

type QueueFilter = 'ALL' | 'OPEN' | 'FAILED' | 'DONE';

/**
 * Cola de provisioning.
 *
 * Todo corre en DRY_RUN: la Edge Function `provisioning-worker` simula la
 * operación y registra el timeline sin tocar ninguna API remota. Pasar a LIVE
 * exige un secreto de servidor que la UI nunca ve (prompt fase 8).
 */
export function ProvisioningPage() {
  const requests = useProvisioningRequests();
  const [filter, setFilter] = useState<QueueFilter>('ALL');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [retryTarget, setRetryTarget] = useState<string | null>(null);
  const { term, setTerm, filtered } = useSearchFilter(requests.data, (r) => [
    r.action, r.status, r.idempotency_key,
    (r.tenants as { name: string } | null)?.name,
    (r.deployment_targets as { code: string } | null)?.code,
  ]);

  const rows = filtered.filter((r) => {
    switch (filter) {
      case 'OPEN': return ['PENDING', 'VALIDATING', 'RUNNING'].includes(r.status as string);
      case 'FAILED': return r.status === 'FAILED';
      case 'DONE': return r.status === 'SUCCEEDED';
      default: return true;
    }
  });

  const all = requests.data ?? [];

  return (
    <PageContainer
      title="Provisioning"
      description="Solicitudes de aprovisionamiento con máquina de estados e idempotencia. Modo DRY_RUN por defecto: no se ejecuta ninguna llamada remota real."
      actions={<Badge tone="info">Modo por defecto: DRY_RUN</Badge>}
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label="Solicitudes" value={String(all.length)} />
        <StatCard label="En cola" value={String(all.filter((r) => ['PENDING', 'VALIDATING', 'RUNNING'].includes(r.status as string)).length)} tone="warn" />
        <StatCard label="Completadas" value={String(all.filter((r) => r.status === 'SUCCEEDED').length)} tone="ok" />
        <StatCard
          label="Fallidas"
          value={String(all.filter((r) => r.status === 'FAILED').length)}
          tone={all.some((r) => r.status === 'FAILED') ? 'danger' : 'ok'}
        />
      </div>

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar por acción, tenant, target o clave de idempotencia…"
          right={
            <StatusTabs
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'ALL', label: 'Todas', count: filtered.length },
                { id: 'OPEN', label: 'En cola' },
                { id: 'FAILED', label: 'Fallidas' },
                { id: 'DONE', label: 'Completadas' },
              ]}
            />
          }
        />
        {requests.isLoading ? (
          <LoadingState />
        ) : requests.error ? (
          <ErrorState error={requests.error} onRetry={() => void requests.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="Sin solicitudes de provisioning" />
        ) : (
          <DataTable columns={['Acción', 'Tenant', 'Target', 'Modo', 'Estado', 'Intentos', 'Creada', '']}>
            {rows.map((r) => (
              <>
                <tr key={r.id as string}>
                  <td className="ebim-td font-medium">{r.action as string}</td>
                  <td className="ebim-td">{(r.tenants as { name: string } | null)?.name ?? '—'}</td>
                  <td className="ebim-td font-mono text-xs text-muted">
                    {(r.deployment_targets as { code: string } | null)?.code ?? '—'}
                  </td>
                  <td className="ebim-td">
                    <Badge tone={r.mode === 'DRY_RUN' ? 'info' : 'warn'}>{r.mode as string}</Badge>
                  </td>
                  <td className="ebim-td">
                    <Badge tone={r.status === 'SUCCEEDED' ? 'ok' : r.status === 'FAILED' ? 'danger' : 'warn'}>
                      {PROVISIONING_STATUS_LABEL[r.status as keyof typeof PROVISIONING_STATUS_LABEL]}
                    </Badge>
                  </td>
                  <td className="ebim-td tabular-nums">
                    {r.attempts as number}/{r.max_attempts as number}
                  </td>
                  <td className="ebim-td text-xs text-muted">{formatDateTime(r.created_at as string)}</td>
                  <td className="ebim-td text-right">
                    <button
                      type="button"
                      className="ebim-link text-[13px]"
                      onClick={() => setExpanded(expanded === r.id ? null : (r.id as string))}
                    >
                      {expanded === r.id ? 'Ocultar' : 'Timeline'}
                    </button>
                    {r.status === 'FAILED' && (r.attempts as number) < (r.max_attempts as number) ? (
                      <button
                        type="button"
                        className="ebim-link ml-3 text-[13px]"
                        onClick={() => setRetryTarget(r.id as string)}
                      >
                        Reintentar
                      </button>
                    ) : null}
                  </td>
                </tr>
                {expanded === r.id ? (
                  <tr key={`${r.id}-detail`}>
                    <td colSpan={8} className="bg-[color:var(--bg)] px-4 py-3">
                      {r.error_message ? (
                        <p className="mb-2 rounded-field bg-danger-soft px-3 py-2 text-xs text-danger">
                          {r.error_message as string}
                        </p>
                      ) : null}
                      <ol className="space-y-1.5">
                        {((r.provisioning_events ?? []) as Array<Record<string, unknown>>)
                          .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)))
                          .map((e) => (
                            <li key={e.id as string} className="flex gap-3 text-xs">
                              <span className="w-40 shrink-0 text-muted">
                                {formatDateTime(e.occurred_at as string)}
                              </span>
                              <Badge tone="neutral">{e.status as string}</Badge>
                              <span className="text-fg">{e.message as string}</span>
                            </li>
                          ))}
                        {((r.provisioning_events ?? []) as unknown[]).length === 0 ? (
                          <li className="text-xs text-muted">Sin eventos registrados.</li>
                        ) : null}
                      </ol>
                    </td>
                  </tr>
                ) : null}
              </>
            ))}
          </DataTable>
        )}
      </Card>

      <ConfirmDialog
        open={retryTarget !== null}
        title="Reintentar solicitud de provisioning"
        message="Se volverá a encolar la solicitud en modo DRY_RUN. La clave de idempotencia evita duplicar el trabajo si la operación anterior sí llegó a completarse."
        confirmLabel="Reintentar"
        tone="primary"
        onCancel={() => setRetryTarget(null)}
        onConfirm={() => setRetryTarget(null)}
      />
    </PageContainer>
  );
}
