-- ============================================================================
-- V3 · Fase 09 — Moneda de reporte (G-18). Tasas QA con fecha fija: no reales.
-- ============================================================================
begin;
select plan(16);

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

create or replace function pg_temp.rep(p_amount numeric, p_currency text, p_as_of date, p_rc text default null)
returns text language sql as $$
  select r.native_amount::text || ' ' || r.native_currency || ' -> '
      || coalesce(r.reporting_amount::text, 'NULL') || ' ' || coalesce(r.reporting_currency, '---')
      || ' [' || r.conversion_status || ']'
    from platform.to_reporting_amount(p_amount, p_currency::char(3), p_as_of, p_rc::char(3)) r
$$;

select is(
  (select reporting_currency::text || '/' || fx_max_rate_age_days from platform.reporting_settings()),
  'USD/31',
  'La moneda de reporte inicial es USD por configuración (no por código), con tolerancia de 31 días'
);

select set_config('ebim.invoices_total_before',
  (select coalesce(sum(total), 0)::text from platform.invoices), true);

select pg_temp.act_as('10000000-0000-4000-a000-000000000003');  -- finance

select lives_ok(
  $$ select platform.set_exchange_rate('2031-03-31', 'USD', 'PEN', 3.75, 'QA fase 09');
     select platform.set_exchange_rate('2031-03-31', 'USD', 'BOB', 6.90, 'QA fase 09') $$,
  'Finanzas publica tasas QA de cierre de marzo'
);

select is(
  pg_temp.rep(5000, 'PEN', '2031-03-31'),
  '5000 PEN -> 1333.33 USD [CONVERTED]',
  'PEN 5000 conserva su valor nativo y añade su equivalente USD'
);

select is(
  pg_temp.rep(250, 'USD', '2031-03-31'),
  '250 USD -> 250.00 USD [SAME_CURRENCY]',
  'Un importe ya en la moneda de reporte no se convierte'
);

select is(
  pg_temp.rep(890, 'BOB', '2031-04-15'),
  '890 BOB -> 128.99 USD [CONVERTED]',
  'Dentro de la tolerancia configurada se usa la última tasa (se expone su fecha)'
);

select is(
  (select fx_rate_date::text || ' ' || fx_method from platform.to_reporting_amount(890, 'BOB', '2031-04-15')),
  '2031-03-31 RECIPROCAL',
  'La respuesta dice qué tasa, de qué fecha y por qué método'
);

select is(
  pg_temp.rep(890, 'BOB', '2031-06-15'),
  '890 BOB -> NULL USD [MISSING_FX]',
  'Fuera de la tolerancia: MISSING_FX, reporting NULL (ni 0 ni tasa inventada)'
);

select is(
  pg_temp.rep(890, 'BOB', '2031-03-31', 'PEN'),
  '890 BOB -> NULL PEN [MISSING_FX]',
  'Con PEN como moneda de reporte, BOB→PEN no se triangula por USD'
);

select is(
  pg_temp.rep(100, 'USD', '2031-03-31', 'PEN'),
  '100 USD -> 375.00 PEN [CONVERTED]',
  'El helper recibe fecha y moneda de reporte explícitas'
);

-- ---------------------------------------------------------------------------
-- Cambio de configuración
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select platform.set_reporting_settings('PEN', 15) $$,
  'EBIM_FINANCE cambia la moneda de reporte a PEN'
);

select is(
  pg_temp.rep(100, 'USD', '2031-03-31'),
  '100 USD -> 375.00 PEN [CONVERTED]',
  'Sin moneda explícita el helper usa la configurada, no un USD fijo'
);

select throws_like(
  $$ select platform.set_reporting_settings('COP') $$,
  'MONEDA_INACTIVA%',
  'Una moneda inactiva del catálogo no puede ser moneda de reporte'
);

select pg_temp.act_as('10000000-0000-4000-a000-000000000002');  -- product admin
select throws_ok(
  $$ select platform.set_reporting_settings('USD') $$,
  '42501', null,
  'EBIM_PRODUCT_ADMIN no cambia la moneda de reporte'
);

select pg_temp.act_as('10000000-0000-4000-a000-000000000004');  -- partner
select throws_ok(
  $$ select platform.set_reporting_settings('USD') $$,
  '42501', null,
  'Un partner no cambia la moneda de reporte'
);

select pg_temp.act_as_postgres();

select is(
  (select coalesce(sum(total), 0)::text from platform.invoices),
  current_setting('ebim.invoices_total_before'),
  'Convertir y cambiar la moneda de reporte no altera ningún importe nativo'
);

delete from platform.control_plane_settings;
select is(
  (select conversion_status from platform.to_reporting_amount(100, 'PEN', '2031-03-31')),
  'NO_REPORTING_CURRENCY',
  'Sin configuración el estado lo dice, en vez de asumir una moneda'
);

select * from finish();
rollback;
