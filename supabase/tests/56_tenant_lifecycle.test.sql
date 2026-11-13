-- ============================================================================
-- Ciclo de vida del tenant (20261020000100): impago → suspensión gobernada →
-- reactivación al pagar, interruptores globales, historial con causa, marca de
-- entitlements y jobs programados.
-- Organización QA propia: la deuda del seed no entra en estos tenants.
-- ============================================================================
begin;
select plan(55);

create or replace function pg_temp.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$$;

-- El job de pg_cron: sesión postgres, sin rol de PostgREST y sin JWT.
create or replace function pg_temp.act_as_system()
returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.super() returns uuid language sql as
  $$ select '10000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.padmin() returns uuid language sql as
  $$ select '10000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.finance() returns uuid language sql as
  $$ select '10000000-0000-4000-a000-000000000003'::uuid $$;
create or replace function pg_temp.t(p_n int) returns uuid language sql as
  $$ select ('5c600000-0000-4000-a000-00000000000' || p_n)::uuid $$;
create or replace function pg_temp.status(p_tenant uuid) returns text language sql as
  $$ select status::text from platform.tenants where id = p_tenant $$;
create or replace function pg_temp.stage(p_tenant uuid) returns text language sql as
  $$ select lifecycle_stage from platform.v_tenant_lifecycle where tenant_id = p_tenant $$;

-- ---------------------------------------------------------------------------
-- Estructura y permisos
-- ---------------------------------------------------------------------------
select has_function('platform', 'run_tenant_lifecycle_cycle', array['timestamp with time zone', 'boolean'],
  'run_tenant_lifecycle_cycle(as_of, dry_run) existe');
select has_function('platform', 'set_tenant_lifecycle_settings', array['boolean', 'boolean', 'boolean', 'boolean'],
  'set_tenant_lifecycle_settings existe');
