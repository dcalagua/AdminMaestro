-- ============================================================================
-- Tests de SEGURIDAD de las extensiones V2 (Fase 16)
-- ----------------------------------------------------------------------------
-- El archivo 00 ya comprueba, en bucle sobre TODO el schema, que cada tabla
-- tenga RLS+FORCE y que `anon` no tenga nada. Eso cubre automáticamente las
-- tablas nuevas, y por eso aquí no se repite.
--
-- Lo que sí se comprueba aquí es lo que un bucle genérico no puede saber:
-- que las tablas de cobro no admiten secretos, que cada rol ve exactamente lo
-- que le toca, y que las RPCs nuevas rechazan a quien no debe llamarlas.
-- ============================================================================
begin;
select plan(26);

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
-- 1-6. ESTRUCTURA: las tablas V2 existen, en `platform`, con RLS y sin `anon`.
-- ---------------------------------------------------------------------------
set local role postgres;

select is(
  (select count(*)::int from information_schema.tables
    where table_schema = 'platform'
      and table_name in (
        'payment_provider_accounts', 'subscription_collection_profiles',
        'subscription_commercial_documents', 'provider_customers',
        'provider_payment_methods', 'provider_plans', 'provider_subscriptions',
        'provider_webhook_events', 'billing_alerts'
      )),
  9,
  'Las 9 tablas de V2 viven en el schema platform, no en public'
);

select is(
  (select count(*)::int from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform' and c.relkind = 'r'
      and c.relname in (
        'payment_provider_accounts', 'subscription_collection_profiles',
        'subscription_commercial_documents', 'provider_customers',
        'provider_payment_methods', 'provider_plans', 'provider_subscriptions',
        'provider_webhook_events', 'billing_alerts'
      )
      and (not c.relrowsecurity or not c.relforcerowsecurity)),
  0,
  'Todas las tablas V2 tienen RLS habilitada Y forzada'
);

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'platform' and grantee = 'anon'),
  0,
  'anon sigue sin ningún GRANT tras añadir las tablas de V2'
);

-- Escribir sobre cobro y documentos pasa por RPC, no por GRANT directo.
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'platform'
      and table_name in (
        'payment_provider_accounts', 'subscription_collection_profiles',
        'subscription_commercial_documents', 'billing_alerts',
        'provider_webhook_events', 'provider_subscriptions'
      )
      and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'Ninguna tabla de cobranza es escribible directamente por authenticated'
);

-- Toda función V2 SECURITY DEFINER fija search_path (el 00 lo mira global; aquí
-- se nombra el subconjunto V2 para que el fallo señale al archivo correcto).
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform' and p.prosecdef
      and p.proname in (
        'upsert_payment_provider_account', 'set_subscription_collection_profile',
        'request_commercial_document', 'approve_commercial_document',
        'register_provider_payment', 'refresh_billing_alerts',
        'apply_due_suspensions', 'reverse_payment', 'confirm_manual_payment',
        'onboard_customer_subscription', 'upsert_product_agreement'
      )
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
         where cfg like 'search_path=%')),
  0,
  'Toda RPC V2 SECURITY DEFINER fija su search_path'
);

-- Todas las vistas V2 son security_invoker: si no, serían un bypass de RLS.
select is(
  (select count(*)::int from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform' and c.relkind = 'v'
      and c.relname like 'v_%'
      and coalesce(
            (select option_value from pg_options_to_table(c.reloptions)
              where option_name = 'security_invoker'), 'false') <> 'true'),
  0,
  'Todas las vistas de platform (incluidas las de V2) usan security_invoker'
);

-- ---------------------------------------------------------------------------
-- 7-10. SECRETOS: la base rechaza cualquier cosa con forma de credencial.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into platform.payment_provider_accounts (code, name, provider_kind, secret_key_ref)
     values ('culqi-fuga', 'Fuga', 'CULQI', 'sk_test_1234567890abcdef') $$,
  '23514',
  null,
  'Una clave sk_test_ real en secret_key_ref viola el CHECK: no se guarda nunca'
);

select throws_ok(
  $$ insert into platform.payment_provider_accounts (code, name, provider_kind, public_key)
     values ('culqi-fuga2', 'Fuga 2', 'CULQI', 'sk_live_abcdef1234567890') $$,
  '23514',
  null,
  'Una clave secreta en la columna de llave PÚBLICA también se rechaza'
);

select throws_ok(
  $$ insert into platform.payment_provider_accounts (code, name, provider_kind, environment, secret_key_ref)
     values ('culqi-live-sin-ref', 'Live sin secreto', 'CULQI', 'LIVE', null) $$,
  '23514',
  null,
  'Una cuenta Culqi LIVE sin referencia de secreto es una configuración inválida'
);

select throws_ok(
  $$ insert into platform.payment_provider_accounts (code, name, provider_kind, metadata)
     values ('culqi-meta', 'Meta', 'CULQI',
             jsonb_build_object('api_key', 'algo')) $$,
  '42501',
  null,
  'Una metadata con pinta de credencial (api_key) se rechaza'
);

