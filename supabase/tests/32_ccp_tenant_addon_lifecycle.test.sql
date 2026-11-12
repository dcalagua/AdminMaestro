-- ============================================================================
-- EBIM Commercial Control Plane · Fase 07 · subscription_items por origen y
-- ciclo de vida de add-ons de tenant (Tasks MA-15, MA-16)
-- ----------------------------------------------------------------------------
-- Spec §3.2 (subscription_items: source_type, tenant_addon_id, price_ref),
-- §5.4-5.5 (precio congelado, TARIFA_ADDON_NO_DEFINIDA), §6.2 (ciclo de vida),
-- §10 (downgrade/revocación), §14.1 (autoridad). Todo se revierte (rollback).
-- ============================================================================
begin;
select plan(70);

create or replace function pg_temp.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_anon()
returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end;
$$;

create or replace function pg_temp.act_as_postgres()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Huella de las líneas debidas (= líneas que emitiría issue_subscription_invoice)
-- de todas las suscripciones vivas del seed en este mes y los dos siguientes.
-- Anclas en meses de calendario relativos: estable día a día.
create or replace function pg_temp.fp_due() returns text language sql as $$
  select md5(coalesce(string_agg(r, E'\n' order by r), ''))
    from (
      select concat_ws('|', s.code, p.idx, d.charge_kind, d.description, d.tenant_id,
                       d.quantity, d.unit_amount, d.amount, d.currency, d.billing_interval,
                       (extract(year from d.billing_anchor) * 12 + extract(month from d.billing_anchor))
                         - (extract(year from current_date) * 12 + extract(month from current_date)),
                       (extract(year from d.valid_to) * 12 + extract(month from d.valid_to))
                         - (extract(year from current_date) * 12 + extract(month from current_date))) as r
        from platform.subscriptions s
        cross join (values (0, date_trunc('month', current_date)::date),
                           (1, (date_trunc('month', current_date) + interval '1 month')::date),
                           (2, (date_trunc('month', current_date) + interval '2 months')::date)) p(idx, period)
        cross join lateral platform.subscription_due_items(s.id, p.period) d
       where s.status in ('ACTIVE', 'PAST_DUE')
    ) x
$$;

-- ---------------------------------------------------------------------------
-- MA-15 · subscription_items.source_type / tenant_addon_id / price_ref
-- ---------------------------------------------------------------------------
select has_column('platform', 'subscription_items', 'source_type', 'subscription_items.source_type');
select has_column('platform', 'subscription_items', 'price_ref', 'subscription_items.price_ref');
select is(
  (select string_agg(source_type || '=' || n, ',' order by source_type)
     from (select source_type, count(*) n from platform.subscription_items group by 1) x),
  'MANUAL=' || (select count(*) from platform.subscription_items),
  'Todos los ítems existentes quedan en MANUAL');
select is(pg_temp.fp_due(), '1966da3a5d134bcdb433410842bea9b0',
  'Las líneas que emitiría issue_subscription_invoice son idénticas a las de antes de la migración (78 líneas, 3 periodos)');

select pg_temp.act_as_postgres();
select throws_ok($$ update platform.subscription_items set source_type = 'GIFT'
                     where subscription_id = '70000000-0000-4000-a000-000000000001' $$,
  '23514', null, 'source_type desconocido se rechaza');
select throws_ok($$ update platform.subscription_items set source_type = 'ADDON', price_ref = gen_random_uuid()
                     where subscription_id = '70000000-0000-4000-a000-000000000001' and charge_kind = 'ADDON' $$,
  '23503', null, 'Un price_ref que no es una tarifa de add-on se rechaza');
select lives_ok($$ update platform.subscription_items si set source_type = 'PLAN',
                        price_ref = (select pp.id from platform.plan_prices pp
                                      where pp.plan_id = '60000000-0000-4000-a000-000000000001'
                                        and pp.charge_kind = 'LICENSE' and pp.valid_to is null limit 1)
                     where si.subscription_id = '70000000-0000-4000-a000-000000000001' and si.charge_kind = 'LICENSE' $$,
  'Un ítem PLAN puede referenciar la tarifa de plan que lo fijó');

