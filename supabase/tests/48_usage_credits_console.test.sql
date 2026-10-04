-- ============================================================================
-- M4 · Complementos de base de la consola de uso y créditos (migración 20261012000100)
-- ----------------------------------------------------------------------------
-- Spec §5: cerrar un período (finanzas, solo si terminó), acuse de alertas
-- (finanzas o admin de producto; usage_alerts sigue append-only), cierre de
-- políticas de créditos (una vez, sin retroactivo), vista de agregados
-- extendida (compatible), quitar el vínculo de uso de un ítem y lectura de
-- finanzas del eje BILLING sin gestionar integraciones.
-- ============================================================================
begin;
select plan(46);

create or replace function pg_temp.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
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
create or replace function pg_temp.padmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.finance() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000003'::uuid $$;
create or replace function pg_temp.tadmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000009'::uuid $$;
create or replace function pg_temp.m(k int) returns date language sql as $$
  select (date_trunc('month', now() at time zone 'UTC') + make_interval(months => k))::date
$$;

create temp table qa (k text primary key, v text);
grant all on qa to public;
create or replace function pg_temp.v(p_k text) returns text language sql as $$ select v from qa where k = p_k $$;

-- ---------------------------------------------------------------------------
-- Fixtures: medidor, agregados (M-2 vencido, M0 en curso, M-3 finalizado), alertas
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.padmin());
select platform.upsert_usage_meter('esupplier', 'esupplier.qa48.docs', 'QA 48 documentos', 'document', 'SUM', 'ACTIVE');

select pg_temp.act_as_postgres();
insert into qa select 'meter', id::text from platform.usage_meters where code = 'esupplier.qa48.docs';
insert into platform.usage_period_aggregates (tenant_id, saas_product_id, meter_id, meter_code, period_start, period_end)
select pg_temp.alpha(), pg_temp.esup(), pg_temp.v('meter')::uuid, 'esupplier.qa48.docs', pg_temp.m(k),
       (pg_temp.m(k) + interval '1 month' - interval '1 day')::date
  from unnest(array[-2, 0]) k;
insert into qa select 'agg_past', id::text from platform.usage_period_aggregates
 where meter_code = 'esupplier.qa48.docs' and period_start = pg_temp.m(-2);
insert into qa select 'agg_now', id::text from platform.usage_period_aggregates
 where meter_code = 'esupplier.qa48.docs' and period_start = pg_temp.m(0);

insert into platform.usage_alerts (tenant_id, saas_product_id, aggregate_id, code, detail)
values (pg_temp.alpha(), pg_temp.esup(), pg_temp.v('agg_past')::uuid, 'OVERAGE_UNDER_BLOCK_POLICY', '{"qa": 48}'),
       (pg_temp.alpha(), pg_temp.esup(), null, 'AI_CREDIT_POLICY_MISSING', '{"qa": 48}');
insert into qa select 'alert1', id::text from platform.usage_alerts where code = 'OVERAGE_UNDER_BLOCK_POLICY' and detail ->> 'qa' = '48';
insert into qa select 'alert2', id::text from platform.usage_alerts where code = 'AI_CREDIT_POLICY_MISSING' and detail ->> 'qa' = '48';

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(f || ':' || has_function_privilege('anon', f, 'execute'), ',' order by f)
     from unnest(array['platform.close_usage_aggregate(uuid, text)', 'platform.acknowledge_usage_alert(uuid, text)',
                       'platform.end_ai_credit_policy(uuid, date, text)',
                       'platform.clear_catalog_item_usage_binding(text, text)']) f),
  'platform.acknowledge_usage_alert(uuid, text):false,platform.clear_catalog_item_usage_binding(text, text):false,'
  || 'platform.close_usage_aggregate(uuid, text):false,platform.end_ai_credit_policy(uuid, date, text):false',
  '01 anon no ejecuta ninguna RPC nueva');
