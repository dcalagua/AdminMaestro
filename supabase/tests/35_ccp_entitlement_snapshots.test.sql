-- ============================================================================
-- EBIM Commercial Control Plane · Fase 08 · snapshots versionados (Task MA-32)
-- ----------------------------------------------------------------------------
-- Spec §7 (ebim.entitlements/v1, JCS + SHA-256, versión monótona, sin versión
-- nueva si el contenido no cambia, append-only, effectiveAt ≤ now(), sin
-- precios ni secretos), §14 (solo service_role emite). Plan §10.1 MA-32.
--
-- La concurrencia entre dos sesiones (advisory lock) no se puede ejercitar en
-- una sola transacción pgTAP: la prueba está en
-- scripts/ccp/entitlement-snapshot-concurrency.sh (evidencia MA-32).
-- ============================================================================
begin;
select plan(50);

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

create or replace function pg_temp.sha(p text) returns text language sql as $$
  select encode(sha256(convert_to(p, 'UTF8')), 'hex')
$$;

create or replace function pg_temp.latest(p_tenant uuid) returns platform.entitlement_snapshots
language sql as $$
  select s.* from platform.entitlement_snapshots s
   where s.tenant_id = p_tenant and s.saas_product_id = pg_temp.esup()
   order by s.snapshot_version desc limit 1
$$;

-- ---------------------------------------------------------------------------
-- Forma y privilegios
-- ---------------------------------------------------------------------------
select has_table('platform', 'entitlement_snapshots', 'Existe entitlement_snapshots');
select is((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'platform.entitlement_snapshots'::regclass),
  true, 'RLS habilitado y forzado');
select is(
  (select string_agg(r || ':' || has_function_privilege(r, 'platform.issue_entitlement_snapshot(uuid, uuid, timestamptz)', 'execute'), ',' order by r)
     from unnest(array['anon', 'authenticated', 'service_role']) r),
  'anon:false,authenticated:false,service_role:true',
  'issue_entitlement_snapshot: EXECUTE solo service_role');
select is(
  (select p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), '')
     from pg_proc p where p.oid = 'platform.issue_entitlement_snapshot(uuid, uuid, timestamptz)'::regprocedure),
  'true:search_path=platform, pg_catalog', 'issue es SECURITY DEFINER con search_path fijo');
select is(
  (select string_agg(r || ':' || has_table_privilege(r, 'platform.entitlement_snapshots', 'insert,update,delete'), ',' order by r)
     from unnest(array['anon', 'authenticated']) r),
  'anon:false,authenticated:false', 'Sin escritura directa para anon ni authenticated');
select is((select provolatile::text from pg_proc where oid = 'platform.jcs_canonical(jsonb)'::regprocedure),
  'i', 'jcs_canonical es IMMUTABLE');

-- ---------------------------------------------------------------------------
-- JCS: vectores sqlDomain de contracts/entitlements/v1/jcs-vectors.json
-- (el test de vitest pin-sql-vectors comprueba que estos sha256 son los del archivo)
-- ---------------------------------------------------------------------------
select is(pg_temp.sha(platform.jcs_canonical('{"b":2,"a":1,"c":{"z":true,"y":null}}')),
  '8de4da99ba10a81ad0712ed5ca145e6017393749463cfdafc1a6b16836ad4d1d', 'JCS key-order');
select is(pg_temp.sha(platform.jcs_canonical('{"s":"Almac\u00e9n \u20ac \ud83d\ude00 \u00f1"}')),
  '9564099aad41013f7cfeee67d818cefa93b653586d88322bc65f61edf0c63679', 'JCS unicode-values');
select is(pg_temp.sha(platform.jcs_canonical('{"e":"a\"b\\c\n\t\b\f\r\u0001\u001F\/\u007f"}')),
  '38dee623555e22c5490c909ab483d436fa3a8b83c057798c502fe7e6ab18fce3', 'JCS escapes');
select is(pg_temp.sha(platform.jcs_canonical('{"a":0,"b":-7,"c":9007199254740991,"d":100}')),
  '3474ee30f83d89b7bd9e63fec0f719eebb6cee0ac6e7a159b9a3231d35abbb81', 'JCS integers');
