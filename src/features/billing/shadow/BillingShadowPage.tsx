import { SectionTabs } from '@/components/ui/SectionTabs';
import { KpiTile, PageContainer } from '@/components/ui/primitives';
import { useBillingShadowComparisons, useCommercialCutoverAxes } from '@/services/queries';
import { formatDateTime, formatNumber } from '@/lib/format';
import { KpiStrip } from '@/features/billing/financeUi';
import { ShadowAxisTab } from './ShadowAxisTab';
import { ShadowPreviewTab } from './ShadowPreviewTab';
import { ShadowHistoryTab } from './ShadowHistoryTab';

/**
 * «Billing shadow» (CCP M4, spec §5.3; CCP §15.2 y D-14). Antes de que
 * MasterAdmin facture un producto, calcula lo que facturaría y se compara
 * línea a línea con el biller local. Nadie cobra desde esta pantalla.
 */
export function BillingShadowPage() {
  return (
    <PageContainer
      title="Billing shadow"
      description="Eje de facturación por producto, vista previa de lo que MasterAdmin facturaría y el historial de comparaciones con el biller local de cada SaaS."
    >
      <ShadowKpis />
      <SectionTabs
        tabs={[
          { id: 'products', label: 'Productos', content: <ShadowAxisTab /> },
          { id: 'preview', label: 'Vista previa', content: <ShadowPreviewTab /> },
          { id: 'history', label: 'Historial', content: <ShadowHistoryTab /> },
        ]}
      />
    </PageContainer>
  );
}

/** Franja con las mismas consultas (y caché) de las pestañas «Productos» e «Historial». */
function ShadowKpis() {
  const axes = useCommercialCutoverAxes();
  const comparisons = useBillingShadowComparisons();
  const integrations = axes.data ?? [];
  const inShadow = integrations.filter((i) => i.cutover_state_billing === 'BILLING_SHADOW').length;
  const rows = comparisons.data ?? [];
  const green = rows.filter((c) => c.mismatches === 0).length;
  const red = rows.length - green;
  const latest = rows.reduce<string | null>((m, c) => (c.created_at && (m == null || c.created_at > m) ? c.created_at : m), null);
  const cmp = { loading: comparisons.isLoading, error: comparisons.error, onRetry: () => void comparisons.refetch() };

  return (
    <KpiStrip label="Indicadores de billing shadow">
      <KpiTile
        label="Productos en shadow"
        info="Integraciones con el eje de facturación en BILLING_SHADOW: MasterAdmin calcula y compara, nadie cobra desde aquí."
        value={axes.data ? formatNumber(inShadow) : null}
        footer={axes.data ? `de ${formatNumber(integrations.length)} integraciones` : undefined}
        loading={axes.isLoading}
        error={axes.error}
        onRetry={() => void axes.refetch()}
      />
      <KpiTile
        label="Comparaciones registradas"
        value={comparisons.data ? formatNumber(rows.length) : null}
        footer={latest ? `Última: ${formatDateTime(latest)}` : 'Todavía no hay comparaciones'}
        {...cmp}
      />
      <KpiTile
        label="En verde"
        info="Biller local y MasterAdmin coinciden línea a línea (cantidad, importe al centavo y moneda)."
        value={comparisons.data ? formatNumber(green) : null}
        tone={rows.length > 0 && red === 0 ? 'ok' : 'neutral'}
        footer="0 diferencias"
        {...cmp}
      />
      <KpiTile
        label="Con diferencias"
        info="Comparaciones con al menos una línea distinta: hay que explicarlas antes de avanzar el eje."
        value={comparisons.data ? formatNumber(red) : null}
        tone={red > 0 ? 'danger' : 'neutral'}
        footer={red > 0 ? 'Revisar en «Historial»' : 'Ninguna comparación en rojo'}
        {...cmp}
      />
    </KpiStrip>
  );
}
