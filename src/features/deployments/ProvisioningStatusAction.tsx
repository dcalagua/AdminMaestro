import { useState } from 'react';
import { useProvisioningAccess } from '@/hooks/useProvisioningAccess';
import { useGetProvisioningStatus, type OrchestratorResult } from '@/services/mutations';
import { useToast } from '@/components/ui/toast-context';
import { adminStatusLabel } from './contractAdapters';

/**
 * «Consultar estado»: pregunta al producto si el tenant existe y si coincide
 * con el mapping de MasterAdmin. Sólo lectura: no cambia la solicitud.
 *
 * Aparece sólo si la integración tiene la capacidad GET_STATUS y el usuario el
 * permiso de lectura. Ocultarlo es UX; la autorización la da la base.
 */
export function ProvisioningStatusAction({ request }: { request: Record<string, unknown> }) {
  const access = useProvisioningAccess();
  const lookup = useGetProvisioningStatus();
  const toast = useToast();
  const [result, setResult] = useState<OrchestratorResult | null>(null);

  const capabilities = (request.capabilities as string[] | null | undefined) ?? [];
  const canRead = access.canForProduct('platform.provisioning.read', request.saas_product_id as string);
  if (!capabilities.includes('GET_STATUS') || !canRead) return null;

  async function run() {
    try {
      setResult(await lookup.mutateAsync(request.id as string));
    } catch (error) {
      toast.error('No se pudo consultar el estado', error instanceof Error ? error.message : String(error));
    }
  }

  const admin = adminStatusLabel(result?.remote?.resources?.adminProvisioningStatus);

  return (
    <div className="mt-4">
      <button type="button" className="ebim-btn-secondary" disabled={lookup.isPending} onClick={() => void run()}>
        Consultar estado
      </button>

      {result ? (
        <div
          role="dialog"
          aria-label="Estado en el producto"
          className="mt-3 rounded-field border border-border p-3 text-[13px]"
        >
          {result.found && result.remote ? (
            <dl className="space-y-1">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Estado remoto</dt>
                <dd className="text-fg">{result.remote.status}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Tenant externo</dt>
                <dd className="font-mono text-xs text-fg">{result.remote.externalTenantId}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Organización externa</dt>
                <dd className="font-mono text-xs text-fg">{result.remote.externalOrganizationId ?? '—'}</dd>
              </div>
              {admin ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Administrador</dt>
                  <dd className="text-fg">{admin}</dd>
                </div>
              ) : null}
              <p className={result.mapping_consistent ? 'pt-1 text-success' : 'pt-1 font-semibold text-danger'}>
                {result.mapping_consistent ? 'Coincide con el mapping' : 'No coincide con el mapping'}
              </p>
            </dl>
          ) : (
            <p className="text-muted">
              {result.provider_http_status === 404
                ? 'El producto no tiene este tenant.'
                : 'La consulta no se pudo completar.'}{' '}
              <span className="font-mono text-xs">
                HTTP {String(result.provider_http_status ?? '—')} · {result.provider_code ?? '—'}
              </span>
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
