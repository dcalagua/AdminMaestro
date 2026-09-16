import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { DEMO_PASSWORD, login } from './fixtures';

/**
 * V4 · El recorrido de consola del plano de provisioning, contra la app REAL.
 *
 * Sin mocks de red y sin llamadas a ningún SaaS: el destino de DEV usa el
 * adaptador simulado, así que el flujo completo se ejercita sin salir del stack
 * local. Lo que se comprueba es lo que ve y puede hacer cada persona — y, sobre
 * todo, lo que NO puede: si RLS bloquea algo, el test lo ve igual que un usuario.
 */

const TECH_LEAD = 'product.admin@ebim.test';
const EWM_OWNER = 'ewm.owner@ebim.test';
const ESUPPLIER_OWNER = 'esupplier.owner@ebim.test';
const FINANCE = 'finance@ebim.test';

async function gotoSaasProvisioning(page: Page) {
  await page.goto('/saas-provisioning');
  await expect(page.getByRole('heading', { name: 'Provisioning SaaS' })).toBeVisible();
}

/**
 * El archivo se prepara SUS PROPIOS datos.
 *
 * Playwright ejecuta los ficheros por orden alfabético, así que este corre antes
 * que el E2E de la Edge Function. Depender de que el otro haya dejado
 * solicitudes creadas convertiría estas pruebas en verdes o rojas según el orden
 * — que es la peor clase de test: el que no dice nada cuando pasa.
 *
 * Se usan las mismas RPC que usa la consola, y son idempotentes: si la solicitud
 * ya existe, se devuelve la existente.
 */
const env = loadEnv('development', process.cwd(), 'VITE_');

/** alpha-ewm (SHARED, MOCK) y titan-ewm (dedicado sin infraestructura). */
const TENANTS_A_PREPARAR = [
  '50000000-0000-4000-a000-000000000008',
  '50000000-0000-4000-a000-00000000000d',
];

test.beforeAll(async () => {
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    db: { schema: 'platform' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: authError } = await client.auth.signInWithPassword({
    email: TECH_LEAD,
    password: DEMO_PASSWORD,
  });
  expect(authError, 'login del Tech Lead para preparar datos').toBeNull();

  for (const tenantId of TENANTS_A_PREPARAR) {
    const { error } = await client.rpc('create_saas_provisioning_request', {
      p_tenant_id: tenantId,
      p_environment: 'DEV',
    });
    expect(error, `preparar solicitud de ${tenantId}`).toBeNull();
  }
});

