import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useBillingAlerts, useRenewalDashboard } from '@/services/queries';
import {
  useRefreshBillingAlerts, useApplyDueSuspensions, useSetAlertStatus,
} from '@/services/mutations';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  PageContainer, Card, DataTable, SearchBar, StatCard, LoadingState, ErrorState, EmptyState, Badge,
} from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { formatDate, formatNumber } from '@/lib/format';

/**
 * Renovaciones y alertas de cobranza.
 *
 * Dos acciones, deliberadamente SEPARADAS:
 *
 *   «Recalcular»  → materializa el trabajo pendiente. Es idempotente y NO
 *                   cambia el estado de ningún tenant.
 *   «Suspender»   → la única acción que apaga clientes, y solo donde la
 *                   política de cobranza lo autoriza con `auto_suspend`.
 *
 * Están separadas porque un botón que calcula y de paso suspende es un botón
 * que nadie se atreve a pulsar.
 */

const WINDOW_LABEL: Record<string, string> = {
  D7: '7 días',
  D15: '15 días',
  D30: '30 días',
  D45: '45 días',
  D60: '60 días',
  LEJOS: 'Más de 60',
  SIN_RENOVACION: 'Sin renovación',
};

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

const SEVERITY_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'info'> = {
  INFO: 'info',
  WARNING: 'warn',
  CRITICAL: 'danger',
};

type Filter = 'ALL' | 'CRITICAL' | 'DOCUMENTS' | 'OVERDUE';

