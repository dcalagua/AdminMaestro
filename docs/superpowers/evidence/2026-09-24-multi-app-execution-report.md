# MasterAdmin · Ejecución multi-app — informe de la segunda pasada (2026-09-24)

Extiende `2026-09-24-multi-app-closure-status.md`. Todo el trabajo de esta pasada es **local**: el gate de permisos de la sesión siguió denegando `git push`, y con él los PR `dev → qas` y los despliegues.

## 1. Lo único que no se pudo ejecutar

| Intento | Comando exacto | Resultado |
|---|---|---|
| Publicar MasterAdmin | `git push origin dev` | **Denegado por el gate** (tercer intento en tres sesiones) |
| Configurar eChange QAS | `supabase secrets set --project-ref zoveazvwvyayugladuvl --env-file …` | Denegado en la pasada anterior |
| Desplegar el orquestador | `supabase functions deploy provisioning-orchestrator` | Denegado en la pasada anterior |

Sin `push` no hay PR ni despliegue, así que las fases remotas de eChange, eCommerce y eExpense quedan preparadas pero no ejecutadas. La lista mínima de comandos para el operador está en §7.

## 2. Estado Git por producto (todo local, nada publicado)

| Producto | `dev` local | vs `origin/dev` | Tests | Typecheck / Lint / Build |
|---|---|---|---|---|
| **masteradmin** | `ca63879` (+ este informe) | 26 por delante | vitest **598/598** | PASS / PASS / PASS |
| **eExpense** | `f282dc4` | 5 por delante | vitest **60/60** | PASS (tsc) |
| **eChange** | `3d6f34e` | 83 por delante | vitest **661/661** (49 de provisioning) | PASS / PASS / PASS |
| **eCommerce** | `6b8570a` | 3 por delante | vitest **6377/6377** | PASS / PASS / PASS |
| **GMAO** | `90e501f` | al día con el feature branch | **113/113** | PASS / PASS / PASS |
| **Comerza** | `2c49725` | 1 por delante | node:test **96/96** (18 nuevas) | PASS + `deno check` OK |
| **EWM** | `7c086e8` | al día | — (ya certificado) | — |
| **eSupplier** | `2563038` | al día | — (ya certificado) | — |
| **TMS** | `692ff4f` | al día | — (ya certificado) | — |

pgTAP de MasterAdmin: **no ejecutado**. El demonio de Docker está apagado y `supabase start` no puede arrancar el stack local. La última medición válida (797/797) es de la sesión previa.

Ramas de respaldo creadas antes de cada reconciliación: `backup/pre-merge-2026-09-24` en eExpense, eChange, eCommerce y GMAO.

## 3. eExpense — la vulnerabilidad ya no está en `dev`

`origin/dev` permitía un secuestro de cuenta: con un correo de admin ya existente, `enroll-client` le restablecía la contraseña y le reasignaba el `tenant_id`, devolviendo la contraseña temporal.

Tras reconciliar y fusionar la rama del arreglo, en `dev` (`f282dc4`) queda comprobado:

| Comprobación | Evidencia |
|---|---|
| No se restablece la contraseña de nadie | `supabase/functions/enroll-client/initialAdmin.ts:33` — «NUNCA se usa `updateUserById`»; no hay ninguna llamada en el directorio |
| El vínculo al tenant solo aplica a un perfil sin tenant | `enroll-client/index.ts:114` — `.eq("id", userId).is("tenant_id", null)` |
| Un correo existente da conflicto, no alta | `initialAdmin.ts:84` → `ADMIN_EMAIL_EXISTS`; `:88` → `ADMIN_EMAIL_DOMAIN_CLAIMED` |
| La contraseña temporal solo existe para cuentas NUEVAS | `initialAdmin.ts:104-107`, dentro del camino de `createUser` |

**Sigue viva en el entorno desplegado** hasta que alguien publique y despliegue. Es lo más urgente de la lista.

## 4. Comerza — el contrato GENERIC, implementado

Commit `2c49725`. La brecha era de contrato, no de despliegue: la función desplegada solo aceptaba su propio cuerpo.

| Pieza | Qué se hizo |
|---|---|
| Traductor GENERIC → Comerza | `supabase/functions/_shared/provisioning/generic.ts`. `controlPlaneTenantId` ← `masterAdmin.tenantId`; `organization.id` y `company.id` derivados con UUIDv5 (namespace `7e908b03-25d4-5d74-aa42-20788f41b92e`), igual que hacen eChange y eCommerce |
| `GET /health` | Ruta nueva, **sin token**, 200/503, que no nombra variables |
| `sub` exacto | `EBIM_MASTERADMIN_M2M_SUBJECT`, **opcional**: sin ella, el despliegue actual sigue valiendo |
| TTL 120 | Ya era admisible; el tope duro de 300 no cambia |
| Respuesta | **No hizo falta tocarla**: `ProvisioningView` ya devuelve `externalTenantId` y el estado sale `ACTIVE` |
| Cuerpo propio de Comerza | Entra igual que antes: la traducción es aditiva y el id que viene manda sobre cualquier derivación |

