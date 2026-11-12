-- ============================================================================
-- MasterAdmin · M1 · Cobro de pasarela imputado a una FACTURA concreta
-- ----------------------------------------------------------------------------
-- Spec §2.2. Hermana de `register_provider_payment` (migración 22), que imputa
-- un cobro recurrente a la SUSCRIPCIÓN del proveedor. Aquí el cargo nace en el
-- portal de pago (M1) o en el cobro automático con tarjeta guardada (M2) y trae
-- la factura en sus metadatos: no hay suscripción del proveedor de por medio.
--
-- MISMA REGLA QUE LA MIGRACIÓN 22: un cobro de pasarela es un hecho externo y
-- solo lo afirma el servidor que habló con el proveedor. Ningún usuario humano
-- —ni finanzas ni el super admin— puede invocarla; para dinero registrado a
-- mano sigue existiendo `confirm_manual_payment`.
--
-- Garantías:
--   · idempotente por `payments.reference = 'culqi:' || chr_` (único en el
--     baseline): el mismo cargo que llega por el portal, por el webhook y por la
--     reconciliación entra UNA vez → {duplicate: true};
--   · moneda = la de la factura; factura ISSUED/PARTIALLY_PAID; sin sobrecobro;
--   · la cuenta del cargo debe poder cobrar esa factura;
--   · inserta `payments` CONFIRMED: el trigger existente genera las comisiones
--     (una sola vez) y cierra las alertas de la factura.
-- ============================================================================

/**
 * ¿Puede esta cuenta cobrar esta factura con tarjeta? Es la cuenta resuelta
 * (resolve_invoice_card_account) o, para una factura con suscripción, cualquier
 * candidato ELEGIBLE que cobre su moneda: un cargo hecho ayer con la cuenta
 * vigente no se rechaza porque hoy el perfil apunte a otra.
 */
