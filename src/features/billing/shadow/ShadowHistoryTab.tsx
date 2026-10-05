import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useBillingShadowComparisons, useCommercialCutoverAxes } from '@/services/queries';
import { useRecordBillingShadowComparison } from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge } from '@/components/ui/primitives';
import { DetailDrawer, DetailList } from '@/components/ui/DetailDrawer';
import { FormDialog } from '@/components/ui/FormDialog';
import { FieldRow, SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { Money } from '@/components/ui/Money';
import { useToast } from '@/components/ui/toast-context';
import { formatDateTime } from '@/lib/format';
import {
  parseShadowLocal, toShadowDiffs, toShadowExpected, toShadowLocal, type ShadowDiff,
} from '@/lib/billingShadow';
import {
  DIFF_TYPE, currentPeriodStart, formatPeriod, formatQuantity, labelOf, monthOf, periodFromMonth,
} from '@/features/usage/usageLabels';
import { useLookups, type Lookups } from '@/features/usage/useLookups';

/**
 * Historial BILLING_SHADOW (D-14): cada comparación línea a línea entre el
 * biller local y MasterAdmin, con su checksum sha256. Verde = 0 diferencias.
 * «Registrar comparación» solo existe con el eje BILLING en BILLING_SHADOW: la
 * base lo exige (BILLING_NOT_IN_SHADOW) y la UI no lo ofrece antes.
 */
type Comparison = NonNullable<ReturnType<typeof useBillingShadowComparisons>['data']>[number];
type Tab = 'ALL' | 'GREEN' | 'RED';

export function ShadowHistoryTab() {
  const comparisons = useBillingShadowComparisons();
  const integrations = useCommercialCutoverAxes();
  const lookups = useLookups();
  const perms = usePermissions();
  const [tab, setTab] = useState<Tab>('ALL');
  const [selected, setSelected] = useState<Comparison | null>(null);
  const [registering, setRegistering] = useState(false);

  const shadowProducts = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of integrations.data ?? []) {
      if (i.cutover_state_billing !== 'BILLING_SHADOW') continue;
      if (i.product_code) map.set(i.product_code, i.product_short_name ?? i.product_code);
    }
    return Array.from(map, ([value, label]) => ({ value, label }));
  }, [integrations.data]);

  const { term, setTerm, filtered } = useSearchFilter(comparisons.data, (c) => [
    lookups.productName(c.saas_product_id), lookups.tenantName(c.tenant_id), c.report_checksum, c.source, c.actor,
    c.period_start,
  ]);
  const match = (t: Tab, c: Comparison) => t === 'ALL' || (t === 'GREEN' ? c.mismatches === 0 : c.mismatches > 0);
  const count = (t: Tab) => filtered.filter((c) => match(t, c)).length;
  const visible = filtered.filter((c) => match(tab, c));
  const hasAny = (comparisons.data ?? []).length > 0;
  const canRegister = perms.canReadFinance && shadowProducts.length > 0;

  return (
    <Card
      title="Historial de comparaciones"
      description="Reportes append-only. Verde = el biller local y MasterAdmin coinciden línea a línea (cantidad, importe al centavo y moneda)."
      actions={
        perms.canReadFinance ? (
          <button
            type="button"
            className="ebim-btn-primary ebim-btn-sm"
            disabled={!canRegister}
            title={canRegister ? undefined : 'Ningún producto tiene el eje de facturación en BILLING_SHADOW'}
            onClick={() => setRegistering(true)}
          >
            Registrar comparación
          </button>
        ) : null
      }
    >
      <SearchBar
        value={term}
        onChange={setTerm}
        placeholder="Buscar por producto, tenant, checksum u origen…"
        right={
          <StatusTabs
            value={tab}
            onChange={setTab}
            options={[
              { id: 'ALL', label: 'Todas', count: count('ALL') },
              { id: 'GREEN', label: 'Verdes', count: count('GREEN') },
              { id: 'RED', label: 'Con diferencias', count: count('RED') },
            ]}
          />
        }
      />
      {comparisons.isLoading ? (
        <LoadingState label="Cargando comparaciones…" />
      ) : comparisons.error ? (
        <ErrorState error={comparisons.error} onRetry={() => void comparisons.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={hasAny ? 'Ninguna comparación coincide' : 'Sin comparaciones registradas'}
          description={
            hasAny
              ? 'Prueba con otra búsqueda o cambia de pestaña.'
              : 'Se registran con el eje de facturación del producto en BILLING_SHADOW.'
          }
        />
      ) : (
        <DataTable columns={['Fecha', 'Producto', 'Tenant', 'Período', 'Resultado', 'Checksum', '']}>
          {visible.map((c) => (
            <tr key={c.id}>
              <td className="ebim-td whitespace-nowrap text-compact text-muted">{formatDateTime(c.created_at)}</td>
              <td className="ebim-td text-compact font-semibold">{lookups.productName(c.saas_product_id)}</td>
              <td className="ebim-td text-compact">{lookups.tenantName(c.tenant_id)}</td>
              <td className="ebim-td whitespace-nowrap text-compact">{formatPeriod(c.period_start)}</td>
              <td className="ebim-td">
                {c.mismatches === 0 ? (
                  <Badge tone="ok">Verde · sin diferencias</Badge>
                ) : (
                  <Badge tone="danger">Rojo · {c.mismatches} diferencia(s)</Badge>
                )}
              </td>
              <td className="ebim-td font-mono text-caption text-muted" title={c.report_checksum}>
                {c.report_checksum.slice(0, 19)}…
              </td>
              <td className="ebim-td text-right">
                <button type="button" className="ebim-link text-compact" onClick={() => setSelected(c)}>
                  Ver diferencias
                </button>
              </td>
            </tr>
          ))}
        </DataTable>
      )}

      <ComparisonDrawer comparison={selected} lookups={lookups} onClose={() => setSelected(null)} />
      <RegisterComparisonDialog
        open={registering}
        products={shadowProducts}
        lookups={lookups}
        onClose={() => setRegistering(false)}
      />
    </Card>
  );
}

