import type { AutochargeSummary } from '@/services/mutations';

/** Etiquetas del cobro con tarjeta guardada (M2). */
export const ATTEMPT_STATUS_LABEL: Record<string, string> = {
  PENDING: 'En curso',
  SUCCEEDED: 'Cobrado',
  FAILED: 'Fallido',
  SKIPPED: 'Omitido',
  REVIEW: 'En revisión',
};

export const ATTEMPT_STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral' | 'info'> = {
  PENDING: 'info',
  SUCCEEDED: 'ok',
  FAILED: 'danger',
  SKIPPED: 'neutral',
  REVIEW: 'warn',
};

export const TRIGGER_SOURCE_LABEL: Record<string, string> = {
  MANUAL: 'Manual',
  RUN: 'Ejecución',
  CRON: 'Programado',
};

/**
 * Resultado de «Cobrar ahora» para un toast: cobrado, rechazado con su código u
 * omitido (no procedía: sin autorización vigente, intento en curso, sin saldo).
 */
export function autochargeToast(
  summary: AutochargeSummary,
  invoiceNumber: string,
): ['success' | 'error', string, string] {
  const result = summary.results[0];
  if (!result) return ['error', 'Cobro omitido', `La factura ${invoiceNumber} no tenía nada que cobrar.`];
  switch (result.status) {
    case 'SUCCEEDED':
      return ['success', 'Cobro realizado', `Factura ${invoiceNumber} cobrada con la tarjeta guardada.`];
    case 'FAILED':
      return ['error', 'Cobro rechazado', `Factura ${invoiceNumber}: ${result.error_code ?? 'COBRO_FALLIDO'}.`];
    case 'REVIEW':
      return ['error', 'Cobro en revisión', `Factura ${invoiceNumber}: el proveedor no confirmó a tiempo. No lo repitas; revisa la conciliación.`];
    default:
      return ['error', 'Cobro omitido', `Factura ${invoiceNumber}: ${result.error_code ?? 'no procede'}.`];
  }
}
