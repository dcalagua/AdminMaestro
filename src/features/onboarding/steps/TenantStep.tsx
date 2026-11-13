import { TextField, SelectField, NumberField, FieldRow } from '@/components/ui/fields';
import { TENANT_TYPES } from '../onboardingForm';
import type { OnboardingWizard } from '../useOnboardingWizard';

/** Paso 2 · Canal, modelo de despliegue y tenant. */
export function TenantStep({ wizard }: { wizard: OnboardingWizard }) {
  const { orgs, form, values, agreement, allowedModes, targetOptions, mode } = wizard;
  const isApp = mode === 'APP';
  return (
    <div className="grid gap-4">
      <FieldRow>
        <SelectField
          label="Canal / partner que administra"
          placeholder="Venta directa EBIM (sin partner)"
          options={(orgs.data ?? []).map((o) => ({ value: o.id, label: o.display_name }))}
          hint="Necesita acuerdo activo con este producto o la base rechaza el alta."
          error={form.formState.errors.managing_organization_id}
          {...form.register('managing_organization_id')}
        />
        {isApp ? null : (
        <NumberField
          label="Margen del canal (%)" min={0} max={100} step="0.01"
          hint={
            agreement
              ? `Acuerdo vigente: ${(Number(agreement.margin_rate) * 100).toFixed(2)}%`
              : 'Snapshot que se guarda en la suscripción.'
          }
          error={form.formState.errors.channel_margin_pct}
          {...form.register('channel_margin_pct')}
        />
        )}
      </FieldRow>

      {values.managing_organization_id && !agreement ? (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-compact text-warn">
          Esta organización no tiene un acuerdo activo para {values.saas_product_code}. La
          base rechazará el alta con PARTNER_SIN_ACUERDO.
        </p>
      ) : null}

      <FieldRow>
        <SelectField
          label="Modelo de despliegue" options={allowedModes}
          hint={
            agreement
              ? 'Limitado a lo que autoriza el acuerdo del canal.'
              : 'Compartido aloja N tenants sobre la misma infraestructura.'
          }
          error={form.formState.errors.deployment_mode}
          {...form.register('deployment_mode')}
        />
        <SelectField
          label="Tipo de tenant" options={TENANT_TYPES}
          hint="DEMO no genera suscripción recurrente."
          error={form.formState.errors.tenant_type}
          {...form.register('tenant_type')}
        />
      </FieldRow>

      <FieldRow>
        <TextField
          label="Nombre del tenant" required placeholder="Alpha Producción"
          error={form.formState.errors.tenant_name} {...form.register('tenant_name')}
        />
        <TextField
          label="Código" required placeholder="alpha-prod"
          hint="Único dentro del producto."
          error={form.formState.errors.tenant_slug} {...form.register('tenant_slug')}
        />
      </FieldRow>

      <TextField
        label="Correo del administrador del cliente" required type="email"
        placeholder="admin@cliente.com"
        hint="Obligatorio. No puede ser del dominio operador."
        error={form.formState.errors.admin_email} {...form.register('admin_email')}
      />

      {!isApp && values.deployment_mode !== 'SHARED' ? (
        <SelectField
          label="Deployment target dedicado"
          placeholder="Crear más adelante (queda encolado)"
          options={targetOptions}
          hint="La base valida que el target sea del mismo modo, producto y dueño."
          error={form.formState.errors.deployment_target_id}
          {...form.register('deployment_target_id')}
        />
      ) : null}
    </div>
  );
}
