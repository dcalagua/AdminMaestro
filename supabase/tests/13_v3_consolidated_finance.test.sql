-- ============================================================================
-- V3 · Fase 10 — Finanzas consolidadas (G-19..G-22, G-32)
-- Escenario aislado en el producto GMAO (sin datos en el seed), fechas 2031 y
-- tasas QA: PEN y BOB de ingreso, USD de costo, BOB de comisión.
-- ============================================================================
begin;
select plan(20);

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

create or replace function pg_temp.gmao() returns uuid language sql as
  $$ select id from platform.saas_products where code = 'gmao' $$;

create or replace function pg_temp.cons() returns jsonb language sql as
  $$ select platform.finance_consolidated(p_as_of => '2031-05-31', p_saas_product_id => pg_temp.gmao()) -> 'groups' -> 0 $$;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
select set_config('ebim.invoices_total_before',
  (select coalesce(sum(total), 0)::text from platform.invoices), true);
select set_config('ebim.bob_pending_before',
  coalesce((platform.dashboard_summary() -> 'commission_pending_by_currency' ->> 'BOB'), '0'), true);

insert into platform.invoices (id, number, customer_organization_id, status, currency, issue_date)
values ('7e000000-0000-4000-a000-000000000001', 'INV-QA-GMAO-PEN', '30000000-0000-4000-a000-000000000004', 'ISSUED', 'PEN', '2031-05-10'),
       ('7e000000-0000-4000-a000-000000000002', 'INV-QA-GMAO-BOB', '30000000-0000-4000-a000-000000000004', 'ISSUED', 'BOB', '2031-05-10');

insert into platform.invoice_lines (invoice_id, charge_kind, description, saas_product_id, unit_amount)
values ('7e000000-0000-4000-a000-000000000001', 'LICENSE', 'GMAO PEN', pg_temp.gmao(), 1000),
       ('7e000000-0000-4000-a000-000000000002', 'LICENSE', 'GMAO BOB', pg_temp.gmao(), 500);

insert into platform.payments (id, invoice_id, reference, status, amount, paid_at)
values ('7f000000-0000-4000-a000-000000000001', '7e000000-0000-4000-a000-000000000001', 'PAY-QA-GMAO-PEN', 'CONFIRMED', 1000, '2031-05-15'),
       ('7f000000-0000-4000-a000-000000000002', '7e000000-0000-4000-a000-000000000002', 'PAY-QA-GMAO-BOB', 'CONFIRMED', 500, '2031-05-15');

with c as (
  insert into platform.cost_entries (category, description, amount, currency, period_start, period_end)
  values ('DATABASE', 'Infra GMAO QA (USD)', 100, 'USD', '2031-05-01', '2031-05-31')
  returning id
)
insert into platform.cost_allocations (cost_entry_id, scope, saas_product_id, weight)
select c.id, 'PRODUCT', pg_temp.gmao(), 1 from c;

insert into platform.commission_events (
  sales_agent_id, sales_attribution_id, commission_rule_id, payment_id, saas_product_id,
  status, base_amount, applied_rate, attribution_pct, amount, earned_on
)
select a.sales_agent_id, a.id, (select id from platform.commission_rules limit 1),
       '7f000000-0000-4000-a000-000000000002', pg_temp.gmao(),
       'ELIGIBLE', 500, 0.05, 1, 25, '2031-05-15'
  from platform.sales_attributions a limit 1;

-- ---------------------------------------------------------------------------
-- Capa NATIVA corregida
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(currency || '=' || collected_revenue || '/' || direct_cost || '/' || commission_total, ' ' order by currency)
     from platform.v_product_margin where saas_product_id = pg_temp.gmao()),
  'BOB=500.00/0/25.00 PEN=1000.00/0/0 USD=0/100.00/0',
  'R-3: una fila por moneda; el costo USD de un producto que cobra PEN/BOB ya no desaparece'
);

select is(
  (select string_agg(currency || '=' || gross_margin, ' ' order by currency)
     from platform.v_product_margin where saas_product_id = pg_temp.gmao()),
  'BOB=475.00 PEN=1000.00 USD=-100.00',
  'El margen nativo se calcula dentro de cada moneda, sin sumar PEN + BOB + USD'
);

select is(
  (select platform.dashboard_summary() -> 'commission_pending'),
  'null'::jsonb,
  'R-1: con comisiones USD y BOB el escalar commission_pending es NULL, no una suma mezclada'
);

select is(
  (select (platform.dashboard_summary() -> 'commission_pending_by_currency' ->> 'BOB')::numeric)
    - current_setting('ebim.bob_pending_before')::numeric,
  25.00::numeric,
  'El detalle por moneda suma el BOB 25 nuevo solo a BOB'
);

select is(
  (select count(*)::int from platform.v_tenant_overview o
    where o.currency is not null
      and not exists (select 1 from platform.subscriptions s where s.tenant_id = o.tenant_id)),
  0,
  'G-32: un tenant sin contrato no se rotula USD'
);

-- Canal con MRR en dos monedas.
insert into platform.subscriptions (id, code, billed_organization_id, saas_product_id, plan_id, market_id,
                                    status, billing_interval, currency)
