-- ============================================================================
-- EBIM Commercial Control Plane · Fase 17 · créditos IA (MA-53)
-- ----------------------------------------------------------------------------
-- Spec §12: unidad comercial = crédito EBIM; peso por capacidad AI_FEATURE con
-- vigencia (D-03, no se inventa: aquí son valores SINTÉTICOS de la prueba, en
-- una transacción que se revierte); consumo = Σ(cantidad × peso vigente en
-- occurred_at) al FINALIZAR el agregado, con el peso guardado en la entrada;
-- ledger append-only con clave de idempotencia; saldo por tenant × pool ×
-- período (vista security_invoker); REVERSAL; sin ROLLOVER/EXPIRE sin
-- política (D-04); sin política → POLITICA_CREDITOS_NO_DEFINIDA; exceso con
-- BLOCK/ALLOW → alerta (nunca factura en esta fase).
-- Plan §4 fila 19, §12.1 MA-53. Migración 20261005000300_ccp_ai_credits.
-- ============================================================================
begin;
select plan(68);

create or replace function pg_temp.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$$;
create or replace function pg_temp.act_as_service()
returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
end;
$$;
create or replace function pg_temp.act_as_postgres()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.esup() returns uuid language sql as $$ select '20000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.alpha() returns uuid language sql as $$ select '50000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.demo() returns uuid language sql as $$ select '50000000-0000-4000-a000-000000000004'::uuid $$;
create or replace function pg_temp.padmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.finance() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000003'::uuid $$;
create or replace function pg_temp.tadmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000009'::uuid $$;
create or replace function pg_temp.m(k int) returns date language sql as $$
  select (date_trunc('month', now() at time zone 'UTC') + make_interval(months => k))::date
$$;
create or replace function pg_temp.ts(k int, p_day int) returns timestamptz language sql as $$
  select (pg_temp.m(k) + (p_day - 1))::timestamp at time zone 'UTC' + interval '12 hours'
$$;
create or replace function pg_temp.call(p_meter text, p_cap text, p_at timestamptz, p_tenant uuid default null) returns jsonb language sql as $$
  select jsonb_build_object('eventId', gen_random_uuid()::text, 'meterCode', p_meter, 'quantity', 1, 'unit', 'call',
    'occurredAt', to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'controlPlaneTenantId', coalesce(p_tenant, pg_temp.alpha())::text, 'capabilityCode', p_cap)
$$;
create or replace function pg_temp.agg(p_meter text, k int, p_tenant uuid default null) returns uuid language sql as $$
  select a.id from platform.usage_period_aggregates a
   where a.tenant_id = coalesce(p_tenant, pg_temp.alpha()) and a.meter_code = p_meter and a.period_start = pg_temp.m(k)
$$;
create or replace function pg_temp.bal(k int, p_pool text default 'TENANT') returns platform.v_ai_credit_balances language sql as $$
  select b.* from platform.v_ai_credit_balances b
   where b.tenant_id = pg_temp.alpha() and b.pool_key = p_pool and b.period_start = pg_temp.m(k)
$$;

-- ---------------------------------------------------------------------------
-- Forma y privilegios
-- ---------------------------------------------------------------------------
select has_table('platform', 'ai_credit_weights', 'Existe ai_credit_weights');
select has_table('platform', 'ai_credit_policies', 'Existe ai_credit_policies');
select has_table('platform', 'ai_credit_ledger', 'Existe ai_credit_ledger');
select is(
  (select string_agg(c.relname || ':' || (c.relrowsecurity and c.relforcerowsecurity)::text, ',' order by c.relname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform' and c.relname in ('ai_credit_weights', 'ai_credit_policies', 'ai_credit_ledger')),
  'ai_credit_ledger:true,ai_credit_policies:true,ai_credit_weights:true', 'RLS habilitado y forzado');
select is(
  (select string_agg(t || ':' || has_table_privilege('authenticated', 'platform.' || t, 'insert,update,delete'), ',' order by t)
     from unnest(array['ai_credit_weights', 'ai_credit_policies', 'ai_credit_ledger']) t),
  'ai_credit_ledger:false,ai_credit_policies:false,ai_credit_weights:false', 'Escrituras solo por RPC');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'platform' and c.relname = 'v_ai_credit_balances'
              and c.reloptions @> array['security_invoker=true']), 1, 'v_ai_credit_balances es security_invoker');
