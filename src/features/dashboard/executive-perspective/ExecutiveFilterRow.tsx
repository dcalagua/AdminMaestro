import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { ClockCountdownIcon, FlaskIcon, PresentationChartIcon } from '@phosphor-icons/react';
import { useCurrencies } from '@/services/queries';
import { CurrencyPicker } from '@/features/executive/components/ChartPanel';
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
  return (
    <section aria-label="Filtros del resumen" className="flex flex-wrap items-end gap-x-6 gap-y-3">
      {/* Al imprimir, los controles se reemplazan por la línea de contexto. */}
      <p className="hidden text-compact text-fg-2 print:block">
        Moneda de reporte <strong className="text-fg">{currency}</strong> · Mes analizado{' '}
        <strong className="text-fg">{monthLongLabel(month)}</strong> · Horizonte {horizon} meses
      </p>
      <div className="print:hidden">
        <CurrencyPicker currencies={codes} value={currency} onChange={setCurrency} label="Moneda de reporte" showLabel />
      </div>
      <SelectInput
        className="print:hidden"
        label="Mes analizado"
        selectClassName="h-9 min-w-[210px]"
        value={month}
        onChange={setMonth}
        options={options}
      />
      <div className="flex flex-col gap-1.5 print:hidden">
        <span className="text-micro text-muted" id="horizonte-label">
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
      <ul className="flex flex-wrap items-center gap-2 pb-1 text-caption" aria-label="Notas del reporte">
        {isCurrent ? (
          <li className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2.5 py-1 font-semibold text-warn">
            <ClockCountdownIcon size={14} aria-hidden /> Mes en curso: cifras parciales
          </li>
        ) : null}
        {missing.length ? (
          <li className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2.5 py-1 font-semibold text-warn">
            Parcial: falta tasa {missing.join(', ')} → {currency}
          </li>
        ) : null}
        {fxIsDemo ? (
          <li className="inline-flex items-center gap-1 rounded-full border border-border bg-sunken px-2.5 py-1 text-fg-2">
            <FlaskIcon size={14} aria-hidden /> Tipos de cambio de demostración
          </li>
        ) : null}
      </ul>
      {canPresent ? (
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
      ) : null}
    </section>
  );
}
