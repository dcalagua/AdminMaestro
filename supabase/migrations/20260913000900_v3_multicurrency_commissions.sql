-- ============================================================================
-- EBIM Control Plane V3 — 32 · Comisiones multimoneda
-- ----------------------------------------------------------------------------
-- Fase 11 de `.claude-prompts-v3-multicurrency`. Cierra G-23..G-26 (R-4..R-6).
--
-- REGLAS:
--   · un evento de comisión está en la moneda de su COBRO (guard de la fase 06);
--   · el porcentaje se aplica sobre el importe ORIGINAL cobrado, en su moneda;
--   · una liquidación es MONO-MONEDA: no admite eventos de otra moneda;
--   · un reverso conserva la moneda del evento que compensa;
--   · un importe FIJO o un TOPE están expresados en la moneda de la regla y
--     solo se aplican a cobros en esa moneda: USD 50 no son «PEN 50»;
--   · liquidar exige moneda explícita: ya no hay `default 'USD'`.
--
-- El dashboard puede convertir comisiones a la moneda de reporte (fase 10),
-- pero solo como analítica: ninguna liquidación se paga en un equivalente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. G-24 (R-5) · evento ↔ liquidación en la misma moneda.
-- ---------------------------------------------------------------------------
create or replace function platform.enforce_settlement_currency()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_settlement record;
begin
  if new.settlement_id is null then
    return new;
  end if;

  select s.code, s.currency into v_settlement
    from platform.commission_settlements s where s.id = new.settlement_id;

  if v_settlement.code is not null and v_settlement.currency <> new.currency then
    raise exception 'LIQUIDACION_MULTIMONEDA: la liquidación % es en % y el evento de comisión es en %; una liquidación no mezcla monedas',
      v_settlement.code, v_settlement.currency, new.currency
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger commission_events_settlement_currency_guard
  before insert or update of settlement_id, currency on platform.commission_events
  for each row execute function platform.enforce_settlement_currency();

-- La moneda de una liquidación con eventos no cambia: sería relabelar lo liquidado.
create or replace function platform.enforce_settlement_currency_immutable()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if new.currency is distinct from old.currency
     and exists (select 1 from platform.commission_events e where e.settlement_id = old.id) then
    raise exception 'MONEDA_DOCUMENTO_INMUTABLE: la liquidación % ya tiene eventos en %', old.code, old.currency
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger settlements_currency_immutable
  before update of currency on platform.commission_settlements
  for each row execute function platform.enforce_settlement_currency_immutable();

-- ---------------------------------------------------------------------------
-- 2. G-23 (R-4) + G-26 · settle_commissions con moneda obligatoria.
--
-- V2: código STL-<agente>-<YYYYMM> SIN moneda y `on conflict (code) do update`:
-- liquidar BOB y luego PEN en el mismo mes reutilizaba la liquidación BOB y le
-- colgaba eventos PEN. Y si esa liquidación ya estaba PAGADA, le añadía eventos
-- nuevos. Ahora el código lleva la moneda y una liquidación no OPEN no se toca.
-- Las liquidaciones históricas conservan su código.
-- ---------------------------------------------------------------------------
drop function if exists platform.settle_commissions(uuid, date, date, character);

