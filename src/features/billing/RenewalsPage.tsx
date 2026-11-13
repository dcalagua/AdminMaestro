import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBillingAlerts } from '@/services/queries';
import { useRenewalPipeline } from '@/services/financeRead';
import {
  useRefreshBillingAlerts,
  useApplyDueSuspensions,
  useSetAlertStatus,
  useAutocharge,
  type AutochargeSummary,
} from '@/services/mutations';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer,
  Card,
  DataTable,
  SearchBar,
  LoadingState,
  ErrorState,
  EmptyState,
  Badge,
  KpiTile,
} from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import {
  formatCountNoun,
  formatDate,
  formatMoney,
  formatNumber,
  sumByCurrency,
} from '@/lib/format';
import { fromQuery } from '@/features/executive/dataState';
import { KpiStrip, NativeAmountTile } from './financeUi';
import { RENEWAL_WINDOWS, type RenewalWindow } from '@/features/executive/kpis';
import { ATTEMPT_STATUS_LABEL, ATTEMPT_STATUS_TONE } from './autochargeSummary';
import { COLLECTION_METHOD_LABEL } from './subscriptionLabels';
import { CellTitle, MoneyCell, StatusCell } from '@/components/ui/cells';

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

const METHOD_LABEL = COLLECTION_METHOD_LABEL;

type Filter = 'ALL' | 'CRITICAL' | 'DOCUMENTS' | 'OVERDUE';

function parseWindow(value: string | null): RenewalWindow {
  const n = Number(value);
  return (RENEWAL_WINDOWS as readonly number[]).includes(n) ? (n as RenewalWindow) : 30;
}

function isWithin(days: number | null | undefined, windowDays: number): boolean {
  return days !== null && days !== undefined && days <= windowDays;
}