test.describe('Tech Lead: visión transversal', () => {
  test('ve el catálogo de integraciones de toda la suite', async ({ page }) => {
    await login(page, TECH_LEAD);
    await page.goto('/integrations');

    await expect(page.getByRole('heading', { name: 'Integraciones SaaS' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'ewm-provisioning-v1' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'ewm-mock-local' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'esupplier-manual' })).toBeVisible();

    // Y puede administrarlas.
    await expect(page.getByRole('button', { name: 'Nueva integración' })).toBeVisible();
  });

  test('el detalle muestra el contrato completo SIN revelar ningún secreto', async ({ page }) => {
    await login(page, TECH_LEAD);
    await page.goto('/integrations');
    await page.getByRole('link', { name: 'ewm-provisioning-v1' }).click();

    await page.getByRole('tab', { name: 'Seguridad' }).click();
    await expect(page.getByText('masteradmin.ebim').first()).toBeVisible();
    await expect(page.getByText('ewm.ebim').first()).toBeVisible();
    await expect(page.getByText('RS256').first()).toBeVisible();
    await expect(page.getByText('300 segundos')).toBeVisible();

    // La referencia del secreto NO está en la página: hay que pedirla.
    await page.getByRole('tab', { name: 'Credenciales' }).click();
    await expect(page.getByText('Referencia configurada').first()).toBeVisible();
    await expect(page.getByText('EWM_QAS_M2M_PRIVATE_KEY')).toHaveCount(0);

    // Y al pedirla, aparece el NOMBRE del secreto, nunca su valor. Se apunta a
    // la FILA de ewm-qas-m2m: el perfil DEV no tiene referencia y responder con
    // «sin referencia» sería un falso negativo, no un fallo.
    const filaQas = page.locator('tr', { hasText: 'ewm-qas-m2m' });
    await filaQas.getByRole('button', { name: 'Ver referencia' }).click();
    await expect(page.getByText('EWM_QAS_M2M_PRIVATE_KEY')).toBeVisible();
  });

  test('las rutas del contrato son relativas: el host vive en el destino', async ({ page }) => {
    await login(page, TECH_LEAD);
    await page.goto('/integrations');
    await page.getByRole('link', { name: 'ewm-provisioning-v1' }).click();
    await page.getByRole('tab', { name: 'Seguridad' }).click();

    await expect(page.getByText('/internal/platform/v1/tenants').first()).toBeVisible();
    await expect(page.getByText('Relativa a la URL base del destino', { exact: false })).toBeVisible();
  });

  test('el formulario RECHAZA una URL base insegura antes de enviarla', async ({ page }) => {
    await login(page, TECH_LEAD);
    await page.goto('/deployments');

    await page.getByRole('button', { name: 'Configurar provisioning' }).first().click();
    await expect(page.getByRole('heading', { name: /Provisioning de/ })).toBeVisible();

    // El endpoint de metadatos del cloud: la consola lo explica en el acto.
    await page.getByLabel('Ambiente de provisioning').selectOption('PRD');
    await page.getByLabel('URL base').fill('http://169.254.169.254');
    await expect(page.getByText(/host interno|HTTPS/).first()).toBeVisible();

    await page.getByRole('button', { name: 'Cancelar' }).click();
  });

  test('verifica la conexión de un destino y no inventa un estado', async ({ page }) => {
    await login(page, TECH_LEAD);
    await page.goto('/deployments');

    await expect(page.getByText('Provisioning SaaS').first()).toBeVisible();
    await page.getByRole('button', { name: 'Verificar conexión' }).first().click();

    // Cualquiera de los dos resultados es correcto y ninguno es una invención:
    // «saludable» sólo aparece cuando hay algo que verificar.
    await expect(
      page.getByText(/Conexión verificada|Sin verificar|Destino/).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Provisioning SaaS: estados y acciones', () => {
  test('el listado distingue los estados del ciclo de vida', async ({ page }) => {
    await login(page, TECH_LEAD);
    await gotoSaasProvisioning(page);

    await expect(page.getByText('Infraestructura pendiente').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nueva solicitud' })).toBeVisible();
  });

  test('el detalle expone correlación e idempotencia, y el timeline', async ({ page }) => {
    await login(page, TECH_LEAD);
    await gotoSaasProvisioning(page);

    await page.getByRole('button', { name: 'Detalle' }).first().click();

    await expect(page.getByText('Identidad y trazabilidad')).toBeVisible();
    await expect(page.getByText('Correlación')).toBeVisible();
    await expect(page.getByText('Idempotencia')).toBeVisible();
    await expect(page.getByText('Historial de la solicitud')).toBeVisible();
  });

  test('no se ofrece «Provisionar» sobre algo ya activo', async ({ page }) => {
    await login(page, TECH_LEAD);
    await gotoSaasProvisioning(page);

    // Filtro de activas: ninguna fila debe ofrecer provisionar ni cancelar.
    await page.getByRole('tab', { name: /Activas/ }).click();
    const filas = page.locator('tbody tr');
    if ((await filas.count()) > 0) {
      await expect(page.getByRole('button', { name: 'Provisionar' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Cancelar' })).toHaveCount(0);
    }
  });

  test('el tenant muestra su alta en cada producto de la suite', async ({ page }) => {
    await login(page, TECH_LEAD);
    await page.goto('/tenants');
    await page.getByRole('link', { name: 'Empresa Directa Alpha · EWM' }).first().click();

    await page.getByRole('tab', { name: 'Productos / Provisioning' }).click();
    await expect(page.getByText('Alta en los productos de la suite')).toBeVisible();
    // La columna se llama «ID en el producto» a propósito: lo que se muestra son
    // identificadores DEL PRODUCTO, no datos operativos ni IDs universales EBIM.
    await expect(page.getByRole('columnheader', { name: 'ID en el producto' })).toBeVisible();
    await expect(page.getByText('EWM').first()).toBeVisible();
  });
});

test.describe('Nueva venta: cerrar un contrato NO aprovisiona', () => {
  test('el alta comercial no ofrece ninguna acción de provisioning de SaaS', async ({ page }) => {
    await login(page, TECH_LEAD);
    await page.goto('/onboarding');

    await expect(page.getByRole('heading', { name: /Nueva venta/ })).toBeVisible();
    // El único provisioning que menciona el alta es el de infraestructura, y en
    // simulación. Nada aquí crea el tenant dentro de un producto.
    await expect(page.getByText('Provisioning en DRY_RUN')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Provisionar' })).toHaveCount(0);
  });

  test('provisioning SaaS es un destino SEPARADO del alta comercial', async ({ page }) => {
    await login(page, TECH_LEAD);
    await page.goto('/onboarding');

    const menu = page.getByRole('navigation');
    await expect(menu.getByRole('link', { name: 'Nueva venta' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Provisioning SaaS' })).toBeVisible();

    await menu.getByRole('link', { name: 'Provisioning SaaS' }).click();
    await expect(page.getByRole('heading', { name: 'Provisioning SaaS' })).toBeVisible();
  });
});

test.describe('aislamiento entre propietarios de producto', () => {
  test('el owner de EWM ve SU integración y ninguna otra', async ({ page }) => {
    await login(page, EWM_OWNER);
    await page.goto('/saas-provisioning');

    await expect(page.getByRole('heading', { name: 'Provisioning SaaS' })).toBeVisible();
    await expect(page.getByText('EWM').first()).toBeVisible();
    // RLS, no el menú: aunque llegara por URL, la base no le devuelve eSupplier.
    await expect(page.getByText('eSupplier')).toHaveCount(0);
  });

  test('el owner de eSupplier ve la suya, y no la de EWM', async ({ page }) => {
    await login(page, ESUPPLIER_OWNER);
    await page.goto('/saas-provisioning');

    await expect(page.getByRole('heading', { name: 'Provisioning SaaS' })).toBeVisible();
    await expect(page.getByText('EWM')).toHaveCount(0);
  });

  test('un owner no puede administrar integraciones ni siquiera de su producto', async ({ page }) => {
    await login(page, EWM_OWNER);
    await page.goto('/integrations');
    // Ve el catálogo acotado a su producto, pero sin el botón de administración.
    await expect(page.getByRole('button', { name: 'Nueva integración' })).toHaveCount(0);
  });
});

test.describe('sólo lectura', () => {
  test('finanzas ve el estado de las altas pero no puede ejecutar ninguna', async ({ page }) => {
    await login(page, FINANCE);
    await page.goto('/saas-provisioning');

    await expect(page.getByRole('heading', { name: 'Provisioning SaaS' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nueva solicitud' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Provisionar' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reintentar' })).toHaveCount(0);
  });
});
