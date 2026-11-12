# Runbook — ingest de uso y créditos IA (fase 17)

Contrato: `contracts/usage/v1/README.md` (FIX-USG-v1). Spec §11–§12. Rollback: `docs/runbooks/ccp-rollback/17.sql`.

**Estado por defecto en cualquier entorno: APAGADO.** Encenderlo requiere (1) la aprobación de **D-12** (credencial por producto + validación de mapping), (2) GATE C para QAS, y nunca PRD dentro de este programa. Todos los pasos remotos los ejecuta el operador; el agente no hace `link`/`push`/`deploy`/`secrets set`.

## 1. Piezas

| Pieza | Dónde | Interruptor |
| --- | --- | --- |
| Edge Function `usage-ingest` (`verify_jwt = false`: verifica el JWT ES256 del SaaS) | `supabase/functions/usage-ingest` | env `USAGE_INGEST_ENABLED=true` (global) |
| Kill-switch por producto | `product_integrations.usage_ingest_enabled` | RPC `set_usage_ingest_enabled(product, bool, motivo)` |
| Credencial del SaaS (clave **pública** por referencia) | `usage_ingest_credentials` | RPC `configure_usage_ingest_credential(product, env, issuer, public_key_ref, enabled, kid?, audience?)` |
| Medidores | `usage_meters` (nacen `is_billable=false`) | RPC `upsert_usage_meter(…)`; facturable solo por finanzas: `set_usage_meter_billable` (D-06) |
| Cierre de período | `close_usage_periods(p_now)` → CLOSING tras `grace_hours` | job de servidor |
| Finalización | `finalize_due_usage_aggregates(limit)` (job) o `finalize_usage_aggregate(id)` (finanzas) | — |
| Créditos incluidos | `open_ai_credit_period(tenant, período)` | requiere política (D-03) |
| Pesos / políticas | `set_ai_credit_weight`, `create_ai_credit_policy` (finanzas) | **no se siembran** (D-02/D-03/D-04) |

## 2. Alta de un producto (por entorno, tras D-12)

1. **SaaS**: generar un par ES256 (P-256) propio del producto × entorno. La privada (PKCS#8 PEM) va SOLO a los secretos del SaaS con el nombre acordado (`<PRODUCT>_USAGE_PRIVATE_KEY`); nunca a git ni a MasterAdmin.
2. **MasterAdmin**: publicar la **pública** (JWK EC P-256 o PEM SPKI) como secreto de la Edge Function con nombre `<PRODUCT>_<ENV>_USAGE_PUBLIC_JWK` (la función solo resuelve nombres que terminan en `_PUBLIC_JWK`/`_PUBLIC_KEY`).
3. Registrar la credencial (product admin): `select platform.configure_usage_ingest_credential('<product>', '<ENV>', '<product>.ebim', '<PRODUCT>_<ENV>_USAGE_PUBLIC_JWK', true);`
4. Registrar los medidores de `contracts/usage/v1/meters.json` (product admin), `status = 'ACTIVE'`, ligando `p_capability_code` a la AI_FEATURE cuando aplique. No registrar `DAILY_SNAPSHOT` sin aprobación de la dimensión.
5. Encender: `USAGE_INGEST_ENABLED=true` en la función y `select platform.set_usage_ingest_enabled('<product>', true, '<motivo + ref. D-12>');`
6. **SaaS**: `MASTERADMIN_USAGE_INGEST_URL=https://<ref>.supabase.co/functions/v1/usage-ingest` y `USAGE_OUTBOX_SENDER_ENABLED=true`; agendar su worker.
7. Verificar: `usage_ingest_rejections` sin crecer por `SIGNATURE_INVALID`/`TENANT_NOT_MAPPED_FOR_PRODUCT`; `usage_events` con el tenant correcto.

## 3. Jobs (no se crean en migraciones)

Las RPCs de jobs exigen el claim `service_role` (`is_service_request()`): se llaman por PostgREST con la clave de servicio guardada en Vault (patrón pg_cron + pg_net de `docs/runbooks/entitlement-sync.md` §3), no con `pg_cron` ejecutando SQL directo.

| Job | Frecuencia sugerida | Llamada |
| --- | --- | --- |
| Cierre | horaria | `POST /rest/v1/rpc/close_usage_periods` `{}` |
| Finalización | diaria (tras el cierre) | `POST /rest/v1/rpc/finalize_due_usage_aggregates` `{"p_limit":500}` |
| Créditos incluidos | día 1 de cada mes, por tenant con política | `POST /rest/v1/rpc/open_ai_credit_period` |

## 4. Diagnóstico (solo lectura)

- Rechazos por código: `select code, count(*) from platform.usage_ingest_rejections where created_at > now() - interval '1 day' group by 1;`
- `CONFLICT` = mismo `eventId` con contenido distinto: investigar el productor (el outbox lo deja DEAD).
- Alertas de finanzas: `select code, count(*) from platform.usage_alerts group by 1;` (`OVERAGE_UNDER_BLOCK_POLICY`, `POLITICA_CREDITOS_NO_DEFINIDA`, `PESO_CREDITO_NO_DEFINIDO`, `CREDIT_OVERAGE`, `POOL_SCOPE_CONFLICT`).
- Saldos: `platform.v_ai_credit_balances`. Agregados: `platform.v_usage_period_aggregates`.
- COGS (proveedor/modelo/tokens): solo finanzas, `platform.usage_event_cogs(tenant, desde, hasta)`.

## 5. Apagado de emergencia

`USAGE_INGEST_ENABLED=false` en la función (efecto inmediato, 503). Los SaaS no pierden eventos: reintentan con backoff. Para congelar además cierres y créditos: `docs/runbooks/ccp-rollback/17.sql`.
