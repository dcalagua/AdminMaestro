-- ============================================================================
-- EBIM Commercial Control Plane · Fase 17 · medidores y eventos de uso (MA-50)
-- ----------------------------------------------------------------------------
-- Spec §11.1 (usage_meters), §11.3 (ingest idempotente por evento, desviación
-- D-12: la credencial identifica al producto y cada tenant necesita mapping
-- ACTIVE para ESE producto), §12.7 (internal = COGS, solo finanzas), §14.
-- Plan §4 fila 17, §12.1 MA-50. Migración 20261005000100_ccp_usage_meters_events.
--
-- Nota de numeración: el plan reservaba 37 para este archivo, pero la fase 08
-- ya ocupó 37_ccp_sync_actions → 38 (ingest), 39 (agregados), 40 (créditos).
-- ============================================================================
begin;
select plan(57);

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
create or replace function pg_temp.p1() returns uuid language sql as $$ select '50000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.ewm_alpha() returns uuid language sql as $$ select '50000000-0000-4000-a000-000000000008'::uuid $$;
create or replace function pg_temp.super() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.padmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.finance() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000003'::uuid $$;
create or replace function pg_temp.tadmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000009'::uuid $$;

create or replace function pg_temp.ev(p_id text, p_meter text, p_qty numeric, p_tenant uuid,
                                      p_unit text default 'call', p_at text default null,
                                      p_internal jsonb default null)
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'eventId', p_id, 'meterCode', p_meter, 'quantity', p_qty, 'unit', p_unit,
    'occurredAt', coalesce(p_at, to_char((now() - interval '1 hour') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    'controlPlaneTenantId', p_tenant::text, 'externalCompanyId', 'ext-co-alpha',
    'internal', p_internal))
$$;

create or replace function pg_temp.status_of(p_result jsonb, p_idx int)
returns text language sql as $$
  select (p_result -> 'results' -> p_idx ->> 'status') || coalesce(':' || (p_result -> 'results' -> p_idx ->> 'code'), '')
$$;

-- ---------------------------------------------------------------------------
-- Forma, RLS y privilegios
-- ---------------------------------------------------------------------------
select has_table('platform', 'usage_meters', 'Existe usage_meters');
select has_table('platform', 'usage_events', 'Existe usage_events');
select has_table('platform', 'usage_ingest_credentials', 'Existe usage_ingest_credentials');
select has_table('platform', 'usage_ingest_rejections', 'Existe usage_ingest_rejections');
select has_table('platform', 'm2m_jti_replay', 'Existe m2m_jti_replay');
select is(
  (select string_agg(c.relname || ':' || (c.relrowsecurity and c.relforcerowsecurity)::text, ',' order by c.relname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform'
      and c.relname in ('usage_meters', 'usage_events', 'usage_ingest_credentials', 'usage_ingest_rejections', 'm2m_jti_replay')),
  'm2m_jti_replay:true,usage_events:true,usage_ingest_credentials:true,usage_ingest_rejections:true,usage_meters:true',
  'RLS habilitado y forzado en las 5 tablas');
select is(
  (select string_agg(r || ':' || has_function_privilege(r, 'platform.ingest_usage_events(text, text, jsonb, uuid)', 'execute'), ',' order by r)
     from unnest(array['anon', 'authenticated', 'service_role']) r),
  'anon:false,authenticated:false,service_role:true',
  'ingest_usage_events: EXECUTE solo service_role');
select is(
  (select string_agg(r || ':' || has_function_privilege(r, 'platform.consume_m2m_jti(text, text, timestamptz)', 'execute'), ',' order by r)
     from unnest(array['anon', 'authenticated', 'service_role']) r),
  'anon:false,authenticated:false,service_role:true',
  'consume_m2m_jti: EXECUTE solo service_role');
select is(
  (select string_agg(r || ':' || has_function_privilege(r, 'platform.usage_ingest_credential(text)', 'execute'), ',' order by r)
     from unnest(array['anon', 'authenticated', 'service_role']) r),
  'anon:false,authenticated:false,service_role:true',
  'usage_ingest_credential: EXECUTE solo service_role');
select is(
  (select string_agg(p.proname || ':' || p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), ''), ' ' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform' and p.proname in ('ingest_usage_events', 'consume_m2m_jti', 'upsert_usage_meter')),
  'consume_m2m_jti:true:search_path=platform, pg_catalog ingest_usage_events:true:search_path=platform, pg_catalog upsert_usage_meter:true:search_path=platform, pg_catalog',
  'RPCs DEFINER con search_path fijo');
select is(
  (select string_agg(r || ':' || has_table_privilege(r, 'platform.usage_events', 'insert,update,delete'), ',' order by r)
     from unnest(array['anon', 'authenticated']) r),
  'anon:false,authenticated:false', 'usage_events: sin escritura directa para anon ni authenticated');
select is(has_column_privilege('authenticated', 'platform.usage_events', 'internal', 'select'), false,
  'usage_events.internal (COGS): sin SELECT para authenticated (grant por columna)');
select is(has_column_privilege('authenticated', 'platform.usage_events', 'quantity', 'select'), true,
  'usage_events.quantity: legible por authenticated (filtrado por RLS)');
select is(has_table_privilege('anon', 'platform.usage_events', 'select'), false, 'anon no lee usage_events');
select is(has_table_privilege('authenticated', 'platform.m2m_jti_replay', 'select'), false, 'Nadie humano lee m2m_jti_replay');
select is(has_column_privilege('authenticated', 'platform.usage_ingest_credentials', 'public_key_ref', 'select'), false,
  'usage_ingest_credentials.public_key_ref no se expone a authenticated');

-- ---------------------------------------------------------------------------
-- Registro de medidores: product admin; negativo por defecto no; facturable no
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.tadmin());
select throws_ok($$ select platform.upsert_usage_meter('esupplier', 'esupplier.qa.ai.calls', 'QA', 'call', 'SUM', 'ACTIVE') $$,
  '42501', null, 'Un tenant admin no registra medidores');
