-- ============================================================================
-- MasterAdmin · M2 · Tarjeta guardada y cobro automático
-- ----------------------------------------------------------------------------
-- Spec §3. El cliente, desde el portal de pago (M1), autoriza que MasterAdmin
-- cobre con su tarjeta guardada cada factura emitida de sus suscripciones.
-- A diferencia de la suscripción del proveedor (V2/V3.2), aquí el IMPORTE lo
-- decide cada factura: admite montos variables (uso, add-ons, prorrateos).
--
-- Piezas:
--   · card_on_file_authorizations — la autorización (términos CARD_ON_FILE_V1),
--     una vigente por organización y cuenta;
--   · subscription_collection_profiles gana recurring_mode y payment_method_id
--     (CHECK: CARD_ON_FILE exige tarjeta y auto_charge);
--   · payment_charge_attempts — cada intento de cobro, idempotente por
--     `invoice:attempt_no`, con la política de reintentos (al vencer, +3 d,
--     +7 d; tras el tercer fallo, alerta CARD_ON_FILE_EXHAUSTED);
--   · RPCs SOLO SERVIDOR para el alta/baja desde el portal y para los intentos,
--     y una RPC de consola (finanzas) para revocar la autorización.
--
-- Nunca se guarda PAN, CVV ni el token `tkn_`: solo `cus_`/`crd_`/`chr_` y
-- brand/last4.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Autorizaciones de cobro con tarjeta guardada
-- ---------------------------------------------------------------------------
create table platform.card_on_file_authorizations (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references platform.organizations (id) on delete restrict,
  provider_account_id uuid not null references platform.payment_provider_accounts (id) on delete restrict,
  payment_method_id   uuid not null references platform.provider_payment_methods (id) on delete restrict,
  terms_version       text not null,
  accepted_at         timestamptz not null default now(),
  link_id             uuid references platform.payment_links (id) on delete set null,
  client_fingerprint  text,
  revoked_at          timestamptz,
  revoked_by          uuid references auth.users (id) on delete set null,
  revoke_reason       text,
  revoke_source       text,
  created_at          timestamptz not null default now(),

  constraint cofa_terms_ck check (terms_version ~ '^CARD_ON_FILE_V[0-9]+$'),
  constraint cofa_fingerprint_ck check (client_fingerprint is null or client_fingerprint ~ '^[0-9a-f]{16,64}$'),
  constraint cofa_revoke_source_ck check (revoke_source is null or revoke_source in ('PORTAL', 'CONSOLE')),
  constraint cofa_revocation_ck check (
    (revoked_at is null and revoke_source is null and revoke_reason is null)
    or (revoked_at is not null and revoke_source is not null and length(btrim(coalesce(revoke_reason, ''))) > 0)
  )
);

comment on table platform.card_on_file_authorizations is
  'Autorización del titular para cobrar automáticamente sus facturas con la tarjeta guardada (M2). '
  'Una vigente por organización y cuenta. Revocar no borra historia.';

create unique index cofa_active_uk
  on platform.card_on_file_authorizations (organization_id, provider_account_id)
  where revoked_at is null;
create index cofa_org_ix on platform.card_on_file_authorizations (organization_id, created_at desc);
create index cofa_account_ix on platform.card_on_file_authorizations (provider_account_id);
create index cofa_method_ix on platform.card_on_file_authorizations (payment_method_id);
create index cofa_link_ix on platform.card_on_file_authorizations (link_id);
create index cofa_revoked_by_ix on platform.card_on_file_authorizations (revoked_by);

-- ---------------------------------------------------------------------------
-- 2. Perfil de cobranza: modo recurrente y tarjeta
-- ---------------------------------------------------------------------------
alter table platform.subscription_collection_profiles
  add column recurring_mode text not null default 'PROVIDER_SUBSCRIPTION',
  add column payment_method_id uuid references platform.provider_payment_methods (id) on delete restrict;

alter table platform.subscription_collection_profiles
  add constraint scp_recurring_mode_ck check (recurring_mode in ('PROVIDER_SUBSCRIPTION', 'CARD_ON_FILE')),
  -- Spec §3.1: CARD_ON_FILE exige la tarjeta y el cargo automático (y, por
  -- coherencia con scp_culqi_*, el método CULQI_CARD).
  add constraint scp_card_on_file_ck check (
    recurring_mode <> 'CARD_ON_FILE'
    or (payment_method_id is not null and auto_charge and collection_method = 'CULQI_CARD')
  );

create index scp_payment_method_ix on platform.subscription_collection_profiles (payment_method_id);

comment on column platform.subscription_collection_profiles.recurring_mode is
  'PROVIDER_SUBSCRIPTION (V3.2: el proveedor cobra un Plan fijo) o CARD_ON_FILE (M2: MasterAdmin '
  'cobra cada factura emitida con la tarjeta guardada).';

-- ---------------------------------------------------------------------------
-- 3. Intentos de cobro
-- ---------------------------------------------------------------------------
create table platform.payment_charge_attempts (
  id                  uuid primary key default gen_random_uuid(),
  invoice_id          uuid not null references platform.invoices (id) on delete restrict,
  payment_method_id   uuid not null references platform.provider_payment_methods (id) on delete restrict,
  provider_account_id uuid not null references platform.payment_provider_accounts (id) on delete restrict,
  attempt_no          integer not null,
  idempotency_key     text not null,
  status              text not null default 'PENDING',
  amount              numeric(14,2) not null,
  currency            char(3) not null references platform.currencies (code) on delete restrict,
  external_charge_id  text,
  payment_id          uuid references platform.payments (id) on delete set null,
  error_code          text,
  next_retry_at       timestamptz,
  trigger_source      text not null,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz,

  constraint pca_idempotency_uk unique (idempotency_key),
  constraint pca_attempt_ck check (attempt_no >= 1),
  constraint pca_status_ck check (status in ('PENDING', 'SUCCEEDED', 'FAILED')),
  constraint pca_trigger_ck check (trigger_source in ('MANUAL', 'RUN', 'CRON')),
  constraint pca_amount_ck check (amount > 0),
  constraint pca_currency_ck check (currency ~ '^[A-Z]{3}$'),
  constraint pca_external_ck check (external_charge_id is null or external_charge_id !~* '^(sk|pk|tkn)_'),
  constraint pca_error_code_ck check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  constraint pca_completion_ck check (
    (status = 'PENDING' and completed_at is null)
    or (status <> 'PENDING' and completed_at is not null)
  ),
  constraint pca_success_ck check (status <> 'SUCCEEDED' or external_charge_id is not null)
);

