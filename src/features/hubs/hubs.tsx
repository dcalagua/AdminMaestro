import { lazy } from 'react';
import { HubPage } from './HubPage';
import { HUB_PANELS } from './hubPanels';

/** Las entradas de la V5 que fusionan pantallas (plan §4); ver `hubPanels.ts`. */
export const AccountsHubPage = () => <HubPage to="/cuentas" panels={HUB_PANELS['/cuentas']!} />;
export const SalesTeamHubPage = () => <HubPage to="/sales-agents" panels={HUB_PANELS['/sales-agents']!} />;
export const AppsHubPage = () => <HubPage to="/apps" panels={HUB_PANELS['/apps']!} />;
export const CatalogHubPage = () => <HubPage to="/catalogo" panels={HUB_PANELS['/catalogo']!} />;
// «Emitir factura» es la acción primaria de Cobranza (V5 · F4); se carga en diferido.
const IssueInvoiceAction = lazy(() =>
  import('@/features/billing/IssueInvoiceDialog').then((m) => ({ default: m.IssueInvoiceAction })),
);
export const CollectionsHubPage = () => (
  <HubPage to="/cobranza" panels={HUB_PANELS['/cobranza']!} actions={<IssueInvoiceAction />} />
);
export const CommissionsHubPage = () => <HubPage to="/commissions" panels={HUB_PANELS['/commissions']!} />;
export const SettingsHubPage = () => <HubPage to="/settings" panels={HUB_PANELS['/settings']!} />;
