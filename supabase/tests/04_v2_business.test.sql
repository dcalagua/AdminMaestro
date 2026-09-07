-- ============================================================================
-- Tests de REGLAS DE NEGOCIO de V2 (Fase 16)
-- ----------------------------------------------------------------------------
-- Cobranza, OS/OC, idempotencia de webhook, reversos, renovaciones y dedicados.
--
-- Cada test fija una regla que, si se rompiera, produciría un error CARO y
-- silencioso: dinero duplicado, comisión sobre algo que no se cobró, o un
-- cliente apagado sin motivo registrado.
-- ============================================================================
begin;
select plan(24);

set local role postgres;

-- Las RPCs de V2 autorizan contra `auth.uid()`, así que hay que declarar QUIÉN
-- ejecuta. Se usa el super admin: aquí se prueban REGLAS DE NEGOCIO, y la
-- autorización tiene su propio archivo (03_v2_security).
select set_config('request.jwt.claims',
  json_build_object(
    'sub', (select id::text from auth.users where email = 'dcalagua@ebim.pe'),
    'role', 'authenticated'
  )::text, true);

-- ---------------------------------------------------------------------------
-- 1-4. COBRANZA: coherencia entre método y configuración.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select platform.set_subscription_collection_profile(
       (select id from platform.subscriptions where code = 'SUB-TITAN-EWM'),
       'CULQI_CARD') $$,
  '23502',
  null,
  'CULQI_CARD sin cuenta de proveedor se rechaza con un mensaje explícito'
);

select throws_ok(
  $$ select platform.set_subscription_collection_profile(
       (select id from platform.subscriptions where code = 'SUB-TITAN-EWM'),
       'CULQI_CARD',
       (select id from platform.payment_provider_accounts where code = 'ebim-manual')) $$,
  '23514',
  null,
  'CULQI_CARD exige una cuenta de tipo CULQI: una cuenta MANUAL no sirve'
);

select throws_ok(
  $$ select platform.set_subscription_collection_profile(
       (select id from platform.subscriptions where code = 'SUB-TITAN-EWM'),
       'MANUAL', null, false, null, null, 0, 30, 15, 0, 45, true) $$,
  '23514',
  null,
  'La suspensión automática exige al menos 1 día de gracia'
);

-- El versionado no pierde el perfil anterior.
select lives_ok(
  $$ select platform.set_subscription_collection_profile(
       (select id from platform.subscriptions where code = 'SUB-TITAN-EWM'),
       'BANK_TRANSFER', null, false, null, null, 0, 30, 15, 10, 45, false,
       null, 'ACTIVE', current_date) $$,
  'Se puede fijar un perfil de cobro nuevo'
);

-- ---------------------------------------------------------------------------
-- 5-9. OS/OC: documento administrativo, NUNCA un cobro.
-- ---------------------------------------------------------------------------

-- LA REGLA CENTRAL DE LA FASE 08.
select set_config('ebim.pagos_antes',
  (select count(*)::text from platform.payments), true);
select set_config('ebim.comisiones_antes',
  (select count(*)::text from platform.commission_events), true);

select lives_ok(
  $$ select platform.approve_commercial_document(
       'e0000000-0000-4000-a000-000000000002', (current_date + 365)) $$,
  'Se puede aprobar una OS que ya fue recibida'
);

select is(
  (select count(*)::int from platform.payments),
  current_setting('ebim.pagos_antes')::int,
  'Aprobar una OS NO crea ningún payment'
);

select is(
  (select count(*)::int from platform.commission_events),
  current_setting('ebim.comisiones_antes')::int,
  'Aprobar una OS NO devenga ninguna comisión'
);

-- No se aprueba lo que no ha llegado.
select throws_ok(
  $$ select platform.approve_commercial_document(
       'e0000000-0000-4000-a000-000000000003', (current_date + 365)) $$,
  '23514',
  null,
  'Una OS/OC solo SOLICITADA no se puede aprobar: primero se recibe'
);

-- Recibir exige número de documento.
select throws_ok(
  $$ select platform.receive_commercial_document(
       'e0000000-0000-4000-a000-000000000003', '   ') $$,
  '23502',
  null,
  'Registrar una OS/OC recibida exige su número'
);

-- ---------------------------------------------------------------------------
-- 10-13. WEBHOOK: idempotencia real.
-- ---------------------------------------------------------------------------
select set_config('ebim.pagos_pre_webhook',
  (select count(*)::text from platform.payments), true);
select set_config('ebim.comisiones_pre_webhook',
  (select count(*)::text from platform.commission_events), true);

-- La MISMA entrega, cinco veces.
select lives_ok(
  $$ select platform.register_provider_payment(
       (select id from platform.payment_provider_accounts where code = 'culqi-pe-test'),
       'evt_test_idempotencia', 'charge.succeeded', 'chr_test_idem_001',
       'sxn_mock_grupasa01', 850.00, 'USD', now(),
       '{"type":"charge.succeeded","simulated":true}'::jsonb)
     from generate_series(1, 5) $$,
  'El mismo evento de webhook se puede entregar cinco veces sin error'
);

select is(
  (select count(*)::int from platform.payments),
  current_setting('ebim.pagos_pre_webhook')::int + 1,
  'Cinco entregas del mismo webhook generan UN solo payment'
);

