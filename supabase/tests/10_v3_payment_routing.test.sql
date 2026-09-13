-- ============================================================================
-- V3 · Fase 07 — Routing regional de cobro (G-16)
-- ============================================================================
begin;
select plan(22);

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

create or replace function pg_temp.sub(p_code text) returns uuid language sql as
  $$ select id from platform.subscriptions where code = p_code $$;
create or replace function pg_temp.acc(p_code text) returns uuid language sql as
  $$ select id from platform.payment_provider_accounts where code = p_code $$;

-- ---------------------------------------------------------------------------
-- Estado de partida
-- ---------------------------------------------------------------------------
select is(
  (select market_code || ':' || array_to_string(currencies, ',')
     from platform.v_provider_account_routes where code = 'culqi-pe-test'),
  'PE:PEN,USD',
  'culqi-pe-test es una cuenta de Perú que cobra PEN y USD'
);

select is(
  (select array_to_string(supported_methods, ',') from platform.v_provider_account_routes where code = 'culqi-pe-test'),
  'CULQI_CARD',
  'Una cuenta Culqi solo soporta tarjeta: no es un proveedor universal'
);

select throws_ok(
  $$ insert into platform.payment_provider_accounts (code, name, provider_kind)
     values ('sin-pais', 'Sin país', 'BANK') $$,
  '23502', null,
  'Una cuenta sin país ni moneda ya no nace PE/PEN por defecto'
);

-- ---------------------------------------------------------------------------
-- Fixtures (finanzas): cuenta bancaria de Bolivia, Culqi PE solo PEN, Culqi de Andina.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');  -- finance

select lives_ok(
  $$ select platform.upsert_payment_provider_account(
       'banco-bo-test', 'Banco Bolivia (TEST)', 'BANK', 'TEST', null, 'BO', array['BOB', 'USD']::char(3)[]) $$,
  'Finanzas crea una cuenta bancaria del mercado BO con BOB y USD'
);

select throws_like(
  $$ select platform.upsert_payment_provider_account(
       'banco-bo-pen', 'Banco Bolivia PEN', 'BANK', 'TEST', null, 'BO', array['PEN']::char(3)[]) $$,
  'MONEDA_NO_PERMITIDA_EN_MERCADO%',
  'Una cuenta de Bolivia no puede declarar PEN'
);

select throws_like(
  $$ select platform.upsert_payment_provider_account('culqi-sin-mercado', 'Sin mercado', 'CULQI') $$,
  'MERCADO_REQUERIDO%',
  'Una cuenta de cobro exige mercado explícito'
);

select lives_ok(
  $$ select platform.upsert_payment_provider_account(
       'culqi-pe-solo-pen', 'Culqi PE solo PEN', 'CULQI', 'TEST', null, 'PE', array['PEN']::char(3)[],
       p_routing_priority => 1) $$,
  'Finanzas crea una cuenta Culqi PE que solo cobra PEN (y con prioridad alta)'
);

select lives_ok(
  $$ select platform.upsert_payment_provider_account(
       'culqi-andina', 'Culqi Consultora Andina', 'CULQI', 'TEST', '30000000-0000-4000-a000-000000000002',
       'PE', array['USD']::char(3)[]) $$,
  'Finanzas registra la cuenta Culqi propia del partner Andina (PE/USD)'
);

select pg_temp.act_as_postgres();

-- Contrato BOB en Bolivia.
insert into platform.subscriptions (id, code, billed_organization_id, saas_product_id, plan_id, market_id,
                                    billing_interval, currency)
values ('7d000000-0000-4000-a000-000000000001', 'SUB-QA-BO-BOB', '30000000-0000-4000-a000-000000000004',
        '20000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001',
        platform.market_id_by_code('BO'), 'MONTHLY', 'BOB');

select throws_like(
  $$ insert into platform.payment_provider_account_currencies (provider_account_id, currency_code)
     values (pg_temp.acc('culqi-pe-test'), 'BOB') $$,
  'MONEDA_NO_PERMITIDA_EN_MERCADO%',
  'A una cuenta de Perú no se le puede añadir BOB'
);

-- ---------------------------------------------------------------------------
-- Cuenta explícita: solo si es elegible
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000001');  -- super admin

select throws_like(
  $$ select platform.set_subscription_collection_profile(
       '7d000000-0000-4000-a000-000000000001', 'CULQI_CARD', pg_temp.acc('culqi-pe-test')) $$,
  'CUENTA_PROVEEDOR_OTRO_MERCADO%',
  'La cuenta PE/PEN (culqi-pe-test) NO cobra un contrato BO/BOB'
);

