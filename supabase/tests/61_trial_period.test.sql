-- ============================================================================
-- Periodo de prueba (20261024000100_echange_trial_period, contrato trial.v1)
--   · días por producto (7 por defecto, 1..90) con RPC dedicada y auditada;
--   · el alta de un tenant TRIAL fija trial_ends_at = now() + días del producto;
--   · nadie se extiende la prueba por PATCH: solo set_tenant_trial_end;
--   · extender / convertir: permisos, motivo, fecha futura, auditoría;
--   · el payload de provisioning lleva `trial` solo para TRIAL;
--   · la entrega trial.v1: STARTED al aprovisionar, EXTENDED, CONVERTED;
--   · apply_due_trial_expirations: DRY_RUN lista, LIVE suspende (super admin),
--     extender reactiva lo suspendido por prueba vencida.
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

create or replace function pg_temp.echange() returns uuid language sql as $$ select '20000000-0000-4000-a000-000000000005'::uuid $$;
create or replace function pg_temp.esup() returns uuid language sql as $$ select '20000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.super() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.padmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.finance() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000003'::uuid $$;
create or replace function pg_temp.comercial() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000008'::uuid $$;
create or replace function pg_temp.alpha_admin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000009'::uuid $$;
create or replace function pg_temp.alpha_org() returns uuid language sql as $$ select '30000000-0000-4000-a000-000000000004'::uuid $$;
create or replace function pg_temp.integ() returns uuid language sql as $$ select '70000000-0000-4000-a000-0000000000f8'::uuid $$;

create temp table qa (k text primary key, v text);
grant all on qa to authenticated, service_role;
create or replace function pg_temp.v(p_key text) returns text language sql as $$ select v from qa where k = p_key $$;
create or replace function pg_temp.t(p_key text) returns uuid language sql as $$ select v::uuid from qa where k = p_key $$;

-- ---------------------------------------------------------------------------
-- Forma, defaults y privilegios
-- ---------------------------------------------------------------------------
select col_default_is('platform', 'saas_products', 'trial_days', '7', 'saas_products.trial_days nace en 7');
select is((select trial_days::int from platform.saas_products where id = pg_temp.echange()), 7,
  'eChange tiene 7 días de prueba por defecto');
select throws_ok($$ update platform.saas_products set trial_days = 0 where id = pg_temp.echange() $$,
  '23514', null, 'CHECK: la prueba dura al menos 1 día');
select throws_ok($$ update platform.saas_products set trial_days = 91 where id = pg_temp.echange() $$,
  '23514', null, 'CHECK: la prueba dura como mucho 90 días');
select is(
  (select string_agg(f || ':' || has_function_privilege('anon', f, 'execute') || '/'
                     || has_function_privilege('authenticated', f, 'execute'), ',' order by f)
     from unnest(array[
       'platform.apply_due_trial_expirations(timestamptz, text)',
       'platform.set_product_trial_days(uuid, integer)',
       'platform.set_tenant_trial_end(uuid, timestamptz, text)']) f),
  'platform.apply_due_trial_expirations(timestamptz, text):false/true,'
  || 'platform.set_product_trial_days(uuid, integer):false/true,'
  || 'platform.set_tenant_trial_end(uuid, timestamptz, text):false/true',
  'Las RPC de consola: anon no, authenticated sí (la guardia está dentro)');
select is(
  (select string_agg(f || ':' || has_function_privilege('authenticated', f, 'execute') || '/'
                     || has_function_privilege('service_role', f, 'execute'), ',' order by f)
     from unnest(array[
       'platform.claim_trial_deliveries(text, integer, integer)',
       'platform.record_trial_delivery_result(uuid, text, integer, text, integer, text, text)',
       'platform.trial_delivery_context(uuid)']) f),
  'platform.claim_trial_deliveries(text, integer, integer):false/true,'
  || 'platform.record_trial_delivery_result(uuid, text, integer, text, integer, text, text):false/true,'
  || 'platform.trial_delivery_context(uuid):false/true',
  'Claim, contexto y resultado de trial.v1 son solo del canal servidor');
