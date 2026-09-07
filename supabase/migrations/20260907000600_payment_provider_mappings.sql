-- ============================================================================
-- EBIM Control Plane V2 — 19 · Mapeos de proveedor de pago (Culqi y futuros)
-- ----------------------------------------------------------------------------
-- Fase 10 de `.claude-prompts-v2`. Diseño: `docs/payments/CULQI_ARCHITECTURE.md`.
--
-- QUÉ GUARDAN ESTAS TABLAS: identificadores externos y metadatos NO sensibles.
-- Nada más. En concreto NO guardan:
--   · PAN ni CVV — nunca tocan nuestro servidor: los tokeniza el navegador;
--   · el token de tarjeta — es efímero y de un solo uso;
--   · ninguna clave `sk_`/`pk_` — las claves viven en secrets del servidor.
--
-- `brand` y `last4` sí se guardan: no permiten cobrar nada y son lo único que
-- deja al usuario reconocer "la Visa terminada en 4242" en la pantalla.
-- ============================================================================

create type platform.provider_mapping_status as enum ('ACTIVE', 'INACTIVE', 'FAILED', 'PENDING');

create type platform.webhook_event_status as enum (
  'RECEIVED',   -- almacenado, aún sin procesar
  'PROCESSED',  -- aplicado correctamente
  'IGNORED',    -- duplicado o irrelevante; no es un error
  'REJECTED'    -- no superó la validación estricta: hay que mirarlo
);

-- ---------------------------------------------------------------------------
-- 1. Customer del proveedor
-- ---------------------------------------------------------------------------
create table platform.provider_customers (
  id                   uuid primary key default gen_random_uuid(),
  provider_account_id  uuid not null references platform.payment_provider_accounts(id) on delete restrict,
  organization_id      uuid not null references platform.organizations(id) on delete cascade,
  external_customer_id text not null,
  status               platform.provider_mapping_status not null default 'ACTIVE',
  metadata             jsonb not null default '{}'::jsonb,
  synced_at            timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint provider_customers_uk unique (provider_account_id, organization_id),
  -- Un id externo no puede parecer una credencial.
  constraint provider_customers_no_key_ck check (external_customer_id !~* '^(sk|pk)_(test|live)_')
);

create index provider_customers_org_idx on platform.provider_customers(organization_id);
create index provider_customers_account_idx on platform.provider_customers(provider_account_id);
create index provider_customers_external_idx on platform.provider_customers(external_customer_id);

-- ---------------------------------------------------------------------------
-- 2. Medio de pago (tarjeta)
-- ---------------------------------------------------------------------------
create table platform.provider_payment_methods (
  id                         uuid primary key default gen_random_uuid(),
  provider_account_id        uuid not null references platform.payment_provider_accounts(id) on delete restrict,
  organization_id            uuid not null references platform.organizations(id) on delete cascade,
  provider_customer_id       uuid references platform.provider_customers(id) on delete set null,
  external_payment_method_id text not null,
  -- Datos NO sensibles, solo para que el usuario reconozca su medio de pago.
  brand                      text,
  last4                      char(4),
  exp_month                  smallint,
  exp_year                   smallint,
  is_default                 boolean not null default false,
  status                     platform.provider_mapping_status not null default 'ACTIVE',
  metadata                   jsonb not null default '{}'::jsonb,
  synced_at                  timestamptz not null default now(),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint provider_pm_uk unique (provider_account_id, external_payment_method_id),
  -- `last4` es literalmente eso: cuatro dígitos. Cualquier cosa más larga sería
  -- un PAN parcial, y un PAN parcial no se guarda.
  constraint provider_pm_last4_ck check (last4 is null or last4 ~ '^[0-9]{4}$'),
  constraint provider_pm_exp_ck check (
    (exp_month is null or exp_month between 1 and 12)
    and (exp_year is null or exp_year between 2000 and 2100)
  ),
  constraint provider_pm_no_key_ck check (external_payment_method_id !~* '^(sk|pk|tkn)_')
);

comment on table platform.provider_payment_methods is
  'Referencia al medio de pago en el proveedor. NUNCA PAN, CVV ni el token de '
  'tarjeta: el token es efímero, de un solo uso, y no se persiste.';

create index provider_pm_org_idx on platform.provider_payment_methods(organization_id);
create index provider_pm_account_idx on platform.provider_payment_methods(provider_account_id);
create index provider_pm_customer_idx on platform.provider_payment_methods(provider_customer_id);

