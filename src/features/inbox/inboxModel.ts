import { allows, findNavItem, visibleTabs, type NavAccess } from '@/app/navigation';
import { formatDate, formatNumber } from '@/lib/format';
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
import type { SalesReminder } from '@/features/leads/leadsModel';

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

export type InboxKind =
  | 'reminder' | 'invoice' | 'alta' | 'health' | 'confirm' | 'trial-request' | 'lead' | 'document' | 'billing-alert' | 'settlement';

/** 1 = urgente · 2 = importante · 3 = normal. */
export type InboxPriority = 1 | 2 | 3;

export const PRIORITY_LABEL: Record<InboxPriority, string> = { 1: 'Urgente', 2: 'Importante', 3: 'Normal' };
export const PRIORITY_TONE: Record<InboxPriority, 'danger' | 'warn' | 'neutral'> = { 1: 'danger', 2: 'warn', 3: 'neutral' };

/** Orden de los grupos en la pantalla: primero el dinero y lo que está caído. */
export const KIND_ORDER: InboxKind[] = [
  'reminder', 'invoice', 'health', 'alta', 'confirm', 'trial-request', 'lead', 'billing-alert', 'document', 'settlement',
];

export const KIND_LABEL: Record<InboxKind, string> = {
  reminder: 'Recordatorios de tus clientes',
  invoice: 'Facturas vencidas',
  alta: 'Altas en las apps',
  health: 'Salud de las apps',
  confirm: 'Tenants por confirmar',
  'trial-request': 'Pruebas por aprobar',
  lead: 'Solicitudes de la web',
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
  /**
   * V6 · Importe del aviso (saldo vencido, total de la liquidación) en su
   * moneda nativa: la Bandeja lo pinta en su propia columna, compacto.
   */
  amount?: { value: number; currency: string } | null;
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
  /** Comercial con registro ACTIVO: recordatorios de lo suyo y solicitudes de la web. */
  isSalesAgent?: boolean;
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
    // Perfil comercial: todo comercial ve todas las solicitudes; EBIM aprueba sus pedidos de prueba.
    lead: (input.canManageCommercial || Boolean(input.isSalesAgent)) && entryVisible('/solicitudes', access),
    'trial-request': input.canManageCommercial && entryVisible('/solicitudes', access),
    // Lo suyo y nada más (my_sales_reminders): no son avisos operativos.
    reminder: Boolean(input.isSalesAgent),
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
  leads?: readonly InboxLead[];
  reminders?: readonly SalesReminder[];
  trialRequests?: readonly InboxTrialRequest[];
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
        detail: r.due_date ? `Venció el ${formatDate(r.due_date)}` : undefined,
        amount: r.currency ? { value: Number(r.balance), currency: r.currency } : null,
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
        detail: agent ?? undefined,
        amount: { value: Number(s.total_amount ?? 0), currency: s.currency },
        account: null,
        app: null,
        since,
        ageText: age(since, now),
        screen: { label: 'Abrir liquidaciones', to },
        action: { type: 'link' as const, label: approved ? 'Registrar pago…' : 'Aprobar…', to },
      };
    });
}

/** Solicitud de la web (leads.v1): lo que se lee de `commercial_leads`. */
export interface InboxLead {
  id: string;
  status: string;
  company_name: string;
  contact_name: string;
  received_at: string;
  organization_id: string | null;
  saas_products?: { short_name?: string | null } | null;
}

const DAY_MS = 24 * 3600 * 1000;

/** Solicitudes NUEVAS: un prospecto sin contestar se enfría; pasado un día, urgente. */
export function leadItems(rows: readonly InboxLead[], now: Date): InboxItem[] {
  return rows
    .filter((l) => l.status === 'NEW')
    .map((l) => {
      const old = now.getTime() - new Date(l.received_at).getTime() > DAY_MS;
      const to = '/solicitudes';
      return {
        key: `lead:${l.id}:NEW`,
        kind: 'lead' as const,
        priority: (old ? 1 : 2) as InboxPriority,
        title: `${l.company_name} pidió una prueba`,
        detail: l.contact_name,
        account: null,
        app: l.saas_products?.short_name ?? null,
        since: l.received_at,
        ageText: `recibida ${relativeAge(l.received_at, now)}`,
        screen: { label: 'Abrir solicitudes de la web', to },
        action: { type: 'link' as const, label: 'Contactar', to },
      };
    });
}

