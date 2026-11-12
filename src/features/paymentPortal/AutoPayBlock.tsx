import { useState } from 'react';
import {
  ArrowsClockwiseIcon,
  LockKeyIcon,
  ShieldCheckIcon,
  ToggleLeftIcon,
  type Icon,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/primitives';
import { TextField } from '@/components/ui/fields';
import { formatDate } from '@/lib/format';
import { callPortal, type PortalStatement } from './portalApi';
import { FIELD_LABEL, FIELD_KEY, type TokenRequest } from './portalModel';

/** Pago automático del portal: explicación de confianza, alta y baja de la tarjeta guardada. */
const AUTOPAY_TRUST: Array<{ icon: Icon; title: string; description: string }> = [
  { icon: ShieldCheckIcon, title: 'Procesado por Culqi', description: 'Tu tarjeta se valida en la pasarela de pago.' },
  { icon: LockKeyIcon, title: 'EBIM no guarda tu tarjeta', description: 'Ni el número ni el código de seguridad.' },
  { icon: ToggleLeftIcon, title: 'Lo desactivas cuando quieras', description: 'Desde este mismo enlace, sin trámites.' },
];

export function AutoPayBlock({
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
