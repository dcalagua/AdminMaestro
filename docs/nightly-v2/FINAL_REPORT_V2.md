# FINAL REPORT V2 — EBIM Control Plane

**Fecha:** 2026-09-07
**Branch:** `dev`
**Alcance:** fases 01-18 y auditoría independiente 98 de `.claude-prompts-v2`
**Veredicto:** **GO_WITH_GAPS** — funcionalmente completo salvo la activación de
Culqi en producción, que depende de credenciales que este proyecto no tiene.

> **Esto NO está «100 % listo».** Culqi opera en modo MOCK porque no hay
> credenciales. El PRD de cobro con tarjeta **no está validado**. Todo lo demás
> está implementado y verificado con evidencia reproducible.

---

## 1. Resumen de la ejecución

| | Baseline (2026-09-02) | V2 (2026-09-07) |
|---|---|---|
| Migraciones | 13 | **21** (13 intactas + 8 nuevas) |
| Tablas en `platform` | 39 | **48** |
| Vistas | 7 | **16** |
| Enums | 26 | **37** |
| Funciones | 42 | **96** |
| Tests de base de datos | 52 | **102** |
| Tests unitarios | 29 | **32** |
| Tests E2E | 21 | **39** |
| Escrituras desde la consola | **0** | 25 RPCs auditadas |

**Las 13 migraciones baseline no se tocaron.** Verificado por hash SHA-256
contra el commit `561053e`: los 13 archivos coinciden byte a byte.

---

## 2. Migraciones añadidas

| Archivo | Qué aporta |
|---|---|
| `20260907000100_admin_write_rpcs.sql` | 25 RPCs de escritura administrativa + `can_manage_commercial()` |
| `20260907000200_channel_agreements_v2.sql` | Límites del acuerdo de canal, guard de alcance, `v_partner_agreements` |
| `20260907000300_onboarding_rpc.sql` | `onboard_customer_subscription()`, `current_plan_price()`, suspensión/reanudación |
| `20260907000400_collection_profiles.sql` | Cuentas de proveedor y perfil de cobro por suscripción |
| `20260907000500_commercial_documents.sql` | OS/OC con máquina de estados y caducidad idempotente |
| `20260907000600_payment_provider_mappings.sql` | 5 tablas de mapeo + `register_provider_payment()` idempotente |
| `20260907000700_billing_alerts_and_renewals.sql` | Motor de alertas, `next_renewal_date()`, suspensión |
| `20260907000800_commissions_and_finance.sql` | Reverso por contra-evento y vistas de reconciliación |

---

## 3. Rutas de la consola

| Ruta | Estado |
|---|---|
| `/`, `/products`, `/products/:id`, `/plans`, `/feature-flags` | Lectura + escritura |
| `/organizations`, `/organizations/:id` (**Vista 360**), `/partners`, `/customers` | Lectura + escritura |
| `/onboarding` | **Nuevo** · wizard transaccional (solo EBIM) |
| `/tenants`, `/tenants/:id` | Lectura + escritura + suspender/reanudar |
| `/subscriptions`, `/subscriptions/:id` | **Detalle nuevo** con pestaña Cobranza |
| `/billing`, `/renewals`, `/reconciliation` | `/renewals` y `/reconciliation` son nuevas |
| `/sales-agents`, `/attributions`, `/commission-plans`, `/commissions` | Lectura + escritura |
| `/deployments`, `/provisioning` | Lectura + escritura + encolar/reintentar |
| `/costs`, `/audit`, `/settings` | Lectura |

---

## 4. Resultado de los gates (auditoría 98, ejecutada desde cero)

