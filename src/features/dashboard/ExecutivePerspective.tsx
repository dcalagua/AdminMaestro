import { useNavigate } from 'react-router-dom';
import { fromQuery } from '@/features/executive/dataState';
import { formatDate } from '@/lib/format';
import { monthBounds } from './executiveModel';
import { AgingPanel, AttentionPanel, MixPanel, PanelBoundary, TopCustomersPanel, TopPartnersPanel } from './executivePanels';
import { usePresentationView } from './presentation/presentationContext';
import { useExecutiveDashboard, type ExecutiveDashboardData } from './executiveDashboardData';
import { BilledCollectedPanel } from './executive-perspective/BilledCollectedPanel';
import { BridgePanel, MrrEvolutionPanel } from './executive-perspective/MrrPanels';
import { HeroKpis } from './executive-perspective/ExecutiveHeroKpis';
import { FilterRow } from './executive-perspective/ExecutiveFilterRow';

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
 */
export function ExecutivePerspective({ today = new Date(), canPresent = false }: { today?: Date; canPresent?: boolean }) {
  const d = useExecutiveDashboard(today);

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

      {/* Cada fila es una sección: al imprimir, una por página (A4 apaisado). */}
      <div className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-12 print:break-before-page print:grid-cols-12" data-print-section="evolucion">
          <div className="min-w-0 xl:col-span-8 print:col-span-8">
            <ExecutivePanel d={d} panel="evolucion-mrr" />
          </div>
          <div className="min-w-0 xl:col-span-4 print:col-span-4">
            <ExecutivePanel d={d} panel="puente" />
          </div>
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
        <div className="grid gap-4 xl:grid-cols-12 print:break-before-page print:grid-cols-12" data-print-section="tops">
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
export function ExecutivePanel({ d, panel }: { d: ExecutiveDashboardData; panel: ExecutivePanelId }) {
  const navigate = useNavigate();
  const view = usePresentationView();
  const { month, horizon, rc } = d;
  return <PanelBoundary title={PANEL_TITLE[panel]}>{renderPanel()}</PanelBoundary>;

  function renderPanel() {
    switch (panel) {
      case 'evolucion-mrr':
        return <MrrEvolutionPanel query={d.series} currency={rc} horizon={horizon} month={month} onSelect={(m) => d.filters.setMonth(m)} />;
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
              navigate(`/billing?desde=${r.from}&hasta=${r.to}#cobros`);
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

