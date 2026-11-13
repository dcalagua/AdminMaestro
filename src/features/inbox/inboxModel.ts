import { allows, findNavItem, visibleTabs, type NavAccess } from '@/app/navigation';
import { formatMoney, formatNumber } from '@/lib/format';
import {
  DEPLOYMENT_HEALTH_LABEL,
  canRetry,
  providerErrorLabel,
  type DeploymentHealth,
  type SaasProvisioningStatus,
} from '@/lib/provisioning';
import { isEvaluable } from '@/features/platform/targetHealth';
import {
  cellKind,
  latestRequestByTenant,
  relativeAge,
  type AppHealth,
  type ProvisioningRow,
  type TenantRow,
} from '@/features/suite/suiteModel';

/**
 * Bandeja (V5 · F5): todo lo que requiere una acción, calculado con datos que
 * YA existen (sin tablas nuevas). Lógica pura, sin React ni consultas: recibe
 * las filas que cada rol ya puede leer (RLS decide) y devuelve ítems con su
 * prioridad, cuenta/app, antigüedad y la acción directa.
 *
 * Un ítem se resuelve solo cuando el dato cambia: su clave incluye el estado
 * que lo hizo aparecer (una liquidación aprobada ya no es «por aprobar», una
 * salud verificada de nuevo es otra observación). «Hecho» sólo lo oculta en
 * este navegador; la clave nueva vuelve a aparecer.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type InboxKind = 'invoice' | 'alta' | 'health' | 'confirm' | 'document' | 'billing-alert' | 'settlement';

/** 1 = urgente · 2 = importante · 3 = normal. */
export type InboxPriority = 1 | 2 | 3;

export const PRIORITY_LABEL: Record<InboxPriority, string> = { 1: 'Urgente', 2: 'Importante', 3: 'Normal' };
export const PRIORITY_TONE: Record<InboxPriority, 'danger' | 'warn' | 'neutral'> = { 1: 'danger', 2: 'warn', 3: 'neutral' };

/** Orden de los grupos en la pantalla: primero el dinero y lo que está caído. */
export const KIND_ORDER: InboxKind[] = ['invoice', 'health', 'alta', 'confirm', 'billing-alert', 'document', 'settlement'];

export const KIND_LABEL: Record<InboxKind, string> = {
  invoice: 'Facturas vencidas',
  alta: 'Altas en las apps',
  health: 'Salud de las apps',
  confirm: 'Tenants por confirmar',
  document: 'Documentos por aprobar',
  'billing-alert': 'Renovaciones y alertas de cobranza',
  settlement: 'Liquidaciones de comisión',
};

export interface InboxLink {
  label: string;
  to: string;
}

/** La acción directa: un enlace a la pantalla de la acción o una acción en el sitio. */
export type InboxAction =
  | { type: 'link'; label: string; to: string }
  | { type: 'confirm-active'; label: string; tenantId: string; tenantName: string }
  | { type: 'execute-alta'; label: string; requestId: string; productId: string; tenantId: string; tenantName: string; productName: string }
  | { type: 'check-health'; label: string; targetId: string; productId: string; appName: string; appCode: string };

export interface InboxItem {
  /** Clave estable para «hecho»: incluye el estado que hizo aparecer el ítem. */
  key: string;
  kind: InboxKind;
  priority: InboxPriority;
  title: string;
  detail?: string;
  account?: { name: string; to?: string } | null;
  app?: string | null;
  /** Desde cuándo pide atención (ISO). `null` = nunca ocurrió (p. ej. nunca comprobada). */
  since: string | null;
  /** Antigüedad en texto: «vencida hace 12 días», «hace 3 horas». */
  ageText: string;
  /** La pantalla donde vive el ítem. */
  screen: InboxLink;
  action: InboxAction;
}

// ---------------------------------------------------------------------------
// Quién ve qué (UX; RLS decide las filas)
// ---------------------------------------------------------------------------

export type InboxAudience = Record<InboxKind, boolean>;

export interface AudienceInput {
  access: NavAccess;
  canManagePlatform: boolean;
  canManageCommercial: boolean;
  canReadFinance: boolean;
  /** Tiene algún alcance en el plano de provisioning (verificar salud). */
  hasProvisioningAccess: boolean;
}

function tabVisible(to: string, tabId: string, access: NavAccess): boolean {
  const item = findNavItem(to);
  return Boolean(item && allows(item, access) && visibleTabs(item, access).some((t) => t.id === tabId));
}