select is(
  (select bool_or(has_function_privilege(r, f, 'execute'))
     from unnest(array['anon', 'authenticated', 'service_role']) r,
          unnest(array['platform._mark_trial_desired(uuid, text)', 'platform.trial_channel_of(uuid)']) f),
  false, 'Los núcleos de trial.v1 no tienen GRANT para nadie');
select is((select relrowsecurity and relforcerowsecurity from pg_class
            where oid = 'platform.tenant_trial_delivery'::regclass), true, 'tenant_trial_delivery: RLS habilitada y forzada');
select is(has_table_privilege('authenticated', 'platform.tenant_trial_delivery', 'update'), false,
  'authenticated no escribe la entrega trial.v1');

-- ---------------------------------------------------------------------------
-- set_product_trial_days
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.finance());
select throws_ok($$ select platform.set_product_trial_days(pg_temp.echange(), 10) $$,
  '42501', null, 'Finanzas no configura la prueba de un producto');

select pg_temp.act_as(pg_temp.padmin());
select throws_ok($$ select platform.set_product_trial_days(pg_temp.echange(), 0) $$,
  '23514', null, 'set_product_trial_days rechaza 0 días');
select throws_ok($$ update platform.saas_products set trial_days = 20 where id = pg_temp.echange() $$,
  '42501', null, 'Ni el admin de producto cambia los días por PATCH: sin auditoría no hay cambio');
select is(platform.set_product_trial_days(pg_temp.echange(), 10)::int, 10, 'El admin de producto pone 10 días');
select is((select trial_days::int from platform.saas_products where id = pg_temp.echange()), 10, '… y quedan guardados');
select is((select count(*)::int from platform.audit_logs
            where action = 'PRODUCT_TRIAL_DAYS_CHANGED' and entity_id = pg_temp.echange()::text
              and metadata ->> 'from' = '7' and metadata ->> 'to' = '10'), 1, '… con auditoría (de 7 a 10)');
select is(platform.set_product_trial_days(pg_temp.echange(), 7)::int, 7, 'Y vuelve a 7');

-- ---------------------------------------------------------------------------
-- Alta: un tenant TRIAL nace con vencimiento = now() + días del producto
-- ---------------------------------------------------------------------------
insert into qa select 'trial', platform.create_tenant(
  'echange', pg_temp.alpha_org(), 'qa61-echange-trial', 'QA 61 eChange Trial',
  'admin@qa61.ebim.test', 'TRIAL', 'SHARED')::text;
insert into qa select 'prod', platform.create_tenant(
  'echange', pg_temp.alpha_org(), 'qa61-echange-prod', 'QA 61 eChange Producción',
  'admin@qa61p.ebim.test', 'PRODUCTION', 'SHARED')::text;

select is((select trial_days::int from platform.tenants where id = pg_temp.t('trial')), 7,
  'create_tenant TRIAL copia los días del producto');
select is((select trial_ends_at from platform.tenants where id = pg_temp.t('trial')),
  date_trunc('second', now()) + interval '7 days', 'create_tenant TRIAL vence en now() + 7 días');
select is((select trial_ends_at from platform.tenants where id = pg_temp.t('prod')), null::timestamptz,
  'Un tenant PRODUCTION no tiene vencimiento');

insert into qa select 'onb', (platform.onboard_customer_subscription(
  'esupplier', '30000000-0000-4000-a000-00000000000d', 'qa61-onb-trial', 'QA 61 onboarding trial',
  'admin@qa61onb.ebim.test', '60000000-0000-4000-a000-000000000001', 'BO',
  p_tenant_type => 'TRIAL', p_activate => true) ->> 'tenant_id');
select is((select trial_ends_at from platform.tenants where id = pg_temp.t('onb')),
  date_trunc('second', now()) + make_interval(days => (select trial_days from platform.saas_products where id = pg_temp.esup())),
  'onboard_customer_subscription TRIAL fija trial_ends_at = now() + días del producto');

-- PATCH directo: ni el admin de plataforma ni el admin del cliente.
select throws_ok(format($$ update platform.tenants set trial_ends_at = now() + interval '300 days' where id = %L $$,
                        pg_temp.t('trial')),
  '42501', null, 'Nadie extiende la prueba por PATCH (admin de producto)');
