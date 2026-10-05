import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBillingAlerts } from '@/services/queries';
import { useRenewalPipeline } from '@/services/financeRead';
import {
  useRefreshBillingAlerts, useApplyDueSuspensions, useSetAlertStatus, useAutocharge,
  type AutochargeSummary,
} from '@/services/mutations';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge, KpiTile,
} from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { formatDate, formatMoney, formatNumber, sumByCurrency } from '@/lib/format';
import { fromQuery } from '@/features/executive/dataState';
import { InfoNote } from './listing';
import { KpiStrip, NativeAmountTile } from './financeUi';
import { RENEWAL_WINDOWS, type RenewalWindow } from '@/features/executive/kpis';
import { ATTEMPT_STATUS_LABEL, ATTEMPT_STATUS_TONE } from './autochargeSummary';

/**
 * Renovaciones y alertas de cobranza (P05).
 *
 * Tres tipos de acción, deliberadamente SEPARADAS y rotuladas:
 *
 *   REVISAR   «Visto» / «Resolver» una alerta: sólo cambian la alerta.
 *   CALCULAR  «Recalcular alertas» materializa el trabajo pendiente. Es
 *             idempotente y NO cambia el estado de ningún tenant.
 *   EJECUTAR  «Aplicar suspensiones»: la única que cambia tenants, y sólo donde
 *             la política tiene `auto_suspend`. La solicitud al producto va en
 *             DRY_RUN (simulación); el cambio de estado en el Control Plane es real.
 *
 * Un botón que calcula y de paso suspende es un botón que nadie se atreve a pulsar.
 */

const ALERT_LABEL: Record<string, string> = {
  REQUEST_DOCUMENT: 'Solicitar OS/OC',
  RENEWAL_NOTICE: 'Aviso de renovación',
  PAYMENT_DUE: 'Factura por vencer',
  PAST_DUE: 'Factura vencida',
  GRACE_ENDING: 'Fin de gracia',
  SUSPENSION_DUE: 'Suspensión pendiente',
  PAYMENT_FAILURE: 'Cobro fallido',
  DOCUMENT_EXPIRING: 'Documento por vencer',
};

const SEVERITY_LABEL: Record<string, string> = {
  INFO: 'Informativa',
  WARNING: 'Advertencia',
  CRITICAL: 'Crítica',
};
const SEVERITY_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'info'> = {
  INFO: 'info',
  WARNING: 'warn',
  CRITICAL: 'danger',
};

const METHOD_LABEL: Record<string, string> = {
  CULQI_CARD: 'Tarjeta (Culqi)',
  SERVICE_ORDER: 'Orden de Servicio',
  PURCHASE_ORDER: 'Orden de Compra',
  BANK_TRANSFER: 'Transferencia',
  MANUAL: 'Manual',
};

type Filter = 'ALL' | 'CRITICAL' | 'DOCUMENTS' | 'OVERDUE';

function parseWindow(value: string | null): RenewalWindow {
  const n = Number(value);
  return (RENEWAL_WINDOWS as readonly number[]).includes(n) ? (n as RenewalWindow) : 30;
}

function isWithin(days: number | null | undefined, windowDays: number): boolean {
  return days !== null && days !== undefined && days <= windowDays;
}

function countWithin(rows: ReadonlyArray<{ days_to_renewal: number | null }>, windowDays: number): number {
  return rows.filter((r) => isWithin(r.days_to_renewal, windowDays)).length;
}

