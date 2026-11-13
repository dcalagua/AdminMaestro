import { useEffect, useState, type ReactNode } from 'react';
import { StatusTabs } from '@/components/ui/SectionTabs';
import { PageContainer } from '@/components/ui/primitives';
import { MetersTab } from './MetersTab';
import { IngestTab } from './IngestTab';
import { AggregatesTab } from './AggregatesTab';
import { EventsTab } from './EventsTab';
import { RejectionsTab } from './RejectionsTab';
import { AlertsTab } from './AlertsTab';

type Section = 'meters' | 'ingest' | 'aggregates' | 'events' | 'rejections' | 'alerts';

const SECTIONS: Array<{ id: Section; label: string; render: () => ReactNode }> = [
  { id: 'meters', label: 'Medidores', render: () => <MetersTab /> },
  { id: 'ingest', label: 'Conexión de uso', render: () => <IngestTab /> },
  { id: 'aggregates', label: 'Agregados', render: () => <AggregatesTab /> },
  { id: 'events', label: 'Eventos', render: () => <EventsTab /> },
  { id: 'rejections', label: 'Rechazos', render: () => <RejectionsTab /> },
  { id: 'alerts', label: 'Alertas', render: () => <AlertsTab /> },
];

function fromHash(): Section {
  const hash = window.location.hash.replace('#', '');
  return SECTIONS.some((s) => s.id === hash) ? (hash as Section) : 'meters';
}

/**
 * «Uso» (CCP M4, spec §5.1): medidores, conexión de uso, agregados, eventos,
 * rechazos y alertas.
 *
 * V6 · F2 (plan §3.3, un solo nivel de pestañas): dentro de Apps › Uso las
 * secciones son un control segmentado, no una tercera fila de pestañas
 * subrayadas. Conservan el deep-link por `#hash` (U-07). Cada acción se ofrece
 * según el rol, pero la RPC es la autoridad: la pantalla solo es UX.
 */
export function UsagePage() {
  const [section, setSection] = useState<Section>(fromHash);

  useEffect(() => {
    const onHashChange = () => setSection(fromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const select = (id: Section) => {
    setSection(id);
    window.location.hash = id;
  };
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!;

  return (
    <PageContainer
      title="Uso"
      description="Lo que miden las apps de la suite y cómo se cierra cada período. Nada se factura desde eventos sueltos: solo desde agregados cerrados de medidores facturables."
    >
      <div className="mb-4 max-w-full overflow-x-auto">
        <StatusTabs label="Secciones de uso" value={section} onChange={select} options={SECTIONS} />
      </div>
      <div role="tabpanel" aria-label={current.label} data-usage-section={current.id}>
        {current.render()}
      </div>
    </PageContainer>
  );
}
