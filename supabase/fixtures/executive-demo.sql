-- ============================================================================
-- FIXTURE LOCAL · experiencia ejecutiva (evidencia visual y funcional)
-- ----------------------------------------------------------------------------
-- SÓLO para el Supabase LOCAL de pruebas. NO es una migración ni forma parte
-- de seed.sql: se aplica a mano con psql contra 127.0.0.1. NUNCA contra QAS/PRD.
--
--   psql -h 127.0.0.1 -p 55422 -U postgres -d postgres -f supabase/fixtures/executive-demo.sql
--
-- Datos sintéticos rotulados «DEMO-EXEC», idempotente (se puede reaplicar):
--   · 230 facturas (USD/PEN) repartidas en todas las bandas de antigüedad, con
--     pagos parciales, un pago revertido, un sobrepago, una anulada y facturas
--     sin vencimiento → muchos registros, sin truncar;
--   · 210 costos con asignación explícita (plataforma y producto);
--   · 320 comisiones ELIGIBLE, cada una sobre un pago CONFIRMED propio (sólo se
--     comisiona lo cobrado);
--   · el caso del Tenant 360: comercial PENDING + alta ACTIVE + mapping ACTIVE +
--     MRR 0 + administrador PREPROVISIONED (EWM, destino ewm-shared-dev);
--   · una alta SaaS FALLIDA para ver «requiere atención».
-- ============================================================================
begin;