create or replace function platform.settle_commissions(
  p_sales_agent_id uuid,
  p_period_start   date,
  p_period_end     date,
  p_currency       char(3)
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_settlement record;
  v_code       text;
  v_currency   char(3) := upper(nullif(trim(coalesce(p_currency, '')), ''));
  v_count      integer;
begin
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: sólo EBIM_FINANCE o el super admin liquidan comisiones'
      using errcode = '42501';
  end if;

  if v_currency is null then
    raise exception 'MONEDA_REQUERIDA: una liquidación es mono-moneda; indica PEN, BOB, USD...'
      using errcode = '23502';
  end if;
  if not exists (select 1 from platform.currencies c where c.code = v_currency) then
    raise exception 'MONEDA_INVALIDA: "%" no está en el catálogo', p_currency using errcode = '23503';
  end if;

  if p_period_end < p_period_start then
    raise exception 'PERIODO_INVALIDO: el fin (%) es anterior al inicio (%)', p_period_end, p_period_start
      using errcode = '22007';
  end if;

  select 'STL-' || sa.code || '-' || to_char(p_period_start, 'YYYYMM') || '-' || v_currency into v_code
    from platform.sales_agents sa where sa.id = p_sales_agent_id;

  if v_code is null then
    raise exception 'COMERCIAL_NO_ENCONTRADO: %', p_sales_agent_id using errcode = '23503';
  end if;

  select * into v_settlement from platform.commission_settlements where code = v_code;

  if v_settlement.id is not null and v_settlement.status <> 'OPEN' then
    raise exception 'LIQUIDACION_CERRADA: la liquidación % está %; no admite eventos nuevos',
      v_code, v_settlement.status
      using errcode = '23514';
  end if;

  if v_settlement.id is null then
    insert into platform.commission_settlements (
      code, sales_agent_id, period_start, period_end, currency, status
    )
    values (v_code, p_sales_agent_id, p_period_start, p_period_end, v_currency, 'OPEN')
    returning * into v_settlement;
  end if;

  update platform.commission_events e
     set settlement_id = v_settlement.id,
         status = 'ACCRUED',
         updated_at = now()
   where e.sales_agent_id = p_sales_agent_id
     and e.settlement_id is null
     and e.status = 'ELIGIBLE'
     and e.currency = v_currency
     and e.earned_on between p_period_start and p_period_end;

  get diagnostics v_count = row_count;

  perform platform.log_audit(
    'COMMISSIONS_SETTLED', 'commission_settlement', v_settlement.id::text,
    null, null,
    jsonb_build_object('code', v_code, 'currency', v_currency, 'events', v_count,
                       'period_start', p_period_start, 'period_end', p_period_end)
  );

  return v_settlement.id;
end;
$$;

comment on function platform.settle_commissions(uuid, date, date, char) is
  'Liquidación MONO-MONEDA por comercial, periodo y moneda (código STL-<agente>-<YYYYMM>-<MON>). '
  'Moneda obligatoria. No toca liquidaciones APPROVED/PAID.';

-- ---------------------------------------------------------------------------
-- 3. G-25 (R-6) · generate_commission_events: fijos y topes en SU moneda.
--
-- Único cambio frente al baseline (resto del cuerpo idéntico):
--   · FIXED_AMOUNT solo devenga si el cobro está en la moneda de la regla;
--   · `max_total_amount` suma solo eventos en la moneda de la regla, y una
--     regla con tope no devenga sobre cobros en otra moneda (no hay forma de
--     comparar el tope sin un tipo de cambio, y el FX no toca documentos).
--   Una regla porcentual sin tope es agnóstica de moneda: rate × importe original.
--   El motivo de cada omisión queda en el snapshot `calculation` de los eventos
--   que sí se generan (`rule_currency`) y en la documentación (DV3-015).
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

comment on function platform.generate_commission_events(uuid) is
  'Devenga comisión desde un COBRO confirmado, en la moneda del cobro. Importes fijos y topes '
  'solo se aplican a cobros en la moneda de la regla. Idempotente.';

-- ---------------------------------------------------------------------------
-- 4. upsert_commission_rule sin `p_currency default 'USD'`.
-- ---------------------------------------------------------------------------
drop function if exists platform.upsert_commission_rule(
  uuid, text, platform.commission_basis, numeric, numeric, character, platform.charge_kind,
  boolean, integer, numeric, integer, date, date, platform.entity_status, uuid
);

create or replace function platform.upsert_commission_rule(
  p_commission_plan_id uuid,
  p_name               text,
  p_basis              platform.commission_basis,
  p_rate               numeric default null,
  p_fixed_amount       numeric default null,
  -- Moneda en la que se expresan `fixed_amount` y `max_total_amount`. Obligatoria.
  p_currency           char(3) default null,
  p_charge_kind        platform.charge_kind default null,
  p_is_recurring       boolean default true,
  p_max_months         integer default null,
  p_max_total_amount   numeric default null,
  p_priority           integer default 100,
  p_valid_from         date default current_date,
  p_valid_to           date default null,
  p_status             platform.entity_status default 'ACTIVE',
  p_id                 uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id       uuid;
  v_is_new   boolean := p_id is null;
  v_used     integer;
  v_currency char(3) := upper(nullif(trim(coalesce(p_currency, '')), ''));
begin
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin definen reglas de comisión'
      using errcode = '42501';
  end if;

  if v_currency is null then
    raise exception 'MONEDA_REQUERIDA: la regla declara la moneda de su importe fijo y de su tope'
      using errcode = '23502';
  end if;
  if not platform.is_currency_active(v_currency) then
    raise exception 'MONEDA_INACTIVA: % no existe o está inactiva', v_currency using errcode = '23514';
  end if;

  if p_basis = 'FIXED_AMOUNT' then
    if coalesce(p_fixed_amount, 0) <= 0 then
      raise exception 'IMPORTE_FIJO_REQUERIDO: una regla FIXED_AMOUNT necesita fixed_amount > 0'
        using errcode = '23514';
    end if;
  else
    if p_rate is null or p_rate <= 0 or p_rate > 1 then
      raise exception 'TASA_INVALIDA: rate debe estar en (0, 1]; recibido %', p_rate using errcode = '23514';
    end if;
  end if;

  if v_is_new then
    insert into platform.commission_rules (
      commission_plan_id, name, basis, rate, fixed_amount, currency, charge_kind,
      is_recurring, max_months, max_total_amount, priority, valid_from, valid_to, status
    ) values (
      p_commission_plan_id, trim(p_name), p_basis, p_rate, p_fixed_amount, v_currency, p_charge_kind,
      coalesce(p_is_recurring, true), p_max_months, p_max_total_amount, p_priority,
      p_valid_from, p_valid_to, p_status
    )
    returning id into v_id;
  else
    select count(*) into v_used
      from platform.commission_events where commission_rule_id = p_id and status <> 'VOID';

    if v_used > 0 then
      -- La moneda también es un término económico: cambiarla relabelaría lo devengado.
      if exists (
        select 1 from platform.commission_rules r
         where r.id = p_id
           and (r.basis is distinct from p_basis
             or r.rate is distinct from p_rate
             or r.fixed_amount is distinct from p_fixed_amount
             or r.currency is distinct from v_currency
             or r.charge_kind is distinct from p_charge_kind)
      ) then
        raise exception 'REGLA_YA_DEVENGADA: la regla % ya generó % comisión(es); no se pueden cambiar sus términos económicos retroactivamente. Cierra esta regla y crea una versión nueva.',
          p_id, v_used
          using errcode = '23514';
      end if;
    end if;

    update platform.commission_rules
       set name = trim(p_name), basis = p_basis, rate = p_rate, fixed_amount = p_fixed_amount,
           currency = v_currency, charge_kind = p_charge_kind,
           is_recurring = coalesce(p_is_recurring, true), max_months = p_max_months,
           max_total_amount = p_max_total_amount, priority = p_priority,
           valid_from = p_valid_from, valid_to = p_valid_to, status = p_status
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'REGLA_NO_ENCONTRADA: %', p_id using errcode = '23503';
    end if;
  end if;

  perform platform.log_audit(
    case when v_is_new then 'COMMISSION_RULE_CREATED' else 'COMMISSION_RULE_UPDATED' end,
    'commission_rule', v_id::text, null, null,
    jsonb_build_object('plan', p_commission_plan_id, 'basis', p_basis, 'rate', p_rate,
                       'fixed_amount', p_fixed_amount, 'currency', v_currency,
                       'max_total_amount', p_max_total_amount, 'is_recurring', p_is_recurring)
  );

  return v_id;
end;
$$;

comment on function platform.upsert_commission_rule is
  'Regla de comisión con moneda explícita (la de su importe fijo y su tope). Una regla que ya '
  'devengó no cambia de base, tasa, importe, moneda ni tipo de cargo.';

-- ---------------------------------------------------------------------------
-- 5. GRANTS
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'platform'
       and p.proname in (
         'enforce_settlement_currency', 'enforce_settlement_currency_immutable',
         'settle_commissions', 'generate_commission_events', 'upsert_commission_rule'
       )
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;
