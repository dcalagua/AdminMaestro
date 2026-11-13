import { useRef, useState } from 'react';
import { useCreatePaymentLink } from '@/services/mutations';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, TextAreaField } from '@/components/ui/fields';
import { useModalFocus } from '@/components/ui/useModalFocus';
import { useToast } from '@/components/ui/toast-context';
import { formatDate } from '@/lib/format';
import { portalMailto, portalUrl } from './paymentPortalLinks';

/**
 * Generar un enlace al portal `/pagar` (M1) y mostrarlo UNA sola vez, con
 * «Enviar por correo» y «Copiar». Lo usan la ficha 360 (Portal de pago), el
 * flujo de alta de cliente y la bandeja «Por cobrar» de Cobranza: el mismo
 * diálogo, la misma RPC (`create_payment_link`).
 *
 * La base sólo guarda el hash del token: al cerrar, el enlace se descarta del
 * estado del componente y nadie puede volver a verlo.
 */
export function GeneratePaymentLinkDialog({
  open,
  organizationId,
  organizationName,
  billingEmail,
  reasonHint,
  onClose,
  onCreated,
}: {
  open: boolean;
  organizationId: string;
  organizationName: string;
  billingEmail: string | null | undefined;
  /** Motivo sugerido (p. ej. la factura que se cobra). */
  reasonHint?: string;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const createLink = useCreatePaymentLink();
  const [days, setDays] = useState('30');
  const [allowCard, setAllowCard] = useState(true);
  const [reason, setReason] = useState(reasonHint ?? '');
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<{ url: string; hint: string; expiresAt: string | null } | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setDays('30');
      setAllowCard(true);
      setReason(reasonHint ?? '');
      setError(null);
    }
  }

  async function generate() {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 90) {
      setError(new Error('VIGENCIA_INVALIDA: la vigencia debe estar entre 1 y 90 días.'));
      return;
    }
    try {
      const result = (await createLink.mutateAsync({
        p_organization_id: organizationId,
        p_expires_in_days: n,
        p_allow_card_enrollment: allowCard,
        p_reason: reason.trim() || undefined,
      })) as { token?: string; hint?: string; expires_at?: string } | null;
      if (!result?.token) throw new Error('No se recibió el enlace generado.');
      setCreated({ url: portalUrl(result.token), hint: result.hint ?? '', expiresAt: result.expires_at ?? null });
      onClose();
      onCreated?.();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <>
      <FormDialog
        open={open}
        title="Generar enlace de pago"
        description={`Estado de cuenta de ${organizationName}. El enlace se mostrará una sola vez.`}
        submitLabel="Generar"
        busy={createLink.isPending}
        error={error}
        onCancel={onClose}
        onSubmit={() => void generate()}
      >
        <NumberField
          label="Vigencia (días)"
          min={1}
          max={90}
          required
          value={days}
          onChange={(e) => setDays(e.target.value)}
          hint="Entre 1 y 90 días. Por defecto 30."
        />
        <CheckboxField
          label="Permitir guardar tarjeta (pago automático)"
          hint="El cliente podrá autorizar el cobro automático de sus próximas facturas."
          checked={allowCard}
          onChange={(e) => setAllowCard(e.target.checked)}
        />
        <TextAreaField
          label="Motivo (opcional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint="Queda en la auditoría junto con la pista del enlace."
        />
      </FormDialog>

      <LinkCreatedDialog
        created={created}
        organizationName={organizationName}
        billingEmail={billingEmail}
        onClose={() => setCreated(null)}
      />
    </>
  );
}

/** Diálogo que muestra el URL UNA sola vez. */
function LinkCreatedDialog({
  created,
  organizationName,
  billingEmail,
  onClose,
}: {
  created: { url: string; hint: string; expiresAt: string | null } | null;
  organizationName: string;
  billingEmail: string | null | undefined;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();
  useModalFocus(ref, Boolean(created), { onEscape: onClose, canEscape: () => true });
  if (!created) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(created!.url);
      toast.success('Enlace copiado', 'Pégalo en el mensaje para el cliente.');
    } catch {
      toast.error('No se pudo copiar', 'Selecciona el enlace y cópialo manualmente.');
    }
  }

  return (
    <div className="ebim-scrim fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-created-title"
        className="ebim-dialog w-full max-w-[560px] p-6"
      >
        <h2 id="link-created-title" className="text-h2 text-fg">
          Enlace de pago generado
        </h2>
        <p className="mt-3 rounded-field bg-warn-soft px-3 py-2.5 text-compact text-warn" role="note">
          Este enlace se muestra <strong>una sola vez</strong>. EBIM solo guarda una huella del token: si lo pierdes,
          revócalo y genera uno nuevo.
        </p>
        <label className="ebim-label mt-4" htmlFor="payment-link-url">
          Enlace para el cliente
        </label>
        <input
          id="payment-link-url"
          className="ebim-input font-mono text-caption"
          readOnly
          value={created.url}
          onFocus={(e) => e.currentTarget.select()}
        />
        <p className="ebim-help">
          Termina en <span className="font-mono">…{created.hint}</span>
          {created.expiresAt ? ` · vence el ${formatDate(created.expiresAt)}` : ''}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <a
            className="ebim-btn-ghost"
            href={portalMailto(billingEmail, organizationName, created.url, created.expiresAt)}
          >
            Enviar por correo
          </a>
          <button type="button" className="ebim-btn-secondary" onClick={() => void copy()}>
            Copiar
          </button>
          <button type="button" className="ebim-btn-primary" onClick={onClose}>
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}