comment on table platform.payment_charge_attempts is
  'Intentos de cobro con tarjeta guardada (M2). Idempotente por invoice:attempt_no. Un intento '
  'PENDING bloquea otro sobre la misma factura: no se cobra dos veces en paralelo.';

create unique index pca_one_pending_uk on platform.payment_charge_attempts (invoice_id) where status = 'PENDING';
create index pca_invoice_ix on platform.payment_charge_attempts (invoice_id, attempt_no);
create index pca_method_ix on platform.payment_charge_attempts (payment_method_id);
create index pca_account_ix on platform.payment_charge_attempts (provider_account_id);
create index pca_payment_ix on platform.payment_charge_attempts (payment_id);
create index pca_created_by_ix on platform.payment_charge_attempts (created_by);
create index pca_currency_ix on platform.payment_charge_attempts (currency);

-- ---------------------------------------------------------------------------
-- 4. RLS + GRANT
-- ---------------------------------------------------------------------------
alter table platform.card_on_file_authorizations enable row level security;
alter table platform.card_on_file_authorizations force row level security;
alter table platform.payment_charge_attempts enable row level security;
alter table platform.payment_charge_attempts force row level security;

revoke all on platform.card_on_file_authorizations from public, anon, authenticated;
revoke all on platform.payment_charge_attempts from public, anon, authenticated;
grant select on platform.card_on_file_authorizations to authenticated;
grant select on platform.payment_charge_attempts to authenticated;
grant all on platform.card_on_file_authorizations to service_role;
grant all on platform.payment_charge_attempts to service_role;

-- Mismo alcance que provider_payment_methods: EBIM y la propia organización.
create policy cofa_select on platform.card_on_file_authorizations
  for select to authenticated
  using (
    platform.can_read_finance()
    or platform.can_manage_platform_entities()
    or organization_id in (select platform.my_org_ids())
  );

create policy pca_select on platform.payment_charge_attempts
  for select to authenticated
  using (platform.can_read_finance() or platform.can_manage_platform_entities());

-- ---------------------------------------------------------------------------
-- 5. Política de reintentos
-- ---------------------------------------------------------------------------

/** Spec §3.2: intento 1 al vencer, 2 a +3 días, 3 a +7 días; no hay 4. */
create or replace function platform.card_on_file_retry_at(p_due_date date, p_attempt_no integer)
returns timestamptz
language sql
immutable
set search_path = pg_catalog
as $$
  select case p_attempt_no
    when 1 then p_due_date::timestamptz
    when 2 then (p_due_date + 3)::timestamptz
    when 3 then (p_due_date + 7)::timestamptz
    else null
  end;
$$;

comment on function platform.card_on_file_retry_at(date, integer) is
  'Momento a partir del cual toca el intento N de cobro con tarjeta guardada: N=1 al vencer, '
  'N=2 a +3 días, N=3 a +7 días. NULL = no hay más intentos.';

/**
 * Facturas que toca cobrar con tarjeta guardada.
 *
 * Elegible: ISSUED/PARTIALLY_PAID con saldo, suscripción con perfil vigente
 * CARD_ON_FILE, tarjeta ACTIVE y autorización vigente de la organización en esa
 * cuenta, sin intento PENDING, y que el reintento toque según la política
 * (o `p_ignore_schedule`, que usa «Cobrar ahora» desde la consola).
 */
create or replace function platform.card_on_file_due_invoices(
  p_limit           integer default 50,
  p_invoice_id      uuid default null,
  p_as_of           timestamptz default now(),
  p_ignore_schedule boolean default false
)
returns table (
  invoice_id                 uuid,
  invoice_number             text,
  organization_id            uuid,
  subscription_id            uuid,
  currency                   char(3),
  balance                    numeric,
  due_date                   date,
  provider_account_id        uuid,
  payment_method_id          uuid,
  external_payment_method_id text,
  external_customer_id       text,
  billing_email              text,
  next_attempt_no            integer
)
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
#variable_conflict use_column
declare
  c_max_attempts constant integer := 3;
