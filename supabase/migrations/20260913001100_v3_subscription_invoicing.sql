-- ============================================================================
-- EBIM Control Plane V3 — 34 · Emisión de la factura gerencial del periodo
-- ----------------------------------------------------------------------------
-- Fase 17 de `.claude-prompts-v3-multicurrency` (habilita los journeys E2E).
--
-- Hasta aquí las facturas solo nacían del seed o del webhook del proveedor: no
-- existía un camino de negocio para emitir la factura de un contrato recién
-- vendido y registrar su cobro manual, así que el recorrido «venta → factura →
-- cobro → comisión» no se podía hacer desde la consola.
--
-- Es una factura de CONTROL GERENCIAL (no un comprobante SUNAT/SIN/SRI):
--   · se emite en la MONEDA DEL CONTRATO (la cadena de moneda la hereda);
--   · incluye las líneas recurrentes vigentes en el periodo y los cargos
--     únicos aún no facturados;
--   · es idempotente por (suscripción, inicio de periodo): repetir devuelve la
--     factura existente en vez de duplicarla.
-- El cobro se registra con `confirm_manual_payment` (V2), que ya toma la moneda
-- de la factura y dispara el devengo de comisión.
-- ============================================================================

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
  v_period_start date := coalesce(p_period_start, date_trunc('month', current_date)::date);
  v_period_end   date;
  v_existing     record;
  v_invoice_id   uuid;
  v_number       text;
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

  v_period_start := date_trunc('month', v_period_start)::date;
  v_period_end   := (v_period_start + interval '1 month' - interval '1 day')::date;

  select i.id, i.number, i.status, i.total, i.currency into v_existing
    from platform.invoices i
   where i.subscription_id = p_subscription_id
     and i.period_start = v_period_start
     and i.status <> 'VOID'
   order by i.created_at
   limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('invoice_id', v_existing.id, 'number', v_existing.number, 'created', false,
                              'currency', v_existing.currency, 'total', v_existing.total, 'status', v_existing.status);
  end if;

  select coalesce(p.payment_due_days, 15) into v_due_days
    from platform.v_subscription_collection p where p.subscription_id = p_subscription_id;

  v_number := 'INV-' || to_char(v_period_start, 'YYYYMM') || '-' || v_sub.code;

  -- Sin `currency`: la hereda del contrato (guard de moneda transaccional).
  insert into platform.invoices (
    number, customer_organization_id, subscription_id, status, issue_date, due_date,
    period_start, period_end, notes, metadata
  ) values (
    v_number, v_sub.billed_organization_id, v_sub.id, 'ISSUED', current_date,
    current_date + coalesce(v_due_days, 15), v_period_start, v_period_end,
    'Factura gerencial del periodo emitida desde la consola',
    jsonb_build_object('origin', 'console', 'market', v_sub.market_code)
  )
  returning id into v_invoice_id;

  insert into platform.invoice_lines (
    invoice_id, charge_kind, description, saas_product_id, tenant_id, subscription_item_id,
    quantity, unit_amount, is_recurring
  )
  select v_invoice_id, si.charge_kind, si.description, v_sub.saas_product_id,
         coalesce(si.tenant_id, v_sub.tenant_id), si.id, si.quantity, si.unit_amount,
         si.billing_interval <> 'ONE_TIME'
    from platform.subscription_items si
   where si.subscription_id = v_sub.id
     and si.valid_from <= v_period_end
     and (si.valid_to is null or si.valid_to >= v_period_start)
     and (
       si.billing_interval <> 'ONE_TIME'
       -- Un cargo único se factura una sola vez en toda la vida del contrato.
       or not exists (select 1 from platform.invoice_lines l
                       join platform.invoices i on i.id = l.invoice_id
                      where l.subscription_item_id = si.id and i.status <> 'VOID')
     );
  get diagnostics v_lines = row_count;

  if v_lines = 0 then
    raise exception 'SIN_LINEAS_FACTURABLES: la suscripción % no tiene cargos vigentes en %', v_sub.code, v_period_start
      using errcode = '23514';
  end if;

  select total into v_total from platform.invoices where id = v_invoice_id;

  perform platform.log_audit(
    'INVOICE_ISSUED', 'invoice', v_invoice_id::text, v_sub.billed_organization_id, v_sub.tenant_id,
    jsonb_build_object('number', v_number, 'subscription', v_sub.code, 'currency', v_sub.currency,
                       'total', v_total, 'lines', v_lines, 'period_start', v_period_start)
  );

  return jsonb_build_object('invoice_id', v_invoice_id, 'number', v_number, 'created', true,
                            'currency', v_sub.currency, 'total', v_total, 'status', 'ISSUED');
end;
$$;

comment on function platform.issue_subscription_invoice(uuid, date) is
  'Emite la factura gerencial del mes de un contrato activo, en su moneda. Idempotente por '
  '(suscripción, periodo). No es un comprobante fiscal.';

revoke all on function platform.issue_subscription_invoice(uuid, date) from public, anon;
grant execute on function platform.issue_subscription_invoice(uuid, date) to authenticated, service_role;
