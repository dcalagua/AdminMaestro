-- ============================================================================
-- M2 · Tarjeta guardada y cobro automático (migración 20261010000300)
-- ----------------------------------------------------------------------------
-- Spec §3. Alta/baja desde el portal (servidor), CHECK del perfil
-- CARD_ON_FILE, facturas a cobrar, política de reintentos (al vencer, +3 d,
-- +7 d, agotado → alerta CARD_ON_FILE_EXHAUSTED), idempotencia de intentos,
-- revocación desde la consola (finanzas) y auditoría.
-- Las fechas son RELATIVAS al vencimiento de la factura (p_as_of explícito).
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

create or replace function pg_temp.finance() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000003'::uuid $$;
create or replace function pg_temp.tadmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000009'::uuid $$;
create or replace function pg_temp.alpha() returns uuid language sql as $$ select '30000000-0000-4000-a000-000000000004'::uuid $$;
create or replace function pg_temp.acc() returns uuid language sql as
  $$ select id from platform.payment_provider_accounts where code = 'culqi-pe-test' $$;
create or replace function pg_temp.h(p_token text) returns text language sql as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;

create temp table qa (k text primary key, v jsonb);
grant all on qa to public;
create or replace function pg_temp.v(p_k text) returns jsonb language sql as $$ select v from qa where k = p_k $$;

-- Factura abierta de Alpha · eSupplier y su vencimiento D.
create temp table qa_inv as
select i.id as inv, i.number, i.due_date as d, i.total
  from platform.invoices i
  join platform.subscriptions s on s.id = i.subscription_id
 where s.code = 'SUB-ALPHA-ESUP' and i.status in ('ISSUED', 'PARTIALLY_PAID')
 order by i.issue_date desc limit 1;
grant all on qa_inv to public;
create or replace function pg_temp.inv() returns uuid language sql as $$ select inv from qa_inv $$;
create or replace function pg_temp.at(p_days int) returns timestamptz language sql as $$
  select ((select d from qa_inv) + p_days)::timestamp at time zone 'UTC' + interval '12 hours'
$$;
create or replace function pg_temp.due(p_days int, p_ignore boolean default false) returns setof record language sql as $$
  select invoice_id, next_attempt_no from platform.card_on_file_due_invoices(50, pg_temp.inv(), pg_temp.at(p_days), p_ignore)
$$;
create or replace function pg_temp.due_count(p_days int, p_ignore boolean default false) returns int language sql as $$
  select count(*)::int from platform.card_on_file_due_invoices(50, pg_temp.inv(), pg_temp.at(p_days), p_ignore)
$$;
create or replace function pg_temp.due_no(p_days int, p_ignore boolean default false) returns int language sql as $$
  select next_attempt_no from platform.card_on_file_due_invoices(50, pg_temp.inv(), pg_temp.at(p_days), p_ignore)
$$;

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
    where oid in ('platform.card_on_file_authorizations'::regclass, 'platform.payment_charge_attempts'::regclass)),
  '01 autorizaciones e intentos: RLS habilitada y forzada');

