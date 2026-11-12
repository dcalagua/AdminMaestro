import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge, Card, DataTable, EmptyState, ErrorState, LoadingState, SearchBar,
} from '@/components/ui/primitives';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { SelectInput } from '@/components/ui/fields';
import { DetailDrawer, DetailList } from '@/components/ui/DetailDrawer';
import { useToast } from '@/components/ui/toast-context';
import { useListState } from '@/hooks/useListState';
import { usePermissions } from '@/hooks/usePermissions';
import { useProvisioningAccess } from '@/hooks/useProvisioningAccess';
import { useRetrySaasProvisioning } from '@/services/mutations';
import { businessErrorMessage } from '@/lib/pgError';
import { providerErrorLabel } from '@/lib/provisioning';
import { formatDateTime } from '@/lib/format';
import { SUBSCRIPTION_STATUS_LABEL, SUBSCRIPTION_STATUS_TONE } from '@/features/billing/subscriptionLabels';
import {
  CELL,
  MATRIX_FILTERS,
  MATRIX_FILTER_LABEL,
  filterCount,
  moduleState,
  rowMatches,
  type AppHealth,
  type MatrixFilter,
  type MatrixRow,
  type MatrixTenant,
  type SuiteApp,
} from './suiteModel';
import { ConfirmActiveButton, PENDING_CONFIRM_EXPLANATION, PendingConfirmNotice } from './ConfirmActive';
import { useConfirmActive } from './useConfirmActive';
import { LifecycleDialog } from './LifecycleDialog';

type Action = { kind: 'SUSPEND' | 'RESUME'; tenant: MatrixTenant; organizationId: string; appName: string };

interface Selection {
  row: MatrixRow;
  app: SuiteApp;
}

/** ¿Están activos los canales de módulos y uso de esta app? */
function channelFlags(health: AppHealth | undefined) {
  return {
    modules: Boolean(health?.channels.find((c) => c.key === 'modulos')?.active),
    usage: Boolean(health?.channels.find((c) => c.key === 'uso')?.active),
  };
}

function CellSummary({
  tenant,
  extra,
  finance,
  flags,
}: {
  tenant: MatrixTenant;
  extra: number;
  finance: boolean;
  flags: { modules: boolean; usage: boolean };
}) {
  const meta = CELL[tenant.kind];
  const modules = moduleState(flags.modules, tenant.moduleSync);
  const appLine =
    tenant.kind === 'PENDING_CONFIRM'
      ? 'Activo en la app · pendiente de confirmar en MasterAdmin'
      : `En la app: ${tenant.requestStatusLabel ?? 'sin alta'} · Aquí: ${tenant.tenantStatusLabel}`;
  const contractLine = finance
    ? `Contrato: ${tenant.subscriptionStatus ? SUBSCRIPTION_STATUS_LABEL[tenant.subscriptionStatus] ?? tenant.subscriptionStatus : 'sin contrato'}`
    : null;
  const channelLine = `Módulos: ${modules.label.toLowerCase()} · Uso: ${flags.usage ? 'activo' : 'no activo'}`;
  // La celda muestra sólo el estado; el detalle va al pasar el puntero, al lector de pantalla y al panel lateral.
  return (
    <span className="flex flex-col items-center gap-1" title={[appLine, contractLine, channelLine].filter(Boolean).join('\n')}>
      <Badge tone={meta.tone} dot>
        {meta.short}
      </Badge>
      <span className="sr-only">{appLine}</span>
      {contractLine ? <span className="sr-only">{contractLine}</span> : null}
      <span className="sr-only">{channelLine}</span>
      {extra > 0 ? (
        <span className="text-caption font-semibold text-accent-deep">
          +{extra} tenant{extra === 1 ? '' : 's'} más
        </span>
      ) : null}
    </span>
  );
}

