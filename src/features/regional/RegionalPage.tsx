import { PageContainer } from '@/components/ui/primitives';
import { SectionTabs } from '@/components/ui/SectionTabs';
import { ReportingCurrencyPanel } from './ReportingCurrencyPanel';
import { ExchangeRatesPanel } from './ExchangeRatesPanel';
import { RegionalPricesPanel } from './RegionalPricesPanel';
import { MarketsPanel } from './MarketsPanel';
import { FxCoveragePanel } from './FxCoveragePanel';

/**
 * Monedas y FX (P27).
 *
 * Administración regional de EBIM: moneda de reporte, tipos de cambio MANUAL,
 * cobertura FX, mercados con sus monedas y rutas de cobro. Nada de esto cambia
 * un documento: la moneda de cada operación es la suya para siempre.
 *
 * Dos fechas que no se confunden: la fecha de las TASAS (valuación) y el
 * PERÍODO financiero (cuándo ocurrieron cobros, costos y comisiones).
 */
export function RegionalPage() {
  return (
    <PageContainer
      title="Monedas y FX"
      description="Mercados, moneda de reporte y tipos de cambio para el consolidado gerencial. Los importes nativos no se convierten ni se reescriben."
    >
      <p className="mb-4 rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
        <strong>Fecha FX ≠ período financiero.</strong> La fecha de las tasas sólo decide con qué tasa se convierte; el
        período de cobros, costos y comisiones se elige en el inicio. Si falta una tasa, el consolidado se marca incompleto
        en vez de mostrar un total falso.
      </p>
      <SectionTabs
        tabs={[
          { id: 'reporting', label: 'Moneda de reporte', content: <ReportingCurrencyPanel /> },
          { id: 'fx', label: 'Tipos de cambio', content: <ExchangeRatesPanel /> },
          { id: 'coverage', label: 'Cobertura FX', content: <FxCoveragePanel /> },
          { id: 'prices', label: 'Tarifas por mercado', content: <RegionalPricesPanel /> },
          { id: 'markets', label: 'Mercados y rutas de cobro', content: <MarketsPanel /> },
        ]}
      />
    </PageContainer>
  );
}
