-- ============================================================================
-- EBIM Commercial Control Plane · Fase 18 · emisión con uso, créditos, add-ons
-- y correctivos (MA-60)
-- ----------------------------------------------------------------------------
-- Spec §5.3, §11.4, §12.5, §13.1, §13.2, §17. Plan §4 fila 21, §13 MA-60.
-- Test: supabase/tests/41_ccp_billing_usage.test.sql (+ 18_v3_1_billing_cadence,
-- 27_ccp_discount como regresión).
--
-- subscription_usage_lines(sub, período) — consumo VENCIDO que entra en la
-- factura del período (nunca el del propio período, que sigue abierto):
--   · Medidores: agregados FINALIZED ∧ is_billable (medidor facturable D-06 ∧
--     tenant no DEMO/SANDBOX) del tenant del contrato y su producto, de
--     períodos ya cerrados desde el inicio del contrato, aún no reclamados por
--     una factura no anulada. Los medidores de capacidades IA se facturan por
--     créditos, no por medidor.
--       - NO_ALLOWANCE y el registro NO declara asignación para el medidor →
--         uso puro (USAGE) sobre toda la cantidad.
--       - NO_ALLOWANCE pero existe capacidad ALLOWANCE sin valor decidido
--         (D-05) → ASIGNACION_NO_DEFINIDA, sin línea.
--       - OVER con política ALLOW → exceso (OVERAGE). OVER bajo BLOCK (lo
--         único que emite el contrato v1) → sin línea; la alerta
--         OVERAGE_UNDER_BLOCK_POLICY ya existe desde la finalización.
--       - Tarifa: ítem PER_UNIT ligado al medidor + tarifa USAGE_OVERAGE
--         MONTHLY vigente al cierre del período en el mercado y moneda del
--         contrato; si falta → TARIFA_ADDON_NO_DEFINIDA, sin línea.
--   · Créditos IA: saldo negativo de tenant × pool × período cerrado, con al
--     menos un CONSUME y todos los agregados IA del período FINALIZED. Solo
--     con política ALLOW (el SaaS dejó pasar el exceso); BLOCK → nada (alerta
--     CREDIT_OVERAGE de la fase 17); sin política → POLITICA_CREDITOS_NO_DEFINIDA.
--     Tarifa: ítem PER_UNIT AI_CREDIT del pool (producto o transversal para
--     TENANT); si falta → TARIFA_ADDON_NO_DEFINIDA.
--   · Cantidad: la del agregado; si tiene más de 2 decimales se factura como
--     1 × round(cantidad × tarifa, 2) (mismo importe, sin truncar la cantidad).
--
-- issue_subscription_invoice: copia EXACTA de 20260928000100 con los cambios
-- «CCP fase 18»: sigue idempotente por (suscripción, período); las líneas de
-- ítems llevan catalog_item_id / price_ref / corrects_line_id /
-- ai_credit_entry_id; un correctivo se emite NEGATIVO (spec §13.2); añade las
-- líneas de uso. Para una suscripción sin uso ni ítems vinculados la factura
-- es idéntica (test "antes = después").
--
-- Rollback: docs/runbooks/ccp-rollback/18.sql.
-- ============================================================================

