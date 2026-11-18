import type { Database } from '@/types/database.types';

/**
 * Solicitudes de la web (leads.v1, migración 20261025000100). Lógica pura:
 * etiquetas, filtros y lo que se propone al convertir. Sin React ni consultas.
 */
export type LeadRow = Database['platform']['Tables']['commercial_leads']['Row'];
export type LeadStatus = 'NEW' | 'CONTACTED' | 'CONVERTED' | 'DISCARDED';
export type LeadTab = 'OPEN' | LeadStatus | 'ALL';

export const STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: 'Nueva',
  CONTACTED: 'Contactada',
  CONVERTED: 'Convertida',
  DISCARDED: 'Descartada',
};

export const STATUS_TONE: Record<LeadStatus, 'warn' | 'info' | 'ok' | 'neutral'> = {
  NEW: 'warn',
  CONTACTED: 'info',
  CONVERTED: 'ok',
  DISCARDED: 'neutral',
};

export const COUNTRY_LABEL: Record<string, string> = { PE: 'Perú', EC: 'Ecuador', BO: 'Bolivia' };

/** El nombre del plan sale del catálogo; si no está, el código tal cual. «No sé» viaja nulo. */
export function planLabel(code: string | null, plans: Array<{ code: string; name: string }>): string {
  if (!code) return 'Sin preferencia';
  return plans.find((p) => p.code === code)?.name ?? code;
}

export function asStatus(value: string): LeadStatus {
  return (['NEW', 'CONTACTED', 'CONVERTED', 'DISCARDED'] as const).includes(value as LeadStatus)
    ? (value as LeadStatus)
    : 'NEW';
}

/** «Abiertas» = lo que todavía espera a alguien: nuevas y contactadas. */
export function matchesTab(lead: Pick<LeadRow, 'status'>, tab: LeadTab): boolean {
  if (tab === 'ALL') return true;
  if (tab === 'OPEN') return lead.status === 'NEW' || lead.status === 'CONTACTED';
  return lead.status === tab;
}

export function tabOptions(leads: Array<Pick<LeadRow, 'status'>>): Array<{ id: LeadTab; label: string; count: number }> {
  const count = (tab: LeadTab) => leads.filter((l) => matchesTab(l, tab)).length;
  return [
    { id: 'OPEN', label: 'Abiertas', count: count('OPEN') },
    { id: 'NEW', label: 'Nuevas', count: count('NEW') },
    { id: 'CONTACTED', label: 'Contactadas', count: count('CONTACTED') },
    { id: 'CONVERTED', label: 'Convertidas', count: count('CONVERTED') },
    { id: 'DISCARDED', label: 'Descartadas', count: count('DISCARDED') },
    { id: 'ALL', label: 'Todas', count: leads.length },
  ];
}

/** Slug válido para `upsert_organization` (minúsculas, números y guiones, 2-48). */
export function slugFromCompany(company: string): string {
  const base = company
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return base.length >= 2 ? base : `cliente-${base || 'nuevo'}`;
}

/** Lo que se propone al crear el cliente desde una solicitud. Todo se puede corregir. */
export function organizationDraftFrom(lead: Pick<LeadRow, 'company_name' | 'country_code' | 'email'>) {
  return {
    slug: slugFromCompany(lead.company_name),
    legal_name: lead.company_name,
    display_name: lead.company_name,
    country_code: lead.country_code ?? '',
    billing_email: lead.email,
  };
}

/** «Nueva venta» con la cuenta y la solicitud: el asistente propone producto, plan, prueba y admin. */
export function onboardingUrl(lead: Pick<LeadRow, 'id' | 'organization_id'>): string {
  const q = new URLSearchParams({ solicitud: lead.id });
  if (lead.organization_id) q.set('cuenta', lead.organization_id);
  return `/onboarding?${q.toString()}`;
}

