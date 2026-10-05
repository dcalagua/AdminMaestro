import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useProductCapabilities, useUsageAggregates, useUsageMeters } from '@/services/queries';
import { useSetUsageMeterBillable, useUpsertUsageMeter } from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge } from '@/components/ui/primitives';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, FieldRow, NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { AGGREGATION_LABEL, MEASUREMENT_LABEL, METER_STATUS, labelOf } from './usageLabels';
import { Undecided } from './Undecided';
import { useLookups } from './useLookups';
import { Sparkline } from '@/components/ui/Sparkline';
import { formatPeriod, formatQuantity } from './usageLabels';
import { meterKey, meterSeries, type MeterSeries } from './usageSeries';

/**
 * Medidores de uso por producto (CCP fase 17, spec §11.1).
 *
 * Registrar o editar un medidor es de producto (EBIM_PRODUCT_ADMIN). Que sea
 * FACTURABLE es una decisión de finanzas (D-06) con motivo: mientras nadie la
 * toma, el medidor se muestra «No decidido (D-06)», nunca «gratis».
 */

type Meter = NonNullable<ReturnType<typeof useUsageMeters>['data']>[number];

type StatusTab = 'ALL' | 'ACTIVE' | 'DRAFT' | 'DEPRECATED';

export function MetersTab() {
  const meters = useUsageMeters();
  const aggregates = useUsageAggregates();
  const series = useMemo(() => meterSeries(aggregates.data ?? []), [aggregates.data]);
  const capabilities = useProductCapabilities();
  const lookups = useLookups();
  const perms = usePermissions();
  const [tab, setTab] = useState<StatusTab>('ALL');
  const [editing, setEditing] = useState<Meter | 'new' | null>(null);
  const [billable, setBillable] = useState<Meter | null>(null);

  const capabilityById = useMemo(() => {
    const map = new Map<string, { code: string; name: string }>();
    for (const c of capabilities.data ?? []) map.set(c.id, { code: c.code, name: c.name });
    return map;
  }, [capabilities.data]);

  const { term, setTerm, filtered } = useSearchFilter(meters.data, (m) => [
    m.code, m.name, m.unit, lookups.productName(m.saas_product_id),
    m.capability_id ? capabilityById.get(m.capability_id)?.code : null,
  ]);

  const visible = filtered.filter((m) => tab === 'ALL' || m.status === tab);
  const groups = useMemo(() => {
    const ids = Array.from(new Set(visible.map((m) => m.saas_product_id)));
    return ids
      .map((id) => ({ id, label: lookups.productName(id), rows: visible.filter((m) => m.saas_product_id === id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [visible, lookups]);
  const hasAny = (meters.data ?? []).length > 0;
  const count = (s: StatusTab) => filtered.filter((m) => s === 'ALL' || m.status === s).length;

  return (
    <>
      <Card
        title="Medidores"
        description="Qué mide cada producto y cómo se agrega por período. Un medidor nace no facturable: lo decide finanzas (D-06)."
        actions={
          perms.canManagePlatform ? (
            <button type="button" className="ebim-btn-primary ebim-btn-sm" onClick={() => setEditing('new')}>
              Nuevo medidor
            </button>
          ) : null
        }
      >
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar medidor por código, nombre, unidad, producto o capacidad…"
          right={
            <StatusTabs
              value={tab}
              onChange={setTab}
              options={[
                { id: 'ALL', label: 'Todos', count: count('ALL') },
                { id: 'ACTIVE', label: 'Activos', count: count('ACTIVE') },
                { id: 'DRAFT', label: 'Borrador', count: count('DRAFT') },
                { id: 'DEPRECATED', label: 'Obsoletos', count: count('DEPRECATED') },
              ]}
            />
          }
        />
        {meters.isLoading ? (
          <LoadingState label="Cargando medidores…" />
        ) : meters.error ? (
          <ErrorState error={meters.error} onRetry={() => void meters.refetch()} />
        ) : groups.length === 0 ? (
          <EmptyState
            title={hasAny ? 'Ningún medidor coincide' : 'Sin medidores registrados'}
            description={
              hasAny
                ? 'Prueba con otra búsqueda o cambia de estado.'
                : 'Se registran desde el contrato de uso de cada producto (contracts/usage/v1/meters.json).'
            }
          />
        ) : (
          groups.map((g) => (
            <section key={g.id} aria-label={g.label}>
              <h3 className="border-b border-border bg-sunken px-5 py-2 text-compact font-semibold text-fg">
                {g.label} <span className="ml-1 font-normal tabular-nums text-muted">{g.rows.length}</span>
              </h3>
              <DataTable
                label={`Medidores de ${g.label}`}
                columns={['Medidor', 'Consumo mensual', 'Agregación', 'Capacidad', 'Estado', 'Facturable', { label: 'Acciones', srOnly: true }]}
              >
                {g.rows.map((m) => {
                  const st = labelOf(METER_STATUS, m.status);
                  const cap = m.capability_id ? capabilityById.get(m.capability_id) : null;
                  return (
                    <tr key={m.id}>
                      <td className="ebim-td">
                        <div className="font-semibold">{m.name}</div>
                        <div className="font-mono text-caption text-muted">
                          {m.code}
                        </div>
                      </td>
                      <td className="ebim-td">
                        <MeterTrend
                          series={series.get(meterKey(lookups.productCode(m.saas_product_id), m.code))}
                          unit={m.unit}
                          loading={aggregates.isLoading}
                        />
                      </td>
                      <td className="ebim-td text-compact">
                        {AGGREGATION_LABEL[m.aggregation] ?? m.aggregation}
                        <div className="whitespace-nowrap text-caption text-muted">
                          {MEASUREMENT_LABEL[m.measurement] ?? m.measurement} · gracia {m.grace_hours} h
                        </div>
                        {m.allows_negative ? <div className="text-caption text-muted">Admite negativos</div> : null}
                      </td>
                      <td className="ebim-td text-compact">
                        {cap ? <span className="font-mono text-caption">{cap.code}</span> : <span className="text-muted">—</span>}
                      </td>
                      <td className="ebim-td">
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </td>
                      <td className="ebim-td">
                        {m.is_billable ? (
                          <Badge tone="ok">Facturable</Badge>
                        ) : m.billable_decided_by || m.billable_reason ? (
                          <Badge tone="neutral">No facturable</Badge>
                        ) : (
                          <Undecided code="D-06" />
                        )}
                        {m.billable_reason ? (
                          <div className="mt-0.5 max-w-[200px] truncate text-caption text-muted" title={m.billable_reason}>
                            {m.billable_reason}
                          </div>
                        ) : null}
                      </td>
                      <td className="ebim-td">
                        <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                          {perms.canManagePlatform ? (
                            <button type="button" className="ebim-link text-compact" onClick={() => setEditing(m)}>
                              Editar
                            </button>
                          ) : null}
                          {perms.canReadFinance ? (
                            <button type="button" className="ebim-link text-compact" onClick={() => setBillable(m)}>
                              Facturable…
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </DataTable>
            </section>
          ))
        )}
      </Card>

      <MeterDialog
        meter={editing === 'new' ? null : editing}
        open={editing !== null}
        productOptions={lookups.productOptions}
        productCode={editing && editing !== 'new' ? lookups.productCode(editing.saas_product_id) : null}
        capabilities={(capabilities.data ?? []).filter((c) => c.kind === 'AI_FEATURE' || c.kind === 'ALLOWANCE')}
        productIdByCode={(code) => lookups.products.find((p) => p.code === code)?.id ?? null}
        capabilityCode={editing && editing !== 'new' && editing.capability_id ? (capabilityById.get(editing.capability_id)?.code ?? '') : ''}
        onClose={() => setEditing(null)}
      />
      <BillableDialog
        meter={billable}
        productCode={billable ? lookups.productCode(billable.saas_product_id) : null}
        onClose={() => setBillable(null)}
      />
    </>
  );
}

/** «sep 2026»: mes corto para la celda (el largo va en el texto accesible). */
function shortPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('es-PE', { month: 'short', year: 'numeric' }).format(new Date(y!, m! - 1, 1)).replace('.', '');
}

/**
 * Consumo mensual del medidor (suma de tenants, solo agregados FINALIZADOS):
 * sparkline de los últimos meses + la cifra del último mes cerrado. Es
 * tendencia, no magnitud: no compara medidores de unidades distintas.
 */
function MeterTrend({ series, unit, loading }: { series: MeterSeries | undefined; unit: string; loading: boolean }) {
  if (loading) return <span className="ebim-skeleton inline-block h-7 w-28" aria-hidden />;
  if (!series?.last) {
    return (
      <span className="text-caption text-muted">
        Sin períodos finalizados · <span className="font-mono">{unit}</span>
      </span>
    );
  }
  const first = series.values.find((v) => v !== null);
  const description = `Consumo de ${formatPeriod(series.periods[series.values.indexOf(first ?? null)])} a ${formatPeriod(series.last.period)}: de ${formatQuantity(first)} a ${formatQuantity(series.last.value)} ${unit}`;
  return (
    <div className="flex items-center gap-3" title={description} data-meter-trend>
      <div className="w-20 shrink-0">
        <Sparkline data={series.values} description={description} height={28} />
      </div>
      <div className="min-w-0 whitespace-nowrap leading-tight">
        <div className="text-compact font-semibold tabular-nums text-fg">
          {formatQuantity(series.last.value)} <span className="font-mono text-caption font-normal text-muted">{unit}</span>
        </div>
        <div className="text-caption text-muted">{shortPeriod(series.last.period)}</div>
      </div>
    </div>
  );
}

/* ==========================================================================
   Alta / edición (upsert_usage_meter)
   ========================================================================== */

const meterSchema = z
  .object({
    product_code: z.string().min(1, 'Elige el producto'),
    code: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+([._][a-z0-9]+)*$/, 'Minúsculas, números, punto o guion bajo (p. ej. ai.pages)')
      .max(120),
    name: z.string().trim().min(1, 'El nombre es obligatorio'),
    unit: z.string().trim().regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, 'Unidad en minúsculas (p. ej. page, call)'),
    aggregation: z.enum(['SUM', 'MAX', 'COUNT_DISTINCT_SUBJECT']),
    measurement: z.enum(['EVENT', 'DAILY_SNAPSHOT']),
    capability_code: z.string().optional(),
    allows_negative: z.boolean(),
    grace_hours: z.coerce.number().int('Horas enteras').min(0, 'Entre 0 y 720').max(720, 'Entre 0 y 720'),
    status: z.enum(['DRAFT', 'ACTIVE', 'DEPRECATED']),
  })
  .refine((v) => v.measurement !== 'DAILY_SNAPSHOT' || v.aggregation === 'MAX', {
    path: ['aggregation'],
    message: 'Una foto diaria se agrega como máximo (pico), nunca como suma',
  });
type MeterValues = z.input<typeof meterSchema>;

function MeterDialog({
  open,
  meter,
  productCode,
  capabilityCode,
  productOptions,
  capabilities,
  productIdByCode,
  onClose,
}: {
  open: boolean;
  meter: Meter | null;
  productCode: string | null;
  capabilityCode: string;
  productOptions: Array<{ value: string; label: string }>;
  capabilities: Array<{ code: string; name: string; kind: string; saas_product_id: string }>;
  productIdByCode: (code: string) => string | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const upsert = useUpsertUsageMeter();
  const form = useForm<MeterValues>({ resolver: zodResolver(meterSchema) });

  useEffect(() => {
    if (!open) return;
    upsert.reset();
    form.reset({
      product_code: productCode ?? '',
      code: meter?.code ?? '',
      name: meter?.name ?? '',
      unit: meter?.unit ?? '',
      aggregation: (meter?.aggregation as MeterValues['aggregation']) ?? 'SUM',
      measurement: (meter?.measurement as MeterValues['measurement']) ?? 'EVENT',
      capability_code: capabilityCode,
      allows_negative: meter?.allows_negative ?? false,
      grace_hours: meter?.grace_hours ?? 72,
      status: (meter?.status as MeterValues['status']) ?? 'DRAFT',
    });
  }, [open, meter]);

  const selectedProduct = form.watch('product_code');
  const productId = selectedProduct ? productIdByCode(selectedProduct) : null;
  const capabilityOptions = capabilities
    .filter((c) => !productId || c.saas_product_id === productId)
    .map((c) => ({ value: c.code, label: `${c.name} (${c.code}) · ${c.kind === 'AI_FEATURE' ? 'IA' : 'cupo'}` }));

  const submit = form.handleSubmit(async (values) => {
    const v = meterSchema.parse(values);
    try {
      await upsert.mutateAsync({
        p_product_code: v.product_code,
        p_code: v.code,
        p_name: v.name,
        p_unit: v.unit,
        p_aggregation: v.aggregation,
        p_status: v.status,
        p_measurement: v.measurement,
        p_capability_code: v.capability_code || undefined,
        p_allows_negative: v.allows_negative,
        p_grace_hours: v.grace_hours,
      });
      toast.success(meter ? 'Medidor actualizado' : 'Medidor registrado', `${v.product_code} · ${v.code}`);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      wide
      title={meter ? `Editar medidor · ${meter.code}` : 'Nuevo medidor'}
      description="El medidor nace no facturable. Que lo sea lo decide finanzas aparte (D-06). Una foto diaria solo se registra para dimensiones aprobadas."
      submitLabel={meter ? 'Guardar' : 'Registrar'}
      busy={upsert.isPending}
      error={upsert.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <FieldRow>
        {/*
          Al editar, producto y código son la clave del medidor: se muestran de
          solo lectura (`readOnly`, no `disabled`: un control deshabilitado no
          entrega su valor a React Hook Form).
        */}
        {meter ? (
          <TextField label="Producto" required readOnly error={form.formState.errors.product_code} {...form.register('product_code')} />
        ) : (
          <SelectField label="Producto" required placeholder="Elige el producto…"
            options={productOptions} error={form.formState.errors.product_code} {...form.register('product_code')} />
        )}
        <TextField label="Código" required readOnly={Boolean(meter)} placeholder="ai.pages"
          error={form.formState.errors.code} {...form.register('code')} />
      </FieldRow>
      <FieldRow>
        <TextField label="Nombre" required error={form.formState.errors.name} {...form.register('name')} />
        <TextField label="Unidad" required placeholder="page" error={form.formState.errors.unit} {...form.register('unit')} />
      </FieldRow>
      <FieldRow>
        <SelectField label="Agregación" required
          options={Object.entries(AGGREGATION_LABEL).map(([value, label]) => ({ value, label }))}
          error={form.formState.errors.aggregation} {...form.register('aggregation')} />
        <SelectField label="Medición" required
          options={Object.entries(MEASUREMENT_LABEL).map(([value, label]) => ({ value, label }))}
          error={form.formState.errors.measurement} {...form.register('measurement')} />
      </FieldRow>
      <FieldRow>
        <SelectField label="Capacidad" placeholder="Sin capacidad" options={capabilityOptions}
          hint="Solo AI_FEATURE o ALLOWANCE del mismo producto."
          error={form.formState.errors.capability_code} {...form.register('capability_code')} />
        <NumberField label="Gracia (horas)" required min={0} max={720}
          hint="Ventana técnica de llegada tardía, no comercial."
          error={form.formState.errors.grace_hours} {...form.register('grace_hours')} />
      </FieldRow>
      <FieldRow>
        <SelectField label="Estado" required
          options={Object.entries(METER_STATUS).map(([value, { label }]) => ({ value, label }))}
          error={form.formState.errors.status} {...form.register('status')} />
        <CheckboxField label="Admite cantidades negativas" hint="Para eventos compensatorios."
          {...form.register('allows_negative')} />
      </FieldRow>
    </FormDialog>
  );
}

/* ==========================================================================
   Facturable (set_usage_meter_billable) — D-06, solo finanzas
   ========================================================================== */

const billableSchema = z.object({
  billable: z.enum(['true', 'false']),
  reason: z.string().trim().min(3, 'El motivo es obligatorio'),
});
type BillableValues = z.input<typeof billableSchema>;

function BillableDialog({
  meter,
  productCode,
  onClose,
}: {
  meter: Meter | null;
  productCode: string | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const setBillable = useSetUsageMeterBillable();
  const form = useForm<BillableValues>({ resolver: zodResolver(billableSchema) });

  useEffect(() => {
    if (!meter) return;
    setBillable.reset();
    form.reset({ billable: meter.is_billable ? 'true' : 'false', reason: '' });
  }, [meter]);

  const submit = form.handleSubmit(async (values) => {
    if (!meter || !productCode) return;
    const v = billableSchema.parse(values);
    try {
      await setBillable.mutateAsync({
        p_product_code: productCode,
        p_code: meter.code,
        p_billable: v.billable === 'true',
        p_reason: v.reason,
      });
      toast.success(v.billable === 'true' ? 'Medidor facturable' : 'Medidor no facturable', meter.code);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={Boolean(meter)}
      title={`Decisión D-06 · ${meter?.code ?? ''}`}
      description="Solo finanzas decide si el uso de este medidor se factura. El agregado hereda la decisión al finalizar; un tenant DEMO/SANDBOX nunca factura."
      submitLabel="Registrar decisión"
      busy={setBillable.isPending}
      error={setBillable.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <SelectField label="¿Facturable?" required
        options={[
          { value: 'true', label: 'Sí, el uso se factura' },
          { value: 'false', label: 'No, el uso no se factura' },
        ]}
        error={form.formState.errors.billable} {...form.register('billable')} />
      <TextAreaField label="Motivo" required hint="Queda en la auditoría (referencia a la decisión D-06)."
        error={form.formState.errors.reason} {...form.register('reason')} />
    </FormDialog>
  );
}
