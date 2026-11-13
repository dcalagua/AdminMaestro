-- ============================================================================
-- Correo del Admin Maestro por MailHub (20261022000100)
--   · forma, RLS forzada y privilegios (secret_variables fuera del alcance de la consola);
--   · los eventos reales encolan una fila idempotente con sus variables;
--   · canal servidor: tomar lote, enlace de pago idempotente, resultado, callback deduplicado;
--   · consola: prueba solo a EBIM, reenviar/cancelar con motivo, destinatarios internos;
--   · job MAIL_DISPATCH sin secretos de Vault no hace nada.
-- Los triggers son diferidos: aquí se fuerzan con SET CONSTRAINTS ALL IMMEDIATE.
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

create or replace function pg_temp.superadmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.finance() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000003'::uuid $$;
create or replace function pg_temp.alpha_admin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000009'::uuid $$;
create or replace function pg_temp.alpha_org() returns uuid language sql as $$ select '30000000-0000-4000-a000-000000000004'::uuid $$;
create or replace function pg_temp.alpha_tenant() returns uuid language sql as $$ select '50000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.esup() returns uuid language sql as $$ select '20000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.mail(p_key text) returns platform.mail_outbox language sql as $$
  select * from platform.mail_outbox where idempotency_key = p_key
$$;

set constraints all immediate;

-- ---------------------------------------------------------------------------
-- Forma y privilegios
-- ---------------------------------------------------------------------------
select ok((select relforcerowsecurity from pg_class where oid = 'platform.mail_outbox'::regclass), 'mail_outbox: RLS forzada');
select ok((select relforcerowsecurity from pg_class where oid = 'platform.mail_events'::regclass), 'mail_events: RLS forzada');
select ok((select relforcerowsecurity from pg_class where oid = 'platform.mail_settings'::regclass), 'mail_settings: RLS forzada');
select ok(not has_column_privilege('authenticated', 'platform.mail_outbox', 'secret_variables', 'select'),
  'la consola no puede leer secret_variables');
select ok(has_column_privilege('authenticated', 'platform.mail_outbox', 'recipient_email', 'select'),
  'la consola sí lee el destinatario (la RLS decide las filas)');
select ok(not has_table_privilege('authenticated', 'platform.mail_outbox', 'insert')
          and not has_table_privilege('authenticated', 'platform.mail_outbox', 'update'),
  'la consola no escribe en la tabla: solo por funciones');
