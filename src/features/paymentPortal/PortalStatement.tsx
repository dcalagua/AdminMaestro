import { useEffect, useRef } from 'react';
import {
  CheckCircleIcon,
  ClockIcon,
  CreditCardIcon,
  PrinterIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { SuccessCheck } from '@/components/ui/SuccessCheck';
import { Badge } from '@/components/ui/primitives';
import { formatAmount, formatDate, formatDateTime, formatMoney, sumByCurrency } from '@/lib/format';
import { type PortalInvoice, type PortalReceipt, type PortalStatement } from './portalApi';
import { STATUS_LABEL, type TokenRequest } from './portalModel';
import { AutoPayBlock } from './AutoPayBlock';

/** Estado de cuenta del portal: total pendiente, facturas como tarjetas y comprobante de pago. */
export function Statement({
  statement,
  busyInvoice,
  notice,
  receipt,
  onPay,
  token,
  requestCardToken,
  reload,
}: {
  statement: PortalStatement;
  busyInvoice: string | null;
  notice: { tone: 'error' | 'ok'; text: string } | null;
  receipt: (PortalReceipt & { simulated: boolean }) | null;
  onPay: (invoice: PortalInvoice) => void;
  token: string;
  requestCardToken: (req: Omit<TokenRequest, 'resolve' | 'reject'>) => Promise<string | null>;
  reload: () => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const anyMock =
    statement.invoices.some((i) => i.checkout?.mode === 'MOCK') || statement.enrollment.checkout?.mode === 'MOCK';
  // Total pendiente AGRUPADO por moneda: PEN + USD no se suman (R-7).
  const totals = Object.entries(
    sumByCurrency(
      statement.invoices,
      (i) => i.balance,
      (i) => i.currency,
    ),
  );
  const overdueCount = statement.invoices.filter((i) => i.due_date !== null && i.due_date < today).length;
  const count = statement.invoices.length;

  return (
    <div className="space-y-4 sm:space-y-5">
      {receipt ? <Receipt receipt={receipt} /> : null}

      {/* Estado de cuenta: quién, hasta cuándo y cuánto falta pagar. */}
      <section
        aria-labelledby="portal-title"
        className="rounded-dialog border border-border bg-card p-6 shadow-brand sm:p-8"
      >
        <p className="text-micro text-muted">Estado de cuenta</p>
        <h1 id="portal-title" className="mt-1.5 text-h1 text-fg [overflow-wrap:anywhere]">
          {statement.organization.name ?? 'Estado de cuenta'}
        </h1>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-compact text-fg-2">
          {statement.organization.billing_email_masked ? (
            <span>Facturación a {statement.organization.billing_email_masked}</span>
          ) : null}
          {statement.expires_at ? (
            <span className="inline-flex items-center gap-1.5">
              <ClockIcon size={15} className="text-muted" aria-hidden />
              Enlace válido hasta el {formatDate(statement.expires_at)}
            </span>
          ) : null}
        </p>

        <div className="mt-6 border-t border-border pt-5">
          {count === 0 ? (
            <p className="flex items-center gap-3 text-h2 text-fg">
              <CheckCircleIcon size={32} weight="fill" className="shrink-0 text-ok" aria-hidden />
              Estás al día
            </p>
          ) : (
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-compact font-semibold text-fg-2">Total pendiente</p>
                <div className="mt-1 space-y-1">
                  {totals.map(([currency, amount]) => (
                    <p key={currency} className="flex items-baseline gap-2 text-fg">
                      <span className="text-h3 font-semibold text-muted">{currency}</span>
                      <span className="text-display">{formatAmount(amount)}</span>
                    </p>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="neutral">
                  {count} {count === 1 ? 'factura pendiente' : 'facturas pendientes'}
                </Badge>
                {overdueCount > 0 ? (
                  <Badge tone="danger" dot>
                    {overdueCount} {overdueCount === 1 ? 'vencida' : 'vencidas'}
                  </Badge>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </section>

      {anyMock ? (
        <p
          className="flex items-start gap-2 rounded-field bg-warn-soft px-4 py-3 text-compact font-semibold text-warn"
          role="note"
        >
          <WarningCircleIcon size={18} className="mt-px shrink-0" aria-hidden />
          Modo de prueba: este entorno no cobra tarjetas reales. Los pagos son simulados.
        </p>
      ) : null}

      {notice ? (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`flex items-start gap-2 rounded-field px-4 py-3 text-compact font-medium ${notice.tone === 'error' ? 'bg-danger-soft text-danger' : 'bg-ok-soft text-ok'}`}
        >
          <WarningCircleIcon size={18} className="mt-px shrink-0" aria-hidden />
          {notice.text}
        </p>
      ) : null}

      <section aria-labelledby="portal-invoices">
        <h2 id="portal-invoices" className="mb-3 mt-2 px-1 text-h3 text-fg">
          Facturas pendientes
        </h2>
        {count === 0 ? (
          <div className="ebim-card px-5 py-10 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ok-soft text-ok">
              <CheckCircleIcon size={26} weight="duotone" aria-hidden />
            </span>
            <p className="mt-3 text-body text-fg-2">No tienes facturas pendientes de pago. ¡Gracias!</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {statement.invoices.map((inv) => (
              <InvoiceCard
                key={inv.id}
                invoice={inv}
                overdue={inv.due_date !== null && inv.due_date < today}
                busy={busyInvoice === inv.id}
                disabled={busyInvoice !== null}
                onPay={() => onPay(inv)}
              />
            ))}
          </ul>
        )}
      </section>

      {statement.allow_card_enrollment || statement.card_on_file?.authorized ? (
        <AutoPayBlock statement={statement} token={token} requestCardToken={requestCardToken} reload={reload} />
      ) : null}
    </div>
  );
}

function InvoiceCard({
  invoice: inv,
  overdue,
  busy,
  disabled,
  onPay,
}: {
  invoice: PortalInvoice;
  overdue: boolean;
  busy: boolean;
  disabled: boolean;
  onPay: () => void;
}) {
  const numberId = `inv-${inv.number}`;
  return (
    <li className="ebim-card relative overflow-hidden">
      {overdue ? <span className="absolute inset-y-0 left-0 w-1 bg-danger" aria-hidden /> : null}
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p id={numberId} className="text-h3 text-fg">
              {inv.number}
            </p>
            {overdue ? (
              <Badge tone="danger">Vencida</Badge>
            ) : (
              <Badge tone={inv.status === 'PARTIALLY_PAID' ? 'warn' : 'neutral'}>
                {STATUS_LABEL[inv.status] ?? 'Pendiente'}
              </Badge>
            )}
          </div>
          {inv.product ? <p className="mt-0.5 text-compact text-fg-2">{inv.product}</p> : null}
          <dl className="mt-2 space-y-0.5 text-caption text-muted">
            {inv.period_start ? (
              <div>
                <dt className="inline">Periodo </dt>
                <dd className="inline">
                  {formatDate(inv.period_start)} – {formatDate(inv.period_end)}
                </dd>
              </div>
            ) : null}
            <div>
              {inv.due_date ? (
                <>
                  <dt className="inline">{overdue ? 'Vencida el ' : 'Vence el '}</dt>
                  <dd className={`inline ${overdue ? 'font-semibold text-danger' : ''}`}>{formatDate(inv.due_date)}</dd>
                </>
              ) : (
                <dd>Sin vencimiento</dd>
              )}
            </div>
            {inv.paid > 0 ? (
              <div>
                <dt className="inline">Total </dt>
                <dd className="inline">
                  {formatMoney(inv.total, inv.currency)} · pagado {formatMoney(inv.paid, inv.currency)}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>

        <div className="flex flex-col gap-3 sm:items-end">
          <p className="flex items-baseline gap-1.5 text-fg sm:justify-end">
            <span className="text-compact font-semibold text-muted">{inv.currency}</span>
            <span className="text-h1 tabular-nums">{formatAmount(inv.balance)}</span>
          </p>
          {inv.payable_by_card ? (
            <button
              type="button"
              className="ebim-btn-primary ebim-btn-lg w-full sm:w-auto sm:min-w-[148px]"
              disabled={disabled}
              aria-busy={busy || undefined}
              aria-describedby={numberId}
              onClick={onPay}
            >
              {busy ? <span className="ebim-spinner" aria-hidden /> : <CreditCardIcon size={18} aria-hidden />}
              {busy ? 'Procesando…' : 'Pagar'}
            </button>
          ) : (
            <span className="max-w-[220px] text-caption text-muted sm:text-right">
              No pagable con tarjeta. Puedes pagar por transferencia.
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

/** Comprobante: check dibujado, importe y datos para conservar. */
function Receipt({ receipt }: { receipt: PortalReceipt & { simulated: boolean } }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
    titleRef.current?.scrollIntoView?.({ block: 'center' });
  }, [receipt]);

  return (
    <section
      aria-live="polite"
      aria-labelledby="receipt-title"
      className="ebim-success-enter rounded-dialog border border-border bg-card p-6 text-center shadow-brand sm:p-8"
    >
      <SuccessCheck size={64} />
      <h2 id="receipt-title" ref={titleRef} tabIndex={-1} className="mt-4 text-h2 text-fg focus:outline-none">
        Pago recibido{receipt.simulated ? ' (simulado)' : ''}
      </h2>
      <p className="mt-2 flex items-baseline justify-center gap-2 text-fg">
        <span className="text-h3 font-semibold text-muted">{receipt.currency}</span>
        <span className="text-display">{formatAmount(receipt.amount)}</span>
      </p>
      <dl className="mx-auto mt-6 grid max-w-sm grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-field bg-sunken px-5 py-4 text-left text-compact">
        <dt className="text-muted">Factura</dt>
        <dd className="text-right font-semibold text-fg">{receipt.invoice_number}</dd>
        <dt className="text-muted">Importe</dt>
        <dd className="text-right font-semibold tabular-nums text-fg">{formatMoney(receipt.amount, receipt.currency)}</dd>
        <dt className="text-muted">Fecha</dt>
        <dd className="text-right font-semibold text-fg">{formatDateTime(receipt.paid_at)}</dd>
        <dt className="text-muted">Operación</dt>
        <dd className="text-right font-mono text-caption text-fg">{receipt.charge}</dd>
      </dl>
      <p className="mt-4 text-caption text-muted">Guarda este comprobante: es tu constancia del pago.</p>
      <button type="button" className="ebim-btn-ghost mt-3" onClick={() => window.print()}>
        <PrinterIcon size={18} aria-hidden />
        Imprimir comprobante
      </button>
    </section>
  );
}
