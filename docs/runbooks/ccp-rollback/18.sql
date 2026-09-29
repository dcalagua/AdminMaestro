-- ============================================================================
-- Rollback de la fase 18 (EBIM Commercial Control Plane) — NO es una migración.
-- ----------------------------------------------------------------------------
-- Plan §15 fila 18: "por tenant, BILLING_LEGACY; facturas DRAFT de MasterAdmin
-- anuladas; nunca VOID sobre pagos CONFIRMED". Migraciones 20261008000050…0200.
-- El rollback DESACTIVA, nunca borra: columnas, líneas ya emitidas, ítems y
-- entradas del ledger se conservan (append-only / evidencia contable).
-- Se aplica a mano, solo con decisión humana registrada en el ledger, primero
-- sobre una base LOCAL/desechable.
--
-- Efecto:
--   A. EXECUTE revocado de las RPCs nuevas (compra de créditos, correctivos,
--      vínculos de tarifa por uso y paquetes).
--   B. issue_subscription_invoice, generate_commission_events,
--      set_catalog_item_price y enforce_subscription_item_price_ref vuelven a
--      su definición anterior (20260928000100 / 20260929000400 / …0550): la
--      emisión deja de añadir uso, créditos y correctivos.
--   C. Se retiran los guards de ítems vinculados y de vínculos de línea (las
--      líneas ya emitidas no cambian).
--   D. SE CONSERVA invoices_void_guard: "nunca VOID sobre pagos CONFIRMED" es
--      una regla de la spec §13.2.3, no una función nueva que revertir.
--   E. El valor de enum CREDIT_PURCHASE queda sin uso (no existe DROP VALUE).
-- Una factura emitida con líneas de uso NO se anula si tiene cobros CONFIRMED:
-- se corrige con un DISCOUNT manual en la siguiente (spec §13.2).
-- ============================================================================
begin;

select platform.log_audit('BILLING_ROLLBACK_PHASE_18', 'platform', 'billing', null, null,
                          jsonb_build_object('runbook', 'docs/runbooks/ccp-rollback/18.sql'));

-- ---- A · EXECUTE -----------------------------------------------------------
revoke execute on function platform.purchase_ai_credits(uuid, text, integer, text, date, text, text) from authenticated;
revoke execute on function platform.schedule_corrective_discount(uuid, numeric, text) from authenticated;
revoke execute on function platform.set_catalog_item_usage_binding(text, text, text, text) from authenticated;
revoke execute on function platform.set_catalog_item_credit_pack(text, numeric, text) from authenticated;

-- ---- C · guards de fase 18 ---------------------------------------------------
drop trigger if exists invoice_lines_billing_links_guard on platform.invoice_lines;
drop trigger if exists subscription_items_linked_guard on platform.subscription_items;
drop trigger if exists subscription_items_price_ref_guard on platform.subscription_items;
create trigger subscription_items_price_ref_guard
  before insert or update of source_type, price_ref on platform.subscription_items
  for each row execute function platform.enforce_subscription_item_price_ref();

-- ---- B · definiciones anteriores (copias exactas) ------------------------------
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
  -- CCP P-01: el total debido es FIRMADO (DISCOUNT resta), igual que la factura.
  select count(*), coalesce(sum(platform.signed_line_amount(d.charge_kind, d.amount)), 0)
    into v_due_count, v_due_total
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
       -- CCP P-01: un DISCOUNT no es base de comisión (ni suma ni resta; D-11 abierto).
       and l.charge_kind <> 'DISCOUNT'
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

