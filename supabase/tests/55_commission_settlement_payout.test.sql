-- ============================================================================
-- V4 · Fase 13 — Liquidación y pago de comisiones (20261019000100).
-- Ciclo OPEN → APPROVED → PAID, anulación con motivo que libera eventos,
-- idempotencia, permisos, reverso tras el pago, auditoría y RLS del vendedor.
-- Fechas relativas al mes en curso (M-2, M-1, M0): un pago no puede ser futuro.
-- Comercial QA propio para que los eventos del seed no entren en los totales.
-- ============================================================================
begin;
select plan(61);

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

create or replace function pg_temp.finance() returns uuid language sql as
  $$ select '10000000-0000-4000-a000-000000000003'::uuid $$;
create or replace function pg_temp.agent() returns uuid language sql as
  $$ select '81300000-0000-4000-a000-000000000001'::uuid $$;
-- M-2 y M-1: meses cerrados anteriores; M0: el mes en curso.
create or replace function pg_temp.m(p_offset int) returns date language sql as
  $$ select (date_trunc('month', current_date) + make_interval(months => p_offset))::date $$;
create or replace function pg_temp.eom(p_offset int) returns date language sql as
  $$ select (date_trunc('month', current_date) + make_interval(months => p_offset + 1) - interval '1 day')::date $$;

-- Lecturas que deben atravesar RLS (y no la del postgres de la prueba).
create or replace function pg_temp.stl(p_id uuid) returns platform.commission_settlements
  language sql as $$ select * from platform.commission_settlements where id = p_id $$;

create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

select has_function('platform', 'approve_commission_settlement', array['uuid', 'text'],
  'approve_commission_settlement(id, nota) existe');
select has_function('platform', 'pay_commission_settlement', array['uuid', 'date', 'text', 'text', 'text'],
  'pay_commission_settlement(id, fecha, referencia, medio, nota) existe');
select has_function('platform', 'cancel_commission_settlement', array['uuid', 'text'],
  'cancel_commission_settlement(id, motivo) existe');
select ok(
  not has_function_privilege('anon', 'platform.pay_commission_settlement(uuid, date, text, text, text)', 'execute'),
  'anon no puede registrar pagos de comisiones'
);

-- ---------------------------------------------------------------------------
-- Fixture: comercial QA (plan independiente: 10% licencia), contrato USD y
-- tres cobros confirmados (M-2 ×2, M-1 ×1). El trigger devenga las comisiones.
-- ---------------------------------------------------------------------------
insert into platform.sales_agents (id, code, full_name, agent_type, contact_email)
values (pg_temp.agent(), 'qa-liquidaciones', 'QA Liquidaciones', 'INDEPENDENT', 'qa.liquidaciones@ebim.test');

insert into platform.subscriptions (id, code, billed_organization_id, saas_product_id, plan_id, market_id, billing_interval, currency)
values ('7a300000-0000-4000-a000-000000000001', 'SUB-QA-STL-USD', '30000000-0000-4000-a000-000000000004',
        '20000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001', platform.market_id_by_code('EC'), 'MONTHLY', 'USD');

insert into platform.sales_attributions (sales_agent_id, saas_product_id, subscription_id, customer_organization_id,
                                         attribution_pct, commission_plan_id, valid_from)
values (pg_temp.agent(), '20000000-0000-4000-a000-000000000001', '7a300000-0000-4000-a000-000000000001',
        '30000000-0000-4000-a000-000000000004', 1, '90000000-0000-4000-a000-000000000001', pg_temp.m(-3));

insert into platform.invoices (id, number, customer_organization_id, subscription_id, status, issue_date)
values ('7b300000-0000-4000-a000-000000000001', 'INV-QA-STL-1', '30000000-0000-4000-a000-000000000004', '7a300000-0000-4000-a000-000000000001', 'ISSUED', pg_temp.m(-2)),
       ('7b300000-0000-4000-a000-000000000002', 'INV-QA-STL-2', '30000000-0000-4000-a000-000000000004', '7a300000-0000-4000-a000-000000000001', 'ISSUED', pg_temp.m(-2)),
       ('7b300000-0000-4000-a000-000000000003', 'INV-QA-STL-3', '30000000-0000-4000-a000-000000000004', '7a300000-0000-4000-a000-000000000001', 'ISSUED', pg_temp.m(-1));

