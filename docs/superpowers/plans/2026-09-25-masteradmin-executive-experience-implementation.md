# MasterAdmin — Experiencia ejecutiva y operación corporativa
## Plan nocturno de implementación local (persistido tal como lo aprobó el operador)

> Fuente: mensaje del operador del 2026-09-25 que aprueba la ejecución LOCAL.
> Este archivo reproduce el plan; no amplía ni reduce su alcance.
> Spec vinculante: `docs/superpowers/specs/2026-09-25-masteradmin-executive-experience-design.md`
> Auditoría: `docs/superpowers/specs/2026-09-24-masteradmin-audit-ux-negocio.md`
> Registro de aprobación: `docs/superpowers/evidence/2026-09-25-masteradmin-executive-experience-approval.md`
> Ledger: `docs/superpowers/evidence/2026-09-25-masteradmin-executive-experience-progress.md`

## Aprobación del operador

Apruebo ejecutar LOCALMENTE el plan descrito. La especificación de diseño v1.0 ya fue aprobada.

Método: implementación por tareas; TDD para cambios de comportamiento; subagentes/revisores
independientes cuando estén disponibles; un solo integrador para archivos compartidos; revisión
final de toda la rama.

**NO autoriza:** push, merge, PR, deploy, SQL remoto ni mutaciones QAS.

La corrida debe producir una candidata local verificable y el material para revisarla y
promoverla posteriormente.

## 1. Identidad del trabajo

- PROJECT_ROOT: `/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin`
- REFERENCE_ROOT: `PROJECT_ROOT/.overnight-executive-20260925` (spec-aprobada.md, auditoria.md)
- Producto: MasterAdmin / AdminMaestro EBIM.
- Objetivo: evolucionar la consola para dirección, finanzas, comerciales, partners y operaciones,
  sin reabrir el provisioning certificado. No es otra ronda de integración multi-app. No trabajar
  en otros repos EBIM.

## 2. Documentos vinculantes

spec-aprobada.md, auditoria.md, CLAUDE.md, docs/architecture/EBIM_CONVENTIONS.md,
docs/finance/COST_MARGIN_MODEL.md. La spec define D1–D3, E01–E20, P01–P32, K01–K06, G01–G06,
AC01–AC20; no reemplazarlas por una interpretación más amplia. Si el checkout cambió: registrar el
delta y ajustar paths. No repetir auditoría completa de los SaaS.

## 3. Límites no negociables

PROTEGIDO: `supabase/functions/_shared/provisioning/`; provisioning-orchestrator y su lógica;
contratos GENERIC y EWM_V1; claims y algoritmos M2M; private keys, secret_ref y guardia de
secretos; semántica de idempotencia; RPC de altas y mapping; registros certificados de tenants,
requests y mappings; reglas de precios, cadencias, comisiones y pagos; RLS y permisos existentes;
configuración de otros proyectos.

NO: tocar QAS o PRD; crear tenants remotos; replays remotos; CHECK_HEALTH al abrir pantallas;
activar administradores; enviar correos/WhatsApp/pagos; copiar credenciales QAS al entorno de
pruebas; leer el token del Keychain; modificar permisos del agente; force push, reset-hard o
limpieza destructiva; reescribir migraciones históricas; habilitar hooks administrativos de alto
riesgo solo porque existen.

Se permiten nuevas vistas/RPC de LECTURA aditivas y sus migraciones locales cuando sean
necesarias para la analítica. Una nueva lectura no debe ampliar el universo de datos autorizado.

## 4. Preparación y worktree — T01

1. Registrar pwd, git status, rama, HEAD, worktrees, log -15.
2. Identificar dev local y últimos refs.
3. Preservar archivos modificados y commits existentes; no mezclar cambios ajenos.
4. Worktree bajo `PROJECT_ROOT/.worktrees/`, rama `feat/masteradmin-executive-experience-<fecha-hora>`, base dev local.
5. No cambiar el checkout principal; reanudar si ya existe worktree de esta mejora.
6. Copiar la spec al path documental que indica; registrar aprobación en archivo separado.
7. Persistir este plan.
8. Crear ledger (tarea, estado, commit, prueba, evidencia, próximo paso).

No escribir un segundo plan que cambie el alcance y lo autoapruebe.

## 5. Entorno local y baseline

**T02 — Ejecución segura.** Inspeccionar package.json, lockfile, vite/playwright config,
supabase/config.toml, scripts. No upgrades mayores. Comprobar Node, npm, Supabase CLI, Docker,
navegadores Playwright; `--help` antes de fijar comandos. Sin herramientas globales. Runtime
Supabase LOCAL dedicado: project_id propio, puertos libres, sin reset de stacks ajenos, sin enlace
remoto, sin copiar .temp ni .env.local. Frontend preferente 127.0.0.1:5209. No matar procesos
ajenos. Revisar SQL/seed por jobs/triggers/llamadas externas antes de levantar DB. No workers
externos ni Edge Functions remotas. Tests de navegador bloquean hosts remotos. Sin Docker: avanzar
con UI/unitarios/fixtures y marcar SQL/pgTAP NOT_RUN.

**T03 — Baseline.** typecheck, lint, test, build, secrets:scan, SQL local, captura inicial.
Registrar código de salida, HEAD, fecha. Hashes de archivos protegidos, migraciones y pruebas
doradas/sensibles. No modificar tests para ocultar regresiones.

