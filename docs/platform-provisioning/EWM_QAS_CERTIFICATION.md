# EWM V1 · Acta de certificación QAS

**Proyecto QAS MasterAdmin:** `jivgwrczgdpsuvqcwqku` («AdminMaestro»). **PRD:** no se toca.
**EWM QAS:** `https://ewm-rsxs.onrender.com` (contrato `WMS-by-EBIM@origin/qas` `7e45d70`).
**Rama:** `feat/ewm-adapter`. **Plan:** `docs/superpowers/plans/2026-09-21-ewm-masteradmin-adapter-implementation.md`.

## 1. Estado

| Paso | Estado | Evidencia |
| --- | --- | --- |
| Gate local (Task 13) | PASS | pgTAP 797/797 · vitest 598/598 · E2E local 63 + dorada 2 · typecheck, lint, build, `secrets:scan` · advisors locales: 0 hallazgos nuevos |
| Huella de la clave (H5) | PASS | P-256 SEC1; pública derivada = `masteradmin-public.pem` (`6fac1a327f7e5813…`) |
| Formato PKCS#8 de una línea (H15, local) | PASS | Importa con WebCrypto; misma huella `6fac1a327f7e5813…` |
| Secret `EWM_QAS_M2M_PRIVATE_KEY` (Task 14) | **PENDIENTE (operador)** | El harness del agente denegó `supabase secrets set` |
| Migración `20260921000100` (Task 15) | **PENDIENTE (operador)** | `migration list --linked`: es la única pendiente. El harness denegó `db push` (también `--dry-run`) |
| Despliegue `provisioning-orchestrator` (Task 16) | **PENDIENTE (operador)** | El harness denegó `functions deploy`. La versión actual (v2) ya sirve el CORS de `a25e4a7`: `OPTIONS` → `204`, `access-control-allow-origin: http://127.0.0.1:5199`; `POST` sin sesión → `401` |
| Configuración EWM (Task 17) | **PENDIENTE** | Depende de la columna `adapter_key` (Task 15). Registros existentes en QAS, sin duplicar: `ewm-provisioning-v1`, `ewm-qas-m2m`, `ewm-shared-qas` |
| Pre-activación y habilitación (Task 18) | PENDIENTE | — |
| Create / Replay / Get (Tasks 19–22) | Siguiente prompt | — |

## 2. Runbook del operador (en este orden)

Guardia previa, en el worktree: `[ "$(cat supabase/.temp/project-ref)" = "jivgwrczgdpsuvqcwqku" ] || echo STOP`.

1. **Secret** (ver [M2M.md §5](./M2M.md)):
   ```bash
   supabase secrets set --project-ref jivgwrczgdpsuvqcwqku \
     --env-file <(printf 'EWM_QAS_M2M_PRIVATE_KEY="%s"\n' \
       "$(openssl pkcs8 -topk8 -nocrypt -in "$HOME/.ebim-keys/masteradmin/ewm/qas/private.pem" | tr -d '\n')")
   ```
2. **Migración:** `supabase db push --linked --dry-run` (debe listar sólo `20260921000100`) y después `supabase db push --linked`.
3. **Función:** `supabase functions deploy provisioning-orchestrator --project-ref jivgwrczgdpsuvqcwqku` (sin `--no-verify-jwt`, sin `--prune`).
4. **Configuración** (consola local apuntando a QAS, o RPC como super admin), manteniendo DRAFT/deshabilitado:
   - `ewm-provisioning-v1`: contrato «EWM v1» (`p_adapter_key 'EWM_V1'`), `status_path_template = /internal/platform/v1/tenants/{controlPlaneTenantId}`; el resto ya está en QAS (ES256, TTL 300, `masteradmin.ebim`/`ewm.ebim`, `ewm:tenant:create`/`ewm:tenant:read`, `/internal/platform/v1/tenants`, `/actuator/health`, `allowed_hosts ['ewm-rsxs.onrender.com']`).
   - `ewm-qas-m2m`: `secret_ref EWM_QAS_M2M_PRIVATE_KEY`, ES256 (ya en QAS), deshabilitado hasta los prechecks.
   - `ewm-shared-qas`: `base_url https://ewm-rsxs.onrender.com` (ya en QAS), `timeout 30000`, `retry 2`, DRAFT.
5. **Verificación:** `OPTIONS` 204 con CORS, `POST` sin sesión 401, advisors `--linked --type security` comparados con la línea base (104 hallazgos antes de la migración).

## 3. Rollback

Ver «Rollback QAS» del plan (RB1–RB5). Ningún paso de esta sesión cambió QAS.
