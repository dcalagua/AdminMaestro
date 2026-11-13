import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  useProducts, useOrganizations, usePlans, usePartnerAgreements, useSalesAgents,
  useCommissionPlans, useDeploymentTargets, useMarkets, usePlanPriceCatalog,
} from '@/services/queries';
import {
  currencyForMarket,
  findMarket,
  planHasRegionalPrice,
  resolveRegionalPrice,
  suggestedMarketForCountry,
} from '@/lib/regional';
import { useCreateTenant, useOnboardCustomer } from '@/services/mutations';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/components/ui/toast-context';
import { MODES, STEP_FIELDS, schema, type FormValues } from './onboardingForm';
import { flowFor, type FlowMode } from './flowModel';

/** Lo que quedó creado al cerrar la venta (o el tenant): alimenta los pasos siguientes. */
export interface CreatedSale {
  tenantId: string;
  tenantName: string;
  organizationId: string;
  organizationName: string;
  billingEmail: string | null;
  productId: string;
  productName: string;
  productCode: string;
  subscriptionId: string | null;
  /** `PARTNER_STATEMENT`: lo factura el partner, EBIM no emite factura al cliente. */
  billingChannel: string | null;
  currency: string;
  activated: boolean;
}

/** «Nuevo tenant» (modo app): sólo los campos que pide `create_tenant`. */
const APP_STEP_FIELDS: Record<number, Array<keyof FormValues>> = {
  1: ['customer_organization_id', 'saas_product_code'],
  2: STEP_FIELDS[2] ?? [],
};

/**
 * Estado y reglas del flujo guiado de alta (V5 · F4): consultas, formulario,
 * mercado y moneda sugeridos, tarifa regional vigente y avance por pasos.
 *
 * - Venta (`/onboarding`): el contrato sale de UN envío a
 *   `onboard_customer_subscription()`; después siguen primera factura, enlace
 *   de pago y alta en las apps, cada uno con su acción explícita.
 * - «Nuevo tenant» (`/onboarding?modo=app`, opcional `&cuenta=<id>`): cuenta
 *   existente → tenant con `create_tenant()` → alta en esa app.
 *
 * La pantalla y cada paso solo pintan.
 */
