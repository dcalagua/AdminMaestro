-- ============================================================================
-- Tests de la fase V2.1 de HARDENING
-- ----------------------------------------------------------------------------
-- Cada bloque corresponde a un hallazgo CONFIRMADO ejecutándolo, no leyéndolo.
-- El nombre de cada prueba dice qué se rompía, porque dentro de seis meses lo
-- que hay que poder leer de un vistazo es qué pasa si alguien lo revierte.
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

-- ---------------------------------------------------------------------------
-- F-01. Registrar un cobro de pasarela es una operación de SERVIDOR.
--
-- Lo que ocurría: EBIM_FINANCE llamaba a register_provider_payment() y obtenía
-- `accepted: true` con un `payments` CONFIRMED — indistinguible de un cobro
-- real de Culqi— que además dispara el devengo de comisión. No es "un rol con
-- muchos permisos": es que un cobro que nunca ocurrió entra en la contabilidad
-- y genera una comisión pagadera.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000003');  -- finance@ebim.test
select throws_ok(
  $$ select platform.register_provider_payment(
       (select id from platform.payment_provider_accounts where code='culqi-pe-test'),
       'evt_intento_finanzas', 'charge.succeeded', 'chr_inventado',
       'sxn_mock_grupasa01', 100, 'USD') $$,
  '42501',
  null,
  'F-01: EBIM_FINANCE no puede AFIRMAR un cobro de pasarela que no ocurrió'
);

select throws_ok(
  $$ select platform.register_provider_payment_failure(
       (select id from platform.payment_provider_accounts where code='culqi-pe-test'),
       'evt_fallo_finanzas', 'charge.failed', 'sxn_mock_grupasa01', 'x', 'y') $$,
  '42501',
  null,
  'F-01: tampoco puede declarar un cobro FALLIDO, que marca la suscripción en mora'
);

-- El camino legítimo para registrar dinero a mano sigue abierto: la corrección
-- cierra la suplantación de la pasarela, no la operativa financiera.
select lives_ok(
  $$ select platform.confirm_manual_payment(
       (select id from platform.invoices where status <> 'PAID' limit 1),
       100, 'REF-QA-V21-001', 'BANK_TRANSFER', now()) $$,
  'F-01: EBIM_FINANCE conserva el cobro MANUAL, que es el que sí puede afirmar'
);

-- ---------------------------------------------------------------------------
-- F-02. El mapeo con el proveedor tampoco lo escribe un usuario.
--
-- Lo que ocurría: un ORG_ADMIN podía apuntar SU contrato a la suscripción de
-- otro en la pasarela, y a partir de ahí los cobros ajenos se registraban
-- contra su factura.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000009');  -- admin@alpha
select throws_ok(
  $$ select platform.upsert_provider_subscription(
       (select id from platform.payment_provider_accounts where code='culqi-pe-test'),
       (select id from platform.subscriptions where code='SUB-ALPHA-ESUP'),
       'sxn_secuestrada', null, null, null, 'active', null, '{}'::jsonb) $$,
  '42501',
  null,
  'F-02: un ORG_ADMIN no puede reapuntar el mapeo de cobro de su contrato'
);

select pg_temp.act_as('10000000-0000-4000-a000-000000000001');  -- super admin
select throws_ok(
  $$ select platform.upsert_provider_subscription(
       (select id from platform.payment_provider_accounts where code='culqi-pe-test'),
       (select id from platform.subscriptions where code='SUB-ALPHA-ESUP'),
       'sxn_secuestrada', null, null, null, 'active', null, '{}'::jsonb) $$,
  '42501',
  null,
  'F-02: ni siquiera el super admin: el mapeo lo escribe el proceso que habló con el proveedor'
);

-- ---------------------------------------------------------------------------
-- El contexto de servicio SÍ puede: si esto se rompe, el webhook deja de
-- funcionar y la plataforma no cobra.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select lives_ok(
  $$ select platform.upsert_provider_subscription(
       (select id from platform.payment_provider_accounts where code='culqi-pe-test'),
       (select id from platform.subscriptions where code='SUB-ALPHA-ESUP'),
       'sxn_mock_alpha01', 'pln_x', 'crd_x', 'cus_x', 'active', now(), '{}'::jsonb) $$,
  'El contexto de servicio conserva la escritura del mapeo: el webhook sigue operando'
);

select ok(
  (platform.register_provider_payment(
     (select id from platform.payment_provider_accounts where code='culqi-pe-test'),
     'evt_qa_servicio', 'charge.succeeded', 'chr_qa_servicio',
     'sxn_mock_alpha01', 250, 'USD') ->> 'accepted')::boolean,
  'El contexto de servicio registra el cobro y genera factura y pago'
);

-- Idempotencia: el mismo evento dos veces no cobra dos veces.
select is(
  (platform.register_provider_payment(
     (select id from platform.payment_provider_accounts where code='culqi-pe-test'),
     'evt_qa_servicio', 'charge.succeeded', 'chr_qa_servicio',
     'sxn_mock_alpha01', 250, 'USD') ->> 'duplicate')::boolean,
  true,
  'La reentrega del mismo evento no crea un segundo pago'
);

