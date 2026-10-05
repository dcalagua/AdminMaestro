import type { ReactNode } from 'react';
import { CheckIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { Avatar } from '@/components/ui/Avatar';
import { formatAmount, formatMoney } from '@/lib/format';
import { STEPS } from './onboardingSteps';

/**
 * Piezas de presentación del asistente «Nueva venta» (VISUAL_SYSTEM_V2 §8
 * PT-WIZARD): stepper horizontal con progreso visible y resumen lateral fijo
 * del contrato. No validan ni calculan negocio: la base decide al crear.
 */

/**
 * Pasos numerados unidos por una línea; el actual en `--accent-deep`, los
 * completados con check (se puede volver a ellos), los siguientes apagados
 * (avanzar exige validar el paso actual con «Continuar»).
 */
export function WizardStepper({ step, onBack }: { step: number; onBack: (id: number) => void }) {
  const current = STEPS.find((s) => s.id === step);
  const pct = Math.round(((step - 1) / (STEPS.length - 1)) * 100);
  return (
    <nav aria-label="Pasos del alta" className="mb-6">
      <p className="mb-3 text-compact text-fg-2">
        <span className="font-semibold text-fg">
          Paso {step} de {STEPS.length}
        </span>{' '}
        · {current?.label}
      </p>
      <div
        className="mb-4 h-1 w-full overflow-hidden rounded-full bg-hover"
        role="progressbar"
        aria-label="Progreso del alta"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-overlay ease-out" style={{ width: `${pct}%` }} />
      </div>
      <ol className="grid grid-cols-5 gap-2">
        {STEPS.map((s) => {
          const done = s.id < step;
          const active = s.id === step;
          return (
            <li key={s.id} className="min-w-0">
              <button
                type="button"
                // Solo se puede volver atrás: avanzar exige pasar la validación del paso.
                disabled={s.id > step}
                onClick={() => onBack(s.id)}
                aria-current={active ? 'step' : undefined}
                className="group flex w-full min-w-0 items-center gap-2.5 rounded-field p-1 text-left disabled:cursor-default"
              >
                <span
                  aria-hidden
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-compact font-semibold tabular-nums transition-colors ${
                    active
                      ? 'bg-accent-deep text-card'
                      : done
                        ? 'bg-accent-soft text-accent-deep ring-accent-deep group-hover:ring-1'
                        : 'border border-border-strong text-muted'
                  }`}
                >
                  {done ? <CheckIcon size={16} weight="bold" /> : s.id}
                </span>
                <span
                  className={`min-w-0 text-compact leading-tight ${
                    active ? 'font-semibold text-accent-deep' : done ? 'text-fg' : 'text-muted'
                  }`}
                >
                  <span className="sr-only">{done ? 'Completado:' : active ? 'Paso actual:' : 'Pendiente:'}</span>{' '}
                  {s.label}
                </span>
              </button>
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