insert into platform.invoice_lines (invoice_id, charge_kind, description, saas_product_id, unit_amount)
values ('7b300000-0000-4000-a000-000000000001', 'LICENSE', 'Licencia 1', '20000000-0000-4000-a000-000000000001', 1000),
       ('7b300000-0000-4000-a000-000000000002', 'LICENSE', 'Licencia 2', '20000000-0000-4000-a000-000000000001', 500),
       ('7b300000-0000-4000-a000-000000000003', 'LICENSE', 'Licencia 3', '20000000-0000-4000-a000-000000000001', 200);

insert into platform.payments (id, invoice_id, reference, status, amount, paid_at)
values ('7f300000-0000-4000-a000-000000000001', '7b300000-0000-4000-a000-000000000001', 'PAY-QA-STL-1', 'CONFIRMED', 1000, pg_temp.m(-2) + 9),
       ('7f300000-0000-4000-a000-000000000002', '7b300000-0000-4000-a000-000000000002', 'PAY-QA-STL-2', 'CONFIRMED', 500, pg_temp.m(-2) + 19),
       ('7f300000-0000-4000-a000-000000000003', '7b300000-0000-4000-a000-000000000003', 'PAY-QA-STL-3', 'CONFIRMED', 200, pg_temp.m(-1) + 9);

select is(
  (select string_agg(e.currency || ' ' || e.amount || ' ' || e.status, ', ' order by e.earned_on)
     from platform.commission_events e where e.sales_agent_id = pg_temp.agent()),
  'USD 100.00 ELIGIBLE, USD 50.00 ELIGIBLE, USD 20.00 ELIGIBLE',
  'Tres cobros confirmados devengan tres comisiones ELEGIBLES'
);

-- ---------------------------------------------------------------------------
-- Generar (finanzas) y permisos
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.finance());
insert into ids values ('m2', platform.settle_commissions(pg_temp.agent(), pg_temp.m(-2), pg_temp.eom(-2), 'USD'));

select is(
  (select s.status || ' ' || s.currency || ' ' || s.total_amount from pg_temp.stl((select id from ids where k = 'm2')) s),
  'OPEN USD 150.00',
  'settle_commissions agrupa los eventos de M-2 en una liquidación OPEN de USD 150.00'
);

select throws_like(
  format($$ select platform.pay_commission_settlement(%L, current_date, 'TRF-1', 'BANK_TRANSFER') $$,
         (select id from ids where k = 'm2')),
  'LIQUIDACION_NO_APROBADA%',
  'No se paga una liquidación sin aprobar'
);

select pg_temp.act_as('10000000-0000-4000-a000-000000000008');  -- Carla, comercial
select throws_ok(
  format($$ select platform.approve_commission_settlement(%L) $$, (select id from ids where k = 'm2')),
  '42501', null, 'Un comercial no aprueba liquidaciones'
);

select pg_temp.act_as('10000000-0000-4000-a000-000000000005');  -- Beto, ventas de partner
select throws_ok(
  format($$ select platform.cancel_commission_settlement(%L, 'x') $$, (select id from ids where k = 'm2')),
  '42501', null, 'Ventas de partner no anula liquidaciones'
);

select pg_temp.act_as('10000000-0000-4000-a000-000000000002');  -- product admin
select throws_ok(
  format($$ select platform.approve_commission_settlement(%L) $$, (select id from ids where k = 'm2')),
  '42501', null, 'EBIM_PRODUCT_ADMIN no aprueba liquidaciones'
);
select throws_ok(
  format($$ select platform.pay_commission_settlement(%L, current_date, 'TRF-1', 'BANK_TRANSFER') $$,
         (select id from ids where k = 'm2')),
  '42501', null, 'EBIM_PRODUCT_ADMIN no registra pagos de comisiones'
);