-- ===========================================================================
-- MA-16 · ciclo de vida de tenant_addons
-- ===========================================================================
create or replace function pg_temp.alpha() returns uuid language sql as $$ select '50000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.req(p_tenant uuid, p_code text) returns uuid language sql as $$
  select id from platform.tenant_addons
   where tenant_id = p_tenant and addon_code = p_code
   order by requested_at desc, created_at desc limit 1
$$;
create or replace function pg_temp.due_addon(p_offset int) returns text language sql as $$
  select coalesce(string_agg(d.description || '=' || d.amount, ',' order by d.description), '')
    from platform.subscription_due_items('70000000-0000-4000-a000-000000000001',
           (date_trunc('month', current_date) + make_interval(months => p_offset))::date) d
   where d.charge_kind = 'ADDON' and d.description like 'Add-on %'
$$;

select pg_temp.act_as_postgres();
select is(
  (select string_agg(addon_code || ':' || status || ':' || request_source || ':' || active, ',' order by tenant_id, addon_code)
     from platform.tenant_addons),
  'licitaciones:ACTIVE:LEGACY_BACKFILL:true,licitaciones:ACTIVE:LEGACY_BACKFILL:true,multi_country:ACTIVE:LEGACY_BACKFILL:true,'
  || 'sla_premium:ACTIVE:LEGACY_BACKFILL:true,white_label:ACTIVE:LEGACY_BACKFILL:true,sla_premium:ACTIVE:LEGACY_BACKFILL:true',
  'Filas existentes → ACTIVE (LEGACY_BACKFILL), active derivado');
select hasnt_function('platform', 'set_tenant_addon_active', array['uuid', 'text', 'boolean', 'text'],
  'La RPC temporal de la fase 03 se retiró: el ciclo de vida la reemplaza');
select is(
  (select string_agg(p.proname || ':' || p.prosecdef || ':'
            || has_function_privilege('public', p.oid, 'execute') || ':'
            || has_function_privilege('anon', p.oid, 'execute') || ':'
            || has_function_privilege('authenticated', p.oid, 'execute') || ':'
            || coalesce(array_to_string(p.proconfig, ';') like '%search_path%', false),
            ',' order by p.proname)
     from pg_proc p
    where p.pronamespace = 'platform'::regnamespace
      and p.proname in ('request_tenant_addon', 'approve_tenant_addon', 'reject_tenant_addon',
                        'schedule_cancel_tenant_addon', 'reactivate_tenant_addon', 'suspend_tenant_addon',
                        'resume_tenant_addon', 'cancel_tenant_addon', 'complete_scheduled_addon_cancellations',
                        'transition_tenant_addon')),
  'approve_tenant_addon:true:false:false:true:true,cancel_tenant_addon:true:false:false:true:true,'
  || 'complete_scheduled_addon_cancellations:true:false:false:true:true,reactivate_tenant_addon:true:false:false:true:true,'
  || 'reject_tenant_addon:true:false:false:true:true,request_tenant_addon:true:false:false:true:true,'
  || 'resume_tenant_addon:true:false:false:true:true,schedule_cancel_tenant_addon:true:false:false:true:true,'
  || 'suspend_tenant_addon:true:false:false:true:true,transition_tenant_addon:true:false:false:false:true',
  'Lifecycle: DEFINER + search_path, sin PUBLIC/anon; la transición común es interna');

-- Tarifa QA de `consolidation` solo en PE/USD (importe de prueba, se revierte).
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select lives_ok($$ select platform.set_catalog_item_price('consolidation', 'PE', 'ADDON', 'MONTHLY', 10.00, 'USD', current_date) $$,
  'Tarifa QA PE/USD de consolidation');

-- ---------------------------------------------------------------------------
-- request: nunca activa; quién puede pedir
-- ---------------------------------------------------------------------------
select pg_temp.act_as_anon();
select throws_ok($$ select platform.request_tenant_addon(pg_temp.alpha(), 'consolidation') $$,
  '42501', null, 'anon no solicita');
select pg_temp.act_as('10000000-0000-4000-a000-0000000000ff');
select throws_ok($$ select platform.request_tenant_addon(pg_temp.alpha(), 'consolidation') $$,
  '42501', null, 'authenticated sin rol no solicita');
