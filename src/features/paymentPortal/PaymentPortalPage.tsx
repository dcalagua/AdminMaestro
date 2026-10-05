import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowClockwiseIcon,
  ArrowsClockwiseIcon,
  CalendarXIcon,
  CheckCircleIcon,
  ClockIcon,
  CreditCardIcon,
  LinkBreakIcon,
  LockKeyIcon,
  LockSimpleIcon,
  PrinterIcon,
  ShieldCheckIcon,
  ToggleLeftIcon,
  WarningCircleIcon,
  WifiSlashIcon,
  type Icon,
} from '@phosphor-icons/react';
import { EbimMark } from '@/components/ui/EbimMark';
import { FormDialog } from '@/components/ui/FormDialog';
import { SuccessCheck } from '@/components/ui/SuccessCheck';
import { Badge, Skeleton } from '@/components/ui/primitives';
import { SelectField, TextField } from '@/components/ui/fields';
import { formatAmount, formatDate, formatDateTime, formatMoney, sumByCurrency } from '@/lib/format';
import {
  callPortal,
  readLinkToken,
  type PortalCheckout,
  type PortalInvoice,
  type PortalReceipt,
  type PortalStatement,
} from './portalApi';
import { mockToken, openCulqiCheckout } from './culqiCheckout';

/**
 * Portal de pago PÚBLICO (`/pagar#<token>`) — spec §2.4 y §3.1.
 *
 * Fuera de RequireAuth/AppShell: quien paga no tiene cuenta en MasterAdmin. El
 * token del enlace se lee del fragmento `#` y se manda en el cuerpo a la Edge
 * Function `pay-portal`; la página nunca habla con PostgREST.
 *
 * Lo que la página NO muestra nunca: ids internos (factura, cuenta, enlace),
 * códigos técnicos ni el id completo del cargo. Los mensajes de error son los
 * que devuelve el portal, ya escritos para el cliente; el código solo elige
 * el icono y el título de la tarjeta de error.
 *
 * Diseño (fase 07, PT-PUBLIC): cabecera de marca, estado de cuenta con el
 * total pendiente destacado, facturas como tarjetas, pago automático con la
 * explicación de confianza y comprobante con check animado. Los clientes
 * pagan desde el celular: todo se apila en una columna bajo `sm`.
 */

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'ready'; statement: PortalStatement };

const FIELD_LABEL: Record<string, string> = {
  billing_first_name: 'Nombre del titular',
  billing_last_name: 'Apellido del titular',
  billing_email: 'Correo de facturación',
  billing_address: 'Dirección de facturación',
  billing_city: 'Ciudad',
  billing_phone: 'Teléfono (solo dígitos, con código de país)',
};
const FIELD_KEY: Record<string, string> = {
  billing_first_name: 'first_name',
  billing_last_name: 'last_name',
  billing_email: 'email',
  billing_address: 'address',
  billing_city: 'city',
  billing_phone: 'phone',
};

const STATUS_LABEL: Record<string, string> = { ISSUED: 'Pendiente', PARTIALLY_PAID: 'Pago parcial' };

/** Token de tarjeta: formulario simulado (MOCK) o Culqi Checkout (TEST/LIVE). */
type TokenRequest = {
  title: string;
  description: string;
  currency: string;
  amountMinor: number;
  checkout: PortalCheckout;
  resolve: (token: string) => void;
  reject: (message: string | null) => void;
};

