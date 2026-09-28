# EBIM Commercial Control Plane v1 — Especificación de arquitectura

**Fecha:** 2026-09-27
**Estado:** `SPEC_REVIEW_REQUIRED` (GATE A). Es solo diseño: no incluye código, migraciones ni cambios remotos.
**Rama:** `feature/ebim-commercial-control-plane-v1` (worktree `.worktrees/ebim-commercial-control-plane-v1`), creada desde `dev` @ `346aa72`.
**Bases leídas (solo lectura, `program-state/repo-state.tsv`):**

| Producto | Ruta (bajo `EBIM/`) | Base |
| --- | --- | --- |
| MasterAdmin | `masteradmin` | `346aa72` |
| EWM | `IACLAUDE/WMS-by-EBIM` | `7c086e8` |
| eSupplier | `eSupplier` | `a61dd22` (origin/dev) |
| TMS | `TMS` | `692ff4f` |
| Comerza | `comerza` | `2c49725` |
| eChange | `eChange` | `3d6f34e` |
| eExpense | `eExpenses` | `f282dc4` (dev; la raíz está en `qas`, con el mismo árbol) |
| eCommerce | `eCommerce` | `7da2ae4` (origin/dev; el diff con el checkout local es solo frontend) |
| GMAO | `GMAO` | `90e501f` |

Las citas usan el formato `repo:ruta:línea`. `M/` significa `supabase/migrations/` del repo citado y `F/` significa `supabase/functions/`.

---

## 0. Resumen ejecutivo

1. **MasterAdmin pasa a ser la única fuente de verdad comercial.** Gobierna el catálogo, los precios con vigencia, el registro de capacidades, los entitlements, las asignaciones de uso y créditos IA, y las líneas de factura.
2. **Cada SaaS sigue siendo dueño de ejecutar esas reglas.** Aplica el entitlement en su propio servidor, a partir de un snapshot local duradero.
3. **La sincronización es aditiva y versionada.** MasterAdmin calcula un *snapshot de entitlements* inmutable (versión monótona + checksum) y lo empuja por M2M a un endpoint nuevo de cada SaaS. El SaaS lo guarda y lo aplica. MasterAdmin confirma lo aplicado con un `GET`. Los contratos CREATE/REPLAY/GET de provisioning no cambian.
4. **El uso sigue un camino fijo:** outbox SaaS → ingest M2M firmado → eventos append-only idempotentes → agregado por período finalizado → asignación y créditos IA → exceso → línea de factura. Nunca se factura desde eventos crudos.
5. **La IA se mide en créditos EBIM.** Un crédito es una unidad interna ponderada por capacidad. Los tokens del proveedor son metadato interno de costo (COGS) y nunca se muestran al cliente.
6. **La migración es gradual y reversible, sin big-bang.** Cada producto recorre `LEGACY_ONLY → SHADOW → DUAL_READ → MASTERADMIN_PRIMARY → LEGACY_RETIRED`, primero para entitlements y después para facturación, por cohorte de tenants.
7. **No se inventa ninguna decisión de negocio.** Los precios, créditos incluidos, rollover, expiración, overage, gracia e impuestos quedan como configuración vacía. El sistema **falla cerrado** si falta alguno, siguiendo el patrón existente de `TARIFA_REGIONAL_NO_DEFINIDA`.

---

## 1. Hallazgos de descubrimiento (evidencia)

### 1.1 Hoy coexisten cuatro fuentes de verdad comercial (verificado)

| Fuente | Qué contiene hoy | Evidencia |
| --- | --- | --- |
| **MasterAdmin** (`platform`) | `saas_products`, `plans`, `plan_prices` con vigencia y mercado, `subscriptions`, `subscription_items`, `invoices`, `invoice_lines`, `payments`, `commission_*`, `cost_*`, `catalog_items` (precio plano `price_month`, sin vigencia ni mercado), `tenant_addons`, `tenant_features` | masteradmin `M/20260902000300`, `…0400`, `…0500`, `…0600`; `M/20260913000300_v3_regional_pricing.sql:104-321` |
| **Hub GMAO** (schema `platform` dentro del proyecto GMAO) | `catalog_items(app_code, code, category, price_month NOT NULL, available)`, `company_addons`, `workspace_apps`, `workspace_subscriptions`, `invoices`, `payments`, RPCs `hub_*`, Platform Context API. **La mayor parte no está versionada en git** | GMAO `M/20260915120000_hub_alta_ecommerce_catalogo_y_miquimica.sql:12-77`; `F/platform-context/index.ts:13-25`; `F/platform-register/index.ts:19-62`; readiness `docs/superpowers/reports/2026-09-24-gmao-masteradmin-readiness.md:15-22` |
| **SaaS locales** | eExpense: `plans`, `addons` con precio, `invoices`, `billing-run`. eChange: `ai_agents.price_month`, `channels`, `billing_plans`. eSupplier: `plans` y límites. GMAO: `plans` con límites, `charge`. EWM: `ai_agents.price_usd`. eCommerce: `ai_quotas` | ver §16 |
| **Documentos** | Listas de precios USD por add-on en mensajes de coordinación y en el contrato de plataforma | `EBIM-Plataforma/coordinacion/respondidos/2026-06-28-eexpense-004-addons-catalogo.md`, `…esupplier-005…`, `pendientes/2026-08-06-echange-002…`, `pendientes/2026-09-15-gmao-039…`; `EBIM-CONTRATO-PLATAFORMA.md` §5, §6, §11.1 |

### 1.2 Inventario de add-ons y de puntos de entrada de IA (verificado; las cifras son aproximadas)

| Producto | Códigos comerciales locales | Entradas IA | Enforcement server-side actual |
| --- | --- | --- | --- |
| eCommerce | 25 `ecommerce.*` (dot-notation) + 5 baseline | 18 edge functions vía `ejecutarIA` | **Sí**: `ebim.has_capability`/`assert_capability`, RLS, `ai_consume` con cuota (eCommerce `M/20260827160000_capabilities_entitlements.sql:205-255`; `M/20260914180000_capability_guard_core.sql:112-208`; `M/20260921120000_ai_core.sql:49-178`) |
| eExpense | 23 snake_case (`ai_copilot`, `fraud_vision`, …) | 9 funciones Anthropic + 2 validadores fiscales | **No**: el gating es de cliente y falla abierto (`web/src/features/portal/useModuleGate.ts:65-67`) |
| eSupplier | 12 snake_case, leídos del hub | 21 (19 con fetch directo + 2 vía gateway) | **No**: cliente y fail-open (`src/hooks/usePlatformAddons.ts:39-43`) |
| eChange | 4 agentes add-on + 5 incluidos + canales add-on | ~8 call sites + Deepgram | **Parcial**: `ai_agents.enabled`, pero el tenant owner puede hacer `UPDATE(enabled)` (`M/20260811290000_el_precio_no_lo_escribe_el_cliente.sql:19-20`) |
| EWM | 8 agentes IA `wms_*`/`ai_*` | 1 edge + 1 Java (apagado) | **Sí**: `wms_agent_active` y escritura solo por operador (`M/20260805140000_fix_agent_entitlement_rls.sql:29-37`) |
| GMAO | 4 locales (`ai_assist`, `failure_log`, `wo_approvals`, `access_by_plant`) + hub | 10 (6 con `ai_consume`, 4 sin gate) | **Parcial**: `ai_consume` y `access_by_plant`; los límites del plan no se aplican |
| Comerza | 2 flags (`vitrina`, `erp_connector`) | 1 agente Gemini WhatsApp | **No** |
| TMS | 0 (sin licenciamiento; `MASTERADMIN_GENERIC_CONTRACT.md:84`) | 0 | n/a |
| MasterAdmin | 8 `catalog_items` seed | — | — |

En total hay **~86 códigos** y **~70 puntos de entrada de IA**, en línea con lo previsto en el descubrimiento (~85 y ~66).

**Correcciones al contexto previo:**
- eChange **no es un producto de tipo de cambio (FX)**. Es una mesa de servicio ITIL. Su "pricing de dominio" es la tarifa horaria de `service_rates` (eChange `M/20260814100000…:1-35`).
- El contrato §6 llama `tenant_addons` a la tabla, pero en el hub vivo se llama `company_addons`. Además, `org_context` no devuelve `app_active` (`EBIM-Plataforma/Estado de Suite/EBIM-ESTADO-GMAO.md:71-76`).

### 1.3 El contrato de provisioning actual no transporta entitlements (verificado)

- El payload GENERIC v1 que construye MasterAdmin solo incluye `plan{code,name}` (masteradmin `M/20260921000100_v4_contract_adapters.sql:365-411`; `docs/platform-provisioning/ADAPTERS.md:39-66`).
- Todos los receptores ignoran el plan: eCommerce "El catálogo comercial (plan, addons) no se toca" (`docs/platform-provisioning/MASTERADMIN_GENERIC_CONTRACT.md:80`); eExpense y eSupplier crean el tenant con `plan='pro'` fijo; EWM no acepta ni `plan` ni GENERIC.
- Todos los receptores comparten el mismo patrón: JWT ES256 (EWM también admite RS256), TTL ≤ 300 s, `Idempotency-Key` + hash SHA-256 del comando canónico, `REPLAYED` 200 / `IDEMPOTENCY_CONFLICT` 409, `GET /tenants/{controlPlaneTenantId}` y tablas de solicitud y auditoría append-only. **En ninguno el `jti` es de un solo uso.**

### 1.4 Hallazgos P0/críticos que bloquean la integridad comercial (verificado en código)

