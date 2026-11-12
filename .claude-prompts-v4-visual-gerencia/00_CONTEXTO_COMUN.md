# CONTEXTO COMÚN — MasterAdmin V4 visual para Gerencia (corrida nocturna autónoma)

Eres Claude ejecutando UNA fase de una corrida nocturna sin supervisión humana. Nadie responderá preguntas:
decide tú dentro de las reglas, registra la decisión y sigue. Trabaja hasta dejar la fase terminada y verificada.

## Rutas
- PROJECT_ROOT (checkout principal, NO lo modifiques): `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
- **WORKTREE (único lugar donde escribes código):** `PROJECT_ROOT/.worktrees/visual-gerencia` — rama `feature/masteradmin-visual-gerencia`.
- PACK (estado y decisiones): `PROJECT_ROOT/.claude-prompts-v4-visual-gerencia` — aquí solo escribes `STATE.md` y `DECISIONS.md` (sección «Decisiones de la noche»).
- EVIDENCIA: `WORKTREE/docs/superpowers/evidence/visual-gerencia/` (capturas en `capturas/antes/` y `capturas/despues/`).
- GUIDELINES_ROOT (Google Drive EBIM-Plataforma): solo lectura, nunca modificar.

## Antes de empezar la fase
1. Lee `PACK/STATE.md`, `PACK/DECISIONS.md`, `PACK/QUALITY_GATE.md` y, si existe, `WORKTREE/docs/design/VISUAL_SYSTEM_V2.md`.
2. Lee `WORKTREE/CLAUDE.md` y `WORKTREE/docs/architecture/EBIM_CONVENTIONS.md`.
3. `git -C WORKTREE status` debe estar limpio. Si hay cambios sin commitear de una fase anterior interrumpida,
   revísalos: si son coherentes y pasan gates, commitéalos con un mensaje que lo diga; si no, descártalos
   archivo por archivo con `git checkout -- <archivo>` (nunca `reset --hard` ni `clean`).

## Límites no negociables
- **Nada remoto:** no `git push`, no `gh`, no `supabase link`, no `--linked`, no `db push`, no `functions deploy`,
  no `secrets set`, no `supabase-cli-ebim`. No tocar AdminMaestro en la nube, QAS ni PRD.
- Supabase **solo local**: proyecto `ebim-control-plane` (API 54421, DB 54422). Puedes `supabase db reset --local`,
  `supabase test db`, `npm run db:types`. No toques otros contenedores Docker de la máquina (otros proyectos).
  Los comandos Docker/Supabase pueden requerir salir del sandbox (`dangerouslyDisableSandbox: true`); úsalo solo para ellos.
- No leas `.env`, `.env.local` ni `.env.qas.local`. El worktree usa `.env.development.local` (local), ya creado por el runner.
- **No instales dependencias npm nuevas.** Todo con React 19, Tailwind, Recharts 3, Phosphor icons y CSS. Fuentes solo vía Google Fonts (ya se usa DM Sans).
- No debilites RLS, grants, guards de secretos ni tests de seguridad. RLS es la autoridad; la UI es UX.
- Nunca números falsos hardcodeados en componentes: los datos de demostración viven **solo** en el seed de demo local (fase 02).
- Culqi solo MOCK/TEST. Nada LIVE.

## Convenciones EBIM que mandan sobre el gusto (resumen; detalle en EBIM_CONVENTIONS.md)
- Marca: verde `#5AA97F` (accent, para rellenos), teal `#056769` (accent-deep, para TEXTO sobre claro), isotipo `#0A5A52`. Tipografía **DM Sans**.
- U-04 anatomía de login; U-06 listados con **un buscador único + pestañas de estado** (prohibidos paneles de filtros multi-campo);
  U-07 detalle con `SectionTabs` y `#hash`; U-08 el usuario solo elige modo claro/oscuro y densidad (no el color);
  U-09 tokens de densidad; U-10 contraste AA; U-11 topbar neutro o gradiente de marca; U-13 todo en español; U-14 estados vacío/carga/error/éxito.
- Colores siempre por variables CSS de `src/app/tokens.css` (nunca hex sueltos en componentes).

## Forma de trabajo
- Cambios pequeños y verificables; commits lógicos en inglés convencional (`feat(ui): …`, `style(ui): …`, `feat(executive): …`),
  cada uno terminado en la línea: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Si cambias textos o estructura que los tests verifican, actualiza los tests con criterio (el test debe seguir probando el comportamiento, no solo pasar).
- Para cualquier gráfico, tablero, KPI o paleta de datos: **carga primero el skill `dataviz`** y síguelo.
- Usa subagentes solo si la fase lo justifica; nunca dos procesos haciendo `db reset` a la vez.

## Al terminar la fase
1. Corre los gates de `QUALITY_GATE.md` que apliquen y anota los resultados con números.
2. Actualiza `PACK/STATE.md`: cambia la línea de tu fase a `NN_NOMBRE: DONE — <resumen de una línea> — commits <hashes>`;
   si no pudiste terminar, `NN_NOMBRE: BLOCKED — <motivo concreto y qué falta>`. Agrega notas útiles para la fase siguiente en «Notas».
3. Registra en `PACK/DECISIONS.md` (sección «Decisiones de la noche») cualquier decisión no trivial que hayas tomado.
4. Termina tu respuesta con la línea exacta `FASE_RESULTADO=DONE` o `FASE_RESULTADO=BLOCKED`.
