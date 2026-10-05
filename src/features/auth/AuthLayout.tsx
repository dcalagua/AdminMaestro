import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { EyeIcon, EyeSlashIcon, MoonIcon, ShieldCheckIcon, SunIcon, type Icon } from '@phosphor-icons/react';
import { EbimMark } from '@/components/ui/EbimMark';
import { useAppearance } from '@/hooks/useAppearance';

/* ==========================================================================
   Anatomía de acceso — contrato §4.5 (U-04/U-05). OBLIGATORIA, no es elección
   de la app. La comparten el login y `/bienvenida`.

   Criterio de aceptación: tapando el nombre del producto, el usuario NO debe
   poder decir de qué app se trata, pero SÍ que es EBIM.

   Estructura fija:
     · fondo --bg con halos de marca tenues; controles de idioma/tema sobre la
       tarjeta, alineados a su borde derecho;
     · tarjeta flotante centrada, radius 22, grid 1fr 1fr, max-w 1000,
       min-h 580, sombra teñida de marca;
     · panel izquierdo en degradado de marca, en ESTE orden:
         1 isotipo EBIM arriba-izquierda (blanco, «gira y para», U-03)
         2 wordmark del producto (40 px, inicial en el acento)
         3 eyebrow en MAYÚSCULAS, letter-spacing .16em
         4 párrafo de valor de 2-3 líneas
         5 EXACTAMENTE 3 bullets (el tipo lo exige: ni dos ni cinco)
         6 pie de confianza con escudo
       oculto en móvil (display:none), NO se apila;
     · panel derecho: el contenido de cada pantalla (labels ENCIMA del input,
       radius 11, ojo de contraseña, CTA ancho completo, UN solo link
       secundario) y el lockup «by EBIM» al pie tras un divisor.

   Lo que SÍ varía: eyebrow, párrafo y los 3 bullets.
   ========================================================================== */

export const APP_NAME = 'Admin Maestro';

export interface BrandBullet {
  icon: Icon;
  title: string;
  description: string;
}

export interface BrandPanelContent {
  eyebrow: string;
  paragraph: string;
  bullets: readonly [BrandBullet, BrandBullet, BrandBullet];
}

export const TRUST_LINE = 'Acceso solo por invitación · datos aislados por cliente · cifrado en tránsito.';