## 6. Contratos comunes — T04

`src/features/executive/`: `DataState<T>` (loading/ready/empty/partial/error/forbidden/unavailable);
no `error => [] => cero`. Separar período transaccional, fecha FX, snapshot, moneda nativa/reporte,
alcance. Documentar K01–K06. Tests: error de costos no produce margen completo; FX faltante no
produce cero; snapshot MRR no cambia por período pasado; cero real ≠ ausencia.

## 7. Sesiones y apariencia

**T05 — E11.** Regresión con dos identidades (A superadmin, B limitado) y respuesta tardía de A.
Corregir invalidación/cancelación y generaciones de sesión si se reproduce. No ampliar RLS. Refresco
de token de la misma identidad no vacía caché.

**T06 — Apariencia compartida.** Una fuente para modo y densidad; persistencia por usuario sin
datos financieros; migrar preferencias locales. No prometer sync entre dispositivos sin contrato.

## 8. Sistema visual

**T07 — Tokens/componentes.** DM Sans, isotipo, Phosphor, verde/teal. Densidades
40/52/12/14 · 36/44/9/12 · 32/38/6/10. `ebim-btn-secondary` en una sola definición. Estados y
contraste 4.5:1.

**T08 — Diálogos y tabs.** Focus trap, retorno de foco, Escape según guardado, busy sin doble
mutación, destructiva sin foco por defecto, flechas/Home/End, hashes intactos.

**T09 — Shell y navegación.** Grupos Inicio / Clientes y canales / Productos y contratos / Finanzas /
Operación SaaS / Gobierno. Rutas y guards intactos; breadcrumbs; sidebar plegable; menú móvil
accesible; entorno desde configuración.

## 9. Tablas y exportación

**T10** — Tabla paginada aditiva compatible (columnas tipadas, id estable, orden, página, total),
orden estable con desempate por id, scroll confinado.

**T11** — Exportación: PAGINA_ACTUAL vs TODOS_LOS_RESULTADOS_FILTRADOS, límite mostrado, CSV sin
fórmulas, sin columnas secretas; tests de conciliación y error intermedio.

## 10. Datos financieros completos

**T12** — `useFinanceConsolidated` con `p_period_start/p_period_end`; `asOf` sigue siendo fecha FX.

**T13** — Agregados de servidor + detalle paginado para invoices/costs/commissions. Objetos nuevos
solo lectura, aditivos, SECURITY INVOKER, con pruebas RLS. Fixtures >200/>200/>300, parciales,
revertidos, anulada, multimoneda, organización fuera de alcance.

**T14** — Cartera y series (cobros mensuales, MRR por producto, saldo, antigüedad
vigente/1-30/31-60/61-90/>90/sin fecha, margen, renovaciones) sin reconstruir históricos ni
multiplicar por joins.

## 11. Dashboard y gráficos

**T15** — Una biblioteca (preferente Recharts 3.x) verificada en peers/licencia, versión exacta.
`ChartPanel` común.

**T16** — Inicio: perspectivas Ejecutivo / Finanzas / Operación SaaS; seis KPI (MRR vigente, Cobrado
del período, Saldo por cobrar, Cartera vencida, Margen gerencial, Renovaciones próximas).

**T17** — Finanzas (antigüedad, cobrado/costo/comisión por producto, partner, cobertura FX) y
Operación (matriz del control plane, sin CHECK_HEALTH automático ni 8/8 hardcode).

## 12. 360

**T18** — Cliente/partner 360 por organización desde servidor, secciones con estado independiente.
**T19** — Tenant 360 con cuatro dimensiones; fixture PENDING + mapping ACTIVE + MRR 0 + PREPROVISIONED.
**T20** — Nueva venta: cinco pasos, continuidad sin PROVISION automático.

## 13. Normalización administrativa

**T21** Catálogo y relación comercial. **T22** Finanzas administrativas. **T23** SaaS, gobierno y acceso.
(Ver listas de páginas y restricciones en la spec y en el mensaje original.)

## 14–16. Evidencia, gates y entrega

**T24** — `docs/superpowers/evidence/executive-experience/page-matrix.md` P01–P32 con capturas y viewports.
**T25** — Gates: typecheck, lint, vitest, build, secret scan, e2e de la mejora, pgTAP local,
permisos de agregaciones, contrato dorado GENERIC, `supabase/tests/24_secret_key_rule.test.sql`.
Hashes de protegidos. Revisión independiente.
**T26** — Commits pequeños; entrega de HEAD, ledger, diccionario KPI, matriz, capturas, logs,
guía de demo, migraciones de lectura + rollback, pendientes, pasos dev → PR → qas (no ejecutados).

## 17–19. Forma de trabajo, cierre y reporte

Cada tarea: test → RED → implementación mínima → GREEN → revisión → commit → ledger. Un integrador
para archivos compartidos. Al compactar contexto: leer ledger y reanudar la primera tarea pendiente.
Ante denegación de permisos: registrar una vez, no rodearla.

Cierre: CANDIDATA_LOCAL_COMPLETA / CANDIDATA_PARCIAL / BLOQUEADO según §18 del mensaje. Reporte
final único con el formato de §19.
