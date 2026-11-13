import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/primitives';
import { SummaryBar, SummaryItem } from '@/components/ui/SummaryBar';
import { useAuth } from '@/hooks/useAuth';
import { DEPLOYMENT_MODE_LABEL, TENANT_STATUS_LABEL, TENANT_TYPE_LABEL } from '@/types/domain';
import { CELL, type AccountAppTenant, type TenantRow } from '@/features/suite/suiteModel';

type HeaderTenant = Pick<
  TenantRow,
  'status' | 'product_short_name' | 'product_lockup' | 'product_code' | 'customer_name' | 'customer_organization_id' | 'deployment_mode' | 'tenant_type'
>;

function tenantStatusTone(status: string | null | undefined): 'ok' | 'danger' | 'warn' {
  if (status === 'ACTIVE') return 'ok';
  if (status === 'SUSPENDED' || status === 'CHURNED') return 'danger';
  return 'warn';
}

/**
 * Cabecera fija del tenant (V5 · F3), con el mismo esquema que la de la cuenta:
 * app, cuenta, estado aquí, estado en la app y modo. Sin códigos de
 * infraestructura: esos viven en «App y alta › Avanzado».
 */
export function TenantHeader({ tenant, appState }: { tenant: HeaderTenant; appState: AccountAppTenant | null }) {
  const { persona } = useAuth();
  const appName = tenant.product_short_name ?? tenant.product_lockup ?? '—';
  const appCell = appState ? CELL[appState.kind] : null;
  return (
    <SummaryBar label="Resumen del tenant">
      <SummaryItem label="App">
        {persona === 'EBIM' && tenant.product_code ? (
          <Link className="ebim-link" to={`/apps/${tenant.product_code}`}>{appName}</Link>
        ) : (
          appName
        )}
      </SummaryItem>
      <SummaryItem label="Cuenta">
        {tenant.customer_organization_id ? (
          <Link className="ebim-link" to={`/organizations/${tenant.customer_organization_id}`}>
            {tenant.customer_name ?? 'Ver cuenta'}
          </Link>
        ) : (
          tenant.customer_name ?? '—'
        )}
      </SummaryItem>
      <SummaryItem label="Estado aquí" hint="Estado del tenant en el Admin Maestro">
        <Badge tone={tenantStatusTone(tenant.status)} dot>
          {tenant.status ? TENANT_STATUS_LABEL[tenant.status] : 'Sin estado'}
        </Badge>
      </SummaryItem>
      <SummaryItem label="Estado en la app" hint={appCell?.help ?? 'Estado del alta del tenant dentro de la app'}>
        {appState?.request ? (
          <span data-app-state={appState.kind}>
            <Badge tone={appCell!.tone} dot>{appState.requestStatusLabel}</Badge>
          </span>
        ) : (
          <span className="font-normal text-muted">Sin alta registrada</span>
        )}
      </SummaryItem>
      <SummaryItem label="Modo">
        <span>
          {tenant.deployment_mode ? DEPLOYMENT_MODE_LABEL[tenant.deployment_mode] : 'Sin modelo'}
          {tenant.tenant_type ? <span className="font-normal text-muted"> · {TENANT_TYPE_LABEL[tenant.tenant_type]}</span> : null}
        </span>
      </SummaryItem>
    </SummaryBar>
  );
}
