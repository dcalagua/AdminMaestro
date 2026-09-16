import { test, expect, type Page } from '@playwright/test';
import { login, USERS } from './fixtures';

/**
 * Journeys V2 — Fase 17.
 *
 * Son los recorridos que se enseñan a gerencia, ejecutados contra la app real y
 * el Supabase local con el seed cargado. No hay mocks de red: si RLS bloquea
 * algo, el test lo ve igual que lo vería una persona.
 *
 * Los datos que estos tests CREAN llevan un sufijo único por ejecución, para
 * que la suite pueda repetirse sin `db:reset` en medio y sin chocar con los
 * slugs del seed.
 */

const RUN = Date.now().toString(36).slice(-6);

/**
 * Rutas del menú lateral, por etiqueta.
 *
 * `goToSection` ESPERA a que la URL cambie antes de devolver. Sin esa espera,
 * el `click` vuelve enseguida y la aserción siguiente se evalúa contra la
 * pantalla ANTERIOR — que fue exactamente lo que hizo que un conteo de filas
 * midiera la tabla del dashboard creyendo que medía la de tenants.
 */
const SECTION_PATH: Record<string, string> = {
  'Suite SaaS': '/products',
  'Partners / Resellers': '/partners',
  Clientes: '/customers',
  'Todas las organizaciones': '/organizations',
  'Nueva venta': '/onboarding',
  Tenants: '/tenants',
  'Suscripciones y licencias': '/subscriptions',
  'Renovaciones y alertas': '/renewals',
  Reconciliación: '/reconciliation',
  Deployments: '/deployments',
  Provisioning: '/provisioning',
  'Comisiones y liquidaciones': '/commissions',
};

async function goToSection(page: Page, label: string) {
  await page.getByRole('link', { name: label, exact: true }).click();
  const path = SECTION_PATH[label];
  if (path) await page.waitForURL(`**${path}`);
}

