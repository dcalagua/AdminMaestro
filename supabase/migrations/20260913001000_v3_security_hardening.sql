-- ============================================================================
-- EBIM Control Plane V3 — 33 · Reauditoría de seguridad multicurrency
-- ----------------------------------------------------------------------------
-- Fase 16 de `.claude-prompts-v3-multicurrency`. Cierra G-33 (junto con la
-- migración 26) y aplica «grants mínimos» a lo que la auditoría encontró:
--
--   H-1 · `generate_commission_events(uuid)` era ejecutable por cualquier
--         `authenticated`. Solo la invoca el trigger `payments_generate_commissions`
--         (función SECURITY DEFINER, que corre como owner): un usuario no tiene
--         por qué poder dispararla. Se retira el EXECUTE salvo a service_role.
--   H-2 · Las funciones de TRIGGER conceden EXECUTE a `authenticated` por el
--         patrón de grants de V2/V3. No hace falta: PostgreSQL no comprueba
--         EXECUTE al disparar un trigger, y una función de trigger no se puede
--         llamar directamente. Se retira a PUBLIC, anon y authenticated.
--   H-3 · `on_payment_confirmed()` y `normalize_agreement_modes()` (baseline/V2)
--         seguían ejecutables por PUBLIC. Mismo tratamiento que H-2.
--
-- No se modifica ninguna migración anterior: solo privilegios.
-- ============================================================================

-- H-1
revoke all on function platform.generate_commission_events(uuid) from public, anon, authenticated;
grant execute on function platform.generate_commission_events(uuid) to service_role;

comment on function platform.generate_commission_events(uuid) is
  'Devenga comisión desde un COBRO confirmado, en la moneda del cobro. Importes fijos y topes '
  'solo se aplican a cobros en la moneda de la regla. Idempotente. Solo la invoca el trigger '
  'de pagos (y service_role): no es una RPC de usuario.';

-- H-2 y H-3: toda función de trigger del schema platform.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'platform'
       and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;
