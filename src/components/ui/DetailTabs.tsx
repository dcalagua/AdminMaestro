import { useEffect } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { TabStrip, type TabDefinition } from './SectionTabs';
import { resolveDetailTab, type LegacyTabMap } from './detailTabRouting';

/**
 * Pestañas de una ficha (cuenta, tenant) con deep-link por `?tab=` (V5 · F3).
 *
 * - Los enlaces anteriores (`#hash` o `?tab=` de las pestañas que ya no
 *   existen) redirigen con `replace` a la pestaña nueva; el nombre viejo queda
 *   como `#ancla` y la vista baja a esa sección cuando aparece.
 * - El `#hash` queda libre para anclas de sección dentro de la pestaña.
 * - Una pestaña oculta por permisos no se muestra aunque se pida: se abre la
 *   primera visible. RLS sigue siendo la autoridad sobre los datos.
 */
export function DetailTabs({
  tabs,
  legacy = {},
  label = 'Secciones',
}: {
  tabs: TabDefinition[];
  legacy?: LegacyTabMap;
  label?: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const visible = tabs.filter((t) => !t.hidden);
  const resolution = resolveDetailTab(
    tabs.map((t) => t.id),
    legacy,
    params.get('tab'),
    location.hash,
  );
  const wanted = resolution.kind === 'show' ? resolution.tab : null;
  const current = visible.find((t) => t.id === wanted) ?? visible[0];
  const anchor = location.hash.replace(/^#/, '');

  // Lleva la vista a la sección del ancla en cuanto existe (los datos llegan después).
  useEffect(() => {
    if (resolution.kind !== 'show' || !anchor) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(anchor);
      tries += 1;
      if (el) {
        el.scrollIntoView?.({ block: 'start' });
        window.clearInterval(timer);
      } else if (tries > 30) {
        window.clearInterval(timer);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [anchor, current?.id, resolution.kind]);

  if (resolution.kind === 'redirect') {
    const search = new URLSearchParams(location.search);
    search.set('tab', resolution.tab);
    return (
      <Navigate
        replace
        state={location.state}
        to={{ pathname: location.pathname, search: `?${search.toString()}`, hash: resolution.anchor ? `#${resolution.anchor}` : '' }}
      />
    );
  }

  const select = (id: string) => {
    if (id === current?.id) return;
    navigate({ pathname: location.pathname, search: `?tab=${encodeURIComponent(id)}` }, { preventScrollReset: true });
  };

  return (
    <div>
      <TabStrip tabs={visible} activeId={current?.id} onSelect={select} label={label} />
      {current ? (
        <div
          key={current.id}
          role="tabpanel"
          id={`panel-${current.id}`}
          aria-labelledby={`tab-${current.id}`}
          tabIndex={0}
          className="rounded-card focus-visible:outline-offset-4"
        >
          {current.content}
        </div>
      ) : null}
    </div>
  );
}