begin
  if not platform.is_service_context() then
    raise exception 'NO_AUTORIZADO_SERVER_ONLY: el cobro automático lo ejecuta el servidor'
      using errcode = '42501';
  end if;

  return query
  with base as (
    select i.id, i.number, i.customer_organization_id, i.subscription_id, i.currency, i.due_date,
           platform.invoice_balance(i.id) as bal,
           p.provider_account_id, m.id as method_id, m.external_payment_method_id,
           pc.external_customer_id, o.billing_email,
           (select count(*) from platform.payment_charge_attempts x
             where x.invoice_id = i.id and x.status = 'FAILED')::integer as failed,
           (select coalesce(max(x.attempt_no), 0) from platform.payment_charge_attempts x
             where x.invoice_id = i.id)::integer as last_no,
           (select x.next_retry_at from platform.payment_charge_attempts x
             where x.invoice_id = i.id and x.status = 'FAILED'
             order by x.attempt_no desc limit 1) as retry_at
      from platform.invoices i
      join platform.subscription_collection_profiles p
        on p.subscription_id = i.subscription_id and p.effective_to is null
      join platform.provider_payment_methods m
        on m.id = p.payment_method_id and m.status = 'ACTIVE'
      join platform.card_on_file_authorizations a
        on a.organization_id = i.customer_organization_id
       and a.provider_account_id = p.provider_account_id
       and a.payment_method_id = m.id
       and a.revoked_at is null
      join platform.organizations o on o.id = i.customer_organization_id
      left join platform.provider_customers pc on pc.id = m.provider_customer_id
     where i.status in ('ISSUED', 'PARTIALLY_PAID')
       and p.recurring_mode = 'CARD_ON_FILE'
       and p.auto_charge
       and (p_invoice_id is null or i.id = p_invoice_id)
       and not exists (select 1 from platform.payment_charge_attempts x
                        where x.invoice_id = i.id and x.status = 'PENDING')
  )
  select b.id, b.number, b.customer_organization_id, b.subscription_id, b.currency::char(3), b.bal,
         b.due_date, b.provider_account_id, b.method_id, b.external_payment_method_id,
         b.external_customer_id, b.billing_email,
         (b.last_no + 1)::integer
    from base b
   where b.bal > 0
     and (
       p_ignore_schedule
       or (
         b.due_date is not null
         and b.due_date <= (p_as_of at time zone 'UTC')::date
         and b.failed < c_max_attempts
         and (b.failed = 0 or (b.retry_at is not null and b.retry_at <= p_as_of))
       )
     )
   order by b.due_date nulls last, b.number
   limit greatest(coalesce(p_limit, 50), 1);
end;
$$;

comment on function platform.card_on_file_due_invoices(integer, uuid, timestamptz, boolean) is
  'SERVER-ONLY. Facturas a cobrar con tarjeta guardada según la política de reintentos '
  '(al vencer, +3 d, +7 d; máximo 3). p_ignore_schedule = «Cobrar ahora» de la consola.';

/** Abre un intento PENDING (idempotente por invoice:attempt_no). */
create or replace function platform.begin_card_charge_attempt(
  p_invoice_id      uuid,
  p_trigger_source  text,
  p_actor           uuid default null,
  p_ignore_schedule boolean default false,
  p_as_of           timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_due record;
  v_id  uuid;
begin
  if not platform.is_service_context() then
    raise exception 'NO_AUTORIZADO_SERVER_ONLY: el cobro automático lo ejecuta el servidor'
      using errcode = '42501';
  end if;
  if p_trigger_source not in ('MANUAL', 'RUN', 'CRON') then
    raise exception 'ORIGEN_INVALIDO: %', p_trigger_source using errcode = '22023';
  end if;

  -- Serializa con cualquier otro cobro o pago de esta factura.
  perform 1 from platform.invoices where id = p_invoice_id for update;

  select * into v_due
    from platform.card_on_file_due_invoices(1, p_invoice_id, p_as_of, coalesce(p_ignore_schedule, false));
  if v_due.invoice_id is null then
    return jsonb_build_object('ok', false, 'error', 'COBRO_NO_PROCEDE');
  end if;

  begin
    insert into platform.payment_charge_attempts (
      invoice_id, payment_method_id, provider_account_id, attempt_no, idempotency_key, status,
      amount, currency, trigger_source, created_by
    ) values (
      v_due.invoice_id, v_due.payment_method_id, v_due.provider_account_id, v_due.next_attempt_no,
      v_due.invoice_id::text || ':' || v_due.next_attempt_no::text, 'PENDING',
      v_due.balance, v_due.currency, p_trigger_source, p_actor
    )
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'INTENTO_EN_CURSO');
  end;

  if p_trigger_source = 'MANUAL' then
    perform platform.log_audit(
      'CARD_CHARGE_REQUESTED', 'invoice', v_due.invoice_id::text, v_due.organization_id, null,
      jsonb_build_object('invoice', v_due.invoice_number, 'attempt_no', v_due.next_attempt_no,
                         'requested_by', p_actor, 'amount', v_due.balance, 'currency', v_due.currency)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'attempt_id', v_id,
    'attempt_no', v_due.next_attempt_no,
    'idempotency_key', v_due.invoice_id::text || ':' || v_due.next_attempt_no::text,
    'invoice_id', v_due.invoice_id,
    'invoice_number', v_due.invoice_number,
    'organization_id', v_due.organization_id,
    'amount', v_due.balance,
    'currency', v_due.currency,
    'provider_account_id', v_due.provider_account_id,
    'external_payment_method_id', v_due.external_payment_method_id,
    'external_customer_id', v_due.external_customer_id,
    'billing_email', v_due.billing_email
  );
end;
$$;

/**
 * Cierra un intento. Éxito → register_provider_invoice_payment (en la MISMA
 * transacción: si el registro falla, el intento sigue PENDING y la
 * reconciliación lo verá; nunca queda un cargo cobrado marcado como fallido).
 * Fallo → próximo reintento según la política o, tras el tercero, alerta.
 */
