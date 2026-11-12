-- ============================================================================
-- Rollback de la fase 08 (EBIM Commercial Control Plane) — NO es una migración.
-- ----------------------------------------------------------------------------
-- Plan §15 fila 08: migraciones 20260930000100…0400 + funciones. El rollback
-- DESACTIVA, nunca borra: snapshots (append-only), estado de sync, bitácora,
-- registry checks e historial de cutover se conservan como evidencia.
-- FIX-ENT-v1 es inmutable (una corrección es v1.1 aditivo).
-- Se aplica a mano, solo con decisión humana registrada en el ledger, primero
-- sobre una base LOCAL/desechable.
--
-- Efecto:
--   A. Kill-switch: ninguna integración empuja snapshots.
--   B. Ejes de entitlements a LEGACY_ONLY (con evento en el historial): los
--      tenants quedan NOT_ENROLLED. Cada SaaS vuelve a su fuente legacy según
--      su enforcement_mode (spec §15.1); su último snapshot aplicado se
--      conserva y NO se borra ningún dato.
--   C. El job y el orquestador dejan de poder emitir, reclamar o registrar
--      (EXECUTE revocado a service_role); los humanos dejan de poder disparar
--      sync o mover ejes (EXECUTE revocado a authenticated).
--   D. Lectura intacta (tablas y v_entitlement_sync_status) para diagnóstico.
--   E. provisioning (PROVISION / GET_STATUS / REPLAY_CERTIFICATION) no se toca.
-- ============================================================================
begin;

-- ---- A + B · kill-switch y ejes, con rastro ---------------------------------
insert into platform.commercial_cutover_events
  (product_integration_id, axis, from_state, to_state, reason, actor_user_id)
select id, 'PUSH_KILL_SWITCH', 'ON', 'OFF', 'ROLLBACK fase 08 (docs/runbooks/ccp-rollback/08.sql)', null
  from platform.product_integrations where entitlements_push_enabled;
insert into platform.commercial_cutover_events
  (product_integration_id, axis, from_state, to_state, reason, actor_user_id)
select id, 'ENTITLEMENTS', cutover_state_entitlements, 'LEGACY_ONLY',
       'ROLLBACK fase 08 (docs/runbooks/ccp-rollback/08.sql)', null
  from platform.product_integrations where cutover_state_entitlements <> 'LEGACY_ONLY';

update platform.product_integrations
   set entitlements_push_enabled = false, cutover_state_entitlements = 'LEGACY_ONLY'
 where entitlements_push_enabled or cutover_state_entitlements <> 'LEGACY_ONLY';

update platform.entitlement_sync_state
   set cohort_state = null, state = 'NOT_ENROLLED', state_reason = 'ROLLBACK_08', state_changed_at = now(),
       pushing_version = null, lease_owner = null, lease_until = null
 where state <> 'NOT_PROVISIONED';

-- ---- C · sin EXECUTE -----------------------------------------------------------
revoke execute on function
  platform.issue_entitlement_snapshot(uuid, uuid, timestamptz),
  platform.refresh_entitlement_sync_state(uuid, uuid),
  platform.claim_entitlement_pushes(text, integer, integer),
  platform.claim_entitlement_push_for(uuid, uuid, text, integer),
  platform.record_entitlement_push_result(uuid, uuid, text, bigint, jsonb),
  platform.claim_entitlement_verifications(text, integer, integer, interval),
  platform.claim_entitlement_verification_for(uuid, uuid, text, integer),
  platform.record_entitlement_verify_result(uuid, uuid, text, jsonb),
  platform.record_entitlement_registry_check(uuid, text, text[]),
  platform.entitlement_delivery_context(uuid, uuid),
  platform.entitlement_issue_candidates(integer, boolean),
  platform.entitlement_registry_targets()
from service_role;

revoke execute on function
  platform.can_sync_entitlements(uuid),
  platform.can_read_entitlement_sync(uuid),
  platform.configure_entitlements_integration(uuid, text, text, text, text),
  platform.set_commercial_cutover_state(uuid, text, text, text),
  platform.set_entitlements_push_enabled(uuid, boolean, text)
from authenticated, service_role;

commit;

-- Re-habilitar = re-aplicar los GRANT de las migraciones 20260930000100…0400
-- (sección "revoke/grant" de cada una) y volver a enrolar con
-- set_commercial_cutover_state + set_entitlements_push_enabled (runbook
-- docs/runbooks/entitlement-sync.md §2). Ningún dato hay que restaurar.
