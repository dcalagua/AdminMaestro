-- ============================================================================
-- Rollback de la fase 17 (EBIM Commercial Control Plane) — NO es una migración.
-- ----------------------------------------------------------------------------
-- Plan §15 fila 17: "flag de ingest off; outbox acumula; eventos idempotentes".
-- Migraciones 20261005000100…0300 + Edge Function usage-ingest. El rollback
-- DESACTIVA, nunca borra: usage_events, agregados, alertas y ledger de créditos
-- son append-only y se conservan como evidencia.
-- Se aplica a mano, solo con decisión humana registrada en el ledger, primero
-- sobre una base LOCAL/desechable. Además, en la Edge Function:
--   USAGE_INGEST_ENABLED=false (o sin definir) → 503 USAGE_INGEST_DISABLED.
--
-- Efecto:
--   A. Kill-switch de ingest por producto apagado y credenciales de ingest
--      deshabilitadas: los SaaS reciben 503/403, NO descartan eventos (FIX-USG-v1
--      §4) y su outbox acumula con backoff.
--   B. EXECUTE revocado: ingest, cierre, finalización, créditos, pesos y
--      políticas. Nadie puede mover dinero ni créditos mientras dure.
--   C. aiCredits del snapshot vuelve a emitirse vacío (expresión original de la
--      fase 08); los tenants enrolados quedan dirty para re-emitir.
--   D. Lectura intacta (tablas y vistas) para diagnóstico y reconciliación.
--   E. provisioning y entitlements (fases 07/08) no se tocan.
-- ============================================================================
begin;

-- ---- A · interruptores -------------------------------------------------------
update platform.product_integrations set usage_ingest_enabled = false where usage_ingest_enabled;
update platform.usage_ingest_credentials set enabled = false where enabled;
select platform.log_audit('USAGE_ROLLBACK_PHASE_17', 'platform', 'usage', null, null,
                          jsonb_build_object('runbook', 'docs/runbooks/ccp-rollback/17.sql'));

-- ---- B · EXECUTE ---------------------------------------------------------------
revoke execute on function platform.ingest_usage_events(text, text, jsonb, uuid) from service_role;
revoke execute on function platform.consume_m2m_jti(text, text, timestamptz) from service_role;
revoke execute on function platform.usage_ingest_credential(text) from service_role;
revoke execute on function platform.close_usage_periods(timestamptz) from service_role;
revoke execute on function platform.finalize_due_usage_aggregates(integer) from service_role;
revoke execute on function platform.finalize_usage_aggregate(uuid) from authenticated, service_role;
revoke execute on function platform.open_ai_credit_period(uuid, date) from authenticated, service_role;
revoke execute on function platform.record_ai_credit_entry(uuid, text, date, text, numeric, text, text) from authenticated;
revoke execute on function platform.reverse_ai_credit_entry(uuid, text) from authenticated;
revoke execute on function platform.reserve_ai_credits(uuid, text, date, numeric, text) from service_role;
revoke execute on function platform.release_ai_credit_reservation(uuid) from service_role;
revoke execute on function platform.expire_ai_credits(uuid, text, date) from authenticated, service_role;
revoke execute on function platform.set_ai_credit_weight(text, numeric, text, timestamptz, text) from authenticated;
revoke execute on function platform.create_ai_credit_policy(text, text, text, numeric, text, date, text) from authenticated;
revoke execute on function platform.upsert_usage_meter(text, text, text, text, text, text, text, text, boolean, integer) from authenticated;
revoke execute on function platform.set_usage_meter_billable(text, text, boolean, text) from authenticated;
revoke execute on function platform.configure_usage_ingest_credential(text, platform.provisioning_environment, text, text, boolean, text, text) from authenticated;
revoke execute on function platform.set_usage_ingest_enabled(text, boolean, text) from authenticated;

-- ---- C · aiCredits del snapshot vuelve a vacío --------------------------------
do $$
declare
  v_def text := pg_get_functiondef('platform.entitlement_snapshot_content(uuid, uuid, timestamptz)'::regprocedure);
  v_cur text := 'platform.ai_credit_weights_snapshot(p_product_id, p_at)';
  v_orig text := $x$jsonb_build_object('weights', '[]'::jsonb, 'weightsVersion', 0)$x$;
begin
  if position(v_cur in v_def) > 0 then
    execute replace(v_def, v_cur, v_orig);
  end if;
end;
$$;
select platform.mark_entitlements_dirty(d.tenant_id, d.saas_product_id, 'ROLLBACK_FASE_17')
  from platform.entitlement_desired_state d
 where exists (select 1 from platform.ai_credit_weights w
                 join platform.product_capabilities c on c.id = w.capability_id
                where c.saas_product_id = d.saas_product_id);

commit;
