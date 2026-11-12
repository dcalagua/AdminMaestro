import { KpiTile, PageContainer } from '@/components/ui/primitives';
import { SectionTabs } from '@/components/ui/SectionTabs';
import { useExchangeRates, useFinanceConsolidated, useMarkets, useReportingSettings } from '@/services/queries';
import { isoDate } from '@/features/executive/reportContext';
import { formatDate, formatNumber } from '@/lib/format';
import { InfoNote } from '@/features/billing/listing';
import { KpiStrip } from '@/features/billing/financeUi';
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
      <RegionalKpis />
      <div className="mb-4">
        <InfoNote>
          <strong>Fecha FX ≠ período financiero.</strong> La fecha de las tasas sólo decide con qué tasa se convierte; el
          período de cobros, costos y comisiones se elige en el inicio. Si falta una tasa, el consolidado se marca
          incompleto en vez de mostrar un total falso.
        </InfoNote>
      </div>
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

/** Franja de la pantalla: configuración, tasas, cobertura a hoy y mercados (lecturas ya existentes). */
function RegionalKpis() {
  const settings = useReportingSettings();
  const rates = useExchangeRates();
  const markets = useMarkets();
  // Misma consulta (y caché) que la pestaña «Cobertura FX» con su fecha por defecto.
  const coverage = useFinanceConsolidated({ asOf: isoDate(new Date()), groupBy: 'TOTAL' });

  const active = (rates.data ?? []).filter((r) => r.status === 'ACTIVE');
  const demo = active.filter((r) => r.is_demo).length;
  const latest = active.reduce<string | null>((m, r) => (m == null || r.rate_date > m ? r.rate_date : m), null);
  const missing = coverage.data?.completeness.missing_currencies ?? [];
  const currencies = new Set((markets.data ?? []).flatMap((m) => m.allowedCurrencies));

  return (
    <KpiStrip label="Indicadores de monedas y tipos de cambio">
      <KpiTile
        label="Moneda de reporte"
        info="Lente gerencial del consolidado: cambiarla no toca ningún importe."
        value={settings.data?.reporting_currency ?? null}
        footer={
          settings.data?.fx_max_rate_age_days != null
            ? `Tasas de hasta ${formatNumber(settings.data.fx_max_rate_age_days)} días de antigüedad`
            : 'Sin configurar'
        }
        loading={settings.isLoading}
        error={settings.error}
        onRetry={() => void settings.refetch()}
      />
      <KpiTile
        label="Tipos de cambio vigentes"
        value={rates.data ? formatNumber(active.length) : null}
        footer={
          latest
            ? `Última publicada: ${formatDate(latest)}${demo > 0 ? ` · ${formatNumber(demo)} DEMO` : ''}`
            : 'Ninguna tasa publicada'
        }
        loading={rates.isLoading}
        error={rates.error}
        onRetry={() => void rates.refetch()}
      />
      <KpiTile
        label="Cobertura FX a hoy"
        info="Monedas con importes que no tienen tasa vigente para convertirse a la moneda de reporte."
        value={coverage.data ? (missing.length === 0 ? 'Completa' : `${formatNumber(missing.length)} sin tasa`) : null}
        tone={coverage.data ? (missing.length === 0 ? 'ok' : 'warn') : 'neutral'}
        footer={missing.length > 0 ? `Falta: ${missing.join(', ')}` : 'Todas las monedas se convierten'}
        loading={coverage.isLoading}
        error={coverage.error}
        onRetry={() => void coverage.refetch()}
      />
      <KpiTile
        label="Mercados"
        value={markets.data ? formatNumber(markets.data.length) : null}
        footer={markets.data ? `${formatNumber(currencies.size)} monedas admitidas` : undefined}
        loading={markets.isLoading}
        error={markets.error}
        onRetry={() => void markets.refetch()}
      />
    </KpiStrip>
  );
}
