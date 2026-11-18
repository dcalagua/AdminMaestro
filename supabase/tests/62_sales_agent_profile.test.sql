-- ============================================================================
-- Perfil comercial (20261026000100_sales_agent_profile)
--   · todo comercial activo lee las solicitudes de la web; quien la mueve la toma
--     y otro comercial ya no puede moverla ni pedir su prueba;
--   · el comercial pide la prueba; EBIM la rechaza con motivo o la aprueba con
--     el tenant creado, y eso deja la atribución y convierte la solicitud;
--   · el comercial no aprueba, no rechaza ni ve las pruebas de otro;
--   · my_sales_reminders: solo lo atribuido al comercial de la sesión.
-- ============================================================================
begin;
select plan(38);

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

create or replace function pg_temp.echange() returns uuid language sql as $$ select '20000000-0000-4000-a000-000000000005'::uuid $$;
create or replace function pg_temp.padmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.finance() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000003'::uuid $$;
-- Carla: comercial independiente. Beto: comercial de un partner (PARTNER_SALES).
create or replace function pg_temp.carla() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000008'::uuid $$;
create or replace function pg_temp.carla_agent() returns uuid language sql as $$ select '80000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.beto() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000005'::uuid $$;
create or replace function pg_temp.alpha_admin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000009'::uuid $$;
create or replace function pg_temp.alpha_org() returns uuid language sql as $$ select '30000000-0000-4000-a000-000000000004'::uuid $$;

create temp table qa (k text primary key, v text);
grant all on qa to authenticated, service_role;
create or replace function pg_temp.t(p_key text) returns uuid language sql as $$ select v::uuid from qa where k = p_key $$;

-- Una solicitud de la web de eChange, como la deja lead-sync.
insert into qa select 'target', id::text from platform.deployment_targets order by created_at limit 1;
insert into platform.commercial_leads (saas_product_id, deployment_target_id, external_id, received_at,
                                       contact_name, company_name, email, country_code)
values (pg_temp.echange(), pg_temp.t('target'), 'qa62-lead-1', now() - interval '2 hours',
        'Lucía Prospecto', 'Andina Servicios QA62', 'lucia@andina-qa62.test', 'PE');
insert into qa select 'lead', id::text from platform.commercial_leads where external_id = 'qa62-lead-1';

-- ---------------------------------------------------------------------------
-- Forma y privilegios
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(f || ':' || has_function_privilege('anon', f, 'execute') || '/'
                     || has_function_privilege('authenticated', f, 'execute'), ',' order by f)
     from unnest(array[
       'platform.cancel_trial_request(uuid)',
       'platform.complete_trial_request(uuid, uuid)',
       'platform.my_sales_reminders()',
       'platform.reject_trial_request(uuid, text)',
       'platform.request_trial(uuid, text, text, text, uuid, text, text, uuid)']) f),
  'platform.cancel_trial_request(uuid):false/true,'
  || 'platform.complete_trial_request(uuid, uuid):false/true,'
  || 'platform.my_sales_reminders():false/true,'
  || 'platform.reject_trial_request(uuid, text):false/true,'
  || 'platform.request_trial(uuid, text, text, text, uuid, text, text, uuid):false/true',
  'Las RPC del perfil comercial: anon no, authenticated sí (la guardia está dentro)');
select is((select relrowsecurity from pg_class where oid = 'platform.trial_requests'::regclass), true,
  'trial_requests: RLS habilitada');
select is(has_table_privilege('authenticated', 'platform.trial_requests', 'insert'), false,
  'authenticated no inserta pruebas por PATCH: solo por request_trial');

-- ---------------------------------------------------------------------------
-- Solicitudes de la web: las ve todo comercial, la mueve quien la toma
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.carla());
select is((select count(*)::int from platform.commercial_leads where id = pg_temp.t('lead')), 1,
  'Carla (comercial) ve la solicitud');
select pg_temp.act_as(pg_temp.beto());
select is((select count(*)::int from platform.commercial_leads where id = pg_temp.t('lead')), 1,
  'Beto (otro comercial) también la ve: todos ven todas');
select pg_temp.act_as(pg_temp.alpha_admin());
select is((select count(*)::int from platform.commercial_leads where id = pg_temp.t('lead')), 0,
  'El admin de un cliente no ve solicitudes');

