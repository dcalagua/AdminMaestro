import { useState } from 'react';
import { useProviderSubscription } from '@/services/queries';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, EmptyState, Badge, LoadingState } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/format';

/**
 * Estado del cobro con tarjeta de una suscripción.
 *
 * Lo que esta pantalla muestra y lo que NO:
 *
 *   muestra  → marca, últimos 4 dígitos, estado del proveedor, próxima fecha
 *   NO tiene → PAN, CVV, token, ni la clave secreta. Ninguno de esos datos
 *              existe en la base, así que la UI no podría enseñarlos ni
 *              queriendo.
 *
 * Cuando la cuenta de proveedor no tiene credenciales configuradas, la pantalla
 * lo dice claramente en vez de fingir que el cobro está operativo. Es la
 * diferencia entre "pendiente de configurar" y "configurado y roto".
 */
export function CulqiCardPanel({
  subscriptionId,
  collectionMethod,
  providerAccountCode,
  providerEnvironment,
}: {
  subscriptionId: string | undefined;
  collectionMethod: string | null | undefined;
  providerAccountCode: string | null | undefined;
  providerEnvironment: string | null | undefined;
}) {
  const perms = usePermissions();
  const providerSub = useProviderSubscription(subscriptionId);
  const [showHelp, setShowHelp] = useState(false);

  if (collectionMethod !== 'CULQI_CARD') return null;

  const link = (providerSub.data ?? [])[0];
  const account = link?.payment_provider_accounts as
    | { code: string; environment: string; provider_kind: string; public_key: string | null }
    | null;

  // Sin llave pública no se puede ni abrir el Checkout: el navegador la necesita
  // para tokenizar. Es la señal inequívoca de "falta configurar".
  const credentialsMissing = !account?.public_key;

  return (
    <Card
      title="Cobro con tarjeta"
      description="El PAN y el CVV nunca llegan a EBIM: los tokeniza el navegador contra el proveedor."
      actions={
        <Badge tone={providerEnvironment === 'LIVE' ? 'warn' : 'info'}>
          {providerAccountCode ?? 'sin cuenta'} · {providerEnvironment ?? 'TEST'}
        </Badge>
      }
    >
      {providerSub.isLoading ? (
        <LoadingState label="Consultando el proveedor…" />
      ) : credentialsMissing ? (
        <div className="px-4 py-6">
          <div className="rounded-lg bg-warn-soft px-4 py-3">
            <p className="text-sm font-semibold text-warn">Culqi pendiente de configurar</p>
            <p className="mt-1 text-sm text-muted">
              La cuenta <span className="font-mono">{providerAccountCode}</span> no tiene llave
              pública cargada, así que el Checkout no puede abrirse y el adapter opera en modo{' '}
              <strong>MOCK</strong>. No se ejecuta ningún cobro real.
            </p>
            <button
              type="button"
              className="ebim-link mt-2 text-[13px]"
              onClick={() => setShowHelp((v) => !v)}
            >
              {showHelp ? 'Ocultar pasos' : '¿Qué falta para activarlo?'}
            </button>
            {showHelp ? (
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-muted">
                <li>
                  Cargar la llave pública <span className="font-mono">pk_test_…</span> en la cuenta
                  de proveedor desde Configuración.
                </li>
                <li>
                  Cargar la clave secreta como <em>secret</em> del servidor:{' '}
                  <span className="font-mono">supabase secrets set CULQI_SECRET_KEY=sk_test_…</span>.
                  Nunca en la base ni en el repositorio.
                </li>
                <li>
                  Definir <span className="font-mono">CULQI_API_BASE</span> con la URL confirmada en
                  apidocs.culqi.com.
                </li>
                <li>
                  El checklist completo está en{' '}
                  <span className="font-mono">docs/payments/CULQI_ARCHITECTURE.md</span> §10.
                </li>
              </ol>
            ) : null}
          </div>
        </div>
      ) : !link ? (
        <EmptyState
          title="Sin método de pago domiciliado"
          description="La suscripción está configurada para cobro con tarjeta pero aún no se ha registrado ninguna."
          action={
            perms.canManageCommercial ? (
              <button type="button" className="ebim-btn-primary" disabled>
                Configurar tarjeta
              </button>
            ) : null
          }
        />
      ) : (
        <dl className="divide-y divide-border">
          {[
            [
              'Estado en el proveedor',
              <Badge
                key="st"
                tone={
                  link.provider_status === 'active'
                    ? 'ok'
                    : link.provider_status === 'payment_failed'
                      ? 'danger'
                      : 'warn'
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
          ].map(([k, v]) => (
            <div key={k as string} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
              <dt className="text-muted">{k as string}</dt>
              <dd className="text-right font-medium">{v as React.ReactNode}</dd>
            </div>
          ))}
        </dl>
      )}

      {String(link?.external_subscription_id ?? '').includes('_mock_') ? (
        <p className="border-t border-border px-4 py-2.5 text-xs text-muted">
          Los identificadores con <span className="font-mono">_mock_</span> son simulados: no
          corresponden a ninguna suscripción real en el proveedor.
        </p>
      ) : null}
    </Card>
  );
}
