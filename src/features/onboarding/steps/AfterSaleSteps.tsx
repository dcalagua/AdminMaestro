import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircleIcon } from '@phosphor-icons/react';
import { Card } from '@/components/ui/primitives';
import { useTenantOverview } from '@/services/queries';
import { usePermissions } from '@/hooks/usePermissions';
import { PeriodInvoiceAction } from '@/features/billing/PeriodInvoiceAction';
import { GeneratePaymentLinkDialog } from '@/features/organizations/PaymentLinkDialog';
import { AppProvisioningPanel, type AltaTenant } from '../AppProvisioningPanel';
import type { CreatedSale } from '../useOnboardingWizard';

/**
 * Pasos posteriores a la creación (V5 · F4): primera factura, enlace de pago y
 * alta en las apps. Cada uno reutiliza la pieza de siempre (`PeriodInvoiceAction`,
 * el diálogo del portal `/pagar`, el panel de altas) y se puede dejar para
 * después: el hilo de la ficha 360 recuerda en qué paso quedó el cliente.
 */

function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'ok' }) {
  return (
    <p
      role="note"
      className={`flex items-start gap-2 rounded-field px-3 py-2.5 text-compact ${tone === 'ok' ? 'bg-ok-soft text-fg' : 'bg-sunken text-fg-2'}`}
    >
      {tone === 'ok' ? <CheckCircleIcon size={18} className="mt-px shrink-0 text-ok" aria-hidden /> : null}
      <span>{children}</span>
    </p>
  );
}

/** Por qué no aplica cobrar al cliente desde aquí, o `null` si sí aplica. */
function notBillable(created: CreatedSale): string | null {
  if (!created.subscriptionId) return 'Sin contrato recurrente (por ejemplo, un tenant demo): no hay factura ni cobro que preparar.';
  if (created.billingChannel === 'PARTNER_STATEMENT') {
    return 'Este contrato lo factura el partner al cliente final: EBIM no le emite facturas ni le envía enlaces de pago.';
  }
  return null;
}

export function FirstInvoiceStep({ created }: { created: CreatedSale }) {
  const perms = usePermissions();
  const [issued, setIssued] = useState<string | null>(null);
  const skip = notBillable(created);
  return (
    <div className="grid gap-4">
      <p className="text-body text-fg-2">
        Emite la factura del primer período del contrato. La base decide qué cargos tocan según la periodicidad; si ya
        existe la del período, la reutiliza.
      </p>
      {skip ? (
        <Note>{skip}</Note>
      ) : !perms.canReadFinance ? (
        <Note>Emitir la factura es de finanzas. Queda pendiente en el hilo de la ficha de la cuenta.</Note>
      ) : !created.activated ? (
        <Note>
          El contrato quedó en borrador: actívalo para poder facturarlo.{' '}
          <Link className="ebim-link" to={`/subscriptions/${created.subscriptionId}`}>Revisar el contrato</Link>
        </Note>
      ) : (
        <Card title="Primera factura">
          <PeriodInvoiceAction
            subscriptionId={created.subscriptionId!}
            currency={created.currency}
            onIssued={(r) => setIssued(r?.number ?? 'emitida')}
          />
          {issued ? (
            <div className="px-4 py-3">
              <Note tone="ok">Factura {issued} lista. Sigue con el enlace de pago.</Note>
            </div>
          ) : null}
        </Card>
      )}
    </div>
  );
}

export function PaymentLinkStep({ created }: { created: CreatedSale }) {
  const perms = usePermissions();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const skip = notBillable(created);
  return (
    <div className="grid gap-4">
      <p className="text-body text-fg-2">
        El cliente abre su estado de cuenta en el portal de pago, paga con tarjeta y puede dejarla guardada para los
        próximos cobros. El enlace se muestra una sola vez para enviarlo o copiarlo.
      </p>
      {skip ? (
        <Note>{skip}</Note>
      ) : !perms.canReadFinance ? (
        <Note>Generar el enlace de pago es de finanzas. Queda pendiente en el hilo de la ficha de la cuenta.</Note>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="ebim-btn-secondary" onClick={() => setOpen(true)}>
            {sent ? 'Generar otro enlace' : 'Generar enlace de pago'}
          </button>
          {sent ? <Note tone="ok">Enlace generado para {created.organizationName}.</Note> : null}
          <GeneratePaymentLinkDialog
            open={open}
            organizationId={created.organizationId}
            organizationName={created.organizationName}
            billingEmail={created.billingEmail}
            reasonHint={`Alta de ${created.tenantName}`}
            onClose={() => setOpen(false)}
            onCreated={() => setSent(true)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Alta en las apps: la app recién vendida primero y, en una venta, también las
 * demás apps contratadas de la cuenta que siguen vivas.
 */
export function AppsStep({ created, onlyThisTenant }: { created: CreatedSale; onlyThisTenant: boolean }) {
  const overview = useTenantOverview({ enabled: !onlyThisTenant });
  const self: AltaTenant = {
    tenantId: created.tenantId,
    tenantName: created.tenantName,
    productId: created.productId,
    productName: created.productName,
    productCode: created.productCode,
    subscriptionId: created.subscriptionId,
  };
  const others: AltaTenant[] = onlyThisTenant
    ? []
    : (overview.data ?? [])
        .filter(
          (t) =>
            t.customer_organization_id === created.organizationId &&
            t.tenant_id !== created.tenantId &&
            t.subscription_id &&
            t.status !== 'CHURNED' &&
            t.status !== 'ARCHIVED',
        )
        .map((t) => ({
          tenantId: t.tenant_id as string,
          tenantName: (t.name as string) ?? '—',
          productId: t.saas_product_id as string,
          productName: (t.product_short_name as string) ?? '—',
          productCode: t.product_code as string | null,
          subscriptionId: t.subscription_id,
        }));
  return (
    <div className="grid gap-4">
      <p className="text-body text-fg-2">
        Por cada app contratada: solicita el alta (en el ambiente donde la app tiene las altas habilitadas) y ejecútala.
        Nada se ejecuta solo; si la app la rechaza, verás el motivo y podrás reintentar.
      </p>
      <Card>
        <AppProvisioningPanel tenants={[self, ...others]} />
      </Card>
    </div>
  );
}