select pg_temp.act_as(pg_temp.finance());
select throws_ok(
  format($$ update platform.commission_settlements set status = 'PAID' where id = %L $$, (select id from ids where k = 'm2')),
  '42501', null, 'Ni finanzas cambia el estado escribiendo la tabla: solo por RPC'
);

-- ---------------------------------------------------------------------------
-- Aprobar
-- ---------------------------------------------------------------------------
select is(
  platform.approve_commission_settlement((select id from ids where k = 'm2'), '  Revisada  ') ->> 'status',
  'APPROVED',
  'Finanzas aprueba la liquidación OPEN'
);

select is(
  (select s.approved_by::text || ' ' || (s.approved_at is not null)::text || ' ' || s.approval_note
     from pg_temp.stl((select id from ids where k = 'm2')) s),
  pg_temp.finance()::text || ' true Revisada',
  'La aprobación guarda quién, cuándo y la nota'
);

select is(
  (platform.approve_commission_settlement((select id from ids where k = 'm2')) ->> 'already_approved')::boolean,
  true,
  'Aprobar dos veces es idempotente'
);

select is(
  (select count(*)::int from platform.audit_logs
    where action = 'COMMISSION_SETTLEMENT_APPROVED' and entity_id = (select id::text from ids where k = 'm2')),
  1,
  'La segunda aprobación no duplica la auditoría'
);

select throws_like(
  $$ select platform.settle_commissions(pg_temp.agent(), pg_temp.m(-2), pg_temp.eom(-2), 'USD') $$,
  'LIQUIDACION_CERRADA%',
  'Una liquidación aprobada no recibe eventos nuevos'
);

select pg_temp.act_as_postgres();
select throws_like(
  format($$ update platform.commission_events set settlement_id = null where settlement_id = %L $$,
         (select id from ids where k = 'm2')),
  'LIQUIDACION_APROBADA%',
  'Los eventos de una liquidación aprobada no se liberan sin anularla'
);

-- ---------------------------------------------------------------------------
-- Pagar: validaciones
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.finance());
select throws_like(
  format($$ select platform.pay_commission_settlement(%L, current_date, '  ', 'BANK_TRANSFER') $$, (select id from ids where k = 'm2')),
  'REFERENCIA_REQUERIDA%', 'El pago exige referencia'
);
select throws_like(
  format($$ select platform.pay_commission_settlement(%L, current_date, 'TRF-1', null) $$, (select id from ids where k = 'm2')),
  'MEDIO_REQUERIDO%', 'El pago exige medio'
);
select throws_like(
  format($$ select platform.pay_commission_settlement(%L, current_date, 'TRF-1', 'BITCOIN') $$, (select id from ids where k = 'm2')),
  'MEDIO_INVALIDO%', 'El medio debe ser uno de los admitidos'
);
select throws_like(
  format($$ select platform.pay_commission_settlement(%L, current_date + 1, 'TRF-1', 'BANK_TRANSFER') $$, (select id from ids where k = 'm2')),
  'FECHA_FUTURA%', 'No se registra un pago con fecha futura'
);
select throws_like(
  format($$ select platform.pay_commission_settlement(%L, pg_temp.m(-2) - 1, 'TRF-1', 'BANK_TRANSFER') $$, (select id from ids where k = 'm2')),
  'FECHA_INVALIDA%', 'No se registra un pago anterior al período liquidado'
);

-- ---------------------------------------------------------------------------
-- Pagar
-- ---------------------------------------------------------------------------
select is(
  platform.pay_commission_settlement((select id from ids where k = 'm2'), pg_temp.m(-1) + 4, ' TRF-QA-001 ', 'bank_transfer', 'Pago trimestral')
    ->> 'status',
  'PAID',
  'Finanzas registra el pago de la liquidación aprobada'
);

select is(
  (select s.status || ' ' || s.total_amount || ' ' || s.payment_reference || ' ' || s.payment_method || ' '
          || s.paid_by::text || ' ' || (s.paid_at at time zone 'America/Lima')::date::text || ' ' || s.payment_note
     from pg_temp.stl((select id from ids where k = 'm2')) s),
  'PAID 150.00 TRF-QA-001 BANK_TRANSFER ' || pg_temp.finance()::text || ' ' || (pg_temp.m(-1) + 4)::text || ' Pago trimestral',
  'El pago guarda referencia, medio, quién y la fecha indicada (sin correrse de día en Lima)'
);

