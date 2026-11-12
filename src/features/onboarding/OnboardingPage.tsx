import {
  PageContainer, Card, EmptyState, Badge,
} from '@/components/ui/primitives';
import { ContractSummary, WizardStepper } from './OnboardingWizardParts';
import { businessErrorMessage } from '@/lib/pgError';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';
import { INTERVALS } from './onboardingForm';
import { useOnboardingWizard } from './useOnboardingWizard';
import { CustomerStep } from './steps/CustomerStep';
import { TenantStep } from './steps/TenantStep';
import { PlanStep } from './steps/PlanStep';
import { CommercialStep } from './steps/CommercialStep';
import { ConfirmStep } from './steps/ConfirmStep';
import { AppsStep, FirstInvoiceStep, PaymentLinkStep } from './steps/AfterSaleSteps';
import { Link } from 'react-router-dom';

/**
 * Flujo guiado «Nueva venta / alta de cliente» (Fase 05 → V5 · F4).
 *
 * V5 · F4: el hilo es cuenta → plan y precio → contrato → primera factura →
 * enlace de pago → alta en las apps. Tras crear el contrato el flujo sigue en
 * esta pantalla; cada paso posterior tiene su botón explícito y se puede dejar
 * para después (la ficha 360 muestra en qué paso quedó el cliente).
 * «Nuevo tenant» (`?modo=app`) es el mismo flujo, sólo cuenta → tenant → alta.
 *
 * Toda la pantalla desemboca en UNA llamada:
 * `platform.onboard_customer_subscription()`. Ese es el punto: el alta es
 * atómica en la base, no una secuencia de pasos que puede quedarse a medias si
 * el navegador se cierra entre el paso 3 y el 4.
 *
 * Los pasos son de UX. La validación de verdad —correo de administrador, dominio
 * operador, acuerdo del canal, DEMO sin recurrente, fee de infraestructura sobre
 * un tenant compartido— la hace PostgreSQL, y el error se muestra tal cual.
 *
 * V3 · la venta es regional: cliente -> mercado -> moneda sugerida (o otra que
 * el mercado admita) -> plan -> tarifa DEL MERCADO -> suscripción. No hay
 * textbox de moneda ni USD por defecto, y sin tarifa regional no se avanza.
 */