/** Pedido de prueba de un comercial, como lo lee EBIM de `trial_requests`. */
export interface InboxTrialRequest {
  id: string;
  status: string;
  company_name: string;
  created_at: string;
  saas_products?: { short_name?: string | null } | null;
  sales_agents?: { full_name?: string | null } | null;
}

/** Pedidos de prueba PENDIENTES: el comercial espera; pasado un día, urgente. */
export function trialRequestItems(rows: readonly InboxTrialRequest[], now: Date): InboxItem[] {
  return rows
    .filter((r) => r.status === 'PENDING')
    .map((r) => {
      const old = now.getTime() - new Date(r.created_at).getTime() > DAY_MS;
      const agent = r.sales_agents?.full_name ?? 'Un comercial';
      return {
        key: `trial-request:${r.id}:PENDING`,
        kind: 'trial-request' as const,
        priority: (old ? 1 : 2) as InboxPriority,
        title: `${agent} pidió una prueba para ${r.company_name}`,
        detail: 'Aprobar crea el cliente y el tenant de prueba',
        account: null,
        app: r.saas_products?.short_name ?? null,
        since: r.created_at,
        ageText: `pedida ${relativeAge(r.created_at, now)}`,
        screen: { label: 'Abrir solicitudes de la web', to: '/solicitudes' },
        action: { type: 'link' as const, label: 'Revisar', to: '/solicitudes' },
      };
    });
}

/**
 * Recordatorios del comercial (`my_sales_reminders`): cobros de sus clientes,
 * renovaciones, pruebas por vencer y la respuesta a sus pedidos de prueba.
 * Llevan a lo que el comercial PUEDE abrir: la ficha del cliente o del tenant.
 */
