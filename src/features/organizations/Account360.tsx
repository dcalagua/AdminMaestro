import { Link } from 'react-router-dom';
import { useAccountSeries, useAdminUsers } from '@/services/queries';
import { useInvoiceSummary, useRenewalPipeline } from '@/services/financeRead';
import { Badge, Card, DataTable, EmptyState, ErrorState, LoadingState } from '@/components/ui/primitives';
import { SummaryBar, SummaryItem } from '@/components/ui/SummaryBar';
import { Avatar } from '@/components/ui/Avatar';
import { toCurrencyAmounts } from '@/features/executive/reportContext';
import { nativeInline } from '@/features/billing/financeModel';
import { entityStatusLabel, entityStatusTone } from '@/features/catalog/catalogLabels';
import { AGENT_TYPE_LABEL, SOURCE_LABEL } from '@/features/commercial/commercialLabels';
import { CELL, accountApps, type AccountApp, type ProvisioningRow, type TenantRow } from '@/features/suite/suiteModel';
import { accessSummary, accountStatus } from '@/features/users/userModel';
import { useUserAdminScope } from '@/features/users/useUserAdminScope';
import { formatDate, formatDateTime, formatPercent } from '@/lib/format';
import { HEALTH_TEXT, accountHealth } from './accountSeriesModel';
import { commercialOwner, currentMrrByCurrency, isCurrentAttribution, type AttributionLike } from './account360Model';
import { useOrgAttributions, useOrgSaasProvisioning, useOrgSalesAgents, useOrgTenants } from './org360Queries';

/**
 * Ficha 360 de la cuenta (V5 · F3): cabecera fija y pestaña «Personas».
 *
 * La cabecera responde «¿cómo está esta cuenta?» sin cambiar de pestaña:
 * estado, MRR por moneda y saldo vencido (sólo con vista financiera), apps con
 * su estado (el mismo modelo del Centro de la suite) y responsable comercial.
 * Todo se lee acotado a la cuenta; RLS sigue decidiendo qué filas llegan.
 */

/* ------------------------------------------------------------ Cabecera */

function FinanceItems({ organizationId }: { organizationId: string }) {
  const series = useAccountSeries({ organizationId });
  const invoices = useInvoiceSummary({ search: '', filter: 'ALL', organizationId });
  const renewals = useRenewalPipeline(organizationId);
  const mrr = currentMrrByCurrency(series.data);
  const overdue = toCurrencyAmounts(invoices.data?.overdue);
  const health = HEALTH_TEXT[accountHealth(renewals.data ?? [])];
  return (
    <>
      <SummaryItem label="Salud de cobranza" hint={health.detail}>
        {renewals.isLoading ? '…' : renewals.error ? <span className="text-muted">No disponible</span> : <Badge tone={health.tone} dot>{health.label}</Badge>}
      </SummaryItem>
      <SummaryItem label="MRR vigente" hint="Por moneda: nunca se suman monedas distintas">
        {series.isLoading ? '…' : series.error ? (
          <span className="text-muted">No disponible</span>
        ) : Object.keys(mrr).length > 0 ? (
          <span className="tabular-nums" data-mrr>{nativeInline(mrr)}</span>
        ) : (
          <span className="font-normal text-muted">Sin contratos recurrentes</span>
        )}
      </SummaryItem>
      <SummaryItem label="Saldo vencido" hint="Facturas emitidas vencidas con saldo pendiente, por moneda">
        {invoices.isLoading ? '…' : invoices.error ? (
          <span className="text-muted">No disponible</span>
        ) : Object.keys(overdue).length > 0 ? (
          <span className="tabular-nums text-danger" data-overdue>{nativeInline(overdue)}</span>
        ) : (
          <span className="font-normal text-muted">Nada vencido</span>
        )}
      </SummaryItem>
    </>
  );
}

/** Chips por app con el estado combinado (alta en la app × estado aquí). */
export function AppChips({ apps, to }: { apps: AccountApp[]; to?: string }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Apps de la cuenta">
      {apps.map((a) => {
        const meta = CELL[a.primary.kind];
        const chip = (
          <Badge tone={meta.tone} dot title={meta.help}>
            {a.productName} · {meta.short}
          </Badge>
        );
        return (
          <li key={a.productId} data-app-chip={a.productName} data-kind={a.primary.kind}>
            {to ? <Link to={to} className="rounded-full focus-visible:outline-offset-2">{chip}</Link> : chip}
          </li>
        );
      })}
    </ul>
  );
}