export function OnboardingPage() {
  const wizard = useOnboardingWizard();
  const {
    navigate, perms, creation, mode, flow, created, step, setStep, stepIssue, setStepIssue, values, product, customer,
    manager, plan, market, isDemo, effectiveLicense, regionalPriceMissing, nextStep, submit,
  } = wizard;
  const isApp = mode === 'APP';
  const title = isApp ? 'Nuevo tenant' : 'Nueva venta / alta de cliente';

  if (isApp ? !perms.canManagePlatform : !perms.canManagePlatform && !perms.canManageCommercial) {
    return (
      <PageContainer title={title}>
        <Card>
          <EmptyState
            title={isApp ? 'Tu rol no puede crear tenants' : 'Tu rol no puede dar de alta clientes'}
            description={
              isApp
                ? 'Crear un tenant requiere un rol de plataforma de EBIM.'
                : 'El alta transaccional requiere un rol de plataforma o de finanzas de EBIM.'
            }
          />
        </Card>
      </PageContainer>
    );
  }

  const last = step === flow.steps.length;
  const tenantState =
    created && !isApp
      ? { onboarded: { subscriptionId: created.subscriptionId, productName: created.productCode, activated: created.activated } }
      : undefined;

  return (
    <PageContainer
      title={title}
      description={
        isApp
          ? 'Para una cuenta existente: elige la app, crea el tenant y dalo de alta en esa app, sin salir de aquí.'
          : 'Da de alta a un cliente de principio a fin: su cuenta, el plan con su precio y el contrato. Después, sin salir de aquí, emites la primera factura, envías el enlace de pago y activas sus apps.'
      }
      actions={isApp ? undefined : <Badge tone="info" dot>Infraestructura en simulación</Badge>}
    >
      <WizardStepper
        steps={flow.steps}
        phases={flow.phases}
        step={step}
        minStep={created ? flow.createStep + 1 : 1}
        onBack={(id) => {
          setStepIssue(null);
          setStep(id);
        }}
      />

      {created ? (
        <div
          className="ebim-card mb-4 flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-[color:var(--accent-action)] px-5 py-3"
          role="status"
          data-flow-created
        >
          <p className="text-body text-fg">
            <strong>{created.tenantName}</strong>{' '}
            {isApp ? 'se creó en' : 'y su contrato se crearon para'} {created.organizationName || 'la cuenta'}. Puedes seguir
            ahora o retomarlo desde la ficha de la cuenta.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link className="ebim-btn-ghost ebim-btn-sm" to={`/tenants/${created.tenantId}`} state={tenantState}>
              Ir a la ficha del tenant
            </Link>
            <Link className="ebim-btn-ghost ebim-btn-sm" to={`/organizations/${created.organizationId}`}>
              Ir a la ficha de la cuenta
            </Link>
          </div>
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-12">
      <div className={`min-w-0 ${isApp ? 'lg:col-span-12' : 'lg:col-span-8'}`}>
      <Card>
        <div className="p-5">
          {stepIssue ? (
            <p className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-compact font-semibold text-danger" role="alert">
              {stepIssue === 1
                ? 'Falta 1 dato para continuar: revisa el campo marcado.'
                : `Faltan ${stepIssue} datos para continuar: revisa los campos marcados.`}
            </p>
          ) : null}
          {step === 1 ? <CustomerStep wizard={wizard} /> : null}
          {step === 2 ? <TenantStep wizard={wizard} /> : null}
          {!isApp && step === 3 ? <PlanStep wizard={wizard} /> : null}
          {!isApp && step === 4 ? <CommercialStep wizard={wizard} /> : null}
          {!isApp && step === 5 ? <ConfirmStep wizard={wizard} /> : null}
          {created && !isApp && step === 6 ? <FirstInvoiceStep created={created} /> : null}
          {created && !isApp && step === 7 ? <PaymentLinkStep created={created} /> : null}
          {created && last ? <AppsStep created={created} onlyThisTenant={isApp} /> : null}

          {creation.error && !created ? (
            <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-compact text-danger" role="alert">
              {businessErrorMessage(creation.error)}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          {step === flow.createStep + 1 ? (
            <span />
          ) : (
            <button
              type="button" className="ebim-btn-ghost"
              onClick={() => {
                setStepIssue(null);
                if (step === 1) navigate(-1);
                else setStep((s) => s - 1);
              }}
              disabled={creation.isPending}
            >
              {step === 1 ? 'Cancelar' : 'Atrás'}
            </button>
          )}

          {step === flow.createStep && !created ? (
            <button
              type="button" className="ebim-btn-primary"
              onClick={() => void submit()} disabled={creation.isPending}
              aria-busy={creation.isPending || undefined}
            >
              {creation.isPending ? 'Creando…' : isApp ? 'Crear tenant' : 'Crear cliente'}
            </button>
          ) : last && created ? (
            <Link className="ebim-btn-primary" to={`/organizations/${created.organizationId}`}>
              Terminar
            </Link>
          ) : (
            <button type="button" className="ebim-btn-primary" onClick={() => void nextStep()}>
              Continuar
            </button>
          )}
        </div>
      </Card>
      </div>

      {isApp ? null : (
        <ContractSummary
          className="lg:col-span-4"
          customerName={customer?.display_name}
          productName={product?.lockup_name ?? product?.short_name}
          marketText={market ? `${market.name} (${market.code})` : undefined}
          currency={values.currency}
          modeText={DEPLOYMENT_MODE_LABEL[values.deployment_mode]}
          channelText={manager?.display_name ?? 'Venta directa EBIM'}
          tenantText={values.tenant_name || undefined}
          planName={plan?.name}
          intervalText={INTERVALS.find((i) => i.value === values.billing_interval)?.label}
          quantity={Number(values.quantity) || 1}
          license={isDemo ? null : effectiveLicense ?? null}
          licenseIsListed={!values.license_amount}
          isDemo={isDemo}
          implementationFee={values.implementation_fee ? Number(values.implementation_fee) : null}
          infrastructureFee={values.infrastructure_fee ? Number(values.infrastructure_fee) : null}
          supportFee={values.support_fee ? Number(values.support_fee) : null}
          regionalPriceMissing={regionalPriceMissing}
        />
      )}
      </div>
    </PageContainer>
  );
}