select is(pg_temp.sha(platform.jcs_canonical('{"a":4.50,"b":0.002,"c":-1.5,"d":10.0}')),
  '4d1458148566503caf3ebc4580378a8e3cfcb0789aed7c1908adcf291d431e28', 'JCS decimals');
select is(pg_temp.sha(platform.jcs_canonical('{"b":{},"a":[]}')),
  '9959f7ea5ff37e0cf81634a894845a335eb6e26fbad0877944e9bc009b4f0644', 'JCS empty-containers');
select is(pg_temp.sha(platform.jcs_canonical('{"x":[3,1,2,true,false,null]}')),
  'c9a35aeef41adfdb7922756a46449375699fcb922c76cb1c4c9749be7a989f7f', 'JCS literals-and-array-order');
select is(pg_temp.sha(platform.jcs_canonical('{ "a" : [ 1 , { "c" : "d" , "b" : "e" } ] }')),
  'c714c03c80a30063e6a5093dddf9460ee48956d2e4e76b96be7039951a63e763', 'JCS whitespace');

-- Fuera del dominio SQL: se rechaza en vez de producir bytes distintos a TS.
select is(platform.entitlement_checksum('{"schema":"ebim.entitlements/v1","environment":"DEV","controlPlaneTenantId":"00000000-0000-4ccc-8000-000000000003","productCode":"fixture","external":{"tenantId":"fixture-ext-03","organizationId":"fixture-org-03","companyIds":["fixture-co-03a","fixture-co-03b"]},"snapshotVersion":1,"previousVersion":null,"effectiveAt":"2026-10-01T00:00:01Z","issuedAt":"2026-10-01T00:00:11Z","appActive":true,"planCode":"fixture-standard","capabilities":[{"code":"fixture.ai.insights","enabled":false,"scope":{"level":"TENANT"},"sources":[]},{"code":"fixture.promotions","enabled":true,"scope":{"level":"COMPANY","companyIds":["00000000-0000-4ccc-8000-00000000c001","00000000-0000-4ccc-8000-00000000c002"]},"sources":["ADDON"]},{"code":"fixture.reports","enabled":true,"scope":{"level":"TENANT"},"sources":["PLAN"]}],"limits":[{"code":"fixture.users.max","value":25,"unit":"user","enforcement":"HARD","scope":{"level":"TENANT"},"sources":["ADDON","PLAN"]}],"allowances":[{"code":"fixture.docs.monthly","meterCode":"docs","included":150,"unit":"document","period":{"start":"2026-10-01","end":"2026-10-31"},"overageMode":"BLOCK","sources":["ADDON","PLAN"]}],"aiCredits":{"weights":[],"weightsVersion":0},"correlationId":"00000000-0000-4ccc-8000-0000000c0031","idempotencyKey":"ma-ent-v1-611b1bad1c8e026ef277f4ab57632ab06144acee714bef728b8b56825532bfaf","checksum":"sha256:f6d60051140269bd0f27157943fa94e2b3a333f3ad54593357000091c92d7600"}'::jsonb),
  'sha256:f6d60051140269bd0f27157943fa94e2b3a333f3ad54593357000091c92d7600',
  'SQL y TS producen el mismo checksum para el fixture dorado 03-plan-plus-addon (FIX-ENT-v1)');
select throws_ok($$ select platform.jcs_canonical('{"ö":1}') $$, '22023', null, 'Clave no ASCII → error');
select throws_ok($$ select platform.jcs_canonical('[1e21]') $$, '22023', null, 'Entero ≥ 1e21 → error');
select throws_ok($$ select platform.jcs_canonical('[9007199254740993]') $$, '22023', null, 'Entero > 2^53 − 1 → error');
select throws_ok($$ select platform.jcs_canonical('[0.1234567890123456]') $$, '22023', null, '16 dígitos significativos → error');
select throws_ok($$ select platform.jcs_canonical('[0.0000001]') $$, '22023', null, '|x| < 1e-6 → error');
select is(platform.entitlement_checksum('{"b":1,"a":"x","checksum":"sha256:x"}'),
  'sha256:' || pg_temp.sha('{"a":"x","b":1}'), 'entitlement_checksum ignora el campo checksum');

