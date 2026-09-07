-- ============================================================================
-- EBIM Control Plane V2 — 21 · Reversos de comisión y reconciliación financiera
-- ----------------------------------------------------------------------------
-- Fases 12 y 13 de `.claude-prompts-v2`.
--
-- La regla fundamental NO cambia: **solo un cobro CONFIRMED devenga comisión**.
-- Lo que se añade es qué pasa cuando ese cobro se deshace.
--
-- ============================================================================
-- DECISIÓN DE DISEÑO: CONTRA-EVENTO, NO BORRADO NI VOID
-- ============================================================================
--
-- Se barajaron tres mecanismos para el reverso:
--
--   (a) Borrar los `commission_events` del pago revertido.
--       Descartado: destruye la historia. En marzo el comercial vio una
--       comisión y en abril desapareció sin rastro. Indefendible en una
--       auditoría.
--
--   (b) Marcarlos `VOID`.
--       Descartado a medias: conserva la fila, pero si el evento ya entró en
--       una liquidación PAGADA, anularlo reescribe un periodo cerrado. El
--       dinero ya salió; el asiento no puede evaporarse.
--
--   (c) CONTRA-EVENTO con importe negativo. ELEGIDO.
--       El evento original queda intacto —el periodo cerrado sigue cuadrando— y
--       se añade una fila nueva, negativa, que apunta al original y neteará en
--       la siguiente liquidación. Es como funciona una nota de crédito.
--
-- La ventaja concreta de (c): TODAS las sumas existentes siguen siendo
-- correctas sin tocarlas. `v_product_margin` hace `sum(e.amount)`,
-- `recalc_settlement_total` hace `sum(e.amount)`: el negativo se resta solo.
-- No hay que reescribir ni una vista del baseline.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. El contra-evento necesita poder ser negativo.
--
-- El CHECK del baseline (`amount >= 0`) se sustituye por uno MÁS estricto, no
-- más laxo: un devengo sigue siendo >= 0 y un reverso es obligatoriamente <= 0.
-- No queda ningún hueco por el que colar un devengo negativo.
-- ---------------------------------------------------------------------------
alter table platform.commission_events
  add column reversal_of_event_id uuid references platform.commission_events(id) on delete restrict,
  add column reversal_reason text;

comment on column platform.commission_events.reversal_of_event_id is
  'Si no es null, esta fila es un CONTRA-EVENTO que compensa al evento indicado. '
  'El original nunca se borra ni se anula: la historia se conserva íntegra.';

create index commission_events_reversal_idx
  on platform.commission_events(reversal_of_event_id);

alter table platform.commission_events drop constraint commission_events_amount_ck;
alter table platform.commission_events add constraint commission_events_amount_ck check (
  (reversal_of_event_id is null and amount >= 0)
  or (reversal_of_event_id is not null and amount <= 0)
);

-- Un evento solo puede compensarse UNA vez: si no, un reverso repetido
-- convertiría la comisión en negativa sin límite.
create unique index commission_events_reversal_uk
  on platform.commission_events(reversal_of_event_id)
  where reversal_of_event_id is not null;

-- ---------------------------------------------------------------------------
-- 2. El índice de idempotencia del baseline tiene que distinguir el
--    contra-evento del original: comparten pago, atribución, regla y línea.
--
-- Se recrea añadiendo el discriminante. Para un devengo normal
-- (`reversal_of_event_id is null`) el comportamiento es IDÉNTICO al anterior,
-- así que `generate_commission_events()` y su `on conflict do nothing` siguen
-- funcionando exactamente igual.
-- ---------------------------------------------------------------------------
drop index if exists platform.commission_events_idempotency_uk;