select is(
  (select string_agg(f, ',' order by f) from unnest(array[
     'platform.mail_claim_batch(integer)', 'platform.mail_payment_link(uuid)',
     'platform.mail_mark_result(uuid,text,text,text,text,text,integer,text,text)',
     'platform.mail_record_auth(text,text,text,text,jsonb,text,text,text,text,text,text)',
     'platform.mail_apply_event(text,text,text,text,text,timestamptz,jsonb)'
   ]) f where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')),
  null, 'canal servidor: ni anon ni authenticated');
select ok(has_function_privilege('service_role', 'platform.mail_claim_batch(integer)', 'execute'), 'service_role toma lotes');
select is(
  (select string_agg(f, ',' order by f) from unnest(array[
     'platform._mail_enqueue(text,text,text,text,text,jsonb,text,uuid,uuid,uuid,uuid,text,boolean)',
     'platform._mail_kick()', 'platform._mail_ops(text,text,text,integer,text,text,uuid)'
   ]) f where has_function_privilege('service_role', f, 'execute') or has_function_privilege('authenticated', f, 'execute')),
  null, 'internos: nadie los llama desde fuera');
select ok(not has_function_privilege('anon', 'platform.mail_send_test(text,text)', 'execute'), 'anon no envía pruebas');

-- ---------------------------------------------------------------------------
-- Eventos de negocio
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();

-- Pago confirmado sobre una factura emitida → recibo.
insert into platform.payments (id, invoice_id, reference, status, amount, currency, paid_at, method)
select 'abababab-0000-4000-a000-000000000001', i.id, 'culqi:chr_test_mail', 'CONFIRMED', 1200, 'USD', now(), 'CULQI_CARD'
  from platform.invoices i where i.number = 'INV-202611-0026';
select is((pg_temp.mail('payment-confirmed-abababab-0000-4000-a000-000000000001')).event_type, 'PAYMENT_CONFIRMED',
  'pago CONFIRMED → PAYMENT_CONFIRMED');
select is((pg_temp.mail('payment-confirmed-abababab-0000-4000-a000-000000000001')).variables ->> 'saldo', 'USD 0.00',
  'el recibo ve la factura ya pagada (trigger diferido)');
select is((pg_temp.mail('payment-confirmed-abababab-0000-4000-a000-000000000001')).variables ->> 'referencia', 'chr_test_mail',
  'referencia sin el prefijo del proveedor');
select is((pg_temp.mail('payment-confirmed-abababab-0000-4000-a000-000000000001')).recipient_email, 'pagos@alpha.ebim.test',
  'va al correo de facturación de la organización');
update platform.payments set status = 'CONFIRMED' where id = 'abababab-0000-4000-a000-000000000001';
select is((select count(*)::int from platform.mail_outbox where payment_id = 'abababab-0000-4000-a000-000000000001'), 1,
  'idempotente: un mismo pago no encola dos recibos');

-- Factura emitida (con total) → con portal de pago; una sin total, nada.
insert into platform.invoices (id, number, customer_organization_id, status, currency, issue_date, due_date, total, subtotal)
values ('abababab-0000-4000-a000-0000000000a1', 'INV-TEST-MAIL-1', pg_temp.alpha_org(), 'ISSUED', 'USD', current_date, current_date + 15, 350, 350),
       ('abababab-0000-4000-a000-0000000000a2', 'INV-TEST-MAIL-0', pg_temp.alpha_org(), 'ISSUED', 'USD', current_date, current_date + 15, 0, 0);
select ok((pg_temp.mail('invoice-issued-abababab-0000-4000-a000-0000000000a1')).needs_payment_link,
  'factura emitida → INVOICE_ISSUED con portal de pago');
select is((pg_temp.mail('invoice-issued-abababab-0000-4000-a000-0000000000a1')).variables ->> 'monto', 'USD 350.00', 'monto con moneda');
select ok(pg_temp.mail('invoice-issued-abababab-0000-4000-a000-0000000000a2') is null, 'factura en cero: sin correo');

-- Tenant PENDING → ACTIVE → bienvenida al administrador del cliente.
insert into platform.tenants (id, slug, name, saas_product_id, customer_organization_id, admin_email, status)
values ('abababab-0000-4000-a000-0000000000b1', 'mail-test', 'Prueba Correo · eSupplier', pg_temp.esup(), pg_temp.alpha_org(),
        'jefe@cliente-real.com', 'PENDING');
update platform.tenants set status = 'ACTIVE', activated_at = now() where id = 'abababab-0000-4000-a000-0000000000b1';
select is((pg_temp.mail('tenant-activated-abababab-0000-4000-a000-0000000000b1')).recipient_email, 'jefe@cliente-real.com',
  'PENDING → ACTIVE → bienvenida al admin_email');
select is((pg_temp.mail('tenant-activated-abababab-0000-4000-a000-0000000000b1')).variables ->> 'app', 'eSupplier by EBIM',
  'con el nombre de la app');

-- Suspensión por impago y su levantamiento.
insert into platform.tenant_suspensions (id, tenant_id, cause, reason)
values ('abababab-0000-4000-a000-0000000000c1', pg_temp.alpha_tenant(), 'NON_PAYMENT', 'Facturas vencidas fuera de gracia');
select ok((pg_temp.mail('tenant-suspended-abababab-0000-4000-a000-0000000000c1')).needs_payment_link,
  'suspensión NON_PAYMENT → TENANT_SUSPENDED con portal de pago');
update platform.tenant_suspensions set resumed_at = now(), resume_cause = 'PAYMENT', resume_reason = 'Pagó'
 where id = 'abababab-0000-4000-a000-0000000000c1';
select is((pg_temp.mail('tenant-reactivated-abababab-0000-4000-a000-0000000000c1')).event_type, 'TENANT_REACTIVATED',
  'levantar la suspensión → TENANT_REACTIVATED');
insert into platform.tenant_suspensions (id, tenant_id, cause, reason)
values ('abababab-0000-4000-a000-0000000000c2', '50000000-0000-4000-a000-000000000002', 'MANUAL', 'Pedido del cliente');
select ok(pg_temp.mail('tenant-suspended-abababab-0000-4000-a000-0000000000c2') is null, 'una suspensión MANUAL no avisa de impago');

-- ---------------------------------------------------------------------------
-- Consola: configuración, pruebas y RLS
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.alpha_admin());
select is((select count(*)::int from platform.v_mail_outbox), 0, 'un admin de cliente no ve la bandeja');
select throws_ok($$ select platform.mail_send_test('masteradmin-acceso-invitacion', 'x@ebim.pe') $$, '42501', null,
  'un admin de cliente no envía pruebas');