export function PaymentPortalPage() {
  const [token] = useState(() => readLinkToken());
  const [phase, setPhase] = useState<Phase>(() =>
    token
      ? { kind: 'loading' }
      : {
          kind: 'error',
          code: 'ENLACE_INVALIDO',
          message: 'Este enlace de pago no es válido. Pide uno nuevo a tu contacto en EBIM.',
        },
  );
  const [busyInvoice, setBusyInvoice] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);
  const [receipt, setReceipt] = useState<(PortalReceipt & { simulated: boolean }) | null>(null);
  const [tokenRequest, setTokenRequest] = useState<TokenRequest | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const res = await callPortal<PortalStatement>('statement', { token });
    setPhase(res.ok ? { kind: 'ready', statement: res.data } : { kind: 'error', code: res.error, message: res.message });
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Pide un token de tarjeta según el modo de la cuenta. */
  const requestCardToken = useCallback(
    async (req: Omit<TokenRequest, 'resolve' | 'reject'>): Promise<string | null> => {
      if (req.checkout.mode !== 'MOCK') {
        if (!req.checkout.public_key) return null;
        const res = await openCulqiCheckout({
          publicKey: req.checkout.public_key,
          title: req.title,
          description: req.description,
          currency: req.currency,
          amountMinor: req.amountMinor,
        });
        return res.token;
      }
      return new Promise<string | null>((resolve, reject) =>
        setTokenRequest({
          ...req,
          resolve: (t) => resolve(t),
          reject: (m) => (m ? reject(new Error(m)) : resolve(null)),
        }),
      );
    },
    [],
  );

  async function pay(invoice: PortalInvoice) {
    if (!token || !invoice.checkout) return;
    setNotice(null);
    setReceipt(null);
    setBusyInvoice(invoice.id);
    try {
      const amountMinor = Math.round(invoice.balance * 100);
      let sourceToken: string | null;
      try {
        sourceToken = await requestCardToken({
          title: 'EBIM',
          description: `Factura ${invoice.number}`,
          currency: invoice.currency,
          amountMinor,
          checkout: invoice.checkout,
        });
      } catch (error) {
        setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'No se pudo validar la tarjeta.' });
        return;
      }
      if (!sourceToken) return;
      const res = await callPortal<{ receipt: PortalReceipt; simulated: boolean }>('charge', {
        token,
        invoice_id: invoice.id,
        source_token: sourceToken,
      });
      if (!res.ok) {
        setNotice({ tone: 'error', text: res.message });
      } else {
        setReceipt({ ...res.data.receipt, simulated: res.data.simulated });
      }
      await load();
    } finally {
      setBusyInvoice(null);
    }
  }

  return (
    <PortalShell>
      {phase.kind === 'loading' ? (
        <PortalSkeleton />
      ) : phase.kind === 'error' ? (
        <LinkProblem
          code={phase.code}
          message={phase.message}
          onRetry={
            phase.code === 'RED' || phase.code === 'ERROR_INTERNO'
              ? () => {
                  setPhase({ kind: 'loading' });
                  void load();
                }
              : undefined
          }
        />
      ) : (
        <Statement
          statement={phase.statement}
          busyInvoice={busyInvoice}
          notice={notice}
          receipt={receipt}
          onPay={(inv) => void pay(inv)}
          token={token!}
          requestCardToken={requestCardToken}
          reload={load}
        />
      )}

      <MockCardDialog request={tokenRequest} onClose={() => setTokenRequest(null)} />
    </PortalShell>
  );
}

/* ------------------------------------------------------------------ Layout */

const TRUST_FOOTER =
  'Pagos con tarjeta procesados por Culqi. EBIM nunca ve ni guarda el número ni el código de seguridad de tu tarjeta.';