| ID | Repo | Hallazgo | Evidencia |
| --- | --- | --- | --- |
| P0-MA-1 | MasterAdmin | `tenant_addons` y `tenant_features` tienen CRUD para `authenticated` bajo `can_manage_tenant`, así que un TENANT_ADMIN puede autoactivarse add-ons y features. Ningún trigger valida `catalog_items.available` | masteradmin `M/20260902000900_rls_policies.sql:300-315,396-414` |
| P0-EX-1 | eExpense | Endpoints IA y fiscales sin auth de usuario, tenant ni add-on: basta la anon key para consumir crédito Anthropic y fiscal | eExpenses `F/copilot-chat/index.ts:22-32`, `F/capture-receipt/index.ts:51-60` |
| P0-EX-2 | eExpense | El tenant admin puede escribir `tenant_addons` y `tenants.plan/max_users/billing_mode/status`. Con `billing_mode='demo'` sale de la facturación | eExpenses `M/20260626240000_tenant_isolation_hardening.sql:90-93,130-133`; `F/billing-run/index.ts:68` |
| P0-EX-3 | eExpense | `billing-webhook` es público, no verifica firma y marca facturas como pagadas | eExpenses `F/billing-webhook/index.ts:6-26` |
| P0-EX-4 | eExpense | `platform-subscribe` activa add-ons en modo `live` sin chequear rol | eExpenses `F/platform-subscribe/index.ts:26-33` |
| P0-EX-5 | eExpense | `whatsapp-inbound` no verifica la firma de Twilio y el `From` se puede falsificar, lo que genera gasto de LLM | eExpenses `F/whatsapp-inbound/index.ts:24-33` |
| P0-EX-6 | eExpense | Toma de cuenta vía `enroll-client`: el fix existe pero no está desplegado | masteradmin `docs/superpowers/evidence/2026-09-24-multi-app-closure-status.md` §4 |
| P0-GM-1 | GMAO | Con `public.set_addon` + `reset_ai_usage` un tenant admin se otorga IA pagada y reinicia su contador | GMAO `M/20260709150000:228-245`, `M/20260710200000:83-91` |
| P0-GM-2 | GMAO | `translate` no tiene auth y llama a Anthropic con service_role | GMAO `F/translate/index.ts:20-52` |
| P0-GM-3 | GMAO | `provision_or_attach_tenant` es ejecutable por anon: cualquiera se une a cualquier tenant como owner. Corregido solo en local | GMAO readiness report §6; `M/20260925002308` |
| P0-SU-1 | eSupplier | `platform-catalog` no autentica al llamador: con la anon key se activan add-ons del hub (`subscribe`/`set_addon`) para cualquier org | eSupplier `F/platform-catalog/index.ts:42` |
| P0-SU-2 | eSupplier | `platform-context` es un IDOR cross-tenant | eSupplier `F/platform-context/index.ts:46-49` |
| P0-SU-3 | eSupplier | Los P0-01/04/05/06 documentados siguen PARTIAL | eSupplier `SECURITY_INFORME_CONSOLIDADO.md:99-108` |
| P0-EC-1 | eChange | Tres funciones SECURITY DEFINER con EXECUTE para PUBLIC. Entre ellas `consumo_de_horas_de` (costo y margen) | eChange `M/20260815101000:101,151`, `M/20260815130000:47` |
| P0-EC-2 | eChange | El tenant owner puede autoactivar agentes add-on con `UPDATE(enabled)` | eChange `M/20260811290000:19-20` |
| H-ECO-1 | eCommerce (alto) | El modo provisioning de `platform-context` usa una clave estática compartida que concede cualquier entitlement a cualquier org | eCommerce `_shared/platform-context.ts:144-181` |

Estos hallazgos se atienden en las fases 03–06 del programa, **antes** de que el producto afectado entre en `SHADOW`. Esta especificación solo fija la regla: **ningún producto pasa de `LEGACY_ONLY` mientras tenga abierto un P0 que permita autootorgarse entitlements o gastar IA sin autenticación.**

---

## 2. Propiedad y fuente de verdad por campo (decisión 1)

**Regla general:** MasterAdmin decide *qué está contratado y cuánto*. El SaaS decide *cómo se hace cumplir* y *qué significa en su dominio*.

| Dato | Dueño canónico | Copia derivada | Notas |
| --- | --- | --- | --- |
| Producto SaaS (`code`, `billing_unit`, `is_billable`) | MasterAdmin `saas_products` | — | `code` es el slug en minúsculas (`ewm`, `esupplier`, `tms`, `comerza`, `echange`, `eexpense`, `ecommerce`, `gmao`) |
| Plan (`code`, modo de despliegue, `included_companies`, `multi_country`) | MasterAdmin `plans` | `planCode` en el snapshot, solo para trazabilidad | El SaaS **nunca** decide por `planCode`; decide por capacidades (patrón de eCommerce `tenant_platform_context.plan`, "diagnóstico", `M/20260827160000:97-99`) |
| Precio del plan | MasterAdmin `plan_prices` (vigencia + mercado + moneda) | Ninguna | Nunca sale de MasterAdmin |
| Add-on / ítem de catálogo | MasterAdmin `catalog_items` (extendido) | Registro de alias en el SaaS | El hub GMAO pasa a ser una copia legacy (§15) |
| Precio del add-on | MasterAdmin `catalog_item_prices` (NUEVO) | Ninguna | `catalog_items.price_month` queda deprecado para facturación |
| Código de capacidad (qué existe) | **Co-propiedad**: el SaaS la declara, MasterAdmin la registra | `product_capabilities` en MasterAdmin; tabla local equivalente en el SaaS | Si el SaaS introduce una capacidad sin registrarla, es drift de registro (§9) |
| Mapeo plan/add-on → capacidades y límites | MasterAdmin `entitlement_grants` (NUEVO) | Snapshot | — |
| Entitlement efectivo de un tenant | MasterAdmin (cálculo) | Snapshot local del SaaS (último válido) | En runtime el SaaS consulta **solo** su copia local |
| Aplicación técnica del entitlement | SaaS | — | RLS, RPC y guardas en edge/Java |
| Flags técnicos y kill-switches del SaaS | SaaS | — | Solo pueden **restar** capacidad, nunca sumar (patrón eCommerce `tenant_feature_flags`) |
| Rate limits operativos (por minuto) | SaaS | — | p. ej. 30 llamadas/min en eCommerce `ai_core.sql:326-338`. No son comerciales |
| Asignaciones de uso (incluido por período) | MasterAdmin | Snapshot (`allowances`) | — |
| Evento de uso | SaaS lo produce (outbox) | MasterAdmin `usage_events` (append-only) | — |
| Agregado facturable | MasterAdmin `usage_period_aggregates` | — | Único insumo de facturación por uso |
| Ledger de créditos IA | MasterAdmin `ai_credit_ledger` | El SaaS guarda un contador local de pre-chequeo, no autoritativo | — |
| Costo del proveedor IA (modelo, tokens, USD) | MasterAdmin, como metadato interno de COGS | — | No visible para el cliente ni en roles comerciales sin finanzas (§14) |
| Credenciales de proveedor del tenant (ERP, pasarela, fiscal) | SaaS | — | Nunca en MasterAdmin ni en el snapshot |
| Precios de dominio (fletes TMS, tarifas horarias de eChange, listas de precio de eCommerce, precios de venta de Comerza, `billing_config` 3PL de EWM) | SaaS | — | **Fuera del alcance.** No son licenciamiento EBIM |
| Suscripción, factura, pago, comisión | MasterAdmin | — | Las comisiones solo se generan por pagos `CONFIRMED` (se mantiene `generate_commission_events`, masteradmin `M/20260913000900:206-222`) |
| Identidad/SSO y Platform Context (org/company/memberships) | Hub GMAO (no cambia en este programa) | — | Este programa migra **solo** la parte comercial del hub |

---

## 3. Modelo de tablas: REUSE / EXTEND / NEW (decisión 2)

Todas las tablas nuevas van en el schema `platform`, con `ENABLE` + `FORCE ROW LEVEL SECURITY`, uuid `gen_random_uuid()`, dinero en `numeric(14,2)` + `char(3)` y nombres de migración `YYYYMMDDHHMMSS_*.sql` (masteradmin `docs/architecture/EBIM_CONVENTIONS.md` C-01..C-16).

### 3.1 REUSE (sin cambios de esquema)

| Tabla / objeto | Uso en el Commercial Control Plane |
| --- | --- |
| `saas_products` | Producto comercial y unidad de facturación |
| `plans` | Plan comercial por producto |
| `plan_prices`, `current_plan_price`, `set_plan_price` | Precio base con vigencia regional. Es el patrón que se replica para add-ons |
| `currencies`, `markets`, `market_currencies` | Mercado y moneda de todos los precios nuevos |
| `subscriptions` (+ guard DEMO) | Contrato comercial |
| `invoices`, `recalc_invoice_totals`, `payments`, `sync_invoice_payment_status` | Facturación y cobranza |
| `commission_plans/rules/events/settlements`, `generate_commission_events` | Comisiones solo sobre `CONFIRMED` |
| `saas_provisioning_requests`, `tenant_product_mappings`, `saas_provisioning_events` | Resolver `controlPlaneTenantId` ↔ `external*Id` de cada SaaS |
| `product_integrations`, `credential_profiles` (grant por columna sin `secret_ref`), `F/_shared/provisioning/m2m.ts`, `url-guard.ts`, `retry.ts` | Transporte M2M saliente para empujar snapshots |
| `platform_permissions`, `has_product_permission`, `can_manage_commercial`, `can_manage_platform_entities`, `can_read_finance` | Autoridad (§14) |
| `audit_log` | Auditoría comercial |