-- Un solo medio por defecto y activo por organización y cuenta.
create unique index provider_pm_default_uk
  on platform.provider_payment_methods(provider_account_id, organization_id)
  where is_default and status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- 3. Plan del proveedor
--
-- El mapeo es a nivel de `plans` + intervalo + moneda, no de `plan_prices`: un
-- Plan de Culqi es "importe + frecuencia", y dos tarifas históricas del mismo
-- plan con el mismo importe son el mismo Plan externo.
-- ---------------------------------------------------------------------------
create table platform.provider_plans (
  id                  uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null references platform.payment_provider_accounts(id) on delete restrict,
  plan_id             uuid not null references platform.plans(id) on delete cascade,
  external_plan_id    text not null,
  -- Snapshot de lo que se registró en el proveedor. Si la tarifa local cambia y
  -- este snapshot no, la reconciliación lo detecta como deriva.
  amount              numeric(14,2) not null,
  currency            char(3) not null,
  billing_interval    platform.billing_interval not null,
  status              platform.provider_mapping_status not null default 'ACTIVE',
  metadata            jsonb not null default '{}'::jsonb,
  synced_at           timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint provider_plans_uk unique (provider_account_id, plan_id, billing_interval, currency),
  constraint provider_plans_external_uk unique (provider_account_id, external_plan_id),
  constraint provider_plans_currency_ck check (currency ~ '^[A-Z]{3}$'),
  constraint provider_plans_amount_ck check (amount >= 0)
);

create index provider_plans_plan_idx on platform.provider_plans(plan_id);
create index provider_plans_account_idx on platform.provider_plans(provider_account_id);

-- ---------------------------------------------------------------------------
-- 4. Suscripción del proveedor
-- ---------------------------------------------------------------------------
create table platform.provider_subscriptions (
  id                         uuid primary key default gen_random_uuid(),
  provider_account_id        uuid not null references platform.payment_provider_accounts(id) on delete restrict,
  subscription_id            uuid not null references platform.subscriptions(id) on delete cascade,
  external_subscription_id   text not null,
  external_plan_id           text,
  external_payment_method_id text,
  external_customer_id       text,
  -- Estado tal y como lo reporta el proveedor, sin traducir. Traducirlo aquí
  -- perdería información cuando el proveedor añada un estado nuevo.
  provider_status            text not null default 'unknown',
  next_billing_at            timestamptz,
  last_error_code            text,
  last_error_message         text,
  status                     platform.provider_mapping_status not null default 'ACTIVE',
  metadata                   jsonb not null default '{}'::jsonb,
  synced_at                  timestamptz not null default now(),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint provider_subs_external_uk unique (provider_account_id, external_subscription_id)
);

-- Una suscripción local tiene UNA suscripción activa por proveedor. Las
-- canceladas se conservan para poder reconstruir el historial de cobro.
create unique index provider_subs_active_uk
  on platform.provider_subscriptions(subscription_id, provider_account_id)
  where status = 'ACTIVE';

create index provider_subs_subscription_idx on platform.provider_subscriptions(subscription_id);
create index provider_subs_account_idx on platform.provider_subscriptions(provider_account_id);
create index provider_subs_next_billing_idx on platform.provider_subscriptions(next_billing_at);

-- ---------------------------------------------------------------------------
-- 5. Ledger de eventos de webhook — el corazón de la idempotencia.
--
-- Culqi NO firma sus webhooks (ver CULQI_ARCHITECTURE.md §5.1), así que esta
-- tabla es la primera línea de defensa: el mismo evento entregado cinco veces
-- entra una sola vez, porque la segunda choca con el índice único.
-- ---------------------------------------------------------------------------
create table platform.provider_webhook_events (
  id                  uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null references platform.payment_provider_accounts(id) on delete restrict,
  external_event_key  text not null,
  event_type          text not null,
  -- Payload SANITIZADO por el adapter antes de llegar aquí. El trigger
  -- `reject_secret_like_json` es la red de seguridad, no el filtro principal.
  payload             jsonb not null default '{}'::jsonb,
  status              platform.webhook_event_status not null default 'RECEIVED',
  payment_id          uuid references platform.payments(id) on delete set null,
  subscription_id     uuid references platform.subscriptions(id) on delete set null,
  error_code          text,
  error_message       text,
  received_at         timestamptz not null default now(),
  processed_at        timestamptz,

  constraint provider_webhook_events_uk unique (provider_account_id, external_event_key)
);

