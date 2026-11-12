-- ============================================================================
-- M3 · Tarifa de plataforma de partners (migraciones 20261011000050 y …000100)
-- ----------------------------------------------------------------------------
-- Spec §4: términos por acuerdo (solo si factura el partner), canal de
-- facturación de la suscripción, estado de cuenta mensual por moneda
-- (idempotente, base mensualizada, ONE_TIME fuera, fijo en otra moneda en línea
-- aparte), emisión de la factura al partner (sin suscripción, pagable por el
-- portal M1), anulación sin cobros, lectura del propio partner y comisiones
-- solo con regla explícita.
--
-- Escenario: Consultora Andina (partner) · eSupplier pasa a facturación del
-- partner con 10 % + 5 USD por tenant. Tenants de Andina en eSupplier (seed):
-- P1 850, P2 850, PD-A 480, PD-B 480, Santa Cruz 480 (USD) e Illimani 5900 BOB.
-- ============================================================================
begin;
select plan(52);

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

create or replace function pg_temp.super() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.padmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.finance() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000003'::uuid $$;
create or replace function pg_temp.andina_admin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000004'::uuid $$;
create or replace function pg_temp.pacifico_admin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000007'::uuid $$;
create or replace function pg_temp.andina() returns uuid language sql as $$ select '30000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.esup() returns uuid language sql as $$ select '20000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.m0() returns date language sql as $$
  select date_trunc('month', current_date)::date
$$;
create or replace function pg_temp.agreement() returns uuid language sql as $$
  select id from platform.organization_product_agreements
   where organization_id = pg_temp.andina() and saas_product_id = pg_temp.esup() and status = 'ACTIVE'
$$;
create or replace function pg_temp.acc() returns uuid language sql as
  $$ select id from platform.payment_provider_accounts where code = 'culqi-pe-test' $$;

create temp table qa (k text primary key, v jsonb);
grant all on qa to public;
create or replace function pg_temp.v(p_k text) returns jsonb language sql as $$ select v from qa where k = p_k $$;
create or replace function pg_temp.st(p_currency text) returns platform.partner_fee_statements language sql as $$
  select * from platform.partner_fee_statements
   where partner_organization_id = pg_temp.andina() and period_start = pg_temp.m0() and currency = p_currency
     and status <> 'VOID'
$$;

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
    where oid in ('platform.partner_fee_statements'::regclass, 'platform.partner_fee_statement_lines'::regclass)),
  '01 estados de cuenta y líneas: RLS habilitada y forzada');
select is(
  (select string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'execute'), ',' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform'
      and p.proname in ('set_agreement_platform_fee', 'set_subscription_billing_channel', 'compute_partner_fee_statement',
                        'compute_all_partner_fee_statements', 'issue_partner_fee_statement', 'void_partner_fee_statement')),
  'compute_all_partner_fee_statements:false,compute_partner_fee_statement:false,issue_partner_fee_statement:false,'
  || 'set_agreement_platform_fee:false,set_subscription_billing_channel:false,void_partner_fee_statement:false',
  '02 anon no ejecuta ninguna RPC de la tarifa');
select ok(
  not has_column_privilege('authenticated', 'platform.organization_product_agreements', 'platform_fee_model', 'UPDATE')
  and not has_column_privilege('authenticated', 'platform.organization_product_agreements', 'platform_fee_rate', 'INSERT')
  and not has_column_privilege('authenticated', 'platform.subscriptions', 'billing_channel', 'UPDATE')
  and not has_table_privilege('authenticated', 'platform.partner_fee_statements', 'INSERT'),
  '03 la tarifa, el canal y los estados de cuenta solo cambian por RPC');
select ok('PARTNER_PLATFORM_FEE' = any (enum_range(null::platform.charge_kind)::text[]),
  '04 el enum charge_kind tiene PARTNER_PLATFORM_FEE');

-- ---------------------------------------------------------------------------
-- 1. Términos por acuerdo
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.padmin());
select throws_ok(format('select platform.set_agreement_platform_fee(%L, %L, 0.1, null, null, %L)',
                        pg_temp.agreement(), 'PERCENT_OF_LIST', 'QA'),
  '42501', null, '05 el admin de producto no fija tarifas de partners');

