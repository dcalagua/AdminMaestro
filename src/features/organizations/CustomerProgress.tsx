import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckIcon } from '@phosphor-icons/react';
import { Card } from '@/components/ui/primitives';
import { usePaymentLinks } from '@/services/queries';
import { useInvoiceSummary } from '@/services/financeRead';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useProvisioningAccess } from '@/hooks/useProvisioningAccess';
import { accountApps, type ProvisioningRow, type TenantRow } from '@/features/suite/suiteModel';
import { customerProgress, type ProgressStep } from '@/features/onboarding/flowModel';
import { AppProvisioningPanel, type AltaTenant } from '@/features/onboarding/AppProvisioningPanel';
import { GeneratePaymentLinkDialog } from './PaymentLinkDialog';
import { AppChips } from './Account360';
import { useOrgSaasProvisioning, useOrgSubscriptions, useOrgTenants } from './org360Queries';

const LIVE = (status: string | null | undefined) => status !== 'CHURNED' && status !== 'ARCHIVED';

/**
 * Hilo de progreso del cliente en la ficha 360 (V5 · F4): en qué paso del alta
 * quedó — contrato, primera factura, enlace de pago, pago y alta en cada app —
 * con la siguiente acción a un clic. Se calcula con lecturas que ya existen;
 * lo financiero sólo con vista financiera (si no, se dice «no visible»).
 */
