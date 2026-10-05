import { useRef, useState } from 'react';
import {
  useCardOnFileAuthorizations,
  usePaymentLinkEvents,
  usePaymentLinks,
} from '@/services/queries';
import {
  useCreatePaymentLink,
  useRevokeCardOnFile,
  useRevokePaymentLink,
} from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  Badge, Card, DataTable, EmptyState, ErrorState, LoadingState, SearchBar,
} from '@/components/ui/primitives';
import { FormDialog } from '@/components/ui/FormDialog';
import { CheckboxField, NumberField, TextAreaField } from '@/components/ui/fields';
import { RevokeWithReasonDialog } from '@/components/ui/RevokeWithReasonDialog';
import { portalMailto, portalUrl } from './paymentPortalLinks';
import { useModalFocus } from '@/components/ui/useModalFocus';
import { useToast } from '@/components/ui/toast-context';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';

/**
 * Ficha 360 → «Portal de pago» (M1/M2, spec §2.5 y §3.3).
 *
 * El enlace se genera aquí y su URL se muestra UNA sola vez: la base solo guarda
 * el hash del token, así que ni esta pantalla ni nadie puede volver a verlo. Al
 * cerrar el diálogo el token se descarta del estado del componente.
 */

const LINK_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Activo',
  EXPIRED: 'Vencido',
  REVOKED: 'Revocado',
};
const LINK_STATUS_TONE: Record<string, 'ok' | 'warn' | 'neutral'> = {
  ACTIVE: 'ok',
  EXPIRED: 'warn',
  REVOKED: 'neutral',
};

const EVENT_LABEL: Record<string, string> = {
  VIEW: 'Consulta del estado de cuenta',
  CHARGE_ATTEMPT: 'Intento de pago',
  CHARGE_OK: 'Pago confirmado',
  CHARGE_FAILED: 'Pago rechazado',
  ENROLL_ATTEMPT: 'Intento de guardar tarjeta',
  ENROLL: 'Pago automático activado',
  UNENROLL: 'Pago automático desactivado',
  RATE_LIMITED: 'Bloqueado por demasiados intentos',
};

const REVOKE_SOURCE_LABEL: Record<string, string> = {
  PORTAL: 'Cliente (portal)',
  CONSOLE: 'Consola',
};

type LinkFilter = 'ALL' | 'ACTIVE' | 'EXPIRED' | 'REVOKED';

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
          className="ebim-input font-mono text-xs"
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

