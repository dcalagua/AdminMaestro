import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import {
  CaretLeftIcon,
  CaretRightIcon,
  ClockCountdownIcon,
  CornersInIcon,
  CornersOutIcon,
  EyeSlashIcon,
  FlaskIcon,
  PauseIcon,
  PlayIcon,
  PrinterIcon,
  SunIcon,
  XIcon,
  type Icon,
} from '@phosphor-icons/react';
import { EbimMark } from '@/components/ui/EbimMark';
import { formatDate } from '@/lib/format';
import { ExecutivePanel, HeroKpis } from '../ExecutivePerspective';
import { useExecutiveDashboard, type ExecutiveDashboardData } from '../executiveDashboardData';
import { DIRECT_CHANNEL } from '../executiveModel';
import { PresentationViewContext, presentationView } from './presentationContext';
import {
  AUTOPLAY_MS,
  autoplayIndex,
  buildAliases,
  MASK_PARAM,
  nextIndex,
  PRESENTATION_PARAMS,
  presentationKeyAction,
  SLIDE_PARAM,
  slideIndexFrom,
  SLIDES,
  type PresentationAction,
  type SlideDef,
} from './presentationModel';
import { exitFullscreen, fullscreenSupported, isFullscreen, requestFullscreen } from './fullscreen';
import { useForcedLightTheme, usePrintInLightTheme } from './theme';

/** Ancho con el que se dibujan las diapositivas al imprimir: el de una hoja A4 apaisada con 10 mm de margen. */
const PRINT_WIDTH = 1040;
/** Margen para que los gráficos se vuelvan a medir con ese ancho antes de abrir el diálogo de impresión. */
const PRINT_SETTLE_MS = 400;

/**
 * Modo presentación del Resumen Ejecutivo (fase 14).
 *
 * Proyecta los MISMOS paneles del tablero (mismas lecturas, mismos filtros de
 * la URL) como seis diapositivas, a pantalla completa y sin menús: la app queda
 * detrás, inerte. Flechas/espacio navegan, Esc sale, reproducción automática
 * opcional cada 20 s, «Ocultar nombres» reemplaza clientes y partners por
 * alias, e «Imprimir» saca una diapositiva por hoja A4 apaisada.
 */