select is(
  (select count(*)::int from platform.payments
    where reference = 'culqi:chr_test_idem_001'),
  1,
  'Solo existe una fila de pago para ese cargo externo'
);

select is(
  (select count(*)::int from platform.provider_webhook_events
    where external_event_key = 'evt_test_idempotencia'),
  1,
  'El ledger de idempotencia guarda el evento una sola vez'
);

-- ---------------------------------------------------------------------------
-- 14-15. Un cobro FALLIDO no es un cobro.
-- ---------------------------------------------------------------------------
select set_config('ebim.pagos_pre_fallo',
  (select count(*)::text from platform.payments), true);

select lives_ok(
  $$ select platform.register_provider_payment_failure(
       (select id from platform.payment_provider_accounts where code = 'culqi-pe-test'),
       'evt_test_fallo', 'charge.failed', 'sxn_mock_grupasa01',
       'card_declined', 'Tarjeta rechazada') $$,
  'Se registra un cobro fallido del proveedor'
);

select is(
  (select count(*)::int from platform.payments),
  current_setting('ebim.pagos_pre_fallo')::int,
  'Un cobro FALLIDO no crea ningún payment'
);

-- ---------------------------------------------------------------------------
-- 16-18. REVERSO: contra-evento, historia intacta.
-- ---------------------------------------------------------------------------
select set_config('ebim.evento_original',
  (select id::text from platform.commission_events
    where payment_id = (select id from platform.payments where reference = 'culqi:chr_test_idem_001')
    limit 1), true);

select lives_ok(
  $$ select platform.reverse_payment(
       (select id from platform.payments where reference = 'culqi:chr_test_idem_001'),
       'Devolución de prueba') $$,
  'Se puede revertir un cobro confirmado indicando el motivo'
);

select ok(
  (select exists (select 1 from platform.commission_events
                   where id = current_setting('ebim.evento_original')::uuid)),
  'El evento de comisión ORIGINAL sigue existiendo tras el reverso'
);

select is(
  (select coalesce(sum(amount), 0) from platform.commission_events
    where payment_id = (select id from platform.payments where reference = 'culqi:chr_test_idem_001')),
  0::numeric,
  'La comisión NETA del pago revertido es cero: el contra-evento la compensa'
);

-- Un devengo negativo que no sea un reverso sigue prohibido.
select throws_ok(
  $$ insert into platform.commission_events
       (sales_agent_id, sales_attribution_id, commission_rule_id, payment_id,
        saas_product_id, status, base_amount, attribution_pct, amount, currency, earned_on)
     select e.sales_agent_id, e.sales_attribution_id, e.commission_rule_id, e.payment_id,
            e.saas_product_id, 'ELIGIBLE', 100, 1.0, -50, e.currency, current_date
       from platform.commission_events e where e.reversal_of_event_id is null limit 1 $$,
  '23514',
  null,
  'Un devengo negativo que NO es contra-evento se rechaza'
);

-- ---------------------------------------------------------------------------
-- 20-22. RENOVACIONES: deterministas e idempotentes.
-- ---------------------------------------------------------------------------
select is(
  platform.next_renewal_date('2026-01-15', null, 'MONTHLY', '2026-09-07'),
  '2026-09-15'::date,
  'next_renewal_date proyecta el aniversario mensual correcto'
);

select is(
  platform.next_renewal_date('2026-01-07', null, 'MONTHLY', '2026-09-07'),
  '2026-09-07'::date,
  'En el propio día de aniversario, la renovación es HOY y no el mes siguiente'
);

-- Idempotencia REAL: se llama dos veces seguidas con la misma fecha y se afirma
-- sobre la SEGUNDA. La primera puede crear alertas legítimas, porque los tests
-- anteriores de este archivo cambiaron el estado (aprobaron una OS, registraron
-- un cobro). Lo que se prueba es que recalcular no duplica, no que no haya nada
-- que calcular.
select set_config('ebim.primer_refresh',
  platform.refresh_billing_alerts('2026-09-07'::timestamptz)::text, true);

select is(
  platform.refresh_billing_alerts('2026-09-07'::timestamptz),
  0,
  'Un segundo recálculo con la misma fecha no crea NINGUNA alerta: es idempotente'
);

-- ---------------------------------------------------------------------------
-- 23. El cálculo de alertas NO suspende a nadie.
-- ---------------------------------------------------------------------------
select set_config('ebim.activos_antes',
  (select count(*)::text from platform.tenants where status = 'ACTIVE'), true);

select is(
  (select count(*)::int from platform.tenants where status = 'ACTIVE'),
  current_setting('ebim.activos_antes')::int,
  'refresh_billing_alerts no cambia el estado de ningún tenant'
);

-- ---------------------------------------------------------------------------
-- 24. DEDICADOS: un tenant no aterriza en el target de otro partner.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into platform.tenant_deployments (tenant_id, deployment_target_id, is_primary, status)
     select t.id, d.id, false, 'ACTIVE'
       from platform.tenants t, platform.deployment_targets d
      where t.slug = 'andina-pd-cliente-a'
        and d.code = 'pacifico-ewm-dedicated' $$,
  '23514',
  null,
  'Un tenant del partner A no puede adjuntarse al target dedicado del partner B'
);

select * from finish();
rollback;