function LinkEventsDialog({ linkId, hint, onClose }: { linkId: string | null; hint: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const events = usePaymentLinkEvents(linkId);
  useModalFocus(ref, Boolean(linkId), { onEscape: onClose, canEscape: () => true });
  if (!linkId) return null;
  const rows = (events.data ?? []) as Array<{
    id: string;
    kind: string;
    error_code: string | null;
    amount: number | null;
    currency: string | null;
    created_at: string;
    invoices: { number: string } | null;
  }>;

  return (
    <div className="ebim-scrim fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 py-10">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-events-title"
        className="ebim-dialog w-full max-w-[720px] p-6"
      >
        <h2 id="link-events-title" className="text-h2 text-fg">
          Actividad del enlace …{hint}
        </h2>
        <div className="mt-4">
          {events.isLoading ? (
            <LoadingState />
          ) : events.error ? (
            <ErrorState error={events.error} onRetry={() => void events.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState title="Sin actividad" description="El cliente aún no ha abierto el enlace." />
          ) : (
            <DataTable columns={['Fecha', 'Evento', 'Factura', 'Importe', 'Código']}>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="ebim-td text-xs text-muted">{formatDateTime(e.created_at)}</td>
                  <td className="ebim-td">{EVENT_LABEL[e.kind] ?? e.kind}</td>
                  <td className="ebim-td font-mono text-xs">{e.invoices?.number ?? '—'}</td>
                  <td className="ebim-td tabular-nums">
                    {e.amount !== null && e.amount !== undefined ? formatMoney(Number(e.amount), e.currency) : '—'}
                  </td>
                  <td className="ebim-td font-mono text-xs">{e.error_code ?? '—'}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </div>
        <div className="mt-5 flex justify-end">
          <button type="button" className="ebim-btn-primary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

export function PaymentPortalPanel({
  organizationId,
  organizationName,
  billingEmail,
}: {
  organizationId: string;
  organizationName: string;
  billingEmail: string | null | undefined;
}) {
  const perms = usePermissions();
  const toast = useToast();
  const links = usePaymentLinks(organizationId);
  const authorizations = useCardOnFileAuthorizations(organizationId);
  const createLink = useCreatePaymentLink();
  const revokeLink = useRevokePaymentLink();
  const revokeCard = useRevokeCardOnFile();

  const [generateOpen, setGenerateOpen] = useState(false);
  const [days, setDays] = useState('30');
  const [allowCard, setAllowCard] = useState(true);
  const [reason, setReason] = useState('');
  const [generateError, setGenerateError] = useState<unknown>(null);
  const [created, setCreated] = useState<{ url: string; hint: string; expiresAt: string | null } | null>(null);
  const [filter, setFilter] = useState<LinkFilter>('ALL');
  const [eventsOf, setEventsOf] = useState<{ id: string; hint: string } | null>(null);
  const [revokingLink, setRevokingLink] = useState<{ id: string; hint: string } | null>(null);
  const [revokingAuth, setRevokingAuth] = useState<{ id: string; label: string } | null>(null);

  const allLinks = links.data ?? [];
  const { term, setTerm, filtered } = useSearchFilter(allLinks, (l) => [l.token_hint, l.revoke_reason]);
  const visible = filtered.filter((l) => filter === 'ALL' || l.status === filter);
  const count = (s: LinkFilter) => allLinks.filter((l) => s === 'ALL' || l.status === s).length;

  function openGenerate() {
    setDays('30');
    setAllowCard(true);
    setReason('');
    setGenerateError(null);
    setGenerateOpen(true);
  }

  async function generate() {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 90) {
      setGenerateError(new Error('VIGENCIA_INVALIDA: la vigencia debe estar entre 1 y 90 días.'));
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
      setGenerateOpen(false);
      setCreated({ url: portalUrl(result.token), hint: result.hint ?? '', expiresAt: result.expires_at ?? null });
    } catch (error) {
      setGenerateError(error);
    }
  }

  async function doRevokeLink(why: string) {
    if (!revokingLink) return;
    await revokeLink.mutateAsync({ p_link_id: revokingLink.id, p_reason: why });
    toast.success('Enlace revocado', `…${revokingLink.hint}`);
    setRevokingLink(null);
  }

  async function doRevokeAuth(why: string) {
    if (!revokingAuth) return;
    await revokeCard.mutateAsync({ p_authorization_id: revokingAuth.id, p_reason: why });
    toast.success('Autorización revocada', 'El cobro automático queda desactivado; las suscripciones pasan a cobro manual.');
    setRevokingAuth(null);
  }

  const auths = authorizations.data ?? [];

  return (
    <div className="space-y-4">
      <Card
        title="Enlaces de pago"
        description="El cliente abre su estado de cuenta, paga sus facturas con tarjeta y puede activar el pago automático. Un enlace vence y se puede revocar."
        actions={
          perms.canReadFinance ? (
            <button type="button" className="ebim-btn-primary h-8 px-3 text-xs" onClick={openGenerate}>
              Generar enlace
            </button>
          ) : null
        }
      >
        <SearchBar
          value={term}
          onChange={setTerm}
          placeholder="Buscar por pista del enlace o motivo…"
          right={
            <StatusTabs<LinkFilter>
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'ALL', label: 'Todos', count: count('ALL') },
                { id: 'ACTIVE', label: 'Activos', count: count('ACTIVE') },
                { id: 'EXPIRED', label: 'Vencidos', count: count('EXPIRED') },
                { id: 'REVOKED', label: 'Revocados', count: count('REVOKED') },
              ]}
            />
          }
        />
        {links.isLoading ? (
          <LoadingState />
        ) : links.error ? (
          <ErrorState error={links.error} onRetry={() => void links.refetch()} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={allLinks.length === 0 ? 'Sin enlaces de pago' : 'Ningún enlace coincide'}
            description={
              allLinks.length === 0
                ? 'Genera un enlace y compártelo con el contacto de facturación.'
                : 'Cambia la búsqueda o la pestaña de estado.'
            }
          />
        ) : (
          <DataTable columns={['Enlace', 'Estado', 'Vence', 'Último acceso', 'Accesos', 'Cobros', '']}>
            {visible.map((l) => (
              <tr key={l.id as string}>
                <td className="ebim-td font-mono text-xs">
                  …{l.token_hint}
                  {l.allow_card_enrollment ? null : (
                    <span className="ml-2 font-sans text-[11px] text-muted">sin tarjeta guardada</span>
                  )}
                </td>
                <td className="ebim-td">
                  <Badge tone={LINK_STATUS_TONE[l.status as string] ?? 'neutral'}>
                    {LINK_STATUS_LABEL[l.status as string] ?? l.status}
                  </Badge>
                  {l.revoke_reason ? <div className="mt-0.5 text-[11px] text-muted">{l.revoke_reason}</div> : null}
                </td>
                <td className="ebim-td text-xs text-muted">{formatDate(l.expires_at as string)}</td>
                <td className="ebim-td text-xs text-muted">
                  {l.last_accessed_at ? formatDateTime(l.last_accessed_at as string) : 'Nunca'}
                </td>
                <td className="ebim-td tabular-nums">{Number(l.access_count ?? 0)}</td>
                <td className="ebim-td text-xs">
                  <span className="text-ok">{Number(l.charges_ok ?? 0)} ok</span>
                  {' · '}
                  <span className={Number(l.charges_failed ?? 0) > 0 ? 'text-danger' : 'text-muted'}>
                    {Number(l.charges_failed ?? 0)} fallidos
                  </span>
                  {Number(l.rate_limited ?? 0) > 0 ? (
                    <span className="text-warn"> · {Number(l.rate_limited)} bloqueos</span>
                  ) : null}
                </td>
                <td className="ebim-td">
                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="button"
                      className="ebim-link text-[13px]"
                      onClick={() => setEventsOf({ id: l.id as string, hint: l.token_hint as string })}
                    >
                      Ver actividad
                    </button>
                    {perms.canReadFinance && l.status === 'ACTIVE' ? (
                      <button
                        type="button"
                        className="text-[13px] text-danger hover:underline"
                        onClick={() => setRevokingLink({ id: l.id as string, hint: l.token_hint as string })}
                      >
                        Revocar
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <Card
        title="Tarjeta guardada"
        description="Autorizaciones de cobro automático otorgadas por el cliente desde el portal. Solo se guardan la marca y los últimos 4 dígitos."
      >
        {authorizations.isLoading ? (
          <LoadingState />
        ) : authorizations.error ? (
          <ErrorState error={authorizations.error} onRetry={() => void authorizations.refetch()} />
        ) : auths.length === 0 ? (
          <EmptyState
            title="Sin tarjeta guardada"
            description="El cliente puede activar el pago automático desde un enlace de pago que lo permita."
          />
        ) : (
          <DataTable columns={['Tarjeta', 'Autorizada', 'Cuenta', 'Suscripciones', 'Estado', '']}>
            {auths.map((a) => (
              <tr key={a.id as string}>
                <td className="ebim-td font-medium">
                  {a.brand ?? 'Tarjeta'} •••• {a.last4 ?? '????'}
                </td>
                <td className="ebim-td text-xs text-muted">
                  {formatDateTime(a.accepted_at as string)}
                  <div>Términos {a.terms_version}</div>
                </td>
                <td className="ebim-td text-xs">
                  {a.provider_account_code ?? '—'} {a.provider_environment ? `(${a.provider_environment})` : ''}
                </td>
                <td className="ebim-td tabular-nums">{Number(a.subscriptions_on_card ?? 0)}</td>
                <td className="ebim-td">
                  {a.is_active ? (
                    <Badge tone="ok">Vigente</Badge>
                  ) : (
                    <div>
                      <Badge tone="neutral">Revocada</Badge>
                      <div className="mt-0.5 text-[11px] text-muted">
                        {REVOKE_SOURCE_LABEL[a.revoke_source as string] ?? a.revoke_source} ·{' '}
                        {formatDate(a.revoked_at as string)}
                      </div>
                    </div>
                  )}
                </td>
                <td className="ebim-td text-right">
                  {perms.canReadFinance && a.is_active ? (
                    <button
                      type="button"
                      className="text-[13px] text-danger hover:underline"
                      onClick={() =>
                        setRevokingAuth({ id: a.id as string, label: `${a.brand ?? 'Tarjeta'} •••• ${a.last4 ?? ''}` })
                      }
                    >
                      Revocar autorización
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>

      <FormDialog
        open={generateOpen}
        title="Generar enlace de pago"
        description={`Estado de cuenta de ${organizationName}. El enlace se mostrará una sola vez.`}
        submitLabel="Generar"
        busy={createLink.isPending}
        error={generateError}
        onCancel={() => setGenerateOpen(false)}
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

      <LinkEventsDialog
        linkId={eventsOf?.id ?? null}
        hint={eventsOf?.hint ?? ''}
        onClose={() => setEventsOf(null)}
      />

      <RevokeWithReasonDialog
        open={Boolean(revokingLink)}
        title="Revocar enlace de pago"
        description={`El enlace …${revokingLink?.hint ?? ''} dejará de funcionar de inmediato. Es irreversible.`}
        busy={revokeLink.isPending}
        onSubmit={doRevokeLink}
        onCancel={() => setRevokingLink(null)}
      />

      <RevokeWithReasonDialog
        open={Boolean(revokingAuth)}
        title="Revocar autorización de cobro automático"
        description={`${revokingAuth?.label ?? ''}: la tarjeta queda inactiva y las suscripciones pasan a cobro manual. El historial se conserva.`}
        busy={revokeCard.isPending}
        onSubmit={doRevokeAuth}
        onCancel={() => setRevokingAuth(null)}
      />
    </div>
  );
}