-- Moneda incoherente: un cobro en otra divisa no entra en el MRR.
select is(
  platform.register_provider_payment(
    (select id from platform.payment_provider_accounts where code='culqi-pe-test'),
    'evt_qa_moneda', 'charge.succeeded', 'chr_qa_moneda',
    'sxn_mock_alpha01', 250, 'PEN') ->> 'error',
  'MONEDA_INCOHERENTE',
  'Un cobro en moneda distinta a la del contrato se rechaza en vez de sumarse'
);

-- ---------------------------------------------------------------------------
-- GRANTS: lo anterior no puede depender solo del `if` dentro de la función.
-- PostgREST expone toda función con EXECUTE para `authenticated`.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();

select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform'
      and p.proname in ('register_provider_payment', 'register_provider_payment_failure',
                        'upsert_provider_subscription')
      and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('anon', p.oid, 'EXECUTE'))),
  0,
  'Ninguna RPC de proveedor está expuesta a authenticated ni a anon por PostgREST'
);

select ok(
  (select bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform'
      and p.proname in ('register_provider_payment', 'register_provider_payment_failure',
                        'upsert_provider_subscription')),
  'Las tres RPC de proveedor siguen siendo ejecutables por service_role'
);

-- Toda función SECURITY DEFINER con search_path fijo: sin él, un schema en el
-- camino de búsqueda del llamante secuestra la resolución de nombres.
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'))
                       as cfg where cfg like 'search_path=%')),
  0,
  'Ninguna función SECURITY DEFINER de platform se queda sin search_path fijo'
);

-- ---------------------------------------------------------------------------
-- F-05 (parte de base de datos). can_run_provisioning es la autoridad que
-- consulta la Edge Function: un JWT válido no es autorización.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-00000000000b');  -- user@alpha (TENANT_USER)
select is(platform.can_run_provisioning(), false,
  'F-05: un usuario de tenant no puede lanzar el worker de provisioning');

select pg_temp.act_as('10000000-0000-4000-a000-000000000003');  -- finance
select is(platform.can_run_provisioning(), false,
  'F-05: el rol financiero tampoco: provisioning no es una función financiera');

select pg_temp.act_as('10000000-0000-4000-a000-000000000002');  -- product.admin
select is(platform.can_run_provisioning(), true,
  'F-05: EBIM_PRODUCT_ADMIN sí, que es de quien es la responsabilidad');

-- F-03. can_read_finance es la autoridad de la reconciliación.
select pg_temp.act_as('10000000-0000-4000-a000-00000000000b');  -- TENANT_USER
select is(platform.can_read_finance(), false,
  'F-03: un usuario de tenant no supera el control de la reconciliación');

select pg_temp.act_as('10000000-0000-4000-a000-000000000003');  -- finance
select is(platform.can_read_finance(), true,
  'F-03: EBIM_FINANCE sí lo supera');

-- ---------------------------------------------------------------------------
-- Datos de facturación del titular (Fase 6).
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();
select is(
  (select ready_for_card_payment from platform.v_billing_contact_readiness r
     join platform.organizations o on o.id = r.organization_id where o.slug='grupasa'),
  true,
  'El cliente con cobro por tarjeta tiene los siete datos que exige la pasarela'
);

select is(
  (select array_length(missing_fields, 1) from platform.v_billing_contact_readiness r
     join platform.organizations o on o.id = r.organization_id where o.slug='consultora-andina'),
  5,
  'La vista enumera exactamente los campos que faltan, para que la UI no los repita'
);

select pg_temp.act_as('10000000-0000-4000-a000-00000000000b');  -- TENANT_USER
select throws_ok(
  $$ select platform.set_billing_contact(
       '30000000-0000-4000-a000-000000000004',
       'Hacker', 'Anonimo', 'otro@dominio.test', 'Calle Falsa 123', 'Lima', '51900000000') $$,
  '42501',
  null,
  'Un usuario sin mando no cambia el domicilio fiscal que se envía a la pasarela'
);

select pg_temp.act_as('10000000-0000-4000-a000-000000000001');  -- super admin
select throws_ok(
  $$ select platform.set_billing_contact(
       '30000000-0000-4000-a000-000000000004',
       'Contacto', 'Facturacion', 'no-es-un-correo', 'Av. Real 100', 'Lima', '51987654321') $$,
  '23514',
  null,
  'Un correo inválido se rechaza aquí y no en la pasarela'
);

select throws_ok(
  $$ select platform.set_billing_contact(
       '30000000-0000-4000-a000-000000000004',
       'Contacto', 'Facturacion', 'pagos@alpha.ebim.test', 'Av. Real 100', 'Lima', '12') $$,
  '23514',
  null,
  'Un teléfono demasiado corto se rechaza: la pasarela exige entre 5 y 15 dígitos'
);

select * from finish();
rollback;