comment on table platform.provider_webhook_events is
  'Ledger de idempotencia. Culqi no firma sus webhooks, así que la unicidad de '
  '(cuenta, clave de evento) es la defensa principal contra reprocesos y repeticiones.';

create index pwe_account_idx on platform.provider_webhook_events(provider_account_id);
create index pwe_status_idx on platform.provider_webhook_events(status);
create index pwe_received_idx on platform.provider_webhook_events(received_at desc);
create index pwe_payment_idx on platform.provider_webhook_events(payment_id);
create index pwe_subscription_idx on platform.provider_webhook_events(subscription_id);

-- ---------------------------------------------------------------------------
-- 6. updated_at + guardas de secretos
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'provider_customers', 'provider_payment_methods', 'provider_plans', 'provider_subscriptions'
  ]
  loop
    execute format(
      'create trigger %I before update on platform.%I for each row execute function platform.set_updated_at()',
      t || '_set_updated_at', t
    );
    execute format(
      'create trigger %I before insert or update on platform.%I for each row execute function platform.reject_secret_like_json(%L)',
      t || '_no_secrets', t, 'metadata'
    );
  end loop;
end;
$$;

create trigger pwe_no_secrets
  before insert or update on platform.provider_webhook_events
  for each row execute function platform.reject_secret_like_json('payload');

-- ---------------------------------------------------------------------------
-- 7. RLS + FORCE + políticas
--
-- Todas son de SOLO LECTURA para `authenticated`. Estas tablas las escribe el
-- `service_role` desde las Edge Functions, o las RPCs de más abajo.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'provider_customers', 'provider_payment_methods', 'provider_plans',
    'provider_subscriptions', 'provider_webhook_events'
  ]
  loop
    execute format('alter table platform.%I enable row level security', t);
    execute format('alter table platform.%I force row level security', t);
    execute format('grant select on platform.%I to authenticated', t);
    execute format('revoke insert, update, delete on platform.%I from authenticated', t);
  end loop;
end;
$$;

create policy provider_customers_select on platform.provider_customers
  for select to authenticated
  using (
    platform.can_read_finance()
    or platform.can_manage_platform_entities()
    or organization_id in (select platform.my_org_ids())
  );

create policy provider_pm_select on platform.provider_payment_methods
  for select to authenticated
  using (
    platform.can_read_finance()
    or platform.can_manage_platform_entities()
    or organization_id in (select platform.my_org_ids())
  );

-- El catálogo de planes externos no revela nada de un cliente concreto.
create policy provider_plans_select on platform.provider_plans
  for select to authenticated
  using (platform.can_read_finance() or platform.can_manage_platform_entities());

create policy provider_subs_select on platform.provider_subscriptions
  for select to authenticated
  using (
    exists (
      select 1 from platform.subscriptions s
       where s.id = provider_subscriptions.subscription_id
         and (
           platform.can_read_finance()
           or platform.can_manage_platform_entities()
           or s.billed_organization_id in (select platform.my_org_ids())
         )
    )
  );

-- Los eventos crudos del proveedor son diagnóstico de plataforma: no se exponen
-- a los clientes ni a los partners.
create policy pwe_select on platform.provider_webhook_events
  for select to authenticated
  using (platform.can_read_finance() or platform.is_super_admin());

-- ---------------------------------------------------------------------------
-- 8. register_provider_payment — el único camino por el que un cobro externo
--    entra en `payments`.
--
-- Es `SECURITY DEFINER` y la llama la Edge Function del webhook con el
-- `service_role`. Concentra aquí la idempotencia para que ni un bug del adapter
-- ni una entrega repetida puedan duplicar dinero.
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
  -- Solo el servidor. Un usuario del navegador no registra cobros externos.
  if not (platform.is_super_admin() or platform.can_read_finance()
          or current_setting('role', true) = 'service_role') then
    raise exception 'NO_AUTORIZADO: solo el servidor registra cobros de proveedor'
      using errcode = '42501';
  end if;

  -- ---- CAPA 1 de idempotencia: el ledger de eventos ---------------------
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

  -- ---- Correlación obligatoria ------------------------------------------
  -- Un evento que no se corresponde con una suscripción NUESTRA no se procesa.
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

  -- ---- CAPA 2 de idempotencia: la referencia del pago -------------------
  -- `payments.reference` es único en el baseline. Si el mismo cargo llegara por
  -- otro camino (reconciliación manual), esto lo detecta igual.
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

  -- ---- Factura de destino ------------------------------------------------
  -- Se busca una factura abierta de esa suscripción. Si no hay, se emite una
  -- para que el cobro no quede colgando sin documento.
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

    -- Sin línea, la factura no explicaría qué se cobró y el motor de comisiones
    -- —que recorre `invoice_lines`— no tendría nada sobre lo que devengar.
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

  -- ---- El cobro. Aquí sí entra dinero -----------------------------------
  -- El trigger `payments_generate_commissions` del baseline devenga la comisión
  -- desde este INSERT. No se replica esa lógica: se reutiliza.
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
  'Único camino por el que un cobro del proveedor entra en `payments`. Idempotente '
  'en dos capas: el ledger de eventos y la unicidad de `payments.reference`.';