create or replace function platform.set_catalog_item_price(
  p_catalog_item_code text,
  p_market_code       text,
  p_charge_kind       platform.charge_kind,
  p_billing_interval  platform.billing_interval,
  p_amount            numeric,
  p_currency          char(3),
  p_valid_from        date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id       uuid;
  v_item     record;
  v_current  record;
  v_market   platform.markets;
  v_currency char(3);
  v_clash    record;
begin
  if not platform.can_manage_regional_catalog() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin fijan tarifas de add-on'
      using errcode = '42501';
  end if;

  select id, code into v_item from platform.catalog_items where code = p_catalog_item_code;
  if v_item.id is null then
    raise exception 'ADDON_NO_ENCONTRADO: %', p_catalog_item_code using errcode = '23503';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'IMPORTE_INVALIDO: la tarifa no puede ser negativa' using errcode = '23514';
  end if;
  if p_charge_kind is null or p_charge_kind not in ('ADDON', 'IMPLEMENTATION_FEE', 'USAGE_OVERAGE') then
    raise exception 'CARGO_INVALIDO: un add-on se tarifa como ADDON, IMPLEMENTATION_FEE o USAGE_OVERAGE (no %)', p_charge_kind
      using errcode = '23514';
  end if;
  if nullif(trim(coalesce(p_currency, '')), '') is null then
    raise exception 'MONEDA_REQUERIDA: una tarifa declara su moneda explícitamente' using errcode = '23502';
  end if;
  if p_valid_from is null then
    raise exception 'VIGENCIA_INVALIDA: la tarifa necesita fecha de inicio' using errcode = '23502';
  end if;

  v_market   := platform.require_active_market(p_market_code);
  v_currency := platform.resolve_market_currency(v_market.id, p_currency);

  select * into v_current
    from platform.catalog_item_prices
   where catalog_item_id = v_item.id
     and market_id = v_market.id
     and charge_kind = p_charge_kind
     and billing_interval = p_billing_interval
     and currency = v_currency
     and valid_to is null;

  if v_current.id is not null then
    if v_current.valid_from >= p_valid_from then
      raise exception 'VIGENCIA_INVALIDA: la tarifa abierta empieza el % y la nueva pretende empezar el %; una tarifa nueva no puede solapar hacia atrás',
        v_current.valid_from, p_valid_from
        using errcode = '23514';
    end if;
    if v_current.amount = p_amount then
      return v_current.id;
    end if;
  end if;

  select p.id, p.valid_from, p.valid_to into v_clash
    from platform.catalog_item_prices p
   where p.catalog_item_id = v_item.id
     and p.market_id = v_market.id
     and p.charge_kind = p_charge_kind
     and p.billing_interval = p_billing_interval
     and p.currency = v_currency
     and p.valid_to is not null
     and p.valid_to >= p_valid_from
   limit 1;
  if v_clash.id is not null then
    raise exception 'TARIFA_SOLAPADA: ya existe una tarifa % del % al % en ese mercado y moneda',
      p_charge_kind, v_clash.valid_from, v_clash.valid_to
      using errcode = '23514';
  end if;

  if v_current.id is not null then
    update platform.catalog_item_prices set valid_to = p_valid_from - 1 where id = v_current.id;
  end if;

  insert into platform.catalog_item_prices (
    catalog_item_id, market_id, charge_kind, billing_interval, amount, currency, valid_from
  ) values (
    v_item.id, v_market.id, p_charge_kind, p_billing_interval, p_amount, v_currency, p_valid_from
  )
  returning id into v_id;

  perform platform.log_audit(
    'ADDON_PRICE_VERSIONED', 'catalog_item_price', v_id::text, null, null,
    jsonb_build_object(
      'catalog_item', v_item.code, 'market', v_market.code, 'charge_kind', p_charge_kind,
      'billing_interval', p_billing_interval, 'amount', p_amount, 'currency', v_currency,
      'valid_from', p_valid_from, 'closed_price_id', v_current.id, 'previous_amount', v_current.amount
    )
  );

  return v_id;
end;
$$;

create or replace function platform.enforce_subscription_item_price_ref()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if new.price_ref is null then
    return new;
  end if;
  if new.source_type = 'PLAN'
     and not exists (select 1 from platform.plan_prices where id = new.price_ref) then
    raise exception 'PRICE_REF_INVALIDO: % no es una tarifa de plan', new.price_ref using errcode = '23503';
  end if;
  if new.source_type in ('ADDON', 'USAGE')
     and not exists (select 1 from platform.catalog_item_prices where id = new.price_ref) then
    raise exception 'PRICE_REF_INVALIDO: % no es una tarifa de add-on', new.price_ref using errcode = '23503';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 20261008000300_ccp_billing_shadow_comparison (D-14, BILLING_SHADOW)
-- Solo se revoca: la tabla append-only queda como evidencia de las
-- comparaciones ya hechas. El eje de facturación vuelve un paso con
-- set_commercial_cutover_state(<integración>, 'BILLING', 'BILLING_LEGACY', '<motivo>').
-- ---------------------------------------------------------------------------
revoke execute on function platform.record_billing_shadow_comparison(text, uuid, date, jsonb, text) from authenticated, service_role;
revoke execute on function platform.billing_shadow_expected_lines(text, uuid, date) from authenticated, service_role;

commit;