select pg_temp.act_as(pg_temp.carla());
select lives_ok($$ select platform.set_commercial_lead_status(pg_temp.t('lead'), 'CONTACTED') $$,
  'Carla la marca como contactada');
select is((select owner_sales_agent_id from platform.commercial_leads where id = pg_temp.t('lead')),
  pg_temp.carla_agent(), '… y queda tomada por Carla');

select pg_temp.act_as(pg_temp.beto());
select throws_ok($$ select platform.set_commercial_lead_status(pg_temp.t('lead'), 'DISCARDED', 'no aplica') $$,
  '42501', null, 'Beto no mueve una solicitud que tomó Carla');
select throws_ok(
  $$ select platform.request_trial(pg_temp.echange(), 'Andina Servicios QA62', 'Lucía', 'lucia@andina-qa62.test',
                                   p_lead_id => pg_temp.t('lead')) $$,
  '42501', null, 'Beto no pide la prueba de una solicitud de Carla');

select pg_temp.act_as(pg_temp.alpha_admin());
select throws_ok($$ select platform.set_commercial_lead_status(pg_temp.t('lead'), 'CONTACTED') $$,
  '42501', null, 'Quien no es comercial ni EBIM no mueve solicitudes');
select throws_ok(
  $$ select platform.request_trial(pg_temp.echange(), 'X SA', 'X', 'x@x.test') $$,
  '42501', null, 'Quien no es comercial no pide pruebas');

-- ---------------------------------------------------------------------------
-- Carla pide la prueba
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.carla());
insert into qa select 'req', platform.request_trial(
  pg_temp.echange(), 'Andina Servicios QA62', 'Lucía Prospecto', 'Lucia@Andina-QA62.test',
  p_country_code => 'pe', p_notes => 'Quiere probar la mesa de ayuda', p_lead_id => pg_temp.t('lead'))::text;
select is((select status from platform.trial_requests where id = pg_temp.t('req')), 'PENDING',
  'La prueba queda pendiente');
select is((select admin_email || '|' || country_code from platform.trial_requests where id = pg_temp.t('req')),
  'lucia@andina-qa62.test|PE', '… con el correo en minúsculas y el país normalizado');
select throws_ok(
  $$ select platform.request_trial(pg_temp.echange(), 'Andina Servicios QA62', 'Lucía', 'lucia@andina-qa62.test') $$,
  '23505', null, 'No se pide dos veces la misma prueba pendiente');
select throws_ok(
  $$ select platform.request_trial(pg_temp.echange(), 'Andina Servicios QA62', 'Lucía', 'lucia@otra-qa62.test',
                                   p_plan_id => (select id from platform.plans where saas_product_id <> pg_temp.echange() limit 1)) $$,
  '22023', null, 'El plan tiene que ser de la app pedida');
select is((select count(*)::int from platform.trial_requests where id = pg_temp.t('req')), 1,
  'Carla ve su pedido');
select pg_temp.act_as_postgres();
select is((select count(*)::int from platform.audit_logs
            where action = 'TRIAL_REQUESTED' and entity_id = pg_temp.t('req')::text), 1,
  'El pedido queda auditado');
select is((select status || '|' || owner_sales_agent_id::text from platform.commercial_leads where id = pg_temp.t('lead')),
  'CONTACTED|' || pg_temp.carla_agent()::text, 'La solicitud sigue contactada y tomada por Carla');

select pg_temp.act_as(pg_temp.beto());
select is((select count(*)::int from platform.trial_requests where id = pg_temp.t('req')), 0,
  'Beto no ve el pedido de Carla');
select throws_ok($$ select platform.cancel_trial_request(pg_temp.t('req')) $$,
  '42501', null, 'Beto no retira el pedido de Carla');

select pg_temp.act_as(pg_temp.carla());
select throws_ok($$ select platform.complete_trial_request(pg_temp.t('req'), pg_temp.t('req')) $$,
  '42501', null, 'El comercial no aprueba su propia prueba');
select throws_ok($$ select platform.reject_trial_request(pg_temp.t('req'), 'no') $$,
  '42501', null, 'El comercial no rechaza pruebas');

