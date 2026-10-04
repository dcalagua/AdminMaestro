import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { USAGE_LIST_LIMIT, useUsageAlerts } from '@/services/queries';
import { useAcknowledgeUsageAlert } from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge } from '@/components/ui/primitives';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextAreaField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { formatDateTime } from '@/lib/format';
import { ALERT_CODE, alertCategory, labelOf, type AlertCategory } from './usageLabels';
import { useLookups } from './useLookups';

/**
 * Alertas de uso, créditos y facturación de uso (append-only, para finanzas).
 * Ninguna factura: avisan de lo que falta decidir (D-xx) o de un exceso.
 *
 * El acuse (finanzas o admin de producto) vive en `usage_alert_acks`: la
 * alerta no cambia. Pestañas de estado Pendientes/Atendidas y de categoría.
 */
type Alert = NonNullable<ReturnType<typeof useUsageAlerts>['data']>[number];
type Category = 'ALL' | AlertCategory;
type AckTab = 'PENDING' | 'ACKED' | 'ALL';

function detailText(detail: unknown): string {
  if (!detail || typeof detail !== 'object') return '';
  return Object.entries(detail as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

const isAcked = (a: Alert) => a.acknowledged === true;

export function AlertsTab() {
  const alerts = useUsageAlerts();
  const lookups = useLookups();
  const perms = usePermissions();
  const [category, setCategory] = useState<Category>('ALL');
  const [ackTab, setAckTab] = useState<AckTab>('PENDING');
  const [acking, setAcking] = useState<Alert | null>(null);
  const canAck = perms.canReadFinance || perms.canManagePlatform;

  const { term, setTerm, filtered } = useSearchFilter(alerts.data, (a) => [
    a.code, a.code ? ALERT_CODE[a.code]?.label : null, lookups.tenantName(a.tenant_id), lookups.productName(a.saas_product_id),
    detailText(a.detail), a.ack_note, a.acknowledged_by_name,
  ]);
  const inAck = (t: AckTab, a: Alert) => t === 'ALL' || (t === 'ACKED' ? isAcked(a) : !isAcked(a));
  const inCategory = (c: Category, a: Alert) => c === 'ALL' || alertCategory(a.code ?? '') === c;
  const ackCount = (t: AckTab) => filtered.filter((a) => inAck(t, a) && inCategory(category, a)).length;
  const categoryCount = (c: Category) => filtered.filter((a) => inAck(ackTab, a) && inCategory(c, a)).length;
  const visible = filtered.filter((a) => inAck(ackTab, a) && inCategory(category, a));
  const hasAny = (alerts.data ?? []).length > 0;

  return (
    <Card
      title="Alertas"
      description={`Últimas ${USAGE_LIST_LIMIT} alertas. Son bitácora append-only: un exceso bajo BLOCK, una política o un peso sin decidir, una tarifa ausente. El acuse no las borra ni las modifica.`}
    >
      <SearchBar
        value={term}
        onChange={setTerm}
        placeholder="Buscar por código, tenant, producto, detalle o nota…"
        right={
          <StatusTabs
            value={ackTab}
            onChange={setAckTab}
            options={[
              { id: 'PENDING', label: 'Pendientes', count: ackCount('PENDING') },
              { id: 'ACKED', label: 'Atendidas', count: ackCount('ACKED') },
              { id: 'ALL', label: 'Todas', count: ackCount('ALL') },
            ]}
          />
        }
      />
      <div className="mb-3">
        <StatusTabs
          value={category}
          onChange={setCategory}
          options={[
            { id: 'ALL', label: 'Todas las categorías', count: categoryCount('ALL') },
            { id: 'USAGE', label: 'Uso', count: categoryCount('USAGE') },
            { id: 'CREDITS', label: 'Créditos IA', count: categoryCount('CREDITS') },
            { id: 'BILLING', label: 'Facturación', count: categoryCount('BILLING') },
          ]}
        />
      </div>
      {alerts.isLoading ? (
        <LoadingState label="Cargando alertas…" />
      ) : alerts.error ? (
        <ErrorState error={alerts.error} onRetry={() => void alerts.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={hasAny ? 'Ninguna alerta coincide' : 'Sin alertas'}
          description={
            hasAny ? 'Prueba con otra búsqueda o cambia de pestaña.' : 'Ningún cierre ni consumo ha generado alertas.'
          }
        />
      ) : (
        <DataTable columns={['Fecha', 'Alerta', 'Tenant', 'Producto', 'Detalle', 'Acuse']}>
          {visible.map((a) => {
            const meta = labelOf(ALERT_CODE, a.code ?? '');
            return (
              <tr key={a.id}>
                <td className="ebim-td whitespace-nowrap text-xs text-muted">{formatDateTime(a.created_at)}</td>
                <td className="ebim-td">
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <div className="mt-0.5 font-mono text-[11px] text-muted">{a.code}</div>
                </td>
                <td className="ebim-td text-xs">{a.tenant_id ? lookups.tenantName(a.tenant_id) : '—'}</td>
                <td className="ebim-td text-xs">{a.saas_product_id ? lookups.productName(a.saas_product_id) : '—'}</td>
                <td className="ebim-td max-w-[360px] break-words font-mono text-[11px] text-muted">
                  {detailText(a.detail) || '—'}
                </td>
                <td className="ebim-td text-xs">
                  {isAcked(a) ? (
                    <>
                      <Badge tone="ok">Atendida</Badge>
                      <div className="mt-0.5 text-[11px] text-muted">
                        {a.acknowledged_by_name ?? 'EBIM'} · {formatDateTime(a.acknowledged_at)}
                      </div>
                      {a.ack_note ? <div className="max-w-[220px] text-[11px]">{a.ack_note}</div> : null}
                    </>
                  ) : canAck && a.id ? (
                    <button type="button" className="ebim-link text-[13px]" onClick={() => setAcking(a)}>
                      Dar acuse
                    </button>
                  ) : (
                    <Badge tone="warn">Pendiente</Badge>
                  )}
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}

      <AckDialog alert={acking} onClose={() => setAcking(null)} />
    </Card>
  );
}

const ackSchema = z.object({ note: z.string().trim().max(1000, 'Máximo 1000 caracteres') });
type AckValues = z.input<typeof ackSchema>;

function AckDialog({ alert, onClose }: { alert: Alert | null; onClose: () => void }) {
  const toast = useToast();
  const ack = useAcknowledgeUsageAlert();
  const form = useForm<AckValues>({ resolver: zodResolver(ackSchema), defaultValues: { note: '' } });

  useEffect(() => {
    if (!alert) return;
    ack.reset();
    form.reset({ note: '' });
  }, [alert]);

  const label = alert ? labelOf(ALERT_CODE, alert.code ?? '').label : '';
  const submit = form.handleSubmit(async (values) => {
    if (!alert?.id) return;
    const v = ackSchema.parse(values);
    try {
      await ack.mutateAsync({ p_alert_id: alert.id, p_note: v.note || undefined });
      toast.success('Acuse registrado', label);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={Boolean(alert)}
      title={`Dar acuse · ${label}`}
      description="Marca la alerta como atendida. La alerta queda tal cual en la bitácora; el acuse (quién, cuándo y la nota) se guarda aparte y no se puede editar."
      submitLabel="Dar acuse"
      busy={ack.isPending}
      error={ack.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <TextAreaField label="Nota" hint="Opcional: qué se hizo o qué decisión se espera."
        error={form.formState.errors.note} {...form.register('note')} />
    </FormDialog>
  );
}
