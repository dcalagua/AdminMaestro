/**
 * Edge Function: portal de pago PÚBLICO (M1/M2, spec §2.3).
 *
 * `verify_jwt = false`: quien paga no tiene sesión de MasterAdmin. Su única
 * credencial es el token del enlace, que la página lee del fragmento `#` y
 * manda en el CUERPO. Esta función lo convierte en su sha256 y pregunta a la
 * base con la clave de servicio, que nunca sale de aquí.
 *
 * Rutas (POST): /statement · /charge · /enroll · /unenroll. Cuerpo ≤ 16 KB.
 * CORS limitado a la consola (`MASTERADMIN_ALLOWED_ORIGINS`).
 *
 * Toda la lógica vive en `_shared/payments/portal.ts` (probada con vitest).
 * Aquí solo se cablean el cliente de servicio, el proveedor y el entorno:
 *   · PAYMENT_PORTAL_ALLOW_MOCK=true permite cobrar con cuentas SIN
 *     credenciales (modo de prueba). Por defecto NO: un portal público no debe
 *     poder fabricar pagos simulados en un entorno desplegado.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { resolvePaymentProvider, toAccountConfig } from '../_shared/payments/index.ts';
import { handlePayPortal, PORTAL_MAX_BODY_BYTES, portalError } from '../_shared/payments/portal.ts';
import { parseAllowedOrigins, withCors } from '../_shared/provisioning/cors.ts';

const allowedOrigins = parseAllowedOrigins(Deno.env.get('MASTERADMIN_ALLOWED_ORIGINS'));

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(
  withCors(async (req: Request) => {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) {
      const e = portalError('ERROR_INTERNO');
      return respond(e.status, e.body);
    }

    // Tope de lectura antes de leer: no se acepta un cuerpo mayor al permitido.
    const declared = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > PORTAL_MAX_BODY_BYTES) {
      const e = portalError('CUERPO_DEMASIADO_GRANDE');
      return respond(e.status, e.body);
    }
    const bodyText = req.method === 'POST' ? await req.text() : '';

    const admin = createClient(supabaseUrl, serviceKey, { db: { schema: 'platform' } });
    const route = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? '';

    const res = await handlePayPortal(
      {
        method: req.method,
        route,
        bodyText,
        contentLength: Number.isFinite(declared) ? declared : null,
        clientIp:
          req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
          req.headers.get('x-real-ip') ??
          null,
        userAgent: req.headers.get('user-agent'),
      },
      {
        rpc: async (fn, args) => {
          const { data, error } = await admin.rpc(fn, args);
          return { data, error };
        },
        loadAccount: async (id) => {
          const { data } = await admin
            .from('payment_provider_accounts')
            .select('id, code, provider_kind, environment, currency, public_key, secret_key_ref, status')
            .eq('id', id)
            .maybeSingle();
          return data && data.status === 'ACTIVE' ? (data as Record<string, unknown>) : null;
        },
        resolveProvider: (row) => resolvePaymentProvider(toAccountConfig(row)),
        allowMock: Deno.env.get('PAYMENT_PORTAL_ALLOW_MOCK') === 'true',
        sha256Hex,
      },
    );
    return respond(res.status, res.body);
  }, allowedOrigins),
);