select is(
  (select string_agg(r || ':' || has_function_privilege(r, 'platform.open_ai_credit_period(uuid, date)', 'execute'), ',' order by r)
     from unnest(array['anon', 'authenticated', 'service_role']) r),
  'anon:false,authenticated:true,service_role:true', 'open_ai_credit_period: finanzas (gate) o service_role');
select is(
  (select string_agg(r || ':' || has_function_privilege(r, 'platform.reserve_ai_credits(uuid, text, date, numeric, text)', 'execute'), ',' order by r)
     from unnest(array['anon', 'authenticated', 'service_role']) r),
  'anon:false,authenticated:false,service_role:true', 'reserve_ai_credits: solo service_role');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform' and p.prosecdef
      and p.proname in ('set_ai_credit_weight', 'create_ai_credit_policy', 'open_ai_credit_period', 'record_ai_credit_entry',
                        'reverse_ai_credit_entry', 'reserve_ai_credits', 'release_ai_credit_reservation', 'expire_ai_credits')
      and array_to_string(p.proconfig, ',') = 'search_path=platform, pg_catalog'),
  8, 'Las 8 RPCs son DEFINER con search_path fijo');
select is((select count(*)::int from platform.ai_credit_weights) + (select count(*)::int from platform.ai_credit_policies)
          + (select count(*)::int from platform.ai_credit_ledger), 0,
  'Nada sembrado: sin pesos, políticas ni créditos (D-02/D-03)');

-- ---------------------------------------------------------------------------
-- Escenario
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.padmin());
select platform.import_capability_manifest('esupplier', '{
  "schema": "ebim.capabilities/v1", "productCode": "esupplier", "manifestVersion": "qa-17c",
  "capabilities": [
    {"code": "esupplier.qa.ai.copilot", "name": "QA copiloto", "kind": "AI_FEATURE", "meterCode": "esupplier.qa.ai.calls", "status": "ACTIVE"},
    {"code": "esupplier.qa.ai.ocr", "name": "QA OCR", "kind": "AI_FEATURE", "meterCode": "esupplier.qa.ai.ocr", "status": "ACTIVE"}
  ]}'::jsonb);
select platform.upsert_usage_meter('esupplier', 'esupplier.qa.ai.calls', 'QA llamadas', 'call', 'SUM', 'ACTIVE', p_capability_code => 'esupplier.qa.ai.copilot');
select platform.upsert_usage_meter('esupplier', 'esupplier.qa.ai.ocr', 'QA OCR', 'call', 'SUM', 'ACTIVE', p_capability_code => 'esupplier.qa.ai.ocr');
select pg_temp.act_as_postgres();
insert into platform.tenant_product_mappings
  (tenant_id, saas_product_id, deployment_target_id, external_tenant_id, external_organization_id,
   external_company_id, status, provisioned_at, registered_manually)
values (pg_temp.alpha(), pg_temp.esup(), '40000000-0000-4000-a000-00000000000a', 'ext-alpha', 'ext-org-alpha', 'ext-co-alpha', 'ACTIVE', now(), true),
       (pg_temp.demo(), pg_temp.esup(), '40000000-0000-4000-a000-00000000000a', 'ext-demo', 'ext-org-demo', 'ext-co-demo', 'ACTIVE', now(), true);

-- ---------------------------------------------------------------------------
-- Pesos (D-03): solo finanzas; no se inventan; vigencia; inmutables
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.padmin());
select throws_ok($$ select platform.set_ai_credit_weight('esupplier.qa.ai.copilot', 2, 'call', pg_temp.ts(-6, 1), 'QA') $$,
  '42501', null, 'El product admin no fija pesos de crédito (decisión comercial)');
