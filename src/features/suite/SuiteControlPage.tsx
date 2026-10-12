import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useLifecycleJobRuns, useTenantLifecycle, useTenantLifecycleSettings, useTenantSuspensions,
} from '@/services/queries';
import {
  useRequestTenantResume, useRequestTenantSuspension, useRunTenantLifecycleCycle, useSetTenantLifecycleSettings,
} from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { SectionTabs, StatusTabs } from '@/components/ui/SectionTabs';
import {
  Badge, Card, DataTable, EmptyState, ErrorState, KpiTile, LoadingState, PageContainer, SearchBar,
} from '@/components/ui/primitives';
import { Avatar } from '@/components/ui/Avatar';
import { SwitchField } from '@/components/ui/fields';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { RevokeWithReasonDialog } from '@/components/ui/RevokeWithReasonDialog';
import { useToast } from '@/components/ui/toast-context';
import { KpiStrip } from '@/features/billing/financeUi';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import {
  ATTENTION_STAGES, JOB_LABEL, JOB_OUTCOME, RESUME_CAUSE, STAGE, SUSPENSION_CAUSE, buildSuiteMatrix, cycleSummary,
  deliveryOf, parseCycleResult, stageOf, suiteKpis, suiteProducts,
  type LifecycleCycleResult, type TenantLifecycleRow,
} from './suiteLifecycleModel';

/**
 * Centro de la suite: la vista desde la que EBIM opera TODAS sus apps.
 *
 * Una fila por cuenta, una columna por app (EWM, TMS, eSupplier, …) y, en
 * cada celda, el tenant con su etapa de ciclo de vida: al día, en gracia,
 * suspensión sugerida/programada o suspendido (por impago o a mano), y si la
 * app ya recibió y aplica ese estado.
 *
 * Las reglas viven en la base (`run_tenant_lifecycle_cycle`, triggers de pago,
 * RLS). Esta pantalla las muestra y ofrece las acciones; un botón oculto no
 * protege nada y uno visible no autoriza nada.
 */

