/**
 * Envío de la bandeja `mail_outbox` a EBIM MailHub (Edge Function `mail-dispatch`).
 *
 * Módulo PURO con dependencias inyectadas: lo prueba vitest.
 *
 * Por cada fila tomada (`mail_claim_batch`, que ya la dejó en SENDING):
 *   1. Modo de entrega (`policy.ts`): SKIP (dominio de prueba) o HOLD
 *      («Retenido (QAS)») se cierran SIN llamar a MailHub ni generar enlaces.
 *   2. Variables: las de la fila; en una prueba (TEST) las de muestra del
 *      catálogo; las rutas relativas (`/apps?...`) se completan con la URL de la
 *      consola; si la plantilla lleva portal de pago, el enlace se genera AHORA
 *      (`mail_payment_link`, idempotente) — un correo retenido nunca crea uno.
 *   3. `POST /mailhub-send` con clave estable `masteradmin-<evento>[-r<n>]`.
 *   4. Resultado: SENT / SUPPRESSED; o PENDING con backoff si MailHub dice que
 *      se puede reintentar (red, 429, 5xx) y quedan intentos; si no, FAILED.
 */
import { templateByKey } from './catalog.ts';
import { decideDelivery, type DeliveryConfig } from './policy.ts';
import { MAIL_MAX_ATTEMPTS, nextRetryDelaySeconds, type MailhubSendRequest, type MailhubSendResult } from './mailhub.ts';

export interface OutboxRow {
  id: string;
  category: string;
  event_type: string;
  template_key: string;
  recipient_email: string | null;
  variables: Record<string, unknown> | null;
  needs_payment_link: boolean;
  idempotency_key: string;
  resend_count: number;
  attempts: number;
  reference_label: string | null;
}

export interface MarkResult {
  id: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'HELD' | 'SKIPPED' | 'SUPPRESSED';
  detail?: string | null;
  mailhubEmailId?: string | null;
  mailhubStatus?: string | null;
  errorCode?: string | null;
  retryInSeconds?: number | null;
  deliveredTo?: string | null;
  deliveryMode?: string | null;
}

export interface DispatchDeps {
  claimBatch: (limit: number) => Promise<OutboxRow[]>;
  paymentLink: (outboxId: string) => Promise<{ token: string; expires: string }>;
  markResult: (r: MarkResult) => Promise<void>;
  send: (req: MailhubSendRequest) => Promise<MailhubSendResult>;
  delivery: DeliveryConfig;
  /** URL pública de la consola, sin barra final. */
  appUrl: string;
  now?: () => number;
}

export interface DispatchSummary {
  claimed: number;
  sent: number;
  held: number;
  skipped: number;
  retried: number;
  failed: number;
}

export const DISPATCH_BATCH = 20;
export const DISPATCH_MAX_BATCHES = 5;
/** Tiempo de pared máximo de una corrida (la Edge Function corta a los 150 s). */
export const DISPATCH_BUDGET_MS = 60_000;

function stringVars(vars: Record<string, unknown> | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars ?? {})) {
    if (k.startsWith('_')) continue;
    if (v === null || v === undefined) out[k] = '';
    else out[k] = typeof v === 'string' ? v : String(v);
  }
  return out;
}

export function sendKeyFor(row: Pick<OutboxRow, 'idempotency_key' | 'resend_count'>): string {
  const base = `masteradmin-${row.idempotency_key}`;
  return row.resend_count > 0 ? `${base}-r${row.resend_count}` : base;
}

