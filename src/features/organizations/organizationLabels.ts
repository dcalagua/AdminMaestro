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

/** Quién factura al cliente final en un acuerdo de canal. */
export const BILLING_RESPONSIBILITY_TEXT: Record<string, string> = {
  EBIM: 'Factura EBIM',
  PARTNER: 'Factura el partner',
  MIXED: 'Mixto',
};
