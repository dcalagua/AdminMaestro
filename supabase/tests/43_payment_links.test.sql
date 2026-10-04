-- ============================================================================
-- M1 · Portal de pago por enlace (migración 20261010000100)
-- ----------------------------------------------------------------------------
-- Spec §2.1–§2.2: el token en claro no se guarda ni se expone; el enlace lo
-- crean y revocan finanzas o el super admin (con auditoría); el estado de
-- cuenta y los eventos son SOLO SERVIDOR; inválido = inexistente; vencimiento,
-- revocación idempotente y límite de intentos (10/enlace/hora, 5/factura/hora).
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

create or replace function pg_temp.finance() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000003'::uuid $$;
create or replace function pg_temp.padmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.tadmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000009'::uuid $$;
create or replace function pg_temp.alpha() returns uuid language sql as $$ select '30000000-0000-4000-a000-000000000004'::uuid $$;
create or replace function pg_temp.omega() returns uuid language sql as $$ select '30000000-0000-4000-a000-000000000005'::uuid $$;
create or replace function pg_temp.h(p_token text) returns text language sql as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;

-- Tokens emitidos durante la prueba (la tabla temporal la leen todos los roles).
create temp table qa_links (name text primary key, result jsonb);
grant all on qa_links to public;
create or replace function pg_temp.tok(p_name text) returns text language sql as $$
  select result ->> 'token' from qa_links where name = p_name
$$;
create or replace function pg_temp.lid(p_name text) returns uuid language sql as $$
  select (result ->> 'id')::uuid from qa_links where name = p_name
$$;

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
    where oid in ('platform.payment_links'::regclass, 'platform.payment_link_events'::regclass)),
  '01 payment_links y payment_link_events: RLS habilitada y forzada');

select ok(not has_column_privilege('authenticated', 'platform.payment_links', 'token_hash', 'SELECT'),
  '02 authenticated NO puede leer token_hash (GRANT por columna)');

select ok(
  not has_table_privilege('authenticated', 'platform.payment_links', 'INSERT')
  and not has_table_privilege('authenticated', 'platform.payment_links', 'UPDATE')
  and not has_table_privilege('authenticated', 'platform.payment_link_events', 'INSERT'),
  '03 authenticated no escribe directamente enlaces ni eventos');