-- ---------------------------------------------------------------------------
-- Escenario: registro QA, grants y mapping ACTIVE de alpha en eSupplier DEV
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select platform.import_capability_manifest('esupplier', '{
  "schema": "ebim.capabilities/v1", "productCode": "esupplier", "manifestVersion": "qa-1",
  "capabilities": [
    {"code": "esupplier.qa.core", "name": "QA núcleo", "kind": "FEATURE", "isBaseline": true, "status": "ACTIVE"},
    {"code": "esupplier.qa.tenders", "name": "QA licitaciones", "kind": "FEATURE", "status": "ACTIVE"},
    {"code": "esupplier.qa.scoped", "name": "QA por compañía", "kind": "FEATURE", "scopeLevel": "COMPANY", "status": "ACTIVE"},
    {"code": "esupplier.qa.users.max", "name": "QA usuarios", "kind": "LIMIT", "unit": "user", "combineRule": "MAX", "status": "ACTIVE"},
    {"code": "esupplier.qa.docs", "name": "QA documentos", "kind": "ALLOWANCE", "unit": "document", "combineRule": "SUM", "meterCode": "documents", "status": "ACTIVE"},
    {"code": "esupplier.qa.ai.copilot", "name": "QA copiloto", "kind": "AI_FEATURE", "meterCode": "ai.credits", "status": "ACTIVE"},
    {"code": "esupplier.qa.beta", "name": "QA borrador", "kind": "FEATURE", "status": "DRAFT"}
  ]}'::jsonb);
select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.tenders', '{"enabled": true}', current_date - 30, 'QA');
select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.users.max', '{"value": 25, "enforcement": "HARD"}', current_date - 30, 'QA');
select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.docs', '{"included": 100, "period": "MONTH"}', current_date - 30, 'QA');
select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.beta', '{"enabled": true}', current_date - 30, 'QA');
select platform.create_entitlement_grant('PLAN', 'esupplier-shared-standard', 'esupplier.qa.ai.copilot', '{"enabled": true}', current_date + 10, 'QA futuro');
select platform.create_entitlement_grant('CATALOG_ITEM', 'licitaciones', 'esupplier.qa.users.max', '{"value": 10, "enforcement": "SOFT"}', current_date - 30, 'QA');
select platform.create_entitlement_grant('CATALOG_ITEM', 'licitaciones', 'esupplier.qa.docs', '{"included": 50, "period": "MONTH"}', current_date - 30, 'QA');

select pg_temp.act_as_postgres();
insert into platform.tenant_product_mappings
  (tenant_id, saas_product_id, deployment_target_id, external_tenant_id, external_organization_id,
   external_company_id, status, provisioned_at, registered_manually)
values (pg_temp.alpha(), pg_temp.esup(), '40000000-0000-4000-a000-00000000000a',
        'ext-alpha', 'ext-org-alpha', 'ext-co-alpha', 'ACTIVE', now() - interval '1 day', true);

-- ---------------------------------------------------------------------------
-- Autoridad: solo el servidor emite
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select throws_ok($$ select platform.issue_entitlement_snapshot(pg_temp.alpha(), pg_temp.esup()) $$,
  '42501', null, 'Un humano (product admin) no emite snapshots');
select pg_temp.act_as_postgres();
select throws_ok($$ select platform.issue_entitlement_snapshot(pg_temp.alpha(), pg_temp.esup()) $$,
  '42501', null, 'Sin claim service_role (conexión directa) tampoco emite');

-- ---------------------------------------------------------------------------
-- Primera emisión
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select is((platform.issue_entitlement_snapshot(pg_temp.alpha(), pg_temp.esup()) ->> 'issued')::boolean,
  true, 'Primera emisión: versión nueva');
select pg_temp.act_as_postgres();
select is((select snapshot_version::text || ':' || coalesce(previous_version::text, 'null') from pg_temp.latest(pg_temp.alpha())),
  '1:null', 'Versión 1, sin anterior');
select is((select checksum = platform.entitlement_checksum(document) and document ->> 'checksum' = checksum
             from pg_temp.latest(pg_temp.alpha())),
  true, 'checksum = JCS del documento sin checksum, y viaja dentro del documento');