type Action =
  | { kind: 'suspend'; row: TenantLifecycleRow }
  | { kind: 'resume'; row: TenantLifecycleRow }
  | { kind: 'run' }
  | null;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function SuiteControlPage() {
  const lifecycle = useTenantLifecycle();
  const settings = useTenantLifecycleSettings();
  const perms = usePermissions();
  const run = useRunTenantLifecycleCycle();
  const [result, setResult] = useState<LifecycleCycleResult | null>(null);
  const [action, setAction] = useState<Action>(null);

  const rows = lifecycle.data ?? [];
  const kpis = useMemo(() => suiteKpis(rows), [rows]);
  const autoSuspend = Boolean(settings.data?.auto_suspend_enabled);

  async function runCycle(dryRun: boolean) {
    const data = await run.mutateAsync({ p_dry_run: dryRun });
    setResult(parseCycleResult(data));
  }

  return (
    <PageContainer
      title="Centro de la suite"
      description="Todas las apps de EBIM en un solo lugar: cada cliente, cada app, su etapa de cobranza y si la app ya aplica lo que MasterAdmin decidió."
      actions={
        perms.canManagePlatform ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="ebim-btn-secondary"
              disabled={run.isPending}
              onClick={() => void runCycle(true).catch(() => undefined)}
            >
              Simular ciclo
            </button>
            <button type="button" className="ebim-btn-primary" disabled={run.isPending} onClick={() => setAction({ kind: 'run' })}>
              Ejecutar ciclo ahora
            </button>
          </div>
        ) : null
      }
    >
      {rows.length > 0 ? (
        <KpiStrip label="Estado de la suite">
          <KpiTile
            label="Tenants activos"
            value={formatNumber(kpis.active)}
            footer={`${formatNumber(kpis.accounts)} cuentas en ${formatNumber(kpis.apps)} apps.`}
          />
          <KpiTile
            label="En gracia"
            value={formatNumber(kpis.inGrace)}
            footer="Vencidos, todavía dentro de su gracia."
            tone={kpis.inGrace > 0 ? 'warn' : 'neutral'}
          />
          <KpiTile
            label="Por suspender"
            value={formatNumber(kpis.toSuspend)}
            footer={autoSuspend ? 'El ciclo diario corta los programados.' : 'Corte automático apagado: decide una persona.'}
            tone={kpis.toSuspend > 0 ? 'danger' : 'neutral'}
          />
          <KpiTile
            label="Suspendidos"
            value={formatNumber(kpis.suspendedNonPayment + kpis.suspendedManual)}
            footer={`${formatNumber(kpis.suspendedNonPayment)} por impago · ${formatNumber(kpis.suspendedManual)} manuales.`}
            tone={kpis.suspendedNonPayment + kpis.suspendedManual > 0 ? 'danger' : 'ok'}
          />
        </KpiStrip>
      ) : null}

      {result ? (
        <div role="status" className="mb-4 rounded-card border border-border bg-card px-4 py-3 text-compact text-fg">
          <span className="font-semibold">{cycleSummary(result)}</span>
          <CycleLists result={result} />
        </div>
      ) : null}
      {run.error ? (
        <div role="alert" className="mb-4 rounded-card border border-danger bg-danger-soft px-4 py-3 text-compact text-danger">
          {errorText(run.error)}
        </div>
      ) : null}

      {lifecycle.isLoading ? (
        <LoadingState label="Cargando la suite…" />
      ) : lifecycle.error ? (
        <ErrorState error={lifecycle.error} onRetry={() => void lifecycle.refetch?.()} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Todavía no hay tenants en la suite"
            description="Un tenant aparece aquí cuando se vende una app desde «Nueva venta»."
          />
        </Card>
      ) : (
        <SectionTabs
          tabs={[
            { id: 'matriz', label: 'Matriz de la suite', content: <SuiteMatrix rows={rows} /> },
            {
              id: 'cobranza',
              label: 'Cobranza y cortes',
              count: rows.filter((r) => ATTENTION_STAGES.includes(stageOf(r))).length,
              content: (
                <CollectionsTab
                  rows={rows}
                  canAct={perms.canManagePlatform}
                  onSuspend={(row) => setAction({ kind: 'suspend', row })}
                  onResume={(row) => setAction({ kind: 'resume', row })}
                />
              ),
            },
            { id: 'historial', label: 'Historial de suspensiones', content: <SuspensionHistory rows={rows} /> },
            {
              id: 'politica',
              label: 'Política y jobs',
              content: <PolicyTab isSuperAdmin={perms.isSuperAdmin} />,
              hidden: !(perms.canManagePlatform || perms.canReadFinance),
            },
          ]}
        />
      )}

      <TenantActionDialogs action={action} onClose={() => setAction(null)} />
      <ConfirmDialog
        open={action?.kind === 'run'}
        title="Ejecutar el ciclo de vida ahora"
        message={
          autoSuspend
            ? 'Se recalculan las alertas, se SUSPENDEN los tenants con suspensión programada y se reactivan los que ya pagaron. Cada cambio llega a su app en la próxima sincronización.'
            : 'Se recalculan las alertas y se reactivan los tenants que ya pagaron. El corte automático está apagado: nadie será suspendido.'
        }
        confirmLabel="Ejecutar ciclo"
        tone={autoSuspend ? 'danger' : 'primary'}
        busy={run.isPending}
        onConfirm={() => runCycle(false).then(() => setAction(null), () => setAction(null))}
        onCancel={() => setAction(null)}
      />
    </PageContainer>
  );
}

function CycleLists({ result }: { result: LifecycleCycleResult }) {
  const groups = [
    { label: 'Suspendidos', items: result.suspended },
    { label: 'Reactivados', items: result.resumed },
    { label: result.dry_run ? 'Cumplen la regla de suspensión' : 'Esperan el corte automático', items: result.pending_suspensions },
    { label: 'Reactivaciones pendientes', items: result.pending_resumes },
  ].filter((g) => g.items.length > 0);
  if (groups.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-caption text-muted">
      {groups.map((g) => (
        <li key={g.label}>
          <span className="font-semibold text-fg-2">{g.label}:</span>{' '}
          {g.items.map((i) => `${i.tenant} (${i.product})`).join(', ')}
        </li>
      ))}
    </ul>
  );
}

/* ==========================================================================
   Matriz cuenta × app
   ========================================================================== */

