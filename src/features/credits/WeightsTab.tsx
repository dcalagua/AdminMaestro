import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAiCreditWeights, useProductCapabilities } from '@/services/queries';
import { useSetAiCreditWeight } from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge } from '@/components/ui/primitives';
import { FormDialog } from '@/components/ui/FormDialog';
import { FieldRow, NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { formatDateTime } from '@/lib/format';
import { formatQuantity } from '@/features/usage/usageLabels';
import { Undecided } from '@/features/usage/Undecided';
import { useLookups } from '@/features/usage/useLookups';

/**
 * Pesos de crédito por capacidad AI_FEATURE (spec §12.1, D-03). Versionados:
 * una versión nueva cierra la vigente y nunca empieza antes que ella. Sin peso
 * vigente la capacidad se muestra «No decidido (D-03)» y su uso alerta
 * PESO_CREDITO_NO_DEFINIDO en vez de consumir créditos inventados.
 */
type Weight = NonNullable<ReturnType<typeof useAiCreditWeights>['data']>[number];

export function WeightsTab() {
  const weights = useAiCreditWeights();
  const capabilities = useProductCapabilities();
  const lookups = useLookups();
  const perms = usePermissions();
  const [creatingFor, setCreatingFor] = useState<string | null>(null);

  const aiCapabilities = useMemo(
    () => (capabilities.data ?? []).filter((c) => c.kind === 'AI_FEATURE'),
    [capabilities.data],
  );
  const capabilityById = useMemo(() => new Map(aiCapabilities.map((c) => [c.id, c])), [aiCapabilities]);

  const now = Date.now();
  const isCurrent = (w: Weight) =>
    new Date(w.valid_from).getTime() <= now && (!w.valid_to || new Date(w.valid_to).getTime() > now);

  const rows = useMemo(
    () =>
      aiCapabilities.map((c) => {
        const history = (weights.data ?? []).filter((w) => w.capability_id === c.id);
        return { capability: c, current: history.find(isCurrent) ?? null, scheduled: history.find((w) => new Date(w.valid_from).getTime() > now) ?? null, history };
      }),
    [aiCapabilities, weights.data],
  );

  const { term, setTerm, filtered } = useSearchFilter(rows, (r) => [
    r.capability.code, r.capability.name, lookups.productName(r.capability.saas_product_id),
  ]);
  const history = (weights.data ?? []).filter((w) => {
    const c = capabilityById.get(w.capability_id);
    const needle = term.trim().toLowerCase();
    return !needle || [c?.code, c?.name, w.reason].some((v) => String(v ?? '').toLowerCase().includes(needle));
  });

  const loading = weights.isLoading || capabilities.isLoading;
  const error = weights.error ?? capabilities.error;

  return (
    <div className="space-y-4">
      <Card
        title="Pesos vigentes"
        description="Créditos EBIM por unidad de cada capacidad de IA. Los tokens del proveedor nunca son la unidad comercial."
        actions={
          perms.canReadFinance ? (
            <button type="button" className="ebim-btn-primary ebim-btn-sm" onClick={() => setCreatingFor('')}>
              Nueva versión
            </button>
          ) : null
        }
      >
        <SearchBar value={term} onChange={setTerm} placeholder="Buscar capacidad por código, nombre o producto…" />
        {loading ? (
          <LoadingState label="Cargando pesos…" />
        ) : error ? (
          <ErrorState
            error={error}
            onRetry={() => {
              void weights.refetch();
              void capabilities.refetch();
            }}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={rows.length > 0 ? 'Ninguna capacidad coincide' : 'Sin capacidades de IA registradas'}
            description={
              rows.length > 0 ? 'Prueba con otra búsqueda.' : 'Una capacidad AI_FEATURE llega con el manifiesto del producto.'
            }
          />
        ) : (
          <DataTable columns={['Capacidad', 'Producto', 'Peso vigente', 'Desde', 'Programado', '']}>
            {filtered.map((r) => (
              <tr key={r.capability.id}>
                <td className="ebim-td">
                  <div className="font-semibold">{r.capability.name}</div>
                  <div className="font-mono text-caption text-muted">{r.capability.code}</div>
                </td>
                <td className="ebim-td text-compact">{lookups.productName(r.capability.saas_product_id)}</td>
                <td className="ebim-td text-body">
                  {r.current ? (
                    <span className="font-semibold tabular-nums">
                      {formatQuantity(r.current.credits_per_unit)} créditos / {r.current.unit}
                    </span>
                  ) : (
                    <Undecided code="D-03" />
                  )}
                </td>
                <td className="ebim-td whitespace-nowrap text-compact text-muted">
                  {r.current ? formatDateTime(r.current.valid_from) : '—'}
                </td>
                <td className="ebim-td text-compact">
                  {r.scheduled ? (
                    <Badge tone="info">
                      {formatQuantity(r.scheduled.credits_per_unit)} desde {formatDateTime(r.scheduled.valid_from)}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="ebim-td text-right">
                  {perms.canReadFinance ? (
                    <button type="button" className="ebim-link text-compact" onClick={() => setCreatingFor(r.capability.code)}>
                      Nueva versión
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <Card title="Historial de versiones" description="Inmutable: una versión solo se cierra (valid_to) al abrir la siguiente.">
        {loading ? (
          <LoadingState label="Cargando historial…" />
        ) : error ? null : history.length === 0 ? (
          <EmptyState title="Sin versiones registradas" description="Ningún peso se ha decidido todavía (D-03)." />
        ) : (
          <DataTable columns={['Capacidad', 'Peso', 'Vigencia', 'Motivo']}>
            {history.map((w) => (
              <tr key={w.id}>
                <td className="ebim-td font-mono text-compact">{capabilityById.get(w.capability_id)?.code ?? w.capability_id}</td>
                <td className="ebim-td text-compact tabular-nums">
                  {formatQuantity(w.credits_per_unit)} / {w.unit}
                </td>
                <td className="ebim-td whitespace-nowrap text-compact">
                  {formatDateTime(w.valid_from)} → {w.valid_to ? formatDateTime(w.valid_to) : 'sin fin'}
                </td>
                <td className="ebim-td max-w-[320px] text-compact text-muted">{w.reason}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <WeightDialog
        open={creatingFor !== null}
        capabilityCode={creatingFor ?? ''}
        capabilities={aiCapabilities.map((c) => ({ code: c.code, name: c.name, unit: c.unit }))}
        onClose={() => setCreatingFor(null)}
      />
    </div>
  );
}

const weightSchema = z.object({
  capability_code: z.string().min(1, 'Elige la capacidad'),
  credits_per_unit: z.coerce.number({ error: 'Número de créditos' }).min(0, 'Créditos por unidad ≥ 0'),
  unit: z.string().trim().regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, 'Unidad en minúsculas (call, page, minute…)'),
  valid_from: z.string().min(1, 'Indica desde cuándo rige'),
  reason: z.string().trim().min(3, 'El motivo es obligatorio'),
});
type WeightValues = z.input<typeof weightSchema>;

function WeightDialog({
  open,
  capabilityCode,
  capabilities,
  onClose,
}: {
  open: boolean;
  capabilityCode: string;
  capabilities: Array<{ code: string; name: string; unit: string | null }>;
  onClose: () => void;
}) {
  const toast = useToast();
  const setWeight = useSetAiCreditWeight();
  const form = useForm<WeightValues>({ resolver: zodResolver(weightSchema) });

  useEffect(() => {
    if (!open) return;
    setWeight.reset();
    const cap = capabilities.find((c) => c.code === capabilityCode);
    form.reset({ capability_code: capabilityCode, credits_per_unit: '', unit: cap?.unit ?? '', valid_from: '', reason: '' });
  }, [open, capabilityCode]);

  const submit = form.handleSubmit(async (values) => {
    const v = weightSchema.parse(values);
    try {
      await setWeight.mutateAsync({
        p_capability_code: v.capability_code,
        p_credits_per_unit: v.credits_per_unit,
        p_unit: v.unit,
        p_valid_from: new Date(v.valid_from).toISOString(),
        p_reason: v.reason,
      });
      toast.success('Peso registrado', `${v.capability_code}: ${v.credits_per_unit} créditos / ${v.unit}`);
      onClose();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={open}
      title="Nueva versión de peso"
      description="Decisión comercial de finanzas (D-03). Cierra la versión vigente en la fecha indicada; no puede empezar antes que una existente. Los tenants enrolados del producto reciben un snapshot nuevo."
      submitLabel="Registrar peso"
      busy={setWeight.isPending}
      error={setWeight.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <SelectField label="Capacidad de IA" required placeholder="Elige la capacidad…"
        options={capabilities.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` }))}
        error={form.formState.errors.capability_code} {...form.register('capability_code')} />
      <FieldRow>
        <NumberField label="Créditos por unidad" required min={0} step="any"
          error={form.formState.errors.credits_per_unit} {...form.register('credits_per_unit')} />
        <TextField label="Unidad" required placeholder="page" error={form.formState.errors.unit} {...form.register('unit')} />
      </FieldRow>
      <TextField label="Vigente desde" type="datetime-local" required
        error={form.formState.errors.valid_from} {...form.register('valid_from')} />
      <TextAreaField label="Motivo" required hint="Referencia a la decisión D-03."
        error={form.formState.errors.reason} {...form.register('reason')} />
    </FormDialog>
  );
}
