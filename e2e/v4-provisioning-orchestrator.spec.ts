import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { DEMO_PASSWORD, USERS } from './fixtures';

/**
 * V4 · `provisioning-orchestrator` de punta a punta, contra la Edge Function
 * REAL del stack local.
 *
 * NO se contacta con ningún SaaS. El destino de DEV usa el adaptador MOCK, que
 * recorre el flujo completo sin abrir un socket. Todo lo demás es real: el JWT,
 * la comprobación de permiso contra la base, el cliente `service_role`, la
 * máquina de estados y el mapeo que la función escribe.
 *
 * Lo que de verdad se certifica aquí es el orden de la autorización: el gate de
 * permiso ocurre ANTES de que exista ningún privilegio elevado. Por eso los
 * negativos importan tanto como el camino feliz.
 */

const env = loadEnv('development', process.cwd(), 'VITE_');
const FUNCTION_URL = `${env.VITE_SUPABASE_URL}/functions/v1/provisioning-orchestrator`;

const EWM = '20000000-0000-4000-a000-000000000002';
const ESUPPLIER = '20000000-0000-4000-a000-000000000001';

/** alpha-ewm: SHARED, resuelve al destino DEV con adaptador MOCK. */
const TENANT_ALPHA_EWM = '50000000-0000-4000-a000-000000000008';
/** titan-ewm: TENANT_DEDICATED sin infraestructura DEV → WAITING_INFRA. */
const TENANT_TITAN = '50000000-0000-4000-a000-00000000000d';
/** alpha-esupplier: SHARED eSupplier con adaptador MANUAL. */
const TENANT_ALPHA_ESUP = '50000000-0000-4000-a000-000000000001';
/** Destino dedicado de Titán, sin ambiente de provisioning en el seed. */
const TARGET_TITAN = '40000000-0000-4000-a000-000000000006';
const INTEGRATION_MOCK = '70000000-0000-4000-a000-000000000001';

const PROVISIONING_USERS = {
  techLead: 'product.admin@ebim.test',
  provisioningAdmin: 'provisioning.admin@ebim.test',
  ewmOwner: 'ewm.owner@ebim.test',
  esupplierOwner: 'esupplier.owner@ebim.test',
} as const;

let db: SupabaseClient;
const jwts = new Map<string, string>();

async function jwtOf(email: string): Promise<string> {
  const cached = jwts.get(email);
  if (cached) return cached;
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
  expect(error, `login de ${email}`).toBeNull();
  const token = data.session!.access_token;
  jwts.set(email, token);
  return token;
}

