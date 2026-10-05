import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useCardOnFileAuthorizations,
  useCurrentCollectionProfile,
  useProviderSubscription,
} from '@/services/queries';
import { useRevokeCardOnFile } from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, Badge, LoadingState, ErrorState } from '@/components/ui/primitives';
import { RevokeWithReasonDialog } from '@/components/ui/RevokeWithReasonDialog';
import { useToast } from '@/components/ui/toast-context';
import { formatDateTime } from '@/lib/format';

/**
 * Estado del cobro con tarjeta de una suscripción.
 *
 * Lo que esta pantalla muestra y lo que NO:
 *
 *   muestra  → marca, últimos 4 dígitos, autorización, modo recurrente,
 *              estado del proveedor, próxima fecha
 *   NO tiene → PAN, CVV, token, ni la clave secreta. Ninguno de esos datos
 *              existe en la base, así que la UI no podría enseñarlos ni
 *              queriendo.
 *
 * M1/M2 · El estado de credenciales se calcula desde la cuenta RESUELTA del
 * perfil de cobro vigente (la elige el servidor por mercado y moneda), no desde
 * una suscripción del proveedor previa: antes, una suscripción sin alta en el
 * proveedor aparecía siempre como «pendiente de configurar» aunque la cuenta
 * tuviera su llave pública.
 */

type AccountRow = {
  code: string;
  environment: string;
  public_key: string | null;
  secret_key_ref: string | null;
  /** Pista de la llave secreta CIFRADA (`sk_test_…abcd`); la llave nunca llega al navegador. */
  secret_hint?: string | null;
  api_base_url?: string | null;
  status: string;
} | null;

const REVOKE_SOURCE_LABEL: Record<string, string> = {
  PORTAL: 'el cliente desde el portal',
  CONSOLE: 'la consola',
};