create unique index commission_events_idempotency_uk
  on platform.commission_events (
    payment_id,
    sales_attribution_id,
    commission_rule_id,
    coalesce(invoice_line_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(reversal_of_event_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- ---------------------------------------------------------------------------
-- 3. reverse_payment — deshacer un cobro, con su rastro.
-- ---------------------------------------------------------------------------
create or replace function platform.reverse_payment(
  p_payment_id uuid,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_payment  record;
  v_invoice  record;
  v_event    record;
  v_reversed integer := 0;
  v_amount   numeric(14,2) := 0;
begin
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin revierten cobros'
      using errcode = '42501';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: revertir un cobro exige un motivo auditable'
      using errcode = '23502';
  end if;

  select * into v_payment from platform.payments where id = p_payment_id;
  if v_payment is null then
    raise exception 'PAGO_NO_ENCONTRADO: %', p_payment_id using errcode = '23503';
  end if;

  if v_payment.status = 'REVERSED' then
    return jsonb_build_object('already_reversed', true, 'payment_id', p_payment_id);
  end if;
  if v_payment.status <> 'CONFIRMED' then
    raise exception 'PAGO_NO_CONFIRMADO: solo se revierte un cobro CONFIRMED (este está %)', v_payment.status
      using errcode = '23514';
  end if;

  select * into v_invoice from platform.invoices where id = v_payment.invoice_id;

  -- ---- El cobro se marca revertido. El trigger `payments_sync_invoice` del
  --      baseline recalcula el estado de la factura por su cuenta.
  update platform.payments
     set status = 'REVERSED',
         notes = coalesce(notes || E'\n', '') || 'Revertido: ' || p_reason
   where id = p_payment_id;

  -- ---- Contra-eventos de comisión.
  for v_event in
    select * from platform.commission_events
     where payment_id = p_payment_id
       and reversal_of_event_id is null
       and status <> 'VOID'
       -- No se compensa dos veces el mismo evento.
       and not exists (
         select 1 from platform.commission_events r
          where r.reversal_of_event_id = commission_events.id
       )
  loop
    insert into platform.commission_events (
      sales_agent_id, sales_attribution_id, commission_rule_id, payment_id,
      invoice_line_id, saas_product_id, tenant_id, status,
      base_amount, applied_rate, attribution_pct, amount, currency, earned_on,
      reversal_of_event_id, reversal_reason, calculation
    ) values (
      v_event.sales_agent_id, v_event.sales_attribution_id, v_event.commission_rule_id,
      v_event.payment_id, v_event.invoice_line_id, v_event.saas_product_id, v_event.tenant_id,
      -- ELIGIBLE, no VOID: tiene que ENTRAR en la próxima liquidación para
      -- netear. Un contra-evento anulado no compensaría nada.
      'ELIGIBLE',
      -v_event.base_amount, v_event.applied_rate, v_event.attribution_pct,
      -v_event.amount, v_event.currency, current_date,
      v_event.id, p_reason,
      jsonb_build_object(
        'kind', 'REVERSAL',
        'reverses_event_id', v_event.id,
        'original_amount', v_event.amount,
        'original_earned_on', v_event.earned_on,
        'original_status', v_event.status,
        'reason', p_reason,
        'note', 'Contra-evento: el original se conserva intacto'
      )
    );

    v_reversed := v_reversed + 1;
    v_amount := v_amount + v_event.amount;
  end loop;

  perform platform.log_audit(
    'PAYMENT_REVERSED', 'payment', p_payment_id::text,
    v_invoice.customer_organization_id, null,
    jsonb_build_object(
      'reference', v_payment.reference,
      'amount', v_payment.amount,
      'currency', v_payment.currency,
      'reason', p_reason,
      'commission_events_reversed', v_reversed,
      'commission_amount_reversed', v_amount
    )
  );

  return jsonb_build_object(
    'payment_id', p_payment_id,
    'reversed', true,
    'commission_events_reversed', v_reversed,
    'commission_amount_reversed', v_amount,
    'note', 'Los eventos originales se conservan; se añadieron contra-eventos negativos'
  );
end;
$$;

comment on function platform.reverse_payment is
  'Revierte un cobro y compensa su comisión con CONTRA-EVENTOS negativos. No '
  'borra ni anula el devengo original: un periodo ya liquidado no se reescribe.';

-- ---------------------------------------------------------------------------
-- 4. confirm_manual_payment — cobro por transferencia o acuerdo manual.
--
-- Es el otro camino legítimo hacia `payments`, además del webhook del proveedor.
-- Solo finanzas, siempre con referencia, y devenga comisión por el mismo trigger
-- del baseline. Una OS/OC aprobada NO pasa por aquí: aprobar no es cobrar.
-- ---------------------------------------------------------------------------
create or replace function platform.confirm_manual_payment(
  p_invoice_id uuid,
  p_amount     numeric,
  p_reference  text,
  p_method     text default 'BANK_TRANSFER',
  p_paid_at    timestamptz default now(),
  p_notes      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_invoice     record;
  v_payment_id  uuid;
  v_commissions integer;
  v_paid        numeric(14,2);
begin
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin confirman cobros manuales'
      using errcode = '42501';
  end if;

  if nullif(trim(coalesce(p_reference, '')), '') is null then
    raise exception 'REFERENCIA_REQUERIDA: un cobro manual necesita referencia (nº de operación, voucher)'
      using errcode = '23502';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'IMPORTE_INVALIDO: el importe cobrado debe ser mayor que cero' using errcode = '23514';
  end if;
  if p_method not in ('BANK_TRANSFER', 'MANUAL', 'CULQI_CARD', 'CASH', 'CHECK') then
    raise exception 'METODO_INVALIDO: "%" no es un método de cobro reconocido', p_method using errcode = '23514';
  end if;

  select * into v_invoice from platform.invoices where id = p_invoice_id;
  if v_invoice is null then
    raise exception 'FACTURA_NO_ENCONTRADA: %', p_invoice_id using errcode = '23503';
  end if;
  if v_invoice.status in ('DRAFT', 'VOID') then
    raise exception 'COBRO_SOBRE_FACTURA_NO_EMITIDA: la factura está % y no admite cobros', v_invoice.status
      using errcode = '23514';
  end if;

  select coalesce(sum(amount), 0) into v_paid
    from platform.payments where invoice_id = p_invoice_id and status = 'CONFIRMED';

  if v_paid + p_amount > v_invoice.total + 0.005 then
    raise exception 'SOBRECOBRO: la factura % suma % de % y este cobro de % la excedería',
      v_invoice.number, v_paid, v_invoice.total, p_amount
      using errcode = '23514';
  end if;

  -- La unicidad de `reference` (baseline) hace idempotente el doble clic.
  insert into platform.payments (
    invoice_id, reference, status, amount, currency, paid_at, method, notes
  ) values (
    p_invoice_id, trim(p_reference), 'CONFIRMED', p_amount, v_invoice.currency,
    p_paid_at, p_method, p_notes
  )
  returning id into v_payment_id;

  select count(*) into v_commissions
    from platform.commission_events where payment_id = v_payment_id;

  perform platform.log_audit(
    'MANUAL_PAYMENT_CONFIRMED', 'payment', v_payment_id::text,
    v_invoice.customer_organization_id, null,
    jsonb_build_object(
      'invoice', v_invoice.number, 'amount', p_amount, 'currency', v_invoice.currency,
      'method', p_method, 'reference', p_reference, 'commission_events', v_commissions
    )
  );

  return jsonb_build_object(
    'payment_id', v_payment_id, 'commission_events', v_commissions,
    'invoice_number', v_invoice.number
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Vista de comisiones con su ORIGEN legible (Fase 12 §UI).
-- ---------------------------------------------------------------------------
create or replace view platform.v_commission_detail
with (security_invoker = true) as
select
  e.id                as commission_event_id,
  e.sales_agent_id,
  sa.full_name        as agent_name,
  sa.code             as agent_code,
  e.saas_product_id,
  sp.short_name       as product_short_name,
  e.tenant_id,
  t.name              as tenant_name,
  e.payment_id,
  p.reference         as payment_reference,
  p.method            as payment_method,
  p.status            as payment_status,
  p.paid_at,
  i.id                as invoice_id,
  i.number            as invoice_number,
  il.charge_kind,
  -- Traducción del origen a lenguaje de negocio.
  case
    when e.reversal_of_event_id is not null then 'Reverso'
    when il.charge_kind in ('LICENSE', 'TENANT_LICENSE', 'PARTNER_BASE_LICENSE') then 'Licencia'
    when il.charge_kind = 'IMPLEMENTATION_FEE' then 'Implementación'
    when il.charge_kind = 'INFRASTRUCTURE_FEE' then 'Infraestructura'
    when il.charge_kind = 'SUPPORT_FEE' then 'Soporte'
    else coalesce(il.charge_kind::text, 'Otro')
  end                 as source_label,
  cr.name             as rule_name,
  cr.basis            as rule_basis,
  e.base_amount,
  e.applied_rate,
  e.attribution_pct,
  e.amount,
  e.currency,
  e.status,
  e.earned_on,
  e.settlement_id,
  cs.code             as settlement_code,
  cs.status           as settlement_status,
  e.reversal_of_event_id,
  e.reversal_reason,
  (e.reversal_of_event_id is not null) as is_reversal,
  -- ¿Este devengo ya fue compensado? Se ve sin tener que cruzar a mano.
  exists (
    select 1 from platform.commission_events r where r.reversal_of_event_id = e.id
  )                   as has_reversal
from platform.commission_events e
join platform.sales_agents sa on sa.id = e.sales_agent_id
left join platform.saas_products sp on sp.id = e.saas_product_id
left join platform.tenants t on t.id = e.tenant_id
left join platform.payments p on p.id = e.payment_id
left join platform.invoices i on i.id = p.invoice_id
left join platform.invoice_lines il on il.id = e.invoice_line_id
left join platform.commission_rules cr on cr.id = e.commission_rule_id
left join platform.commission_settlements cs on cs.id = e.settlement_id;

grant select on platform.v_commission_detail to authenticated;
revoke all on platform.v_commission_detail from anon;

-- ---------------------------------------------------------------------------
-- 6. Reconciliación financiera (Fase 13 §2).
--
-- Cada fila es un HALLAZGO con estado OK / REVIEW / ERROR. La vista no corrige
-- nada: describe lo que no cuadra para que una persona decida.
-- ---------------------------------------------------------------------------
create or replace view platform.v_finance_reconciliation
with (security_invoker = true) as

-- (1) Deriva entre el proveedor de pago y el estado local
select
  'PROVIDER_DRIFT'                              as finding_type,
  r.reconciliation_status                       as severity,
  r.subscription_code                           as subject,
  r.billed_organization_name                    as organization_name,
  coalesce(r.last_error_message,
           'Local ' || r.local_status || ' vs proveedor ' || r.provider_status) as detail,
  null::numeric                                 as amount,
  null::bpchar                                  as currency,
  r.subscription_id
from platform.v_provider_reconciliation r
where r.reconciliation_status <> 'OK'

union all

-- (2) Facturas emitidas y vencidas sin cobrar
select
  'OPEN_INVOICE',
  case when i.due_date < current_date - 30 then 'ERROR' else 'REVIEW' end,
  i.number,
  o.display_name,
  'Emitida el ' || coalesce(i.issue_date::text, '?') ||
    ', vence el ' || coalesce(i.due_date::text, '?') || ', sin cobro completo',
  i.total - coalesce((select sum(p.amount) from platform.payments p
                       where p.invoice_id = i.id and p.status = 'CONFIRMED'), 0),
  i.currency,
  i.subscription_id
from platform.invoices i
join platform.organizations o on o.id = i.customer_organization_id
where i.status in ('ISSUED', 'PARTIALLY_PAID')
  and i.due_date is not null
  and i.due_date < current_date

union all

-- (3) OS/OC vencidas cuando el método de cobro las exige
select
  'EXPIRED_DOCUMENT',
  'ERROR',
  coalesce(d.document_number, 'OS/OC sin número'),
  c.billed_organization_name,
  'Documento ' || d.status || ' con vigencia hasta ' || coalesce(d.valid_to::text, '?') ||
    ' en una suscripción que exige documento',
  d.amount,
  d.currency,
  d.subscription_id
from platform.subscription_commercial_documents d
join platform.v_subscription_collection c on c.subscription_id = d.subscription_id
where d.status = 'EXPIRED'
  and (c.requires_service_order or c.requires_purchase_order)

union all

-- (4) Cobros revertidos: nunca desaparecen del radar
select
  'REVERSED_PAYMENT',
  'REVIEW',
  p.reference,
  o.display_name,
  'Cobro revertido' ||
    case when exists (select 1 from platform.commission_events e
                       where e.payment_id = p.id and e.reversal_of_event_id is not null)
         then ' con contra-evento de comisión registrado'
         else ' SIN contra-evento de comisión: revisar' end,
  p.amount,
  p.currency,
  i.subscription_id
from platform.payments p
join platform.invoices i on i.id = p.invoice_id
join platform.organizations o on o.id = i.customer_organization_id
where p.status = 'REVERSED'

union all

-- (5) Eventos de webhook rechazados
select
  'REJECTED_WEBHOOK',
  'ERROR',
  e.event_type,
  a.code,
  coalesce(e.error_message, 'Evento rechazado por el adapter'),
  null::numeric,
  null::bpchar,
  e.subscription_id
from platform.provider_webhook_events e
join platform.payment_provider_accounts a on a.id = e.provider_account_id
where e.status = 'REJECTED'

union all

-- (6) Suscripciones activas y facturables SIN perfil de cobro:
--     se cobran a mano, y conviene que gerencia lo sepa.
select
  'MISSING_COLLECTION_PROFILE',
  'REVIEW',
  c.subscription_code,
  c.billed_organization_name,
  'Suscripción activa sin perfil de cobro: se cobra manualmente por omisión',
  null::numeric,
  c.currency,
  c.subscription_id
from platform.v_subscription_collection c
where c.profile_missing
  and c.subscription_status = 'ACTIVE';

comment on view platform.v_finance_reconciliation is
  'Hallazgos de conciliación con estado OK/REVIEW/ERROR. Describe; no corrige. '
  'Corregir automáticamente un descuadre destruye la trazabilidad del cierre.';

grant select on platform.v_finance_reconciliation to authenticated;
revoke all on platform.v_finance_reconciliation from anon;

-- ---------------------------------------------------------------------------
-- 7. Panel gerencial por producto (Fase 13 §4).
--
-- Extiende `v_product_margin` del baseline separando lo que gerencia pide ver
-- por partidas: implementación, infraestructura y soporte cobrados. TODO SIGUE
-- AGRUPADO POR MONEDA: no hay FX, y sumar PEN con USD daría un número que nadie
-- puede auditar.
-- ---------------------------------------------------------------------------
create or replace view platform.v_product_finance
with (security_invoker = true) as
with collected_by_kind as (
  select
    r.saas_product_id,
    r.currency,
    sum(r.collected_amount) filter (
      where r.charge_kind in ('LICENSE', 'TENANT_LICENSE', 'PARTNER_BASE_LICENSE')
    )                                                                  as collected_license,
    sum(r.collected_amount) filter (where r.charge_kind = 'IMPLEMENTATION_FEE')
                                                                       as collected_implementation,
    sum(r.collected_amount) filter (where r.charge_kind = 'INFRASTRUCTURE_FEE')
                                                                       as collected_infrastructure,
    sum(r.collected_amount) filter (where r.charge_kind = 'SUPPORT_FEE')
                                                                       as collected_support
  from platform.v_collected_revenue r
  where r.saas_product_id is not null
  group by r.saas_product_id, r.currency
)
select
  m.saas_product_id,
  m.product_code,
  m.short_name,
  m.currency,
  m.mrr,
  m.arr,
  m.collected_revenue,
  m.collected_recurring,
  m.collected_one_time,
  coalesce(k.collected_license, 0)        as collected_license,
  coalesce(k.collected_implementation, 0) as collected_implementation,
  coalesce(k.collected_infrastructure, 0) as collected_infrastructure,
  coalesce(k.collected_support, 0)        as collected_support,
  m.direct_cost,
  -- `commission_total` ya viene NETO de contra-eventos: los negativos se suman.
  m.commission_total,
  m.commission_paid,
  m.commission_pending,
  m.gross_margin,
  case when m.collected_revenue > 0
       then round(m.gross_margin / m.collected_revenue, 4)
       else null end                      as margin_rate,
  (select count(*) from platform.tenants t
    where t.saas_product_id = m.saas_product_id and t.status = 'ACTIVE')  as active_tenants,
  (select count(*) from platform.subscriptions s
    where s.saas_product_id = m.saas_product_id and s.status = 'ACTIVE')  as active_subscriptions
from platform.v_product_margin m
left join collected_by_kind k
       on k.saas_product_id = m.saas_product_id and k.currency = m.currency;

grant select on platform.v_product_finance to authenticated;
revoke all on platform.v_product_finance from anon;

-- ---------------------------------------------------------------------------
-- 8. Panel por partner (Fase 13 §5).
--
-- DISTINCIÓN QUE ESTA VISTA HACE EXPLÍCITA: el MARGEN DEL PARTNER y la COMISIÓN
-- DEL COMERCIAL son cosas distintas y NO se restan dos veces.
--
--   · margen del partner  = descuento sobre el precio de lista (channel_margin_rate).
--     Es dinero que EBIM nunca ingresa.
--   · comisión del agente = pago a una persona por una venta cobrada.
--     Es dinero que EBIM ingresa y luego paga.
--
-- Se muestran en columnas separadas justamente para que nadie las agregue.
-- ---------------------------------------------------------------------------
create or replace view platform.v_partner_finance
with (security_invoker = true) as
select
  o.id                                as organization_id,
  o.display_name                      as organization_name,
  o.slug                              as organization_slug,
  pm.currency,
  pm.mrr,
  pm.collected_revenue,
  pm.direct_cost,
  pm.gross_margin,
  -- Margen comercial pactado con el canal, ponderado por lo cobrado.
  (select round(coalesce(sum(s.channel_margin_rate * cr.collected), 0)
                / nullif(sum(cr.collected), 0), 4)
     from platform.subscriptions s
     join lateral (
       select coalesce(sum(v.collected_amount), 0) as collected
         from platform.v_collected_revenue v
         join platform.invoices i2 on i2.id = v.invoice_id
        where i2.subscription_id = s.id and v.currency = pm.currency
     ) cr on true
    where s.channel_margin_rate is not null
      and (s.billed_organization_id = o.id
        or exists (select 1 from platform.tenants t
                    where t.id = s.tenant_id and t.managing_organization_id = o.id))
  )                                   as weighted_channel_margin_rate,
  -- Comisiones a comerciales atribuidas a este canal. Concepto DISTINTO.
  (select coalesce(sum(e.amount), 0)
     from platform.commission_events e
     join platform.sales_attributions a on a.id = e.sales_attribution_id
    where a.channel_organization_id = o.id
      and e.currency = pm.currency
      and e.status <> 'VOID')         as agent_commissions,
  (select count(*) from platform.tenants t
    where t.managing_organization_id = o.id and t.status = 'ACTIVE')  as managed_tenants,
  (select count(*) from platform.organization_product_agreements a
    where a.organization_id = o.id and a.status = 'ACTIVE')           as active_agreements
from platform.organizations o
join platform.v_partner_margin pm on pm.organization_id = o.id;

comment on view platform.v_partner_finance is
  'Margen del canal y comisión de comerciales en columnas SEPARADAS. Son '
  'conceptos distintos y sumarlos los contaría dos veces.';

grant select on platform.v_partner_finance to authenticated;
revoke all on platform.v_partner_finance from anon;

-- ---------------------------------------------------------------------------
-- 9. GRANTS
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'platform'
       and p.proname in ('reverse_payment', 'confirm_manual_payment')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;