select throws_like(
  $$ select platform.set_subscription_collection_profile(
       pg_temp.sub('SUB-TITAN-EWM'), 'CULQI_CARD', pg_temp.acc('culqi-pe-solo-pen')) $$,
  'MONEDA_NO_SOPORTADA_POR_CUENTA%',
  'Una cuenta PE que solo cobra PEN no cobra un contrato PE en USD'
);

select throws_like(
  $$ select platform.set_subscription_collection_profile(
       '7d000000-0000-4000-a000-000000000001', 'CULQI_CARD', pg_temp.acc('banco-bo-test')) $$,
  'PROVEEDOR_INCOMPATIBLE%',
  'Proveedor incompatible: una cuenta bancaria no cobra con tarjeta'
);

select throws_ok(
  $$ select platform.set_subscription_collection_profile(
       pg_temp.sub('SUB-TITAN-EWM'), 'CULQI_CARD', pg_temp.acc('culqi-andina')) $$,
  '42501', null,
  'La cuenta propia de Andina no cobra el contrato de otra organización'
);

-- ---------------------------------------------------------------------------
-- Routing en servidor
-- ---------------------------------------------------------------------------
select is(
  (select account_code from platform.provider_account_candidates(pg_temp.sub('SUB-TITAN-EWM'), 'CULQI_CARD')
    where route_rank = 1),
  'culqi-pe-test',
  'Para un contrato PE/USD la ruta es culqi-pe-test aunque exista otra cuenta PE con más prioridad que no cobra USD'
);

select is(
  (select reason from platform.provider_account_candidates(pg_temp.sub('SUB-TITAN-EWM'), 'CULQI_CARD')
    where account_code = 'culqi-pe-solo-pen'),
  'MONEDA_NO_SOPORTADA_POR_CUENTA',
  'La elegibilidad explica por qué una cuenta no sirve'
);

select lives_ok(
  $$ select platform.set_subscription_collection_profile(
       pg_temp.sub('SUB-TITAN-EWM'), 'CULQI_CARD', p_route_provider => true) $$,
  'Con routing del servidor el perfil se crea sin que el cliente indique cuenta'
);

select is(
  (select a.code from platform.subscription_collection_profiles p
     join platform.payment_provider_accounts a on a.id = p.provider_account_id
    where p.subscription_id = pg_temp.sub('SUB-TITAN-EWM') and p.effective_to is null),
  'culqi-pe-test',
  'La cuenta asignada la eligió el servidor por mercado + moneda + método'
);

select lives_ok(
  $$ select platform.set_subscription_collection_profile(
       pg_temp.sub('SUB-ANDINA-PD-A'), 'CULQI_CARD', p_route_provider => true) $$,
  'Routing del contrato de Andina'
);

select is(
  (select a.code from platform.subscription_collection_profiles p
     join platform.payment_provider_accounts a on a.id = p.provider_account_id
    where p.subscription_id = pg_temp.sub('SUB-ANDINA-PD-A') and p.effective_to is null),
  'culqi-andina',
  'La cuenta propia de quien paga gana a la de EBIM en su mercado'
);

select throws_like(
  $$ select platform.set_subscription_collection_profile(
       '7d000000-0000-4000-a000-000000000001', 'CULQI_CARD', p_route_provider => true) $$,
  'PROVEEDOR_NO_DISPONIBLE_EN_MERCADO%',
  'Sin cuenta de tarjeta en Bolivia no se inventa una: Culqi no es universal'
);

select throws_like(
  $$ select platform.set_subscription_collection_profile(
       pg_temp.sub('SUB-OMEGA-ESUP'), 'CULQI_CARD', pg_temp.acc('culqi-pe-test'), p_route_provider => true) $$,
  'CUENTA_PROVEEDOR_NO_COINCIDE%',
  'Con routing del servidor, una cuenta enviada por el cliente se rechaza'
);

-- ---------------------------------------------------------------------------
-- Métodos no-card siguen operativos, sin cuenta
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select platform.set_subscription_collection_profile(
       '7d000000-0000-4000-a000-000000000001', 'BANK_TRANSFER', p_route_provider => true);
     select platform.set_subscription_collection_profile(
       '7d000000-0000-4000-a000-000000000001', 'SERVICE_ORDER', p_route_provider => true,
       p_effective_from => current_date + 1);
     select platform.set_subscription_collection_profile(
       '7d000000-0000-4000-a000-000000000001', 'PURCHASE_ORDER', p_route_provider => true,
       p_effective_from => current_date + 2);
     select platform.set_subscription_collection_profile(
       '7d000000-0000-4000-a000-000000000001', 'MANUAL', p_route_provider => true,
       p_effective_from => current_date + 3) $$,
  'BANK_TRANSFER, SERVICE_ORDER, PURCHASE_ORDER y MANUAL se configuran en Bolivia sin cuenta de proveedor'
);

select * from finish();
rollback;