select pg_temp.act_as('10000000-0000-4000-a000-00000000000a');
select throws_ok($$ select platform.request_tenant_addon(pg_temp.alpha(), 'consolidation') $$,
  '42501', null, 'El admin de otro tenant (omega) no solicita para alpha');

select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select lives_ok($$ select platform.request_tenant_addon(pg_temp.alpha(), 'consolidation', null, 'Lo necesitamos') $$,
  'TENANT_ADMIN solicita un add-on para su tenant');
select pg_temp.act_as_postgres();
select is(
  (select status || ':' || request_source || ':' || active || ':' || (requested_by = '10000000-0000-4000-a000-000000000009')
     from platform.tenant_addons where id = pg_temp.req(pg_temp.alpha(), 'consolidation')),
  'REQUESTED:TENANT:false:true', 'La solicitud queda REQUESTED e inactiva');

select pg_temp.act_as('10000000-0000-4000-a000-000000000008');
select throws_ok($$ select platform.request_tenant_addon(pg_temp.alpha(), 'consolidation') $$,
  '23505', null, 'No se duplica una solicitud abierta');
select lives_ok($$ select platform.request_tenant_addon(pg_temp.alpha(), 'white_label', null, 'Cross-sell') $$,
  'El comercial con atribución solicita (PARTNER) sin acceso operativo');
select throws_ok($$ select platform.request_tenant_addon(pg_temp.alpha(), 'echange_desk') $$,
  '23514', null, 'Un item COMING_SOON no se solicita');
select throws_ok($$ select platform.request_tenant_addon(pg_temp.alpha(), 'consolidation', '31000000-0000-4000-a000-000000000003') $$,
  '23514', null, 'Una compañía de otro cliente se rechaza');

select pg_temp.act_as_postgres();
insert into platform.catalog_items (code, name, saas_product_id, item_type, scope, lifecycle_status, billing_model, currency)
values ('qa_gmao_only', 'QA GMAO', '20000000-0000-4000-a000-000000000004', 'addon', 'org-wide', 'AVAILABLE', 'FLAT', 'USD'),
       ('qa_per_unit', 'QA por uso', null, 'addon', 'org-wide', 'AVAILABLE', 'PER_UNIT', 'USD');
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select throws_ok($$ select platform.request_tenant_addon(pg_temp.alpha(), 'qa_gmao_only') $$,
  '23514', null, 'Un add-on de otro producto no se solicita');

-- ---------------------------------------------------------------------------
-- approve: sin autoaprobación; precio congelado; falla cerrado
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select throws_ok($$ select platform.approve_tenant_addon(pg_temp.req(pg_temp.alpha(), 'consolidation'), 'yo mismo') $$,
  '42501', null, 'TENANT_ADMIN no aprueba su propia solicitud');
select pg_temp.act_as('10000000-0000-4000-a000-000000000004');
select throws_ok($$ select platform.approve_tenant_addon(pg_temp.req(pg_temp.alpha(), 'consolidation'), 'QA') $$,
  '42501', null, 'PARTNER_ADMIN no aprueba');
select pg_temp.act_as('10000000-0000-4000-a000-000000000008');
select throws_ok($$ select platform.approve_tenant_addon(pg_temp.req(pg_temp.alpha(), 'consolidation'), 'QA') $$,
  '42501', null, 'El comercial no aprueba');

select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select throws_ok($$ select platform.approve_tenant_addon(pg_temp.req(pg_temp.alpha(), 'white_label'), 'QA') $$,
  '23514', null, 'TARIFA_ADDON_NO_DEFINIDA: sin tarifa no se activa en un tenant facturable');
select is(pg_temp.due_addon(1), '', 'Antes de aprobar no hay línea de add-on');
select is(
  (select (platform.approve_tenant_addon(pg_temp.req(pg_temp.alpha(), 'consolidation'), 'Alta comercial QA')
           - 'tenant_addon_id' - 'subscription_item_id')),
  '{"status": "ACTIVE", "currency": "USD", "unit_amount": 10.00}'::jsonb,
  'EBIM_PRODUCT_ADMIN aprueba: ACTIVE con la tarifa vigente');

