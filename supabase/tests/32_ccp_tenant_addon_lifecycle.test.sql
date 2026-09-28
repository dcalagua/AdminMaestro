-- ============================================================================
-- EBIM Commercial Control Plane · Fase 07 · subscription_items por origen y
-- ciclo de vida de add-ons de tenant (Tasks MA-15, MA-16)
-- ----------------------------------------------------------------------------
-- Spec §3.2 (subscription_items: source_type, tenant_addon_id, price_ref),
-- §5.4-5.5 (precio congelado, TARIFA_ADDON_NO_DEFINIDA), §6.2 (ciclo de vida),
-- §10 (downgrade/revocación), §14.1 (autoridad). Todo se revierte (rollback).
-- ============================================================================
begin;
select plan(7);

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

select * from finish();
rollback;
