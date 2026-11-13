import { useMemo, useState, type ReactNode } from 'react';
import { DownloadSimpleIcon } from '@phosphor-icons/react';
import {
  useAttributions,
  useOrganizations,
  useSaasProvisioningRequests,
  useTenantOverview,
} from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { useNavAccess } from '@/app/useNavAccess';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { SelectInput } from '@/components/ui/fields';
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  PageContainer,
  SearchBar,
  Skeleton,
  type DataColumn,
  type DataTableSort,
} from '@/components/ui/primitives';
import { StatCell, StatStrip } from '@/components/ui/StatStrip';
import { nextSort } from '@/components/ui/tableSort';
import { AppChips, CellTitle, MoneyCell, StatusCell } from '@/components/ui/cells';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { Avatar } from '@/components/ui/Avatar';
import { entityStatusLabel, entityStatusTone } from '@/features/catalog/catalogLabels';
import type { ProvisioningRow, TenantRow } from '@/features/suite/suiteModel';
import { downloadCsv, exportFilename, toCsv, type ExportColumn } from '@/lib/export';
import { countryName, formatAmountsFull, formatCountNoun, formatNumber } from '@/lib/format';
import type { Enums } from '@/types/domain';
import { HEALTH_TEXT } from './accountSeriesModel';
import {
  ACCOUNT_FILTER_LABEL,
  accountSummary,
  appStatus,
  buildAccountRows,
  channelLabel,
  matchesAccountFilter,
  sortAccounts,
  type AccountFilter,
  type AccountRow,
  type AccountSortKey,
  type AttributionRow,
  type OrganizationLike,
} from './accountListModel';
import { useAccountOverdueInvoices, useAccountRenewalFlags } from './accountListQueries';
import { OrganizationFormDialog, type OrganizationDraft } from './OrganizationFormDialog';

const CAPABILITY_LABEL: Record<string, string> = {
  PARTNER: 'Partner',
  RESELLER: 'Reseller',
  CONSULTING: 'Consultora',
  CUSTOMER: 'Cliente',
};
const CHANNEL_CAPABILITIES = ['PARTNER', 'RESELLER', 'CONSULTING'];

type Scope = 'customers' | 'all';
type CapabilityTab = 'ALL' | 'PARTNER' | 'CUSTOMER';

function isCustomer(caps: string[]) {
  return caps.includes('CUSTOMER');
}
function isChannel(caps: string[]) {
  return caps.some((c) => CHANNEL_CAPABILITIES.includes(c));
}

/**
 * Cuentas › Clientes y Cuentas › Todas las organizaciones (V6 · F1, plan §3.2).
 *
 * Vista gerencial: arriba la franja de cifras de negocio (cada una filtra la
 * tabla) y una tabla densa con lo que responde «¿cómo va esta cuenta?» —apps y
 * su estado, MRR, saldo vencido, salud de cobranza, canal y responsable— en vez
 * de columnas de identificación. País y RUC pasan a la segunda línea.
 *
 * Lo financiero (MRR, vencido, cobranza) solo se pide y se muestra con vista
 * financiera (`useNavAccess().finance`); RLS sigue siendo la autoridad sobre las
 * filas. Ser responsable comercial de una cuenta no da acceso operativo a ella.
 */
