-- ============================================================================
-- EBIM Commercial Control Plane · Fase 17 · agregados y cierre de período (MA-52)
-- ----------------------------------------------------------------------------
-- Spec §11.4: período = mes calendario UTC de occurred_at (D-10);
-- OPEN → CLOSING (period_end + grace_hours) → FINALIZED (finanzas o job);
-- FINALIZED inmutable con event_count, quantity y source_hash; eventos tardíos
-- tras FINALIZED → siguiente período abierto con late=true (nunca se reabre);
-- DEMO/SANDBOX → is_billable=false. Asignación (ALLOWANCE) aplicada al cerrar;
-- exceso con overageMode BLOCK → alerta, nunca facturable.
-- Plan §4 fila 18, §12.1 MA-52. Migración 20261005000200_ccp_usage_aggregates.
--
-- Fechas RELATIVAS al mes actual (M0) para que el test no dependa del día:
-- M-3 y M-2 ya pasaron su ventana de gracia; M0 sigue abierto.
-- ============================================================================
begin;
select plan(49);

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

-- M(k) = primer día del mes actual + k meses (UTC)
create or replace function pg_temp.m(k int) returns date language sql as $$
  select (date_trunc('month', now() at time zone 'UTC') + make_interval(months => k))::date
$$;
create or replace function pg_temp.at(k int, p_day int, p_hour int default 12) returns text language sql as $$
  select to_char(pg_temp.m(k) + (p_day - 1) + make_interval(hours => p_hour), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;
create or replace function pg_temp.ev(p_meter text, p_qty numeric, p_at text, p_tenant uuid default null,
                                      p_unit text default 'document', p_subject text default null)
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('eventId', gen_random_uuid()::text, 'meterCode', p_meter, 'quantity', p_qty,
    'unit', p_unit, 'occurredAt', p_at, 'controlPlaneTenantId', coalesce(p_tenant, pg_temp.alpha())::text,
    'subjectRef', p_subject))
$$;
create or replace function pg_temp.ingest(p_events jsonb) returns jsonb language sql as $$
  select platform.ingest_usage_events('esupplier', 'DEV', p_events, gen_random_uuid())
$$;
create or replace function pg_temp.agg(p_tenant uuid, p_meter text, k int) returns platform.usage_period_aggregates
language sql as $$
  select a.* from platform.usage_period_aggregates a
   where a.tenant_id = p_tenant and a.meter_code = p_meter and a.period_start = pg_temp.m(k)
$$;

-- ---------------------------------------------------------------------------
-- Forma y privilegios
-- ---------------------------------------------------------------------------
select has_table('platform', 'usage_period_aggregates', 'Existe usage_period_aggregates');
select has_table('platform', 'usage_alerts', 'Existe usage_alerts');
select is((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'platform.usage_period_aggregates'::regclass),
  true, 'RLS habilitado y forzado en agregados');
select is(
  (select string_agg(r || ':' || has_table_privilege(r, 'platform.usage_period_aggregates', 'insert,update,delete'), ',' order by r)
     from unnest(array['anon', 'authenticated']) r),
  'anon:false,authenticated:false', 'Agregados: sin escritura directa');
select is(
  (select string_agg(r || ':' || has_function_privilege(r, 'platform.close_usage_periods(timestamptz)', 'execute'), ',' order by r)
     from unnest(array['anon', 'authenticated', 'service_role']) r),
  'anon:false,authenticated:false,service_role:true', 'close_usage_periods: EXECUTE solo service_role');
select is(
  (select string_agg(r || ':' || has_function_privilege(r, 'platform.finalize_usage_aggregate(uuid)', 'execute'), ',' order by r)
     from unnest(array['anon', 'authenticated', 'service_role']) r),
  'anon:false,authenticated:true,service_role:true', 'finalize_usage_aggregate: finanzas (authenticated + gate) o service_role');
select is(
  (select string_agg(p.proname || ':' || p.prosecdef::text, ' ' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform' and p.proname in ('close_usage_periods', 'finalize_usage_aggregate', 'finalize_due_usage_aggregates')),
  'close_usage_periods:true finalize_due_usage_aggregates:true finalize_usage_aggregate:true', 'RPCs de cierre DEFINER');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'platform' and c.relname = 'v_usage_period_aggregates'
              and c.reloptions @> array['security_invoker=true']), 1, 'v_usage_period_aggregates es security_invoker');