function entryVisible(to: string, access: NavAccess): boolean {
  const item = findNavItem(to);
  return Boolean(item && allows(item, access));
}

/**
 * Cada rol ve sólo lo suyo: el mismo criterio que el menú para la pantalla
 * de destino y, para lo que pide una acción, el permiso de esa acción.
 * Ocultar un tipo es UX; las consultas siguen filtradas por RLS.
 */
export function inboxAudience(input: AudienceInput): InboxAudience {
  const { access } = input;
  return {
    invoice: tabVisible('/cobranza', 'por-cobrar', access),
    'billing-alert': tabVisible('/cobranza', 'renovaciones', access),
    // En EBIM, las altas son de quien opera el plano de provisioning (finanzas no
    // las ejecuta); un partner ve las de sus clientes (RLS) para darles seguimiento.
    alta: tabVisible('/apps', 'altas', access) && (access.persona !== 'EBIM' || input.hasProvisioningAccess),
    health: entryVisible('/suite', access) && input.hasProvisioningAccess,
    confirm: input.canManagePlatform,
    document: input.canManageCommercial && entryVisible('/subscriptions', access),
    settlement: input.canReadFinance && tabVisible('/commissions', 'comisiones', access),
  };
}

// ---------------------------------------------------------------------------
// Filas de entrada (subconjuntos de las vistas: lo que el cálculo usa)
// ---------------------------------------------------------------------------

export interface InboxInvoice {
  invoice_id: string | null;
  number: string | null;
  customer_organization_id: string | null;
  organization_name: string | null;
  due_date: string | null;
  days_overdue: number | null;
  balance: number | string | null;
  currency: string | null;
}

export interface InboxAlert {
  id: string;
  alert_type: string;
  severity: string;
  title: string;
  message: string | null;
  created_at: string;
  due_at: string | null;
  invoice_id: string | null;
  subscription_id: string;
  subscriptions?: {
    code?: string | null;
    saas_products?: { short_name?: string | null } | null;
    organizations?: { display_name?: string | null } | null;
  } | null;
}

export interface InboxDocument {
  id: string;
  document_type: string;
  document_number: string | null;
  received_at: string | null;
  requested_at: string | null;
  subscription_id: string;
  subscriptions?: {
    code?: string | null;
    billed_organization_id?: string | null;
    saas_products?: { short_name?: string | null } | null;
    organizations?: { display_name?: string | null } | null;
  } | null;
}

export interface InboxSettlement {
  id: string;
  code: string;
  status: string;
  total_amount: number | string | null;
  currency: string;
  created_at: string;
  approved_at: string | null;
  sales_agents?: { full_name?: string | null } | null;
}

export interface InboxSources {
  invoices?: readonly InboxInvoice[];
  requests?: readonly ProvisioningRow[];
  tenants?: readonly TenantRow[];
  health?: readonly AppHealth[];
  alerts?: readonly InboxAlert[];
  documents?: readonly InboxDocument[];
  settlements?: readonly InboxSettlement[];
}

// ---------------------------------------------------------------------------
// Constructores por tipo
// ---------------------------------------------------------------------------

const age = (iso: string | null | undefined, now: Date) => (iso ? relativeAge(iso, now) : 'sin fecha');
const orgLink = (id: string | null | undefined, name: string | null | undefined) =>
  name ? { name, to: id ? `/organizations/${id}` : undefined } : null;

export function invoiceItems(rows: readonly InboxInvoice[]): InboxItem[] {
  return rows
    .filter((r) => r.invoice_id && (r.days_overdue ?? 0) > 0 && Number(r.balance ?? 0) > 0)
    .map((r) => {
      const days = r.days_overdue ?? 0;
      const to = `/cobranza?tab=por-cobrar${r.number ? `&pcq=${encodeURIComponent(r.number)}` : ''}`;
      return {
        key: `invoice:${r.invoice_id}`,
        kind: 'invoice' as const,
        priority: (days > 30 ? 1 : 2) as InboxPriority,
        title: `Factura ${r.number ?? 'sin número'} vencida`,
        detail: `Saldo ${formatMoney(Number(r.balance), r.currency)}`,
        account: orgLink(r.customer_organization_id, r.organization_name),
        since: r.due_date,
        ageText: `vencida hace ${formatNumber(days)} ${days === 1 ? 'día' : 'días'}`,
        screen: { label: 'Abrir en Por cobrar', to },
        action: { type: 'link' as const, label: 'Gestionar el cobro', to },
      };
    });
}

