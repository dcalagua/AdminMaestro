/**
 * Edge Function: entitlement-sync (jobs push / verify / registry-verify).
 *
 * SOLO canal servidor: la clave de servicio en `x-provisioning-secret` (cron
 * vía pg_net con la clave en Vault, u otra Edge Function). No hay canal humano:
 * el "sincronizar ahora" de la consola es la acción SYNC_ENTITLEMENTS del
 * orquestador, que sí autoriza al usuario con un booleano de la base.
 *
 * Cuerpo: `{ "job": "issue" | "push" | "verify" | "registry-verify" | "all",
 *            "sweep": boolean, "limit": 1..100 }`.
 * Respuesta: conteos, estados y códigos. Nunca snapshots, cuerpos ni tokens.
 *
 * La programación (pg_cron) NO se crea en una migración: la URL y la clave son
 * del entorno. Runbook: docs/runbooks/entitlement-sync.md.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { EntitlementSyncClient } from '../_shared/entitlements/sync-client.ts';
import { createRpcSyncStore } from '../_shared/entitlements/sync-store.ts';
import { isServerCall, parseJobRequest, runJob } from './core.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'METODO_NO_PERMITIDO' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'CONFIGURACION_INCOMPLETA: faltan credenciales del servidor' }, 500);
  }
  if (!isServerCall(req.headers.get('x-provisioning-secret'), serviceKey)) {
    return json({ error: 'NO_AUTORIZADO: solo el canal servidor ejecuta los jobs de entitlements' }, 403);
  }

  let request;
  try {
    request = parseJobRequest(await req.json().catch(() => ({})));
  } catch (error) {
    return json({ error: (error as Error).message.split(':')[0] }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey, { db: { schema: 'platform' } });
  const deps = {
    store: createRpcSyncStore(admin),
    client: new EntitlementSyncClient({ secretResolver: (ref: string) => Deno.env.get(ref) }),
    worker: `entitlement-sync:${crypto.randomUUID()}`,
  };
  try {
    return json(await runJob(deps, request));
  } catch (error) {
    const code = (error as { code?: string }).code;
    return json({ error: typeof code === 'string' ? code : 'ERROR_INTERNO' }, 500);
  }
});