select pg_temp.act_as(pg_temp.padmin());
select isnt(platform.upsert_usage_meter('esupplier', 'esupplier.qa.ai.calls', 'QA llamadas IA', 'call', 'SUM', 'ACTIVE'), null,
  'El product admin registra un medidor ACTIVE');
select platform.upsert_usage_meter('esupplier', 'esupplier.qa.draft', 'QA borrador', 'call', 'SUM', 'DRAFT');
select platform.upsert_usage_meter('esupplier', 'esupplier.qa.credits.adjust', 'QA ajuste', 'call', 'SUM', 'ACTIVE', p_allows_negative => true);
select is((select is_billable::text || ':' || allows_negative::text from platform.usage_meters where code = 'esupplier.qa.ai.calls'),
  'false:false', 'Medidor nuevo: is_billable=false y allows_negative=false por defecto (D-06)');
select throws_ok($$ select platform.upsert_usage_meter('esupplier', 'Bad Code', 'x', 'call', 'SUM', 'ACTIVE') $$,
  '23514', null, 'Código de medidor con formato inválido → rechazado');
select throws_ok($$ select platform.set_usage_meter_billable('esupplier', 'esupplier.qa.ai.calls', true, 'QA') $$,
  '42501', null, 'Solo finanzas decide si un medidor es facturable');

-- ---------------------------------------------------------------------------
-- Escenario: alpha mapeado ACTIVE en eSupplier DEV; p1 sin mapping
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
insert into platform.tenant_product_mappings
  (tenant_id, saas_product_id, deployment_target_id, external_tenant_id, external_organization_id,
   external_company_id, status, provisioned_at, registered_manually)
values (pg_temp.alpha(), pg_temp.esup(), '40000000-0000-4000-a000-00000000000a',
        'ext-alpha', 'ext-org-alpha', 'ext-co-alpha', 'ACTIVE', now() - interval '1 day', true);

-- ---------------------------------------------------------------------------
-- Autoridad del ingest
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.super());
select throws_ok($$ select platform.ingest_usage_events('esupplier', 'DEV', '[]'::jsonb, gen_random_uuid()) $$,
  '42501', null, 'Ni el super admin ingesta uso (solo el servidor tras el M2M)');
select pg_temp.act_as_postgres();
select throws_ok($$ select platform.ingest_usage_events('esupplier', 'DEV', '[]'::jsonb, gen_random_uuid()) $$,
  '42501', null, 'Sin claim service_role (conexión directa) tampoco');