select is(
  (select string_agg(distinct e.status::text, ',') from platform.commission_events e
    where e.settlement_id = (select id from ids where k = 'm2')),
  'PAID',
  'Los eventos de la liquidación pagada quedan PAID'
);

select is(
  (platform.pay_commission_settlement((select id from ids where k = 'm2'), pg_temp.m(-1) + 4, 'TRF-QA-001', 'BANK_TRANSFER')
    ->> 'already_paid')::boolean,
  true,
  'Repetir el mismo pago (misma referencia) es idempotente'
);

select throws_like(
  format($$ select platform.pay_commission_settlement(%L, current_date, 'TRF-QA-002', 'BANK_TRANSFER') $$, (select id from ids where k = 'm2')),
  'LIQUIDACION_YA_PAGADA%',
  'No se paga dos veces: otra referencia sobre una liquidación pagada se rechaza'
);

select is(
  (select count(*)::int from platform.audit_logs
    where action = 'COMMISSION_SETTLEMENT_PAID' and entity_id = (select id::text from ids where k = 'm2')
      and actor_user_id = pg_temp.finance()
      and metadata ->> 'reference' = 'TRF-QA-001' and metadata ->> 'method' = 'BANK_TRANSFER'),
  1,
  'El pago queda auditado una sola vez, con actor, referencia y medio'
);

select throws_like(
  format($$ select platform.cancel_commission_settlement(%L, 'error') $$, (select id from ids where k = 'm2')),
  'LIQUIDACION_YA_PAGADA%',
  'Una liquidación pagada no se anula'
);
select throws_like(
  format($$ select platform.approve_commission_settlement(%L) $$, (select id from ids where k = 'm2')),
  'LIQUIDACION_YA_PAGADA%',
  'Una liquidación pagada no se vuelve a aprobar'
);

select pg_temp.act_as_postgres();
select throws_like(
  format($$ update platform.commission_settlements set status = 'OPEN' where id = %L $$, (select id from ids where k = 'm2')),
  'LIQUIDACION_CERRADA%',
  'PAID es terminal también para escrituras directas'
);
select throws_like(
  format($$ update platform.commission_events set amount = 1 where settlement_id = %L and amount = 100 $$, (select id from ids where k = 'm2')),
  'EVENTO_LIQUIDADO%',
  'Un evento de una liquidación pagada no cambia de importe'
);
select throws_like(
  format($$ insert into platform.commission_events (sales_agent_id, sales_attribution_id, commission_rule_id, payment_id,
              invoice_line_id, saas_product_id, settlement_id, base_amount, applied_rate, attribution_pct, amount, currency, earned_on)
            select sales_agent_id, sales_attribution_id, commission_rule_id, payment_id, null, saas_product_id, %L,
                   1, 0.1, 1, 0.1, currency, earned_on
              from platform.commission_events where settlement_id = %L limit 1 $$,
         (select id from ids where k = 'm2'), (select id from ids where k = 'm2')),
  'LIQUIDACION_CERRADA%',
  'Ningún evento entra en una liquidación pagada'
);

-- ---------------------------------------------------------------------------
-- Reverso posterior al pago: contra-evento para la próxima liquidación
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.finance());
select lives_ok(
  $$ select platform.reverse_payment('7f300000-0000-4000-a000-000000000001', 'Contracargo QA tras el pago') $$,
  'Finanzas revierte un cobro cuya comisión ya se pagó'
);

select is(
  (select e.amount || ' ' || e.status || ' ' || coalesce(e.settlement_id::text, 'sin liquidación')
     from platform.commission_events e
    where e.payment_id = '7f300000-0000-4000-a000-000000000001' and e.reversal_of_event_id is not null),
  '-100.00 ELIGIBLE sin liquidación',
  'El reverso crea un contra-evento negativo ELEGIBLE, fuera de la liquidación pagada'
);

