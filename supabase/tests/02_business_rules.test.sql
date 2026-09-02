-- ============================================================================
-- Tests de REGLAS DE NEGOCIO
-- Cada test corresponde a una regla escrita en el prompt o en el contrato EBIM.
-- ============================================================================
begin;
select plan(18);

set local role postgres;

-- ---------------------------------------------------------------------------
-- 1-3. Contrato §3.2 — el alta de tenant EXIGE administrador nombrado.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select platform.create_tenant('esupplier', '30000000-0000-4000-a000-000000000004',
       'sin-admin', 'Tenant sin admin', null) $$,
  'ADMIN_EMAIL_REQUERIDO: crear un tenant exige el correo de un administrador de esa empresa (contrato §3.2)',
  'create_tenant sin correo de admin falla con ADMIN_EMAIL_REQUERIDO'
);

select throws_ok(
  $$ select platform.create_tenant('esupplier', '30000000-0000-4000-a000-000000000004',
       'admin-vacio', 'Tenant admin vacío', '   ') $$,
  'ADMIN_EMAIL_REQUERIDO: crear un tenant exige el correo de un administrador de esa empresa (contrato §3.2)',
  'Un correo de admin en blanco tampoco pasa (no es un default silencioso)'
);

-- Contrato §13.2: el dominio operador no es actor de negocio de un cliente.
select throws_ok(
  $$ select platform.create_tenant('esupplier', '30000000-0000-4000-a000-000000000004',
       'admin-operador', 'Tenant con admin operador', 'alguien@ebim.pe') $$,
  '42501',
  null,
  'Un correo @ebim.pe no puede ser administrador de un tenant cliente (§13.2)'
);

-- ---------------------------------------------------------------------------
-- 4-5. Contrato §13.1 — Super Admin único y no transferible.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into platform.platform_admins (user_id, role)
     values ('10000000-0000-4000-a000-000000000004', 'EBIM_SUPER_ADMIN') $$,
  '42501',
  null,
  'Nadie más que dcalagua@ebim.pe puede recibir EBIM_SUPER_ADMIN'
);

select is(
  (select count(*)::int from platform.platform_admins where role = 'EBIM_SUPER_ADMIN'), 1,
  'Existe exactamente UN EBIM_SUPER_ADMIN en toda la suite'
);

-- ---------------------------------------------------------------------------
-- 6. Contrato §13.2 — @ebim.pe bloqueado como miembro de organización cliente.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into platform.organization_memberships (user_id, organization_id, role)
     values ('10000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000004', 'ORG_ADMIN') $$,
  '42501',
  null,
  'El dominio operador @ebim.pe no puede ser miembro de una organización cliente'
);

-- ---------------------------------------------------------------------------
-- 7. Regla §2.2 — un tenant DEMO no genera cobro recurrente.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into platform.subscriptions
       (code, billed_organization_id, saas_product_id, tenant_id, plan_id, status, billing_interval)
     values ('SUB-DEMO-TEST', '30000000-0000-4000-a000-000000000002',
             '20000000-0000-4000-a000-000000000001', '50000000-0000-4000-a000-000000000004',
             '60000000-0000-4000-a000-000000000001', 'ACTIVE', 'MONTHLY') $$,
  '23514',
  null,
  'Un tenant DEMO no admite suscripción recurrente ACTIVA'
);

-- ...y por tanto no aporta MRR.
select is(
  (select count(*)::int from platform.v_subscription_mrr
    where tenant_id = '50000000-0000-4000-a000-000000000004'), 0,
  'Un tenant DEMO no aparece en el MRR'
);

-- ---------------------------------------------------------------------------
-- 9. Un partner sin acuerdo activo no puede administrar tenants de un producto.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into platform.tenants
       (slug, name, saas_product_id, customer_organization_id, managing_organization_id,
        tenant_type, deployment_mode, admin_email)
     values ('sin-acuerdo', 'Sin acuerdo', '20000000-0000-4000-a000-000000000003',
             '30000000-0000-4000-a000-000000000004', '30000000-0000-4000-a000-000000000002',
             'PRODUCTION', 'SHARED', 'x@cliente.ebim.test') $$,
  '23514',
  null,
  'PARTNER_SIN_ACUERDO: Andina no puede administrar tenants de TMS (no tiene acuerdo)'
);

-- ---------------------------------------------------------------------------
-- 10-11. Coherencia entre deployment_mode del tenant y del target.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into platform.tenant_deployments (tenant_id, deployment_target_id)
     values ('50000000-0000-4000-a000-000000000001', '40000000-0000-4000-a000-000000000005') $$,
  '23514',
  null,
  'Un tenant SHARED no puede colgar de un target TENANT_DEDICATED'
);

-- Un target TENANT_DEDICATED aloja exactamente un tenant.
select is(
  (select count(*)::int from platform.tenant_deployments
    where deployment_target_id = '40000000-0000-4000-a000-000000000005' and status = 'ACTIVE'), 1,
  'El target exclusivo de Omega aloja exactamente 1 tenant'
);

-- ...mientras el compartido aloja varios.
select ok(
  (select count(*) from platform.tenant_deployments
    where deployment_target_id = '40000000-0000-4000-a000-000000000001') > 1,
  'El target SHARED de eSupplier aloja varios tenants a la vez'
);

-- ---------------------------------------------------------------------------
-- 13-14. Finanzas: DRAFT y VOID no cuentan como ingreso cobrado.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from platform.v_collected_revenue r
     join platform.invoices i on i.id = r.invoice_id
    where i.status in ('DRAFT', 'VOID')), 0,
  'Ninguna factura DRAFT o VOID aparece en el ingreso cobrado'
);

-- Un pago no puede confirmarse sobre una factura no emitida.
select throws_ok(
  $$ insert into platform.payments (invoice_id, reference, status, amount, paid_at)
     select id, 'PAY-TEST-DRAFT', 'CONFIRMED', 100, now()
       from platform.invoices where number = 'INV-DRAFT-0001' $$,
  '23514',
  null,
  'No se puede confirmar un cobro sobre una factura DRAFT'
);

-- ---------------------------------------------------------------------------
-- 15-16. Comisiones: se devengan de cobros, y separan pagada de pendiente.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from platform.commission_events e
     join platform.payments p on p.id = e.payment_id
    where p.status <> 'CONFIRMED'), 0,
  'Todo commission_event proviene de un pago CONFIRMED'
);

select ok(
  (select count(*) from platform.commission_events where status = 'PAID') > 0
  and (select count(*) from platform.commission_events where status in ('ELIGIBLE', 'ACCRUED')) > 0,
  'Comisión pagada y comisión pendiente están separadas por status'
);

-- ---------------------------------------------------------------------------
-- 17. Determinismo del cálculo: base × rate × attribution_pct = amount.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from platform.commission_events e
     join platform.commission_rules r on r.id = e.commission_rule_id
    where r.basis <> 'FIXED_AMOUNT'
      and e.amount <> round(e.base_amount * e.applied_rate * e.attribution_pct, 2)), 0,
  'El monto de toda comisión porcentual = round(base × rate × attribution_pct, 2)'
);

-- ---------------------------------------------------------------------------
-- 18. Idempotencia: reprocesar un pago no duplica comisiones.
-- ---------------------------------------------------------------------------
select is(
  (select platform.generate_commission_events(
     (select id from platform.payments where status = 'CONFIRMED' order by created_at limit 1))),
  0,
  'Reprocesar un pago ya devengado crea 0 eventos nuevos (idempotente)'
);

select * from finish();
rollback;