select pg_temp.act_as(pg_temp.finance());
select throws_ok($$ select platform.set_ai_credit_weight('esupplier.qa.ai.copilot', 2, 'call', pg_temp.ts(-6, 1), '') $$,
  '23502', null, 'Peso sin motivo → rechazado');
select throws_ok($$ select platform.set_ai_credit_weight('esupplier.qa.ai.copilot', -1, 'call', pg_temp.ts(-6, 1), 'QA') $$,
  '23514', null, 'Peso negativo → rechazado');
select throws_ok($$ select platform.set_ai_credit_weight('esupplier.qa.docs.x', 1, 'call', pg_temp.ts(-6, 1), 'QA') $$,
  '23503', null, 'Peso para una capacidad inexistente → rechazado');
select isnt(platform.set_ai_credit_weight('esupplier.qa.ai.copilot', 2, 'call', pg_temp.ts(-6, 1), 'QA sintético'), null,
  'Finanzas fija el peso 2/llamada (sintético)');
select isnt(platform.set_ai_credit_weight('esupplier.qa.ai.copilot', 3, 'call', pg_temp.ts(-3, 15), 'QA sintético'), null,
  'Cambio de peso a 3 desde el día 15 de M-3');
select throws_ok($$ select platform.set_ai_credit_weight('esupplier.qa.ai.copilot', 9, 'call', pg_temp.ts(-4, 1), 'QA') $$,
  '23514', null, 'Un peso no puede empezar antes del vigente (no reescribe historia)');
select pg_temp.act_as_postgres();
select is((select string_agg(credits_per_unit::numeric(10,2) || '@' || (valid_to is null)::text, ',' order by valid_from)
             from platform.ai_credit_weights w join platform.product_capabilities c on c.id = w.capability_id
            where c.code = 'esupplier.qa.ai.copilot'),
  '2.00@false,3.00@true', 'El peso anterior se cierra en la vigencia del nuevo');
select throws_ok($$ update platform.ai_credit_weights set credits_per_unit = 7 $$, '55000', null, 'Pesos inmutables (solo valid_to una vez)');
select throws_ok($$ delete from platform.ai_credit_weights $$, '55000', null, 'Pesos no se borran');

-- ---------------------------------------------------------------------------
-- Políticas: comerciales = nullable (no decidido); sin rollover/expiración (D-04)
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.padmin());
select throws_ok($$ select platform.create_ai_credit_policy('PLAN', 'esupplier-shared-standard', 'TENANT', 1000, 'BLOCK', pg_temp.m(-6), 'QA') $$,
  '42501', null, 'Solo finanzas crea políticas de créditos');
select pg_temp.act_as_postgres();
select throws_ok($$ insert into platform.ai_credit_policies (saas_product_id, source_type, plan_id, rollover_policy, valid_from, reason)
                    values (pg_temp.esup(), 'PLAN', '60000000-0000-4000-a000-000000000001', 'CARRY_ALL', current_date, 'x') $$,
  '23514', null, 'Rollover no se puede configurar hasta decidir D-04');

-- Sin política todavía
select pg_temp.act_as_service();
select is(platform.open_ai_credit_period(pg_temp.alpha(), pg_temp.m(-3)) ->> 'code', 'POLITICA_CREDITOS_NO_DEFINIDA',
  'Sin política → POLITICA_CREDITOS_NO_DEFINIDA, sin entradas');
select pg_temp.act_as(pg_temp.finance());
select isnt(platform.create_ai_credit_policy('PLAN', 'esupplier-shared-standard', 'TENANT', 1000, 'BLOCK', pg_temp.m(-6), 'QA sintético'), null,
  'Finanzas crea una política sintética: pool TENANT, 1000 incluidos, exceso BLOCK');

