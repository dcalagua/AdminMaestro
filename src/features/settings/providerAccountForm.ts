/**
 * Validación de la ficha de una cuenta de cobro (Configuración → Cuentas de pago).
 *
 * Es UX: la base vuelve a validar (CHECK de la tabla, `upsert_payment_provider_account`
 * y `set_payment_provider_secret`). La llave secreta NO forma parte de la ficha:
 * se configura aparte («Configurar llave») y viaja una sola vez a la RPC, que la
 * guarda cifrada. El campo avanzado «Variable de entorno» recibe solo un NOMBRE.
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
  /** URL base de la API (opcional). Vacía = `CULQI_API_BASE` del servidor. */
  apiBaseUrl: string;
  routingPriority: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  /** Solo lectura: ¿la cuenta ya tiene llave cifrada? (no se edita en la ficha). */
  hasEncryptedKey: boolean;
}

export const SECRET_REF_RE = /^[A-Z][A-Z0-9_]{2,63}$/;
const PUBLIC_KEY_RE = /^pk_(test|live)_[A-Za-z0-9]+$/;
const LOOKS_LIKE_KEY_RE = /^(sk|pk|rk)_(test|live)_/i;
/** Misma forma que exige `set_payment_provider_secret`. */
const SECRET_KEY_RE = /^sk_(test|live)_[A-Za-z0-9]{10,}$/;
/** Misma forma que el CHECK `ppa_api_base_url_ck`: https, sin usuario ni parámetros. */
const API_BASE_RE = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[A-Za-z0-9._~/-]*)?$/;

/** URL de la API tal como la guarda la base: sin espacios ni barra final; vacía = null. */
export function normalizeApiBaseUrl(value: string): string | null {
  const v = value.trim().replace(/\/+$/, '');
  return v === '' ? null : v;
}

/**
 * Validación de la llave secreta ANTES de enviarla. Los mensajes describen la
 * forma esperada y NUNCA repiten el valor tecleado.
 */
export function validateSecretKey(value: string, environment: 'TEST' | 'LIVE'): string | null {
  const v = value.trim();
  if (v === '') return 'Pega la llave secreta (sk_test_… o sk_live_…).';
  if (/^pk_/i.test(v)) return 'Esa es la llave PÚBLICA (pk_). Aquí va la llave secreta, que empieza por sk_.';
  if (!SECRET_KEY_RE.test(v) || v.length > 200) {
    return 'La llave secreta empieza por sk_test_ o sk_live_ seguida de al menos 10 letras o dígitos.';
  }
  const isLive = v.startsWith('sk_live_');
  if (isLive && environment !== 'LIVE') return 'Una llave sk_live_ (producción) solo corresponde a una cuenta LIVE.';
  if (!isLive && environment !== 'TEST') return 'Una llave sk_test_ (pruebas) solo corresponde a una cuenta TEST.';
  return null;
}

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
  // Espejo de `ppa_live_needs_secret_ref_ck`: una cuenta Culqi LIVE ACTIVA
  // necesita llave. Una nueva se crea Inactiva, se le configura la llave y se activa.
  if (d.providerKind === 'CULQI' && d.environment === 'LIVE' && d.status === 'ACTIVE' && ref === '' && !d.hasEncryptedKey) {
    errors.status = d.id
      ? 'Una cuenta Culqi LIVE activa necesita su llave secreta: configúrala con «Configurar llave» antes de activarla.'
      : 'Crea la cuenta LIVE como Inactiva, configura su llave secreta con «Configurar llave» y actívala después.';
  }

  const api = d.apiBaseUrl.trim();
  if (api !== '') {
    const normalized = normalizeApiBaseUrl(api) ?? '';
    if (LOOKS_LIKE_KEY_RE.test(normalized) || /(sk|pk)_(test|live)_/i.test(normalized)) {
      errors.apiBaseUrl = 'La URL no puede contener llaves.';
    } else if (!API_BASE_RE.test(normalized) || normalized.length > 200) {
      errors.apiBaseUrl = 'URL https sin usuario ni parámetros (ej. https://api.culqi.com/v2).';
    }
  }

  const prio = Number(d.routingPriority);
  if (!Number.isInteger(prio) || prio < 0 || prio > 10000) errors.routingPriority = 'Entero entre 0 y 10000.';
  return errors;
}
