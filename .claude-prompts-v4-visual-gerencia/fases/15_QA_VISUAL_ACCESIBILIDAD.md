# FASE 15 — QA visual, accesibilidad y regresión completa

## Pasos
1. `supabase db reset --local` → `bash scripts/demo/load-demo-data.sh` → `supabase test db` (todo verde).
2. Gate completo de `QUALITY_GATE.md`.
3. `VISUAL_LABEL=despues npx playwright test e2e/visual/capturas.spec.ts` (mismas rutas que «antes»).
4. Revisión mirando las PNG (Read) de TODAS las rutas: texto cortado/solapado, desbordes, alineaciones, consistencia de encabezados,
   inputs y tablas, estados vacíos. Corrige lo encontrado y repite capturas de lo corregido.
5. Contraste: calcula pares texto/fondo de tokens claro y oscuro (script node pequeño) y corrige lo que no llegue a AA.
6. Teclado: foco visible en shell, ⌘K, diálogos (trampa de foco), tabs; `prefers-reduced-motion` desactiva animaciones.
7. Responsive: dashboard, login y `/pagar` a 390, 768, 1280 y 1440.
8. Suite e2e existente (`npx playwright test` sin `VISUAL_LABEL`): si alguna prueba falla por cambios de texto/estructura legítimos,
   actualízala; si falla por regresión, arréglala.
9. `rg` de hex sueltos (ver QUALITY_GATE) sin hallazgos nuevos.
10. Commits `fix(ui): …` y `test(visual): record the after captures`.

## Hecho cuando
Todo verde (pgTAP, vitest, build, secrets, e2e), capturas «después» completas y revisadas, AA confirmado, STATE con números.