select pg_temp.act_as(pg_temp.finance());
select throws_like(format('select platform.set_agreement_platform_fee(%L, %L, 0.1, null, null, %L)',
                          pg_temp.agreement(), 'PERCENT_OF_LIST', 'QA'),
  '%TARIFA_PARTNER_REQUIERE_FACTURACION_PARTNER%', '06 si factura EBIM, el partner no paga tarifa');

select pg_temp.act_as_postgres();
update platform.organization_product_agreements set billing_responsibility = 'PARTNER' where id = pg_temp.agreement();

select pg_temp.act_as(pg_temp.finance());
select throws_like(format('select platform.set_agreement_platform_fee(%L, %L, 1.5, null, null, %L)',
                          pg_temp.agreement(), 'PERCENT_OF_LIST', 'QA'),
  '%TARIFA_PORCENTAJE_INVALIDO%', '07 el porcentaje va de 0 a 1');
select throws_like(format('select platform.set_agreement_platform_fee(%L, %L, 0.1, null, null, %L)',
                          pg_temp.agreement(), 'PERCENT_PLUS_FIXED', 'QA'),
  '%TARIFA_FIJA_INVALIDA%', '08 % + fijo exige el fijo');
select throws_like(format('select platform.set_agreement_platform_fee(%L, %L, 0.1, null, null, %L)',
                          pg_temp.agreement(), 'PERCENT_OF_LIST', ' '),
  '%MOTIVO_REQUERIDO%', '09 fijar la tarifa exige motivo');
select is(platform.set_agreement_platform_fee(pg_temp.agreement(), 'PERCENT_PLUS_FIXED', 0.10, 5, 'usd',
                                               'QA: 10 % + 5 USD por tenant') ->> 'currency', 'USD',
  '10 finanzas fija 10 % + 5 USD (moneda normalizada)');
select is((select count(*)::int from platform.audit_logs where action = 'AGREEMENT_PLATFORM_FEE_SET'
            and entity_id = pg_temp.agreement()::text), 1, '11 queda auditado');

select pg_temp.act_as_postgres();
select throws_ok(format('update platform.organization_product_agreements set platform_fee_fixed_amount = null where id = %L',
                        pg_temp.agreement()),
  '23514', null, '12 CHECK: el modelo exige sus términos');
select throws_ok(format('update platform.organization_product_agreements set billing_responsibility = %L where id = %L',
                        'EBIM', pg_temp.agreement()),
  '23514', null, '13 CHECK: con tarifa, el acuerdo no puede pasar a facturación EBIM');

-- ---------------------------------------------------------------------------
-- 2. Canal de facturación
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.super());
insert into qa select 'onb', platform.onboard_customer_subscription(
  'esupplier', '30000000-0000-4000-a000-00000000000d', 'qa47-partner-billed', 'QA 47 facturado por partner',
  'admin@qa47.example.com', '60000000-0000-4000-a000-000000000001', 'BO',
  p_managing_organization_id => pg_temp.andina(), p_activate => true);
select is(pg_temp.v('onb') ->> 'billing_channel', 'PARTNER_STATEMENT',
  '14 el alta con un partner que factura el producto nace PARTNER_STATEMENT');
select is((select billing_channel from platform.subscriptions where id = (pg_temp.v('onb') ->> 'subscription_id')::uuid),
  'PARTNER_STATEMENT', '15 … y así queda en la suscripción');
insert into qa select 'onb_direct', platform.onboard_customer_subscription(
  'esupplier', '30000000-0000-4000-a000-00000000000d', 'qa47-direct', 'QA 47 directo',
  'admin@qa47d.example.com', '60000000-0000-4000-a000-000000000001', 'BO', p_activate => true);
select is(pg_temp.v('onb_direct') ->> 'billing_channel', 'DIRECT', '16 un alta sin partner sigue DIRECT');

select pg_temp.act_as(pg_temp.finance());
select throws_like(format('select platform.issue_subscription_invoice(%L)', pg_temp.v('onb') ->> 'subscription_id'),
  '%SUSCRIPCION_FACTURADA_POR_PARTNER%', '17 EBIM no factura al cliente final de un partner que factura');
