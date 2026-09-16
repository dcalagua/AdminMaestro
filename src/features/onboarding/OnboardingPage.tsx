import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useProducts, useOrganizations, usePlans, usePartnerAgreements, useSalesAgents,
  useCommissionPlans, useDeploymentTargets, useMarkets, usePlanPriceCatalog,
} from '@/services/queries';
import { MarketSelectField, CurrencySelectField } from '@/components/ui/regional-fields';
import {
  allowedCurrenciesFor, currencyForMarket, findMarket, planHasRegionalPrice,
  resolveRegionalPrice, suggestedMarketForCountry,
} from '@/lib/regional';
import { useOnboardCustomer } from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/components/ui/toast-context';
import {
  PageContainer, Card, StatCard, EmptyState, Badge,
} from '@/components/ui/primitives';
import {
  TextField, SelectField, NumberField, TextAreaField, CheckboxField, FieldRow,
} from '@/components/ui/fields';
import { businessErrorMessage } from '@/lib/pgError';
import { isOperatorDomain } from '@/features/auth/session';
import { formatMoney } from '@/lib/format';
import { DEPLOYMENT_MODE_LABEL } from '@/types/domain';

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

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const schema = z
  .object({
    // 1 · Cliente y mercado
    customer_organization_id: z.string().uuid('Elige el cliente'),
    market_code: z.string().min(1, 'Elige el mercado'),
    // 2 · Producto
    saas_product_code: z.string().min(1, 'Elige el producto'),
    // 3 · Canal
    managing_organization_id: z.string().optional(),
    channel_margin_pct: z.coerce.number().min(0).max(100).optional(),
    // 4 · Modelo y tenant
    deployment_mode: z.enum(['SHARED', 'PARTNER_DEDICATED', 'TENANT_DEDICATED']),
    tenant_type: z.enum(['PRODUCTION', 'TRIAL', 'DEMO', 'SANDBOX']),
    tenant_slug: z.string().trim().regex(SLUG, 'Minúsculas, números y guiones'),
    tenant_name: z.string().trim().min(2, 'Obligatorio'),
    admin_email: z.string().trim().email('Correo inválido'),
    deployment_target_id: z.string().optional(),
    // 5 · Plan y licencia
    plan_id: z.string().uuid('Elige el plan'),
    billing_interval: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME']),
    currency: z.string().regex(/^[A-Z]{3}$/, 'Elige la moneda'),
    quantity: z.coerce.number().int().min(1),
    started_on: z.string().min(1, 'Obligatorio'),
    license_amount: z.string().trim().optional(),
    // 6 · Implementación y addons
    implementation_fee: z.string().trim().optional(),
    infrastructure_fee: z.string().trim().optional(),
    support_fee: z.string().trim().optional(),
    // 7 · Comercial
    sales_agent_id: z.string().optional(),
    commission_plan_id: z.string().optional(),
    attribution_pct: z.coerce.number().min(1).max(100),
    attribution_source: z.enum(['DIRECT', 'PARTNER', 'REFERRAL', 'INBOUND', 'CAMPAIGN']),
    // 8 · Cierre
    activate: z.boolean(),
    notes: z.string().trim().optional(),
  })
  .refine((v) => !isOperatorDomain(v.admin_email), {
    path: ['admin_email'],
    message: 'El dominio operador ebim.pe no puede administrar un tenant cliente (contrato §13.2)',
  })
  .refine((v) => v.deployment_mode !== 'PARTNER_DEDICATED' || Boolean(v.managing_organization_id), {
    path: ['managing_organization_id'],
    message: 'Un tenant Dedicado partner necesita el partner que lo administra',
  })
  .refine((v) => v.deployment_mode !== 'SHARED' || !v.infrastructure_fee, {
    path: ['infrastructure_fee'],
    message: 'Un fee de infraestructura dedicada no aplica a un tenant compartido',
  });

type FormValues = z.input<typeof schema>;

const STEPS = [
  { id: 1, label: 'Cliente, mercado y producto' },
  { id: 2, label: 'Canal y modelo' },
  { id: 3, label: 'Plan y precio regional' },
  { id: 4, label: 'Implementación y comercial' },
  { id: 5, label: 'Resumen' },
] as const;

