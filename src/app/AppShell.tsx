import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import {
  CaretDoubleLeftIcon,
  CaretDoubleRightIcon,
  CaretDownIcon,
  CaretRightIcon,
  ListIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  SunIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useAuth } from '@/hooks/useAuth';
import { useAppearance } from '@/hooks/useAppearance';
import { hasFinanceView, navGroupsFor, routeMeta, type NavGroup, type NavItem } from './navigation';
import { EbimMark } from '@/components/ui/EbimMark';
import { useModalFocus } from '@/components/ui/useModalFocus';
import { PageTrailContext } from '@/components/ui/pageTrail';
import type { Crumb } from '@/components/ui/primitives';
import { useCriticalBillingAlertCount } from '@/services/queries';
import { PLATFORM_ROLE_LABEL, ORG_ROLE_LABEL } from '@/types/domain';
import { env } from '@/lib/env';
import { AccountMenu } from './AccountMenu';
import { CommandPalette, type PaletteAccess } from './CommandPalette';

/**
 * Shell administrativo (fase 06, spec §3.2 y U-11).
 *
 * Sidebar: gradiente teal de marca, lockup «Admin Maestro / BY EBIM» (U-02),
 * grupos con micro-label plegables, ítem activo con barra `--sidebar-indicator`
 * + fondo, reducible a iconos (con tooltip) y estado guardado en localStorage.
 *
 * Topbar: tratamiento (A) NEUTRO — `var(--card)` + borde. Buscador global ⌘K /
 * Ctrl+K, entorno según `VITE_APP_ENV` (nunca inferido de la rama), tema y
 * menú de cuenta. Las migas viven en el encabezado de página (`PageContainer`)
 * y el foco va al `h1` al cambiar de ruta.
 *
 * El menú se adapta al rol, pero es UX: cada ruta tiene su guard y cada consulta
 * su RLS.
 */

const RAIL_KEY = 'ebim-cp-sidebar-rail';
const COLLAPSED_KEY = 'ebim-cp-nav-collapsed';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin storage: dura la sesión */
  }
}

const ENV_LABEL: Record<string, string> = {
  LOCAL: 'Entorno local',
  DEV: 'Desarrollo',
  QAS: 'QAS · pruebas',
  PRD: 'Producción',
};

/** Cada entorno no productivo con su color; producción, discreto. */
const ENV_STYLE: Record<string, string> = {
  LOCAL: 'bg-info-soft text-info',
  DEV: 'bg-accent-soft text-accent-deep',
  QAS: 'bg-warn-soft text-warn',
  PRD: 'text-muted',
};

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

interface NavBadge {
  count: number;
  /** Texto para lectores de pantalla y tooltip. */
  label: string;
}

