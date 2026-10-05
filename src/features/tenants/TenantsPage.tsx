import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProvisioningTargets, useSaasProvisioningRequests, useTenantOverview } from '@/services/queries';
import { tenantDimensions } from './tenantDimensions';
import { TenantDimensionsInline } from './TenantDimensionsView';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge, KpiTile,
} from '@/components/ui/primitives';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { KpiStrip, NativeAmountTile } from '@/features/billing/financeUi';
import { fromQuery } from '@/features/executive/dataState';
import { usePermissions } from '@/hooks/usePermissions';
import { formatMoney, sumByCurrency, formatNumber } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL, TENANT_TYPE_LABEL, TENANT_STATUS_LABEL } from '@/types/domain';
import { TenantFormDialog, TenantStatusDialog } from './TenantDialogs';

type TenantFilter = 'ALL' | 'PRODUCTION' | 'DEMO_TRIAL' | 'SHARED' | 'DEDICATED';

/**
 * Listado de tenants.
 *
 * Un solo buscador general + tabs de estado (contrato §8): nada de paneles con
 * dropdowns de producto/partner/modelo/estado. El buscador cubre producto,
 * cliente, partner y slug a la vez.
 */
export function TenantsPage() {
  const tenants = useTenantOverview();
  // Alta técnica y acceso del administrador: otra fuente (v_saas_provisioning).
  // Si no se puede leer, se dice; no se deduce del estado comercial.
  const saas = useSaasProvisioningRequests();
  const targets = useProvisioningTargets();
  const perms = usePermissions();
  const [tab, setTab] = useState<TenantFilter>('ALL');
  const [creating, setCreating] = useState(false);
  const [statusTarget, setStatusTarget] = useState<{
    id: string;
    name: string;
    status: string;
  } | null>(null);
  const { term, setTerm, filtered } = useSearchFilter(tenants.data, (t) => [
    t.name, t.slug, t.customer_name, t.managing_name, t.product_short_name,
    t.deployment_mode, t.tenant_type, t.admin_email,
  ]);

  const inTab = (t: (typeof filtered)[number], id: TenantFilter) => {
    switch (id) {
      case 'PRODUCTION': return t.tenant_type === 'PRODUCTION';
      case 'DEMO_TRIAL': return t.tenant_type === 'DEMO' || t.tenant_type === 'TRIAL';
      case 'SHARED': return t.deployment_mode === 'SHARED';
      case 'DEDICATED': return t.deployment_mode !== 'SHARED';
      default: return true;
    }
  };
  const rows = filtered.filter((t) => inTab(t, tab));
  const count = (id: TenantFilter) => filtered.filter((t) => inTab(t, id)).length;

  const all = tenants.data ?? [];
  // V3 · por moneda: el MRR de un tenant BOB no se suma al de uno USD (R-7).
  const totalMrr = sumByCurrency(all, (t) => t.mrr, (t) => t.currency);

  return (
    <PageContainer
      title="Tenants"
      description="Cada tenant pertenece a UN producto SaaS. Dónde vive físicamente lo decide su deployment mode, no su jerarquía comercial."
      actions={
        perms.canManagePlatform ? (
          <button type="button" className="ebim-btn-primary" onClick={() => setCreating(true)}>
            Nuevo tenant
          </button>
        ) : null
      }
    >
      <KpiStrip label="Resumen de tenants">
        <KpiTile
          label="Tenants"
          loading={tenants.isLoading}
          value={tenants.data ? formatNumber(all.length) : null}
          footer="Visibles para tu perfil"
        />
        <KpiTile
          label="Productivos"
          loading={tenants.isLoading}
          value={tenants.data ? formatNumber(all.filter((t) => t.tenant_type === 'PRODUCTION').length) : null}
          footer={`${formatNumber(all.filter((t) => t.status === 'ACTIVE').length)} activos en total`}
        />
        <KpiTile
          label="Demo / trial"
          loading={tenants.isLoading}
          value={tenants.data ? formatNumber(all.filter((t) => t.tenant_type === 'DEMO' || t.tenant_type === 'TRIAL').length) : null}
          footer="No generan recurrente"
        />
        <NativeAmountTile
          label="MRR vigente"
          info="Suma del MRR de los tenants por moneda: nunca se mezclan monedas"
          amounts={totalMrr}
          state={fromQuery(tenants, { isEmpty: () => false })}
          onRetry={() => void tenants.refetch()}
          emptyLabel="Sin recurrente vigente"
          footer="Foto actual, por moneda"
        />
      </KpiStrip>

      <Card>
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar por tenant, cliente, partner, producto o slug…"
          right={
            <StatusTabs
              value={tab}
              onChange={setTab}
              options={[
                { id: 'ALL', label: 'Todos', count: filtered.length },
                { id: 'PRODUCTION', label: 'Productivos', count: count('PRODUCTION') },
                { id: 'DEMO_TRIAL', label: 'Demo / Trial', count: count('DEMO_TRIAL') },
                { id: 'SHARED', label: 'Compartidos', count: count('SHARED') },
                { id: 'DEDICATED', label: 'Dedicados', count: count('DEDICATED') },
              ]}
            />
          }
        />
        {tenants.isLoading ? (
          <LoadingState />
        ) : tenants.error ? (
          <ErrorState error={tenants.error} onRetry={() => void tenants.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Sin tenants"
            description="No hay tenants visibles para tu rol que coincidan con el filtro."
          />
        ) : (
          <DataTable
            columns={[
              'Tenant',
              'Cliente',
              'Tipo y modelo',
              'Infraestructura',
              { label: 'MRR vigente', align: 'right' },
              'Comercial · alta · admin',
              { label: 'Acciones', srOnly: true },
            ]}
          >
            {rows.map((t) => (
              <tr key={t.tenant_id as string}>
                <td className="ebim-td">
                  <Link className="font-semibold text-fg hover:underline" to={`/tenants/${t.tenant_id}`}>{t.name}</Link>
                  <div className="text-compact text-fg-2">{t.product_short_name}</div>
                </td>
                <td className="ebim-td">
                  <div>{t.customer_name}</div>
                  <div className="text-compact text-fg-2">{t.managing_name ? `vía ${t.managing_name}` : 'Directo EBIM'}</div>
                </td>
                <td className="ebim-td">
                  <Badge tone={t.tenant_type === 'PRODUCTION' ? 'neutral' : 'info'}>
                    {TENANT_TYPE_LABEL[t.tenant_type as keyof typeof TENANT_TYPE_LABEL]}
                  </Badge>
                  <div className="mt-1 text-compact text-fg-2">
                    {DEPLOYMENT_MODE_LABEL[t.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL]}
                  </div>
                </td>
                <td className="ebim-td">
                  <span
                    className="block max-w-[180px] truncate whitespace-nowrap font-mono text-compact"
                    title={(t.deployment_target_code as string) ?? undefined}
                  >
                    {t.deployment_target_code ?? <span className="font-sans text-muted">Sin asignar</span>}
                  </span>
                  <span className="text-compact text-fg-2">{t.deployment_region ?? ''}</span>
                </td>
                <td className="ebim-td ebim-num whitespace-nowrap">
                  {Number(t.mrr) === 0 || !t.currency ? <span className="text-muted">Sin recurrente</span> : formatMoney(Number(t.mrr), t.currency as string | null)}
                </td>
                <td className="ebim-td">
                  <span className="sr-only">{TENANT_STATUS_LABEL[t.status as keyof typeof TENANT_STATUS_LABEL]}</span>
                  {saas.error ? (
                    <span className="text-compact text-warn">Alta y acceso: no se pudo leer</span>
                  ) : (
                    <TenantDimensionsInline
                      dims={tenantDimensions(t, (saas.data ?? []).filter((r) => r.tenant_id === t.tenant_id), targets.data ?? [])}
                    />
                  )}
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
            ))}
          </DataTable>
        )}
      </Card>

      <TenantFormDialog open={creating} onClose={() => setCreating(false)} />

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
