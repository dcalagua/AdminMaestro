import { useMemo, useState, type ReactNode } from 'react';
import { useSubscriptionCollection, useSubscriptions } from '@/services/queries';
import { useRenewalPipeline } from '@/services/financeRead';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer,
  Card,
  DataTable,
  SearchBar,
  LoadingState,
  ErrorState,
  EmptyState,
  Skeleton,
  type DataColumn,
  type DataTableSort,
} from '@/components/ui/primitives';
import { StatCell, StatStrip } from '@/components/ui/StatStrip';
import { CellTitle, MoneyCell, StatusCell, type CellTone } from '@/components/ui/cells';
import { nextSort } from '@/components/ui/tableSort';
import { InfoHint } from '@/components/ui/InfoHint';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { Avatar } from '@/components/ui/Avatar';
import { formatAmountsCompact, formatAmountsFull, formatCountNoun, formatDate, formatNumber, formatPercent } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';
import { SubscriptionFormDialog, SubscriptionStatusDialog, SubscriptionItemDialog } from './SubscriptionDialogs';
import { COLLECTION_METHOD_LABEL, SUBSCRIPTION_STATUS_LABEL, SUBSCRIPTION_STATUS_TONE } from './subscriptionLabels';
import {
  RENEWAL_SOON_DAYS,
  buildContractRows,
  contractSummary,
  matchesContract,
  sortContracts,
  type CollectionInfo,
  type ContractFilter,
  type ContractRow,
  type ContractSortKey,
  type RenewalInfo,
  type SubscriptionLike,
} from './contractListModel';

/**
 * Contratos (P07 · V6 · F3): la cartera contractual.
 *
 * El ESTADO que se muestra es el del contrato (`subscriptions.status`), nunca
 * el del tenant ni el de su mapping técnico: un tenant suspendido por
 * operación no convierte el contrato en cancelado, ni al revés.
 *
 * Una suscripción SIN tenant es la licencia base de un partner en
 * PARTNER_DEDICATED: es del partner, no de ninguno de sus clientes. Por eso la
 * columna «Tenant» puede decir «Nivel partner» y no es un dato faltante.
 *
 * V6: franja de cifras que filtra (activos, recurrente vivo por moneda, pago
 * atrasado, renuevan pronto, borradores) y una fila densa con plan, cliente,
 * app, tenant, recurrente, próxima renovación y método de cobro.
 */

const FILTERS: Array<{ id: ContractFilter; label: string }> = [
  { id: 'ALL', label: 'Todos' },
  { id: 'ACTIVE', label: 'Activos' },
  { id: 'PAST_DUE', label: 'Pago atrasado' },
  { id: 'DRAFT', label: 'Borrador' },
  { id: 'PAUSED', label: 'Pausados' },
  { id: 'CANCELLED', label: 'Cancelados' },
];

const STATUS_CELL_TONE: Record<string, CellTone> = { ok: 'ok', warn: 'warn', danger: 'danger', info: 'info', neutral: 'neutral' };

const COLUMNS: DataColumn[] = [
  { label: 'Contrato', sticky: true, sortKey: 'contract' },
  { label: 'Cliente · tenant', sortKey: 'customer' },
  { label: 'Recurrente / mes', align: 'right', sortKey: 'monthly' },
  { label: 'Renovación', sortKey: 'renewal' },
  { label: 'Cobro', mobile: false },
  { label: 'Estado' },
  { label: 'Acciones', srOnly: true },
];

