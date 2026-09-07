-- ============================================================================
-- EBIM Control Plane V2.1 — 22 · Escrituras PROVIDER-ORIGINATED = SERVER-ONLY
-- ----------------------------------------------------------------------------
-- Fase 2 del hardening. Corrige tres hallazgos verificados de la auditoría.
--
-- EL PROBLEMA
-- -----------
-- Un `payments` con status CONFIRMED es, en este dominio, la ÚNICA cosa que
-- devenga comisión. Y hasta esta migración, `register_provider_payment()` tenía
-- GRANT de EXECUTE para `authenticated` y aceptaba a cualquiera que superara
-- `can_read_finance()`.
--
-- Consecuencia verificada empíricamente antes de escribir este archivo:
--
--     finance@ebim.test  ->  register_provider_payment(...)  ->  accepted: true
--                        ->  1 fila nueva en `payments` (CONFIRMED)
--                        ->  el trigger del baseline devengó su comisión
--
-- Es decir: un usuario humano podía FABRICAR un cobro que nunca ocurrió en la
-- pasarela, y con él una comisión. No es una escalada de privilegios: es peor,
-- es una escalada CONTABLE, y no deja ninguna huella distinguible de un cobro
-- real porque entra por el mismo camino.
--
-- LA REGLA QUE ESTABLECE ESTA MIGRACIÓN
-- -------------------------------------
-- Un hecho originado en el PSP solo puede afirmarlo el servidor, porque solo el
-- servidor puede haber hablado con el PSP:
--
--     register_provider_payment          -> service_role EXCLUSIVAMENTE
--     register_provider_payment_failure  -> service_role EXCLUSIVAMENTE
--     upsert_provider_subscription       -> service_role EXCLUSIVAMENTE
--
-- Lo que NO cambia, y es deliberado: las operaciones financieras HUMANAS siguen
-- siendo humanas. `confirm_manual_payment` y `reverse_payment` continúan
-- disponibles para EBIM_FINANCE, porque una transferencia bancaria la concilia
-- una persona y un reverso lo decide una persona. Ahí el actor humano ES la
-- fuente de verdad; en un cobro de pasarela, no.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Helper: ¿está corriendo esto como el servidor?
--
-- Se comprueba el rol EFECTIVO de la sesión de base de datos, no un claim del
-- JWT. `service_role` solo lo puede asumir quien tiene la clave de servicio, y
-- esa clave vive únicamente en secrets de Edge Function.
--
-- `current_user` bajo una función SECURITY DEFINER es el owner, así que NO
-- sirve: hay que mirar `current_setting('role')`, que PostgREST fija al rol del
-- JWT, y `session_user`, que es el rol real de la conexión.
-- ---------------------------------------------------------------------------
create or replace function platform.is_service_context()
returns boolean
language sql
stable
-- No es SECURITY DEFINER —no lo necesita— pero se le fija el search_path
-- igualmente: es la puerta que decide quién puede afirmar un cobro, y no
-- conviene que la resolución de sus nombres dependa del llamante.
set search_path = pg_catalog
as $$
  select coalesce(current_setting('role', true), '') = 'service_role'
      or session_user = 'service_role'
      or session_user = 'postgres';
$$;

comment on function platform.is_service_context() is
  'True solo si la ejecución viene del servidor (service_role) o de una tarea de '
  'mantenimiento local (postgres). Es la puerta de las escrituras originadas en '
  'el PSP: un hecho del proveedor solo puede afirmarlo quien habló con él.';

