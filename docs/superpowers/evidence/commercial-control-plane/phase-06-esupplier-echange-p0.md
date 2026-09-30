# Fase 06 — eSupplier + eChange P0 (resumen)

Solo LOCAL. Sin push, sin QAS, nada contra proyectos remotos. Evidencia completa en cada repo SaaS:
- eSupplier: `eSupplier/.worktrees/ebim-commercial-control-plane-v1/docs/superpowers/evidence/commercial-control-plane/phase-06-esupplier.md`
- eChange: `eChange/.worktrees/ebim-commercial-control-plane-v1/docs/superpowers/evidence/commercial-control-plane/phase-06-echange.md`

## eSupplier (base `a61dd22`, rama `feature/ebim-commercial-control-plane-v1`)

| Tarea | Commit | Resultado |
| --- | --- | --- |
| SU-00 | `e26e1ff` | baseline (lint NOT_EXECUTED preexistente; `db reset` local bloqueado por la cadena) |
| SU-03 | `1a60fab` | `tenant_commercial_addons` (fuente local, service_role) + backfill P-08 + gate `requireCapability` en 11 funciones IA de pago + `upsert_agent_config_rpc` solo dentro de lo concedido |
| SU-01 | `a52822c` | `platform-catalog` autenticado; `subscribe`/`set_addon` → solicitud `REQUESTED`, el hub no las recibe |
| SU-02 | `65f2df5` | `platform-context` ligado a la organización de la sesión; guarda la foto `HUB` de add-ons |
| SU-04 | `5f8274d` | UI fail-closed: hub → concesión server-side → cerrado |
| SU-05/06 | `32f9792` | sin escritura directa en `tenants`/`plans`; lista cerrada de DEFINER con anon; límites solo caracterizados (D-05) |
| SU-07 | `e942be5` | evidencia |

Gate: vitest 1099/1099 · security 500/500 · type ratchet 625=625 · build OK · security:gates 17/17 ·
SQL CCP 47/47 (captura de tests en `supabase/postgres` desechable) · INV-1 diff vacío (provisioning 107/107) ·
INV-4 hash `plans` igual · rollback dry-run idéntico.

## eChange (base `3d6f34e`, rama `feature/ebim-commercial-control-plane-v1`)

| Tarea | Commit | Resultado |
| --- | --- | --- |
| EC-00 | `3a45f26` | baseline |
| EC-01 | `dd160de` | `consumo_de_horas_de`, `satisfaccion_resumen_de`, `executive_summary_de`: EXECUTE solo service_role (era PUBLIC: lectura cross-tenant de horas/coste/margen) |
| EC-02 | `f872841` | `ai_agents.commercially_entitled` (P-07 = `enabled`) + guarda por claims: el owner apaga siempre, enciende un add-on solo si está concedido; columnas comerciales inmutables para el tenant |
| EC-03 | `a152c9b` | lo mismo para `channels`; revoca INSERT/DELETE/TRUNCATE; WhatsApp/teléfono insertados como `incluido` se clasifican `addon` (regla de `20260813040000`) |
| EC-04 | `4d582bd` | evidencia |
| EC-05 | `ad3133b` | verificación en stack Supabase local real |

Gate: web 661/661 · build OK · stack local real con la cadena completa (241 migraciones): CCP 27+24+29,
`platform_provisioning_test` 31/31, `rls_aislamiento_tenant_test` 45/45; 10 fallas preexistentes idénticas en la
base · INV-1 diff vacío · INV-4 sin cambios (fixture con precios, harness PGlite) · pricing local
(`service_rates`, `billing_plans`, `channel_billing_events`) intacto para el dual-read de la fase 14.

## Decisiones para el humano

- **P-08 (eSupplier)**: todo tenant existente recibe los 10 add-ons de pago como `LEGACY_BACKFILL` (cero cambio
  de comportamiento); los tenants nuevos nacen sin concesiones. Mismo criterio que P-07.
- **eChange**: los tenants nuevos ya no pueden encender WhatsApp/teléfono sin concesión de EBIM (antes nacían
  `incluido` por omisión del alta). Tenants aprovisionados desde 20260918 con esos canales en `incluido` no se
  reclasifican: revisión del operador.