select pg_temp.act_as(pg_temp.finance());
select ok((select count(*) from platform.v_mail_outbox) > 0, 'finanzas ve la bandeja');

select pg_temp.act_as(pg_temp.superadmin());
select throws_ok($$ select platform.set_mail_settings(true, array['ops@gmail.com']) $$, '23514', null,
  'el resumen de operaciones es interno: no acepta dominios externos');
select is((platform.set_mail_settings(true, array[' Ops@EBIM.pe ', 'ops@ebim.pe'])) -> 'ops_recipients', '["ops@ebim.pe"]'::jsonb,
  'destinatarios internos normalizados y sin duplicados');
select throws_ok($$ select platform.mail_send_test('masteradmin-acceso-invitacion', 'admin@chm.com.pe') $$, '23514', null,
  'una prueba nunca va a un cliente');
select ok((platform.mail_send_test('masteradmin-pago-confirmado', 'qa@ebim.pe')) ->> 'id' is not null, 'prueba a EBIM encolada');

-- Fin de una sincronización con diferencias → resumen a operaciones.
select pg_temp.act_as_postgres();
insert into platform.tenant_sync_runs (id, trigger_kind, status) values ('abababab-0000-4000-a000-0000000000d1', 'MANUAL', 'RUNNING');
update platform.tenant_sync_runs set status = 'COMPLETED', finished_at = now(), findings_opened = 2
 where id = 'abababab-0000-4000-a000-0000000000d1';
select is((select count(*)::int from platform.mail_outbox where event_type = 'OPS_SYNC_DIGEST' and recipient_email = 'ops@ebim.pe'), 1,
  'sincronización con diferencias → OPS_SYNC_DIGEST al buzón interno');

-- Interruptor apagado: el evento queda constancia como SKIPPED.
update platform.mail_settings set business_mail_enabled = false where id;
insert into platform.invoices (id, number, customer_organization_id, status, currency, issue_date, due_date, total, subtotal)
values ('abababab-0000-4000-a000-0000000000a3', 'INV-TEST-MAIL-OFF', pg_temp.alpha_org(), 'ISSUED', 'USD', current_date, current_date + 15, 10, 10);
select is((pg_temp.mail('invoice-issued-abababab-0000-4000-a000-0000000000a3')).status, 'SKIPPED', 'correo de negocio apagado → SKIPPED');
update platform.mail_settings set business_mail_enabled = true where id;

-- ---------------------------------------------------------------------------
-- Canal servidor
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.superadmin());
select throws_ok($$ select * from platform.mail_claim_batch(5) $$, '42501', null, 'un usuario no toma lotes');

select pg_temp.act_as_service();
update platform.mail_outbox set next_attempt_at = now() + interval '1 day'
 where status = 'PENDING' and idempotency_key <> 'invoice-issued-abababab-0000-4000-a000-0000000000a1';
select is((select count(*)::int from platform.mail_claim_batch(10)), 1, 'toma solo lo pendiente y vencido');
select is((pg_temp.mail('invoice-issued-abababab-0000-4000-a000-0000000000a1')).status, 'SENDING', 'la fila queda SENDING');
select is((pg_temp.mail('invoice-issued-abababab-0000-4000-a000-0000000000a1')).attempts, 1, 'cuenta el intento');

select is(
  (select platform.mail_payment_link(id) ->> 'payment_link_token' from platform.mail_outbox
    where idempotency_key = 'invoice-issued-abababab-0000-4000-a000-0000000000a1'),
  (select platform.mail_payment_link(id) ->> 'payment_link_token' from platform.mail_outbox
    where idempotency_key = 'invoice-issued-abababab-0000-4000-a000-0000000000a1'),
  'el enlace de pago es idempotente durante el envío');
