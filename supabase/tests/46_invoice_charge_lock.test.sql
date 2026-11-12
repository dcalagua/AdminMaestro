-- ============================================================================
-- M1/M2 · Candado de cobro por factura (migración 20261010000400)
-- ----------------------------------------------------------------------------
-- Dos cobros simultáneos de la misma factura (doble clic, dos pestañas, portal
-- + cobro automático) no pueden llegar ambos a la pasarela:
--   · solo el servidor reclama/libera; finanzas solo lee;
--   · un segundo claim mientras hay uno vigente → COBRO_EN_CURSO;
--   · RELEASE lo libera; REVIEW lo mantiene (ambiguo) hasta registrar un pago
--     o vencer; un candado vencido se puede volver a reclamar;
--   · un intento PENDING reciente de cobro automático cuenta como en curso;
--   · el claim devuelve el SALDO vigente y rechaza facturas sin saldo.
-- ============================================================================
begin;
select plan(24);

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
create or replace function pg_temp.acc() returns uuid language sql as
  $$ select id from platform.payment_provider_accounts where code = 'culqi-pe-test' $$;

create temp table qa (k text primary key, v jsonb);
grant all on qa to public;
create or replace function pg_temp.v(p_k text) returns jsonb language sql as $$ select v from qa where k = p_k $$;

-- Factura abierta de Alpha · eSupplier.
create temp table qa_inv as
select i.id as inv, i.number, i.total
  from platform.invoices i
  join platform.subscriptions s on s.id = i.subscription_id
 where s.code = 'SUB-ALPHA-ESUP' and i.status in ('ISSUED', 'PARTIALLY_PAID')
 order by i.issue_date desc limit 1;
grant all on qa_inv to public;
create or replace function pg_temp.inv() returns uuid language sql as $$ select inv from qa_inv $$;
create or replace function pg_temp.claim(p_holder text default 'PORTAL') returns jsonb language sql as $$
  select platform.claim_invoice_charge_lock(pg_temp.inv(), p_holder, 'qa46', 120)
$$;

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'platform.invoice_charge_locks'::regclass),
  '01 invoice_charge_locks: RLS habilitada y forzada');