-- ---------------------------------------------------------------------------
-- GRANT_PERIOD (incluidos), idempotente
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select is((platform.open_ai_credit_period(pg_temp.alpha(), pg_temp.m(-3)) ->> 'granted')::int, 1, 'GRANT_PERIOD de M-3');
select is((platform.open_ai_credit_period(pg_temp.alpha(), pg_temp.m(-3)) ->> 'granted')::int, 0, 'Reabrir el período no duplica (idempotente)');
select pg_temp.act_as(pg_temp.tadmin());
select throws_ok($$ select platform.open_ai_credit_period(pg_temp.alpha(), pg_temp.m(-2)) $$, '42501', null, 'Un tenant admin no abre períodos de créditos');
select pg_temp.act_as_service();
select is(platform.open_ai_credit_period(pg_temp.demo(), pg_temp.m(-3)) ->> 'code', 'POLITICA_CREDITOS_NO_DEFINIDA',
  'El tenant DEMO (sin plan con política) no recibe créditos');

-- ---------------------------------------------------------------------------
-- CONSUME al finalizar: peso vigente en occurred_at, guardado en la entrada
-- ---------------------------------------------------------------------------
select platform.ingest_usage_events('esupplier', 'DEV', jsonb_build_array(
  pg_temp.call('esupplier.qa.ai.calls', 'esupplier.qa.ai.copilot', pg_temp.ts(-3, 2)),
  pg_temp.call('esupplier.qa.ai.calls', 'esupplier.qa.ai.copilot', pg_temp.ts(-3, 5)),
  pg_temp.call('esupplier.qa.ai.calls', 'esupplier.qa.ai.copilot', pg_temp.ts(-3, 10)),
  pg_temp.call('esupplier.qa.ai.calls', 'esupplier.qa.ai.copilot', pg_temp.ts(-3, 20)),
  pg_temp.call('esupplier.qa.ai.calls', 'esupplier.qa.ai.copilot', pg_temp.ts(-3, 25)),
  pg_temp.call('esupplier.qa.ai.ocr', 'esupplier.qa.ai.ocr', pg_temp.ts(-3, 6))
), gen_random_uuid());
select platform.close_usage_periods(now());
select pg_temp.act_as_postgres();
select is((select count(*)::int from platform.ai_credit_ledger where entry_type = 'CONSUME'), 0,
  'Nada se consume antes de FINALIZED (nunca desde eventos crudos)');
select pg_temp.act_as(pg_temp.finance());
select platform.finalize_usage_aggregate(pg_temp.agg('esupplier.qa.ai.calls', -3));
select pg_temp.act_as_postgres();
select is((select string_agg(credits::numeric(10,2) || '=' || quantity::numeric(10,2) || 'x' || weight_applied::numeric(10,2), ',' order by weight_applied)
             from platform.ai_credit_ledger where entry_type = 'CONSUME' and usage_aggregate_id = pg_temp.agg('esupplier.qa.ai.calls', -3)),
  '-6.00=3.00x2.00,-6.00=2.00x3.00', 'CONSUME por peso vigente: 3 llamadas × 2 y 2 llamadas × 3; peso guardado en la entrada');
select is((select count(distinct period_start)::int || ':' || min(pool_key) from platform.ai_credit_ledger where entry_type = 'CONSUME'),
  '1:TENANT', 'CONSUME en el pool y el período del agregado');
select is((select b.included::numeric(10,2) || ':' || b.used::numeric(10,2) || ':' || b.balance::numeric(10,2) from pg_temp.bal(-3) b),
  '1000.00:12.00:988.00', 'Saldo M-3: 1000 incluidos − 12 usados = 988');

-- Un peso nuevo no reescribe lo consumido
select pg_temp.act_as(pg_temp.finance());
select platform.set_ai_credit_weight('esupplier.qa.ai.copilot', 5, 'call', now(), 'QA sintético');
select pg_temp.act_as_postgres();
select is((select sum(credits)::numeric(10,2) from platform.ai_credit_ledger where entry_type = 'CONSUME'), -12.00::numeric(10,2),
  'Cambiar el peso después no altera el consumo registrado');