select has_view('platform', 'v_tenant_lifecycle', 'v_tenant_lifecycle existe');
select ok(
  not has_function_privilege('anon', 'platform.run_tenant_lifecycle_cycle(timestamptz, boolean)', 'execute'),
  'anon no ejecuta el ciclo de vida'
);
select ok(
  not has_function_privilege('authenticated',
    'platform._tenant_status_transition(uuid, platform.tenant_status, text)', 'execute')
  and not has_function_privilege('authenticated',
    'platform._suspend_tenant_for_nonpayment(uuid, timestamptz, text, jsonb)', 'execute')
  and not has_function_privilege('authenticated',
    'platform._resume_tenant_after_payment(uuid, date, text)', 'execute')
  and not has_function_privilege('authenticated', 'platform._refresh_billing_alerts_core(timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'platform.invoke_scheduled_function(text)', 'execute'),
  'Los núcleos sin guardia y el disparador HTTP no tienen GRANT'
);
select is(
  (select auto_suspend_enabled::text || ' ' || auto_resume_enabled::text || ' '
          || entitlement_sync_enabled::text || ' ' || autocharge_enabled::text
     from platform.tenant_lifecycle_settings),
  'false true true false',
  'Por defecto: suspensión automática APAGADA, reactivación y sync encendidos, autocobro apagado'
);

-- ---------------------------------------------------------------------------
-- Fixture: organización QA y cuatro tenants de eSupplier
--   T1: deuda fuera de gracia, auto_suspend      → suspensión programada
--   T2: deuda fuera de gracia, sin auto_suspend  → suspensión sugerida
--   T3: vencida hace 2 días (gracia 5)           → en gracia
--   T4: DOS facturas fuera de gracia, auto_suspend
-- ---------------------------------------------------------------------------
insert into platform.organizations (id, slug, legal_name, display_name, kind, country_code)
values ('3c600000-0000-4000-a000-000000000001', 'qa-ciclo-vida', 'QA Ciclo de Vida S.A.C.', 'QA Ciclo de Vida', 'COMPANY', 'PE');
insert into platform.organization_capabilities (organization_id, capability)
values ('3c600000-0000-4000-a000-000000000001', 'CUSTOMER');

insert into platform.tenants (id, slug, name, saas_product_id, customer_organization_id, status, admin_email, activated_at)
select pg_temp.t(n), 'qa-ciclo-' || n, 'QA Ciclo ' || n, '20000000-0000-4000-a000-000000000001',
       '3c600000-0000-4000-a000-000000000001', 'ACTIVE', 'qa' || n || '@ciclo.ebim.test', now() - interval '1 year'
  from generate_series(1, 4) n;

-- La cuenta tiene eSupplier activo: appActive depende entonces solo del estado del tenant.
insert into platform.workspace_apps (organization_id, saas_product_id, status, activated_at)
values ('3c600000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001', 'active', now());

insert into platform.subscriptions (id, code, billed_organization_id, saas_product_id, tenant_id, plan_id, market_id,
                                    status, billing_interval, currency, started_on)
select ('7c600000-0000-4000-a000-00000000000' || n)::uuid, 'SUB-QA-CICLO-' || n, '3c600000-0000-4000-a000-000000000001',
       '20000000-0000-4000-a000-000000000001', pg_temp.t(n), '60000000-0000-4000-a000-000000000001',
       platform.market_id_by_code('EC'), 'ACTIVE', 'MONTHLY', 'USD', current_date - 300
  from generate_series(1, 4) n;

insert into platform.subscription_collection_profiles (subscription_id, collection_method, grace_period_days, auto_suspend)
values ('7c600000-0000-4000-a000-000000000001', 'MANUAL', 5, true),
       ('7c600000-0000-4000-a000-000000000002', 'MANUAL', 5, false),
       ('7c600000-0000-4000-a000-000000000003', 'MANUAL', 5, true),
       ('7c600000-0000-4000-a000-000000000004', 'MANUAL', 5, true);

insert into platform.invoices (id, number, customer_organization_id, subscription_id, status, issue_date, due_date)
values ('7d600000-0000-4000-a000-000000000001', 'INV-QA-CICLO-1', '3c600000-0000-4000-a000-000000000001', '7c600000-0000-4000-a000-000000000001', 'ISSUED', current_date - 40, current_date - 30),
       ('7d600000-0000-4000-a000-000000000002', 'INV-QA-CICLO-2', '3c600000-0000-4000-a000-000000000001', '7c600000-0000-4000-a000-000000000002', 'ISSUED', current_date - 40, current_date - 30),
       ('7d600000-0000-4000-a000-000000000003', 'INV-QA-CICLO-3', '3c600000-0000-4000-a000-000000000001', '7c600000-0000-4000-a000-000000000003', 'ISSUED', current_date - 12, current_date - 2),
       ('7d600000-0000-4000-a000-000000000004', 'INV-QA-CICLO-4A', '3c600000-0000-4000-a000-000000000001', '7c600000-0000-4000-a000-000000000004', 'ISSUED', current_date - 70, current_date - 60),
       ('7d600000-0000-4000-a000-000000000005', 'INV-QA-CICLO-4B', '3c600000-0000-4000-a000-000000000001', '7c600000-0000-4000-a000-000000000004', 'ISSUED', current_date - 40, current_date - 30);

insert into platform.invoice_lines (invoice_id, charge_kind, description, saas_product_id, unit_amount)
select i.id, 'LICENSE', 'Licencia QA', '20000000-0000-4000-a000-000000000001', 100
  from platform.invoices i where i.number like 'INV-QA-CICLO-%';

-- ---------------------------------------------------------------------------
-- Read model: etapas
-- ---------------------------------------------------------------------------
select is(
  platform.is_tenant_app_active(pg_temp.t(1), '20000000-0000-4000-a000-000000000001'),
  true,
  'Antes del ciclo, appActive de T1 es true'
);
select is(pg_temp.stage(pg_temp.t(1)), 'SUSPENSION_SCHEDULED', 'T1: fuera de gracia con auto_suspend → suspensión programada');
select is(pg_temp.stage(pg_temp.t(2)), 'SUSPENSION_SUGGESTED', 'T2: fuera de gracia sin auto_suspend → suspensión sugerida');
select is(pg_temp.stage(pg_temp.t(3)), 'IN_GRACE', 'T3: vencida dentro de la gracia → en gracia');
select is(
  (select overdue_invoices || ' ' || overdue_balance || ' ' || overdue_currency || ' ' || days_past_due
     from platform.v_tenant_lifecycle where tenant_id = pg_temp.t(4)),
  '2 200.00 USD 60',
  'T4: dos facturas, saldo USD 200, 60 días de atraso'
);

-- ---------------------------------------------------------------------------
-- Simulación y ciclo con la suspensión APAGADA
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.padmin());
select is(
  (select string_agg(x ->> 'tenant', ',' order by x ->> 'tenant')
     from jsonb_array_elements(platform.run_tenant_lifecycle_cycle(now(), true) -> 'pending_suspensions') x
    where x ->> 'tenant' like 'QA Ciclo%'),
  'QA Ciclo 1,QA Ciclo 4',
  'La simulación lista a T1 y T4 (auto_suspend y gracia vencida), no a T2 ni T3'
);
select is(pg_temp.status(pg_temp.t(1)), 'ACTIVE', 'La simulación no suspende');