select ok(
  (select bool_and(p.prosecdef and 'search_path=platform, pg_catalog' = any (p.proconfig))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform'
      and p.proname in ('close_usage_aggregate', 'acknowledge_usage_alert', 'end_ai_credit_policy',
                        'clear_catalog_item_usage_binding', 'commercial_cutover_axes', 'commercial_cutover_history')),
  '02 RPCs nuevas: SECURITY DEFINER con search_path fijo');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform'
      and c.relname in ('v_usage_alerts', 'v_usage_period_aggregates', 'v_commercial_cutover_axes', 'v_commercial_cutover_history')
      and c.reloptions @> array['security_invoker=true']),
  4, '03 vistas nuevas y extendida: security_invoker');
select ok(
  not has_table_privilege('authenticated', 'platform.usage_alert_acks', 'INSERT')
  and not has_table_privilege('authenticated', 'platform.usage_alert_acks', 'UPDATE')
  and not has_table_privilege('anon', 'platform.v_commercial_cutover_axes', 'SELECT')
  and not has_table_privilege('anon', 'platform.v_usage_alerts', 'SELECT'),
  '04 acuses solo por RPC; anon no lee las vistas');

-- ---------------------------------------------------------------------------
-- 1. close_usage_aggregate
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.padmin());
select throws_ok(format('select platform.close_usage_aggregate(%L, %L)', pg_temp.v('agg_past'), 'QA'),
  '42501', null, '05 el admin de producto no cierra períodos de uso');

select pg_temp.act_as(pg_temp.finance());
select throws_like(format('select platform.close_usage_aggregate(%L, %L)', pg_temp.v('agg_past'), '  '),
  '%MOTIVO_REQUERIDO%', '06 cerrar exige motivo');
select throws_like(format('select platform.close_usage_aggregate(%L, %L)', pg_temp.v('agg_now'), 'QA'),
  '%PERIODO_NO_TERMINADO%', '07 un período en curso no se cierra');
select is(platform.close_usage_aggregate(pg_temp.v('agg_past')::uuid, 'QA: cierre manual sin job') ->> 'status', 'CLOSING',
  '08 finanzas pasa a CLOSING un período terminado');
select is(platform.close_usage_aggregate(pg_temp.v('agg_past')::uuid, 'QA: repetido') ->> 'duplicate', 'true',
  '09 cerrar dos veces es idempotente');
select ok((select closing_at is not null from platform.v_usage_period_aggregates where id = pg_temp.v('agg_past')::uuid),
  '10 la vista expone closing_at');
select is((select count(*)::int from platform.audit_logs where action = 'USAGE_AGGREGATE_CLOSED' and entity_id = pg_temp.v('agg_past')),
  1, '11 el cierre queda auditado una vez');

-- Finalizar el agregado cerrado y comprobar que ya no se puede «cerrar».
select platform.finalize_usage_aggregate(pg_temp.v('agg_past')::uuid);
select throws_like(format('select platform.close_usage_aggregate(%L, %L)', pg_temp.v('agg_past'), 'QA'),
  '%AGREGADO_FINALIZADO%', '12 un agregado finalizado no se cierra');
select is((select finalized_by from platform.v_usage_period_aggregates where id = pg_temp.v('agg_past')::uuid),
  pg_temp.finance(), '13 la vista expone finalized_by');
select is((select meter_id from platform.v_usage_period_aggregates where id = pg_temp.v('agg_past')::uuid),
  pg_temp.v('meter')::uuid, '14 la vista expone meter_id');
select is(
  (select string_agg(attname, ',' order by attnum) from pg_attribute
    where attrelid = 'platform.v_usage_period_aggregates'::regclass and attnum > 0 and not attisdropped),
  'id,tenant_id,tenant_slug,saas_product_id,product_code,meter_code,unit,period_start,period_end,status,'
  || 'event_count,late_event_count,quantity,allowance_included,overage_quantity,allowance_status,overage_policy,'
  || 'is_billable,source_hash,finalized_at,meter_id,closing_at,finalized_by',
  '15 columnas previas en el mismo orden; las nuevas al final');

-- ---------------------------------------------------------------------------
-- 2. Acuse de alertas
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.tadmin());
select throws_ok(format('select platform.acknowledge_usage_alert(%L, %L)', pg_temp.v('alert1'), 'QA'),
  '42501', null, '16 un admin de tenant no da acuse');
select is((select count(*)::int from platform.v_usage_alerts where id in (pg_temp.v('alert1')::uuid, pg_temp.v('alert2')::uuid)),
  0, '17 … ni ve las alertas en la vista');

