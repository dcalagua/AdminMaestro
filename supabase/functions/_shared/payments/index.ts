import { CulqiPaymentProvider } from './culqi.ts';
import { MockPaymentProvider } from './mock.ts';
import { ProviderError, type PaymentProvider, type ProviderAccountConfig } from './types.ts';

export * from './types.ts';
export { CulqiPaymentProvider } from './culqi.ts';
export { MockPaymentProvider } from './mock.ts';

/** Lectura de una variable de entorno. Inyectable para que los tests no dependan de `Deno`. */
export type EnvReader = (name: string) => string | undefined;

/** RPC con la clave de servicio (misma forma que `PortalDeps.rpc`). */
export type ServiceRpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

export interface ResolveProviderDeps {
  /** Por defecto, `Deno.env.get`. */
  env?: EnvReader;
  /**
   * Llave secreta CIFRADA (Vault) de la cuenta, en claro, o null si no existe.
   * La implementación real es `vaultSecretLoader` (RPC de servicio).
   */
  loadVaultSecret?: (accountId: string) => Promise<string | null>;
}

const denoEnv: EnvReader = (name) => Deno.env.get(name);

/**
 * Selector de proveedor.
 *
 * La regla de degradación está escrita una sola vez, aquí, para que no haya dos
 * funciones con criterios distintos sobre cuándo se cobra de verdad.
 *
 * Llave secreta, por orden:
 *   1. la llave CIFRADA de la cuenta (Vault), configurada desde la consola;
 *   2. la variable de entorno cuyo NOMBRE declara `secret_key_ref` (avanzado);
 *   3. ninguna -> MOCK.
 * URL de la API, por orden: `api_base_url` de la cuenta -> `CULQI_API_BASE` del
 * entorno -> ninguna -> MOCK (no se inventa la URL de la API).
 *
 *   sin llave o sin URL      -> MOCK
 *   `environment = 'LIVE'`   -> exige CULQI_ALLOW_LIVE=true (ENTORNO, no editable
 *                               desde la UI), o falla RUIDOSAMENTE
 *   resto                    -> Culqi TEST
 *
 * El último punto es el importante: en LIVE **nunca** se degrada en silencio a
 * MOCK. Una pasarela de producción que "no cobra pero no avisa" es peor que una
 * caída, porque nadie la detecta hasta el cierre de mes. La coherencia
 * llave/entorno (sk_live_ ↔ LIVE) la vuelve a comprobar el adapter.
 *
 * La llave en claro solo vive en esta función y en el adapter: nunca se
 * registra, ni se incluye en un mensaje de error.
 */
export async function resolvePaymentProvider(
  account: ProviderAccountConfig,
  deps: ResolveProviderDeps = {},
): Promise<PaymentProvider> {
  if (account.providerKind !== 'CULQI') {
    // MANUAL y BANK no tienen pasarela: se concilian a mano. El mock da una
    // implementación inerte para que quien llama no tenga que ramificar.
    return new MockPaymentProvider(account);
  }

  const env = deps.env ?? denoEnv;
  const missing: string[] = [];

  let secretKey: string | null = null;
  if (account.hasVaultSecret) {
    // La cuenta DICE tener llave cifrada: si no se puede leer es un fallo del
    // servidor, no "una cuenta sin configurar". No se degrada a MOCK.
    if (!deps.loadVaultSecret) {
      throw new ProviderError(
        'LLAVE_NO_DISPONIBLE',
        `La cuenta ${account.code} tiene una llave cifrada pero el servidor no puede leerla.`,
        500,
      );
    }
    try {
      secretKey = await deps.loadVaultSecret(account.id);
    } catch {
      throw new ProviderError(
        'LLAVE_NO_DISPONIBLE',
        `No se pudo leer la llave secreta cifrada de la cuenta ${account.code}.`,
        500,
      );
    }
  }
  if (!secretKey && account.secretKeyRef) {
    secretKey = env(account.secretKeyRef) || null;
  }
  if (!secretKey) {
    missing.push(
      account.secretKeyRef
        ? `llave secreta (ni cifrada en la cuenta ni en ${account.secretKeyRef})`
        : 'llave secreta (configúrala en Configuración → Cuentas de pago)',
    );
  }

  const apiBase = account.apiBaseUrl || env('CULQI_API_BASE') || null;
  if (!apiBase) missing.push('URL de la API (en la cuenta o CULQI_API_BASE)');

  if (missing.length > 0) {
    if (account.environment === 'LIVE') {
      throw new ProviderError(
        'CULQI_LIVE_SIN_CONFIGURAR',
        `La cuenta ${account.code} es LIVE pero falta configuración: ${missing.join(', ')}. ` +
          'No se degrada a simulación en producción.',
        500,
      );
    }
    return new MockPaymentProvider(account);
  }

  if (account.environment === 'LIVE' && env('CULQI_ALLOW_LIVE') !== 'true') {
    throw new ProviderError(
      'LIVE_NO_AUTORIZADO',
      'El cobro LIVE exige CULQI_ALLOW_LIVE=true en el entorno del servidor. ' +
        'Es un interruptor deliberado: activarlo cobra dinero real.',
      403,
    );
  }

  return new CulqiPaymentProvider(account, {
    apiBase: apiBase!.replace(/\/+$/, ''),
    secretKey: secretKey!,
  });
}