do $$
begin
  if exists (select 1 from platform.invoices where number = 'DEMO-EXEC-0001') then
    raise notice 'Fixture ya aplicado: no se duplica.';
    return;
  end if;

  -- ---------------------------------------------------------------- facturas
  insert into platform.invoices (number, customer_organization_id, status, currency, issue_date, due_date, subtotal, total, notes)
  select
    'DEMO-EXEC-' || lpad(g::text, 4, '0'),
    case g % 3 when 0 then '30000000-0000-4000-a000-000000000004'::uuid
               when 1 then '30000000-0000-4000-a000-000000000005'::uuid
               else '30000000-0000-4000-a000-00000000000a'::uuid end,
    'ISSUED',
    case when g % 4 = 0 then 'PEN' else 'USD' end,
    current_date - (g % 150) - 5,
    case when g % 23 = 0 then null else current_date - (g % 150) + 25 end,
    100 + (g % 17) * 25, 100 + (g % 17) * 25,
    'Fixture local DEMO-EXEC'
  from generate_series(1, 230) g;

  insert into platform.invoice_lines (invoice_id, description, charge_kind, is_recurring, quantity, unit_amount, currency, saas_product_id)
  select i.id, 'Licencia (fixture DEMO-EXEC)', 'LICENSE', true, 1, i.total, i.currency,
         case when right(i.number, 1) in ('1','3','5','7','9') then '20000000-0000-4000-a000-000000000001'::uuid
              else '20000000-0000-4000-a000-000000000002'::uuid end
    from platform.invoices i where i.number like 'DEMO-EXEC-%';

  -- Pagos: cobro total en 1 de cada 3, parcial en 1 de cada 5 (del resto).
  insert into platform.payments (invoice_id, reference, status, amount, currency, paid_at, method)
  select i.id, 'DEMO-EXEC-PAY-' || i.number, 'CONFIRMED',
         case when right(i.number, 2)::int % 3 = 0 then i.total else round(i.total / 2, 2) end,
         i.currency, (i.issue_date + 10)::timestamptz, 'TRANSFER'
    from platform.invoices i
   where i.number like 'DEMO-EXEC-%'
     and (right(i.number, 2)::int % 3 = 0 or right(i.number, 2)::int % 5 = 0);

  -- Un pago revertido (no cuenta), un sobrepago (saldo negativo) y una anulada.
  update platform.payments set status = 'REVERSED' where reference = 'DEMO-EXEC-PAY-DEMO-EXEC-0005';
  insert into platform.payments (invoice_id, reference, status, amount, currency, paid_at, method)
  select id, 'DEMO-EXEC-PAY-OVER', 'CONFIRMED', total + 15, currency, now(), 'TRANSFER'
    from platform.invoices where number = 'DEMO-EXEC-0007';
  update platform.invoices set status = 'VOID' where number = 'DEMO-EXEC-0011';

  -- ------------------------------------------------------------------ costos
  insert into platform.cost_entries (category, description, vendor, amount, currency, period_start, period_end)
  select case g % 3 when 0 then 'COMPUTE' when 1 then 'DATABASE' else 'SUPPORT' end::platform.cost_category,
         'DEMO-EXEC costo ' || lpad(g::text, 3, '0'), 'Proveedor fixture', 40 + (g % 9) * 5, 'USD',
         date_trunc('month', current_date - (g % 6) * 30)::date,
         (date_trunc('month', current_date - (g % 6) * 30) + interval '1 month - 1 day')::date
    from generate_series(1, 210) g;
  insert into platform.cost_allocations (cost_entry_id, scope, saas_product_id, weight, allocation_rule)
  select ce.id,
         case when right(ce.description, 1) in ('0','5') then 'PLATFORM' else 'PRODUCT' end::platform.cost_scope,
         case when right(ce.description, 1) in ('0','5') then null
              else '20000000-0000-4000-a000-000000000002'::uuid end,
         1, 'FIXTURE_DEMO_EXEC'
    from platform.cost_entries ce where ce.description like 'DEMO-EXEC costo %';

  -- -------------------------------------------------------------- comisiones
  insert into platform.invoices (number, customer_organization_id, status, currency, issue_date, due_date, subtotal, total, notes)
  values ('DEMO-EXEC-COMM', '30000000-0000-4000-a000-000000000004', 'ISSUED', 'USD', current_date, current_date + 30, 500, 500, 'Fixture local DEMO-EXEC');
  insert into platform.invoice_lines (invoice_id, description, charge_kind, is_recurring, quantity, unit_amount, currency)
  select id, 'Base de comisiones (fixture)', 'LICENSE', true, 1, 500, 'USD' from platform.invoices where number = 'DEMO-EXEC-COMM';
  insert into platform.payments (invoice_id, reference, status, amount, currency, paid_at, method)
  select (select id from platform.invoices where number = 'DEMO-EXEC-COMM'), 'DEMO-EXEC-COMM-' || g, 'CONFIRMED', 1, 'USD', now(), 'TRANSFER'
    from generate_series(1, 320) g;
  insert into platform.commission_events
    (sales_agent_id, sales_attribution_id, commission_rule_id, payment_id, saas_product_id,
     status, base_amount, applied_rate, attribution_pct, amount, currency, earned_on, calculation)
  select e.sales_agent_id, e.sales_attribution_id, e.commission_rule_id, p.id, e.saas_product_id,
         'ELIGIBLE', 1, e.applied_rate, e.attribution_pct, 0.10, 'USD', current_date, '{"fixture":"DEMO-EXEC"}'::jsonb
    from platform.payments p
    cross join lateral (select * from platform.commission_events ce
                         where ce.currency = 'USD' and ce.reversal_of_event_id is null
                         order by ce.created_at limit 1) e
   where p.reference like 'DEMO-EXEC-COMM-%';

  -- ---------------------------------------------- Tenant 360: caso de demo
  insert into platform.tenants (id, slug, name, saas_product_id, customer_organization_id, tenant_type, status,
                                deployment_mode, environment, admin_email, metadata)
  values ('5e000000-0000-4000-a000-00000000e001', 'demo-exec-ewm', 'Demo Ejecutivo · EWM',
          '20000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000004',
          'PRODUCTION', 'PENDING', 'SHARED', 'PRODUCTION', 'admin@demo-exec.ebim.test',
          '{"fixture":"DEMO-EXEC"}');
  insert into platform.saas_provisioning_requests
    (id, tenant_id, saas_product_id, deployment_target_id, product_integration_id, idempotency_key,
     status, provisioning_environment, provisioning_policy, attempt_count, requested_at, started_at, completed_at,
     external_reference)
  values ('5e000000-0000-4000-a000-00000000e101', '5e000000-0000-4000-a000-00000000e001',
          '20000000-0000-4000-a000-000000000002', '40000000-0000-4000-a000-000000000007',
          '70000000-0000-4000-a000-000000000001', 'DEMO-EXEC-IDEMP-1', 'ACTIVE', 'DEV', 'MANUAL', 1,
          now() - interval '1 day', now() - interval '1 day', now() - interval '23 hours', 'DEMO-EXEC-REF-1');
  insert into platform.tenant_product_mappings
    (tenant_id, saas_product_id, deployment_target_id, saas_provisioning_request_id, external_tenant_id,
     external_organization_id, status, provisioned_at, metadata)
  values ('5e000000-0000-4000-a000-00000000e001', '20000000-0000-4000-a000-000000000002',
          '40000000-0000-4000-a000-000000000007', '5e000000-0000-4000-a000-00000000e101', 'ewm-demo-company',
          'ewm-demo-org', 'ACTIVE', now() - interval '23 hours',
          '{"resources": {"adminProvisioningStatus": "PREPROVISIONED"}, "fixture": "DEMO-EXEC"}');

  -- Alta SaaS fallida (otro tenant del seed) para «requiere atención».
  insert into platform.saas_provisioning_requests
    (tenant_id, saas_product_id, deployment_target_id, product_integration_id, idempotency_key, status,
     provisioning_environment, provisioning_policy, attempt_count, requested_at, last_error_code,
     last_error_message, provider_http_status)
  values ('50000000-0000-4000-a000-000000000009', '20000000-0000-4000-a000-000000000002',
          '40000000-0000-4000-a000-000000000009', '70000000-0000-4000-a000-000000000001', 'DEMO-EXEC-IDEMP-FAIL',
          'FAILED', 'DEV', 'MANUAL', 3, now() - interval '3 hours', 'PROVIDER_TIMEOUT',
          'El producto no respondió en 15 s (fixture local).', 504);
end;
$$;

commit;