select pg_temp.act_as(pg_temp.finance());
select is((select count(*)::int from platform.v_usage_alerts
            where id in (pg_temp.v('alert1')::uuid, pg_temp.v('alert2')::uuid) and not acknowledged),
  2, '18 finanzas ve las dos alertas pendientes');
select is(platform.acknowledge_usage_alert(pg_temp.v('alert1')::uuid, '  Revisado con producto  ') ->> 'duplicate', 'false',
  '19 finanzas da acuse con nota');
select is(platform.acknowledge_usage_alert(pg_temp.v('alert1')::uuid, 'otra nota') ->> 'duplicate', 'true',
  '20 el acuse es idempotente (uno por alerta)');
select is((select ack_note from platform.v_usage_alerts where id = pg_temp.v('alert1')::uuid), 'Revisado con producto',
  '21 la vista muestra la nota recortada del primer acuse');
select is((select acknowledged_by from platform.v_usage_alerts where id = pg_temp.v('alert1')::uuid), pg_temp.finance(),
  '22 y quién lo dio');
select throws_like($$ select platform.acknowledge_usage_alert(gen_random_uuid(), null) $$,
  '%ALERTA_NO_ENCONTRADA%', '23 alerta inexistente');

select pg_temp.act_as(pg_temp.padmin());
select is(platform.acknowledge_usage_alert(pg_temp.v('alert2')::uuid) ->> 'duplicate', 'false',
  '24 el admin de producto también da acuse (sin nota)');

select pg_temp.act_as_postgres();
select throws_ok(format('update platform.usage_alert_acks set note = %L where alert_id = %L', 'x', pg_temp.v('alert1')),
  '55000', null, '25 los acuses son append-only');
select throws_ok(format('update platform.usage_alerts set code = %L where id = %L', 'OTRA_ALERTA', pg_temp.v('alert1')),
  '55000', null, '26 usage_alerts sigue append-only');
select is((select count(*)::int from platform.audit_logs where action = 'USAGE_ALERT_ACKNOWLEDGED'
            and entity_id in (pg_temp.v('alert1'), pg_temp.v('alert2'))), 2, '27 cada acuse se audita una vez');

-- ---------------------------------------------------------------------------
-- 3. end_ai_credit_policy
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.finance());
insert into qa select 'policy', platform.create_ai_credit_policy(
  'PLAN', 'esupplier-shared-standard', 'TENANT', 100, 'BLOCK', current_date - 30, 'QA 48 política')::text;

select pg_temp.act_as(pg_temp.padmin());
select throws_ok(format('select platform.end_ai_credit_policy(%L, %L, %L)', pg_temp.v('policy'), current_date + 10, 'QA'),
  '42501', null, '28 el admin de producto no cierra políticas de créditos');

select pg_temp.act_as(pg_temp.finance());
select throws_like(format('select platform.end_ai_credit_policy(%L, %L, %L)', pg_temp.v('policy'), current_date - 1, 'QA'),
  '%CIERRE_RETROACTIVO%', '29 sin cierre retroactivo');
select throws_like(format('select platform.end_ai_credit_policy(%L, %L, %L)', pg_temp.v('policy'), current_date - 30, 'QA'),
  '%FECHA_INVALIDA%', '30 el cierre debe ser posterior al inicio');
select throws_like(format('select platform.end_ai_credit_policy(%L, %L, %L)', pg_temp.v('policy'), current_date + 10, ''),
  '%MOTIVO_REQUERIDO%', '31 cerrar exige motivo');
select is(platform.end_ai_credit_policy(pg_temp.v('policy')::uuid, current_date + 10, 'QA: fin de la promoción') ->> 'valid_to',
  (current_date + 10)::text, '32 finanzas cierra la vigencia');
select throws_like(format('select platform.end_ai_credit_policy(%L, %L, %L)', pg_temp.v('policy'), current_date + 20, 'QA'),
  '%POLITICA_YA_CERRADA%', '33 valid_to se fija una sola vez');
select is((select count(*)::int from platform.audit_logs where action = 'AI_CREDIT_POLICY_ENDED' and entity_id = pg_temp.v('policy')),
  1, '34 el cierre queda auditado');

