-- ============================================================================
-- EBIM Control Plane V3.1 — 36 · Billing cadence de la factura del periodo
-- ----------------------------------------------------------------------------
-- CAUSA RAÍZ (migración 34, `issue_subscription_invoice`): toda línea recurrente
-- vigente entraba en la factura de CUALQUIER mes. `billing_interval` solo se
-- miraba para distinguir ONE_TIME, así que una licencia YEARLY (SUB-GRUPASA-EWM,
-- USD 24,000) o QUARTERLY se volvía a facturar el mes siguiente. Además, re-emitir
-- un periodo cuya factura se anuló (VOID) chocaba con `invoices_number_uk`, aunque
-- la función ya trataba VOID como «no facturado». Evidencia en
-- `docs/nightly-v3-1/evidence/phase1-*.txt`.
--
-- REGLA (docs/finance/BILLING_CADENCE.md):
--   · El periodo de facturación es el MES calendario (`period_start` = día 1).
--   · Ancla de cada línea = `subscription_items.valid_from`. No hay campo mejor:
--     `subscriptions.started_on` es del contrato, y las líneas tienen vigencia y
--     periodicidad propias (una suscripción puede mezclar MONTHLY/YEARLY/ONE_TIME).
--   · Se cuenta en MESES entre el mes del ancla y el mes del periodo, nunca en
--     días: un ancla 31/01 factura en febrero. MONTHLY cada 1, QUARTERLY cada 3,
--     YEARLY cada 12. ONE_TIME: una sola vez, en el primer periodo emitido desde su
--     ancla (una línea en factura VOID no cuenta).
--   · La línea debe estar vigente en el periodo (`valid_from` <= fin de mes y
--     `valid_to` nula o >= inicio de mes). Sin prorrateo.
--   · Sin cargos debidos → no se crea factura (SIN_LINEAS_FACTURABLES, como antes,
--     pero sin llegar a insertar). Cargos que suman 0 → SIN_IMPORTE_FACTURABLE.
--
-- No se reutiliza `next_renewal_date`: cuenta meses COMPLETOS por `age()` (día
-- exacto) y es de renovación de contrato, no de facturación por línea.
--
-- La API pública se conserva: misma firma, mismos códigos de error y mismo JSON
-- (se añaden claves). La moneda sigue heredándose del contrato; aquí no hay FX.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Helper puro: ¿toca esta línea en este periodo?
-- ---------------------------------------------------------------------------
create or replace function platform.is_subscription_item_due_for_period(
  p_billing_interval platform.billing_interval,
  p_billing_anchor   date,
  p_valid_to         date,
  p_period_start     date,
  p_already_invoiced boolean default false
)
returns boolean
language sql
immutable
parallel safe
set search_path = platform, pg_catalog
as $$
  select coalesce(
           p_billing_anchor <= (date_trunc('month', p_period_start) + interval '1 month' - interval '1 day')::date
           and (p_valid_to is null or p_valid_to >= date_trunc('month', p_period_start)::date)
           and case p_billing_interval
                 when 'MONTHLY'   then true
                 when 'QUARTERLY' then m.months_from_anchor % 3 = 0
                 when 'YEARLY'    then m.months_from_anchor % 12 = 0
                 when 'ONE_TIME'  then not coalesce(p_already_invoiced, false)
               end,
           false)
    from (select (extract(year from p_period_start)::int * 12 + extract(month from p_period_start)::int)
               - (extract(year from p_billing_anchor)::int * 12 + extract(month from p_billing_anchor)::int)
                 as months_from_anchor) m;
$$;

comment on function platform.is_subscription_item_due_for_period(platform.billing_interval, date, date, date, boolean) is
  'Billing cadence V3.1. TRUE si una línea con esa periodicidad, ancla (valid_from) y fin de vigencia '
  'se factura en el MES de p_period_start. Cuenta meses de calendario desde el ancla (no días): '
  'MONTHLY cada 1, QUARTERLY cada 3, YEARLY cada 12; ONE_TIME solo si aún no está facturado. '
  'Puro y determinista: no lee ni escribe tablas.';

revoke all on function platform.is_subscription_item_due_for_period(platform.billing_interval, date, date, date, boolean)
  from public, anon;
grant execute on function platform.is_subscription_item_due_for_period(platform.billing_interval, date, date, date, boolean)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2 · Líneas debidas de una suscripción en un periodo. ÚNICA fuente de verdad
--     para emitir y para mostrar el estado: no se duplica en React.
--     SECURITY INVOKER: llamada por un usuario respeta su RLS; dentro de la RPC
--     de emisión (DEFINER) ve todo.
-- ---------------------------------------------------------------------------
create or replace function platform.subscription_due_items(
  p_subscription_id uuid,
  p_period_start    date
)
returns table (
  subscription_item_id uuid,
  charge_kind          platform.charge_kind,
  description          text,
  tenant_id            uuid,
  quantity             numeric,
  unit_amount          numeric,
  amount               numeric,
  currency             char(3),
  billing_interval     platform.billing_interval,
  billing_anchor       date,
  valid_to             date
)
language sql
stable
set search_path = platform, pg_catalog
as $$
  select si.id, si.charge_kind, si.description, si.tenant_id, si.quantity, si.unit_amount, si.amount,
         si.currency, si.billing_interval, si.valid_from, si.valid_to
    from platform.subscription_items si
   where si.subscription_id = p_subscription_id
     and platform.is_subscription_item_due_for_period(
           si.billing_interval, si.valid_from, si.valid_to, p_period_start,
           si.billing_interval = 'ONE_TIME'
           and exists (select 1 from platform.invoice_lines l
                         join platform.invoices i on i.id = l.invoice_id
                        where l.subscription_item_id = si.id and i.status <> 'VOID'))
   order by si.valid_from, si.charge_kind, si.id;
$$;

comment on function platform.subscription_due_items(uuid, date) is
  'Líneas de la suscripción que se facturan en el mes de p_period_start según su billing cadence '
  '(is_subscription_item_due_for_period). Solo lectura; respeta RLS del llamante.';

revoke all on function platform.subscription_due_items(uuid, date) from public, anon;
grant execute on function platform.subscription_due_items(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3 · Emisión con cadence. Misma firma y seguridad que la migración 34.
-- ---------------------------------------------------------------------------
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

comment on function platform.issue_subscription_invoice(uuid, date) is
  'Emite la factura gerencial del PERIODO (mes) de un contrato activo, en su moneda, con solo las líneas '
  'debidas según su billing cadence (subscription_due_items). Idempotente por (suscripción, periodo); '
  'sin cargos debidos no crea factura. No es un comprobante fiscal.';

revoke all on function platform.issue_subscription_invoice(uuid, date) from public, anon;
grant execute on function platform.issue_subscription_invoice(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4 · Estado de facturación del periodo para la UI. Solo lectura, INVOKER.
--     La UI no calcula cadence ni fechas: pinta lo que devuelve esto.
-- ---------------------------------------------------------------------------
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

comment on function platform.get_subscription_billing_status(uuid, date) is
  'Estado de facturación del mes de p_period_start: cargos debidos, total estimado en la moneda del '
  'contrato, factura vigente y próximo periodo con cargos sin facturar (horizonte 12 meses). Solo lectura; '
  'respeta RLS del llamante. La UI lo pinta, no lo recalcula.';

revoke all on function platform.get_subscription_billing_status(uuid, date) from public, anon;
grant execute on function platform.get_subscription_billing_status(uuid, date) to authenticated, service_role;
