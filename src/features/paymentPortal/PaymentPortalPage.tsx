import { useCallback, useEffect, useMemo, useState } from 'react';
import { EbimMark } from '@/components/ui/EbimMark';
import { FormDialog } from '@/components/ui/FormDialog';
import { SelectField, TextField } from '@/components/ui/fields';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
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
 * que devuelve el portal, ya escritos para el cliente.
 */

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
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
    token ? { kind: 'loading' } : { kind: 'error', message: 'Este enlace de pago no es válido. Pide uno nuevo a tu contacto en EBIM.' },
  );
  const [busyInvoice, setBusyInvoice] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);
  const [receipt, setReceipt] = useState<(PortalReceipt & { simulated: boolean }) | null>(null);
  const [tokenRequest, setTokenRequest] = useState<TokenRequest | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const res = await callPortal<PortalStatement>('statement', { token });
    setPhase(res.ok ? { kind: 'ready', statement: res.data } : { kind: 'error', message: res.message });
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
        <p role="status" className="py-16 text-center text-sm text-muted">
          Cargando tu estado de cuenta…
        </p>
      ) : phase.kind === 'error' ? (
        <div role="alert" className="ebim-card px-6 py-12 text-center">
          <p className="text-base font-bold text-fg">No podemos mostrar este estado de cuenta</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">{phase.message}</p>
        </div>
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

function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-4 py-4">
          <EbimMark size={28} color="var(--brand-mark)" />
          <div className="leading-none">
            <div className="text-[17px] font-extrabold tracking-tight text-fg">Pagos</div>
            <div className="mt-[3px] text-[9.5px] font-bold tracking-[0.22em] text-muted opacity-85">BY EBIM</div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      <footer className="mx-auto max-w-3xl px-4 pb-10 text-center text-xs text-muted">
        Pagos con tarjeta procesados por Culqi. EBIM nunca ve ni guarda el número ni el código de seguridad de tu
        tarjeta.
      </footer>
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

  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-[22px] font-bold tracking-tight text-fg">{statement.organization.name ?? 'Estado de cuenta'}</h1>
        <p className="mt-1 text-sm text-muted">
          Estado de cuenta
          {statement.organization.billing_email_masked
            ? ` · facturación a ${statement.organization.billing_email_masked}`
            : ''}
          {statement.expires_at ? ` · enlace válido hasta el ${formatDate(statement.expires_at)}` : ''}
        </p>
      </section>

      {anyMock ? (
        <p className="rounded-field bg-warn-soft px-4 py-3 text-sm font-semibold text-warn" role="note">
          Modo de prueba: este entorno no cobra tarjetas reales. Los pagos son simulados.
        </p>
      ) : null}

      {receipt ? (
        <section className="ebim-card border-l-4 border-l-[color:var(--ok)] px-5 py-4" aria-live="polite">
          <p className="text-sm font-bold text-ok">Pago recibido{receipt.simulated ? ' (simulado)' : ''}</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Factura</dt>
            <dd className="font-medium">{receipt.invoice_number}</dd>
            <dt className="text-muted">Importe</dt>
            <dd className="font-medium tabular-nums">{formatMoney(receipt.amount, receipt.currency)}</dd>
            <dt className="text-muted">Fecha</dt>
            <dd className="font-medium">{formatDateTime(receipt.paid_at)}</dd>
            <dt className="text-muted">Operación</dt>
            <dd className="font-mono text-xs">{receipt.charge}</dd>
          </dl>
        </section>
      ) : null}

      {notice ? (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-field px-4 py-3 text-sm ${notice.tone === 'error' ? 'bg-danger-soft text-danger' : 'bg-ok-soft text-ok'}`}
        >
          {notice.text}
        </p>
      ) : null}

      <section className="ebim-card">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-bold text-fg">Facturas pendientes</h2>
        </div>
        {statement.invoices.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">No tienes facturas pendientes de pago. ¡Gracias!</p>
        ) : (
          <ul className="divide-y divide-border">
            {statement.invoices.map((inv) => {
              const overdue = inv.due_date !== null && inv.due_date < today;
              return (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-[200px]">
                    <p className="text-sm font-semibold text-fg">
                      {inv.number}
                      {inv.product ? <span className="font-normal text-muted"> · {inv.product}</span> : null}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {inv.period_start ? `Periodo ${formatDate(inv.period_start)} – ${formatDate(inv.period_end)} · ` : ''}
                      {inv.due_date ? (
                        <span className={overdue ? 'font-semibold text-danger' : undefined}>
                          {overdue ? 'Vencida el ' : 'Vence el '}
                          {formatDate(inv.due_date)}
                        </span>
                      ) : (
                        'Sin vencimiento'
                      )}
                      {' · '}
                      {STATUS_LABEL[inv.status] ?? 'Pendiente'}
                    </p>
                    {inv.paid > 0 ? (
                      <p className="mt-0.5 text-xs text-muted">
                        Total {formatMoney(inv.total, inv.currency)} · pagado {formatMoney(inv.paid, inv.currency)}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-base font-bold tabular-nums text-fg">{formatMoney(inv.balance, inv.currency)}</span>
                    {inv.payable_by_card ? (
                      <button
                        type="button"
                        className="ebim-btn-primary"
                        disabled={busyInvoice !== null}
                        aria-busy={busyInvoice === inv.id || undefined}
                        onClick={() => onPay(inv)}
                      >
                        {busyInvoice === inv.id ? 'Procesando…' : 'Pagar'}
                      </button>
                    ) : (
                      <span className="max-w-[180px] text-right text-xs text-muted">
                        No pagable con tarjeta. Puedes pagar por transferencia.
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {statement.allow_card_enrollment || statement.card_on_file?.authorized ? (
        <AutoPayBlock statement={statement} token={token} requestCardToken={requestCardToken} reload={reload} />
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------- Pago automático */

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
      <div className="border-b border-border px-5 py-3">
        <h2 id="autopay-title" className="text-sm font-bold text-fg">
          Pago automático
        </h2>
      </div>
      <div className="space-y-4 px-5 py-4 text-sm">
        {card?.authorized ? (
          <>
            <p>
              Activo con <strong>{card.brand ?? 'tarjeta'} •••• {card.last4 ?? '····'}</strong>
              {card.authorized_at ? ` desde el ${formatDate(card.authorized_at)}` : ''}. Cobraremos cada factura
              emitida al vencer y, si falla, lo reintentaremos a los 3 y a los 7 días.
            </p>
            {confirmOff ? (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirmar desactivación">
                <span className="text-muted">¿Desactivar el pago automático?</span>
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
            <p className="text-muted">
              Guarda tu tarjeta y cobraremos automáticamente cada factura de tus suscripciones cuando venza. Puedes
              desactivarlo cuando quieras desde este mismo enlace.
            </p>
            {missing.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <p className="text-xs text-muted sm:col-span-2">
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
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
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
              className="ebim-btn-primary"
              disabled={!accepted || busy || missing.some((f) => !(contact[f] ?? '').trim())}
              onClick={() => void activate()}
            >
              {busy ? 'Procesando…' : 'Guardar tarjeta y activar'}
            </button>
          </>
        ) : (
          <p className="text-muted">El pago automático no está disponible para tu cuenta en este momento.</p>
        )}
        {message ? (
          <p
            role={message.tone === 'error' ? 'alert' : 'status'}
            className={`rounded-field px-3 py-2 ${message.tone === 'error' ? 'bg-danger-soft text-danger' : 'bg-ok-soft text-ok'}`}
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