select throws_like(format('select platform.set_subscription_billing_channel(%L, %L, %L)',
                          pg_temp.v('onb_direct') ->> 'subscription_id', 'PARTNER_STATEMENT', 'QA'),
  '%SUSCRIPCION_SIN_PARTNER%', '18 PARTNER_STATEMENT exige un partner');
select is(platform.set_subscription_billing_channel((pg_temp.v('onb') ->> 'subscription_id')::uuid, 'DIRECT',
                                                    'QA: corrección') ->> 'billing_channel', 'DIRECT',
  '19 finanzas corrige el canal');
select ok((platform.issue_subscription_invoice((pg_temp.v('onb') ->> 'subscription_id')::uuid) ->> 'invoice_id') is not null,
  '20 con DIRECT la suscripción vuelve a facturarse (comportamiento previo intacto)');
select platform.set_subscription_billing_channel((pg_temp.v('onb') ->> 'subscription_id')::uuid, 'PARTNER_STATEMENT', 'QA');
select pg_temp.act_as(pg_temp.padmin());
select throws_ok(format('select platform.set_subscription_billing_channel(%L, %L, %L)',
                        pg_temp.v('onb') ->> 'subscription_id', 'DIRECT', 'QA'),
  '42501', null, '21 el admin de producto no cambia el canal');

-- La suscripción del alta QA (BOB) entraría en la base: se saca para fijar los importes del seed.
select pg_temp.act_as_postgres();
update platform.subscriptions set status = 'CANCELLED', cancelled_at = now()
 where id = (pg_temp.v('onb') ->> 'subscription_id')::uuid;

-- ---------------------------------------------------------------------------
-- 3. Estado de cuenta (cálculo)
-- ---------------------------------------------------------------------------
-- Ítems extra en P1: un ADDON anual (1200 → 100/mes) y un ONE_TIME (fuera de la base).
insert into platform.subscription_items (subscription_id, charge_kind, description, quantity, unit_amount, currency,
                                         billing_interval, tenant_id, valid_from)
select s.id, 'ADDON'::platform.charge_kind, 'QA addon anual', 1, 1200, 'USD', 'YEARLY'::platform.billing_interval, s.tenant_id, pg_temp.m0()
  from platform.subscriptions s where s.code = 'SUB-P1-ESUP'
union all
select s.id, 'ADDON', 'QA addon único', 1, 999, 'USD', 'ONE_TIME', s.tenant_id, pg_temp.m0()
  from platform.subscriptions s where s.code = 'SUB-P1-ESUP';

select pg_temp.act_as(pg_temp.padmin());
select throws_ok(format('select platform.compute_partner_fee_statement(%L, %L)', pg_temp.andina(), pg_temp.m0()),
  '42501', null, '22 el admin de producto no calcula tarifas');

select pg_temp.act_as(pg_temp.finance());
insert into qa select 'c1', platform.compute_partner_fee_statement(pg_temp.andina(), pg_temp.m0() + 10);
select is(jsonb_array_length(pg_temp.v('c1') -> 'statements'), 2, '23 un estado de cuenta por moneda (USD y BOB)');
select is((pg_temp.st('USD')).base_total, 3240.00::numeric(14,2),
  '24 base USD = 950 + 850 + 480 × 3 (anual mensualizado, ONE_TIME fuera)');
select is((pg_temp.st('USD')).fee_total, 354.00::numeric(14,2),
  '25 tarifa USD = Σ (10 % + 5) por tenant + 5 USD fijo de Illimani');
select is((pg_temp.st('BOB')).fee_total, 590.00::numeric(14,2), '26 tarifa BOB = 10 % de 5900 (el fijo va en USD)');
select is((pg_temp.st('USD')).tenant_count, 6, '27 seis tenants en el estado USD (Illimani por su fijo)');
select is((select count(*)::int from platform.partner_fee_statement_lines
            where statement_id = (pg_temp.st('USD')).id and line_kind = 'FIXED_SEPARATE'), 1,
  '28 el fijo en otra moneda va en una línea FIXED_SEPARATE');
