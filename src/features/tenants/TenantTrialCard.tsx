import { useEffect, useState } from 'react';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextField, TextAreaField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { Badge, Card } from '@/components/ui/primitives';
import { useSetTenantTrialEnd } from '@/services/mutations';
import { formatDate } from '@/lib/format';
import {
  MAX_TRIAL_EXTENSION_DAYS,
  endOfDayIso,
  toDateInput,
  trialStatus,
  trialText,
  type TrialFields,
} from './tenantTrial';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Periodo de prueba del tenant (20261024000100). La fecha la fija la base al
 * crear el tenant TRIAL (días del producto) y solo cambia con
 * `set_tenant_trial_end`: extender (fecha futura) o convertir (sin vencimiento).
 * La app (eChange) aplica el vencimiento por su cuenta con lo que recibe por
 * trial.v1; aquí se gobierna.
 */
export function TenantTrialCard({
  tenant,
  canManage,
}: {
  tenant: TrialFields & { tenant_id?: unknown; name?: unknown; trial_days?: unknown; status?: unknown };
  canManage: boolean;
}) {
  const status = trialStatus(tenant);
  const [dialog, setDialog] = useState<'EXTEND' | 'CONVERT' | null>(null);
  if (status.kind === 'NOT_TRIAL') return null;

  const tone =
    status.kind === 'EXPIRED' ? 'danger' : status.kind === 'CONVERTED' ? 'ok' : status.kind === 'NO_END' ? 'neutral' : 'info';
  const badge =
    status.kind === 'EXPIRED' ? 'Vencida' : status.kind === 'CONVERTED' ? 'Convertida' : status.kind === 'NO_END' ? 'Sin fecha' : 'En prueba';
  const isTrial = status.kind !== 'CONVERTED';
  const manageable = canManage && isTrial && tenant.status !== 'CHURNED' && tenant.status !== 'ARCHIVED';

  return (
    <Card
      id="trial"
      title="Periodo de prueba"
      description="La app aplica el vencimiento por su cuenta. Extender o convertir solo se hace desde aquí, con motivo y auditoría."
      actions={
        manageable ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="ebim-btn-secondary ebim-btn-sm" onClick={() => setDialog('EXTEND')}>
              Extender prueba
            </button>
            <button type="button" className="ebim-btn-ghost ebim-btn-sm" onClick={() => setDialog('CONVERT')}>
              Marcar como convertida
            </button>
          </div>
        ) : null
      }
    >
      <div className="flex flex-wrap items-center gap-3 px-5 py-4" data-tenant-trial>
        <Badge tone={tone}>{badge}</Badge>
        <p className="text-body font-medium text-fg">{trialText(status)}</p>
        {typeof tenant.trial_days === 'number' && isTrial ? (
          <p className="text-compact text-muted">Prueba inicial de {tenant.trial_days} días.</p>
        ) : null}
      </div>
      {status.kind === 'EXPIRED' && tenant.status === 'ACTIVE' ? (
        <p className="border-t border-border px-5 py-3 text-compact text-warn" role="status">
          La app ya no deja operar a este cliente. Aquí sigue activo hasta que se aplique el vencimiento de pruebas;
          extender la prueba lo evita.
        </p>
      ) : null}
      <TrialEndDialog
        mode={dialog}
        tenantId={(tenant.tenant_id as string) ?? null}
        tenantName={(tenant.name as string) ?? ''}
        currentEndsAt={status.kind === 'ACTIVE' || status.kind === 'EXPIRED' ? status.endsAt : null}
        onClose={() => setDialog(null)}
      />
    </Card>
  );
}

function TrialEndDialog({
  mode,
  tenantId,
  tenantName,
  currentEndsAt,
  onClose,
}: {
  mode: 'EXTEND' | 'CONVERT' | null;
  tenantId: string | null;
  tenantName: string;
  currentEndsAt: string | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const setEnd = useSetTenantTrialEnd();
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [issue, setIssue] = useState<{ date?: string; reason?: string }>({});

  const today = new Date();
  const minDate = toDateInput(today);
  const maxDate = toDateInput(new Date(today.getTime() + MAX_TRIAL_EXTENSION_DAYS * DAY_MS));

  useEffect(() => {
    if (!mode) return;
    setEnd.reset();
    setIssue({});
    setReason(mode === 'CONVERT' ? 'Cliente convertido a contrato de pago' : '');
    // Sugerencia: una semana más desde hoy o desde el vencimiento vigente, lo que sea posterior.
    const base = Math.max(Date.now(), currentEndsAt ? Date.parse(currentEndsAt) : 0);
    setDate(toDateInput(new Date(base + 7 * DAY_MS)));
    // `setEnd` es estable entre renders; incluirlo reiniciaría el diálogo al enviar.
  }, [mode, currentEndsAt]);

  async function submit() {
    const next: { date?: string; reason?: string } = {};
    let endsAt: string | null = null;
    if (mode === 'EXTEND') {
      endsAt = endOfDayIso(date);
      if (!endsAt || date < minDate) next.date = 'Elige una fecha desde hoy';
      else if (date > maxDate) next.date = `Como máximo ${MAX_TRIAL_EXTENSION_DAYS} días desde hoy; si sigue, conviértela en cliente`;
    }
    if (!reason.trim()) next.reason = 'El motivo queda en la auditoría: es obligatorio';
    setIssue(next);
    if (next.date || next.reason || !tenantId) return;
    try {
      await setEnd.mutateAsync({
        p_tenant_id: tenantId,
        // null = convertir: la RPC lo acepta aunque el tipo generado no lo diga.
        p_ends_at: endsAt as unknown as string,
        p_reason: reason.trim(),
      });
      toast.success(
        mode === 'CONVERT' ? 'Prueba convertida' : 'Prueba extendida',
        mode === 'CONVERT' ? `${tenantName} ya no tiene vencimiento` : `${tenantName} vence el ${formatDate(endsAt)}`,
      );
      onClose();
    } catch {
      /* el error de negocio se muestra dentro del diálogo */
    }
  }

  return (
    <FormDialog
      open={mode !== null}
      title={mode === 'CONVERT' ? `Convertir la prueba de ${tenantName}` : `Extender la prueba de ${tenantName}`}
      description={
        mode === 'CONVERT'
          ? 'El tenant pasa a Producción y la prueba deja de vencer. Se avisa a la app y queda en auditoría.'
          : `Vencimiento actual: ${currentEndsAt ? formatDate(currentEndsAt) : 'sin fecha'}. La nueva fecha vence al final de ese día y se avisa a la app.`
      }
      submitLabel={mode === 'CONVERT' ? 'Marcar como convertida' : 'Extender prueba'}
      busy={setEnd.isPending}
      error={setEnd.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      {mode === 'EXTEND' ? (
        <TextField
          label="Nuevo vencimiento"
          type="date"
          required
          min={minDate}
          max={maxDate}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          error={issue.date ? { message: issue.date } : undefined}
        />
      ) : null}
      <TextAreaField
        label="Motivo (obligatorio)"
        required
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={mode === 'CONVERT' ? 'Firmó el contrato anual' : 'El cliente necesita una semana más para evaluar'}
        error={issue.reason ? { message: issue.reason } : undefined}
      />
    </FormDialog>
  );
}