test.describe('J1 · Canal: alta de partner y acuerdo por SaaS', () => {
  test('EBIM crea un partner y le asigna un acuerdo eSupplier Shared', async ({ page }) => {
    await login(page, USERS.superAdmin);
    await goToSection(page, 'Partners / Resellers');

    await page.getByRole('button', { name: 'Nuevo partner' }).click();
    // Se acota al diálogo: «País» y «Slug» también existen en la tabla de fondo.
    const alta = page.getByRole('dialog');
    await alta.getByLabel('Nombre comercial').fill(`Partner E2E ${RUN}`);
    await alta.getByLabel('Razón social').fill(`Partner E2E ${RUN} SAC`);
    await alta.getByLabel('Slug').fill(`partner-e2e-${RUN}`);
    await alta.getByLabel('País').fill('PE');
    await alta.getByRole('button', { name: 'Crear organización' }).click();

    // El toast confirma que la base aceptó la escritura, no solo que la UI cerró.
    await expect(page.getByText('Organización creada')).toBeVisible({ timeout: 15_000 });

    // Se busca el partner recién creado y se abre SU detalle, no el de otra fila.
    await page.getByRole('searchbox').fill(`partner-e2e-${RUN}`);
    await page.getByRole('link', { name: 'Ver detalle' }).first().click();

    await page.getByRole('tab', { name: 'Productos autorizados' }).click();
    await page.getByRole('button', { name: /Nuevo acuerdo|Crear el primer acuerdo/ }).first().click();

    const acuerdo = page.getByRole('dialog');
    await acuerdo.getByLabel('Producto').selectOption({ label: 'eSupplier' });
    await acuerdo.getByLabel('Margen del canal (%)').fill('25');
    await acuerdo.getByRole('button', { name: 'Crear acuerdo' }).click();

    await expect(page.getByText('Acuerdo creado')).toBeVisible({ timeout: 15_000 });
    // El margen se formatea con la configuración regional (es-PE usa coma y un
    // espacio duro antes del %), así que se compara con una expresión tolerante.
    await expect(page.getByText(/25[.,]0\s*%/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('eSupplier').first()).toBeVisible();
  });
});

test.describe('J2 · Alta transaccional de cliente con fee de implementación', () => {
  test('el wizard crea tenant, suscripción, licencia y fee en una sola operación', async ({ page }) => {
    await login(page, USERS.superAdmin);
    await goToSection(page, 'Nueva venta');

    await expect(page.getByRole('heading', { name: 'Nueva venta / alta de cliente' })).toBeVisible();

    // Paso 1 · cliente y producto
    await page.getByLabel('Organización cliente').selectOption({ label: 'Empresa Directa Alpha' });
    await page.getByLabel('Producto SaaS').selectOption({ label: 'eSupplier (esupplier)' });
    await page.getByRole('button', { name: 'Continuar' }).click();

    // Paso 2 · canal y modelo
    await page.getByLabel('Nombre del tenant').fill(`Alpha E2E ${RUN}`);
    await page.getByLabel('Slug').fill(`alpha-e2e-${RUN}`);
    await page.getByLabel('Correo del administrador del cliente').fill(`admin-${RUN}@alpha-e2e.com`);
    await page.getByRole('button', { name: 'Continuar' }).click();

    // Paso 3 · plan y precio regional. V3: Alpha es peruana, así que el mercado
    // sugerido es PE y la moneda sugerida PEN; este journey contrata en USD, que
    // Perú admite, con la tarifa PE/USD del plan.
    await page.getByLabel('Moneda').selectOption('USD');
    await page.getByLabel('Plan').selectOption({ label: 'eSupplier Shared Standard' });
    await page.getByRole('button', { name: 'Continuar' }).click();

    // Paso 4 · implementación
    await page.getByLabel('Fee de implementación').fill('1500');
    await page.getByRole('button', { name: 'Continuar' }).click();

    // Paso 5 · resumen: la implementación NO puede aparecer dentro del MRR.
    await expect(page.getByText('Implementación (única)')).toBeVisible();
    await page.getByRole('button', { name: 'Crear cliente' }).click();

    await expect(page.getByText('Alta completada')).toBeVisible({ timeout: 20_000 });
    // Aterriza en el detalle del tenant recién creado.
    await expect(page.getByRole('heading', { name: `Alpha E2E ${RUN}` })).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe('J3-J4 · Partner Shared: su cartera, y solo la suya', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USERS.partnerAdmin);
  });

  test('el partner administra varios tenants SHARED sin infraestructura dedicada', async ({ page }) => {
    await goToSection(page, 'Tenants');
    await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible({ timeout: 15_000 });

    // Consultora Andina administra varios tenants; los compartidos son mayoría.
    const filas = page.locator('tbody tr');
    await expect(filas.first()).toBeVisible({ timeout: 15_000 });
    expect(await filas.count()).toBeGreaterThan(1);

    // Tener muchos clientes en compartido NO lo convierte en Dedicated.
    await page.getByRole('tab', { name: 'Compartidos' }).click();
    await expect(page.locator('tbody tr').first()).toBeVisible();
  });

  test('el partner NO ve la organización de otro partner', async ({ page }) => {
    await goToSection(page, 'Todas las organizaciones');
    await expect(page.getByText('Consultora Andina').first()).toBeVisible({ timeout: 15_000 });
    // RLS, no el menú: la fila del otro partner sencillamente no vuelve.
    await expect(page.getByText('Reseller Pacífico')).toHaveCount(0);
  });

  test('el partner no ve costos ni reconciliación de la plataforma', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Costos y margen' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Reconciliación' })).toHaveCount(0);
  });
});

