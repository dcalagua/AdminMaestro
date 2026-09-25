import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * Soporte común de la suite «experiencia ejecutiva».
 *
 * Regla de la corrida: el navegador de pruebas NO sale de la máquina. Todo host
 * distinto de 127.0.0.1/localhost se aborta y queda registrado. La única
 * excepción es cosmética y tampoco sale: la hoja de Google Fonts se responde con
 * una copia local de DM Sans (OFL-1.1) descargada una vez en `.runtime/fonts`.
 * Si esa copia no existe, la fuente cae al fallback del sistema y la captura lo
 * refleja; la petición remota sigue abortada.
 */

export const DEMO_PASSWORD = 'Ebim.Demo2026!';

export const USERS = {
  superAdmin: 'dcalagua@ebim.pe',
  productAdmin: 'product.admin@ebim.test',
  finance: 'finance@ebim.test',
  partnerAdmin: 'admin@andina.ebim.test',
  otherPartnerAdmin: 'admin@pacifico.ebim.test',
  salesAgent: 'comercial@indep.ebim.test',
  tenantAdmin: 'admin@alpha.ebim.test',
} as const;

const FONT_DIR = resolve(process.cwd(), '.runtime/fonts/package/files');
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

export interface RemoteGuard {
  /** Hosts remotos que la página intentó contactar (abortados). */
  blocked: string[];
}

export async function guardRemote(context: BrowserContext): Promise<RemoteGuard> {
  const guard: RemoteGuard = { blocked: [] };
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:' || LOCAL_HOSTS.has(url.hostname)) {
      return route.continue();
    }
    if (url.hostname === 'fonts.googleapis.com') {
      return route.fulfill({ contentType: 'text/css', body: localFontCss() });
    }
    if (url.hostname === 'fonts.gstatic.com' && url.pathname.startsWith('/__local__/')) {
      const file = resolve(FONT_DIR, url.pathname.replace('/__local__/', ''));
      if (existsSync(file)) {
        return route.fulfill({ contentType: 'font/woff2', body: readFileSync(file) });
      }
    }
    guard.blocked.push(url.hostname);
    return route.abort('blockedbyclient');
  });
  return guard;
}

function localFontCss(): string {
  // Las URL apuntan a un path sintético que el propio route handler responde
  // desde disco; nunca llegan a la red.
  const face = (style: 'normal' | 'italic') => `@font-face {
  font-family: 'DM Sans';
  font-style: ${style};
  font-display: swap;
  font-weight: 100 1000;
  src: url(https://fonts.gstatic.com/__local__/dm-sans-latin-wght-${style}.woff2) format('woff2-variations');
}`;
  return `${face('normal')}\n${face('italic')}`;
}

/** Sólo Google Fonts se tolera como intento (se sirve localmente arriba). */
export function unexpectedRemoteHosts(guard: RemoteGuard): string[] {
  return [...new Set(guard.blocked)].filter((h) => !h.startsWith('fonts.'));
}

export async function setAppearance(
  page: Page,
  mode: 'light' | 'dark',
  density: 'comoda' | 'equilibrada' | 'compacta' = 'equilibrada',
) {
  await page.addInitScript(
    ([m, d]) => {
      try {
        localStorage.setItem('ebim-cp-color-mode', m);
        localStorage.setItem('ebim-cp-density', d);
      } catch {
        /* sin storage: se usa el default */
      }
    },
    [mode, density] as const,
  );
}

/**
 * Apariencia tal como la fija una persona: desde Configuración, después de
 * iniciar sesión (el perfil guardado manda sobre el almacenamiento local).
 */
export async function applyAppearance(
  page: Page,
  mode: 'light' | 'dark',
  density: 'comoda' | 'equilibrada' | 'compacta' = 'equilibrada',
) {
  await page.goto('/settings#appearance');
  const label = { comoda: 'Cómoda', equilibrada: 'Equilibrada', compacta: 'Compacta' }[density];
  await page.getByRole('button', { name: mode === 'dark' ? 'Oscuro' : 'Claro', exact: true }).click();
  await page.getByRole('button', { name: label, exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
  await expect(page.locator('html')).toHaveAttribute('data-density', density);
}

export async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Correo corporativo').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('button', { name: 'Salir' }).first()).toBeAttached({
    timeout: 20_000,
  });
}

