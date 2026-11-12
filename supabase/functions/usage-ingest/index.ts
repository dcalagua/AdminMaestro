/**
 * Edge Function: usage-ingest (spec §11.3, contrato contracts/usage/v1).
 *
 * El SaaS autentica con SU JWT ES256 en `Authorization: Bearer` (no con un JWT
 * de Supabase): por eso `verify_jwt = false` en config.toml y la verificación
 * completa (firma, aud, scope, TTL, jti de un solo uso) la hace
 * _shared/usage/ingest.ts antes de construir nada con service_role.
 *
 * Apagado por defecto: USAGE_INGEST_ENABLED !== 'true' → 503
 * USAGE_INGEST_DISABLED (D-12), y además kill-switch por producto.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleUsageIngest } from '../_shared/usage/ingest.ts';
import { MAX_BODY_BYTES } from '../_shared/usage/types.ts';
import { buildIngestDeps } from './core.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'CONFIGURACION_INCOMPLETA' }, 500);

  // Tope de lectura: no se lee un cuerpo mayor al permitido (+1 para detectarlo).
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
  const bodyText = req.method === 'POST' ? await req.text() : '';

  const admin = createClient(supabaseUrl, serviceKey, { db: { schema: 'platform' } });
  const deps = buildIngestDeps(admin, (name) => Deno.env.get(name));
  const res = await handleUsageIngest({ method: req.method, headers: req.headers, bodyText }, deps);
  return json(res.body, res.status);
});
