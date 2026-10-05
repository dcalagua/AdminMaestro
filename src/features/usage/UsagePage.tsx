import { SectionTabs } from '@/components/ui/SectionTabs';
import { PageContainer } from '@/components/ui/primitives';
import { MetersTab } from './MetersTab';
import { IngestTab } from './IngestTab';
import { AggregatesTab } from './AggregatesTab';
import { EventsTab } from './EventsTab';
import { RejectionsTab } from './RejectionsTab';
import { AlertsTab } from './AlertsTab';

/**
 * «Uso» (CCP M4, spec §5.1): medidores, ingest, agregados, eventos, rechazos y
 * alertas sobre el backend de las fases 17–18.
 *
 * Pestañas centradas con deep-link por `#hash` (U-07). Cada acción se ofrece
 * según el rol, pero la RPC es la autoridad: la pantalla solo es UX.
 */
export function UsagePage() {
  return (
    <PageContainer
      title="Uso"
      description="Lo que miden los productos de la suite y cómo se cierra cada período. Nada se factura desde eventos crudos: solo desde agregados finalizados de medidores facturables (D-06)."
    >
      <SectionTabs
        tabs={[
          { id: 'meters', label: 'Medidores', content: <MetersTab /> },
          { id: 'ingest', label: 'Ingest', content: <IngestTab /> },
          { id: 'aggregates', label: 'Agregados', content: <AggregatesTab /> },
          { id: 'events', label: 'Eventos', content: <EventsTab /> },
          { id: 'rejections', label: 'Rechazos', content: <RejectionsTab /> },
          { id: 'alerts', label: 'Alertas', content: <AlertsTab /> },
        ]}
      />
    </PageContainer>
  );
}
