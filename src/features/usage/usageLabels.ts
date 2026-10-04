/**
 * Etiquetas de negocio de uso, créditos IA y billing shadow (CCP M4).
 *
 * Los códigos técnicos se traducen aquí; un valor desconocido se muestra tal
 * cual en vez de inventarle un significado. Las decisiones de negocio abiertas
 * (spec CCP §20: D-01…D-15) se rotulan «No decidido (D-xx)», nunca 0 ni
 * «gratis».
 */

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'accent';

export interface LabelTone {
  label: string;
  tone: Tone;
}

export function labelOf(map: Record<string, LabelTone>, value: string | null | undefined): LabelTone {
  if (!value) return { label: '—', tone: 'neutral' };
  return map[value] ?? { label: value, tone: 'neutral' };
}

/** Texto canónico para una decisión de negocio abierta. */
export function undecidedText(code: string): string {
  return `No decidido (${code})`;
}

/* ---- Medidores ---------------------------------------------------------- */

export const METER_STATUS: Record<string, LabelTone> = {
  DRAFT: { label: 'Borrador', tone: 'neutral' },
  ACTIVE: { label: 'Activo', tone: 'ok' },
  DEPRECATED: { label: 'Obsoleto', tone: 'warn' },
};

export const AGGREGATION_LABEL: Record<string, string> = {
  SUM: 'Suma',
  MAX: 'Máximo (pico)',
  COUNT_DISTINCT_SUBJECT: 'Sujetos distintos',
};

export const MEASUREMENT_LABEL: Record<string, string> = {
  EVENT: 'Por evento',
  DAILY_SNAPSHOT: 'Foto diaria',
};

/* ---- Agregados ---------------------------------------------------------- */

export const AGGREGATE_STATUS: Record<string, LabelTone> = {
  OPEN: { label: 'Abierto', tone: 'info' },
  CLOSING: { label: 'En cierre', tone: 'warn' },
  FINALIZED: { label: 'Finalizado', tone: 'ok' },
};

export const ALLOWANCE_STATUS: Record<string, LabelTone> = {
  NO_ALLOWANCE: { label: 'Sin asignación', tone: 'neutral' },
  WITHIN: { label: 'Dentro de la asignación', tone: 'ok' },
  OVER: { label: 'Excede la asignación', tone: 'danger' },
};

/* ---- Ingest ------------------------------------------------------------- */

export const REJECTION_CODE: Record<string, string> = {
  INVALID_EVENT: 'Evento con forma inválida',
  UNKNOWN_METER: 'Medidor desconocido o no activo',
  NEGATIVE_QUANTITY: 'Cantidad negativa en un medidor que no la admite',
  UNIT_MISMATCH: 'Unidad distinta a la del medidor',
  OCCURRED_AT_IN_FUTURE: 'Fecha del evento en el futuro',
  INTERNAL_METADATA_INVALID: 'Metadatos internos (COGS) inválidos',
  TENANT_NOT_MAPPED_FOR_PRODUCT: 'Tenant sin alta ACTIVE en el producto (D-12)',
  ENVIRONMENT_MISMATCH: 'Ambiente distinto al del alta del tenant',
  CONFLICT: 'Mismo eventId con contenido distinto (integridad)',
};

/* ---- Alertas ------------------------------------------------------------ */

export type AlertCategory = 'USAGE' | 'CREDITS' | 'BILLING';

export const ALERT_CODE: Record<string, LabelTone & { category: AlertCategory }> = {
  OVERAGE_UNDER_BLOCK_POLICY: { label: 'Exceso bajo política BLOCK', tone: 'warn', category: 'USAGE' },
  ASIGNACION_NO_DEFINIDA: { label: 'Asignación no decidida (D-05)', tone: 'warn', category: 'BILLING' },
  TARIFA_ADDON_NO_DEFINIDA: { label: 'Tarifa no decidida (D-01/D-02)', tone: 'warn', category: 'BILLING' },
  POLITICA_CREDITOS_NO_DEFINIDA: { label: 'Política de créditos no decidida (D-03)', tone: 'warn', category: 'CREDITS' },
  PESO_CREDITO_NO_DEFINIDO: { label: 'Peso de crédito no decidido (D-03)', tone: 'warn', category: 'CREDITS' },
  CREDIT_OVERAGE: { label: 'Saldo de créditos negativo', tone: 'danger', category: 'CREDITS' },
  POOL_SCOPE_CONFLICT: { label: 'Políticas con pools distintos', tone: 'danger', category: 'CREDITS' },
  CREDIT_METER_NOT_SUM: { label: 'Medidor de IA sin agregación SUM', tone: 'danger', category: 'CREDITS' },
};

export function alertCategory(code: string | null | undefined): AlertCategory {
  return (code && ALERT_CODE[code]?.category) || 'USAGE';
}

/* ---- Créditos IA -------------------------------------------------------- */

export const LEDGER_ENTRY: Record<string, LabelTone> = {
  GRANT_PERIOD: { label: 'Incluidos del período', tone: 'ok' },
  GRANT_PURCHASE: { label: 'Compra', tone: 'ok' },
  GRANT_BONUS: { label: 'Bono', tone: 'ok' },
  CONSUME: { label: 'Consumo', tone: 'info' },
  RESERVE: { label: 'Reserva', tone: 'neutral' },
  RESERVE_RELEASE: { label: 'Liberación de reserva', tone: 'neutral' },
  ADJUST: { label: 'Ajuste', tone: 'warn' },
  EXPIRE: { label: 'Expiración', tone: 'warn' },
  ROLLOVER_OUT: { label: 'Traslado (salida)', tone: 'neutral' },
  ROLLOVER_IN: { label: 'Traslado (entrada)', tone: 'neutral' },
  REVERSAL: { label: 'Reversión', tone: 'danger' },
};