-- ---------------------------------------------------------------------------
-- 5. clear_catalog_item_usage_binding
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
insert into platform.catalog_items (code, name, saas_product_id, item_type, scope, lifecycle_status, billing_model, currency)
values ('qa48_docs_per_unit', 'QA 48 documentos por uso', pg_temp.esup(), 'addon', 'org-wide', 'AVAILABLE', 'PER_UNIT', 'USD');

select pg_temp.act_as(pg_temp.finance());
select platform.set_catalog_item_usage_binding('qa48_docs_per_unit', 'METER', 'esupplier.qa48.docs', 'QA vincular');

select pg_temp.act_as(pg_temp.tadmin());
select throws_ok($$ select platform.clear_catalog_item_usage_binding('qa48_docs_per_unit', 'QA') $$,
  '42501', null, '35 un admin de tenant no quita vínculos de uso');

select pg_temp.act_as(pg_temp.finance());
select throws_like($$ select platform.clear_catalog_item_usage_binding('qa48_docs_per_unit', ' ') $$,
  '%MOTIVO_REQUERIDO%', '36 quitar el vínculo exige motivo');
select is(platform.clear_catalog_item_usage_binding('qa48_docs_per_unit', 'QA: el medidor deja de tarifarse') ->> 'duplicate',
  'false', '37 finanzas quita el vínculo');
select ok((select per_unit_source is null and usage_meter_id is null from platform.catalog_items where code = 'qa48_docs_per_unit'),
  '38 el ítem queda sin origen ni medidor');
select is(platform.clear_catalog_item_usage_binding('qa48_docs_per_unit', 'QA otra vez') ->> 'duplicate', 'true',
  '39 quitarlo dos veces es idempotente');
select is((select count(*)::int from platform.audit_logs where action = 'CATALOG_ITEM_USAGE_BINDING_CLEARED'
            and metadata ->> 'previous_meter' = 'esupplier.qa48.docs'), 1, '40 la baja queda auditada con el medidor previo');

-- ---------------------------------------------------------------------------
-- 6. Lectura del eje BILLING para finanzas
-- ---------------------------------------------------------------------------
-- Escenario: el usuario de finanzas SIN platform.integration.read (fuera del seed).
select pg_temp.act_as_postgres();
update platform.provisioning_role_members set is_active = false where user_id = pg_temp.finance();
delete from platform.product_owners where user_id = pg_temp.finance();
insert into platform.commercial_cutover_events (product_integration_id, axis, from_state, to_state, reason)
select id, 'BILLING', 'BILLING_LEGACY', 'BILLING_SHADOW', 'QA 48 shadow' from platform.product_integrations where code = 'esupplier-manual';
insert into platform.commercial_cutover_events (product_integration_id, axis, from_state, to_state, reason)
select id, 'ENTITLEMENTS', 'LEGACY_ONLY', 'SHADOW', 'QA 48 entitlements' from platform.product_integrations where code = 'esupplier-manual';

select pg_temp.act_as(pg_temp.finance());
select is((select count(*)::int from platform.product_integrations), 0,
  '41 finanzas sin integration.read no ve product_integrations (contrato M2M)');
select is((select count(*)::int from platform.v_commercial_cutover_axes),
  (select count(*)::int from platform.commercial_cutover_axes()), '42 la vista es la función');
select ok((select count(*) from platform.v_commercial_cutover_axes) >= 3
  and (select bool_and(cutover_state_billing is not null) from platform.v_commercial_cutover_axes),
  '43 … pero sí lee el eje BILLING y el ingest de todas las integraciones');
select is((select string_agg(distinct axis, ',') from platform.v_commercial_cutover_history where reason like 'QA 48%'),
  'BILLING', '44 el historial expone solo el eje BILLING');
select ok(not has_table_privilege('authenticated', 'platform.product_integrations', 'UPDATE')
  and not has_table_privilege('authenticated', 'platform.v_commercial_cutover_axes', 'UPDATE'),
  '45 leer el eje no da escritura de integraciones');

select pg_temp.act_as(pg_temp.tadmin());
select is((select count(*)::int from platform.v_commercial_cutover_axes), 0,
  '46 un admin de tenant no ve ejes de cutover');

select * from finish();
rollback;