select pg_temp.act_as_system();
select ok(platform.is_system_job(), 'Sesión postgres sin rol ni JWT = job del sistema');
select lives_ok($$ select platform.run_tenant_lifecycle_cycle() $$, 'El job del sistema ejecuta el ciclo');
select is(pg_temp.status(pg_temp.t(1)), 'ACTIVE', 'Con auto_suspend_enabled apagado el ciclo NO suspende');
select is(
  (select outcome from platform.lifecycle_job_runs where job = 'LIFECYCLE_CYCLE' order by id desc limit 1),
  'OK',
  'El ciclo queda en la bitácora de jobs'
);
select ok(
  (select last_cycle_result -> 'pending_suspensions' @> jsonb_build_array(jsonb_build_object('tenant', 'QA Ciclo 1'))
     from platform.tenant_lifecycle_settings),
  'El último resultado deja a T1 como suspensión pendiente de habilitar'
);

-- ---------------------------------------------------------------------------
-- Interruptores: solo el super admin
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.padmin());
select throws_ok($$ select platform.set_tenant_lifecycle_settings(true) $$, '42501', null,
  'EBIM_PRODUCT_ADMIN no habilita la suspensión automática');
select pg_temp.act_as(pg_temp.finance());
select throws_ok($$ select platform.set_tenant_lifecycle_settings(true) $$, '42501', null,
  'Finanzas no habilita la suspensión automática');
select throws_ok($$ select platform.run_tenant_lifecycle_cycle() $$, '42501', null,
  'Finanzas no ejecuta el ciclo (suspende clientes)');
select ok(not platform.is_system_job(), 'Un usuario authenticated nunca es el job del sistema');
select throws_ok($$ update platform.tenant_lifecycle_settings set auto_suspend_enabled = true $$, '42501', null,
  'Nadie cambia los interruptores escribiendo la tabla');

select pg_temp.act_as(pg_temp.super());
select is(
  platform.set_tenant_lifecycle_settings(p_auto_suspend_enabled => true) ->> 'auto_suspend_enabled',
  'true',
  'El super admin habilita la suspensión automática'
);
select is(
  (select metadata #>> '{to,auto_suspend_enabled}' from platform.audit_logs
    where action = 'TENANT_LIFECYCLE_SETTINGS_CHANGED' order by id desc limit 1),
  'true',
  'El cambio de política queda auditado'
);

-- ---------------------------------------------------------------------------
-- Suspensión por impago
-- ---------------------------------------------------------------------------
select pg_temp.act_as_system();
select platform.run_tenant_lifecycle_cycle();

