/**
 * Ejes de cutover de una integración (spec §15): pasos en orden y su nombre de
 * NEGOCIO para el `CutoverStepper` (V6 · T7: nada de «Legacy», «Primario» ni
 * «Lectura dual» fuera de Configuración › Avanzado). El orden de facturación
 * vive en `usageLabels.BILLING_AXIS_ORDER` (Billing shadow).
 */

export const ENTITLEMENT_AXIS_ORDER = [
  'LEGACY_ONLY',
  'SHADOW',
  'DUAL_READ',
  'MASTERADMIN_PRIMARY',
  'LEGACY_RETIRED',
] as const;

const STEP_LABEL: Record<string, string> = {
  LEGACY_ONLY: 'La app manda',
  SHADOW: 'En comparación',
  DUAL_READ: 'Doble control',
  MASTERADMIN_PRIMARY: 'Manda el Admin Maestro',
  LEGACY_RETIRED: 'Migración completa',
  BILLING_LEGACY: 'Cobra la app',
  BILLING_SHADOW: 'En comparación',
  BILLING_PRIMARY: 'Cobra el Admin Maestro',
  BILLING_RETIRED: 'Migración completa',
};

/** Qué significa cada etapa, para el tooltip o la ficha. */
export const STEP_HELP: Record<string, string> = {
  LEGACY_ONLY: 'La app decide qué módulos tiene cada cliente; el Admin Maestro aún no interviene.',
  SHADOW: 'El Admin Maestro calcula lo mismo en paralelo y se compara, sin cambiar nada en la app.',
  DUAL_READ: 'La app lee ambos orígenes y avisa si no coinciden.',
  MASTERADMIN_PRIMARY: 'El Admin Maestro decide los módulos; la app los aplica.',
  LEGACY_RETIRED: 'La app ya no tiene su propio origen de módulos.',
  BILLING_LEGACY: 'La app cobra por su cuenta.',
  BILLING_SHADOW: 'El Admin Maestro calcula el cobro en paralelo y se compara, sin cobrar.',
  BILLING_PRIMARY: 'El Admin Maestro emite y cobra.',
  BILLING_RETIRED: 'La app dejó de cobrar por su cuenta.',
};

export const AXIS_LABEL = { entitlements: 'Módulos habilitados', billing: 'Cobro' } as const;

export function cutoverStepLabel(state: string | null | undefined): string {
  return state ? (STEP_LABEL[state] ?? state) : '—';
}