/** Altas fallidas o listas para ejecutar: sólo la ÚLTIMA solicitud de cada tenant × app. */
export function altaItems(requests: readonly ProvisioningRow[], now: Date): InboxItem[] {
  const out: InboxItem[] = [];
  for (const r of latestRequestByTenant(requests).values()) {
    const status = r.status as SaasProvisioningStatus | null;
    if (!r.id || !r.tenant_id || !r.saas_product_id) continue;
    const tenant = r.tenant_name ?? 'Tenant';
    const app = r.product_short_name ?? 'la app';
    const base = {
      kind: 'alta' as const,
      account: orgLink(r.customer_organization_id, r.customer_organization_name),
      app: r.product_short_name,
      screen: { label: 'Abrir Altas en las apps', to: '/apps?tab=altas' },
    };
    if (status === 'FAILED') {
      const since = r.updated_at ?? r.completed_at ?? r.requested_at;
      const retry = canRetry(status, r.attempt_count ?? 0, r.max_attempts ?? 0);
      out.push({
        ...base,
        key: `alta:${r.id}:FAILED:${r.attempt_count ?? 0}`,
        priority: 1,
        title: `Alta fallida de ${tenant} en ${app}`,
        detail: providerErrorLabel(r.last_error_code) ?? r.last_error_message ?? undefined,
        since,
        ageText: age(since, now),
        action: { type: 'link', label: retry ? 'Revisar y reintentar' : 'Revisar el alta', to: `/tenants/${r.tenant_id}` },
      });
    } else if (status === 'READY_TO_PROVISION') {
      const since = r.updated_at ?? r.requested_at;
      out.push({
        ...base,
        key: `alta:${r.id}:READY`,
        priority: 3,
        title: `Alta de ${tenant} en ${app} lista para ejecutar`,
        detail: 'La solicitud cumple las condiciones: falta ejecutarla.',
        since,
        ageText: age(since, now),
        action: {
          type: 'execute-alta',
          label: 'Ejecutar alta',
          requestId: r.id,
          productId: r.saas_product_id,
          tenantId: r.tenant_id,
          tenantName: tenant,
          productName: app,
        },
      });
    }
  }
  return out;
}

/** Tenants con alta ACTIVE en su app y «Pendiente» en el Admin Maestro. */
export function confirmItems(tenants: readonly TenantRow[], requests: readonly ProvisioningRow[], now: Date): InboxItem[] {
  const latest = latestRequestByTenant(requests);
  const out: InboxItem[] = [];
  for (const t of tenants) {
    if (!t.tenant_id || !t.saas_product_id) continue;
    const request = latest.get(`${t.tenant_id}:${t.saas_product_id}`);
    if (cellKind(t.status, request?.status) !== 'PENDING_CONFIRM') continue;
    const name = t.name ?? 'Tenant';
    const since = request?.completed_at ?? request?.updated_at ?? null;
    out.push({
      key: `confirm:${t.tenant_id}`,
      kind: 'confirm',
      priority: 2,
      title: `Confirmar ${name} como activo`,
      detail: 'Ya está activo en su app y sigue «Pendiente» aquí.',
      account: orgLink(t.customer_organization_id, t.customer_name),
      app: t.product_short_name,
      since,
      ageText: age(since, now),
      screen: { label: 'Abrir el tenant', to: `/tenants/${t.tenant_id}` },
      action: { type: 'confirm-active', label: 'Confirmar como activo', tenantId: t.tenant_id, tenantName: name },
    });
  }
  return out;
}

