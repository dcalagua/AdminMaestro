import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCatalogItemsWithLifecycle, useUsageMeters } from '@/services/queries';
import {
  useClearCatalogItemUsageBinding,
  useSetCatalogItemCreditPack,
  useSetCatalogItemUsageBinding,
} from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge } from '@/components/ui/primitives';
import { FormDialog } from '@/components/ui/FormDialog';
import { NumberField, SelectField, TextAreaField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { billingModelLabel } from '@/features/catalog/catalogLabels';
import { formatQuantity } from '@/features/usage/usageLabels';
import { Undecided } from '@/features/usage/Undecided';
import { useLookups } from '@/features/usage/useLookups';

/**
 * Catálogo de créditos y uso (CCP fase 18, `docs/finance/USAGE_BILLING.md` §5):
 *  - créditos por paquete de un ítem (no PER_UNIT): sin valor no se vende como
 *    créditos (D-03);
 *  - vínculo de un ítem PER_UNIT con lo que tarifa: un medidor (METER) o el
 *    exceso de créditos del pool (AI_CREDIT). Sin vínculo, el uso no se factura.
 * Ambas son de `can_manage_regional_catalog` (finanzas o super admin).
 */
type Item = NonNullable<ReturnType<typeof useCatalogItemsWithLifecycle>['data']>[number];
type Tab = 'ALL' | 'PACKS' | 'PER_UNIT';

const isPerUnit = (i: Item) => i.billing_model === 'PER_UNIT';

export function CreditCatalogTab() {
  const items = useCatalogItemsWithLifecycle();
  const meters = useUsageMeters();
  const lookups = useLookups();
  const perms = usePermissions();
  const [tab, setTab] = useState<Tab>('ALL');
  const [packFor, setPackFor] = useState<Item | null>(null);
  const [bindingFor, setBindingFor] = useState<Item | null>(null);
  const [unbinding, setUnbinding] = useState<Item | null>(null);

  const meterById = useMemo(() => new Map((meters.data ?? []).map((m) => [m.id, m])), [meters.data]);

  const { term, setTerm, filtered } = useSearchFilter(items.data, (i) => [
    i.code, i.name, i.billing_model, i.per_unit_source, lookups.productName(i.saas_product_id),
  ]);
  const inTab = (t: Tab, i: Item) => t === 'ALL' || (t === 'PER_UNIT' ? isPerUnit(i) : !isPerUnit(i));
  const count = (t: Tab) => filtered.filter((i) => inTab(t, i)).length;
  const visible = filtered.filter((i) => inTab(tab, i));
  const hasAny = (items.data ?? []).length > 0;

  return (
    <Card
      title="Catálogo de créditos y uso"
      description="Qué paquetes acreditan créditos y qué ítem tarifa cada medidor o el exceso de créditos. Nada se siembra: lo que falta se muestra como no decidido."
    >
      <SearchBar
        value={term}
        onChange={setTerm}
        placeholder="Buscar ítem por código, nombre o producto…"
        right={
          <StatusTabs
            value={tab}
            onChange={setTab}
            options={[
              { id: 'ALL', label: 'Todos', count: count('ALL') },
              { id: 'PACKS', label: 'Paquetes', count: count('PACKS') },
              { id: 'PER_UNIT', label: 'Por uso', count: count('PER_UNIT') },
            ]}
          />
        }
      />
      {items.isLoading ? (
        <LoadingState label="Cargando catálogo…" />
      ) : items.error ? (
        <ErrorState error={items.error} onRetry={() => void items.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={hasAny ? 'Ningún ítem coincide' : 'Catálogo vacío'}
          description={hasAny ? 'Prueba con otra búsqueda o cambia de pestaña.' : 'No hay ítems de catálogo registrados.'}
        />
      ) : (
        <DataTable columns={['Ítem', 'Producto', 'Modelo', 'Créditos por paquete', 'Tarifa por uso', '']}>
          {visible.map((i) => {
            const meter = i.usage_meter_id ? meterById.get(i.usage_meter_id) : null;
            return (
              <tr key={i.id}>
                <td className="ebim-td">
                  <div className="font-semibold">{i.name}</div>
                  <div className="font-mono text-caption text-muted">{i.code}</div>
                </td>
                <td className="ebim-td text-compact">{i.saas_product_id ? lookups.productName(i.saas_product_id) : 'Transversal'}</td>
                <td className="ebim-td text-compact">{billingModelLabel(i.billing_model)}</td>
                <td className="ebim-td text-compact">
                  {isPerUnit(i) ? (
                    <span className="text-muted">No aplica</span>
                  ) : i.credit_pack_credits !== null ? (
                    <span className="font-semibold tabular-nums">{formatQuantity(i.credit_pack_credits)}</span>
                  ) : (
                    <Undecided code="D-03" />
                  )}
                </td>
                <td className="ebim-td text-compact">
                  {!isPerUnit(i) ? (
                    <span className="text-muted">No aplica</span>
                  ) : i.per_unit_source === 'METER' ? (
                    <Badge tone="accent">Medidor {meter?.code ?? i.usage_meter_id}</Badge>
                  ) : i.per_unit_source === 'AI_CREDIT' ? (
                    <Badge tone="accent">Exceso de créditos IA</Badge>
                  ) : (
                    <Undecided code="D-02/D-06" />
                  )}
                </td>
                <td className="ebim-td text-right">
                  {perms.canReadFinance ? (
                    isPerUnit(i) ? (
                      <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                        <button type="button" className="ebim-link text-compact" onClick={() => setBindingFor(i)}>
                          {i.per_unit_source ? 'Cambiar vínculo' : 'Vincular uso'}
                        </button>
                        {i.per_unit_source ? (
                          <button type="button" className="ebim-link text-compact" onClick={() => setUnbinding(i)}>
                            Quitar vínculo
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <button type="button" className="ebim-link text-compact" onClick={() => setPackFor(i)}>
                        Créditos por paquete
                      </button>
                    )
                  ) : null}
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}

      <CreditPackDialog item={packFor} onClose={() => setPackFor(null)} />
      <UsageBindingDialog
        item={bindingFor}
        meterOptions={(meters.data ?? [])
          .filter((m) => bindingFor && m.saas_product_id === bindingFor.saas_product_id)
          .map((m) => ({ value: m.code, label: `${m.name} (${m.code})` }))}
        onClose={() => setBindingFor(null)}
      />
      <ClearBindingDialog
        item={unbinding}
        meterCode={unbinding?.usage_meter_id ? meterById.get(unbinding.usage_meter_id)?.code ?? null : null}
        onClose={() => setUnbinding(null)}
      />
    </Card>
  );
}

const packSchema = z.object({
  credits: z.coerce.number({ error: 'Número de créditos' }).gt(0, 'Un paquete acredita más de 0 créditos'),
  reason: z.string().trim().min(3, 'El motivo es obligatorio'),
});
type PackValues = z.input<typeof packSchema>;

function CreditPackDialog({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const toast = useToast();
  const setPack = useSetCatalogItemCreditPack();
  const form = useForm<PackValues>({ resolver: zodResolver(packSchema) });

  useEffect(() => {
    if (!item) return;
    setPack.reset();
    form.reset({ credits: item.credit_pack_credits ?? '', reason: '' });
  }, [item]);

  const submit = form.handleSubmit(async (values) => {
    if (!item) return;
    const v = packSchema.parse(values);
    try {
      await setPack.mutateAsync({ p_catalog_item_code: item.code, p_credits: v.credits, p_reason: v.reason });
      toast.success('Créditos por paquete registrados', `${item.code}: ${v.credits}`);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={Boolean(item)}
      title={`Créditos por paquete · ${item?.name ?? ''}`}
      description="Decisión comercial (D-03). El precio del paquete es la tarifa CREDIT_PURCHASE del ítem (Add-ons y tarifas)."
      submitLabel="Guardar"
      busy={setPack.isPending}
      error={setPack.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <NumberField label="Créditos por paquete" required min={0} step="any"
        error={form.formState.errors.credits} {...form.register('credits')} />
      <TextAreaField label="Motivo" required error={form.formState.errors.reason} {...form.register('reason')} />
    </FormDialog>
  );
}

const bindingSchema = z
  .object({
    source: z.enum(['METER', 'AI_CREDIT']),
    meter_code: z.string(),
    reason: z.string().trim().min(3, 'El motivo es obligatorio'),
  })
  .refine((v) => v.source !== 'METER' || v.meter_code !== '', { path: ['meter_code'], message: 'Elige el medidor' });
type BindingValues = z.input<typeof bindingSchema>;

function UsageBindingDialog({
  item,
  meterOptions,
  onClose,
}: {
  item: Item | null;
  meterOptions: Array<{ value: string; label: string }>;
  onClose: () => void;
}) {
  const toast = useToast();
  const bind = useSetCatalogItemUsageBinding();
  const form = useForm<BindingValues>({ resolver: zodResolver(bindingSchema) });

  useEffect(() => {
    if (!item) return;
    bind.reset();
    form.reset({ source: (item.per_unit_source as BindingValues['source']) ?? 'METER', meter_code: '', reason: '' });
  }, [item]);

  const source = form.watch('source');

  const submit = form.handleSubmit(async (values) => {
    if (!item) return;
    const v = bindingSchema.parse(values);
    try {
      await bind.mutateAsync({
        p_catalog_item_code: item.code,
        p_source: v.source,
        p_meter_code: v.source === 'METER' ? v.meter_code : null,
        p_reason: v.reason,
      });
      toast.success('Vínculo de uso registrado', item.code);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={Boolean(item)}
      title={`Vincular uso · ${item?.name ?? ''}`}
      description="Un medidor, o el pool de créditos, tiene un solo ítem de tarifa vivo: no hay doble cobro. La tarifa USAGE_OVERAGE se fija aparte (D-01/D-02)."
      submitLabel="Guardar vínculo"
      busy={bind.isPending}
      error={bind.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <SelectField label="Qué tarifa" required
        options={[
          { value: 'METER', label: 'El uso de un medidor' },
          { value: 'AI_CREDIT', label: 'El exceso de créditos IA del pool' },
        ]}
        error={form.formState.errors.source} {...form.register('source')} />
      {source === 'METER' ? (
        <SelectField label="Medidor" required placeholder={meterOptions.length ? 'Elige el medidor…' : 'El producto no tiene medidores'}
          options={meterOptions} error={form.formState.errors.meter_code} {...form.register('meter_code')} />
      ) : null}
      <TextAreaField label="Motivo" required error={form.formState.errors.reason} {...form.register('reason')} />
    </FormDialog>
  );
}

const clearSchema = z.object({ reason: z.string().trim().min(3, 'El motivo es obligatorio') });
type ClearValues = z.input<typeof clearSchema>;

/** Quita el vínculo: el uso deja de tarifarse en las facturas que se emitan después. */
function ClearBindingDialog({
  item,
  meterCode,
  onClose,
}: {
  item: Item | null;
  meterCode: string | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const clear = useClearCatalogItemUsageBinding();
  const form = useForm<ClearValues>({ resolver: zodResolver(clearSchema), defaultValues: { reason: '' } });

  useEffect(() => {
    if (!item) return;
    clear.reset();
    form.reset({ reason: '' });
  }, [item]);

  const what =
    item?.per_unit_source === 'AI_CREDIT' ? 'el exceso de créditos IA del pool' : `el medidor ${meterCode ?? ''}`.trim();

  const submit = form.handleSubmit(async (values) => {
    if (!item) return;
    const v = clearSchema.parse(values);
    try {
      await clear.mutateAsync({ p_catalog_item_code: item.code, p_reason: v.reason });
      toast.success('Vínculo de uso quitado', item.code);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={Boolean(item)}
      title={`Quitar vínculo · ${item?.name ?? ''}`}
      description={`Este ítem deja de tarifar ${what}. Las facturas ya emitidas no cambian; en las siguientes ese uso no se cobrará hasta volver a vincularlo.`}
      submitLabel="Quitar vínculo"
      busy={clear.isPending}
      error={clear.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <TextAreaField label="Motivo" required hint="Queda en la auditoría."
        error={form.formState.errors.reason} {...form.register('reason')} />
    </FormDialog>
  );
}
