import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSubscriptions } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatMoney, formatDate, formatPercent } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';
import {
  SubscriptionFormDialog, SubscriptionStatusDialog, SubscriptionItemDialog,
} from './SubscriptionDialogs';

/**
 * Suscripciones.
 *
 * Una suscripción SIN tenant es la licencia base de un partner en
 * PARTNER_DEDICATED: es del partner, no de ninguno de sus clientes. Por eso la
 * columna "Tenant" puede decir "Nivel partner" y no es un dato faltante.
 */
export function SubscriptionsPage() {
  const subs = useSubscriptions();
  const perms = usePermissions();
  const [creating, setCreating] = useState(false);
  const [statusTarget, setStatusTarget] = useState<{ id: string; code: string; status: string } | null>(null);
  const [itemTarget, setItemTarget] = useState<{ id: string; code: string } | null>(null);

  const { term, setTerm, filtered } = useSearchFilter(subs.data, (s) => [
    s.code,
    (s.organizations as { display_name: string } | null)?.display_name,
    (s.tenants as { name: string } | null)?.name,
    (s.saas_products as { short_name: string } | null)?.short_name,
    (s.plans as { name: string } | null)?.name,
    s.status,
  ]);

  return (
    <PageContainer
      title="Suscripciones"
      description="El contrato recurrente vivo. Incluye licencias por tenant, licencias base de partner y fees de infraestructura dedicada."
      actions={
        perms.canManageCommercial ? (
          <button type="button" className="ebim-btn-primary" onClick={() => setCreating(true)}>
            Nueva suscripción
          </button>
        ) : null
      }
    >
      <Card>
        <SearchBar value={term} onChange={setTerm} placeholder="Buscar por código, organización, tenant o plan…" />
        {subs.isLoading ? (
          <LoadingState />
        ) : subs.error ? (
          <ErrorState error={subs.error} onRetry={() => void subs.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState title="Sin suscripciones" />
        ) : (
          <DataTable columns={['Código', 'Facturado a', 'Producto', 'Tenant', 'Plan', 'Modelo', 'Margen canal', 'Inicio', 'Estado', '']}>
            {filtered.map((s) => (
              <tr key={s.id}>
                <td className="ebim-td">
                  <Link className="ebim-link font-mono text-xs font-semibold" to={`/subscriptions/${s.id}`}>
                    {s.code}
                  </Link>
                </td>
                <td className="ebim-td">{(s.organizations as { display_name: string } | null)?.display_name}</td>
                <td className="ebim-td">{(s.saas_products as { short_name: string } | null)?.short_name}</td>
                <td className="ebim-td">
                  {s.tenant_id ? (
                    (s.tenants as { name: string } | null)?.name
                  ) : (
                    <Badge tone="accent">Nivel partner</Badge>
                  )}
                </td>
                <td className="ebim-td text-muted">{(s.plans as { name: string } | null)?.name}</td>
                <td className="ebim-td">
                  {s.tenants ? (
                    <Badge tone="info">
                      {DEPLOYMENT_MODE_LABEL[
                        (s.tenants as { deployment_mode: string }).deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL
                      ]}
                    </Badge>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="ebim-td tabular-nums">
                  {s.channel_margin_rate !== null ? formatPercent(Number(s.channel_margin_rate)) : '—'}
                </td>
                <td className="ebim-td text-xs text-muted">{formatDate(s.started_on)}</td>
                <td className="ebim-td">
                  <Badge tone={s.status === 'ACTIVE' ? 'ok' : s.status === 'CANCELLED' ? 'danger' : 'warn'}>
                    {s.status}
                  </Badge>
                </td>
                <td className="ebim-td">
                  {perms.canManageCommercial ? (
                    <div className="flex items-center justify-end gap-3">
                      <button
                        type="button"
                        className="ebim-link text-[13px]"
                        onClick={() => setItemTarget({ id: s.id, code: s.code })}
                      >
                        Añadir línea
                      </button>
                      <button
                        type="button"
                        className="ebim-link text-[13px]"
                        onClick={() => setStatusTarget({ id: s.id, code: s.code, status: s.status })}
                      >
                        Estado
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
      <p className="mt-3 px-1 text-xs text-muted">
        Total de líneas recurrentes:{' '}
        {formatMoney(
          (filtered ?? []).reduce(
            (sum, s) =>
              sum +
              ((s.subscription_items ?? []) as Array<Record<string, unknown>>)
                .filter((i) => i.billing_interval === 'MONTHLY')
                .reduce((a, i) => a + Number(i.amount), 0),
            0,
          ),
        )}{' '}
        mensuales entre las suscripciones listadas.
      </p>

      <SubscriptionFormDialog open={creating} onClose={() => setCreating(false)} />

      <SubscriptionStatusDialog
        open={Boolean(statusTarget)}
        subscriptionId={statusTarget?.id ?? null}
        subscriptionCode={statusTarget?.code ?? ''}
        currentStatus={statusTarget?.status ?? 'DRAFT'}
        onClose={() => setStatusTarget(null)}
      />

      <SubscriptionItemDialog
        open={Boolean(itemTarget)}
        subscriptionId={itemTarget?.id ?? null}
        subscriptionCode={itemTarget?.code ?? ''}
        onClose={() => setItemTarget(null)}
      />
    </PageContainer>
  );
}