### 3.2 EXTEND (cambios aditivos y compatibles)

| Objeto | Cambio | Compatibilidad |
| --- | --- | --- |
| `catalog_items` | + `saas_product_id uuid null` (null = transversal, p. ej. `extra_company`), + `lifecycle_status` (`DRAFT`/`AVAILABLE`/`COMING_SOON`/`RETIRED`), + `billing_model` (`FLAT`/`PER_COMPANY`/`PER_UNIT`) derivado de `scope`. `price_month` se mantiene como **legacy de solo lectura**; ninguna ruta de facturación nueva lo usa | Las filas existentes quedan intactas. `available` se conserva y pasa a ser derivado |
| `subscription_items` | + `source_type` (`PLAN`/`ADDON`/`USAGE`/`MANUAL`), + `tenant_addon_id uuid null`, + `price_ref` (id de `plan_prices` o `catalog_item_prices` usado al fijar el precio) | Los ítems existentes quedan en `MANUAL`. `issue_subscription_invoice` produce las mismas líneas (test de "antes = después") |
| `tenant_addons` | + `company_id null` (para `scope=per-company`), + `status` (§6), + `effective_from`/`effective_to`, + `subscription_item_id`, + `requested_by`/`approved_by`. **Se revoca INSERT/UPDATE/DELETE de `authenticated`**: solo se escribe por RPC (corrige P0-MA-1) | PK existente `(tenant_id, addon_code)` → nueva unique parcial `(tenant_id, addon_code, coalesce(company_id))` sobre filas no terminales. Las filas existentes pasan a `ACTIVE` |
| `tenant_features` | Pasa a **read-model derivado** de entitlements. `source` gana `ENTITLEMENT`. **Se revoca la escritura de `authenticated`**; `set_tenant_feature` escribe un override manual auditado (§5.4) | La UI existente sigue leyendo |
| `platform.charge_kind` | + `USAGE_OVERAGE` | Enum aditivo (`ALTER TYPE … ADD VALUE`) en una migración aislada |
| `invoice_lines` | + `usage_aggregate_id uuid null`, + `meter_code text null`, + `corrects_line_id uuid null` (DISCOUNT correctivo, §13) | Nulos para las líneas existentes |
| `provisioning_execution_context` / adapters | + acciones `SYNC_ENTITLEMENTS` y `GET_ENTITLEMENTS` en el orquestador. **No cambia `PROVISION`, `GET_STATUS`, `REPLAY_CERTIFICATION` ni el payload** | Test carácter a carácter del payload (patrón de la spec EWM §4.3) |
| `product_integrations` | + `entitlements_path`, `entitlements_write_scope`, `entitlements_read_scope`, `usage_ingest_enabled`, `cutover_state_entitlements`, `cutover_state_billing` | Todos nulos o `LEGACY_ONLY` por defecto |

### 3.3 NEW

| Tabla | Propósito | Claves e invariantes |
| --- | --- | --- |
| `product_capabilities` | Registro de capacidades (§4) | unique `(saas_product_id, code)`; `code` con forma `<product>.<segmento>(.<segmento>)*` |
| `capability_aliases` | Traducir códigos legacy de SaaS o hub a códigos canónicos | unique `(saas_product_id, alias_source, alias_code)` |
| `catalog_item_prices` | Precio del add-on con vigencia regional (§5) | Réplica exacta de las reglas de `plan_prices` |
| `entitlement_grants` | Plan o add-on → capacidad/límite/asignación, con vigencia | Inmutable salvo `valid_to`; GiST sin solapes por `(source, capability)` |
| `tenant_entitlement_overrides` | Excepciones manuales auditadas (cortesía, piloto) | Requieren `reason`, `approved_by` y `expires_at` obligatorio |
| `entitlement_snapshots` | Snapshot calculado, inmutable, versionado (§7) | unique `(tenant_id, saas_product_id, snapshot_version)`; `checksum` NOT NULL; append-only por trigger |
| `entitlement_sync_state` | Estado deseado frente a aplicado por tenant×producto (§9) | PK `(tenant_id, saas_product_id)` |
| `entitlement_sync_attempts` | Bitácora de push y GET | Append-only |
| `usage_meters` | Registro de medidores (§11) | unique `(saas_product_id, code)` |
| `usage_events` | Eventos de uso crudos | unique `(saas_product_id, event_id)`; append-only; particionable por mes |
| `usage_period_aggregates` | Agregado por tenant×medidor×período | Estados `OPEN`/`CLOSING`/`FINALIZED`; `FINALIZED` es inmutable |
| `ai_credit_weights` | Créditos por unidad de cada capacidad IA, con vigencia | Inmutable salvo `valid_to` |
| `ai_credit_policies` | Política de créditos por plan o add-on: incluidos, rollover, expiración, modo de exceso | Todos los campos comerciales son nullable = **no decidido** |
| `ai_credit_ledger` | Ledger append-only de créditos (§12) | unique `(tenant_id, entry_idempotency_key)` |
| `m2m_jti_replay` | Registro de `jti` ya usados en el ingest de uso | PK `(issuer, jti)`; purga a TTL + skew |
| `commercial_cutover_events` | Historial de transiciones del §15 | Append-only |

---

## 4. Registro de capacidades por producto (decisión 3)

**`product_capabilities`**

- `saas_product_id`
- `code`: canónico, en minúsculas y con puntos, p. ej. `ecommerce.promotions`, `eexpense.fraud_vision`, `ewm.ai.slotting`
- `kind`:
  - `FEATURE`: booleano
  - `LIMIT`: tope numérico sobre recursos vivos, p. ej. usuarios o empresas
  - `ALLOWANCE`: cantidad incluida por período para un medidor
  - `AI_FEATURE`: feature IA que consume créditos
- `is_baseline`: incluida siempre que la app esté activa, sin entitlement. Es el patrón eCommerce `app_capabilities.is_baseline`
- `unit`: para `LIMIT`/`ALLOWANCE`
- `combine_rule`: `MAX` o `SUM`; indica cómo se combinan plan y add-ons para `LIMIT`/`ALLOWANCE`
- `scope_level`: `TENANT` o `COMPANY`
- `meter_code`: para `ALLOWANCE` y `AI_FEATURE`
- `status`: `DRAFT`, `ACTIVE` o `DEPRECATED`
- `introduced_in_contract`

**Reglas:**

1. **Namespacing.** Los códigos canónicos llevan el producto como prefijo, siguiendo la convención de eCommerce, que ya es dot-notation (eCommerce `M/20260827160000:80-92`). Los códigos snake_case existentes (eExpense, eSupplier, eChange, EWM, GMAO) **no se renombran en los SaaS**. Se mapean con `capability_aliases`, p. ej. `(eexpense, LOCAL_ADDON, 'fraud_vision') → eexpense.fraud_vision` y `(esupplier, GMAO_HUB, 'dorothy_copilot') → esupplier.ai.dorothy_copilot`.
2. **La registración nace del SaaS.** Cada SaaS publica un manifiesto versionado de capacidades (archivo en su repo y respuesta de `GET …/entitlements/manifest`). MasterAdmin lo importa por RPC y **no inventa códigos**. El registro inicial es exactamente el inventario del §1.2.
3. **Cobertura bidireccional.** Todo código sellable que el SaaS aplica debe existir en el registro, y todo código `ACTIVE` del registro debe tener enforcement server-side en el SaaS. Cualquier diferencia es drift de registro (§9).
4. **Las capacidades transversales del contrato** (§11.1: `extra_company`, `multi_country`, `consolidation`, `white_label`) se registran por producto (`<product>.companies.extra`, `<product>.multi_country`, …). El contrato fija los nombres pero no el precio.
5. **Los límites sobre recursos existentes** se registran como `LIMIT`, sin valores. Ejemplos: GMAO `max_assets`/`max_users`/`max_work_orders_month` (GMAO `M/20260625120000:51-63`), eSupplier empresas/usuarios (`multitenant_19_plan_limits.sql:8-13`), eExpense `max_users`. Los valores actuales **no se importan** sin aprobación humana (D-05).

---

## 5. Precios de add-ons con vigencia (decisión 4)

1. **`catalog_item_prices`** replica `plan_prices` y usa sus mismos patrones:
   - columnas `catalog_item_id`, `market_id`, `charge_kind` (`ADDON`/`IMPLEMENTATION_FEE`/`USAGE_OVERAGE`), `billing_interval`, `amount`, `currency`, `valid_from`, `valid_to`;
   - vigencia inclusiva;
   - índice único para el precio vigente, con `nulls not distinct where valid_to is null`;
   - exclusión GiST sin solapes (`daterange(valid_from, valid_to, '[]')`);
   - trigger que exige mercado y moneda permitidos (`MERCADO_REQUERIDO`);
   - inmutabilidad salvo `valid_to` (`PRECIO_HISTORICO_INMUTABLE`).

   Referencia: masteradmin `M/20260913000300_v3_regional_pricing.sql:159-321`.
2. **Funciones:**
   - `current_catalog_item_price(item, market, kind, interval, currency, as_of)` es SECURITY INVOKER.
   - `set_catalog_item_price(...)` es SECURITY DEFINER, con `search_path` fijo, EXECUTE revocado de PUBLIC y concedido a `authenticated`, y con gate interno `can_manage_regional_catalog()`.
3. **Unidad de cobro:**
   - `billing_model=PER_COMPANY`: la cantidad es el número de compañías con el add-on `ACTIVE` en la fecha de corte. Aplica el contrato §11.1 (`count × extra_company_price`).
   - `FLAT`: cantidad 1.
   - `PER_UNIT`: la cantidad viene de un agregado de uso.
