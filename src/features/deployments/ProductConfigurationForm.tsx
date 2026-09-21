import { useEffect, useMemo } from 'react';
import { useForm, type FieldErrors, type FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { TextField, CheckboxField } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';
import { useProvisioningAccess } from '@/hooks/useProvisioningAccess';
import { useEffectiveTenantConfig, useProfileFullNameByEmail, useTenant } from '@/services/queries';
import { useSetProvisioningConfiguration } from '@/services/mutations';
import { businessErrorMessage } from '@/lib/pgError';
import { contractAdapterFor } from './contractAdapters';

/** Estados en los que la base todavía acepta fijar la configuración. */
const CONFIGURABLE = ['PENDING', 'READY_TO_PROVISION', 'WAITING_INFRA'];

function valueAt(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
    source,
  );
}

function errorAt(errors: FieldErrors, path: string): { message?: string } | undefined {
  const found = valueAt(errors, path) as { message?: unknown } | undefined;
  return found && typeof found.message === 'string' ? { message: found.message } : undefined;
}

function display(value: unknown): string {
  if (value === true) return 'Sí';
  if (value === false) return 'No';
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

/**
 * «Datos de alta en el producto».
 *
 * Sólo aparece si el contrato de la integración los pide. Se fijan antes del
 * primer envío y después la base los congela: un reintento tiene que mandar el
 * mismo cuerpo. La moneda no se pide: la resuelve el servidor desde la sociedad.
 *
 * Ocultar o deshabilitar es UX; la autorización y la validación son de la base
 * y del orquestador.
 */
export function ProductConfigurationForm({ request }: { request: Record<string, unknown> }) {
  const descriptor = contractAdapterFor(request.adapter_key as string | null);
  if (!descriptor.configurationSchema) return null;
  return <ConfigurationPanel request={request} />;
}

function ConfigurationPanel({ request }: { request: Record<string, unknown> }) {
  const descriptor = contractAdapterFor(request.adapter_key as string | null);
  const schema = descriptor.configurationSchema!;
  const toast = useToast();
  const access = useProvisioningAccess();
  const save = useSetProvisioningConfiguration();

  const tenantId = request.tenant_id as string | undefined;
  const tenant = useTenant(tenantId);
  const adminEmail = (tenant.data as { admin_email?: string | null } | null | undefined)?.admin_email ?? null;
  const fullName = useProfileFullNameByEmail(adminEmail);
  const tenantConfig = useEffectiveTenantConfig(tenantId);

  const saved = (request.product_configuration ?? {}) as Record<string, unknown>;
  const hasSaved = Object.keys(saved).length > 0;
  const editable =
    Number(request.attempt_count ?? 0) === 0 &&
    CONFIGURABLE.includes(request.status as string) &&
    access.canForProduct('platform.provisioning.execute', request.saas_product_id as string);

  const timezone = valueAt(tenantConfig.data, 'locale.timezone');
  const defaults = useMemo(() => {
    if (hasSaved) {
      const { resolvedCurrency: _currency, ...rest } = saved;
      return rest;
    }
    return descriptor.prefill({
      fullName: (fullName.data as string | null | undefined) ?? null,
      timezone: typeof timezone === 'string' ? timezone : null,
    });
    // `saved` cambia de identidad en cada render; su contenido lo fija la clave.
  }, [hasSaved, JSON.stringify(saved), fullName.data, timezone, descriptor]);

  const form = useForm<FieldValues>({
    resolver: zodResolver(schema as never),
    defaultValues: defaults,
  });

  // Las precargas llegan de forma asíncrona: se aplican mientras el operador no
  // haya tocado el formulario.
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(defaults);
  }, [defaults, form]);

  const submit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync({ p_request_id: request.id as string, p_configuration: values as never });
      toast.success('Datos de alta guardados', 'Quedan congelados al primer envío');
    } catch (error) {
      toast.error('No se pudieron guardar los datos de alta', businessErrorMessage(error));
    }
  });

  return (
    <section className="mt-4" aria-label="Datos de alta en el producto">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
        Datos de alta en el producto
      </p>

      {editable ? (
        <form noValidate onSubmit={(e) => void submit(e)} className="space-y-3">
          {descriptor.fields.map((field) =>
            field.kind === 'checkbox' ? (
              <CheckboxField key={field.name} label={field.label} hint={field.hint} {...form.register(field.name)} />
            ) : (
              <TextField
                key={field.name}
                label={field.label}
                required={field.required}
                placeholder={field.placeholder}
                hint={field.hint}
                error={errorAt(form.formState.errors, field.name)}
                {...form.register(field.name)}
              />
            ),
          )}
          <p className="text-xs text-muted">
            La moneda la toma el servidor de la sociedad del tenant. Estos datos se congelan al
            primer envío.
          </p>
          <button type="submit" className="ebim-btn-secondary" disabled={save.isPending}>
            Guardar datos de alta
          </button>
        </form>
      ) : hasSaved ? (
        <dl className="space-y-1 text-[13px]">
          {descriptor.fields.map((field) => (
            <div key={field.name} className="flex justify-between gap-3">
              <dt className="text-muted">{field.label}</dt>
              <dd className="text-fg">{display(valueAt(saved, field.name))}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Moneda (congelada por el servidor)</dt>
            <dd className="text-fg">{display(saved.resolvedCurrency)}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-[13px] text-muted">
          Este producto necesita datos de alta que todavía no se han fijado.
        </p>
      )}
    </section>
  );
}