select is((select idempotency_key from pg_temp.latest(pg_temp.alpha())),
  'ma-ent-v1-' || pg_temp.sha(pg_temp.alpha()::text || ':esupplier:1'), 'idempotencyKey = ma-ent-v1-sha256(tenant:producto:versión)');
select is((select document -> 'capabilities' from pg_temp.latest(pg_temp.alpha())),
  '[{"code": "esupplier.qa.ai.copilot", "enabled": false, "scope": {"level": "TENANT"}, "sources": []},
    {"code": "esupplier.qa.scoped", "enabled": false, "scope": {"level": "COMPANY"}, "sources": []},
    {"code": "esupplier.qa.tenders", "enabled": true, "scope": {"level": "TENANT"}, "sources": ["PLAN"]}]'::jsonb,
  'capabilities: todas las sellables ACTIVE con enabled explícito; sin baseline, sin DRAFT; grant futuro = false');
select is((select document -> 'limits' from pg_temp.latest(pg_temp.alpha())),
  '[{"code": "esupplier.qa.users.max", "value": 25, "unit": "user", "enforcement": "HARD",
     "scope": {"level": "TENANT"}, "sources": ["ADDON", "PLAN"]}]'::jsonb,
  'limits: MAX(25 HARD, 10 SOFT) con sus fuentes');
select is((select document -> 'allowances' from pg_temp.latest(pg_temp.alpha())),
  jsonb_build_array(jsonb_build_object(
    'code', 'esupplier.qa.docs', 'meterCode', 'documents', 'included', 150, 'unit', 'document',
    'period', jsonb_build_object(
      'start', to_char(date_trunc('month', now() at time zone 'UTC'), 'YYYY-MM-DD'),
      'end', to_char(date_trunc('month', now() at time zone 'UTC') + interval '1 month' - interval '1 day', 'YYYY-MM-DD')),
    'overageMode', 'BLOCK', 'sources', jsonb_build_array('ADDON', 'PLAN'))),
  'allowances: SUM(100 + 50) del mes en curso, BLOCK por defecto');
select is((select jsonb_build_object('schema', document -> 'schema', 'environment', document -> 'environment',
                                     'productCode', document -> 'productCode', 'tenant', document -> 'controlPlaneTenantId',
                                     'external', document -> 'external', 'appActive', document -> 'appActive',
                                     'planCode', document -> 'planCode', 'aiCredits', document -> 'aiCredits')
             from pg_temp.latest(pg_temp.alpha())),
  jsonb_build_object('schema', 'ebim.entitlements/v1', 'environment', 'DEV', 'productCode', 'esupplier',
                     'tenant', pg_temp.alpha(), 'appActive', true, 'planCode', 'esupplier-shared-standard',
                     'external', '{"tenantId": "ext-alpha", "organizationId": "ext-org-alpha", "companyIds": ["ext-co-alpha"]}'::jsonb,
                     'aiCredits', '{"weights": [], "weightsVersion": 0}'::jsonb),
  'Cabecera: esquema, ambiente del destino, ids externos del mapping, plan y app activa');
select is((select count(*)::int from pg_temp.latest(pg_temp.alpha()) s,
                  lateral jsonb_path_query(s.document, 'strict $.**') v,
                  lateral jsonb_object_keys(case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end) k
            where k ~* '(price|amount|currency|cost|secret|token|email|key|password)' and k <> 'idempotencyKey'),
  0, 'Ninguna clave prohibida en todo el documento (spec §7.2 regla 6)');
select is((select (document ->> 'effectiveAt')::timestamptz <= (document ->> 'issuedAt')::timestamptz
                  and size_bytes = octet_length(platform.jcs_canonical(document)) and size_bytes <= 65536
             from pg_temp.latest(pg_temp.alpha())),
  true, 'effectiveAt ≤ issuedAt; tamaño medido y ≤ 64 KB');
select is((select desired_dirty from platform.entitlement_desired_state
            where tenant_id = pg_temp.alpha() and saas_product_id = pg_temp.esup()),
  false, 'Emitir limpia desired_dirty');

-- ---------------------------------------------------------------------------
-- Sin cambios → sin versión nueva; con cambio → versión + 1
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select is(platform.issue_entitlement_snapshot(pg_temp.alpha(), pg_temp.esup()) ->> 'issued',
  'false', 'Mismo contenido canónico: no se emite versión nueva');