select ok(
  not has_function_privilege('authenticated', 'platform.claim_invoice_charge_lock(uuid, text, text, integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'platform.claim_invoice_charge_lock(uuid, text, text, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'platform.release_invoice_charge_lock(uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'platform.release_invoice_charge_lock(uuid, text, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'platform.claim_invoice_charge_lock(uuid, text, text, integer)', 'EXECUTE'),
  '02 reclamar y liberar el candado: SOLO SERVIDOR');

select ok(
  not has_table_privilege('authenticated', 'platform.invoice_charge_locks', 'INSERT')
  and not has_table_privilege('authenticated', 'platform.invoice_charge_locks', 'UPDATE')
  and not has_table_privilege('anon', 'platform.invoice_charge_locks', 'SELECT'),
  '03 la consola no escribe candados; anon no los ve');

-- Un usuario de finanzas que fuerza la RPC recibe 42501 (defensa en la función).
select pg_temp.act_as(pg_temp.finance());
select throws_ok($$ select platform.claim_invoice_charge_lock(pg_temp.inv(), 'PORTAL') $$,
  '42501', null, '04 finanzas no puede reclamar el candado');

-- ---------------------------------------------------------------------------
-- Reclamo atómico
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select throws_like($$ select platform.claim_invoice_charge_lock(pg_temp.inv(), 'CONSOLA') $$,
  '%ORIGEN_INVALIDO%', '05 el origen solo puede ser PORTAL o AUTOCHARGE');

insert into qa select 'c1', pg_temp.claim('PORTAL');
select is(pg_temp.v('c1') ->> 'ok', 'true', '06 el primer cobro reclama el candado');
select is((pg_temp.v('c1') ->> 'balance')::numeric, platform.invoice_balance(pg_temp.inv()),
  '07 el claim devuelve el saldo vigente leído con la factura bloqueada');

insert into qa select 'c2', pg_temp.claim('PORTAL');
select is(pg_temp.v('c2') ->> 'error', 'COBRO_EN_CURSO', '08 un segundo cobro del portal (doble clic) → COBRO_EN_CURSO');
select ok((pg_temp.v('c2') ->> 'retry_after_seconds')::int between 1 and 120,
  '09 informa cuánto falta para que el candado venza');

insert into qa select 'c3', pg_temp.claim('AUTOCHARGE');
select is(pg_temp.v('c3') ->> 'error', 'COBRO_EN_CURSO', '10 el cobro automático tampoco cobra mientras el portal tiene el candado');

-- ---------------------------------------------------------------------------
-- Liberación
-- ---------------------------------------------------------------------------
select is(platform.release_invoice_charge_lock(gen_random_uuid(), 'RELEASE') ->> 'error', 'CANDADO_NO_ENCONTRADO',
  '11 liberar con un lock_id ajeno no toca el candado vigente');
select is(pg_temp.claim() ->> 'error', 'COBRO_EN_CURSO', '12 … y sigue tomado');

select is(platform.release_invoice_charge_lock((pg_temp.v('c1') ->> 'lock_id')::uuid, 'RELEASE', 'TARJETA_RECHAZADA') ->> 'status',
  'RELEASED', '13 un fallo definitivo libera el candado');
select is(platform.release_invoice_charge_lock((pg_temp.v('c1') ->> 'lock_id')::uuid, 'RELEASE') ->> 'duplicate', 'true',
  '14 liberar dos veces es idempotente');

insert into qa select 'c4', pg_temp.claim('AUTOCHARGE');
select is(pg_temp.v('c4') ->> 'ok', 'true', '15 liberado, otro cobro puede reclamarlo');
select isnt(pg_temp.v('c4') ->> 'lock_id', pg_temp.v('c1') ->> 'lock_id', '16 cada reclamo tiene su propio lock_id');

-- ---------------------------------------------------------------------------
-- Resultado ambiguo (REVIEW) y vencimiento
-- ---------------------------------------------------------------------------
select is(platform.release_invoice_charge_lock((pg_temp.v('c4') ->> 'lock_id')::uuid, 'REVIEW', 'PROVEEDOR_NO_DISPONIBLE') ->> 'status',
  'REVIEW', '17 un fallo ambiguo deja el candado en revisión');
select is(pg_temp.claim() ->> 'error', 'COBRO_EN_CURSO', '18 en revisión no se puede volver a cobrar');

-- Un pago CONFIRMED de la factura (webhook / reconciliación) resuelve la revisión.
select platform.register_provider_invoice_payment(
  pg_temp.acc(), 'qa46:evt-1', 'chr_test_qa46_review', pg_temp.inv(), 1, 'USD', now(), '{"origin":"pgtap"}'::jsonb);
select is((select status from platform.invoice_charge_locks where invoice_id = pg_temp.inv()), 'RELEASED',
  '19 registrar el pago libera el candado en revisión');

-- Vencimiento: un candado ACTIVE abandonado (Edge Function caída) se puede reclamar al vencer.
insert into qa select 'c5', pg_temp.claim('PORTAL');
select pg_temp.act_as_postgres();
update platform.invoice_charge_locks
   set claimed_at = now() - interval '10 minutes', expires_at = now() - interval '1 second'
 where invoice_id = pg_temp.inv();
select pg_temp.act_as_service();
insert into qa select 'c6', pg_temp.claim('PORTAL');
select is(pg_temp.v('c6') ->> 'ok', 'true', '20 un candado vencido se vuelve a reclamar');
select is(platform.release_invoice_charge_lock((pg_temp.v('c5') ->> 'lock_id')::uuid, 'RELEASE') ->> 'error',
  'CANDADO_NO_ENCONTRADO', '21 el dueño del candado vencido ya no puede liberar el nuevo');
select platform.release_invoice_charge_lock((pg_temp.v('c6') ->> 'lock_id')::uuid, 'RELEASE');

-- ---------------------------------------------------------------------------
-- Intento PENDING de cobro automático y facturas sin saldo
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
insert into platform.payment_charge_attempts (
  invoice_id, payment_method_id, provider_account_id, attempt_no, idempotency_key, status, amount, currency, trigger_source)
select pg_temp.inv(), m.id, m.provider_account_id, 99, pg_temp.inv()::text || ':99', 'PENDING', 1, 'USD', 'RUN'
  from platform.provider_payment_methods m limit 1;
select pg_temp.act_as_service();
select is(pg_temp.claim() ->> 'error', 'COBRO_EN_CURSO',
  '22 un intento PENDING reciente de cobro automático (resultado desconocido) bloquea el portal');

select is(platform.claim_invoice_charge_lock(gen_random_uuid(), 'PORTAL') ->> 'error', 'FACTURA_NO_PAGABLE',
  '23 una factura inexistente (o sin saldo) no se puede cobrar');

-- ---------------------------------------------------------------------------
-- Lectura de finanzas
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.finance());
select is((select count(*)::int from platform.invoice_charge_locks where invoice_id = pg_temp.inv()), 1,
  '24 finanzas puede leer el estado del candado');

select * from finish();
rollback;