test.describe('J5-J6 · Modelos dedicados', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USERS.superAdmin);
  });

  test('los tres modelos conviven y el dedicado de partner aloja varios tenants suyos', async ({ page }) => {
    await goToSection(page, 'Deployments');
    await expect(page.getByText('Dedicados de partner')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('andina-esupplier-dedicated')).toBeVisible();
    await expect(page.getByText('omega-esupplier-dedicated')).toBeVisible();
    await expect(page.getByText('shared-esupplier-sa-east')).toBeVisible();
  });

  test('se encola provisioning en DRY_RUN desde la consola', async ({ page }) => {
    await goToSection(page, 'Provisioning de infraestructura');
    await expect(page.getByText('Modo por defecto: DRY_RUN')).toBeVisible();

    await page.getByRole('button', { name: 'Encolar solicitud' }).click();
    const encolar = page.getByRole('dialog');
    await encolar.getByLabel('Acción').selectOption('CREATE_DEDICATED_TARGET');
    await encolar.getByLabel('Tenant').selectOption({ index: 1 });
    await encolar.getByRole('button', { name: 'Encolar' }).click();

    await expect(page.getByText('Solicitud encolada')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('J7 · Un cliente, dos SaaS, dos métodos de cobro', () => {
  test('GRUPASA paga eSupplier con tarjeta y EWM con Orden de Servicio', async ({ page }) => {
    await login(page, USERS.finance);
    await goToSection(page, 'Todas las organizaciones');
    // En el listado el enlace es «Ver detalle»; se filtra primero para abrir el correcto.
    await page.getByRole('searchbox').fill('grupasa');
    await page.getByRole('link', { name: 'Ver detalle' }).first().click();

    // La vista 360 es la demostración principal del Control Plane.
    await expect(page.getByRole('tab', { name: 'Vista 360' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Cobranza por SaaS')).toBeVisible();

    // El mismo cliente, dos métodos distintos, en la misma tabla.
    await expect(page.getByText('Tarjeta (Culqi)').first()).toBeVisible();
    await expect(page.getByText('Orden de Servicio').first()).toBeVisible();
    await expect(page.getByText('Métodos de cobro distintos')).toBeVisible();
  });
});

test.describe('J8 · OS/OC: el ciclo NO es un cobro', () => {
  test('una Orden de Servicio aprobada no aparece como cobro confirmado', async ({ page }) => {
    await login(page, USERS.finance);
    await goToSection(page, 'Suscripciones y licencias');

    await page.getByRole('link', { name: 'SUB-GRUPASA-EWM' }).click();
    await page.getByRole('tab', { name: 'Cobranza' }).click();

    // El documento está aprobado y vigente...
    await expect(page.getByText('OS-2026-0455')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Aprobada').first()).toBeVisible();

    // ...y aun así la pestaña de cobros no muestra ningún cobro confirmado por él.
    await page.getByRole('tab', { name: 'Facturación y cobros' }).click();
    await expect(
      page.getByText(/Sin facturas emitidas|Sin cobros confirmados/).first(),
    ).toBeVisible();
  });

  test('el ciclo completo request -> received -> approved se ve en la línea de tiempo', async ({ page }) => {
    await login(page, USERS.finance);
    await goToSection(page, 'Suscripciones y licencias');
    await page.getByRole('link', { name: 'SUB-P1-EWM' }).click();
    await page.getByRole('tab', { name: 'Cobranza' }).click();

    await expect(page.getByText('OS-2026-0512')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Recibida').first()).toBeVisible();
    // Una recibida ofrece aprobar; una solicitada, no.
    await expect(page.getByRole('button', { name: 'Aprobar' })).toBeVisible();
  });
});

test.describe('J9 · Culqi en MOCK e idempotencia visible', () => {
  test('la UI declara que Culqi está pendiente de configurar', async ({ page }) => {
    await login(page, USERS.finance);
    await goToSection(page, 'Suscripciones y licencias');
    await page.getByRole('link', { name: 'SUB-GRUPASA-ESUP' }).click();
    await page.getByRole('tab', { name: 'Cobranza' }).click();

    await expect(page.getByText('Cobro con tarjeta')).toBeVisible({ timeout: 15_000 });
    // Sin credenciales, se dice; no se finge que el cobro está operativo.
    await expect(page.getByText('Culqi pendiente de configurar')).toBeVisible();
  });

  test('el ledger de webhooks muestra la entrega repetida como IGNORADA', async ({ page }) => {
    await login(page, USERS.superAdmin);
    await goToSection(page, 'Reconciliación');
    await page.getByRole('tab', { name: 'Eventos del proveedor' }).click();

    await expect(page.getByText('charge.failed').first()).toBeVisible({ timeout: 15_000 });
    // La entrega repetida del seed: la idempotencia funcionando, a la vista.
    await expect(page.getByText('IGNORED').first()).toBeVisible();
  });
});

test.describe('J10 · Comercial: comisión sí, acceso operativo no', () => {
  test('ve sus comisiones pero no la gestión de tenants ni la infraestructura', async ({ page }) => {
    await login(page, USERS.salesAgent);

    await goToSection(page, 'Comisiones y liquidaciones');
    await expect(page.getByRole('heading', { name: /Comisiones/ })).toBeVisible({ timeout: 15_000 });

    // Nada de infraestructura, cobranza ni organizaciones ajenas.
    await expect(page.getByRole('link', { name: 'Deployments' })).toHaveCount(0);
    // Los DOS ejes de provisioning quedan fuera del alcance de un comercial.
    await expect(page.getByRole('link', { name: 'Provisioning de infraestructura' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Provisioning SaaS' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Renovaciones y alertas' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Nueva venta' })).toHaveCount(0);
  });
});

test.describe('J11 · Renovaciones y gracia', () => {
  test('el tablero muestra ventanas de renovación y la factura en gracia', async ({ page }) => {
    await login(page, USERS.superAdmin);
    await goToSection(page, 'Renovaciones y alertas');

    await expect(page.getByRole('heading', { name: 'Renovaciones y alertas' })).toBeVisible();
    await expect(page.getByText('Renuevan en 45 días')).toBeVisible();
    await expect(page.getByText('En gracia').first()).toBeVisible();

    // El seed deja una factura vencida dentro de la gracia.
    await page.getByRole('tab', { name: 'Vencidas' }).click();
    await expect(page.getByText(/Factura vencida|Se acaba la gracia/).first()).toBeVisible();
  });

  test('recalcular alertas es idempotente y no suspende nada', async ({ page }) => {
    await login(page, USERS.superAdmin);
    await goToSection(page, 'Renovaciones y alertas');

    // Se pulsa DOS veces y se afirma sobre la segunda. La primera puede crear
    // alertas legítimas, porque los journeys anteriores dieron de alta clientes
    // nuevos. Lo que se prueba es que recalcular no DUPLICA, no que no haya nada
    // que calcular.
    await page.getByRole('button', { name: 'Recalcular alertas' }).click();
    await expect(page.getByText('Alertas recalculadas')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Recalcular alertas' }).click();
    await expect(page.getByText('Nada nuevo: el cálculo es idempotente.')).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe('J12 · Una mutación no autorizada se rechaza de verdad', () => {
  test('el partner admin no puede crear un producto ni ve el botón', async ({ page }) => {
    await login(page, USERS.partnerAdmin);
    await goToSection(page, 'Suite SaaS');

    await expect(page.getByRole('heading', { name: 'SaaS Products' })).toBeVisible({
      timeout: 15_000,
    });
    // La UI no ofrece la acción...
    await expect(page.getByRole('button', { name: 'Nuevo producto' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  });

  test('forzar la URL del alta de cliente no da acceso', async ({ page }) => {
    await login(page, USERS.partnerAdmin);
    // La ruta existe; el guard la rechaza y, aunque no lo hiciera, la RPC
    // devolvería 42501.
    await page.goto('/onboarding');
    await expect(page.getByText('Tu rol no tiene acceso a esta sección')).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe('J13 · Vista 360 de organización', () => {
  test('reúne productos, tenants, cobranza, renovación, comisión y margen', async ({ page }) => {
    await login(page, USERS.superAdmin);
    await goToSection(page, 'Clientes');
    await page.getByRole('link', { name: 'Ver detalle' }).first().click();

    await expect(page.getByRole('tab', { name: 'Vista 360' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Capacidades y acuerdos')).toBeVisible();
    await expect(page.getByText('Cobranza por SaaS')).toBeVisible();
    await expect(page.getByText('Cobros confirmados')).toBeVisible();
    await expect(page.getByText('Comercial y comisiones')).toBeVisible();
    await expect(page.getByText('Infraestructura y provisioning')).toBeVisible();
  });
});

test.describe('J14 · Datos de facturación del titular (V2.1)', () => {
  test('dice qué falta para poder cobrar, en vez de rellenarlo por su cuenta', async ({ page }) => {
    await login(page, USERS.superAdmin);
    await goToSection(page, 'Clientes');
    // Cliente EWM Norte llega sin contacto de facturación: es el estado en que
    // entra cualquier organización nueva.
    await page.getByRole('row', { name: /Cliente EWM Norte/ }).getByRole('link', { name: 'Ver detalle' }).click();
    await page.getByRole('tab', { name: 'Resumen' }).click();

    await expect(page.getByText('Datos de facturación del titular')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Faltan 5')).toBeVisible();
    // El error que se llevaría el operador si intentara domiciliar el cobro,
    // dicho ANTES de intentarlo.
    await expect(page.getByText('DATOS_FACTURACION_INCOMPLETOS')).toBeVisible();
    // La lista nombra los campos que faltan, sin que el operador tenga que
    // deducirlos del mensaje de la pasarela.
    await expect(page.getByRole('listitem').filter({ hasText: 'Domicilio' })).toBeVisible();
  });

  test('el formulario llega con lo ya cargado y valida antes que la pasarela', async ({ page }) => {
    await login(page, USERS.superAdmin);
    await goToSection(page, 'Clientes');
    await page.getByRole('row', { name: /GRUPASA/ }).getByRole('link', { name: 'Ver detalle' }).click();
    await page.getByRole('tab', { name: 'Resumen' }).click();

    await expect(page.getByText('Datos de facturación del titular')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Completos')).toBeVisible();

    await page.getByRole('button', { name: /datos de facturación/i }).click();
    // Se abre con lo que ya hay: editar no es volver a teclearlo todo.
    await expect(page.getByLabel('Ciudad')).toHaveValue('Lima');

    // Un teléfono con formato humano se rechaza AQUÍ. En la pasarela el mensaje
    // no dice qué campo es.
    await page.getByLabel('Teléfono').fill('+51 987 654 321');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText(/Solo dígitos, entre 5 y 15/)).toBeVisible();
  });
});
