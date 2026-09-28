-- ============================================================================
-- Rollback de la fase 03 (EBIM Commercial Control Plane) — NO es una migración.
-- ----------------------------------------------------------------------------
-- Se aplica a mano, solo con decisión humana registrada en el ledger, sobre una
-- base LOCAL/desechable primero (plan §4 "Rollback de MasterAdmin", §15).
-- Nunca restaura el autootorgamiento comercial en QAS sin decisión humana.
--
-- Parte A (MA-02): re-aplica las definiciones previas a 20260928000100
-- (copias exactas de 20260902000500, 20260902001100, 20260925100000,
-- 20260913000900 y 20260913001300) y retira los objetos nuevos. No toca datos.
-- ============================================================================
begin;

-- ---- Parte A · DISCOUNT ----------------------------------------------------
create or replace function platform.recalc_invoice_totals()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_invoice uuid := coalesce(new.invoice_id, old.invoice_id);
  v_subtotal numeric(14,2);
begin
  select coalesce(sum(l.amount), 0) into v_subtotal
    from platform.invoice_lines l where l.invoice_id = v_invoice;

  update platform.invoices i
     set subtotal = v_subtotal,
         total = round(v_subtotal + i.tax_amount, 2),
         updated_at = now()
   where i.id = v_invoice;

  return null;
end;
$$;

create or replace view platform.v_subscription_mrr
with (security_invoker = true) as
select
  s.id                        as subscription_id,
  s.saas_product_id,
  s.tenant_id,
  s.billed_organization_id,
  s.currency,
  t.deployment_mode,
  t.tenant_type,
  t.managing_organization_id,
  sum(
    round(
      si.amount * case si.billing_interval
        when 'MONTHLY'   then 1.0
        when 'QUARTERLY' then 1.0 / 3
        when 'YEARLY'    then 1.0 / 12
        else 0.0  -- ONE_TIME nunca entra en MRR
      end, 2)
  ) as mrr
from platform.subscriptions s
join platform.subscription_items si on si.subscription_id = s.id
left join platform.tenants t on t.id = s.tenant_id
where s.status = 'ACTIVE'
  and si.billing_interval <> 'ONE_TIME'
  and si.charge_kind <> 'DISCOUNT'
  and si.valid_from <= current_date
  and (si.valid_to is null or si.valid_to >= current_date)
  -- Regla §2.2: un tenant DEMO nunca aporta MRR.
  and (t.id is null or t.tenant_type <> 'DEMO')
group by s.id, s.saas_product_id, s.tenant_id, s.billed_organization_id, s.currency,
         t.deployment_mode, t.tenant_type, t.managing_organization_id;

create or replace view platform.v_collected_revenue
with (security_invoker = true) as
select
  i.id                     as invoice_id,
  i.customer_organization_id,
  l.saas_product_id,
  l.tenant_id,
  l.charge_kind,
  l.is_recurring,
  i.currency,
  i.period_start,
  i.period_end,
  p.paid_at::date          as collected_on,
  round(l.amount * (p.amount / nullif(i.total, 0)), 2) as collected_amount
from platform.invoices i
join platform.invoice_lines l on l.invoice_id = i.id
join platform.payments p on p.invoice_id = i.id
where p.status = 'CONFIRMED'
  -- DRAFT y VOID nunca cuentan como ingreso (prompt fase 7).
  and i.status in ('ISSUED', 'PARTIALLY_PAID', 'PAID')
  and coalesce(i.total, 0) > 0;

create or replace view platform.v_collected_payments
with (security_invoker = true) as
select
  p.id                              as payment_id,
  p.reference,
  p.method,
  i.id                              as invoice_id,
  i.number                          as invoice_number,
  i.customer_organization_id,
  o.display_name                    as organization_name,
  i.subscription_id,
  i.currency,
  (p.paid_at)::date                 as collected_on,
  date_trunc('month', p.paid_at)::date as collected_month,
  p.amount                          as payment_amount,
  sum(round(l.amount * (p.amount / nullif(i.total, 0)), 2)) as collected_amount
from platform.payments p
join platform.invoices i on i.id = p.invoice_id
join platform.invoice_lines l on l.invoice_id = i.id
left join platform.organizations o on o.id = i.customer_organization_id
where p.status = 'CONFIRMED'
  and i.status in ('ISSUED', 'PARTIALLY_PAID', 'PAID')
  and coalesce(i.total, 0) > 0
