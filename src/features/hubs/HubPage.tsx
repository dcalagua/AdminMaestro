import { Suspense, type ComponentType, type ReactNode } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { Card, EmptyState, LoadingState, PageContainer } from '@/components/ui/primitives';
import { TabStrip } from '@/components/ui/SectionTabs';
import { EmbeddedPageContext } from '@/components/ui/pageTrail';
import { findNavItem, visibleTabs } from '@/app/navigation';
import { useNavAccess } from '@/app/useNavAccess';

/**
 * Pantalla con pestañas de la V5 (F1): fusiona varias pantallas antiguas en una
 * sola entrada de menú (Cobranza = Facturación + Renovaciones + Conciliación…).
 *
 * - Las pestañas, sus etiquetas y quién ve cada una salen de `navigation.ts`
 *   (fuente única con el menú y ⌘K). Una pestaña que el rol no veía como
 *   pantalla tampoco aparece aquí; además, RLS decide los datos.
 * - Deep-link por `?tab=`: el `#hash` queda libre para las pestañas internas de
 *   cada pantalla (p. ej. `/apps?tab=uso#aggregates`). Cambiar de pestaña limpia
 *   los filtros de la anterior.
 * - Cada pantalla se pinta «incrustada»: sin repetir migas ni `h1`.
 * - `actions`: la acción primaria de la entrada (p. ej. «Emitir factura» en
 *   Cobranza), visible en todas sus pestañas.
 */
export type HubPanels = Record<string, ComponentType>;

export function HubPage({ to, panels, actions }: { to: string; panels: HubPanels; actions?: ReactNode }) {
  const item = findNavItem(to);
  const access = useNavAccess();
  const [params, setParams] = useSearchParams();

  if (!item?.tabs) return <Navigate to="/404" replace />;
  if (access.loading) return <LoadingState variant="page" />;

  const tabs = visibleTabs(item, access).filter((t) => panels[t.id]);
  const requested = params.get('tab');
  const requestedTab = requested ? item.tabs.find((t) => t.id === requested) : undefined;
  // Sin `?tab=` o con uno desconocido, la primera pestaña visible.
  const current = requestedTab ? tabs.find((t) => t.id === requestedTab.id) : tabs[0];
  // Se pidió una pestaña que existe pero este rol no ve: se dice, no se disimula.
  const denied = Boolean(requestedTab && !current);
  const Panel = current ? panels[current.id] : undefined;

  const select = (id: string) => {
    if (id === current?.id) return;
    setParams(new URLSearchParams({ tab: id }), { preventScrollReset: true });
  };

  return (
    <PageContainer
      title={item.label}
      description={item.description}
      actions={
        actions && tabs.length > 0 ? <Suspense fallback={null}>{actions}</Suspense> : undefined
      }
    >
      {tabs.length === 0 ? (
        <NoAccess />
      ) : (
        <>
          {tabs.length > 1 ? (
            <TabStrip
              tabs={tabs}
              activeId={current?.id}
              onSelect={select}
              label={item.label}
              idPrefix="hub-tab"
              panelPrefix="hub-panel"
            />
          ) : null}
          {denied ? (
            <NoAccess section={requestedTab!.label} />
          ) : current && Panel ? (
            <div
              key={current.id}
              role={tabs.length > 1 ? 'tabpanel' : undefined}
              id={`hub-panel-${current.id}`}
              aria-labelledby={tabs.length > 1 ? `hub-tab-${current.id}` : undefined}
            >
              <EmbeddedPageContext.Provider value>
                <Suspense fallback={<LoadingState label={`Cargando ${current.label.toLowerCase()}…`} />}>
                  <Panel />
                </Suspense>
              </EmbeddedPageContext.Provider>
            </div>
          ) : null}
        </>
      )}
    </PageContainer>
  );
}

function NoAccess({ section }: { section?: string }) {
  return (
    <Card>
      <EmptyState
        title={section ? `Tu rol no tiene acceso a «${section}»` : 'Tu rol no tiene acceso a esta sección'}
        description="Si crees que deberías verla, pídele al equipo de plataforma EBIM que revise tus permisos. El contenido está protegido en la base de datos, no sólo en el menú."
      />
    </Card>
  );
}

/**
 * Ruta anterior a la V5: redirige a su nueva casa con la pestaña correcta,
 * conservando el resto de la consulta (`?estado=OPEN`) y el `#hash`.
 */
export function LegacyRedirect({ to, tab }: { to: string; tab: string }): ReactNode {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  search.delete('tab');
  const query = new URLSearchParams({ tab });
  search.forEach((value, key) => query.append(key, value));
  return <Navigate replace to={{ pathname: to, search: `?${query.toString()}`, hash: location.hash }} />;
}
