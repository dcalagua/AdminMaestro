import { useState } from 'react';
import {
  Card, Badge, DataTable, EmptyState, LoadingState, ErrorState, SearchBar,
} from '@/components/ui/primitives';
import { Money } from '@/components/ui/Money';
import { usePermissions } from '@/hooks/usePermissions';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { usePlanPriceCatalog } from '@/services/queries';
import { formatDate } from '@/lib/format';
import { PlanPriceDialog } from '@/features/catalog/PlanDialogs';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { BILLING_INTERVAL_LABEL, CHARGE_KIND_LABEL } from '@/features/billing/subscriptionLabels';

/**
 * Tarifas por mercado (V3 · fase 04/12).
 *
 * Una misma moneda puede costar distinto en dos mercados (PE/USD ≠ EC/USD), por
 * eso mercado y moneda van juntos en cada fila. Una tarifa no se edita: se
 * versiona desde «Versionar tarifa», que cierra la vigente y abre otra.
 */
type Tab = 'CURRENT' | 'SCHEDULED' | 'HISTORY' | 'LEGACY';

export function RegionalPricesPanel() {
  const perms = usePermissions();
  const prices = usePlanPriceCatalog();
  const [tab, setTab] = useState<Tab>('CURRENT');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const { term, setTerm, filtered } = useSearchFilter(prices.data, (p) => [
    p.plan_name, p.plan_code, p.market_code, p.market_name, p.currency, p.charge_kind,
  ]);

  const rows = filtered.filter((p) => {
    if (tab === 'LEGACY') return p.is_legacy;
    if (p.is_legacy) return false;
    if (tab === 'CURRENT') return p.is_current;
    if (tab === 'SCHEDULED') return p.is_scheduled;
    return !p.is_current && !p.is_scheduled;
  });

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'CURRENT', label: 'Vigentes' },
    { id: 'SCHEDULED', label: 'Programadas' },
    { id: 'HISTORY', label: 'Historial' },
    { id: 'LEGACY', label: 'Sin mercado (legacy)' },
  ];

  return (
    <Card
      title="Tarifas por mercado"
      description="Plan + mercado + cargo + periodicidad + moneda + vigencia. Sin tarifa regional vigente no se vende en ese mercado."
    >
      <SearchBar
        value={term}
        onChange={setTerm}
        placeholder="Buscar por plan, mercado o moneda…"
        right={<StatusTabs label="Estado de las tarifas" value={tab} onChange={setTab} options={TABS} />}
      />
      {prices.isLoading ? (
        <LoadingState />
      ) : prices.error ? (
        <ErrorState error={prices.error} onRetry={() => void prices.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="Sin tarifas" description="No hay tarifas en esta vista." />
      ) : (
        <DataTable
          label="Tarifas por mercado"
          columns={['Plan', 'Mercado', 'Cargo', 'Periodicidad', { label: 'Importe', align: 'right' }, 'Vigencia', { label: 'Acciones', srOnly: true }]}
        >
          {rows.map((p) => (
            <tr key={p.price_id ?? undefined}>
              <td className="ebim-td">
                <div className="font-semibold">{p.plan_name}</div>
                <div className="font-mono text-caption text-muted">{p.plan_code}</div>
              </td>
              <td className="ebim-td">
                {p.is_legacy ? <Badge tone="warn">Sin mercado</Badge> : <Badge tone="accent">{p.market_code}</Badge>}
              </td>
              <td className="ebim-td text-compact" title={p.charge_kind ?? undefined}>
                {CHARGE_KIND_LABEL[p.charge_kind ?? ''] ?? p.charge_kind}
              </td>
              <td className="ebim-td text-compact" title={p.billing_interval ?? undefined}>
                {BILLING_INTERVAL_LABEL[p.billing_interval ?? ''] ?? p.billing_interval}
              </td>
              <td className="ebim-td ebim-num whitespace-nowrap font-semibold">
                <Money amount={p.amount} currency={p.currency} />
              </td>
              <td className="ebim-td whitespace-nowrap text-compact text-fg-2">
                {formatDate(p.valid_from)} → {p.valid_to ? formatDate(p.valid_to) : 'abierta'}
              </td>
              <td className="ebim-td w-12 text-right">
                {perms.canManagePlatform && p.plan_id ? (
                  <ActionMenu
                    label={`Acciones de la tarifa ${p.plan_name ?? ''} ${p.market_code ?? 'sin mercado'} ${p.currency ?? ''}`.trim()}
                    items={[{ label: 'Versionar tarifa', onSelect: () => setEditing({ id: p.plan_id as string, name: p.plan_name ?? '' }) }]}
                  />
                ) : null}
              </td>
            </tr>
          ))}
        </DataTable>
      )}

      <PlanPriceDialog
        open={Boolean(editing)}
        planId={editing?.id ?? null}
        planName={editing?.name ?? ''}
        onClose={() => setEditing(null)}
      />
    </Card>
  );
}
