import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircleIcon, InfoIcon, MinusCircleIcon, WarningCircleIcon, XCircleIcon } from '@phosphor-icons/react';
import { useProvisioningTargets, useSaasProvisioningRequests, useTenantOverview } from '@/services/queries';
import { tenantDimensions, type Dimension, type DimTone } from './tenantDimensions';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Skeleton, type DataTableSort,
} from '@/components/ui/primitives';
import { StatCell, StatStrip } from '@/components/ui/StatStrip';
import { CellTitle, MoneyCell, StatusCell } from '@/components/ui/cells';
import { nextSort } from '@/components/ui/tableSort';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { Avatar } from '@/components/ui/Avatar';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCountNoun, formatNumber, sumByCurrency } from '@/lib/format';
import { TenantStatusDialog } from './TenantDialogs';
import {
  TENANT_FILTER_LABEL,
  altaState,
  commercialState,
  latestRequestByTenant,
  matchesTenantFilter,
  modelLabel,
  sortTenants,
  type AltaState,
  type TenantFilter,
  type TenantSortKey,
} from './tenantListModel';

const TABS: TenantFilter[] = ['ALL', 'PRODUCTION', 'DEMO_TRIAL', 'SHARED', 'DEDICATED', 'NO_ALTA'];

const PROVIDER_LABEL: Record<string, string> = {
  SUPABASE: 'Supabase',
  AWS: 'AWS',
  AZURE: 'Azure',
  GCP: 'Google Cloud',
  ON_PREMISE: 'Servidor propio',
};

const DIM_ICON: Record<DimTone, typeof InfoIcon> = {
  ok: CheckCircleIcon,
  warn: WarningCircleIcon,
  danger: XCircleIcon,
  info: InfoIcon,
  neutral: MinusCircleIcon,
};
const DIM_TONE: Record<DimTone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
  neutral: 'text-muted',
};

/**
 * Listado de tenants (V6 · F2, plan §3.3).
 *
 * Filas de una línea principal y una secundaria: tenant y app, cuenta y canal,
 * modelo en una insignia («Compartido · Producción»), MRR, estado (comercial
 * como insignia y, debajo, alta en la app y administrador con icono) e
 * infraestructura (proveedor y región; el código del destino va al tooltip).
 * Arriba, una franja compacta cuyas cifras filtran la tabla.
 *
 * Un solo buscador general + pestañas de estado (contrato §8). Las cuatro
 * dimensiones siguen sin semáforo global: cada una conserva su texto completo
 * en el `title` y en la ficha (spec §11.2).
 */