-- ---------------------------------------------------------------------------
-- Escenario: medidores, asignación de 100 documentos por el plan de alpha
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.padmin());
select platform.import_capability_manifest('esupplier', '{
  "schema": "ebim.capabilities/v1", "productCode": "esupplier", "manifestVersion": "qa-17",
  "capabilities": [
    {"code": "esupplier.qa.docs", "name": "QA documentos", "kind": "ALLOWANCE", "unit": "document", "combineRule": "SUM", "meterCode": "esupplier.qa.documents", "status": "ACTIVE"}
  ]}'::jsonb);
select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.docs', '{"included": 100, "period": "MONTH"}', pg_temp.m(-6), 'QA');
select platform.upsert_usage_meter('esupplier', 'esupplier.qa.documents', 'QA documentos', 'document', 'SUM', 'ACTIVE',
                                   p_capability_code => 'esupplier.qa.docs');
select platform.upsert_usage_meter('esupplier', 'esupplier.qa.peak', 'QA pico', 'document', 'MAX', 'ACTIVE', p_measurement => 'DAILY_SNAPSHOT');
select platform.upsert_usage_meter('esupplier', 'esupplier.qa.users', 'QA usuarios', 'document', 'COUNT_DISTINCT_SUBJECT', 'ACTIVE');
select pg_temp.act_as(pg_temp.finance());
select platform.set_usage_meter_billable('esupplier', 'esupplier.qa.documents', true, 'QA: decisión sintética de la prueba');

select pg_temp.act_as_postgres();
insert into platform.tenant_product_mappings
  (tenant_id, saas_product_id, deployment_target_id, external_tenant_id, external_organization_id,
   external_company_id, status, provisioned_at, registered_manually)
values (pg_temp.alpha(), pg_temp.esup(), '40000000-0000-4000-a000-00000000000a', 'ext-alpha', 'ext-org-alpha', 'ext-co-alpha', 'ACTIVE', now(), true),
       (pg_temp.demo(), pg_temp.esup(), '40000000-0000-4000-a000-00000000000a', 'ext-demo', 'ext-org-demo', 'ext-co-demo', 'ACTIVE', now(), true);

-- ---------------------------------------------------------------------------
-- Ingest: asignación por occurred_at UTC
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select pg_temp.ingest(jsonb_build_array(
  pg_temp.ev('esupplier.qa.documents', 60, pg_temp.at(-3, 3)),
  pg_temp.ev('esupplier.qa.documents', 50, pg_temp.at(-3, 20)),
  pg_temp.ev('esupplier.qa.documents', 10, pg_temp.at(-3, 28)),
  pg_temp.ev('esupplier.qa.documents', 40, pg_temp.at(-2, 10)),
  pg_temp.ev('esupplier.qa.documents', 5, pg_temp.at(0, 1, 0)),
  pg_temp.ev('esupplier.qa.documents', 7, pg_temp.at(-3, 5), pg_temp.demo()),
  pg_temp.ev('esupplier.qa.peak', 3, pg_temp.at(-3, 2)),
  pg_temp.ev('esupplier.qa.peak', 9, pg_temp.at(-3, 9)),
  pg_temp.ev('esupplier.qa.peak', 4, pg_temp.at(-3, 15)),
  pg_temp.ev('esupplier.qa.users', 1, pg_temp.at(-3, 2), p_subject => 'u1'),
  pg_temp.ev('esupplier.qa.users', 1, pg_temp.at(-3, 3), p_subject => 'u2'),
  pg_temp.ev('esupplier.qa.users', 1, pg_temp.at(-3, 4), p_subject => 'u1')
));
-- 23:30 del último día de M-3 en UTC−5 = 04:30 UTC del día 1 de M-2
select is((pg_temp.ingest(jsonb_build_array(jsonb_build_object(
    'eventId', 'a7000000-0000-4000-8000-000000000001', 'meterCode', 'esupplier.qa.documents', 'quantity', 1, 'unit', 'document',
    'occurredAt', to_char(pg_temp.m(-2) - 1, 'YYYY-MM-DD') || 'T23:30:00-05:00',
    'controlPlaneTenantId', pg_temp.alpha()::text))) ->> 'accepted')::int, 1, 'Evento con zona −05:00 aceptado');

select pg_temp.act_as_postgres();
select is((select period_start from platform.usage_events where event_id = 'a7000000-0000-4000-8000-000000000001'),
  pg_temp.m(-2), 'Período por occurred_at en UTC (D-10): 23:30 −05:00 del último día cae en el mes siguiente');
