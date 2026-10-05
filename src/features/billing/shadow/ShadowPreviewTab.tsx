import { useId, useState } from 'react';
import { useBillingShadowExpected, type BillingShadowExpectedParams } from '@/services/queries';
import { Card, DataTable, LoadingState, EmptyState } from '@/components/ui/primitives';
import { Money } from '@/components/ui/Money';
import { businessErrorMessage } from '@/lib/pgError';
import { toShadowExpected } from '@/lib/billingShadow';
import { currentPeriodStart, formatPeriod, formatQuantity, monthOf, periodFromMonth } from '@/features/usage/usageLabels';
import { useLookups } from '@/features/usage/useLookups';

/**
 * Vista previa «lo que MasterAdmin facturaría» por tenant y mes
 * (`billing_shadow_expected_lines`). SOLO LECTURA: no emite facturas ni reserva
 * números. Misma fuente única que la emisión real + consumo vencido.
 */
export function ShadowPreviewTab() {
  const lookups = useLookups();
  const ids = { product: useId(), tenant: useId(), month: useId() };
  const [productCode, setProductCode] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [month, setMonth] = useState(monthOf(currentPeriodStart()));
  const [params, setParams] = useState<BillingShadowExpectedParams | null>(null);
  const expected = useBillingShadowExpected(params);
  const data = toShadowExpected(expected.data);

  const productId = lookups.products.find((p) => p.code === productCode)?.id;
  const tenantOptions = lookups.tenants
    .filter((t) => t.tenant_id && (!productId || t.saas_product_id === productId))
    .map((t) => ({ value: t.tenant_id as string, label: `${t.name ?? t.slug}` }));
  const ready = Boolean(productCode && tenantId && periodFromMonth(month));

  return (
    <Card
      title="Vista previa"
      description="Lo que MasterAdmin facturaría al tenant en el mes: líneas del contrato con su signo y consumo vencido de agregados finalizados. No emite nada."
    >
      <form
        className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) setParams({ productCode, tenantId, periodStart: periodFromMonth(month) });
        }}
      >
        <div className="min-w-[180px]">
          <label className="ebim-label" htmlFor={ids.product}>Producto</label>
          <select
            id={ids.product}
            className="ebim-input"
            value={productCode}
            onChange={(e) => {
              setProductCode(e.target.value);
              setTenantId('');
            }}
          >
            <option value="">Elige el producto…</option>
            {lookups.productOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[220px]">
          <label className="ebim-label" htmlFor={ids.tenant}>Tenant</label>
          <select id={ids.tenant} className="ebim-input" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            <option value="">Elige el tenant…</option>
            {tenantOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="ebim-label" htmlFor={ids.month}>Mes</label>
          <input id={ids.month} type="month" className="ebim-input" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <button type="submit" className="ebim-btn-primary" disabled={!ready}>
          Calcular
        </button>
      </form>

      {!params ? (
        <EmptyState title="Elige producto, tenant y mes" description="La vista previa se calcula bajo demanda en la base." />
      ) : expected.isLoading ? (
        <LoadingState label="Calculando lo que MasterAdmin facturaría…" />
      ) : expected.error ? (
        <div role="alert" className="px-4 py-10 text-center">
          <p className="text-body font-semibold text-danger">No se pudo calcular la vista previa</p>
          <p className="mx-auto mt-1 max-w-lg text-body text-muted">{businessErrorMessage(expected.error)}</p>
          <button type="button" className="ebim-btn-ghost mt-4" onClick={() => void expected.refetch()}>
            Reintentar
          </button>
        </div>
      ) : !data || data.lines.length === 0 ? (
        <EmptyState
          title={`Sin líneas en ${formatPeriod(params.periodStart)}`}
          description="El contrato no tiene cargos vencidos ni consumo facturable en ese mes."
        />
      ) : (
        <>
          <DataTable columns={['Línea (itemCode)', 'Cantidad', 'Importe']}>
            {data.lines.map((l) => (
              <tr key={l.itemCode}>
                <td className="ebim-td font-mono text-compact">{l.itemCode}</td>
                <td className="ebim-td text-compact tabular-nums">{formatQuantity(l.quantity)}</td>
                <td className="ebim-td text-body">
                  <Money amount={l.amount} currency={l.currency ?? data.currency} />
                </td>
              </tr>
            ))}
          </DataTable>
          <div className="flex items-center justify-end gap-3 border-t border-border px-4 py-3 text-body">
            <span className="text-muted">Total {formatPeriod(data.periodStart)}</span>
            <Money className="text-base font-bold" amount={data.total} currency={data.currency} />
          </div>
        </>
      )}
    </Card>
  );
}
