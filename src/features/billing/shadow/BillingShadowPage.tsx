import { SectionTabs } from '@/components/ui/SectionTabs';
import { PageContainer } from '@/components/ui/primitives';
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