select is(
  (select s.status || ' ' || s.total_amount || ' ' ||
          (select count(*) from platform.commission_events e where e.settlement_id = s.id and e.status = 'PAID')
     from pg_temp.stl((select id from ids where k = 'm2')) s),
  'PAID 150.00 2',
  'La liquidación pagada no se reescribe: mismo total y sus dos eventos siguen PAID'
);

insert into ids values ('m0', platform.settle_commissions(pg_temp.agent(), pg_temp.m(0), current_date, 'USD'));

select is(
  (select s.status || ' ' || s.total_amount from pg_temp.stl((select id from ids where k = 'm0')) s),
  'OPEN -100.00',
  'El contra-evento entra en la próxima liquidación y la deja en negativo'
);

select throws_like(
  format($$ select platform.approve_commission_settlement(%L) $$, (select id from ids where k = 'm0')),
  'LIQUIDACION_NEGATIVA%',
  'Una liquidación con total negativo no se aprueba (no hay nada que pagar)'
);

-- ---------------------------------------------------------------------------
-- Anular: motivo obligatorio, libera eventos, código reutilizable
-- ---------------------------------------------------------------------------
select throws_like(
  format($$ select platform.cancel_commission_settlement(%L, '   ') $$, (select id from ids where k = 'm0')),
  'MOTIVO_REQUERIDO%',
  'Anular exige motivo'
);

select is(
  (platform.cancel_commission_settlement((select id from ids where k = 'm0'), 'Netear con el próximo mes') ->> 'events_released')::int,
  1,
  'Anular una liquidación OPEN libera su evento'
);

select is(
  (select s.status || ' ' || s.total_amount || ' ' || s.cancellation_reason || ' ' || s.cancelled_by::text
     from pg_temp.stl((select id from ids where k = 'm0')) s),
  'CANCELLED -100.00 Netear con el próximo mes ' || pg_temp.finance()::text,
  'La anulada conserva su total, el motivo y quién la anuló'
);

select is(
  (select e.status || ' ' || coalesce(e.settlement_id::text, 'libre') from platform.commission_events e
    where e.payment_id = '7f300000-0000-4000-a000-000000000001' and e.reversal_of_event_id is not null),
  'ELIGIBLE libre',
  'El contra-evento vuelve a ELEGIBLE y sin liquidación'
);

select is(
  (platform.cancel_commission_settlement((select id from ids where k = 'm0'), 'otra vez') ->> 'already_cancelled')::boolean,
  true,
  'Anular dos veces es idempotente'
);

select throws_like(
  format($$ select platform.approve_commission_settlement(%L) $$, (select id from ids where k = 'm0')),
  'LIQUIDACION_ANULADA%', 'Una anulada no se aprueba'
);
select throws_like(
  format($$ select platform.pay_commission_settlement(%L, current_date, 'TRF-X', 'CASH') $$, (select id from ids where k = 'm0')),
  'LIQUIDACION_ANULADA%', 'Una anulada no se paga'
);

select pg_temp.act_as_postgres();
select throws_like(
  format($$ update platform.commission_settlements set cancellation_reason = 'otro' where id = %L $$, (select id from ids where k = 'm0')),
  'LIQUIDACION_CERRADA%',
  'CANCELLED es terminal: ni el motivo se reescribe'
);

select pg_temp.act_as(pg_temp.finance());
insert into ids values ('m0b', platform.settle_commissions(pg_temp.agent(), pg_temp.m(0), current_date, 'USD'));

select is(
  (select count(*)::text || ' ' || string_agg(s.status::text, ',' order by s.status)
     from platform.commission_settlements s
    where s.code = (select code from platform.commission_settlements where id = (select id from ids where k = 'm0'))),
  '2 OPEN,CANCELLED',
  'El mismo período se vuelve a liquidar con el mismo código: la anulada queda como historia'
);

select is(
  (select e.settlement_id from platform.commission_events e
    where e.payment_id = '7f300000-0000-4000-a000-000000000001' and e.reversal_of_event_id is not null),
  (select id from ids where k = 'm0b'),
  'El evento liberado entra en la nueva liquidación'
);

