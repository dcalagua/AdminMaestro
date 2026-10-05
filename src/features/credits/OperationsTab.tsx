import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCatalogItemsWithLifecycle, useSubscriptions } from '@/services/queries';
import { useOpenAiCreditPeriod, usePurchaseAiCredits, useRecordAiCreditEntry } from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, Badge } from '@/components/ui/primitives';
import { FormDialog } from '@/components/ui/FormDialog';
import { FieldRow, NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { Money } from '@/components/ui/Money';
import { useToast } from '@/components/ui/toast-context';
import {
  currentPeriodStart, formatQuantity, monthOf, newIdempotencyKey, periodFromMonth, poolLabel, undecidedText,
} from '@/features/usage/usageLabels';
import { useLookups, type Lookups } from '@/features/usage/useLookups';

/**
 * Operaciones de créditos IA (solo EBIM_FINANCE):
 *  - abrir el período de un tenant (GRANT_PERIOD de los incluidos de su política);
 *  - bono o ajuste manual, limitado en la UI a GRANT_BONUS / ADJUST (la compra
 *    tiene su propio circuito porque factura);
 *  - compra de paquetes: ítem CREDIT_PURCHASE en el contrato + GRANT_PURCHASE.
 * Cada movimiento manual lleva motivo y una clave de idempotencia generada al
 * abrir el diálogo: reintentar el mismo envío no duplica créditos.
 */
type Op = 'OPEN' | 'MANUAL' | 'PURCHASE';

interface LastResult {
  title: string;
  lines: Array<[string, React.ReactNode]>;
  tone: 'ok' | 'warn';
}

export function OperationsTab() {
  const perms = usePermissions();
  const lookups = useLookups();
  const [op, setOp] = useState<Op | null>(null);
  const [last, setLast] = useState<LastResult | null>(null);

  if (!perms.canReadFinance) {
    return (
      <Card title="Operaciones">
        <p className="px-4 py-6 text-body text-muted">
          Abrir períodos, registrar bonos, ajustes y compras de créditos es exclusivo de EBIM_FINANCE.
        </p>
      </Card>
    );
  }

  const cards: Array<{ id: Op; title: string; text: string; action: string }> = [
    {
      id: 'OPEN',
      title: 'Abrir período',
      text: 'Acredita los créditos incluidos de la política vigente del tenant para el mes. Idempotente: repetirlo no duplica. Sin política responde «No decidido (D-03)».',
      action: 'Abrir período',
    },
    {
      id: 'MANUAL',
      title: 'Bono o ajuste',
      text: 'Bono (siempre positivo) o ajuste (positivo o negativo) de finanzas, con motivo. No factura.',
      action: 'Registrar bono o ajuste',
    },
    {
      id: 'PURCHASE',
      title: 'Compra de créditos',
      text: 'Paquetes de un ítem con créditos por paquete y tarifa CREDIT_PURCHASE vigente: crea el cargo único en el contrato y acredita los créditos.',
      action: 'Registrar compra',
    },
  ];

  return (
    <div className="space-y-4">
      {last ? (
        <div role="status" className="ebim-card px-4 py-3 text-body">
          <div className="flex items-center gap-2 font-semibold">
            <Badge tone={last.tone}>{last.tone === 'ok' ? 'Hecho' : 'Atención'}</Badge> {last.title}
          </div>
          <dl className="mt-2 grid gap-1 sm:grid-cols-3">
            {last.lines.map(([k, v]) => (
              <div key={k}>
                <dt className="text-caption font-bold uppercase tracking-wider text-muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.id} title={c.title}>
            <div className="flex h-full flex-col gap-3 p-4">
              <p className="text-body text-muted">{c.text}</p>
              <div>
                <button type="button" className="ebim-btn-primary" onClick={() => setOp(c.id)}>
                  {c.action}
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <OpenPeriodDialog open={op === 'OPEN'} lookups={lookups} onClose={() => setOp(null)} onResult={setLast} />
      <ManualEntryDialog open={op === 'MANUAL'} lookups={lookups} onClose={() => setOp(null)} onResult={setLast} />
      <PurchaseDialog open={op === 'PURCHASE'} lookups={lookups} onClose={() => setOp(null)} onResult={setLast} />
    </div>
  );
}

/** Pools válidos de un tenant: el transversal o el de su producto. */
function poolOptions(productCode: string | null | undefined) {
  const options = [{ value: 'TENANT', label: poolLabel('TENANT') }];
  if (productCode) options.push({ value: `PRODUCT:${productCode}`, label: poolLabel(`PRODUCT:${productCode}`) });
  return options;
}

const monthField = z.string().regex(/^\d{4}-\d{2}$/, 'Elige el mes');

/* ---- Abrir período ------------------------------------------------------ */

const openSchema = z.object({ tenant_id: z.string().min(1, 'Elige el tenant'), month: monthField });
type OpenValues = z.input<typeof openSchema>;

function OpenPeriodDialog({
  open,
  lookups,
  onClose,
  onResult,
}: {
  open: boolean;
  lookups: Lookups;
  onClose: () => void;
  onResult: (r: LastResult) => void;
}) {
  const toast = useToast();
  const openPeriod = useOpenAiCreditPeriod();
  const form = useForm<OpenValues>({ resolver: zodResolver(openSchema) });

  useEffect(() => {
    if (!open) return;
    openPeriod.reset();
    form.reset({ tenant_id: '', month: monthOf(currentPeriodStart()) });
  }, [open]);

  const submit = form.handleSubmit(async (values) => {
    const v = openSchema.parse(values);
    try {
      const result = (await openPeriod.mutateAsync({
        p_tenant_id: v.tenant_id,
        p_period_start: periodFromMonth(v.month),
      })) as { granted?: number; code?: string } | null;
      const undecided = result?.code === 'POLITICA_CREDITOS_NO_DEFINIDA';
      onResult({
        title: `Período ${v.month} · ${lookups.tenantName(v.tenant_id)}`,
        tone: undecided ? 'warn' : 'ok',
        lines: [
          ['Entradas creadas', String(result?.granted ?? 0)],
          ['Política', undecided ? undecidedText('D-03') : 'Aplicada'],
        ],
      });
      if (undecided) toast.error('Sin política de créditos', `${undecidedText('D-03')}: no se acreditó nada.`);
      else toast.success('Período abierto', `${result?.granted ?? 0} entrada(s) de incluidos`);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title="Abrir período de créditos"
      description="GRANT_PERIOD de los créditos incluidos por la política vigente del tenant en ese mes."
      submitLabel="Abrir período"
      busy={openPeriod.isPending}
      error={openPeriod.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <SelectField label="Tenant" required placeholder="Elige el tenant…" options={lookups.tenantOptions}
        error={form.formState.errors.tenant_id} {...form.register('tenant_id')} />
      <TextField label="Mes" type="month" required error={form.formState.errors.month} {...form.register('month')} />
    </FormDialog>
  );
}

/* ---- Bono o ajuste ------------------------------------------------------ */

const manualSchema = z
  .object({
    tenant_id: z.string().min(1, 'Elige el tenant'),
    pool_key: z.string().min(1, 'Elige el pool'),
    month: monthField,
    entry_type: z.enum(['GRANT_BONUS', 'ADJUST']),
    credits: z.coerce.number({ error: 'Número de créditos' }),
    reason: z.string().trim().min(3, 'El motivo es obligatorio'),
  })
  .refine((v) => (v.entry_type === 'GRANT_BONUS' ? v.credits > 0 : v.credits !== 0), {
    path: ['credits'],
    message: 'Un bono es > 0; un ajuste es distinto de 0',
  });
type ManualValues = z.input<typeof manualSchema>;

function ManualEntryDialog({
  open,
  lookups,
  onClose,
  onResult,
}: {
  open: boolean;
  lookups: Lookups;
  onClose: () => void;
  onResult: (r: LastResult) => void;
}) {
  const toast = useToast();
  const record = useRecordAiCreditEntry();
  const form = useForm<ManualValues>({ resolver: zodResolver(manualSchema) });
  const [key, setKey] = useState('');

  useEffect(() => {
    if (!open) return;
    record.reset();
    setKey(newIdempotencyKey('manual'));
    form.reset({ tenant_id: '', pool_key: 'TENANT', month: monthOf(currentPeriodStart()), entry_type: 'GRANT_BONUS', credits: '', reason: '' });
  }, [open]);

  const tenantId = form.watch('tenant_id');
  const productCode = tenantId ? (lookups.tenantById.get(tenantId)?.productCode ?? null) : null;

  const submit = form.handleSubmit(async (values) => {
    const v = manualSchema.parse(values);
    try {
      const id = await record.mutateAsync({
        p_tenant_id: v.tenant_id,
        p_pool_key: v.pool_key,
        p_period_start: periodFromMonth(v.month),
        p_entry_type: v.entry_type,
        p_credits: v.credits,
        p_reason: v.reason,
        p_idempotency_key: key,
      });
      onResult({
        title: `${v.entry_type === 'GRANT_BONUS' ? 'Bono' : 'Ajuste'} · ${lookups.tenantName(v.tenant_id)}`,
        tone: 'ok',
        lines: [
          ['Créditos', formatQuantity(v.credits)],
          ['Pool', poolLabel(v.pool_key)],
          ['Movimiento', <span key="id" className="font-mono text-compact">{String(id)}</span>],
        ],
      });
      toast.success('Movimiento registrado', `${formatQuantity(v.credits)} créditos`);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      wide
      title="Bono o ajuste de créditos"
      description="Movimiento manual de finanzas. Las compras se registran aparte porque facturan."
      submitLabel="Registrar"
      busy={record.isPending}
      error={record.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <FieldRow>
        <SelectField label="Tenant" required placeholder="Elige el tenant…" options={lookups.tenantOptions}
          error={form.formState.errors.tenant_id} {...form.register('tenant_id')} />
        <SelectField label="Pool" required options={poolOptions(productCode)}
          error={form.formState.errors.pool_key} {...form.register('pool_key')} />
      </FieldRow>
      <FieldRow>
        <SelectField label="Tipo" required
          options={[
            { value: 'GRANT_BONUS', label: 'Bono (suma)' },
            { value: 'ADJUST', label: 'Ajuste (±)' },
          ]}
          error={form.formState.errors.entry_type} {...form.register('entry_type')} />
        <NumberField label="Créditos" required step="any" error={form.formState.errors.credits} {...form.register('credits')} />
      </FieldRow>
      <TextField label="Mes" type="month" required error={form.formState.errors.month} {...form.register('month')} />
      <TextAreaField label="Motivo" required error={form.formState.errors.reason} {...form.register('reason')} />
      <p className="text-compact text-muted">
        Clave de idempotencia: <span className="font-mono">{key}</span>
      </p>
    </FormDialog>
  );
}

/* ---- Compra ------------------------------------------------------------- */

const purchaseSchema = z.object({
  subscription_id: z.string().min(1, 'Elige el contrato'),
  catalog_item_code: z.string().min(1, 'Elige el paquete'),
  packs: z.coerce.number({ error: 'Número de paquetes' }).int('Paquetes enteros').min(1, 'Al menos 1 paquete'),
  pool_key: z.string().min(1, 'Elige el pool'),
  month: monthField,
  reason: z.string().trim().min(3, 'El motivo es obligatorio'),
});
type PurchaseValues = z.input<typeof purchaseSchema>;

function PurchaseDialog({
  open,
  lookups,
  onClose,
  onResult,
}: {
  open: boolean;
  lookups: Lookups;
  onClose: () => void;
  onResult: (r: LastResult) => void;
}) {
  const toast = useToast();
  const purchase = usePurchaseAiCredits();
  const subscriptions = useSubscriptions();
  const items = useCatalogItemsWithLifecycle();
  const form = useForm<PurchaseValues>({ resolver: zodResolver(purchaseSchema) });
  const [key, setKey] = useState('');

  useEffect(() => {
    if (!open) return;
    purchase.reset();
    setKey(newIdempotencyKey('console'));
    form.reset({ subscription_id: '', catalog_item_code: '', packs: 1, pool_key: 'TENANT', month: monthOf(currentPeriodStart()), reason: '' });
  }, [open]);

  const eligible = (subscriptions.data ?? []).filter(
    (s) => s.tenant_id && (s.status === 'ACTIVE' || s.status === 'PAST_DUE'),
  );
  const subscriptionId = form.watch('subscription_id');
  const sub = eligible.find((s) => s.id === subscriptionId);
  const productCode = (sub?.saas_products as { code: string } | null)?.code ?? null;
  const packs = (items.data ?? []).filter(
    (i) =>
      i.credit_pack_credits !== null &&
      i.lifecycle_status === 'AVAILABLE' &&
      (!sub || !i.saas_product_id || i.saas_product_id === sub.saas_product_id),
  );

  const submit = form.handleSubmit(async (values) => {
    const v = purchaseSchema.parse(values);
    try {
      const result = (await purchase.mutateAsync({
        p_subscription_id: v.subscription_id,
        p_catalog_item_code: v.catalog_item_code,
        p_packs: v.packs,
        p_pool_key: v.pool_key,
        p_period_start: periodFromMonth(v.month),
        p_reason: v.reason,
        p_idempotency_key: key,
      })) as { credits?: number; unit_amount?: number; currency?: string; created?: boolean } | null;
      onResult({
        title: `Compra · ${v.catalog_item_code} × ${v.packs}`,
        tone: 'ok',
        lines: [
          ['Créditos acreditados', formatQuantity(result?.credits ?? null)],
          [
            'Precio por paquete',
            result?.unit_amount !== undefined && result?.currency ? (
              <Money key="m" amount={result.unit_amount} currency={result.currency} />
            ) : (
              '—'
            ),
          ],
          ['Nuevo', result?.created === false ? 'No (misma clave: ya existía)' : 'Sí'],
        ],
      });
      toast.success('Compra registrada', 'Se creó el cargo único en el contrato y se acreditaron los créditos.');
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      wide
      title="Compra de créditos"
      description="Requiere créditos por paquete (D-03) y tarifa CREDIT_PURCHASE vigente en el mercado y moneda del contrato (D-02). Un tenant DEMO/SANDBOX no compra: usa un bono."
      submitLabel="Registrar compra"
      busy={purchase.isPending}
      error={purchase.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <FieldRow>
        <SelectField label="Contrato" required placeholder="Elige el contrato…"
          options={eligible.map((s) => ({
            value: s.id,
            label: `${s.code} · ${(s.tenants as { name: string } | null)?.name ?? lookups.tenantName(s.tenant_id)}`,
          }))}
          error={form.formState.errors.subscription_id} {...form.register('subscription_id')} />
        <SelectField label="Paquete" required
          placeholder={packs.length === 0 ? `Ningún paquete decidido (D-03)` : 'Elige el paquete…'}
          options={packs.map((i) => ({ value: i.code, label: `${i.name} · ${formatQuantity(i.credit_pack_credits)} créditos` }))}
          error={form.formState.errors.catalog_item_code} {...form.register('catalog_item_code')} />
      </FieldRow>
      <FieldRow>
        <NumberField label="Paquetes" required min={1} step={1} error={form.formState.errors.packs} {...form.register('packs')} />
        <SelectField label="Pool" required options={poolOptions(productCode)}
          hint="Debe ser el pool de la política vigente del período."
          error={form.formState.errors.pool_key} {...form.register('pool_key')} />
      </FieldRow>
      <TextField label="Mes" type="month" required error={form.formState.errors.month} {...form.register('month')} />
      <TextAreaField label="Motivo" required error={form.formState.errors.reason} {...form.register('reason')} />
      <p className="text-compact text-muted">
        Clave de idempotencia: <span className="font-mono">{key}</span>
      </p>
    </FormDialog>
  );
}
