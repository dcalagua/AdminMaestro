import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextField, SelectField, NumberField, CheckboxField, TextAreaField, FieldRow } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import {
  useOrganizations, useProducts, useSalesAgents, useCommissionPlans, useTenantOverview, useCurrencies,
} from '@/services/queries';
import {
  useUpsertSalesAgent, useCreateAttribution, useUpsertCommissionPlan, useUpsertCommissionRule,
} from '@/services/mutations';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/* ==========================================================================
   Comercial (sales agent)
   ========================================================================== */

const agentSchema = z
  .object({
    code: z.string().trim().regex(SLUG, 'Minúsculas y guiones (ej. beto-andina)'),
    full_name: z.string().trim().min(2, 'Obligatorio'),
    agent_type: z.enum(['EBIM_INTERNAL', 'INDEPENDENT', 'PARTNER_AGENT']),
    organization_id: z.string().optional(),
    contact_email: z.string().trim().email('Correo inválido').or(z.literal('')).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED']),
    valid_from: z.string().min(1, 'Obligatorio'),
    valid_to: z.string().optional(),
  })
  // Mismas dos reglas que valida `platform.upsert_sales_agent`, para que el error
  // aparezca junto al campo en vez de llegar como excepción de la base.
  .refine((v) => v.agent_type !== 'PARTNER_AGENT' || Boolean(v.organization_id), {
    path: ['organization_id'],
    message: 'Un comercial de partner pertenece a una organización',
  })
  .refine((v) => v.agent_type !== 'INDEPENDENT' || !v.organization_id, {
    path: ['organization_id'],
    message: 'Un independiente no pertenece a ninguna organización; usa «De partner»',
  });

type AgentValues = z.infer<typeof agentSchema>;

export interface SalesAgentDraft {
  id: string;
  code: string;
  full_name: string;
  agent_type: string;
  organization_id: string | null;
  contact_email: string | null;
  status: string;
  valid_from: string;
  valid_to: string | null;
}

const AGENT_TYPES = [
  { value: 'INDEPENDENT', label: 'Independiente' },
  { value: 'PARTNER_AGENT', label: 'De partner' },
  { value: 'EBIM_INTERNAL', label: 'Interno EBIM' },
];

const ENTITY_STATUSES = [
  { value: 'ACTIVE', label: 'Activo' },
  { value: 'INACTIVE', label: 'Inactivo' },
  { value: 'SUSPENDED', label: 'Suspendido' },
];