select pg_temp.act_as_postgres();
select is(
  (select a.status || ':' || a.active || ':' || (a.approved_by = '10000000-0000-4000-a000-000000000002') || ':'
          || (a.effective_from is not null) || '|' || si.source_type || ':' || si.charge_kind || ':' || si.unit_amount || ':'
          || si.currency || ':' || si.catalog_item_code || ':' || (si.tenant_addon_id = a.id) || ':' || (si.valid_from = current_date) || ':'
          || (si.price_ref = (select p.id from platform.catalog_item_prices p join platform.catalog_items ci on ci.id = p.catalog_item_id
                                where ci.code = 'consolidation' and p.valid_to is null))
     from platform.tenant_addons a join platform.subscription_items si on si.id = a.subscription_item_id
    where a.id = pg_temp.req(pg_temp.alpha(), 'consolidation')),
  'ACTIVE:true:true:true|ADDON:ADDON:10.00:USD:consolidation:true:true:true',
  'approve crea el subscription_item ADDON (precio congelado + price_ref) en la misma transacción');
select is(pg_temp.due_addon(1), 'Add-on Consolidado multi-tenant=10.00',
  'La factura del mes siguiente incluye el add-on');

select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select lives_ok($$ select platform.set_catalog_item_price('consolidation', 'PE', 'ADDON', 'MONTHLY', 12.00, 'USD', current_date + 1) $$,
  'Finanzas sube la tarifa desde mañana');
select is(pg_temp.due_addon(1), 'Add-on Consolidado multi-tenant=10.00',
  'Un cambio de tarifa posterior no altera el ítem ya contratado (D-09)');

select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select throws_ok($$ select platform.approve_tenant_addon(pg_temp.req(pg_temp.alpha(), 'consolidation'), 'otra vez') $$,
  '23514', null, 'Un add-on activo no se aprueba dos veces');
select lives_ok($$ select platform.reject_tenant_addon(pg_temp.req(pg_temp.alpha(), 'white_label'), 'Sin tarifa definida') $$,
  'Una solicitud sin tarifa se rechaza');
select throws_ok($$ select platform.reject_tenant_addon(pg_temp.req(pg_temp.alpha(), 'white_label'), 'otra vez') $$,
  '23514', null, 'REJECTED es terminal');

-- DEMO: sin facturación, se permite sin tarifa.
select lives_ok($$ select platform.request_tenant_addon('50000000-0000-4000-a000-000000000004', 'white_label', null, 'Demo QA') $$,
  'Solicitud para el tenant DEMO');
select is(
  (select (platform.approve_tenant_addon(pg_temp.req('50000000-0000-4000-a000-000000000004', 'white_label'), 'Demo QA')
           ->> 'subscription_item_id')),
  null, 'DEMO se activa sin tarifa y sin ítem facturable');

-- TRIAL sin contrato, mercado sin tarifa, modelo por uso: fallan cerrado.
select lives_ok($$ select platform.request_tenant_addon('50000000-0000-4000-a000-00000000000a', 'consolidation', null, 'QA') $$,
  'Solicitud para un tenant TRIAL sin contrato');
select throws_ok($$ select platform.approve_tenant_addon(pg_temp.req('50000000-0000-4000-a000-00000000000a', 'consolidation'), 'QA') $$,
  '23514', null, 'SUSCRIPCION_REQUERIDA para un tenant facturable sin contrato');
select lives_ok($$ select platform.request_tenant_addon('50000000-0000-4000-a000-0000000000c4', 'consolidation', null, 'QA') $$,
  'Solicitud para un tenant con contrato en EC');
select throws_ok($$ select platform.approve_tenant_addon(pg_temp.req('50000000-0000-4000-a000-0000000000c4', 'consolidation'), 'QA') $$,
  '23514', null, 'La tarifa de PE no sirve para un contrato de EC (precio por mercado)');
select lives_ok($$ select platform.request_tenant_addon(pg_temp.alpha(), 'qa_per_unit', null, 'QA') $$,
  'Solicitud de un add-on por uso');
select throws_ok($$ select platform.approve_tenant_addon(pg_temp.req(pg_temp.alpha(), 'qa_per_unit'), 'QA') $$,
  '23514', null, 'MODELO_POR_USO_PENDIENTE hasta la fase 18');