export function AccountsPage({
  scope,
  title,
  description,
}: {
  scope: Scope;
  title: string;
  description: string;
}) {
  const access = useNavAccess();
  const finance = access.finance;
  const perms = usePermissions();
  const orgs = useOrganizations();
  const tenants = useTenantOverview();
  const saas = useSaasProvisioningRequests();
  const attributions = useAttributions();
  const invoices = useAccountOverdueInvoices({ enabled: finance });
  const renewals = useAccountRenewalFlags({ enabled: finance });

  const [filter, setFilter] = useState<AccountFilter>('ALL');
  const [capability, setCapability] = useState<CapabilityTab>('ALL');
  const [sort, setSort] = useState<DataTableSort>({ key: 'name', dir: 'asc' });
  const [dialog, setDialog] = useState<{ open: boolean; org: OrganizationDraft | null }>({
    open: false,
    org: null,
  });

  const { term, setTerm, filtered } = useSearchFilter(orgs.data, (o) => [
    o.display_name,
    o.legal_name,
    o.slug,
    o.tax_id,
    o.country_code,
  ]);

  const byId = useMemo(() => new Map((orgs.data ?? []).map((o) => [o.id, o])), [orgs.data]);

  const allRows = useMemo(
    () =>
      buildAccountRows({
        organizations: (filtered ?? []) as OrganizationLike[],
        tenants: (tenants.data ?? []) as TenantRow[],
        requests: (saas.data ?? []) as ProvisioningRow[],
        overdueInvoices: finance ? (invoices.data ?? []) : undefined,
        renewals: finance && renewals.data ? renewals.data : undefined,
        attributions: (attributions.data ?? []) as unknown as AttributionRow[],
      }),
    [filtered, tenants.data, saas.data, invoices.data, renewals.data, attributions.data, finance],
  );

  // Alcance de la pestaña del hub: Clientes = capacidad cliente; Todas = cualquiera (con su pestaña de capacidad).
  const scoped = allRows.filter((r) =>
    scope === 'customers'
      ? isCustomer(r.capabilities)
      : capability === 'ALL' ||
        (capability === 'PARTNER' ? isChannel(r.capabilities) : isCustomer(r.capabilities)),
  );
  const summary = accountSummary(scoped);
  const rows = sortAccounts(
    scoped.filter((r) => matchesAccountFilter(r, filter)),
    sort.key as AccountSortKey,
    sort.dir,
  );
  const universe = (orgs.data ?? []).filter((o) =>
    scope === 'customers' ? isCustomer(capsOf(o)) : true,
  ).length;

  const noun = scope === 'customers' ? 'clientes' : 'organizaciones';
  const baseTabs: AccountFilter[] = finance
    ? ['ALL', 'DEBT', 'SUSPENSION', 'NO_ACTIVE_APPS', 'INACTIVE']
    : ['ALL', 'APPS_PENDING', 'NO_ACTIVE_APPS', 'INACTIVE'];
  // Un filtro elegido desde la franja («Activas», «Apps sin alta») se ve también como pestaña.
  const tabs = baseTabs.includes(filter) ? baseTabs : [...baseTabs, filter];
  const toggle = (f: AccountFilter) => setFilter((current) => (current === f ? 'ALL' : f));
  const defaultCapability: Enums<'org_capability'> | undefined =
    scope === 'customers' ? 'CUSTOMER' : undefined;

  const financePending = finance && (invoices.isLoading || renewals.isLoading);
  const exportCsv = () =>
    downloadCsv(
      exportFilename(scope === 'customers' ? 'clientes' : 'organizaciones', 'todos'),
      toCsv(csvColumns(finance), rows),
    );

  return (
    <PageContainer
      title={title}
      description={description}
      actions={
        <>
          {rows.length > 0 ? (
            <button
              type="button"
              className="ebim-btn-ghost ebim-btn-sm max-sm:hidden"
              onClick={exportCsv}
            >
              <DownloadSimpleIcon size={16} aria-hidden />
              Exportar CSV
            </button>
          ) : null}
          {perms.canManagePlatform ? (
            <button
              type="button"
              className="ebim-btn-primary"
              onClick={() => setDialog({ open: true, org: null })}
            >
              {scope === 'customers' ? 'Nuevo cliente' : 'Nueva organización'}
            </button>
          ) : null}
        </>
      }
    >
      {orgs.data && universe > 0 ? (
        <StatStrip
          label={scope === 'customers' ? 'Resumen de clientes' : 'Resumen de organizaciones'}
        >
          <StatCell
            label={scope === 'customers' ? 'Clientes activos' : 'Activas'}
            value={formatNumber(summary.active)}
            context={`de ${formatNumber(summary.total)}`}
            onSelect={() => toggle('ACTIVE')}
            selected={filter === 'ACTIVE'}
          />
          {finance ? (
            <StatCell
              label="MRR vigente"
              amounts={summary.mrr}
              emptyLabel="Sin recurrente"
              loading={tenants.isLoading}
              info="Recurrente mensual de los contratos vigentes, por moneda: nunca se suman monedas distintas."
              context={`${formatCountNoun(scoped.filter((r) => Object.keys(r.mrr).length > 0).length, 'cuenta')} con recurrente`}
            />
          ) : null}
          {finance ? (
            <StatCell
              label="Saldo vencido"
              amounts={summary.overdue}
              emptyLabel="Nada vencido"
              tone={summary.overdueInvoices > 0 ? 'warn' : 'neutral'}
              loading={invoices.isLoading}
              error={invoices.error}
              onRetry={() => void invoices.refetch()}
              context={
                summary.overdueInvoices > 0
                  ? `${formatCountNoun(summary.overdueInvoices, 'factura')} · ${formatCountNoun(summary.withDebt, 'cuenta')}`
                  : undefined
              }
              onSelect={() => toggle('DEBT')}
              selected={filter === 'DEBT'}
            />
          ) : null}
          {finance ? (
            <StatCell
              label="Por suspender"
              value={formatNumber(summary.suspension)}
              tone={summary.suspension > 0 ? 'danger' : 'neutral'}
              loading={renewals.isLoading}
              error={renewals.error}
              context="Superaron el plazo de gracia"
              onSelect={() => toggle('SUSPENSION')}
              selected={filter === 'SUSPENSION'}
            />
          ) : null}
          <StatCell
            label="Con apps sin alta"
            value={formatNumber(summary.appsPending)}
            tone={summary.appsPending > 0 ? 'warn' : 'neutral'}
            loading={tenants.isLoading || saas.isLoading}
            context="Alta fallida, en curso o sin pedir"
            onSelect={() => toggle('APPS_PENDING')}
            selected={filter === 'APPS_PENDING'}
          />
        </StatStrip>
      ) : null}

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          total={universe}
          placeholder="Buscar por nombre, razón social, RUC/NIT o país…"
          right={
            <div className="flex flex-wrap items-center gap-2">
              {scope === 'all' ? (
                <StatusTabs
                  label="Capacidad"
                  value={capability}
                  onChange={setCapability}
                  options={[
                    { id: 'ALL', label: 'Todas', count: allRows.length },
                    {
                      id: 'PARTNER',
                      label: 'Partners',
                      count: allRows.filter((r) => isChannel(r.capabilities)).length,
                    },
                    {
                      id: 'CUSTOMER',
                      label: 'Clientes',
                      count: allRows.filter((r) => isCustomer(r.capabilities)).length,
                    },
                  ]}
                />
              ) : null}
              {scope === 'all' ? (
                // Dos filas de pestañas «Todas» confunden: en el directorio el estado es un selector compacto.
                <SelectInput
                  label="Estado"
                  labelDisplay="inline"
                  size="sm"
                  selectClassName="w-auto"
                  value={filter}
                  onChange={(v) => setFilter(v as AccountFilter)}
                  options={tabs.map((id) => ({
                    value: id,
                    label: `${id === 'ALL' ? 'Todos' : ACCOUNT_FILTER_LABEL[id]} (${formatNumber(
                      id === 'ALL'
                        ? scoped.length
                        : scoped.filter((r) => matchesAccountFilter(r, id)).length,
                    )})`,
                  }))}
                />
              ) : (
                <StatusTabs
                  label="Estado de la cuenta"
                  value={filter}
                  onChange={setFilter}
                  options={tabs.map((id) => ({
                    id,
                    label: ACCOUNT_FILTER_LABEL[id],
                    count:
                      id === 'ALL'
                        ? scoped.length
                        : scoped.filter((r) => matchesAccountFilter(r, id)).length,
                  }))}
                />
              )}
            </div>
          }
        />
        {orgs.isLoading ? (
          <LoadingState label={`Cargando ${noun}…`} />
        ) : orgs.error ? (
          <ErrorState error={orgs.error} onRetry={() => void orgs.refetch()} />
        ) : universe === 0 ? (
          <EmptyState
            title={`Sin ${noun}`}
            description={`No hay ${noun} visibles para tu perfil.`}
            action={
              perms.canManagePlatform ? (
                <button
                  type="button"
                  className="ebim-btn-primary"
                  onClick={() => setDialog({ open: true, org: null })}
                >
                  {scope === 'customers' ? 'Nuevo cliente' : 'Nueva organización'}
                </button>
              ) : undefined
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            variant="no-results"
            title={
              term
                ? `Ningún resultado para «${term}»`
                : `Ninguna cuenta en «${ACCOUNT_FILTER_LABEL[filter]}»`
            }
            description="Prueba con otra búsqueda o cambia de pestaña."
            onClear={() => {
              setTerm('');
              setFilter('ALL');
              setCapability('ALL');
            }}
          />
        ) : (
          <DataTable
            label="Cuentas"
            minWidth={finance ? 1080 : 820}
            sort={sort}
            onSort={(key) => setSort((s) => nextSort(s, key))}
            columns={columnsFor(scope, finance)}
          >
            {rows.map((r) => {
              const org = byId.get(r.id);
              const channel = channelLabel(r);
              return (
                <tr
                  key={r.id}
                  className={r.status === 'ACTIVE' ? undefined : 'opacity-80'}
                  data-account={r.id}
                >
                  <td className="ebim-td py-2">
                    <div className="max-w-[280px]">
                      <CellTitle
                        title={r.name}
                        to={`/organizations/${r.id}`}
                        leading={<Avatar name={r.name} ringColor={r.accent} />}
                        secondary={[
                          r.legalName && r.legalName !== r.name ? r.legalName : null,
                          r.country ? countryName(r.country) : null,
                          r.taxId,
                        ]}
                        monoParts={[2]}
                        aside={
                          <>
                            {r.status !== 'ACTIVE' ? (
                              <Badge tone={entityStatusTone(r.status)} dot>
                                {entityStatusLabel(r.status)}
                              </Badge>
                            ) : null}
                            {scope === 'all' && r.isPlatform ? (
                              <Badge tone="accent">Plataforma EBIM</Badge>
                            ) : null}
                            {/* «Cliente» a secas es lo normal: solo se marcan las capacidades de canal (y la combinación). */}
                            {scope === 'all' && isChannel(r.capabilities)
                              ? r.capabilities.map((c) => (
                                  <Badge key={c} tone={c === 'CUSTOMER' ? 'info' : 'neutral'}>
                                    {CAPABILITY_LABEL[c] ?? c}
                                  </Badge>
                                ))
                              : null}
                          </>
                        }
                      />
                    </div>
                  </td>
                  <td className="ebim-td py-2">
                    {tenants.isLoading ? (
                      <Skeleton className="h-4 w-28" />
                    ) : tenants.error ? (
                      <span className="text-compact text-muted">No disponible</span>
                    ) : (
                      <div className="min-w-[180px]">
                        <AppChips
                          label={`Apps de ${r.name}`}
                          empty={r.managedTenants > 0 ? 'Solo como canal' : 'Sin apps'}
                          items={r.apps.map((a) => {
                            const st = appStatus(a.kind);
                            return {
                              key: a.productId,
                              name: a.tenants > 1 ? `${a.name} ×${a.tenants}` : a.name,
                              tone: st.tone,
                              status: st.short,
                              help: st.help,
                            };
                          })}
                        />
                      </div>
                    )}
                  </td>
                  {scope === 'all' ? (
                    <td
                      className="ebim-td ebim-num whitespace-nowrap"
                      title="Propios · que administra como canal"
                    >
                      {tenants.data ? (
                        <>
                          {formatNumber(r.ownTenants)}
                          {r.managedTenants > 0 ? (
                            <span className="text-muted">
                              {' '}
                              · {formatNumber(r.managedTenants)} como canal
                            </span>
                          ) : null}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  ) : null}
                  {finance ? (
                    <>
                      <td className="ebim-td ebim-num">
                        {tenants.isLoading ? (
                          <Skeleton className="ml-auto h-4 w-16" />
                        ) : (
                          <MoneyCell amounts={r.mrr} />
                        )}
                      </td>
                      <td
                        className="ebim-td ebim-num"
                        title={formatAmountsFull(r.overdue) || undefined}
                      >
                        {invoices.isLoading ? (
                          <Skeleton className="ml-auto h-4 w-16" />
                        ) : invoices.error ? (
                          <span className="text-compact text-muted">No disponible</span>
                        ) : (
                          <MoneyCell
                            amounts={r.overdue}
                            tone="danger"
                            context={
                              r.overdueInvoices > 0
                                ? `${formatCountNoun(r.overdueInvoices, 'factura')}${
                                    r.oldestOverdueDays
                                      ? ` · ${formatCountNoun(r.oldestOverdueDays, 'día')}`
                                      : ''
                                  }`
                                : undefined
                            }
                          />
                        )}
                      </td>
                      <td className="ebim-td">
                        <HealthCell
                          row={r}
                          pending={financePending}
                          failed={Boolean(renewals.error)}
                        />
                      </td>
                    </>
                  ) : null}
                  {/* En el directorio, el canal ya se lee en «Tenants» (propios · como canal). */}
                  {scope === 'customers' ? (
                    <td className="ebim-td text-compact text-fg-2">
                      <span
                        className="block max-w-[170px] truncate"
                        title={channel.title ?? channel.label}
                      >
                        {channel.label}
                      </span>
                    </td>
                  ) : null}
                  <td className="ebim-td text-compact">
                    {attributions.isLoading ? (
                      <Skeleton className="h-4 w-20" />
                    ) : r.owner ? (
                      <span
                        className="block max-w-[150px] truncate text-fg"
                        title={
                          r.owner.others.length
                            ? `También: ${r.owner.others.join(', ')}`
                            : r.owner.name
                        }
                      >
                        {r.owner.name}
                        {r.owner.others.length ? (
                          <span className="text-muted"> +{r.owner.others.length}</span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-muted">{attributions.error ? '—' : 'Sin asignar'}</span>
                    )}
                  </td>
                  <td className="ebim-td w-12 text-right">
                    <ActionMenu
                      label={`Acciones de ${r.name}`}
                      items={[
                        { label: 'Abrir ficha 360', to: `/organizations/${r.id}` },
                        {
                          label: 'Ver contratos',
                          to: `/organizations/${r.id}?tab=contratos#contracts`,
                        },
                        perms.canManageOrganization(r.id) && org
                          ? {
                              label: 'Editar datos',
                              onSelect: () => setDialog({ open: true, org: toDraft(org) }),
                            }
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

      <OrganizationFormDialog
        open={dialog.open}
        organization={dialog.org}
        defaultCapability={defaultCapability}
        onClose={() => setDialog({ open: false, org: null })}
      />
    </PageContainer>
  );
}

function capsOf(o: { organization_capabilities?: unknown }): string[] {
  return ((o.organization_capabilities ?? []) as Array<{ capability: string }>).map(
    (c) => c.capability,
  );
}

function toDraft(o: OrganizationLike & { billing_email?: string | null }): OrganizationDraft {
  return {
    id: o.id,
    slug: o.slug ?? '',
    legal_name: o.legal_name ?? '',
    display_name: o.display_name,
    country_code: o.country_code ?? '',
    tax_id: o.tax_id ?? null,
    billing_email: o.billing_email ?? null,
    status: o.status ?? 'ACTIVE',
    accent_color: o.accent_color ?? null,
    capabilities: capsOf(o),
  };
}

function columnsFor(scope: Scope, finance: boolean): DataColumn[] {
  return [
    { label: 'Cuenta', sticky: true, sortKey: 'name' },
    { label: 'Apps', sortKey: 'apps' },
    ...(scope === 'all' ? [{ label: 'Tenants', align: 'right' as const }] : []),
    ...(finance
      ? [
          { label: 'MRR', align: 'right' as const, sortKey: 'mrr' },
          { label: 'Saldo vencido', align: 'right' as const, sortKey: 'overdue' },
          { label: 'Cobranza', mobile: false },
        ]
      : []),
    ...(scope === 'customers' ? [{ label: 'Canal', mobile: false }] : []),
    { label: 'Responsable', mobile: false },
    { label: 'Acciones', srOnly: true },
  ];
}

function HealthCell({
  row,
  pending,
  failed,
}: {
  row: AccountRow;
  pending: boolean;
  failed: boolean;
}): ReactNode {
  if (pending) return <Skeleton className="h-4 w-20" />;
  if (failed || !row.health) return <span className="text-compact text-muted">—</span>;
  const h = HEALTH_TEXT[row.health];
  // Sin contratos ni recurrente: un guion (no repetir «Sin contratos» fila tras fila).
  if (row.health === 'NO_CONTRACTS')
    return (
      <span className="text-compact text-muted" title={h.label}>
        —
      </span>
    );
  return (
    <StatusCell
      label={h.label === 'Con deuda vencida' ? 'Con deuda' : h.label}
      tone={h.tone}
      help={h.detail}
    />
  );
}

function csvColumns(finance: boolean): ExportColumn<AccountRow>[] {
  const amounts = (m: Record<string, number>) =>
    Object.entries(m)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([c, v]) => `${c} ${v.toFixed(2)}`)
      .join(' | ');
  return [
    { header: 'Cuenta', value: (r) => r.name },
    { header: 'Razón social', value: (r) => r.legalName },
    { header: 'País', value: (r) => r.country },
    { header: 'Identificación fiscal', value: (r) => r.taxId },
    { header: 'Estado', value: (r) => entityStatusLabel(r.status) },
    {
      header: 'Apps',
      value: (r) => r.apps.map((a) => `${a.name}: ${appStatus(a.kind).short}`).join(' | '),
    },
    ...(finance
      ? [
          { header: 'MRR', value: (r: AccountRow) => amounts(r.mrr) },
          { header: 'Saldo vencido', value: (r: AccountRow) => amounts(r.overdue) },
          {
            header: 'Facturas vencidas',
            value: (r: AccountRow) => r.overdueInvoices,
            kind: 'number' as const,
          },
          {
            header: 'Cobranza',
            value: (r: AccountRow) => (r.health ? HEALTH_TEXT[r.health].label : ''),
          },
        ]
      : []),
    { header: 'Canal', value: (r) => channelLabel(r).label },
    { header: 'Responsable', value: (r) => r.owner?.name ?? '' },
  ];
}
