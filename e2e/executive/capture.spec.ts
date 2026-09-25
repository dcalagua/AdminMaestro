import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  USERS,
  guardRemote,
  login,
  extraViews,
  pageMatrix,
  applyAppearance,
  setAppearance,
  settle,
  unexpectedRemoteHosts,
  type PageSpec,
} from './support';

/**
 * Captura de evidencia P01–P32 (spec §15.1).
 *
 * `CAPTURE_SET=before|after` decide la carpeta. Sólo se ejecuta cuando se pide
 * explícitamente (`CAPTURE_SET` definido): no es un test de regresión visual con
 * snapshots auto-aprobados, es material para inspección humana.
 *
 * Además de la imagen, registra por captura si el documento tiene scroll
 * horizontal global (AC03) — un dato medido, no una opinión.
 */

const SET = process.env.CAPTURE_SET;
const OUT = resolve(process.cwd(), 'docs/superpowers/evidence/executive-experience/screenshots', SET ?? 'unset');

interface Shot {
  id: string;
  name: string;
  file: string;
  width: number;
  theme: 'light' | 'dark';
  horizontalOverflow: boolean;
  httpErrors: number;
}

const VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  1280: { width: 1280, height: 800 },
  768: { width: 768, height: 1024 },
  390: { width: 390, height: 844 },
} as const;

function plan(spec: PageSpec): Array<{ width: keyof typeof VIEWPORTS; theme: 'light' | 'dark' }> {
  const base = [
    { width: 1440 as const, theme: 'light' as const },
    { width: 390 as const, theme: 'light' as const },
  ];
  if (!spec.key) return base;
  return [
    ...base,
    { width: 1280, theme: 'light' },
    { width: 768, theme: 'light' },
    { width: 1440, theme: 'dark' },
    { width: 390, theme: 'dark' },
  ];
}

async function resolveIntegrationId(page: Page): Promise<string> {
  await page.goto('/integrations');
  const link = page.locator('a[href^="/integrations/"]').first();
  await link.waitFor({ timeout: 15_000 });
  const href = (await link.getAttribute('href')) ?? '';
  return href.split('/').pop() ?? '';
}

test.describe('captura de páginas P01–P32', () => {
  test.skip(!SET, 'Definir CAPTURE_SET=before|after para generar evidencia');

  test('superadmin · matriz visual', async ({ browser }) => {
    test.setTimeout(20 * 60_000);
    mkdirSync(OUT, { recursive: true });
    const shots: Shot[] = [];
    const blocked: string[] = [];

    for (const theme of ['light', 'dark'] as const) {
      const context = await browser.newContext({ viewport: VIEWPORTS[1440] });
      const guard = await guardRemote(context);
      const page = await context.newPage();
      await setAppearance(page, theme);

      let httpErrors = 0;
      page.on('response', (r) => {
        if (r.status() >= 400 && r.url().includes('127.0.0.1:55421')) httpErrors += 1;
      });

      // P01 se captura sin sesión.
      const integrationId = await (async () => {
        await login(page, USERS.superAdmin);
        // En «after» la apariencia vive en el perfil: se fija como lo haría la persona.
        if (SET !== 'before') await applyAppearance(page, theme);
        return resolveIntegrationId(page);
      })();
      const specs = [...pageMatrix(integrationId), ...(SET === 'before' ? [] : extraViews())];

      for (const spec of specs) {
        const runs = plan(spec).filter((r) => r.theme === theme);
        for (const run of runs) {
          const target = spec.public ? await browser.newContext({ viewport: VIEWPORTS[run.width] }) : null;
          const p = target ? await target.newPage() : page;
          if (target) {
            const g = await guardRemote(target);
            await setAppearance(p, theme);
            blocked.push(...unexpectedRemoteHosts(g));
          }
          await p.setViewportSize(VIEWPORTS[run.width]);
          httpErrors = 0;
          await p.goto(spec.path);
          await settle(p);
          const horizontalOverflow = await p.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          );
          const file = `${spec.id}-${spec.name}-${run.width}-${theme}.jpg`;
          await p.screenshot({ path: resolve(OUT, file), fullPage: true, type: 'jpeg', quality: 70 });
          shots.push({
            id: spec.id,
            name: spec.name,
            file,
            width: run.width,
            theme,
            horizontalOverflow,
            httpErrors,
          });
          if (target) await target.close();
        }
      }
      blocked.push(...unexpectedRemoteHosts(guard));
      await context.close();
    }

    writeFileSync(resolve(OUT, 'index.json'), JSON.stringify({ set: SET, shots, blocked }, null, 2));
    expect(blocked, 'ningún host remoto inesperado').toEqual([]);
  });
});