function countWithin(
  rows: ReadonlyArray<{ days_to_renewal: number | null }>,
  windowDays: number,
): number {
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
    (a.subscriptions as { organizations: { display_name: string } | null } | null)?.organizations
      ?.display_name,
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
  const withoutMrr = inWindow.filter(
    (r) => r.current_mrr === null || r.current_mrr === undefined,
  ).length;
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
          : `${created === 1 ? '1 alerta nueva' : `${formatNumber(created)} alertas nuevas`}.`,
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
        `${formatCountNoun(result?.applied ?? 0, 'tenant')} en «Suspendido» en el Admin Maestro, con la orden a la app en simulación; ${formatCountNoun(result?.skipped ?? 0, 'omitido')} por política.`,
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
        `${formatCountNoun(summary.processed, 'factura procesada', 'facturas procesadas')}: ${formatNumber(summary.succeeded)} cobradas, ${formatNumber(summary.failed)} fallidas, ${formatNumber(summary.skipped)} omitidas${summary.review ? `, ${formatNumber(summary.review)} en revisión` : ''}.`,
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
      description={`Contratos que renuevan pronto y el trabajo de cobranza pendiente, calculado desde el perfil de cobro de cada suscripción.${
        perms.canManageCommercial
          ? ' «Visto», «Resolver» y «Recalcular alertas» solo cambian alertas.' +
            (perms.canManagePlatform
              ? ' «Ejecutar suspensiones» cambia tenants a «Suspendido» en el Admin Maestro donde la política lo autoriza; la orden a la app se envía en simulación, así que la app no se apaga desde aquí.'
              : '')
          : ''
      }`}
      actions={
        perms.canManageCommercial ? (
          // V6: las acciones de esta pestaña van juntas en un menú; la primaria de
          // Cobranza («Emitir factura») queda sola. La destructiva, al final y en rojo (A11).
          <ActionMenu
            variant="page"
            label="Acciones de cobranza"
            buttonLabel="Acciones de cobranza"
            items={[
              {
                label: refresh.isPending ? 'Recalculando…' : 'Recalcular alertas',
                title: 'Calcula alertas nuevas. No cambia ningún tenant.',
                disabled: refresh.isPending,
                onSelect: () => void doRefresh(),
              },
              perms.canReadFinance
                ? {
                    label: autocharge.isPending ? 'Cobrando…' : 'Ejecutar cobros pendientes',
                    title:
                      'Cobra con la tarjeta guardada las facturas que tocan según la política de reintentos.',
                    disabled: autocharge.isPending,
                    onSelect: () => setConfirmCharges(true),
                  }
                : null,
              perms.canManagePlatform
                ? {
                    label: 'Ejecutar suspensiones…',
                    tone: 'danger' as const,
                    disabled: suspend.isPending,
                    onSelect: () => setConfirmSuspend(true),
                  }
                : null,
            ]}
          />
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
              ? `${formatCountNoun(withoutDate, 'contrato')} sin fecha de renovación no se cuentan`
              : 'Contratos con fecha de renovación en la ventana'
          }
          loading={pipeline.isLoading}
          error={pipeline.error}
          onRetry={() => void pipeline.refetch()}
        />
        <NativeAmountTile
          label="MRR en la ventana"
          info="MRR vigente de los contratos que renuevan en la ventana, por moneda. No es pronóstico de churn."
          amounts={sumByCurrency(
            inWindow,
            (r) => r.current_mrr,
            (r) => r.currency,
          )}
          state={pipelineState}
          onRetry={() => void pipeline.refetch()}
          emptyLabel="Sin MRR vigente en la ventana"
          footer={
            withoutMrr > 0
              ? `${formatCountNoun(withoutMrr, 'contrato')} sin recurrente vigente`
              : 'Por moneda; no es pronóstico de churn'
          }
        />
        <KpiTile
          label="En riesgo"
          info="Toda la cartera, no sólo la ventana: factura vencida, en gracia o con suspensión pendiente."
          value={pipeline.data ? formatNumber(atRisk) : null}
          tone={suspensionPending > 0 ? 'danger' : atRisk > 0 ? 'warn' : 'neutral'}
          footer={`${formatNumber(pastDue)} con factura vencida · ${formatNumber(inGrace)} en gracia · ${formatNumber(suspensionPending)} por suspender`}
          loading={pipeline.isLoading}
          error={pipeline.error}
          onRetry={() => void pipeline.refetch()}
        />
        <KpiTile
          label="Alertas críticas"
          info="Alertas de cobranza abiertas con severidad crítica; el resto está en la bandeja."
          value={alerts.data ? formatNumber(critical) : null}
          tone={critical > 0 ? 'danger' : 'neutral'}
          footer={
            alerts.data ? `de ${formatNumber(openAlerts.length)} alertas abiertas` : undefined
          }
          loading={alerts.isLoading}
          error={alerts.error}
          onRetry={() => void alerts.refetch()}
        />
      </KpiStrip>

      {chargeSummary ? (
        <Card
          className="mb-4"
          title="Resultado de los cobros con tarjeta guardada"
          description="Facturas vencidas de suscripciones con pago automático autorizado, según la política de reintentos."
          actions={
            <button
              type="button"
              className="ebim-btn-ghost ebim-btn-sm"
              onClick={() => setChargeSummary(null)}
            >
              Cerrar
            </button>
          }
        >
          <div
            className="grid grid-cols-2 gap-3 border-b border-border p-4 sm:grid-cols-4"
            data-testid="autocharge-summary"
          >
            {[
              ['Procesadas', chargeSummary.processed],
              ['Cobradas', chargeSummary.succeeded],
              ['Fallidas', chargeSummary.failed],
              ['Omitidas', chargeSummary.skipped],
              ...(chargeSummary.review ? [['En revisión', chargeSummary.review]] : []),
            ].map(([label, value]) => (
              <div key={label as string}>
                <div className="text-micro text-muted">{label}</div>
                <div className="mt-0.5 text-h2 tabular-nums text-fg">
                  {formatNumber(Number(value))}
                </div>
              </div>
            ))}
          </div>
          {chargeSummary.results.length === 0 ? (
            <EmptyState
              title="Nada que cobrar"
              description="Ninguna factura con tarjeta guardada vence hoy ni tiene un reintento pendiente."
            />
          ) : (
            <DataTable
              label="Resultado de los cobros"
              columns={['Factura', 'Resultado', { label: 'Importe', align: 'right' }, 'Código']}
            >
              {chargeSummary.results.map((r, i) => (
                <tr key={`${r.invoice_number ?? 'x'}-${i}`}>
                  <td className="ebim-td whitespace-nowrap font-mono text-compact">
                    {r.invoice_number ?? '—'}
                  </td>
                  <td className="ebim-td">
                    <Badge tone={ATTEMPT_STATUS_TONE[r.status] ?? 'neutral'}>
                      {ATTEMPT_STATUS_LABEL[r.status] ?? r.status}
                    </Badge>
                  </td>
                  <td className="ebim-td ebim-num whitespace-nowrap">
                    {r.amount !== null && r.amount !== undefined
                      ? formatMoney(Number(r.amount), r.currency ?? null)
                      : '—'}
                  </td>
                  <td className="ebim-td font-mono text-compact">{r.error_code ?? '—'}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
      ) : null}

      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 className="text-h3 text-fg">Renuevan pronto</h2>
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
          <EmptyState
            title={`Ningún contrato renueva en los próximos ${windowDays} días`}
            description="Amplía la ventana para ver más contratos."
          />
        ) : (
          <DataTable
            maxHeight={520}
            label="Contratos en la ventana"
            columns={[
              { label: 'Cliente · contrato', sticky: true },
              'Renueva',
              { label: 'MRR vigente', align: 'right' },
              { label: 'Cobro', mobile: false },
              'Estado de cobro',
            ]}
          >
            {inWindow.map((r) => (
              <tr key={r.subscription_id as string}>
                <td className="ebim-td py-2">
                  <div className="max-w-[320px]">
                    <CellTitle
                      title={r.billed_organization_name ?? '—'}
                      to={`/subscriptions/${r.subscription_id}`}
                      tooltip={`${r.billed_organization_name ?? ''} · contrato ${r.subscription_code ?? ''}`}
                      secondary={[r.subscription_code, r.product_short_name, r.tenant_name]}
                      monoParts={[0]}
                    />
                  </div>
                </td>
                <td className="ebim-td whitespace-nowrap">
                  <span className="block text-compact text-fg-2">{formatDate(r.renewal_on)}</span>
                  <span
                    className={`block text-caption ${Number(r.days_to_renewal) <= 7 ? 'font-semibold text-warn' : 'text-muted'}`}
                  >
                    {Number(r.days_to_renewal) === 0
                      ? 'hoy'
                      : `en ${formatCountNoun(Number(r.days_to_renewal), 'día')}`}
                  </span>
                </td>
                <td className="ebim-td ebim-num">
                  <MoneyCell amount={r.current_mrr} currency={r.currency} empty="Sin recurrente" />
                </td>
                <td className="ebim-td whitespace-nowrap text-compact text-fg-2">
                  {r.collection_method ? (
                    (METHOD_LABEL[r.collection_method] ?? r.collection_method)
                  ) : (
                    <span
                      className="text-muted"
                      title="Sin perfil de cobro: se cobra de forma manual"
                    >
                      Sin perfil
                    </span>
                  )}
                </td>
                <td className="ebim-td">
                  {r.suspension_pending ? (
                    <StatusCell
                      label="Suspensión pendiente"
                      tone="danger"
                      detail={r.is_past_due ? 'Con factura vencida' : undefined}
                    />
                  ) : r.in_grace ? (
                    <StatusCell label="En gracia" tone="warn" detail="Factura vencida" />
                  ) : r.is_past_due ? (
                    <StatusCell label="Factura vencida" tone="warn" />
                  ) : (
                    <StatusCell label="Al día" tone="ok" />
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <Card title="Alertas abiertas">
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
            columns={[
              'Alerta',
              'Cliente · contrato',
              'Actuar antes de',
              'Severidad',
              { label: 'Acciones', srOnly: true },
            ]}
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
                    <div className="font-semibold">
                      {ALERT_LABEL[a.alert_type as string] ?? a.title}
                    </div>
                    <div
                      className="max-w-[230px] truncate text-compact text-fg-2"
                      title={[a.title, a.message].filter(Boolean).join(' · ')}
                    >
                      {[a.title, a.message].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td className="ebim-td py-2">
                    <div className="max-w-[280px]">
                      <CellTitle
                        title={sub?.organizations?.display_name ?? '—'}
                        to={`/subscriptions/${a.subscription_id}`}
                        tooltip={`${sub?.organizations?.display_name ?? ''} · contrato ${sub?.code ?? ''}`}
                        secondary={[sub?.code, sub?.saas_products?.short_name]}
                        monoParts={[0]}
                      />
                    </div>
                  </td>
                  <td className="ebim-td whitespace-nowrap text-compact text-fg-2">
                    {formatDate(a.due_at)}
                  </td>
                  <td className="ebim-td">
                    <Badge tone={SEVERITY_TONE[a.severity] ?? 'neutral'}>
                      {SEVERITY_LABEL[a.severity] ?? a.severity}
                    </Badge>
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
                      <span className="text-caption text-muted" title="Solo lectura con tu perfil">
                        —
                      </span>
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
        message="Sólo afecta a tenants cuya política de cobranza tenga la suspensión automática activada y cuyo período de gracia haya terminado. Cada uno pasa a «Suspendido» en el Admin Maestro y se encola la orden de suspensión a la app en simulación (la app no se apaga desde aquí). Las alertas quedan resueltas y todo se audita."
        confirmLabel="Ejecutar suspensiones"
        busy={suspend.isPending}
        onConfirm={doSuspend}
        onCancel={() => setConfirmSuspend(false)}
      />
    </PageContainer>
  );
}
