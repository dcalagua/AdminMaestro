/**
 * Ejes de cutover de una integración (spec §15): pasos en orden y etiquetas
 * cortas en español para el `CutoverStepper`. El orden de facturación vive en
 * `usageLabels.BILLING_AXIS_ORDER` (Billing shadow).
 */

export const ENTITLEMENT_AXIS_ORDER = [
  'LEGACY_ONLY',
  'SHADOW',
  'DUAL_READ',
  'MASTERADMIN_PRIMARY',
  'LEGACY_RETIRED',
] as const;

const STEP_LABEL: Record<string, string> = {
  LEGACY_ONLY: 'Legacy',
  SHADOW: 'Shadow',
  DUAL_READ: 'Lectura dual',
  MASTERADMIN_PRIMARY: 'Primario',
  LEGACY_RETIRED: 'Retirado',
  BILLING_LEGACY: 'Legacy',
  BILLING_SHADOW: 'Shadow',
  BILLING_PRIMARY: 'Primario',
  BILLING_RETIRED: 'Retirado',
};

export const AXIS_LABEL = { entitlements: 'Entitlements', billing: 'Facturación' } as const;

export function cutoverStepLabel(state: string | null | undefined): string {
  return state ? (STEP_LABEL[state] ?? state) : '—';
}