export function TenantsPage() {
  const tenants = useTenantOverview();
  // Alta técnica y acceso del administrador: otra fuente (v_saas_provisioning).
  // Si no se puede leer, se dice; no se deduce del estado comercial.
  const saas = useSaasProvisioningRequests();
  const targets = useProvisioningTargets();
  const perms = usePermissions();
  const [tab, setTab] = useState<TenantFilter>('ALL');
  const [sort, setSort] = useState<DataTableSort>({ key: 'name', dir: 'asc' });
  const [statusTarget, setStatusTarget] = useState<{
    id: string;
    name: string;
    status: string;
  } | null>(null);
  const { term, setTerm, filtered } = useSearchFilter(tenants.data, (t) => [
    t.name, t.slug, t.customer_name, t.managing_name, t.product_short_name,
    t.deployment_mode, t.tenant_type, t.admin_email, t.deployment_target_code, t.deployment_region,
  ]);

  const requests = useMemo(() => saas.data ?? [], [saas.data]);
  const latest = useMemo(() => latestRequestByTenant(requests), [requests]);
  const altaOf = (id: string | null | undefined): AltaState => altaState(id ? latest.get(id) : undefined);

  const all = tenants.data ?? [];
  const inTab = (t: (typeof all)[number], id: TenantFilter) => matchesTenantFilter(t, id, altaOf(t.tenant_id));
  const count = (id: TenantFilter) => filtered.filter((t) => inTab(t, id)).length;
  const rows = sortTenants(filtered.filter((t) => inTab(t, tab)), sort.key as TenantSortKey, sort.dir);

  // V3 · por moneda: el MRR de un tenant BOB no se suma al de uno USD (R-7).
  const totalMrr = sumByCurrency(all, (t) => t.mrr, (t) => t.currency);
  const withMrr = all.filter((t) => Number(t.mrr) > 0 && t.currency).length;
  const noAlta = saas.data ? all.filter((t) => inTab(t, 'NO_ALTA')).length : null;
  const toggle = (id: TenantFilter) => setTab((current) => (current === id ? 'ALL' : id));

  return (
    <PageContainer
      title="Tenants"
      description="El espacio de cada cliente en una app de la suite: un tenant pertenece a una sola app."
      actions={
        perms.canManagePlatform ? (
          // «Nuevo tenant» abre el flujo guiado en modo «solo alta en una app» (V5 · F4).
          <Link className="ebim-btn-primary" to="/onboarding?modo=app">
            Nuevo tenant
          </Link>
        ) : null
      }
    >
      {tenants.isLoading || all.length > 0 ? (
        <StatStrip label="Resumen de tenants">
          <StatCell
            label="Tenants"
            loading={tenants.isLoading}
            value={formatNumber(all.length)}
            context={`${formatNumber(all.filter((t) => t.status === 'ACTIVE').length)} activos`}
            onSelect={() => setTab('ALL')}
            selected={tab === 'ALL'}
          />
          <StatCell
            label="Productivos"
            loading={tenants.isLoading}
            value={formatNumber(all.filter((t) => t.tenant_type === 'PRODUCTION').length)}
            context="Generan recurrente"
            onSelect={() => toggle('PRODUCTION')}
            selected={tab === 'PRODUCTION'}
          />
          <StatCell
            label="Demo / trial"
            loading={tenants.isLoading}
            value={formatNumber(all.filter((t) => t.tenant_type === 'DEMO' || t.tenant_type === 'TRIAL').length)}
            context="No generan recurrente"
            onSelect={() => toggle('DEMO_TRIAL')}
            selected={tab === 'DEMO_TRIAL'}
          />
          <StatCell
            label="MRR vigente"
            amounts={totalMrr}
            loading={tenants.isLoading}
            emptyLabel="Sin recurrente"
            info="Suma del MRR de los tenants por moneda: nunca se mezclan monedas."
            context={`${formatCountNoun(withMrr, 'tenant')} con recurrente`}
          />
          <StatCell
            label="Sin alta en la app"
            value={noAlta === null ? null : formatNumber(noAlta)}
            loading={tenants.isLoading || saas.isLoading}
            error={saas.error}
            onRetry={() => void saas.refetch()}
            tone={noAlta ? 'warn' : 'neutral'}
            context="Sin alta, fallida o cancelada"
            onSelect={() => toggle('NO_ALTA')}
            selected={tab === 'NO_ALTA'}
          />
        </StatStrip>
      ) : null}

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          total={tenants.isLoading ? undefined : all.length}
          placeholder="Buscar por tenant, cliente, partner, app o código…"
          right={
            <StatusTabs
              label="Tipo de tenant"
              value={tab}
              onChange={setTab}
              options={TABS.filter((id) => id !== 'NO_ALTA' || tab === 'NO_ALTA').map((id) => ({
                id,
                label: TENANT_FILTER_LABEL[id],
                count: id === 'ALL' ? filtered.length : count(id),
              }))}
            />
          }
        />
        {tenants.isLoading ? (
          <LoadingState />
        ) : tenants.error ? (
          <ErrorState error={tenants.error} onRetry={() => void tenants.refetch()} />
        ) : all.length === 0 ? (
          <EmptyState
            title="Sin tenants"
            description="Todavía no hay tenants visibles para tu perfil."
            action={
              perms.canManagePlatform ? (
                <Link className="ebim-btn-primary" to="/onboarding?modo=app">
                  Nuevo tenant
                </Link>
              ) : undefined
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            variant="no-results"
            title={term ? `Ningún resultado para «${term}»` : `Ningún tenant en «${TENANT_FILTER_LABEL[tab]}»`}
            description="Prueba con otra búsqueda o cambia de pestaña."
            onClear={() => {
              setTerm('');
              setTab('ALL');
            }}
          />
        ) : (
          <DataTable
            label="Tenants"
            minWidth={980}
            sort={sort}
            onSort={(key) => setSort((s) => nextSort(s, key))}
            columns={[
              { label: 'Tenant', sticky: true, sortKey: 'name' },
              { label: 'Cuenta' },
              { label: 'Modelo e infraestructura', mobile: false },
              { label: 'MRR', align: 'right', sortKey: 'mrr' },
              { label: 'Estado' },
              { label: 'Acciones', srOnly: true },
            ]}
          >
            {rows.map((t) => {
              const commercial = commercialState(t.status);
              const alta = altaOf(t.tenant_id);
              const dims = saas.data
                ? tenantDimensions(t, requests.filter((r) => r.tenant_id === t.tenant_id), targets.data ?? [])
                : null;
              const provider = t.deployment_provider ? PROVIDER_LABEL[t.deployment_provider] ?? t.deployment_provider : null;
              return (
                <tr key={t.tenant_id as string} data-tenant={t.slug ?? ''}>
                  <td className="ebim-td py-2">
                    <div className="max-w-[250px]">
                      <CellTitle
                        title={t.name ?? '—'}
                        to={`/tenants/${t.tenant_id}`}
                        tooltip={t.slug ? `${t.name}\nCódigo: ${t.slug}` : undefined}
                        leading={<Avatar name={t.product_short_name ?? t.name ?? '—'} />}
                        secondary={[t.product_short_name]}
                      />
                    </div>
                  </td>
                  <td className="ebim-td py-2">
                    <div className="max-w-[200px]">
                      <CellTitle
                        title={t.customer_name ?? '—'}
                        to={t.customer_organization_id ? `/organizations/${t.customer_organization_id}` : undefined}
                        secondary={[t.managing_name ? `Vía ${t.managing_name}` : 'Directo EBIM']}
                      />
                    </div>
                  </td>
                  <td className="ebim-td py-2 text-compact">
                    <span
                      className="block max-w-[200px] leading-tight"
                      title={
                        t.deployment_target_code
                          ? `Destino: ${t.deployment_target_code}${t.deployment_region ? `\nRegión: ${t.deployment_region}` : ''}`
                          : undefined
                      }
                    >
                      <span className="block truncate font-semibold text-fg">{modelLabel(t)}</span>
                      <span className="block truncate text-caption text-muted">
                        {t.deployment_target_code
                          ? [provider ?? 'Destino propio', t.deployment_region].filter(Boolean).join(' · ')
                          : t.deployment_mode === 'SHARED'
                            ? 'Infraestructura de la suite'
                            : 'Destino sin asignar'}
                      </span>
                    </span>
                  </td>
                  <td className="ebim-td ebim-num">
                    <MoneyCell amount={t.mrr} currency={t.currency} />
                  </td>
                  <td className="ebim-td py-2">
                    <StatusCell
                      label={commercial.short}
                      tone={commercial.tone}
                      help={dims ? `Comercial: ${dims.commercial.label}` : undefined}
                      detail={
                        saas.isLoading ? (
                          <Skeleton className="mt-0.5 h-3 w-32" />
                        ) : saas.error ? (
                          <span className="text-warn">Alta y acceso: no se pudo leer</span>
                        ) : dims ? (
                          <span className="inline-flex items-center gap-2">
                            <DimMark name="Alta" short={alta.short} dim={dims.technical} />
                            {/* «Sin dato del producto» es lo habitual: solo se pinta cuando la app informó algo. */}
                            {dims.admin.label !== 'Sin dato del producto' ? (
                              <DimMark name="Admin" short={adminShort(dims.admin)} dim={dims.admin} />
                            ) : null}
                          </span>
                        ) : null
                      }
                    />
                  </td>
                  <td className="ebim-td w-12 text-right">
                    <ActionMenu
                      label={`Acciones de ${t.name}`}
                      items={[
                        { label: 'Abrir Tenant 360', to: `/tenants/${t.tenant_id}` },
                        t.customer_organization_id
                          ? { label: 'Ficha del cliente', to: `/organizations/${t.customer_organization_id}` }
                          : null,
                        perms.canManagePlatform || perms.canManageOrganization(t.customer_organization_id as string)
                          ? {
                              label: 'Cambiar estado…',
                              onSelect: () =>
                                setStatusTarget({
                                  id: t.tenant_id as string,
                                  name: t.name as string,
                                  status: t.status as string,
                                }),
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

      <TenantStatusDialog
        open={Boolean(statusTarget)}
        tenantId={statusTarget?.id ?? null}
        tenantName={statusTarget?.name ?? ''}
        currentStatus={statusTarget?.status ?? 'ACTIVE'}
        onClose={() => setStatusTarget(null)}
      />
    </PageContainer>
  );
}

/** «Admin»: lo que informó el producto, en corto. */
function adminShort(dim: Dimension): string {
  if (dim.label === 'Sin dato del producto') return 'sin dato';
  if (dim.label === 'Administrador preaprovisionado') return 'preaprovisionado';
  return dim.label.replace(/^Administrador:\s*/, '');
}

/** Una dimensión en una línea: icono con tono, nombre y estado corto; el detalle completo en el `title`. */
function DimMark({ name, short, dim }: { name: string; short: string; dim: Dimension }) {
  const Icon = DIM_ICON[dim.tone];
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap" title={`${name}: ${dim.label}\n${dim.detail}`}>
      <Icon size={12} aria-hidden className={`shrink-0 ${DIM_TONE[dim.tone]}`} />
      {name === 'Alta' ? short : `${name} ${short}`}
    </span>
  );
}