-- Capacidad sin peso → alerta, sin consumo inventado
select pg_temp.act_as(pg_temp.finance());
select platform.finalize_usage_aggregate(pg_temp.agg('esupplier.qa.ai.ocr', -3));
select pg_temp.act_as_postgres();
select is((select count(*)::int from platform.ai_credit_ledger where usage_aggregate_id = pg_temp.agg('esupplier.qa.ai.ocr', -3)), 0,
  'Sin peso para la capacidad → sin CONSUME');
select is((select count(*)::int from platform.usage_alerts where aggregate_id = pg_temp.agg('esupplier.qa.ai.ocr', -3) and code = 'PESO_CREDITO_NO_DEFINIDO'), 1,
  'Sin peso → alerta PESO_CREDITO_NO_DEFINIDO');

-- ---------------------------------------------------------------------------
-- Ledger append-only y clave de idempotencia
-- ---------------------------------------------------------------------------
select throws_ok($$ update platform.ai_credit_ledger set credits = 0 $$, '55000', null, 'Ledger: UPDATE prohibido');
select throws_ok($$ delete from platform.ai_credit_ledger $$, '55000', null, 'Ledger: DELETE prohibido');
select throws_ok($$ truncate platform.ai_credit_ledger $$, '55000', null, 'Ledger: TRUNCATE prohibido');
select throws_ok($$ insert into platform.ai_credit_ledger (tenant_id, saas_product_id, pool_key, period_start, entry_type, credits, entry_idempotency_key, reason)
                    select tenant_id, saas_product_id, pool_key, period_start, 'ADJUST', 1, entry_idempotency_key, 'x'
                      from platform.ai_credit_ledger where entry_type = 'GRANT_PERIOD' limit 1 $$,
  '23505', null, 'Unique (tenant, entry_idempotency_key)');
select throws_ok($$ insert into platform.ai_credit_ledger (tenant_id, saas_product_id, pool_key, period_start, entry_type, credits, entry_idempotency_key)
                    values (pg_temp.alpha(), pg_temp.esup(), 'TENANT', pg_temp.m(-3), 'CONSUME', 5, 'x-signo') $$,
  '23514', null, 'Signo por tipo: CONSUME es negativo');

-- ---------------------------------------------------------------------------
-- Compras, bonos y ajustes (finanzas, con motivo); REVERSAL
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.tadmin());
select throws_ok($$ select platform.record_ai_credit_entry(pg_temp.alpha(), 'TENANT', pg_temp.m(-3), 'GRANT_BONUS', 50, 'QA', 'bonus-1') $$,
  '42501', null, 'Un tenant admin no se regala créditos');
select pg_temp.act_as(pg_temp.finance());
select throws_ok($$ select platform.record_ai_credit_entry(pg_temp.alpha(), 'TENANT', pg_temp.m(-3), 'GRANT_BONUS', 50, ' ', 'bonus-1') $$,
  '23502', null, 'Bono sin motivo → rechazado');
select throws_ok($$ select platform.record_ai_credit_entry(pg_temp.alpha(), 'TENANT', pg_temp.m(-3), 'EXPIRE', -5, 'QA', 'exp-1') $$,
  '22023', null, 'EXPIRE no se registra a mano (solo por política, D-04)');
select throws_ok($$ select platform.record_ai_credit_entry(pg_temp.alpha(), 'PRODUCT:ewm', pg_temp.m(-3), 'GRANT_BONUS', 5, 'QA', 'pool-1') $$,
  '22023', null, 'Pool de otro producto → rechazado');
select isnt(platform.record_ai_credit_entry(pg_temp.alpha(), 'TENANT', pg_temp.m(-3), 'GRANT_BONUS', 50, 'QA bono sintético', 'bonus-1'), null, 'Bono +50');
select is(platform.record_ai_credit_entry(pg_temp.alpha(), 'TENANT', pg_temp.m(-3), 'GRANT_BONUS', 50, 'QA bono sintético', 'bonus-1'),
  (select id from platform.ai_credit_ledger where entry_idempotency_key = 'bonus-1'), 'Misma clave → misma entrada (idempotente)');
