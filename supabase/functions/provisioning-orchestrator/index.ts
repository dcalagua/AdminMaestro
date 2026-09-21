/**
 * Edge Function: orquestador de provisioning SaaS.
 *
 * React NUNCA llama a EWM, TMS ni a ningún producto. React llama AQUÍ, y esta
 * función:
 *
 *   1. valida el JWT humano;
 *   2. resuelve el usuario;
 *   3. comprueba el permiso con un BOOLEANO EXPLÍCITO de la base;
 *   4. y sólo entonces asume el rol de servidor.
 *
 * El orden del punto 3 y 4 es lo importante. El bug que ya ocurrió en payments
 * fue asumir que «si la consulta con RLS no devolvió error, el usuario está
 * autorizado». RLS filtra FILAS: una lista vacía y una prohibición se ven
 * exactamente igual. Aquí la autorización es una pregunta con respuesta
 * booleana, hecha ANTES de tener ningún privilegio elevado.
 *
 * Toda la configuración —base_url, issuer, audience, scopes, algoritmo, TTL,
 * referencia de secreto, tipo de adaptador— la resuelve el SERVIDOR. El cliente
 * manda un identificador de solicitud y nada más: no puede reapuntar la llamada
 * ni ampliar el alcance del token.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  normalizeThrownFailure,
  parseAllowedOrigins,
  permissionRpcFor,
  resolveAdapter,
  routeAction,
  withCors,
  type AdapterType,
  type ProvisioningContext,
  type ProvisioningEnvironment,
} from '../_shared/provisioning/index.ts';

/**
 * Lo ÚNICO que el cliente aporta. `source`, `adapter` o cualquier otra clave
 * del cuerpo se ignoran: el contexto de ejecución se construye exclusivamente
 * desde `provisioning_execution_context`.
 */
interface RequestBody {
  action?: unknown;
  request_id?: string;
  deployment_target_id?: string;
}

function adminClient(url: string, key: string) {
  return createClient(url, key, { db: { schema: 'platform' } });
}
type AdminClient = ReturnType<typeof adminClient>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Resolución de secretos. ÚNICO punto por el que un valor de secreto entra al
 * proceso, y nunca se guarda en ninguna estructura que pueda serializarse.
 */
const secretResolver = (secretRef: string): string | undefined => Deno.env.get(secretRef);

// El preflight se responde ANTES de cualquier autenticación y sin ejecutar
// nada; el resto de métodos llega al handler con su autenticación intacta.
const allowedOrigins = parseAllowedOrigins(Deno.env.get('MASTERADMIN_ALLOWED_ORIGINS'));