select ok(
  not has_function_privilege('authenticated',
        'platform.enroll_card_on_file(uuid, uuid, text, text, text, text, integer, integer, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'platform.unenroll_card_on_file(text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated',
        'platform.card_on_file_due_invoices(integer, uuid, timestamp with time zone, boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated',
        'platform.begin_card_charge_attempt(uuid, text, uuid, boolean, timestamp with time zone)', 'EXECUTE')
  and not has_function_privilege('authenticated',
        'platform.complete_card_charge_attempt(uuid, boolean, text, text, numeric, character, timestamp with time zone)', 'EXECUTE')
  and not has_function_privilege('authenticated',
        'platform.set_billing_contact_from_portal(uuid, text, text, text, text, text, text)', 'EXECUTE'),
  '02 alta, baja, cola de cobro e intentos: SOLO SERVIDOR');

select ok(
  has_function_privilege('authenticated', 'platform.revoke_card_on_file_authorization(uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'platform.revoke_card_on_file_authorization(uuid, text)', 'EXECUTE'),
  '03 la revocación de consola es una RPC autenticada (la autorización está dentro)');

select pg_temp.act_as_postgres();
select throws_ok(
  $$ update platform.subscription_collection_profiles set recurring_mode = 'CARD_ON_FILE'
      where subscription_id = (select id from platform.subscriptions where code = 'SUB-ALPHA-ESUP')
        and effective_to is null $$,
  '23514', null, '04 CHECK: CARD_ON_FILE sin tarjeta no es representable');
select throws_ok(
  $$ update platform.subscription_collection_profiles set recurring_mode = 'MENSUAL' where effective_to is null $$,
  '23514', null, '05 CHECK: recurring_mode solo admite los dos modos');

-- ---------------------------------------------------------------------------
-- Alta desde el portal
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.finance());
insert into qa select 'link', platform.create_payment_link(pg_temp.alpha(), 30, true, 'QA M2');
insert into qa select 'link_no_card', platform.create_payment_link(pg_temp.alpha(), 30, false, 'QA M2 sin tarjeta');
create or replace function pg_temp.lid() returns uuid language sql as $$ select (pg_temp.v('link') ->> 'id')::uuid $$;
create or replace function pg_temp.lhash() returns text language sql as $$ select pg_temp.h(pg_temp.v('link') ->> 'token') $$;

select pg_temp.act_as_service();
select is(platform.payment_link_enrollment_context(pg_temp.lhash()) ->> 'provider_account_id', pg_temp.acc()::text,
  '06 el contexto de alta resuelve la cuenta Culqi de la organización');
select is(platform.payment_link_enrollment_context(pg_temp.h(pg_temp.v('link_no_card') ->> 'token')) ->> 'error',
  'TARJETA_GUARDADA_NO_PERMITIDA', '07 un enlace sin tarjeta guardada no admite el alta');
select is(platform.payment_link_statement(pg_temp.lhash()) #>> '{enrollment,available}', 'true',
  '08 el estado de cuenta ofrece el pago automático');

select throws_like(
  $$ select platform.enroll_card_on_file(pg_temp.lid(), pg_temp.acc(), 'cus_mock_qa45', 'crd_mock_qa45', 'VISA', '4242',
                                         12, 2030, 'OTROS_TERMINOS', null) $$,
  '%TERMINOS_NO_ACEPTADOS%', '09 sin los términos CARD_ON_FILE_V1 no hay alta');
select throws_like(
  $$ select platform.enroll_card_on_file(pg_temp.lid(), (select id from platform.payment_provider_accounts where code = 'ebim-manual'),
                                         'cus_mock_qa45', 'crd_mock_qa45', 'VISA', '4242', 12, 2030, 'CARD_ON_FILE_V1', null) $$,
  '%CUENTA_PROVEEDOR_NO_COINCIDE%', '10 la cuenta la decide el servidor, no la petición');

insert into qa select 'enroll', platform.enroll_card_on_file(
  pg_temp.lid(), pg_temp.acc(), 'cus_mock_qa45', 'crd_mock_qa45', 'VISA', '4242', 12, 2030, 'CARD_ON_FILE_V1',
  'abcdef0123456789abcdef0123456789');
select ok((pg_temp.v('enroll') ->> 'authorization_id') is not null, '11 el alta crea la autorización');
select is((pg_temp.v('enroll') ->> 'subscriptions_switched')::int, 2,
  '12 las dos suscripciones activas de Alpha pasan a cobro automático');

select pg_temp.act_as_postgres();
select is(
  (select count(*)::int from platform.subscription_collection_profiles p
     join platform.subscriptions s on s.id = p.subscription_id
    where s.billed_organization_id = pg_temp.alpha() and p.effective_to is null
      and p.collection_method = 'CULQI_CARD' and p.recurring_mode = 'CARD_ON_FILE' and p.auto_charge
      and p.payment_method_id = (pg_temp.v('enroll') ->> 'payment_method_id')::uuid),
  2, '13 perfiles vigentes CULQI_CARD + CARD_ON_FILE con la tarjeta');
select is(
  (select count(*)::int from platform.subscription_collection_profiles p
     join platform.subscriptions s on s.id = p.subscription_id
    where s.code = 'SUB-ALPHA-ESUP'),
  2, '14 el perfil anterior se conserva cerrado (versionado, no se pisa)');
select is((select external_payment_method_id from platform.provider_payment_methods
            where id = (pg_temp.v('enroll') ->> 'payment_method_id')::uuid), 'crd_mock_qa45',
  '15 solo se guarda el id opaco de la tarjeta');
select is((select count(*)::int from platform.payment_link_events where link_id = pg_temp.lid() and kind = 'ENROLL'), 1,
  '16 evento ENROLL en la bitácora del enlace');
select is((select count(*)::int from platform.audit_logs
            where action = 'CARD_ON_FILE_ENROLLED' and entity_id = pg_temp.v('enroll') ->> 'authorization_id'), 1,
  '17 auditoría del alta');

select pg_temp.act_as_service();
select is(platform.payment_link_statement(pg_temp.lhash()) #>> '{card_on_file,authorized}', 'true',
  '18 el estado de cuenta muestra la tarjeta autorizada');
select is(platform.payment_link_statement(pg_temp.lhash()) #>> '{card_on_file,last4}', '4242',
  '19 ... con brand/last4 y nada más');

select pg_temp.act_as(pg_temp.tadmin());
select is((select count(*)::int from platform.v_card_on_file_authorizations where organization_id = pg_temp.alpha()), 1,
  '20 el admin de la organización ve SU autorización');
select is((select count(*)::int from platform.payment_charge_attempts), 0,
  '21 pero no los intentos de cobro (finanzas)');

-- ---------------------------------------------------------------------------
-- Cola de cobro y política de reintentos
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select is(pg_temp.due_count(-1), 0, '22 antes del vencimiento no toca cobrar');
select is(pg_temp.due_no(0), 1, '23 al vencer toca el intento 1');

insert into qa select 'a1', platform.begin_card_charge_attempt(pg_temp.inv(), 'RUN', null, false, pg_temp.at(0));
select is(pg_temp.v('a1') ->> 'ok', 'true', '24 se abre el intento 1 (PENDING)');
select is(pg_temp.v('a1') ->> 'idempotency_key', pg_temp.inv()::text || ':1', '25 clave idempotente invoice:attempt_no');
select is(platform.begin_card_charge_attempt(pg_temp.inv(), 'RUN', null, false, pg_temp.at(0)) ->> 'error',
  'COBRO_NO_PROCEDE', '26 con un intento PENDING no se abre otro (no se cobra dos veces en paralelo)');

select is(platform.complete_card_charge_attempt((pg_temp.v('a1') ->> 'attempt_id')::uuid, false, null, 'TARJETA_RECHAZADA')
            ->> 'next_retry_at',
  to_jsonb(((select d from qa_inv) + 3)::timestamptz) #>> '{}', '27 fallo 1 → reintento a +3 días');
select is(pg_temp.due_count(2), 0, '28 a +2 días todavía no toca');
select is(pg_temp.due_no(3), 2, '29 a +3 días toca el intento 2');

insert into qa select 'a2', platform.begin_card_charge_attempt(pg_temp.inv(), 'RUN', null, false, pg_temp.at(3));
select is(platform.complete_card_charge_attempt((pg_temp.v('a2') ->> 'attempt_id')::uuid, false, null, 'TARJETA_RECHAZADA')
            ->> 'next_retry_at',
  to_jsonb(((select d from qa_inv) + 7)::timestamptz) #>> '{}', '30 fallo 2 → reintento a +7 días');
select is(pg_temp.due_count(6), 0, '31 a +6 días todavía no toca');
select is(pg_temp.due_no(7), 3, '32 a +7 días toca el intento 3');

insert into qa select 'a3', platform.begin_card_charge_attempt(pg_temp.inv(), 'CRON', null, false, pg_temp.at(7));
insert into qa select 'c3', platform.complete_card_charge_attempt((pg_temp.v('a3') ->> 'attempt_id')::uuid, false, null, 'TARJETA_RECHAZADA');
select is(pg_temp.v('c3') ->> 'exhausted', 'true', '33 el tercer fallo agota los reintentos');
select is(pg_temp.v('c3') -> 'next_retry_at', 'null'::jsonb, '34 ... sin fecha de reintento');
select is(pg_temp.due_count(30), 0, '35 agotado: la cola automática ya no lo toma');

select pg_temp.act_as_postgres();
select is(
  (select metadata ->> 'code' from platform.billing_alerts
    where dedupe_key = pg_temp.inv()::text || ':CARD_ON_FILE_EXHAUSTED' and status = 'OPEN'),
  'CARD_ON_FILE_EXHAUSTED', '36 se crea la alerta de cobranza CARD_ON_FILE_EXHAUSTED');
select throws_ok(
  $$ insert into platform.payment_charge_attempts (invoice_id, payment_method_id, provider_account_id, attempt_no,
       idempotency_key, status, amount, currency, trigger_source, completed_at)
     select pg_temp.inv(), (pg_temp.v('enroll') ->> 'payment_method_id')::uuid, pg_temp.acc(), 9,
            pg_temp.inv()::text || ':1', 'FAILED', 1, 'USD', 'RUN', now() $$,
  '23505', null, '37 la clave idempotente es única');

-- «Cobrar ahora» desde la consola ignora el calendario
select pg_temp.act_as_service();
select is(pg_temp.due_no(30, true), 4, '38 «Cobrar ahora» abre el intento 4 aunque la política esté agotada');
insert into qa select 'a4', platform.begin_card_charge_attempt(pg_temp.inv(), 'MANUAL', pg_temp.finance(), true, now());
insert into qa select 'c4', platform.complete_card_charge_attempt(
  (pg_temp.v('a4') ->> 'attempt_id')::uuid, true, 'chr_mock_qa45_ok', null,
  (pg_temp.v('a4') ->> 'amount')::numeric, 'USD', now());
select is(pg_temp.v('c4') ->> 'status', 'SUCCEEDED', '39 cobro correcto → SUCCEEDED');

select pg_temp.act_as_postgres();
select is((select status::text from platform.invoices where id = pg_temp.inv()), 'PAID',
  '40 la factura queda PAID por register_provider_invoice_payment');
select is((select count(*)::int from platform.payments where reference = 'culqi:chr_mock_qa45_ok'), 1,
  '41 un único pago con reference culqi:<chr>');
select ok((select count(*) from platform.commission_events
            where payment_id = (pg_temp.v('c4') ->> 'payment_id')::uuid) > 0,
  '42 el pago devengó su comisión por el trigger existente');
select is(
  (select status::text from platform.billing_alerts where dedupe_key = pg_temp.inv()::text || ':CARD_ON_FILE_EXHAUSTED'),
  'RESOLVED', '43 el cobro cierra la alerta de tarjeta agotada');
select is((select count(*)::int from platform.audit_logs
            where action = 'CARD_CHARGE_REQUESTED' and entity_id = pg_temp.inv()::text), 1,
  '44 «Cobrar ahora» queda auditado');

select pg_temp.act_as_service();
select is(platform.complete_card_charge_attempt((pg_temp.v('a4') ->> 'attempt_id')::uuid, true, 'chr_mock_qa45_ok')
            ->> 'duplicate', 'true', '45 cerrar dos veces el mismo intento es idempotente');

-- ---------------------------------------------------------------------------
-- Baja desde el portal y revocación desde la consola
-- ---------------------------------------------------------------------------
select is((platform.unenroll_card_on_file(pg_temp.lhash(), null) ->> 'revoked')::int, 1,
  '46 el cliente revoca desde el portal');
select pg_temp.act_as_postgres();
select ok(
  (select revoke_source = 'PORTAL' and revoked_at is not null from platform.card_on_file_authorizations
    where id = (pg_temp.v('enroll') ->> 'authorization_id')::uuid)
  and (select status::text = 'INACTIVE' from platform.provider_payment_methods
        where id = (pg_temp.v('enroll') ->> 'payment_method_id')::uuid)
  and not exists (select 1 from platform.subscription_collection_profiles p
                    join platform.subscriptions s on s.id = p.subscription_id
                   where s.billed_organization_id = pg_temp.alpha() and p.effective_to is null
                     and p.recurring_mode = 'CARD_ON_FILE'),
  '47 baja: autorización revocada (PORTAL), tarjeta INACTIVE y sin perfiles CARD_ON_FILE');

-- Nueva alta para probar la revocación de consola.
select pg_temp.act_as_service();
insert into qa select 'enroll2', platform.enroll_card_on_file(
  pg_temp.lid(), pg_temp.acc(), 'cus_mock_qa45', 'crd_mock_qa45_b', 'MASTERCARD', '5454', null, null, 'CARD_ON_FILE_V1', null);

select pg_temp.act_as(pg_temp.tadmin());
select throws_ok(
  $$ select platform.revoke_card_on_file_authorization((pg_temp.v('enroll2') ->> 'authorization_id')::uuid, 'x') $$,
  '42501', null, '48 un ORG_ADMIN no revoca desde la consola');
select pg_temp.act_as(pg_temp.finance());
select is(platform.revoke_card_on_file_authorization((pg_temp.v('enroll2') ->> 'authorization_id')::uuid,
            'El cliente lo pidió por teléfono') ->> 'already_revoked', 'false',
  '49 finanzas revoca la autorización');
select pg_temp.act_as_postgres();
select is(
  (select count(*)::int from platform.audit_logs
    where action = 'CARD_ON_FILE_REVOKED' and entity_id = pg_temp.v('enroll2') ->> 'authorization_id'
      and metadata ->> 'source' = 'CONSOLE'),
  1, '50 la revocación de consola queda auditada con su origen');

select * from finish();
rollback;
