/**
 * Lectura humana de la bitácora (fase 12, PT-TIMELINE): el código de acción
 * (`INVOICE_ISSUED`) se presenta como frase en español («Emisión de factura») y
 * se clasifica por tipo para elegir el icono de la línea de tiempo.
 *
 * Solo presentación: el código original se sigue mostrando (pequeño, en mono) y
 * se exporta tal cual. Un código desconocido no se inventa: queda el código.
 * La frase se arma como «<verbo nominalizado> de <sujeto>» para no depender del
 * género del sustantivo.
 */

export type AuditKind = 'create' | 'update' | 'remove' | 'money' | 'access' | 'provision' | 'usage' | 'failure';

const EXACT: Record<string, string> = {
  CUSTOMER_ONBOARDED: 'Alta de cliente (Nueva venta)',
  COMMISSIONS_SETTLED: 'Liquidación de comisiones',
  AI_CREDIT_ENTRY: 'Movimiento de créditos IA',
  AI_CREDIT_REVERSAL: 'Reverso de créditos IA',
  USAGE_INGEST_SWITCH: 'Cambio del ingest de uso',
  PUSH_KILL_SWITCH: 'Corte del envío de entitlements',
  USER_INVITED: 'Invitación de usuario',
  USER_INVITATION_ACCEPTED: 'Invitación aceptada',
  PROVIDER_ACCOUNT_KEY_SET: 'Llave secreta configurada',
  PROVIDER_ACCOUNT_KEY_CLEARED: 'Llave secreta retirada',
  CREDENTIAL_SECRET_REF_REVEALED: 'Consulta de referencia de secreto',
  CANCEL_SCHEDULED: 'Cancelación programada',
  PARTIALLY_PAID: 'Pago parcial',
};

/** Sufijos de acción (de más largo a más corto al buscar). */
const VERB: Record<string, string> = {
  STATUS_CHANGED: 'Cambio de estado',
  BILLABLE_SET: 'Cambio de facturable',
  CANCEL_SCHEDULED: 'Cancelación programada',
  CANCEL_COMPLETED: 'Cancelación completada',
  CREATED: 'Alta',
  ONBOARDED: 'Alta',
  UPDATED: 'Actualización',
  CHANGED: 'Cambio',
  SET: 'Ajuste',
  UPSERTED: 'Registro',
  REGISTERED: 'Registro',
  RECORDED: 'Registro',
  DELETED: 'Eliminación',
  ARCHIVED: 'Archivo',
  ENDED: 'Cierre',
  CLOSED: 'Cierre',
  FINALIZED: 'Cierre definitivo',
  ISSUED: 'Emisión',
  CONFIRMED: 'Confirmación',
  SETTLED: 'Liquidación',
  PAID: 'Pago',
  PURCHASED: 'Compra',
  GRANTED: 'Concesión',
  ASSIGNED: 'Asignación',
  REVOKED: 'Revocación',
  PUBLISHED: 'Publicación',
  VOIDED: 'Anulación',
  COMPUTED: 'Cálculo',
  REFRESHED: 'Recálculo',
  ENQUEUED: 'Encolado',
  STARTED: 'Inicio',
  COMPLETED: 'Finalización',
  SUCCEEDED: 'Éxito',
  FAILED: 'Fallo',
  RETRIED: 'Reintento',
  CANCELLED: 'Cancelación',
  APPROVED: 'Aprobación',
  REJECTED: 'Rechazo',
  SUSPENDED: 'Suspensión',
  RESUMED: 'Reanudación',
  REACTIVATED: 'Reactivación',
  DEACTIVATED: 'Desactivación',
  DISABLED: 'Desactivación',
  ENABLED: 'Activación',
  RESENT: 'Reenvío',
  IMPORTED: 'Importación',
  CLEARED: 'Retiro',
  SCHEDULED: 'Programación',
  ACKNOWLEDGED: 'Reconocimiento',
  CONFIGURED: 'Configuración',
  LINKED: 'Vinculación',
  UNLINKED: 'Desvinculación',
  REVEALED: 'Consulta',
  EXPIRED: 'Vencimiento',
};