function PortalShell({ children }: { children: React.ReactNode }) {
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

function PortalSkeleton() {
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

function LinkProblem({ code, message, onRetry }: { code: string; message: string; onRetry?: () => void }) {
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

/* --------------------------------------------------------- Estado de cuenta */

function Statement({
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

/* ----------------------------------------------------------- Pago automático */

const AUTOPAY_TRUST: Array<{ icon: Icon; title: string; description: string }> = [
  { icon: ShieldCheckIcon, title: 'Procesado por Culqi', description: 'Tu tarjeta se valida en la pasarela de pago.' },
  { icon: LockKeyIcon, title: 'EBIM no guarda tu tarjeta', description: 'Ni el número ni el código de seguridad.' },
  { icon: ToggleLeftIcon, title: 'Lo desactivas cuando quieras', description: 'Desde este mismo enlace, sin trámites.' },
];

function AutoPayBlock({
  statement,
  token,
  requestCardToken,
  reload,
}: {
  statement: PortalStatement;
  token: string;
  requestCardToken: (req: Omit<TokenRequest, 'resolve' | 'reject'>) => Promise<string | null>;
  reload: () => Promise<void>;
}) {
  const card = statement.card_on_file;
  const enrollment = statement.enrollment;
  const [accepted, setAccepted] = useState(false);
  const [contact, setContact] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);
  const [missing, setMissing] = useState<string[]>(enrollment.missing_fields);
  const firstInvoice = statement.invoices[0];

  async function activate() {
    if (!enrollment.checkout) return;
    setMessage(null);
    setBusy(true);
    try {
      let sourceToken: string | null;
      try {
        sourceToken = await requestCardToken({
          title: 'EBIM',
          description: 'Pago automático de facturas',
          currency: firstInvoice?.currency ?? 'PEN',
          // Tokenizar no cobra: el importe solo se muestra en el formulario.
          amountMinor: firstInvoice ? Math.round(firstInvoice.balance * 100) : 100,
          checkout: enrollment.checkout,
        });
      } catch (error) {
        setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'No se pudo validar la tarjeta.' });
        return;
      }
      if (!sourceToken) return;
      const billingContact: Record<string, string> = {};
      for (const field of missing) {
        const key = FIELD_KEY[field];
        if (key && contact[field]) billingContact[key] = contact[field]!;
      }
      const res = await callPortal<{ card: { brand: string | null; last4: string | null } }>('enroll', {
        token,
        source_token: sourceToken,
        accepted_terms: true,
        ...(missing.length ? { billing_contact: billingContact } : {}),
      });
      if (!res.ok) {
        if (res.missing_fields) setMissing(res.missing_fields);
        setMessage({ tone: 'error', text: res.message });
        return;
      }
      setMessage({ tone: 'ok', text: 'Pago automático activado. Te cobraremos cada factura cuando venza.' });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await callPortal<{ revoked: number }>('unenroll', { token });
      setConfirmOff(false);
      if (!res.ok) {
        setMessage({ tone: 'error', text: res.message });
        return;
      }
      setMessage({ tone: 'ok', text: 'Pago automático desactivado. Tus próximas facturas no se cobrarán solas.' });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ebim-card" aria-labelledby="autopay-title">
      <div className="flex items-start gap-3.5 border-b border-border px-5 py-4 sm:px-6">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-deep">
          <ArrowsClockwiseIcon size={22} weight="duotone" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="autopay-title" className="text-h3 text-fg">
              Pago automático
            </h2>
            {card?.authorized ? (
              <Badge tone="ok" dot>
                Activo
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 text-compact text-fg-2">Olvídate de las fechas de vencimiento: cada factura se paga sola.</p>
        </div>
      </div>
      <div className="space-y-4 px-5 py-5 text-body sm:px-6">
        {card?.authorized || enrollment.available ? (
          <ul className="grid gap-3 sm:grid-cols-3" aria-label="Cómo protegemos tu tarjeta">
            {AUTOPAY_TRUST.map(({ icon: TrustIcon, title, description }) => (
              <li key={title} className="flex gap-2.5 rounded-field bg-sunken p-3">
                <TrustIcon size={20} weight="duotone" className="mt-px shrink-0 text-accent-deep" aria-hidden />
                <span>
                  <span className="block text-compact font-semibold text-fg">{title}</span>
                  <span className="block text-caption text-fg-2">{description}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {card?.authorized ? (
          <>
            <p className="text-fg-2">
              Activo con <strong className="text-fg">{card.brand ?? 'tarjeta'} •••• {card.last4 ?? '····'}</strong>
              {card.authorized_at ? ` desde el ${formatDate(card.authorized_at)}` : ''}. Cobraremos cada factura
              emitida al vencer y, si falla, lo reintentaremos a los 3 y a los 7 días.
            </p>
            {confirmOff ? (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirmar desactivación">
                <span className="text-fg-2">¿Desactivar el pago automático?</span>
                <button type="button" className="ebim-btn-danger" disabled={busy} onClick={() => void deactivate()}>
                  {busy ? 'Procesando…' : 'Sí, desactivar'}
                </button>
                <button type="button" className="ebim-btn-ghost" disabled={busy} onClick={() => setConfirmOff(false)}>
                  Cancelar
                </button>
              </div>
            ) : (
              <button type="button" className="ebim-btn-ghost" onClick={() => setConfirmOff(true)}>
                Desactivar pago automático
              </button>
            )}
          </>
        ) : enrollment.available ? (
          <>
            <p className="text-fg-2">
              Guarda tu tarjeta y cobraremos automáticamente cada factura de tus suscripciones cuando venza. Puedes
              desactivarlo cuando quieras desde este mismo enlace.
            </p>
            {missing.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <p className="text-caption text-muted sm:col-span-2">
                  La pasarela de pago necesita estos datos de facturación:
                </p>
                {missing.map((field) => (
                  <TextField
                    key={field}
                    label={FIELD_LABEL[field] ?? field}
                    value={contact[field] ?? ''}
                    inputMode={field === 'billing_phone' ? 'tel' : undefined}
                    type={field === 'billing_email' ? 'email' : 'text'}
                    onChange={(e) => setContact((c) => ({ ...c, [field]: e.target.value }))}
                  />
                ))}
              </div>
            ) : null}
            <label className="flex cursor-pointer items-start gap-2.5 rounded-field border border-border p-3 text-compact text-fg-2">
              <input
                type="checkbox"
                className="ebim-checkbox mt-0.5"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              <span>
                Autorizo a EBIM a cobrar automáticamente en esta tarjeta las facturas emitidas de mis suscripciones,
                por el importe de cada factura, hasta que desactive el pago automático (términos{' '}
                {enrollment.terms_version}).
              </span>
            </label>
            <button
              type="button"
              className="ebim-btn-primary ebim-btn-lg w-full sm:w-auto"
              disabled={!accepted || busy || missing.some((f) => !(contact[f] ?? '').trim())}
              aria-busy={busy || undefined}
              onClick={() => void activate()}
            >
              {busy ? <span className="ebim-spinner" aria-hidden /> : <LockKeyIcon size={18} aria-hidden />}
              {busy ? 'Procesando…' : 'Guardar tarjeta y activar'}
            </button>
          </>
        ) : (
          <p className="text-muted">El pago automático no está disponible para tu cuenta en este momento.</p>
        )}
        {message ? (
          <p
            role={message.tone === 'error' ? 'alert' : 'status'}
            className={`rounded-field px-3 py-2.5 text-compact font-medium ${message.tone === 'error' ? 'bg-danger-soft text-danger' : 'bg-ok-soft text-ok'}`}
          >
            {message.text}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------- Modo de prueba */

function MockCardDialog({ request, onClose }: { request: TokenRequest | null; onClose: () => void }) {
  const [holder, setHolder] = useState('');
  const [outcome, setOutcome] = useState<'approve' | 'decline' | '3ds'>('approve');
  const amount = useMemo(
    () => (request ? formatMoney(request.amountMinor / 100, request.currency) : ''),
    [request],
  );

  return (
    <FormDialog
      open={Boolean(request)}
      title="Modo de prueba · tarjeta simulada"
      description={`Este entorno no tiene credenciales de Culqi: no se cobra ninguna tarjeta real. ${request?.description ?? ''} · ${amount}`}
      submitLabel="Continuar"
      onCancel={() => {
        request?.reject(null);
        onClose();
      }}
      onSubmit={() => {
        request?.resolve(mockToken(outcome));
        onClose();
      }}
    >
      <p className="rounded-field bg-warn-soft px-3 py-2 text-xs font-semibold text-warn">
        Modo de prueba: no escribas datos de una tarjeta real.
      </p>
      <TextField label="Titular (opcional)" value={holder} onChange={(e) => setHolder(e.target.value)} autoComplete="off" />
      <SelectField
        label="Resultado simulado"
        value={outcome}
        onChange={(e) => setOutcome(e.target.value as typeof outcome)}
        options={[
          { value: 'approve', label: 'Aprobada' },
          { value: 'decline', label: 'Rechazada por el emisor' },
          { value: '3ds', label: 'Requiere autenticación (3-D Secure)' },
        ]}
      />
    </FormDialog>
  );
}