export function SuiteMatrix({
  apps,
  rows,
  health,
  finance,
  loading,
  error,
  onRetry,
}: {
  apps: SuiteApp[];
  rows: MatrixRow[];
  health: AppHealth[];
  finance: boolean;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const list = useListState<MatrixFilter, 'name'>(
    { filter: 'ALL', filters: MATRIX_FILTERS, sortBy: 'name', sorts: ['name'], sortDir: 'asc' },
    'm',
  );
  const appFilter = list.extra('app');
  const appId = apps.find((a) => a.code === appFilter)?.id ?? null;
  const perms = usePermissions();
  const access = useProvisioningAccess();
  const toast = useToast();
  const confirmActive = useConfirmActive();
  const retry = useRetrySaasProvisioning();

  const [selected, setSelected] = useState<Selection | null>(null);
  const [action, setAction] = useState<Action | null>(null);

  const healthById = useMemo(() => new Map(health.map((h) => [h.app.id, h])), [health]);
  const visible = rows.filter((r) => rowMatches(r, list.filter, appId, list.search));
  const pendingConfirm = rows.reduce(
    (n, r) => n + Object.values(r.cells).reduce((m, c) => m + c.tenants.filter((t) => t.kind === 'PENDING_CONFIRM').length, 0),
    0,
  );

  // Abre el detalle de la MISMA celda con los datos frescos tras una acción.
  const selectedRow = selected ? (rows.find((r) => r.organizationId === selected.row.organizationId) ?? selected.row) : null;
  const selectedCell = selected && selectedRow ? selectedRow.cells[selected.app.id] : undefined;

  async function runRetry(tenant: MatrixTenant) {
    if (!tenant.request?.id) return;
    try {
      await retry.mutateAsync({ p_request_id: tenant.request.id });
      toast.success('Reintento habilitado', `${tenant.tenantName}: el alta vuelve a quedar lista para ejecutarse.`);
    } catch (e) {
      toast.error('No se pudo reintentar el alta', businessErrorMessage(e));
    }
  }

  const appOptions = apps.map((a) => ({ value: a.code, label: a.name }));

  return (
    <Card
      title="Cuentas en cada app"
      description="Una fila por cuenta cliente con al menos un tenant; una columna por app. Abre una celda para ver el detalle y sus acciones."
    >
      <PendingConfirmNotice count={pendingConfirm} />
      <SearchBar
        value={list.search}
        onChange={list.setSearch}
        placeholder="Buscar por cuenta o tenant…"
        right={
          <SelectInput
            label="App"
            labelDisplay="inline"
            size="sm"
            selectClassName="w-auto"
            placeholder="Todas las apps"
            value={appFilter}
            onChange={(v) => list.setExtra('app', v || null)}
            options={appOptions}
          />
        }
      />
      <div className="border-b border-border px-5 py-3">
        <StatusTabs
          label="Estado en la app"
          value={list.filter}
          onChange={list.setFilter}
          options={MATRIX_FILTERS.map((f) => ({
            id: f,
            label: MATRIX_FILTER_LABEL[f],
            count: filterCount(rows, f, appId, list.search),
          }))}
        />
      </div>

      {loading ? (
        <LoadingState label="Leyendo cuentas y altas…" />
      ) : error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : rows.length === 0 ? (
        <EmptyState title="Sin cuentas con tenants" description="Ninguna cuenta cliente visible para tu perfil tiene tenants en la suite." />
      ) : visible.length === 0 ? (
        <EmptyState title="Sin resultados" description="Ninguna cuenta coincide con la búsqueda o el filtro." illustration="search" />
      ) : (
        <DataTable
          label="Cuentas por app"
          scrollRegion
          minWidth={180 + apps.length * 100}
          columns={['Cuenta', ...apps.map((a) => a.name)]}
        >
          {visible.map((row) => (
            <tr key={row.organizationId} data-account={row.organizationName}>
              <th scope="row" className="ebim-td sticky left-0 z-[1] min-w-[170px] bg-card text-left align-middle font-semibold">
                <Link to={`/organizations/${row.organizationId}`} className="hover:text-accent-deep hover:underline">
                  {row.organizationName}
                </Link>
              </th>
              {apps.map((app) => {
                const cell = row.cells[app.id];
                const tenant = cell?.primary;
                if (!cell || !tenant) {
                  return (
                    <td key={app.id} className="ebim-td text-center align-middle text-caption text-muted">
                      <span aria-hidden>—</span>
                      <span className="sr-only">Sin tenant en {app.name}</span>
                    </td>
                  );
                }
                return (
                  <td key={app.id} className="ebim-td p-1 text-center align-middle">
                    <button
                      type="button"
                      className="flex w-full min-w-[84px] justify-center rounded-md p-1.5 transition-colors duration-fast hover:bg-hover"
                      data-cell-kind={tenant.kind}
                      aria-label={`${row.organizationName} en ${app.name}: ${CELL[tenant.kind].label}. Ver detalle`}
                      onClick={() => setSelected({ row, app })}
                    >
                      <CellSummary
                        tenant={tenant}
                        extra={cell.tenants.length - 1}
                        finance={finance}
                        flags={channelFlags(healthById.get(app.id))}
                      />
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </DataTable>
      )}

      <DetailDrawer
        open={Boolean(selected && selectedCell)}
        size="lg"
        title={selected ? `${selected.row.organizationName} · ${selected.app.name}` : ''}
        subtitle="Estado de la cuenta en la app y acciones disponibles"
        onClose={() => setSelected(null)}
        actions={
          selected ? (
            <Link to={`/apps/${selected.app.code}`} className="ebim-btn-secondary">
              Ficha de {selected.app.name}
            </Link>
          ) : null
        }
      >
        {selected && selectedCell ? (
          <div className="flex flex-col gap-6">
            {selectedCell.tenants.map((t) => {
              const flags = channelFlags(healthById.get(selected.app.id));
              const modules = moduleState(flags.modules, t.moduleSync);
              const canExecute = access.canForProduct('platform.provisioning.execute', t.productId);
              return (
                <section key={t.tenantId} aria-labelledby={`t-${t.tenantId}`} data-drawer-tenant={t.tenantId}>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h3 id={`t-${t.tenantId}`} className="text-body font-semibold text-fg">
                      {t.tenantName}
                    </h3>
                    <Badge tone={CELL[t.kind].tone} dot>
                      {CELL[t.kind].label}
                    </Badge>
                  </div>
                  <p className="mb-3 text-compact text-fg-2">{CELL[t.kind].help}</p>
                  {t.kind === 'PENDING_CONFIRM' ? (
                    <p className="mb-3 rounded-md bg-warn-soft px-3 py-2 text-compact text-fg" role="note">
                      {PENDING_CONFIRM_EXPLANATION}
                    </p>
                  ) : null}
                  <DetailList
                    items={[
                      ['Estado en MasterAdmin', t.tenantStatusLabel],
                      [
                        'Alta en la app',
                        t.request ? (
                          <span>
                            {t.requestStatusLabel}
                            {t.request.status === 'FAILED' && t.request.last_error_code ? (
                              <span className="block text-caption text-danger">{providerErrorLabel(t.request.last_error_code)}</span>
                            ) : null}
                            <span className="block text-caption text-muted">
                              Intento {t.request.attempt_count ?? 0} de {t.request.max_attempts ?? 0}
                              {t.request.completed_at ? ` · completada el ${formatDateTime(t.request.completed_at)}` : ''}
                            </span>
                          </span>
                        ) : (
                          'Sin alta registrada'
                        ),
                      ],
                      [
                        'Contrato',
                        !finance ? (
                          <span className="text-muted">Visible con permisos de finanzas</span>
                        ) : t.subscriptionId ? (
                          <Link to={`/subscriptions/${t.subscriptionId}`} className="ebim-link">
                            <Badge tone={SUBSCRIPTION_STATUS_TONE[t.subscriptionStatus ?? ''] ?? 'neutral'}>
                              {t.subscriptionStatus ? SUBSCRIPTION_STATUS_LABEL[t.subscriptionStatus] ?? t.subscriptionStatus : 'Ver contrato'}
                            </Badge>
                          </Link>
                        ) : (
                          'Sin contrato'
                        ),
                      ],
                      ['Módulos habilitados', <Badge key="m" tone={modules.tone}>{modules.label}</Badge>],
                      ['Uso', flags.usage ? 'Activo' : <span key="u" className="text-muted">No activo: la app no reporta consumo</span>],
                      [
                        'Suspensión en la app',
                        <span key="s" className="text-muted">No disponible: no existe el canal por app</span>,
                      ],
                    ]}
                  />
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link to={`/tenants/${t.tenantId}`} className="ebim-btn-ghost ebim-btn-sm">
                      Ver tenant
                    </Link>
                    {t.kind === 'PENDING_CONFIRM' ? (
                      <ConfirmActiveButton
                        confirm={confirmActive}
                        target={{ tenantId: t.tenantId, tenantName: t.tenantName }}
                        onBeforeOpen={() => setSelected(null)}
                      />
                    ) : null}
                    {t.canRetry && canExecute ? (
                      <button
                        type="button"
                        className="ebim-btn-secondary ebim-btn-sm"
                        disabled={retry.isPending}
                        onClick={() => void runRetry(t)}
                      >
                        Reintentar alta
                      </button>
                    ) : null}
                    {t.tenantStatus === 'ACTIVE' && perms.canManagePlatform ? (
                      <button
                        type="button"
                        className="ebim-btn-ghost ebim-btn-sm"
                        onClick={() => {
                          setSelected(null);
                          setAction({ kind: 'SUSPEND', tenant: t, organizationId: selected.row.organizationId, appName: selected.app.name });
                        }}
                      >
                        Suspender
                      </button>
                    ) : null}
                    {t.tenantStatus === 'SUSPENDED' && perms.canManagePlatform ? (
                      <button
                        type="button"
                        className="ebim-btn-primary ebim-btn-sm"
                        onClick={() => {
                          setSelected(null);
                          setAction({ kind: 'RESUME', tenant: t, organizationId: selected.row.organizationId, appName: selected.app.name });
                        }}
                      >
                        Reactivar
                      </button>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}
      </DetailDrawer>

      {confirmActive.dialog}

      <LifecycleDialog
        open={Boolean(action)}
        mode={action?.kind ?? 'SUSPEND'}
        subject={action?.tenant.tenantName ?? ''}
        organizationId={action?.organizationId}
        targets={
          action
            ? [{ tenantId: action.tenant.tenantId, tenantName: action.tenant.tenantName, productName: action.appName, tenantStatus: action.tenant.tenantStatus }]
            : []
        }
        onClose={() => setAction(null)}
      />
    </Card>
  );
}