const SUBJECT: Record<string, string> = {
  INVOICE: 'factura',
  MANUAL_PAYMENT: 'cobro manual',
  PAYMENT: 'cobro',
  PAYMENT_LINK: 'enlace de pago',
  COMMISSION: 'comisión',
  COMMISSIONS: 'comisiones',
  COMMISSION_PLAN: 'plan de comisión',
  COMMISSION_RULE: 'regla de comisión',
  SUBSCRIPTION: 'contrato',
  SUBSCRIPTION_ITEM: 'ítem de contrato',
  SUBSCRIPTION_BILLING_CHANNEL: 'canal de cobro del contrato',
  TENANT: 'tenant',
  TENANT_ADDON: 'add-on de tenant',
  TENANT_FEATURE: 'capacidad de tenant',
  TENANT_MEMBERSHIP: 'acceso a tenant',
  ORG_MEMBERSHIP: 'acceso a organización',
  ORGANIZATION: 'organización',
  COMPANY: 'sociedad',
  CUSTOMER: 'cliente',
  AGREEMENT: 'acuerdo de producto',
  AGREEMENT_PLATFORM_FEE: 'tarifa de plataforma',
  PARTNER_FEE_STATEMENT: 'liquidación de tarifa de partner',
  USAGE_AGGREGATE: 'agregado de uso',
  USAGE_METER: 'medidor de uso',
  USAGE_ALERT: 'alerta de uso',
  USAGE_INGEST: 'ingest de uso',
  USAGE_INGEST_CREDENTIAL: 'credencial de ingest',
  REPORTING_SETTINGS: 'configuración de reportes',
  FX_RATE: 'tipo de cambio',
  CURRENCY: 'moneda',
  MARKET: 'mercado',
  AI_CREDITS: 'créditos IA',
  AI_CREDIT_POLICY: 'política de créditos IA',
  AI_CREDIT_WEIGHT: 'peso de créditos IA',
  CATALOG_ITEM: 'ítem de catálogo',
  CATALOG_ITEM_USAGE_BINDING: 'vínculo de uso del catálogo',
  CATALOG_ITEM_CREDIT_PACK: 'paquete de créditos',
  CATALOG_ITEM_LIFECYCLE: 'ciclo de vida del catálogo',
  CAPABILITY_MANIFEST: 'manifiesto de capacidades',
  CAPABILITY_ALIAS: 'alias de capacidad',
  PLATFORM_ROLE: 'rol de plataforma',
  PROVISIONING_ROLE: 'rol de provisioning',
  PRODUCT_OWNER: 'propietario técnico',
  PRODUCT: 'producto',
  PRODUCT_CONFIGURATION: 'configuración de producto',
  PLAN: 'plan',
  PROVISIONING: 'provisioning',
  SAAS_PROVISIONING: 'alta SaaS',
  REQUEST: 'solicitud',
  INTEGRATION: 'integración',
  ENTITLEMENTS_INTEGRATION: 'integración de entitlements',
  ENTITLEMENT_GRANT: 'entitlement',
  ENTITLEMENT_OVERRIDE: 'excepción de entitlement',
  DEPLOYMENT: 'despliegue',
  DEPLOYMENT_TARGET: 'destino de despliegue',
  DEPLOYMENT_HEALTH: 'salud de despliegue',
  DEPLOYMENT_PROVISIONING: 'provisioning del destino',
  CREDENTIAL: 'credencial',
  CREDENTIAL_PROFILE: 'perfil de credencial',
  PROVIDER_ACCOUNT: 'cuenta de pago',
  PROVIDER_ACCOUNT_API_BASE: 'URL de API de la cuenta de pago',
  PROVIDER_PAYMENT: 'pago del proveedor',
  PROVIDER_INVOICE_PAYMENT: 'pago de factura del proveedor',
  PROVIDER_PLAN: 'plan del proveedor',
  PROVIDER_SUBSCRIPTION: 'suscripción del proveedor',
  BILLING_ALERT: 'alerta de cobro',
  BILLING_ALERTS: 'alertas de cobro',
  BILLING_CONTACT: 'contacto de facturación',
  COLLECTION_PROFILE: 'perfil de cobranza',
  CARD_ON_FILE: 'tarjeta guardada',
  CHARGE: 'cargo',
  SALES_AGENT: 'comercial',
  SALES_AGENT_USER: 'usuario del comercial',
  SALES_ATTRIBUTION: 'atribución comercial',
  COMMERCIAL_DOCUMENT: 'documento comercial',
  COMMERCIAL_DOCUMENTS: 'documentos comerciales',
  CORRECTIVE_DISCOUNT: 'descuento correctivo',
  USER: 'usuario',
  USER_INVITATION: 'invitación',
  USER_PROFILE: 'perfil de usuario',
};

const VERBS_BY_LENGTH = Object.keys(VERB).sort((a, b) => b.length - a.length);