export function AuthLayout({ brand, children }: { brand: BrandPanelContent; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-auth px-4 py-6 sm:py-10">
      <div className="w-full max-w-[1000px]">
        <AuthToolbar />

        <div className="mt-3 grid w-full overflow-hidden rounded-login border border-border bg-card shadow-brand md:min-h-[580px] md:grid-cols-2">
          <BrandPanel brand={brand} />

          {/* ---- PANEL DERECHO ---- */}
          <div className="flex flex-col px-6 py-8 sm:px-10 sm:py-10">
            {/* En móvil el panel de marca está oculto: el lockup sube aquí. */}
            <div className="mb-7 flex items-center gap-2.5 md:hidden">
              <EbimMark size={30} color="var(--brand-mark)" animated />
              <AppLockupText />
            </div>

            <div className="flex flex-1 flex-col justify-center">{children}</div>

            {/* Lockup «by EBIM» al pie, tras un divisor sutil, centrado. */}
            <div className="mt-8 border-t border-border pt-5 text-center">
              <span className="text-compact font-bold text-fg">{APP_NAME}</span>
              <span className="ml-1.5 text-[9.5px] font-bold tracking-[0.22em] text-muted">BY EBIM</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Nombre de la app + «BY EBIM» (U-02), para cabeceras compactas. */
function AppLockupText() {
  return (
    <div className="leading-none">
      <div className="text-[17px] font-extrabold tracking-tight text-fg">{APP_NAME}</div>
      <div className="mt-[3px] text-[9.5px] font-bold tracking-[0.22em] text-muted opacity-85">BY EBIM</div>
    </div>
  );
}

/**
 * Idioma (solo español, U-13) y modo claro/oscuro: fuera de la tarjeta pero
 * alineados con su borde derecho, como un único grupo.
 */
function AuthToolbar() {
  const { mode, toggleMode } = useAppearance();
  return (
    <div className="flex justify-end">
      <div className="inline-flex items-center overflow-hidden rounded-field border border-border bg-card text-caption font-semibold text-muted shadow-card">
        <span className="px-3 py-1.5" title="Idioma: español">
          ES
        </span>
        <span className="h-4 w-px bg-border" aria-hidden />
        <button
          type="button"
          onClick={toggleMode}
          aria-label={mode === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 transition-colors duration-fast ease-out hover:bg-hover hover:text-fg"
        >
          {mode === 'light' ? <MoonIcon size={14} aria-hidden /> : <SunIcon size={14} aria-hidden />}
          {mode === 'light' ? 'Oscuro' : 'Claro'}
        </button>
      </div>
    </div>
  );
}

function BrandPanel({ brand }: { brand: BrandPanelContent }) {
  return (
    <div className="ebim-on-brand relative hidden flex-col overflow-hidden bg-auth-panel p-10 text-[color:var(--on-brand)] md:flex">
      {/* Isotipo gigante como marca de agua: decorativo, detrás del contenido. */}
      <EbimMark
        size={300}
        color="var(--on-brand)"
        className="pointer-events-none absolute -bottom-28 -right-28 opacity-[0.05]"
        decorative
      />

      <div className="relative">
        {/* 1 · Isotipo EBIM arriba-izquierda, blanco, «gira y para». */}
        <EbimMark size={36} color="var(--on-brand)" animated />

        {/* 2 · Wordmark: la inicial en el acento de marca, el resto en blanco. */}
        <p className="mt-9 text-display font-extrabold tracking-tight">
          <span className="text-[color:var(--brand-highlight)]">{APP_NAME.charAt(0)}</span>
          {APP_NAME.slice(1)}
        </p>

        {/* 3 · Eyebrow: dice qué ES, no qué hace. */}
        <p className="mt-3 text-micro tracking-[0.16em] text-[color:var(--on-brand-2)]">{brand.eyebrow}</p>

        {/* 4 · Párrafo de valor. */}
        <p className="mt-5 max-w-[40ch] text-[15px] leading-relaxed text-[color:var(--on-brand)]">{brand.paragraph}</p>
      </div>

      {/* 5 · EXACTAMENTE 3 bullets. */}
      <ul className="relative my-9 space-y-5">
        {brand.bullets.map(({ icon: BulletIcon, title, description }) => (
          <li key={title} className="flex gap-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[color:var(--on-brand-soft)]">
              <BulletIcon size={19} weight="duotone" aria-hidden />
            </span>
            <span>
              <span className="block text-body font-bold">{title}</span>
              <span className="block text-compact text-[color:var(--on-brand-2)]">{description}</span>
            </span>
          </li>
        ))}
      </ul>

      {/* 6 · Pie de confianza. */}
      <p className="relative mt-auto flex items-start gap-2 text-caption text-[color:var(--on-brand-2)]">
        <ShieldCheckIcon size={16} weight="duotone" className="mt-px shrink-0" aria-hidden />
        {TRUST_LINE}
      </p>
    </div>
  );
}

/**
 * Campo de contraseña con el ojo al final (U-04). Si `visible`/`onToggle` vienen
 * de fuera, el ojo controla varios campos a la vez (bienvenida).
 */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { visible?: boolean; onToggleVisible?: () => void }
>(function PasswordInput({ visible, onToggleVisible, className = '', ...props }, ref) {
  const [ownVisible, setOwnVisible] = useState(false);
  const shown = visible ?? ownVisible;
  const toggle = onToggleVisible ?? (() => setOwnVisible((v) => !v));
  const EyeGlyph = shown ? EyeSlashIcon : EyeIcon;
  return (
    <div className="relative">
      <input ref={ref} type={shown ? 'text' : 'password'} className={`ebim-input pr-11 ${className}`} {...props} />
      <button
        type="button"
        onClick={toggle}
        aria-label={shown ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        aria-pressed={shown}
        className="ebim-icon-btn absolute right-1.5 top-1/2 -translate-y-1/2"
      >
        <EyeGlyph size={18} aria-hidden />
      </button>
    </div>
  );
});
