/**
 * CORS del orquestador.
 *
 * La consola llama a `provisioning-orchestrator` desde el navegador con
 * `supabase.functions.invoke()`, que manda `authorization`, `apikey` y
 * `content-type: application/json`: el navegador exige un preflight `OPTIONS`.
 * Sin respuesta a ese preflight, «Verificar conexión» y «Ejecutar» mueren en el
 * navegador antes de que la función vea la petición.
 *
 * Tres decisiones:
 *   · ALLOWLIST de orígenes, no `*`. Los orígenes locales de la consola vienen
 *     por defecto; cualquier otro (la consola desplegada) se declara en el
 *     secreto `MASTERADMIN_ALLOWED_ORIGINS`, separado por comas.
 *   · SIN `Access-Control-Allow-Credentials`: la sesión viaja como JWT en una
 *     cabecera, no en cookies.
 *   · El preflight NO autentica ni autoriza nada: responde y termina. Cualquier
 *     otro método pasa por el handler, que conserva su autenticación intacta.
 *     CORS decide qué puede LEER el navegador, nunca quién puede EJECUTAR.
 */

/** Orígenes del dev server de la consola (`vite.config.ts`: 5199, strictPort). */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  'http://127.0.0.1:5199',
  'http://localhost:5199',
];

export const CORS_ALLOWED_METHODS = 'POST, GET, OPTIONS';

/**
 * Cabeceras que manda la consola. `x-application-name` es la cabecera global
 * del cliente (`src/lib/supabase.ts`) y `functions.invoke` también la envía: si
 * faltara aquí, el preflight fallaría igual que sin CORS.
 */
export const CORS_ALLOWED_HEADERS = [
  'authorization',
  'apikey',
  'content-type',
  'x-client-info',
  'x-application-name',
  'x-correlation-id',
  'idempotency-key',
].join(', ');

/** Allowlist efectiva: los orígenes por defecto más los declarados. */
export function parseAllowedOrigins(configured: string | null | undefined): string[] {
  const extra = (configured ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => o !== '' && o !== '*');
  return Array.from(new Set([...DEFAULT_ALLOWED_ORIGINS, ...extra]));
}

/**
 * Cabeceras CORS para un origen. Un origen fuera de la allowlist no recibe
 * `Access-Control-Allow-Origin`: el navegador bloquea la lectura y el servidor
 * no tiene que decidir nada más.
 */
export function corsHeadersFor(
  origin: string | null,
  allowedOrigins: readonly string[],
): Record<string, string> {
  const headers: Record<string, string> = { vary: 'Origin' };
  if (origin && allowedOrigins.includes(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-methods'] = CORS_ALLOWED_METHODS;
    headers['access-control-allow-headers'] = CORS_ALLOWED_HEADERS;
    headers['access-control-max-age'] = '600';
  }
  return headers;
}

/**
 * Envuelve el handler: responde el preflight SIN llamarlo y añade las cabeceras
 * CORS a todas sus respuestas. El handler recibe exactamente la misma petición.
 */
export function withCors(
  handler: (req: Request) => Promise<Response>,
  allowedOrigins: readonly string[],
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const cors = corsHeadersFor(req.headers.get('origin'), allowedOrigins);

    if (req.method === 'OPTIONS') {
      const allowed = 'access-control-allow-origin' in cors;
      return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    }

    const response = await handler(req);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(cors)) headers.set(name, value);
    return new Response(response.body, { status: response.status, headers });
  };
}
