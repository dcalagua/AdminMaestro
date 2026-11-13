import type { ReactNode } from 'react';
import { CheckIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { Avatar } from '@/components/ui/Avatar';
import { formatAmount, formatMoney } from '@/lib/format';
import type { FlowPhase, FlowStep } from './flowModel';

/**
 * Piezas de presentación del asistente «Nueva venta» (VISUAL_SYSTEM_V2 §8
 * PT-WIZARD): stepper horizontal con progreso visible y resumen lateral fijo
 * del contrato. No validan ni calculan negocio: la base decide al crear.
 */

/**
 * Hilo del flujo guiado (V5 · F4): las FASES numeradas unidas por una línea
 * (cuenta → plan y precio → contrato → primera factura → enlace de pago → alta
 * en las apps). La fase actual en `--accent-deep`, las completadas con check;
 * se puede volver a una fase anterior, pero nunca por detrás de lo ya creado
 * (`minStep`): el contrato no se «des-crea» volviendo atrás.
 *
 * Un solo sistema de pasos visible: el contador, la barra y el hilo cuentan
 * FASES («Paso 2 de 6 · Plan y precio»). Si una fase tiene más de una
 * pantalla, la pantalla actual se nombra al lado, sin un segundo contador.
 */
export function WizardStepper({
  steps,
  phases,
  step,
  minStep = 1,
  onBack,
}: {
  steps: readonly FlowStep[];
  phases: readonly FlowPhase[];
  step: number;
  /** Primer paso al que se puede volver. */
  minStep?: number;
  onBack: (id: number) => void;
}) {
  const current = steps.find((s) => s.id === step);
  const phaseIndex = Math.max(0, phases.findIndex((p) => p.id === current?.phase));
  const phase = phases[phaseIndex];
  // Avance dentro de la fase: la barra crece pantalla a pantalla, pero se mide en fases.
  const inPhase = steps.filter((s) => s.phase === phase?.id);
  const within = inPhase.length > 1 ? inPhase.findIndex((s) => s.id === step) / inPhase.length : 0;
  const pct = Math.round(((phaseIndex + within) / Math.max(phases.length - 1, 1)) * 100);
  const screen = current && phase && inPhase.length > 1 && current.label !== phase.label ? current.label : null;
  const cols = phases.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-3 lg:grid-cols-6';
  return (
    <nav aria-label="Pasos del alta" className="mb-6">
      {/* V6: el hilo de abajo ya dice en qué paso se está; el contador queda para lector
          de pantalla y la pantalla dentro de la fase se nombra bajo el paso activo. */}
      <p className="sr-only">
        Paso {phaseIndex + 1} de {phases.length} · {phase?.label}
        {screen ? <> · {screen}</> : null}
      </p>
      <div
        className="mb-4 h-1 w-full overflow-hidden rounded-full bg-hover"
        role="progressbar"
        aria-label="Progreso del alta"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(pct, 100)}
        aria-valuetext={`Paso ${phaseIndex + 1} de ${phases.length}`}
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-overlay ease-out" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <ol className={`grid grid-cols-2 gap-2 ${cols}`}>
        {phases.map((p, i) => {
          const done = i < phaseIndex;
          const active = i === phaseIndex;
          const first = steps.find((s) => s.phase === p.id)?.id ?? 1;
          // Sólo se vuelve atrás, y nunca por detrás de lo ya creado.
          const reachable = done && first >= minStep;
          return (
            <li key={p.id} className="min-w-0">
              <button
                type="button"
                disabled={!reachable}
                onClick={() => onBack(first)}
                aria-current={active ? 'step' : undefined}
                className="group flex w-full min-w-0 items-center gap-2.5 rounded-field p-1 text-left disabled:cursor-default"
              >
                <span
                  aria-hidden
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-compact font-semibold tabular-nums transition-colors ${
                    active
                      ? 'bg-accent-deep text-card'
                      : done
                        ? `bg-accent-soft text-accent-deep ring-accent-deep ${reachable ? 'group-hover:ring-1' : ''}`
                        : 'border border-border-strong text-muted'
                  }`}
                >
                  {done ? <CheckIcon size={16} weight="bold" /> : i + 1}
                </span>
                <span
                  className={`min-w-0 text-compact leading-tight ${
                    active ? 'font-semibold text-accent-deep' : done ? 'text-fg' : 'text-muted'
                  }`}
                >
                  <span className="sr-only">{done ? 'Completado:' : active ? 'Paso actual:' : 'Pendiente:'}</span>{' '}
                  {p.label}
                </span>
              </button>
              {active && screen ? (
                <span className="-mt-1 block pl-[46px] text-caption leading-snug text-muted" aria-hidden>
                  {screen}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Line({ label, children, muted }: { label: string; children: ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-compact text-muted">{label}</dt>
      <dd className={`min-w-0 truncate text-right text-compact ${muted ? 'text-muted' : 'font-medium text-fg'}`}>{children}</dd>
    </div>
  );
}

/**
 * Resumen lateral fijo (sticky) del contrato que se está armando y su total.
 * El total es la licencia × cantidad en su periodicidad (lo que ya mostraba el
 * paso de resumen); los fees se listan aparte y nunca se suman a la licencia.
 */
export function ContractSummary({
  className = '',
  customerName,
  productName,
  marketText,
  currency,
  modeText,
  channelText,
  tenantText,
  planName,
  intervalText,
  quantity,
  license,
  licenseIsListed,
  isDemo,
  implementationFee,
  infrastructureFee,
  supportFee,
  regionalPriceMissing,
}: {
  className?: string;
  customerName?: string;
  productName?: string;
  marketText?: string;
  currency: string;
  modeText?: string;
  channelText: string;
  tenantText?: string;
  planName?: string;
  intervalText?: string;
  quantity: number;
  license: number | null;
  licenseIsListed: boolean;
  isDemo: boolean;
  implementationFee: number | null;
  infrastructureFee: number | null;
  supportFee: number | null;
  regionalPriceMissing: boolean;
}) {
  const money = (v: number | null) => (v == null || !currency ? '—' : formatMoney(v, currency));
  const total = license != null && currency ? license * quantity : null;
  return (
    <aside className={`lg:sticky lg:top-6 ${className}`} aria-labelledby="contract-summary-title" data-contract-summary>
      <section className="ebim-card">
        <div className="border-b border-border px-5 py-4">
          <h2 id="contract-summary-title" className="text-h3 text-fg">
            Resumen del contrato
          </h2>
          <p className="mt-0.5 text-compact text-muted">Se actualiza mientras completas los pasos.</p>
        </div>
        <div className="px-5 py-4">
          <div className="flex items-center gap-3">
            {customerName ? <Avatar name={customerName} size="md" /> : null}
            <div className="min-w-0">
              <p className="truncate text-body font-semibold text-fg">{customerName ?? 'Cliente sin elegir'}</p>
              <p className="truncate text-compact text-fg-2">{productName ?? 'Producto sin elegir'}</p>
            </div>
          </div>
          <dl className="mt-4 divide-y divide-border border-t border-border">
            <Line label="Mercado" muted={!marketText}>
              {marketText ?? 'Sin elegir'}
            </Line>
            <Line label="Moneda" muted={!currency}>
              {currency || 'Sin elegir'}
            </Line>
            <Line label="Canal">{channelText}</Line>
            <Line label="Modelo" muted={!modeText}>
              {modeText ?? '—'}
            </Line>
            <Line label="Tenant" muted={!tenantText}>
              {tenantText ?? 'Sin nombre aún'}
            </Line>
            <Line label="Plan" muted={!planName}>
              {planName ? `${planName}${quantity > 1 ? ` × ${quantity}` : ''}` : 'Sin elegir'}
            </Line>
            <Line label="Implementación" muted={implementationFee == null}>
              {implementationFee == null ? 'Sin fee' : `${money(implementationFee)} · única`}
            </Line>
            {infrastructureFee != null ? <Line label="Infraestructura">{money(infrastructureFee)}</Line> : null}
            {supportFee != null ? <Line label="Soporte / SLA">{money(supportFee)}</Line> : null}
          </dl>
        </div>
        <div className="rounded-b-card border-t border-border bg-sunken px-5 py-4">
          <p className="text-micro text-muted">
            Licencia{intervalText ? ` · ${intervalText.toLowerCase()}` : ''}
          </p>
          {isDemo ? (
            <p className="mt-1 text-h2 text-muted">Sin recurrente</p>
          ) : total != null ? (
            <p className="mt-1 flex items-baseline gap-1.5">
              <span className="text-h3 font-semibold text-muted">{currency}</span>
              <span className="text-kpi tabular-nums text-fg">{formatAmount(total)}</span>
            </p>
          ) : (
            <p className="mt-1 text-h2 text-muted">—</p>
          )}
          <p className="mt-1 text-caption text-muted">
            {isDemo
              ? 'Un tenant DEMO no genera licencia recurrente.'
              : regionalPriceMissing
                ? 'Sin tarifa regional para esta moneda: no se puede continuar.'
                : total != null
                  ? `${licenseIsListed ? 'Tarifa de lista' : 'Precio negociado'}${quantity > 1 ? ` × ${quantity}` : ''}. Los fees se cobran aparte.`
                  : 'Elige plan, mercado y moneda para ver el importe.'}
          </p>
          {regionalPriceMissing ? (
            <p className="mt-2 flex items-center gap-1.5 text-compact font-semibold text-warn">
              <WarningCircleIcon size={16} aria-hidden /> Falta tarifa regional
            </p>
          ) : null}
        </div>
      </section>
    </aside>
  );
}