4. **Congelamiento del precio.** Al activarse el add-on, `subscription_items.unit_amount` copia el precio vigente y guarda `price_ref`, igual que hoy con los planes. Un cambio de precio posterior no afecta ítems existentes hasta una renovación o repricing explícito (D-09).
5. **Falla cerrado.** Si no hay precio vigente, un add-on marcado facturable no se puede activar en una suscripción no-DEMO: error `TARIFA_ADDON_NO_DEFINIDA`. **Los precios en USD de los documentos no se cargan automáticamente** (D-01).
6. **`catalog_items.price_month`** queda congelado como dato legacy informativo, sin escritura nueva en cuanto `catalog_item_prices` exista para el ítem.

---

## 6. Mapeo plan/add-on → entitlements y ciclo de vida del add-on (decisiones 5 y 6)

### 6.1 `entitlement_grants`

`(source_type ∈ {PLAN, CATALOG_ITEM}, source_id, capability_id, grant jsonb, valid_from, valid_to)`

Forma de `grant` según el tipo de capacidad:

| `kind` | Forma de `grant` |
| --- | --- |
| `FEATURE` / `AI_FEATURE` | `{"enabled": true}` |
| `LIMIT` | `{"value": <int>, "enforcement": "HARD" \| "SOFT"}` |
| `ALLOWANCE` | `{"included": <numeric>, "period": "MONTH"}` |

- `AI_FEATURE` puede llevar además `"creditPolicyId"`.
- Una fila cuyo valor numérico no esté decidido **no se crea**. No existen defaults inventados.

**Cálculo del entitlement efectivo** (tenant, producto, instante `t`):

1. Baseline del producto, solo si `workspace_apps`/mapping está activo para el tenant.
2. ∪ grants del plan de la suscripción `ACTIVE` que cubre al tenant (vía `subscriptions.tenant_id`, o por la organización si `tenant_id` es null).
3. ∪ grants de cada `tenant_addons` en estado `ACTIVE` en `t` (y de su `company_id` si el scope es por compañía).
4. ⊕ `tenant_entitlement_overrides` vigentes.
5. Los `LIMIT`/`ALLOWANCE` se combinan según `combine_rule`.

El cálculo es una función pura `compute_entitlements(tenant, product, t)` STABLE. Se prueba con pgTAP con tablas de verdad.

### 6.2 Ciclo de vida de `tenant_addons.status`

```
REQUESTED ──approve──► ACTIVE ──schedule_cancel──► CANCEL_SCHEDULED ──(fin de período)──► CANCELLED
    │                    │  ▲                           │
    └──reject──► REJECTED │  └────── reactivate ────────┘
                         └──suspend──► SUSPENDED ──resume──► ACTIVE
                                           └──cancel──► CANCELLED
```

- **Estados terminales:** `CANCELLED` y `REJECTED`. Una reactivación crea una fila nueva, así la historia no se sobrescribe.
- **`approve` y `schedule_cancel`** son RPC DEFINER con gate `can_manage_commercial()`. Crean o cierran el `subscription_item` `ADDON` en la **misma transacción** (patrón `onboard_customer_subscription`).
- **`suspend`/`resume`** se reservan a finanzas. **Cuándo** se suspende por impago es una decisión de negocio (D-07); el mecanismo existe, pero ninguna automatización lo dispara por defecto.
- **Solicitudes originadas en el SaaS.** Un botón de "contratar" dentro de la app no activa nada. Crea `REQUESTED` vía M2M o lead (contrato §6.1: el cross-sell genera un lead). Esto **elimina el camino actual de autoactivación** de eExpense `platform-subscribe`, eSupplier `platform-catalog` y el hub `hub_subscribe`.
- **Cada transición** escribe `audit_log` y marca `entitlement_sync_state.desired_dirty = true` para el producto afectado.

---

## 7. Snapshot versionado de entitlements (decisión 7)

### 7.1 Esquema `ebim.entitlements/v1`

```json
{
  "schema": "ebim.entitlements/v1",
  "environment": "DEV",
  "controlPlaneTenantId": "3f1c…-uuid",
  "productCode": "ecommerce",
  "external": {
    "tenantId": "…",
    "organizationId": "…",
    "companyIds": ["…"]
  },
  "snapshotVersion": 17,
  "previousVersion": 16,
  "effectiveAt": "2026-10-01T00:00:00Z",
  "issuedAt": "2026-10-01T00:00:03Z",
  "appActive": true,
  "planCode": "ecommerce-shared-standard",
  "capabilities": [
    { "code": "ecommerce.promotions", "enabled": true,  "scope": { "level": "COMPANY", "companyIds": ["…"] }, "sources": ["ADDON"] },
    { "code": "ecommerce.payments",   "enabled": false, "scope": { "level": "TENANT" }, "sources": [] }
  ],
  "limits": [
    { "code": "gmao.assets.max", "value": 1000, "unit": "asset", "enforcement": "HARD", "scope": { "level": "TENANT" } }
  ],
  "allowances": [
    { "code": "ecommerce.ai.credits", "meterCode": "ai.credits", "included": 500, "period": { "start": "2026-10-01", "end": "2026-10-31" }, "overageMode": "BLOCK" }
  ],
  "aiCredits": {
    "weights": [ { "capabilityCode": "ecommerce.ai.insights", "creditsPerUnit": 2, "unit": "call" } ],
    "weightsVersion": 3
  },
  "correlationId": "uuid",
  "idempotencyKey": "ma-ent-v1-<sha256(tenant:product:version)>",
  "checksum": "sha256:<hex>"
}
```

Los valores numéricos del ejemplo (500, 2, 1000) son **ilustrativos del formato**, no decisiones comerciales.

### 7.2 Reglas del snapshot

1. **Snapshot completo, no delta.** Lista **todas** las capacidades sellables `ACTIVE` del registro del producto, con `enabled` explícito. Si una capacidad sellable no aparece, el receptor la deniega. Las capacidades baseline no hace falta listarlas.
2. **Versión monótona** por `(tenant, product)`, asignada en la misma transacción que inserta el snapshot (`max+1` bajo advisory lock). Si el contenido canónico no cambia, **no** se emite versión nueva.
3. **Checksum** = SHA-256 del JSON canónico RFC 8785 (JCS) sin el campo `checksum`, calculado en MasterAdmin y verificado por el receptor.
4. **`effectiveAt`** es el instante comercial en que el estado deseado entra en vigor. MasterAdmin **solo emite** snapshots con `effectiveAt ≤ now()`: las bajas futuras las emite un job programado al llegar la fecha. Así el SaaS no depende de su reloj para decidir vigencias.
5. **`environment`.** El receptor rechaza un snapshot cuyo `environment` no coincide con el suyo (`ENVIRONMENT_MISMATCH`, 422).
6. **Prohibido en el snapshot:** precios, montos, monedas, costos, nombres de proveedores de IA, tokens, secretos, `secret_ref`, emails o datos de contacto. Un test de contrato recorre el JSON y falla si aparecen las claves `price`, `amount`, `currency`, `cost`, `secret`, `token`, `email` o `key`, salvo `idempotencyKey`.
7. **Tamaño máximo:** 64 KB, el mismo límite que los receptores existentes.
8. **Persistencia.** `entitlement_snapshots` guarda el JSON completo y es append-only.

---

## 8. Receptor SaaS, snapshot local y GET de estado aplicado (decisión 8)

### 8.1 Endpoints nuevos

Son aditivos y van en una ruta separada, según el contrato §2.6.

| Método y ruta (relativa a la base de provisioning de cada SaaS) | Scope | Semántica |
| --- | --- | --- |
| `PUT /tenants/{controlPlaneTenantId}/entitlements` | `<product>:entitlements:write` | Aplica el snapshot |
| `GET /tenants/{controlPlaneTenantId}/entitlements` | `<product>:entitlements:read` | Devuelve el estado aplicado |
| `GET /entitlements/manifest` | `<product>:entitlements:read` | Devuelve el manifiesto de capacidades (§4 regla 2) |

**Transporte y credenciales:**

- Reusa el JWT ES256 existente: `iss=masteradmin.ebim`, `aud=<product>.ebim`, TTL ≤ 300 s y `jti` obligatorio.
- Los scopes son **nuevos**, así que una credencial solo de provisioning no puede escribir entitlements.
- Headers: `Idempotency-Key` = `snapshot.idempotencyKey`, `X-Correlation-Id` y `X-MasterAdmin-Contract: entitlements.v1`.
- Cada receptor **debe** registrar el `jti` de estos endpoints en una tabla única con TTL. Así se cierra la brecha "jti no single-use" del §1.3, sin tocar el endpoint de CREATE.

### 8.2 Semántica de `PUT`

Se aplica en orden, en una sola transacción del SaaS:

1. Validar el JWT, el scope y el `environment`. Recalcular el checksum; si no coincide → 422 `CHECKSUM_MISMATCH`.
2. Resolver `controlPlaneTenantId` con la tabla de provisioning local. Si no existe → 404 `TENANT_NOT_PROVISIONED`.
3. Comparar con la versión aplicada:

| Condición | Respuesta |
| --- | --- |
| `snapshotVersion < applied` | 409 `STALE_SNAPSHOT`, con `appliedVersion` |
| `snapshotVersion == applied` y mismo checksum | 200 `replayed:true` |
| `snapshotVersion == applied` y checksum distinto | 409 `VERSION_CONFLICT` |
| `snapshotVersion > applied` | Aplicar (se permiten saltos de versión: el snapshot es completo) |