-- ---------------------------------------------------------------------------
-- 9. register_provider_payment_failure — un fallo NO es un cobro.
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
  if not (platform.is_super_admin() or platform.can_read_finance()
          or current_setting('role', true) = 'service_role') then
    raise exception 'NO_AUTORIZADO' using errcode = '42501';
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
    -- Se anota el fallo en el mapeo. NO se crea ningún `payments`: un cobro
    -- fallido es exactamente lo contrario de un cobro.
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
-- 10. upsert_provider_subscription — lo llama la Edge Function tras el alta.
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
  select * into v_sub from platform.subscriptions where id = p_subscription_id;
  if v_sub is null then
    raise exception 'SUSCRIPCION_NO_ENCONTRADA: %', p_subscription_id using errcode = '23503';
  end if;

  if not (
    platform.can_manage_commercial()
    or platform.is_org_admin(v_sub.billed_organization_id)
    or current_setting('role', true) = 'service_role'
  ) then
    raise exception 'NO_AUTORIZADO: no puede configurar el cobro de la suscripción %', v_sub.code
      using errcode = '42501';
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
-- 11. Vista de reconciliación proveedor ↔ local (alimenta la Fase 13).
-- ---------------------------------------------------------------------------
create or replace view platform.v_provider_reconciliation
with (security_invoker = true) as
select
  ps.id                       as provider_subscription_id,
  ps.provider_account_id,
  a.code                      as provider_account_code,
  a.environment               as provider_environment,
  ps.subscription_id,
  s.code                      as subscription_code,
  s.status                    as local_status,
  ps.provider_status,
  ps.external_subscription_id,
  ps.next_billing_at,
  ps.synced_at,
  ps.last_error_code,
  ps.last_error_message,
  s.billed_organization_id,
  o.display_name              as billed_organization_name,
  (select count(*) from platform.provider_webhook_events e
    where e.subscription_id = ps.subscription_id and e.status = 'REJECTED')   as rejected_events,
  (select count(*) from platform.payments p
     join platform.invoices i on i.id = p.invoice_id
    where i.subscription_id = ps.subscription_id and p.status = 'CONFIRMED')  as confirmed_payments,
  -- Diagnóstico, no corrección automática: esta vista describe, no arregla.
  case
    when ps.last_error_code is not null                              then 'ERROR'
    when ps.provider_status = 'payment_failed'                       then 'ERROR'
    when s.status = 'ACTIVE'  and ps.provider_status = 'canceled'    then 'REVIEW'
    when s.status = 'CANCELLED' and ps.provider_status = 'active'    then 'REVIEW'
    when ps.synced_at < now() - interval '35 days'                   then 'REVIEW'
    else 'OK'
  end                         as reconciliation_status
from platform.provider_subscriptions ps
join platform.payment_provider_accounts a on a.id = ps.provider_account_id
join platform.subscriptions s on s.id = ps.subscription_id
join platform.organizations o on o.id = s.billed_organization_id;

comment on view platform.v_provider_reconciliation is
  'Compara el estado del proveedor con el local. Diagnostica; no corrige. Un '
  'ajuste contable automático a partir de una comparación destruye la trazabilidad.';

grant select on platform.v_provider_reconciliation to authenticated;
revoke all on platform.v_provider_reconciliation from anon;

-- ---------------------------------------------------------------------------
-- 12. GRANTS
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
         'register_provider_payment', 'register_provider_payment_failure',
         'upsert_provider_subscription'
       )
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;
