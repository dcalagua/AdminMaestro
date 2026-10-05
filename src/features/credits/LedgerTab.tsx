import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAiCreditLedger } from '@/services/queries';
import { useReverseAiCreditEntry } from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { Card, DataTable, SearchBar, LoadingState, ErrorState, EmptyState, Badge } from '@/components/ui/primitives';
import { DetailDrawer, DetailList } from '@/components/ui/DetailDrawer';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextAreaField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { formatDateTime } from '@/lib/format';
import {
  LEDGER_ENTRY, LEDGER_GROUPS, NON_REVERSIBLE_ENTRIES, formatPeriod, formatQuantity, labelOf, poolLabel,
} from '@/features/usage/usageLabels';
import { useLookups } from '@/features/usage/useLookups';

/**
 * Ledger append-only de créditos IA (spec §12.3). Una corrección es una
 * entrada nueva (ADJUST o REVERSAL), nunca un UPDATE. «Revertir» crea la
 * REVERSAL por el importe opuesto, una sola vez por entrada, con motivo.
 */
type Entry = NonNullable<ReturnType<typeof useAiCreditLedger>['data']>[number];
type Tab = 'ALL' | 'GRANTS' | 'CONSUMPTION' | 'CORRECTIONS';

export function LedgerTab() {
  const ledger = useAiCreditLedger();
  const lookups = useLookups();
  const perms = usePermissions();
  const [tab, setTab] = useState<Tab>('ALL');
  const [selected, setSelected] = useState<Entry | null>(null);
  const [reversing, setReversing] = useState<Entry | null>(null);

  const reversed = useMemo(
    () => new Set((ledger.data ?? []).map((e) => e.reverses_entry_id).filter((id): id is string => Boolean(id))),
    [ledger.data],
  );

  const { term, setTerm, filtered } = useSearchFilter(ledger.data, (e) => [
    lookups.tenantName(e.tenant_id), e.entry_type, LEDGER_ENTRY[e.entry_type]?.label, e.pool_key, e.reason,
    e.entry_idempotency_key, e.id,
  ]);
  const inTab = (t: Tab, type: string) => t === 'ALL' || LEDGER_GROUPS[t]?.includes(type);
  const count = (t: Tab) => filtered.filter((e) => inTab(t, e.entry_type)).length;
  const visible = filtered.filter((e) => inTab(tab, e.entry_type));
  const hasAny = (ledger.data ?? []).length > 0;

  const canReverse = (e: Entry) => perms.canReadFinance && !NON_REVERSIBLE_ENTRIES.has(e.entry_type) && !reversed.has(e.id);

  return (
    <Card
      title="Movimientos"
      description="Del más reciente al más antiguo. El signo lo fija el tipo: altas suman, consumos restan; un ajuste puede ir en ambos sentidos."
    >
      <SearchBar
        value={term}
        onChange={setTerm}
        placeholder="Buscar por tenant, tipo, pool, motivo o clave…"
        right={
          <StatusTabs
            value={tab}
            onChange={setTab}
            options={[
              { id: 'ALL', label: 'Todos', count: count('ALL') },
              { id: 'GRANTS', label: 'Altas', count: count('GRANTS') },
              { id: 'CONSUMPTION', label: 'Consumos', count: count('CONSUMPTION') },
              { id: 'CORRECTIONS', label: 'Correcciones', count: count('CORRECTIONS') },
            ]}
          />
        }
      />
      {ledger.isLoading ? (
        <LoadingState label="Cargando movimientos…" />
      ) : ledger.error ? (
        <ErrorState error={ledger.error} onRetry={() => void ledger.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={hasAny ? 'Ningún movimiento coincide' : 'Sin movimientos de créditos'}
          description={hasAny ? 'Prueba con otra búsqueda o cambia de filtro.' : 'El ledger está vacío: nada se siembra (D-02/D-03/D-04).'}
        />
      ) : (
        <DataTable columns={['Fecha', 'Tenant', 'Tipo', 'Pool', 'Período', 'Créditos', '']}>
          {visible.map((e) => {
            const t = labelOf(LEDGER_ENTRY, e.entry_type);
            return (
              <tr key={e.id}>
                <td className="ebim-td whitespace-nowrap text-compact text-muted">{formatDateTime(e.created_at)}</td>
                <td className="ebim-td text-compact font-semibold">{lookups.tenantName(e.tenant_id)}</td>
                <td className="ebim-td">
                  <Badge tone={t.tone}>{t.label}</Badge>
                  {reversed.has(e.id) ? <div className="mt-0.5 text-caption text-muted">Revertida</div> : null}
                </td>
                <td className="ebim-td text-compact">{poolLabel(e.pool_key)}</td>
                <td className="ebim-td whitespace-nowrap text-compact">{formatPeriod(e.period_start)}</td>
                <td className={`ebim-td text-body font-semibold tabular-nums ${e.credits < 0 ? 'text-danger' : 'text-ok'}`}>
                  {e.credits > 0 ? '+' : ''}
                  {formatQuantity(e.credits)}
                </td>
                <td className="ebim-td text-right">
                  <button type="button" className="ebim-link text-compact" onClick={() => setSelected(e)}>
                    Ver detalle
                  </button>
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}

      <DetailDrawer
        open={selected !== null}
        title={selected ? `${labelOf(LEDGER_ENTRY, selected.entry_type).label} · ${formatQuantity(selected.credits)} créditos` : ''}
        subtitle={selected ? `${lookups.tenantName(selected.tenant_id)} · ${poolLabel(selected.pool_key)}` : undefined}
        onClose={() => setSelected(null)}
        actions={
          selected && canReverse(selected) ? (
            <button
              type="button"
              className="ebim-btn-danger"
              onClick={() => {
                // Un solo modal a la vez: el panel se cierra y abre el diálogo con motivo.
                setReversing(selected);
                setSelected(null);
              }}
            >
              Revertir
            </button>
          ) : null
        }
      >
        {selected ? (
          <DetailList
            items={[
              ['Movimiento', <span key="id" className="font-mono text-compact">{selected.id}</span>],
              ['Tipo', selected.entry_type],
              ['Créditos', formatQuantity(selected.credits)],
              ['Tenant', lookups.tenantName(selected.tenant_id)],
              ['Producto', lookups.productName(selected.saas_product_id)],
              ['Pool', poolLabel(selected.pool_key)],
              ['Período', formatPeriod(selected.period_start)],
              ['Cantidad', formatQuantity(selected.quantity)],
              ['Peso aplicado', selected.weight_applied === null ? '—' : `${formatQuantity(selected.weight_applied)} créditos/unidad`],
              ['Agregado de uso', selected.usage_aggregate_id ?? '—'],
              ['Política', selected.policy_id ?? '—'],
              ['Revierte a', selected.reverses_entry_id ?? '—'],
              ['Clave de idempotencia', <span key="k" className="font-mono text-compact">{selected.entry_idempotency_key}</span>],
              ['Motivo', selected.reason ?? '—'],
              ['Registrado', formatDateTime(selected.created_at)],
            ]}
          />
        ) : null}
        {selected && reversed.has(selected.id) ? (
          <p className="mt-3 text-compact text-muted">Esta entrada ya tiene su reversión: una entrada se revierte una sola vez.</p>
        ) : null}
      </DetailDrawer>

      <ReverseDialog
        entry={reversing}
        onClose={() => setReversing(null)}
        onDone={() => setReversing(null)}
      />
    </Card>
  );
}

const reverseSchema = z.object({ reason: z.string().trim().min(3, 'El motivo es obligatorio') });
type ReverseValues = z.input<typeof reverseSchema>;

function ReverseDialog({ entry, onClose, onDone }: { entry: Entry | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const reverse = useReverseAiCreditEntry();
  const form = useForm<ReverseValues>({ resolver: zodResolver(reverseSchema), defaultValues: { reason: '' } });

  useEffect(() => {
    if (!entry) return;
    reverse.reset();
    form.reset({ reason: '' });
  }, [entry]);

  const submit = form.handleSubmit(async (values) => {
    if (!entry) return;
    const v = reverseSchema.parse(values);
    try {
      await reverse.mutateAsync({ p_entry_id: entry.id, p_reason: v.reason });
      toast.success('Movimiento revertido', `${formatQuantity(-entry.credits)} créditos`);
      onDone();
    } catch {
      /* visible en el diálogo */
    }
  });

  return (
    <FormDialog
      open={Boolean(entry)}
      title="Revertir movimiento"
      description={
        entry
          ? `Crea una REVERSAL de ${formatQuantity(-entry.credits)} créditos. El original no cambia (ledger append-only) y solo se revierte una vez.`
          : undefined
      }
      submitLabel="Revertir"
      busy={reverse.isPending}
      error={reverse.error}
      onSubmit={() => void submit()}
      onCancel={onClose}
    >
      <TextAreaField label="Motivo" required hint="Queda en el ledger y en la auditoría."
        error={form.formState.errors.reason} {...form.register('reason')} />
    </FormDialog>
  );
}
