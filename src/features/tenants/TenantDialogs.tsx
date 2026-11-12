import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormDialog } from '@/components/ui/FormDialog';
import { SelectField, TextAreaField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { useSetTenantStatus } from '@/services/mutations';
import type { Enums } from '@/types/domain';
import { TENANT_STATUS_LABEL } from '@/types/domain';

/* ==========================================================================
   Cambio de estado
   ========================================================================== */

const statusSchema = z.object({
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'CHURNED', 'ARCHIVED']),
  reason: z.string().trim().optional(),
});

type StatusValues = z.infer<typeof statusSchema>;

/** Transiciones permitidas — el mismo grafo que valida `platform.set_tenant_status`. */
const NEXT_STATUS: Record<string, Array<Enums<'tenant_status'>>> = {
  PENDING: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['SUSPENDED', 'CHURNED'],
  SUSPENDED: ['ACTIVE', 'CHURNED', 'ARCHIVED'],
  CHURNED: ['ARCHIVED'],
  ARCHIVED: [],
};

/** Estados cuyo cambio exige motivo auditable, igual que en la base. */
const NEEDS_REASON = new Set(['SUSPENDED', 'CHURNED']);

export function TenantStatusDialog({
  open,
  tenantId,
  tenantName,
  currentStatus,
  onClose,
}: {
  open: boolean;
  tenantId: string | null;
  tenantName: string;
  currentStatus: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const setStatus = useSetTenantStatus();

  const options = (NEXT_STATUS[currentStatus] ?? []).map((s) => ({
    value: s,
    label: TENANT_STATUS_LABEL[s],
  }));

  const form = useForm<StatusValues>({
    resolver: zodResolver(statusSchema),
    defaultValues: { status: options[0]?.value ?? 'ACTIVE', reason: '' },
  });

  useEffect(() => {
    if (!open) return;
    setStatus.reset();
    form.reset({ status: options[0]?.value ?? 'ACTIVE', reason: '' });
  }, [open, currentStatus]);

  const selected = form.watch('status');
  const reasonRequired = NEEDS_REASON.has(selected);

  const submit = form.handleSubmit(async (values) => {
    if (reasonRequired && !values.reason?.trim()) {
      form.setError('reason', { message: 'Suspender o dar de baja exige un motivo auditable' });
      return;
    }
    if (!tenantId) return;
    try {
      await setStatus.mutateAsync({
        p_tenant_id: tenantId,
        p_status: values.status,
        p_reason: values.reason?.trim() || undefined,
      });
      toast.success('Estado actualizado', `${tenantName} → ${TENANT_STATUS_LABEL[values.status]}`);
      onClose();
    } catch {
      /* mensaje visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={`Cambiar estado de ${tenantName}`}
      description={
        options.length === 0
          ? 'Este tenant está en un estado terminal: no admite más transiciones.'
          : `Estado actual: ${TENANT_STATUS_LABEL[currentStatus as Enums<'tenant_status'>] ?? currentStatus}. El cambio queda registrado en auditoría.`
      }
      submitLabel="Aplicar cambio"
      busy={setStatus.isPending}
      error={setStatus.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <SelectField
        label="Nuevo estado"
        required
        options={options}
        error={form.formState.errors.status}
        {...form.register('status')}
      />
      <TextAreaField
        label={reasonRequired ? 'Motivo (obligatorio)' : 'Motivo'}
        required={reasonRequired}
        placeholder="Impago de la factura F-2026-0031, tercer aviso"
        hint="Un tenant apagado sin explicación es un incidente, no una operación."
        error={form.formState.errors.reason}
        {...form.register('reason')}
      />
    </FormDialog>
  );
}
