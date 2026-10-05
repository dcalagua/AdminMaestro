import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  type Icon,
  ArrowElbowDownLeftIcon,
  ArrowsClockwiseIcon,
  BuildingOfficeIcon,
  BuildingsIcon,
  MagnifyingGlassIcon,
} from '@phosphor-icons/react';
import { useModalFocus } from '@/components/ui/useModalFocus';
import { useOrganizations, useSubscriptions, useTenantOverview } from '@/services/queries';
import { SUBSCRIPTION_STATUS_LABEL } from '@/features/billing/subscriptionLabels';
import { PALETTE_GROUP_LIMIT, PALETTE_MIN_TERM, topMatches } from './commandSearch';
import type { NavItem } from './navigation';

/**
 * Paleta de comandos ⌘K / Ctrl+K (fase 06).
 *
 * «Ir a» filtra las entradas de menú que la persona ya ve (mismo `navItemsFor`
 * que el sidebar). Organizaciones, tenants y contratos reutilizan las consultas
 * de sus listados (misma caché, mismo RLS): solo se leen cuando hay un término
 * de 2+ caracteres y la persona tiene la pantalla de destino. Ocultar un grupo
 * es UX; lo que cada usuario puede leer lo decide RLS.
 */

export interface PaletteAccess {
  organizations: boolean;
  tenants: boolean;
  subscriptions: boolean;
}

interface PaletteOption {
  id: string;
  label: string;
  hint?: string;
  to: string;
  icon: Icon;
}

interface PaletteSection {
  key: string;
  label: string;
  options: PaletteOption[];
  /** Mensaje de estado del grupo (buscando / error). */
  status?: string;
}

const CAPABILITY_LABEL: Record<string, string> = {
  PARTNER: 'Partner',
  RESELLER: 'Reseller',
  CONSULTING: 'Consultora',
  CUSTOMER: 'Cliente',
};

function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function groupStatus(query: { isFetching: boolean; isError: boolean; data: unknown }, noun: string) {
  if (query.isError) return `No se pudo buscar en ${noun}.`;
  if (query.isFetching && !query.data) return `Buscando ${noun}…`;
  return undefined;
}

