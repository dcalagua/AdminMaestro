# Fase 05 — GMAO P0 (resumen para el programa)

Evidencia completa en el repo SaaS: `GMAO/.worktrees/ebim-commercial-control-plane-v1/docs/superpowers/evidence/commercial-control-plane/phase-05.md` (rama `feature/ebim-commercial-control-plane-v1`, base `90e501f`, sin push). Nada aplicado en `xikbhkfeaosasdltartg`.

| Tarea | Commit GMAO | Resultado |
| --- | --- | --- |
| GM-00 baseline | `0d75d79` | SQL 61/61 · provisioning 20/20 · deno 32/32 · web tsc |
| GM-01 `ai_consume` | `4f9c62a` | `CANTIDAD_INVALIDA` (NULL/<1/>10000), `FEATURE_INVALIDA`, sin anon. RED: un negativo subía `remaining` 20 → 1020 |
| GM-02 plan IA | `4f9c62a` | `ai_assist` solo lectura para el tenant (`COMMERCIAL_ENTITLEMENT_READONLY`); `platform.ccp_set_ai_entitlement` (service_role, auditado); `AiPlanPage` solo lectura |
| GM-03 reset de uso | `4f9c62a` | `reset_ai_usage` sin EXECUTE cliente; `platform.ccp_reset_ai_usage` (service_role, un periodo, motivo, auditado) |
| GM-04 `translate` (P0-GM-2) | `5eeaaca` | usuario verificado por GoTrue + tenant; Anthropic 0 llamadas en rechazos |
| GM-05 alta de tenant (P0-GM-3) | `39e5889` | aserción `has_function_privilege` anon/authenticated = false |
| GM-06 secretos | `4f9c62a` | 7 columnas secretas sin SELECT cliente; guardia `CCP_SECRET_INVOKER_DEPENDENCY` |
| GM-07 `charge` | `68b0d0d` | moneda caracterizada (KNOWN_DEFECT P-06, sin cambio de semántica); solo owner/admin |
| GM-08 hub + evidencia | `39e5889` | hub vivo (3/3 con los `index.ts` reales); rollback `docs/runbooks/ccp-rollback/05.sql` (en GMAO) dry-run OK |

Gate final: SQL 61/61 · provisioning 20/20 (sin editar) · CCP 40/40 · deno 32 + 8 + 10 + 3 · deno check/lint OK · web tsc/build OK · INV-1 diff vacío · INV-4 sin referencias a precios · secret scan PASS.