-- Ninguna columna de las tablas V2 puede guardar un PAN: `last4` son 4 dígitos.
select throws_ok(
  $$ insert into platform.provider_payment_methods
       (provider_account_id, organization_id, external_payment_method_id, last4)
     select a.id, '30000000-0000-4000-a000-000000000004', 'crd_mock_test', '4111111111111111'
       from platform.payment_provider_accounts a where a.code = 'culqi-pe-test' $$,
  '22001',
  null,
  'Un PAN completo no cabe en last4: la columna solo admite 4 dígitos'
);

-- ---------------------------------------------------------------------------
-- 12-16. AUTORIZACIÓN: cada rol ve y hace lo suyo.
-- ---------------------------------------------------------------------------

-- Un PARTNER_ADMIN no define sus propias condiciones comerciales.
select pg_temp.act_as('10000000-0000-4000-a000-000000000004');  -- admin@andina
select throws_ok(
  $$ select platform.upsert_product_agreement(
       '30000000-0000-4000-a000-000000000002',
       (select id from platform.saas_products where code = 'esupplier'),
       true, true, 0.99) $$,
  '42501',
  null,
  'Un partner admin NO puede concederse a sí mismo margen ni condiciones'
);

-- Un PARTNER_ADMIN no configura pasarelas de cobro de la plataforma.
select throws_ok(
  $$ select platform.upsert_payment_provider_account('pirata', 'Pirata', 'CULQI') $$,
  '42501',
  null,
  'Un partner admin no configura cuentas de proveedor de cobro'
);

-- Un PARTNER_ADMIN no ve los acuerdos de OTRO partner.
select is(
  (select count(*)::int from platform.v_partner_agreements
    where organization_slug = 'reseller-pacifico'),
  0,
  'Un partner admin no ve los acuerdos de otro partner (vista security_invoker)'
);

-- Un PARTNER_ADMIN no ve los eventos crudos del proveedor de pago.
select is(
  (select count(*)::int from platform.provider_webhook_events),
  0,
  'Los eventos de webhook son diagnóstico de plataforma: un partner no los ve'
);

-- Un PARTNER_ADMIN no puede recalcular ni aplicar suspensiones globales.
select throws_ok(
  $$ select platform.apply_due_suspensions(now(), 'DRY_RUN') $$,
  '42501',
  null,
  'Un partner admin no puede aplicar suspensiones'
);

-- ---------------------------------------------------------------------------
-- 17-20. COMERCIAL != ACCESO OPERATIVO.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000008');  -- comercial@indep (Carla)

select ok(
  (select count(*) from platform.sales_attributions) > 0,
  'Un comercial SÍ ve sus propias atribuciones'
);

select ok(
  (select count(*) from platform.commission_events) > 0,
  'Un comercial SÍ ve sus propias comisiones'
);

select is(
  (select count(*)::int from platform.tenant_memberships),
  0,
  'Un comercial NO tiene ninguna membresía operativa de tenant'
);

-- Vender no da acceso a la configuración operativa del tenant vendido.
select is(
  (select count(*)::int from platform.tenant_settings),
  0,
  'Un comercial no accede a la configuración operativa de ningún tenant'
);

select is(
  (select count(*)::int from platform.cost_entries),
  0,
  'Un comercial no ve los costos de infraestructura de EBIM'
);

-- ---------------------------------------------------------------------------
-- 22-24. Un usuario de TENANT no ve el plano financiero de la plataforma.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-00000000000b');  -- user@alpha (TENANT_USER)

select is(
  (select count(*)::int from platform.cost_entries), 0,
  'Un usuario de tenant no ve costos de plataforma'
);

select is(
  (select count(*)::int from platform.payment_provider_accounts), 0,
  'Un usuario de tenant no ve las cuentas de cobro de la plataforma'
);

select is(
  (select count(*)::int from platform.billing_alerts), 0,
  'Un usuario de tenant no ve las alertas de cobranza'
);

-- ---------------------------------------------------------------------------
-- 25-26. El perfil de cobro no cruza organizaciones.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_postgres();

-- Una cuenta de proveedor con dueño solo cobra a su dueño.
select lives_ok(
  $$ insert into platform.payment_provider_accounts
       (id, code, name, provider_kind, owner_organization_id)
     values ('b0000000-0000-4000-a000-0000000000ff', 'andina-culqi',
             'Culqi de Consultora Andina', 'CULQI',
             '30000000-0000-4000-a000-000000000002') $$,
  'Se puede crear una cuenta de cobro propiedad de un partner'
);

select throws_ok(
  $$ insert into platform.subscription_collection_profiles
       (subscription_id, collection_method, provider_account_id, auto_charge)
     select s.id, 'CULQI_CARD', 'b0000000-0000-4000-a000-0000000000ff', true
       from platform.subscriptions s where s.code = 'SUB-OMEGA-ESUP' $$,
  '42501',
  null,
  'La cuenta de cobro de un partner NO puede cobrar la suscripción de otra organización'
);

select * from finish();
rollback;
