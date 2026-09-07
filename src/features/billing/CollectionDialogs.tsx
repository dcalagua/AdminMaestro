import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextField, SelectField, NumberField, CheckboxField, TextAreaField, FieldRow } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { useProviderAccounts } from '@/services/queries';
import {
  useSetCollectionProfile, useRequestDocument, useReceiveDocument, useApproveDocument,
} from '@/services/mutations';

/* ==========================================================================
   Perfil de cobro de una suscripción
   ========================================================================== */

const METHODS = [
  { value: 'CULQI_CARD', label: 'Tarjeta (Culqi)' },
  { value: 'SERVICE_ORDER', label: 'Orden de Servicio' },
  { value: 'PURCHASE_ORDER', label: 'Orden de Compra' },
  { value: 'BANK_TRANSFER', label: 'Transferencia bancaria' },
  { value: 'MANUAL', label: 'Manual' },
];

const profileSchema = z
  .object({
    collection_method: z.enum([
      'CULQI_CARD', 'SERVICE_ORDER', 'PURCHASE_ORDER', 'BANK_TRANSFER', 'MANUAL',
    ]),
    provider_account_id: z.string().optional(),
    invoice_lead_days: z.coerce.number().int().min(0).max(365),
    renewal_notice_days: z.coerce.number().int().min(0).max(365),
    payment_due_days: z.coerce.number().int().min(0).max(365),
    grace_period_days: z.coerce.number().int().min(0).max(365),
    document_lead_days: z.coerce.number().int().min(0).max(365),
    auto_suspend: z.boolean(),
    effective_from: z.string().min(1, 'Obligatorio'),
    notes: z.string().trim().optional(),
  })
  .refine((v) => v.collection_method !== 'CULQI_CARD' || Boolean(v.provider_account_id), {
    path: ['provider_account_id'],
    message: 'El cobro con tarjeta exige una cuenta de proveedor Culqi',
  })
  .refine((v) => !v.auto_suspend || v.grace_period_days >= 1, {
    path: ['grace_period_days'],
    message: 'La suspensión automática exige al menos 1 día de gracia',
  });

type ProfileValues = z.input<typeof profileSchema>;

