import { PageContainer } from '@/components/ui/primitives';
import { SectionTabs } from '@/components/ui/SectionTabs';
import { ReportingCurrencyPanel } from './ReportingCurrencyPanel';

/**
 * Monedas y FX (V3).
 *
 * Administración regional de EBIM: moneda de reporte, tipos de cambio MANUAL,
 * mercados con sus monedas y rutas de cobro. Nada de esto cambia un documento:
 * la moneda de cada operación es la suya para siempre.
 */
export function RegionalPage() {
  return (
    <PageContainer
      title="Monedas y FX"
      description="Mercados, moneda de reporte y tipos de cambio para el consolidado gerencial. Los importes nativos no se convierten ni se reescriben."
    >
      <SectionTabs
        tabs={[
          { id: 'reporting', label: 'Moneda de reporte', content: <ReportingCurrencyPanel /> },
        ]}
      />
    </PageContainer>
  );
}