create or replace function platform.subscription_usage_lines(
  p_subscription_id uuid,
  p_period_start    date
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_sub      record;
  v_since    date;
  v_lines    jsonb := '[]'::jsonb;
  r          record;
  v_pool     record;
  v_item     platform.catalog_items;
  v_price    numeric;
  v_price_id uuid;
  v_qty      numeric;
  v_basis    text;
  v_modes    text[];
  v_anchor   uuid;
  v_hash     text;
  v_label    text;
begin
  select s.*, t.tenant_type into v_sub
    from platform.subscriptions s left join platform.tenants t on t.id = s.tenant_id
   where s.id = p_subscription_id;
  -- Sin tenant (licencia base de partner) o DEMO/SANDBOX: nunca hay uso facturable.
  if v_sub.id is null or v_sub.tenant_id is null or v_sub.tenant_type in ('DEMO', 'SANDBOX') then
    return v_lines;
  end if;
  v_since := date_trunc('month', v_sub.started_on)::date;

  -- 1. Medidores ------------------------------------------------------------
  for r in
    select a.*, m.unit
      from platform.usage_period_aggregates a
      join platform.usage_meters m on m.id = a.meter_id
      left join platform.product_capabilities c on c.id = m.capability_id
     where a.tenant_id = v_sub.tenant_id
       and a.saas_product_id = v_sub.saas_product_id
       and a.status = 'FINALIZED'
       and a.is_billable
       and a.period_end < p_period_start
       and a.period_start >= v_since
       and c.kind is distinct from 'AI_FEATURE'
       and not exists (select 1 from platform.invoice_lines l join platform.invoices i on i.id = l.invoice_id
                        where l.usage_aggregate_id = a.id and i.status <> 'VOID')
     order by a.period_start, a.meter_code
  loop
    if r.allowance_status = 'NO_ALLOWANCE' then
      if exists (select 1 from platform.product_capabilities c
                  where c.saas_product_id = r.saas_product_id and c.kind = 'ALLOWANCE'
                    and c.meter_code = r.meter_code and c.status in ('ACTIVE', 'DEPRECATED')) then
        perform platform.usage_billing_alert_once(r.tenant_id, r.saas_product_id, r.id, 'ASIGNACION_NO_DEFINIDA',
          jsonb_build_object('meter', r.meter_code, 'period', r.period_start, 'quantity', r.quantity));
        continue;
      end if;
      v_basis := 'USAGE';
      v_qty := r.quantity;
    elsif r.allowance_status = 'OVER' and r.overage_policy = 'ALLOW' then
      v_basis := 'OVERAGE';
      v_qty := r.overage_quantity;
    else
      continue;
    end if;
    if coalesce(v_qty, 0) <= 0 then
      continue;
    end if;

    select * into v_item from platform.catalog_items ci
     where ci.usage_meter_id = r.meter_id and ci.lifecycle_status <> 'RETIRED';
    v_price := null;
    v_price_id := null;
    if v_item.id is not null then
      v_price := platform.current_catalog_item_price(v_item.id, v_sub.market_id, 'USAGE_OVERAGE', 'MONTHLY', v_sub.currency, r.period_end);
      v_price_id := platform.current_catalog_item_price_id(v_item.id, v_sub.market_id, 'USAGE_OVERAGE', 'MONTHLY', v_sub.currency, r.period_end);
    end if;
    if v_price is null then
      perform platform.usage_billing_alert_once(r.tenant_id, r.saas_product_id, r.id, 'TARIFA_ADDON_NO_DEFINIDA',
        jsonb_build_object('meter', r.meter_code, 'period', r.period_start, 'quantity', v_qty, 'subscription', v_sub.code));
      continue;
    end if;

    v_label := case v_basis when 'USAGE' then 'Uso ' else 'Exceso ' end || r.meter_code || ' ' || to_char(r.period_start, 'MM/YYYY')
               || ' (' || trim_scale(v_qty) || ' ' || r.unit || ')';
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'description', v_label, 'tenant_id', r.tenant_id,
      'quantity', case when v_qty = round(v_qty, 2) then v_qty else 1 end,
      'unit_amount', case when v_qty = round(v_qty, 2) then v_price else round(v_qty * v_price, 2) end,
      'usage_aggregate_id', r.id, 'meter_code', r.meter_code, 'catalog_item_id', v_item.id, 'price_ref', v_price_id,
      'usage_basis', v_basis, 'ai_credit_pool_key', null, 'usage_period_start', r.period_start,
      'usage_source_hash', r.source_hash));
  end loop;

  -- 2. Créditos IA ------------------------------------------------------------
  for v_pool in
    select l.pool_key, l.period_start, sum(l.credits) as balance
      from platform.ai_credit_ledger l
     where l.tenant_id = v_sub.tenant_id
       and l.saas_product_id = v_sub.saas_product_id
       and l.period_start < p_period_start
       and l.period_start >= v_since
     group by l.pool_key, l.period_start
    having sum(l.credits) < 0
     order by l.period_start, l.pool_key
  loop
    if exists (select 1 from platform.invoice_lines il join platform.invoices i on i.id = il.invoice_id
                where il.tenant_id = v_sub.tenant_id and il.ai_credit_pool_key = v_pool.pool_key
                  and il.usage_period_start = v_pool.period_start and i.status <> 'VOID') then
      continue;
    end if;
    -- Período completo: ningún agregado IA del tenant sigue OPEN/CLOSING.
    if exists (select 1 from platform.usage_period_aggregates a
                 join platform.usage_meters m on m.id = a.meter_id
                 join platform.product_capabilities c on c.id = m.capability_id
                where a.tenant_id = v_sub.tenant_id and a.period_start = v_pool.period_start
                  and c.kind = 'AI_FEATURE' and a.status <> 'FINALIZED') then
      continue;
    end if;

    select 'sha256:' || encode(sha256(convert_to(string_agg(a.id::text || ':' || a.source_hash, ',' order by a.id::text), 'UTF8')), 'hex'),
           (array_agg(a.id order by a.finalized_at desc, a.id))[1]
      into v_hash, v_anchor
      from platform.usage_period_aggregates a
     where a.id in (select distinct e.usage_aggregate_id from platform.ai_credit_ledger e
                     where e.tenant_id = v_sub.tenant_id and e.pool_key = v_pool.pool_key
                       and e.period_start = v_pool.period_start and e.entry_type = 'CONSUME');
    if v_anchor is null then
      continue;  -- saldo negativo sin consumo (solo ajustes): no es uso, no se factura
    end if;

    select array_agg(distinct coalesce(p.overage_mode, 'NO_DEFINIDO')) into v_modes
      from platform.ai_credit_applicable_policies(v_sub.tenant_id, v_pool.period_start) p;
    if v_modes is null or 'NO_DEFINIDO' = any(v_modes) then
      perform platform.usage_billing_alert_once(v_sub.tenant_id, v_sub.saas_product_id, v_anchor, 'POLITICA_CREDITOS_NO_DEFINIDA',
        jsonb_build_object('pool', v_pool.pool_key, 'period', v_pool.period_start, 'balance', v_pool.balance));
      continue;
    end if;
    if 'BLOCK' = any(v_modes) then
      continue;
    end if;

    select * into v_item from platform.catalog_items ci
     where ci.per_unit_source = 'AI_CREDIT' and ci.lifecycle_status <> 'RETIRED'
       and ci.saas_product_id is not distinct from
           (case when v_pool.pool_key = 'TENANT' then null else v_sub.saas_product_id end);
    v_price := null;
    v_price_id := null;
    if v_item.id is not null then
      v_price := platform.current_catalog_item_price(v_item.id, v_sub.market_id, 'USAGE_OVERAGE', 'MONTHLY', v_sub.currency,
                                                     (v_pool.period_start + interval '1 month' - interval '1 day')::date);
      v_price_id := platform.current_catalog_item_price_id(v_item.id, v_sub.market_id, 'USAGE_OVERAGE', 'MONTHLY', v_sub.currency,
                                                           (v_pool.period_start + interval '1 month' - interval '1 day')::date);
    end if;
    if v_price is null then
      perform platform.usage_billing_alert_once(v_sub.tenant_id, v_sub.saas_product_id, v_anchor, 'TARIFA_ADDON_NO_DEFINIDA',
        jsonb_build_object('pool', v_pool.pool_key, 'period', v_pool.period_start, 'balance', v_pool.balance, 'subscription', v_sub.code));
      continue;
    end if;

    v_qty := -v_pool.balance;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'description', 'Exceso de créditos IA ' || v_pool.pool_key || ' ' || to_char(v_pool.period_start, 'MM/YYYY')
                     || ' (' || trim_scale(v_qty) || ' créditos)',
      'tenant_id', v_sub.tenant_id,
      'quantity', case when v_qty = round(v_qty, 2) then v_qty else 1 end,
      'unit_amount', case when v_qty = round(v_qty, 2) then v_price else round(v_qty * v_price, 2) end,
      'usage_aggregate_id', null, 'meter_code', null, 'catalog_item_id', v_item.id, 'price_ref', v_price_id,
      'usage_basis', 'AI_CREDIT_OVERAGE', 'ai_credit_pool_key', v_pool.pool_key, 'usage_period_start', v_pool.period_start,
      'usage_source_hash', v_hash));
  end loop;

  return v_lines;
