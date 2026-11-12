import {
  PageContainer, Card, EmptyState, Badge,
} from '@/components/ui/primitives';
import { ContractSummary, WizardStepper } from './OnboardingWizardParts';
import { businessErrorMessage } from '@/lib/pgError';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';
import { STEPS } from './onboardingSteps';
import { INTERVALS } from './onboardingForm';
import { useOnboardingWizard } from './useOnboardingWizard';
import { CustomerStep } from './steps/CustomerStep';
import { TenantStep } from './steps/TenantStep';
import { PlanStep } from './steps/PlanStep';
import { CommercialStep } from './steps/CommercialStep';
import { ConfirmStep } from './steps/ConfirmStep';

/**
 * Wizard «Nueva venta / alta de cliente» (Fase 05).
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
    navigate, perms, onboard, step, setStep, stepIssue, setStepIssue, values, product, customer,
    manager, plan, market, isDemo, effectiveLicense, regionalPriceMissing, nextStep, submit,
  } = wizard;

  if (!perms.canManagePlatform && !perms.canManageCommercial) {
    return (
      <PageContainer title="Nueva venta">
        <Card>
          <EmptyState
            title="Tu rol no puede dar de alta clientes"
            description="El alta transaccional requiere un rol de plataforma o de finanzas de EBIM."
          />
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title="Nueva venta / alta de cliente"
      description="Un solo envío crea tenant, suscripción, líneas, atribución y solicitud de provisioning dentro de la misma transacción de base de datos."
      actions={<Badge tone="info" dot>Infraestructura en simulación (DRY_RUN)</Badge>}
    >
      <WizardStepper
        step={step}
        onBack={(id) => {
          setStepIssue(null);
          setStep(id);
        }}
      />

      <div className="grid items-start gap-6 lg:grid-cols-12">
      <div className="min-w-0 lg:col-span-8">
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
          {step === 3 ? <PlanStep wizard={wizard} /> : null}
          {step === 4 ? <CommercialStep wizard={wizard} /> : null}
          {step === 5 ? <ConfirmStep wizard={wizard} /> : null}

          {onboard.error ? (
            <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-compact text-danger" role="alert">
              {businessErrorMessage(onboard.error)}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <button
            type="button" className="ebim-btn-ghost"
            onClick={() => {
              setStepIssue(null);
              if (step === 1) navigate(-1);
              else setStep((s) => s - 1);
            }}
            disabled={onboard.isPending}
          >
            {step === 1 ? 'Cancelar' : 'Atrás'}
          </button>

          {step < STEPS.length ? (
            <button type="button" className="ebim-btn-primary" onClick={() => void nextStep()}>
              Continuar
            </button>
          ) : (
            <button
              type="button" className="ebim-btn-primary"
              onClick={() => void submit()} disabled={onboard.isPending}
              aria-busy={onboard.isPending || undefined}
            >
              {onboard.isPending ? 'Creando…' : 'Crear cliente'}
            </button>
          )}
        </div>
      </Card>
      </div>

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
      </div>
    </PageContainer>
  );
}
