import {
  ArrowClockwiseIcon,
  CalendarXIcon,
  LinkBreakIcon,
  LockKeyIcon,
  LockSimpleIcon,
  WarningCircleIcon,
  WifiSlashIcon,
  type Icon,
} from '@phosphor-icons/react';
import { EbimMark } from '@/components/ui/EbimMark';
import { Skeleton } from '@/components/ui/primitives';

/** Marco del portal de pago: cabecera de marca, pie de confianza, esqueleto de carga y tarjeta de enlace inválido. */
const TRUST_FOOTER =
  'Pagos con tarjeta procesados por Culqi. EBIM nunca ve ni guarda el número ni el código de seguridad de tu tarjeta.';

export function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-auth">
      {/* Cabecera de marca: la banda continúa detrás de la primera tarjeta. */}
      <header className="ebim-on-brand bg-auth-panel text-[color:var(--on-brand)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 pb-20 pt-5 sm:px-6 sm:pb-24 sm:pt-6">
          <div className="flex items-center gap-2.5">
            <EbimMark size={30} color="var(--on-brand)" />
            <div className="leading-none">
              <div className="text-[17px] font-extrabold tracking-tight">Pagos</div>
              <div className="mt-[3px] text-[9.5px] font-bold tracking-[0.22em] opacity-85">BY EBIM</div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--on-brand-soft)] px-3 py-1 text-caption font-semibold">
            <LockSimpleIcon size={14} weight="bold" aria-hidden />
            Pago seguro
          </span>
        </div>
      </header>
      <main className="relative mx-auto -mt-14 w-full max-w-3xl flex-1 px-4 pb-10 sm:-mt-16 sm:px-6">{children}</main>
      <footer className="mx-auto w-full max-w-3xl px-4 pb-10 text-center sm:px-6">
        <p className="mx-auto flex max-w-[60ch] items-start justify-center gap-2 text-caption text-muted">
          <LockKeyIcon size={16} className="mt-px shrink-0" aria-hidden />
          <span>{TRUST_FOOTER}</span>
        </p>
        <p className="mt-4 text-[9.5px] font-bold tracking-[0.22em] text-muted">BY EBIM</p>
      </footer>
    </div>
  );
}

export function PortalSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <span className="sr-only">Cargando tu estado de cuenta…</span>
      <div className="rounded-dialog border border-border bg-card p-6 shadow-brand sm:p-8">
        <Skeleton className="block h-3 w-28" />
        <Skeleton className="mt-3 block h-7 w-3/5" />
        <Skeleton className="mt-2 block h-4 w-2/5" />
        <Skeleton className="mt-8 block h-3 w-24" />
        <Skeleton className="mt-3 block h-10 w-1/2" />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="ebim-card p-5">
          <Skeleton className="block h-4 w-1/3" />
          <Skeleton className="mt-3 block h-3 w-1/2" />
          <Skeleton className="mt-5 block h-9 w-full sm:ml-auto sm:w-40" />
        </div>
      ))}
    </div>
  );
}

/** Enlace inválido, vencido, revocado o sin conexión: tarjeta pública amable (§5.14). */
const LINK_PROBLEM: Record<string, { icon: Icon; title: string }> = {
  ENLACE_VENCIDO: { icon: CalendarXIcon, title: 'Este enlace de pago venció' },
  ENLACE_REVOCADO: { icon: LinkBreakIcon, title: 'Este enlace ya no está disponible' },
  ENLACE_INVALIDO: { icon: LinkBreakIcon, title: 'No reconocemos este enlace' },
  RED: { icon: WifiSlashIcon, title: 'No pudimos conectar' },
};

export function LinkProblem({ code, message, onRetry }: { code: string; message: string; onRetry?: () => void }) {
  const { icon: ProblemIcon, title } = LINK_PROBLEM[code] ?? {
    icon: WarningCircleIcon,
    title: 'No podemos mostrar este estado de cuenta',
  };
  const linkIssue = code.startsWith('ENLACE_');
  return (
    <div
      role="alert"
      className="mx-auto max-w-[480px] rounded-dialog border border-border bg-card px-6 py-9 text-center shadow-brand sm:px-9"
    >
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-accent-deep">
        <ProblemIcon size={32} weight="duotone" aria-hidden />
      </span>
      <h1 className="mt-5 text-h2 text-fg">{title}</h1>
      <p className="mx-auto mt-2 max-w-[44ch] text-body text-fg-2">{message}</p>
      {linkIssue ? (
        <div className="mt-6 rounded-field bg-sunken px-4 py-3 text-left text-compact text-fg-2">
          <p className="font-semibold text-fg">Tus facturas no se ven afectadas</p>
          <p className="mt-1">
            Por seguridad, cada enlace de pago tiene vigencia limitada. Tu contacto en EBIM puede enviarte uno nuevo en
            minutos.
          </p>
        </div>
      ) : null}
      {onRetry ? (
        <button type="button" className="ebim-btn-primary ebim-btn-lg mt-6 w-full" onClick={onRetry}>
          <ArrowClockwiseIcon size={18} aria-hidden />
          Reintentar
        </button>
      ) : null}
    </div>
  );
}