export function AccountHeader({
  organizationId,
  status,
  showFinance,
}: {
  organizationId: string;
  status: string | null | undefined;
  showFinance: boolean;
}) {
  const tenants = useOrgTenants(organizationId);
  const saas = useOrgSaasProvisioning(organizationId);
  const attributions = useOrgAttributions(organizationId);
  const rows = (tenants.data ?? []) as TenantRow[];
  const apps = accountApps(organizationId, rows, (saas.data ?? []) as ProvisioningRow[]);
  const own = apps
    .map((a) => ({ ...a, tenants: a.tenants.filter((t) => t.relation === 'OWN') }))
    .filter((a) => a.tenants.length > 0)
    .map((a) => ({ ...a, primary: a.tenants[0]! }));
  const shown = own.length > 0 ? own : apps;
  const active = shown.filter((a) => a.primary.kind === 'ACTIVE').length;
  const owner = commercialOwner(attributions.data as AttributionLike[] | undefined);

  return (
    <SummaryBar label="Resumen de la cuenta">
      <SummaryItem label="Estado">
        <Badge tone={entityStatusTone(status)} dot>{entityStatusLabel(status)}</Badge>
      </SummaryItem>
      {showFinance ? <FinanceItems organizationId={organizationId} /> : null}
      <SummaryItem
        label={shown.length > 0 ? `Apps · ${active} de ${shown.length} activas` : 'Apps'}
        hint="Estado de la cuenta en cada app: el mismo del Centro de la suite"
        grow
      >
        {tenants.isLoading ? '…' : tenants.error ? (
          <span className="text-muted">No disponible</span>
        ) : shown.length === 0 ? (
          <span className="font-normal text-muted">Sin tenants en la suite</span>
        ) : (
          <>
            <AppChips apps={shown} to="?tab=apps" />
            {own.length === 0 ? <span className="text-caption font-normal text-muted">como canal</span> : null}
          </>
        )}
      </SummaryItem>
      <SummaryItem label="Responsable comercial" hint="Quién vendió la cuenta. No da acceso operativo a sus apps">
        {attributions.isLoading ? '…' : attributions.error ? (
          <span className="font-normal text-muted">No visible para tu rol</span>
        ) : owner ? (
          <span title={owner.others.length ? `También: ${owner.others.join(', ')}` : undefined} data-owner>
            {owner.name}
            {owner.others.length ? <span className="font-normal text-muted"> +{owner.others.length}</span> : null}
          </span>
        ) : (
          <span className="font-normal text-muted">Sin asignar</span>
        )}
      </SummaryItem>
    </SummaryBar>
  );
}

/* ------------------------------------------------------------- Personas */

type AttributionRow = AttributionLike & {
  id: string;
  source: string | null;
  sales_agents: { full_name: string | null; agent_type: string | null } | null;
  saas_products: { short_name: string | null } | null;
  tenants: { name: string | null } | null;
  commission_plans: { name: string | null } | null;
};