-- ---------------------------------------------------------------------------
-- EBIM aprueba: crea el tenant (Nueva venta) y cierra el pedido
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.finance());
select is((select count(*)::int from platform.trial_requests where id = pg_temp.t('req')), 1,
  'Finanzas (área comercial de EBIM) ve el pedido');
select throws_ok($$ select platform.reject_trial_request(pg_temp.t('req'), '  ') $$,
  '22023', null, 'Rechazar exige motivo');

select pg_temp.act_as(pg_temp.padmin());
insert into qa select 'tenant', platform.create_tenant(
  'echange', pg_temp.alpha_org(), 'qa62-andina-prueba', 'QA 62 Andina prueba',
  'lucia@andina-qa62.test', 'TRIAL', 'SHARED')::text;
select lives_ok($$ select platform.complete_trial_request(pg_temp.t('req'), pg_temp.t('tenant')) $$,
  'EBIM cierra el pedido con el tenant creado');
select is((select status || '|' || (organization_id = pg_temp.alpha_org())::text
             from platform.trial_requests where id = pg_temp.t('req')),
  'APPROVED|true', '… queda aprobado y enlazado al cliente');
select is((select count(*)::int from platform.sales_attributions
            where sales_agent_id = pg_temp.carla_agent() and tenant_id = pg_temp.t('tenant') and status = 'ACTIVE'),
  1, '… y Carla queda atribuida al tenant');
select is((select status || '|' || (organization_id = pg_temp.alpha_org())::text
             from platform.commercial_leads where id = pg_temp.t('lead')),
  'CONVERTED|true', '… y la solicitud de la web queda convertida');
select throws_ok($$ select platform.complete_trial_request(pg_temp.t('req'), pg_temp.t('tenant')) $$,
  '22023', null, 'Un pedido resuelto no se vuelve a cerrar');

-- ---------------------------------------------------------------------------
-- Recordatorios
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.carla());
select ok(platform.my_sales_reminders() @> jsonb_build_array(jsonb_build_object(
  'type', 'TRIAL_APPROVED', 'ref_id', pg_temp.t('req'), 'tenant_id', pg_temp.t('tenant'))),
  'Carla recibe el aviso de que su prueba fue aprobada');
select ok(not platform.my_sales_reminders() @> jsonb_build_array(jsonb_build_object('ref_id', pg_temp.t('tenant'), 'type', 'TRIAL_ENDING')),
  'Una prueba de 7 días todavía no avisa que vence');

select pg_temp.act_as_postgres();
update platform.tenants set trial_ends_at = now() + interval '1 day' where id = pg_temp.t('tenant');
select pg_temp.act_as(pg_temp.carla());
select ok(platform.my_sales_reminders() @> jsonb_build_array(jsonb_build_object('ref_id', pg_temp.t('tenant'), 'type', 'TRIAL_ENDING')),
  'Si vence mañana, Carla recibe el aviso');
select is(
  (select count(*)::int from jsonb_array_elements(platform.my_sales_reminders()) r
    where r->>'type' like 'INVOICE_%'
      and (r->>'organization_id')::uuid not in (
            select customer_organization_id from platform.sales_attributions
             where sales_agent_id = pg_temp.carla_agent() and status = 'ACTIVE')),
  0, 'Los avisos de factura de Carla son solo de sus clientes');

select pg_temp.act_as(pg_temp.beto());
select ok(not platform.my_sales_reminders() @> jsonb_build_array(jsonb_build_object('ref_id', pg_temp.t('tenant'))),
  'Beto no recibe los avisos de Carla');
select pg_temp.act_as(pg_temp.finance());
select is(platform.my_sales_reminders(), '[]'::jsonb, 'Quien no es comercial no tiene recordatorios de comercial');

-- ---------------------------------------------------------------------------
-- Retirar un pedido
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.carla());
insert into qa select 'req2', platform.request_trial(pg_temp.echange(), 'Otra QA62', 'Pepe', 'pepe@otra-qa62.test')::text;
select lives_ok($$ select platform.cancel_trial_request(pg_temp.t('req2')) $$, 'Carla retira su pedido');
select throws_ok($$ select platform.cancel_trial_request(pg_temp.t('req2')) $$,
  '22023', null, 'Un pedido retirado no se retira dos veces');

select * from finish();
rollback;