Deno.serve(withCors(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'METODO_NO_PERMITIDO' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json({ error: 'CONFIGURACION_INCOMPLETA: faltan credenciales del servidor' }, 500);
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ error: 'CUERPO_INVALIDO: se esperaba JSON' }, 400);
  }

  const action = routeAction(body.action);

  // ======================== CANALES DE ENTRADA ========================
  // 1. SERVIDOR (cron u otra Edge Function): presenta la clave de servicio.
  // 2. HUMANO desde la consola: presenta su JWT y debe superar el permiso.
  // Cualquier otra combinación se rechaza ANTES de tocar `service_role`.
  const serverChannel = req.headers.get('x-provisioning-secret');
  const isServer = typeof serverChannel === 'string' && serverChannel === serviceKey;

  let actorId: string | null = null;
  let actorRole = 'SERVER';

  if (!isServer) {
    const authHeader = req.headers.get('authorization') ?? '';
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
      return json({ error: 'NO_AUTENTICADO: falta el token de sesión' }, 401);
    }

    const asUser = createClient(supabaseUrl, anonKey, {
      db: { schema: 'platform' },
      // `Authorization` con A mayúscula, exactamente como la escribe
      // supabase-js: en minúscula la cabecera se DUPLICA y la puerta de enlace
      // responde «Bad request» en texto plano, que el cliente reporta como
      // fallo de autenticación. Falla cerrado, pero deja la función inservible
      // sin decir por qué. (Misma lección que en provisioning-worker.)
      global: { headers: { Authorization: authHeader } },
    });

    const bearer = authHeader.slice('bearer '.length).trim();
    const { data: userData, error: userError } = await asUser.auth.getUser(bearer);
    if (userError || !userData?.user) {
      return json({ error: 'NO_AUTENTICADO: sesión inválida' }, 401);
    }
    actorId = userData.user.id;

    // ---- AUTORIZACIÓN EXPLÍCITA -----------------------------------------
    const permission = permissionRpcFor(action);
    const subjectId = body[permission.bodyField];

    if (!subjectId) {
      return json({ error: 'PARAMETRO_REQUERIDO: falta el identificador de la operación' }, 400);
    }

    const { data: allowed, error: authzError } = await asUser.rpc(permission.rpc, {
      [permission.arg]: subjectId,
    });

    if (authzError) {
      return json(
        { error: 'NO_AUTORIZADO', message: 'No se pudo verificar la autorización' },
        403,
      );
    }
    // `=== true` y no un valor verdadero cualquiera: null, undefined o una lista
    // vacía NO son autorización.
    if (allowed !== true) {
      return json(
        {
          error: 'NO_AUTORIZADO',
          message:
            'Esta operación exige el permiso correspondiente sobre el producto. ' +
            'Un JWT válido demuestra sesión, no autorización.',
        },
        403,
      );
    }

    const { data: role } = await asUser.rpc('my_provisioning_actor_role');
    actorRole = typeof role === 'string' ? role : 'UNKNOWN';
  }

  // Sólo aquí, superado el gate, se asume el rol de servidor.
  const admin = adminClient(supabaseUrl, serviceKey);

  if (action === 'CHECK_HEALTH') {
    return await checkHealth(admin, body.deployment_target_id!, actorId, actorRole);
  }
  if (action === 'GET_STATUS' || action === 'REPLAY_CERTIFICATION') {
    return json({ error: 'ACCION_NO_DISPONIBLE' }, 501);
  }

  return await provision(admin, body.request_id!, actorId, actorRole);
}, allowedOrigins));

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------
async function provision(
  admin: AdminClient,
  requestId: string,
  actorId: string | null,
  actorRole: string,
): Promise<Response> {
  const { data: preconditions, error: preError } = await admin.rpc(
    'check_provisioning_preconditions',
    { p_request_id: requestId },
  );
  if (preError) return json({ error: 'SOLICITUD_NO_ENCONTRADA', message: preError.message }, 404);

  const pre = preconditions as { can_execute: boolean; blockers: string[]; adapter_type: string };
  if (!pre.can_execute) {
    return json(
      {
        error: 'PRECONDICIONES_NO_CUMPLIDAS',
        blockers: pre.blockers,
        message: 'La solicitud no cumple las condiciones para ejecutarse',
      },
      409,
    );
  }

  const { data: contextData, error: contextError } = await admin.rpc(
    'provisioning_execution_context',
    { p_request_id: requestId },
  );
  if (contextError) {
    return json({ error: 'CONTEXTO_NO_DISPONIBLE', message: contextError.message }, 500);
  }

  const ctx = contextData as Omit<ProvisioningContext, 'actor'>;
  const adapterType = (ctx.integration?.type ?? 'MANUAL') as AdapterType;
  const environment = ctx.request.environment as ProvisioningEnvironment;

  // Marca PROVISIONING e incrementa el intento. El UPDATE condicional de la RPC
  // es el candado contra la doble ejecución concurrente.
  const { error: beginError } = await admin.rpc('begin_saas_provisioning', {
    p_request_id: requestId,
    p_actor_id: actorId,
    p_actor_role: actorRole,
  });
  if (beginError) {
    return json({ error: 'NO_EJECUTABLE', message: beginError.message }, 409);
  }

  const context: ProvisioningContext = { ...ctx, actor: { id: actorId, role: actorRole } };

  let outcome;
  try {
    const adapter = resolveAdapter(
      adapterType,
      environment,
      { secretResolver },
      ctx.adapter?.key ?? 'GENERIC',
    );
    outcome = await adapter.provision(context);
  } catch (error) {
    outcome = { ok: false as const, attempts: 0, failure: normalizeThrownFailure(error) };
  }

  if (!outcome.ok) {
    await admin.rpc('fail_saas_provisioning', {
      p_request_id: requestId,
      p_error_code: outcome.failure.code,
      p_message: outcome.failure.message,
      p_http_status: outcome.failure.httpStatus,
      p_actor_id: actorId,
      p_actor_role: actorRole,
      p_detail: outcome.failure.detail,
    });

    // Al frontend van el código, el mensaje saneado y el estado HTTP. El cuerpo
    // crudo del proveedor no sale de esta función.
    return json(
      {
        request_id: requestId,
        status: 'FAILED',
        error_code: outcome.failure.code,
        message: outcome.failure.message,
        provider_http_status: outcome.failure.httpStatus,
        retryable: outcome.failure.retryable,
        attempts: outcome.attempts,
      },
      200,
    );
  }

  // PENDING del proveedor NO es ACTIVE: hay productos que crean el tenant de
  // forma asíncrona, y declararlo activo aquí sería adelantarse a los hechos.
  if (outcome.result.status === 'PENDING') {
    await admin.rpc('record_provisioning_event', {
      p_request_id: requestId,
      p_action: 'PROVIDER_ACCEPTED_PENDING',
      p_message: 'El producto aceptó la solicitud y la está procesando de forma asíncrona',
      p_detail: { external_tenant_id: outcome.result.externalTenantId },
      p_actor_id: actorId,
      p_actor_role: actorRole,
    });
    await admin.rpc('fail_saas_provisioning', {
      p_request_id: requestId,
      p_error_code: 'PROVIDER_PENDING',
      p_message:
        'El producto aceptó la solicitud pero todavía no confirmó el alta. Reintente para consultar el estado.',
      p_http_status: 202,
      p_actor_id: actorId,
      p_actor_role: actorRole,
      p_detail: { external_tenant_id: outcome.result.externalTenantId },
    });
    return json({ request_id: requestId, status: 'PENDING', attempts: outcome.attempts });
  }

  const { data: completed, error: completeError } = await admin.rpc('complete_saas_provisioning', {
    p_request_id: requestId,
    p_external_tenant_id: outcome.result.externalTenantId,
    p_external_organization_id: outcome.result.externalOrganizationId,
    p_external_company_id: outcome.result.externalCompanyId,
    p_resources: outcome.result.resources,
    p_external_reference: outcome.result.rawReference,
    p_actor_id: actorId,
    p_actor_role: actorRole,
  });

  if (completeError) {
    await admin.rpc('fail_saas_provisioning', {
      p_request_id: requestId,
      p_error_code: 'MAPPING_WRITE_FAILED',
      p_message: 'El producto respondió correctamente pero no se pudo registrar el mapeo',
      p_actor_id: actorId,
      p_actor_role: actorRole,
      p_detail: {},
    });
    return json({ request_id: requestId, status: 'FAILED', error_code: 'MAPPING_WRITE_FAILED' }, 200);
  }

  return json({
    request_id: requestId,
    status: 'ACTIVE',
    attempts: outcome.attempts,
    mapping: completed,
    external_tenant_id: outcome.result.externalTenantId,
  });
}

