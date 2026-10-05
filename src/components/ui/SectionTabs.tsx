import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { nextTabIndex } from './tabKeys';

/**
 * Tabs CENTRADOS con deep-link por `#hash` — contrato §8, regla `gmao-025`.
 *
 * Regla de suite: toda pantalla de configuración o detalle larga se organiza en
 * tabs centrados en vez de apilar formularios en scroll infinito. El `#hash`
 * hace que una pestaña concreta sea enlazable y sobreviva a un refresh.
 *
 * Teclado (E09): roving tabindex — sólo la pestaña activa está en el orden de
 * Tab; flechas, Home y End cambian de pestaña y actualizan el hash.
 */
export interface TabDefinition {
  id: string;
  label: string;
  content: ReactNode;
  /** Oculta la pestaña cuando el rol no debería verla. */
  hidden?: boolean;
  /** Contador opcional (pendientes, elementos) junto a la etiqueta. */
  count?: number;
}

export function SectionTabs({ tabs }: { tabs: TabDefinition[] }) {
  const visible = tabs.filter((t) => !t.hidden);
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

  // Deep-link a una pestaña que aún no es visible (depende de permisos que se
  // cargan después): se recuerda el #hash pedido y se abre cuando aparece,
  // salvo que la persona ya haya elegido otra pestaña.
  const requested = useRef<string | null>(window.location.hash.replace('#', '') || null);
  useEffect(() => {
    const want = requested.current;
    if (!want || !visible.some((t) => t.id === want)) return;
    requested.current = null;
    if (want !== active) setActive(want);
  }, [visible, active]);

  // Si la pestaña activa desaparece (por permisos), se cae a la primera visible.
  useEffect(() => {
    if (visible.length > 0 && !visible.some((t) => t.id === active)) {
      setActive(visible[0]!.id);
    }
  }, [visible, active]);

  const current = visible.find((t) => t.id === active) ?? visible[0];
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const scroller = useRef<HTMLDivElement>(null);

  // Con más pestañas de las que caben, la activa (p. ej. al entrar por #hash) se
  // desplaza a la vista dentro de la fila, sin mover la página.
  const activeIndex = visible.findIndex((t) => t.id === current?.id);
  useEffect(() => {
    const box = scroller.current;
    const button = buttons.current[activeIndex];
    if (!box || !button || box.scrollWidth <= box.clientWidth) return;
    const left = button.offsetLeft; // el contenedor es `relative`: offset respecto de la fila
    if (left < box.scrollLeft || left + button.offsetWidth > box.scrollLeft + box.clientWidth) {
      box.scrollLeft = Math.max(0, left - 24);
    }
  }, [activeIndex]);

  const select = (id: string) => {
    requested.current = null;
    setActive(id);
    window.location.hash = id;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = nextTabIndex(e.key, index, visible.length);
    if (target === null) return;
    e.preventDefault();
    select(visible[target]!.id);
    buttons.current[target]?.focus();
  };

  return (
    <div>
      {/* Centradas (U-07). Si no caben, scroll horizontal en UNA fila (nunca
          dos renglones, A08/A09): `w-max mx-auto` centra mientras sobra sitio. */}
      <div ref={scroller} className="relative mb-5 overflow-x-auto border-b border-border [scrollbar-width:thin]">
        <div role="tablist" aria-label="Secciones" className="mx-auto flex w-max flex-nowrap gap-1">
          {visible.map((tab, index) => {
            const isActive = tab.id === current?.id;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  buttons.current[index] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`panel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                className={`-mb-px inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-4 text-compact font-semibold transition-colors duration-fast ease-out ${
                  isActive
                    ? 'border-accent-deep text-accent-deep'
                    : 'border-transparent text-muted hover:border-border-strong hover:text-fg'
                }`}
                onClick={() => select(tab.id)}
                onKeyDown={(e) => onKeyDown(e, index)}
              >
                {tab.label}
                {/* El espacio separa etiqueta y contador en el nombre accesible («Pendientes 4»). */}
                {tab.count !== undefined ? <>{' '}<TabCount value={tab.count} active={isActive} /></> : null}
              </button>
            );
          })}
        </div>
      </div>
      {current ? (
        <div
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

/** Contador de pestaña: `text-caption` tabular en pastilla. */
function TabCount({ value, active }: { value: number; active: boolean }) {
  return (
    <span
      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-caption font-semibold tabular-nums ${
        active ? 'bg-accent-soft text-accent-deep' : 'bg-border text-fg-2'
      }`}
    >
      {value}
    </span>
  );
}

/**
 * Tabs de ESTADO para listados (Todos / Activos / …).
 * El contrato prohíbe paneles de filtros multi-campo, pero permite estos tabs.
 */
export function StatusTabs<T extends string>({
  options,
  value,
  onChange,
  label = 'Filtro de estado',
}: {
  options: Array<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  /** Nombre accesible del grupo. */
  label?: string;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const current = Math.max(0, options.findIndex((o) => o.id === value));
  return (
    // Control segmentado (§5.8): pozo --sunken, pestaña activa elevada sobre --card.
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex max-w-full flex-wrap gap-1 rounded-field border border-border bg-sunken p-1"
    >
      {options.map((opt, index) => {
        const isActive = opt.id === value;
        return (
          <button
            key={opt.id}
            ref={(el) => {
              buttons.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={index === current ? 0 : -1}
            onKeyDown={(e) => {
              const target = nextTabIndex(e.key, index, options.length);
              if (target === null) return;
              e.preventDefault();
              onChange(options[target]!.id);
              buttons.current[target]?.focus();
            }}
            className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-compact font-semibold transition-colors duration-fast ease-out ${
              isActive ? 'bg-card text-fg shadow-card ring-1 ring-border' : 'text-muted hover:text-fg'
            }`}
            onClick={() => onChange(opt.id)}
          >
            {opt.label}
            {opt.count !== undefined ? <>{' '}<TabCount value={opt.count} active={isActive} /></> : null}
          </button>
        );
      })}
    </div>
  );
}