select throws_ok($$ select platform.record_ai_credit_entry(pg_temp.alpha(), 'TENANT', pg_temp.m(-3), 'GRANT_BONUS', 60, 'QA', 'bonus-1') $$,
  '23505', null, 'Misma clave con otro contenido → conflicto');
select isnt(platform.record_ai_credit_entry(pg_temp.alpha(), 'TENANT', pg_temp.m(-3), 'GRANT_PURCHASE', 200, 'QA compra sintética', 'buy-1'), null, 'Compra +200');
select isnt(platform.record_ai_credit_entry(pg_temp.alpha(), 'TENANT', pg_temp.m(-3), 'ADJUST', -8, 'QA ajuste', 'adj-1'), null, 'Ajuste −8');
select isnt(platform.reverse_ai_credit_entry((select id from platform.ai_credit_ledger where entry_idempotency_key = 'adj-1'), 'QA corrección'), null,
  'REVERSAL del ajuste');
select throws_ok($$ select platform.reverse_ai_credit_entry((select id from platform.ai_credit_ledger where entry_idempotency_key = 'adj-1'), 'otra vez') $$,
  '23505', null, 'Una entrada se revierte una sola vez');
select throws_ok($$ select platform.reverse_ai_credit_entry((select id from platform.ai_credit_ledger where entry_type = 'REVERSAL' limit 1), 'x') $$,
  '22023', null, 'Una REVERSAL no se revierte');
select pg_temp.act_as_postgres();
select is((select credits::numeric(10,2) from platform.ai_credit_ledger where entry_type = 'REVERSAL'), 8.00::numeric(10,2),
  'REVERSAL = −(entrada original)');

-- Reservas (servidor)
select pg_temp.act_as_service();
select isnt(platform.reserve_ai_credits(pg_temp.alpha(), 'TENANT', pg_temp.m(-3), 10, 'res-1'), null, 'Reserva de 10');
select pg_temp.act_as_postgres();
select is((select b.reserved::numeric(10,2) || ':' || b.balance::numeric(10,2) from pg_temp.bal(-3) b), '10.00:1228.00',
  'Reserva descuenta del saldo: 1000+50+200−12−10 = 1228');
select pg_temp.act_as_service();
select isnt(platform.release_ai_credit_reservation((select id from platform.ai_credit_ledger where entry_idempotency_key = 'res-1')), null, 'Liberación');
select pg_temp.act_as_postgres();
select is((select b.included::numeric(10,2) || ':' || b.purchased::numeric(10,2) || ':' || b.bonus::numeric(10,2) || ':' || b.reserved::numeric(10,2)
                 || ':' || b.used::numeric(10,2) || ':' || b.expired::numeric(10,2) || ':' || b.adjusted::numeric(10,2) || ':' || b.balance::numeric(10,2)
             from pg_temp.bal(-3) b),
  '1000.00:200.00:50.00:0.00:12.00:0.00:0.00:1238.00', 'Saldo derivado: incluidos/comprados/bono/reservado/usado/expirado/ajuste neto');

-- Expiración / rollover sin política
select pg_temp.act_as_service();
select throws_ok($$ select platform.expire_ai_credits(pg_temp.alpha(), 'TENANT', pg_temp.m(-3)) $$,
  'P0001', 'POLITICA_EXPIRACION_NO_DEFINIDA: sin decisión D-04 no se expiran ni se trasladan créditos',
  'Sin política D-04 → no hay EXPIRE ni ROLLOVER');

-- ---------------------------------------------------------------------------
-- Exceso: saldo < 0 al cierre con BLOCK → alerta (no factura)
-- ---------------------------------------------------------------------------
select platform.open_ai_credit_period(pg_temp.alpha(), pg_temp.m(-2));
select pg_temp.act_as(pg_temp.finance());
select platform.reverse_ai_credit_entry((select id from platform.ai_credit_ledger where entry_type = 'GRANT_PERIOD' and period_start = pg_temp.m(-2)), 'QA: forzar exceso');
select pg_temp.act_as_service();
select platform.ingest_usage_events('esupplier', 'DEV', jsonb_build_array(
  pg_temp.call('esupplier.qa.ai.calls', 'esupplier.qa.ai.copilot', pg_temp.ts(-2, 3)),
  pg_temp.call('esupplier.qa.ai.calls', 'esupplier.qa.ai.copilot', pg_temp.ts(-2, 4))), gen_random_uuid());