select is((select count(*)::int from platform.entitlement_snapshots where tenant_id = pg_temp.alpha()),
  1, 'Sigue habiendo un solo snapshot');

select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select platform.create_entitlement_override(pg_temp.alpha(), 'esupplier.qa.scoped', 'GRANT', '{"enabled": true}',
  now() + interval '30 days', 'Piloto QA');
select pg_temp.act_as_postgres();
select is((select desired_dirty from platform.entitlement_desired_state
            where tenant_id = pg_temp.alpha() and saas_product_id = pg_temp.esup()),
  true, 'Un override marca dirty');
select pg_temp.act_as_service();
select is(platform.issue_entitlement_snapshot(pg_temp.alpha(), pg_temp.esup()) ->> 'version',
  '2', 'Con cambio: versión 2');
select pg_temp.act_as_postgres();
select is((select previous_version::text || ':' || (document -> 'capabilities' -> 1 ->> 'enabled')
                  || ':' || (document -> 'capabilities' -> 1 -> 'sources')::text
             from pg_temp.latest(pg_temp.alpha())),
  '1:true:["OVERRIDE"]', 'La versión 2 apunta a la 1 y concede la capacidad por OVERRIDE');
select is((select count(distinct correlation_id)::int from platform.entitlement_snapshots where tenant_id = pg_temp.alpha()),
  2, 'Cada emisión tiene su propia correlación');

-- ---------------------------------------------------------------------------
-- Append-only (incluso para postgres) y unicidad de versión
-- ---------------------------------------------------------------------------
select throws_ok($$ update platform.entitlement_snapshots set checksum = checksum where tenant_id = pg_temp.alpha() $$,
  '55000', null, 'UPDATE bloqueado');
select throws_ok($$ delete from platform.entitlement_snapshots where tenant_id = pg_temp.alpha() $$,
  '55000', null, 'DELETE bloqueado');
select throws_ok($$ truncate platform.entitlement_snapshots $$, '55000', null, 'TRUNCATE bloqueado');
select throws_ok($$
  insert into platform.entitlement_snapshots
    (tenant_id, saas_product_id, snapshot_version, previous_version, document, checksum, content_checksum,
     effective_at, correlation_id, idempotency_key, size_bytes)
  select tenant_id, saas_product_id, 2, 1, document, checksum, content_checksum,
         effective_at, gen_random_uuid(), 'ma-ent-v1-' || repeat('0', 64), size_bytes
    from pg_temp.latest(pg_temp.alpha()) $$,
  '23505', null, 'Versión duplicada por tenant×producto → 23505');

-- ---------------------------------------------------------------------------
-- Precondiciones
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select throws_ok($$ select platform.issue_entitlement_snapshot(pg_temp.alpha(), pg_temp.esup(), now() + interval '1 hour') $$,
  '22023', null, 'effectiveAt en el futuro → VIGENCIA_FUTURA (lo emite el job al llegar la fecha)');
select throws_ok($$ select platform.issue_entitlement_snapshot(pg_temp.p1(), pg_temp.esup()) $$,
  'P0002', null, 'Tenant sin mapping ACTIVE → TENANT_NO_APROVISIONADO');
select throws_ok($$ select platform.issue_entitlement_snapshot(pg_temp.alpha(), '20000000-0000-4000-a000-000000000002') $$,
  '22023', null, 'Tenant de otro producto → TENANT_PRODUCTO_INCOHERENTE');

-- ---------------------------------------------------------------------------
-- Lectura (RLS)
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select is((select count(*)::int from platform.entitlement_snapshots where tenant_id = pg_temp.alpha()),
  2, 'Plataforma lee los snapshots');
select pg_temp.act_as('10000000-0000-4000-a000-00000000000a');
select is((select count(*)::int from platform.entitlement_snapshots where tenant_id = pg_temp.alpha()),
  0, 'El admin de omega no ve los snapshots de alpha');
select pg_temp.act_as('10000000-0000-4000-a000-0000000000ff');
select is((select count(*)::int from platform.entitlement_snapshots), 0, 'authenticated sin rol no ve nada');

select * from finish();
rollback;