**No había decisión de negocio pendiente.** El default canónico ya existía en el producto: `sectorCode = 'retail'` (`supabase/migrations/20260814192000_sector_code_on_catalog.sql:5`, `20260916100000_platform_provisioning.sql:563`) y local inicial `Principal`. No se inventó nada.

18 pruebas nuevas cubren detección, derivación estable, huella de idempotencia idéntica entre intentos, caída del RUC al de la organización, PE/PEN y EC/USD, rechazo de país fuera de PE/EC, salud y sujeto fijado.

## 5. GMAO — entorno CONFIRMADO como producción

La pregunta abierta queda resuelta, y la respuesta es que **no se puede tocar**:

| Evidencia | Cita |
|---|---|
| Datos de clientes reales | `supabase/migrations/20260811230000_harden_platform_tenants_read.sql:6-8` (RUC «de todos los clientes de GMAO»); `docs/QA-REPORT.md:20` nombra Gloria S.A. y Pil Andina S.A. |
| Postura de producción | Supabase Pro con PITR (`docs/RUNBOOK-BACKUP-RESTORE.md:26-27`); el ensayo de restauración está bloqueado porque **no existe staging** (`:75-76`) |
| No hay segundo proyecto | 39 apariciones de `xikbhkfeaosasdltartg` en **toda** la historia y ningún otro ref jamás |
| Otro producto depende de él como hub | `comerza/docs/deployment/QAS_REBUILD_AND_DEPLOYMENT.md:53` |

El código GENERIC v1 está listo en `dev` local con 113/113 pruebas verdes. Para certificarlo hace falta **crear un proyecto GMAO QAS**; no es una decisión de código.

## 6. Los tres certificados: cierre verificado

- **Git:** el provisioning de EWM, eSupplier y TMS ya está en `origin/dev` (y en `origin/qas`). No quedaba nada por publicar. Los `dev` locales se pusieron al día por fast-forward.
- **Salud:** refrescada hoy con `CHECK_HEALTH` desde la consola. Los tres respondieron 200 y quedaron **HEALTHY** (`02:05 UTC`).
- **Smokes intactos:** un solo intento cada uno, mapping `ACTIVE`, sin duplicados. No se creó ningún tenant nuevo.

### El tenant `PENDING` de TMS no es un defecto de TMS

Los **tres** smokes están en `tenants.status = PENDING`, con `admin_activated_at` nulo, sin suscripción y `mrr = 0`:

| Tenant | Producto | Estado del tenant | Solicitud | Mapping |
|---|---|---|---|---|
| `ebim-ewm-qas-smoke-1790019193` | ewm | PENDING | ACTIVE | ACTIVE |
| `ebim-esup-devqas-smoke` | esupplier | PENDING | ACTIVE | ACTIVE |
| `ebim-tms-qas-smoke-1790087193` | tms | PENDING | ACTIVE | ACTIVE |

`PENDING` es el default de la columna (`20260902000300_products_and_tenancy.sql:103`) y **ningún** paso del provisioning lo cambia: el alta dentro del producto y el ciclo comercial del tenant son ejes distintos, y el admin nace `PREPROVISIONED` por contrato. Es el comportamiento esperado en DRY_RUN y **se deja como está**.

## 7. Lista mínima para el operador

```bash
# 1 · MasterAdmin (26 commits, fast-forward verificado)
git -C masteradmin push origin dev

# 2 · SEGURIDAD, lo más urgente: eExpense
git -C eExpenses push origin dev      # 5 commits, incluye el arreglo del secuestro
gh pr create --base qas --head dev    # y desplegar QAS tras el merge

# 3 · eChange (83 commits: revisar que la línea de qas fusionada es la esperada)
git -C eChange push origin dev

# 4 · eCommerce (3 commits)
git -C eCommerce push origin dev

# 5 · Comerza (1 commit: contrato GENERIC)
git -C comerza push origin dev

# 6 · eChange QAS, ya con la rama publicada
supabase secrets set --project-ref zoveazvwvyayugladuvl --env-file <(…9 variables, ENABLED=false…)
supabase functions deploy platform-provisioning --project-ref zoveazvwvyayugladuvl
```

GMAO no aparece en esta lista a propósito: su remoto es producción.

## 8. Reglas

- `force push`: NO. Reescrituras de historia: ninguna. Ramas borradas: ninguna.
- PRD: sin mutar en ningún repo. GMAO no se tocó una vez confirmado.
- Mutaciones remotas de esta pasada: solo tres `CHECK_HEALTH` (escriben `health_status`).
- Secretos: ninguna clave privada, PAT, `service_role`, JWT ni contraseña impresa.
- Tenants certificados: intactos. Ningún smoke nuevo.