/** Antigüedad corta para la columna «Recibida». */
export function ageLabel(iso: string, now = new Date()): string {
  const min = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

/**
 * Lo que «Nueva venta» propone desde una solicitud: producto de la app de
 * origen, plan de interés (si es de ese producto), prueba, administrador y
 * país. La suscripción NO se activa: es una prueba y no se cobra todavía.
 */
export function leadPrefill(
  lead: Pick<LeadRow, 'saas_product_id' | 'plan_code' | 'email' | 'company_name' | 'country_code' | 'received_at'>,
  products: Array<{ id: string; code: string }>,
  plans: Array<{ id: string; code: string; saas_product_id: string | null }>,
  markets: Array<{ code: string }>,
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {
    tenant_type: 'TRIAL',
    tenant_name: lead.company_name,
    tenant_slug: slugFromCompany(lead.company_name),
    admin_email: lead.email,
    activate: false,
    notes: `Desde la solicitud de la web del ${new Date(lead.received_at).toLocaleDateString('es-PE')}.`,
  };
  const product = products.find((p) => p.id === lead.saas_product_id);
  if (product) out.saas_product_code = product.code;
  const plan = plans.find((p) => p.code === lead.plan_code && p.saas_product_id === lead.saas_product_id);
  if (plan) out.plan_id = plan.id;
  if (lead.country_code && markets.some((m) => m.code === lead.country_code)) out.market_code = lead.country_code;
  return out;
}

// ---------------------------------------------------------------------------
// Perfil comercial (20261026000100): quién mueve una solicitud y pruebas pedidas
// ---------------------------------------------------------------------------

export type TrialRequestBase = Database['platform']['Tables']['trial_requests']['Row'];
export type TrialRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export const TRIAL_REQUEST_LABEL: Record<TrialRequestStatus, string> = {
  PENDING: 'Por aprobar',
  APPROVED: 'Aprobada',
  REJECTED: 'Rechazada',
  CANCELLED: 'Retirada',
};

export const TRIAL_REQUEST_TONE: Record<TrialRequestStatus, 'warn' | 'ok' | 'danger' | 'neutral'> = {
  PENDING: 'warn',
  APPROVED: 'ok',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

export function asTrialStatus(value: string): TrialRequestStatus {
  return (['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const).includes(value as TrialRequestStatus)
    ? (value as TrialRequestStatus)
    : 'PENDING';
}

/**
 * ¿Puede ESTE comercial mover la solicitud? La base lo decide igual
 * (`set_commercial_lead_status`, `request_trial`): libre o tomada por él, y sin
 * convertir. EBIM (`canManageCommercial`) siempre puede.
 */
export function canWorkLead(
  lead: Pick<LeadRow, 'status' | 'owner_sales_agent_id'>,
  me: { canManageCommercial: boolean; salesAgentId: string | null },
): boolean {
  if (me.canManageCommercial) return true;
  if (!me.salesAgentId || lead.status === 'CONVERTED') return false;
  return !lead.owner_sales_agent_id || lead.owner_sales_agent_id === me.salesAgentId;
}

/** «Tomada por …»: el nombre propio, o «otro comercial» (RLS no deja ver el de otro). */
export function ownerLabel(
  lead: Pick<LeadRow, 'owner_sales_agent_id'> & { owner?: { full_name: string } | null },
  mySalesAgentId: string | null,
): string | null {
  if (!lead.owner_sales_agent_id) return null;
  if (lead.owner_sales_agent_id === mySalesAgentId) return 'Tomada por ti';
  return `Tomada por ${lead.owner?.full_name ?? 'otro comercial'}`;
}

/** Lo que el diálogo «Pedir prueba» propone desde una solicitud de la web. */
export function trialDraftFrom(
  lead: Pick<LeadRow, 'id' | 'saas_product_id' | 'plan_code' | 'company_name' | 'contact_name' | 'email' | 'country_code' | 'message'> | null,
  plans: Array<{ id: string; code: string; saas_product_id: string | null }>,
) {
  if (!lead) {
    return { leadId: null, productId: '', planId: '', companyName: '', contactName: '', adminEmail: '', countryCode: '', notes: '' };
  }
  const plan = plans.find((p) => p.code === lead.plan_code && p.saas_product_id === lead.saas_product_id);
  return {
    leadId: lead.id,
    productId: lead.saas_product_id,
    planId: plan?.id ?? '',
    companyName: lead.company_name,
    contactName: lead.contact_name,
    adminEmail: lead.email,
    countryCode: lead.country_code ?? '',
    notes: '',
  };
}

/** «Nueva venta» desde una prueba pedida: tenant TRIAL para ese cliente y el comercial atribuido. */
export function onboardingUrlForTrial(requestId: string, organizationId?: string | null): string {
  const q = new URLSearchParams({ prueba: requestId });
  if (organizationId) q.set('cuenta', organizationId);
  return `/onboarding?${q.toString()}`;
}

/**
 * Lo que «Nueva venta» propone desde una prueba pedida por un comercial: la
 * app, el plan, el tenant TRIAL, el administrador, el país y el comercial
 * (para que la atribución nazca con el alta). La suscripción NO se activa.
 */
export function trialRequestPrefill(
  req: Pick<TrialRequestBase, 'saas_product_id' | 'plan_id' | 'admin_email' | 'company_name' | 'country_code' | 'created_at' | 'sales_agent_id'>,
  products: Array<{ id: string; code: string }>,
  markets: Array<{ code: string }>,
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {
    tenant_type: 'TRIAL',
    tenant_name: req.company_name,
    tenant_slug: slugFromCompany(req.company_name),
    admin_email: req.admin_email,
    activate: false,
    sales_agent_id: req.sales_agent_id,
    notes: `Prueba pedida por el comercial el ${new Date(req.created_at).toLocaleDateString('es-PE')}.`,
  };
  const product = products.find((p) => p.id === req.saas_product_id);
  if (product) out.saas_product_code = product.code;
  if (req.plan_id) out.plan_id = req.plan_id;
  if (req.country_code && markets.some((m) => m.code === req.country_code)) out.market_code = req.country_code;
  return out;
}

/** Un recordatorio del comercial, como lo devuelve `my_sales_reminders()`. */
export interface SalesReminder {
  type: 'INVOICE_OVERDUE' | 'INVOICE_DUE_SOON' | 'RENEWAL' | 'TRIAL_ENDING' | 'TRIAL_EXPIRED' | 'TRIAL_APPROVED' | 'TRIAL_REJECTED';
  ref_id: string;
  title: string;
  organization_id: string | null;
  organization_name: string | null;
  product: string | null;
  date: string | null;
  amount: number | string | null;
  currency: string | null;
  tenant_id: string | null;
  note: string | null;
}
