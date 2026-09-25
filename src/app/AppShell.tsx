import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import {
  CaretDownIcon,
  CaretRightIcon,
  ListIcon,
  MoonIcon,
  SidebarSimpleIcon,
  SignOutIcon,
  SunIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useAuth } from '@/hooks/useAuth';
import { useAppearance } from '@/hooks/useAppearance';
import { hasFinanceView, navGroupsFor, routeMeta, type NavGroup } from './navigation';
import { EbimMark } from '@/components/ui/EbimMark';
import { useModalFocus } from '@/components/ui/useModalFocus';
import { PLATFORM_ROLE_LABEL, ORG_ROLE_LABEL } from '@/types/domain';
import { env } from '@/lib/env';

/**
 * Shell administrativo.
 *
 * Topbar: tratamiento (A) NEUTRO del contrato §4.4 — `var(--card)` + borde, con
 * la marca viviendo sólo en el sidebar. El contrato admite exactamente dos
 * tratamientos y prohíbe inventar un tercero con un tinte arbitrario del accent.
 *
 * Spec §5.1: grupos plegables, sidebar reducible a iconos en escritorio, menú
 * móvil como panel modal (foco confinado, Escape, sin capa invisible), migas y
 * título humano en lugar de `location.pathname`, y entorno tomado de la
 * configuración (`VITE_APP_ENV`), nunca inferido del nombre de la rama.
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

export function AppShell() {
  const { roles, persona, signOut } = useAuth();
  const { mode, density, toggleMode, setDensity } = useAppearance();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [rail, setRail] = useState<boolean>(() => readJson(RAIL_KEY, false));
  const [collapsed, setCollapsed] = useState<Partial<Record<NavGroup, boolean>>>(() =>
    readJson(COLLAPSED_KEY, {}),
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  const finance = hasFinanceView(persona, roles);
  const groups = navGroupsFor(persona, { finance });
  const meta = routeMeta(location.pathname);

  useEffect(() => {
    document.title = `${meta.title} · EBIM Control Plane`;
  }, [meta.title]);

  // Al navegar, el panel móvil se cierra (el foco vuelve al botón de menú).
  const [lastPath, setLastPath] = useState(location.pathname);
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    setMobileOpen(false);
  }

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
    setRail((current) => {
      writeJson(RAIL_KEY, !current);
      return !current;
    });
  };

  const renderNav = (compact: boolean) => (
    <nav aria-label="Navegación principal" className="px-3 pb-8">
      {groups.map(({ group, items }) => {
        const containsActive = meta.group === group;
        const isCollapsed = !compact && Boolean(collapsed[group]) && !containsActive;
        const listId = `nav-group-${group.replace(/\s+/g, '-')}`;
        return (
          <div key={group} className="mb-3">
            {compact ? (
              <div className="mx-2 my-2 border-t border-white/20" aria-hidden />
            ) : (
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md px-2 pb-1.5 pt-1 text-[10.5px] font-bold uppercase tracking-wider text-white/85 hover:text-white"
                aria-expanded={!isCollapsed}
                aria-controls={listId}
                onClick={() => toggleGroup(group)}
              >
                {group}
                {isCollapsed ? <CaretRightIcon size={12} aria-hidden /> : <CaretDownIcon size={12} aria-hidden />}
              </button>
            )}
            <ul id={listId} hidden={isCollapsed} className="space-y-0.5">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    title={compact ? item.label : undefined}
                    aria-label={compact ? item.label : undefined}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-field px-2.5 py-2 text-[13.5px] font-medium transition-colors ${
                        compact ? 'justify-center' : ''
                      } ${
                        isActive
                          ? 'bg-white/20 font-semibold text-white shadow-[inset_3px_0_0_#ffffff]'
                          : 'text-white/95 hover:bg-white/10 hover:text-white'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon size={18} weight={isActive ? 'fill' : 'regular'} aria-hidden className="shrink-0" />
                        {compact ? null : <span className="min-w-0 truncate">{item.label}</span>}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  const brand = (compact: boolean) => (
    <div className={`flex items-center gap-3 pb-6 pt-6 ${compact ? 'justify-center px-2' : 'px-5'}`}>
      <EbimMark size={34} color="#FFFFFF" animated />
      {compact ? null : (
        <div className="leading-none">
          <div className="text-[17px] font-extrabold tracking-tight">Control Plane</div>
          <div className="mt-[4px] text-[9px] font-bold tracking-[0.22em] text-white/85">BY EBIM</div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen bg-bg">
      {/* ---- Sidebar de escritorio: aquí vive la marca ---- */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 overflow-y-auto overflow-x-hidden text-white lg:block ${
          rail ? 'w-[76px]' : 'w-[248px]'
        }`}
        style={{ background: 'var(--sidebar)' }}
      >
        {brand(rail)}
        {renderNav(rail)}
      </aside>

      {/* ---- Menú móvil: panel modal; cerrado no existe en el DOM ---- */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            className="absolute inset-0 h-full w-full bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menú de navegación"
            className="absolute inset-y-0 left-0 w-[min(86vw,300px)] overflow-y-auto text-white shadow-pop"
            style={{ background: 'var(--sidebar)' }}
          >
            <div className="flex items-start justify-between">
              {brand(false)}
              <button
                type="button"
                className="m-3 rounded-field p-2 text-white hover:bg-white/10"
                aria-label="Cerrar menú"
                onClick={() => setMobileOpen(false)}
              >
                <XIcon size={20} aria-hidden />
              </button>
            </div>
            {renderNav(false)}
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---- Topbar neutro (tratamiento A) ---- */}
        <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-border bg-card px-3 sm:gap-3 sm:px-4">
          <button
            ref={openerRef}
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-field border border-border text-fg lg:hidden"
            aria-label="Abrir menú"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
          >
            <ListIcon size={20} aria-hidden />
          </button>
          <button
            type="button"
            className="hidden h-9 w-9 items-center justify-center rounded-field border border-border text-muted hover:text-fg lg:inline-flex"
            aria-label={rail ? 'Expandir menú lateral' : 'Reducir menú lateral a iconos'}
            aria-pressed={rail}
            onClick={toggleRail}
          >
            <SidebarSimpleIcon size={18} aria-hidden />
          </button>

          <nav aria-label="Migas de pan" className="min-w-0 flex-1">
            <ol className="flex min-w-0 items-center gap-1.5 text-[13px]">
              {meta.group && meta.group !== 'Inicio' ? (
                <li className="hidden truncate text-muted md:block">{meta.group}</li>
              ) : null}
              {meta.section && meta.isDetail ? (
                <>
                  <li aria-hidden className="hidden text-muted md:block">/</li>
                  <li className="truncate">
                    <Link className="ebim-link font-medium" to={meta.section.to}>
                      {meta.section.label}
                    </Link>
                  </li>
                  <li aria-hidden className="text-muted">/</li>
                  <li className="truncate font-semibold text-fg" aria-current="page">
                    {meta.title}
                  </li>
                </>
              ) : (
                <>
                  {meta.group && meta.group !== 'Inicio' ? (
                    <li aria-hidden className="hidden text-muted md:block">/</li>
                  ) : null}
                  <li className="truncate font-semibold text-fg" aria-current="page">
                    {meta.title}
                  </li>
                </>
              )}
            </ol>
          </nav>

          <span
            className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold sm:inline ${
              env.appEnv === 'PRD' ? 'bg-accent-soft text-accent-deep' : 'bg-warn-soft text-warn'
            }`}
            title="Entorno según la configuración de esta consola (VITE_APP_ENV)"
          >
            {ENV_LABEL[env.appEnv] ?? env.appEnv}
          </span>

          <label className="hidden items-center gap-1.5 text-xs text-muted md:flex">
            <span className="sr-only">Densidad</span>
            <select
              className="rounded-field border border-border bg-card px-2 py-1.5 text-xs text-fg"
              value={density}
              onChange={(e) => setDensity(e.target.value as typeof density)}
              aria-label="Densidad de la interfaz"
            >
              <option value="comoda">Cómoda</option>
              <option value="equilibrada">Equilibrada</option>
              <option value="compacta">Compacta</option>
            </select>
          </label>

          <button
            type="button"
            onClick={toggleMode}
            className="inline-flex h-9 w-9 items-center justify-center rounded-field border border-border text-muted hover:text-fg"
            aria-label={mode === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}
          >
            {mode === 'light' ? <MoonIcon size={18} aria-hidden /> : <SunIcon size={18} aria-hidden />}
          </button>

          <Link
            to="/settings"
            className="hidden min-w-0 max-w-[220px] text-right sm:block"
            title="Tu perfil y apariencia"
          >
            <div className="truncate text-[13px] font-semibold leading-tight text-fg">
              {roles?.fullName ?? roles?.email ?? 'Sesión'}
            </div>
            <div className="truncate text-[11px] leading-tight text-muted">{roleLabel}</div>
          </Link>

          <button
            type="button"
            className="ebim-btn-ghost h-9 px-3 text-xs"
            onClick={() => void signOut()}
            aria-label="Salir"
          >
            <SignOutIcon size={16} aria-hidden />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </header>

        <main id="contenido" className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
