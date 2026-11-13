import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { CaretDownIcon } from '@phosphor-icons/react';
import { nextTabIndex } from './tabKeys';
import { useIsMobile } from '@/hooks/useMediaQuery';

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

  const select = (id: string) => {
    requested.current = null;
    setActive(id);
    window.location.hash = id;
  };

  return (
    <div>
      <TabStrip tabs={visible} activeId={current?.id} onSelect={select} label="Secciones" />
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

/**
 * Fila de pestañas centradas compartida por `SectionTabs` (deep-link por
 * `#hash`) y `RouteTabs` (deep-link por `?tab=`). Roving tabindex: sólo la
 * activa está en el orden de Tab; flechas, Home y End cambian de pestaña.
 */
export function TabStrip({
  tabs,
  activeId,
  onSelect,
  label,
  idPrefix = 'tab',
  panelPrefix = 'panel',
}: {
  tabs: Array<Pick<TabDefinition, 'id' | 'label' | 'count'>>;
  /** Sin pestaña activa (p. ej. se pidió una que el rol no ve), la primera queda enfocable. */
  activeId: string | undefined;
  onSelect: (id: string) => void;
  label: string;
  idPrefix?: string;
  panelPrefix?: string;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const mobile = useIsMobile();

  // Con más pestañas de las que caben, la activa (p. ej. al entrar por enlace) se
  // desplaza a la vista dentro de la fila, sin mover la página.
  const activeIndex = tabs.findIndex((t) => t.id === activeId);
  const focusIndex = Math.max(0, activeIndex);
  useEffect(() => {
    const box = scroller.current;
    const button = buttons.current[activeIndex];
    if (!box || !button || box.scrollWidth <= box.clientWidth) return;
    const left = button.offsetLeft; // el contenedor es `relative`: offset respecto de la fila
    if (left < box.scrollLeft || left + button.offsetWidth > box.scrollLeft + box.clientWidth) {
      box.scrollLeft = Math.max(0, left - 24);
    }
  }, [activeIndex]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = nextTabIndex(e.key, index, tabs.length);
    if (target === null) return;
    e.preventDefault();
    onSelect(tabs[target]!.id);
    buttons.current[target]?.focus();
  };

  // V6 · F5: en móvil, si la fila no cabe, un `select` en lugar de pestañas
  // recortadas por el borde (antes «uración y cobros»).
  if (mobile && !tabStripFits(tabs, typeof window === 'undefined' ? 390 : Math.min(window.innerWidth, 640))) {
    return (
      <div className="relative mb-4" data-tab-select>
        <select
          aria-label={label}
          className="ebim-input ebim-input-select h-10 text-compact font-semibold"
          value={activeId ?? tabs[0]?.id ?? ''}
          onChange={(e) => onSelect(e.target.value)}
        >
          {tabs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.count !== undefined ? `${t.label} (${t.count})` : t.label}
            </option>
          ))}
        </select>
        <CaretDownIcon size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
      </div>
    );
  }

  return (
    // Centradas (U-07). Si no caben, scroll horizontal en UNA fila (nunca
    // dos renglones, A08/A09): `w-max mx-auto` centra mientras sobra sitio.
    <div ref={scroller} className="relative mb-5 overflow-x-auto border-b border-border [scrollbar-width:thin]">
      <div role="tablist" aria-label={label} className="mx-auto flex w-max flex-nowrap gap-1">
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                buttons.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`${idPrefix}-${tab.id}`}
              aria-selected={isActive}
              aria-controls={isActive ? `${panelPrefix}-${tab.id}` : undefined}
              tabIndex={index === focusIndex ? 0 : -1}
              className={`-mb-px inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-4 text-compact font-semibold transition-colors duration-fast ease-out ${
                isActive
                  ? 'border-accent-deep text-accent-deep'
                  : 'border-transparent text-muted hover:border-border-strong hover:text-fg'
              }`}
              onClick={() => onSelect(tab.id)}
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
  );
}

/**
 * ¿La fila de pestañas cabe en `viewport` px (menos los 16 px de margen a cada
 * lado)? Estimación sin medir (evita un parpadeo): ~7.5 px por carácter de
 * `text-compact` semibold, 32 px de padding por pestaña y 26 px por contador.
 */
export function tabStripFits(tabs: Array<{ label: string; count?: number }>, viewport: number): boolean {
  const width = tabs.reduce((w, t) => w + t.label.length * 7.5 + 36 + (t.count !== undefined ? 26 : 0), 0);
  return width <= viewport - 32;
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
 * ¿El control segmentado cabe en una fila a 390 px? Más de 3 opciones, o más
 * de ~28 caracteres entre etiquetas y contadores, se parte en dos renglones.
 */
export function statusTabsFitMobile(options: Array<{ label: string; count?: number }>): boolean {
  const chars = options.reduce((n, o) => n + o.label.length + (o.count !== undefined ? String(o.count).length + 2 : 0), 0);
  return options.length <= 3 && chars <= 28;
}

/**
 * Tabs de ESTADO para listados (Todos / Activos / …).
 * El contrato prohíbe paneles de filtros multi-campo, pero permite estos tabs.
 *
 * V6 · F5: por debajo de `sm`, si no caben en una fila (`statusTabsFitMobile`),
 * se pintan como un `select` nativo con el mismo nombre accesible y los
 * contadores entre paréntesis.
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
  const mobile = useIsMobile();
  const current = Math.max(0, options.findIndex((o) => o.id === value));
  if (mobile && !statusTabsFitMobile(options)) {
    return (
      <div className="relative w-full" data-status-select>
        <select
          aria-label={label}
          className="ebim-input ebim-input-select h-9 text-compact font-semibold"
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.count !== undefined ? `${o.label} (${o.count})` : o.label}
            </option>
          ))}
        </select>
        <CaretDownIcon size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
      </div>
    );
  }
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
