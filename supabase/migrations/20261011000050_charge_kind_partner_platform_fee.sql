-- ============================================================================
-- MasterAdmin · M3 · cargo PARTNER_PLATFORM_FEE
-- ----------------------------------------------------------------------------
-- Spec §4.3: la factura consolidada que EBIM emite al partner por usar la
-- plataforma lleva líneas PARTNER_PLATFORM_FEE (por tenant y producto). Es un
-- flujo partner → EBIM, distinto de commission_events (EBIM → vendedores).
--
-- Migración AISLADA a propósito (mismo patrón que USAGE_OVERAGE y
-- CREDIT_PURCHASE): un valor nuevo de enum no puede usarse en la transacción
-- que lo crea.
--
-- Rollback: no existe DROP VALUE. El valor queda sin uso.
-- Test: supabase/tests/47_partner_platform_fee.test.sql.
-- ============================================================================

alter type platform.charge_kind add value if not exists 'PARTNER_PLATFORM_FEE';