export function CollectionProfileDialog({
  open,
  subscriptionId,
  subscriptionCode,
  current,
  onClose,
}: {
  open: boolean;
  subscriptionId: string | null;
  subscriptionCode: string;
  current?: Record<string, unknown> | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const accounts = useProviderAccounts();
  const setProfile = useSetCollectionProfile();

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      collection_method: 'MANUAL', provider_account_id: '',
      invoice_lead_days: 0, renewal_notice_days: 30, payment_due_days: 15,
      grace_period_days: 10, document_lead_days: 45, auto_suspend: false,
      effective_from: new Date().toISOString().slice(0, 10), notes: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    setProfile.reset();
    form.reset({
      collection_method:
        (current?.collection_method as ProfileValues['collection_method']) ?? 'MANUAL',
      provider_account_id: (current?.provider_account_id as string) ?? '',
      invoice_lead_days: (current?.invoice_lead_days as number) ?? 0,
      renewal_notice_days: (current?.renewal_notice_days as number) ?? 30,
      payment_due_days: (current?.payment_due_days as number) ?? 15,
      grace_period_days: (current?.grace_period_days as number) ?? 10,
      document_lead_days: (current?.document_lead_days as number) ?? 45,
      auto_suspend: (current?.auto_suspend as boolean) ?? false,
      // Un perfil nuevo empieza HOY salvo que se indique otra cosa; la base exige
      // que sea posterior al inicio del vigente.
      effective_from: new Date().toISOString().slice(0, 10),
      notes: '',
    });
  }, [open, current]);

  const method = form.watch('collection_method');
  const needsProvider = method === 'CULQI_CARD';
  const needsDocument = method === 'SERVICE_ORDER' || method === 'PURCHASE_ORDER';

  const accountOptions = (accounts.data ?? [])
    .filter((a) => a.status === 'ACTIVE')
    .filter((a) => !needsProvider || a.provider_kind === 'CULQI')
    .map((a) => ({ value: a.id, label: `${a.code} · ${a.name} (${a.environment})` }));

  const submit = form.handleSubmit(async (raw) => {
    const v = profileSchema.parse(raw);
    if (!subscriptionId) return;
    try {
      await setProfile.mutateAsync({
        p_subscription_id: subscriptionId,
        p_collection_method: v.collection_method,
        p_provider_account_id: v.provider_account_id || undefined,
        p_invoice_lead_days: v.invoice_lead_days,
        p_renewal_notice_days: v.renewal_notice_days,
        p_payment_due_days: v.payment_due_days,
        p_grace_period_days: v.grace_period_days,
        p_document_lead_days: v.document_lead_days,
        p_auto_suspend: v.auto_suspend,
        p_effective_from: v.effective_from,
        p_notes: v.notes || undefined,
      });
      toast.success(
        'Cobranza configurada',
        `${subscriptionCode}: el perfil anterior queda cerrado, no borrado.`,
      );
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={`Cobranza · ${subscriptionCode}`}
      description="Configurar CÓMO se cobra no registra ningún cobro. El dinero solo entra por `payments`."
      submitLabel="Guardar perfil"
      busy={setProfile.isPending}
      error={setProfile.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
      wide
    >
      <FieldRow>
        <SelectField
          label="Método de cobro" required options={METHODS}
          hint="Se configura por suscripción: el mismo cliente puede pagar cada SaaS de otra forma."
          error={form.formState.errors.collection_method}
          {...form.register('collection_method')}
        />
        <SelectField
          label="Cuenta de proveedor"
          placeholder={needsProvider ? 'Elige la cuenta Culqi…' : 'Ninguna'}
          options={accountOptions}
          disabled={!needsProvider}
          hint={
            needsProvider
              ? 'Solo se listan cuentas Culqi activas. Las cuentas no guardan secretos.'
              : 'Solo aplica al cobro con tarjeta.'
          }
          error={form.formState.errors.provider_account_id}
          {...form.register('provider_account_id')}
        />
      </FieldRow>

      {needsProvider ? (
        <p className="rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
          El cargo automático queda activado. Si la cuenta no tiene credenciales configuradas, el
          adapter opera en modo MOCK y no se ejecuta ningún cobro real.
        </p>
      ) : null}
      {needsDocument ? (
        <p className="rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
          Este método exige documento del cliente. Recibirlo o aprobarlo habilita el trámite, pero{' '}
          <strong>no equivale a un cobro</strong> ni devenga comisión.
        </p>
      ) : null}

      <FieldRow>
        <NumberField
          label="Emitir factura (días antes)" min={0} max={365} step={1}
          error={form.formState.errors.invoice_lead_days} {...form.register('invoice_lead_days')}
        />
        <NumberField
          label="Avisar renovación (días antes)" min={0} max={365} step={1}
          error={form.formState.errors.renewal_notice_days} {...form.register('renewal_notice_days')}
        />
      </FieldRow>

      <FieldRow>
        <NumberField
          label="Vencimiento (días tras emitir)" min={0} max={365} step={1}
          error={form.formState.errors.payment_due_days} {...form.register('payment_due_days')}
        />
        <NumberField
          label="Gracia (días tras vencer)" min={0} max={365} step={1}
          error={form.formState.errors.grace_period_days} {...form.register('grace_period_days')}
        />
      </FieldRow>

      <FieldRow>
        <NumberField
          label="Pedir OS/OC (días antes)" min={0} max={365} step={1}
          hint="Ej. 45 días para una Orden de Servicio anual."
          error={form.formState.errors.document_lead_days} {...form.register('document_lead_days')}
        />
        <TextField
          label="Vigente desde" type="date" required
          hint="Debe ser posterior al inicio del perfil actual."
          error={form.formState.errors.effective_from} {...form.register('effective_from')}
        />
      </FieldRow>

      <CheckboxField
        label="Suspender automáticamente al acabar la gracia"
        hint="Genera una solicitud SUSPEND_TENANT; nunca suspende como efecto colateral de una lectura."
        {...form.register('auto_suspend')}
      />
      {form.formState.errors.grace_period_days ? (
        <p className="-mt-2 text-xs text-danger" role="alert">
          {form.formState.errors.grace_period_days.message}
        </p>
      ) : null}

      <TextAreaField label="Notas" error={form.formState.errors.notes} {...form.register('notes')} />
    </FormDialog>
  );
}

/* ==========================================================================
   Solicitar OS/OC
   ========================================================================== */

const requestSchema = z.object({
  document_type: z.enum(['SERVICE_ORDER', 'PURCHASE_ORDER']),
  valid_from: z.string().optional(),
  valid_to: z.string().optional(),
  amount: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

type RequestValues = z.infer<typeof requestSchema>;

const DOC_TYPES = [
  { value: 'SERVICE_ORDER', label: 'Orden de Servicio' },
  { value: 'PURCHASE_ORDER', label: 'Orden de Compra' },
];

export function RequestDocumentDialog({
  open,
  subscriptionId,
  subscriptionCode,
  defaultType,
  onClose,
}: {
  open: boolean;
  subscriptionId: string | null;
  subscriptionCode: string;
  defaultType?: 'SERVICE_ORDER' | 'PURCHASE_ORDER';
  onClose: () => void;
}) {
  const toast = useToast();
  const request = useRequestDocument();

  const form = useForm<RequestValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: {
      document_type: defaultType ?? 'SERVICE_ORDER',
      valid_from: '', valid_to: '', amount: '', notes: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    request.reset();
    form.reset({
      document_type: defaultType ?? 'SERVICE_ORDER',
      valid_from: '', valid_to: '', amount: '', notes: '',
    });
  }, [open, defaultType]);

  const submit = form.handleSubmit(async (v) => {
    if (!subscriptionId) return;
    try {
      await request.mutateAsync({
        p_subscription_id: subscriptionId,
        p_document_type: v.document_type,
        p_valid_from: v.valid_from || undefined,
        p_valid_to: v.valid_to || undefined,
        p_amount: v.amount ? Number(v.amount) : undefined,
        p_notes: v.notes || undefined,
      });
      toast.success('Documento solicitado', `${subscriptionCode}: queda en estado SOLICITADO.`);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={`Solicitar documento · ${subscriptionCode}`}
      description="Se registra la petición al cliente. El número llega cuando el documento se recibe."
      submitLabel="Solicitar"
      busy={request.isPending}
      error={request.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <SelectField
        label="Tipo de documento" required options={DOC_TYPES}
        error={form.formState.errors.document_type} {...form.register('document_type')}
      />
      <FieldRow>
        <TextField
          label="Cubre desde" type="date"
          error={form.formState.errors.valid_from} {...form.register('valid_from')}
        />
        <TextField
          label="Cubre hasta" type="date"
          hint="Obligatorio al aprobar: sin vencimiento no se puede caducar."
          error={form.formState.errors.valid_to} {...form.register('valid_to')}
        />
      </FieldRow>
      <TextField
        label="Importe autorizado" type="number" min={0} step="0.01"
        error={form.formState.errors.amount} {...form.register('amount')}
      />
      <TextAreaField label="Notas" error={form.formState.errors.notes} {...form.register('notes')} />
    </FormDialog>
  );
}

/* ==========================================================================
   Registrar recepción
   ========================================================================== */

const receiveSchema = z.object({
  document_number: z.string().trim().min(1, 'El número del documento es obligatorio'),
  valid_from: z.string().optional(),
  valid_to: z.string().optional(),
  amount: z.string().trim().optional(),
  external_file_ref: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

type ReceiveValues = z.infer<typeof receiveSchema>;

export function ReceiveDocumentDialog({
  open,
  documentId,
  onClose,
}: {
  open: boolean;
  documentId: string | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const receive = useReceiveDocument();

  const form = useForm<ReceiveValues>({
    resolver: zodResolver(receiveSchema),
    defaultValues: {
      document_number: '', valid_from: '', valid_to: '', amount: '',
      external_file_ref: '', notes: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    receive.reset();
    form.reset();
  }, [open]);

  const submit = form.handleSubmit(async (v) => {
    if (!documentId) return;
    try {
      await receive.mutateAsync({
        p_document_id: documentId,
        p_document_number: v.document_number,
        p_valid_from: v.valid_from || undefined,
        p_valid_to: v.valid_to || undefined,
        p_amount: v.amount ? Number(v.amount) : undefined,
        p_external_file_ref: v.external_file_ref || undefined,
        p_notes: v.notes || undefined,
      });
      toast.success('Documento recibido', `${v.document_number} · no registra ningún cobro.`);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title="Registrar documento recibido"
      description="Recibir la OS/OC mueve el trámite administrativo. No mueve dinero."
      submitLabel="Registrar recepción"
      busy={receive.isPending}
      error={receive.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <TextField
        label="Número del documento" required placeholder="OS-2026-0455"
        error={form.formState.errors.document_number} {...form.register('document_number')}
      />
      <FieldRow>
        <TextField
          label="Cubre desde" type="date"
          error={form.formState.errors.valid_from} {...form.register('valid_from')}
        />
        <TextField
          label="Cubre hasta" type="date"
          error={form.formState.errors.valid_to} {...form.register('valid_to')}
        />
      </FieldRow>
      <TextField
        label="Importe autorizado" type="number" min={0} step="0.01"
        error={form.formState.errors.amount} {...form.register('amount')}
      />
      <TextField
        label="Referencia del archivo" placeholder="storage://os/2026/os-0455.pdf"
        hint="Una referencia, no el archivo ni una URL firmada."
        error={form.formState.errors.external_file_ref} {...form.register('external_file_ref')}
      />
      <TextAreaField label="Notas" error={form.formState.errors.notes} {...form.register('notes')} />
    </FormDialog>
  );
}

/* ==========================================================================
   Aprobar
   ========================================================================== */

const approveSchema = z.object({
  valid_to: z.string().min(1, 'Una OS/OC aprobada necesita fecha de vencimiento'),
  notes: z.string().trim().optional(),
});

type ApproveValues = z.infer<typeof approveSchema>;

export function ApproveDocumentDialog({
  open,
  documentId,
  documentNumber,
  defaultValidTo,
  onClose,
}: {
  open: boolean;
  documentId: string | null;
  documentNumber: string;
  defaultValidTo?: string | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const approve = useApproveDocument();

  const form = useForm<ApproveValues>({
    resolver: zodResolver(approveSchema),
    defaultValues: { valid_to: defaultValidTo ?? '', notes: '' },
  });

  useEffect(() => {
    if (!open) return;
    approve.reset();
    form.reset({ valid_to: defaultValidTo ?? '', notes: '' });
  }, [open, defaultValidTo]);

  const submit = form.handleSubmit(async (v) => {
    if (!documentId) return;
    try {
      await approve.mutateAsync({
        p_document_id: documentId,
        p_valid_to: v.valid_to,
        p_notes: v.notes || undefined,
      });
      toast.success(
        'Documento aprobado',
        `${documentNumber} habilita el trámite. No se registró ningún cobro.`,
      );
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={`Aprobar ${documentNumber}`}
      description="Aprobar habilita la continuidad administrativa. NO crea un pago ni devenga comisión: eso solo ocurre con un cobro confirmado."
      submitLabel="Aprobar documento"
      busy={approve.isPending}
      error={approve.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <TextField
        label="Vence el" type="date" required
        hint="Sin vencimiento el documento no podría caducar nunca."
        error={form.formState.errors.valid_to} {...form.register('valid_to')}
      />
      <TextAreaField label="Notas" error={form.formState.errors.notes} {...form.register('notes')} />
    </FormDialog>
  );
}