/** Frase en español del código, o null si no se reconoce (se muestra el código). */
export function auditActionLabel(action: string | null | undefined): string | null {
  if (!action) return null;
  if (EXACT[action]) return EXACT[action];
  for (const verb of VERBS_BY_LENGTH) {
    if (!action.endsWith(`_${verb}`)) continue;
    const subject = SUBJECT[action.slice(0, -(verb.length + 1))];
    if (subject) return `${VERB[verb]} de ${subject}`;
  }
  return null;
}

const has = (action: string, re: RegExp) => re.test(action);

/** Tipo de evento para el icono. El fallo manda sobre el tema; luego el tema (dinero, accesos…) y al final el verbo. */
export function auditActionKind(action: string | null | undefined): AuditKind {
  const a = action ?? '';
  if (has(a, /_(FAILED|REJECTED)$|NOT_CONFIGURED|KILL_SWITCH/)) return 'failure';
  if (has(a, /^(INVOICE|MANUAL_PAYMENT|PAYMENT|COMMISSION|PARTNER_FEE|FX_RATE|CHARGE|PROVIDER_(INVOICE_)?PAYMENT|AI_CREDITS_PURCHASED|CORRECTIVE_DISCOUNT)|PARTIALLY_PAID/))
    return 'money';
  if (has(a, /^(USER|PLATFORM_ROLE|PROVISIONING_ROLE|ORG_MEMBERSHIP|TENANT_MEMBERSHIP|PRODUCT_OWNER|SALES_AGENT_USER)/)) return 'access';
  if (has(a, /^(USAGE|AI_CREDIT)/)) return 'usage';
  if (has(a, /^(PROVISIONING|SAAS_PROVISIONING|DEPLOYMENT|INTEGRATION|ENTITLEMENT|CREDENTIAL|REQUEST)/)) return 'provision';
  if (has(a, /_(REVOKED|DEACTIVATED|DISABLED|VOIDED|CANCELLED|ARCHIVED|ENDED|DELETED|CLEARED|EXPIRED)$/)) return 'remove';
  if (has(a, /_(CREATED|ONBOARDED|ISSUED|PUBLISHED|IMPORTED|GRANTED)$/)) return 'create';
  return 'update';
}

const ENTITY: Record<string, string> = {
  invoice: 'Factura',
  payment: 'Cobro',
  payment_link: 'Enlace de pago',
  subscription: 'Contrato',
  subscription_item: 'Ítem de contrato',
  tenant: 'Tenant',
  organization: 'Organización',
  organization_product_agreement: 'Acuerdo de producto',
  commission_settlement: 'Liquidación de comisiones',
  commission: 'Comisión',
  partner_fee_statement: 'Tarifa de partner',
  usage_period_aggregate: 'Agregado de uso',
  usage_meter: 'Medidor de uso',
  control_plane_settings: 'Configuración',
  ai_credit_weight: 'Peso de créditos IA',
  ai_credit_policy: 'Política de créditos IA',
  ai_credit_ledger: 'Créditos IA',
  provisioning_request: 'Solicitud de provisioning',
  billing_alert: 'Alerta de cobro',
  saas_product: 'Producto',
  platform_admin: 'Rol de plataforma',
  exchange_rate: 'Tipo de cambio',
  product_integration: 'Integración',
  deployment_target: 'Destino de despliegue',
  credential_profile: 'Perfil de credencial',
  profile: 'Usuario',
  payment_provider_account: 'Cuenta de pago',
  sales_agent: 'Comercial',
};

export function entityTypeLabel(type: string | null | undefined): string {
  if (!type) return '—';
  return ENTITY[type] ?? type.replace(/_/g, ' ');
}

/* ---- Agrupación por día (zona horaria del navegador) ---------------------------- */

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** «Hoy · lunes, 5 de octubre de 2026», «Ayer · …» o solo la fecha larga. */
export function auditDayLabel(iso: string, now: Date = new Date()): string {
  const long = new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(iso),
  );
  const today = dayKey(now.toISOString());
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000).toISOString());
  const key = dayKey(iso);
  if (key === today) return `Hoy · ${long}`;
  if (key === yesterday) return `Ayer · ${long}`;
  return long.charAt(0).toUpperCase() + long.slice(1);
}

export function auditTime(iso: string): string {
  return new Intl.DateTimeFormat('es-PE', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** Agrupa filas YA ordenadas por día, conservando el orden de llegada. */
export function groupByDay<T extends { occurred_at: string }>(rows: readonly T[]): Array<{ key: string; first: string; rows: T[] }> {
  const groups: Array<{ key: string; first: string; rows: T[] }> = [];
  for (const row of rows) {
    const key = dayKey(row.occurred_at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else groups.push({ key, first: row.occurred_at, rows: [row] });
  }
  return groups;
}