select pg_temp.act_as(pg_temp.alpha_admin());
select throws_ok(format($$ update platform.tenants set tenant_type = 'PRODUCTION' where id = %L $$, pg_temp.t('trial')),
  '42501', null, 'El admin del cliente no sale de TRIAL por PATCH');
select pg_temp.act_as(pg_temp.padmin());
insert into platform.tenants (slug, name, saas_product_id, customer_organization_id, tenant_type, admin_email, trial_ends_at)
values ('qa61-direct-trial', 'QA 61 direct', pg_temp.echange(), pg_temp.alpha_org(), 'TRIAL', 'admin@qa61d.ebim.test',
        now() + interval '5 years');
select is((select trial_ends_at from platform.tenants where slug = 'qa61-direct-trial'),
  date_trunc('second', now()) + interval '7 days', 'Un INSERT por la API no elige su propio vencimiento');

-- ---------------------------------------------------------------------------
-- set_tenant_trial_end: quién, con qué y qué deja
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.comercial());
select throws_ok(format($$ select platform.set_tenant_trial_end(%L, now() + interval '20 days', 'QA') $$, pg_temp.t('trial')),
  '42501', null, 'Un comercial no extiende pruebas (comercial != acceso operativo)');
select pg_temp.act_as(pg_temp.finance());
select throws_ok(format($$ select platform.set_tenant_trial_end(%L, now() + interval '20 days', 'QA') $$, pg_temp.t('trial')),
  '42501', null, 'Finanzas tampoco');

select pg_temp.act_as(pg_temp.padmin());
select throws_ok(format($$ select platform.set_tenant_trial_end(%L, now() - interval '1 day', 'QA') $$, pg_temp.t('trial')),
  '22023', null, 'Extender a una fecha pasada se rechaza');
select throws_ok(format($$ select platform.set_tenant_trial_end(%L, now() + interval '20 days', '  ') $$, pg_temp.t('trial')),
  '23502', null, 'Extender exige motivo');
select throws_ok(format($$ select platform.set_tenant_trial_end(%L, now() + interval '400 days', 'QA') $$, pg_temp.t('trial')),
  '22023', null, 'Una prueba no se extiende más de 365 días');
select throws_ok(format($$ select platform.set_tenant_trial_end(%L, now() + interval '20 days', 'QA') $$, pg_temp.t('prod')),
  '23514', null, 'Un tenant PRODUCTION no tiene prueba que extender');

select is(platform.set_tenant_trial_end(pg_temp.t('trial'), now() + interval '20 days', 'Cliente pidió más tiempo') ->> 'reason',
  'EXTENDED', 'Extender a una fecha posterior es EXTENDED');
select is((select trial_ends_at from platform.tenants where id = pg_temp.t('trial')),
  date_trunc('second', now() + interval '20 days'), '… y el vencimiento queda en la fecha nueva');
select is((select count(*)::int from platform.audit_logs
            where action = 'TENANT_TRIAL_EXTENDED' and entity_id = pg_temp.v('trial')
              and metadata ->> 'reason' = 'Cliente pidió más tiempo'), 1, '… auditado con su motivo');

-- ---------------------------------------------------------------------------
-- Payload de provisioning: `trial` solo para TRIAL
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
with r as (
  insert into platform.saas_provisioning_requests (tenant_id, saas_product_id, idempotency_key, provisioning_environment)
  values (pg_temp.t('trial'), pg_temp.echange(), 'qa61-req-trial', 'DEV') returning id)
insert into qa select 'req_trial', r.id::text from r;
with r as (
  insert into platform.saas_provisioning_requests (tenant_id, saas_product_id, idempotency_key, provisioning_environment)
  values (pg_temp.t('prod'), pg_temp.echange(), 'qa61-req-prod', 'DEV') returning id)
insert into qa select 'req_prod', r.id::text from r;

select pg_temp.act_as_service();
select is(platform.provisioning_execution_context(pg_temp.t('req_trial')) -> 'payload' -> 'trial',
  jsonb_build_object('days', 7, 'endsAt', platform.trial_iso_utc(date_trunc('second', now() + interval '20 days'))),
  'Payload TRIAL: trial = {days, endsAt ISO-8601 UTC}');