4. Traducir los códigos canónicos a los locales con el alias local. Si hay códigos desconocidos, se guardan sin aplicar y se devuelve `unknownCapabilities[]`; el estado aplicado queda `APPLIED_WITH_WARNINGS`. Las capacidades desconocidas **nunca** se conceden.
5. Guardar el snapshot completo (`entitlement_snapshot_applied`: JSON, versión, checksum, `applied_at`) y materializarlo en las tablas de enforcement del producto, reemplazando el conjunto de forma atómica. Es el patrón eCommerce `sync_platform_context` (`M/20260827160000:363-442`).
6. Registrar la auditoría append-only.
7. Responder `200 {appliedVersion, appliedChecksum, appliedAt, status, unknownCapabilities}`.

### 8.3 `GET` aplicado

Devuelve `{controlPlaneTenantId, productCode, appliedVersion, appliedChecksum, appliedAt, status ∈ {NONE, APPLIED, APPLIED_WITH_WARNINGS}, unknownCapabilities, enforcementMode ∈ {LEGACY, SHADOW, DUAL_READ, PRIMARY}}`. **Es la única prueba válida de sincronización**: la respuesta del `PUT` no cuenta como evidencia (§19).

### 8.4 Snapshot local duradero y enforcement

- **Runtime.** El enforcement lee **solo** el snapshot local (tablas materializadas). No hay ninguna llamada a MasterAdmin por acción de usuario.
- **Si MasterAdmin cae,** el SaaS sigue con el último snapshot válido **sin expiración**. La revocación solo ocurre con un snapshot nuevo. La gracia comercial por impago es D-07.
- **Nunca sincronizado** (`NONE`): el comportamiento depende del estado de cutover (§15). Antes de `MASTERADMIN_PRIMARY` usa legacy. En `PRIMARY` concede solo baseline, y el alta de provisioning **debe** ir seguida del primer snapshot (el orquestador lo encadena tras `ACTIVE`).
- **Server-side siempre.** RLS, RPC `assert_capability`-like, guardas en edge y servicios Java. El cliente solo hace UX.

---

## 9. Reconciliación deseado/aplicado y estados de drift (decisión 9)

**`entitlement_sync_state`** (una fila por tenant×producto):

- `desired_version`, `desired_checksum`, `desired_dirty`
- `last_pushed_version`, `last_push_at`, `last_push_result`
- `applied_version`, `applied_checksum`, `applied_status`, `last_verified_at`
- `state`, `state_reason`, `consecutive_failures`

**Estados de `state`:**

| Estado | Condición |
| --- | --- |
| `NOT_PROVISIONED` | Sin `tenant_product_mappings` activo |
| `NOT_ENROLLED` | El producto está en `LEGACY_ONLY` (§15); no se empuja |
| `PENDING_PUSH` | `desired_version > last_pushed_version` o `desired_dirty` |
| `PUSHING` | Push en curso (lease con timeout) |
| `AWAITING_VERIFY` | Push 200, falta la verificación por `GET` |
| `IN_SYNC` | `GET` confirma `applied_version = desired_version`, mismo checksum y `status=APPLIED` |
| `IN_SYNC_WITH_WARNINGS` | Igual que `IN_SYNC`, pero con `unknownCapabilities` no vacío |
| `DRIFT_BEHIND` | `applied_version < desired_version` tras verificar |
| `DRIFT_CHECKSUM` | Misma versión, checksum distinto (se alerta como incidente) |
| `DRIFT_AHEAD` | `applied_version > desired_version`. No debería ocurrir; se alerta y no se hace push automático |
| `REJECTED` | 4xx no reintentable (`CHECKSUM_MISMATCH`, `ENVIRONMENT_MISMATCH`, `TENANT_NOT_PROVISIONED`) |
| `UNREACHABLE` | 5xx o timeout tras `max_attempts`, con backoff (reusa `retry.ts`) |
| `REGISTRY_DRIFT` | El manifiesto del SaaS y `product_capabilities` difieren |

**Jobs:**

1. `entitlement-push`: toma `PENDING_PUSH` con `FOR UPDATE SKIP LOCKED`.
2. `entitlement-verify`: hace `GET` sobre `AWAITING_VERIFY` y sobre una muestra periódica de `IN_SYNC`, para detectar drift silencioso.
3. `registry-verify`: compara el manifiesto con el registro.

Los tres corren como edge function de MasterAdmin con service_role y se invocan igual que el orquestador. **Nunca corrigen el SaaS escribiendo en su base**: `DB_DIRECT` está prohibido (`ADAPTERS.md`).

---

## 10. Upgrade, downgrade y revocación (decisión 10)

| Evento | `effectiveAt` | Efecto en el SaaS |
| --- | --- | --- |
| Upgrade de plan o alta de add-on | Inmediato al aprobar | Capacidad concedida al aplicar el snapshot |
| Downgrade o baja programada de add-on | Fin del período facturado (`CANCEL_SCHEDULED` → job) | Capacidad retirada al llegar la fecha |
| Baja inmediata (acuerdo comercial o fraude) | Inmediata; solo finanzas o super admin, con motivo | Igual que la revocación |
| Suspensión por impago | Según D-07; mecanismo manual | Snapshot con `appActive=true` y capacidades sellables `enabled:false`. El baseline se mantiene salvo decisión contraria |
| Baja de la app (`appActive=false`) | Por solicitud comercial | El SaaS bloquea el acceso operativo. **Los datos no se borran** |

**Semántica obligatoria de revocación en el SaaS:**

1. **Los datos nunca se borran por pérdida de entitlement.** Se bloquean las escrituras y el uso nuevo; la lectura histórica se mantiene salvo decisión contraria (D-08).
2. **Límite bajado por debajo del uso actual** (p. ej. 30 usuarios con límite 25): se bloquean las altas nuevas y no se desactivan recursos existentes automáticamente. Es el patrón *grandfather* y es el comportamiento técnico por defecto; la política comercial de ajuste es D-08.
3. **Efectos visibles externos** (white label, integraciones): se revierten de forma reversible, como eCommerce `sync_platform_context`, que apaga white_label al perder el add-on (`:426-432`).
4. **Idempotencia y orden.** Solo se aplica una versión mayor, así que un snapshot atrasado nunca revoca lo concedido después.

---

## 11. Contrato de uso: meter, evento, outbox y agregado (decisión 11)

### 11.1 `usage_meters`

`(saas_product_id, code, unit, aggregation ∈ {SUM, MAX, COUNT_DISTINCT_SUBJECT}, is_billable, status)`

- Los códigos son canónicos, p. ej. `ecommerce.ai.calls`, `ai.credits` (transversal) o `ewm.warehouses.active`.
- `is_billable=false` por defecto. Que un medidor sea facturable es una decisión comercial.

### 11.2 Outbox en el SaaS

Se crea una tabla nueva por producto, con el mismo patrón que los outbox ya presentes (eCommerce `integration_outbox`, EWM `evt_outbox_event`, TMS `shipment_outbox_event`).

**Columnas:**

- `event_id`: uuid generado por el productor, estable ante reintentos
- `occurred_at`
- `meter_code`, `quantity numeric`, `external_company_id`, `subject_ref`
- `capability_code`, para IA
- `internal jsonb`: `{provider, model, inputTokens, outputTokens, cacheTokens, latencyMs}`. Es opcional y solo para COGS
- `status`, `attempts`, `sent_at`

**Reglas:**

- Se escribe **en la misma transacción** que la acción medida, o en el `finally` del pipeline IA (patrón eCommerce `ai_record`, que registra incluso en fallo).
- Tablas sin grants para `anon`/`authenticated`.

### 11.3 Ingest `POST {MasterAdmin}/functions/v1/usage-ingest`

**Autenticación:**

- JWT ES256 firmado **por el SaaS**, con clave privada propia por producto y entorno. La pública se registra en `credential_profiles`.
- Claims: `iss=<product>.ebim`, `aud=masteradmin.ebim`, scope `usage:ingest`, TTL ≤ 300 s.
- El `jti` es de uso único (`m2m_jti_replay`).

**Cuerpo:** lote de ≤ 500 eventos, ≤ 256 KB, con `controlPlaneTenantId` por evento.

**Desviación explícita del contrato §2.6.** El contrato pide derivar el tenant de la credencial y rechazar payloads que traigan tenant. Una credencial por (app, tenant) no escala para ingest de uso. Se sustituye por: *la credencial identifica al producto, y cada `controlPlaneTenantId` debe tener un `tenant_product_mappings` ACTIVE **para ese producto**; si no, el evento se rechaza (`TENANT_NOT_MAPPED_FOR_PRODUCT`)*. Esta desviación requiere visto bueno en GATE A (D-12).

**Idempotencia por evento** (unique `(saas_product_id, event_id)` + hash del evento):

| Caso | Resultado |
| --- | --- |
| Duplicado idéntico | `DUPLICATE` (aceptado) |
| Duplicado con contenido distinto | `CONFLICT` (rechazado y alertado) |

**Respuesta:** por evento (`ACCEPTED`/`DUPLICATE`/`REJECTED:<code>`). El SaaS marca `sent` solo `ACCEPTED`/`DUPLICATE`.

**Otras validaciones:**

- Medidor inexistente o `DRAFT` → `UNKNOWN_METER`.
- Cantidad negativa → rechazada. Las correcciones son eventos compensatorios con `meter_code` y `quantity` negativa **solo** si el medidor lo declara (`allows_negative`, por defecto false).

### 11.4 Agregación y cierre de período