// ---------------------------------------------------------------------------
// Verificación de conexión
// ---------------------------------------------------------------------------
// Si el producto no declara ruta de salud, el resultado es UNKNOWN. No se
// inventa un HEALTHY: un estado de salud que nadie ha comprobado es peor que
// no tener estado, porque invita a confiar en él.
// ---------------------------------------------------------------------------
async function checkHealth(
  admin: AdminClient,
  deploymentTargetId: string,
  actorId: string | null,
  actorRole: string,
): Promise<Response> {
  const { data, error } = await admin.rpc('deployment_health_context', {
    p_deployment_target_id: deploymentTargetId,
  });
  if (error) return json({ error: 'DESTINO_NO_ENCONTRADO', message: error.message }, 404);

  const ctx = data as {
    base_url: string | null;
    timeout_ms: number;
    integration_type: string;
    health_path_template: string | null;
    allowed_hosts: string[];
    environment: ProvisioningEnvironment;
  };

  if (ctx.integration_type === 'MOCK') {
    await admin.rpc('set_deployment_health', {
      p_deployment_target_id: deploymentTargetId,
      p_health: 'HEALTHY',
      p_detail: 'Adaptador MOCK: no hay servicio remoto que verificar',
    });
    return json({ health: 'HEALTHY', detail: 'Adaptador MOCK (DEV)' });
  }

  if (!ctx.health_path_template || !ctx.base_url) {
    await admin.rpc('set_deployment_health', {
      p_deployment_target_id: deploymentTargetId,
      p_health: 'UNKNOWN',
      p_detail: 'El producto no declara ruta de verificación de salud',
    });
    return json({
      health: 'UNKNOWN',
      detail: 'Sin ruta de salud configurada: no se inventa un estado',
    });
  }

  const { buildProvisioningUrl } = await import('../_shared/provisioning/url-guard.ts');

  let health: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' = 'UNHEALTHY';
  let detail = '';

  try {
    const url = buildProvisioningUrl(ctx.base_url, ctx.health_path_template, {}, {
      environment: ctx.environment,
      allowedHosts: ctx.allowed_hosts,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ctx.timeout_ms);
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'manual',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (response.status >= 200 && response.status < 300) {
      health = 'HEALTHY';
      detail = `El producto respondió ${response.status}`;
    } else if (response.status >= 500) {
      health = 'UNHEALTHY';
      detail = `El producto respondió ${response.status}`;
    } else {
      health = 'DEGRADED';
      detail = `El producto respondió ${response.status}`;
    }
  } catch (error) {
    const failure = normalizeThrownFailure(error);
    health = 'UNHEALTHY';
    detail = failure.message;
  }

  // `set_deployment_health` ya deja el rastro en audit_logs. No se escribe
  // además en saas_provisioning_events porque ese timeline pertenece a una
  // solicitud concreta y una verificación de salud no lo es.
  await admin.rpc('set_deployment_health', {
    p_deployment_target_id: deploymentTargetId,
    p_health: health,
    p_detail: detail,
  });

  return json({ health, detail, actor: { id: actorId, role: actorRole } });
}
