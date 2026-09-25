import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSubscriptions } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { formatMoney, formatPercent, formatDate, formatNumber } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';
import { CurrencyLines } from '@/features/executive/components/StateView';
import {
  SubscriptionFormDialog, SubscriptionStatusDialog, SubscriptionItemDialog,
} from './SubscriptionDialogs';
import { SUBSCRIPTION_STATUS_LABEL, SUBSCRIPTION_STATUS_TONE, splitCharges } from './subscriptionLabels';

/**
 * Suscripciones (P07): la cartera contractual.
 *
 * El ESTADO que se muestra es el del contrato (`subscriptions.status`), nunca
 * el del tenant ni el de su mapping técnico: un tenant suspendido por
 * operación no convierte el contrato en cancelado, ni al revés.
 *
 * Una suscripción SIN tenant es la licencia base de un partner en
 * PARTNER_DEDICATED: es del partner, no de ninguno de sus clientes. Por eso la
 * columna "Tenant" puede decir "Nivel partner" y no es un dato faltante.
 */

type Filter = 'ALL' | 'ACTIVE' | 'PAST_DUE' | 'DRAFT' | 'PAUSED' | 'CANCELLED';
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'ALL', label: 'Todas' },
  { id: 'ACTIVE', label: 'Activas' },
  { id: 'PAST_DUE', label: 'Pago atrasado' },
  { id: 'DRAFT', label: 'Borrador' },
  { id: 'PAUSED', label: 'Pausadas' },
  { id: 'CANCELLED', label: 'Canceladas' },
];

export function SubscriptionsPage() {
  const subs = useSubscriptions();
  const perms = usePermissions();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [statusTarget, setStatusTarget] = useState<{ id: string; code: string; status: string } | null>(null);
  const [itemTarget, setItemTarget] = useState<{ id: string; code: string } | null>(null);

  const { term, setTerm, filtered } = useSearchFilter(subs.data, (s) => [
    s.code,
    (s.organizations as { display_name: string } | null)?.display_name,
    (s.tenants as { name: string } | null)?.name,
    (s.saas_products as { short_name: string } | null)?.short_name,
    (s.plans as { name: string } | null)?.name,
    s.status,
    SUBSCRIPTION_STATUS_LABEL[s.status],
  ]);
  const rows = filtered.filter((s) => filter === 'ALL' || s.status === filter);
  const countOf = (f: Filter) => (f === 'ALL' ? filtered.length : filtered.filter((s) => s.status === f).length);

  const listedMonthly = rows.reduce<Record<string, number>>((acc, s) => {
    const { monthly } = splitCharges((s.subscription_items ?? []) as Array<Record<string, unknown>>);
    for (const [currency, amount] of Object.entries(monthly)) {
      acc[currency] = Math.round(((acc[currency] ?? 0) + amount) * 100) / 100;
    }
    return acc;
  }, {});

  return (
    <PageContainer
      title="Suscripciones"
      description="La cartera contractual: licencias por tenant, licencias base de partner y fees de infraestructura dedicada. El estado es el del contrato, no el técnico."
      actions={
        perms.canManageCommercial ? (
          <button type="button" className="ebim-btn-primary" onClick={() => setCreating(true)}>
            Nueva suscripción
          </button>
        ) : null
      }
    >
      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar por código, organización, tenant o plan…"
        />
        <div className="border-b border-border px-4 py-2">
          <StatusTabs
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((f) => ({ ...f, count: subs.data ? countOf(f.id) : undefined }))}
          />
        </div>
        {subs.isLoading ? (
          <LoadingState />
        ) : subs.error ? (
          <ErrorState error={subs.error} onRetry={() => void subs.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="Sin suscripciones" description="No hay contratos visibles para tu rol con estos filtros." />
        ) : (
          <DataTable
            columns={[
              'Código', 'Facturado a', 'Producto', 'Tenant', 'Plan', 'Recurrente (mensual)', 'Cargos únicos',
              'Despliegue', 'Margen canal', 'Inicio', 'Estado del contrato', 'Acciones',
            ]}
          >
            {rows.map((s) => {
              const charges = splitCharges((s.subscription_items ?? []) as Array<Record<string, unknown>>);
              return (
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
                  <td className="ebim-td text-right tabular-nums">
                    {Object.keys(charges.monthly).length === 0 ? (
                      <span className="text-xs text-muted">Sin líneas recurrentes</span>
                    ) : (
                      <span className="text-sm font-semibold">
                        <CurrencyLines amounts={charges.monthly} />
                      </span>
                    )}
                  </td>
                  <td className="ebim-td text-right tabular-nums">
                    {charges.oneTimeCount === 0 ? (
                      <span className="text-xs text-muted">Ninguno</span>
                    ) : (
                      <span className="text-xs">
                        {Object.entries(charges.oneTime)
                          .map(([currency, amount]) => formatMoney(amount, currency))
                          .join(' · ')}
                        <span className="block text-muted">{formatNumber(charges.oneTimeCount)} cargo(s) único(s)</span>
                      </span>
                    )}
                  </td>
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
                  <td className="ebim-td whitespace-nowrap text-xs text-muted">{formatDate(s.started_on)}</td>
                  <td className="ebim-td">
                    <Badge tone={SUBSCRIPTION_STATUS_TONE[s.status] ?? 'neutral'}>
                      {SUBSCRIPTION_STATUS_LABEL[s.status] ?? s.status}
                    </Badge>
                  </td>
                  <td className="ebim-td">
                    {perms.canManageCommercial ? (
                      <div className="flex items-center justify-end gap-3">
                        <button
                          type="button"
                          className="ebim-link whitespace-nowrap text-[13px]"
                          onClick={() => setItemTarget({ id: s.id, code: s.code })}
                        >
                          Añadir línea
                        </button>
                        <button
                          type="button"
                          className="ebim-link whitespace-nowrap text-[13px]"
                          onClick={() => setStatusTarget({ id: s.id, code: s.code, status: s.status })}
                        >
                          Estado
                        </button>
                      </div>
                    ) : (
                      <Link className="ebim-link text-[13px]" to={`/subscriptions/${s.id}`}>
                        Ver
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>
      {rows.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-start gap-2 px-1 text-xs text-muted">
          <span>Recurrente mensual de las {formatNumber(rows.length)} suscripciones listadas, por moneda:</span>
          <span className="font-semibold text-fg">
            <CurrencyLines amounts={listedMonthly} emptyLabel="Sin líneas recurrentes" />
          </span>
          <span className="basis-full">
            Suma de líneas del contrato normalizada a mes (trimestral ÷ 3, anual ÷ 12). Los cargos únicos no cuentan. El MRR
            oficial del inicio además excluye descuentos, líneas fuera de vigencia, contratos no activos y tenants DEMO.
          </span>
        </div>
      ) : null}

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
