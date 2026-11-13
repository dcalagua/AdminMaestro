import { useRef, useState } from 'react';
import {
  useCardOnFileAuthorizations,
  usePaymentLinkEvents,
  usePaymentLinks,
} from '@/services/queries';
import { useRevokeCardOnFile, useRevokePaymentLink } from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { useSearchFilter } from '@/hooks/useSearchFilter';
import { StatusTabs } from '@/components/ui/SectionTabs';
import {
  Badge, Card, DataTable, EmptyState, ErrorState, LoadingState, SearchBar,
} from '@/components/ui/primitives';
import { RevokeWithReasonDialog } from '@/components/ui/RevokeWithReasonDialog';
import { GeneratePaymentLinkDialog } from './PaymentLinkDialog';
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
                  <td className="ebim-td text-caption text-muted">{formatDateTime(e.created_at)}</td>
                  <td className="ebim-td">{EVENT_LABEL[e.kind] ?? e.kind}</td>
                  <td className="ebim-td font-mono text-caption">{e.invoices?.number ?? '—'}</td>
                  <td className="ebim-td tabular-nums">
                    {e.amount !== null && e.amount !== undefined ? formatMoney(Number(e.amount), e.currency) : '—'}
                  </td>
                  <td className="ebim-td font-mono text-caption">{e.error_code ?? '—'}</td>
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
  const revokeLink = useRevokePaymentLink();
  const revokeCard = useRevokeCardOnFile();

  const [generateOpen, setGenerateOpen] = useState(false);
  const [filter, setFilter] = useState<LinkFilter>('ALL');
  const [eventsOf, setEventsOf] = useState<{ id: string; hint: string } | null>(null);
  const [revokingLink, setRevokingLink] = useState<{ id: string; hint: string } | null>(null);
  const [revokingAuth, setRevokingAuth] = useState<{ id: string; label: string } | null>(null);

  const allLinks = links.data ?? [];
  const { term, setTerm, filtered } = useSearchFilter(allLinks, (l) => [l.token_hint, l.revoke_reason]);
  const visible = filtered.filter((l) => filter === 'ALL' || l.status === filter);
  const count = (s: LinkFilter) => allLinks.filter((l) => s === 'ALL' || l.status === s).length;

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
            <button type="button" className="ebim-btn-primary h-8 px-3 text-caption" onClick={() => setGenerateOpen(true)}>
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
                <td className="ebim-td font-mono text-caption">
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
                <td className="ebim-td text-caption text-muted">{formatDate(l.expires_at as string)}</td>
                <td className="ebim-td text-caption text-muted">
                  {l.last_accessed_at ? formatDateTime(l.last_accessed_at as string) : 'Nunca'}
                </td>
                <td className="ebim-td tabular-nums">{Number(l.access_count ?? 0)}</td>
                <td className="ebim-td text-caption">
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
                <td className="ebim-td text-caption text-muted">
                  {formatDateTime(a.accepted_at as string)}
                  <div>Términos {a.terms_version}</div>
                </td>
                <td className="ebim-td text-caption">
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

      <GeneratePaymentLinkDialog
        open={generateOpen}
        organizationId={organizationId}
        organizationName={organizationName}
        billingEmail={billingEmail}
        onClose={() => setGenerateOpen(false)}
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
