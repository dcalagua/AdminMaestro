import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/primitives';
import { TextAreaField, CheckboxField } from '@/components/ui/fields';
import { formatMoney } from '@/lib/format';
import { INTERVALS, TENANT_TYPES } from '../onboardingForm';
import type { OnboardingWizard } from '../useOnboardingWizard';

/** Paso 5 · Confirmación: lo que se creará en una sola transacción. */
export function ConfirmStep({ wizard }: { wizard: OnboardingWizard }) {
  const { agents, form, values, manager, plan, market, isDemo, effectiveLicense } = wizard;
  return (
    <div className="grid gap-4">
      <Card title="Lo que se creará en una sola transacción">
        <dl className="divide-y divide-border">
          {[
            ['Tenant', `${values.tenant_name} (${values.tenant_slug})`],
            ['Administrador del cliente', values.admin_email],
            ['Tipo', TENANT_TYPES.find((t) => t.value === values.tenant_type)?.label ?? values.tenant_type],
            ['Canal', manager?.display_name ?? 'Venta directa EBIM'],
            ['Mercado', market ? `${market.name} (${market.code})` : '—'],
            ['Moneda contractual', values.currency || '—'],
            ['Plan', plan?.name ?? '—'],
            [
              'Licencia',
              isDemo
                ? 'No aplica (tenant DEMO)'
                : effectiveLicense
                  ? `${formatMoney(effectiveLicense, values.currency)} · ${INTERVALS.find((i) => i.value === values.billing_interval)?.label.toLowerCase() ?? values.billing_interval}`
                  : 'Sin importe',
            ],
            [
              'Implementación (única)',
              values.implementation_fee
                ? formatMoney(Number(values.implementation_fee), values.currency)
                : '—',
            ],
            [
              'Infraestructura',
              values.infrastructure_fee
                ? formatMoney(Number(values.infrastructure_fee), values.currency)
                : '—',
            ],
            [
              'Soporte / SLA',
              values.support_fee
                ? formatMoney(Number(values.support_fee), values.currency)
                : '—',
            ],
            [
              'Atribución comercial',
              values.sales_agent_id
                ? `${(agents.data ?? []).find((a) => a.id === values.sales_agent_id)?.full_name} · ${values.attribution_pct}%`
                : 'Sin atribución',
            ],
            ['Infraestructura', 'Solicitud encolada en simulación'],
            [
              'Alta en el producto SaaS',
              'Último paso de este flujo, sólo con tu confirmación',
            ],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-5 py-2.5 text-body">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/*
        Aviso explícito y deliberado. Cerrar una venta NO crea el tenant
        dentro del producto: son dos decisiones distintas y la segunda tiene
        su propia política (manual, al activar la suscripción, o al
        confirmarse el pago), configurable por integración y por destino.
        Dar el alta en la app al cotizar sería regalar el producto.
      */}
      <Card title="Qué NO hace este envío">
        <div className="px-5 py-4 text-body text-fg-2">
          <p>
            «Crear cliente» crea el <strong>contrato comercial</strong>: tenant, suscripción, líneas y atribución.{' '}
            <strong>No</strong> da de alta al cliente dentro de la app.
          </p>
          <p className="mt-2">
            Después siguen la primera factura, el enlace de pago y, al final, el <strong>alta en las apps</strong>: cada
            paso con su propio botón y la política de alta de cada app (por defecto, manual). También se puede hacer
            luego desde{' '}
            <Link to="/apps?tab=altas" className="ebim-link">
              Suite → Apps → Altas en las apps
            </Link>
            .
          </p>
        </div>
      </Card>

      <CheckboxField
        label="Activar la suscripción al crearla"
        hint="Si se deja sin marcar, queda en BORRADOR para revisión."
        {...form.register('activate')}
      />

      <TextAreaField
        label="Notas de la venta"
        error={form.formState.errors.notes} {...form.register('notes')}
      />
    </div>
  );
}