select ok(platform.trial_iso_utc('2026-11-24 10:04:05.678+00'::timestamptz) = '2026-11-24T10:04:05Z',
  'endsAt va en UTC, sin milisegundos y con Z');
select is((platform.provisioning_execution_context(pg_temp.t('req_prod')) -> 'payload') ? 'trial', false,
  'Payload PRODUCTION: sin clave trial (el de siempre)');

-- ---------------------------------------------------------------------------
-- Entrega trial.v1: el tenant onboarded se aprovisiona en una integración M2M
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
insert into platform.product_integrations
  (id, saas_product_id, code, name, integration_type, contract_version, issuer, audience, subject, algorithm,
   token_ttl_seconds, create_scope, read_scope, create_path_template, status_path_template, provisioning_policy,
   enabled, status)
values (pg_temp.integ(), pg_temp.esup(), 'esupplier-m2m-trial', 'eSupplier · M2M (trial test)',
        'HTTP_M2M', 'v1', 'masteradmin.ebim', 'esupplier.ebim', 'masteradmin-provisioning', 'ES256', 300,
        'esupplier:tenant:create', 'esupplier:tenant:read', '/tenants', '/tenants/{controlPlaneTenantId}', 'MANUAL',
        true, 'READY');
insert into platform.credential_profiles
  (id, code, name, saas_product_id, type, environment, secret_ref, algorithm, issuer, audience, token_ttl_seconds, enabled)
values ('71000000-0000-4000-a000-0000000000f8', 'esupplier-trial-m2m-test', 'eSupplier M2M (trial test)', pg_temp.esup(),
        'M2M_ASYMMETRIC_JWT', 'DEV', 'LOCAL_ESUPPLIER_M2M_PRIVATE_KEY', 'ES256', 'masteradmin.ebim', 'esupplier.ebim', 300, true);
update platform.deployment_targets
   set product_integration_id = pg_temp.integ(),
       credential_profile_id = '71000000-0000-4000-a000-0000000000f8', base_url = 'http://127.0.0.1:54999'
 where id = '40000000-0000-4000-a000-00000000000a';

select throws_ok($$ update platform.product_integrations
                       set trial_path = '/tenants/{controlPlaneTenantId}/trial', trial_write_scope = 'esupplier:tenant:create'
                     where id = pg_temp.integ() $$,
  '23514', null, 'El scope de trial.v1 no puede ser el de alta');
select throws_ok($$ update platform.product_integrations set trial_path = '/tenants/{controlPlaneTenantId}/trial'
                     where id = pg_temp.integ() $$,
  '23514', null, 'Ruta y scope de trial.v1 van juntos');

select pg_temp.act_as(pg_temp.super());
select is(platform.configure_trial_integration(pg_temp.integ(), '/tenants/{controlPlaneTenantId}/trial',
                                               'esupplier:lifecycle:write'),
  pg_temp.integ(), 'configure_trial_integration fija ruta y scope');

select pg_temp.act_as_postgres();
insert into platform.tenant_product_mappings
  (tenant_id, saas_product_id, deployment_target_id, external_tenant_id, status, provisioned_at, registered_manually)
values (pg_temp.t('onb'), pg_temp.esup(), '40000000-0000-4000-a000-00000000000a', 'ext-qa61', 'ACTIVE', now(), true);

select is((select desired_reason || ':v' || desired_version from platform.tenant_trial_delivery where tenant_id = pg_temp.t('onb')),
  'STARTED:v1', 'Aprovisionar un TRIAL crea la entrega STARTED v1');
select is((select desired_ends_at from platform.tenant_trial_delivery where tenant_id = pg_temp.t('onb')),
  (select trial_ends_at from platform.tenants where id = pg_temp.t('onb')), '… con el vencimiento del tenant');

select pg_temp.act_as_service();
select is((select count(*)::int from platform.claim_trial_deliveries('w61', 10, 60) c where c.tenant_id = pg_temp.t('onb')), 1,
  'El canal servidor reclama la entrega');
select is(platform.trial_delivery_context(pg_temp.t('onb')) -> 'integration' ->> 'trial_path',
  '/tenants/{controlPlaneTenantId}/trial', 'El contexto trae la ruta trial.v1');
