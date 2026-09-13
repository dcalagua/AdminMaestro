import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTenantOverview } from '@/services/queries';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge, StatCard,
} from '@/components/ui/primitives';
import { usePermissions } from '@/hooks/usePermissions';
import { formatMoney, formatCurrencyMap, sumByCurrency, formatNumber } from '@/lib/format';
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

  const rows = filtered.filter((t) => {
    switch (tab) {
      case 'PRODUCTION': return t.tenant_type === 'PRODUCTION';
      case 'DEMO_TRIAL': return t.tenant_type === 'DEMO' || t.tenant_type === 'TRIAL';
      case 'SHARED': return t.deployment_mode === 'SHARED';
      case 'DEDICATED': return t.deployment_mode !== 'SHARED';
      default: return true;
    }
  });

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
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label="Total de tenants" value={formatNumber(all.length)} />
        <StatCard label="Productivos" value={formatNumber(all.filter((t) => t.tenant_type === 'PRODUCTION').length)} />
        <StatCard
          label="Demo / trial"
          value={formatNumber(all.filter((t) => t.tenant_type === 'DEMO' || t.tenant_type === 'TRIAL').length)}
          hint="No generan recurrente"
        />
        <StatCard label="MRR agregado" value={formatCurrencyMap(totalMrr)} tone="ok" hint="Por moneda" />
      </div>

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
                { id: 'PRODUCTION', label: 'Productivos' },
                { id: 'DEMO_TRIAL', label: 'Demo / Trial' },
                { id: 'SHARED', label: 'Compartidos' },
                { id: 'DEDICATED', label: 'Dedicados' },
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
            columns={['Tenant', 'Producto', 'Cliente', 'Administra', 'Tipo', 'Modelo', 'Infraestructura', 'MRR', 'Estado', '']}
          >
            {rows.map((t) => (
              <tr key={t.tenant_id as string}>
                <td className="ebim-td">
                  <Link className="ebim-link" to={`/tenants/${t.tenant_id}`}>{t.name}</Link>
                  <div className="font-mono text-xs text-muted">{t.slug}</div>
                </td>
                <td className="ebim-td">{t.product_short_name}</td>
                <td className="ebim-td">{t.customer_name}</td>
                <td className="ebim-td text-muted">{t.managing_name ?? 'Directo EBIM'}</td>
                <td className="ebim-td">
                  <Badge tone={t.tenant_type === 'PRODUCTION' ? 'ok' : 'info'}>
                    {TENANT_TYPE_LABEL[t.tenant_type as keyof typeof TENANT_TYPE_LABEL]}
                  </Badge>
                </td>
                <td className="ebim-td">
                  <Badge tone="accent">
                    {DEPLOYMENT_MODE_LABEL[t.deployment_mode as keyof typeof DEPLOYMENT_MODE_LABEL]}
                  </Badge>
                </td>
                <td className="ebim-td font-mono text-xs text-muted">{t.deployment_target_code ?? '—'}</td>
                <td className="ebim-td tabular-nums">{formatMoney(Number(t.mrr), t.currency as string | null)}</td>
                <td className="ebim-td">
                  <Badge tone={t.status === 'ACTIVE' ? 'ok' : t.status === 'PENDING' ? 'warn' : 'neutral'}>
                    {TENANT_STATUS_LABEL[t.status as keyof typeof TENANT_STATUS_LABEL]}
                  </Badge>
                </td>
                <td className="ebim-td text-right">
                  {perms.canManagePlatform || perms.canManageOrganization(t.customer_organization_id as string) ? (
                    <button
                      type="button"
                      className="ebim-link text-[13px]"
                      onClick={() =>
                        setStatusTarget({
                          id: t.tenant_id as string,
                          name: t.name as string,
                          status: t.status as string,
                        })
                      }
                    >
                      Cambiar estado
                    </button>
                  ) : null}
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