const MODES = [
  { value: 'SHARED', label: 'Compartido' },
  { value: 'PARTNER_DEDICATED', label: 'Dedicado partner' },
  { value: 'TENANT_DEDICATED', label: 'Dedicado cliente' },
];

const TENANT_TYPES = [
  { value: 'PRODUCTION', label: 'Producción' },
  { value: 'TRIAL', label: 'Trial' },
  { value: 'DEMO', label: 'Demo (sin recurrente)' },
  { value: 'SANDBOX', label: 'Sandbox' },
];

const INTERVALS = [
  { value: 'MONTHLY', label: 'Mensual' },
  { value: 'QUARTERLY', label: 'Trimestral' },
  { value: 'YEARLY', label: 'Anual' },
  { value: 'ONE_TIME', label: 'Pago único' },
];

const SOURCES = [
  { value: 'DIRECT', label: 'Venta directa' },
  { value: 'PARTNER', label: 'Por partner' },
  { value: 'REFERRAL', label: 'Referido' },
  { value: 'INBOUND', label: 'Inbound' },
  { value: 'CAMPAIGN', label: 'Campaña' },
];

/** Campos que deben estar limpios antes de dejar avanzar cada paso. */
const STEP_FIELDS: Record<number, Array<keyof FormValues>> = {
  1: ['customer_organization_id', 'market_code', 'saas_product_code'],
  2: ['deployment_mode', 'tenant_type', 'tenant_slug', 'tenant_name', 'admin_email', 'managing_organization_id'],
  3: ['plan_id', 'billing_interval', 'currency', 'quantity', 'started_on'],
  4: ['implementation_fee', 'infrastructure_fee', 'support_fee', 'attribution_pct'],
  5: [],
};