select is(platform.record_trial_delivery_result(pg_temp.t('onb'), 'w61', 1, 'APPLIED', 200, null, 'TRIAL'), 'APPLIED',
  'Registrar APPLIED');
select is((select applied_version || ':' || applied_state from platform.tenant_trial_delivery where tenant_id = pg_temp.t('onb')),
  '1:TRIAL', '… queda aplicada la v1 en estado TRIAL');

select pg_temp.act_as(pg_temp.padmin());
select platform.set_tenant_trial_end(pg_temp.t('onb'), now() + interval '30 days', 'Extensión QA');
select is((select desired_reason || ':v' || desired_version from platform.tenant_trial_delivery where tenant_id = pg_temp.t('onb')),
  'EXTENDED:v2', 'Extender sube la versión deseada (EXTENDED v2)');
select is(platform.set_tenant_trial_end(pg_temp.t('onb'), null, 'Firmó contrato') ->> 'reason', 'CONVERTED',
  'NULL convierte la prueba');
select is((select tenant_type::text || ':' || (trial_ends_at is null) || ':' || (trial_converted_at is not null)
             from platform.tenants where id = pg_temp.t('onb')),
  'PRODUCTION:true:true', '… pasa a PRODUCTION, sin vencimiento y con fecha de conversión');
select is((select desired_reason || ':v' || desired_version || ':' || (desired_ends_at is null)
             from platform.tenant_trial_delivery where tenant_id = pg_temp.t('onb')),
  'CONVERTED:v3:true', '… y la app recibe CONVERTED con endsAt null');

-- ---------------------------------------------------------------------------
-- Vencimiento
-- ---------------------------------------------------------------------------
select platform.set_tenant_status(pg_temp.t('trial'), 'ACTIVE', 'QA: activar');

select pg_temp.act_as(pg_temp.finance());
select throws_ok($$ select platform.apply_due_trial_expirations(now() + interval '30 days', 'DRY_RUN') $$,
  '42501', null, 'Finanzas no corre el vencimiento de pruebas');

select pg_temp.act_as(pg_temp.padmin());
insert into qa select 'dry', platform.apply_due_trial_expirations(now() + interval '21 days', 'DRY_RUN')::text;
select is((select count(*)::int from jsonb_array_elements(pg_temp.v('dry')::jsonb -> 'due') d
            where d ->> 'tenant_id' = pg_temp.v('trial') and d ->> 'action' = 'WOULD_SUSPEND'), 1,
  'DRY_RUN lista la prueba vencida (WOULD_SUSPEND)');
select is((select status::text from platform.tenants where id = pg_temp.t('trial')), 'ACTIVE', '… y no la toca');
select is((select count(*)::int from jsonb_array_elements(
             platform.apply_due_trial_expirations(now() + interval '10 days', 'DRY_RUN') -> 'due') d
            where d ->> 'tenant_id' = pg_temp.v('trial')), 0, 'Una prueba que aún no vence no aparece');
select throws_ok($$ select platform.apply_due_trial_expirations(now() + interval '21 days', 'LIVE') $$,
  '42501', null, 'LIVE es del super admin');

select pg_temp.act_as(pg_temp.super());
select is((platform.apply_due_trial_expirations(now() + interval '21 days', 'LIVE') ->> 'applied')::int >= 1, true,
  'LIVE suspende las pruebas vencidas');
select is((select t.status::text || ':' || (su.detail ->> 'source')
             from platform.tenants t
             join platform.tenant_suspensions su on su.tenant_id = t.id and su.resumed_at is null
            where t.id = pg_temp.t('trial')),
  'SUSPENDED:TRIAL_EXPIRED', '… SUSPENDED con la marca TRIAL_EXPIRED');
select is((platform.set_tenant_trial_end(pg_temp.t('trial'), now() + interval '40 days', 'Segunda oportunidad') ->> 'resumed')::boolean,
  true, 'Extender una prueba suspendida por vencer la reactiva');
select is((select status::text from platform.tenants where id = pg_temp.t('trial')), 'ACTIVE', '… y queda ACTIVE');

select * from finish();
rollback;