/** Variables finales (sin el enlace de pago, que se agrega al enviar). */
export function buildVariables(row: OutboxRow, appUrl: string): Record<string, string> {
  const base = row.event_type === 'TEST' ? { ...(templateByKey(row.template_key)?.sample ?? {}) } : stringVars(row.variables);
  if (row.event_type === 'TEST' && base.consola_url) base.consola_url = appUrl;
  for (const [k, v] of Object.entries(base)) {
    // Rutas relativas de la consola (resumen de operaciones) → URL completa.
    if (/^\/[a-z0-9/?=&#._-]*$/i.test(v) && (k === 'enlace' || k.endsWith('_url'))) base[k] = `${appUrl}${v}`;
  }
  return base;
}

async function dispatchRow(row: OutboxRow, deps: DispatchDeps): Promise<keyof Omit<DispatchSummary, 'claimed'>> {
  const mode = deps.delivery.mode;
  const decision = decideDelivery(row.recipient_email ?? '', deps.delivery);
  if (decision.action === 'SKIP') {
    await deps.markResult({ id: row.id, status: 'SKIPPED', detail: decision.reason, deliveryMode: mode });
    return 'skipped';
  }
  if (decision.action === 'HOLD') {
    await deps.markResult({ id: row.id, status: 'HELD', detail: decision.reason, deliveryMode: mode });
    return 'held';
  }
  if (!templateByKey(row.template_key)) {
    await deps.markResult({ id: row.id, status: 'FAILED', detail: `Plantilla desconocida: ${row.template_key}`, errorCode: 'template_unknown', deliveryMode: mode });
    return 'failed';
  }

  const variables = buildVariables(row, deps.appUrl);
  if (row.needs_payment_link && row.event_type !== 'TEST') {
    try {
      const link = await deps.paymentLink(row.id);
      variables.enlace_pago = `${deps.appUrl}/pagar#${link.token}`;
      variables.vence_enlace = link.expires;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = /^[A-Z_]+/.exec(message)?.[0] ?? 'PAYMENT_LINK_ERROR';
      await deps.markResult({ id: row.id, status: 'FAILED', detail: `No se pudo generar el portal de pago: ${message.slice(0, 200)}`, errorCode: code, deliveryMode: mode });
      return 'failed';
    }
  }

  const result = await deps.send({
    to: [decision.to],
    templateKey: row.template_key,
    variables,
    idempotencyKey: sendKeyFor(row),
    referenceId: row.reference_label ?? row.event_type,
    metadata: { outboxId: row.id, event: row.event_type, category: row.category, redirected: decision.redirectedFrom !== null },
  });

  if (result.ok) {
    const suppressed = result.suppressed.map((s) => s.toLowerCase()).includes(decision.to);
    await deps.markResult({
      id: row.id,
      status: suppressed ? 'SUPPRESSED' : 'SENT',
      detail: suppressed
        ? 'MailHub tiene esta dirección en su lista de supresión (rebote o baja previa)'
        : decision.redirectedFrom
          ? `Redirigido desde ${decision.redirectedFrom}`
          : null,
      mailhubEmailId: result.emailId,
      mailhubStatus: result.status,
      deliveredTo: decision.to,
      deliveryMode: mode,
    });
    return suppressed ? 'failed' : 'sent';
  }

  if (result.retryable && row.attempts < MAIL_MAX_ATTEMPTS) {
    await deps.markResult({
      id: row.id,
      status: 'PENDING',
      detail: `Reintento ${row.attempts}/${MAIL_MAX_ATTEMPTS}: ${result.message}`,
      errorCode: result.code,
      retryInSeconds: nextRetryDelaySeconds(row.attempts),
      deliveryMode: mode,
    });
    return 'retried';
  }
  await deps.markResult({ id: row.id, status: 'FAILED', detail: result.message, errorCode: result.code, deliveryMode: mode });
  return 'failed';
}

export async function runDispatch(deps: DispatchDeps): Promise<DispatchSummary> {
  const now = deps.now ?? Date.now;
  const started = now();
  const summary: DispatchSummary = { claimed: 0, sent: 0, held: 0, skipped: 0, retried: 0, failed: 0 };
  for (let batch = 0; batch < DISPATCH_MAX_BATCHES && now() - started < DISPATCH_BUDGET_MS; batch += 1) {
    const rows = await deps.claimBatch(DISPATCH_BATCH);
    if (!rows.length) break;
    summary.claimed += rows.length;
    for (const row of rows) {
      try {
        summary[await dispatchRow(row, deps)] += 1;
      } catch (error) {
        // Un error inesperado no detiene el lote: la fila vuelve a la cola.
        const message = error instanceof Error ? error.message : String(error);
        await deps
          .markResult({ id: row.id, status: 'PENDING', detail: `Error interno: ${message.slice(0, 200)}`, errorCode: 'internal_error', retryInSeconds: nextRetryDelaySeconds(row.attempts) })
          .catch(() => undefined);
        summary.retried += 1;
      }
    }
    if (rows.length < DISPATCH_BATCH) break;
  }
  return summary;
}
