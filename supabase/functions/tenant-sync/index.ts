/**
 * Edge Function: tenant-sync — sincronización de tenants con las 8 apps.
 *
 * Por qué una función NUEVA y no una acción del orquestador: las acciones del
 * orquestador actúan sobre UN sujeto (solicitud, destino o tenant) con un
 * permiso por sujeto, y responden en segundos. Esto es un BARRIDO de todas las
 * integraciones, lo dispara pg_cron, dura lo que tarden 8 apps y su permiso es
 * global. Separarlo deja el orquestador de provisioning intacto (sin riesgo de
 * regresión en altas) y le da a esta corrida su propio límite de tiempo.
 *
 * Dos canales, como el orquestador:
 *   1. SERVIDOR (pg_cron vía `invoke_scheduled_function('TENANT_SYNC')`): la
 *      clave de servicio en `x-provisioning-secret` (tiempo constante).
 *   2. HUMANO («Sincronizar ahora» en la consola): JWT y el booleano explícito
 *      `can_manage_tenant_sync()` ANTES de asumir service_role.
 *
 * El cliente no aporta nada más que la intención: ni destinos, ni rutas, ni
 * scopes. Respuesta: estados, conteos y códigos; nunca cuerpos de las apps.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { parseAllowedOrigins, withCors } from '../_shared/provisioning/index.ts';
import { codeOf } from '../_shared/sync/types.ts';
import { createRpcTenantSyncStore, httpStatusFor, isServerCall, runTenantSync, type SyncTrigger } from './core.ts';

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

  let trigger: SyncTrigger = 'SCHEDULED';
  let actor = { id: null as string | null, role: 'SERVER' };

  if (!isServerCall(req.headers.get('x-provisioning-secret'), serviceKey)) {
    const authHeader = req.headers.get('authorization') ?? '';
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
      return json({ error: 'NO_AUTENTICADO: falta el token de sesión' }, 401);
    }
    // `Authorization` con A mayúscula, como supabase-js (misma lección que el orquestador).
    const asUser = createClient(supabaseUrl, anonKey, {
      db: { schema: 'platform' },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await asUser.auth.getUser(authHeader.slice(7).trim());
    if (userError || !userData?.user) return json({ error: 'NO_AUTENTICADO: sesión inválida' }, 401);

    // AUTORIZACIÓN EXPLÍCITA: `=== true`; un error o un null NO autorizan.
    const { data: allowed, error: authzError } = await asUser.rpc('can_manage_tenant_sync');
    if (authzError || allowed !== true) {
      return json({ error: 'NO_AUTORIZADO', message: 'Sincronizar con las apps exige gestión de plataforma' }, 403);
    }
    trigger = 'MANUAL';
    actor = { id: userData.user.id, role: 'PLATFORM' };
  }

  // Solo aquí, superado el gate, se asume el rol de servidor.
  const admin = createClient(supabaseUrl, serviceKey, { db: { schema: 'platform' } });
  try {
    const summary = await runTenantSync(
      {
        store: createRpcTenantSyncStore(admin),
        // ÚNICO punto por el que un valor de secreto entra al proceso.
        secretResolver: (ref: string) => Deno.env.get(ref),
      },
      { trigger, actor },
    );
    return json(summary);
  } catch (error) {
    const code = codeOf(error, 'ERROR_INTERNO');
    return json({ error: code }, httpStatusFor(code));
  }
}, allowedOrigins));