| Gate | Comando | Resultado |
|---|---|---|
| Migraciones baseline intactas | `sha256` vs `561053e` | ✅ 13/13 idénticas |
| Reconstrucción de la BD | `npm run db:reset` | ✅ PASS |
| Tests de base de datos | `npm run db:test` | ✅ **102/102 PASS** (5 archivos) |
| Drift de tipos | `npm run db:types` + `git diff` | ✅ sin drift |
| Escáner de secretos | `npm run secrets:scan` | ✅ PASS |
| Typecheck | `npm run typecheck` | ✅ PASS |
| Lint | `npm run lint` | ✅ PASS (0 warnings) |
| Unitarios | `npm run test` | ✅ **32/32 PASS** |
| Build | `npm run build` | ✅ 862,26 kB |
| E2E | `npx playwright test` | ✅ **39/39 PASS, 0 skips** |

### Verificaciones estructurales

| Comprobación | Resultado |
|---|---|
| Tablas sin RLS o sin FORCE | **0** de 48 |
| Tablas con RLS y sin política | **0** |
| GRANTs de `anon` sobre `platform` | **0** |
| `anon` con USAGE del schema | **false** |
| Vistas sin `security_invoker` | **0** de 16 |
| Funciones `SECURITY DEFINER` sin `search_path` | **0** |
| `commission_events` sin pago existente | **0** |
| `commission_events` con pago no CONFIRMED (sin contar reversos) | **0** |

---

## 5. Escenarios verificados en la base de datos

| Escenario | Evidencia |
|---|---|
| **3 deployment modes** | SHARED 9 tenants · PARTNER_DEDICATED 4 · TENANT_DEDICATED 2 |
| **5 collection methods** | Los 5 del enum, y los 5 en uso: MANUAL 3, CULQI_CARD 2, SERVICE_ORDER 2, BANK_TRANSFER 2, PURCHASE_ORDER 1 |
| **SHARED vía Partner** | `shared-esupplier-sa-east` aloja 5 tenants de 2 administradores distintos; consultora-andina administra 3 tenants SHARED sin infraestructura dedicada |
| **Un cliente, dos métodos** | GRUPASA: eSupplier `CULQI_CARD` mensual + EWM `SERVICE_ORDER` anual con lead de 45 días |
| **OS aprobada ≠ cobro** | Tras `approve_commercial_document`, `payments` y `commission_events` quedan **idénticos** |
| **Webhook idempotente** | 5 entregas del mismo evento → 1 `payment`, 1 `commission_event`, 1 fila en el ledger |
| **Cobro fallido** | `register_provider_payment_failure` → **0** `payments` |
| **Reverso** | Comisión de 85,00 → 2 filas, suma neta **0,00**, original intacto |
| **Implementación fuera del MRR** | Licencia 850 + fee 1500 ONE_TIME → **MRR = 850** |
| **DEMO sin recurrente** | `recurring: false`, suscripción ONE_TIME, MRR 0 |
| **Alta atómica** | Fallo de dominio operador a mitad del alta → **0 tenants huérfanos** |
| **Comercial ≠ acceso operativo** | Tras el onboarding con atribución: **0 `tenant_memberships`** |
| **Renovación determinista** | Mensual 2026-01-15 → 2026-09-15; en el aniversario exacto → ese mismo día |
| **Alertas idempotentes** | 27 → 0 → 0 con `p_as_of` fijo |
| **Suspensión configurable** | Con `auto_suspend`: applied 1 + SUSPEND_TENANT DRY_RUN. Sin él: skipped 1, tenant sigue ACTIVE |
| **Aislamiento dedicado** | `TARGET_PARTNER_AJENO`, `TARGET_DEDICADO_OCUPADO`, `MODO_NO_AUTORIZADO`, `LIMITE_TENANTS_ALCANZADO` |

---

## 6. Qué es real y qué es simulado

| Componente | Estado |
|---|---|
| Schema, RLS, RPCs, triggers, vistas | **REAL** · PostgreSQL local, reconstruible |
| Consola React con escritura | **REAL** · contra PostgREST con RLS |
| Motor de comisiones y reversos | **REAL** |
| Motor de renovaciones y suspensión | **REAL**, pero **no programado por cron** (decisión del operador) |
| OS/OC | **REAL** |
| Adapter de pago | **REAL** el código; **MOCK** la ejecución, por falta de credenciales |
| Cobro con tarjeta Culqi | **SIMULADO** · ids `mock_*`, sin una sola llamada de red |
| Webhook de Culqi | Código real; **nunca recibió un evento de Culqi** |
| Provisioning | **DRY_RUN** · no toca infraestructura remota |