-- ---------------------------------------------------------------------------
-- downgrade programado, reactivación, suspensión
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select throws_ok($$ select platform.schedule_cancel_tenant_addon(pg_temp.req(pg_temp.alpha(), 'consolidation'), 'QA') $$,
  '42501', null, 'TENANT_ADMIN no programa bajas');
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select is(platform.schedule_cancel_tenant_addon(pg_temp.req(pg_temp.alpha(), 'consolidation'), 'Downgrade QA'),
  date_trunc('month', now()) + interval '1 month', 'Baja programada al fin del periodo facturado');
select pg_temp.act_as_postgres();
select is(
  (select a.status || ':' || a.active || ':' || (si.valid_to = (date_trunc('month', current_date) + interval '1 month - 1 day')::date)
     from platform.tenant_addons a join platform.subscription_items si on si.id = a.subscription_item_id
    where a.id = pg_temp.req(pg_temp.alpha(), 'consolidation')),
  'CANCEL_SCHEDULED:true:true', 'Sigue activo hasta effective_to; el ítem se cierra el último día del periodo');
select is(pg_temp.due_addon(0) || '|' || pg_temp.due_addon(1), 'Add-on Consolidado multi-tenant=10.00|',
  'Se factura este mes y ya no el siguiente');

select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select lives_ok($$ select platform.reactivate_tenant_addon(pg_temp.req(pg_temp.alpha(), 'consolidation'), 'Se queda QA') $$,
  'Reactivar una baja programada');
select is(pg_temp.due_addon(1), 'Add-on Consolidado multi-tenant=10.00', 'La reactivación reabre el ítem');
select throws_ok($$ select platform.reactivate_tenant_addon(pg_temp.req(pg_temp.alpha(), 'consolidation'), 'QA') $$,
  '23514', null, 'reactivate solo desde CANCEL_SCHEDULED');
select throws_ok($$ select platform.suspend_tenant_addon(pg_temp.req(pg_temp.alpha(), 'consolidation'), 'Impago QA') $$,
  '42501', null, 'EBIM_PRODUCT_ADMIN no suspende (finanzas)');

select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select lives_ok($$ select platform.suspend_tenant_addon(pg_temp.req(pg_temp.alpha(), 'consolidation'), 'Impago QA') $$,
  'EBIM_FINANCE suspende');
select pg_temp.act_as_postgres();
select is((select status || ':' || active from platform.tenant_addons where id = pg_temp.req(pg_temp.alpha(), 'consolidation')),
  'SUSPENDED:false', 'Suspendido = sin capacidad');
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select lives_ok($$ select platform.resume_tenant_addon(pg_temp.req(pg_temp.alpha(), 'consolidation'), 'Pagó QA') $$,
  'EBIM_FINANCE reanuda');

-- Guardas de tabla (incluso para postgres/service_role).
select pg_temp.act_as_postgres();
select throws_ok($$ update platform.tenant_addons set status = 'REQUESTED' where id = pg_temp.req(pg_temp.alpha(), 'consolidation') $$,
  '23514', null, 'TRANSICION_INVALIDA también en escritura directa');
select throws_ok($$ update platform.tenant_addons set addon_code = 'white_label' where id = pg_temp.req(pg_temp.alpha(), 'consolidation') $$,
  '23514', null, 'La identidad de la fila es inmutable');

-- Fin de periodo: el job cierra las bajas vencidas.
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select lives_ok($$ select platform.schedule_cancel_tenant_addon(pg_temp.req(pg_temp.alpha(), 'consolidation'), 'Downgrade QA 2') $$,
  'Nueva baja programada');
select pg_temp.act_as_postgres();
update platform.tenant_addons set effective_from = now() - interval '40 days', effective_to = now() - interval '1 day'
 where id = pg_temp.req(pg_temp.alpha(), 'consolidation');
select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select throws_ok($$ select platform.complete_scheduled_addon_cancellations() $$,
  '42501', null, 'TENANT_ADMIN no ejecuta el job');
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select throws_ok($$ select platform.complete_scheduled_addon_cancellations(now() + interval '1 day') $$,
  '23514', null, 'El job no cierra bajas en el futuro');
