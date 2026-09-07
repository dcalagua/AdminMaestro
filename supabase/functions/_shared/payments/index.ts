import { CulqiPaymentProvider } from './culqi.ts';
import { MockPaymentProvider } from './mock.ts';
import { ProviderError, type PaymentProvider, type ProviderAccountConfig } from './types.ts';

export * from './types.ts';
export { CulqiPaymentProvider } from './culqi.ts';
export { MockPaymentProvider } from './mock.ts';

/**
 * Selector de proveedor.
 *
 * La regla de degradación está escrita una sola vez, aquí, para que no haya dos
 * funciones con criterios distintos sobre cuándo se cobra de verdad:
 *
 *   sin `secret_key_ref`            -> MOCK
 *   el secreto no está en el entorno -> MOCK
 *   sin `CULQI_API_BASE`             -> MOCK   (no se inventa la URL de la API)
 *   `environment = 'LIVE'`           -> exige CULQI_ALLOW_LIVE=true, o falla RUIDOSAMENTE
 *   resto                            -> Culqi TEST
 *
 * El último punto es el importante: en LIVE **nunca** se degrada en silencio a
 * MOCK. Una pasarela de producción que "no cobra pero no avisa" es peor que una
 * caída, porque nadie la detecta hasta el cierre de mes.
 */
export function resolvePaymentProvider(account: ProviderAccountConfig): PaymentProvider {
  const missing: string[] = [];

  if (account.providerKind !== 'CULQI') {
    // MANUAL y BANK no tienen pasarela: se concilian a mano. El mock da una
    // implementación inerte para que quien llama no tenga que ramificar.
    return new MockPaymentProvider(account);
  }

  if (!account.secretKeyRef) missing.push('secret_key_ref en la cuenta');

  const secretKey = account.secretKeyRef ? Deno.env.get(account.secretKeyRef) : undefined;
  if (account.secretKeyRef && !secretKey) missing.push(account.secretKeyRef);

  const apiBase = Deno.env.get('CULQI_API_BASE');
  if (!apiBase) missing.push('CULQI_API_BASE');

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

  if (account.environment === 'LIVE' && Deno.env.get('CULQI_ALLOW_LIVE') !== 'true') {
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

/** Configuración de cuenta tal y como sale de la base, sin secretos. */
export function toAccountConfig(row: Record<string, unknown>): ProviderAccountConfig {
  return {
    id: String(row.id),
    code: String(row.code),
    providerKind: row.provider_kind as ProviderAccountConfig['providerKind'],
    environment: row.environment as ProviderAccountConfig['environment'],
    currency: String(row.currency ?? 'PEN'),
    publicKey: (row.public_key as string | null) ?? null,
    secretKeyRef: (row.secret_key_ref as string | null) ?? null,
  };
}

/** Respuesta JSON uniforme para las tres Edge Functions de pago. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