export function CulqiCardPanel({
  subscriptionId,
  organizationId,
  collectionMethod,
  providerAccountCode,
  providerEnvironment,
}: {
  subscriptionId: string | undefined;
  /** Organización facturada: dueña de la tarjeta guardada y su autorización. */
  organizationId: string | undefined;
  collectionMethod: string | null | undefined;
  providerAccountCode: string | null | undefined;
  providerEnvironment: string | null | undefined;
}) {
  const perms = usePermissions();
  const toast = useToast();
  const profile = useCurrentCollectionProfile(collectionMethod === 'CULQI_CARD' ? subscriptionId : undefined);
  const providerSub = useProviderSubscription(collectionMethod === 'CULQI_CARD' ? subscriptionId : undefined);
  const authorizations = useCardOnFileAuthorizations(collectionMethod === 'CULQI_CARD' ? organizationId : undefined);
  const revoke = useRevokeCardOnFile();
  const [showHelp, setShowHelp] = useState(false);
  const [revoking, setRevoking] = useState<{ id: string; label: string } | null>(null);

  if (collectionMethod !== 'CULQI_CARD') return null;

  const current = profile.data as
    | { recurring_mode: string; payment_method_id: string | null; payment_provider_accounts: AccountRow }
    | null
    | undefined;
  const account = current?.payment_provider_accounts ?? null;
  const accountCode = account?.code ?? providerAccountCode ?? null;
  const environment = account?.environment ?? providerEnvironment ?? null;
  const isCardOnFile = current?.recurring_mode === 'CARD_ON_FILE';

  // Sin llave pública no se puede ni abrir el Checkout: el navegador la necesita
  // para tokenizar. Sin llave secreta (cifrada o por variable de entorno) el
  // servidor no puede cobrar. Cualquiera de las dos es «falta configurar».
  const hasSecret = Boolean(account?.secret_hint || account?.secret_key_ref);
  const credentialsMissing = !account?.public_key || !hasSecret;

  const link = (providerSub.data ?? [])[0];
  const activeAuth = (authorizations.data ?? []).find((a) => a.is_active);
  const lastAuth = activeAuth ?? (authorizations.data ?? [])[0];

  async function doRevoke(reason: string) {
    if (!revoking) return;
    await revoke.mutateAsync({ p_authorization_id: revoking.id, p_reason: reason });
    toast.success('Autorización revocada', 'La suscripción pasa a cobro manual. El historial se conserva.');
    setRevoking(null);
  }

  const rows: Array<[string, React.ReactNode]> = [
    [
      'Modo de cobro',
      isCardOnFile ? (
        <Badge key="mode" tone="accent">Tarjeta guardada · cobro por factura</Badge>
      ) : (
        <Badge key="mode" tone="info">Suscripción del proveedor</Badge>
      ),
    ],
    [
      'Tarjeta guardada',
      lastAuth ? (
        <span key="card">
          {lastAuth.brand ?? 'Tarjeta'} •••• {lastAuth.last4 ?? '????'}
        </span>
      ) : (
        <span key="card" className="text-muted">Ninguna</span>
      ),
    ],
    [
      'Autorización de cobro automático',
      activeAuth ? (
        <span key="auth">
          <Badge tone="ok">Vigente</Badge>{' '}
          <span className="text-xs text-muted">
            desde {formatDateTime(activeAuth.accepted_at as string)} · {activeAuth.terms_version}
          </span>
        </span>
      ) : lastAuth ? (
        <span key="auth">
          <Badge tone="neutral">Revocada</Badge>{' '}
          <span className="text-xs text-muted">
            por {REVOKE_SOURCE_LABEL[lastAuth.revoke_source as string] ?? lastAuth.revoke_source} ·{' '}
            {formatDateTime(lastAuth.revoked_at as string)}
          </span>
        </span>
      ) : (
        <span key="auth" className="text-muted">Sin autorización</span>
      ),
    ],
  ];

  if (link) {
    rows.push(
      [
        'Estado en el proveedor',
        <Badge
          key="st"
          tone={
            link.provider_status === 'active' ? 'ok' : link.provider_status === 'payment_failed' ? 'danger' : 'warn'
          }
        >
          {String(link.provider_status)}
        </Badge>,
      ],
      ['Suscripción del proveedor', <span key="id" className="font-mono text-xs">{String(link.external_subscription_id)}</span>],
      ['Próximo cobro', link.next_billing_at ? formatDateTime(link.next_billing_at) : '—'],
      ['Última sincronización', formatDateTime(link.synced_at)],
      [
        'Último error',
        link.last_error_code ? (
          <span key="err" className="text-danger">
            {String(link.last_error_code)} · {String(link.last_error_message ?? '')}
          </span>
        ) : (
          'Ninguno'
        ),
      ],
    );
  }

  return (
    <Card
      title="Cobro con tarjeta"
      description="El PAN y el CVV nunca llegan a EBIM: los tokeniza el navegador contra el proveedor."
      actions={
        <Badge tone={environment === 'LIVE' ? 'warn' : 'info'}>
          {accountCode ?? 'sin cuenta'} · {environment ?? 'TEST'}
        </Badge>
      }
    >
      {profile.isLoading ? (
        <LoadingState label="Consultando la cuenta de cobro…" />
      ) : profile.error ? (
        <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
      ) : (
        <>
          {credentialsMissing ? (
            <div className="px-4 pt-4">
              <div className="rounded-lg bg-warn-soft px-4 py-3">
                <p className="text-sm font-semibold text-warn">Culqi pendiente de configurar</p>
                <p className="mt-1 text-sm text-muted">
                  La cuenta <span className="font-mono">{accountCode ?? '—'}</span> no tiene{' '}
                  {!account?.public_key && !hasSecret
                    ? 'ni llave pública ni llave secreta'
                    : !account?.public_key
                      ? 'llave pública cargada, así que el Checkout no puede abrirse'
                      : 'llave secreta configurada'}
                  {' '}y el adapter opera en modo <strong>MOCK</strong>. No se ejecuta ningún cobro real.
                </p>
                <button type="button" className="ebim-link mt-2 text-[13px]" onClick={() => setShowHelp((v) => !v)}>
                  {showHelp ? 'Ocultar pasos' : '¿Qué falta para activarlo?'}
                </button>
                {showHelp ? (
                  <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-muted">
                    <li>
                      Cargar la llave pública <span className="font-mono">pk_test_…</span> en la cuenta desde
                      Configuración → Cuentas de pago.
                    </li>
                    <li>
                      Configurar la llave secreta <span className="font-mono">sk_test_…</span> con «Configurar llave» en
                      la misma pantalla ({account?.secret_hint ? (
                        <>configurada: <span className="font-mono">{account.secret_hint}</span></>
                      ) : (
                        'pendiente'
                      )}
                      ). Se guarda cifrada en el servidor y nunca vuelve al navegador.
                    </li>
                    <li>
                      Indicar en la cuenta la URL de la API (<span className="font-mono">https://api.culqi.com/v2</span>) o
                      dejar que la defina el servidor (<span className="font-mono">CULQI_API_BASE</span>).
                    </li>
                    <li>
                      El checklist completo está en{' '}
                      <span className="font-mono">docs/payments/CULQI_ARCHITECTURE.md</span> §10.
                    </li>
                  </ol>
                ) : null}
              </div>
            </div>
          ) : null}

          <dl className="divide-y divide-border">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>

          {!activeAuth && !link ? (
            <p className="border-t border-border px-4 py-2.5 text-xs text-muted">
              Sin método de pago registrado. El cliente guarda su tarjeta desde un enlace de pago
              {organizationId ? (
                <>
                  {' '}
                  (<Link className="ebim-link" to={`/organizations/${organizationId}#payment-portal`}>Portal de pago</Link>)
                </>
              ) : null}
              .
            </p>
          ) : null}

          {perms.canReadFinance && activeAuth ? (
            <div className="flex justify-end border-t border-border px-4 py-2.5">
              <button
                type="button"
                className="text-[13px] text-danger hover:underline"
                onClick={() =>
                  setRevoking({
                    id: activeAuth.id as string,
                    label: `${activeAuth.brand ?? 'Tarjeta'} •••• ${activeAuth.last4 ?? ''}`,
                  })
                }
              >
                Revocar autorización
              </button>
            </div>
          ) : null}

          {String(link?.external_subscription_id ?? '').includes('_mock_') ||
          String(activeAuth?.external_payment_method_id ?? '').includes('_mock_') ? (
            <p className="border-t border-border px-4 py-2.5 text-xs text-muted">
              Los identificadores con <span className="font-mono">_mock_</span> son simulados: no corresponden a
              ningún objeto real en el proveedor.
            </p>
          ) : null}
        </>
      )}

      <RevokeWithReasonDialog
        open={Boolean(revoking)}
        title="Revocar autorización de cobro automático"
        description={`${revoking?.label ?? ''}: la tarjeta queda inactiva y las suscripciones pasan a cobro manual.`}
        busy={revoke.isPending}
        onSubmit={doRevoke}
        onCancel={() => setRevoking(null)}
      />
    </Card>
  );
}