function side(value: ShadowDiff['masteradmin'], currency: string) {
  if (value === null) return <span className="text-muted">—</span>;
  if (typeof value === 'string') return <span className="font-mono">{value}</span>;
  return (
    <span>
      cant. {formatQuantity(value.quantity)} · <Money amount={value.amount} currency={currency} />
    </span>
  );
}

function ComparisonDrawer({
  comparison,
  lookups,
  onClose,
}: {
  comparison: Comparison | null;
  lookups: Lookups;
  onClose: () => void;
}) {
  const expected = toShadowExpected(comparison?.expected);
  const local = toShadowLocal(comparison?.local);
  const diffs = toShadowDiffs(comparison?.diffs);
  const currency = expected?.currency ?? local?.currency ?? '';

  return (
    <DetailDrawer
      open={comparison !== null}
      title={comparison ? `${lookups.productName(comparison.saas_product_id)} · ${formatPeriod(comparison.period_start)}` : ''}
      subtitle={comparison ? lookups.tenantName(comparison.tenant_id) : undefined}
      onClose={onClose}
    >
      {comparison ? (
        <div className="space-y-5">
          <div>
            {comparison.mismatches === 0 ? (
              <Badge tone="ok">Verde · sin diferencias</Badge>
            ) : (
              <Badge tone="danger">Rojo · {comparison.mismatches} diferencia(s)</Badge>
            )}
          </div>
          <DetailList
            items={[
              ['Checksum del reporte', <span key="c" className="font-mono text-compact">{comparison.report_checksum}</span>],
              ['Origen', comparison.source],
              ['Registrado por', comparison.actor],
              ['Fecha', formatDateTime(comparison.created_at)],
              ['Total MasterAdmin', expected ? <Money key="e" amount={expected.total} currency={expected.currency} /> : '—'],
              ['Total biller local', local ? <Money key="l" amount={local.total} currency={local.currency} /> : '—'],
            ]}
          />
          <section aria-label="Diferencias línea a línea">
            <h3 className="mb-2 text-body font-bold text-fg">Diferencias línea a línea</h3>
            {diffs.length === 0 ? (
              <p className="text-body text-ok">Todas las líneas coinciden.</p>
            ) : (
              <DataTable columns={['Línea', 'Diferencia', 'MasterAdmin', 'Biller local']}>
                {diffs.map((d) => {
                  const t = labelOf(DIFF_TYPE, d.type);
                  return (
                    <tr key={`${d.itemCode}:${d.type}`}>
                      <td className="ebim-td font-mono text-compact">{d.itemCode}</td>
                      <td className="ebim-td">
                        <Badge tone={t.tone}>{t.label}</Badge>
                      </td>
                      <td className="ebim-td text-compact">{side(d.masteradmin, currency)}</td>
                      <td className="ebim-td text-compact">{side(d.local, local?.currency ?? currency)}</td>
                    </tr>
                  );
                })}
              </DataTable>
            )}
          </section>
        </div>
      ) : null}
    </DetailDrawer>
  );
}