/** Las entradas que la base no deja revertir. */
export const NON_REVERSIBLE_ENTRIES = new Set(['REVERSAL', 'RESERVE_RELEASE']);

export const LEDGER_GROUPS: Record<string, string[]> = {
  GRANTS: ['GRANT_PERIOD', 'GRANT_PURCHASE', 'GRANT_BONUS', 'ROLLOVER_IN'],
  CONSUMPTION: ['CONSUME', 'RESERVE', 'RESERVE_RELEASE', 'EXPIRE', 'ROLLOVER_OUT'],
  CORRECTIONS: ['ADJUST', 'REVERSAL'],
};

export function poolLabel(pool: string | null | undefined): string {
  if (!pool) return '—';
  if (pool === 'TENANT') return 'Pool del tenant';
  if (pool.startsWith('PRODUCT:')) return `Pool del producto ${pool.slice('PRODUCT:'.length)}`;
  return pool;
}

export const POOL_SCOPE_LABEL: Record<string, string> = {
  TENANT: 'Por tenant',
  PRODUCT: 'Por producto',
};

export const OVERAGE_MODE_LABEL: Record<string, string> = {
  BLOCK: 'Bloquear el exceso',
  ALLOW: 'Permitir y facturar el exceso',
};

export const POLICY_SOURCE_LABEL: Record<string, string> = {
  PLAN: 'Plan',
  CATALOG_ITEM: 'Add-on',
};

/* ---- Billing shadow ----------------------------------------------------- */

export const BILLING_AXIS_ORDER = ['BILLING_LEGACY', 'BILLING_SHADOW', 'BILLING_PRIMARY', 'BILLING_RETIRED'] as const;

export const BILLING_AXIS: Record<string, LabelTone> = {
  BILLING_LEGACY: { label: 'Biller local (legacy)', tone: 'neutral' },
  BILLING_SHADOW: { label: 'Shadow: se compara', tone: 'info' },
  BILLING_PRIMARY: { label: 'MasterAdmin factura', tone: 'accent' },
  BILLING_RETIRED: { label: 'Biller local retirado', tone: 'neutral' },
};

/**
 * Estados a los que la base deja mover el eje desde `from`: un paso adelante o
 * atrás, nunca BILLING_RETIRED en este programa (RETIRO_FUERA_DE_PROGRAMA).
 */
export function billingAxisTargets(from: string | null | undefined): string[] {
  const i = BILLING_AXIS_ORDER.indexOf((from ?? '') as (typeof BILLING_AXIS_ORDER)[number]);
  if (i < 0) return [];
  return [BILLING_AXIS_ORDER[i - 1], BILLING_AXIS_ORDER[i + 1]].filter(
    (s): s is (typeof BILLING_AXIS_ORDER)[number] => Boolean(s) && s !== 'BILLING_RETIRED',
  );
}

export const DIFF_TYPE: Record<string, LabelTone> = {
  ONLY_LOCAL: { label: 'Solo en el biller local', tone: 'danger' },
  ONLY_MASTERADMIN: { label: 'Solo en MasterAdmin', tone: 'danger' },
  QUANTITY_MISMATCH: { label: 'Cantidad distinta', tone: 'warn' },
  AMOUNT_MISMATCH: { label: 'Importe distinto', tone: 'warn' },
  CURRENCY_MISMATCH: { label: 'Moneda distinta', tone: 'danger' },
};

/* ---- Períodos (mes calendario UTC, D-10) -------------------------------- */

const pad = (n: number) => String(n).padStart(2, '0');

/** Primer día del mes actual, `YYYY-MM-01`. */
export function currentPeriodStart(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
}

/** `2026-10` (valor de un `<input type="month">`) → `2026-10-01`. */
export function periodFromMonth(month: string): string {
  return /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : '';
}

/** `2026-10-01` → `2026-10`. */
export function monthOf(period: string): string {
  return period.slice(0, 7);
}

/** `2026-12-01` → `2027-01-01`. */
export function nextPeriodStart(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const year = m === 12 ? y + 1 : y;
  const month = m === 12 ? 1 : m + 1;
  return `${year}-${pad(month)}-01`;
}

/** Rango UTC [inicio, fin) de un mes, como instantes ISO. */
export function periodRange(period: string): { from: string; to: string } {
  return { from: `${period}T00:00:00Z`, to: `${nextPeriodStart(period)}T00:00:00Z` };
}

/** `2026-10-01` → «octubre de 2026». */
export function formatPeriod(period: string | null | undefined): string {
  if (!period || !/^\d{4}-\d{2}/.test(period)) return '—';
  const [y, m] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
}

/** Créditos y cantidades: hasta 6 decimales, sin redondear a entero. */
export function formatQuantity(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('es-PE', { maximumFractionDigits: 6 }).format(n);
}

/** Clave de idempotencia nueva para un movimiento manual. */
export function newIdempotencyKey(prefix: string): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}:${uuid}`;
}
