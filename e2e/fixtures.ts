import { expect, type Page } from '@playwright/test';

/**
 * Usuarios de prueba del seed. Fixtures descartables en `@ebim.test`
 * (gobernanza de datos, contrato §11) más el operador único de la suite.
 *
 * La contraseña sólo existe en el stack local: el seed la genera en la base de
 * desarrollo y no hay ningún entorno remoto con estos usuarios.
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

export async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Correo corporativo').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  // El shell aparece cuando la sesión quedó establecida.
  await expect(page.getByRole('button', { name: 'Menú de cuenta' })).toBeVisible({ timeout: 20_000 });
}

/** Cierra la sesión desde el menú de cuenta del topbar. */
export async function logout(page: Page) {
  await page.getByRole('button', { name: 'Menú de cuenta' }).click();
  await page.getByRole('menuitem', { name: 'Salir' }).click();
}