values ('7a100000-0000-4000-a000-000000000001', 'SUB-QA-ANDINA-BOB', '30000000-0000-4000-a000-000000000002',
        '20000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001',
        platform.market_id_by_code('BO'), 'ACTIVE', 'MONTHLY', 'BOB');
insert into platform.subscription_items (subscription_id, charge_kind, description, unit_amount, billing_interval, valid_from)
values ('7a100000-0000-4000-a000-000000000001', 'LICENSE', 'Licencia BOB', 5900, 'MONTHLY', current_date - 1);

select is(
  (select coalesce(channel_mrr::text, 'NULL') || ' ' || (select string_agg(k, ',' order by k) from jsonb_object_keys(channel_mrr_by_currency) k)
     from platform.v_partner_agreements
    where organization_slug = 'consultora-andina' and product_code = 'esupplier'),
  'NULL BOB,USD',
  'R-2: channel_mrr no suma USD + BOB; el detalle por moneda está en channel_mrr_by_currency'
);

-- ---------------------------------------------------------------------------
-- Capa CONSOLIDADA con un FX faltante (BOB)
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');  -- finance
select lives_ok(
  $$ select platform.set_exchange_rate('2031-05-31', 'USD', 'PEN', 3.75, 'QA fase 10') $$,
  'Finanzas publica USD/PEN; NO publica tasa para BOB'
);

select is(
  (select string_agg(native_currency || ':' || conversion_status || ':' || coalesce(reporting_amount::text, 'NULL'), ' ' order by native_currency)
     from platform.finance_reporting_rows(p_as_of => '2031-05-31', p_saas_product_id => pg_temp.gmao())
    where metric = 'COLLECTED'),
  'BOB:MISSING_FX:NULL PEN:CONVERTED:266.67',
  'Cada moneda se suma y convierte por separado; BOB sin tasa queda MISSING_FX, no 0'
);

select is(
  pg_temp.cons() -> 'metrics' -> 'COLLECTED' -> 'native',
  '{"BOB": 500.00, "PEN": 1000.00}'::jsonb,
  'El nativo por moneda se entrega separado: nunca «1500»'
);

select is(
  (pg_temp.cons() -> 'metrics' -> 'COLLECTED') - 'native',
  '{"complete": false, "reporting_amount": null, "missing_currencies": ["BOB"]}'::jsonb,
  'Cobrado consolidado incompleto: importe NULL y la moneda que falta'
);

select is(
  (pg_temp.cons() -> 'metrics' -> 'COST') - 'native',
  '{"complete": true, "reporting_amount": 100.00, "missing_currencies": []}'::jsonb,
  'El costo USD sí está completo'
);

select is(
  pg_temp.cons() -> 'margin',
  '{"complete": false, "reporting_amount": null}'::jsonb,
  'Margen consolidado NULL mientras falte una conversión requerida'
);

select is(
  (select platform.finance_consolidated(p_as_of => '2031-05-31', p_saas_product_id => pg_temp.gmao()) -> 'completeness'),
  '{"complete": false, "missing_fx_count": 1, "missing_currencies": ["BOB"]}'::jsonb,
  'La respuesta expone missing_fx_count para no presentar una cifra incompleta como total'
);

-- ---------------------------------------------------------------------------
-- Con la tasa disponible: totales correctos
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select platform.set_exchange_rate('2031-05-31', 'USD', 'BOB', 6.90, 'QA fase 10') $$,
  'Finanzas publica USD/BOB'
);

select is(
  (pg_temp.cons() -> 'metrics' -> 'COLLECTED' ->> 'reporting_amount')::numeric,
  339.13::numeric,
  'Cobrado consolidado = PEN 1000/3.75 (266.67) + BOB 500/6.90 (72.46) = USD 339.13'
);

select is(
  pg_temp.cons() -> 'margin',
  '{"complete": true, "reporting_amount": 235.51}'::jsonb,
  'Margen consolidado = 339.13 − costo 100.00 − comisión BOB 25/6.90 (3.62) = USD 235.51'
);

select is(
  (select platform.finance_consolidated(p_as_of => '2031-05-31', p_saas_product_id => pg_temp.gmao()) -> 'completeness' ->> 'complete'),
  'true',
  'Con todas las tasas el consolidado se declara completo'
);

select is(
  (select jsonb_array_length(platform.finance_consolidated(p_as_of => '2031-05-31', p_saas_product_id => pg_temp.gmao()) -> 'rates_used')),
  2,
  'La respuesta lista las tasas usadas (contexto de fecha y método)'
);

-- ---------------------------------------------------------------------------
-- Filtros regionales y aislamiento
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(g ->> 'key', ',' order by g ->> 'key')
     from jsonb_array_elements(platform.finance_consolidated(p_group_by => 'MARKET') -> 'groups') g),
  'BO,EC,PE,SIN_MERCADO',
  'Agrupado por mercado: BO, EC, PE y los contratos fuera del modelo regional por separado'
);

select pg_temp.act_as_postgres();
select is(
  (select coalesce(sum(total), 0)::text from platform.invoices
    where number not in ('INV-QA-GMAO-PEN', 'INV-QA-GMAO-BOB')),
  current_setting('ebim.invoices_total_before'),
  'Los reportes consolidados no alteran ningún importe nativo'
);

select * from finish();
rollback;
