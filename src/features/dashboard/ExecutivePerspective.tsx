import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CaretDownIcon } from '@phosphor-icons/react';
import { LoadingState } from '@/components/ui/primitives';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { fromQuery } from '@/features/executive/dataState';
import { formatDate } from '@/lib/format';
import { bridgeSteps, monthBounds } from './executiveModel';
import { AgingPanel, AttentionPanel, MixPanel, PanelBoundary, TopCustomersPanel, TopPartnersPanel } from './executivePanels';
import { usePresentationView } from './presentation/presentationContext';
import { useExecutiveDashboard, type ExecutiveDashboardData } from './executiveDashboardData';
import { BilledCollectedPanel } from './executive-perspective/BilledCollectedPanel';
import { BridgePanel, MrrEvolutionPanel } from './executive-perspective/MrrPanels';
import { HeroKpis } from './executive-perspective/ExecutiveHeroKpis';
import { FilterRow } from './executive-perspective/ExecutiveFilterRow';

/** La Bandeja resumida solo se descarga en móvil. */
const InboxSummaryCard = lazy(() =>
  import('@/features/inbox/InboxSummaryCard').then((m) => ({ default: m.InboxSummaryCard })),
);

/**
 * Perspectiva EJECUTIVA — Resumen Ejecutivo V4 (fase 09, D-V05).
 *
 * Orden de lectura: (1) franja hero de 6 KPI con tendencia de 12 meses,
 * (2) evolución del MRR y su puente del mes, (3) facturado vs cobrado y
 * cartera vencida, (4) mix por producto y mercado, (5) tops y lo que requiere
 * atención. Todo en UNA moneda de reporte convertida en la base (S01–S08):
 * si falta una tasa, la cifra se rotula «sin tasa», nunca se rellena.
 *
 * Una sola fila de filtros (moneda, horizonte, mes analizado) acota todo lo de
 * abajo y vive en la URL (`?moneda=USD&horizonte=18&cierre=2026-09`). El mes
 * analizado por defecto es el último CERRADO: el mes en curso es parcial.
 * Cada panel lee su propia fuente y falla solo. El modo presentación (fase 14)
 * proyecta estos mismos paneles, uno o dos por diapositiva.
 *
 * Móvil «de consulta» (V5 · F7): por debajo de `sm` el Resumen muestra los KPI y
 * la Bandeja; los gráficos quedan detrás de «Ver gráficos y detalle».
 */
export function ExecutivePerspective({ today = new Date(), canPresent = false }: { today?: Date; canPresent?: boolean }) {
  const d = useExecutiveDashboard(today);
  const mobile = useIsMobile();
  const [showCharts, setShowCharts] = useState(false);
  const chartsHidden = mobile && !showCharts;
  // V6 · 3.1: sin tasa para consolidar el puente, la tarjeta (350 px vacíos) se
  // pliega en un aviso de una línea dentro de la de MRR, que ocupa la fila.
  const bridgeFolded =
    !d.movements.isLoading && !d.movements.error && d.bridge != null && bridgeSteps(d.bridge) == null;

  return (
    <div className="space-y-6">
      <FilterRow
        {...d.filters}
        currency={d.rc}
        missing={d.missing}
        fxIsDemo={d.fxIsDemo}
        isCurrent={d.isCurrent}
        canPresent={canPresent}
      />

      <HeroKpis d={d} />

      {mobile ? (
        <>
          <Suspense fallback={<LoadingState variant="card" label="Cargando la bandeja…" />}>
            <InboxSummaryCard />
          </Suspense>
          <button
            type="button"
            className="ebim-btn-secondary w-full justify-center"
            aria-expanded={showCharts}
            aria-controls="resumen-graficos"
            onClick={() => setShowCharts((v) => !v)}
          >
            {showCharts ? 'Ocultar gráficos' : 'Ver gráficos y detalle'}
            <CaretDownIcon size={16} aria-hidden className={showCharts ? 'rotate-180' : ''} />
          </button>
        </>
      ) : null}

      {/* Cada fila es una sección: al imprimir, una por página (A4 apaisado). */}
      <div id="resumen-graficos" className="space-y-4" hidden={chartsHidden}>
        <div className="grid gap-4 xl:grid-cols-12 print:break-before-page print:grid-cols-12" data-print-section="evolucion">
          <div className={`min-w-0 ${bridgeFolded ? 'xl:col-span-12 print:col-span-12' : 'xl:col-span-8 print:col-span-8'}`}>
            <ExecutivePanel
              d={d}
              panel="evolucion-mrr"
              notice={bridgeFolded ? 'Puente del mes no disponible: falta un tipo de cambio para consolidarlo' : undefined}
            />
          </div>
          {bridgeFolded ? null : (
            <div className="min-w-0 xl:col-span-4 print:col-span-4">
              <ExecutivePanel d={d} panel="puente" />
            </div>
          )}
        </div>
        <div className="grid gap-4 xl:grid-cols-12 print:break-before-page print:grid-cols-12" data-print-section="cobranza">
          <div className="min-w-0 xl:col-span-7 print:col-span-7">
            <ExecutivePanel d={d} panel="facturado-cobrado" />
          </div>
          <div className="min-w-0 xl:col-span-5 print:col-span-5">
            <ExecutivePanel d={d} panel="antiguedad" />
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-12 print:break-before-page print:grid-cols-12" data-print-section="mix">
          <div className="min-w-0 xl:col-span-6 print:col-span-6">
            <ExecutivePanel d={d} panel="mix-producto" />
          </div>
          <div className="min-w-0 xl:col-span-6 print:col-span-6">
            <ExecutivePanel d={d} panel="mix-mercado" />
          </div>
        </div>
        {/* Alturas por contenido: una lista de 1 fila no se estira a la altura de la de 5. */}
        <div className="grid items-start gap-4 xl:grid-cols-12 print:break-before-page print:grid-cols-12" data-print-section="tops">
          <div className="min-w-0 xl:col-span-4 print:col-span-4">
            <ExecutivePanel d={d} panel="top-clientes" />
          </div>
          <div className="min-w-0 xl:col-span-4 print:col-span-4">
            <ExecutivePanel d={d} panel="top-partners" />
          </div>
          <div className="min-w-0 xl:col-span-4 print:col-span-4">
            <ExecutivePanel d={d} panel="atencion" />
          </div>
        </div>
      </div>
    </div>
  );
}

