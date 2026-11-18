/**
 * Edge Function: lead-sync — trae las solicitudes de la web de las apps (leads.v1).
 *
 * Dos canales, como tenant-sync:
 *   1. SERVIDOR (pg_cron vía `invoke_scheduled_function('LEAD_SYNC')`, cada 10
 *      min): la clave de servicio en `x-provisioning-secret` (tiempo constante).
 *   2. HUMANO («Traer ahora» en Comercial › Solicitudes de la web): JWT y el
 *      booleano explícito `can_manage_commercial()` ANTES de asumir service_role.
 *
 * Solo hace GET en las apps. Respuesta: conteos y códigos por destino; nunca
 * cuerpos de las apps.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { parseAllowedOrigins, withCors } from '../_shared/provisioning/index.ts';
import { codeOf } from '../_shared/sync/types.ts';
import { createRpcLeadSyncStore, isServerCall, runLeadSync } from './core.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const allowedOrigins = parseAllowedOrigins(Deno.env.get('MASTERADMIN_ALLOWED_ORIGINS'));

Deno.serve(withCors(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'METODO_NO_PERMITIDO' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json({ error: 'CONFIGURACION_INCOMPLETA: faltan credenciales del servidor' }, 500);
  }

  let actor = { id: null as string | null, role: 'SERVER' };
  if (!isServerCall(req.headers.get('x-provisioning-secret'), serviceKey)) {
    const authHeader = req.headers.get('authorization') ?? '';
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
      return json({ error: 'NO_AUTENTICADO: falta el token de sesión' }, 401);
    }
    const asUser = createClient(supabaseUrl, anonKey, {
      db: { schema: 'platform' },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await asUser.auth.getUser(authHeader.slice(7).trim());
    if (userError || !userData?.user) return json({ error: 'NO_AUTENTICADO: sesión inválida' }, 401);
    // AUTORIZACIÓN EXPLÍCITA: `=== true`; un error o un null NO autorizan.
    const { data: allowed, error: authzError } = await asUser.rpc('can_manage_commercial');
    if (authzError || allowed !== true) {
      return json({ error: 'NO_AUTORIZADO', message: 'Traer solicitudes exige gestión comercial' }, 403);
    }
    actor = { id: userData.user.id, role: 'PLATFORM' };
  }

  // Solo aquí, superado el gate, se asume el rol de servidor.
  const admin = createClient(supabaseUrl, serviceKey, { db: { schema: 'platform' } });
  try {
    const summary = await runLeadSync(
      {
        store: createRpcLeadSyncStore(admin),
        // ÚNICO punto por el que un valor de secreto entra al proceso.
        secretResolver: (ref: string) => Deno.env.get(ref),
      },
      actor,
    );
    return json(summary);
  } catch (error) {
    return json({ error: codeOf(error, 'ERROR_INTERNO') }, 500);
  }
}, allowedOrigins));
