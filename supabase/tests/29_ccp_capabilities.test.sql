-- ============================================================================
-- EBIM Commercial Control Plane · Fase 07 · registro de capacidades
-- (Tasks MA-10 enum USAGE_OVERAGE, MA-11 product_capabilities / aliases)
-- ----------------------------------------------------------------------------
-- Spec §3.2 (charge_kind + USAGE_OVERAGE), §4 (registro), §14 (autoridad).
-- Todo se revierte al final (rollback).
-- ============================================================================
begin;
select plan(1);

-- ---------------------------------------------------------------------------
-- MA-10 · cargo por exceso de uso (spec §13.1): valor de enum aditivo.
-- ---------------------------------------------------------------------------
select ok(
  'USAGE_OVERAGE' = any(enum_range(null::platform.charge_kind)::text[]),
  'platform.charge_kind admite USAGE_OVERAGE');

select * from finish();
rollback;