---

## 7. Secretos pendientes de configurar

Ninguno está en el repositorio, y así debe seguir.

| Variable | Dónde va | Para qué |
|---|---|---|
| `CULQI_SECRET_KEY` | Supabase Edge Function secret | Llamadas server-side a Culqi |
| `CULQI_API_BASE` | Edge Function env | URL base de la API. **No se asumió**: sin ella, MOCK |
| `CULQI_ALLOW_LIVE` | Edge Function env | Interruptor deliberado para cobrar de verdad |
| `pk_test_…` / `pk_live_…` | Columna `public_key` de la cuenta | Tokenización en el navegador (es pública) |
| `SUPABASE_ACCESS_TOKEN` | Edge Function secret | Provisioning LIVE (blocker B-05 del baseline) |

---

## 8. Checklist para activar Culqi en producción

Detalle completo en `docs/payments/CULQI_ARCHITECTURE.md` §10. Resumen:

- [ ] Cuenta Culqi verificada por el operador.
- [ ] `pk_test_` en la cuenta `culqi-pe-test`.
- [ ] `CULQI_SECRET_KEY` como secret del servidor.
- [ ] Confirmar y fijar `CULQI_API_BASE` contra `apidocs.culqi.com`.
- [ ] Alta de tarjeta con las tarjetas de prueba.
- [ ] Cobro recurrente TEST y recepción del webhook.
- [ ] Reenviar el mismo webhook 5 veces → 1 pago, 1 comisión.
- [ ] Cobro fallido → alerta y **sin** pago.
- [ ] Devolución → contra-evento de comisión.
- [ ] `payment-reconcile` en OK sobre el periodo de pruebas.
- [ ] `secrets:scan` sigue en PASS con las credenciales cargadas.
- [ ] Restringir el webhook por IP si Culqi publica su rango.
- [ ] **Autorización escrita del operador** para pasar a `sk_live_`.

---

## 9. Bloqueos y hallazgos

### Bloqueos externos (genuinos)

| ID | Bloqueo | Estado |
|---|---|---|
| **BE-01** | `GUIDELINES_ROOT` no enumerable: el gate de permisos rechaza `ls`/`find` sobre esa ruta | Mitigado con el snapshot `docs/architecture/EBIM_CONVENTIONS.md`, como autoriza el propio prompt. **GUIDELINES_ROOT no fue modificado** — de hecho ni siquiera fue legible |
| **BE-02** | Sin credenciales Culqi | Adapter en MOCK determinista, declarado en la UI. PRD **no validado** |
| **B-05** (heredado) | Sin token de la Management API de Supabase | Provisioning sigue en DRY_RUN, como exige el contrato |

### Defectos encontrados y corregidos durante la ejecución

Ninguno se escondió como bloqueo externo: todos eran locales y todos se arreglaron.

