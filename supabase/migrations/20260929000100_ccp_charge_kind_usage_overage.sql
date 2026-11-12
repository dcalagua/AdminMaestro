-- ============================================================================
-- EBIM Commercial Control Plane · Fase 07 · cargo USAGE_OVERAGE (Task MA-10)
-- ----------------------------------------------------------------------------
-- Spec §3.2 / §13.1: el exceso sobre una asignación de uso se factura con un
-- tipo de cargo propio. Plan §4 fila 3.
--
-- Migración AISLADA a propósito: un valor nuevo de enum no puede usarse en la
-- misma transacción que lo crea (Postgres: "unsafe use of new value"). Las
-- migraciones siguientes (catalog_item_prices) ya lo referencian.
--
-- Rollback: no existe DROP VALUE. El valor queda sin uso (plan §15).
-- Test: supabase/tests/29_ccp_capabilities.test.sql (parte MA-10).
-- ============================================================================

alter type platform.charge_kind add value if not exists 'USAGE_OVERAGE';