select is((select count(*)::int from platform.usage_period_aggregates where tenant_id = pg_temp.alpha() and meter_code = 'esupplier.qa.documents'),
  3, 'El ingest abre un agregado OPEN por tenant × medidor × período con eventos');
select is((pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.documents', -3)).status, 'OPEN', 'Agregado nuevo en OPEN');

-- ---------------------------------------------------------------------------
-- Cierre: OPEN → CLOSING solo pasada la ventana de gracia
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.finance());
select throws_ok($$ select platform.close_usage_periods(now()) $$, '42501', null, 'close_usage_periods: un humano no lo ejecuta');
select pg_temp.act_as_service();
select ok(platform.close_usage_periods(now()) >= 3, 'close_usage_periods mueve a CLOSING los períodos vencidos');
select is((pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.documents', -3)).status, 'CLOSING', 'M-3 → CLOSING');
select is((pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.documents', 0)).status, 'OPEN', 'M0 (en curso) sigue OPEN');
select is(platform.close_usage_periods(now() + interval '400 days'), 0,
  'Un p_now futuro no adelanta cierres (se acota a now())');

-- ---------------------------------------------------------------------------
-- Finalización: autoridad, cálculo, asignación, inmutabilidad
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.tadmin());
select throws_ok(format('select platform.finalize_usage_aggregate(%L)', (pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.documents', -3)).id),
  '42501', null, 'Un tenant admin no finaliza');
select pg_temp.act_as(pg_temp.padmin());
select throws_ok(format('select platform.finalize_usage_aggregate(%L)', (pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.documents', -3)).id),
  '42501', null, 'El product admin tampoco (finanzas)');
select pg_temp.act_as(pg_temp.finance());
select throws_ok(format('select platform.finalize_usage_aggregate(%L)', (pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.documents', 0)).id),
  '55000', null, 'Un agregado OPEN no se finaliza (primero CLOSING)');
select lives_ok(format('select platform.finalize_usage_aggregate(%L)', (pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.documents', -3)).id),
  'Finanzas finaliza M-3');

select pg_temp.act_as_postgres();
select is((select status || ':' || event_count || ':' || quantity::numeric(20,2) || ':' || late_event_count
             from pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.documents', -3)),
  'FINALIZED:3:120.00:0', 'FINALIZED: 3 eventos, cantidad 120');
select is((select source_hash from pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.documents', -3)),
  (select 'sha256:' || encode(sha256(convert_to(string_agg(event_id::text, ',' order by event_id::text), 'UTF8')), 'hex')
     from platform.usage_events where tenant_id = pg_temp.alpha() and meter_code = 'esupplier.qa.documents' and period_start = pg_temp.m(-3)),
  'source_hash = sha256 de los event_id ordenados');
select is((select allowance_status || ':' || allowance_included::numeric(20,2) || ':' || overage_quantity::numeric(20,2)
             from pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.documents', -3)),
  'OVER:100.00:20.00', 'Asignación aplicada: 100 incluidos, 20 de exceso');
select is((select overage_policy from pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.documents', -3)), 'BLOCK',
  'Exceso de asignación con overageMode BLOCK (contrato v1)');
select is((select count(*)::int from platform.usage_alerts
            where aggregate_id = (pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.documents', -3)).id and code = 'OVERAGE_UNDER_BLOCK_POLICY'), 1,
  'Exceso bajo BLOCK → alerta a finanzas');
select is((pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.documents', -3)).is_billable, true, 'Medidor facturable + tenant PRODUCTION → is_billable');
select is((select finalized_by from pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.documents', -3)), pg_temp.finance(), 'finalized_by = finanzas');

select throws_ok($$ update platform.usage_period_aggregates set quantity = 1 where status = 'FINALIZED' $$, '55000', null,
  'FINALIZED es inmutable incluso para postgres');
select throws_ok($$ delete from platform.usage_period_aggregates $$, '55000', null, 'Los agregados no se borran');
select throws_ok(format('update platform.usage_period_aggregates set status = %L where id = %L', 'OPEN',
                        (pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.documents', -2)).id),
  '55000', null, 'Sin retrocesos de estado (CLOSING → OPEN)');
select pg_temp.act_as(pg_temp.finance());
select throws_ok(format('select platform.finalize_usage_aggregate(%L)', (pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.documents', -3)).id),
  '55000', null, 'Finalizar dos veces → error (nunca se reabre)');

-- Tipos de agregación
select platform.finalize_usage_aggregate((pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.peak', -3)).id);
select platform.finalize_usage_aggregate((pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.users', -3)).id);
select is((pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.peak', -3)).quantity::numeric(20,2), 9.00::numeric(20,2), 'MAX (foto diaria) = pico del período');
select is((pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.users', -3)).quantity::numeric(20,2), 2.00::numeric(20,2), 'COUNT_DISTINCT_SUBJECT = sujetos distintos');
select is((pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.peak', -3)).allowance_status, 'NO_ALLOWANCE', 'Sin asignación para el medidor → NO_ALLOWANCE');
select is((pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.peak', -3)).is_billable, false, 'Medidor no facturable (D-06) → is_billable=false');

-- DEMO nunca facturable
select platform.finalize_usage_aggregate((pg_temp.agg(pg_temp.demo(), 'esupplier.qa.documents', -3)).id);
select is((pg_temp.agg(pg_temp.demo(), 'esupplier.qa.documents', -3)).is_billable, false,
  'Tenant DEMO: agregado con is_billable=false aunque el medidor sea facturable (INV-7)');

-- ---------------------------------------------------------------------------
-- Eventos tardíos
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select is((pg_temp.ingest(jsonb_build_array(jsonb_build_object(
    'eventId', 'a7000000-0000-4000-8000-000000000002', 'meterCode', 'esupplier.qa.documents', 'quantity', 30, 'unit', 'document',
    'occurredAt', pg_temp.at(-3, 25), 'controlPlaneTenantId', pg_temp.alpha()::text))) ->> 'accepted')::int, 1,
  'Evento tardío de un período FINALIZED: aceptado');
select pg_temp.act_as_postgres();
select is((select period_start || ':' || late from platform.usage_events where event_id = 'a7000000-0000-4000-8000-000000000002'),
  pg_temp.m(-2) || ':true', 'Se imputa al siguiente período no finalizado (M-2) con late=true');
select is((select quantity::numeric(20,2) || ':' || event_count from pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.documents', -3)),
  '120.00:3', 'El agregado FINALIZED de M-3 no cambia');

select pg_temp.act_as_service();
select is(platform.finalize_due_usage_aggregates(100) >= 1, true, 'Job: finaliza los CLOSING pendientes');
select pg_temp.act_as_postgres();
select is((select status || ':' || quantity::numeric(20,2) || ':' || event_count || ':' || late_event_count
             from pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.documents', -2)),
  'FINALIZED:71.00:3:1', 'M-2: 40 + 1 (UTC) + 30 tardío; late_event_count = 1');
select is((select allowance_status from pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.documents', -2)), 'WITHIN', 'M-2 dentro de la asignación');
select is((select finalized_by is null from pg_temp.agg(pg_temp.alpha(), 'esupplier.qa.documents', -2)), true, 'finalizado por el job (sin persona)');

select pg_temp.act_as_service();
select pg_temp.ingest(jsonb_build_array(jsonb_build_object(
    'eventId', 'a7000000-0000-4000-8000-000000000003', 'meterCode', 'esupplier.qa.documents', 'quantity', 2, 'unit', 'document',
    'occurredAt', pg_temp.at(-3, 26), 'controlPlaneTenantId', pg_temp.alpha()::text)));
select pg_temp.act_as_postgres();
select is((select period_start > pg_temp.m(-2) and late from platform.usage_events where event_id = 'a7000000-0000-4000-8000-000000000003'),
  true, 'Con M-3 y M-2 FINALIZED, el tardío salta al siguiente período abierto');

-- ---------------------------------------------------------------------------
-- Lectura
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.tadmin());
select ok((select count(*) from platform.v_usage_period_aggregates where tenant_id = pg_temp.alpha()) >= 3,
  'El tenant admin de alpha ve sus agregados (vista security_invoker)');
select is((select count(*)::int from platform.v_usage_period_aggregates where tenant_id = pg_temp.demo()), 0,
  'y no los de otro tenant');
select is((select count(*)::int from platform.usage_alerts), 0, 'Las alertas son solo para finanzas / product admin');
select pg_temp.act_as(pg_temp.finance());
select ok((select count(*) from platform.usage_alerts) >= 1, 'Finanzas ve las alertas');

select * from finish();
rollback;
