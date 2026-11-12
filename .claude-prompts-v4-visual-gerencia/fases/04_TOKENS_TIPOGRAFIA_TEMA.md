# FASE 04 — Tokens, tipografía y tema

## Objetivo
Llevar `VISUAL_SYSTEM_V2.md` §2–4 y §7 al código base para que toda la app cambie de nivel sin tocar pantalla por pantalla.

## Alcance
- `src/app/tokens.css`: tokens v2 claro/oscuro (superficies en capas, texto, bordes hairline, marca, semánticos con `soft`,
  foco, sombras de 2–3 niveles, gradientes de sidebar/hero, paleta de datos `--chart-1..n` y secuenciales). Mantén los nombres
  existentes que usa el código (renombrar rompe todo); agrega los nuevos. `tokens.test.ts` debe seguir verde (actualízalo si verifica valores).
- `src/app/index.css`: import de DM Sans con los pesos/opsz necesarios; clases base `.ebim-*` (input, label, botones, card, tabla)
  con la nueva anatomía; utilidades tipográficas (`.text-display`, `.text-kpi`, `.text-micro`…) y `tabular-nums` global para números.
- `tailwind.config.ts`: exponer escala tipográfica, sombras, radios y colores de gráfico como clases.
- Densidad (U-09) y modo oscuro (U-08) siguen funcionando; el usuario NO puede elegir color.
- Respeta `prefers-reduced-motion`.

## Pasos
1. Implementa tokens y clases base. 2. Recorre la app con capturas rápidas (`VISUAL_LABEL=fase04`) y corrige regresiones
   evidentes (texto ilegible, contraste, bordes desaparecidos). 3. Verifica AA de pares texto/fondo clave (calcula y anota).
4. Gate completo. 5. Commits: `style(theme): …` (pueden ser 2–3).

## Hecho cuando
Gates verdes, la app entera ya refleja la nueva tipografía y superficies, sin regresiones visibles, contraste AA anotado.