| ID | Defecto | Corrección |
|---|---|---|
| **R-01** | `npm run build` FALLABA: `vite.config.ts` importaba `defineConfig` de `vite` pero declaraba la clave `test` de Vitest | Import desde `vitest/config` |
| **R-02** | `npm run typecheck` era un script inválido que tapaba su propio error con `\|\|`, dejando `tsconfig.node.json` sin comprobar nunca | Comprueba los dos proyectos; `build` lo exige |
| **R-03** | Ese typecheck roto había emitido **53 archivos `.js`** dentro de `src/` y junto a los configs de la raíz. Vite y Playwright resuelven `.js` ANTES que `.ts`, así que **el bundle y la configuración estaban congelados**. Se detectó porque tras añadir ~2.500 líneas el bundle seguía pesando exactamente lo mismo | Eliminados del disco y del índice; guardia en `.gitignore` con el porqué escrito al lado |
| **R-04** | La suite E2E corría contra **otra aplicación**: el puerto 5173 lo ocupa el dev server de otro proyecto de la máquina y `reuseExistingServer: true` lo daba por bueno | Puerto 5199 con `strictPort`, `reuseExistingServer: false` |
| **R-05** | `v_partner_agreements` nació sin `security_invoker`: habría sido un **bypass de RLS** | Detectado por el test 8 del baseline y corregido antes de continuar |
| **R-06** | Las FKs de `subscription_commercial_documents` a `auth.users` nacieron sin índice | Detectado por el test 12 del baseline; índices añadidos |
| **R-07** | `secrets:scan` daba PASS en falso: los archivos nuevos aún no estaban en `git ls-files` cuando se ejecutó | Detectado en la auditoría 98. Fixtures de test acortados para que el escáner siga siendo estricto |

> Vale la pena subrayar que **R-05, R-06 y R-07 los cazaron los propios tests y
> la auditoría**, no una revisión manual. Es exactamente para eso que existen.

---

## 10. Contraste con `99_DEFINITION_OF_DONE.md`

| Requisito | Estado | Evidencia | Siguiente acción |
|---|---|---|---|
| **Suite y comercial** | | | |
| Producto SaaS nuevo desde UI sin código | ✅ PASS | Sexto producto `efield` creado extremo a extremo solo con RPCs | — |
| Partner/Reseller desde UI | ✅ PASS | E2E J1 | — |
| Acuerdos distintos por SaaS | ✅ PASS | Andina: esupplier 25 %, ewm 18 %, efield 30 % | — |
| Partner Shared con múltiples tenants | ✅ PASS | 3 tenants SHARED sin infra dedicada; target compartido con 2 administradores | — |
| Partner Dedicated: base + N + infra | ✅ PASS | `is_partner_base`, seed y E2E J5 | — |
| Tenant Dedicated: enterprise + infra + impl + soporte | ✅ PASS | Omega; `SUPPORT_FEE` soportado | — |
| Comercial independiente sin acceso operativo | ✅ PASS | 0 `tenant_memberships`; tests 03 §17-21 y E2E J10 | — |
| **Tenants/licencias** | | | |
| Alta transaccional tenant+subscription+items | ✅ PASS | `onboard_customer_subscription`; fallo → 0 huérfanos | — |
| Implementation fee one-time sin inflar MRR | ✅ PASS | MRR 850 con fee 1500 | — |
| Demo sin recurrente | ✅ PASS | `recurring: false` | — |
| Suspender/activar auditable | ✅ PASS | Motivo obligatorio + `audit_logs` | — |
| **Cobranza** | | | |
| Collection profile por subscription | ✅ PASS | 10 perfiles en el seed | — |
| Los 5 métodos | ✅ PASS | Los 5 en uso | — |
| Cliente con dos SaaS y dos métodos | ✅ PASS | GRUPASA | — |
| OS/OC con ciclo completo | ✅ PASS | 3 estados en el seed; E2E J8 | — |
| OS/OC aprobada ≠ pago | ✅ PASS | Contadores idénticos | — |
| Renovación/anticipación/gracia/suspensión | ✅ PASS | Motor determinista e idempotente | Activar cron cuando el operador lo autorice |
| **Culqi** | | | |
| Provider adapter desacoplado | ✅ PASS | `_shared/payments/` con interfaz + 2 implementaciones | — |
| Secret nunca en React/DB/Git | ✅ PASS | CHECKs + `secrets:scan` | — |
| Customer/Card/Plan/Subscription mapeables | ✅ PASS | 4 tablas de mapeo | — |
| Webhook idempotente | ✅ PASS | 5 entregas → 1 pago | Verificar contra Culqi real |
| Reconciliación disponible | ✅ PASS | `payment-reconcile` + `/reconciliation` | Ejecutar contra Culqi TEST |
| Sin credenciales, MOCK explícito | ✅ PASS | UI dice «Culqi pendiente de configurar» | — |
| **PRD no validado sin credenciales** | ⛔ **BLOCKED_EXTERNAL** | No hay credenciales Culqi | Checklist §8 |
| **Finanzas/comisiones** | | | |
| Payment confirmed es la fuente | ✅ PASS | 0 comisiones sin pago confirmado | — |
| Implementation commission según regla | ✅ PASS | `COLLECTED_IMPLEMENTATION` | — |
| Reversals sin borrar historia | ✅ PASS | Contra-evento; neto 0, original intacto | — |
| Dashboard separa monedas | ✅ PASS | Todas las vistas agrupan por `currency` | FX consolidado fuera de alcance V2 |
| MRR/cobrado/costos/comisión/margen por producto-partner-tenant | ✅ PASS | `v_product_finance`, `v_partner_finance`, `v_tenant_margin` | — |
| **Seguridad/calidad** | | | |
| Tablas nuevas RLS + FORCE | ✅ PASS | 0 de 48 sin RLS/FORCE | — |
| `anon` sin acceso de negocio | ✅ PASS | 0 grants, sin USAGE | — |
| Negative tests cross-partner/cross-tenant | ✅ PASS | 03 y 04 | — |
| Sin fuga de secretos | ✅ PASS | `secrets:scan` PASS | — |
| DB reset PASS | ✅ PASS | | — |
| DB tests PASS | ✅ PASS | 102/102 | — |
| typecheck PASS | ✅ PASS | | — |
| lint PASS | ✅ PASS | | — |
| unit PASS | ✅ PASS | 32/32 | — |
| build PASS | ✅ PASS | | Code-splitting pendiente (862 kB) |
| E2E crítico PASS sin skips | ✅ PASS | 39/39, 0 skips | — |
| **Handoff** | | | |
| Documentación V2 actualizada | ✅ PASS | 12 documentos | — |
| `FINAL_REPORT_V2.md` con evidencia | ✅ PASS | Este documento | — |
| Gaps externos marcados | ✅ PASS | §9 | — |

