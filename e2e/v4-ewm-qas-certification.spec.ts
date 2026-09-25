import { test, expect, type Page } from '@playwright/test';

/**
 * Certificación EWM V1 contra QAS REAL — OPT-IN.
 *
 * No forma parte de la suite por defecto: sólo corre con
 * `EWM_QAS_CERTIFICATION=1`. Llama al orquestador DESDE EL NAVEGADOR (atraviesa
 * CORS) con la sesión de un operador autorizado, que es exactamente el camino
 * de producción: Browser → Edge Function QAS → HTTP_M2M → EWM QAS.
 *
 * Entradas, todas por variable de entorno en tiempo de ejecución (nunca en el
 * repositorio ni en logs):
 *   · REQUEST_ID                  solicitud de provisioning EWM en QAS;
 *   · EWM_QAS_OPERATOR_EMAIL      operador con permiso sobre EWM;
 *   · EWM_QAS_OPERATOR_PASSWORD   su contraseña.
 *
 * Guardia: tras el login, la app tiene que apuntar al proyecto QAS
 * `jivgwrczgdpsuvqcwqku`; si no, se aborta antes de invocar nada.
 *
 * Sólo se registran los campos de la respuesta del orquestador que se
 * certifican: ni el JWT ni cuerpos completos.
 */

const QAS_REF = 'jivgwrczgdpsuvqcwqku';
const ENABLED = process.env.EWM_QAS_CERTIFICATION === '1';

test.skip(!ENABLED, 'certificación QAS opt-in (EWM_QAS_CERTIFICATION=1)');

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

async function loginAsOperator(page: Page): Promise<void> {
  const email = requiredEnv('EWM_QAS_OPERATOR_EMAIL');
  const password = requiredEnv('EWM_QAS_OPERATOR_PASSWORD');
  await page.goto('/login');
  await page.getByLabel('Correo corporativo').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('button', { name: 'Salir' })).toBeVisible({ timeout: 20_000 });

  const supabaseUrl = await page.evaluate(
    async () => (await import('/src/lib/env.ts')).env.supabaseUrl as string,
  );
  if (!supabaseUrl.includes(QAS_REF)) {
    throw new Error('GUARDIA: la aplicación no apunta al proyecto QAS; no se invoca nada');
  }
}

async function invoke(page: Page, action: string, requestId: string): Promise<Record<string, unknown>> {
  return page.evaluate(
    async ({ action, requestId }) => {
      const { supabase } = await import('/src/lib/supabase.ts');
      const { data, error } = await supabase.functions.invoke('provisioning-orchestrator', {
        body: { action, request_id: requestId },
      });
      if (error) {
        const context = (error as { context?: Response }).context;
        const payload = context && typeof context.json === 'function' ? await context.json() : null;
        return { invoke_error: error.message, ...(payload ?? {}) };
      }
      return data as Record<string, unknown>;
    },
    { action, requestId },
  );
}

function pick(body: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, body[k]]));
}

test.describe('EWM V1 · certificación QAS', () => {
  let requestId: string;

  test.beforeEach(() => {
    requestId = requiredEnv('REQUEST_ID');
    requiredEnv('EWM_QAS_OPERATOR_EMAIL');
    requiredEnv('EWM_QAS_OPERATOR_PASSWORD');
  });

  test('status', async ({ page }) => {
    await loginAsOperator(page);
    const body = await invoke(page, 'GET_STATUS', requestId);
    const evidence = pick(body, ['found', 'provider_http_status', 'provider_code', 'mapping_consistent']);
    test.info().annotations.push({ type: 'GET_STATUS', description: JSON.stringify(evidence) });
    expect(evidence).toMatchObject({ found: true, provider_http_status: 200, mapping_consistent: true });
  });

  test('replay', async ({ page }) => {
    await loginAsOperator(page);
    const body = await invoke(page, 'REPLAY_CERTIFICATION', requestId);
    const evidence = pick(body, [
      'certified',
      'provider_http_status',
      'replayed',
      'identifiers_match',
      'duplicate',
      'reason',
      'error',
    ]);
    test.info().annotations.push({ type: 'REPLAY_CERTIFICATION', description: JSON.stringify(evidence) });
    expect(evidence).toMatchObject({
      certified: true,
      provider_http_status: 200,
      replayed: true,
      identifiers_match: true,
      duplicate: false,
    });
  });
});