/** Apps caídas o degradadas, o con su última comprobación de hace más de 24 h. */
export function healthItems(health: readonly AppHealth[], now: Date): InboxItem[] {
  const out: InboxItem[] = [];
  for (const h of health) {
    const target = h.primary;
    if (!target?.deployment_target_id || !isEvaluable(target)) continue;
    const unhealthy = h.health === 'UNHEALTHY' || h.health === 'DEGRADED';
    if (!unhealthy && !h.stale) continue;
    const label = DEPLOYMENT_HEALTH_LABEL[h.health as DeploymentHealth] ?? 'Sin verificar';
    out.push({
      key: `health:${target.deployment_target_id}:${h.health}:${h.checkedAt ?? 'nunca'}`,
      kind: 'health',
      priority: h.health === 'UNHEALTHY' ? 1 : h.health === 'DEGRADED' ? 2 : 3,
      title: unhealthy ? `${h.app.name}: ${label.toLowerCase()}` : `${h.app.name}: comprobación vencida`,
      detail: unhealthy
        ? 'La última comprobación no fue saludable.'
        : h.checkedAt
          ? 'La última comprobación tiene más de 24 h.'
          : 'Nunca se comprobó la conexión con la app.',
      account: null,
      app: h.app.name,
      since: h.checkedAt,
      ageText: h.checkedAt ? `comprobada ${relativeAge(h.checkedAt, now)}` : 'nunca comprobada',
      screen: { label: 'Abrir la ficha de la app', to: `/apps/${h.app.code}` },
      action: {
        type: 'check-health',
        label: 'Verificar ahora',
        targetId: target.deployment_target_id,
        productId: h.app.id,
        appName: h.app.name,
        appCode: h.app.code,
      },
    });
  }
  return out;
}

const ALERT_LABEL: Record<string, string> = {
  REQUEST_DOCUMENT: 'Solicitar la orden de servicio o compra',
  RENEWAL_NOTICE: 'Renovación próxima',
  PAYMENT_DUE: 'Factura por vencer',
  PAST_DUE: 'Factura vencida',
  GRACE_ENDING: 'Termina el periodo de gracia',
  SUSPENSION_DUE: 'Suspensión pendiente',
  PAYMENT_FAILURE: 'Cobro fallido',
  DOCUMENT_EXPIRING: 'Documento por vencer',
};

const SEVERITY_PRIORITY: Record<string, InboxPriority> = { CRITICAL: 1, WARNING: 2, INFO: 3 };
const DOCUMENT_ALERTS = new Set(['REQUEST_DOCUMENT', 'DOCUMENT_EXPIRING']);
const INVOICE_ALERTS = new Set(['PAST_DUE', 'PAYMENT_DUE']);

/**
 * Alertas de cobranza abiertas (`billing_alerts`). Una alerta de factura
 * vencida cuya factura ya está en la bandeja no se repite.
 */
export function alertItems(alerts: readonly InboxAlert[], now: Date, invoiceIds: ReadonlySet<string> = new Set()): InboxItem[] {
  return alerts
    .filter((a) => !(INVOICE_ALERTS.has(a.alert_type) && a.invoice_id && invoiceIds.has(a.invoice_id)))
    .map((a) => {
      const sub = a.subscriptions;
      const renewals = '/cobranza?tab=renovaciones';
      const action: InboxAction = DOCUMENT_ALERTS.has(a.alert_type)
        ? { type: 'link', label: 'Gestionar el documento', to: `/subscriptions/${a.subscription_id}#collection` }
        : a.alert_type === 'RENEWAL_NOTICE'
          ? { type: 'link', label: 'Revisar la renovación', to: `${renewals}&ventana=30` }
          : { type: 'link', label: 'Gestionar el cobro', to: renewals };
      return {
        key: `alert:${a.id}`,
        kind: 'billing-alert' as const,
        priority: SEVERITY_PRIORITY[a.severity] ?? 3,
        title: `${ALERT_LABEL[a.alert_type] ?? a.title}${sub?.code ? ` · ${sub.code}` : ''}`,
        detail: a.message ?? a.title,
        account: sub?.organizations?.display_name ? { name: sub.organizations.display_name } : null,
        app: sub?.saas_products?.short_name ?? null,
        since: a.created_at,
        ageText: age(a.created_at, now),
        screen: { label: 'Abrir alertas de cobranza', to: renewals },
        action,
      };
    });
}

const DOCUMENT_LABEL: Record<string, string> = { SERVICE_ORDER: 'Orden de servicio', PURCHASE_ORDER: 'Orden de compra' };
const WEEK_MS = 7 * 24 * 3600 * 1000;

