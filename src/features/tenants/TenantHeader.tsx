import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/primitives';
import { nativeInline } from '@/features/billing/financeModel';
import { HEALTH_TEXT, type AccountHealth } from '@/features/organizations/accountSeriesModel';
import type { CurrencyAmounts } from '@/features/executive/reportContext';
import { SummaryBar, SummaryItem } from '@/components/ui/SummaryBar';
import { useAuth } from '@/hooks/useAuth';
import { DEPLOYMENT_MODE_LABEL, TENANT_STATUS_LABEL, TENANT_TYPE_LABEL } from '@/types/domain';
import { CELL, type AccountAppTenant, type TenantRow } from '@/features/suite/suiteModel';

type HeaderTenant = Pick<
  TenantRow,
  'status' | 'product_short_name' | 'product_lockup' | 'product_code' | 'customer_name' | 'customer_organization_id' | 'deployment_mode' | 'tenant_type'
> & { plan_name?: string | null };

/** Dato leído aparte (MRR, salud): cargando, con error o listo. */
interface Loaded<T> {
  loading?: boolean;
  error?: boolean;
  value: T;
}

/** Cifras de negocio de la cabecera; solo con vista financiera. */
export interface TenantHeaderFinance {
  mrr: Loaded<CurrencyAmounts>;
  health: Loaded<AccountHealth>;
}

function loaded<T>(item: Loaded<T>, render: (value: T) => ReactNode) {
  if (item.loading) return '…';
  if (item.error) return <span className="font-normal text-muted">No disponible</span>;
  return render(item.value);
}

function tenantStatusTone(status: string | null | undefined): 'ok' | 'danger' | 'warn' {
  if (status === 'ACTIVE') return 'ok';
  if (status === 'SUSPENDED' || status === 'CHURNED') return 'danger';
  return 'warn';
}

/**
 * Cabecera fija del tenant (V5 · F3 → V6 · T8), con el mismo esquema que la de
 * la cuenta: estado aquí y en la app, app, cuenta, plan, modo y, con vista
 * financiera, MRR por moneda y salud de cobranza. Reemplaza los KPI grandes
 * que repetían plan y salud con texto en tamaño de cifra. Sin códigos de
 * infraestructura: esos viven en «App y alta › Avanzado».
 */
export function TenantHeader({
  tenant,
  appState,
  finance,
}: {
  tenant: HeaderTenant;
  appState: AccountAppTenant | null;
  finance?: TenantHeaderFinance;
}) {
  const { persona } = useAuth();
  const appName = tenant.product_short_name ?? tenant.product_lockup ?? '—';
  const appCell = appState ? CELL[appState.kind] : null;
  return (
    <SummaryBar label="Resumen del tenant">
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
      <SummaryItem label="Plan">
        {tenant.plan_name ? tenant.plan_name : <span className="font-normal text-muted">Sin plan contratado</span>}
      </SummaryItem>
      <SummaryItem
        label="Modo"
        hint={tenant.tenant_type ? `Tenant de ${TENANT_TYPE_LABEL[tenant.tenant_type].toLowerCase()}` : undefined}
      >
        {tenant.deployment_mode ? DEPLOYMENT_MODE_LABEL[tenant.deployment_mode] : 'Sin modelo'}
      </SummaryItem>
      {finance ? (
        <>
          <SummaryItem label="MRR vigente" hint="Contratos recurrentes de este tenant, a hoy, por moneda">
            {loaded(finance.mrr, (mrr) =>
              Object.keys(mrr).length > 0 ? (
                <span className="tabular-nums" data-mrr>{nativeInline(mrr)}</span>
              ) : (
                <span className="font-normal text-muted">Sin contratos recurrentes</span>
              ),
            )}
          </SummaryItem>
          <SummaryItem label="Salud de cobranza" hint={finance.health.loading || finance.health.error ? undefined : HEALTH_TEXT[finance.health.value].detail}>
            {loaded(finance.health, (h) => (
              <Badge tone={HEALTH_TEXT[h].tone} dot>{HEALTH_TEXT[h].label}</Badge>
            ))}
          </SummaryItem>
        </>
      ) : null}
    </SummaryBar>
  );
}