revoke all on function platform.is_service_context() from public, anon;
grant execute on function platform.is_service_context() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. register_provider_payment — cierre del guard interno.
--
-- Se sustituye la condición anterior
--     is_super_admin() OR can_read_finance() OR role = 'service_role'
-- por la única correcta: SOLO contexto de servidor.
--
-- El cuerpo de la función NO se reescribe: se conserva íntegra la lógica de
-- idempotencia en dos capas, la correlación obligatoria y la auditoría. Lo que
-- cambia es exclusivamente QUIÉN puede entrar.
-- ---------------------------------------------------------------------------
create or replace function platform.register_provider_payment(
  p_provider_account_id  uuid,
  p_external_event_key   text,
  p_event_type           text,
  p_external_charge_id   text,
  p_external_subscription_id text,
  p_amount               numeric,
  p_currency             char(3),
  p_paid_at              timestamptz default now(),
  p_payload              jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_event_id     uuid;
  v_existing     record;
  v_provider_sub record;
  v_subscription record;
  v_invoice_id   uuid;
  v_payment_id   uuid;
  v_reference    text;
  v_commissions  integer := 0;
begin
  -- ---- SERVER-ONLY -------------------------------------------------------
  -- Un cobro de pasarela es un hecho externo. Ningún usuario humano, por alto
  -- que sea su rol, puede AFIRMARLO: solo puede afirmarlo el proceso que habló
  -- con el proveedor. Para registrar dinero a mano existe confirm_manual_payment.
  if not platform.is_service_context() then
    raise exception 'NO_AUTORIZADO_SERVER_ONLY: registrar un cobro de proveedor es una operación de servidor. Para un cobro manual usa platform.confirm_manual_payment()'
      using errcode = '42501';
  end if;

  select * into v_existing
    from platform.provider_webhook_events
   where provider_account_id = p_provider_account_id
     and external_event_key = p_external_event_key;

  if v_existing.id is not null then
    return jsonb_build_object(
      'duplicate', true,
      'event_id', v_existing.id,
      'payment_id', v_existing.payment_id,
      'status', v_existing.status,
      'note', 'Evento ya recibido: no se procesa dos veces'
    );
  end if;

  insert into platform.provider_webhook_events (
    provider_account_id, external_event_key, event_type, payload, status
  ) values (
    p_provider_account_id, p_external_event_key, p_event_type,
    coalesce(p_payload, '{}'::jsonb), 'RECEIVED'
  )
  returning id into v_event_id;

  select * into v_provider_sub
    from platform.provider_subscriptions
   where provider_account_id = p_provider_account_id
     and external_subscription_id = p_external_subscription_id;

  if v_provider_sub.id is null then
    update platform.provider_webhook_events
       set status = 'REJECTED',
           error_code = 'SUSCRIPCION_DESCONOCIDA',
           error_message = 'El evento referencia una suscripción que no existe en el Control Plane',
           processed_at = now()
     where id = v_event_id;

    return jsonb_build_object(
      'accepted', false, 'event_id', v_event_id, 'error', 'SUSCRIPCION_DESCONOCIDA'
    );
  end if;

  update platform.provider_webhook_events
     set subscription_id = v_provider_sub.subscription_id
   where id = v_event_id;

  select * into v_subscription
    from platform.subscriptions where id = v_provider_sub.subscription_id;

  if coalesce(p_amount, 0) <= 0 then
    update platform.provider_webhook_events
       set status = 'REJECTED', error_code = 'IMPORTE_INVALIDO',
           error_message = 'El evento no trae un importe cobrado positivo', processed_at = now()
     where id = v_event_id;
    return jsonb_build_object('accepted', false, 'event_id', v_event_id, 'error', 'IMPORTE_INVALIDO');
  end if;

  -- ---- Validación de MONEDA (Fase 15) ------------------------------------
  -- Un cobro en una moneda distinta a la del contrato no se registra: sumarlo
  -- al MRR de otra divisa produciría un total que nadie puede auditar.
  if p_currency is distinct from v_subscription.currency then
    update platform.provider_webhook_events
       set status = 'REJECTED', error_code = 'MONEDA_INCOHERENTE',
           error_message = format('El cobro llega en %s y la suscripción %s está en %s',
                                  p_currency, v_subscription.code, v_subscription.currency),
           processed_at = now()
     where id = v_event_id;
    return jsonb_build_object('accepted', false, 'event_id', v_event_id, 'error', 'MONEDA_INCOHERENTE');
  end if;

  v_reference := 'culqi:' || p_external_charge_id;

  select id into v_payment_id from platform.payments where reference = v_reference;
  if v_payment_id is not null then
    update platform.provider_webhook_events
       set status = 'IGNORED', payment_id = v_payment_id,
           error_code = 'PAGO_YA_REGISTRADO',
           error_message = 'El cargo ya estaba registrado con esa referencia',
           processed_at = now()
     where id = v_event_id;
    return jsonb_build_object('duplicate', true, 'event_id', v_event_id, 'payment_id', v_payment_id);
  end if;

  select i.id into v_invoice_id
    from platform.invoices i
   where i.subscription_id = v_subscription.id
     and i.status in ('ISSUED', 'PARTIALLY_PAID')
     and i.currency = p_currency
   order by i.issue_date nulls last
   limit 1;

  if v_invoice_id is null then
    insert into platform.invoices (
      number, customer_organization_id, subscription_id, status, currency,
      issue_date, due_date, period_start, period_end,
      subtotal, tax_amount, total, notes, metadata
    ) values (
      'INV-' || to_char(now(), 'YYYYMM') || '-' || substr(replace(p_external_charge_id, '_', ''), 1, 12),
      v_subscription.billed_organization_id, v_subscription.id, 'ISSUED', p_currency,
      current_date, current_date, date_trunc('month', p_paid_at)::date,
      (date_trunc('month', p_paid_at) + interval '1 month - 1 day')::date,
      p_amount, 0, p_amount,
      'Factura generada automáticamente al confirmarse el cobro del proveedor',
      jsonb_build_object('origin', 'provider_webhook', 'external_charge_id', p_external_charge_id)
    )
    returning id into v_invoice_id;

    insert into platform.invoice_lines (
      invoice_id, charge_kind, description, saas_product_id, tenant_id,
      quantity, unit_amount, currency, is_recurring
    ) values (
      v_invoice_id, 'LICENSE',
      'Cobro recurrente ' || v_subscription.code,
      v_subscription.saas_product_id, v_subscription.tenant_id,
      1, p_amount, p_currency, true
    );
  end if;

  insert into platform.payments (
    invoice_id, reference, status, amount, currency, paid_at, method, notes
  ) values (
    v_invoice_id, v_reference, 'CONFIRMED', p_amount, p_currency, p_paid_at,
    'CULQI_CARD', 'Cobro confirmado por webhook del proveedor'
  )
  returning id into v_payment_id;

  select count(*) into v_commissions
    from platform.commission_events where payment_id = v_payment_id;

  update platform.provider_webhook_events
     set status = 'PROCESSED', payment_id = v_payment_id, processed_at = now()
   where id = v_event_id;

  update platform.provider_subscriptions
     set provider_status = 'active', synced_at = now(),
         last_error_code = null, last_error_message = null
   where id = v_provider_sub.id;

  perform platform.log_audit(
    'PROVIDER_PAYMENT_REGISTERED', 'payment', v_payment_id::text,
    v_subscription.billed_organization_id, v_subscription.tenant_id,
    jsonb_build_object(
      'subscription', v_subscription.code,
      'external_charge_id', p_external_charge_id,
      'amount', p_amount, 'currency', p_currency,
      'commission_events', v_commissions,
      'event_id', v_event_id
    )
  );

  return jsonb_build_object(
    'accepted', true, 'event_id', v_event_id, 'payment_id', v_payment_id,
    'invoice_id', v_invoice_id, 'commission_events', v_commissions
  );
end;
$$;

comment on function platform.register_provider_payment is
  'SERVER-ONLY. Único camino por el que un cobro del proveedor entra en `payments`. '
  'Idempotente en dos capas y con validación de importe y moneda. Un usuario '
  'humano NO puede invocarla: para dinero registrado a mano existe confirm_manual_payment.';

-- ---------------------------------------------------------------------------
-- 3. register_provider_payment_failure — mismo cierre.
-- ---------------------------------------------------------------------------
create or replace function platform.register_provider_payment_failure(
  p_provider_account_id      uuid,
  p_external_event_key       text,
  p_event_type               text,
  p_external_subscription_id text,
  p_error_code               text default null,
  p_error_message            text default null,
  p_payload                  jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_event_id     uuid;
  v_existing     uuid;
  v_provider_sub record;
begin
  if not platform.is_service_context() then
    raise exception 'NO_AUTORIZADO_SERVER_ONLY: un fallo de cobro del proveedor es un hecho externo; solo el servidor puede registrarlo'
      using errcode = '42501';
  end if;

  select id into v_existing
    from platform.provider_webhook_events
   where provider_account_id = p_provider_account_id
     and external_event_key = p_external_event_key;

  if v_existing is not null then
    return jsonb_build_object('duplicate', true, 'event_id', v_existing);
  end if;

  insert into platform.provider_webhook_events (
    provider_account_id, external_event_key, event_type, payload, status,
    error_code, error_message, processed_at
  ) values (
    p_provider_account_id, p_external_event_key, p_event_type,
    coalesce(p_payload, '{}'::jsonb), 'PROCESSED',
    p_error_code, p_error_message, now()
  )
  returning id into v_event_id;

  select * into v_provider_sub
    from platform.provider_subscriptions
   where provider_account_id = p_provider_account_id
     and external_subscription_id = p_external_subscription_id;

  if v_provider_sub.id is not null then
    update platform.provider_subscriptions
       set last_error_code = p_error_code,
           last_error_message = p_error_message,
           provider_status = 'payment_failed',
           synced_at = now()
     where id = v_provider_sub.id;

    update platform.provider_webhook_events
       set subscription_id = v_provider_sub.subscription_id
     where id = v_event_id;
  end if;

  return jsonb_build_object(
    'accepted', true, 'event_id', v_event_id,
    'payment_created', false,
    'note', 'Un cobro fallido no genera payments ni comisión'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. upsert_provider_subscription — mismo cierre.
--
-- Antes admitía `can_manage_commercial()` o `is_org_admin(billed_org)`. Se
-- verificó que un ORG_ADMIN podía crear y sobrescribir el mapeo, es decir,
-- apuntar SU suscripción a otra suscripción del proveedor. A partir de ahí, los
-- cobros de esa suscripción externa se habrían imputado a su contrato.
-- ---------------------------------------------------------------------------
create or replace function platform.upsert_provider_subscription(
  p_provider_account_id        uuid,
  p_subscription_id            uuid,
  p_external_subscription_id   text,
  p_external_plan_id           text default null,
  p_external_payment_method_id text default null,
  p_external_customer_id       text default null,
  p_provider_status            text default 'active',
  p_next_billing_at            timestamptz default null,
  p_metadata                   jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id  uuid;
  v_sub record;
begin
  if not platform.is_service_context() then
    raise exception 'NO_AUTORIZADO_SERVER_ONLY: el mapeo con la suscripción del proveedor lo establece el servidor tras hablar con la pasarela, no un usuario'
      using errcode = '42501';
  end if;

  select * into v_sub from platform.subscriptions where id = p_subscription_id;
  if v_sub is null then
    raise exception 'SUSCRIPCION_NO_ENCONTRADA: %', p_subscription_id using errcode = '23503';
  end if;

  insert into platform.provider_subscriptions (
    provider_account_id, subscription_id, external_subscription_id, external_plan_id,
    external_payment_method_id, external_customer_id, provider_status, next_billing_at,
    metadata, synced_at
  ) values (
    p_provider_account_id, p_subscription_id, p_external_subscription_id, p_external_plan_id,
    p_external_payment_method_id, p_external_customer_id, p_provider_status, p_next_billing_at,
    coalesce(p_metadata, '{}'::jsonb), now()
  )
  on conflict (provider_account_id, external_subscription_id) do update
    set external_plan_id = excluded.external_plan_id,
        external_payment_method_id = excluded.external_payment_method_id,
        external_customer_id = excluded.external_customer_id,
        provider_status = excluded.provider_status,
        next_billing_at = excluded.next_billing_at,
        metadata = excluded.metadata,
        synced_at = now()
  returning id into v_id;

  perform platform.log_audit(
    'PROVIDER_SUBSCRIPTION_LINKED', 'provider_subscription', v_id::text,
    v_sub.billed_organization_id, v_sub.tenant_id,
    jsonb_build_object(
      'subscription', v_sub.code,
      'external_subscription_id', p_external_subscription_id,
      'provider_status', p_provider_status
    )
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. GRANTS: se REVOCA `authenticated` de las tres.
--
-- Defensa en profundidad: el guard del cuerpo ya rechazaría la llamada, pero
-- quitar el EXECUTE hace que PostgREST ni siquiera exponga la función. Un
-- atacante no debería poder ni descubrir que existe.
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
         'register_provider_payment',
         'register_provider_payment_failure',
         'upsert_provider_subscription'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Autorización explícita para el worker de provisioning (Fase 5).
--
-- `verify_jwt = true` solo prueba que existe un JWT válido, no que su portador
-- pueda aprovisionar infraestructura. Esta función es el gate que la Edge
-- Function debe consultar ANTES de construir el cliente `service_role`.
-- ---------------------------------------------------------------------------
create or replace function platform.can_run_provisioning()
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select platform.is_super_admin()
      or platform.has_platform_role('EBIM_PRODUCT_ADMIN');
$$;

comment on function platform.can_run_provisioning() is
  'Gate del worker de provisioning. Solo el super admin y EBIM_PRODUCT_ADMIN '
  'pueden lanzarlo manualmente. Un JWT válido NO es autorización.';

revoke all on function platform.can_run_provisioning() from public, anon;
grant execute on function platform.can_run_provisioning() to authenticated, service_role;