select is(pg_temp.status(pg_temp.t(1)), 'SUSPENDED', 'T1 queda SUSPENDED por impago');
select is(pg_temp.status(pg_temp.t(4)), 'SUSPENDED', 'T4 queda SUSPENDED por impago');
select is(pg_temp.status(pg_temp.t(2)), 'ACTIVE', 'T2 (sin auto_suspend) sigue ACTIVE: es una sugerencia para una persona');
select is(pg_temp.status(pg_temp.t(3)), 'ACTIVE', 'T3 (en gracia) sigue ACTIVE');
select is(
  (select cause || ' ' || (resumed_at is null)::text from platform.tenant_suspensions where tenant_id = pg_temp.t(1)),
  'NON_PAYMENT true',
  'La suspensión de T1 queda abierta con causa NON_PAYMENT'
);
select is(
  (select r.action::text || ' ' || r.mode || ' ' || r.idempotency_key
     from platform.tenant_suspensions s join platform.provisioning_requests r on r.id = s.provisioning_request_id
    where s.tenant_id = pg_temp.t(1)),
  'SUSPEND_TENANT DRY_RUN SUSPEND_TENANT:' || (select id from platform.tenant_suspensions where tenant_id = pg_temp.t(1)),
  'Se encola SUSPEND_TENANT DRY_RUN con clave por suspensión'
);
select is(
  (select desired_dirty::text || ' ' || last_change_reason from platform.entitlement_desired_state
    where tenant_id = pg_temp.t(1)),
  'true TENANT_STATUS_SUSPENDED',
  'Suspender marca el entitlement como cambiado: la app recibirá appActive=false'
);
select is(
  platform.is_tenant_app_active(pg_temp.t(1), '20000000-0000-4000-a000-000000000001'),
  false,
  'appActive del tenant suspendido es false'
);
select is(pg_temp.stage(pg_temp.t(1)), 'SUSPENDED_NON_PAYMENT', 'La matriz muestra «suspendido por impago»');
select is(
  (select count(*)::int from platform.audit_logs
    where action = 'TENANT_STATUS_CHANGED' and tenant_id = pg_temp.t(1) and metadata ->> 'source' = 'SYSTEM'),
  1,
  'El cambio de estado queda auditado con origen SYSTEM'
);

select platform.run_tenant_lifecycle_cycle();
select is(
  (select count(*)::int from platform.tenant_suspensions where tenant_id = pg_temp.t(1)),
  1,
  'Un segundo ciclo no vuelve a suspender (idempotente)'
);

-- ---------------------------------------------------------------------------
-- Reactivación por pago
-- ---------------------------------------------------------------------------
insert into platform.payments (invoice_id, reference, status, amount, paid_at)
values ('7d600000-0000-4000-a000-000000000001', 'PAY-QA-CICLO-1A', 'CONFIRMED', 50, now());
select is(pg_temp.status(pg_temp.t(1)), 'SUSPENDED', 'Un pago parcial no reactiva');

insert into platform.payments (invoice_id, reference, status, amount, paid_at)
values ('7d600000-0000-4000-a000-000000000001', 'PAY-QA-CICLO-1B', 'PENDING', 50, null);
select is(pg_temp.status(pg_temp.t(1)), 'SUSPENDED', 'Un pago PENDING no reactiva');

update platform.payments set status = 'CONFIRMED', paid_at = now() where reference = 'PAY-QA-CICLO-1B';
select is(pg_temp.status(pg_temp.t(1)), 'ACTIVE', 'Al confirmarse el saldo, T1 se reactiva en el acto');
select is(
  (select resume_cause || ' ' || (resume_request_id is not null)::text
     from platform.tenant_suspensions where tenant_id = pg_temp.t(1)),
  'PAYMENT true',
  'La suspensión se cierra con causa PAYMENT y encola RESUME_TENANT'
);
select is(
  (select last_change_reason from platform.entitlement_desired_state where tenant_id = pg_temp.t(1)),
  'TENANT_STATUS_ACTIVE',
  'Reactivar marca el entitlement: la app recibirá appActive=true'
);
select is(
  (select count(*)::int from platform.billing_alerts a
    where a.subscription_id = '7c600000-0000-4000-a000-000000000001'
      and a.status in ('OPEN', 'ACKNOWLEDGED')
      and a.alert_type in ('PAST_DUE', 'GRACE_ENDING', 'SUSPENSION_DUE')),
  0,
  'No quedan alertas de cobranza abiertas de T1'
);

-- T4: pagar UNA de dos facturas fuera de gracia no basta.
insert into platform.payments (invoice_id, reference, status, amount, paid_at)
values ('7d600000-0000-4000-a000-000000000004', 'PAY-QA-CICLO-4A', 'CONFIRMED', 100, now());
select is(pg_temp.status(pg_temp.t(4)), 'SUSPENDED', 'T4 sigue suspendido: aún debe otra factura fuera de gracia');
select is(platform.tenant_has_blocking_debt(pg_temp.t(4)), true, 'T4 conserva deuda bloqueante');

