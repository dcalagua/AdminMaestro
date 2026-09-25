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

  // Si la pestaña activa desaparece (por permisos), se cae a la primera visible.
  useEffect(() => {
    if (visible.length > 0 && !visible.some((t) => t.id === active)) {
      setActive(visible[0]!.id);
    }
  }, [visible, active]);

  const current = visible.find((t) => t.id === active) ?? visible[0];
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (id: string) => {
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
      <div className="mb-4 flex justify-center overflow-x-auto border-b border-border">
        <div role="tablist" aria-label="Secciones" className="flex flex-nowrap justify-center gap-1 sm:flex-wrap">
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
                className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                  isActive
                    ? 'border-accent text-accent-deep'
                    : 'border-transparent text-muted hover:text-fg'
                }`}
                onClick={() => select(tab.id)}
                onKeyDown={(e) => onKeyDown(e, index)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
      {current ? (
        <div role="tabpanel" id={`panel-${current.id}`} aria-labelledby={`tab-${current.id}`} tabIndex={0}>
          {current.content}
        </div>
      ) : null}
    </div>
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
}: {
  options: Array<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const current = Math.max(0, options.findIndex((o) => o.id === value));
  return (
    <div role="tablist" aria-label="Filtro de estado" className="flex flex-wrap gap-1">
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
            className={`rounded-field px-3 py-1.5 text-[13px] font-semibold transition-colors ${
              isActive
                ? 'bg-accent-soft text-accent-deep'
                : 'text-muted hover:bg-[color:var(--bg)] hover:text-fg'
            }`}
            onClick={() => onChange(opt.id)}
          >
            {opt.label}
            {opt.count !== undefined ? (
              <span className="ml-1.5 tabular-nums opacity-70">{opt.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