select is((select fee_amount from platform.partner_fee_statement_lines l join platform.tenants t on t.id = l.tenant_id
            where l.statement_id = (pg_temp.st('USD')).id and t.slug = 'cliente-p1-esupplier'), 100.00::numeric(14,2),
  '29 P1: round(950 × 10 %) + 5 = 100');
select is((pg_temp.st('USD')).period_start, pg_temp.m0(), '30 el período se normaliza al primer día del mes');

insert into qa select 'h1', to_jsonb((pg_temp.st('USD')).source_hash);
insert into qa select 'c2', platform.compute_partner_fee_statement(pg_temp.andina(), pg_temp.m0());
select is((select count(*)::int from jsonb_array_elements(pg_temp.v('c2') -> 'statements') e where (e ->> 'changed')::boolean),
  0, '31 recalcular sin cambios es idempotente');
select is(to_jsonb((pg_temp.st('USD')).source_hash), pg_temp.v('h1'), '32 source_hash estable');

-- Un tenant suspendido sale de la base; el borrador se recalcula.
select pg_temp.act_as_postgres();
update platform.tenants set status = 'SUSPENDED' where slug = 'andina-pd-cliente-b';
select pg_temp.act_as(pg_temp.finance());
select platform.compute_partner_fee_statement(pg_temp.andina(), pg_temp.m0());
select is((pg_temp.st('USD')).fee_total, 301.00::numeric(14,2), '33 un tenant no ACTIVE sale de la base (−53)');
select pg_temp.act_as_postgres();
update platform.tenants set status = 'ACTIVE' where slug = 'andina-pd-cliente-b';
select pg_temp.act_as(pg_temp.finance());
select platform.compute_partner_fee_statement(pg_temp.andina(), pg_temp.m0());
select is(to_jsonb((pg_temp.st('USD')).source_hash), pg_temp.v('h1'), '34 vuelve al mismo hash con los mismos datos');

-- Lectura: el admin del partner ve lo suyo; otro partner no.
select pg_temp.act_as(pg_temp.andina_admin());
select is((select count(*)::int from platform.v_partner_fee_statements where partner_organization_id = pg_temp.andina()),
  2, '35 el PARTNER_ADMIN lee sus estados de cuenta');
select ok((select count(*) from platform.v_partner_fee_statement_lines) >= 7, '36 … y sus líneas');
select pg_temp.act_as(pg_temp.pacifico_admin());
select is((select count(*)::int from platform.v_partner_fee_statements), 0, '37 otro partner no los ve');
select is((select count(*)::int from platform.partner_fee_statement_lines), 0, '38 … ni sus líneas');

-- ---------------------------------------------------------------------------
-- 4. Emisión
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.andina_admin());
select throws_ok(format('select platform.issue_partner_fee_statement(%L)', (pg_temp.st('USD')).id),
  '42501', null, '39 el partner no se emite su propia factura');

select pg_temp.act_as(pg_temp.finance());
insert into qa select 'iss', platform.issue_partner_fee_statement((pg_temp.st('USD')).id);
create or replace function pg_temp.inv() returns platform.invoices language sql as $$
  select * from platform.invoices where id = (pg_temp.v('iss') ->> 'invoice_id')::uuid
$$;
select ok((pg_temp.inv()).status = 'ISSUED' and (pg_temp.inv()).subscription_id is null
          and (pg_temp.inv()).customer_organization_id = pg_temp.andina(),
  '40 factura ISSUED al partner, sin suscripción');
select is((pg_temp.inv()).total, 354.00::numeric(14,2), '41 total = tarifa del estado de cuenta');
select is((pg_temp.inv()).due_date, current_date + 15, '42 vence a 15 días');
select is((select count(*)::int from platform.invoice_lines where invoice_id = (pg_temp.inv()).id
            and charge_kind = 'PARTNER_PLATFORM_FEE' and tenant_id is not null and saas_product_id = pg_temp.esup()),
  6, '43 una línea PARTNER_PLATFORM_FEE por línea con tarifa, con tenant y producto');
