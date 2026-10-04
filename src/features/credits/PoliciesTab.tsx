import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAiCreditPolicies, useCatalogItemsWithLifecycle, usePlans } from '@/services/queries';
import { useCreateAiCreditPolicy } from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge } from '@/components/ui/primitives';
import { FormDialog } from '@/components/ui/FormDialog';
import { FieldRow, NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { formatDate } from '@/lib/format';
import {
  OVERAGE_MODE_LABEL, POLICY_SOURCE_LABEL, POOL_SCOPE_LABEL, currentPeriodStart, formatQuantity,
} from '@/features/usage/usageLabels';
import { Undecided } from '@/features/usage/Undecided';
import { useLookups } from '@/features/usage/useLookups';

/**
 * Políticas de créditos IA por plan o add-on (spec §12). Los campos comerciales
 * nulos son decisiones abiertas y se rotulan como tales: pool, incluidos y modo
 * de exceso (D-03); rollover y expiración están bloqueados por CHECK hasta D-04.
 */
type Policy = NonNullable<ReturnType<typeof useAiCreditPolicies>['data']>[number];
type Tab = 'ALL' | 'CURRENT' | 'FUTURE' | 'ENDED';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function phase(p: Policy, at: string): Exclude<Tab, 'ALL'> {
  if (p.valid_from > at) return 'FUTURE';
  if (p.valid_to && p.valid_to <= at) return 'ENDED';
  return 'CURRENT';
}

export function PoliciesTab() {
  const policies = useAiCreditPolicies();
  const plans = usePlans();
  const items = useCatalogItemsWithLifecycle();
  const lookups = useLookups();
  const perms = usePermissions();
  const [tab, setTab] = useState<Tab>('CURRENT');
  const [creating, setCreating] = useState(false);
  const at = today();

  const planById = useMemo(() => new Map((plans.data ?? []).map((p) => [p.id, { code: p.code, name: p.name }])), [plans.data]);
  const itemById = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, { code: i.code, name: i.name }])), [items.data]);
  const sourceOf = (p: Policy) =>
    p.source_type === 'PLAN' ? planById.get(p.plan_id ?? '') : itemById.get(p.catalog_item_id ?? '');

  const { term, setTerm, filtered } = useSearchFilter(policies.data, (p) => [
    sourceOf(p)?.code, sourceOf(p)?.name, p.source_type, lookups.productName(p.saas_product_id), p.reason,
  ]);
  const count = (t: Tab) => filtered.filter((p) => t === 'ALL' || phase(p, at) === t).length;
  const visible = filtered.filter((p) => tab === 'ALL' || phase(p, at) === tab);
  const hasAny = (policies.data ?? []).length > 0;

  return (
    <Card
      title="Políticas"
      description="Cuántos créditos incluye un plan o add-on, en qué pool y qué pasa con el exceso. Sin política, el uso de IA alerta y no consume."
      actions={
        perms.canReadFinance ? (
          <button type="button" className="ebim-btn-primary h-8 px-3 text-xs" onClick={() => setCreating(true)}>
            Nueva política
          </button>
        ) : null
      }
    >
      <SearchBar
        value={term}
        onChange={setTerm}
        placeholder="Buscar por plan, add-on, producto o motivo…"
        right={
          <StatusTabs
            value={tab}
            onChange={setTab}
            options={[
              { id: 'CURRENT', label: 'Vigentes', count: count('CURRENT') },
              { id: 'FUTURE', label: 'Programadas', count: count('FUTURE') },
              { id: 'ENDED', label: 'Cerradas', count: count('ENDED') },
              { id: 'ALL', label: 'Todas', count: count('ALL') },
            ]}
          />
        }
      />
      {policies.isLoading ? (
        <LoadingState label="Cargando políticas…" />
      ) : policies.error ? (
        <ErrorState error={policies.error} onRetry={() => void policies.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={hasAny ? 'Ninguna política coincide' : 'Sin políticas de créditos'}
          description={
            hasAny ? 'Prueba con otra búsqueda o cambia de pestaña.' : 'Ningún plan ni add-on incluye créditos todavía (D-03).'
          }
        />
      ) : (
        <DataTable columns={['Origen', 'Producto', 'Pool', 'Incluidos', 'Exceso', 'Rollover / expiración', 'Vigencia']}>
          {visible.map((p) => {
            const src = sourceOf(p);
            return (
              <tr key={p.id}>
                <td className="ebim-td">
                  <div className="font-semibold">{src?.name ?? '—'}</div>
                  <div className="text-[11px] text-muted">
                    {POLICY_SOURCE_LABEL[p.source_type] ?? p.source_type} · <span className="font-mono">{src?.code ?? '—'}</span>
                  </div>
                </td>
                <td className="ebim-td text-xs">{lookups.productName(p.saas_product_id)}</td>
                <td className="ebim-td text-xs">
                  {p.pool_scope ? POOL_SCOPE_LABEL[p.pool_scope] ?? p.pool_scope : <Undecided code="D-03" />}
                </td>
                <td className="ebim-td text-xs tabular-nums">
                  {p.included_credits === null ? <Undecided code="D-03" /> : formatQuantity(p.included_credits)}
                </td>
                <td className="ebim-td text-xs">
                  {p.overage_mode ? (
                    <Badge tone={p.overage_mode === 'BLOCK' ? 'neutral' : 'warn'}>{OVERAGE_MODE_LABEL[p.overage_mode] ?? p.overage_mode}</Badge>
                  ) : (
                    <Undecided code="D-03" />
                  )}
                </td>
                <td className="ebim-td text-xs">
                  <Undecided code="D-04" />
                </td>
                <td className="ebim-td whitespace-nowrap text-xs">
                  {formatDate(p.valid_from)} → {p.valid_to ? formatDate(p.valid_to) : 'sin fin'}
                  <div className="max-w-[220px] text-[11px] text-muted" title={p.reason}>{p.reason}</div>
                  {/*
                    TODO(M4-DB): «Cerrar» (finanzas) en filas vigentes o programadas →
                    end_ai_credit_policy(p_policy_id, p_valid_to, p_reason), FormDialog con
                    fecha de fin y motivo. Pendiente de la migración 20261012000100.
                  */}
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}

      <PolicyDialog
        open={creating}
        planOptions={(plans.data ?? []).map((p) => ({ value: p.code, label: `${p.name} (${p.code})` }))}
        itemOptions={(items.data ?? []).map((i) => ({ value: i.code, label: `${i.name} (${i.code})` }))}
        onClose={() => setCreating(false)}
      />
    </Card>
  );
}

const policySchema = z
  .object({
    source_type: z.enum(['PLAN', 'CATALOG_ITEM']),
    source_code: z.string().min(1, 'Elige el plan o add-on'),
    pool_scope: z.enum(['', 'TENANT', 'PRODUCT']),
    included_credits: z.string().trim(),
    overage_mode: z.enum(['', 'BLOCK', 'ALLOW']),
    valid_from: z.string().min(1, 'Indica desde cuándo rige'),
    reason: z.string().trim().min(3, 'El motivo es obligatorio'),
  })
  .refine((v) => v.included_credits === '' || (Number(v.included_credits) >= 0 && !Number.isNaN(Number(v.included_credits))), {
    path: ['included_credits'],
    message: 'Créditos ≥ 0, o vacío si no está decidido',
  });
type PolicyValues = z.input<typeof policySchema>;

function PolicyDialog({
  open,
  planOptions,
  itemOptions,
  onClose,
}: {
  open: boolean;
  planOptions: Array<{ value: string; label: string }>;
  itemOptions: Array<{ value: string; label: string }>;
  onClose: () => void;
}) {
  const toast = useToast();
  const create = useCreateAiCreditPolicy();
  const form = useForm<PolicyValues>({ resolver: zodResolver(policySchema) });

  useEffect(() => {
    if (!open) return;
    create.reset();
    form.reset({
      source_type: 'PLAN', source_code: '', pool_scope: '', included_credits: '', overage_mode: '',
      valid_from: currentPeriodStart(), reason: '',
    });
  }, [open]);

  const sourceType = form.watch('source_type');

  const submit = form.handleSubmit(async (values) => {
    const v = policySchema.parse(values);
    try {
      await create.mutateAsync({
        p_source_type: v.source_type,
        p_source_code: v.source_code,
        p_pool_scope: v.pool_scope || null,
        p_included_credits: v.included_credits === '' ? null : Number(v.included_credits),
        p_overage_mode: v.overage_mode || null,
        p_valid_from: v.valid_from,
        p_reason: v.reason,
      });
      toast.success('Política registrada', v.source_code);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      wide
      title="Nueva política de créditos"
      description="Deja vacío lo que no esté decidido: se guarda como «No decidido (D-03)», nunca como 0. Rollover y expiración no se pueden configurar hasta D-04."
      submitLabel="Registrar política"
      busy={create.isPending}
      error={create.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <FieldRow>
        <SelectField label="Origen" required
          options={[
            { value: 'PLAN', label: 'Plan' },
            { value: 'CATALOG_ITEM', label: 'Add-on' },
          ]}
          error={form.formState.errors.source_type} {...form.register('source_type')} />
        <SelectField label={sourceType === 'PLAN' ? 'Plan' : 'Add-on'} required placeholder="Elige…"
          options={sourceType === 'PLAN' ? planOptions : itemOptions}
          error={form.formState.errors.source_code} {...form.register('source_code')} />
      </FieldRow>
      <FieldRow>
        <SelectField label="Pool"
          options={[
            { value: '', label: 'No decidido (D-03)' },
            { value: 'TENANT', label: 'Por tenant' },
            { value: 'PRODUCT', label: 'Por producto' },
          ]}
          error={form.formState.errors.pool_scope} {...form.register('pool_scope')} />
        <NumberField label="Créditos incluidos por período" min={0} step="any" placeholder="No decidido (D-03)"
          error={form.formState.errors.included_credits} {...form.register('included_credits')} />
      </FieldRow>
      <FieldRow>
        <SelectField label="Exceso"
          options={[
            { value: '', label: 'No decidido (D-03)' },
            { value: 'BLOCK', label: 'Bloquear el exceso' },
            { value: 'ALLOW', label: 'Permitir y facturar el exceso' },
          ]}
          error={form.formState.errors.overage_mode} {...form.register('overage_mode')} />
        <TextField label="Vigente desde" type="date" required
          error={form.formState.errors.valid_from} {...form.register('valid_from')} />
      </FieldRow>
      <TextAreaField label="Motivo" required hint="Referencia a la decisión D-03."
        error={form.formState.errors.reason} {...form.register('reason')} />
    </FormDialog>
  );
}
