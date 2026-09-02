import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useAppearance } from '@/hooks/useAppearance';
import { navGroupsFor } from './navigation';
import { EbimMark } from '@/components/ui/EbimMark';
import { PLATFORM_ROLE_LABEL, ORG_ROLE_LABEL } from '@/types/domain';
import { env } from '@/lib/env';

/**
 * Shell administrativo.
 *
 * Topbar: tratamiento (A) NEUTRO del contrato §4.4 — `var(--card)` + borde, con
 * la marca viviendo sólo en el sidebar. El contrato admite exactamente dos
 * tratamientos y prohíbe inventar un tercero con un tinte arbitrario del accent.
 */
export function AppShell() {
  const { roles, persona, signOut } = useAuth();
  const { mode, density, toggleMode, setDensity } = useAppearance();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const groups = navGroupsFor(persona);

  const roleLabel = roles?.platformRole
    ? PLATFORM_ROLE_LABEL[roles.platformRole]
    : roles?.organizations[0]
      ? `${ORG_ROLE_LABEL[roles.organizations[0].role]} · ${roles.organizations[0].displayName}`
      : roles?.salesAgentId
        ? 'Comercial'
        : 'Usuario de tenant';

  return (
    <div className="flex min-h-screen bg-bg">
      {/* ---- Sidebar: aquí vive la marca ---- */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[248px] shrink-0 overflow-y-auto text-white transition-transform lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ background: 'var(--sidebar)' }}
      >
        <div className="flex items-center gap-2.5 px-5 py-5">
          <EbimMark size={28} color="#FFFFFF" animated />
          <div className="leading-none">
            <div className="text-[15px] font-extrabold tracking-tight">Control Plane</div>
            <div className="mt-[3px] text-[9px] font-bold tracking-[0.22em] text-white/70">
              BY EBIM
            </div>
          </div>
        </div>

        <nav className="px-3 pb-8">
          {groups.map(({ group, items }) => (
            <div key={group} className="mb-4">
              <div className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-white/50">
                {group}
              </div>
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `block rounded-field px-2.5 py-2 text-[13.5px] font-medium transition-colors ${
                      isActive
                        ? 'bg-white/20 font-semibold text-white'
                        : 'text-white/80 hover:bg-white/10 hover:text-white'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {mobileOpen ? (
        <button
          type="button"
          aria-label="Cerrar menú"
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---- Topbar neutro (tratamiento A) ---- */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-card px-4">
          <button
            type="button"
            className="rounded-field border border-border p-1.5 text-muted lg:hidden"
            aria-label="Abrir menú"
            onClick={() => setMobileOpen(true)}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>

          <div className="min-w-0 flex-1">
            <span className="text-xs text-muted">{location.pathname}</span>
          </div>

          {env.appEnv !== 'PRD' ? (
            <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-bold text-warn">
              {env.appEnv}
            </span>
          ) : null}

          <label className="hidden items-center gap-1.5 text-xs text-muted sm:flex">
            <span className="sr-only">Densidad</span>
            <select
              className="rounded-field border border-border bg-card px-2 py-1 text-xs text-fg"
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
            className="rounded-field border border-border px-2 py-1 text-xs font-semibold text-muted hover:text-fg"
            aria-label={mode === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}
          >
            {mode === 'light' ? '🌙' : '☀️'}
          </button>

          <div className="hidden text-right sm:block">
            <div className="text-[13px] font-semibold leading-tight text-fg">
              {roles?.fullName ?? roles?.email ?? 'Sesión'}
            </div>
            <div className="text-[11px] leading-tight text-muted">{roleLabel}</div>
          </div>

          <button type="button" className="ebim-btn-ghost h-8 px-3 text-xs" onClick={() => void signOut()}>
            Salir
          </button>
        </header>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
