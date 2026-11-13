import { useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CaretDownIcon, ClockCountdownIcon, FlaskIcon, FunnelSimpleIcon, PresentationChartIcon } from '@phosphor-icons/react';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useCurrencies } from '@/services/queries';
import { HORIZONS, monthLongLabel } from '../executiveModel';
import { type useExecutiveFilters } from '../executiveDashboardData';
import { SelectInput } from '@/components/ui/fields';

/** Fila de filtros del resumen ejecutivo (moneda, mes analizado, horizonte) y acceso al modo presentación. */
export function FilterRow({
  month,
  horizon,
  options,
  setMonth,
  setHorizon,
  setCurrency,
  currency,
  missing,
  fxIsDemo,
  isCurrent,
  present,
  canPresent,
}: ReturnType<typeof useExecutiveFilters> & {
  currency: string;
  missing: string[];
  fxIsDemo: boolean;
  isCurrent: boolean;
  canPresent: boolean;
}) {
  const currencies = useCurrencies();
  const codes = [...new Set([...(currencies.data ?? []).filter((c) => c.status === 'ACTIVE').map((c) => c.code), currency].filter(Boolean))].sort();
  const presentRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const backFromPresentation = (location.state as { fromPresentation?: boolean } | null)?.fromPresentation === true;
  // Al salir del modo presentación el foco vuelve al botón que lo abrió.
  useEffect(() => {
    if (backFromPresentation) presentRef.current?.focus();
  }, [backFromPresentation]);
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const controls = (
    <>
      <SelectInput
        className="print:hidden"
        // «Moneda» a secas: la barra es del resumen y el aviso de tasa dice a qué se convierte.
        label="Moneda"
        labelDisplay="inline"
        selectClassName="h-9 w-[88px]"
        value={currency}
        onChange={setCurrency}
        options={codes.map((c) => ({ value: c, label: c }))}
      />
      <SelectInput
        className="print:hidden"
        label="Mes analizado"
        labelDisplay="inline"
        selectClassName="h-9 w-[168px]"
        value={month}
        onChange={setMonth}
        options={options}
      />
      <div className="flex items-center gap-2 print:hidden">
        <span className="text-caption text-muted" id="horizonte-label">
          Horizonte
        </span>
        <div role="group" aria-labelledby="horizonte-label" className="inline-flex h-9 items-center rounded-field border border-border-strong p-0.5">
          {HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              aria-pressed={horizon === h}
              className={`h-full rounded-md px-3 text-compact font-semibold transition-colors duration-fast ${
                horizon === h ? 'bg-accent-soft text-accent-deep' : 'text-muted hover:text-fg'
              }`}
              onClick={() => setHorizon(h)}
            >
              {h} meses
            </button>
          ))}
        </div>
      </div>
    </>
  );
  const notes = (
    <ul className="flex flex-wrap items-center gap-1.5 text-caption" aria-label="Notas del reporte">
      {isCurrent ? (
        <li className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2.5 py-1 font-semibold text-warn">
          <ClockCountdownIcon size={14} aria-hidden /> Mes en curso: cifras parciales
        </li>
      ) : null}
      {missing.length ? (
        <li
          className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2.5 py-1 font-semibold text-warn"
          title={`Sin tipo de cambio ${missing.join(', ')} → ${currency}: esas monedas no se consolidan y los totales se muestran por moneda.`}
        >
          Parcial: falta tasa {missing.join(', ')}
        </li>
      ) : null}
      {fxIsDemo ? (
        <li
          className="inline-flex items-center gap-1 rounded-full border border-border bg-sunken px-2.5 py-1 text-fg-2"
          title="Los tipos de cambio vigentes son de demostración"
        >
          <FlaskIcon size={14} aria-hidden /> Tasas demo
          <span className="sr-only"> (tipos de cambio de demostración)</span>
        </li>
      ) : null}
    </ul>
  );
  const presentButton = canPresent ? (
    <button
      ref={presentRef}
      type="button"
      className="ebim-btn ebim-btn-secondary ml-auto print:hidden"
      onClick={present}
      aria-keyshortcuts="Escape"
      title="Proyectar el resumen a pantalla completa, sin menús (Esc para salir)"
    >
      <PresentationChartIcon size={18} aria-hidden /> Presentar
    </button>
  ) : null;

  if (mobile) {
    // V6 · F5: en móvil los filtros se pliegan en un botón con el resumen de lo
    // elegido; así la primera cifra (MRR) entra en la primera pantalla.
    return (
      <section aria-label="Filtros del resumen" className="flex flex-col gap-2" data-filter-bar="mobile">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="ebim-btn ebim-btn-secondary min-w-0 flex-1 justify-between"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <FunnelSimpleIcon size={16} aria-hidden className="shrink-0" />
              <span className="truncate" title={`Filtros: ${currency} · ${monthLongLabel(month)} · ${horizon} meses`}>
                {currency} · {monthLongLabel(month)} · {horizon} m
              </span>
            </span>
            <CaretDownIcon size={14} aria-hidden className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {presentButton}
        </div>
        {open ? (
          <div id={panelId} className="flex flex-col items-start gap-2 rounded-card border border-border bg-card p-3">
            {controls}
          </div>
        ) : null}
        {notes}
      </section>
    );
  }

  return (
    // V6 · 3.1: una sola barra (≈ 40 px): filtros a la izquierda, avisos como chips y «Presentar» a la derecha.
    <section aria-label="Filtros del resumen" className="flex flex-wrap items-center gap-x-4 gap-y-2" data-filter-bar>
      {/* Al imprimir, los controles se reemplazan por la línea de contexto. */}
      <p className="hidden text-compact text-fg-2 print:block">
        Moneda de reporte <strong className="text-fg">{currency}</strong> · Mes analizado{' '}
        <strong className="text-fg">{monthLongLabel(month)}</strong> · Horizonte {horizon} meses
      </p>
      {controls}
      {notes}
      {presentButton}
    </section>
  );
}
