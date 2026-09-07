import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useBillingContactReadiness } from '@/services/queries';
import { useSetBillingContact } from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, Badge, LoadingState } from '@/components/ui/primitives';
import { FormDialog } from '@/components/ui/FormDialog';
import { TextField, FieldRow } from '@/components/ui/fields';
import { useToast } from '@/components/ui/toast-context';

/**
 * Datos de facturación del titular.
 *
 * POR QUÉ ESTA PANTALLA EXISTE
 * ----------------------------
 * La pasarela exige siete campos para dar de alta al Customer: nombre,
 * apellido, correo, domicilio, ciudad, país y teléfono. El Control Plane solo
 * tenía correo y país.
 *
 * La salida fácil habría sido que el servidor rellenara los cinco que faltan
 * con literales ("Lima", "N/A", "999999999"). No se hace: esos datos viajan al
 * proveedor, salen impresos en el recibo del cliente y aparecen en la
 * conciliación del comercio. Un domicilio inventado no es un atajo técnico, es
 * un dato falso en un documento fiscal.
 *
 * Así que se piden aquí, se validan aquí, y si falta alguno el alta del cobro
 * se detiene diciendo exactamente cuál. Los nombres de campo que muestra esta
 * tarjeta salen de la vista, no de una lista repetida en el cliente.
 */

const CAMPOS: Record<string, string> = {
  billing_first_name: 'Nombre del titular',
  billing_last_name: 'Apellido del titular',
  billing_email: 'Correo de facturación',
  billing_address: 'Domicilio',
  billing_city: 'Ciudad',
  billing_phone: 'Teléfono',
  country_code: 'País',
};

// Los límites replican los de la migración 23, que a su vez replican los
// medidos contra la pasarela. Validar aquí ahorra un viaje; la autoridad sigue
// siendo el CHECK de la base.
const schema = z.object({
  first_name: z.string().trim().min(2, 'Entre 2 y 50 caracteres').max(50, 'Máximo 50 caracteres'),
  last_name: z.string().trim().min(2, 'Entre 2 y 50 caracteres').max(50, 'Máximo 50 caracteres'),
  email: z.string().trim().email('Correo inválido'),
  address: z.string().trim().min(5, 'Entre 5 y 100 caracteres').max(100, 'Máximo 100 caracteres'),
  city: z.string().trim().min(2, 'Entre 2 y 30 caracteres').max(30, 'Máximo 30 caracteres'),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9]{5,15}$/, 'Solo dígitos, entre 5 y 15 (ej. 51987654321)'),
});

type FormValues = z.infer<typeof schema>;

export function BillingContactPanel({ organizationId }: { organizationId: string }) {
  const readiness = useBillingContactReadiness(organizationId);
  const save = useSetBillingContact();
  const perms = usePermissions();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { first_name: '', last_name: '', email: '', address: '', city: '', phone: '' },
  });

  const data = readiness.data;

  useEffect(() => {
    if (!open || !data) return;
    save.reset();
    form.reset({
      first_name: data.billing_first_name ?? '',
      last_name: data.billing_last_name ?? '',
      email: data.billing_email ?? '',
      address: data.billing_address ?? '',
      city: data.billing_city ?? '',
      phone: data.billing_phone ?? '',
    });
    // Se recarga al abrir el diálogo y cuando cambian los datos del servidor.
  }, [open, data]);

  const submit = form.handleSubmit(async (values) => {
    try {
      await save.mutateAsync({
        p_organization_id: organizationId,
        p_first_name: values.first_name,
        p_last_name: values.last_name,
        p_email: values.email,
        p_address: values.address,
        p_city: values.city,
        p_phone: values.phone,
      });
      toast.success('Datos de facturación actualizados');
      setOpen(false);
    } catch {
      // El error de la base se muestra dentro del diálogo.
    }
  });

  const missing = (data?.missing_fields ?? []) as string[];
  const ready = data?.ready_for_card_payment === true;

  return (
    <Card
      title="Datos de facturación del titular"
      description="Los exige la pasarela para domiciliar el cobro. No se rellenan automáticamente: salen en el recibo del cliente."
      actions={
        readiness.isLoading ? null : (
          <Badge tone={ready ? 'ok' : 'warn'}>
            {ready ? 'Completos' : `Faltan ${missing.length}`}
          </Badge>
        )
      }
    >
      {readiness.isLoading ? (
        <LoadingState label="Comprobando datos de facturación…" />
      ) : (
        <>
          <dl className="divide-y divide-border">
            {[
              ['Titular', [data?.billing_first_name, data?.billing_last_name].filter(Boolean).join(' ')],
              ['Correo', data?.billing_email],
              ['Domicilio', data?.billing_address],
              ['Ciudad', data?.billing_city],
              ['País', data?.country_code],
              ['Teléfono', data?.billing_phone],
            ].map(([label, value]) => (
              <div
                key={label as string}
                className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm"
              >
                <dt className="text-muted">{label as string}</dt>
                <dd className="text-right font-medium">
                  {value ? (
                    (value as string)
                  ) : (
                    <span className="text-warn">Pendiente</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          {!ready ? (
            <div className="border-t border-border px-4 py-3">
              <p className="text-sm text-muted">
                Mientras falten estos datos, el alta de cobro con tarjeta se detiene con el error{' '}
                <span className="font-mono text-xs">DATOS_FACTURACION_INCOMPLETOS</span>. No es un
                fallo de la pantalla: es la pasarela, que no crea el cliente sin ellos.
              </p>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted">
                {missing.map((f) => (
                  <li key={f}>{CAMPOS[f] ?? f}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {perms.canManageCommercial ? (
            <div className="border-t border-border px-4 py-3">
              <button type="button" className="ebim-btn-primary" onClick={() => setOpen(true)}>
                {ready ? 'Editar datos de facturación' : 'Completar datos de facturación'}
              </button>
            </div>
          ) : null}
        </>
      )}

      <FormDialog
        open={open}
        title="Datos de facturación del titular"
        description="Se envían a la pasarela tal cual para crear el cliente. Deben ser los reales del contrato."
        submitLabel="Guardar"
        busy={save.isPending}
        error={save.error}
        onSubmit={() => void submit()}
        onCancel={() => setOpen(false)}
        wide
      >
        <FieldRow>
          <TextField
            label="Nombre"
            required
            placeholder="María"
            error={form.formState.errors.first_name}
            {...form.register('first_name')}
          />
          <TextField
            label="Apellido"
            required
            placeholder="Quispe"
            error={form.formState.errors.last_name}
            {...form.register('last_name')}
          />
        </FieldRow>
        <TextField
          label="Correo de facturación"
          required
          placeholder="facturacion@empresa.pe"
          error={form.formState.errors.email}
          {...form.register('email')}
        />
        <TextField
          label="Domicilio"
          required
          placeholder="Av. Javier Prado Este 4200, Of. 501"
          hint="Entre 5 y 100 caracteres. Es el domicilio fiscal que verá el cliente en su recibo."
          error={form.formState.errors.address}
          {...form.register('address')}
        />
        <FieldRow>
          <TextField
            label="Ciudad"
            required
            placeholder="Lima"
            error={form.formState.errors.city}
            {...form.register('city')}
          />
          <TextField
            label="Teléfono"
            required
            placeholder="51987654321"
            hint="Solo dígitos, con prefijo de país y sin espacios ni guiones."
            error={form.formState.errors.phone}
            {...form.register('phone')}
          />
        </FieldRow>
      </FormDialog>
    </Card>
  );
}
