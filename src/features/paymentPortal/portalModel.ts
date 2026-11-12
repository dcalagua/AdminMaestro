import { type PortalCheckout, type PortalStatement } from './portalApi';

/** Fases, etiquetas y tipos compartidos del portal de pago público. */
export type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'ready'; statement: PortalStatement };

export const FIELD_LABEL: Record<string, string> = {
  billing_first_name: 'Nombre del titular',
  billing_last_name: 'Apellido del titular',
  billing_email: 'Correo de facturación',
  billing_address: 'Dirección de facturación',
  billing_city: 'Ciudad',
  billing_phone: 'Teléfono (solo dígitos, con código de país)',
};
export const FIELD_KEY: Record<string, string> = {
  billing_first_name: 'first_name',
  billing_last_name: 'last_name',
  billing_email: 'email',
  billing_address: 'address',
  billing_city: 'city',
  billing_phone: 'phone',
};

export const STATUS_LABEL: Record<string, string> = { ISSUED: 'Pendiente', PARTIALLY_PAID: 'Pago parcial' };

/** Token de tarjeta: formulario simulado (MOCK) o Culqi Checkout (TEST/LIVE). */
export type TokenRequest = {
  title: string;
  description: string;
  currency: string;
  amountMinor: number;
  checkout: PortalCheckout;
  resolve: (token: string) => void;
  reject: (message: string | null) => void;
};