select is((pg_temp.inv()).number, 'INV-' || to_char(pg_temp.m0(), 'YYYYMM') || '-PFEE-'
          || upper((select slug from platform.organizations where id = pg_temp.andina())) || '-USD',
  '44 número correlativo INV-AAAAMM-PFEE-<partner>-<moneda>');
select is(platform.issue_partner_fee_statement((pg_temp.st('USD')).id) ->> 'created', 'false', '45 emitir es idempotente');
select is((select string_agg(e ->> 'status', ',') from jsonb_array_elements(
            platform.compute_partner_fee_statement(pg_temp.andina(), pg_temp.m0()) -> 'statements') e
            where e ->> 'currency' = 'USD'), 'ISSUED', '46 un estado emitido no se recalcula');

-- ---------------------------------------------------------------------------
-- 5. Portal de pago (M1) y comisiones
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select is(platform.resolve_invoice_card_account((pg_temp.inv()).id), pg_temp.acc(),
  '47 la factura del partner (sin suscripción) se cobra con la cuenta Culqi del país');
select pg_temp.act_as(pg_temp.finance());
insert into qa select 'link', platform.create_payment_link(pg_temp.andina(), 30, false, 'QA 47 tarifa');
select pg_temp.act_as_service();
select is(platform.payment_link_charge_context(
            encode(sha256(convert_to(pg_temp.v('link') ->> 'token', 'UTF8')), 'hex'), (pg_temp.inv()).id) ->> 'ok',
  'true', '48 el portal acepta cobrar la factura del partner');

-- Regla genérica COLLECTED_ANY en el plan de la atribución de P1: NO comisiona la tarifa.
select pg_temp.act_as_postgres();
insert into platform.commission_rules (commission_plan_id, name, basis, rate, currency)
values ('90000000-0000-4000-a000-000000000002', 'QA 47 cualquier cobro', 'COLLECTED_ANY', 0.05, 'USD');
select pg_temp.act_as_service();
insert into qa select 'pay', platform.register_provider_invoice_payment(
  pg_temp.acc(), 'qa47:evt-1', 'chr_test_qa47_fee', (pg_temp.inv()).id, 354, 'USD', now(), '{"origin":"pgtap"}'::jsonb);
select pg_temp.act_as_postgres();
select is((select count(*)::int from platform.commission_events where payment_id = (pg_temp.v('pay') ->> 'payment_id')::uuid),
  0, '49 una regla genérica no comisiona PARTNER_PLATFORM_FEE');
insert into platform.commission_rules (commission_plan_id, name, basis, charge_kind, rate, currency)
values ('90000000-0000-4000-a000-000000000002', 'QA 47 tarifa de partner', 'COLLECTED_ANY', 'PARTNER_PLATFORM_FEE', 0.02, 'USD');
select ok(platform.generate_commission_events((pg_temp.v('pay') ->> 'payment_id')::uuid) > 0,
  '50 una regla que nombra PARTNER_PLATFORM_FEE sí comisiona');

-- ---------------------------------------------------------------------------
-- 6. Anulación
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.finance());
select throws_like(format('select platform.void_partner_fee_statement(%L, %L)', (pg_temp.st('USD')).id, 'QA'),
  '%FACTURA_CON_PAGOS_CONFIRMADOS%', '51 con cobros CONFIRMED no se anula');

insert into qa select 'iss_bob', platform.issue_partner_fee_statement((pg_temp.st('BOB')).id);
select platform.void_partner_fee_statement((pg_temp.st('BOB')).id, 'QA: tarifa mal configurada');
select ok(
  (select status from platform.invoices where id = (pg_temp.v('iss_bob') ->> 'invoice_id')::uuid) = 'VOID'
  and (select status from platform.partner_fee_statements where invoice_id = (pg_temp.v('iss_bob') ->> 'invoice_id')::uuid) = 'VOID'
  and (platform.compute_partner_fee_statement(pg_temp.andina(), pg_temp.m0()) is not null)
  and (pg_temp.st('BOB')).status = 'DRAFT'
  and (platform.issue_partner_fee_statement((pg_temp.st('BOB')).id) ->> 'number') like '%-BOB-R2',
  '52 anular deja factura y estado en VOID; el recálculo crea otro borrador y su factura lleva -R2');

select * from finish();
rollback;
