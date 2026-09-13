# V3 · Reauditoría de seguridad multicurrency (fase 16)

> Evidencia: `supabase/tests/16_v3_security_rls.test.sql` (42 tests) y consultas de catálogo
> ejecutadas sobre el stack local el 2026-09-13. Migración correctiva:
> `20260913001000_v3_security_hardening.sql`.

## 1. Inventario V3

| Tipo | Objetos | Control |
|---|---|---|
| Tablas | `currencies`, `markets`, `market_currencies`, `payment_provider_account_currencies`, `exchange_rates`, `control_plane_settings` | RLS + FORCE; `authenticated` solo SELECT; escritura únicamente por RPC |
| Columnas nuevas | `companies.market_id`, `plan_prices.market_id`, `subscriptions.market_id`, `payment_provider_accounts.market_id/routing_priority` | Guards por trigger (coherencia de mercado/moneda, inmutabilidad) |
| Vistas | `v_company_markets`, `v_plan_price_catalog`, `v_currency_integrity_issues`, `v_provider_account_routes`, `v_finance_facts` + redefinidas `v_tenant_overview`, `v_product_margin`, `v_partner_margin`, `v_tenant_margin`, `v_partner_agreements` | `security_invoker = true` (10/10) |
| RPC de escritura (SECURITY DEFINER, `search_path = platform, pg_catalog`, autorización en la primera línea) | `upsert_currency`, `upsert_market` (finanzas/super admin) · `upsert_company` (plataforma u org admin) · `set_plan_price` (producto/super admin) · `create_subscription`, `onboard_customer_subscription` (comercial EBIM) · `upsert_catalog_item` (producto) · `set_subscription_collection_profile` (comercial EBIM u org admin de quien paga) · `upsert_payment_provider_account`, `set_exchange_rate`, `void_exchange_rate`, `set_reporting_settings`, `settle_commissions`, `upsert_commission_rule` (finanzas/super admin) | pgTAP negativos por rol |
| Lecturas (SECURITY INVOKER: respetan RLS del llamante) | `current_plan_price`, `plan_has_regional_price`, `provider_account_candidates`, `fx_rate_lookup`, `fx_convert`, `reporting_settings`, `to_reporting_amount`, `finance_reporting_rows`, `finance_consolidated`, `dashboard_summary` | Un partner o tenant sin acceso a tasas obtiene `MISSING`, nunca una conversión |

Lectura del catálogo regional (mercados, monedas): cualquier `authenticated`, sin escritura. Tasas
de cambio: plataforma o finanzas. Moneda de reporte: legible por autenticados (no es sensible),
modificable solo por finanzas/super admin.

## 2. Hallazgos y corrección

| Id | Hallazgo | Severidad | Corrección |
|---|---|---|---|
| H-1 | `generate_commission_events(uuid)` ejecutable por cualquier `authenticated`: un usuario podía disparar el devengo, que solo debe nacer del trigger de cobro | MEDIA | EXECUTE retirado salvo `service_role` (migración 33) |
| H-2 | Funciones de trigger V3 con EXECUTE para `authenticated` por patrón de grants | BAJA | Retirado a PUBLIC/anon/authenticated. Verificado empíricamente que un trigger se dispara aunque el rol no tenga EXECUTE |
| H-3 | `on_payment_confirmed()` y `normalize_agreement_modes()` (baseline/V2) ejecutables por PUBLIC | BAJA | Mismo tratamiento, sin editar migraciones antiguas |
| G-33 | `current_plan_price` SECURITY DEFINER exponía tarifas ocultas por RLS | MEDIA | SECURITY INVOKER (migración 26) |
| DV3-011 | `upsert_payment_provider_account` (V2) auditaba `has_secret_ref` y el guard anti-secretos lo rechazaba: la RPC nunca completaba | MEDIA (disponibilidad) | Clave `server_credential_configured` (migración 28) |

## 3. Frontend

- Sin `service_role` en `src/` (solo comentarios que lo prohíben); `npm run secrets:scan` PASS.
- Toda escritura V3 de la UI pasa por RPC (`src/services/mutations.ts`); la UI de cobranza ya no
  envía `provider_account_id` (routing en servidor).
