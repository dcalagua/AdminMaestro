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
import { ActionMenu } from '@/components/ui/ActionMenu';
import { Avatar } from '@/components/ui/Avatar';
import { FilterTotals } from './financeUi';
import { fromQuery } from '@/features/executive/dataState';
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
      title="Contratos y suscripciones"
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
          right={
            <StatusTabs
              value={filter}
              onChange={setFilter}
              options={FILTERS.map((f) => ({ ...f, count: subs.data ? countOf(f.id) : undefined }))}
            />
          }
        />
        {subs.data && rows.length > 0 ? (
          <FilterTotals
            state={fromQuery(subs, { isEmpty: () => false })}
            items={[
              {
                label: `Recurrente mensual · ${formatNumber(rows.length)} contratos`,
                amounts: listedMonthly,
                emptyLabel: 'Sin líneas recurrentes',
                hint: 'Suma de líneas del contrato normalizada a mes (trimestral ÷ 3, anual ÷ 12); los cargos únicos no cuentan',
              },
            ]}
            note="El MRR oficial del Resumen Ejecutivo además excluye descuentos, líneas fuera de vigencia, contratos no activos y tenants DEMO."
          />
        ) : null}
        {subs.isLoading ? (
          <LoadingState />
        ) : subs.error ? (
          <ErrorState error={subs.error} onRetry={() => void subs.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="Sin suscripciones" description="No hay contratos visibles para tu rol con estos filtros." />
        ) : (
          <DataTable
            columns={[
              'Contrato',
              'Facturado a',
              { label: 'Recurrente / mes', align: 'right' },
              { label: 'Cargos únicos', align: 'right' },
              'Estado',
              { label: 'Acciones', srOnly: true },
            ]}
          >
            {rows.map((s) => {
              const charges = splitCharges((s.subscription_items ?? []) as Array<Record<string, unknown>>);
              const org = (s.organizations as { display_name: string } | null)?.display_name ?? '—';
              const tenant = s.tenants as { name: string; deployment_mode: string } | null;
              return (
                <tr key={s.id}>
                  <td className="ebim-td">
                    <Link
                      className="ebim-link block max-w-[200px] truncate whitespace-nowrap font-mono text-compact font-semibold"
                      to={`/subscriptions/${s.id}`}
                      title={s.code}
                    >
                      {s.code}
                    </Link>
                    <div className="text-compact text-fg-2">
                      {(s.plans as { name: string } | null)?.name ?? (s.saas_products as { short_name: string } | null)?.short_name}
                    </div>
                  </td>
                  <td className="ebim-td">
                    <div className="flex items-center gap-3">
                      <Avatar name={org} />
                      <div className="min-w-0 max-w-[240px]">
                        <div className="truncate" title={org}>{org}</div>
                        <div className="truncate text-compact text-fg-2">
                          {s.tenant_id ? (
                            <>
                              {tenant?.name}
                              {tenant?.deployment_mode
                                ? ` · ${DEPLOYMENT_MODE_LABEL[tenant.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL]}`
                                : ''}
                            </>
                          ) : (
                            'Nivel partner (sin tenant)'
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="ebim-td ebim-num whitespace-nowrap">
                    {Object.keys(charges.monthly).length === 0 ? (
                      <span className="text-compact text-muted">Sin líneas recurrentes</span>
                    ) : (
                      <span className="font-semibold">
                        <CurrencyLines amounts={charges.monthly} />
                      </span>
                    )}
                    {/* Margen del canal: parte del recurrente que retiene el partner. */}
                    {s.channel_margin_rate !== null ? (
                      <span className="block text-caption text-muted">
                        Margen canal {formatPercent(Number(s.channel_margin_rate))}
                      </span>
                    ) : null}
                  </td>
                  <td className="ebim-td ebim-num whitespace-nowrap">
                    {charges.oneTimeCount === 0 ? (
                      <span className="text-compact text-muted">Ninguno</span>
                    ) : (
                      <span>
                        {Object.entries(charges.oneTime)
                          .map(([currency, amount]) => formatMoney(amount, currency))
                          .join(' · ')}
                        <span className="block text-compact text-muted">
                          {formatNumber(charges.oneTimeCount)} {charges.oneTimeCount === 1 ? 'cargo' : 'cargos'}
                        </span>
                      </span>
                    )}
                  </td>
                  <td className="ebim-td">
                    <Badge tone={SUBSCRIPTION_STATUS_TONE[s.status] ?? 'neutral'} dot>
                      {SUBSCRIPTION_STATUS_LABEL[s.status] ?? s.status}
                    </Badge>
                    <span className="mt-0.5 block whitespace-nowrap text-caption text-muted">desde {formatDate(s.started_on)}</span>
                  </td>
                  <td className="ebim-td w-12 text-right">
                    <ActionMenu
                      label={`Acciones de ${s.code}`}
                      items={[
                        { label: 'Abrir contrato', to: `/subscriptions/${s.id}` },
                        perms.canManageCommercial
                          ? { label: 'Añadir línea…', onSelect: () => setItemTarget({ id: s.id, code: s.code }) }
                          : null,
                        perms.canManageCommercial
                          ? { label: 'Cambiar estado…', onSelect: () => setStatusTarget({ id: s.id, code: s.code, status: s.status }) }
                          : null,
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>
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