export function AppShell() {
  const { roles, persona, signOut } = useAuth();
  const { mode, density, toggleMode, setDensity } = useAppearance();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [rail, setRail] = useState<boolean>(() => readJson(RAIL_KEY, false));
  const [collapsed, setCollapsed] = useState<Partial<Record<NavGroup, boolean>>>(() =>
    readJson(COLLAPSED_KEY, {}),
  );
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  const finance = hasFinanceView(persona, roles);
  const groups = useMemo(() => navGroupsFor(persona, { finance }), [persona, finance]);
  const items = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const meta = routeMeta(location.pathname);
  const has = (to: string) => items.some((i) => i.to === to);

  // Badges solo con un conteo barato (head: true) y solo si la pantalla se ve.
  const criticalAlerts = useCriticalBillingAlertCount({ enabled: has('/renewals') });
  const badges: Record<string, NavBadge> = {};
  if (criticalAlerts.data) {
    const n = criticalAlerts.data;
    badges['/renewals'] = { count: n, label: `${n} alerta${n === 1 ? '' : 's'} crítica${n === 1 ? '' : 's'} abierta${n === 1 ? '' : 's'}` };
  }

  const paletteAccess = useMemo<PaletteAccess>(() => {
    const visible = new Set(items.map((i) => i.to));
    return {
      organizations: visible.has('/organizations') || visible.has('/customers'),
      tenants: visible.has('/tenants'),
      subscriptions: visible.has('/subscriptions'),
    };
  }, [items]);

  // Migas de contexto para `PageContainer`: grupo y, en fichas, el listado.
  const trail = useMemo<Crumb[]>(() => {
    const out: Crumb[] = [];
    if (meta.group && meta.group !== 'Inicio') out.push({ label: meta.group });
    if (meta.isDetail && meta.section) out.push({ label: meta.section.label, to: meta.section.to });
    return out;
  }, [meta.group, meta.isDetail, meta.section]);

  useEffect(() => {
    document.title = `${meta.title} · Admin Maestro · EBIM`;
  }, [meta.title]);

  // Al navegar, el panel móvil y el tooltip se cierran.
  const [lastPath, setLastPath] = useState(location.pathname);
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    setMobileOpen(false);
    setTip(null);
  }

  // Foco al h1 de la página nueva (§5.13): el lector de pantalla anuncia dónde
  // está. No en la carga inicial ni si el usuario ya entró al contenido. Las
  // rutas perezosas pintan el h1 después: se espera hasta 3 s.
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    const main = mainRef.current;
    if (!main) return;
    let observer: MutationObserver | null = null;
    let timer = 0;
    const focusTitle = () => {
      const active = document.activeElement;
      if (active && active !== document.body && main.contains(active)) return true;
      const h1 = main.querySelector<HTMLElement>('h1');
      if (!h1) return false;
      if (!h1.hasAttribute('tabindex')) h1.tabIndex = -1;
      h1.focus();
      return true;
    };
    const raf = requestAnimationFrame(() => {
      if (focusTitle()) return;
      observer = new MutationObserver(() => {
        if (focusTitle()) observer?.disconnect();
      });
      observer.observe(main, { childList: true, subtree: true });
      timer = window.setTimeout(() => observer?.disconnect(), 3000);
    });
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.clearTimeout(timer);
    };
  }, [location.pathname]);

  // ⌘K / Ctrl+K abre (o cierra) la paleta; no encima de otro diálogo modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || String(e.key).toLowerCase() !== 'k') return;
      if (document.querySelector('[aria-modal="true"]:not([data-command-palette])')) return;
      e.preventDefault();
      setPaletteOpen((open) => !open);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useModalFocus(panelRef, mobileOpen, {
    onEscape: () => setMobileOpen(false),
    returnFocus: () => openerRef.current,
  });

  const roleLabel = roles?.platformRole
    ? PLATFORM_ROLE_LABEL[roles.platformRole]
    : roles?.organizations[0]
      ? `${ORG_ROLE_LABEL[roles.organizations[0].role]} · ${roles.organizations[0].displayName}`
      : roles?.salesAgentId
        ? 'Comercial'
        : roles?.provisioningRoles.length || roles?.ownedProductIds.length
          ? 'Operación técnica EBIM'
          : 'Usuario de tenant';

  const toggleGroup = (group: NavGroup) => {
    setCollapsed((current) => {
      const next = { ...current, [group]: !current[group] };
      writeJson(COLLAPSED_KEY, next);
      return next;
    });
  };

  const toggleRail = () => {
    setTip(null);
    setRail((current) => {
      writeJson(RAIL_KEY, !current);
      return !current;
    });
  };

  // Tooltip del modo iconos: `fixed` para no quedar recortado por el scroll del sidebar.
  const showTip = (e: SyntheticEvent<HTMLElement>, label: string) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2, left: r.right + 12 });
  };
  const tipHandlers = (compact: boolean, label: string) =>
    compact
      ? {
          onMouseEnter: (e: SyntheticEvent<HTMLElement>) => showTip(e, label),
          onFocus: (e: SyntheticEvent<HTMLElement>) => showTip(e, label),
          onMouseLeave: () => setTip(null),
          onBlur: () => setTip(null),
        }
      : {};

  const renderItem = (item: NavItem, compact: boolean) => {
    const badge = badges[item.to];
    const name = badge ? `${item.label} (${badge.label})` : item.label;
    return (
      <li key={item.to}>
        <NavLink
          to={item.to}
          end={item.to === '/'}
          aria-label={compact || badge ? name : undefined}
          {...tipHandlers(compact, name)}
          className={({ isActive }) =>
            `relative flex items-center rounded-field text-compact transition-colors duration-fast ease-out ${
              compact ? 'mx-auto h-10 w-11 justify-center' : 'h-9 gap-3 px-3'
            } ${
              isActive
                ? 'bg-white/[.14] font-semibold text-white'
                : 'font-medium text-white/[.86] hover:bg-white/10 hover:text-white'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive ? (
                <span
                  aria-hidden
                  className={`absolute top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[color:var(--sidebar-indicator)] ${
                    compact ? '-left-[16px]' : '-left-3'
                  }`}
                />
              ) : null}
              <span className="relative shrink-0">
                <item.icon size={compact ? 20 : 18} weight={isActive ? 'fill' : 'regular'} aria-hidden />
                {compact && badge ? (
                  <span
                    aria-hidden
                    className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[color:var(--danger-fill)] ring-2 ring-[color:var(--sidebar-base)]"
                  />
                ) : null}
              </span>
              {compact ? null : <span className="min-w-0 flex-1 truncate">{item.label}</span>}
              {!compact && badge ? (
                <span
                  aria-hidden
                  title={badge.label}
                  className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[color:var(--danger-fill)] px-1.5 text-caption font-bold tabular-nums text-[color:var(--danger-fill-fg)]"
                >
                  {badge.count > 99 ? '99+' : badge.count}
                </span>
              ) : null}
            </>
          )}
        </NavLink>
      </li>
    );
  };

  const renderNav = (compact: boolean) => (
    <nav aria-label="Navegación principal" className={compact ? 'px-2 pb-6' : 'px-3 pb-6'}>
      {groups.map(({ group, items: groupItems }) => {
        const containsActive = meta.group === group;
        const isCollapsed = !compact && Boolean(collapsed[group]) && !containsActive;
        const listId = `nav-group-${group.replace(/\s+/g, '-')}`;
        return (
          <div key={group} className="mt-4 first:mt-0">
            {compact ? (
              <div className="mx-3 mb-2 border-t border-white/15" aria-hidden />
            ) : (
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md px-3 pb-1.5 pt-1 text-micro text-white/[.72] transition-colors duration-fast ease-out hover:text-white"
                aria-expanded={!isCollapsed}
                aria-controls={listId}
                onClick={() => toggleGroup(group)}
              >
                {group}
                {isCollapsed ? <CaretRightIcon size={12} aria-hidden /> : <CaretDownIcon size={12} aria-hidden />}
              </button>
            )}
            <ul id={listId} hidden={isCollapsed} className="space-y-0.5">
              {groupItems.map((item) => renderItem(item, compact))}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  const brand = (compact: boolean) => (
    <div className={`flex h-16 shrink-0 items-center gap-3 ${compact ? 'justify-center px-2' : 'px-5'}`}>
      <EbimMark size={compact ? 30 : 32} color="var(--on-brand)" animated />
      {compact ? null : (
        <div className="min-w-0 leading-none">
          <div className="truncate text-[18px] font-extrabold tracking-tight">Admin Maestro</div>
          <div className="mt-[4px] text-[9.5px] font-bold tracking-[0.22em] opacity-85">BY EBIM</div>
        </div>
      )}
    </div>
  );

  const railLabel = rail ? 'Expandir menú lateral' : 'Reducir menú lateral a iconos';

  return (
    <div className="flex min-h-screen bg-bg">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-field focus:bg-card focus:px-4 focus:py-2 focus:text-compact focus:font-semibold focus:text-fg focus:shadow-pop"
      >
        Saltar al contenido
      </a>

      {/* ---- Sidebar de escritorio: aquí vive la marca. El color base continúa
           el gradiente para que la columna no se corte en páginas largas. ---- */}
      <aside
        data-print-hide
        className={`ebim-on-brand hidden shrink-0 text-white transition-[width] duration-overlay ease-out lg:block ${
          rail ? 'w-[76px]' : 'w-[248px]'
        }`}
        style={{ background: 'var(--sidebar-base)' }}
      >
        <div className="sticky top-0 flex h-screen flex-col" style={{ background: 'var(--sidebar)' }}>
          {brand(rail)}
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-2" onScroll={() => setTip(null)}>
            {renderNav(rail)}
          </div>
          <div className={`shrink-0 border-t border-white/10 py-3 ${rail ? 'px-2' : 'px-3'}`}>
            <button
              type="button"
              className={`flex h-9 items-center rounded-field text-compact font-medium text-white/[.86] transition-colors duration-fast ease-out hover:bg-white/10 hover:text-white ${
                rail ? 'mx-auto w-11 justify-center' : 'w-full gap-3 px-3'
              }`}
              aria-label={railLabel}
              aria-pressed={rail}
              onClick={toggleRail}
              {...tipHandlers(rail, railLabel)}
            >
              {rail ? (
                <CaretDoubleRightIcon size={18} aria-hidden />
              ) : (
                <>
                  <CaretDoubleLeftIcon size={18} aria-hidden />
                  <span>Contraer menú</span>
                </>
              )}
            </button>
          </div>
        </div>
      </aside>

      {tip && rail ? (
        <div aria-hidden className="ebim-tooltip -translate-y-1/2" style={{ top: tip.top, left: tip.left }}>
          {tip.label}
        </div>
      ) : null}

      {/* ---- Menú móvil: panel modal; cerrado no existe en el DOM ---- */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            className="ebim-scrim absolute inset-0 h-full w-full"
            onClick={() => setMobileOpen(false)}
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menú de navegación"
            className="ebim-on-brand absolute inset-y-0 left-0 w-[min(86vw,300px)] overflow-y-auto text-white shadow-modal"
            style={{ background: 'var(--sidebar)' }}
          >
            <div className="flex items-center justify-between pr-2">
              {brand(false)}
              <button
                type="button"
                className="rounded-field p-2 text-white hover:bg-white/10"
                aria-label="Cerrar menú"
                onClick={() => setMobileOpen(false)}
              >
                <XIcon size={20} aria-hidden />
              </button>
            </div>
            <div className="pt-2">{renderNav(false)}</div>
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---- Topbar neutro (tratamiento A) ---- */}
        <header data-print-hide className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-card px-3 sm:gap-3 sm:px-6">
          <button
            ref={openerRef}
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-field border border-border text-fg lg:hidden"
            aria-label="Abrir menú"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
          >
            <ListIcon size={20} aria-hidden />
          </button>

          <button
            type="button"
            className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-field border border-border bg-sunken px-3 text-compact text-muted transition-colors duration-fast ease-out hover:border-border-strong hover:text-fg sm:max-w-[420px]"
            aria-label="Buscar y navegar"
            aria-haspopup="dialog"
            aria-keyshortcuts="Meta+K Control+K"
            onClick={() => setPaletteOpen(true)}
          >
            <MagnifyingGlassIcon size={18} aria-hidden className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">Buscar o ir a…</span>
            <kbd className="ebim-kbd hidden md:inline-flex">{IS_MAC ? '⌘K' : 'Ctrl K'}</kbd>
          </button>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <span
              className={`hidden shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold sm:inline-flex ${
                ENV_STYLE[env.appEnv] ?? ENV_STYLE.LOCAL
              }`}
              title="Entorno según la configuración de esta consola (VITE_APP_ENV)"
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
              {ENV_LABEL[env.appEnv] ?? env.appEnv}
            </span>

            <button
              type="button"
              onClick={toggleMode}
              className="ebim-icon-btn h-10 w-10"
              aria-label={mode === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}
              title={mode === 'light' ? 'Modo oscuro' : 'Modo claro'}
            >
              {mode === 'light' ? <MoonIcon size={20} aria-hidden /> : <SunIcon size={20} aria-hidden />}
            </button>

            <AccountMenu
              name={roles?.fullName ?? roles?.email ?? 'Sesión'}
              email={roles?.email ?? null}
              roleLabel={roleLabel}
              density={density}
              onDensity={setDensity}
              onSignOut={() => void signOut()}
            />
          </div>
        </header>

        <main id="contenido" ref={mainRef} tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
          <PageTrailContext.Provider value={trail}>
            {/* La clave reinicia solo la animación de entrada (opacidad, 120 ms). */}
            <div key={location.pathname} className="ebim-route-enter">
              <Outlet />
            </div>
          </PageTrailContext.Provider>
        </main>
      </div>

      {paletteOpen ? (
        <CommandPalette items={items} access={paletteAccess} onClose={() => setPaletteOpen(false)} />
      ) : null}
    </div>
  );
}