**Resultado: 37 PASS · 1 BLOCKED_EXTERNAL · 0 FAIL · 0 PARTIAL.**

---

## 11. Gaps reales y recomendación

| # | Gap | Impacto | Recomendación |
|---|---|---|---|
| 1 | **Culqi sin credenciales** | El cobro con tarjeta no está probado contra el proveedor real | Ejecutar el checklist §8 en TEST antes de cualquier promesa comercial |
| 2 | **Cron no programado** | Las alertas y suspensiones se recalculan a mano | Activar `pg_cron` con el SQL ya documentado, cuando el operador lo autorice |
| 3 | **Sin FX** | No hay total consolidado multi-moneda | Tabla de tipos de cambio con fecha y fuente. Hoy se agrupa por moneda, que es lo correcto sin FX auditable |
| 4 | **Bundle de 862 kB** | Primera carga lenta | `React.lazy` por ruta. No bloquea nada |
| 5 | **MRR sin histórico** | No se puede reconstruir el MRR de un mes pasado | Tabla de snapshots mensuales (riesgo R-03 del baseline, sigue abierto) |
| 6 | **Webhook sin firma** | Limitación **del proveedor**, no del diseño | Restringir por IP en PRD; ya hay idempotencia + verificación server-to-server |
| 7 | **Divergencia del schema `platform`** | Este schema también existe en el proyecto de GMAO | Decisión de arquitectura de suite pendiente (riesgo R-01 del baseline) |

### Recomendación

El Control Plane está listo para **operar comercialmente** y para demostrarse a
gerencia con datos reales. Lo único que falta para cerrar el círculo del dinero
es el paso 1: credenciales Culqi y una ronda de pruebas en TEST.

El orden sugerido es: (1) Culqi TEST, (2) activar el cron de cobranza, (3)
decidir la arquitectura de suite del schema `platform` con GMAO.