function SuiteMatrix({ rows }: { rows: TenantLifecycleRow[] }) {
  const products = useMemo(() => suiteProducts(rows), [rows]);
  const matrix = useMemo(() => buildSuiteMatrix(rows), [rows]);
  const { term, setTerm, filtered } = useSearchFilter(matrix, (m) => [
    m.organizationName,
    m.managingOrganizationName,
    ...Object.values(m.cells).flat().map((r) => r.tenant_name),
  ]);

  return (
    <Card>
      <SearchBar value={term} onChange={setTerm} placeholder="Buscar cuenta o tenant…" />
      <StageLegend />
      {filtered.length === 0 ? (
        <EmptyState title="Ninguna cuenta coincide" description="Prueba con otra búsqueda." />
      ) : (
        <DataTable label="Matriz de la suite: cuentas por app" columns={['Cuenta', ...products.map((p) => p.name)]}>
          {filtered.map((m) => (
            <tr key={m.organizationId}>
              <td className="ebim-td">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={m.organizationName} />
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-fg">{m.organizationName}</div>
                    {m.managingOrganizationName ? (
                      <div className="truncate text-caption text-muted">Vía {m.managingOrganizationName}</div>
                    ) : null}
                  </div>
                </div>
              </td>
              {products.map((p) => (
                <td key={p.code} className="ebim-td">
                  {(m.cells[p.code] ?? []).length === 0 ? (
                    <span className="text-caption text-disabled" aria-label="Sin contratar">—</span>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {(m.cells[p.code] ?? []).map((r) => (
                        <li key={r.tenant_id}>
                          <TenantChip row={r} />
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </DataTable>
      )}
    </Card>
  );
}

function StageLegend() {
  const order = ['CURRENT', 'IN_GRACE', 'SUSPENSION_SUGGESTED', 'SUSPENSION_SCHEDULED', 'SUSPENDED_NON_PAYMENT', 'SUSPENDED_MANUAL'] as const;
  return (
    <ul className="flex flex-wrap gap-2 px-4 pb-3" aria-label="Leyenda de etapas">
      {order.map((s) => (
        <li key={s}>
          <Badge tone={STAGE[s].tone} dot title={STAGE[s].help}>
            {STAGE[s].label}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function TenantChip({ row }: { row: TenantLifecycleRow }) {
  const stage = STAGE[stageOf(row)];
  const delivery = deliveryOf(row);
  const title = `${row.tenant_name ?? ''} · ${stage.label}. ${stage.help} App: ${delivery.label}. ${delivery.detail}`;
  return (
    <Link to={`/tenants/${row.tenant_id}`} title={title} className="inline-flex flex-col gap-0.5 rounded-field hover:underline">
      <Badge tone={stage.tone} dot>
        {stage.short}
      </Badge>
      <span className="text-caption text-muted">{delivery.label}</span>
    </Link>
  );
}

/* ==========================================================================
   Cobranza y cortes
   ========================================================================== */

type CollectionsFilter = 'ATTENTION' | 'SUSPENDED' | 'ALL';

function CollectionsTab({
  rows,
  canAct,
  onSuspend,
  onResume,
}: {
  rows: TenantLifecycleRow[];
  canAct: boolean;
  onSuspend: (row: TenantLifecycleRow) => void;
  onResume: (row: TenantLifecycleRow) => void;
}) {
  const [filter, setFilter] = useState<CollectionsFilter>('ATTENTION');
  const { term, setTerm, filtered } = useSearchFilter(rows, (r) => [
    r.tenant_name, r.organization_name, r.product_short_name, STAGE[stageOf(r)].label,
  ]);
  const matches = (r: TenantLifecycleRow, f: CollectionsFilter) => {
    const s = stageOf(r);
    if (f === 'ATTENTION') return ATTENTION_STAGES.includes(s);
    if (f === 'SUSPENDED') return s === 'SUSPENDED_NON_PAYMENT' || s === 'SUSPENDED_MANUAL';
    return true;
  };
  const visible = filtered.filter((r) => matches(r, filter));

  return (
    <Card>
      <SearchBar
        value={term}
        onChange={setTerm}
        placeholder="Buscar tenant, cuenta o app…"
        right={
          <StatusTabs
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'ATTENTION', label: 'Requieren atención', count: filtered.filter((r) => matches(r, 'ATTENTION')).length },
              { id: 'SUSPENDED', label: 'Suspendidos', count: filtered.filter((r) => matches(r, 'SUSPENDED')).length },
              { id: 'ALL', label: 'Todos', count: filtered.length },
            ]}
          />
        }
      />
      {visible.length === 0 ? (
        <EmptyState
          title={filter === 'ATTENTION' ? 'Toda la suite está al día' : 'Ningún tenant coincide'}
          description={
            filter === 'ATTENTION'
              ? 'Ningún tenant tiene deuda vencida ni está suspendido.'
              : 'Prueba con otra búsqueda o cambia de filtro.'
          }
        />
      ) : (
        <DataTable
          label="Cobranza y cortes por tenant"
          columns={['Tenant', 'Etapa', 'Deuda vencida', 'Entrega a la app', { label: 'Acciones', srOnly: true }]}
        >
          {visible.map((r) => {
            const s = stageOf(r);
            const stage = STAGE[s];
            const delivery = deliveryOf(r);
            const suspended = s === 'SUSPENDED_NON_PAYMENT' || s === 'SUSPENDED_MANUAL';
            return (
              <tr key={r.tenant_id}>
                <td className="ebim-td">
                  <Link to={`/tenants/${r.tenant_id}`} className="block min-w-0 hover:underline">
                    <div className="truncate font-semibold text-fg">{r.tenant_name}</div>
                    <div className="truncate text-caption text-muted">
                      {r.organization_name} · {r.product_short_name}
                    </div>
                  </Link>
                </td>
                <td className="ebim-td">
                  <Badge tone={stage.tone} dot title={stage.help}>
                    {stage.label}
                  </Badge>
                  {r.suspended_at ? (
                    <div className="mt-1 text-caption text-muted">Desde {formatDate(r.suspended_at)}</div>
                  ) : null}
                </td>
                <td className="ebim-td text-compact">
                  {(r.overdue_invoices ?? 0) === 0 ? (
                    <span className="text-muted">Sin deuda vencida</span>
                  ) : (
                    <>
                      <div className="whitespace-nowrap font-semibold tabular-nums">
                        {r.overdue_balance !== null ? formatMoney(r.overdue_balance, r.overdue_currency) : 'Varias monedas'}
                      </div>
                      <div className="whitespace-nowrap text-caption text-muted">
                        {r.overdue_invoices} factura(s) · {r.days_past_due} día(s) de atraso
                      </div>
                      {r.grace_ends_on ? (
                        <div className="whitespace-nowrap text-caption text-muted">
                          Gracia {r.grace_expired ? 'vencida el' : 'hasta el'} {formatDate(r.grace_ends_on)}
                        </div>
                      ) : null}
                    </>
                  )}
                </td>
                <td className="ebim-td">
                  <Badge tone={delivery.tone} title={delivery.detail}>
                    {delivery.label}
                  </Badge>
                </td>
                <td className="ebim-td whitespace-nowrap text-right">
                  {canAct && r.tenant_status === 'ACTIVE' ? (
                    <button type="button" className="ebim-btn-secondary ebim-btn-sm" onClick={() => onSuspend(r)}>
                      Suspender
                    </button>
                  ) : null}
                  {canAct && suspended ? (
                    <button type="button" className="ebim-btn-secondary ebim-btn-sm" onClick={() => onResume(r)}>
                      Reactivar
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </Card>
  );
}

function TenantActionDialogs({ action, onClose }: { action: Action; onClose: () => void }) {
  const toast = useToast();
  const suspend = useRequestTenantSuspension();
  const resume = useRequestTenantResume();
  const row = action && action.kind !== 'run' ? action.row : null;

  return (
    <>
      <RevokeWithReasonDialog
        open={action?.kind === 'suspend'}
        title={`Suspender ${row?.tenant_name ?? ''}`}
        description="La suspensión manual queda auditada y solo una persona la levanta: un pago no la reactiva. La app recibe el corte en la próxima sincronización."
        submitLabel="Suspender"
        busy={suspend.isPending}
        onCancel={onClose}
        onSubmit={async (reason) => {
          if (!row?.tenant_id) return;
          await suspend.mutateAsync({ p_tenant_id: row.tenant_id, p_reason: reason });
          toast.success('Tenant suspendido', row.tenant_name ?? '');
          onClose();
        }}
      />
      <ConfirmDialog
        open={action?.kind === 'resume'}
        title={`Reactivar ${row?.tenant_name ?? ''}`}
        message={
          row?.suspension_cause === 'NON_PAYMENT' && row.grace_expired
            ? 'Este tenant todavía tiene deuda fuera de gracia. Reactivarlo a mano queda auditado; si la política sigue vigente, el próximo ciclo puede volver a suspenderlo.'
            : 'El tenant vuelve a ACTIVE y la app recibe la reactivación en la próxima sincronización. Queda auditado.'
        }
        confirmLabel="Reactivar"
        tone="primary"
        busy={resume.isPending}
        onCancel={onClose}
        onConfirm={async () => {
          if (!row?.tenant_id) return;
          try {
            await resume.mutateAsync({ p_tenant_id: row.tenant_id });
            toast.success('Tenant reactivado', row.tenant_name ?? '');
          } catch (e) {
            toast.error('No se pudo reactivar', errorText(e));
          }
          onClose();
        }}
      />
    </>
  );
}

/* ==========================================================================
   Historial de suspensiones
   ========================================================================== */

function SuspensionHistory({ rows }: { rows: TenantLifecycleRow[] }) {
  const history = useTenantSuspensions();
  const productOf = useMemo(() => new Map(rows.map((r) => [r.tenant_id, r.product_short_name])), [rows]);

  if (history.isLoading) return <LoadingState label="Cargando el historial…" />;
  if (history.error) return <ErrorState error={history.error} onRetry={() => void history.refetch?.()} />;
  const items = history.data ?? [];

  return (
    <Card>
      {items.length === 0 ? (
        <EmptyState title="Sin suspensiones" description="Cada suspensión y cómo terminó aparecerá aquí." />
      ) : (
        <DataTable label="Historial de suspensiones" columns={['Tenant', 'Causa', 'Suspendido', 'Terminó', 'Motivo']}>
          {items.map((s) => {
            const tenant = (s as { tenant?: { name?: string | null } | null }).tenant;
            return (
              <tr key={s.id}>
                <td className="ebim-td">
                  <Link to={`/tenants/${s.tenant_id}`} className="block min-w-0 hover:underline">
                    <div className="truncate font-semibold text-fg">{tenant?.name ?? '—'}</div>
                    <div className="truncate text-caption text-muted">{productOf.get(s.tenant_id) ?? ''}</div>
                  </Link>
                </td>
                <td className="ebim-td">
                  <Badge tone={s.cause === 'NON_PAYMENT' ? 'danger' : 'warn'}>{SUSPENSION_CAUSE[s.cause] ?? s.cause}</Badge>
                </td>
                <td className="ebim-td whitespace-nowrap text-compact">{formatDateTime(s.suspended_at)}</td>
                <td className="ebim-td text-compact">
                  {s.resumed_at ? (
                    <>
                      <div className="whitespace-nowrap">{formatDateTime(s.resumed_at)}</div>
                      <div className="text-caption text-muted">{RESUME_CAUSE[s.resume_cause ?? ''] ?? s.resume_cause}</div>
                    </>
                  ) : (
                    <Badge tone="danger" dot>
                      Vigente
                    </Badge>
                  )}
                </td>
                <td className="ebim-td text-compact">{s.reason}</td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </Card>
  );
}

/* ==========================================================================
   Política y jobs
   ========================================================================== */

function PolicyTab({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const settings = useTenantLifecycleSettings();
  const jobs = useLifecycleJobRuns();
  const save = useSetTenantLifecycleSettings();
  const toast = useToast();
  const s = settings.data;
  const last = parseCycleResult(s?.last_cycle_result);

  async function toggle(args: Parameters<typeof save.mutateAsync>[0], label: string) {
    try {
      await save.mutateAsync(args);
      toast.success('Política actualizada', label);
    } catch (e) {
      toast.error('No se pudo cambiar la política', errorText(e));
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card
        title="Política del ciclo de vida"
        description={
          isSuperAdmin
            ? 'Interruptores globales. Cada suscripción conserva además su propia regla de corte (perfil de cobranza).'
            : 'Solo el super admin cambia estos interruptores.'
        }
      >
        {settings.isLoading ? (
          <LoadingState label="Cargando la política…" />
        ) : settings.error ? (
          <ErrorState error={settings.error} onRetry={() => void settings.refetch?.()} />
        ) : s ? (
          <div className="space-y-5 px-4 pb-4">
            <SwitchField
              label="Suspensión automática por impago"
              hint="El ciclo diario suspende los tenants cuya gracia terminó y cuya suscripción tiene «suspender automáticamente»."
              checked={s.auto_suspend_enabled}
              disabled={!isSuperAdmin || save.isPending}
              onChange={(v) => void toggle({ p_auto_suspend_enabled: v }, v ? 'Corte automático habilitado' : 'Corte automático apagado')}
            />
            <SwitchField
              label="Reactivación automática al pagar"
              hint="Al confirmarse el pago de la deuda fuera de gracia, el tenant suspendido por impago vuelve a ACTIVE en el acto."
              checked={s.auto_resume_enabled}
              disabled={!isSuperAdmin || save.isPending}
              onChange={(v) => void toggle({ p_auto_resume_enabled: v }, v ? 'Reactivación automática habilitada' : 'Reactivación automática apagada')}
            />
            <SwitchField
              label="Sincronización programada con las apps"
              hint="Cada 5 minutos emite, envía y verifica los entitlements (incluido el estado activo/suspendido) en cada app."
              checked={s.entitlement_sync_enabled}
              disabled={!isSuperAdmin || save.isPending}
              onChange={(v) => void toggle({ p_entitlement_sync_enabled: v }, v ? 'Sincronización programada habilitada' : 'Sincronización programada apagada')}
            />
            <SwitchField
              label="Cobro automático con tarjeta guardada"
              hint="Cada día a las 08:00 (Lima) cobra las facturas pendientes con tarjeta guardada. Culqi LIVE sigue bloqueado por variable de entorno."
              checked={s.autocharge_enabled}
              disabled={!isSuperAdmin || save.isPending}
              onChange={(v) => void toggle({ p_autocharge_enabled: v }, v ? 'Cobro automático habilitado' : 'Cobro automático apagado')}
            />
            <div className="rounded-card border border-border bg-sunken px-4 py-3 text-compact">
              <div className="font-semibold text-fg">Último ciclo</div>
              {s.last_cycle_at && last ? (
                <>
                  <div className="text-muted">{formatDateTime(s.last_cycle_at)}</div>
                  <div className="mt-1">{cycleSummary(last)}</div>
                </>
              ) : (
                <div className="text-muted">Todavía no se ha ejecutado. Corre cada día a las 06:00 (Lima).</div>
              )}
            </div>
          </div>
        ) : (
          <EmptyState title="Sin política" description="No tienes acceso a la política del ciclo de vida." />
        )}
      </Card>

      <Card title="Jobs programados" description="Lo que pg_cron ejecutó. «Sin configurar» = faltan los secretos de Vault del entorno.">
        {jobs.isLoading ? (
          <LoadingState label="Cargando la bitácora…" />
        ) : jobs.error ? (
          <ErrorState error={jobs.error} onRetry={() => void jobs.refetch?.()} />
        ) : (jobs.data ?? []).length === 0 ? (
          <EmptyState title="Sin ejecuciones todavía" description="La primera aparece tras el próximo disparo programado." />
        ) : (
          <DataTable label="Ejecuciones programadas" columns={['Job', 'Resultado', 'Cuándo']}>
            {(jobs.data ?? []).map((j) => {
              const outcome = JOB_OUTCOME[j.outcome] ?? { label: j.outcome, tone: 'neutral' as const };
              return (
                <tr key={j.id}>
                  <td className="ebim-td text-compact">{JOB_LABEL[j.job] ?? j.job}</td>
                  <td className="ebim-td">
                    <Badge tone={outcome.tone} dot>
                      {outcome.label}
                    </Badge>
                  </td>
                  <td className="ebim-td whitespace-nowrap text-compact">{formatDateTime(j.ran_at)}</td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>
    </div>
  );
}
