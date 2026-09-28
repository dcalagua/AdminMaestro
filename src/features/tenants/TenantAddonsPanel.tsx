import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useCatalogItemsWithLifecycle, useTenantAddonHistory, useTenantEntitlements,
} from '@/services/queries';
import {
  useApproveTenantAddon, useCancelTenantAddon, useReactivateTenantAddon, useRejectTenantAddon,
  useRequestTenantAddon, useResumeTenantAddon, useScheduleCancelTenantAddon, useSuspendTenantAddon,
} from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, DataTable, LoadingState, ErrorState, EmptyState, Badge } from '@/components/ui/primitives';
import { FormDialog } from '@/components/ui/FormDialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { Money } from '@/components/ui/Money';
import { useToast } from '@/components/ui/toast-context';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import {
  billingModelLabel, requestSourceLabel, tenantAddonStatusLabel, tenantAddonStatusTone,
} from '@/features/catalog/catalogLabels';

/**
 * Add-ons y entitlements de UN tenant (CCP fase 07, spec §6.2).
 *
 * Solicitar un add-on nunca lo activa: queda REQUESTED hasta que comercial lo
 * aprueba. Aprobar, rechazar, programar la baja y reactivar son de comercial;
 * suspender, reanudar y dar de baja de inmediato, de finanzas. Toda transición
 * lleva motivo y queda auditada.
 *
 * Los botones se ofrecen con `usePermissions` sólo como UX: la RPC es la
 * autoridad y responde 42501 si alguien la fuerza. La solicitud se ofrece a
 * todo el que ve el tenant: la base decide si puede pedirla.
 */

type AddonAction =
  | 'APPROVE' | 'REJECT' | 'SCHEDULE_CANCEL' | 'REACTIVATE' | 'SUSPEND' | 'RESUME' | 'CANCEL';

const ACTION_COPY: Record<AddonAction, { label: string; title: string; description: string; done: string }> = {
  APPROVE: {
    label: 'Aprobar',
    title: 'Aprobar solicitud de add-on',
    description: 'Activa el add-on y congela su tarifa vigente en la suscripción. Los entitlements del tenant quedan pendientes de sincronizar con el producto.',
    done: 'Add-on aprobado',
  },
  REJECT: {
    label: 'Rechazar',
    title: 'Rechazar solicitud de add-on',
    description: 'La solicitud queda rechazada; no se activa nada ni se cobra nada.',
    done: 'Solicitud rechazada',
  },
  SCHEDULE_CANCEL: {
    label: 'Programar baja',
    title: 'Programar la baja del add-on',
    description: 'El add-on sigue activo hasta la fecha de baja. Si no indicas fecha, la base usa el fin del periodo facturado.',
    done: 'Baja programada',
  },
  REACTIVATE: {
    label: 'Reactivar',
    title: 'Reactivar el add-on',
    description: 'Anula la baja programada: el add-on sigue activo sin interrupción.',
    done: 'Add-on reactivado',
  },
  SUSPEND: {
    label: 'Suspender',
    title: 'Suspender el add-on',
    description: 'Finanzas: el add-on deja de otorgar sus capacidades hasta que se reanude.',
    done: 'Add-on suspendido',
  },
  RESUME: {
    label: 'Reanudar',
    title: 'Reanudar el add-on',
    description: 'Finanzas: el add-on vuelve a otorgar sus capacidades.',
    done: 'Add-on reanudado',
  },
  CANCEL: {
    label: 'Dar de baja',
    title: 'Dar de baja el add-on de inmediato',
    description: 'Finanzas: baja inmediata, sin esperar al fin del periodo. No se puede deshacer; habría que volver a solicitarlo.',
    done: 'Add-on dado de baja',
  },
};

/** Transiciones que la base admite por estado, separadas por autoridad. */
const COMMERCIAL_ACTIONS: Record<string, AddonAction[]> = {
  REQUESTED: ['APPROVE', 'REJECT'],
  ACTIVE: ['SCHEDULE_CANCEL'],
  CANCEL_SCHEDULED: ['REACTIVATE'],
};

const FINANCE_ACTIONS: Record<string, AddonAction[]> = {
  ACTIVE: ['SUSPEND', 'CANCEL'],
  CANCEL_SCHEDULED: ['CANCEL'],
  SUSPENDED: ['RESUME', 'CANCEL'],
};