-- Con la reactivación automática APAGADA, el pago no reactiva; el ciclo lo propone.
select pg_temp.act_as(pg_temp.super());
select platform.set_tenant_lifecycle_settings(p_auto_resume_enabled => false);
select pg_temp.act_as_system();
insert into platform.payments (invoice_id, reference, status, amount, paid_at)
values ('7d600000-0000-4000-a000-000000000005', 'PAY-QA-CICLO-4B', 'CONFIRMED', 100, now());
select is(pg_temp.status(pg_temp.t(4)), 'SUSPENDED', 'Con auto_resume apagado, el pago no reactiva');
select ok(
  platform.run_tenant_lifecycle_cycle() -> 'pending_resumes' @> jsonb_build_array(jsonb_build_object('tenant', 'QA Ciclo 4')),
  'El ciclo lo deja como reactivación pendiente'
);
select pg_temp.act_as(pg_temp.super());
select platform.set_tenant_lifecycle_settings(p_auto_resume_enabled => true);
select pg_temp.act_as_system();
select platform.run_tenant_lifecycle_cycle();
select is(pg_temp.status(pg_temp.t(4)), 'ACTIVE', 'Con auto_resume encendido, el ciclo (red de seguridad) reactiva a T4');

-- ---------------------------------------------------------------------------
-- Suspensión MANUAL: el pago no la levanta
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.padmin());
select set_config('qa.req1',
  platform.request_tenant_suspension(pg_temp.t(3), 'Incumplimiento de contrato QA') ->> 'provisioning_request_id', true);
select is(
  (select cause from platform.tenant_suspensions where tenant_id = pg_temp.t(3) and resumed_at is null),
  'MANUAL',
  'Una suspensión desde la consola queda con causa MANUAL'
);
select pg_temp.act_as_system();
insert into platform.payments (invoice_id, reference, status, amount, paid_at)
values ('7d600000-0000-4000-a000-000000000003', 'PAY-QA-CICLO-3', 'CONFIRMED', 100, now());
select is(pg_temp.status(pg_temp.t(3)), 'SUSPENDED', 'Pagar no levanta una suspensión MANUAL');

select pg_temp.act_as(pg_temp.padmin());
select platform.request_tenant_resume(pg_temp.t(3), 'Acuerdo firmado QA');
select is(
  (select resume_cause from platform.tenant_suspensions where tenant_id = pg_temp.t(3)),
  'MANUAL',
  'Reanudar desde la consola cierra la suspensión como MANUAL'
);
select isnt(
  platform.request_tenant_suspension(pg_temp.t(3), 'Segunda suspensión QA') ->> 'provisioning_request_id',
  current_setting('qa.req1'),
  'Una segunda suspensión encola una solicitud NUEVA (antes devolvía la primera)'
);

-- ---------------------------------------------------------------------------
-- Jobs HTTP programados
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.super());
select throws_ok($$ select platform.invoke_scheduled_function('AUTOCHARGE') $$, '42501', null,
  'Ni el super admin dispara los jobs HTTP: solo pg_cron');
select pg_temp.act_as_system();
select is(platform.invoke_scheduled_function('AUTOCHARGE') ->> 'outcome', 'SKIPPED_DISABLED',
  'El autocobro programado no hace nada mientras su interruptor esté apagado');
select is(platform.invoke_scheduled_function('ENTITLEMENT_SYNC') ->> 'outcome', 'SKIPPED_NOT_CONFIGURED',
  'Sin los secretos de Vault del entorno, el sync programado no hace nada');
select is(
  -- Solo los de esta migración: 20261021000100 suma ebim-tenant-sync (test 58).
  (select string_agg(jobname, ',' order by jobname) from cron.job
    where jobname like 'ebim-%' and jobname <> 'ebim-tenant-sync'),
  'ebim-entitlement-sweep,ebim-entitlement-sync,ebim-payment-autocharge,ebim-tenant-lifecycle',
  'pg_cron tiene los cuatro jobs del ciclo de vida'
);

select * from finish();
rollback;