1. Los eventos se asignan al período por `occurred_at` (UTC; la zona horaria de facturación es D-10).
2. `usage_period_aggregates` va de `OPEN` a `CLOSING` en `period_end + grace_hours` (ventana técnica de llegada tardía, configurable; no es decisión comercial) y a `FINALIZED` por RPC de finanzas o job.
3. `FINALIZED` guarda `event_count`, `quantity`, `source_hash` (hash del conjunto de `event_id`) y es inmutable.
4. **Eventos tardíos** tras `FINALIZED`: se aceptan con `late=true` y se imputan al **siguiente** período abierto como línea de ajuste. Nunca se reabre un agregado ni una factura emitida.
5. **Tenants DEMO o de certificación sintética:** los eventos se aceptan y agregan, pero `is_billable=false` a nivel de agregado. El guard DEMO existente impide facturarlos (§17).

---

## 12. Semántica del ledger de créditos IA (decisión 12)

1. **Unidad comercial = crédito EBIM.** Cada `AI_FEATURE` tiene un peso en `ai_credit_weights(capability_id, credits_per_unit, unit ∈ {call, page, minute, …}, valid_from, valid_to)`. El peso es configuración y **no se inventa** (D-03).
2. **Consumo:** `créditos = Σ(quantity × peso vigente en occurred_at)`. Se calcula al finalizar el agregado. El peso aplicado se guarda en la entrada del ledger, así un cambio posterior de peso no reescribe la historia.
3. **`ai_credit_ledger`** (append-only por trigger; unique `(tenant_id, entry_idempotency_key)`):

| `entry_type` | Origen | Signo |
| --- | --- | --- |
| `GRANT_PERIOD` | Política del plan o add-on al abrir el período | + |
| `GRANT_PURCHASE` | Compra de paquete (si existe como producto, D-03) | + |
| `CONSUME` | Agregado `FINALIZED` | − |
| `ADJUST` | Finanzas, con motivo obligatorio | ± |
| `EXPIRE` | Política de expiración, si existe (D-04) | − |
| `ROLLOVER_OUT` / `ROLLOVER_IN` | Política de rollover, si existe (D-04) | −/+ |
| `REVERSAL` | Anula una entrada previa por `reverses_entry_id` | ∓ |

4. **Saldo** = suma por `(tenant, pool, período)`. `pool` puede ser por tenant o por producto según `ai_credit_policies.pool_scope` (D-03). Se expone en una vista SECURITY INVOKER.
5. **Exceso:** saldo < 0 al cierre ⇒ la cantidad en exceso genera una línea `USAGE_OVERAGE` (§13) **solo** si `ai_credit_policies.overage_mode = BILL` y existe precio vigente en `catalog_item_prices` para el ítem de exceso. Si falta cualquiera de los dos → `POLITICA_CREDITOS_NO_DEFINIDA`/`TARIFA_ADDON_NO_DEFINIDA`, el agregado queda sin facturar y se alerta a finanzas.
6. **Enforcement local en el SaaS (no autoritativo):**
   - El snapshot lleva `allowances` y `aiCredits.weights`.
   - El SaaS mantiene un contador local del período para pre-chequear antes de llamar al modelo (patrón `ai_consume` con `FOR UPDATE` de eCommerce y GMAO).
   - `overageMode` del snapshot decide si bloquea (`BLOCK`) o permite y avisa (`ALLOW`).
   - Si el valor no está decidido, el snapshot omite la asignación, y el SaaS mantiene su comportamiento legacy hasta `MASTERADMIN_PRIMARY`.
7. **Los tokens nunca son la unidad comercial.** `internal.*` del evento se guarda en `usage_events.internal`, con grant por columna solo para finanzas.
8. **Rollover, expiración, créditos incluidos, precio del crédito y paquetes:** no se deciden aquí (D-02..D-04).

---

## 13. Tipos de cargo de facturación y corrección DISCOUNT (decisión 13)

### 13.1 Tipos de cargo

Enum `charge_kind` existente, más `USAGE_OVERAGE`:

| `charge_kind` | Origen de la línea | Recurrente | Cuenta para comisión |
| --- | --- | --- | --- |
| `LICENSE`, `TENANT_LICENSE`, `PARTNER_BASE_LICENSE` | `subscription_items` del plan | sí | según `commission_basis` (sin cambios) |
| `ADDON` | `subscription_items` con `source_type=ADDON` | sí | igual que hoy (`amount>0`) |
| `IMPLEMENTATION_FEE`, `PROFESSIONAL_SERVICES` | ítem `ONE_TIME` | no | sin cambios |
| `INFRASTRUCTURE_FEE`, `SUPPORT_FEE` | ítem | sí | sin cambios |
| `USAGE_OVERAGE` (**nuevo**) | agregado `FINALIZED` (uso o créditos IA), con `usage_aggregate_id` y `meter_code` | no (variable) | **D-11**. Hasta que se decida, la regla de comisión no lo incluye: `commission_basis` debe listarlo explícitamente |
| `DISCOUNT` | manual, o corrección con `corrects_line_id` | — | ver §13.2 |

**Extensión de `issue_subscription_invoice`:**

- Sigue siendo idempotente por `(subscription, period_start)`.
- Añade las líneas `USAGE_OVERAGE` de agregados `FINALIZED` del período anterior (consumo vencido) no facturados. El vínculo `usage_aggregate_id` es único entre líneas no-VOID, así un agregado nunca se factura dos veces.
- La salida para suscripciones sin uso es **idéntica** a la actual. Es un test de regresión obligatorio.

### 13.2 Corrección DISCOUNT

1. **Factura `DRAFT`:** se corrige editando o eliminando la línea (el flujo actual).
2. **Factura `ISSUED`/`PAID`/`PARTIALLY_PAID`:** es inmutable.
   - La corrección se emite como línea `DISCOUNT` de monto negativo (`quantity < 0` o `unit_amount < 0`; `invoice_lines` ya permite `quantity <> 0`).
   - Va en la **siguiente** factura de la misma suscripción y moneda, con `corrects_line_id` apuntando a la línea original.
   - El monto de la corrección no puede superar el de la línea corregida menos las correcciones previas (`DESCUENTO_EXCEDE_LINEA`).
3. **Nunca se usa `VOID` para corregir** una factura con pagos `CONFIRMED`.
4. **Nota de crédito fiscal** (SUNAT u otra): queda fuera del alcance. Es D-13.
5. **Comisiones.** Hoy `generate_commission_events` solo cuenta líneas `amount > 0` (masteradmin `M/20260913000900:222`), así que un DISCOUNT **no reduce** la base comisionable de la factura corregida ni de la siguiente.
   - Se **mantiene** ese comportamiento.
   - Si la base debe ser neta de descuentos correctivos, se decide en D-11. El mecanismo sería un contra-evento, igual que la reversión existente (`M/20260907000800:10-20`), y nunca una mutación.
6. **Las comisiones siguen generándose solo desde pagos `CONFIRMED`.** Ninguna línea de uso, crédito o descuento crea comisión sin pago confirmado.

---

## 14. Autoridad y grants (decisión 14)

### 14.1 Matriz de autoridad

| Acción | Quién | Mecanismo |
| --- | --- | --- |
| Registrar o importar capacidades | `EBIM_PRODUCT_ADMIN`, super admin | RPC DEFINER `can_manage_platform_entities()` |
| Crear o editar grants plan/add-on | `EBIM_PRODUCT_ADMIN` | RPC DEFINER; grants inmutables salvo `valid_to` |
| Fijar precios de add-on | `EBIM_FINANCE` | RPC DEFINER `can_manage_regional_catalog()` |
| Aprobar, cancelar o reactivar un add-on de tenant | `can_manage_commercial()` (finanzas o product admin) | RPC DEFINER |
| Solicitar un add-on | Tenant, desde el SaaS, o comercial del partner | M2M o lead → `REQUESTED`. **Nunca activa** |
| Override manual | `EBIM_FINANCE` o super admin | RPC DEFINER, con motivo y `expires_at` |
| Suspender o reanudar | `EBIM_FINANCE` | RPC DEFINER |
| Finalizar un agregado o ajustar créditos | `EBIM_FINANCE` | RPC DEFINER |
| Emitir snapshot, push o verify | service_role (job) | `is_service_request()`; EXECUTE solo `service_role` |
| Ingest de uso | Edge function tras verificar el M2M | RPC `ingest_usage_events`, EXECUTE solo `service_role` |
| Leer entitlements de un tenant | platform admin, finanzas, `can_manage_tenant` (solo lectura) | vistas SECURITY INVOKER + RLS |
| Leer COGS IA (`usage_events.internal`) | `EBIM_FINANCE`, super admin | grant por columna |
| Comerciales/partners | Ven el contrato, add-ons y consumo agregado de sus tenants atribuidos. **Nunca acceso operativo** (`my_attributed_tenant_ids` ≠ `my_tenant_ids`) | RLS existente |

### 14.2 Reglas de grants

1. Toda tabla nueva: `revoke all … from public, anon, authenticated`, más un `grant select` explícito y mínimo a `authenticated` filtrado por RLS. Escrituras **solo** por RPC.
2. Funciones SECURITY DEFINER: `set search_path = ''` (o `platform, pg_temp`) y `revoke execute … from public`. Cada una lleva un test pgTAP de privilegios: anon denegado, `authenticated` sin rol denegado y service_role según corresponda.
3. Las vistas de reporte son `SECURITY INVOKER` (`with (security_invoker = true)`).
4. Se corrigen `tenant_addons` y `tenant_features` (P0-MA-1), revocando la escritura directa.
5. Las claves privadas M2M viven solo en los secrets de edge functions, resueltas por `secret_ref` → env (patrón existente). Ninguna tabla nueva guarda secretos.
6. **Del lado SaaS:**
   - Las tablas del snapshot aplicado no dan escritura a roles de tenant.
   - La única escritura es la RPC de aplicación, ejecutable solo por service_role tras verificar el M2M.
   - Esto **reemplaza** los caminos de autoactivación P0-EX-2, P0-GM-1, P0-EC-2 y H-ECO-1.

