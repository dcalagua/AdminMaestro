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