-- ---------------------------------------------------------------------------
-- Resultados por evento
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
create temp table r1 as
select platform.ingest_usage_events('esupplier', 'DEV', jsonb_build_array(
  pg_temp.ev('7f000000-0000-4000-8000-000000000001', 'esupplier.qa.ai.calls', 1, pg_temp.alpha(),
             p_internal => '{"provider":"anthropic","model":"m-1","inputTokens":120,"outputTokens":30,"latencyMs":800}'),
  pg_temp.ev('7f000000-0000-4000-8000-000000000001', 'esupplier.qa.ai.calls', 1, pg_temp.alpha(),
             p_internal => '{"provider":"anthropic","model":"m-1","inputTokens":120,"outputTokens":30,"latencyMs":800}'),
  pg_temp.ev('7f000000-0000-4000-8000-000000000001', 'esupplier.qa.ai.calls', 2, pg_temp.alpha()),
  pg_temp.ev('7f000000-0000-4000-8000-000000000002', 'esupplier.qa.unknown', 1, pg_temp.alpha()),
  pg_temp.ev('7f000000-0000-4000-8000-000000000003', 'esupplier.qa.draft', 1, pg_temp.alpha()),
  pg_temp.ev('7f000000-0000-4000-8000-000000000004', 'esupplier.qa.ai.calls', -1, pg_temp.alpha()),
  pg_temp.ev('7f000000-0000-4000-8000-000000000005', 'esupplier.qa.credits.adjust', -1, pg_temp.alpha()),
  pg_temp.ev('7f000000-0000-4000-8000-000000000006', 'esupplier.qa.ai.calls', 1, pg_temp.p1()),
  pg_temp.ev('7f000000-0000-4000-8000-000000000007', 'esupplier.qa.ai.calls', 1, pg_temp.ewm_alpha()),
  pg_temp.ev('7f000000-0000-4000-8000-000000000008', 'esupplier.qa.ai.calls', 1, pg_temp.alpha(), p_unit => 'page'),
  pg_temp.ev('7f000000-0000-4000-8000-000000000009', 'esupplier.qa.ai.calls', 1, pg_temp.alpha(),
             p_at => to_char((now() + interval '1 hour') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  pg_temp.ev('7f000000-0000-4000-8000-00000000000a', 'esupplier.qa.ai.calls', 1, pg_temp.alpha(),
             p_internal => '{"provider":"anthropic","prompt":"texto del cliente"}'),
  pg_temp.ev('7f000000-0000-4000-8000-00000000000b', 'esupplier.qa.ai.calls', 1, pg_temp.alpha(),
             p_internal => '{"provider":"anthropic","inputTokens":-5}'),
  jsonb_build_object('eventId', 'no-es-uuid', 'meterCode', 'esupplier.qa.ai.calls', 'quantity', 1),
  pg_temp.ev('7f000000-0000-4000-8000-00000000000c', 'esupplier.qa.ai.calls', 1.5, pg_temp.alpha())
), '6f000000-0000-4000-8000-0000000000b1') as res;

select is(pg_temp.status_of((select res from r1), 0), 'ACCEPTED', 'Evento nuevo → ACCEPTED');
select is(pg_temp.status_of((select res from r1), 1), 'DUPLICATE', 'Duplicado idéntico → DUPLICATE (aceptado)');
select is(pg_temp.status_of((select res from r1), 2), 'REJECTED:CONFLICT', 'Mismo event_id con contenido distinto → CONFLICT');
select is(pg_temp.status_of((select res from r1), 3), 'REJECTED:UNKNOWN_METER', 'Medidor inexistente → UNKNOWN_METER');
select is(pg_temp.status_of((select res from r1), 4), 'REJECTED:UNKNOWN_METER', 'Medidor DRAFT → UNKNOWN_METER');
select is(pg_temp.status_of((select res from r1), 5), 'REJECTED:NEGATIVE_QUANTITY', 'Cantidad negativa → rechazada');
select is(pg_temp.status_of((select res from r1), 6), 'ACCEPTED', 'Negativa aceptada solo si el medidor declara allows_negative');
select is(pg_temp.status_of((select res from r1), 7), 'REJECTED:TENANT_NOT_MAPPED_FOR_PRODUCT', 'Tenant sin mapping ACTIVE → TENANT_NOT_MAPPED_FOR_PRODUCT');
select is(pg_temp.status_of((select res from r1), 8), 'REJECTED:TENANT_NOT_MAPPED_FOR_PRODUCT', 'Tenant de OTRO producto → TENANT_NOT_MAPPED_FOR_PRODUCT');
select is(pg_temp.status_of((select res from r1), 9), 'REJECTED:UNIT_MISMATCH', 'Unidad distinta a la del medidor → UNIT_MISMATCH');
select is(pg_temp.status_of((select res from r1), 10), 'REJECTED:OCCURRED_AT_IN_FUTURE', 'occurredAt en el futuro (más allá del skew) → rechazado');
select is(pg_temp.status_of((select res from r1), 11), 'REJECTED:INTERNAL_METADATA_INVALID', 'internal con contenido (prompt) → rechazado');
select is(pg_temp.status_of((select res from r1), 12), 'REJECTED:INTERNAL_METADATA_INVALID', 'internal con tokens negativos → rechazado');
select is(pg_temp.status_of((select res from r1), 13), 'REJECTED:INVALID_EVENT', 'Evento mal formado → INVALID_EVENT');
select is(pg_temp.status_of((select res from r1), 14), 'ACCEPTED', 'Cantidad decimal no negativa → ACCEPTED');
select is((select (res ->> 'accepted') || '/' || (res ->> 'duplicate') || '/' || (res ->> 'rejected') from r1),
  '3/1/11', 'Conteos del lote: 3 aceptados, 1 duplicado, 11 rechazados');

select is(pg_temp.status_of(platform.ingest_usage_events('esupplier', 'QAS', jsonb_build_array(
    pg_temp.ev('7f000000-0000-4000-8000-0000000000d1', 'esupplier.qa.ai.calls', 1, pg_temp.alpha())), gen_random_uuid()), 0),
  'REJECTED:ENVIRONMENT_MISMATCH', 'Lote QAS para un tenant mapeado en DEV → ENVIRONMENT_MISMATCH');
select throws_ok($$ select platform.ingest_usage_events('esupplier', 'DEV', (select jsonb_agg(pg_temp.ev(gen_random_uuid()::text, 'esupplier.qa.ai.calls', 1, pg_temp.alpha())) from generate_series(1, 501)), gen_random_uuid()) $$,
  '22023', null, 'Lote > 500 eventos → rechazado entero');
select throws_ok($$ select platform.ingest_usage_events('nope', 'DEV', '[]'::jsonb, gen_random_uuid()) $$,
  'P0002', null, 'Producto desconocido → error');

-- Reintento del lote completo: idempotente, nada nuevo
select is((select (res ->> 'accepted') || '/' || (res ->> 'duplicate')
             from (select platform.ingest_usage_events('esupplier', 'DEV', jsonb_build_array(
                     pg_temp.ev('7f000000-0000-4000-8000-000000000001', 'esupplier.qa.ai.calls', 1, pg_temp.alpha(),
                                p_internal => '{"provider":"anthropic","model":"m-1","inputTokens":120,"outputTokens":30,"latencyMs":800}')),
                     gen_random_uuid()) as res) x),
  '0/1', 'Reenvío del mismo evento: DUPLICATE, sin fila nueva');

select pg_temp.act_as_postgres();
select is((select count(*)::int from platform.usage_events where saas_product_id = pg_temp.esup()), 3, 'Solo 3 eventos persistidos');
select is((select event_hash ~ '^sha256:[0-9a-f]{64}$' and quantity = 1 and unit = 'call' and meter_code = 'esupplier.qa.ai.calls'
             and tenant_id = pg_temp.alpha() and (internal ->> 'inputTokens')::int = 120
             from platform.usage_events where event_id = '7f000000-0000-4000-8000-000000000001'),
  true, 'Evento persistido con hash, atribución y metadata interna');
select is((select count(*)::int from platform.usage_ingest_rejections where code = 'CONFLICT'), 1,
  'El CONFLICT queda registrado como alerta');
select is((select count(*)::int from platform.usage_ingest_rejections
            where detail::text ~* '(prompt|texto del cliente)'), 0, 'La alerta no guarda contenido del evento');

-- Append-only
select throws_ok($$ update platform.usage_events set quantity = 9 $$, '55000', null, 'usage_events: UPDATE prohibido incluso para postgres');
select throws_ok($$ delete from platform.usage_events $$, '55000', null, 'usage_events: DELETE prohibido');
select throws_ok($$ truncate platform.usage_events $$, '55000', null, 'usage_events: TRUNCATE prohibido');

-- ---------------------------------------------------------------------------
-- Lectura: RLS por tenant; COGS solo finanzas
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.tadmin());
select is((select count(*)::int from platform.usage_events), 3, 'El tenant admin de alpha ve su consumo');
select throws_ok($$ select internal from platform.usage_events $$, '42501', null, 'El tenant admin NO lee internal (COGS)');
select throws_ok($$ select * from platform.usage_event_cogs(pg_temp.alpha(), now() - interval '1 day', now()) $$,
  '42501', null, 'usage_event_cogs: denegado a un no-finanzas');
select pg_temp.act_as(pg_temp.finance());
select is((select count(*)::int from platform.usage_event_cogs(pg_temp.alpha(), now() - interval '1 day', now()) where internal ? 'model'), 1,
  'Finanzas lee la metadata interna de COGS por RPC');

-- ---------------------------------------------------------------------------
-- jti de un solo uso
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select is(platform.consume_m2m_jti('esupplier.ebim', 'jti-1', now() + interval '5 minutes'), true, 'jti nuevo → consumido');
select is(platform.consume_m2m_jti('esupplier.ebim', 'jti-1', now() + interval '5 minutes'), false, 'jti repetido → rechazado');
select is(platform.consume_m2m_jti('ewm.ebim', 'jti-1', now() + interval '5 minutes'), true, 'El mismo jti de otro emisor es independiente');

select * from finish();
rollback;