---

## 15. Máquina de estados dual-read / shadow / cutover (decisión 15)

Hay dos ejes independientes por producto, con opción de acotarlos a una cohorte de tenants: **entitlements** y **facturación**. Se guardan en `product_integrations.cutover_state_*` y, opcionalmente, por tenant en `entitlement_sync_state.cohort_state`.

### 15.1 Eje de entitlements

```
LEGACY_ONLY ─► SHADOW ─► DUAL_READ ─► MASTERADMIN_PRIMARY ─► LEGACY_RETIRED
      ▲           │           │                 │
      └───────────┴───────────┴── rollback ◄────┘   (un paso atrás, siempre permitido)
```

| Estado | Qué hace el SaaS | Criterio para avanzar |
| --- | --- | --- |
| `LEGACY_ONLY` | Decide con su fuente actual (local u hub) | P0 del producto cerrados (§1.4); receptor desplegado; manifiesto importado |
| `SHADOW` | Recibe y guarda el snapshot, **no** lo usa para decidir. Registra la diferencia entre la decisión legacy y la del snapshot (`entitlement_shadow_diffs`) | 100 % de tenants de la cohorte `IN_SYNC`; diffs = 0 o explicados y aprobados durante una ventana de observación (D-14 fija la duración para QAS) |
| `DUAL_READ` | Decide con el snapshot. Si falta (`NONE`), cae a legacy y alerta. Las escrituras legacy siguen permitidas, pero cada una genera alerta | 0 fallbacks durante la ventana; escrituras legacy congeladas por procedimiento |
| `MASTERADMIN_PRIMARY` | Solo el snapshot. Las escrituras legacy de entitlements quedan **bloqueadas** en servidor (revocar grants/RPC) | Verificado en QAS (GATE C) |
| `LEGACY_RETIRED` | Tablas o columnas legacy en solo lectura como archivo; se eliminan caminos de código | Solo tras un ciclo de facturación sin incidentes; nunca en este programa para PRD |

### 15.2 Eje de facturación (billers locales)

Aplica a eExpense `billing-run`, GMAO `charge`/`pay_subscription`/`emit-invoice`, eChange `billing_plans`/`channel_billing_events` y eSupplier `plans.monthly_price`.

```
BILLING_LEGACY ─► BILLING_SHADOW ─► BILLING_PRIMARY ─► BILLING_RETIRED
```

- **`BILLING_SHADOW`**
  - MasterAdmin genera facturas **DRAFT** para los mismos tenants y período.
  - Un reporte compara línea a línea contra el biller local.
  - Nadie cobra desde MasterAdmin.
- **`BILLING_PRIMARY`**
  - El biller local se desactiva **por tenant**, con un flag server-side. Ejemplos: `billing_mode` pasa a un valor nuevo `external` en eExpense, y el cron `billing-monthly` excluye esos tenants.
  - MasterAdmin emite y cobra.
  - Nunca se permiten dos cobradores activos para el mismo tenant y período. Un invariante verificado por reconciliación lo impide.
- **Cutover:** siempre por cohorte. Primero tenants internos y DEMO, luego un piloto, y después el resto.
- **Culqi live** no se usa sin autorización explícita.

### 15.3 Hub GMAO

1. **Importación.** `catalog_items` y `company_addons` del hub se importan a MasterAdmin como **datos de referencia legacy**: `capability_aliases` con `alias_source=GMAO_HUB`, y un reporte de diferencias.
   - La lectura se hace con la Platform Context API o con un export que el operador entrega.
   - **Nunca por `DB_DIRECT`, ni con escritura en el proyecto GMAO**, cuya clasificación es AMBIGUOUS_OR_PRD (GMAO readiness `:24-33`).
   - Los precios del hub no se importan como precios vigentes (D-01).
2. **Consumidores del hub** (eExpense, eSupplier y eCommerce `platform-context`): pasan a leer su snapshot local al entrar en `DUAL_READ`. El hub sigue sirviendo identidad y organizaciones.
3. **Escrituras comerciales del hub** (`platform-register` `set_addon`/`subscribe`, `hub_subscribe`, `activate_catalog_item`): se congelan **por producto** cuando ese producto llega a `MASTERADMIN_PRIMARY`. El congelamiento lo hace GMAO en su repo (fase 16) y solo con su migración versionada.

---

## 16. Estrategia de adaptación por producto (decisión 16)

| Orden | Producto | Estado de partida | Adaptación |
| --- | --- | --- | --- |
| 1 (piloto) | **eCommerce** | Mejor referencia: capacidades, `has_capability`, `sync_platform_context`, `ai_quotas` | Añadir `entitlement_source='masteradmin'`, receptor `PUT/GET entitlements` que reusa la semántica de `sync_platform_context`, y alias 1:1 (ya dot-notation). Mapear `allowances` a `ai_quotas`. Outbox desde `ai_record`. Retirar el modo de clave estática de `platform-context` (H-ECO-1) al pasar a `PRIMARY`. Resolver `legacy_until_synced` (`capability_guard_core.sql:18-36`) cuando el primer snapshot llegue |
| 2 | **EWM** | 8 agentes IA; escritura solo por operador; contrato propio `EWM_V1`; Java + Flyway | Endpoints nuevos en el controller Java bajo `/internal/platform/v1/tenants/{id}/entitlements`, que materializan `company_ai_agents`. Mover `NarrationBudget` (en memoria) a un contador durable. El adaptador `EWM_V1` gana capacidad `SYNC_ENTITLEMENTS` sin tocar el provisioning |
| 3 | **Comerza** | Solo flags `vitrina`/`erp_connector`; agente Gemini sin gate | Registrar `comerza.storefront`, `comerza.erp_connector` y `comerza.ai.whatsapp_agent`. Guardar el agente en servidor (edge y servicio Baileys) contra el snapshot local. Outbox de uso IA |
| 4 | **TMS** | Sin licenciamiento | Receptor mínimo: snapshot con baseline y `appActive`. Registro vacío de sellables. Sirve para validar el contrato en Spring Boot/Flyway. SYNCHRONIZED es trivial en capacidades, pero debe cumplir el resto del §19 |
| 5 | **eSupplier** | Add-ons del hub, gating cliente fail-open, límites fail-open, P0-SU-1/2 | Primero P0 (fase 06). Luego tabla local de snapshot, guardas server-side en las 21 funciones IA (gateway común) y límites de empresas/usuarios en DB. El gating cliente pasa a fail-closed para sellables |
| 6 | **eChange** | `ai_agents.enabled` con autoactivación del owner; canales add-on; `billing_plans` local | Primero P0 (fase 06). `enabled` pasa a ser `snapshot ∧ flag_local` (el owner solo puede apagar). Canales como capacidades. `billing_plans` al eje de facturación (shadow). Outbox desde `callClaude` (hoy descarta el uso) |
| 7 | **eExpense** | Biller local completo, autoactivación, IA sin auth, webhook sin firma | Primero P0 (fase 04). Snapshot local que sustituye `tenant_addons` como fuente de decisión. Guardas server-side en las 9 funciones IA. Eje de facturación en el orden `BILLING_SHADOW` → `PRIMARY`, por tenant. Cuidado con el cliente CMH en el proyecto etiquetado DEV/QAS (readiness `:95`): tratarlo como productivo, sin cambios de cobro fuera de GATE C |
| 8 | **GMAO** | Producto (plans con límites no aplicados, `ai_assist` autoasignable) + hub | Primero P0 (fase 05). Snapshot → `platform.tenant_addons` local + `ai_usage` + límites aplicados en DB. El hub, como se describe en el §15.3 |

Ningún producto se modifica sin leer antes su `CLAUDE.md` y sus convenciones de migración (Flyway en TMS y en parte de EWM; Supabase CLI en el resto). En los repos con drift de historial de migraciones (GMAO, eExpense, eChange) **no se usa `db push`**. Toda aplicación remota es un paso de operador fuera de este programa, salvo en QAS con GATE C.

---

## 17. Separación LOCAL / DEV / QAS / PRD (decisión 17)

| Entorno | Qué ocurre | Límites |
| --- | --- | --- |
| LOCAL | Supabase local de MasterAdmin y de cada SaaS; integraciones `MOCK`; claves M2M de desarrollo generadas localmente | Nunca `link`/`push`/`reset` contra Supabase remoto |
| DEV | Push de ramas; certificación 8/8 DEV con tenants sintéticos DEMO | Todo lo sintético es `tenant_type=DEMO`, no facturable, con emails `*@ebim.test` |
| QAS | Solo con `PROMOTE_COMMERCIAL_CONTROL_PLANE_TO_QAS=YES` | Culqi en modo test; biller local de eExpense/GMAO sin cambios salvo cohorte DEMO |
| PRD | **Fuera del alcance** | — |

**Aislamiento entre entornos:**

- Cada entorno tiene claves M2M, `aud`/`iss` y `credential_profiles` propios.
- El snapshot y el ingest llevan `environment`; los receptores rechazan un entorno cruzado.
- `provisioning_environment` (DEV/QAS/DEMO/PRD) ya existe en MasterAdmin y se reusa.

---

## 18. Modos de falla y rollback (decisión 18)

