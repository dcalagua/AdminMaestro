/** Etiquetas en español de organizaciones (U-13, A13). */

const CAPABILITY_TEXT: Record<string, string> = {
  CUSTOMER: 'Cliente',
  PARTNER: 'Partner',
  RESELLER: 'Reseller',
  CONSULTING: 'Consultora',
};

export function capabilityText(c: string): string {
  return CAPABILITY_TEXT[c] ?? c;
}