end;
$$;
revoke all on function platform.subscription_usage_lines(uuid, date) from public, anon, authenticated;

comment on function platform.subscription_usage_lines(uuid, date) is
  'Líneas USAGE_OVERAGE (uso vencido de agregados FINALIZED y exceso de créditos IA) que entran en la factura '
  'del período. Interna de issue_subscription_invoice: registra alertas de configuración faltante una vez.';

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
  -- CCP fase 18
  v_usage        jsonb;
  v_usage_count  integer := 0;
  v_usage_total  numeric(14,2) := 0;
  v_usage_lines  integer := 0;
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

  -- CCP fase 18: consumo vencido (agregados FINALIZED y exceso de créditos IA).
  v_usage := platform.subscription_usage_lines(v_sub.id, v_period_start);
  select count(*), coalesce(sum(round((u ->> 'quantity')::numeric * (u ->> 'unit_amount')::numeric, 2)), 0)
    into v_usage_count, v_usage_total
    from jsonb_array_elements(v_usage) u;

  if v_due_count + v_usage_count = 0 then
    raise exception 'SIN_LINEAS_FACTURABLES: la suscripción % no tiene cargos facturables en el periodo %',
      v_sub.code, to_char(v_period_start, 'MM/YYYY')
      using errcode = '23514';
  end if;
  if v_due_total + v_usage_total <= 0 then
    raise exception 'SIN_IMPORTE_FACTURABLE: los cargos de la suscripción % en el periodo % suman %; no se emite una factura en cero',
      v_sub.code, to_char(v_period_start, 'MM/YYYY'), v_due_total + v_usage_total
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
      || case when v_usage_count > 0 then jsonb_build_object('usage_lines', v_usage_count) else '{}'::jsonb end
  )
  returning id into v_invoice_id;

  -- CCP fase 18: cada línea conserva el ítem de catálogo y la tarifa que fijaron su importe;
  -- un correctivo se emite NEGATIVO y apunta a la línea que corrige (spec §13.2).
  insert into platform.invoice_lines (
    invoice_id, charge_kind, description, saas_product_id, tenant_id, subscription_item_id,
    quantity, unit_amount, is_recurring, catalog_item_id, price_ref, corrects_line_id, ai_credit_entry_id
  )
  select v_invoice_id, d.charge_kind, d.description, v_sub.saas_product_id,
         coalesce(d.tenant_id, v_sub.tenant_id), d.subscription_item_id, d.quantity,
         case when si.corrects_line_id is not null then -abs(d.unit_amount) else d.unit_amount end,
         d.billing_interval <> 'ONE_TIME', ci.id, si.price_ref, si.corrects_line_id, si.ai_credit_entry_id
    from platform.subscription_due_items(v_sub.id, v_period_start) d
    join platform.subscription_items si on si.id = d.subscription_item_id
    left join platform.catalog_items ci on ci.code = si.catalog_item_code;
  get diagnostics v_lines = row_count;

  insert into platform.invoice_lines (
    invoice_id, charge_kind, description, saas_product_id, tenant_id, quantity, unit_amount, is_recurring,
    usage_aggregate_id, meter_code, catalog_item_id, price_ref, usage_basis, ai_credit_pool_key,
    usage_period_start, usage_source_hash
  )
  select v_invoice_id, 'USAGE_OVERAGE', u.description, v_sub.saas_product_id, u.tenant_id, u.quantity, u.unit_amount, false,
         u.usage_aggregate_id, u.meter_code, u.catalog_item_id, u.price_ref, u.usage_basis, u.ai_credit_pool_key,
         u.usage_period_start, u.usage_source_hash
    from jsonb_to_recordset(v_usage) as u(
           description text, tenant_id uuid, quantity numeric, unit_amount numeric, usage_aggregate_id uuid,
           meter_code text, catalog_item_id uuid, price_ref uuid, usage_basis text, ai_credit_pool_key text,
           usage_period_start date, usage_source_hash text);
  get diagnostics v_usage_lines = row_count;
  v_lines := v_lines + v_usage_lines;

  select total into v_total from platform.invoices where id = v_invoice_id;

  perform platform.log_audit(
    'INVOICE_ISSUED', 'invoice', v_invoice_id::text, v_sub.billed_organization_id, v_sub.tenant_id,
    jsonb_build_object('number', v_number, 'subscription', v_sub.code, 'currency', v_sub.currency,
                       'total', v_total, 'lines', v_lines, 'period_start', v_period_start)
      || case when v_usage_lines > 0 then jsonb_build_object('usage_lines', v_usage_lines) else '{}'::jsonb end
  );

  return jsonb_build_object('invoice_id', v_invoice_id, 'number', v_number, 'created', true,
                            'currency', v_sub.currency, 'total', v_total, 'status', 'ISSUED',
                            'period_start', v_period_start, 'period_end', v_period_end, 'lines', v_lines);
end;
$$;