select platform.close_usage_periods(now());
select platform.finalize_usage_aggregate(pg_temp.agg('esupplier.qa.ai.calls', -2));
select pg_temp.act_as_postgres();
select is((select b.balance::numeric(10,2) from pg_temp.bal(-2) b), -6.00::numeric(10,2), 'M-2: 0 disponibles − 2 × 3 = −6');
select is((select detail ->> 'overageMode' from platform.usage_alerts
            where aggregate_id = pg_temp.agg('esupplier.qa.ai.calls', -2) and code = 'CREDIT_OVERAGE'), 'BLOCK',
  'Exceso de créditos con política BLOCK → alerta CREDIT_OVERAGE (sin línea de factura)');

-- DEMO: consume sin política → alerta, nada en el ledger
select pg_temp.act_as_service();
select platform.ingest_usage_events('esupplier', 'DEV', jsonb_build_array(
  pg_temp.call('esupplier.qa.ai.calls', 'esupplier.qa.ai.copilot', pg_temp.ts(-3, 12), pg_temp.demo())), gen_random_uuid());
select pg_temp.act_as_postgres();
select is((select late::text from platform.usage_events where tenant_id = pg_temp.demo() and meter_code = 'esupplier.qa.ai.calls'), 'false',
  'DEMO: M-3 aún no finalizado para DEMO');
select pg_temp.act_as_service();
select platform.close_usage_periods(now());
select platform.finalize_usage_aggregate(pg_temp.agg('esupplier.qa.ai.calls', -3, pg_temp.demo()));
select pg_temp.act_as_postgres();
select is((select count(*)::int from platform.usage_alerts
            where aggregate_id = pg_temp.agg('esupplier.qa.ai.calls', -3, pg_temp.demo()) and code = 'POLITICA_CREDITOS_NO_DEFINIDA'), 1,
  'Sin política para el tenant → POLITICA_CREDITOS_NO_DEFINIDA en el cierre');

-- ---------------------------------------------------------------------------
-- Snapshot: los pesos vigentes viajan en aiCredits
-- ---------------------------------------------------------------------------
select is(platform.ai_credit_weights_snapshot(pg_temp.esup(), now()) -> 'weights',
  '[{"capabilityCode": "esupplier.qa.ai.copilot", "creditsPerUnit": 5, "unit": "call"}]'::jsonb,
  'aiCredits.weights: pesos vigentes del producto');
select ok((platform.ai_credit_weights_snapshot(pg_temp.esup(), now()) ->> 'weightsVersion')::int > 0, 'weightsVersion > 0 cuando hay pesos');
select is(platform.ai_credit_weights_snapshot('20000000-0000-4000-a000-000000000002', now()),
  '{"weights": [], "weightsVersion": 0}'::jsonb, 'Producto sin pesos: aiCredits vacío (igual que antes)');
select pg_temp.act_as_service();
select is((select (platform.entitlement_snapshot_content(pg_temp.alpha(), pg_temp.esup(), now()) -> 'aiCredits' -> 'weights' -> 0 ->> 'creditsPerUnit')),
  '5', 'El contenido del snapshot incluye los pesos');

-- Lectura por RLS
select pg_temp.act_as(pg_temp.tadmin());
select ok((select count(*) from platform.v_ai_credit_balances where tenant_id = pg_temp.alpha()) >= 1, 'El tenant admin ve su saldo');
select is((select count(*)::int from platform.v_ai_credit_balances where tenant_id <> pg_temp.alpha()), 0, 'y solo el suyo');

select * from finish();
rollback;
