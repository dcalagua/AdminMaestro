/**
 * Edge Function: worker de provisioning.
 *
 * Toma una solicitud de `platform.provisioning_requests`, la hace avanzar por la
 * máquina de estados y registra el timeline en `platform.provisioning_events`.
 *
 * Por qué vive del lado servidor y no en el frontend:
 *   · usa la clave de servicio para escribir la bitácora (RLS deja la tabla en
 *     sólo lectura para `authenticated`);
 *   · en modo LIVE necesitaría el token de la Management API, que jamás puede
 *     llegar al navegador.
 *
 * La UI sólo LEE el resultado. Nunca recibe credenciales de infraestructura.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { resolveProvider } from './provider.ts';
import type { ProvisioningAction } from './provider.ts';

interface RequestBody {
  request_id: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'METODO_NO_PERMITIDO' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json({ error: 'CONFIGURACION_INCOMPLETA: faltan credenciales del servidor' }, 500);
  }

  /*
   * ============================ AUTORIZACIÓN ============================
   *
   * `verify_jwt = true` solo demuestra que quien llama trae un JWT válido —
   * es decir, que ha iniciado sesión. NO demuestra que pueda aprovisionar
   * infraestructura. Antes de este bloque, este worker construía el cliente
   * `service_role` de inmediato: cualquier usuario autenticado, incluido un
   * TENANT_USER, podía hacer avanzar la máquina de estados de provisioning
   * enviando únicamente un UUID de solicitud.
   *
   * Hay DOS canales legítimos, y se distinguen explícitamente:
   *
   *   1. SERVIDOR (cron, otra Edge Function): presenta la clave de servicio en
   *      `x-provisioning-secret`. No hay usuario detrás.
   *   2. HUMANO desde la consola: presenta su JWT y debe superar
   *      `platform.can_run_provisioning()` — super admin o EBIM_PRODUCT_ADMIN.
   *
   * Cualquier otra combinación se rechaza ANTES de tocar `service_role`.
   */
  const canalServidor = req.headers.get('x-provisioning-secret');
  const esServidor = typeof canalServidor === 'string' && canalServidor === serviceKey;

  if (!esServidor) {
    const authHeader = req.headers.get('authorization') ?? '';
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
      return json({ error: 'NO_AUTENTICADO: falta el token de sesión' }, 401);
    }

    const asUser = createClient(supabaseUrl, anonKey, {
      db: { schema: 'platform' },
      /*
       * `Authorization` con A MAYÚSCULA, exactamente como la escribe supabase-js.
       *
       * Con `authorization` en minúscula —que es lo que había— la cabecera se
       * DUPLICA: la nuestra y la que el cliente añade por su cuenta. La puerta de
       * enlace responde entonces «Bad request» en texto plano, el cliente lo
       * reporta como AuthUnknownError y esta función lo traduce a NO_AUTENTICADO.
       *
       * Efecto medido sobre el runtime real: 401 para TODO el mundo, incluido
       * EBIM_FINANCE con un JWT válido. Falla cerrado, así que no abría ningún
       * hueco; simplemente dejaba la función inservible sin decir por qué.
       */
      global: { headers: { Authorization: authHeader } },
    });

    // El token se pasa EXPLÍCITAMENTE en vez de confiar en que el cliente lo
    // deduzca de la cabecera: en una Edge Function no hay sesión almacenada de
    // la que tirar, y así la identidad no depende del transporte.
    const bearerToken = authHeader.slice('bearer '.length).trim();
    const { data: userData, error: userError } = await asUser.auth.getUser(bearerToken);
    if (userError || !userData?.user) {
      return json({ error: 'NO_AUTENTICADO: sesión inválida' }, 401);
    }

    // Booleano explícito desde la base. Nunca «no hubo error, luego puede».
    const { data: puedeAprovisionar, error: authzError } =
      await asUser.rpc('can_run_provisioning');

    if (authzError) {
      return json({ error: 'NO_AUTORIZADO', message: 'No se pudo verificar la autorización' }, 403);
    }
    if (puedeAprovisionar !== true) {
      return json(
        {
          error: 'NO_AUTORIZADO',
          message:
            'Ejecutar el worker de provisioning exige super admin o EBIM_PRODUCT_ADMIN. ' +
            'Un JWT válido no es autorización.',
        },
        403,
      );
    }
  }

  // Solo aquí, superado el gate, se asume el rol de servidor.
  const admin = createClient(supabaseUrl, serviceKey, { db: { schema: 'platform' } });

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ error: 'CUERPO_INVALIDO: se esperaba JSON con request_id' }, 400);
  }

  if (!body.request_id) {
    return json({ error: 'REQUEST_ID_REQUERIDO' }, 400);
  }

  const { data: request, error: loadError } = await admin
    .from('provisioning_requests')
    .select('*')
    .eq('id', body.request_id)
    .maybeSingle();

  if (loadError) return json({ error: loadError.message }, 500);
  if (!request) return json({ error: 'SOLICITUD_NO_ENCONTRADA' }, 404);

  // Idempotencia: una solicitud terminal no se reprocesa. Reintentar un
  // SUCCEEDED duplicaría infraestructura; reintentar un CANCELLED revive algo
  // que alguien decidió detener.
  if (['SUCCEEDED', 'CANCELLED'].includes(request.status)) {
    return json({ skipped: true, reason: `La solicitud ya está en estado ${request.status}` });
  }

  if (request.attempts >= request.max_attempts) {
    return json({ skipped: true, reason: 'AGOTADOS_LOS_REINTENTOS' }, 409);
  }

  const provider = resolveProvider();

  // El modo LIVE exige que la solicitud lo pida explícitamente. Un worker en
  // LIVE no debe "promover" en silencio una solicitud creada como DRY_RUN.
  if (provider.mode === 'LIVE' && request.mode !== 'LIVE') {
    return json({ error: 'MODO_INCOMPATIBLE: la solicitud es DRY_RUN y el worker está en LIVE' }, 409);
  }

  await admin
    .from('provisioning_requests')
    .update({ status: 'VALIDATING', attempts: request.attempts + 1, started_at: new Date().toISOString() })
    .eq('id', request.id);

  const outcome = await provider.execute({
    action: request.action as ProvisioningAction,
    payload: (request.payload ?? {}) as Record<string, unknown>,
    tenantId: request.tenant_id,
    deploymentTargetId: request.deployment_target_id,
  });

  // El timeline se escribe paso a paso: si algo falla a mitad, queda registrado
  // hasta dónde llegó, no un salto de PENDING a FAILED sin explicación.
  for (const step of outcome.steps) {
    // La transición RUNNING debe reflejarse también en la solicitud.
    if (step.status === 'RUNNING') {
      await admin.from('provisioning_requests').update({ status: 'RUNNING' }).eq('id', request.id);
    }
    await admin.from('provisioning_events').insert({
      provisioning_request_id: request.id,
      status: step.status,
      message: step.message,
      detail: step.detail,
    });
  }

  await admin
    .from('provisioning_requests')
    .update({
      status: outcome.ok ? 'SUCCEEDED' : 'FAILED',
      result: outcome.result,
      error_message: outcome.errorMessage ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', request.id);

  return json({
    request_id: request.id,
    mode: provider.mode,
    provider: provider.name,
    ok: outcome.ok,
    result: outcome.result,
    error: outcome.errorMessage ?? null,
  });
});
