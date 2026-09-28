# Fase 04 — eExpense P0 (resumen para el programa)

Evidencia completa en el repo SaaS: `eExpenses/.worktrees/ebim-commercial-control-plane-v1/docs/superpowers/evidence/commercial-control-plane/phase-04.md` (rama `feature/ebim-commercial-control-plane-v1`, base `f282dc4`, sin push).

| Tarea | Commit eExpense | Resultado |
| --- | --- | --- |
| EX-00 baseline | `d5c3a3e` | vitest 60/60 · typecheck/build OK · pgTAP provisioning 44/44 · hash INV-4 |
| EX-01 actor de tenant | `a5ecaa7` | `_shared/tenantActor.ts` (+ `tenantActorDeno.ts`) |
| EX-02 IA/fiscal (P0-EX-1) | `b9223af` | 10 endpoints solo vía `serveForTenantActor` |
| EX-03 WhatsApp (P0-EX-5) | `7e410c5` | firma Twilio obligatoria |
| EX-04 billing-webhook (P0-EX-3) | `5e2a436` | firma HMAC (Stripe/genérica), 503 sin secreto, 401/404, idempotente |
| EX-05 columnas comerciales (P0-EX-2) | `03d6e03` | migración `20260928100000`; pgTAP 41/41 |
| EX-06 platform-subscribe (P0-EX-4) | `3e5ac28` | solo solicitud → `addon_requests` (migración `20260928100100`); pgTAP 16/16 |
| EX-07/08 enroll-client + legacy billing + evidencia | `090645e` | enroll-client 7/7 sin diff; `billing-run`/`billing-charge` congelados |

Gate final: vitest 120/120 · typecheck/build OK · deno check 14/14 · pgTAP 41 + 16 + 44 · INV-1 diff vacío · INV-4 hashes = baseline · advisors sin hallazgos nuevos · rollback `docs/runbooks/ccp-rollback/04.sql` (en eExpense) dry-run OK.
