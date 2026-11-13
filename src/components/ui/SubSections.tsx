import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { StatusTabs, type TabDefinition } from './SectionTabs';
import { nextTabIndex } from './tabKeys';
import { useMediaQuery } from '@/hooks/useMediaQuery';

/**
 * V6 · principio 6 · «Un solo nivel de pestañas»: el segundo nivel de una
 * pantalla que ya vive bajo las pestañas del hub (Configuración › Créditos IA,
 * Cobranza › Facturación, Comisiones) deja de ser otra fila de pestañas
 * subrayadas.
 *
 * - `segmented`: control segmentado (`StatusTabs`), alineado a la izquierda;
 *   `aside` va a su derecha (una nota corta, un enlace).
 * - `side`: lista vertical a la izquierda desde 1024 px (General); en móvil,
 *   el mismo control segmentado.
 *
 * Conserva el contrato de `SectionTabs`: deep-link por `#hash` (los enlaces
 * viejos como `#ledger` o `#profile` siguen abriendo su sección), roving
 * tabindex y flechas, Inicio y Fin. Al elegir, el `#hash` se reescribe con
 * `history.replaceState` (sin salto de scroll ni entrada nueva en el historial).
 *
 * V6 · F5: une el `SubSections` de Configuración y el `SegmentedSections` de
 * Finanzas, que eran el mismo patrón.
 */
export function SubSections({
  tabs,
  label,
  layout = 'segmented',
  aside,
}: {
  tabs: TabDefinition[];
  /** Nombre accesible del grupo de secciones. */
  label: string;
  layout?: 'segmented' | 'side';
  /** Contenido a la derecha del control segmentado. */
  aside?: ReactNode;
}) {
  const visible = tabs.filter((t) => !t.hidden);
  // Un solo tablist en el DOM: lista lateral desde 1024 px, segmentado por debajo.
  const wide = useMediaQuery('(min-width: 1024px)');
  const [active, setActive] = useState(() => {
    const fromHash = window.location.hash.replace('#', '');
    return visible.some((t) => t.id === fromHash) ? fromHash : (visible[0]?.id ?? '');
  });

  useEffect(() => {
    const onHashChange = () => {
      const next = window.location.hash.replace('#', '');
      if (visible.some((t) => t.id === next)) setActive(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [visible]);

  useEffect(() => {
    if (visible.length > 0 && !visible.some((t) => t.id === active)) setActive(visible[0]!.id);
  }, [visible, active]);

  const select = (id: string) => {
    setActive(id);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${id}`);
  };
  const current = visible.find((t) => t.id === active) ?? visible[0];

  const panel = current ? (
    <div role="tabpanel" aria-label={current.label} tabIndex={0} className="min-w-0 rounded-card focus-visible:outline-offset-4">
      {current.content}
    </div>
  ) : null;

  if (layout === 'side' && wide) {
    return (
      <div className="grid grid-cols-[200px_minmax(0,1fr)] items-start gap-6" data-sub-sections="side">
        <SideNav label={label} tabs={visible} activeId={current?.id} onSelect={select} />
        {panel}
      </div>
    );
  }

  return (
    <div data-sub-sections="segmented">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <StatusTabs
          label={label}
          options={visible.map((t) => ({ id: t.id, label: t.label, count: t.count }))}
          value={current?.id ?? ''}
          onChange={select}
        />
        {aside}
      </div>
      {panel}
    </div>
  );
}

/** Lista vertical (≥1024 px): la sección activa con barra de acento a la izquierda. */
function SideNav({
  label,
  tabs,
  activeId,
  onSelect,
}: {
  label: string;
  tabs: TabDefinition[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const current = Math.max(0, tabs.findIndex((t) => t.id === activeId));
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const key = e.key === 'ArrowDown' ? 'ArrowRight' : e.key === 'ArrowUp' ? 'ArrowLeft' : e.key;
    const target = nextTabIndex(key, index, tabs.length);
    if (target === null) return;
    e.preventDefault();
    onSelect(tabs[target]!.id);
    buttons.current[target]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} aria-orientation="vertical" className="sticky top-20 flex flex-col gap-0.5">
      {tabs.map((t, index) => {
        const isActive = t.id === activeId;
        return (
          <button
            key={t.id}
            ref={(el) => {
              buttons.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={index === current ? 0 : -1}
            onKeyDown={(e) => onKeyDown(e, index)}
            onClick={() => onSelect(t.id)}
            className={`flex h-9 items-center rounded-md border-l-2 px-3 text-left text-compact font-semibold transition-colors duration-fast ${
              isActive ? 'border-accent bg-accent-soft text-accent-deep' : 'border-transparent text-fg-2 hover:bg-hover hover:text-fg'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