const reasonSchema = z.object({
  reason: z.string().trim().min(3, 'El motivo es obligatorio'),
  effective_to: z.string().optional(),
});
type ReasonValues = z.input<typeof reasonSchema>;

const requestSchema = z.object({
  addon_code: z.string().min(1, 'Elige el add-on'),
  reason: z.string().trim().optional(),
});
type RequestValues = z.input<typeof requestSchema>;

interface PendingAction {
  action: AddonAction;
  id: string;
  name: string;
}

export function TenantAddonsPanel({
  tenantId,
  saasProductId,
}: {
  tenantId: string;
  saasProductId?: string | null;
}) {
  const history = useTenantAddonHistory(tenantId);
  const entitlements = useTenantEntitlements(tenantId);
  const perms = usePermissions();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);

  const actionsFor = (status: string | null): AddonAction[] => {
    const s = status ?? '';
    return [
      ...(perms.canManageCommercial ? (COMMERCIAL_ACTIONS[s] ?? []) : []),
      ...(perms.canReadFinance ? (FINANCE_ACTIONS[s] ?? []) : []),
    ];
  };

  const rows = history.data ?? [];
  const ents = entitlements.data ?? [];
  const dirty = ents.some((e) => e.desired_dirty);

  return (
    <div className="space-y-4">
      <Card
        title="Add-ons del tenant"
        description="Historia completa: solicitudes, altas, bajas y suspensiones. El importe es el congelado en la suscripción al aprobar, visible sólo si tu perfil puede verlo."
        actions={
          <button type="button" className="ebim-btn-secondary h-8 px-3 text-xs" onClick={() => setRequestOpen(true)}>
            Solicitar add-on
          </button>
        }
      >
        {history.isLoading ? (
          <LoadingState label="Cargando add-ons…" />
        ) : history.error ? (
          <ErrorState error={history.error} onRetry={() => void history.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="Sin add-ons" description="Este tenant no ha solicitado ni tiene add-ons." />
        ) : (
          <DataTable columns={['Add-on', 'Estado', 'Origen', 'Solicitado', 'Vigencia', 'Importe', '']}>
            {rows.map((a) => {
              const actions = actionsFor(a.status);
              return (
                <tr key={a.id ?? `${a.addon_code}-${a.requested_at}`}>
                  <td className="ebim-td">
                    <div className="font-semibold">{a.addon_name ?? a.addon_code}</div>
                    <div className="font-mono text-[11px] text-muted">
                      {a.addon_code}
                      {a.company_name ? ` · ${a.company_name}` : ''}
                    </div>
                    {a.billing_model ? (
                      <div className="text-[11px] text-muted">{billingModelLabel(a.billing_model)}</div>
                    ) : null}
                  </td>
                  <td className="ebim-td">
                    <Badge tone={tenantAddonStatusTone(a.status)}>{tenantAddonStatusLabel(a.status)}</Badge>
                    {a.status_reason ? (
                      <div className="mt-0.5 max-w-[220px] text-[11px] text-muted" title={a.status_reason}>
                        {a.status_reason}
                      </div>
                    ) : null}
                  </td>
                  <td className="ebim-td text-xs">{requestSourceLabel(a.request_source)}</td>
                  <td className="ebim-td whitespace-nowrap text-xs text-muted">
                    {a.requested_at ? formatDateTime(a.requested_at) : '—'}
                  </td>
                  <td className="ebim-td whitespace-nowrap text-xs">
                    {a.effective_from ? formatDate(a.effective_from) : '—'} →{' '}
                    {a.effective_to ? formatDate(a.effective_to) : a.effective_from ? 'sin fin' : '—'}
                  </td>
                  <td className="ebim-td text-xs">
                    {a.unit_amount !== null && a.unit_amount !== undefined && a.currency ? (
                      <Money className="font-semibold" amount={a.unit_amount} currency={a.currency} />
                    ) : (
                      <span className="text-muted">No visible</span>
                    )}
                  </td>
                  <td className="ebim-td">
                    {actions.length > 0 && a.id ? (
                      <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                        {actions.map((action) => (
                          <button
                            key={action}
                            type="button"
                            className="ebim-link text-[13px]"
                            onClick={() =>
                              setPending({ action, id: a.id as string, name: a.addon_name ?? a.addon_code ?? '' })
                            }
                          >
                            {ACTION_COPY[action].label}
                          </button>
                        ))}
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
        title="Entitlements efectivos"
        description="Lo que el tenant tiene derecho a usar hoy, combinando plan y add-ons. «Pendiente de sincronizar» significa que el producto todavía no recibió el último cambio."
        actions={dirty ? <Badge tone="warn">Pendiente de sincronizar</Badge> : null}
      >
        {entitlements.isLoading ? (
          <LoadingState label="Calculando entitlements…" />
        ) : entitlements.error ? (
          <ErrorState error={entitlements.error} onRetry={() => void entitlements.refetch()} />
        ) : ents.length === 0 ? (
          <EmptyState title="Sin entitlements" description="Ni el plan ni los add-ons de este tenant otorgan capacidades registradas." />
        ) : (
          <DataTable columns={['Capacidad', 'Valor', 'Aplicación', 'Origen', 'Sincronización']}>
            {ents.map((e) => (
              <tr key={`${e.capability_code}-${e.product_code}`}>
                <td className="ebim-td">
                  <div className="font-mono text-[13px] font-semibold">{e.capability_code}</div>
                  <div className="text-[11px] text-muted">
                    {e.kind}
                    {e.scope_level === 'COMPANY'
                      ? ` · por sociedad${e.company_ids?.length ? ` (${e.company_ids.length})` : ''}`
                      : ''}
                  </div>
                </td>
                <td className="ebim-td text-xs">{entitlementValue(e)}</td>
                <td className="ebim-td text-xs">
                  {e.enforcement ? (
                    <Badge tone={e.enforcement === 'HARD' ? 'danger' : 'neutral'}>
                      {e.enforcement === 'HARD' ? 'Bloqueante' : e.enforcement === 'SOFT' ? 'Aviso' : e.enforcement}
                    </Badge>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="ebim-td">
                  <div className="flex flex-wrap gap-1">
                    {(e.sources ?? []).length === 0 ? (
                      <span className="text-xs text-muted">—</span>
                    ) : (
                      (e.sources ?? []).map((s) => (
                        <Badge key={s} tone="info">{s}</Badge>
                      ))
                    )}
                  </div>
                </td>
                <td className="ebim-td">
                  {e.desired_dirty ? (
                    <Badge tone="warn">pendiente de sincronizar</Badge>
                  ) : (
                    <span className="text-xs text-muted">Sincronizado</span>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <AddonActionDialog pending={pending} onClose={() => setPending(null)} />
      <RequestAddonDialog
        open={requestOpen}
        tenantId={tenantId}
        saasProductId={saasProductId ?? null}
        onClose={() => setRequestOpen(false)}
      />
    </div>
  );
}

function entitlementValue(e: {
  kind: string | null;
  enabled: boolean | null;
  value: number | null;
  included: number | null;
  unit: string | null;
  period: string | null;
}): string {
  if (e.kind === 'FEATURE' || e.kind === 'AI_FEATURE') return e.enabled ? 'Habilitada' : 'No habilitada';
  const amount = e.value ?? e.included;
  if (amount === null || amount === undefined) return e.enabled ? 'Habilitada · sin tope declarado' : 'No habilitada';
  const unit = e.unit ? ` ${e.unit}` : '';
  const period = e.period ? ` / ${e.period}` : '';
  const label = e.kind === 'ALLOWANCE' ? 'Incluye' : 'Tope';
  return `${label} ${formatNumber(amount)}${unit}${period}`;
}

/* ==========================================================================
   Diálogos
   ========================================================================== */

function AddonActionDialog({ pending, onClose }: { pending: PendingAction | null; onClose: () => void }) {
  const toast = useToast();
  const approve = useApproveTenantAddon();
  const reject = useRejectTenantAddon();
  const scheduleCancel = useScheduleCancelTenantAddon();
  const reactivate = useReactivateTenantAddon();
  const suspend = useSuspendTenantAddon();
  const resume = useResumeTenantAddon();
  const cancel = useCancelTenantAddon();

  const mutation = (() => {
    switch (pending?.action) {
      case 'APPROVE': return approve;
      case 'REJECT': return reject;
      case 'SCHEDULE_CANCEL': return scheduleCancel;
      case 'REACTIVATE': return reactivate;
      case 'SUSPEND': return suspend;
      case 'RESUME': return resume;
      case 'CANCEL': return cancel;
      default: return null;
    }
  })();

  const form = useForm<ReasonValues>({
    resolver: zodResolver(reasonSchema),
    defaultValues: { reason: '', effective_to: '' },
  });

  useEffect(() => {
    if (!pending) return;
    mutation?.reset();
    form.reset({ reason: '', effective_to: '' });
  }, [pending]);

  const submit = form.handleSubmit(async (values) => {
    if (!pending) return;
    const parsed = reasonSchema.parse(values);
    const base = { p_tenant_addon_id: pending.id, p_reason: parsed.reason };
    try {
      switch (pending.action) {
        case 'APPROVE': await approve.mutateAsync(base); break;
        case 'REJECT': await reject.mutateAsync(base); break;
        case 'SCHEDULE_CANCEL':
          await scheduleCancel.mutateAsync({ ...base, p_effective_to: parsed.effective_to || undefined });
          break;
        case 'REACTIVATE': await reactivate.mutateAsync(base); break;
        case 'SUSPEND': await suspend.mutateAsync(base); break;
        case 'RESUME': await resume.mutateAsync(base); break;
        case 'CANCEL': await cancel.mutateAsync(base); break;
      }
      toast.success(ACTION_COPY[pending.action].done, pending.name);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  const copy = pending ? ACTION_COPY[pending.action] : null;

  return (
    <FormDialog
      open={Boolean(pending)}
      title={copy ? `${copy.title} · ${pending?.name}` : ''}
      description={copy?.description}
      submitLabel={copy?.label ?? 'Confirmar'}
      busy={mutation?.isPending ?? false}
      error={mutation?.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      {pending?.action === 'SCHEDULE_CANCEL' ? (
        <TextField label="Fecha de baja" type="date"
          hint="Opcional. Vacío = fin del periodo facturado."
          {...form.register('effective_to')} />
      ) : null}
      <TextAreaField label="Motivo" required
        hint="Queda en la auditoría comercial."
        error={form.formState.errors.reason} {...form.register('reason')} />
    </FormDialog>
  );
}

function RequestAddonDialog({
  open,
  tenantId,
  saasProductId,
  onClose,
}: {
  open: boolean;
  tenantId: string;
  saasProductId: string | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const items = useCatalogItemsWithLifecycle();
  const request = useRequestTenantAddon();

  // Sólo se ofrecen add-ons «Disponibles» del producto del tenant (o
  // transversales). Es para no ofrecer lo imposible; la base lo revalida.
  const options = (items.data ?? [])
    .filter((i) => i.lifecycle_status === 'AVAILABLE')
    .filter((i) => !i.saas_product_id || !saasProductId || i.saas_product_id === saasProductId)
    .map((i) => ({ value: i.code, label: `${i.name} (${i.code})` }));

  const form = useForm<RequestValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: { addon_code: '', reason: '' },
  });

  useEffect(() => {
    if (!open) return;
    request.reset();
    form.reset({ addon_code: '', reason: '' });
  }, [open]);

  const submit = form.handleSubmit(async (values) => {
    const parsed = requestSchema.parse(values);
    try {
      await request.mutateAsync({
        p_tenant_id: tenantId,
        p_addon_code: parsed.addon_code,
        p_reason: parsed.reason || undefined,
      });
      toast.success('Add-on solicitado', 'Queda pendiente de aprobación comercial: todavía no está activo.');
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title="Solicitar add-on"
      description="Solicitar no activa nada: el add-on queda «Solicitado» hasta que comercial lo apruebe."
      submitLabel="Solicitar"
      busy={request.isPending}
      error={request.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <SelectField label="Add-on" required
        placeholder={options.length === 0 ? 'No hay add-ons disponibles' : 'Elige el add-on…'}
        options={options}
        error={form.formState.errors.addon_code} {...form.register('addon_code')} />
      <TextAreaField label="Motivo" hint="Opcional: contexto para quien aprueba."
        error={form.formState.errors.reason} {...form.register('reason')} />
    </FormDialog>
  );
}
