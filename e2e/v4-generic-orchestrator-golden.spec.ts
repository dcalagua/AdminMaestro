import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { DEMO_PASSWORD } from './fixtures';

/*
 * CONTRATO GENERIC CONGELADO DEL ORQUESTADOR (Task 1 del plan EWM).
 *
 * Caracteriza, contra la Edge Function REAL del stack local, que una acción
 * desconocida o ausente se comporta hoy como PROVISION. Se escribió contra el
 * código ANTERIOR al enrutado de acciones nuevas. Si falla: HARD STOP H1.
 * NO se actualiza para acomodar un cambio.
 *
 * `jwtOf` y `callOrchestrator` están copiados de
 * `v4-provisioning-orchestrator.spec.ts` porque allí son locales al archivo.
 */

const env = loadEnv('development', process.cwd(), 'VITE_');
const FUNCTION_URL = `${env.VITE_SUPABASE_URL}/functions/v1/provisioning-orchestrator`;

/** alpha-ewm: SHARED, resuelve al destino DEV con adaptador MOCK. */
const TENANT_ALPHA_EWM = '50000000-0000-4000-a000-000000000008';
const TECH_LEAD = 'product.admin@ebim.test';

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

async function callOrchestrator(
  jwt: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      apikey: env.VITE_SUPABASE_ANON_KEY,
      'content-type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

let requestId: string;

test.beforeAll(async () => {
  expect(env.VITE_SUPABASE_URL, 'VITE_SUPABASE_URL').toBeTruthy();
  const jwt = await jwtOf(TECH_LEAD);
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    db: { schema: 'platform' },
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data, error } = await client.rpc('create_saas_provisioning_request', {
    p_tenant_id: TENANT_ALPHA_EWM,
    p_environment: 'DEV',
  });
  expect(error).toBeNull();
  requestId = data as unknown as string;

  // Deja la solicitud ACTIVE (flujo MOCK) si todavía no lo está.
  const { data: row } = await client
    .from('saas_provisioning_requests')
    .select('status')
    .eq('id', requestId)
    .maybeSingle();
  if ((row as { status: string } | null)?.status !== 'ACTIVE') {
    const res = await callOrchestrator(jwt, { action: 'PROVISION', request_id: requestId });
    expect(res.body.status).toBe('ACTIVE');
  }
});

test('acción desconocida se comporta como PROVISION', async () => {
  const jwt = await jwtOf(TECH_LEAD);
  const reference = await callOrchestrator(jwt, { action: 'PROVISION', request_id: requestId });
  const unknown = await callOrchestrator(jwt, { action: 'NO_EXISTE', request_id: requestId });
  expect(reference.status).toBe(409);
  expect(unknown.status).toBe(reference.status);
  expect(unknown.body.error).toBe(reference.body.error);
});

test('sin acción se comporta como PROVISION', async () => {
  const jwt = await jwtOf(TECH_LEAD);
  const reference = await callOrchestrator(jwt, { action: 'PROVISION', request_id: requestId });
  const missing = await callOrchestrator(jwt, { request_id: requestId });
  expect(missing.status).toBe(reference.status);
  expect(missing.body.error).toBe(reference.body.error);
});