const registerSchema = z.object({
  product_code: z.string().min(1, 'Elige el producto'),
  tenant_id: z.string().min(1, 'Elige el tenant'),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Elige el mes'),
  actor: z.string().trim().min(1, 'Indica quién ejecuta la comparación').max(200),
  local: z.string().trim().min(2, 'Pega el JSON del biller local'),
});
type RegisterValues = z.input<typeof registerSchema>;

const LOCAL_EXAMPLE = '{"source":"biller-local","currency":"PEN","lines":[{"itemCode":"plan:pro","quantity":1,"amount":120}]}';

function RegisterComparisonDialog({
  open,
  products,
  lookups,
  onClose,
}: {
  open: boolean;
  products: Array<{ value: string; label: string }>;
  lookups: Lookups;
  onClose: () => void;
}) {
  const toast = useToast();
  const record = useRecordBillingShadowComparison();
  const form = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });

  useEffect(() => {
    if (!open) return;
    record.reset();
    form.reset({
      product_code: products.length === 1 ? products[0]!.value : '',
      tenant_id: '',
      month: monthOf(currentPeriodStart()),
      actor: 'masteradmin-console',
      local: '',
    });
  }, [open]);

  const productCode = form.watch('product_code');
  const productId = lookups.products.find((p) => p.code === productCode)?.id;
  const tenantOptions = lookups.tenants
    .filter((t) => t.tenant_id && productId && t.saas_product_id === productId)
    .map((t) => ({ value: t.tenant_id as string, label: t.name ?? t.slug ?? '' }));

  const submit = form.handleSubmit(async (values) => {
    const v = registerSchema.parse(values);
    const parsed = parseShadowLocal(v.local);
    if (!parsed.ok) {
      form.setError('local', { message: parsed.error });
      return;
    }
    try {
      const result = (await record.mutateAsync({
        p_saas_product_code: v.product_code,
        p_tenant_id: v.tenant_id,
        p_period_start: periodFromMonth(v.month),
        p_local: parsed.value,
        p_actor: v.actor,
      })) as { green?: boolean; mismatches?: number } | null;
      if (result?.green) toast.success('Comparación verde', 'Sin diferencias con el biller local.');
      else toast.error('Comparación con diferencias', `${result?.mismatches ?? '?'} diferencia(s): revisa el historial.`);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      wide
      title="Registrar comparación BILLING_SHADOW"
      description="Pega el cálculo del biller local del SaaS. MasterAdmin lo compara con lo que facturaría y guarda el reporte con su checksum. Nunca emite facturas ni cobra."
      submitLabel="Comparar y registrar"
      busy={record.isPending}
      error={record.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <FieldRow>
        <SelectField label="Producto (en BILLING_SHADOW)" required placeholder="Elige el producto…" options={products}
          error={form.formState.errors.product_code} {...form.register('product_code')} />
        <SelectField label="Tenant" required placeholder="Elige el tenant…" options={tenantOptions}
          error={form.formState.errors.tenant_id} {...form.register('tenant_id')} />
      </FieldRow>
      <FieldRow>
        <TextField label="Mes" type="month" required error={form.formState.errors.month} {...form.register('month')} />
        <TextField label="Ejecutado por" required hint="Persona o proceso que corrió el biller local."
          error={form.formState.errors.actor} {...form.register('actor')} />
      </FieldRow>
      <TextAreaField label="JSON del biller local" required spellCheck={false} className="font-mono"
        placeholder={LOCAL_EXAMPLE}
        hint='Forma: {"currency":"PEN","lines":[{"itemCode","quantity","amount"}]}; itemCode único por línea.'
        error={form.formState.errors.local} {...form.register('local')} />
    </FormDialog>
  );
}