/**
 * Lector de la llave cifrada con la RPC de SERVICIO `payment_provider_account_secret`
 * (EXECUTE solo para service_role). El error de la RPC no se propaga tal cual:
 * se sustituye por un código estable sin detalles.
 */
export function vaultSecretLoader(rpc: ServiceRpc): (accountId: string) => Promise<string | null> {
  return async (accountId) => {
    const { data, error } = await rpc('payment_provider_account_secret', { p_account_id: accountId });
    if (error) {
      throw new ProviderError('LLAVE_NO_DISPONIBLE', 'No se pudo leer la llave secreta cifrada.', 500);
    }
    return typeof data === 'string' && data !== '' ? data : null;
  };
}

/**
 * Resolución completa a partir de una FILA de la base: lo que cablean las Edge
 * Functions de pago (`resolveProvider` de sus deps).
 */
export function providerResolver(
  rpc: ServiceRpc,
  env: EnvReader = denoEnv,
): (row: Record<string, unknown>) => Promise<PaymentProvider> {
  const loadVaultSecret = vaultSecretLoader(rpc);
  return (row) => resolvePaymentProvider(toAccountConfig(row), { env, loadVaultSecret });
}

/**
 * Columnas de `payment_provider_accounts` que necesita la resolución. Las
 * funciones las leen con el cliente de SERVICIO: `secret_vault_id` está fuera
 * del alcance de `authenticated` por privilegio de columna.
 */
export const PROVIDER_ACCOUNT_COLUMNS =
  'id, code, provider_kind, environment, currency, public_key, secret_key_ref, secret_vault_id, api_base_url, status';

/** Configuración de cuenta tal y como sale de la base, sin secretos. */
export function toAccountConfig(row: Record<string, unknown>): ProviderAccountConfig {
  // V3: sin moneda no se asume PEN. Una cuenta regional mal cargada debe
  // fallar aquí, no cobrar en la moneda de otro país.
  if (typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency)) {
    throw new ProviderError(
      'CUENTA_SIN_MONEDA',
      `La cuenta de cobro ${String(row.code)} no declara una moneda ISO válida.`,
      500,
    );
  }
  return {
    id: String(row.id),
    code: String(row.code),
    providerKind: row.provider_kind as ProviderAccountConfig['providerKind'],
    environment: row.environment as ProviderAccountConfig['environment'],
    currency: row.currency,
    publicKey: (row.public_key as string | null) ?? null,
    secretKeyRef: (row.secret_key_ref as string | null) ?? null,
    hasVaultSecret: typeof row.secret_vault_id === 'string' && row.secret_vault_id !== '',
    apiBaseUrl:
      typeof row.api_base_url === 'string' && row.api_base_url !== '' ? row.api_base_url : null,
  };
}

/** Respuesta JSON uniforme para las tres Edge Functions de pago. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