group by p.id, p.reference, p.method, i.id, i.number, i.customer_organization_id,
         o.display_name, i.subscription_id, i.currency, p.paid_at, p.amount;

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
        -- V3: un importe fijo o un tope solo tienen sentido en la moneda de la regla.
        if (v_rule.basis = 'FIXED_AMOUNT' or v_rule.max_total_amount is not null)
           and v_rule.currency <> v_line.currency then
          continue;
        end if;

        select count(*) into v_prior_events
          from platform.commission_events e
         where e.sales_attribution_id = v_attr.id
           and e.commission_rule_id = v_rule.id
           and e.status <> 'VOID';

        if not v_rule.is_recurring and v_prior_events > 0 then
          continue;
        end if;

        if v_rule.max_months is not null then
          v_months := (extract(year from age(coalesce(v_payment.paid_at::date, current_date), v_attr.valid_from)) * 12
                     + extract(month from age(coalesce(v_payment.paid_at::date, current_date), v_attr.valid_from)))::integer;
          if v_months >= v_rule.max_months then
            continue;
          end if;
        end if;

        -- Base = porción COBRADA de la línea, en la moneda ORIGINAL del cobro.
        v_base := round(v_line.amount * v_paid_ratio, 2);

        if v_rule.basis = 'FIXED_AMOUNT' then
          v_amount := round(v_rule.fixed_amount * v_attr.attribution_pct, 2);
        else
          v_amount := round(v_base * v_rule.rate * v_attr.attribution_pct, 2);
        end if;

        if v_amount <= 0 then
          continue;
        end if;

        if v_rule.max_total_amount is not null then
          select coalesce(sum(e.amount), 0) into v_accrued
            from platform.commission_events e
           where e.sales_attribution_id = v_attr.id
             and e.commission_rule_id = v_rule.id
             and e.currency = v_rule.currency
             and e.status <> 'VOID';

          if v_accrued >= v_rule.max_total_amount then
            continue;
          end if;
          v_amount := least(v_amount, v_rule.max_total_amount - v_accrued);
        end if;

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
            'rule_currency', v_rule.currency,
            'payment_currency', v_line.currency,
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

