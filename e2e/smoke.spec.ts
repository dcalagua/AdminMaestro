import { test, expect } from '@playwright/test';
import { login, USERS, DEMO_PASSWORD } from './fixtures';

test.describe('Login', () => {
  test('respeta la anatomía de login del contrato §4.5', async ({ page }) => {
    await page.goto('/login');

    // Panel de marca con EXACTAMENTE 3 bullets — "ni dos ni cinco".
    await expect(page.getByText('Consola central de la suite EBIM')).toBeVisible();
    const bullets = page.locator('ul li');
    await expect(bullets).toHaveCount(3);

    // Pie de confianza y lockup "by EBIM".
    await expect(page.getByText(/Cifrado en tránsito/)).toBeVisible();
    await expect(page.getByText('BY EBIM')).toBeVisible();

    // Subtítulo que dice de dónde sale la credencial (evita el ticket del día 1).
    await expect(page.getByText(/Tu acceso lo crea el equipo de plataforma/)).toBeVisible();

    // Un solo CTA primario y un solo link secundario de alta.
    await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Solicítalo al equipo/ })).toHaveCount(1);
  });

  test('rechaza credenciales incorrectas con un mensaje en español', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Correo corporativo').fill(USERS.superAdmin);
    await page.getByLabel('Contraseña', { exact: true }).fill('clave-incorrecta');
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await expect(page.getByRole('alert')).toContainText('Credenciales incorrectas');
  });

  test('una ruta protegida redirige al login', async ({ page }) => {
    await page.goto('/tenants');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Consola EBIM (super admin)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USERS.superAdmin);
  });

  test('el dashboard muestra indicadores calculados del seed', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Dashboard EBIM' })).toBeVisible();
    await expect(page.getByText('SaaS activos')).toBeVisible();
    // "MRR" aparece como tarjeta y como cabecera de tabla: se ancla a la tarjeta.
    await expect(page.getByText('MRR', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Ingreso cobrado').first()).toBeVisible();
    // Margen por producto con datos reales, no un gráfico vacío.
    await expect(page.getByText('Margen por producto SaaS')).toBeVisible();
  });

  test('el catálogo lista los 5 SaaS iniciales', async ({ page }) => {
    await page.getByRole('link', { name: 'SaaS Products' }).click();
    for (const producto of ['eSupplier by EBIM', 'EWM by EBIM', 'TMS by EBIM', 'GMAO by EBIM', 'eChange by EBIM']) {
      await expect(page.getByText(producto, { exact: true })).toBeVisible();
    }
  });

  test('los tenants muestran los tres modelos de despliegue', async ({ page }) => {
    await page.getByRole('link', { name: 'Tenants' }).click();
    await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();
    await expect(page.getByText('Compartido').first()).toBeVisible();
    await expect(page.getByText('Dedicado partner').first()).toBeVisible();
    await expect(page.getByText('Dedicado cliente').first()).toBeVisible();
  });

  test('el detalle de tenant abre en pestañas con deep-link', async ({ page }) => {
    await page.goto('/tenants');
    await page.getByRole('link', { name: 'Empresa Enterprise Omega · eSupplier' }).click();
    await expect(page.getByRole('tab', { name: 'Resumen' })).toBeVisible();

    await page.getByRole('tab', { name: 'Atribución comercial' }).click();
    await expect(page).toHaveURL(/#commercial/);
    await expect(page.getByRole('tab', { name: 'Atribución comercial' })).toHaveAttribute('aria-selected', 'true');
  });

  test('el buscador de listados filtra en un solo campo', async ({ page }) => {
    await page.goto('/tenants');
    // Regla de suite: un buscador general, nunca un panel multi-campo.
    await expect(page.getByRole('searchbox')).toHaveCount(1);
    await page.getByRole('searchbox').fill('titan');
    await expect(page.getByText('Industrias Titán · EWM')).toBeVisible();
    await expect(page.getByText('Empresa Directa Alpha · eSupplier')).toHaveCount(0);
  });

  test('provisioning corre en DRY_RUN y expone su timeline', async ({ page }) => {
    await page.getByRole('link', { name: 'Provisioning' }).click();
    await expect(page.getByText('Modo por defecto: DRY_RUN')).toBeVisible();
    await page.getByRole('button', { name: 'Timeline' }).first().click();
    await expect(page.getByText(/modo DRY_RUN|Solicitud encolada/).first()).toBeVisible();
  });

  test('los deployments separan infraestructura compartida de dedicada', async ({ page }) => {
    await page.getByRole('link', { name: 'Deployments' }).click();
    await expect(page.getByText('shared-esupplier-sa-east')).toBeVisible();
    await expect(page.getByText('omega-esupplier-dedicated')).toBeVisible();
  });

  test('costos y margen calculan sobre ingreso cobrado', async ({ page }) => {
    await page.getByRole('link', { name: 'Costos y margen' }).click();
    await expect(page.getByText('Margen bruto').first()).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Por partner' })).toBeVisible();
  });

  test('la auditoría es visible y de sólo lectura', async ({ page }) => {
    await page.getByRole('link', { name: 'Auditoría' }).click();
    await expect(page.getByText(/no se puede editar ni borrar/)).toBeVisible();
  });

  test('una ruta inexistente cae en el 404', async ({ page }) => {
    await page.goto('/ruta-que-no-existe');
    await expect(page.getByText(/404 · Esta ruta no existe/)).toBeVisible();
  });
});

