/** Estado de una comisión en español (U-13) y su tono; un código nuevo se muestra tal cual. */
export const COMMISSION_STATUS_LABEL: Record<string, string> = {
  PENDING: 'En espera',
  ELIGIBLE: 'Elegible',
  ACCRUED: 'Devengada',
  PAID: 'Pagada',
  VOID: 'Anulada',
};

export const COMMISSION_STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral' | 'info'> = {
  PENDING: 'neutral',
  ELIGIBLE: 'warn',
  ACCRUED: 'warn',
  PAID: 'ok',
  VOID: 'danger',
};
