/**
 * Edge Function: cobro automático con tarjeta guardada (M2, spec §3.2).
 *
 * `verify_jwt = true`, y eso NO basta: un JWT válido demuestra sesión, no
 * autorización. Se acepta:
 *   (a) el JWT de un usuario para el que la base responde
 *       `can_read_finance() = true` (finanzas o super admin), o
 *   (b) la clave de servicio, para un cron futuro (D-07: no se programa).
 * Solo DESPUÉS de esa comprobación se construye el cliente de servicio.
 *
 * Cuerpo: `{invoice_id}` («Cobrar ahora») o `{run: true, limit?}` («Ejecutar
 * cobros pendientes»). La lógica vive en `_shared/payments/autocharge.ts`.
 * LIVE sigue bloqueado por `CULQI_ALLOW_LIVE` (resolvePaymentProvider).
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { resolvePaymentProvider, toAccountConfig } from '../_shared/payments/index.ts';
import { handleAutocharge, type AutochargeCaller } from '../_shared/payments/autocharge.ts';
import { parseAllowedOrigins, withCors } from '../_shared/provisioning/cors.ts';

const allowedOrigins = parseAllowedOrigins(Deno.env.get('MASTERADMIN_ALLOWED_ORIGINS'));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Comparación en tiempo constante: la clave de servicio no se compara con `===`. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(
  withCors(async (req: Request) => {
    if (req.method !== 'POST') return json({ error: 'METODO_NO_PERMITIDO' }, 405);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !serviceKey || !anonKey) return json({ error: 'CONFIGURACION_INCOMPLETA' }, 500);

    const authHeader = req.headers.get('authorization') ?? '';
    if (!authHeader.toLowerCase().startsWith('bearer ')) return json({ error: 'NO_AUTENTICADO' }, 401);
    const bearer = authHeader.slice('bearer '.length).trim();

    let caller: AutochargeCaller;
    if (sameSecret(bearer, serviceKey)) {
      caller = { kind: 'service' };
    } else {
      const asUser = createClient(supabaseUrl, anonKey, {
        db: { schema: 'platform' },
        // `Authorization` con mayúscula: ver payment-setup (cabecera duplicada → 401).
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userError } = await asUser.auth.getUser(bearer);
      if (userError || !userData?.user) return json({ error: 'NO_AUTENTICADO' }, 401);

      // Un booleano explícito de la base: RLS que devuelve cero filas NO es un «no».
      const { data: finance, error: authzError } = await asUser.rpc('can_read_finance');
      if (authzError || finance !== true) {
        return json({ error: 'NO_AUTORIZADO', message: 'El cobro automático exige rol financiero (EBIM_FINANCE o super admin).' }, 403);
      }
      caller = { kind: 'user', userId: userData.user.id };
    }

    // A partir de aquí, servidor.
    const admin = createClient(supabaseUrl, serviceKey, { db: { schema: 'platform' } });
    const bodyText = await req.text();
    if (bodyText.length > 16 * 1024) return json({ error: 'CUERPO_DEMASIADO_GRANDE' }, 413);

    const res = await handleAutocharge({ method: req.method, bodyText }, caller, {
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
    });
    return json(res.body, res.status);
  }, allowedOrigins),
);