select is((select count(*)::int from platform.payment_links where organization_id = pg_temp.alpha_org()
            and token_hash = encode(sha256(convert_to((pg_temp.mail('invoice-issued-abababab-0000-4000-a000-0000000000a1')).secret_variables ->> 'payment_link_token', 'UTF8')), 'hex')),
  1, 'el portal guarda solo el sha256 del token');

select lives_ok($$ select platform.mail_mark_result(
  (select id from platform.mail_outbox where idempotency_key = 'invoice-issued-abababab-0000-4000-a000-0000000000a1'),
  'SENT', null, 'em-test-1', 'queued', null, null, 'pagos@ebim.pe', 'allowlist') $$, 'marca SENT');
select ok((pg_temp.mail('invoice-issued-abababab-0000-4000-a000-0000000000a1')).secret_variables is null,
  'al cerrar el envío el token se borra');

-- Callback: avanza, deduplica y no retrocede.
select is((platform.mail_apply_event('evt_t1', 'email.delivered', 'em-test-1', 'delivered', 'pagos@ebim.pe', now(), '{}')) ->> 'matched', 'true',
  'el callback encuentra el correo por emailId');
select is((pg_temp.mail('invoice-issued-abababab-0000-4000-a000-0000000000a1')).status, 'DELIVERED', 'delivered → DELIVERED');
select is((platform.mail_apply_event('evt_t1', 'email.delivered', 'em-test-1', 'delivered', 'pagos@ebim.pe', now(), '{}')) ->> 'duplicate', 'true',
  'mismo eventId: duplicado');
select lives_ok($$ select platform.mail_apply_event('evt_t0', 'email.sent', 'em-test-1', 'sent', 'pagos@ebim.pe', now() - interval '1 minute', '{}') $$,
  'un evento atrasado se registra');
select is((pg_temp.mail('invoice-issued-abababab-0000-4000-a000-0000000000a1')).status, 'DELIVERED', 'pero no hace retroceder el estado');

select throws_ok($$ select platform.mail_record_auth('AUTH_INVITE', 'masteradmin-acceso-invitacion', 'a@ebim.pe', null,
  '{"enlace":"https://x"}', 'masteradmin-auth-x-invite', 'SENT') $$, '22023', null, 'el enlace de acceso nunca se guarda');

-- Reenviar y cancelar (consola, con motivo).
select pg_temp.act_as(pg_temp.superadmin());
select throws_ok($$ select platform.mail_retry((select id from platform.mail_outbox where idempotency_key = 'invoice-issued-abababab-0000-4000-a000-0000000000a1'), 'otra vez') $$,
  '23514', null, 'no se reenvía un correo entregado');
select pg_temp.act_as_service();
select platform.mail_mark_result((select id from platform.mail_outbox where idempotency_key = 'tenant-activated-abababab-0000-4000-a000-0000000000b1'),
  'FAILED', 'caído', null, null, 'internal_error');
select pg_temp.act_as(pg_temp.finance());
select is((platform.mail_retry((select id from platform.mail_outbox where idempotency_key = 'tenant-activated-abababab-0000-4000-a000-0000000000b1'), 'MailHub caído')) ->> 'status',
  'PENDING', 'finanzas reenvía un correo fallido');
select is((select resend_count from platform.v_mail_outbox
            where tenant_id = 'abababab-0000-4000-a000-0000000000b1' and event_type = 'TENANT_ACTIVATED'),
          1, 'con una clave nueva hacia MailHub (la consola lo ve por la vista)');
select is((platform.mail_cancel((select id from platform.mail_outbox where idempotency_key = 'tenant-activated-abababab-0000-4000-a000-0000000000b1'), 'Ya no aplica')) ->> 'status',
  'CANCELLED', 'un pendiente se cancela con motivo');

-- Job programado sin secretos de Vault: no hace nada.
select pg_temp.act_as_postgres();
select is((platform.invoke_scheduled_function('MAIL_DISPATCH')) ->> 'outcome', 'SKIPPED_NOT_CONFIGURED',
  'MAIL_DISPATCH sin secretos de Vault: SKIPPED_NOT_CONFIGURED');
select is((select schedule from cron.job where jobname = 'ebim-mail-dispatch'), '* * * * *',
  'pg_cron programa ebim-mail-dispatch cada minuto (solo si hay cola)');

select * from finish();
rollback;