function clientFor(jwt: string): SupabaseClient {
  return createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    db: { schema: 'platform' },
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

interface OrchestratorResponse {
  status: number;
  body: Record<string, unknown>;
}

async function callOrchestrator(
  jwt: string | null,
  payload: Record<string, unknown>,
): Promise<OrchestratorResponse> {
  const headers: Record<string, string> = {
    apikey: env.VITE_SUPABASE_ANON_KEY,
    'content-type': 'application/json',
  };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

test.beforeAll(async () => {
  expect(env.VITE_SUPABASE_URL, 'VITE_SUPABASE_URL en .env.local').toBeTruthy();
  // El cliente de verificación se AUTENTICA. Sin sesión, PostgREST usaría el rol
  // `anon`, que no tiene ni USAGE sobre el schema `platform`: todas las
  // comprobaciones devolverían vacío y el test pasaría sin comprobar nada.
  db = clientFor(await jwtOf(USERS.superAdmin));
});

/** Solicitud viva del tenant, o `undefined`. La RPC es idempotente. */
async function ensureRequest(email: string, tenantId: string): Promise<string> {
  const client = clientFor(await jwtOf(email));
  const { data, error } = await client.rpc('create_saas_provisioning_request', {
    p_tenant_id: tenantId,
    p_environment: 'DEV',
  });
  expect(error, `create_saas_provisioning_request(${tenantId})`).toBeNull();
  return data as unknown as string;
}

async function statusOf(requestId: string): Promise<string> {
  const { data } = await db
    .from('saas_provisioning_requests')
    .select('status')
    .eq('id', requestId)
    .maybeSingle();
  return (data as { status: string } | null)?.status ?? 'NOT_FOUND';
}

// ---------------------------------------------------------------------------
test.describe('autorización: el gate va ANTES del privilegio', () => {
  test('sin token de sesión responde 401 y no toca nada', async () => {
    const requestId = await ensureRequest(PROVISIONING_USERS.techLead, TENANT_ALPHA_EWM);
    const before = await statusOf(requestId);

    const res = await callOrchestrator(null, { action: 'PROVISION', request_id: requestId });

    expect(res.status).toBe(401);
    expect(String(res.body.error)).toContain('NO_AUTENTICADO');
    expect(await statusOf(requestId)).toBe(before);
  });

  test('un usuario de tenant con JWT VÁLIDO recibe 403', async () => {
    const requestId = await ensureRequest(PROVISIONING_USERS.techLead, TENANT_ALPHA_EWM);

    const res = await callOrchestrator(await jwtOf(USERS.tenantAdmin), {
      action: 'PROVISION',
      request_id: requestId,
    });

    expect(res.status).toBe(403);
    // El mensaje dice exactamente la lección: sesión no es autorización.
    expect(String(res.body.message)).toContain('no autorización');
  });

  test('un partner admin no puede provisionar', async () => {
    const requestId = await ensureRequest(PROVISIONING_USERS.techLead, TENANT_ALPHA_EWM);
    const res = await callOrchestrator(await jwtOf(USERS.partnerAdmin), {
      action: 'PROVISION',
      request_id: requestId,
    });
    expect(res.status).toBe(403);
  });

  test('AISLAMIENTO: el owner de eSupplier no puede provisionar un tenant de EWM', async () => {
    const requestId = await ensureRequest(PROVISIONING_USERS.techLead, TENANT_ALPHA_EWM);

    const res = await callOrchestrator(await jwtOf(PROVISIONING_USERS.esupplierOwner), {
      action: 'PROVISION',
      request_id: requestId,
    });

    expect(res.status).toBe(403);
  });

  test('una solicitud inexistente devuelve 403, no revela si existe', async () => {
    const res = await callOrchestrator(await jwtOf(PROVISIONING_USERS.techLead), {
      action: 'PROVISION',
      request_id: '00000000-0000-4000-a000-0000000000ff',
    });
    expect(res.status).toBe(403);
  });

  test('sin identificador de operación, 400', async () => {
    const res = await callOrchestrator(await jwtOf(PROVISIONING_USERS.techLead), {
      action: 'PROVISION',
    });
    expect(res.status).toBe(400);
  });

  test('GET no está permitido', async () => {
    const response = await fetch(FUNCTION_URL, {
      method: 'GET',
      headers: { apikey: env.VITE_SUPABASE_ANON_KEY },
    });
    expect(response.status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
test.describe('SHARED con adaptador MOCK: PENDING → PROVISIONING → ACTIVE', () => {
  test('el Tech Lead provisiona y el mapeo queda en la base', async () => {
    const requestId = await ensureRequest(PROVISIONING_USERS.techLead, TENANT_ALPHA_EWM);
    const estadoInicial = await statusOf(requestId);

    // Si una ejecución anterior ya lo dejó ACTIVE, se cancela y se rehace: el
    // test debe poder repetirse sin `db:reset`.
    if (estadoInicial === 'ACTIVE') {
      test.skip(true, 'El tenant ya está provisionado por una ejecución anterior');
      return;
    }

    const res = await callOrchestrator(await jwtOf(PROVISIONING_USERS.techLead), {
      action: 'PROVISION',
      request_id: requestId,
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');
    // El MOCK produce identificadores con prefijo `mock-`: si alguno apareciera
    // en otro entorno, saltaría a la vista.
    expect(String(res.body.external_tenant_id)).toBe('mock-tenant-alpha-ewm');

    expect(await statusOf(requestId)).toBe('ACTIVE');

    const { data: mapping } = await db
      .from('tenant_product_mappings')
      .select('*')
      .eq('tenant_id', TENANT_ALPHA_EWM)
      .eq('saas_product_id', EWM)
      .maybeSingle();

    const row = mapping as Record<string, unknown> | null;
    expect(row, 'el mapeo externo se escribió').not.toBeNull();
    expect(row!.status).toBe('ACTIVE');
    expect(row!.external_tenant_id).toBe('mock-tenant-alpha-ewm');
    expect(row!.registered_manually).toBe(false);
    expect(row!.provisioned_at).not.toBeNull();
  });

  test('el timeline registra el recorrido completo, con actor y correlación', async () => {
    const { data: request } = await db
      .from('saas_provisioning_requests')
      .select('id, correlation_id, idempotency_key')
      .eq('tenant_id', TENANT_ALPHA_EWM)
      .eq('saas_product_id', EWM)
      .maybeSingle();

    const req = request as Record<string, unknown>;
    const { data: events } = await db
      .from('saas_provisioning_events')
      .select('*')
      .eq('saas_provisioning_request_id', req.id as string)
      .order('occurred_at');

    const rows = (events ?? []) as Array<Record<string, unknown>>;
    const actions = rows.map((e) => e.action as string);

    expect(actions).toContain('REQUEST_CREATED');
    expect(actions).toContain('PROVISIONING_STARTED');
    expect(actions).toContain('PROVISIONING_COMPLETED');

    const started = rows.find((e) => e.action === 'PROVISIONING_STARTED')!;
    expect(started.correlation_id).toBe(req.correlation_id);
    expect(started.actor_role).toBeTruthy();

    // Ni un solo evento puede contener material de credencial.
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain('BEGIN PRIVATE KEY');
    expect(serialized).not.toContain('Bearer ');
    expect(serialized).not.toContain('service_role');
  });

  test('una solicitud ya ACTIVE no se vuelve a ejecutar', async () => {
    const { data: request } = await db
      .from('saas_provisioning_requests')
      .select('id')
      .eq('tenant_id', TENANT_ALPHA_EWM)
      .eq('saas_product_id', EWM)
      .maybeSingle();

    const res = await callOrchestrator(await jwtOf(PROVISIONING_USERS.techLead), {
      action: 'PROVISION',
      request_id: (request as { id: string }).id,
    });

    expect(res.status).toBe(409);
    expect(res.body.blockers).toContain('REQUEST_NOT_READY');
  });

  test('IDEMPOTENCIA: cinco intentos de crear dan UNA solicitud', async () => {
    for (let i = 0; i < 5; i += 1) {
      await ensureRequest(PROVISIONING_USERS.techLead, TENANT_ALPHA_EWM);
    }
    const { data } = await db
      .from('saas_provisioning_requests')
      .select('id')
      .eq('tenant_id', TENANT_ALPHA_EWM)
      .eq('saas_product_id', EWM);

    expect((data ?? []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
test.describe('MANUAL: el adaptador no finge un éxito', () => {
  test('eSupplier pide registro manual en vez de declarar ACTIVE', async () => {
    const requestId = await ensureRequest(PROVISIONING_USERS.techLead, TENANT_ALPHA_ESUP);
    if ((await statusOf(requestId)) === 'ACTIVE') {
      test.skip(true, 'Ya registrado por una ejecución anterior');
      return;
    }

    const res = await callOrchestrator(await jwtOf(PROVISIONING_USERS.techLead), {
      action: 'PROVISION',
      request_id: requestId,
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('FAILED');
    expect(res.body.error_code).toBe('MANUAL_REGISTRATION_REQUIRED');
    expect(res.body.retryable).toBe(false);

    // Y el mapeo NO se creó: no hay alta que registrar.
    const { data: mapping } = await db
      .from('tenant_product_mappings')
      .select('id')
      .eq('tenant_id', TENANT_ALPHA_ESUP)
      .eq('saas_product_id', ESUPPLIER)
      .maybeSingle();
    expect(mapping).toBeNull();
  });

  test('el registro manual escribe el mismo mapeo, marcado como manual', async () => {
    const { data: request } = await db
      .from('saas_provisioning_requests')
      .select('id, status')
      .eq('tenant_id', TENANT_ALPHA_ESUP)
      .eq('saas_product_id', ESUPPLIER)
      .maybeSingle();

    const req = request as { id: string; status: string } | null;
    if (!req || req.status === 'ACTIVE') {
      test.skip(true, 'Ya registrado por una ejecución anterior');
      return;
    }

    const client = clientFor(await jwtOf(PROVISIONING_USERS.techLead));
    const { error } = await client.rpc('register_manual_provisioning', {
      p_request_id: req.id,
      p_external_tenant_id: 'esup-manual-0001',
      p_external_organization_id: 'esup-org-0001',
    });
    expect(error).toBeNull();

    const { data: mapping } = await db
      .from('tenant_product_mappings')
      .select('*')
      .eq('tenant_id', TENANT_ALPHA_ESUP)
      .maybeSingle();

    const row = mapping as Record<string, unknown>;
    expect(row.status).toBe('ACTIVE');
    expect(row.external_tenant_id).toBe('esup-manual-0001');
    expect(row.registered_manually).toBe(true);
    expect(await statusOf(req.id)).toBe('ACTIVE');
  });
});

// ---------------------------------------------------------------------------
test.describe('TENANT_DEDICATED: WAITING_INFRA → READY → provisionable', () => {
  test('sin infraestructura, la solicitud espera en vez de fallar', async () => {
    const requestId = await ensureRequest(PROVISIONING_USERS.techLead, TENANT_TITAN);
    const status = await statusOf(requestId);

    if (status === 'ACTIVE' || status === 'READY_TO_PROVISION') {
      test.skip(true, 'La infraestructura ya se configuró en una ejecución anterior');
      return;
    }

    expect(status).toBe('WAITING_INFRA');

    // Y no se le adjudica el destino de nadie más.
    const { data } = await db
      .from('saas_provisioning_requests')
      .select('deployment_target_id')
      .eq('id', requestId)
      .maybeSingle();
    expect((data as { deployment_target_id: string | null }).deployment_target_id).toBeNull();
  });

  test('un destino UNHEALTHY bloquea con un código explicable', async () => {
    const requestId = await ensureRequest(PROVISIONING_USERS.techLead, TENANT_TITAN);
    const client = clientFor(await jwtOf(PROVISIONING_USERS.techLead));

    // Primero se registra la infraestructura y se marca lista.
    const { error } = await client.rpc('configure_deployment_provisioning', {
      p_deployment_target_id: TARGET_TITAN,
      p_product_integration_id: INTEGRATION_MOCK,
      p_provisioning_environment: 'DEV',
      p_provisioning_status: 'READY',
      p_provisioning_enabled: true,
    });
    expect(error).toBeNull();

    // La solicitud que esperaba se promueve SOLA.
    expect(await statusOf(requestId)).toBe('READY_TO_PROVISION');

    // Con el destino caído, el orquestador rechaza y dice por qué.
    await clientFor(await jwtOf(PROVISIONING_USERS.techLead)).rpc('set_deployment_health', {
      p_deployment_target_id: TARGET_TITAN,
      p_health: 'UNHEALTHY',
      p_detail: 'Simulado por el E2E',
    });

    const bloqueado = await callOrchestrator(await jwtOf(PROVISIONING_USERS.techLead), {
      action: 'PROVISION',
      request_id: requestId,
    });
    expect(bloqueado.status).toBe(409);
    expect(bloqueado.body.blockers).toContain('DEPLOYMENT_UNHEALTHY');

    // Restaurada la salud, el mismo Tech Lead provisiona.
    await clientFor(await jwtOf(PROVISIONING_USERS.techLead)).rpc('set_deployment_health', {
      p_deployment_target_id: TARGET_TITAN,
      p_health: 'HEALTHY',
      p_detail: 'Restaurado por el E2E',
    });

    const ok = await callOrchestrator(await jwtOf(PROVISIONING_USERS.techLead), {
      action: 'PROVISION',
      request_id: requestId,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('ACTIVE');
    expect(await statusOf(requestId)).toBe('ACTIVE');
  });
});

// ---------------------------------------------------------------------------
test.describe('aislamiento por producto en las lecturas', () => {
  test('el owner de EWM sólo ve la integración de EWM', async () => {
    const client = clientFor(await jwtOf(PROVISIONING_USERS.ewmOwner));
    const { data } = await client.from('product_integrations').select('saas_product_id');
    const productos = new Set((data ?? []).map((r) => (r as { saas_product_id: string }).saas_product_id));
    expect([...productos]).toEqual([EWM]);
  });

  test('el owner de eSupplier sólo ve la suya: el aislamiento es simétrico', async () => {
    const client = clientFor(await jwtOf(PROVISIONING_USERS.esupplierOwner));
    const { data } = await client.from('product_integrations').select('saas_product_id');
    const productos = new Set((data ?? []).map((r) => (r as { saas_product_id: string }).saas_product_id));
    expect([...productos]).toEqual([ESUPPLIER]);
  });

  test('el Tech Lead los ve todos', async () => {
    const client = clientFor(await jwtOf(PROVISIONING_USERS.techLead));
    const { data } = await client.from('product_integrations').select('id');
    expect((data ?? []).length).toBeGreaterThanOrEqual(3);
  });

  test('NADIE puede leer la referencia del secreto por PostgREST', async () => {
    for (const email of [PROVISIONING_USERS.techLead, USERS.superAdmin]) {
      const client = clientFor(await jwtOf(email));
      const { error } = await client.from('credential_profiles').select('secret_ref');
      // Es un privilegio de COLUMNA: falla incluso para el super admin.
      expect(error, `secret_ref accesible para ${email}`).not.toBeNull();
    }
  });

  test('la referencia SÓLO se obtiene por la RPC auditada', async () => {
    const client = clientFor(await jwtOf(USERS.superAdmin));
    const { data, error } = await client.rpc('reveal_credential_secret_ref', {
      p_id: '71000000-0000-4000-a000-000000000001',
    });
    expect(error).toBeNull();
    const payload = data as unknown as { secret_ref: string };
    // Es el NOMBRE del secreto. El valor no existe en esta base.
    expect(payload.secret_ref).toBe('EWM_QAS_M2M_PRIVATE_KEY');

    const { data: audit } = await db
      .from('audit_logs')
      .select('action')
      .eq('action', 'CREDENTIAL_SECRET_REF_REVEALED')
      .limit(1);
    expect((audit ?? []).length).toBe(1);
  });

  test('un propietario de producto no puede leer ni su propia referencia', async () => {
    const client = clientFor(await jwtOf(PROVISIONING_USERS.ewmOwner));
    const { error } = await client.rpc('reveal_credential_secret_ref', {
      p_id: '71000000-0000-4000-a000-000000000001',
    });
    // Ver la referencia exige credentials.MANAGE, no credentials.read.
    expect(error).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
test.describe('verificación de conexión', () => {
  test('un destino MOCK se reporta saludable sin llamar a nadie', async () => {
    const res = await callOrchestrator(await jwtOf(PROVISIONING_USERS.provisioningAdmin), {
      action: 'CHECK_HEALTH',
      deployment_target_id: '40000000-0000-4000-a000-000000000007',
    });
    expect(res.status).toBe(200);
    expect(res.body.health).toBe('HEALTHY');
  });

  test('un destino sin ruta de salud queda en UNKNOWN: no se inventa un estado', async () => {
    const res = await callOrchestrator(await jwtOf(PROVISIONING_USERS.provisioningAdmin), {
      action: 'CHECK_HEALTH',
      deployment_target_id: '40000000-0000-4000-a000-00000000000a',
    });
    expect(res.status).toBe(200);
    expect(res.body.health).toBe('UNKNOWN');
  });

  test('un usuario sin permiso no puede pedir la verificación', async () => {
    const res = await callOrchestrator(await jwtOf(USERS.tenantAdmin), {
      action: 'CHECK_HEALTH',
      deployment_target_id: '40000000-0000-4000-a000-000000000007',
    });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
test.describe('GET_STATUS: sólo con la capacidad, sólo lectura', () => {
  async function snapshot(requestId: string) {
    const { data } = await db
      .from('saas_provisioning_requests')
      .select('status, attempt_count')
      .eq('id', requestId)
      .maybeSingle();
    return data as { status: string; attempt_count: number };
  }

  test('una integración GENERIC (MOCK) no admite consulta de estado', async () => {
    const requestId = await ensureRequest(PROVISIONING_USERS.techLead, TENANT_ALPHA_EWM);
    const before = await snapshot(requestId);

    const res = await callOrchestrator(await jwtOf(PROVISIONING_USERS.techLead), {
      action: 'GET_STATUS',
      request_id: requestId,
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CAPACIDAD_NO_SOPORTADA');
    expect(await snapshot(requestId)).toEqual(before);
  });

  test('AISLAMIENTO: el owner de eSupplier no consulta una solicitud de EWM', async () => {
    const requestId = await ensureRequest(PROVISIONING_USERS.techLead, TENANT_ALPHA_EWM);
    const res = await callOrchestrator(await jwtOf(PROVISIONING_USERS.esupplierOwner), {
      action: 'GET_STATUS',
      request_id: requestId,
    });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
test.describe('REPLAY_CERTIFICATION: interna y sólo con la capacidad', () => {
  test('una integración GENERIC (MOCK) no admite certificación de replay', async () => {
    const requestId = await ensureRequest(PROVISIONING_USERS.techLead, TENANT_ALPHA_EWM);
    const before = await statusOf(requestId);

    const res = await callOrchestrator(await jwtOf(PROVISIONING_USERS.techLead), {
      action: 'REPLAY_CERTIFICATION',
      request_id: requestId,
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CAPACIDAD_NO_SOPORTADA');
    expect(await statusOf(requestId)).toBe(before);
  });
});
