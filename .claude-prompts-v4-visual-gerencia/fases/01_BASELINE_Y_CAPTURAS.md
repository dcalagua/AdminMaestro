# FASE 01 — Baseline y capturas «antes»

## Objetivo
Dejar una línea base verificada y fotografiar TODA la consola antes de cambiar nada, para poder mostrar el antes/después a Gerencia.

## Pasos
1. En el WORKTREE confirma rama `feature/masteradmin-visual-gerencia`, base `dev` y árbol limpio. Anota HEAD en STATE.
2. Supabase local: `supabase status` (si no corre, `supabase start`). `supabase db reset --local` y `supabase test db`. Anota totales.
3. Gate completo (`QUALITY_GATE.md`). Anota totales de vitest y build.
4. Crea `e2e/visual/capturas.spec.ts` (Playwright, ya instalado; usa `e2e/fixtures.ts` para `login` y `USERS`):
   - Lee `process.env.VISUAL_LABEL` (default `adhoc`) y guarda en `docs/superpowers/evidence/visual-gerencia/capturas/<label>/`.
   - Recorre TODAS las rutas de `src/app/navigation.ts` (`NAV_ITEMS`) como super admin, más: `/login` (sin sesión),
     una ficha 360 de organización, una ficha de tenant, una de suscripción, `/users/:id`, `/pagar` (sin token: estado de enlace inválido).
   - Para cada ruta: espera a que no haya skeleton/spinner (`networkidle` + selector del `h1`), captura **página completa** a 1440×900
     en modo claro, y del dashboard también en modo oscuro y a 1280×800. Nombre de archivo `NN-<slug>-<tema>.png`.
   - Además genera `index.json` con ruta, archivo, título y si la página mostró estado de error.
   - Que el spec no falle por una pantalla rota: registra el error en `index.json` y sigue (es inventario, no un test de regresión).
   - Excluye este spec de la suite e2e normal si `playwright.config.ts` lo recogería sin `VISUAL_LABEL` (por ejemplo con `test.skip(!process.env.VISUAL_LABEL)`).
5. Ejecuta `VISUAL_LABEL=antes npx playwright test e2e/visual/capturas.spec.ts`.
6. Escribe `docs/superpowers/evidence/visual-gerencia/BASELINE.md`: HEAD, totales de gates, lista de capturas, y una
   **auditoría visual breve** (mirando las PNG con Read): 10–15 problemas concretos por prioridad (jerarquía, densidad,
   contraste, consistencia de inputs, gráficos poco representativos, estados vacíos pobres), con la pantalla de cada uno.
   Esa lista guía las fases 04–12.
7. Commit: `test(visual): add the page capture inventory and record the visual baseline`.

## Hecho cuando
Gates en verde, capturas «antes» de todas las rutas, BASELINE.md con la auditoría, commit hecho, STATE actualizado.