export function ExecutivePresentation({ today = new Date() }: { today?: Date }) {
  const d = useExecutiveDashboard(today);
  const [params, setParams] = useSearchParams();
  const index = slideIndexFrom(params.get(SLIDE_PARAM));
  const masked = params.get(MASK_PARAM) === '1';
  const [autoplay, setAutoplay] = useState(false);
  const [forceLight, setForceLight] = useState(true);
  const [fullscreen, setFullscreen] = useState(isFullscreen);
  const [printing, setPrinting] = useState(false);
  const deckRef = useRef<HTMLDivElement>(null);
  const leavingFullscreen = useRef(false);
  const slide = SLIDES[index]!;

  const setParam = (key: string, value: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === null) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  const go = (i: number) => setParam(SLIDE_PARAM, String(i + 1));
  const exit = () => {
    leavingFullscreen.current = true;
    void exitFullscreen();
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const key of PRESENTATION_PARAMS) next.delete(key);
        return next;
      },
      { replace: true, state: { fromPresentation: true } },
    );
  };
  const toggleFullscreen = () => {
    if (isFullscreen()) {
      leavingFullscreen.current = true;
      void exitFullscreen();
    } else {
      void requestFullscreen().then(setFullscreen);
    }
  };

  // Alias estables por importe del mes (el mayor es «A»), los mismos en todas las diapositivas.
  const customerAliases = useMemo(
    () =>
      buildAliases(
        (d.customers.data ?? []).map((c) => ({
          id: c.organizationId,
          weight: c.closing ?? 0,
          tieBreak: c.organizationName,
        })),
        'Cliente',
      ),
    [d.customers.data],
  );
  const partnerAliases = useMemo(
    () =>
      buildAliases(
        (d.mixPartner.data ?? [])
          .filter((r) => r.key !== DIRECT_CHANNEL)
          .map((r) => ({ id: r.key, weight: r.mrr, tieBreak: r.label })),
        'Partner',
      ),
    [d.mixPartner.data],
  );
  const view = useMemo(
    () => presentationView(masked, customerAliases, partnerAliases, printing),
    [masked, customerAliases, partnerAliases, printing],
  );

  useForcedLightTheme(forceLight || printing);
  usePrintInLightTheme();
  usePresentingDocument(deckRef);

  // Teclado: la última versión de los manejadores, sin volver a suscribirse en cada render.
  const onAction = useRef<(a: PresentationAction) => void>(() => {});
  onAction.current = (a) => {
    if (a.type === 'exit') return exit();
    if (a.type === 'print') return setPrinting(true);
    const target = nextIndex(index, a);
    if (target !== index) go(target);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const action = presentationKeyAction(e);
      if (!action) return;
      e.preventDefault();
      onAction.current(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Esc en pantalla completa lo consume el navegador: salir de pantalla completa sin pedirlo = salir de la presentación.
  const onFullscreenLeft = useRef(exit);
  onFullscreenLeft.current = exit;
  useEffect(() => {
    const onChange = () => {
      const now = isFullscreen();
      setFullscreen(now);
      if (!now && !leavingFullscreen.current) onFullscreenLeft.current();
      leavingFullscreen.current = false;
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Reproducción automática: cada 20 s; tras la última vuelve a la primera. Navegar a mano reinicia la cuenta.
  const onTick = useRef(() => {});
  onTick.current = () => go(autoplayIndex(index));
  useEffect(() => {
    if (!autoplay || printing) return;
    const timer = setTimeout(() => onTick.current(), AUTOPLAY_MS);
    return () => clearTimeout(timer);
  }, [autoplay, printing, index]);

  // Imprimir: se dibujan TODAS las diapositivas al ancho de la hoja, se deja que los gráficos se midan y se abre el diálogo.
  useEffect(() => {
    if (!printing) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setPrinting(false);
    };
    const timer = setTimeout(() => {
      try {
        window.print();
      } finally {
        finish();
      }
    }, PRINT_SETTLE_MS);
    window.addEventListener('afterprint', finish);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', finish);
    };
  }, [printing]);

  const asOfLabel = d.isCurrent ? `a hoy, ${formatDate(d.asOf)}` : formatDate(d.asOf);

  return createPortal(
    <PresentationViewContext.Provider value={view}>
      <div
        ref={deckRef}
        tabIndex={-1}
        role="region"
        aria-roledescription="presentación"
        aria-label="Presentación del resumen ejecutivo"
        aria-keyshortcuts="ArrowRight ArrowLeft Space Home End Escape"
        className="ebim-presentation fixed inset-0 z-[80] flex flex-col bg-bg text-fg focus:outline-none"
        data-presentation
        data-printing={printing || undefined}
      >
        <DeckHeader d={d} asOfLabel={asOfLabel} masked={masked} className="print:hidden" heading />

        <div className="ebim-presentation-stage min-h-0 flex-1 overflow-auto px-6 py-6 lg:px-10">
          {printing ? (
            <div style={{ width: PRINT_WIDTH }} className="mx-auto space-y-10">
              {SLIDES.map((s, i) => (
                <Slide key={s.id} slide={s} index={i} d={d} asOfLabel={asOfLabel} masked={masked} />
              ))}
            </div>
          ) : (
            <Slide
              key={slide.id}
              slide={slide}
              index={index}
              d={d}
              asOfLabel={asOfLabel}
              masked={masked}
              animated
            />
          )}
        </div>

        <nav
          aria-label="Controles de la presentación"
          className="relative border-t border-border bg-card print:hidden"
          data-print-hide
        >
          <div className="absolute inset-x-0 top-0 h-0.5 bg-sunken" aria-hidden>
            <div
              className="h-full bg-accent transition-[width] duration-overlay ease-out"
              style={{ width: `${((index + 1) / SLIDES.length) * 100}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 lg:px-6">
            <button
              type="button"
              className="ebim-icon-btn"
              aria-label="Diapositiva anterior"
              disabled={index === 0}
              onClick={() => go(index - 1)}
            >
              <CaretLeftIcon size={20} aria-hidden />
            </button>
            <ol className="flex items-center" aria-label="Diapositivas">
              {SLIDES.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="group inline-flex h-7 w-7 items-center justify-center rounded-full"
                    aria-label={`Ir a la diapositiva ${i + 1}: ${s.title}`}
                    aria-current={i === index ? 'step' : undefined}
                    title={s.title}
                    onClick={() => go(i)}
                  >
                    <span
                      aria-hidden
                      className={`block h-2.5 rounded-full transition-[width,background-color] duration-fast ${
                        i === index
                          ? 'w-6 bg-accent-deep'
                          : 'w-2.5 bg-border-strong group-hover:bg-muted'
                      }`}
                    />
                  </button>
                </li>
              ))}
            </ol>
            <span
              className="min-w-[3.5rem] text-compact font-semibold tabular-nums text-fg-2"
              aria-hidden
            >
              {index + 1} / {SLIDES.length}
            </span>
            <button
              type="button"
              className="ebim-icon-btn"
              aria-label="Diapositiva siguiente"
              disabled={index === SLIDES.length - 1}
              onClick={() => go(index + 1)}
            >
              <CaretRightIcon size={20} aria-hidden />
            </button>

            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <ToolbarToggle
                pressed={autoplay}
                onClick={() => setAutoplay((v) => !v)}
                icon={autoplay ? PauseIcon : PlayIcon}
                label="Automático"
                title={`Avanza sola cada ${AUTOPLAY_MS / 1000} s; tras la última vuelve a la primera`}
              />
              <ToolbarToggle
                pressed={masked}
                onClick={() => setParam(MASK_PARAM, masked ? null : '1')}
                icon={EyeSlashIcon}
                label="Ocultar nombres"
                title="Reemplaza clientes y partners por «Cliente A», «Partner A»…"
              />
              <ToolbarToggle
                pressed={forceLight}
                onClick={() => setForceLight((v) => !v)}
                icon={SunIcon}
                label="Tema claro"
                title="Fuerza el tema claro mientras presentas (no cambia tu preferencia)"
              />
              <ToolbarToggle
                pressed={fullscreen}
                onClick={toggleFullscreen}
                icon={fullscreen ? CornersInIcon : CornersOutIcon}
                label="Pantalla completa"
                disabled={!fullscreenSupported()}
                title={
                  fullscreenSupported()
                    ? 'Pantalla completa del navegador'
                    : 'Este navegador no permite pantalla completa: la presentación ya cubre la ventana'
                }
              />
              <button
                type="button"
                className="ebim-btn ebim-btn-ghost ebim-btn-sm"
                onClick={() => setPrinting(true)}
                title="Una diapositiva por hoja A4 apaisada (Ctrl/⌘+P)"
              >
                <PrinterIcon size={16} aria-hidden /> Imprimir
              </button>
              <button
                type="button"
                className="ebim-btn ebim-btn-secondary ebim-btn-sm"
                onClick={exit}
                aria-keyshortcuts="Escape"
              >
                <XIcon size={16} aria-hidden /> Salir <kbd className="ebim-kbd">Esc</kbd>
              </button>
            </div>
          </div>
        </nav>

        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {printing
            ? 'Preparando la impresión de las seis diapositivas…'
            : `Diapositiva ${index + 1} de ${SLIDES.length}: ${slide.title}`}
          {autoplay && !printing ? '. Reproducción automática activa.' : ''}
        </p>
      </div>
    </PresentationViewContext.Provider>,
    document.body,
  );
}

/**
 * Mientras se presenta: la app de detrás queda inerte (ni foco ni lector de
 * pantalla), el documento no se desplaza y el foco entra a la presentación.
 * Al salir todo vuelve como estaba.
 */
function usePresentingDocument(deckRef: React.RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const html = document.documentElement;
    const root = document.getElementById('root');
    const overflow = document.body.style.overflow;
    html.classList.add('ebim-presenting');
    document.body.style.overflow = 'hidden';
    if (root) root.inert = true;
    deckRef.current?.focus({ preventScroll: true });
    return () => {
      html.classList.remove('ebim-presenting');
      document.body.style.overflow = overflow;
      if (root) root.inert = false;
      // Salir por un enlace o por «Atrás» también deja la pantalla completa. Se difiere un turno: el
      // desmontaje/montaje de StrictMode no debe sacar de pantalla completa a una presentación que sigue abierta.
      setTimeout(() => {
        if (!document.querySelector('[data-presentation]')) void exitFullscreen();
      }, 0);
    };
  }, [deckRef]);
}

/** Cabecera discreta: marca, qué se presenta, fecha de corte y moneda de reporte. */
function DeckHeader({
  d,
  asOfLabel,
  masked,
  className = '',
  heading = false,
}: {
  d: ExecutiveDashboardData;
  asOfLabel: string;
  masked: boolean;
  className?: string;
  /** Solo la cabecera de pantalla es el h1; la que se repite en cada hoja impresa no. */
  heading?: boolean;
}) {
  const Title = heading ? 'h1' : 'p';
  return (
    <header
      className={`flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-card px-6 py-3 lg:px-10 ${className}`}
    >
      <div className="flex items-center gap-3">
        <EbimMark size={28} color="var(--brand-mark)" decorative />
        <div className="leading-tight">
          <p className="text-micro text-muted">Admin Maestro · EBIM</p>
          <Title className="text-h3 text-fg">Resumen ejecutivo</Title>
        </div>
      </div>
      <dl className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1 text-compact">
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted">Datos al</dt>
          <dd className="font-semibold tabular-nums text-fg">{asOfLabel}</dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted">Mes analizado</dt>
          <dd className="font-semibold text-fg">{d.monthFullLabel}</dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted">Moneda de reporte</dt>
          <dd className="font-semibold text-fg">{d.rc || '—'}</dd>
        </div>
      </dl>
      {d.isCurrent || d.missing.length || d.fxIsDemo || masked ? (
        <ul
          className="flex flex-wrap items-center gap-1.5 text-caption"
          aria-label="Notas de la presentación"
        >
          {d.isCurrent ? (
            <Chip tone="warn" icon={ClockCountdownIcon}>
              Mes en curso: cifras parciales
            </Chip>
          ) : null}
          {d.missing.length ? <Chip tone="warn">Falta tasa {d.missing.join(', ')}</Chip> : null}
          {d.fxIsDemo ? <Chip icon={FlaskIcon}>Tipos de cambio de demostración</Chip> : null}
          {masked ? <Chip icon={EyeSlashIcon}>Nombres ocultos</Chip> : null}
        </ul>
      ) : null}
    </header>
  );
}

function Chip({
  children,
  icon: IconCmp,
  tone,
}: {
  children: ReactNode;
  icon?: Icon;
  tone?: 'warn';
}) {
  return (
    <li
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold ${
        tone === 'warn' ? 'bg-warn-soft text-warn' : 'border border-border bg-sunken text-fg-2'
      }`}
    >
      {IconCmp ? <IconCmp size={14} aria-hidden /> : null}
      {children}
    </li>
  );
}

function ToolbarToggle({
  pressed,
  onClick,
  icon: IconCmp,
  label,
  title,
  disabled,
}: {
  pressed: boolean;
  onClick: () => void;
  icon: Icon;
  label: string;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`ebim-btn ebim-btn-sm ${pressed ? 'ebim-btn-secondary border-focus bg-accent-soft text-accent-deep' : 'ebim-btn-ghost'}`}
    >
      <IconCmp size={16} aria-hidden weight={pressed ? 'fill' : 'regular'} /> {label}
    </button>
  );
}

/* ---- Diapositivas -------------------------------------------------------------------- */

function Slide({
  slide,
  index,
  d,
  asOfLabel,
  masked,
  animated = false,
}: {
  slide: SlideDef;
  index: number;
  d: ExecutiveDashboardData;
  asOfLabel: string;
  masked: boolean;
  animated?: boolean;
}) {
  return (
    <section
      role="group"
      aria-roledescription="diapositiva"
      aria-label={`${index + 1} de ${SLIDES.length}: ${slide.title}`}
      data-slide={slide.id}
      className={`ebim-slide mx-auto flex w-full max-w-[1600px] flex-col gap-5 ${animated ? 'ebim-route-enter' : ''}`}
    >
      {/* En papel cada hoja lleva su propia cabecera (en pantalla está fija arriba). */}
      <DeckHeader
        d={d}
        asOfLabel={asOfLabel}
        masked={masked}
        className="hidden rounded-card border print:flex print:gap-x-4 print:px-4 print:py-2"
      />
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-h1 text-fg">{slide.title}</h2>
        <p className="text-body text-muted">
          {SLIDE_SUBTITLE[slide.id](d)} · {index + 1} de {SLIDES.length}
        </p>
      </div>
      <div className="ebim-present-scale min-w-0">
        <SlideBody id={slide.id} d={d} />
      </div>
    </section>
  );
}

const SLIDE_SUBTITLE: Record<SlideDef['id'], (d: ExecutiveDashboardData) => string> = {
  kpis: (d) => `Cierre de ${d.monthFullLabel} contra el mes anterior`,
  mrr: (d) => `Últimos ${d.horizon} meses`,
  puente: (d) => `Qué movió el MRR en ${d.monthFullLabel}`,
  cobranza: (d) => `Caja por mes y cartera al cierre de ${d.monthFullLabel}`,
  mix: (d) => `Composición del MRR al cierre de ${d.monthFullLabel}`,
  tops: (d) => `Quién sostiene el MRR al cierre de ${d.monthFullLabel}`,
};

function SlideBody({ id, d }: { id: SlideDef['id']; d: ExecutiveDashboardData }) {
  switch (id) {
    case 'kpis':
      return <HeroKpis d={d} />;
    case 'mrr':
      return <ExecutivePanel d={d} panel="evolucion-mrr" />;
    case 'puente':
      return (
        <div className="mx-auto max-w-5xl">
          <ExecutivePanel d={d} panel="puente" />
        </div>
      );
    case 'cobranza':
      return (
        <Pair>
          <ExecutivePanel d={d} panel="facturado-cobrado" />
          <ExecutivePanel d={d} panel="antiguedad" />
        </Pair>
      );
    case 'mix':
      return (
        <Pair even>
          <ExecutivePanel d={d} panel="mix-producto" />
          <ExecutivePanel d={d} panel="mix-mercado" />
        </Pair>
      );
    case 'tops':
      return (
        <Pair even>
          <ExecutivePanel d={d} panel="top-clientes" />
          <ExecutivePanel d={d} panel="top-partners" />
        </Pair>
      );
  }
}

/** Dos paneles lado a lado desde `lg` (y siempre en papel): 7·5 o 6·6. */
function Pair({ children, even = false }: { children: [ReactNode, ReactNode]; even?: boolean }) {
  const [a, b] = children;
  return (
    <div className="grid gap-5 lg:grid-cols-12 print:grid-cols-12">
      <div
        className={`min-w-0 ${even ? 'lg:col-span-6 print:col-span-6' : 'lg:col-span-7 print:col-span-7'}`}
      >
        {a}
      </div>
      <div
        className={`min-w-0 ${even ? 'lg:col-span-6 print:col-span-6' : 'lg:col-span-5 print:col-span-5'}`}
      >
        {b}
      </div>
    </div>
  );
}