export function OnboardingPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const perms = usePermissions();
  const onboard = useOnboardCustomer();

  const products = useProducts();
  const orgs = useOrganizations();
  const plans = usePlans();
  const agreements = usePartnerAgreements();
  const agents = useSalesAgents();
  const commissionPlans = useCommissionPlans();
  const targets = useDeploymentTargets();
  const markets = useMarkets();
  const priceCatalog = usePlanPriceCatalog();
  const marketList = useMemo(() => markets.data ?? [], [markets.data]);

  const [step, setStep] = useState(1);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      customer_organization_id: '', saas_product_code: '',
      managing_organization_id: '', channel_margin_pct: 0,
      deployment_mode: 'SHARED', tenant_type: 'PRODUCTION',
      tenant_slug: '', tenant_name: '', admin_email: '', deployment_target_id: '',
      market_code: '',
      plan_id: '', billing_interval: 'MONTHLY', currency: '', quantity: 1,
      started_on: new Date().toISOString().slice(0, 10), license_amount: '',
      implementation_fee: '', infrastructure_fee: '', support_fee: '',
      sales_agent_id: '', commission_plan_id: '', attribution_pct: 100,
      attribution_source: 'DIRECT',
      activate: true, notes: '',
    },
  });

  const values = form.watch();

  const product = (products.data ?? []).find((p) => p.code === values.saas_product_code);
  const customer = (orgs.data ?? []).find((o) => o.id === values.customer_organization_id);
  const manager = (orgs.data ?? []).find((o) => o.id === values.managing_organization_id);
  const plan = (plans.data ?? []).find((p) => p.id === values.plan_id);
  const market = findMarket(marketList, values.market_code);

  // Mercado sugerido por el país del cliente, solo si es inequívoco y el usuario
  // aún no eligió otro. Cambiar de cliente no pisa una elección explícita.
  useEffect(() => {
    if (form.getFieldState('market_code').isDirty) return;
    const suggested = suggestedMarketForCountry(marketList, customer?.country_code);
    if (suggested && suggested !== form.getValues('market_code')) {
      form.setValue('market_code', suggested);
    }
  }, [customer?.country_code, marketList]);

  // La moneda es siempre una admitida por el mercado; por defecto, la sugerida.
  useEffect(() => {
    const current = form.getValues('currency');
    const next = currencyForMarket(marketList, values.market_code, current);
    if (next !== current) form.setValue('currency', next);
  }, [values.market_code, marketList]);

  /** Acuerdo vigente del canal para ESTE producto: acota los modos ofrecidos. */
  const agreement = useMemo(
    () =>
      (agreements.data ?? []).find(
        (a) =>
          a.organization_id === values.managing_organization_id &&
          a.product_code === values.saas_product_code &&
          a.status === 'ACTIVE',
      ),
    [agreements.data, values.managing_organization_id, values.saas_product_code],
  );

  const allowedModes = useMemo(() => {
    if (!values.managing_organization_id) return MODES;
    const allowed = (agreement?.allowed_deployment_modes ?? []) as string[];
    // Sin acuerdo cargado todavía no se restringe: la base tiene la última palabra.
    if (allowed.length === 0) return MODES;
    return MODES.filter((m) => allowed.includes(m.value));
  }, [agreement, values.managing_organization_id]);

  const priceRows = priceCatalog.data ?? [];
  const planOptions = (plans.data ?? [])
    .filter((p) => !product || p.saas_product_id === product.id)
    .filter((p) => !p.deployment_mode || p.deployment_mode === values.deployment_mode)
    .filter((p) => !p.is_partner_base)
    .map((p) => ({
      value: p.id,
      label:
        values.market_code && values.currency &&
        !planHasRegionalPrice(priceRows, p.id, values.market_code, values.currency, values.started_on)
          ? `${p.name} — sin tarifa ${values.market_code}/${values.currency}`
          : p.name,
    }));

  const targetOptions = (targets.data ?? [])
    .filter((t) => t.deployment_mode === values.deployment_mode)
    .filter((t) => !product || t.saas_product_id === product.id || t.saas_product_id === null)
    .map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` }));

  /**
   * Tarifa regional vigente: plan + mercado + moneda + periodicidad a la fecha
   * de inicio. Misma resolución que `current_plan_price` en la base.
   */
  const listedPrice = useMemo(
    () =>
      resolveRegionalPrice(priceRows, {
        planId: values.plan_id,
        marketCode: values.market_code,
        currency: values.currency,
        billingInterval: values.billing_interval,
        chargeKinds: ['LICENSE', 'TENANT_LICENSE'],
        asOf: values.started_on,
      }),
    [priceRows, values.plan_id, values.market_code, values.currency, values.billing_interval, values.started_on],
  );

  /** Fee de implementación de lista en la MISMA moneda contractual (sugerencia, no obligación). */
  const listedImplementationFee = useMemo(
    () =>
      resolveRegionalPrice(priceRows, {
        planId: values.plan_id,
        marketCode: values.market_code,
        currency: values.currency,
        billingInterval: 'ONE_TIME',
        chargeKinds: ['IMPLEMENTATION_FEE'],
        asOf: values.started_on,
      }),
    [priceRows, values.plan_id, values.market_code, values.currency, values.started_on],
  );

  const isDemo = values.tenant_type === 'DEMO';
  const isRecurringSale = !isDemo && values.billing_interval !== 'ONE_TIME';
  const effectiveLicense = values.license_amount ? Number(values.license_amount) : listedPrice;
  const regionalPriceMissing = Boolean(
    values.plan_id && values.market_code && values.currency && isRecurringSale && listedPrice === null,
  );

  async function nextStep() {
    const fields = STEP_FIELDS[step] ?? [];
    const ok = await form.trigger(fields as never);
    if (!ok) return;
    // Sin tarifa regional no hay venta recurrente: la base lo rechazaría con
    // TARIFA_REGIONAL_NO_DEFINIDA. Se corta aquí para no llegar al resumen.
    if (step === 3 && regionalPriceMissing) {
      form.setError('plan_id', {
        type: 'regional-price',
        message: `El plan no tiene tarifa vigente en ${values.market_code}/${values.currency} para esa periodicidad. Publícala en el catálogo o elige otra moneda.`,
      });
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length));
  }

  const submit = form.handleSubmit(async (raw) => {
    const v = schema.parse(raw);
    try {
      const result = (await onboard.mutateAsync({
        p_saas_product_code: v.saas_product_code,
        p_customer_organization_id: v.customer_organization_id,
        p_tenant_slug: v.tenant_slug,
        p_tenant_name: v.tenant_name,
        p_admin_email: v.admin_email,
        p_plan_id: v.plan_id,
        p_billing_interval: v.billing_interval,
        p_market_code: v.market_code,
        p_currency: v.currency,
        p_tenant_type: v.tenant_type,
        p_deployment_mode: v.deployment_mode,
        p_managing_organization_id: v.managing_organization_id || undefined,
        p_started_on: v.started_on,
        p_quantity: v.quantity,
        p_license_amount: v.license_amount ? Number(v.license_amount) : undefined,
        p_implementation_fee: v.implementation_fee ? Number(v.implementation_fee) : undefined,
        p_infrastructure_fee: v.infrastructure_fee ? Number(v.infrastructure_fee) : undefined,
        p_support_fee: v.support_fee ? Number(v.support_fee) : undefined,
        p_channel_margin_rate: v.channel_margin_pct ? Number(v.channel_margin_pct) / 100 : undefined,
        p_sales_agent_id: v.sales_agent_id || undefined,
        p_commission_plan_id: v.commission_plan_id || undefined,
        p_attribution_pct: Number(v.attribution_pct) / 100,
        p_attribution_source: v.attribution_source,
        // Cobranza: la Fase 07 añade el perfil. Aquí no se presupone tarjeta.
        p_provisioning_mode: 'DRY_RUN',
        p_deployment_target_id: v.deployment_target_id || undefined,
        p_activate: v.activate,
        p_notes: v.notes || undefined,
      })) as { tenant_id?: string } | null;

      toast.success('Alta completada', `${v.tenant_name} se creó de forma transaccional.`);
      if (result?.tenant_id) navigate(`/tenants/${result.tenant_id}`);
      else navigate('/tenants');
    } catch {
      /* el error de la base se muestra bajo los botones */
    }
  });

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
      actions={<Badge tone="info">Provisioning en DRY_RUN</Badge>}
    >
      {/* Progreso */}
      <ol className="mb-5 flex flex-wrap gap-2" aria-label="Pasos del alta">
        {STEPS.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              // Solo se puede volver atrás: avanzar exige pasar la validación del paso.
              disabled={s.id > step}
              onClick={() => setStep(s.id)}
              className={`rounded-field px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                s.id === step
                  ? 'bg-accent text-[color:var(--accent-fg)]'
                  : s.id < step
                    ? 'bg-accent-soft text-accent-deep'
                    : 'text-muted'
              }`}
              aria-current={s.id === step ? 'step' : undefined}
            >
              {s.id}. {s.label}
            </button>
          </li>
        ))}
      </ol>

      <Card>
        <div className="p-5">
          {step === 1 ? (
            <div className="grid gap-4">
              <SelectField
                label="Organización cliente" required placeholder="Elige el cliente…"
                options={(orgs.data ?? []).map((o) => ({ value: o.id, label: o.display_name }))}
                hint="Quien recibe el servicio. Puede facturarse a ella o al canal según el acuerdo."
                error={form.formState.errors.customer_organization_id}
                {...form.register('customer_organization_id')}
              />
              <MarketSelectField
                markets={marketList} required label="País / mercado de la venta"
                hint={
                  market
                    ? `Moneda sugerida: ${market.defaultCurrency}. Admitidas: ${market.allowedCurrencies.join(', ')}.`
                    : 'Se sugiere por el país del cliente. Decide la tarifa y las monedas admitidas.'
                }
                error={form.formState.errors.market_code}
                {...form.register('market_code')}
              />
              <SelectField
                label="Producto SaaS" required placeholder="Elige el producto…"
                options={(products.data ?? [])
                  .filter((p) => p.status === 'ACTIVE')
                  .map((p) => ({ value: p.code, label: `${p.short_name} (${p.code})` }))}
                error={form.formState.errors.saas_product_code}
                {...form.register('saas_product_code')}
              />
            </div>
          ) : null}

          {step === 2 ? (
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
              </FieldRow>

              {values.managing_organization_id && !agreement ? (
                <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
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
                  label="Slug" required placeholder="alpha-prod"
                  hint="Único dentro del producto."
                  error={form.formState.errors.tenant_slug} {...form.register('tenant_slug')}
                />
              </FieldRow>

              <TextField
                label="Correo del administrador del cliente" required type="email"
                placeholder="admin@cliente.com"
                hint="Obligatorio por contrato §3.2. No puede ser del dominio operador."
                error={form.formState.errors.admin_email} {...form.register('admin_email')}
              />

              {values.deployment_mode !== 'SHARED' ? (
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
          ) : null}

          {step === 3 ? (
            <div className="grid gap-4">
              <SelectField
                label="Plan" required placeholder="Elige el plan…" options={planOptions}
                hint={
                  planOptions.length === 0
                    ? 'No hay planes para ese producto y modelo. Créalo primero en el catálogo.'
                    : 'Solo se listan planes del producto y modelo elegidos.'
                }
                error={form.formState.errors.plan_id} {...form.register('plan_id')}
              />

              <FieldRow>
                <SelectField
                  label="Periodicidad" options={INTERVALS}
                  error={form.formState.errors.billing_interval}
                  {...form.register('billing_interval')}
                />
                <CurrencySelectField
                  required
                  currencies={allowedCurrenciesFor(marketList, values.market_code)}
                  suggested={market?.defaultCurrency}
                  hint={`Moneda contractual en ${market?.name ?? 'el mercado'}: licencia, fees, facturas y cobros la heredan.`}
                  error={form.formState.errors.currency} {...form.register('currency')}
                />
              </FieldRow>

              <FieldRow>
                <NumberField
                  label="Cantidad" required min={1} step={1}
                  error={form.formState.errors.quantity} {...form.register('quantity')}
                />
                <TextField
                  label="Inicio" type="date" required
                  error={form.formState.errors.started_on} {...form.register('started_on')}
                />
              </FieldRow>

              <TextField
                label="Importe de la licencia" type="number" min={0} step="0.01"
                placeholder={listedPrice !== null ? String(listedPrice) : 'Sin tarifa regional'}
                disabled={listedPrice === null}
                hint={
                  listedPrice !== null
                    ? `Tarifa ${values.market_code}/${values.currency}: ${formatMoney(listedPrice, values.currency)}. Vacío = tarifa; un importe = precio negociado sobre esa tarifa.`
                    : isRecurringSale
                      ? 'Sin tarifa regional no se puede fijar un importe: la base no crea contratos sin tarifa.'
                      : 'Una venta sin recurrente no usa licencia.'
                }
                error={form.formState.errors.license_amount}
                {...form.register('license_amount')}
              />

              {regionalPriceMissing ? (
                <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn" role="alert">
                  {plan?.name} no tiene tarifa vigente en {values.market_code}/{values.currency} (
                  {values.billing_interval}). No se puede continuar: la base rechazaría la venta con
                  TARIFA_REGIONAL_NO_DEFINIDA.
                </p>
              ) : null}

              {isDemo ? (
                <p className="rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
                  El tenant es DEMO: no se creará ninguna línea de licencia recurrente. Solo se
                  generará contrato si añades cargos únicos en el paso siguiente.
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 4 ? (
            <div className="grid gap-4">
              <FieldRow>
                <TextField
                  label={`Fee de implementación${values.currency ? ` (${values.currency})` : ''}`}
                  type="number" min={0} step="0.01"
                  placeholder={listedImplementationFee !== null ? String(listedImplementationFee) : '0'}
                  hint={
                    listedImplementationFee !== null
                      ? `Tarifa ${values.market_code}/${values.currency}: ${formatMoney(listedImplementationFee, values.currency)}. Pago único, misma moneda del contrato.`
                      : 'Pago único en la moneda del contrato: no infla el MRR.'
                  }
                  error={form.formState.errors.implementation_fee}
                  {...form.register('implementation_fee')}
                />
                <TextField
                  label="Fee de infraestructura" type="number" min={0} step="0.01"
                  placeholder="0"
                  hint={
                    values.deployment_mode === 'SHARED'
                      ? 'No aplica a un tenant compartido.'
                      : 'Recurrente, porque el costo de la infraestructura lo es.'
                  }
                  disabled={values.deployment_mode === 'SHARED'}
                  error={form.formState.errors.infrastructure_fee}
                  {...form.register('infrastructure_fee')}
                />
              </FieldRow>

              <TextField
                label="Fee de soporte / SLA" type="number" min={0} step="0.01" placeholder="0"
                error={form.formState.errors.support_fee} {...form.register('support_fee')}
              />

              <hr className="border-border" />

              <FieldRow>
                <SelectField
                  label="Comercial" placeholder="Sin atribución comercial"
                  options={(agents.data ?? []).map((a) => ({
                    value: a.id, label: `${a.full_name} (${a.code})`,
                  }))}
                  hint="Atribuir una venta NO da acceso operativo al tenant."
                  error={form.formState.errors.sales_agent_id}
                  {...form.register('sales_agent_id')}
                />
                <SelectField
                  label="Plan de comisión" placeholder="Sin plan (no devenga)"
                  options={(commissionPlans.data ?? []).map((p) => ({
                    value: p.id, label: p.name,
                  }))}
                  error={form.formState.errors.commission_plan_id}
                  {...form.register('commission_plan_id')}
                />
              </FieldRow>

              <FieldRow>
                <NumberField
                  label="Participación del comercial (%)" min={1} max={100} step={1}
                  error={form.formState.errors.attribution_pct}
                  {...form.register('attribution_pct')}
                />
                <SelectField
                  label="Origen de la venta" options={SOURCES}
                  error={form.formState.errors.attribution_source}
                  {...form.register('attribution_source')}
                />
              </FieldRow>

              <p className="rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
                <strong>Cobranza:</strong> el método de cobro se configura por suscripción en la
                pestaña «Cobranza» del detalle. Hasta entonces la suscripción queda sin perfil, que
                equivale a cobro manual: no se presupone tarjeta.
              </p>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <StatCard label="Cliente" value={customer?.display_name ?? '—'} />
                <StatCard label="Producto" value={product?.short_name ?? '—'} />
                <StatCard
                  label="Modelo"
                  value={DEPLOYMENT_MODE_LABEL[values.deployment_mode] ?? '—'}
                />
                <StatCard
                  label={isDemo ? 'MRR (demo)' : 'MRR estimado'}
                  value={
                    isDemo || !effectiveLicense
                      ? formatMoney(0, values.currency)
                      : formatMoney(effectiveLicense * Number(values.quantity), values.currency)
                  }
                  tone={isDemo ? 'neutral' : 'ok'}
                  hint={isDemo ? 'Un DEMO no genera recurrente' : 'Sin contar cargos únicos'}
                />
              </div>

              <Card title="Lo que se creará en una sola transacción">
                <dl className="divide-y divide-border">
                  {[
                    ['Tenant', `${values.tenant_name} (${values.tenant_slug})`],
                    ['Administrador del cliente', values.admin_email],
                    ['Tipo', values.tenant_type],
                    ['Canal', manager?.display_name ?? 'Venta directa EBIM'],
                    ['Mercado', market ? `${market.name} (${market.code})` : '—'],
                    ['Moneda contractual', values.currency || '—'],
                    ['Plan', plan?.name ?? '—'],
                    [
                      'Licencia',
                      isDemo
                        ? 'No aplica (tenant DEMO)'
                        : effectiveLicense
                          ? `${formatMoney(effectiveLicense, values.currency)} / ${values.billing_interval}`
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
                    ['Provisioning de infraestructura', 'Solicitud DRY_RUN encolada'],
                    [
                      'Alta en el producto SaaS',
                      'No se realiza aquí (política por defecto: manual)',
                    ],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                      <dt className="text-muted">{k}</dt>
                      <dd className="text-right font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
              </Card>

              {/*
                Aviso explícito y deliberado. Cerrar una venta NO crea el tenant
                dentro del producto: son dos decisiones distintas y la segunda
                tiene su propia política (manual, al activar la suscripción, o al
                confirmarse el pago), configurable por integración y por destino.
                Provisionar al cotizar sería regalar el producto.
              */}
              <Card title="Qué NO hace este alta">
                <div className="px-4 py-3 text-sm text-muted">
                  <p>
                    Este formulario crea el <strong>contrato comercial</strong>: tenant,
                    suscripción, líneas y atribución. <strong>No</strong> da de alta al cliente
                    dentro del SaaS.
                  </p>
                  <p className="mt-2">
                    Esa alta se decide en{' '}
                    <Link to="/saas-provisioning" className="ebim-link">
                      Infraestructura → Provisioning SaaS
                    </Link>
                    , según la política configurada en la integración del producto. El valor por
                    defecto es <strong>manual</strong> hasta que el contrato de cada producto esté
                    certificado.
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
          ) : null}

          {onboard.error ? (
            <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {businessErrorMessage(onboard.error)}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <button
            type="button" className="ebim-btn-ghost"
            onClick={() => (step === 1 ? navigate(-1) : setStep((s) => s - 1))}
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
            >
              {onboard.isPending ? 'Creando…' : 'Crear cliente'}
            </button>
          )}
        </div>
      </Card>
    </PageContainer>
  );
}
