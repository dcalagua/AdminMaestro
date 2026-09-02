-- ============================================================================
-- EBIM Control Plane — 10 · Funciones de negocio
-- ----------------------------------------------------------------------------
--   platform.create_tenant()               -> contrato §3.2 ADMIN_EMAIL_REQUERIDO
--   platform.generate_commission_events()  -> comisión desde COBROS (fase 6)
--   platform.settle_commissions()          -> liquidación por periodo
-- ============================================================================

-- ---------------------------------------------------------------------------
-- create_tenant — ÚNICA vía autorizada para dar de alta un tenant.
--
-- Contrato §3.2: "La validación vive en la función que crea el tenant (la base),
-- no solo en la pantalla o la edge function. Un parámetro con default null es la
-- puerta por la que se cuela un espacio sin dueño."
--
-- Por eso p_admin_email NO tiene default: quien llame debe pasarlo o el alta
-- falla en la firma, antes incluso de entrar al cuerpo.
-- ---------------------------------------------------------------------------
create or replace function platform.create_tenant(
  p_saas_product_code       text,
  p_customer_organization_id uuid,
  p_slug                    text,
  p_name                    text,
  p_admin_email             text,
  p_tenant_type             platform.tenant_type default 'PRODUCTION',
  p_deployment_mode         platform.deployment_mode default 'SHARED',
  p_managing_organization_id uuid default null,
  p_company_id              uuid default null,
  p_metadata                jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_product_id uuid;
  v_tenant_id  uuid;
  v_email      text := lower(nullif(trim(coalesce(p_admin_email, '')), ''));
begin
  -- ---- Regla dura del contrato §3.2 ------------------------------------
  if v_email is null then
    raise exception 'ADMIN_EMAIL_REQUERIDO: crear un tenant exige el correo de un administrador de esa empresa (contrato §3.2)'
      using errcode = '23502';
  end if;

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-zA-Z]{2,}$' then
    raise exception 'ADMIN_EMAIL_REQUERIDO: "%" no es un correo válido (contrato §3.2)', p_admin_email
      using errcode = '23514';
  end if;

  -- Contrato §13.2: el dominio operador no es actor de negocio de un cliente.
  if v_email like '%@ebim.pe' then
    raise exception 'DOMINIO_OPERADOR_BLOQUEADO: % pertenece al dominio operador y no puede ser administrador de un tenant cliente (contrato §13.2)', v_email
      using errcode = '42501';
  end if;

  -- ---- Autorización -----------------------------------------------------
  if not (
    platform.can_manage_platform_entities()
    or platform.is_org_admin(p_customer_organization_id)
    or (p_managing_organization_id is not null and platform.is_org_admin(p_managing_organization_id))
  ) then
    raise exception 'NO_AUTORIZADO: no tiene permisos para crear tenants en esta organización'
      using errcode = '42501';
  end if;

  select sp.id into v_product_id
    from platform.saas_products sp where sp.code = p_saas_product_code;

  if v_product_id is null then
    raise exception 'PRODUCTO_NO_ENCONTRADO: no existe el SaaS con código "%"', p_saas_product_code
      using errcode = '23503';
  end if;

  insert into platform.tenants (
    slug, name, saas_product_id, customer_organization_id, managing_organization_id,
    company_id, tenant_type, deployment_mode, environment, admin_email, status, metadata
  )
  values (
    p_slug, p_name, v_product_id, p_customer_organization_id, p_managing_organization_id,
    p_company_id, p_tenant_type, p_deployment_mode,
    -- El entorno sigue al tipo de tenant salvo que se configure aparte.
    case p_tenant_type
      when 'DEMO' then 'DEMO'::platform.environment_kind
      when 'TRIAL' then 'TRIAL'::platform.environment_kind
      when 'SANDBOX' then 'SANDBOX'::platform.environment_kind
      else 'PRODUCTION'::platform.environment_kind
    end,
    v_email, 'PENDING', coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_tenant_id;

  perform platform.log_audit(
    'TENANT_CREATED', 'tenant', v_tenant_id::text,
    p_customer_organization_id, v_tenant_id,
    jsonb_build_object(
      'product', p_saas_product_code,
      'tenant_type', p_tenant_type,
      'deployment_mode', p_deployment_mode,
      'admin_email', v_email
    )
  );

  return v_tenant_id;
end;
$$;

comment on function platform.create_tenant is
  'Alta de tenant. Contrato §3.2: sin correo de administrador el alta FALLA con '
  'ADMIN_EMAIL_REQUERIDO. La validación está aquí, en la base, no sólo en la UI.';

revoke all on function platform.create_tenant from public, anon;
grant execute on function platform.create_tenant to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- generate_commission_events — el corazón del modelo de comisiones.
--
-- Reglas implementadas:
--   1. Sólo pagos CONFIRMED. Una factura impaga no devenga nada.
--   2. La base es la porción COBRADA de cada línea elegible, no el monto facturado
--      (un pago parcial devenga comisión parcial).
--   3. La regla se elige por `basis` vs `charge_kind` de la línea.
--   4. Reglas no recurrentes sólo aplican al primer cobro de esa atribución.
--   5. Topes (`max_months`, `max_total_amount`) se evalúan contra lo ya devengado.
--   6. Idempotente: reprocesar el mismo pago no duplica eventos.
-- ---------------------------------------------------------------------------
create or replace function platform.generate_commission_events(p_payment_id uuid)
returns integer
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_payment      record;
  v_invoice      record;
  v_line         record;
  v_attr         record;
  v_rule         record;
  v_paid_ratio   numeric(12,8);
  v_base         numeric(14,2);
  v_amount       numeric(14,2);
  v_accrued      numeric(14,2);
  v_months       integer;
  v_prior_events integer;
  v_created      integer := 0;
begin
  select * into v_payment from platform.payments where id = p_payment_id;
  if v_payment is null then
    raise exception 'PAGO_NO_ENCONTRADO: %', p_payment_id using errcode = '23503';
  end if;

  -- (1) Sólo cobros confirmados generan comisión.
  if v_payment.status <> 'CONFIRMED' then
    return 0;
  end if;

  select * into v_invoice from platform.invoices where id = v_payment.invoice_id;
  if v_invoice.status in ('DRAFT', 'VOID') then
    return 0;
  end if;
  if coalesce(v_invoice.total, 0) <= 0 then
    return 0;
  end if;

  -- (2) Proporción cobrada por este pago sobre el total de la factura.
  v_paid_ratio := least(v_payment.amount / v_invoice.total, 1.0);

  for v_line in
    select l.* from platform.invoice_lines l
     where l.invoice_id = v_invoice.id and l.amount > 0
  loop
    for v_attr in
      select a.*
        from platform.sales_attributions a
       where a.status = 'ACTIVE'
         and a.commission_plan_id is not null
         and a.saas_product_id = coalesce(v_line.saas_product_id, a.saas_product_id)
         and (
           (v_line.tenant_id is not null and a.tenant_id = v_line.tenant_id)
           or (v_invoice.subscription_id is not null and a.subscription_id = v_invoice.subscription_id)
           or (v_line.tenant_id is not null and a.subscription_id is not null and exists (
                 select 1 from platform.subscriptions s
                  where s.id = a.subscription_id and s.tenant_id = v_line.tenant_id))
         )
         and a.valid_from <= coalesce(v_payment.paid_at::date, current_date)
         and (a.valid_to is null or a.valid_to >= coalesce(v_payment.paid_at::date, current_date))
    loop
      for v_rule in
        select r.*
          from platform.commission_rules r
         where r.commission_plan_id = v_attr.commission_plan_id
           and r.status = 'ACTIVE'
           and r.valid_from <= coalesce(v_payment.paid_at::date, current_date)
           and (r.valid_to is null or r.valid_to >= coalesce(v_payment.paid_at::date, current_date))
           -- (3) La regla debe aplicar a este tipo de cargo.
           and (
             (r.basis = 'COLLECTED_LICENSE' and v_line.charge_kind in
                ('LICENSE', 'TENANT_LICENSE', 'PARTNER_BASE_LICENSE'))
             or (r.basis = 'COLLECTED_IMPLEMENTATION' and v_line.charge_kind = 'IMPLEMENTATION_FEE')
             or (r.basis = 'COLLECTED_ANY')
             or (r.basis = 'FIXED_AMOUNT')
           )
           and (r.charge_kind is null or r.charge_kind = v_line.charge_kind)
         order by r.priority, r.created_at
      loop
        -- (4) Regla no recurrente: sólo el primer cobro de esa atribución.
        select count(*) into v_prior_events
          from platform.commission_events e
         where e.sales_attribution_id = v_attr.id
           and e.commission_rule_id = v_rule.id
           and e.status <> 'VOID';

        if not v_rule.is_recurring and v_prior_events > 0 then
          continue;
        end if;

        -- (5a) Tope de meses desde el inicio de la atribución.
        if v_rule.max_months is not null then
          v_months := (extract(year from age(coalesce(v_payment.paid_at::date, current_date), v_attr.valid_from)) * 12
                     + extract(month from age(coalesce(v_payment.paid_at::date, current_date), v_attr.valid_from)))::integer;
          if v_months >= v_rule.max_months then
            continue;
          end if;
        end if;

        v_base := round(v_line.amount * v_paid_ratio, 2);

        if v_rule.basis = 'FIXED_AMOUNT' then
          v_amount := round(v_rule.fixed_amount * v_attr.attribution_pct, 2);
        else
          v_amount := round(v_base * v_rule.rate * v_attr.attribution_pct, 2);
        end if;

        if v_amount <= 0 then
          continue;
        end if;

        -- (5b) Tope de monto acumulado por atribución.
        if v_rule.max_total_amount is not null then
          select coalesce(sum(e.amount), 0) into v_accrued
            from platform.commission_events e
           where e.sales_attribution_id = v_attr.id
             and e.commission_rule_id = v_rule.id
             and e.status <> 'VOID';

          if v_accrued >= v_rule.max_total_amount then
            continue;
          end if;
          v_amount := least(v_amount, v_rule.max_total_amount - v_accrued);
        end if;

        -- (6) Idempotencia por índice único.
        insert into platform.commission_events (
          sales_agent_id, sales_attribution_id, commission_rule_id, payment_id,
          invoice_line_id, saas_product_id, tenant_id, status,
          base_amount, applied_rate, attribution_pct, amount, currency, earned_on, calculation
        )
        values (
          v_attr.sales_agent_id, v_attr.id, v_rule.id, v_payment.id,
          v_line.id, v_attr.saas_product_id, coalesce(v_line.tenant_id, v_attr.tenant_id), 'ELIGIBLE',
          v_base, v_rule.rate, v_attr.attribution_pct, v_amount, v_line.currency,
          coalesce(v_payment.paid_at::date, current_date),
          jsonb_build_object(
            'rule_name', v_rule.name,
            'basis', v_rule.basis,
            'charge_kind', v_line.charge_kind,
            'rate', v_rule.rate,
            'fixed_amount', v_rule.fixed_amount,
            'invoice_line_amount', v_line.amount,
            'payment_ratio', round(v_paid_ratio, 6),
            'base_amount', v_base,
            'attribution_pct', v_attr.attribution_pct,
            'max_months', v_rule.max_months,
            'max_total_amount', v_rule.max_total_amount,
            'formula', case when v_rule.basis = 'FIXED_AMOUNT'
                            then 'fixed_amount * attribution_pct'
                            else 'invoice_line_amount * payment_ratio * rate * attribution_pct' end
          )
        )
        on conflict do nothing;

        if found then
          v_created := v_created + 1;
        end if;
      end loop;
    end loop;
  end loop;

  return v_created;
end;
$$;

comment on function platform.generate_commission_events(uuid) is
  'Devenga comisión a partir de un COBRO confirmado. Nunca desde el alta de un tenant '
  'ni desde la emisión de una factura. Idempotente.';

revoke all on function platform.generate_commission_events(uuid) from public, anon;
grant execute on function platform.generate_commission_events(uuid) to authenticated, service_role;

-- Automatiza el devengo al confirmarse un pago.
create or replace function platform.on_payment_confirmed()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if new.status = 'CONFIRMED' and (tg_op = 'INSERT' or old.status is distinct from 'CONFIRMED') then
    perform platform.generate_commission_events(new.id);
  end if;
  return null;
end;
$$;

create trigger payments_generate_commissions
  after insert or update of status on platform.payments
  for each row execute function platform.on_payment_confirmed();

-- ---------------------------------------------------------------------------
-- settle_commissions — agrupa eventos ELIGIBLE/ACCRUED de un periodo en una
-- liquidación. No paga: deja la liquidación OPEN para aprobación.
-- ---------------------------------------------------------------------------
create or replace function platform.settle_commissions(
  p_sales_agent_id uuid,
  p_period_start   date,
  p_period_end     date,
  p_currency       char(3) default 'USD'
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_settlement_id uuid;
  v_code text;
  v_count integer;
begin
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: sólo EBIM_FINANCE o el super admin liquidan comisiones'
      using errcode = '42501';
  end if;

  if p_period_end < p_period_start then
    raise exception 'PERIODO_INVALIDO: el fin (%) es anterior al inicio (%)', p_period_end, p_period_start
      using errcode = '22007';
  end if;

  select 'STL-' || sa.code || '-' || to_char(p_period_start, 'YYYYMM') into v_code
    from platform.sales_agents sa where sa.id = p_sales_agent_id;

  if v_code is null then
    raise exception 'COMERCIAL_NO_ENCONTRADO: %', p_sales_agent_id using errcode = '23503';
  end if;

  insert into platform.commission_settlements (
    code, sales_agent_id, period_start, period_end, currency, status
  )
  values (v_code, p_sales_agent_id, p_period_start, p_period_end, p_currency, 'OPEN')
  on conflict (code) do update set updated_at = now()
  returning id into v_settlement_id;

  update platform.commission_events e
     set settlement_id = v_settlement_id,
         status = 'ACCRUED',
         updated_at = now()
   where e.sales_agent_id = p_sales_agent_id
     and e.settlement_id is null
     and e.status = 'ELIGIBLE'
     and e.currency = p_currency
     and e.earned_on between p_period_start and p_period_end;

  get diagnostics v_count = row_count;

  perform platform.log_audit(
    'COMMISSIONS_SETTLED', 'commission_settlement', v_settlement_id::text,
    null, null,
    jsonb_build_object('events', v_count, 'period_start', p_period_start, 'period_end', p_period_end)
  );

  return v_settlement_id;
end;
$$;

revoke all on function platform.settle_commissions from public, anon;
grant execute on function platform.settle_commissions to authenticated, service_role;