export function RenewalsPage() {
  const alerts = useBillingAlerts('OPEN');
  const renewals = useRenewalDashboard();
  const perms = usePermissions();
  const toast = useToast();

  const refresh = useRefreshBillingAlerts();
  const suspend = useApplyDueSuspensions();
  const setStatus = useSetAlertStatus();

  const [filter, setFilter] = useState<Filter>('ALL');
  const [confirmSuspend, setConfirmSuspend] = useState(false);

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

  const all = renewals.data ?? [];
  const openAlerts = alerts.data ?? [];

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
        'Suspensiones aplicadas',
        `${result?.applied ?? 0} aplicada(s), ${result?.skipped ?? 0} omitida(s) por política.`,
      );
    } catch (error) {
      toast.error('No se pudo suspender', businessErrorMessage(error));
    } finally {
      setConfirmSuspend(false);
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

  const byWindow = (w: string) => all.filter((r) => r.renewal_window === w).length;

  return (
    <PageContainer
      title="Renovaciones y alertas"
      description="El trabajo de cobranza pendiente, calculado a partir del perfil de cobro de cada suscripción."
      actions={
        perms.canManageCommercial ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="ebim-btn-ghost"
              onClick={() => void doRefresh()}
              disabled={refresh.isPending}
            >
              {refresh.isPending ? 'Recalculando…' : 'Recalcular alertas'}
            </button>
            {perms.canManagePlatform ? (
              <button
                type="button"
                className="ebim-btn-danger"
                onClick={() => setConfirmSuspend(true)}
              >
                Aplicar suspensiones
              </button>
            ) : null}
          </div>
        ) : null
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(['D7', 'D15', 'D30', 'D45', 'D60'] as const).map((w) => (
          <StatCard
            key={w}
            label={`Renuevan en ${WINDOW_LABEL[w]}`}
            value={formatNumber(byWindow(w))}
            tone={w === 'D7' ? 'warn' : 'neutral'}
          />
        ))}
        <StatCard
          label="Alertas críticas"
          value={formatNumber(openAlerts.filter((a) => a.severity === 'CRITICAL').length)}
          tone={openAlerts.some((a) => a.severity === 'CRITICAL') ? 'danger' : 'ok'}
        />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Vencidas"
          value={formatNumber(all.filter((r) => r.is_past_due).length)}
          tone="warn"
        />
        <StatCard
          label="En gracia"
          value={formatNumber(all.filter((r) => r.in_grace).length)}
          tone="warn"
        />
        <StatCard
          label="Suspensión pendiente"
          value={formatNumber(all.filter((r) => r.suspension_pending).length)}
          tone={all.some((r) => r.suspension_pending) ? 'danger' : 'ok'}
        />
      </div>

      <Card>
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
            columns={['Alerta', 'Suscripción', 'Cliente', 'Producto', 'Actuar antes de', 'Severidad', '']}
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
                    <div className="font-semibold">{a.title}</div>
                    <div className="text-xs text-muted">{a.message}</div>
                  </td>
                  <td className="ebim-td">
                    <Link className="ebim-link font-mono text-xs" to={`/subscriptions/${a.subscription_id}`}>
                      {sub?.code}
                    </Link>
                  </td>
                  <td className="ebim-td text-muted">{sub?.organizations?.display_name}</td>
                  <td className="ebim-td">{sub?.saas_products?.short_name}</td>
                  <td className="ebim-td text-xs text-muted">{formatDate(a.due_at)}</td>
                  <td className="ebim-td">
                    <Badge tone={SEVERITY_TONE[a.severity] ?? 'neutral'}>
                      {ALERT_LABEL[a.alert_type as string] ?? a.alert_type}
                    </Badge>
                  </td>
                  <td className="ebim-td">
                    {perms.canManageCommercial ? (
                      <div className="flex items-center justify-end gap-3">
                        <button
                          type="button"
                          className="ebim-link text-[13px]"
                          onClick={() => void acknowledge(a.id)}
                        >
                          Visto
                        </button>
                        <button
                          type="button"
                          className="ebim-link text-[13px]"
                          onClick={() => void resolve(a.id)}
                        >
                          Resolver
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>

      <Card
        className="mt-4"
        title="Cartera por ventana de renovación"
        description="Proyectada desde el inicio y el intervalo de cada suscripción, o desde su fecha de fin si la tiene."
      >
        {renewals.isLoading ? (
          <LoadingState />
        ) : all.length === 0 ? (
          <EmptyState title="Sin suscripciones activas" />
        ) : (
          <DataTable
            columns={['Suscripción', 'Cliente', 'Producto', 'Método', 'Renueva', 'Días', 'Estado']}
          >
            {all
              .filter((r) => r.renewal_window !== 'LEJOS')
              .map((r) => (
                <tr key={r.subscription_id as string}>
                  <td className="ebim-td">
                    <Link className="ebim-link font-mono text-xs" to={`/subscriptions/${r.subscription_id}`}>
                      {r.subscription_code}
                    </Link>
                  </td>
                  <td className="ebim-td text-muted">{r.billed_organization_name}</td>
                  <td className="ebim-td">{r.product_short_name}</td>
                  <td className="ebim-td text-xs text-muted">
                    {r.collection_method ?? 'Sin perfil (manual)'}
                  </td>
                  <td className="ebim-td text-xs">{formatDate(r.renewal_on)}</td>
                  <td className="ebim-td tabular-nums">{r.days_to_renewal}</td>
                  <td className="ebim-td">
                    <div className="flex flex-wrap gap-1">
                      {r.is_past_due ? <Badge tone="warn">Vencida</Badge> : null}
                      {r.in_grace ? <Badge tone="warn">En gracia</Badge> : null}
                      {r.suspension_pending ? <Badge tone="danger">Suspensión</Badge> : null}
                      {!r.is_past_due && !r.in_grace && !r.suspension_pending ? (
                        <Badge tone="ok">Al día</Badge>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
          </DataTable>
        )}
      </Card>

      <ConfirmDialog
        open={confirmSuspend}
        title="¿Aplicar las suspensiones pendientes?"
        message="Se suspenderán únicamente los tenants cuya política de cobranza tenga la suspensión automática activada y cuyo periodo de gracia haya terminado. Cada suspensión encola una solicitud SUSPEND_TENANT en DRY_RUN y queda auditada."
        confirmLabel="Aplicar suspensiones"
        onConfirm={() => void doSuspend()}
        onCancel={() => setConfirmSuspend(false)}
      />
    </PageContainer>
  );
}