export function SubscriptionsPage() {
  const subs = useSubscriptions();
  const renewals = useRenewalPipeline();
  const collection = useSubscriptionCollection();
  const perms = usePermissions();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<ContractFilter>('ALL');
  const [sort, setSort] = useState<DataTableSort>({ key: 'contract', dir: 'asc' });
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

  const all = useMemo(
    () =>
      buildContractRows(
        (filtered ?? []) as unknown as SubscriptionLike[],
        (renewals.data ?? []) as RenewalInfo[],
        (collection.data ?? []) as CollectionInfo[],
      ),
    [filtered, renewals.data, collection.data],
  );
  const summary = contractSummary(all);
  const rows = sortContracts(
    all.filter((r) => matchesContract(r, filter)),
    sort.key as ContractSortKey,
    sort.dir,
  );
  const tabs = filter === 'RENEWING' ? [...FILTERS, { id: 'RENEWING' as const, label: 'Renuevan pronto' }] : FILTERS;
  const countOf = (f: ContractFilter) => all.filter((r) => matchesContract(r, f)).length;
  const toggle = (f: ContractFilter) => setFilter((current) => (current === f ? 'ALL' : f));
  const universe = subs.data?.length ?? 0;

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
      {subs.data && universe > 0 ? (
        <StatStrip label="Resumen de contratos">
          <StatCell
            label="Activos"
            value={formatNumber(summary.active)}
            context={`de ${formatCountNoun(summary.total, 'contrato')}`}
            onSelect={() => toggle('ACTIVE')}
            selected={filter === 'ACTIVE'}
          />
          <StatCell
            label="Recurrente vigente"
            amounts={summary.liveMonthly}
            emptyLabel="Sin recurrente"
            info="Suma de líneas de los contratos activos y con pago atrasado, normalizada a mes (trimestral ÷ 3, anual ÷ 12), por moneda. Los cargos únicos no cuentan. El MRR oficial del Resumen además excluye descuentos, líneas fuera de vigencia y tenants DEMO."
            context="Al mes, por moneda"
          />
          <StatCell
            label="Pago atrasado"
            value={formatNumber(summary.pastDue)}
            tone={summary.pastDue > 0 ? 'warn' : 'neutral'}
            context={summary.pastDue > 0 ? 'Con una factura vencida' : 'Ninguno'}
            onSelect={() => toggle('PAST_DUE')}
            selected={filter === 'PAST_DUE'}
          />
          <StatCell
            label={`Renuevan en ${RENEWAL_SOON_DAYS} días`}
            value={formatNumber(summary.renewing)}
            loading={renewals.isLoading}
            error={renewals.error}
            onRetry={() => void renewals.refetch()}
            context="Activos o con pago atrasado"
            onSelect={() => toggle('RENEWING')}
            selected={filter === 'RENEWING'}
          />
          <StatCell
            label="Borradores"
            value={formatNumber(summary.drafts)}
            context={summary.drafts > 0 ? 'Aún no facturan' : 'Ninguno'}
            onSelect={() => toggle('DRAFT')}
            selected={filter === 'DRAFT'}
          />
        </StatStrip>
      ) : null}

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          total={universe}
          placeholder="Buscar por código, cliente, tenant o plan…"
          right={
            <StatusTabs
              label="Estado del contrato"
              value={filter}
              onChange={setFilter}
              options={tabs.map((f) => ({ ...f, count: subs.data ? countOf(f.id) : undefined }))}
            />
          }
        />
        {rows.length > 0 ? (
          <p className="flex flex-wrap items-center gap-x-2 border-b border-border px-5 py-2 text-caption text-muted" data-filter-total>
            <span>{formatCountNoun(rows.length, 'contrato')}</span>
            {Object.keys(sumMonthly(rows)).length > 0 ? (
              <>
                <span>· recurrente al mes:</span>
                <span className="font-semibold text-fg-2" title={formatAmountsFull(sumMonthly(rows))}>
                  {formatAmountsCompact(sumMonthly(rows))}
                </span>
              </>
            ) : null}
            <InfoHint label="Recurrente frente al MRR oficial" title="Recurrente y MRR oficial">
              Suma de líneas del contrato normalizada a mes (trimestral ÷ 3, anual ÷ 12); los cargos únicos no cuentan.
              El MRR oficial del Resumen Ejecutivo además excluye descuentos, líneas fuera de vigencia, contratos no
              activos y tenants DEMO.
            </InfoHint>
          </p>
        ) : null}
        {subs.isLoading ? (
          <LoadingState label="Cargando contratos…" />
        ) : subs.error ? (
          <ErrorState error={subs.error} onRetry={() => void subs.refetch()} />
        ) : universe === 0 ? (
          <EmptyState
            title="Sin contratos"
            description="No hay contratos visibles para tu rol."
            action={
              perms.canManageCommercial ? (
                <button type="button" className="ebim-btn-primary" onClick={() => setCreating(true)}>
                  Nueva suscripción
                </button>
              ) : undefined
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            variant="no-results"
            title={term ? `Ningún resultado para «${term}»` : 'Ningún contrato con este filtro'}
            description="Prueba con otra búsqueda o cambia de pestaña."
            onClear={() => {
              setTerm('');
              setFilter('ALL');
            }}
          />
        ) : (
          <DataTable
            label="Contratos"
            minWidth={1000}
            sort={sort}
            onSort={(key) => setSort((s) => nextSort(s, key))}
            columns={COLUMNS}
          >
            {/* Filas como `<tr>` directos (función, no componente): así la tabla pasa a
                tarjetas en móvil (V6 · F5). */}
            {rows.map((r) =>
              contractTableRow({
                row: r,
                renewalsLoading: renewals.isLoading,
                collectionLoading: collection.isLoading,
                actions: (
                  <ActionMenu
                    label={`Acciones de ${r.code}`}
                    items={[
                      { label: 'Abrir contrato', to: `/subscriptions/${r.id}` },
                      r.customerId ? { label: 'Abrir la cuenta', to: `/organizations/${r.customerId}` } : null,
                      perms.canManageCommercial
                        ? { label: 'Añadir línea…', onSelect: () => setItemTarget({ id: r.id, code: r.code }) }
                        : null,
                      perms.canManageCommercial
                        ? {
                            label: 'Cambiar estado…',
                            onSelect: () => setStatusTarget({ id: r.id, code: r.code, status: r.status }),
                          }
                        : null,
                    ]}
                  />
                ),
              }),
            )}
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

function sumMonthly(rows: readonly ContractRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    for (const [currency, amount] of Object.entries(r.monthly)) {
      out[currency] = Math.round(((out[currency] ?? 0) + amount) * 100) / 100;
    }
  }
  return out;
}

/** Una fila de contrato (`<tr>` con `key`). Sin hooks: se llama como función. */
function contractTableRow({
  row: r,
  renewalsLoading,
  collectionLoading,
  actions,
}: {
  row: ContractRow;
  renewalsLoading: boolean;
  collectionLoading: boolean;
  actions: ReactNode;
}) {
  const live = r.status === 'ACTIVE' || r.status === 'PAST_DUE';
  const oneTime = Object.keys(r.oneTime).length > 0;
  return (
    <tr key={r.id} data-contract={r.code}>
      <td className="ebim-td py-2">
        <div className="max-w-[260px]">
          <CellTitle
            title={r.plan}
            to={`/subscriptions/${r.id}`}
            tooltip={`${r.plan} · ${r.code}`}
            secondary={[r.code, r.app]}
            monoParts={[0]}
          />
        </div>
      </td>
      <td className="ebim-td py-2">
        <div className="max-w-[300px]">
          <CellTitle
            title={r.customer}
            to={r.customerId ? `/organizations/${r.customerId}` : undefined}
            leading={<Avatar name={r.customer} size="sm" />}
            secondary={[
              r.tenant ?? 'Nivel partner (sin tenant)',
              r.deploymentMode
                ? (DEPLOYMENT_MODE_LABEL[r.deploymentMode as keyof typeof DEPLOYMENT_MODE_LABEL] ?? r.deploymentMode)
                : null,
              r.channelMargin !== null ? `margen del canal ${formatPercent(r.channelMargin)}` : null,
            ]}
          />
        </div>
      </td>
      <td className="ebim-td ebim-num">
        <MoneyCell
          amounts={r.monthly}
          tone={live ? 'default' : 'muted'}
          empty="Sin recurrente"
          context={
            oneTime ? (
              <span title={`Cargos únicos: ${formatAmountsFull(r.oneTime)}`}>
                + {formatAmountsCompact(r.oneTime)} único{r.oneTimeCount === 1 ? '' : 's'}
              </span>
            ) : undefined
          }
        />
      </td>
      <td className="ebim-td whitespace-nowrap">
        {renewalsLoading ? (
          <Skeleton className="h-4 w-20" />
        ) : r.renewalOn && r.status !== 'CANCELLED' ? (
          <span className="block">
            <span className="block text-compact text-fg-2">{formatDate(r.renewalOn)}</span>
            {r.daysToRenewal !== null ? (
              <span
                className={`block text-caption ${
                  live && r.daysToRenewal >= 0 && r.daysToRenewal <= RENEWAL_SOON_DAYS ? 'font-semibold text-warn' : 'text-muted'
                }`}
              >
                {renewalText(r.daysToRenewal)}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-compact text-muted">—</span>
        )}
      </td>
      <td className="ebim-td text-compact">
        {collectionLoading ? (
          <Skeleton className="h-4 w-20" />
        ) : r.methodMissing ? (
          <span className="whitespace-nowrap text-muted" title="Sin perfil de cobro: se cobra de forma manual">
            Sin perfil
          </span>
        ) : (
          <span className="whitespace-nowrap text-fg-2">{COLLECTION_METHOD_LABEL[r.method ?? ''] ?? r.method}</span>
        )}
      </td>
      <td className="ebim-td">
        <StatusCell
          label={SUBSCRIPTION_STATUS_LABEL[r.status] ?? r.status}
          tone={STATUS_CELL_TONE[SUBSCRIPTION_STATUS_TONE[r.status] ?? 'neutral']}
          detail={r.startedOn ? `desde ${formatDate(r.startedOn)}` : undefined}
        />
      </td>
      <td className="ebim-td w-12 text-right">{actions}</td>
    </tr>
  );
}

/** «en 8 días», «hoy», «hace 3 días». */
function renewalText(days: number): string {
  if (days === 0) return 'hoy';
  if (days > 0) return `en ${formatCountNoun(days, 'día')}`;
  return `hace ${formatCountNoun(-days, 'día')}`;
}