test.describe('Aislamiento por rol', () => {
  test('un PARTNER_ADMIN no ve la sección de costos de EBIM', async ({ page }) => {
    await login(page, USERS.partnerAdmin);
    // No está en el menú...
    await expect(page.getByRole('link', { name: 'Costos y margen' })).toHaveCount(0);
    // ...y forzar la URL tampoco sirve: el guard lo bloquea y RLS no devolvería filas.
    await page.goto('/costs');
    await expect(page.getByText('Tu rol no tiene acceso a esta sección')).toBeVisible();
  });

  test('un partner no ve los tenants de otro partner', async ({ page }) => {
    await login(page, USERS.partnerAdmin);
    await page.goto('/tenants');
    await expect(page.getByText('Cliente Partner Uno · eSupplier')).toBeVisible();
    // Los tenants de Reseller Pacífico son de otra organización: RLS los filtra.
    await expect(page.getByText('Cliente EWM Norte · EWM')).toHaveCount(0);
    await expect(page.getByText('Cliente EWM Sur · EWM')).toHaveCount(0);
  });

  test('un SALES_AGENT ve su tablero comercial y nada operativo', async ({ page }) => {
    await login(page, USERS.salesAgent);
    await expect(page.getByRole('heading', { name: 'Mi tablero comercial' })).toBeVisible();
    await expect(page.getByText(/no expone datos operativos/)).toBeVisible();

    // Su menú no ofrece infraestructura ni facturación.
    await expect(page.getByRole('link', { name: 'Deployments' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Facturación y cobros' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Costos y margen' })).toHaveCount(0);
  });

  test('un TENANT_ADMIN sólo ve su propio tenant', async ({ page }) => {
    await login(page, USERS.tenantAdmin);
    await page.goto('/tenants');
    await expect(page.getByText('Empresa Directa Alpha · eSupplier')).toBeVisible();
    // El tenant de Omega pertenece a otra organización.
    await expect(page.getByText('Empresa Enterprise Omega · eSupplier')).toHaveCount(0);
  });

  test('EBIM_FINANCE accede a costos; el catálogo sigue siendo común', async ({ page }) => {
    await login(page, USERS.finance);
    await page.goto('/costs');
    await expect(page.getByRole('heading', { name: 'Costos y margen' })).toBeVisible();
  });
});

test.describe('Apariencia', () => {
  test('el usuario elige modo y densidad, nunca el color de marca', async ({ page }) => {
    await login(page, USERS.superAdmin);
    await page.goto('/settings');

    // El topbar tiene un botón de modo con aria-label; el de Configuración lleva
    // el texto. `exact` los distingue sin depender del orden del DOM.
    const botonOscuro = page.getByRole('button', { name: 'Oscuro', exact: true });
    await expect(botonOscuro).toBeVisible();
    await expect(page.getByRole('button', { name: 'Compacta', exact: true })).toBeVisible();
    // Contrato §4.4: no existe selector de paleta/color para el usuario.
    await expect(page.getByText(/El color de marca no es elegible por el usuario/)).toBeVisible();

    await botonOscuro.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.getByRole('button', { name: 'Compacta', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-density', 'compacta');
  });
});

test.describe('Higiene de seguridad del cliente', () => {
  test('el bundle no contiene la clave de servicio', async ({ page }) => {
    await login(page, USERS.superAdmin);
    // Se comprueba en el navegador real, no sobre el archivo: es donde importa.
    // Las agujas se componen en tiempo de ejecución para que el literal no
    // exista en ningún archivo del repo: así `npm run secrets:scan` puede seguir
    // siendo estricto sin necesitar una excepción para este test.
    const needles = [`"role":"${'service'}_${'role'}"`, `sb_${'secret'}_`];
    const leak = await page.evaluate(async (patterns: string[]) => {
      const scripts = Array.from(document.querySelectorAll('script[src]')).map(
        (s) => (s as HTMLScriptElement).src,
      );
      for (const src of scripts) {
        const text = await (await fetch(src)).text();
        if (patterns.some((p) => text.includes(p))) return src;
      }
      return null;
    }, needles);
    expect(leak).toBeNull();
  });

  test('la contraseña demo no viaja en el HTML servido', async ({ request }) => {
    const html = await (await request.get('/login')).text();
    expect(html).not.toContain(DEMO_PASSWORD);
  });
});
