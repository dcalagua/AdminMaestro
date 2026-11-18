import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, DataTable, EmptyState, ErrorState, LoadingState } from '@/components/ui/primitives';
import { CellTitle, StatusCell } from '@/components/ui/cells';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { RevokeWithReasonDialog } from '@/components/ui/RevokeWithReasonDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/toast-context';
import { businessErrorMessage } from '@/lib/pgError';
import { formatDateTime } from '@/lib/format';
import { OrganizationFormDialog } from '@/features/organizations/OrganizationFormDialog';
import { useCancelTrialRequest, useRejectTrialRequest, useTrialRequests, type TrialRequestRow } from './leadsApi';
import {
  COUNTRY_LABEL, TRIAL_REQUEST_LABEL, TRIAL_REQUEST_TONE, ageLabel, asTrialStatus, onboardingUrlForTrial,
  organizationDraftFrom,
} from './leadsModel';

/**
 * Pruebas pedidas por los comerciales (perfil comercial, 2026-11-18).
 *
 * EBIM (`canManageCommercial`) ve todas: las aprueba creando el cliente y el
 * tenant con «Nueva venta» (que cierra el pedido y atribuye al comercial) o las
 * rechaza con motivo. Un comercial ve solo las suyas (RLS) y puede retirarlas
 * mientras esperan.
 */
export function TrialRequestsCard({ canApprove }: { canApprove: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const requests = useTrialRequests();
  const reject = useRejectTrialRequest();
  const cancel = useCancelTrialRequest();
  const [rejecting, setRejecting] = useState<TrialRequestRow | null>(null);
  const [cancelling, setCancelling] = useState<TrialRequestRow | null>(null);
  const [creatingFor, setCreatingFor] = useState<TrialRequestRow | null>(null);
  const orgDraft = useMemo(
    () =>
      creatingFor
        ? organizationDraftFrom({
            company_name: creatingFor.company_name,
            country_code: creatingFor.country_code,
            email: creatingFor.admin_email,
          })
        : undefined,
    [creatingFor],
  );

  const rows = requests.data ?? [];
  const pending = rows.filter((r) => r.status === 'PENDING').length;

  function acciones(r: TrialRequestRow) {
    const status = asTrialStatus(r.status);
    if (status === 'PENDING' && canApprove) {
      return [
        { label: 'Crear cliente y tenant de prueba…', onSelect: () => setCreatingFor(r) },
        { label: 'Tenant de prueba para un cliente existente', to: onboardingUrlForTrial(r.id) },
        { label: 'Escribir al contacto', onSelect: () => { window.location.href = `mailto:${r.admin_email}`; } },
        { label: 'Rechazar…', tone: 'danger' as const, onSelect: () => setRejecting(r) },
      ];
    }
    if (status === 'PENDING') {
      return [{ label: 'Retirar pedido…', tone: 'danger' as const, onSelect: () => setCancelling(r) }];
    }
    if (status === 'APPROVED' && r.tenant_id) {
      return [{ label: 'Ver tenant', to: `/tenants/${r.tenant_id}` }];
    }
    return [];
  }

  return (
    <Card
      title={canApprove ? 'Pruebas pedidas por los comerciales' : 'Mis pedidos de prueba'}
      description={
        canApprove
          ? `${pending ? `${pending} por aprobar. ` : ''}Aprobar crea el cliente y el tenant de prueba con «Nueva venta», sin cobro, y deja la atribución al comercial.`
          : 'EBIM revisa cada pedido y crea el tenant. La respuesta te llega a la Bandeja.'
      }
    >
      {requests.isLoading ? (
        <LoadingState label="Cargando pedidos de prueba…" />
      ) : requests.error ? (
        <ErrorState error={requests.error} onRetry={() => void requests.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Sin pedidos de prueba"
          description={canApprove ? 'Cuando un comercial pida una prueba, aparece aquí.' : 'Pide una desde una solicitud de la web o con «Pedir prueba».'}
        />
      ) : (
        <DataTable
          label="Pedidos de prueba"
          minWidth={900}
          columns={[
            { label: 'Empresa y administrador', sticky: true },
            'App y plan',
            ...(canApprove ? ['Comercial'] : []),
            'Pedida',
            'Estado',
            { label: 'Acciones', srOnly: true },
          ]}
        >
          {rows.map((r) => {
            const status = asTrialStatus(r.status);
            const items = acciones(r);
            return (
              <tr key={r.id}>
                <td className="ebim-td py-2">
                  <div className="max-w-[300px]">
                    <CellTitle
                      title={r.company_name}
                      secondary={[r.contact_name, r.admin_email, COUNTRY_LABEL[r.country_code ?? ''] ?? null].filter(Boolean) as string[]}
                    />
                  </div>
                </td>
                <td className="ebim-td py-2 text-compact">
                  {r.saas_products?.short_name ?? 'App'} · {r.plans?.name ?? 'Plan de la prueba'}
                </td>
                {canApprove ? <td className="ebim-td py-2 text-compact">{r.sales_agents?.full_name ?? '—'}</td> : null}
                <td className="ebim-td py-2 text-compact">
                  <span className="block leading-tight">
                    <span className="block text-fg">{ageLabel(r.created_at)}</span>
                    <span className="block text-caption text-muted">{formatDateTime(r.created_at)}</span>
                  </span>
                </td>
                <td className="ebim-td py-2">
                  <StatusCell
                    label={TRIAL_REQUEST_LABEL[status]}
                    tone={TRIAL_REQUEST_TONE[status]}
                    detail={status === 'REJECTED' ? r.decision_note ?? undefined : status === 'PENDING' ? r.notes ?? undefined : undefined}
                  />
                </td>
                <td className="ebim-td w-12 text-right">
                  {items.length ? <ActionMenu label={`Acciones del pedido de ${r.company_name}`} items={items} /> : null}
                </td>
              </tr>
            );
          })}
        </DataTable>
      )}

      <RevokeWithReasonDialog
        open={Boolean(rejecting)}
        title="¿Rechazar este pedido de prueba?"
        description="El comercial ve el motivo en su Bandeja. No se crea nada ni se le avisa al prospecto."
        submitLabel="Rechazar"
        busy={reject.isPending}
        onSubmit={async (note) => {
          if (!rejecting) return;
          await reject.mutateAsync({ id: rejecting.id, note });
          toast.success('Pedido rechazado', rejecting.company_name);
          setRejecting(null);
        }}
        onCancel={() => setRejecting(null)}
      />

      <ConfirmDialog
        open={Boolean(cancelling)}
        title="¿Retirar este pedido de prueba?"
        message="EBIM deja de verlo como pendiente. Puedes volver a pedirlo después."
        confirmLabel="Retirar"
        tone="danger"
        busy={cancel.isPending}
        onConfirm={async () => {
          if (!cancelling) return;
          try {
            await cancel.mutateAsync(cancelling.id);
            toast.success('Pedido retirado', cancelling.company_name);
            setCancelling(null);
          } catch (error) {
            toast.error('No se pudo retirar', businessErrorMessage(error));
          }
        }}
        onCancel={() => setCancelling(null)}
      />

      <OrganizationFormDialog
        open={Boolean(creatingFor)}
        defaultCapability="CUSTOMER"
        initial={orgDraft}
        onSaved={(organizationId) => {
          if (creatingFor) navigate(onboardingUrlForTrial(creatingFor.id, organizationId));
        }}
        onClose={() => setCreatingFor(null)}
      />
    </Card>
  );
}