export function RenewalsPage() {
  const alerts = useBillingAlerts('OPEN');
  const pipeline = useRenewalPipeline();
  const perms = usePermissions();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const windowDays = parseWindow(params.get('ventana'));

  const refresh = useRefreshBillingAlerts();
  const suspend = useApplyDueSuspensions();
  const setStatus = useSetAlertStatus();

  const [filter, setFilter] = useState<Filter>('ALL');
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const autocharge = useAutocharge();
  const [confirmCharges, setConfirmCharges] = useState(false);
  const [chargeSummary, setChargeSummary] = useState<AutochargeSummary | null>(null);

  const { term, setTerm, filtered } = useSearchFilter(alerts.data, (a) => [
    a.title,
    a.message,
    (a.subscriptions as { code: string } | null)?.code,
    (
      (a.subscriptions as { organizations: { display_name: string } | null } | null)?.organizations
    )?.display_name,
    a.alert_type,
  ]);

  const rows = filtered.filter((a) => {
    switch (filter) {
      case 'CRITICAL':
        return a.severity === 'CRITICAL';
      case 'DOCUMENTS':
        return a.alert_type === 'REQUEST_DOCUMENT' || a.alert_type === 'DOCUMENT_EXPIRING';
      case 'OVERDUE':
        return ['PAST_DUE', 'GRACE_ENDING', 'SUSPENSION_DUE'].includes(a.alert_type as string);
      default:
        return true;
    }
  });

  const all = pipeline.data ?? [];
  const openAlerts = alerts.data ?? [];
  const inWindow = all.filter((r) => isWithin(r.days_to_renewal, windowDays));
  const withoutMrr = inWindow.filter((r) => r.current_mrr === null || r.current_mrr === undefined).length;
  const withoutDate = all.filter((r) => r.renewal_on === null).length;

  const pipelineState = fromQuery(pipeline, { isEmpty: () => false });
  const pastDue = all.filter((r) => r.is_past_due).length;
  const inGrace = all.filter((r) => r.in_grace).length;
  const suspensionPending = all.filter((r) => r.suspension_pending).length;
  const atRisk = all.filter((r) => r.is_past_due || r.in_grace || r.suspension_pending).length;
  const critical = openAlerts.filter((a) => a.severity === 'CRITICAL').length;

  function setWindow(w: RenewalWindow) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (w === 30) next.delete('ventana');
        else next.set('ventana', String(w));
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  }

  async function doRefresh() {
    try {
      const created = await refresh.mutateAsync({});
      toast.success(
        'Alertas recalculadas',
        created === 0
          ? 'Nada nuevo: el cálculo es idempotente.'
          : `${created} alerta(s) nueva(s).`,
      );
    } catch (error) {
      toast.error('No se pudo recalcular', businessErrorMessage(error));
    }
  }

  async function doSuspend() {
    try {
      const result = (await suspend.mutateAsync({ p_mode: 'DRY_RUN' })) as {
        applied?: number;
        skipped?: number;
      } | null;
      toast.success(
        'Suspensiones registradas (producto en simulación)',
        `${result?.applied ?? 0} tenant(s) marcados como suspendidos en el Control Plane, con solicitud al producto en DRY_RUN; ${result?.skipped ?? 0} omitida(s) por política.`,
      );
    } catch (error) {
      toast.error('No se pudo suspender', businessErrorMessage(error));
    } finally {
      setConfirmSuspend(false);
    }
  }

  async function doRunCharges() {
    try {
      const summary = await autocharge.mutateAsync({ run: true });
      setChargeSummary(summary);
      toast.success(
        'Cobros pendientes ejecutados',
        `${summary.processed} procesada(s): ${summary.succeeded} cobrada(s), ${summary.failed} fallida(s), ${summary.skipped} omitida(s)${summary.review ? `, ${summary.review} en revisión` : ''}.`,
      );
    } catch (error) {
      toast.error('No se pudieron ejecutar los cobros', businessErrorMessage(error));
    } finally {
      setConfirmCharges(false);
    }
  }

  async function acknowledge(id: string) {
    try {
      await setStatus.mutateAsync({ p_alert_id: id, p_status: 'ACKNOWLEDGED' });
      toast.success('Alerta marcada como vista');
    } catch (error) {
      toast.error('No se pudo actualizar', businessErrorMessage(error));
    }
  }

  async function resolve(id: string) {
    try {
      await setStatus.mutateAsync({
        p_alert_id: id,
        p_status: 'RESOLVED',
        p_note: 'Resuelta manualmente desde la consola',
      });
      toast.success('Alerta resuelta');
    } catch (error) {
      toast.error('No se pudo resolver', businessErrorMessage(error));
    }
  }

  return (
    <PageContainer
      title="Renovaciones y alertas"
      description="Contratos que renuevan pronto y el trabajo de cobranza pendiente, calculado desde el perfil de cobro de cada suscripción."
      actions={
        perms.canManageCommercial ? (
          <>
            <button
              type="button"
              className="ebim-btn-secondary"
              onClick={() => void doRefresh()}
              disabled={refresh.isPending}
              title="Calcula alertas nuevas. No cambia ningún tenant."
            >
              {refresh.isPending ? 'Recalculando…' : 'Recalcular alertas'}
            </button>
            {perms.canReadFinance ? (
              <button
                type="button"
                className="ebim-btn-secondary"
                onClick={() => setConfirmCharges(true)}
                disabled={autocharge.isPending}
                title="Cobra con la tarjeta guardada las facturas que tocan según la política de reintentos."
              >
                {autocharge.isPending ? 'Cobrando…' : 'Ejecutar cobros pendientes'}
              </button>
            ) : null}
            {perms.canManagePlatform ? (
              // La acción destructiva no compite con las demás (A11): vive en el menú, al final y en rojo.
              <ActionMenu
                variant="page"
                label="Más acciones de renovaciones"
                items={[
                  {
                    label: 'Ejecutar suspensiones…',
                    tone: 'danger',
                    disabled: suspend.isPending,
                    onSelect: () => setConfirmSuspend(true),
                  },
                ]}
              />
            ) : null}
          </>
        ) : null
      }
    >
      <KpiStrip label="Indicadores de renovaciones y cobranza">
        <KpiTile
          label={`Renuevan en ${windowDays} días`}
          info="Contratos activos o con pago atrasado cuya próxima renovación cae en la ventana elegida, contada desde hoy."
          value={pipeline.data ? formatNumber(inWindow.length) : null}
          footer={
            withoutDate > 0
              ? `${formatNumber(withoutDate)} contrato(s) sin fecha de renovación no se cuentan`
              : 'Contratos con fecha de renovación en la ventana'
          }
          loading={pipeline.isLoading}
          error={pipeline.error}
          onRetry={() => void pipeline.refetch()}
        />
        <NativeAmountTile
          label="MRR en la ventana"
          info="MRR vigente de los contratos que renuevan en la ventana, por moneda. No es pronóstico de churn."
          amounts={sumByCurrency(inWindow, (r) => r.current_mrr, (r) => r.currency)}
          state={pipelineState}
          onRetry={() => void pipeline.refetch()}
          emptyLabel="Sin MRR vigente en la ventana"
          footer={withoutMrr > 0 ? `${formatNumber(withoutMrr)} contrato(s) sin recurrente vigente` : 'Por moneda; no es pronóstico de churn'}
        />
        <KpiTile
          label="Con riesgo de cobro"
          info="Toda la cartera, no sólo la ventana: factura vencida, en gracia o con suspensión pendiente."
          value={pipeline.data ? formatNumber(atRisk) : null}
          tone={suspensionPending > 0 ? 'danger' : atRisk > 0 ? 'warn' : 'neutral'}
          footer={`${formatNumber(pastDue)} con factura vencida · ${formatNumber(inGrace)} en gracia · ${formatNumber(suspensionPending)} por suspender`}
          loading={pipeline.isLoading}
          error={pipeline.error}
          onRetry={() => void pipeline.refetch()}
        />
        <KpiTile
          label="Alertas críticas abiertas"
          info="Alertas de cobranza abiertas con severidad crítica; el resto está en la bandeja."
          value={alerts.data ? formatNumber(critical) : null}
          tone={critical > 0 ? 'danger' : 'neutral'}
          footer={alerts.data ? `de ${formatNumber(openAlerts.length)} alertas abiertas` : undefined}
          loading={alerts.isLoading}
          error={alerts.error}
          onRetry={() => void alerts.refetch()}
        />
      </KpiStrip>

      {perms.canManageCommercial ? (
        <div className="mb-4">
          <InfoNote>
            <strong>Revisar</strong> (Visto, Resolver) y <strong>Recalcular</strong> sólo cambian alertas.{' '}
            {perms.canManagePlatform ? (
              <>
                <strong>Ejecutar suspensiones</strong> (en «Más acciones») cambia tenants a «Suspendido» en el Control
                Plane donde la política lo autoriza; la orden al producto se envía en <strong>DRY_RUN</strong>
                (simulación), así que el producto no se apaga desde aquí.
              </>
            ) : null}
          </InfoNote>
        </div>
      ) : null}

      {chargeSummary ? (
        <Card
          className="mb-4"
          title="Resultado de los cobros con tarjeta guardada"
          description="Facturas vencidas de suscripciones con pago automático autorizado, según la política de reintentos."
          actions={
            <button type="button" className="ebim-btn-ghost ebim-btn-sm" onClick={() => setChargeSummary(null)}>
              Cerrar
            </button>
          }
        >
          <div className="grid grid-cols-2 gap-3 border-b border-border p-4 sm:grid-cols-4" data-testid="autocharge-summary">
            {[
              ['Procesadas', chargeSummary.processed],
              ['Cobradas', chargeSummary.succeeded],
              ['Fallidas', chargeSummary.failed],
              ['Omitidas', chargeSummary.skipped],
              ...(chargeSummary.review ? [['En revisión', chargeSummary.review]] : []),
            ].map(([label, value]) => (
              <div key={label as string}>
                <div className="text-micro text-muted">{label}</div>
                <div className="mt-0.5 text-h2 tabular-nums text-fg">{formatNumber(Number(value))}</div>
              </div>
            ))}
          </div>
          {chargeSummary.results.length === 0 ? (
            <EmptyState title="Nada que cobrar" description="Ninguna factura con tarjeta guardada vence hoy ni tiene un reintento pendiente." />
          ) : (
            <DataTable label="Resultado de los cobros" columns={['Factura', 'Resultado', { label: 'Importe', align: 'right' }, 'Código']}>
              {chargeSummary.results.map((r, i) => (
                <tr key={`${r.invoice_number ?? 'x'}-${i}`}>
                  <td className="ebim-td whitespace-nowrap font-mono text-compact">{r.invoice_number ?? '—'}</td>
                  <td className="ebim-td">
                    <Badge tone={ATTEMPT_STATUS_TONE[r.status] ?? 'neutral'}>{ATTEMPT_STATUS_LABEL[r.status] ?? r.status}</Badge>
                  </td>
                  <td className="ebim-td ebim-num whitespace-nowrap">
                    {r.amount !== null && r.amount !== undefined ? formatMoney(Number(r.amount), r.currency ?? null) : '—'}
                  </td>
                  <td className="ebim-td font-mono text-compact">{r.error_code ?? '—'}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
      ) : null}

      <Card
        className="mb-4"
        title="Contratos que renuevan pronto"
        description="Contratos activos o con pago atrasado cuya próxima renovación cae dentro de los días elegidos, contados desde hoy."
      >
        <div className="border-b border-border px-5 py-2.5">
          <StatusTabs
            label="Renuevan en"
            value={String(windowDays)}
            onChange={(v) => setWindow(Number(v) as RenewalWindow)}
            options={RENEWAL_WINDOWS.map((w) => ({
              id: String(w),
              label: `${w} días`,
              count: pipeline.data ? countWithin(all, w) : undefined,
            }))}
          />
        </div>
        {pipeline.isLoading ? (
          <LoadingState />
        ) : pipeline.error ? (
          <ErrorState error={pipeline.error} onRetry={() => void pipeline.refetch()} />
        ) : inWindow.length === 0 ? (
          <EmptyState title={`Ningún contrato renueva en los próximos ${windowDays} días`} description="Amplía la ventana para ver más contratos." />
        ) : (
          <DataTable
            maxHeight={520}
            label="Contratos en la ventana"
            columns={['Suscripción', 'Cliente', 'Renueva', { label: 'Días', align: 'right' }, { label: 'MRR vigente', align: 'right' }, 'Método de cobro', 'Estado de cobro']}
          >
            {inWindow.map((r) => (
              <tr key={r.subscription_id as string}>
                <td className="ebim-td">
                  <Link
                    className="ebim-link block max-w-[190px] truncate whitespace-nowrap font-mono text-compact"
                    title={r.subscription_code ?? undefined}
                    to={`/subscriptions/${r.subscription_id}`}
                  >
                    {r.subscription_code}
                  </Link>
                  <span className="block max-w-[190px] truncate text-caption text-muted" title={r.tenant_name ?? undefined}>
                    {r.product_short_name}
                  </span>
                </td>
                <td className="ebim-td">
                  <span className="block max-w-[160px] truncate text-fg-2" title={r.billed_organization_name ?? undefined}>
                    {r.billed_organization_name}
                  </span>
                </td>
                <td className="ebim-td whitespace-nowrap text-compact">{formatDate(r.renewal_on)}</td>
                <td className={`ebim-td ebim-num ${Number(r.days_to_renewal) <= 7 ? 'font-semibold text-warn' : ''}`}>
                  {formatNumber(r.days_to_renewal)}
                </td>
                <td className="ebim-td ebim-num whitespace-nowrap">
                  {r.current_mrr === null ? (
                    <span className="inline-block max-w-[96px] whitespace-normal text-compact text-muted">Sin recurrente vigente</span>
                  ) : (
                    formatMoney(Number(r.current_mrr), r.currency)
                  )}
                </td>
                <td className="ebim-td text-compact text-fg-2">
                  {r.collection_method ? (METHOD_LABEL[r.collection_method] ?? r.collection_method) : 'Sin perfil (manual)'}
                </td>
                <td className="ebim-td">
                  <div className="flex flex-wrap gap-1">
                    {r.is_past_due ? <Badge tone="warn">Factura vencida</Badge> : null}
                    {r.in_grace ? <Badge tone="warn">En gracia</Badge> : null}
                    {r.suspension_pending ? <Badge tone="danger">Suspensión pendiente</Badge> : null}
                    {!r.is_past_due && !r.in_grace && !r.suspension_pending ? <Badge tone="ok">Al día</Badge> : null}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <Card title="Bandeja de alertas abiertas" description="Trabajo de cobranza para revisar. Marcar o resolver una alerta no cambia contratos ni tenants.">
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar por suscripción, cliente o tipo de alerta…"
          right={
            <StatusTabs
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'ALL', label: 'Todas', count: filtered.length },
                { id: 'CRITICAL', label: 'Críticas' },
                { id: 'DOCUMENTS', label: 'Documentos' },
                { id: 'OVERDUE', label: 'Vencidas' },
              ]}
            />
          }
        />
        {alerts.isLoading ? (
          <LoadingState />
        ) : alerts.error ? (
          <ErrorState error={alerts.error} onRetry={() => void alerts.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Sin alertas abiertas"
            description="Si acabas de configurar perfiles de cobro, pulsa «Recalcular alertas» para materializarlas."
          />
        ) : (
          <DataTable
            maxHeight={640}
            label="Alertas abiertas"
            columns={['Alerta', 'Suscripción', 'Cliente', 'Actuar antes de', 'Severidad', { label: 'Acciones', srOnly: true }]}
          >
            {rows.map((a) => {
              const sub = a.subscriptions as {
                code: string;
                saas_products: { short_name: string } | null;
                organizations: { display_name: string } | null;
              } | null;
              return (
                <tr key={a.id}>
                  <td className="ebim-td">
                    <div className="font-semibold">{ALERT_LABEL[a.alert_type as string] ?? a.title}</div>
                    <div className="max-w-[230px] truncate text-compact text-fg-2" title={[a.title, a.message].filter(Boolean).join(' · ')}>
                      {[a.title, a.message].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td className="ebim-td">
                    <Link
                      className="ebim-link block max-w-[180px] truncate whitespace-nowrap font-mono text-compact"
                      title={sub?.code}
                      to={`/subscriptions/${a.subscription_id}`}
                    >
                      {sub?.code}
                    </Link>
                    <span className="block text-caption text-muted">{sub?.saas_products?.short_name}</span>
                  </td>
                  <td className="ebim-td">
                    <span className="block max-w-[180px] truncate text-fg-2" title={sub?.organizations?.display_name}>
                      {sub?.organizations?.display_name}
                    </span>
                  </td>
                  <td className="ebim-td whitespace-nowrap text-compact text-fg-2">{formatDate(a.due_at)}</td>
                  <td className="ebim-td">
                    <Badge tone={SEVERITY_TONE[a.severity] ?? 'neutral'}>{SEVERITY_LABEL[a.severity] ?? a.severity}</Badge>
                  </td>
                  <td className="ebim-td w-12 text-right">
                    {perms.canManageCommercial ? (
                      <ActionMenu
                        label={`Acciones de la alerta ${a.title}`}
                        items={[
                          { label: 'Marcar como vista', onSelect: () => void acknowledge(a.id) },
                          { label: 'Resolver', onSelect: () => void resolve(a.id) },
                        ]}
                      />
                    ) : (
                      <span className="text-caption text-muted">Sólo lectura</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>

      <ConfirmDialog
        open={confirmCharges}
        tone="primary"
        title="¿Ejecutar los cobros pendientes?"
        message="Se cobrarán con la tarjeta guardada las facturas vencidas de suscripciones con pago automático autorizado. Política de reintentos: intento 1 al vencer, intento 2 a los 3 días e intento 3 a los 7 días; máximo 3 intentos, y tras el tercer fallo se crea una alerta de cobranza. Cada cobro confirmado genera su pago y su comisión."
        confirmLabel="Ejecutar cobros"
        busy={autocharge.isPending}
        onConfirm={doRunCharges}
        onCancel={() => setConfirmCharges(false)}
      />

      <ConfirmDialog
        open={confirmSuspend}
        title="¿Ejecutar las suspensiones pendientes?"
        message="Sólo afecta a tenants cuya política de cobranza tenga la suspensión automática activada y cuyo período de gracia haya terminado. Cada uno pasa a «Suspendido» en el Control Plane y se encola una solicitud SUSPEND_TENANT en DRY_RUN (simulación: el producto no se apaga desde aquí). Las alertas quedan resueltas y todo se audita."
        confirmLabel="Ejecutar suspensiones"
        busy={suspend.isPending}
        onConfirm={doSuspend}
        onCancel={() => setConfirmSuspend(false)}
      />
    </PageContainer>
  );
}