select ok(
  not has_function_privilege('anon', 'platform.create_payment_link(uuid, integer, boolean, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'platform.revoke_payment_link(uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'platform.payment_link_statement(text, text)', 'EXECUTE'),
  '04 anon no ejecuta ninguna RPC del portal');

select ok(
  not has_function_privilege('authenticated', 'platform.payment_link_statement(text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'platform.payment_link_charge_context(text, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated',
        'platform.register_payment_link_event(uuid, text, uuid, text, text, numeric, character, text)', 'EXECUTE'),
  '05 estado de cuenta, contexto de cobro y eventos: SOLO SERVIDOR (sin EXECUTE para authenticated)');

select ok(
  has_function_privilege('service_role', 'platform.payment_link_statement(text, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'platform.payment_link_charge_context(text, uuid)', 'EXECUTE')
  and has_function_privilege('service_role',
        'platform.register_payment_link_event(uuid, text, uuid, text, text, numeric, character, text)', 'EXECUTE'),
  '06 service_role sí ejecuta las RPC de servidor');

-- ---------------------------------------------------------------------------
-- Alta: solo finanzas / super admin
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.tadmin());
select throws_ok(
  $$ select platform.create_payment_link('30000000-0000-4000-a000-000000000004', 30, true, null) $$,
  '42501', null, '07 un ORG_ADMIN (no finanzas) no genera enlaces de pago');

select pg_temp.act_as(pg_temp.padmin());
select throws_ok(
  $$ select platform.create_payment_link('30000000-0000-4000-a000-000000000004', 30, true, null) $$,
  '42501', null, '08 EBIM_PRODUCT_ADMIN tampoco');

select pg_temp.act_as(pg_temp.finance());
select lives_ok(
  $$ insert into qa_links select 'a', platform.create_payment_link('30000000-0000-4000-a000-000000000004', null, true, 'QA portal') $$,
  '09 EBIM_FINANCE genera el enlace');

select ok(pg_temp.tok('a') ~ '^[A-Za-z0-9_-]{43}$',
  '10 el token es base64url de 32 bytes (43 caracteres, sin relleno)');

select pg_temp.act_as_postgres();
select is((select token_hash from platform.payment_links where id = pg_temp.lid('a')), pg_temp.h(pg_temp.tok('a')),
  '11 la base guarda el sha256 hex del token');
select ok(not exists (
    select 1 from platform.payment_links l
     where l.token_hash = pg_temp.tok('a') or to_jsonb(l)::text like '%' || pg_temp.tok('a') || '%'),
  '12 el token en claro no está en ninguna columna del enlace');
select is((select token_hint from platform.payment_links where id = pg_temp.lid('a')), right(pg_temp.tok('a'), 4),
  '13 la pista son los últimos 4 caracteres');
select ok(
  (select expires_at between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour'
     from platform.payment_links where id = pg_temp.lid('a')),
  '14 vigencia por defecto: 30 días');
select is(
  (select count(*)::int from platform.audit_logs
    where action = 'PAYMENT_LINK_CREATED' and entity_id = pg_temp.lid('a')::text
      and metadata::text not like '%' || pg_temp.tok('a') || '%'
      and metadata::text not like '%' || pg_temp.h(pg_temp.tok('a')) || '%'),
  1, '15 auditoría del alta SIN token ni hash');

select pg_temp.act_as(pg_temp.finance());
select throws_ok(
  $$ select platform.create_payment_link('30000000-0000-4000-a000-000000000004', 91, true, null) $$,
  '23514', null, '16 más de 90 días de vigencia se rechaza');
select throws_ok(
  $$ select platform.create_payment_link('30000000-0000-4000-a000-000000000004', 0, true, null) $$,
  '23514', null, '17 vigencia 0 se rechaza');

insert into qa_links select 'b', platform.create_payment_link(pg_temp.alpha(), 7, false, null);
insert into qa_links select 'c', platform.create_payment_link(pg_temp.alpha(), 7, true, null);
insert into qa_links select 'expired', platform.create_payment_link(pg_temp.alpha(), 1, true, null);
insert into qa_links select 'omega', platform.create_payment_link(pg_temp.omega(), 5, true, null);

select is((select status from platform.v_payment_links where id = pg_temp.lid('a')), 'ACTIVE',
  '18 finanzas ve el enlace como ACTIVE en v_payment_links');

select pg_temp.act_as(pg_temp.tadmin());
select is((select count(*)::int from platform.v_payment_links), 0,
  '19 un ORG_ADMIN no ve enlaces de pago (RLS)');

-- ---------------------------------------------------------------------------
-- Estado de cuenta (servidor)
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select is(platform.payment_link_statement(pg_temp.h(pg_temp.tok('a')), 'abcdef0123456789') ->> 'valid', 'true',
  '20 el servidor obtiene el estado de cuenta con el hash del token');
select ok(
  jsonb_array_length(platform.payment_link_statement(pg_temp.h(pg_temp.tok('a'))) -> 'invoices') >= 1,
  '21 lista facturas emitidas con saldo de la organización');
select ok(
  (select bool_and((i ->> 'balance')::numeric > 0 and i ->> 'status' in ('ISSUED', 'PARTIALLY_PAID'))
     from jsonb_array_elements(platform.payment_link_statement(pg_temp.h(pg_temp.tok('a'))) -> 'invoices') i),
  '22 solo ISSUED/PARTIALLY_PAID con saldo > 0');
select is(platform.payment_link_statement(pg_temp.h(pg_temp.tok('a'))) #>> '{organization,billing_email_masked}',
  'p***s@alpha.ebim.test', '23 el correo de facturación va enmascarado');
select ok(platform.payment_link_statement(pg_temp.h(pg_temp.tok('a')))::text
            not like '%' || pg_temp.h(pg_temp.tok('a')) || '%',
  '24 el estado de cuenta no devuelve el hash del token');

select pg_temp.act_as_postgres();
select is((select access_count from platform.payment_links where id = pg_temp.lid('a')), 5,
  '25 cada lectura cuenta como acceso (5 lecturas)');
select is((select count(*)::int from platform.payment_link_events where link_id = pg_temp.lid('a') and kind = 'VIEW'), 5,
  '26 cada lectura registra un evento VIEW');

select pg_temp.act_as_service();
select is(platform.payment_link_statement(repeat('a', 64)),
          platform.payment_link_statement('esto-no-es-un-hash'),
  '27 token inexistente y token mal formado responden EXACTAMENTE igual');
select is(platform.payment_link_statement(repeat('a', 64)) ->> 'error', 'ENLACE_INVALIDO',
  '28 ... con ENLACE_INVALIDO');

-- Vencido: se mueve al pasado como mantenimiento local.
select pg_temp.act_as_postgres();
update platform.payment_links
   set created_at = now() - interval '3 days', expires_at = now() - interval '1 minute'
 where id = pg_temp.lid('expired');
select pg_temp.act_as_service();
select is(platform.payment_link_statement(pg_temp.h(pg_temp.tok('expired'))) ->> 'error', 'ENLACE_VENCIDO',
  '29 un enlace vencido responde ENLACE_VENCIDO');
select pg_temp.act_as(pg_temp.finance());
select is((select status from platform.v_payment_links where id = pg_temp.lid('expired')), 'EXPIRED',
  '30 y la consola lo muestra EXPIRED');

-- ---------------------------------------------------------------------------
-- Revocación
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.tadmin());
select throws_ok($$ select platform.revoke_payment_link(pg_temp.lid('b'), 'x') $$, '42501', null,
  '31 un ORG_ADMIN no revoca enlaces');
select pg_temp.act_as(pg_temp.finance());
select throws_ok($$ select platform.revoke_payment_link(pg_temp.lid('b'), '  ') $$, '23502', null,
  '32 revocar exige motivo');
select is(platform.revoke_payment_link(pg_temp.lid('b'), 'Cliente pidió anularlo') ->> 'already_revoked', 'false',
  '33 finanzas revoca el enlace');
select is(platform.revoke_payment_link(pg_temp.lid('b'), 'otra vez') ->> 'already_revoked', 'true',
  '34 revocar dos veces es idempotente');
select is((select status from platform.v_payment_links where id = pg_temp.lid('b')), 'REVOKED',
  '35 la consola lo muestra REVOKED');
select pg_temp.act_as_service();
select is(platform.payment_link_statement(pg_temp.h(pg_temp.tok('b'))) ->> 'error', 'ENLACE_REVOCADO',
  '36 un enlace revocado responde ENLACE_REVOCADO');
select pg_temp.act_as_postgres();
select is((select count(*)::int from platform.audit_logs
            where action = 'PAYMENT_LINK_REVOKED' and entity_id = pg_temp.lid('b')::text), 1,
  '37 una sola auditoría de revocación (la segunda no cambia nada)');

-- ---------------------------------------------------------------------------
-- Contexto de cobro
-- ---------------------------------------------------------------------------
create temp table qa_inv as
select
  (select i.id from platform.invoices i
     where i.customer_organization_id = '30000000-0000-4000-a000-000000000004'
       and i.status in ('ISSUED', 'PARTIALLY_PAID') order by i.number limit 1) as alpha_open,
  (select i.id from platform.invoices i
     where i.customer_organization_id = '30000000-0000-4000-a000-000000000005'
       and i.status in ('ISSUED', 'PARTIALLY_PAID') order by i.number limit 1) as omega_open,
  (select i.id from platform.invoices i where i.number = 'INV-VOID-0001') as alpha_void;
grant all on qa_inv to public;

select pg_temp.act_as_service();
select is(platform.payment_link_charge_context(pg_temp.h(pg_temp.tok('a')), (select alpha_open from qa_inv)) ->> 'ok', 'true',
  '38 factura propia con saldo → contexto de cobro válido');
select is(platform.payment_link_charge_context(pg_temp.h(pg_temp.tok('a')), (select omega_open from qa_inv)) ->> 'error',
  'FACTURA_NO_PAGABLE', '39 la factura de OTRA organización no es pagable con este enlace');
select is(platform.payment_link_charge_context(pg_temp.h(pg_temp.tok('a')), (select alpha_void from qa_inv)) ->> 'error',
  'FACTURA_NO_PAGABLE', '40 una factura VOID no es pagable');
select is(platform.payment_link_charge_context(pg_temp.h(pg_temp.tok('b')), (select alpha_open from qa_inv)) ->> 'error',
  'ENLACE_REVOCADO', '41 el contexto de cobro revalida el enlace');

-- ---------------------------------------------------------------------------
-- Límite de intentos
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select is(
  (select count(*)::int from generate_series(1, 10) g
    where (platform.register_payment_link_event(pg_temp.lid('c'), 'CHARGE_ATTEMPT') ->> 'rate_limited')::boolean = false),
  10, '42 diez intentos por enlace en una hora se aceptan');
select is(platform.register_payment_link_event(pg_temp.lid('c'), 'CHARGE_ATTEMPT') ->> 'rate_limited', 'true',
  '43 el undécimo se rechaza: RATE_LIMITED');

select is(
  (select count(*)::int from generate_series(1, 5) g
    where (platform.register_payment_link_event(pg_temp.lid('a'), 'CHARGE_ATTEMPT',
             (select alpha_open from qa_inv)) ->> 'rate_limited')::boolean = false),
  5, '44 cinco intentos sobre la misma factura se aceptan');
select is(platform.register_payment_link_event(pg_temp.lid('a'), 'CHARGE_ATTEMPT', (select alpha_open from qa_inv))
            ->> 'rate_limited', 'true',
  '45 el sexto sobre la misma factura se rechaza aunque el enlace tenga cupo');

select throws_ok(
  $$ select platform.register_payment_link_event(pg_temp.lid('a'), 'VIEW', null, null, null, null, null, '10.0.0.1') $$,
  '23514', null, '46 la huella del cliente es un hash: una IP en claro se rechaza');

select * from finish();
rollback;