export function SalesAgentFormDialog({
  open,
  agent,
  onClose,
}: {
  open: boolean;
  agent?: SalesAgentDraft | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const orgs = useOrganizations();
  const upsert = useUpsertSalesAgent();
  const isEdit = Boolean(agent);

  const form = useForm<AgentValues>({
    resolver: zodResolver(agentSchema),
    defaultValues: {
      code: '', full_name: '', agent_type: 'INDEPENDENT', organization_id: '',
      contact_email: '', status: 'ACTIVE',
      valid_from: new Date().toISOString().slice(0, 10), valid_to: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    upsert.reset();
    form.reset({
      code: agent?.code ?? '',
      full_name: agent?.full_name ?? '',
      agent_type: (agent?.agent_type as AgentValues['agent_type']) ?? 'INDEPENDENT',
      organization_id: agent?.organization_id ?? '',
      contact_email: agent?.contact_email ?? '',
      status: (agent?.status as AgentValues['status']) ?? 'ACTIVE',
      valid_from: agent?.valid_from ?? new Date().toISOString().slice(0, 10),
      valid_to: agent?.valid_to ?? '',
    });
  }, [open, agent]);

  const submit = form.handleSubmit(async (values) => {
    try {
      await upsert.mutateAsync({
        p_id: agent?.id,
        p_code: values.code,
        p_full_name: values.full_name,
        p_agent_type: values.agent_type,
        p_organization_id: values.organization_id || undefined,
        p_contact_email: values.contact_email || undefined,
        p_status: values.status,
        p_valid_from: values.valid_from,
        p_valid_to: values.valid_to || undefined,
      });
      toast.success(isEdit ? 'Comercial actualizado' : 'Comercial creado', values.full_name);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={isEdit ? `Editar ${agent?.full_name}` : 'Nuevo comercial'}
      description="Dar de alta un comercial NO le da acceso operativo a ningún tenant: solo participa del plano comercial."
      submitLabel={isEdit ? 'Guardar cambios' : 'Crear comercial'}
      busy={upsert.isPending}
      error={upsert.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
      wide
    >
      <FieldRow>
        <TextField label="Nombre completo" required placeholder="Beto Ramírez"
          error={form.formState.errors.full_name} {...form.register('full_name')} />
        <TextField label="Código" required placeholder="beto-andina"
          hint="Minúsculas y guiones. Se usa en los códigos de liquidación."
          error={form.formState.errors.code} {...form.register('code')} />
      </FieldRow>

      <FieldRow>
        <SelectField label="Tipo" options={AGENT_TYPES}
          error={form.formState.errors.agent_type} {...form.register('agent_type')} />
        <SelectField label="Organización" placeholder="Ninguna (independiente)"
          options={(orgs.data ?? []).map((o) => ({ value: o.id, label: o.display_name }))}
          error={form.formState.errors.organization_id} {...form.register('organization_id')} />
      </FieldRow>

      <FieldRow>
        <TextField label="Correo de contacto" type="email" placeholder="comercial@ejemplo.com"
          error={form.formState.errors.contact_email} {...form.register('contact_email')} />
        <SelectField label="Estado" options={ENTITY_STATUSES}
          error={form.formState.errors.status} {...form.register('status')} />
      </FieldRow>

      <FieldRow>
        <TextField label="Vigente desde" type="date" required
          error={form.formState.errors.valid_from} {...form.register('valid_from')} />
        <TextField label="Vigente hasta" type="date" hint="Vacío = sin fecha de fin."
          error={form.formState.errors.valid_to} {...form.register('valid_to')} />
      </FieldRow>
    </FormDialog>
  );
}

/* ==========================================================================
   Atribución comercial
   ========================================================================== */

const attributionSchema = z.object({
  sales_agent_id: z.string().uuid('Elige el comercial'),
  saas_product_id: z.string().uuid('Elige el producto'),
  customer_organization_id: z.string().uuid('Elige el cliente'),
  tenant_id: z.string().optional(),
  channel_organization_id: z.string().optional(),
  commission_plan_id: z.string().optional(),
  attribution_pct: z.coerce.number().min(1, 'Mínimo 1%').max(100, 'Máximo 100%'),
  source: z.enum(['DIRECT', 'PARTNER', 'REFERRAL', 'INBOUND', 'CAMPAIGN']),
  valid_from: z.string().min(1, 'Obligatorio'),
  valid_to: z.string().optional(),
  notes: z.string().trim().optional(),
});

type AttributionValues = z.input<typeof attributionSchema>;

const SOURCES = [
  { value: 'DIRECT', label: 'Venta directa' },
  { value: 'PARTNER', label: 'Por partner' },
  { value: 'REFERRAL', label: 'Referido' },
  { value: 'INBOUND', label: 'Inbound' },
  { value: 'CAMPAIGN', label: 'Campaña' },
];

export function AttributionFormDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const agents = useSalesAgents();
  const products = useProducts();
  const orgs = useOrganizations();
  const tenants = useTenantOverview();
  const plans = useCommissionPlans();
  const create = useCreateAttribution();

  const form = useForm<AttributionValues>({
    resolver: zodResolver(attributionSchema),
    defaultValues: {
      sales_agent_id: '', saas_product_id: '', customer_organization_id: '',
      tenant_id: '', channel_organization_id: '', commission_plan_id: '',
      attribution_pct: 100, source: 'DIRECT',
      valid_from: new Date().toISOString().slice(0, 10), valid_to: '', notes: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    create.reset();
    form.reset();
  }, [open]);

  const submit = form.handleSubmit(async (values) => {
    const parsed = attributionSchema.parse(values);
    try {
      await create.mutateAsync({
        p_sales_agent_id: parsed.sales_agent_id,
        p_saas_product_id: parsed.saas_product_id,
        p_customer_organization_id: parsed.customer_organization_id,
        // La base guarda la participación como fracción (0-1), no como porcentaje.
        p_attribution_pct: parsed.attribution_pct / 100,
        p_tenant_id: parsed.tenant_id || undefined,
        p_channel_organization_id: parsed.channel_organization_id || undefined,
        p_commission_plan_id: parsed.commission_plan_id || undefined,
        p_source: parsed.source,
        p_valid_from: parsed.valid_from,
        p_valid_to: parsed.valid_to || undefined,
        p_notes: parsed.notes || undefined,
      });
      toast.success('Atribución creada', `${parsed.attribution_pct}% asignado`);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title="Nueva atribución comercial"
      description="La suma de participaciones vigentes sobre el mismo objeto no puede pasar del 100%: lo valida un trigger en la base."
      submitLabel="Crear atribución"
      busy={create.isPending}
      error={create.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
      wide
    >
      <FieldRow>
        <SelectField label="Comercial" required placeholder="Elige el comercial…"
          options={(agents.data ?? []).map((a) => ({ value: a.id, label: `${a.full_name} (${a.code})` }))}
          error={form.formState.errors.sales_agent_id} {...form.register('sales_agent_id')} />
        <SelectField label="Producto" required placeholder="Elige el producto…"
          options={(products.data ?? []).map((p) => ({ value: p.id, label: p.short_name }))}
          error={form.formState.errors.saas_product_id} {...form.register('saas_product_id')} />
      </FieldRow>

      <FieldRow>
        <SelectField label="Organización cliente" required placeholder="Elige el cliente…"
          options={(orgs.data ?? []).map((o) => ({ value: o.id, label: o.display_name }))}
          error={form.formState.errors.customer_organization_id} {...form.register('customer_organization_id')} />
        <SelectField label="Tenant" placeholder="Sin tenant concreto"
          hint="Deja vacío para atribuir a nivel de cliente/producto."
          options={(tenants.data ?? []).map((t) => ({
            value: t.tenant_id as string,
            label: `${t.name as string} · ${t.product_short_name as string}`,
          }))}
          error={form.formState.errors.tenant_id} {...form.register('tenant_id')} />
      </FieldRow>

      <FieldRow>
        <NumberField label="Participación (%)" required min={1} max={100} step={1}
          hint="100 = toda la comisión de ese objeto para este comercial."
          error={form.formState.errors.attribution_pct} {...form.register('attribution_pct')} />
        <SelectField label="Origen" options={SOURCES}
          error={form.formState.errors.source} {...form.register('source')} />
      </FieldRow>

      <FieldRow>
        <SelectField label="Canal / partner" placeholder="Sin canal (directo EBIM)"
          options={(orgs.data ?? []).map((o) => ({ value: o.id, label: o.display_name }))}
          error={form.formState.errors.channel_organization_id} {...form.register('channel_organization_id')} />
        <SelectField label="Plan de comisión" placeholder="Sin plan (no devenga)"
          hint="Sin plan la atribución es informativa: no genera comisión."
          options={(plans.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
          error={form.formState.errors.commission_plan_id} {...form.register('commission_plan_id')} />
      </FieldRow>

      <FieldRow>
        <TextField label="Vigente desde" type="date" required
          error={form.formState.errors.valid_from} {...form.register('valid_from')} />
        <TextField label="Vigente hasta" type="date"
          error={form.formState.errors.valid_to} {...form.register('valid_to')} />
      </FieldRow>

      <TextAreaField label="Notas" placeholder="Contexto del acuerdo comercial"
        error={form.formState.errors.notes} {...form.register('notes')} />
    </FormDialog>
  );
}

/* ==========================================================================
   Plan de comisión
   ========================================================================== */

const planSchema = z.object({
  code: z.string().trim().regex(SLUG, 'Minúsculas y guiones (ej. indep-standard)'),
  name: z.string().trim().min(2, 'Obligatorio'),
  description: z.string().trim().optional(),
  saas_product_id: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED']),
  valid_from: z.string().min(1, 'Obligatorio'),
  valid_to: z.string().optional(),
});

type PlanValues = z.infer<typeof planSchema>;

export interface CommissionPlanDraft {
  id: string;
  code: string;
  name: string;
  description: string | null;
  saas_product_id: string | null;
  status: string;
  valid_from: string;
  valid_to: string | null;
}

export function CommissionPlanFormDialog({
  open,
  plan,
  onClose,
}: {
  open: boolean;
  plan?: CommissionPlanDraft | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const products = useProducts();
  const upsert = useUpsertCommissionPlan();
  const isEdit = Boolean(plan);

  const form = useForm<PlanValues>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      code: '', name: '', description: '', saas_product_id: '', status: 'ACTIVE',
      valid_from: new Date().toISOString().slice(0, 10), valid_to: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    upsert.reset();
    form.reset({
      code: plan?.code ?? '',
      name: plan?.name ?? '',
      description: plan?.description ?? '',
      saas_product_id: plan?.saas_product_id ?? '',
      status: (plan?.status as PlanValues['status']) ?? 'ACTIVE',
      valid_from: plan?.valid_from ?? new Date().toISOString().slice(0, 10),
      valid_to: plan?.valid_to ?? '',
    });
  }, [open, plan]);

  const submit = form.handleSubmit(async (values) => {
    try {
      await upsert.mutateAsync({
        p_id: plan?.id,
        p_code: values.code,
        p_name: values.name,
        p_description: values.description || undefined,
        p_saas_product_id: values.saas_product_id || undefined,
        p_status: values.status,
        p_valid_from: values.valid_from,
        p_valid_to: values.valid_to || undefined,
      });
      toast.success(isEdit ? 'Plan actualizado' : 'Plan de comisión creado', values.name);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={isEdit ? `Editar ${plan?.name}` : 'Nuevo plan de comisión'}
      submitLabel={isEdit ? 'Guardar cambios' : 'Crear plan'}
      busy={upsert.isPending}
      error={upsert.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <FieldRow>
        <TextField label="Nombre" required placeholder="Independiente estándar"
          error={form.formState.errors.name} {...form.register('name')} />
        <TextField label="Código" required placeholder="indep-standard"
          error={form.formState.errors.code} {...form.register('code')} />
      </FieldRow>

      <TextAreaField label="Descripción" error={form.formState.errors.description}
        {...form.register('description')} />

      <FieldRow>
        <SelectField label="Producto" placeholder="Todos los productos"
          options={(products.data ?? []).map((p) => ({ value: p.id, label: p.short_name }))}
          error={form.formState.errors.saas_product_id} {...form.register('saas_product_id')} />
        <SelectField label="Estado" options={ENTITY_STATUSES}
          error={form.formState.errors.status} {...form.register('status')} />
      </FieldRow>

      <FieldRow>
        <TextField label="Vigente desde" type="date" required
          error={form.formState.errors.valid_from} {...form.register('valid_from')} />
        <TextField label="Vigente hasta" type="date"
          error={form.formState.errors.valid_to} {...form.register('valid_to')} />
      </FieldRow>
    </FormDialog>
  );
}

/* ==========================================================================
   Regla de comisión
   ========================================================================== */

const ruleSchema = z
  .object({
    name: z.string().trim().min(2, 'Obligatorio'),
    basis: z.enum(['COLLECTED_LICENSE', 'COLLECTED_IMPLEMENTATION', 'COLLECTED_ANY', 'FIXED_AMOUNT']),
    rate_pct: z.coerce.number().min(0).max(100).optional(),
    fixed_amount: z.coerce.number().min(0).optional(),
    // V3: moneda del catálogo (sin USD por defecto). Expresa el monto fijo y el tope.
    currency: z.string().regex(/^[A-Z]{3}$/, 'Elige la moneda'),
    is_recurring: z.boolean(),
    max_months: z.coerce.number().int().min(0).optional(),
    max_total_amount: z.coerce.number().min(0).optional(),
    priority: z.coerce.number().int().min(0),
    valid_from: z.string().min(1, 'Obligatorio'),
    valid_to: z.string().optional(),
  })
  .refine((v) => v.basis !== 'FIXED_AMOUNT' || Number(v.fixed_amount ?? 0) > 0, {
    path: ['fixed_amount'],
    message: 'Una regla de monto fijo necesita un importe mayor que cero',
  })
  .refine((v) => v.basis === 'FIXED_AMOUNT' || Number(v.rate_pct ?? 0) > 0, {
    path: ['rate_pct'],
    message: 'Una regla porcentual necesita una tasa mayor que cero',
  });

type RuleValues = z.input<typeof ruleSchema>;

const BASES = [
  { value: 'COLLECTED_LICENSE', label: '% de licencia cobrada' },
  { value: 'COLLECTED_IMPLEMENTATION', label: '% de implementación cobrada' },
  { value: 'COLLECTED_ANY', label: '% de cualquier cobro' },
  { value: 'FIXED_AMOUNT', label: 'Monto fijo por cobro' },
];

export function CommissionRuleFormDialog({
  open,
  planId,
  planName,
  onClose,
}: {
  open: boolean;
  planId: string | null;
  planName: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const upsert = useUpsertCommissionRule();
  const currencies = useCurrencies();
  const currencyOptions = (currencies.data ?? [])
    .filter((c) => c.status === 'ACTIVE')
    .map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }));

  const form = useForm<RuleValues>({
    resolver: zodResolver(ruleSchema),
    defaultValues: {
      name: '', basis: 'COLLECTED_LICENSE', rate_pct: 10, fixed_amount: 0,
      currency: '', is_recurring: true, priority: 100,
      valid_from: new Date().toISOString().slice(0, 10), valid_to: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    upsert.reset();
    form.reset();
  }, [open]);

  const basis = form.watch('basis');
  const isFixed = basis === 'FIXED_AMOUNT';

  const submit = form.handleSubmit(async (values) => {
    if (!planId) return;
    const parsed = ruleSchema.parse(values);
    try {
      await upsert.mutateAsync({
        p_commission_plan_id: planId,
        p_name: parsed.name,
        p_basis: parsed.basis,
        // La base guarda la tasa como fracción; la UI la pide en porcentaje.
        p_rate: isFixed ? undefined : Number(parsed.rate_pct) / 100,
        p_fixed_amount: isFixed ? Number(parsed.fixed_amount) : undefined,
        p_currency: parsed.currency,
        p_is_recurring: parsed.is_recurring,
        p_max_months: parsed.max_months ? Number(parsed.max_months) : undefined,
        p_max_total_amount: parsed.max_total_amount ? Number(parsed.max_total_amount) : undefined,
        p_priority: Number(parsed.priority),
        p_valid_from: parsed.valid_from,
        p_valid_to: parsed.valid_to || undefined,
      });
      toast.success('Regla creada', `${parsed.name} en ${planName}`);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title={`Nueva regla en ${planName}`}
      description="Toda base parte de un COBRO confirmado: una factura emitida y no pagada no devenga nada."
      submitLabel="Crear regla"
      busy={upsert.isPending}
      error={upsert.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
      wide
    >
      <TextField label="Nombre de la regla" required placeholder="12% licencia recurrente"
        error={form.formState.errors.name} {...form.register('name')} />

      <FieldRow>
        <SelectField label="Base de cálculo" options={BASES}
          error={form.formState.errors.basis} {...form.register('basis')} />
        {isFixed ? (
          <NumberField label="Monto fijo" required min={0} step="0.01"
            error={form.formState.errors.fixed_amount} {...form.register('fixed_amount')} />
        ) : (
          <NumberField label="Tasa (%)" required min={0} max={100} step="0.01"
            error={form.formState.errors.rate_pct} {...form.register('rate_pct')} />
        )}
      </FieldRow>

      <FieldRow>
        <SelectField label="Moneda" required placeholder="Elige la moneda…" options={currencyOptions}
          hint={isFixed
            ? 'El monto fijo solo se paga sobre cobros en esta moneda.'
            : 'Moneda del tope. El porcentaje se aplica sobre el cobro en su moneda original.'}
          error={form.formState.errors.currency} {...form.register('currency')} />
        <NumberField label="Prioridad" min={0} step={1}
          hint="Menor número = se evalúa antes."
          error={form.formState.errors.priority} {...form.register('priority')} />
      </FieldRow>

      <CheckboxField label="Recurrente"
        hint="Si se desmarca, solo devenga en el primer cobro de esa atribución."
        {...form.register('is_recurring')} />

      <FieldRow>
        <NumberField label="Tope de meses" min={0} step={1} hint="Vacío = sin tope."
          error={form.formState.errors.max_months} {...form.register('max_months')} />
        <NumberField label="Tope de monto acumulado" min={0} step="0.01" hint="Vacío = sin tope."
          error={form.formState.errors.max_total_amount} {...form.register('max_total_amount')} />
      </FieldRow>

      <FieldRow>
        <TextField label="Vigente desde" type="date" required
          error={form.formState.errors.valid_from} {...form.register('valid_from')} />
        <TextField label="Vigente hasta" type="date"
          error={form.formState.errors.valid_to} {...form.register('valid_to')} />
      </FieldRow>
    </FormDialog>
  );
}