/** Órdenes de servicio o compra recibidas que esperan aprobación. */
export function documentItems(docs: readonly InboxDocument[], now: Date): InboxItem[] {
  return docs.map((d) => {
    const sub = d.subscriptions;
    const since = d.received_at ?? d.requested_at;
    const to = `/subscriptions/${d.subscription_id}#collection`;
    const old = since ? now.getTime() - new Date(since).getTime() > WEEK_MS : false;
    return {
      key: `document:${d.id}:RECEIVED`,
      kind: 'document' as const,
      priority: (old ? 2 : 3) as InboxPriority,
      title: `${DOCUMENT_LABEL[d.document_type] ?? 'Documento'}${d.document_number ? ` ${d.document_number}` : ''} por aprobar`,
      detail: sub?.code ? `Contrato ${sub.code}` : undefined,
      account: orgLink(sub?.billed_organization_id, sub?.organizations?.display_name),
      app: sub?.saas_products?.short_name ?? null,
      since,
      ageText: since ? `recibido ${relativeAge(since, now)}` : 'sin fecha',
      screen: { label: 'Abrir el contrato', to },
      action: { type: 'link' as const, label: 'Revisar y aprobar', to },
    };
  });
}

/** Liquidaciones abiertas (por aprobar) y aprobadas (por pagar). */
export function settlementItems(rows: readonly InboxSettlement[], now: Date): InboxItem[] {
  const to = '/commissions?tab=comisiones#liquidaciones';
  return rows
    .filter((s) => s.status === 'OPEN' || s.status === 'APPROVED')
    .map((s) => {
      const approved = s.status === 'APPROVED';
      const since = approved ? (s.approved_at ?? s.created_at) : s.created_at;
      const agent = s.sales_agents?.full_name;
      return {
        key: `settlement:${s.id}:${s.status}`,
        kind: 'settlement' as const,
        priority: (approved ? 2 : 3) as InboxPriority,
        title: `Liquidación ${s.code} ${approved ? 'por pagar' : 'por aprobar'}`,
        detail: [agent, formatMoney(Number(s.total_amount ?? 0), s.currency)].filter(Boolean).join(' · '),
        account: null,
        app: null,
        since,
        ageText: age(since, now),
        screen: { label: 'Abrir liquidaciones', to },
        action: { type: 'link' as const, label: approved ? 'Registrar pago…' : 'Aprobar…', to },
      };
    });
}

// ---------------------------------------------------------------------------
// Bandeja completa
// ---------------------------------------------------------------------------

/** Más urgente primero; a igual prioridad, lo que lleva más tiempo esperando. */
export function byUrgency(a: InboxItem, b: InboxItem): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const ta = a.since ? new Date(a.since).getTime() : -Infinity;
  const tb = b.since ? new Date(b.since).getTime() : -Infinity;
  if (ta !== tb) return ta - tb;
  return a.key.localeCompare(b.key);
}

/** Todos los ítems que el rol ve, del más urgente al menos. */
export function buildInbox(sources: InboxSources, audience: InboxAudience, now: Date = new Date()): InboxItem[] {
  const items: InboxItem[] = [];
  const invoices = audience.invoice ? invoiceItems(sources.invoices ?? []) : [];
  items.push(...invoices);
  if (audience.alta) items.push(...altaItems(sources.requests ?? [], now));
  if (audience.confirm) items.push(...confirmItems(sources.tenants ?? [], sources.requests ?? [], now));
  if (audience.health) items.push(...healthItems(sources.health ?? [], now));
  if (audience['billing-alert']) {
    const ids = new Set(invoices.map((i) => i.key.slice('invoice:'.length)));
    items.push(...alertItems(sources.alerts ?? [], now, ids));
  }
  if (audience.document) items.push(...documentItems(sources.documents ?? [], now));
  if (audience.settlement) items.push(...settlementItems(sources.settlements ?? [], now));
  return items.sort(byUrgency);
}

export function countByKind(items: readonly InboxItem[]): Record<InboxKind, number> {
  const out = Object.fromEntries(KIND_ORDER.map((k) => [k, 0])) as Record<InboxKind, number>;
  for (const i of items) out[i.kind] += 1;
  return out;
}

/** Búsqueda simple sobre título, cuenta, app y detalle (sin tildes). */
export function matchesInbox(item: InboxItem, term: string): boolean {
  const norm = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const t = norm(term.trim());
  if (!t) return true;
  return [item.title, item.detail, item.account?.name, item.app].some((f) => f && norm(f).includes(t));
}

/** Adónde lleva un aviso al tocarlo: su acción si es un enlace, si no, su pantalla. */
export function inboxTarget(item: Pick<InboxItem, 'action' | 'screen'>): string {
  return item.action.type === 'link' ? item.action.to : item.screen.to;
}