export function CommandPalette({
  items,
  access,
  onClose,
}: {
  /** Entradas de menú que la persona ya ve. */
  items: NavItem[];
  access: PaletteAccess;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const term = useDebounced(query.trim(), 200);
  const searching = term.length >= PALETTE_MIN_TERM;

  useModalFocus(panelRef, true, {
    initialFocus: () => inputRef.current,
    onEscape: onClose,
  });

  const orgs = useOrganizations({ enabled: searching && access.organizations });
  const tenants = useTenantOverview({ enabled: searching && access.tenants });
  const subs = useSubscriptions({ enabled: searching && access.subscriptions });

  const sections = useMemo<PaletteSection[]>(() => {
    const out: PaletteSection[] = [];
    const navMatches = topMatches(items, query.trim(), (i) => [i.label, i.group, i.to]);
    if (navMatches.length > 0) {
      out.push({
        key: 'nav',
        label: 'Ir a',
        options: navMatches.map((i) => ({ id: `nav:${i.to}`, label: i.label, hint: i.group, to: i.to, icon: i.icon })),
      });
    }
    if (!searching) return out;

    if (access.organizations) {
      const rows = topMatches(orgs.data ?? [], term, (o) => [o.display_name, o.legal_name, o.slug, o.tax_id]);
      out.push({
        key: 'org',
        label: 'Organizaciones',
        status: groupStatus(orgs, 'organizaciones'),
        options: rows.map((o) => {
          const caps = (o.organization_capabilities ?? []).map((c) => CAPABILITY_LABEL[c.capability] ?? c.capability);
          return {
            id: `org:${o.id}`,
            label: o.display_name,
            hint: [caps.join(', '), o.country_code].filter(Boolean).join(' · '),
            to: `/organizations/${o.id}`,
            icon: BuildingsIcon,
          };
        }),
      });
    }
    if (access.tenants) {
      const rows = topMatches(
        (tenants.data ?? []).filter((t) => t.tenant_id),
        term,
        (t) => [t.name, t.slug, t.customer_name, t.product_short_name],
      );
      out.push({
        key: 'tenant',
        label: 'Tenants',
        status: groupStatus(tenants, 'tenants'),
        options: rows.map((t) => ({
          id: `tenant:${t.tenant_id}`,
          label: t.name ?? t.slug ?? 'Tenant',
          hint: [t.customer_name, t.product_short_name].filter(Boolean).join(' · '),
          to: `/tenants/${t.tenant_id}`,
          icon: BuildingOfficeIcon,
        })),
      });
    }
    if (access.subscriptions) {
      const rows = topMatches(subs.data ?? [], term, (s) => [
        s.code,
        s.organizations?.display_name,
        s.tenants?.name,
        s.saas_products?.short_name,
      ]);
      out.push({
        key: 'sub',
        label: 'Contratos y suscripciones',
        status: groupStatus(subs, 'contratos'),
        options: rows.map((s) => ({
          id: `sub:${s.id}`,
          label: s.code,
          hint: [s.organizations?.display_name, s.saas_products?.short_name, SUBSCRIPTION_STATUS_LABEL[s.status] ?? s.status]
            .filter(Boolean)
            .join(' · '),
          to: `/subscriptions/${s.id}`,
          icon: ArrowsClockwiseIcon,
        })),
      });
    }
    return out.filter((s) => s.options.length > 0 || s.status);
  }, [items, query, term, searching, access, orgs, tenants, subs]);

  const flat = useMemo(() => sections.flatMap((s) => s.options), [sections]);
  const current = Math.min(active, Math.max(flat.length - 1, 0));
  const activeOption = flat[current];
  const optionId = (o: PaletteOption) => `${baseId}-${o.id}`;

  // Mantener visible la opción activa al moverse con el teclado.
  useEffect(() => {
    if (!activeOption) return;
    document.getElementById(`${baseId}-${activeOption.id}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeOption, baseId]);

  const go = (option: PaletteOption | undefined) => {
    if (!option) return;
    onClose();
    navigate(option.to);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + flat.length) % flat.length);
    } else if (e.key === 'Home' && flat.length > 0) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && flat.length > 0) {
      e.preventDefault();
      setActive(flat.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(activeOption);
    }
  };

  const listId = `${baseId}-list`;
  const pending = sections.some((s) => s.status && s.options.length === 0) || query.trim() !== term;
  let announcement: ReactNode = null;
  if (query.trim() && !pending) {
    announcement =
      flat.length === 0 ? `Sin resultados para «${query.trim()}»` : `${flat.length} resultado${flat.length === 1 ? '' : 's'}`;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <div className="ebim-scrim absolute inset-0" aria-hidden onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Buscar y navegar"
        data-command-palette
        className="ebim-dialog relative flex max-h-[min(560px,76vh)] w-full max-w-[640px] flex-col overflow-hidden"
      >
        <div className="flex items-center gap-3 border-b border-border px-4 focus-within:border-b-focus">
          <MagnifyingGlassIcon size={20} aria-hidden className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeOption ? optionId(activeOption) : undefined}
            aria-label="Buscar páginas, organizaciones, tenants o contratos"
            placeholder="Buscar páginas, organizaciones, tenants o contratos…"
            autoComplete="off"
            spellCheck={false}
            className="h-14 min-w-0 flex-1 bg-transparent text-body text-fg placeholder:text-muted focus:outline-none"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className="ebim-kbd hidden sm:inline-flex">Esc</kbd>
        </div>

        <div id={listId} role="listbox" aria-label="Resultados" className="min-h-0 flex-1 overflow-y-auto p-2">
          {sections.map((section) => {
            const headingId = `${baseId}-${section.key}`;
            return (
              <div key={section.key} role="group" aria-labelledby={headingId} className="pb-1">
                <div id={headingId} className="px-2.5 pb-1 pt-2 text-micro text-muted">
                  {section.label}
                </div>
                {section.options.map((o) => {
                  const isActive = activeOption?.id === o.id;
                  return (
                    <div
                      key={o.id}
                      id={optionId(o)}
                      role="option"
                      aria-selected={isActive}
                      className={`flex h-11 cursor-pointer items-center gap-3 rounded-md px-2.5 text-compact ${
                        isActive ? 'bg-accent-soft text-fg' : 'text-fg'
                      }`}
                      onMouseMove={() => {
                        if (!isActive) setActive(flat.indexOf(o));
                      }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => go(o)}
                    >
                      <o.icon
                        size={18}
                        weight={isActive ? 'fill' : 'regular'}
                        aria-hidden
                        className={`shrink-0 ${isActive ? 'text-accent-deep' : 'text-muted'}`}
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">{o.label}</span>
                      {o.hint ? <span className="hidden min-w-0 max-w-[50%] truncate text-caption text-muted sm:block">{o.hint}</span> : null}
                      {isActive ? <ArrowElbowDownLeftIcon size={14} aria-hidden className="shrink-0 text-muted" /> : null}
                    </div>
                  );
                })}
                {section.status && section.options.length < PALETTE_GROUP_LIMIT ? (
                  <div className="px-2.5 py-2 text-caption text-muted">{section.status}</div>
                ) : null}
              </div>
            );
          })}
          {flat.length === 0 && !pending ? (
            <p className="px-2.5 py-8 text-center text-compact text-muted">
              Sin resultados para «{query.trim()}». Prueba con el nombre, el código o el slug.
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-sunken px-4 py-2.5 text-caption text-muted">
          <span className="flex items-center gap-1.5">
            <kbd className="ebim-kbd">↑</kbd>
            <kbd className="ebim-kbd">↓</kbd>
            moverse
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="ebim-kbd">Enter</kbd>
            abrir
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="ebim-kbd">Esc</kbd>
            cerrar
          </span>
          {!searching ? <span className="ml-auto hidden sm:inline">Escribe 2 letras para buscar clientes, tenants y contratos</span> : null}
        </div>
        <div role="status" className="sr-only">
          {announcement}
        </div>
      </div>
    </div>
  );
}