-- APPROVED → CANCELLED también libera.
insert into ids values ('m1', platform.settle_commissions(pg_temp.agent(), pg_temp.m(-1), pg_temp.eom(-1), 'USD'));
select platform.approve_commission_settlement((select id from ids where k = 'm1'));

select is(
  (platform.cancel_commission_settlement((select id from ids where k = 'm1'), 'Importe en revisión') ->> 'events_released')::int,
  1,
  'Una liquidación aprobada también se anula con motivo y libera su evento'
);

select is(
  (select e.status::text || ' ' || coalesce(e.settlement_id::text, 'libre') from platform.commission_events e
    where e.payment_id = '7f300000-0000-4000-a000-000000000003'),
  'ELIGIBLE libre',
  'El evento de la aprobada anulada vuelve a ELEGIBLE'
);

select is(
  (select metadata ->> 'previous_status' || ' ' || (metadata ->> 'events') || ' ' || (metadata ->> 'reason')
     from platform.audit_logs
    where action = 'COMMISSION_SETTLEMENT_CANCELLED' and entity_id = (select id::text from ids where k = 'm1')),
  'APPROVED 1 Importe en revisión',
  'La anulación queda auditada con el estado previo, los eventos liberados y el motivo'
);

insert into ids values ('m1b', platform.settle_commissions(pg_temp.agent(), pg_temp.m(-1), pg_temp.eom(-1), 'USD'));

-- ---------------------------------------------------------------------------
-- Un evento no está en dos liquidaciones vivas
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select throws_like(
  format($$ update platform.commission_events set settlement_id = %L
             where payment_id = '7f300000-0000-4000-a000-000000000003' $$, (select id from ids where k = 'm0b')),
  'EVENTO_YA_LIQUIDADO%',
  'Mover un evento de una liquidación abierta a otra se rechaza'
);

-- ---------------------------------------------------------------------------
-- Liquidación vacía
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.finance());
insert into ids values ('empty', platform.settle_commissions(pg_temp.agent(), '2020-01-01', '2020-01-31', 'USD'));
select throws_like(
  format($$ select platform.approve_commission_settlement(%L) $$, (select id from ids where k = 'empty')),
  'LIQUIDACION_VACIA%',
  'Una liquidación sin eventos no se aprueba'
);

-- ---------------------------------------------------------------------------
-- RLS: el vendedor ve solo sus liquidaciones
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000008');  -- Carla
select is(
  (select count(*)::int from platform.commission_settlements where sales_agent_id = pg_temp.agent()),
  0,
  'Carla no ve las liquidaciones de otro comercial'
);
select ok(
  (select count(*) from platform.commission_settlements) > 0
  and not exists (select 1 from platform.commission_settlements
                   where sales_agent_id <> '80000000-0000-4000-a000-000000000001'),
  'Carla ve sus liquidaciones y solo las suyas'
);

select pg_temp.act_as('10000000-0000-4000-a000-000000000005');  -- Beto
select is(
  (select count(*)::int from platform.commission_settlements
    where sales_agent_id in ('80000000-0000-4000-a000-000000000001', pg_temp.agent())),
  0,
  'Beto (ventas de partner) no ve liquidaciones ajenas'
);

select pg_temp.act_as(pg_temp.finance());
select ok(
  (select count(*) from platform.commission_settlements where sales_agent_id = pg_temp.agent()) = 6,
  'Finanzas ve todas las liquidaciones (incluidas las anuladas)'
);

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select col_not_null('platform', 'commission_settlements', 'status', 'status sigue NOT NULL');
select has_column('platform', 'commission_settlements', 'cancellation_reason', 'La liquidación guarda el motivo de anulación');
select ok(
  (select bool_and(p.prosecdef and 'search_path=platform, pg_catalog' = any(p.proconfig))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform'
      and p.proname in ('approve_commission_settlement', 'pay_commission_settlement', 'cancel_commission_settlement')),
  'Las tres RPCs son SECURITY DEFINER con search_path fijo'
);

select * from finish();
rollback;