export function reminderItems(rows: readonly SalesReminder[], now: Date): InboxItem[] {
  return rows.map((r) => {
    const account = orgLink(r.organization_id, r.organization_name);
    const clientTo = r.organization_id ? `/organizations/${r.organization_id}` : '/';
    const tenantTo = r.tenant_id ? `/tenants/${r.tenant_id}` : clientTo;
    const amount = r.amount != null && r.currency ? { value: Number(r.amount), currency: r.currency } : null;
    const base = { key: `reminder:${r.type}:${r.ref_id}:${r.date ?? ''}`, kind: 'reminder' as const, account, app: r.product };
    switch (r.type) {
      case 'INVOICE_OVERDUE': {
        const days = r.date ? Math.max(1, Math.floor((now.getTime() - new Date(r.date).getTime()) / DAY_MS)) : 0;
        return {
          ...base, priority: (days > 30 ? 1 : 2) as InboxPriority, amount,
          title: `Factura ${r.title} vencida: recuérdale el pago`,
          detail: r.date ? `Venció el ${formatDate(r.date)}` : undefined,
          since: r.date, ageText: age(r.date, now),
          screen: { label: 'Abrir el cliente', to: clientTo },
          action: { type: 'link' as const, label: 'Ver cliente', to: clientTo },
        };
      }
      case 'INVOICE_DUE_SOON':
        return {
          ...base, priority: 3 as InboxPriority, amount,
          title: `Factura ${r.title} vence el ${r.date ? formatDate(r.date) : 'pronto'}`,
          detail: 'Buen momento para recordarle el pago',
          since: r.date, ageText: r.date ? `vence el ${formatDate(r.date)}` : 'sin fecha',
          screen: { label: 'Abrir el cliente', to: clientTo },
          action: { type: 'link' as const, label: 'Ver cliente', to: clientTo },
        };
      case 'RENEWAL':
        return {
          ...base, priority: 2 as InboxPriority,
          title: `Renovación del contrato ${r.title}`,
          detail: r.note ?? (r.date ? `Renueva el ${formatDate(r.date)}` : undefined),
          since: r.date, ageText: r.date ? `renueva el ${formatDate(r.date)}` : 'sin fecha',
          screen: { label: 'Abrir el cliente', to: clientTo },
          action: { type: 'link' as const, label: 'Ver cliente', to: clientTo },
        };
      case 'TRIAL_ENDING':
        return {
          ...base, priority: 2 as InboxPriority,
          title: `La prueba de ${r.title} vence el ${r.date ? formatDate(r.date) : 'pronto'}`,
          detail: 'Llámalo para cerrar la venta o pide a EBIM que la extienda',
          since: r.date, ageText: r.date ? `vence el ${formatDate(r.date)}` : 'sin fecha',
          screen: { label: 'Abrir el tenant', to: tenantTo },
          action: { type: 'link' as const, label: 'Ver tenant', to: tenantTo },
        };
      case 'TRIAL_EXPIRED':
        return {
          ...base, priority: 1 as InboxPriority,
          title: `La prueba de ${r.title} venció`,
          detail: 'La app ya no le deja operar: es el momento de cerrar la venta',
          since: r.date, ageText: age(r.date, now),
          screen: { label: 'Abrir el tenant', to: tenantTo },
          action: { type: 'link' as const, label: 'Ver tenant', to: tenantTo },
        };
      case 'TRIAL_APPROVED':
        return {
          ...base, priority: 3 as InboxPriority,
          title: `EBIM aprobó la prueba de ${r.title}`,
          detail: 'El administrador recibe la invitación de la app',
          since: r.date, ageText: age(r.date, now),
          screen: { label: 'Abrir el tenant', to: tenantTo },
          action: { type: 'link' as const, label: 'Ver tenant', to: tenantTo },
        };
      case 'TRIAL_REJECTED':
      default:
        return {
          ...base, priority: 2 as InboxPriority,
          title: `EBIM rechazó la prueba de ${r.title}`,
          detail: r.note ?? undefined,
          since: r.date, ageText: age(r.date, now),
          screen: { label: 'Abrir solicitudes de la web', to: '/solicitudes' },
          action: { type: 'link' as const, label: 'Ver pedido', to: '/solicitudes' },
        };
    }
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
  if (audience.reminder) items.push(...reminderItems(sources.reminders ?? [], now));
  if (audience['trial-request']) items.push(...trialRequestItems(sources.trialRequests ?? [], now));
  if (audience.lead) items.push(...leadItems(sources.leads ?? [], now));
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

/** Cifras de la franja de la Bandeja (V6): nunca suma monedas distintas. */
export interface InboxSummary {
  urgent: number;
  invoices: number;
  /** Saldo vencido por moneda de las facturas de la bandeja. */
  overdue: Record<string, number>;
  altas: number;
  failedAltas: number;
  alerts: number;
  approvals: number;
}

export function inboxSummary(items: readonly InboxItem[]): InboxSummary {
  const out: InboxSummary = { urgent: 0, invoices: 0, overdue: {}, altas: 0, failedAltas: 0, alerts: 0, approvals: 0 };
  for (const i of items) {
    if (i.priority === 1) out.urgent += 1;
    if (i.kind === 'invoice') {
      out.invoices += 1;
      if (i.amount && Number.isFinite(i.amount.value)) {
        out.overdue[i.amount.currency] = (out.overdue[i.amount.currency] ?? 0) + i.amount.value;
      }
    }
    if (i.kind === 'alta') {
      out.altas += 1;
      if (i.key.includes(':FAILED:')) out.failedAltas += 1;
    }
    if (i.kind === 'billing-alert') out.alerts += 1;
    if (i.kind === 'document' || i.kind === 'settlement') out.approvals += 1;
  }
  return out;
}