select is(platform.complete_scheduled_addon_cancellations(), 1, 'El job cierra la baja vencida');
select pg_temp.act_as_postgres();
select is((select status || ':' || active from platform.tenant_addons
            where tenant_id = pg_temp.alpha() and addon_code = 'consolidation'),
  'CANCELLED:false', 'CANCELLED = sin capacidad');

-- Volver a contratar crea una fila nueva: la historia no se sobrescribe.
select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select lives_ok($$ select platform.request_tenant_addon(pg_temp.alpha(), 'consolidation', null, 'Lo queremos otra vez') $$,
  'Nueva solicitud tras la baja');
select pg_temp.act_as_postgres();
select is(
  (select string_agg(status, ',' order by requested_at, created_at) from platform.tenant_addons
    where tenant_id = pg_temp.alpha() and addon_code = 'consolidation'),
  'CANCELLED,REQUESTED', 'Dos filas: la historia y la solicitud nueva');

-- Baja inmediata: solo finanzas.
select pg_temp.act_as('10000000-0000-4000-a000-000000000002');
select throws_ok($$ select platform.cancel_tenant_addon(pg_temp.req(pg_temp.alpha(), 'licitaciones'), 'QA') $$,
  '42501', null, 'EBIM_PRODUCT_ADMIN no da de baja inmediata');
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');
select lives_ok($$ select platform.cancel_tenant_addon(pg_temp.req(pg_temp.alpha(), 'licitaciones'), 'Baja por acuerdo QA') $$,
  'EBIM_FINANCE da de baja inmediata un add-on legacy');

-- Service role (SaaS vía M2M): solicita, no activa.
select pg_temp.act_as_postgres();
select set_config('role', 'service_role', true);
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
select set_config('ccp.saas_req',
  platform.request_tenant_addon('50000000-0000-4000-a000-000000000002', 'consolidation', null, 'Botón contratar')::text, true);
select is(
  (select a.status || ':' || a.request_source from platform.tenant_addons a
    where a.id = current_setting('ccp.saas_req')::uuid),
  'REQUESTED:SAAS_M2M', 'Una solicitud del SaaS entra como REQUESTED (nunca autoactiva)');

-- ---------------------------------------------------------------------------
-- Auditoría y estado deseado
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select is(
  (select string_agg(l.action, ',' order by l.id)
     from platform.audit_logs l
    where l.entity_type = 'tenant_addon'
      and l.entity_id = (select id::text from platform.tenant_addons
                          where tenant_id = pg_temp.alpha() and addon_code = 'consolidation' and status = 'CANCELLED')),
  'TENANT_ADDON_REQUESTED,TENANT_ADDON_APPROVED,TENANT_ADDON_CANCEL_SCHEDULED,TENANT_ADDON_REACTIVATED,'
  || 'TENANT_ADDON_SUSPENDED,TENANT_ADDON_RESUMED,TENANT_ADDON_CANCEL_SCHEDULED,TENANT_ADDON_CANCEL_COMPLETED',
  'Cada transición del ciclo de vida queda en audit_logs');
select ok(
  (select bool_and(l.actor_user_id is not null) from platform.audit_logs l
    where l.action in ('TENANT_ADDON_APPROVED', 'TENANT_ADDON_SUSPENDED', 'TENANT_ADDON_CANCELLED')),
  'Aprobaciones, suspensiones y bajas tienen actor');
select ok(
  (select desired_dirty and desired_revision >= 10 from platform.entitlement_desired_state
    where tenant_id = pg_temp.alpha() and saas_product_id = '20000000-0000-4000-a000-000000000001'),
  'Cada transición marca dirty el estado deseado del tenant');

-- Aislamiento de lectura: omega no ve los add-ons de alpha.
select pg_temp.act_as('10000000-0000-4000-a000-00000000000a');
select is((select count(*)::int from platform.tenant_addons where tenant_id = pg_temp.alpha()), 0,
  'El admin de omega no ve los add-ons de alpha');
select pg_temp.act_as('10000000-0000-4000-a000-000000000009');
select ok((select count(*) from platform.tenant_addons where tenant_id = pg_temp.alpha()) >= 5,
  'El admin de alpha ve su historia de add-ons');

select * from finish();
rollback;