create or replace function platform.invoice_card_account_eligible(p_invoice_id uuid, p_account_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_invoice record;
begin
  if p_account_id is null then
    return false;
  end if;
  if p_account_id = platform.resolve_invoice_card_account(p_invoice_id) then
    return true;
  end if;

  select i.subscription_id, i.currency into v_invoice from platform.invoices i where i.id = p_invoice_id;
  if v_invoice.subscription_id is null then
    return false;
  end if;

  return exists (
    select 1
      from platform.provider_account_candidates(v_invoice.subscription_id, 'CULQI_CARD') c
     where c.provider_account_id = p_account_id
       and c.eligible
       and exists (select 1 from platform.payment_provider_account_currencies x
                    where x.provider_account_id = p_account_id
                      and x.currency_code = v_invoice.currency and x.status = 'ACTIVE')
  );
end;
$$;

revoke all on function platform.invoice_card_account_eligible(uuid, uuid) from public, anon, authenticated;
grant execute on function platform.invoice_card_account_eligible(uuid, uuid) to service_role;

create or replace function platform.register_provider_invoice_payment(
  p_provider_account_id uuid,
  p_external_event_key  text,
  p_external_charge_id  text,
  p_invoice_id          uuid,
  p_amount              numeric,
  p_currency            char(3),
  p_paid_at             timestamptz default now(),
  p_payload             jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_reference  text;
  v_payment    record;
  v_event      record;
  v_event_id   uuid;
  v_invoice    record;
  v_paid       numeric(14,2);
  v_payment_id uuid;
  v_commissions integer := 0;
begin
  -- ---- SERVER-ONLY (mismo criterio que register_provider_payment) ---------
  if not platform.is_service_context() then
    raise exception 'NO_AUTORIZADO_SERVER_ONLY: registrar un cobro de proveedor es una operación de servidor. Para un cobro manual usa platform.confirm_manual_payment()'
      using errcode = '42501';
  end if;

  if coalesce(btrim(p_external_charge_id), '') = '' or p_external_charge_id ~* '^(sk|pk|tkn)_' then
    raise exception 'CARGO_INVALIDO: se esperaba el id opaco de un cargo (chr_…)' using errcode = '22023';
  end if;
  if coalesce(btrim(p_external_event_key), '') = '' then
    raise exception 'EVENTO_REQUERIDO: la clave idempotente del evento es obligatoria' using errcode = '23502';
  end if;

  v_reference := 'culqi:' || p_external_charge_id;

  -- ---- 1. Idempotencia por REFERENCIA (antes que cualquier validación) ----
  -- Un mismo cargo puede llegar por el portal, por el webhook y por la
  -- reconciliación. Si ya entró, se responde duplicado aunque la factura ya
  -- esté PAGADA: rechazarlo por «factura no pagable» sería mentir.
  select p.id, p.invoice_id into v_payment from platform.payments p where p.reference = v_reference;
  if v_payment.id is not null then
    insert into platform.provider_webhook_events (
      provider_account_id, external_event_key, event_type, payload, status, payment_id,
      error_code, error_message, processed_at
    ) values (
      p_provider_account_id, p_external_event_key, 'invoice.charge', coalesce(p_payload, '{}'::jsonb),
      'IGNORED', v_payment.id, 'PAGO_YA_REGISTRADO',
      'El cargo ya estaba registrado con esa referencia', now()
    )
    on conflict (provider_account_id, external_event_key) do nothing;

    return jsonb_build_object(
      'duplicate', true, 'payment_id', v_payment.id, 'invoice_id', v_payment.invoice_id
    );
  end if;

  -- ---- 2. Idempotencia por EVENTO -----------------------------------------
  select e.id, e.payment_id, e.status into v_event
    from platform.provider_webhook_events e
   where e.provider_account_id = p_provider_account_id
     and e.external_event_key = p_external_event_key;
  if v_event.id is not null then
    return jsonb_build_object(
      'duplicate', true, 'payment_id', v_event.payment_id, 'event_id', v_event.id,
      'status', v_event.status
    );
  end if;

  -- ---- 3. Factura: existe, emitida, moneda, saldo --------------------------
  -- FOR UPDATE: dos cargos simultáneos sobre la misma factura se serializan, y
  -- el segundo ve el pago del primero al calcular el saldo.
  select i.* into v_invoice from platform.invoices i where i.id = p_invoice_id for update;
  if v_invoice.id is null then
    raise exception 'FACTURA_NO_ENCONTRADA: %', p_invoice_id using errcode = '23503';
  end if;
  if v_invoice.status not in ('ISSUED', 'PARTIALLY_PAID') then
    raise exception 'FACTURA_NO_PAGABLE: la factura % está % y no admite cobros con tarjeta',
      v_invoice.number, v_invoice.status
      using errcode = '23514';
  end if;
  if p_currency is distinct from v_invoice.currency then
    raise exception 'MONEDA_INCOHERENTE: el cargo llega en % y la factura % está en %',
      p_currency, v_invoice.number, v_invoice.currency
      using errcode = '23514';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'IMPORTE_INVALIDO: el importe cobrado debe ser mayor que cero' using errcode = '23514';
  end if;

  select coalesce(sum(p.amount), 0) into v_paid
    from platform.payments p where p.invoice_id = p_invoice_id and p.status = 'CONFIRMED';
  if v_paid + p_amount > v_invoice.total + 0.005 then
    raise exception 'SOBRECOBRO: la factura % suma % de % y este cargo de % la excedería',
      v_invoice.number, v_paid, v_invoice.total, p_amount
      using errcode = '23514';
  end if;

  -- ---- 4. Cuenta: debe poder cobrar esta factura --------------------------
  if not exists (select 1 from platform.payment_provider_accounts a
                  where a.id = p_provider_account_id and a.provider_kind = 'CULQI') then
    raise exception 'CUENTA_PROVEEDOR_NO_ENCONTRADA: %', p_provider_account_id using errcode = '23503';
  end if;
  if not platform.invoice_card_account_eligible(p_invoice_id, p_provider_account_id) then
    raise exception 'CUENTA_PROVEEDOR_NO_COINCIDE: la cuenta del cargo no cobra la factura %', v_invoice.number
      using errcode = '42501';
  end if;

  -- ---- 5. Ledger + pago ---------------------------------------------------
  insert into platform.provider_webhook_events (
    provider_account_id, external_event_key, event_type, payload, status, subscription_id
  ) values (
    p_provider_account_id, p_external_event_key, 'invoice.charge', coalesce(p_payload, '{}'::jsonb),
    'RECEIVED', v_invoice.subscription_id
  )
  returning id into v_event_id;

  insert into platform.payments (
    invoice_id, reference, status, amount, currency, paid_at, method, notes
  ) values (
    p_invoice_id, v_reference, 'CONFIRMED', p_amount, v_invoice.currency, coalesce(p_paid_at, now()),
    'CULQI_CARD', 'Cobro con tarjeta confirmado por el proveedor (factura)'
  )
  returning id into v_payment_id;

  -- El trigger del baseline ya generó las comisiones de este pago.
  select count(*) into v_commissions from platform.commission_events where payment_id = v_payment_id;

  update platform.provider_webhook_events
     set status = 'PROCESSED', payment_id = v_payment_id, processed_at = now()
   where id = v_event_id;

  perform platform.log_audit(
    'PROVIDER_INVOICE_PAYMENT_REGISTERED', 'payment', v_payment_id::text,
    v_invoice.customer_organization_id, null,
    jsonb_build_object(
      'invoice', v_invoice.number,
      'external_charge_id', p_external_charge_id,
      'amount', p_amount, 'currency', v_invoice.currency,
      'commission_events', v_commissions,
      'event_id', v_event_id,
      'origin', coalesce(p_payload ->> 'origin', 'provider')
    )
  );

  return jsonb_build_object(
    'duplicate', false,
    'payment_id', v_payment_id,
    'invoice_id', p_invoice_id,
    'event_id', v_event_id,
    'commission_events', v_commissions
  );
end;
$$;

comment on function platform.register_provider_invoice_payment is
  'SERVER-ONLY. Registra un cargo de pasarela imputado a una factura (portal de pago o tarjeta '
  'guardada). Idempotente por reference culqi:<chr>. Valida moneda, estado, saldo (sin sobrecobro) '
  'y que la cuenta pueda cobrar la factura. El trigger existente genera las comisiones.';

revoke all on function platform.register_provider_invoice_payment(uuid, text, text, uuid, numeric, char, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function platform.register_provider_invoice_payment(uuid, text, text, uuid, numeric, char, timestamptz, jsonb)
  to service_role;