export function CustomerProgress({
  organizationId,
  organizationName,
  billingEmail,
  showFinance,
}: {
  organizationId: string;
  organizationName: string;
  billingEmail?: string | null;
  showFinance: boolean;
}) {
  const { persona } = useAuth();
  const perms = usePermissions();
  const access = useProvisioningAccess();
  const subs = useOrgSubscriptions(organizationId);
  const tenants = useOrgTenants(organizationId);
  const saas = useOrgSaasProvisioning(organizationId);
  const invoices = useInvoiceSummary({ search: '', filter: 'ALL', organizationId });
  const links = usePaymentLinks(showFinance ? organizationId : undefined);
  const [altaOpen, setAltaOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  const own = ((tenants.data ?? []) as TenantRow[]).filter(
    (t) => t.customer_organization_id === organizationId && LIVE(t.status),
  );
  const apps = accountApps(organizationId, own, (saas.data ?? []) as ProvisioningRow[]);
  const contractIds = new Set(
    [
      ...(subs.data ?? []).map((s) => s.subscription_id),
      ...own.map((t) => t.subscription_id),
    ].filter(Boolean) as string[],
  );
  const counts = invoices.data?.status_counts ?? {};
  const issued = Object.entries(counts)
    .filter(([status]) => status !== 'DRAFT' && status !== 'VOID')
    .reduce((n, [, c]) => n + Number(c), 0);
  const paid = Object.values(invoices.data?.collected ?? {}).some((v) => Number(v) > 0);
  const financeKnown = showFinance && !invoices.error && Boolean(invoices.data);

  const progress = customerProgress({
    contracts: contractIds.size,
    invoicesIssued: financeKnown ? issued : null,
    paymentLinks: showFinance && links.data ? links.data.length : null,
    paid: financeKnown ? paid : null,
    apps: apps.map((a) => ({ name: a.productName, active: a.tenants.every((t) => t.kind === 'ACTIVE') })),
  });

  const loading = subs.isLoading || tenants.isLoading;
  const firstContract = [...contractIds][0];
  const altaTenants: AltaTenant[] = own.map((t) => ({
    tenantId: t.tenant_id as string,
    tenantName: (t.name as string) ?? '—',
    productId: t.saas_product_id as string,
    productName: (t.product_short_name as string) ?? '—',
    productCode: t.product_code as string | null,
    subscriptionId: t.subscription_id,
  }));
  const canAlta = persona === 'EBIM' && access.hasAnyAccess && altaTenants.length > 0;

  function nextAction(step: ProgressStep) {
    switch (step.id) {
      case 'contrato':
        return persona === 'EBIM' && perms.canManageCommercial ? (
          <Link className="ebim-btn-primary ebim-btn-sm" to={`/onboarding?cuenta=${organizationId}`}>
            Nueva venta para esta cuenta
          </Link>
        ) : null;
      case 'factura':
        return perms.canReadFinance && firstContract ? (
          <Link className="ebim-btn-primary ebim-btn-sm" to={`/subscriptions/${firstContract}#invoices`}>
            Emitir la primera factura
          </Link>
        ) : null;
      case 'enlace':
        return perms.canReadFinance ? (
          <button type="button" className="ebim-btn-primary ebim-btn-sm" onClick={() => setLinkOpen(true)}>
            Generar enlace de pago
          </button>
        ) : null;
      case 'pago':
        return showFinance ? (
          <Link className="ebim-btn-primary ebim-btn-sm" to={`/cobranza?tab=por-cobrar&pcq=${encodeURIComponent(organizationName)}`}>
            Ver lo que falta cobrar
          </Link>
        ) : null;
      case 'alta':
        return canAlta ? (
          <button
            type="button"
            className="ebim-btn-primary ebim-btn-sm"
            aria-expanded={altaOpen}
            onClick={() => setAltaOpen((v) => !v)}
          >
            {altaOpen ? 'Ocultar el alta en las apps' : 'Dar de alta en las apps'}
          </button>
        ) : null;
      default:
        return null;
    }
  }

  return (
    <Card
      title="¿En qué paso está el alta del cliente?"
      description="Del contrato al alta en cada app, calculado con lo que ya está registrado."
    >
      {loading ? (
        <p className="px-5 py-4 text-compact text-muted" role="status">Calculando el progreso…</p>
      ) : (
        <>
          <ol className="grid gap-px border-b border-border bg-border sm:grid-cols-3 xl:grid-cols-6" aria-label="Progreso del alta del cliente" data-customer-progress>
            {progress.steps.map((s) => {
              const current = progress.next?.id === s.id;
              return (
                <li
                  key={s.id}
                  className="flex min-w-0 items-start gap-2.5 bg-card px-4 py-3"
                  aria-current={current ? 'step' : undefined}
                  data-progress-step={s.id}
                  data-state={s.state}
                >
                  <span
                    aria-hidden
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-caption font-semibold ${
                      s.state === 'done'
                        ? 'bg-ok-soft text-ok'
                        : current
                          ? 'bg-accent-deep text-card'
                          : 'border border-border-strong text-muted'
                    }`}
                  >
                    {s.state === 'done' ? <CheckIcon size={14} weight="bold" /> : s.state === 'unknown' ? '?' : null}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-compact ${current ? 'font-semibold text-accent-deep' : 'font-medium text-fg'}`}>
                      <span className="sr-only">
                        {s.state === 'done' ? 'Hecho:' : s.state === 'unknown' ? 'No visible:' : current ? 'Siguiente paso:' : 'Pendiente:'}
                      </span>{' '}
                      {s.label}
                    </span>
                    <span className="block text-caption text-muted">{s.detail}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          {apps.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
              <span className="text-caption text-muted">Alta en cada app:</span>
              <AppChips apps={apps} />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <p className="text-compact text-fg-2">
              {progress.next ? (
                <>
                  Siguiente paso: <strong className="text-fg">{progress.next.label}</strong>
                </>
              ) : (
                'Alta completa: contrato, factura, enlace, pago y todas sus apps activas.'
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {progress.next ? nextAction(progress.next) : null}
              {/* El alta en las apps no espera al cobro: se ofrece aunque no sea el siguiente paso. */}
              {progress.next && progress.next.id !== 'alta' && progress.steps.find((s) => s.id === 'alta')?.state === 'todo'
                ? nextAction(progress.steps.find((s) => s.id === 'alta')!)
                : null}
            </div>
          </div>
          {altaOpen && canAlta ? (
            <div className="border-t border-border" data-progress-alta>
              <AppProvisioningPanel tenants={altaTenants} />
            </div>
          ) : null}
        </>
      )}
      {perms.canReadFinance ? (
        <GeneratePaymentLinkDialog
          open={linkOpen}
          organizationId={organizationId}
          organizationName={organizationName}
          billingEmail={billingEmail}
          onClose={() => setLinkOpen(false)}
        />
      ) : null}
    </Card>
  );
}