function AttributionsCard({ organizationId }: { organizationId: string }) {
  const attributions = useOrgAttributions(organizationId);
  const rows = (attributions.data ?? []) as unknown as AttributionRow[];
  return (
    <Card
      id="attributions"
      title="Atribución comercial"
      description="Quién se lleva el crédito de cada venta de la cuenta. Estar aquí NO da acceso operativo a la cuenta ni a sus apps."
    >
      {attributions.isLoading ? (
        <LoadingState label="Leyendo atribuciones…" />
      ) : attributions.error ? (
        <ErrorState error={attributions.error} onRetry={() => void attributions.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="Sin atribución comercial" description="Ninguna venta de esta cuenta tiene comercial asignado." />
      ) : (
        <DataTable columns={['Comercial', 'App · tenant', { label: 'Participación', align: 'right' }, 'Origen', 'Vigencia']}>
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="ebim-td">
                <span className="block font-semibold">{a.sales_agents?.full_name ?? '—'}</span>
                <span className="block text-caption text-muted">
                  {AGENT_TYPE_LABEL[a.sales_agents?.agent_type ?? ''] ?? a.sales_agents?.agent_type ?? ''}
                  {a.commission_plans?.name ? ` · ${a.commission_plans.name}` : ''}
                </span>
              </td>
              <td className="ebim-td text-compact">
                {a.saas_products?.short_name ?? '—'}
                {a.tenants?.name ? <span className="block text-caption text-muted">{a.tenants.name}</span> : null}
              </td>
              <td className="ebim-td ebim-num">{formatPercent(Number(a.attribution_pct ?? 0), 0)}</td>
              <td className="ebim-td text-compact text-fg-2">{SOURCE_LABEL[a.source ?? ''] ?? a.source}</td>
              <td className="ebim-td text-compact">
                <span className="text-muted">
                  {a.valid_from ? formatDate(a.valid_from) : '—'} → {a.valid_to ? formatDate(a.valid_to) : 'sin fin'}
                </span>
                {isCurrentAttribution(a) ? null : <span className="ml-1"><Badge tone="neutral">No vigente</Badge></span>}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </Card>
  );
}

function AgentsCard({ organizationId }: { organizationId: string }) {
  const agents = useOrgSalesAgents(organizationId);
  const rows = agents.data ?? [];
  return (
    <Card id="commercials" title="Comerciales afiliados" description="Comerciales que pertenecen a esta organización (p. ej. el equipo de un partner).">
      {agents.error ? (
        <ErrorState error={agents.error} onRetry={() => void agents.refetch()} />
      ) : agents.isLoading ? (
        <LoadingState label="Leyendo comerciales…" />
      ) : rows.length === 0 ? (
        <EmptyState title="Sin comerciales afiliados" />
      ) : (
        <DataTable columns={['Comercial', 'Tipo', 'Contacto', 'Estado']}>
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="ebim-td">
                <div className="flex items-center gap-3">
                  <Avatar name={a.full_name} mode="person" />
                  <span className="font-semibold">{a.full_name}</span>
                </div>
              </td>
              <td className="ebim-td"><Badge tone="neutral">{AGENT_TYPE_LABEL[a.agent_type] ?? a.agent_type}</Badge></td>
              <td className="ebim-td text-fg-2">{a.contact_email ?? '—'}</td>
              <td className="ebim-td">
                <Badge tone={entityStatusTone(a.status)} dot>{entityStatusLabel(a.status)}</Badge>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </Card>
  );
}

/** Usuarios con acceso a la cuenta o a sus tenants. La lista la acota `admin_list_users`. */
export function AccountUsersCard({
  organizationId,
  tenantId,
  title = 'Usuarios de la cuenta',
}: {
  organizationId: string;
  /** En la ficha del tenant: sólo quienes tienen acceso a ese tenant. */
  tenantId?: string;
  title?: string;
}) {
  const users = useAdminUsers(organizationId);
  const rows = (users.data ?? []).filter((u) =>
    tenantId
      ? u.tenants.some((t) => t.tenant_id === tenantId)
      : u.organizations.some((m) => m.organization_id === organizationId) || u.tenants.some((t) => t.customer_organization_id === organizationId),
  );
  return (
    <Card
      id="users"
      title={title}
      description="Quién entra y con qué acceso. Invitar, cambiar roles o desactivar se hace en la ficha de cada usuario."
    >
      {users.isLoading ? (
        <LoadingState label="Leyendo usuarios…" />
      ) : users.error ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="Sin usuarios visibles" description="Nadie tiene todavía acceso visible para tu rol." />
      ) : (
        <DataTable columns={['Usuario', 'Accesos', 'Estado', 'Último ingreso']}>
          {rows.map((u) => {
            const st = accountStatus(u);
            return (
              <tr key={u.id}>
                <td className="ebim-td">
                  <Link className="ebim-link font-semibold" to={`/users/${u.id}`}>{u.fullName ?? u.email}</Link>
                  {u.fullName ? <span className="block text-caption text-muted">{u.email}</span> : null}
                </td>
                <td className="ebim-td text-compact text-fg-2">{accessSummary(u).join(' · ') || '—'}</td>
                <td className="ebim-td"><Badge tone={st.tone} dot>{st.label}</Badge></td>
                <td className="ebim-td whitespace-nowrap text-compact text-muted">
                  {u.lastSignInAt ? formatDateTime(u.lastSignInAt) : 'Nunca'}
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </Card>
  );
}

export function Org360People({ organizationId }: { organizationId: string }) {
  const scope = useUserAdminScope();
  return (
    <div className="space-y-4">
      <AttributionsCard organizationId={organizationId} />
      {scope.canView ? <AccountUsersCard organizationId={organizationId} /> : null}
      <AgentsCard organizationId={organizationId} />
    </div>
  );
}