export type ExecutivePanelId =
  | 'evolucion-mrr'
  | 'puente'
  | 'facturado-cobrado'
  | 'antiguedad'
  | 'mix-producto'
  | 'mix-mercado'
  | 'top-clientes'
  | 'top-partners'
  | 'atencion';

const PANEL_TITLE: Record<ExecutivePanelId, string> = {
  'evolucion-mrr': 'Evolución del MRR',
  puente: 'Puente de MRR',
  'facturado-cobrado': 'Facturado vs cobrado',
  antiguedad: 'Cartera por antigüedad',
  'mix-producto': 'Mix por producto',
  'mix-mercado': 'Mix por mercado',
  'top-clientes': 'Top clientes',
  'top-partners': 'Top partners',
  atencion: 'Requiere atención',
};

/** Un panel del tablero, aislado: si falla al dibujarse, solo él muestra su aviso. */
export function ExecutivePanel({
  d,
  panel,
  notice,
}: {
  d: ExecutiveDashboardData;
  panel: ExecutivePanelId;
  /** Aviso de una línea dentro del panel (p. ej. el puente plegado en el de MRR). */
  notice?: string;
}) {
  const navigate = useNavigate();
  const view = usePresentationView();
  const { month, horizon, rc } = d;
  return <PanelBoundary title={PANEL_TITLE[panel]}>{renderPanel()}</PanelBoundary>;

  function renderPanel() {
    switch (panel) {
      case 'evolucion-mrr':
        return (
          <MrrEvolutionPanel
            query={d.series}
            currency={rc}
            horizon={horizon}
            month={month}
            notice={notice}
            onSelect={(m) => d.filters.setMonth(m)}
          />
        );
      case 'puente':
        return <BridgePanel key={month} query={d.movements} bridge={d.bridge} customers={d.customers} currency={rc} month={month} />;
      case 'facturado-cobrado':
        return (
          <BilledCollectedPanel
            query={d.billing}
            currency={rc}
            horizon={horizon}
            month={month}
            // Proyectando, un clic analiza ese mes (no saca de la presentación hacia Facturación).
            onSelect={(m) => {
              if (view.active) return d.filters.setMonth(m);
              const r = monthBounds(m);
              navigate(`/cobranza?tab=facturacion&desde=${r.from}&hasta=${r.to}#cobros`);
            }}
          />
        );
      case 'antiguedad':
        return (
          <AgingPanel
            query={d.aging}
            currency={rc}
            asOfLabel={d.isCurrent ? `A hoy, ${formatDate(d.asOf)}` : `Al cierre de ${d.monthLabel}`}
            refreshing={d.aging.isPlaceholderData}
          />
        );
      case 'mix-producto':
        return <MixPanel dimension="PRODUCT" query={d.mixProduct} currency={rc} monthLabel={d.monthLabel} refreshing={d.mixProduct.isPlaceholderData} />;
      case 'mix-mercado':
        return <MixPanel dimension="MARKET" query={d.mixMarket} currency={rc} monthLabel={d.monthLabel} refreshing={d.mixMarket.isPlaceholderData} />;
      case 'top-clientes':
        return (
          <TopCustomersPanel
            rows={d.customers.data}
            state={fromQuery(d.customers)}
            currency={rc}
            monthLabel={d.monthLabel}
            onRetry={() => void d.customers.refetch()}
          />
        );
      case 'top-partners':
        return <TopPartnersPanel current={d.mixPartner} previous={d.mixPartnerPrev} currency={rc} monthLabel={d.monthLabel} />;
      case 'atencion':
        return <AttentionPanel />;
    }
  }
}

