import { z } from 'zod';
import { isOperatorDomain } from '@/features/auth/session';

/**
 * Formulario del alta (Nueva venta): esquema zod, opciones y campos que valida
 * cada paso antes de avanzar. Sin estado ni UI.
 */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const schema = z
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
    message: 'El dominio operador ebim.pe no puede administrar un tenant cliente',
  })
  .refine((v) => v.deployment_mode !== 'PARTNER_DEDICATED' || Boolean(v.managing_organization_id), {
    path: ['managing_organization_id'],
    message: 'Un tenant Dedicado partner necesita el partner que lo administra',
  })
  .refine((v) => v.deployment_mode !== 'SHARED' || !v.infrastructure_fee, {
    path: ['infrastructure_fee'],
    message: 'Un fee de infraestructura dedicada no aplica a un tenant compartido',
  });

export type FormValues = z.input<typeof schema>;

export const MODES = [
  { value: 'SHARED', label: 'Compartido' },
  { value: 'PARTNER_DEDICATED', label: 'Dedicado partner' },
  { value: 'TENANT_DEDICATED', label: 'Dedicado cliente' },
];

export const TENANT_TYPES = [
  { value: 'PRODUCTION', label: 'Producción' },
  { value: 'TRIAL', label: 'Trial' },
  { value: 'DEMO', label: 'Demo (sin recurrente)' },
  { value: 'SANDBOX', label: 'Sandbox' },
];

export const INTERVALS = [
  { value: 'MONTHLY', label: 'Mensual' },
  { value: 'QUARTERLY', label: 'Trimestral' },
  { value: 'YEARLY', label: 'Anual' },
  { value: 'ONE_TIME', label: 'Pago único' },
];

export const SOURCES = [
  { value: 'DIRECT', label: 'Venta directa' },
  { value: 'PARTNER', label: 'Por partner' },
  { value: 'REFERRAL', label: 'Referido' },
  { value: 'INBOUND', label: 'Inbound' },
  { value: 'CAMPAIGN', label: 'Campaña' },
];

/** Campos que deben estar limpios antes de dejar avanzar cada paso. */
export const STEP_FIELDS: Record<number, Array<keyof FormValues>> = {
  1: ['customer_organization_id', 'market_code', 'saas_product_code'],
  2: ['deployment_mode', 'tenant_type', 'tenant_slug', 'tenant_name', 'admin_email', 'managing_organization_id'],
  3: ['plan_id', 'billing_interval', 'currency', 'quantity', 'started_on'],
  4: ['implementation_fee', 'infrastructure_fee', 'support_fee', 'attribution_pct'],
  5: [],
};