create or replace function platform.issue_subscription_invoice(
  p_subscription_id uuid,
  p_period_start    date default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_sub          record;
  v_period_start date;
  v_period_end   date;
  v_existing     record;
  v_invoice_id   uuid;
  v_base_number  text;
  v_number       text;
  v_seq          integer := 1;
  v_due_count    integer;
  v_due_total    numeric(14,2);
  v_lines        integer := 0;
  v_due_days     integer;
  v_total        numeric(14,2);
begin
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin emiten facturas'
      using errcode = '42501';
  end if;

  select s.*, m.code as market_code into v_sub
    from platform.subscriptions s left join platform.markets m on m.id = s.market_id
   where s.id = p_subscription_id;
  if v_sub.id is null then
    raise exception 'SUSCRIPCION_NO_ENCONTRADA: %', p_subscription_id using errcode = '23503';
  end if;
  if v_sub.status not in ('ACTIVE', 'PAST_DUE') then
    raise exception 'SUSCRIPCION_NO_FACTURABLE: la suscripción % está %; solo se factura un contrato activo',
      v_sub.code, v_sub.status
      using errcode = '23514';
  end if;

  v_period_start := date_trunc('month', coalesce(p_period_start, current_date))::date;
  v_period_end   := (v_period_start + interval '1 month' - interval '1 day')::date;

  -- Dos emisiones concurrentes del mismo (suscripción, periodo) se serializan:
  -- la segunda ve la factura de la primera y la devuelve.
  perform pg_advisory_xact_lock(
    hashtextextended('platform.issue_subscription_invoice:' || p_subscription_id::text || ':' || v_period_start::text, 0));

  select i.id, i.number, i.status, i.total, i.currency into v_existing
    from platform.invoices i
   where i.subscription_id = p_subscription_id
     and i.period_start = v_period_start
     and i.status <> 'VOID'
   order by i.created_at
   limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('invoice_id', v_existing.id, 'number', v_existing.number, 'created', false,
                              'currency', v_existing.currency, 'total', v_existing.total, 'status', v_existing.status,
                              'period_start', v_period_start, 'period_end', v_period_end);
  end if;

  -- Billing cadence ANTES de insertar: sin cargos debidos no nace ninguna factura.
  select count(*), coalesce(sum(d.amount), 0) into v_due_count, v_due_total
    from platform.subscription_due_items(v_sub.id, v_period_start) d;

  if v_due_count = 0 then
    raise exception 'SIN_LINEAS_FACTURABLES: la suscripción % no tiene cargos facturables en el periodo %',
      v_sub.code, to_char(v_period_start, 'MM/YYYY')
      using errcode = '23514';
  end if;
  if v_due_total <= 0 then
    raise exception 'SIN_IMPORTE_FACTURABLE: los cargos de la suscripción % en el periodo % suman %; no se emite una factura en cero',
      v_sub.code, to_char(v_period_start, 'MM/YYYY'), v_due_total
      using errcode = '23514';
  end if;

  select coalesce(p.payment_due_days, 15) into v_due_days
    from platform.v_subscription_collection p where p.subscription_id = p_subscription_id;

  -- Una anulada conserva su número: la re-emisión del periodo lleva sufijo -R2, -R3…
  v_base_number := 'INV-' || to_char(v_period_start, 'YYYYMM') || '-' || v_sub.code;
  v_number := v_base_number;
  while exists (select 1 from platform.invoices where number = v_number) loop
    v_seq := v_seq + 1;
    v_number := v_base_number || '-R' || v_seq;
  end loop;

  -- Sin `currency`: la hereda del contrato (guard de moneda transaccional).
  insert into platform.invoices (
    number, customer_organization_id, subscription_id, status, issue_date, due_date,
    period_start, period_end, notes, metadata
  ) values (
    v_number, v_sub.billed_organization_id, v_sub.id, 'ISSUED', current_date,
    current_date + coalesce(v_due_days, 15), v_period_start, v_period_end,
    'Factura gerencial del periodo emitida desde la consola',
    jsonb_build_object('origin', 'console', 'market', v_sub.market_code, 'billing_cadence', 'v3.1')
  )
  returning id into v_invoice_id;

  insert into platform.invoice_lines (
    invoice_id, charge_kind, description, saas_product_id, tenant_id, subscription_item_id,
    quantity, unit_amount, is_recurring
  )
  select v_invoice_id, d.charge_kind, d.description, v_sub.saas_product_id,
         coalesce(d.tenant_id, v_sub.tenant_id), d.subscription_item_id, d.quantity, d.unit_amount,
         d.billing_interval <> 'ONE_TIME'
    from platform.subscription_due_items(v_sub.id, v_period_start) d;
  get diagnostics v_lines = row_count;

  select total into v_total from platform.invoices where id = v_invoice_id;

  perform platform.log_audit(
    'INVOICE_ISSUED', 'invoice', v_invoice_id::text, v_sub.billed_organization_id, v_sub.tenant_id,
    jsonb_build_object('number', v_number, 'subscription', v_sub.code, 'currency', v_sub.currency,
                       'total', v_total, 'lines', v_lines, 'period_start', v_period_start)
  );

  return jsonb_build_object('invoice_id', v_invoice_id, 'number', v_number, 'created', true,
                            'currency', v_sub.currency, 'total', v_total, 'status', 'ISSUED',
                            'period_start', v_period_start, 'period_end', v_period_end, 'lines', v_lines);
end;
$$;

create or replace function platform.get_subscription_billing_status(
  p_subscription_id uuid,
  p_period_start    date default null
)
returns jsonb
language plpgsql
stable
set search_path = platform, pg_catalog
as $$
declare
  v_sub          record;
  v_period_start date := date_trunc('month', coalesce(p_period_start, current_date))::date;
  v_existing     record;
  v_due_count    integer;
  v_due_total    numeric(14,2);
  v_billable     boolean;
  v_next         date;
  v_candidate    date;
begin
  select s.id, s.code, s.status, s.currency into v_sub
    from platform.subscriptions s where s.id = p_subscription_id;
  if v_sub.id is null then
    raise exception 'SUSCRIPCION_NO_ENCONTRADA: %', p_subscription_id using errcode = '23503';
  end if;

  v_billable := v_sub.status in ('ACTIVE', 'PAST_DUE');

  select i.id, i.number, i.status, i.total, i.currency into v_existing
    from platform.invoices i
   where i.subscription_id = p_subscription_id and i.period_start = v_period_start and i.status <> 'VOID'
   order by i.created_at limit 1;

  select count(*), coalesce(sum(d.amount), 0) into v_due_count, v_due_total
    from platform.subscription_due_items(p_subscription_id, v_period_start) d;

  -- Próximo periodo con cargos y sin factura vigente, desde el periodo consultado.
  -- 13 meses cubren cualquier cadencia (YEARLY ya facturado este mes → +12).
  if v_billable then
    for i in 0..12 loop
      v_candidate := (v_period_start + make_interval(months => i))::date;
      if exists (select 1 from platform.subscription_due_items(p_subscription_id, v_candidate) d where d.amount > 0)
         and not exists (select 1 from platform.invoices inv
                          where inv.subscription_id = p_subscription_id
                            and inv.period_start = v_candidate and inv.status <> 'VOID') then
        v_next := v_candidate;
        exit;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'subscription_id', v_sub.id,
    'currency', v_sub.currency,
    'period_start', v_period_start,
    'period_end', (v_period_start + interval '1 month' - interval '1 day')::date,
    'subscription_billable', v_billable,
    'has_due_items', v_due_count > 0,
    'due_item_count', v_due_count,
    'estimated_total', v_due_total,
    'existing_invoice', case when v_existing.id is null then null else
      jsonb_build_object('invoice_id', v_existing.id, 'number', v_existing.number,
                         'status', v_existing.status, 'total', v_existing.total, 'currency', v_existing.currency) end,
    'can_issue', v_billable and v_existing.id is null and v_due_count > 0 and v_due_total > 0,
    'next_billing_period', v_next
  );
end;
$$;

drop view if exists platform.v_discount_sign_legacy_invoices;
drop function if exists platform.signed_line_amount(platform.charge_kind, numeric);

-- ---- Parte B · autootorgamiento (MA-03) ------------------------------------
-- (se completa en MA-03)

commit;