| Falla | Efecto | Mitigación / rollback |
| --- | --- | --- |
| MasterAdmin caído | Sin push ni ingest | El SaaS sigue con el último snapshot válido. El outbox acumula eventos y reintenta con backoff; son idempotentes |
| SaaS caído durante el push | `UNREACHABLE` | Reintento; la versión es monótona, así que no hay doble aplicación |
| Push aplicado pero respuesta perdida | `AWAITING_VERIFY` | El `GET` lo resuelve; un re-push de la misma versión devuelve 200 `replayed` |
| Snapshot fuera de orden | — | `STALE_SNAPSHOT`; nunca revoca lo concedido después |
| Checksum distinto con la misma versión | Corrupción o bug | `DRIFT_CHECKSUM`: incidente y emisión de una versión nueva, sin sobrescribir |
| Error en un grant (revocación masiva no deseada) | Pérdida de capacidades | Kill-switch `entitlements_push_enabled` por producto. Rollback del eje a `DUAL_READ`/`SHADOW` (el SaaS vuelve a legacy). Versión correctora nueva. Los datos del SaaS no se borran nunca (§10) |
| Capacidad desconocida en el SaaS | — | No se concede; `IN_SYNC_WITH_WARNINGS` + `REGISTRY_DRIFT` |
| Evento de uso duplicado o conflictivo | — | `DUPLICATE` aceptado; `CONFLICT` rechazado y alertado |
| Evento tardío | — | Ajuste en el período siguiente (§11.4) |
| Agregado finalizado erróneo | Factura incorrecta | DISCOUNT correctivo (§13.2) y `REVERSAL`/`ADJUST` en el ledger. Nunca se muta |
| Doble cobrador en el cutover de facturación | Doble cobro | Invariante de reconciliación. Si falla, el tenant vuelve a `BILLING_LEGACY` y se anulan las facturas DRAFT de MasterAdmin |
| Clave M2M comprometida | Snapshots o uso falsos | Rotación por `secret_ref` y `kid`. `jti` de uso único. Scopes separados (escritura de entitlements ≠ provisioning) |
| Migración aditiva con problema | — | Toda migración es aditiva. El rollback es desactivar funciones nuevas o revocar grants; nunca `DROP` de datos comerciales |

---

## 19. Definición exacta de "SYNCHRONIZED" (decisión 19)

### 19.1 Un producto `P` en un entorno `E`

`P` está **SYNCHRONIZED en E** si y solo si se cumplen **todas** estas condiciones, verificadas por un script de certificación reproducible cuya salida se archiva como evidencia:

1. **Seguridad:** 0 hallazgos P0 abiertos en `P` (§1.4), con evidencia de test.
2. **Contrato:** `PUT`/`GET entitlements` y `GET manifest` desplegados en `E`. Tests de contrato verdes para `STALE_SNAPSHOT`, `VERSION_CONFLICT`, `CHECKSUM_MISMATCH`, `ENVIRONMENT_MISMATCH`, scope incorrecto (403), `jti` reutilizado (401) y replay idéntico (200 `replayed`).
3. **Registro:** el manifiesto de `P` y `product_capabilities` de `P` son iguales (conjunto de códigos `ACTIVE`, en ambas direcciones); `REGISTRY_DRIFT = 0`.
4. **Estado:** para **cada** tenant con `tenant_product_mappings` ACTIVE de `P` en `E`, `entitlement_sync_state.state = IN_SYNC`, verificado por `GET` (no por la respuesta del push) con `last_verified_at` posterior al último cambio de estado deseado.
5. **Enforcement:** tests automatizados en el SaaS demuestran, para cada capacidad sellable (o una muestra estratificada ≥ 1 por módulo si hay > 20):
   - (a) denegada server-side con `enabled:false`, aunque el cliente la fuerce;
   - (b) permitida con `enabled:true`;
   - (c) la decisión se mantiene con MasterAdmin inalcanzable.
6. **Cutover:** el eje de entitlements de `P` en `E` está en `MASTERADMIN_PRIMARY`, y las escrituras legacy de entitlements están bloqueadas server-side (test negativo).
7. **Uso:** si `P` tiene medidores `ACTIVE`, se demostró que outbox → ingest → agregado `FINALIZED` funciona, que un reenvío es idempotente (mismo `event_id` → `DUPLICATE`) y que un tenant no mapeado es rechazado. Si no tiene medidores, este punto no aplica y se registra como tal.
8. **Facturación:** si `P` tenía biller local, su eje está en `BILLING_SHADOW` o superior con un reporte de diferencias = 0 para el período certificado; en `E` = DEV/QAS, sin cobro real. Si no lo tenía, no aplica.

### 19.2 "8/8 SYNCHRONIZED" en un entorno `E`

- Los 8 productos (EWM, eSupplier, TMS, Comerza, eChange, eExpense, eCommerce, GMAO) cumplen el §19.1 **en el mismo entorno y en una misma corrida** de certificación, con una ventana ≤ 24 h entre el primer y el último `GET` verificado.
- Además:
  - una corrida global de `entitlement-verify` no reporta drift;
  - una factura DRAFT de prueba por producto facturable, generada desde agregados `FINALIZED` de tenants sintéticos no facturables, cuadra con la suma de líneas esperada.
- Quedan explícitamente **excluidos** de "8/8" el hub GMAO de identidad y PRD.

---

## 20. Decisiones de negocio que NO se inventan (decisión 20)

Hasta que un humano las decida, cada una queda como configuración vacía y el sistema falla cerrado donde afecte cobro.

| ID | Decisión pendiente | Comportamiento mientras no se decida |
| --- | --- | --- |
| D-01 | Precios de add-ons por mercado y moneda. Las listas USD de los documentos, `catalog_items.price_month` y los precios de eExpense, eChange, EWM y del hub **no** se cargan automáticamente | `TARIFA_ADDON_NO_DEFINIDA` al activar en suscripción no-DEMO |
| D-02 | Precio del crédito IA y del exceso de créditos | Sin línea `USAGE_OVERAGE`; alerta a finanzas |
| D-03 | Créditos incluidos por plan o add-on, pesos por capacidad, paquetes, pool por tenant o por producto | Sin asignación en el snapshot; el SaaS sigue en legacy para cuota IA |
| D-04 | Rollover y expiración de créditos | Sin entradas `ROLLOVER`/`EXPIRE` |
| D-05 | Valores de límites (usuarios, empresas, activos, almacenes…) por plan. Los actuales de GMAO, eSupplier y eExpense no se importan sin aprobación | Sin `LIMIT` en el snapshot, sin enforcement nuevo |
| D-06 | Qué medidores son facturables y su unidad (p. ej. EWM por almacén, contrato §11.1) | `is_billable=false` |
| D-07 | Política de impago: gracia, suspensión, qué capacidades se retiran | Suspensión solo manual |
| D-08 | Política de datos al perder un entitlement (lectura, retención) y ajuste por límite bajado | Solo lectura, sin borrado, *grandfather* |
| D-09 | Repricing de add-ons existentes al cambiar el precio | Precio congelado hasta decisión explícita |
| D-10 | Zona horaria y calendario del período de uso | UTC, mes calendario (técnico, revisable) |
| D-11 | Si `USAGE_OVERAGE` y los DISCOUNT correctivos afectan la base de comisión | Sin cambios: el overage no comisiona salvo configuración y el DISCOUNT no reduce |
| D-12 | Aceptar la desviación del contrato §2.6 para ingest de uso (credencial por producto + validación de mapping) | Ingest desactivado hasta aprobación |
| D-13 | Nota de crédito fiscal y tratamiento de impuestos por país (IGV, IVA, etc.) | Fuera del alcance; `tax_amount` como hoy |
| D-14 | Duración de las ventanas de observación de shadow y dual-read por entorno | No se avanza de estado sin aprobación humana explícita |
| D-15 | Precio y paquete de los códigos "próximamente" (`travel_advanced`, `sap_integration`, `echange_voice`, …) y de los 24 ítems eCommerce con `price_month=0` en el hub | `lifecycle_status=COMING_SOON`/`DRAFT`, no activables |

---

## 21. Autorrevisión

- **Placeholders.** No hay `TBD` fuera de la tabla D-xx. Los valores numéricos de §7.1 están marcados como ilustrativos.
- **Contradicciones revisadas:**
  - "El SaaS no depende de MasterAdmin" y "revocación por snapshot" son compatibles: sin expiración, la revocación es explícita (§8.4, §10).
  - "Tenant derivado de la credencial" (§2.6) frente al ingest por producto: la desviación está declarada como D-12 y el ingest queda desactivado hasta su aprobación.
  - "DISCOUNT" y comisiones: se preserva el comportamiento existente; el cambio va a D-11.
  - La definición de SYNCHRONIZED exige `MASTERADMIN_PRIMARY`, que solo se alcanza tras SHADOW y DUAL_READ. No hay atajo.
- **Riesgo de big-bang:**
  - No hay migración de datos comerciales masiva.
  - Cada eje avanza por producto y cohorte, con rollback de un paso.
  - Los billers locales nunca se apagan globalmente: el cutover es por tenant.
  - El hub GMAO se congela por producto.
  - CREATE/REPLAY/GET de provisioning quedan intactos (tests de "antes = después").
- **Riesgos residuales que el plan (GATE B) debe tratar:**
  - Drift de historial de migraciones en GMAO, eExpense y eChange: las aplicaciones remotas son solo del operador.
  - El proyecto eExpense etiquetado DEV/QAS sirve a un cliente productivo.
  - EWM usa un contrato propio (`EWM_V1`).
  - Los códigos de catálogo del hub para apps distintas de eCommerce no están en git: su importación depende de un export del operador.