export function useOnboardingWizard() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const toast = useToast();
  const perms = usePermissions();
  const onboard = useOnboardCustomer();
  const createTenant = useCreateTenant();
  const [mode] = useState<FlowMode>(() => (params.get('modo') === 'app' ? 'APP' : 'SALE'));
  const flow = flowFor(mode);
  const [created, setCreated] = useState<CreatedSale | null>(null);

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
  /** Aviso del paso: cuántos campos faltan cuando «Continuar» no deja avanzar. */
  const [stepIssue, setStepIssue] = useState<number | null>(null);
  // Cerrojo síncrono contra el doble clic: `isPending` sólo se activa cuando la
  // mutación arranca, DESPUÉS de la validación asíncrona del formulario.
  const submitting = useRef(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      customer_organization_id: params.get('cuenta') ?? '', saas_product_code: '',
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

  const fieldsFor = (n: number) => (mode === 'APP' ? APP_STEP_FIELDS[n] : STEP_FIELDS[n]) ?? [];

  /** Valida los campos del paso; si falta algo, dice cuántos. */
  async function validStep(n: number): Promise<boolean> {
    const fields = fieldsFor(n);
    const ok = await form.trigger(fields as never);
    if (!ok) {
      const errors = form.formState.errors as Record<string, unknown>;
      setStepIssue(fields.filter((f) => errors[f as string]).length || 1);
      return false;
    }
    setStepIssue(null);
    return true;
  }

  async function nextStep() {
    // Después de crear, avanzar no valida nada: cada paso tiene su propia acción.
    if (step > flow.createStep) {
      setStep((s) => Math.min(s + 1, flow.steps.length));
      return;
    }
    if (!(await validStep(step))) return;
    // Sin tarifa regional no hay venta recurrente: la base lo rechazaría con
    // TARIFA_REGIONAL_NO_DEFINIDA. Se corta aquí para no llegar al resumen.
    if (mode === 'SALE' && step === 3 && regionalPriceMissing) {
      form.setError('plan_id', {
        type: 'regional-price',
        message: `El plan no tiene tarifa vigente en ${values.market_code}/${values.currency} para esa periodicidad. Publícala en el catálogo o elige otra moneda.`,
      });
      return;
    }
    setStep((s) => Math.min(s + 1, flow.steps.length));
  }

  function baseCreated(tenantId: string, v: FormValues): CreatedSale {
    return {
      tenantId,
      tenantName: v.tenant_name,
      organizationId: v.customer_organization_id,
      organizationName: customer?.display_name ?? '',
      billingEmail: (customer as { billing_email?: string | null } | undefined)?.billing_email ?? null,
      productId: product?.id ?? '',
      productName: product?.short_name ?? v.saas_product_code,
      productCode: v.saas_product_code,
      subscriptionId: null,
      billingChannel: null,
      currency: v.currency,
      activated: false,
    };
  }

  const submitOnce = form.handleSubmit(async (raw) => {
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
      })) as {
        tenant_id?: string;
        subscription_id?: string | null;
        billing_channel?: string | null;
        currency?: string;
      } | null;

      if (!result?.tenant_id) {
        toast.success('Cliente creado', `${v.tenant_name} se creó de forma transaccional.`);
        navigate('/tenants');
        return;
      }
      // El flujo sigue aquí: primera factura, enlace de pago y alta en las apps.
      // Nada de eso se ejecuta solo; cada paso tiene su botón.
      setCreated({
        ...baseCreated(result.tenant_id, raw),
        subscriptionId: result.subscription_id ?? null,
        billingChannel: result.billing_channel ?? null,
        currency: result.currency ?? v.currency,
        activated: v.activate,
      });
      toast.success('Cliente creado', `${v.tenant_name}: contrato listo. Sigue con la primera factura.`);
      setStep(flow.createStep + 1);
    } catch {
      /* el error de la base se muestra bajo los botones */
    }
  });

  /** Modo «Nuevo tenant»: `create_tenant()` para una cuenta existente, sin contrato. */
  async function submitTenant() {
    if (!(await validStep(flow.createStep))) return;
    const v = form.getValues();
    try {
      const tenantId = await createTenant.mutateAsync({
        p_saas_product_code: v.saas_product_code,
        p_customer_organization_id: v.customer_organization_id,
        p_slug: v.tenant_slug.trim(),
        p_name: v.tenant_name.trim(),
        p_admin_email: v.admin_email.trim(),
        p_tenant_type: v.tenant_type,
        p_deployment_mode: v.deployment_mode,
        p_managing_organization_id: v.managing_organization_id || undefined,
      });
      setCreated(baseCreated(tenantId, v));
      toast.success('Tenant creado', `${v.tenant_name} queda pendiente hasta su alta en la app.`);
      setStep(flow.createStep + 1);
    } catch {
      /* el error de la base se muestra bajo los botones */
    }
  }

  async function submit() {
    if (submitting.current || created) return;
    submitting.current = true;
    try {
      if (mode === 'APP') await submitTenant();
      else await submitOnce();
    } finally {
      submitting.current = false;
    }
  }

  /** La operación de creación del modo actual (para estado ocupado y error). */
  const creation = mode === 'APP' ? createTenant : onboard;

  return {
    navigate,
    toast,
    perms,
    onboard,
    creation,
    mode,
    flow,
    created,
    products,
    orgs,
    agents,
    commissionPlans,
    marketList,
    step,
    setStep,
    stepIssue,
    setStepIssue,
    form,
    values,
    product,
    customer,
    manager,
    plan,
    market,
    agreement,
    allowedModes,
    planOptions,
    targetOptions,
    listedPrice,
    listedImplementationFee,
    isDemo,
    isRecurringSale,
    effectiveLicense,
    regionalPriceMissing,
    nextStep,
    submit,
  };
}

export type OnboardingWizard = ReturnType<typeof useOnboardingWizard>;