/** Espera razonable a que las consultas visibles terminen. */
export async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page
    .locator('[aria-busy="true"], .animate-pulse')
    .first()
    .waitFor({ state: 'detached', timeout: 8_000 })
    .catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready);
}

/** IDs del seed local (supabase/seed.sql); fijos por diseño del seed. */
export const SEED = {
  organizationId: '30000000-0000-4000-a000-000000000002',
  productId: '20000000-0000-4000-a000-000000000001',
  tenantId: '50000000-0000-4000-a000-000000000001',
  subscriptionId: '70000000-0000-4000-a000-000000000001',
  /** Tenant del fixture local `supabase/fixtures/executive-demo.sql`. */
  demoTenantId: '5e000000-0000-4000-a000-00000000e001',
} as const;

export interface PageSpec {
  id: string;
  name: string;
  path: string;
  /** Página con matriz ampliada (1280/768 y oscuro). */
  key?: boolean;
  public?: boolean;
}

/** P01–P32 de la spec (Anexo A). `integrationId` se resuelve en tiempo de test. */
export function pageMatrix(integrationId: string): PageSpec[] {
  return [
    { id: 'P01', name: 'login', path: '/login', public: true },
    { id: 'P02', name: 'billing', path: '/billing', key: true },
    { id: 'P03', name: 'costs', path: '/costs' },
    { id: 'P04', name: 'reconciliation', path: '/reconciliation' },
    { id: 'P05', name: 'renewals', path: '/renewals' },
    { id: 'P06', name: 'subscription-detail', path: `/subscriptions/${SEED.subscriptionId}` },
    { id: 'P07', name: 'subscriptions', path: '/subscriptions' },
    { id: 'P08', name: 'feature-flags', path: '/feature-flags' },
    { id: 'P09', name: 'plans', path: '/plans' },
    { id: 'P10', name: 'product-detail', path: `/products/${SEED.productId}` },
    { id: 'P11', name: 'products', path: '/products' },
    { id: 'P12', name: 'attributions', path: '/attributions' },
    { id: 'P13', name: 'commission-plans', path: '/commission-plans' },
    { id: 'P14', name: 'commissions', path: '/commissions' },
    { id: 'P15', name: 'sales-agents', path: '/sales-agents' },
    { id: 'P16', name: 'dashboard', path: '/', key: true },
    { id: 'P17', name: 'deployments', path: '/deployments' },
    { id: 'P18', name: 'provisioning', path: '/provisioning' },
    { id: 'P19', name: 'saas-provisioning', path: '/saas-provisioning', key: true },
    { id: 'P20', name: 'onboarding', path: '/onboarding' },
    { id: 'P21', name: 'customers', path: '/customers' },
    { id: 'P22', name: 'organization-detail', path: `/organizations/${SEED.organizationId}`, key: true },
    { id: 'P23', name: 'organizations', path: '/organizations' },
    { id: 'P24', name: 'partners', path: '/partners' },
    { id: 'P25', name: 'integration-detail', path: `/integrations/${integrationId}` },
    { id: 'P26', name: 'integrations', path: '/integrations', key: true },
    { id: 'P27', name: 'regional', path: '/regional' },
    { id: 'P28', name: 'audit', path: '/audit' },
    { id: 'P29', name: 'not-found', path: '/404' },
    { id: 'P30', name: 'settings', path: '/settings' },
    { id: 'P31', name: 'tenant-detail', path: `/tenants/${SEED.tenantId}`, key: true },
    { id: 'P32', name: 'tenants', path: '/tenants' },
  ];
}

/** Vistas adicionales de la matriz ampliada (sólo en el set «after»). */
export function extraViews(): PageSpec[] {
  return [
    { id: 'P16', name: 'dashboard-finanzas', path: '/#finanzas', key: true },
    { id: 'P16', name: 'dashboard-operacion', path: '/#operacion', key: true },
    { id: 'P31', name: 'tenant-detail-demo-fixture', path: `/tenants/${SEED.demoTenantId}`, key: true },
    { id: 'P02', name: 'billing-cobros', path: '/billing#cobros' },
    { id: 'P02', name: 'billing-vencidas-31-60', path: '/billing?estado=OPEN&antiguedad=D31_60' },
  ];
}
