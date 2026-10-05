# Quality gate — V4 visual (ejecutar en el WORKTREE)

## Gate rápido (toda fase que toque código, antes de cada commit relevante)
```bash
npm run typecheck
npm run lint
npx vitest run
```

## Gate completo (al cerrar cada fase)
```bash
npm run typecheck && npm run lint && npx vitest run && npm run build && npm run secrets:scan
```

## Gate de base de datos (fases que crean migraciones: 02 si toca SQL de demo, 08, 13, 15, 16)
```bash
supabase db reset --local      # fuera del sandbox
supabase test db               # TODOS los pgTAP en verde
npm run db:types && npx prettier --write src/types/database.types.ts
```
Después de `db reset` hay que **recargar los datos de demostración**: `bash scripts/demo/load-demo-data.sh` (fase 02 en adelante).

## Gate visual (fases 01, 09 en adelante y 15)
```bash
VISUAL_LABEL=<antes|despues|faseNN> npx playwright test e2e/visual/capturas.spec.ts
```
Las capturas quedan en `docs/superpowers/evidence/visual-gerencia/capturas/<label>/`. Revisa visualmente (Read de las PNG)
al menos el dashboard y 3 pantallas tocadas por la fase.

## Criterios de aceptación visual (se revisan mirando las capturas)
- Ninguna pantalla con texto cortado, solapado o desbordado horizontalmente a 1440×900 y a 1280×800.
- KPIs y gráficos legibles a 3 metros (proyector): valores ≥ 28px, ejes ≥ 12px, sin más de 6 colores por gráfico.
- Contraste AA en texto (≥ 4.5:1) en claro y oscuro.
- Estados vacío / carga (skeleton) / error presentes en las pantallas tocadas.
- Nada de hex sueltos en componentes (`rg "#[0-9a-fA-F]{6}" src --glob '!*.test.*' --glob '!tokens.css'` sin nuevos hallazgos).

## Prohibido marcar DONE si
- algún gate falla;
- hay tests desactivados (`.skip`, `.only`) nuevos;
- hay cambios sin commitear.