create or replace function platform.complete_card_charge_attempt(
  p_attempt_id         uuid,
  p_succeeded          boolean,
  p_external_charge_id text default null,
  p_error_code         text default null,
  p_amount             numeric default null,
  p_currency           char(3) default null,
  p_paid_at            timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  c_max_attempts constant integer := 3;
  v_attempt platform.payment_charge_attempts;
  v_invoice record;
  v_result  jsonb;
  v_next    timestamptz;
  v_alert   boolean := false;
begin
  if not platform.is_service_context() then
    raise exception 'NO_AUTORIZADO_SERVER_ONLY: el cobro automático lo ejecuta el servidor'
      using errcode = '42501';
  end if;

  select * into v_attempt from platform.payment_charge_attempts where id = p_attempt_id for update;
  if v_attempt.id is null then
    raise exception 'INTENTO_NO_ENCONTRADO: %', p_attempt_id using errcode = '23503';
  end if;
  if v_attempt.status <> 'PENDING' then
    return jsonb_build_object('attempt_id', v_attempt.id, 'status', v_attempt.status, 'duplicate', true,
                              'payment_id', v_attempt.payment_id);
  end if;

  select i.id, i.number, i.due_date, i.subscription_id, i.customer_organization_id into v_invoice
    from platform.invoices i where i.id = v_attempt.invoice_id;

  if coalesce(p_succeeded, false) then
    v_result := platform.register_provider_invoice_payment(
      v_attempt.provider_account_id,
      'autocharge:' || v_attempt.id::text,
      p_external_charge_id,
      v_attempt.invoice_id,
      coalesce(p_amount, v_attempt.amount),
      coalesce(p_currency, v_attempt.currency),
      coalesce(p_paid_at, now()),
      jsonb_build_object('origin', 'payment-autocharge', 'attempt_id', v_attempt.id,
                         'attempt_no', v_attempt.attempt_no)
    );

    update platform.payment_charge_attempts
       set status = 'SUCCEEDED', external_charge_id = p_external_charge_id,
           payment_id = (v_result ->> 'payment_id')::uuid, completed_at = now()
     where id = v_attempt.id;

    return jsonb_build_object(
      'attempt_id', v_attempt.id, 'status', 'SUCCEEDED',
      'payment_id', v_result ->> 'payment_id', 'duplicate', coalesce((v_result ->> 'duplicate')::boolean, false)
    );
  end if;

  v_next := platform.card_on_file_retry_at(v_invoice.due_date, v_attempt.attempt_no + 1);
  if v_attempt.attempt_no >= c_max_attempts then
    v_next := null;
  end if;

  update platform.payment_charge_attempts
     set status = 'FAILED',
         external_charge_id = p_external_charge_id,
         error_code = coalesce(nullif(btrim(coalesce(p_error_code, '')), ''), 'COBRO_FALLIDO'),
         next_retry_at = v_next,
         completed_at = now()
   where id = v_attempt.id;

  -- Agotados los reintentos: una persona tiene que mirarlo.
  if v_attempt.attempt_no >= c_max_attempts and v_invoice.subscription_id is not null then
    insert into platform.billing_alerts (
      subscription_id, alert_type, due_at, reference_date, dedupe_key, severity,
      title, message, metadata, invoice_id
    ) values (
      v_invoice.subscription_id, 'PAYMENT_FAILURE', now(), v_invoice.due_date,
      v_invoice.id::text || ':CARD_ON_FILE_EXHAUSTED', 'CRITICAL',
      'Cobro con tarjeta guardada agotado',
      format('La factura %s no se pudo cobrar con la tarjeta guardada tras %s intentos.',
             v_invoice.number, v_attempt.attempt_no),
      jsonb_build_object('code', 'CARD_ON_FILE_EXHAUSTED', 'attempts', v_attempt.attempt_no,
                         'last_error', coalesce(p_error_code, 'COBRO_FALLIDO'))
      , v_invoice.id
    )
    on conflict (dedupe_key) do nothing;
    v_alert := true;
  end if;

  return jsonb_build_object(
    'attempt_id', v_attempt.id, 'status', 'FAILED', 'next_retry_at', v_next,
    'exhausted', v_attempt.attempt_no >= c_max_attempts, 'alert_created', v_alert
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Alta y baja desde el portal (SOLO SERVIDOR)
-- ---------------------------------------------------------------------------

/**
 * Cuenta con la que se guarda la tarjeta de una organización: la ruta 1 de la
 * primera suscripción activa con candidato Culqi; si no tiene, la cuenta Culqi
 * del país (la propia antes que la de EBIM).
 */
create or replace function platform.resolve_org_card_account(p_organization_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_account uuid;
  v_sub     record;
begin
  for v_sub in
    select s.id from platform.subscriptions s
     where s.billed_organization_id = p_organization_id and s.status in ('ACTIVE', 'PAST_DUE')
     order by s.code
  loop
    select c.provider_account_id into v_account
      from platform.provider_account_candidates(v_sub.id, 'CULQI_CARD') c
     where c.eligible
     order by c.route_rank
     limit 1;
    if v_account is not null then
      return v_account;
    end if;
  end loop;

  select a.id into v_account
    from platform.payment_provider_accounts a
    join platform.organizations o on o.id = p_organization_id
   where a.status = 'ACTIVE' and a.provider_kind = 'CULQI'
     and (a.owner_organization_id is null or a.owner_organization_id = o.id)
     and a.country_code = o.country_code
     and (a.environment = 'TEST' or a.secret_key_ref is not null)
   order by (a.owner_organization_id is not null) desc, a.routing_priority, a.code
   limit 1;
  return v_account;
end;
$$;

/** Datos de alta de tarjeta de un enlace (para la Edge Function, no para el navegador). */
create or replace function platform.payment_link_enrollment(p_link_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_link      platform.payment_links;
  v_account   uuid;
  v_readiness record;
begin
  select * into v_link from platform.payment_links where id = p_link_id;
  if v_link.id is null or not v_link.allow_card_enrollment then
    return jsonb_build_object('available', false);
  end if;

  v_account := platform.resolve_org_card_account(v_link.organization_id);
  select r.missing_fields into v_readiness
    from platform.v_billing_contact_readiness r where r.organization_id = v_link.organization_id;

  return jsonb_build_object(
    'available', v_account is not null,
    'account_id', v_account,
    'missing_fields', to_jsonb(coalesce(v_readiness.missing_fields, array[]::text[])),
    'terms_version', 'CARD_ON_FILE_V1'
  );
end;
$$;

/** Tarjeta guardada + autorización para el estado de cuenta del portal. */
create or replace function platform.payment_link_card_on_file(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select coalesce(
    (select jsonb_build_object(
              'brand', m.brand, 'last4', m.last4, 'authorized', true,
              'authorized_at', a.accepted_at, 'terms_version', a.terms_version,
              'account_id', a.provider_account_id)
       from platform.card_on_file_authorizations a
       join platform.provider_payment_methods m on m.id = a.payment_method_id
      where a.organization_id = p_organization_id and a.revoked_at is null
      order by a.accepted_at desc
      limit 1),
    (select jsonb_build_object('brand', m.brand, 'last4', m.last4, 'authorized', false)
       from platform.provider_payment_methods m
      where m.organization_id = p_organization_id and m.status = 'ACTIVE' and m.is_default
      order by m.updated_at desc
      limit 1)
  );
$$;

/**
 * Contexto de alta: valida el enlace y devuelve la cuenta, el cliente previo y
 * los datos de facturación que la pasarela exige. SOLO SERVIDOR: el domicilio
 * y el teléfono no viajan al navegador.
 */
create or replace function platform.payment_link_enrollment_context(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_link     platform.payment_links;
  v_error    text;
  v_account  uuid;
  v_contact  record;
  v_customer text;
begin
  if not platform.is_service_context() then
    raise exception 'NO_AUTORIZADO_SERVER_ONLY: el alta de tarjeta la resuelve el servidor'
      using errcode = '42501';
  end if;

  v_link := platform.payment_link_lookup(p_token_hash);
  v_error := platform.payment_link_error(v_link);
  if v_error is not null then
    return jsonb_build_object('ok', false, 'error', v_error);
  end if;
  if not v_link.allow_card_enrollment then
    return jsonb_build_object('ok', false, 'error', 'TARJETA_GUARDADA_NO_PERMITIDA', 'link_id', v_link.id);
  end if;

  v_account := platform.resolve_org_card_account(v_link.organization_id);
  if v_account is null then
    return jsonb_build_object('ok', false, 'error', 'CUENTA_NO_CONFIGURADA', 'link_id', v_link.id);
  end if;

  select * into v_contact from platform.v_billing_contact_readiness r
   where r.organization_id = v_link.organization_id;

  select c.external_customer_id into v_customer
    from platform.provider_customers c
   where c.provider_account_id = v_account and c.organization_id = v_link.organization_id;

  return jsonb_build_object(
    'ok', true,
    'link_id', v_link.id,
    'organization_id', v_link.organization_id,
    'provider_account_id', v_account,
    'external_customer_id', v_customer,
    'missing_fields', to_jsonb(coalesce(v_contact.missing_fields, array[]::text[])),
    'contact', jsonb_build_object(
      'first_name', v_contact.billing_first_name, 'last_name', v_contact.billing_last_name,
      'email', v_contact.billing_email, 'address', v_contact.billing_address,
      'city', v_contact.billing_city, 'phone', v_contact.billing_phone,
      'country_code', v_contact.country_code
    )
  );
end;
$$;

/**
 * Completa los datos de facturación QUE FALTAN desde el portal (spec §3.1 paso
 * 2). Solo rellena campos vacíos: quien tiene el enlace no puede reescribir los
 * datos fiscales ya registrados. Mismas validaciones que set_billing_contact.
 */
create or replace function platform.set_billing_contact_from_portal(
  p_link_id    uuid,
  p_first_name text,
  p_last_name  text,
  p_email      text,
  p_address    text,
  p_city       text,
  p_phone      text
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_link    platform.payment_links;
  v_org     record;
  v_phone   text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  v_filled  text[] := array[]::text[];
begin
  if not platform.is_service_context() then
    raise exception 'NO_AUTORIZADO_SERVER_ONLY: el portal completa datos de facturación desde el servidor'
      using errcode = '42501';
  end if;

  select * into v_link from platform.payment_links where id = p_link_id;
  if platform.payment_link_error(v_link) is not null then
    raise exception 'ENLACE_INVALIDO: el enlace no está vigente' using errcode = '42501';
  end if;

  select * into v_org from platform.organizations where id = v_link.organization_id for update;

  if coalesce(trim(v_org.billing_email), '') = '' and coalesce(trim(p_email), '') <> '' then
    if trim(p_email) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-zA-Z]{2,}$' then
      raise exception 'CORREO_INVALIDO: el correo de facturación no es válido' using errcode = '23514';
    end if;
    v_filled := v_filled || 'billing_email';
  end if;
  if coalesce(trim(v_org.billing_phone), '') = '' and v_phone is not null then
    if char_length(v_phone) < 5 or char_length(v_phone) > 15 then
      raise exception 'TELEFONO_INVALIDO: el teléfono debe tener entre 5 y 15 dígitos' using errcode = '23514';
    end if;
    v_filled := v_filled || 'billing_phone';
  end if;
  if coalesce(trim(v_org.billing_first_name), '') = '' and coalesce(trim(p_first_name), '') <> '' then
    v_filled := v_filled || 'billing_first_name';
  end if;
  if coalesce(trim(v_org.billing_last_name), '') = '' and coalesce(trim(p_last_name), '') <> '' then
    v_filled := v_filled || 'billing_last_name';
  end if;
  if coalesce(trim(v_org.billing_address), '') = '' and coalesce(trim(p_address), '') <> '' then
    v_filled := v_filled || 'billing_address';
  end if;
  if coalesce(trim(v_org.billing_city), '') = '' and coalesce(trim(p_city), '') <> '' then
    v_filled := v_filled || 'billing_city';
  end if;

  if cardinality(v_filled) = 0 then
    return jsonb_build_object('filled', '[]'::jsonb);
  end if;

  -- Los CHECK de longitud de la migración 23 validan el resto.
  update platform.organizations
     set billing_first_name = case when 'billing_first_name' = any (v_filled) then trim(p_first_name) else billing_first_name end,
         billing_last_name  = case when 'billing_last_name'  = any (v_filled) then trim(p_last_name)  else billing_last_name end,
         billing_email      = case when 'billing_email'      = any (v_filled) then lower(trim(p_email)) else billing_email end,
         billing_address    = case when 'billing_address'    = any (v_filled) then trim(p_address)    else billing_address end,
         billing_city       = case when 'billing_city'       = any (v_filled) then trim(p_city)       else billing_city end,
         billing_phone      = case when 'billing_phone'      = any (v_filled) then v_phone            else billing_phone end
   where id = v_org.id;

  perform platform.log_audit(
    'BILLING_CONTACT_COMPLETED_FROM_PORTAL', 'organization', v_org.id::text, v_org.id, null,
    -- Campos, no valores: domicilio y teléfono son datos personales.
    jsonb_build_object('fields', to_jsonb(v_filled), 'link_hint', v_link.token_hint)
  );

  return jsonb_build_object('filled', to_jsonb(v_filled));
end;
$$;

/** Pasa el perfil vigente de una suscripción a CULQI_CARD + CARD_ON_FILE. */
create or replace function platform.switch_profile_to_card_on_file(
  p_subscription_id   uuid,
  p_account_id        uuid,
  p_payment_method_id uuid,
  p_note              text
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_sub     record;
  v_current platform.subscription_collection_profiles;
  v_id      uuid;
begin
  select s.id, s.currency into v_sub from platform.subscriptions s where s.id = p_subscription_id;
  select * into v_current from platform.subscription_collection_profiles
   where subscription_id = p_subscription_id and effective_to is null
   for update;

  if v_current.id is not null and v_current.effective_from >= current_date then
    -- Mismo día (o perfil futuro): se ajusta en sitio en vez de crear una
    -- vigencia de cero días.
    update platform.subscription_collection_profiles
       set collection_method = 'CULQI_CARD', provider_account_id = p_account_id, auto_charge = true,
           requires_service_order = false, requires_purchase_order = false,
           recurring_mode = 'CARD_ON_FILE', payment_method_id = p_payment_method_id,
           status = 'ACTIVE', notes = p_note
     where id = v_current.id
    returning id into v_id;
    return v_id;
  end if;

  if v_current.id is not null then
    update platform.subscription_collection_profiles
       set effective_to = current_date - 1
     where id = v_current.id;
  end if;

  insert into platform.subscription_collection_profiles (
    subscription_id, collection_method, provider_account_id, auto_charge,
    requires_service_order, requires_purchase_order,
    invoice_lead_days, renewal_notice_days, payment_due_days, grace_period_days,
    document_lead_days, auto_suspend, currency, status, effective_from, notes,
    recurring_mode, payment_method_id
  ) values (
    p_subscription_id, 'CULQI_CARD', p_account_id, true, false, false,
    coalesce(v_current.invoice_lead_days, 0), coalesce(v_current.renewal_notice_days, 30),
    coalesce(v_current.payment_due_days, 15), coalesce(v_current.grace_period_days, 10),
    coalesce(v_current.document_lead_days, 45), coalesce(v_current.auto_suspend, false),
    v_sub.currency, 'ACTIVE', current_date, p_note, 'CARD_ON_FILE', p_payment_method_id
  )
  returning id into v_id;
  return v_id;
end;
$$;

/**
 * Revoca autorizaciones vigentes (todas las de la organización o solo una) y
 * deja de cobrar automáticamente: la tarjeta queda INACTIVE y los perfiles
 * CARD_ON_FILE pasan a MANUAL (CULQI_CARD exige auto_charge por un CHECK de
 * V2, así que «auto_charge = false» solo es representable fuera de CULQI_CARD).
 * No borra historia.
 */
create or replace function platform.revoke_card_on_file_internal(
  p_organization_id  uuid,
  p_authorization_id uuid,
  p_source           text,
  p_reason           text,
  p_actor            uuid
)
returns integer
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_auth    record;
  v_profile record;
  v_count   integer := 0;
begin
  for v_auth in
    select a.* from platform.card_on_file_authorizations a
     where a.revoked_at is null
       and (p_authorization_id is null or a.id = p_authorization_id)
       and (p_organization_id is null or a.organization_id = p_organization_id)
     for update
  loop
    update platform.card_on_file_authorizations
       set revoked_at = now(), revoked_by = p_actor, revoke_reason = left(btrim(p_reason), 500),
           revoke_source = p_source
     where id = v_auth.id;

    update platform.provider_payment_methods
       set status = 'INACTIVE', is_default = false, synced_at = now()
     where id = v_auth.payment_method_id;

    for v_profile in
      select p.* from platform.subscription_collection_profiles p
       where p.payment_method_id = v_auth.payment_method_id
         and p.effective_to is null
         and p.recurring_mode = 'CARD_ON_FILE'
    loop
      if v_profile.effective_from >= current_date then
        update platform.subscription_collection_profiles
           set collection_method = 'MANUAL', provider_account_id = null, auto_charge = false,
               recurring_mode = 'PROVIDER_SUBSCRIPTION', payment_method_id = null,
               notes = 'Autorización de tarjeta guardada revocada: cobro manual'
         where id = v_profile.id;
      else
        update platform.subscription_collection_profiles
           set effective_to = current_date - 1
         where id = v_profile.id;
        insert into platform.subscription_collection_profiles (
          subscription_id, collection_method, provider_account_id, auto_charge,
          requires_service_order, requires_purchase_order,
          invoice_lead_days, renewal_notice_days, payment_due_days, grace_period_days,
          document_lead_days, auto_suspend, currency, status, effective_from, notes
        ) values (
          v_profile.subscription_id, 'MANUAL', null, false, false, false,
          v_profile.invoice_lead_days, v_profile.renewal_notice_days, v_profile.payment_due_days,
          v_profile.grace_period_days, v_profile.document_lead_days, v_profile.auto_suspend,
          v_profile.currency, 'ACTIVE', current_date,
          'Autorización de tarjeta guardada revocada: cobro manual'
        );
      end if;
    end loop;

    perform platform.log_audit(
      'CARD_ON_FILE_REVOKED', 'card_on_file_authorization', v_auth.id::text, v_auth.organization_id, null,
      jsonb_build_object('source', p_source, 'reason', left(btrim(p_reason), 500), 'revoked_by', p_actor)
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function platform.enroll_card_on_file(
  p_link_id                    uuid,
  p_provider_account_id        uuid,
  p_external_customer_id       text,
  p_external_payment_method_id text,
  p_brand                      text,
  p_last4                      text,
  p_exp_month                  integer default null,
  p_exp_year                   integer default null,
  p_terms_version              text default 'CARD_ON_FILE_V1',
  p_client_fingerprint         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  c_terms constant text := 'CARD_ON_FILE_V1';
  v_link     platform.payment_links;
  v_org      uuid;
  v_customer uuid;
  v_method   uuid;
  v_auth     uuid;
  v_sub      record;
  v_switched integer := 0;
  v_skipped  integer := 0;
begin
  if not platform.is_service_context() then
    raise exception 'NO_AUTORIZADO_SERVER_ONLY: el alta de tarjeta guardada la registra el servidor'
      using errcode = '42501';
  end if;

  select * into v_link from platform.payment_links where id = p_link_id for update;
  if platform.payment_link_error(v_link) is not null then
    raise exception 'ENLACE_INVALIDO: el enlace no está vigente' using errcode = '42501';
  end if;
  if not v_link.allow_card_enrollment then
    raise exception 'TARJETA_GUARDADA_NO_PERMITIDA: este enlace no ofrece guardar la tarjeta'
      using errcode = '42501';
  end if;
  if p_terms_version is distinct from c_terms then
    raise exception 'TERMINOS_NO_ACEPTADOS: se requiere la aceptación de %', c_terms using errcode = '23514';
  end if;
  v_org := v_link.organization_id;

  if p_provider_account_id is distinct from platform.resolve_org_card_account(v_org) then
    raise exception 'CUENTA_PROVEEDOR_NO_COINCIDE: la tarjeta se guarda en la cuenta que resuelve el servidor'
      using errcode = '42501';
  end if;
  if coalesce(btrim(p_external_payment_method_id), '') = '' or coalesce(btrim(p_external_customer_id), '') = '' then
    raise exception 'DATOS_REQUERIDOS: cliente y tarjeta del proveedor son obligatorios' using errcode = '23502';
  end if;

  insert into platform.provider_customers (
    provider_account_id, organization_id, external_customer_id, status, synced_at
  ) values (p_provider_account_id, v_org, p_external_customer_id, 'ACTIVE', now())
  on conflict (provider_account_id, organization_id) do update
    set external_customer_id = excluded.external_customer_id, status = 'ACTIVE', synced_at = now()
  returning id into v_customer;

  -- La autorización anterior (si la hay) queda sustituida por esta.
  perform platform.revoke_card_on_file_internal(
    v_org, null, 'PORTAL', 'Reemplazada por una nueva tarjeta autorizada desde el portal', null
  );

  update platform.provider_payment_methods
     set is_default = false
   where provider_account_id = p_provider_account_id and organization_id = v_org and is_default;

  insert into platform.provider_payment_methods (
    provider_account_id, organization_id, provider_customer_id, external_payment_method_id,
    brand, last4, exp_month, exp_year, is_default, status, synced_at, metadata
  ) values (
    p_provider_account_id, v_org, v_customer, p_external_payment_method_id,
    nullif(btrim(coalesce(p_brand, '')), ''), nullif(btrim(coalesce(p_last4, '')), ''),
    p_exp_month::smallint, p_exp_year::smallint, true, 'ACTIVE', now(),
    jsonb_build_object('origin', 'pay-portal')
  )
  on conflict (provider_account_id, external_payment_method_id) do update
    set brand = excluded.brand, last4 = excluded.last4, provider_customer_id = excluded.provider_customer_id,
        is_default = true, status = 'ACTIVE', synced_at = now()
  returning id into v_method;

  insert into platform.card_on_file_authorizations (
    organization_id, provider_account_id, payment_method_id, terms_version, link_id, client_fingerprint
  ) values (v_org, p_provider_account_id, v_method, c_terms, p_link_id, p_client_fingerprint)
  returning id into v_auth;

  -- Suscripciones activas cuya ruta de cobro admite esta cuenta.
  for v_sub in
    select s.id, s.code from platform.subscriptions s
     where s.billed_organization_id = v_org and s.status in ('ACTIVE', 'PAST_DUE')
     order by s.code
  loop
    if exists (select 1 from platform.provider_account_candidates(v_sub.id, 'CULQI_CARD') c
                where c.provider_account_id = p_provider_account_id and c.eligible) then
      perform platform.switch_profile_to_card_on_file(
        v_sub.id, p_provider_account_id, v_method,
        'Tarjeta guardada autorizada por el cliente desde el portal de pago (CARD_ON_FILE_V1)'
      );
      v_switched := v_switched + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  insert into platform.payment_link_events (link_id, kind, external_id, client_fingerprint)
  values (p_link_id, 'ENROLL', p_external_payment_method_id, p_client_fingerprint);

  perform platform.log_audit(
    'CARD_ON_FILE_ENROLLED', 'card_on_file_authorization', v_auth::text, v_org, null,
    jsonb_build_object(
      'terms_version', c_terms, 'link_hint', v_link.token_hint,
      'brand', p_brand, 'last4', p_last4,
      'subscriptions_switched', v_switched, 'subscriptions_skipped', v_skipped
    )
  );

  return jsonb_build_object(
    'authorization_id', v_auth,
    'payment_method_id', v_method,
    'brand', p_brand,
    'last4', p_last4,
    'subscriptions_switched', v_switched,
    'subscriptions_skipped', v_skipped
  );
end;
$$;

comment on function platform.enroll_card_on_file is
  'SERVER-ONLY. Registra la tarjeta guardada y la autorización CARD_ON_FILE_V1 desde el portal y '
  'pasa las suscripciones activas de la organización (cuya ruta admite la cuenta) a cobro automático.';

create or replace function platform.unenroll_card_on_file(
  p_token_hash         text,
  p_client_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_link  platform.payment_links;
  v_error text;
  v_count integer;
begin
  if not platform.is_service_context() then
    raise exception 'NO_AUTORIZADO_SERVER_ONLY: la baja de tarjeta guardada la registra el servidor'
      using errcode = '42501';
  end if;

  -- Revocar el cobro automático es siempre posible con un enlace vigente,
  -- aunque el enlace ya no ofrezca guardar tarjetas.
  v_link := platform.payment_link_lookup(p_token_hash);
  v_error := platform.payment_link_error(v_link);
  if v_error is not null then
    return jsonb_build_object('ok', false, 'error', v_error);
  end if;

  v_count := platform.revoke_card_on_file_internal(
    v_link.organization_id, null, 'PORTAL', 'Revocada por el cliente desde el portal de pago', null
  );

  insert into platform.payment_link_events (link_id, kind, client_fingerprint)
  values (v_link.id, 'UNENROLL', p_client_fingerprint);

  return jsonb_build_object('ok', true, 'revoked', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Consola: revocar una autorización (finanzas o super admin)
-- ---------------------------------------------------------------------------
create or replace function platform.revoke_card_on_file_authorization(
  p_authorization_id uuid,
  p_reason           text
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_auth  record;
  v_count integer;
begin
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin revocan autorizaciones de cobro'
      using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'MOTIVO_REQUERIDO: revocar una autorización exige un motivo' using errcode = '23502';
  end if;

  select * into v_auth from platform.card_on_file_authorizations where id = p_authorization_id;
  if v_auth.id is null then
    raise exception 'AUTORIZACION_NO_ENCONTRADA: %', p_authorization_id using errcode = '23503';
  end if;
  if v_auth.revoked_at is not null then
    return jsonb_build_object('id', v_auth.id, 'already_revoked', true);
  end if;

  v_count := platform.revoke_card_on_file_internal(null, p_authorization_id, 'CONSOLE', p_reason, auth.uid());
  return jsonb_build_object('id', v_auth.id, 'already_revoked', false, 'revoked', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Vistas para la consola
-- ---------------------------------------------------------------------------
create or replace view platform.v_card_on_file_authorizations
with (security_invoker = true) as
select
  a.id,
  a.organization_id,
  o.display_name           as organization_name,
  a.provider_account_id,
  pa.code                  as provider_account_code,
  pa.environment           as provider_environment,
  a.payment_method_id,
  m.brand,
  m.last4,
  m.external_payment_method_id,
  m.status                 as payment_method_status,
  a.terms_version,
  a.accepted_at,
  a.link_id,
  a.revoked_at,
  a.revoke_reason,
  a.revoke_source,
  (a.revoked_at is null)   as is_active,
  (select count(*) from platform.subscription_collection_profiles p
    where p.payment_method_id = a.payment_method_id and p.effective_to is null
      and p.recurring_mode = 'CARD_ON_FILE')::integer as subscriptions_on_card
from platform.card_on_file_authorizations a
join platform.organizations o on o.id = a.organization_id
-- LEFT: el admin de la organización ve su autorización aunque la cuenta sea de EBIM
-- (RLS de payment_provider_accounts solo le muestra las propias).
left join platform.payment_provider_accounts pa on pa.id = a.provider_account_id
join platform.provider_payment_methods m on m.id = a.payment_method_id;

comment on view platform.v_card_on_file_authorizations is
  'Autorizaciones de tarjeta guardada con brand/last4 y cuenta. Sin PAN, CVV ni token.';

revoke all on platform.v_card_on_file_authorizations from public, anon;
grant select on platform.v_card_on_file_authorizations to authenticated, service_role;

create or replace view platform.v_payment_charge_attempts
with (security_invoker = true) as
select
  x.id,
  x.invoice_id,
  i.number                 as invoice_number,
  i.customer_organization_id as organization_id,
  i.subscription_id,
  x.attempt_no,
  x.status,
  x.amount,
  x.currency,
  x.external_charge_id,
  x.payment_id,
  x.error_code,
  x.next_retry_at,
  x.trigger_source,
  x.created_by,
  x.created_at,
  x.completed_at,
  m.brand,
  m.last4
from platform.payment_charge_attempts x
join platform.invoices i on i.id = x.invoice_id
join platform.provider_payment_methods m on m.id = x.payment_method_id;

comment on view platform.v_payment_charge_attempts is
  'Historial de intentos de cobro con tarjeta guardada por factura (M2).';

revoke all on platform.v_payment_charge_attempts from public, anon;
grant select on platform.v_payment_charge_attempts to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. GRANTS de funciones
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
         'card_on_file_retry_at', 'card_on_file_due_invoices', 'begin_card_charge_attempt',
         'complete_card_charge_attempt', 'resolve_org_card_account', 'payment_link_enrollment',
         'payment_link_card_on_file', 'payment_link_enrollment_context', 'set_billing_contact_from_portal',
         'switch_profile_to_card_on_file', 'revoke_card_on_file_internal', 'enroll_card_on_file',
         'unenroll_card_on_file'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end;
$$;

revoke all on function platform.revoke_card_on_file_authorization(uuid, text) from public, anon;
grant execute on function platform.revoke_card_on_file_authorization(uuid, text) to authenticated, service_role;
