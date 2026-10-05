/**
 * Validación de la ficha de una cuenta de cobro (Configuración → Cuentas de pago).
 *
 * Es UX: la base vuelve a validar (CHECK de la tabla y `upsert_payment_provider_account`).
 * Su trabajo es que nadie llegue a pegar una clave secreta en un formulario del
 * navegador: el campo de «secreto» recibe el NOMBRE de la variable del servidor.
 */

export interface ProviderAccountDraft {
  id: string | null;
  code: string;
  name: string;
  providerKind: 'CULQI' | 'MANUAL' | 'BANK' | 'OTHER';
  environment: 'TEST' | 'LIVE';
  marketCode: string;
  currencies: string[];
  publicKey: string;
  secretKeyRef: string;
  routingPriority: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'ARCHIVED';
}

export const SECRET_REF_RE = /^[A-Z][A-Z0-9_]{2,63}$/;
const PUBLIC_KEY_RE = /^pk_(test|live)_[A-Za-z0-9]+$/;
const LOOKS_LIKE_KEY_RE = /^(sk|pk|rk)_(test|live)_/i;

export type DraftErrors = Partial<Record<keyof ProviderAccountDraft, string>>;

export function validateProviderAccount(d: ProviderAccountDraft): DraftErrors {
  const errors: DraftErrors = {};
  const code = d.code.trim();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(code)) errors.code = 'Código en minúsculas y guiones (ej. culqi-pe-test).';
  if (d.name.trim().length < 3) errors.name = 'Indica un nombre.';
  if (!d.marketCode) errors.marketCode = 'Elige el mercado que atiende la cuenta.';
  if (d.currencies.length === 0) errors.currencies = 'Marca al menos una moneda.';

  const pk = d.publicKey.trim();
  if (/^sk_/i.test(pk)) {
    errors.publicKey = 'Eso es una clave SECRETA (sk_). Nunca se escribe aquí: va como secret del servidor.';
  } else if (pk !== '' && !PUBLIC_KEY_RE.test(pk)) {
    errors.publicKey = 'La llave pública empieza por pk_test_ o pk_live_.';
  } else if (pk.startsWith('pk_live_') && d.environment !== 'LIVE') {
    errors.publicKey = 'Una llave pk_live_ solo corresponde a una cuenta LIVE.';
  } else if (pk.startsWith('pk_test_') && d.environment !== 'TEST') {
    errors.publicKey = 'Una llave pk_test_ solo corresponde a una cuenta TEST.';
  }

  const ref = d.secretKeyRef.trim();
  if (ref !== '' && (LOOKS_LIKE_KEY_RE.test(ref) || !SECRET_REF_RE.test(ref))) {
    errors.secretKeyRef = LOOKS_LIKE_KEY_RE.test(ref)
      ? 'Eso parece una clave. Escribe solo el NOMBRE de la variable del servidor (ej. CULQI_SECRET_KEY).'
      : 'Nombre en MAYÚSCULAS, dígitos y guiones bajos (ej. CULQI_SECRET_KEY).';
  }
  if (d.providerKind === 'CULQI' && d.environment === 'LIVE' && ref === '') {
    errors.secretKeyRef = 'Una cuenta Culqi LIVE exige el nombre de su secret del servidor.';
  }

  const prio = Number(d.routingPriority);
  if (!Number.isInteger(prio) || prio < 0 || prio > 10000) errors.routingPriority = 'Entero entre 0 y 10000.';
  return errors;
}
