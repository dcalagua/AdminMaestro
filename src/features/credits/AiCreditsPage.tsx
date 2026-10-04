import { SectionTabs } from '@/components/ui/SectionTabs';
import { PageContainer } from '@/components/ui/primitives';
import { BalancesTab } from './BalancesTab';
import { LedgerTab } from './LedgerTab';
import { WeightsTab } from './WeightsTab';
import { PoliciesTab } from './PoliciesTab';
import { OperationsTab } from './OperationsTab';
import { CreditCatalogTab } from './CreditCatalogTab';

/**
 * «Créditos IA» (CCP M4, spec §5.2). Saldos y ledger append-only; pesos,
 * políticas, operaciones y catálogo son decisiones de finanzas (D-02…D-04).
 * Nada se siembra: lo no decidido se muestra «No decidido (D-xx)».
 */
export function AiCreditsPage() {
  return (
    <PageContainer
      title="Créditos IA"
      description="La unidad comercial de la IA es el crédito EBIM. Se consume al finalizar los agregados de uso de cada capacidad, según su peso vigente y la política del plan o add-on."
    >
      <SectionTabs
        tabs={[
          { id: 'balances', label: 'Saldos', content: <BalancesTab /> },
          { id: 'ledger', label: 'Movimientos', content: <LedgerTab /> },
          { id: 'weights', label: 'Pesos', content: <WeightsTab /> },
          { id: 'policies', label: 'Políticas', content: <PoliciesTab /> },
          { id: 'operations', label: 'Operaciones', content: <OperationsTab /> },
          { id: 'catalog', label: 'Catálogo', content: <CreditCatalogTab /> },
        ]}
      />
    </PageContainer>
  );
}
