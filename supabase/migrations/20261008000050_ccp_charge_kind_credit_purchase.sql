-- ============================================================================
-- EBIM Commercial Control Plane · Fase 18 · cargo CREDIT_PURCHASE (Task MA-60)
-- ----------------------------------------------------------------------------
-- Prompt de la fase 18: la facturación distingue la compra de créditos IA
-- (spec §12.3 GRANT_PURCHASE) de un add-on o de un exceso de uso. La spec
-- §13.1 no listaba este tipo: es una extensión aditiva registrada en el ledger
-- del programa. Precio, créditos por paquete y comisión siguen siendo
-- decisiones humanas (D-02, D-03, D-11): nada se siembra.
--
-- Migración AISLADA a propósito (mismo patrón que USAGE_OVERAGE,
-- 20260929000100): un valor nuevo de enum no puede usarse en la transacción
-- que lo crea.
--
-- Rollback: no existe DROP VALUE. El valor queda sin uso (plan §15).
-- Test: supabase/tests/41_ccp_billing_usage.test.sql.
-- ============================================================================

alter type platform.charge_kind add value if not exists 'CREDIT_PURCHASE';
