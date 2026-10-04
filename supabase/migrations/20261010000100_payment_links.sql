-- ============================================================================
-- MasterAdmin · M1 · Portal de pago por enlace (payment links)
-- ----------------------------------------------------------------------------
-- Spec: docs/superpowers/specs/2026-10-04-masteradmin-cobro-usuarios-design.md §2.
--
-- Un ENLACE abre el estado de cuenta de UNA organización: lista sus facturas
-- emitidas con saldo y permite pagarlas con tarjeta (y, en M2, guardar la
-- tarjeta). Es reutilizable, vence y se revoca.
--
-- REGLAS QUE ESTE ARCHIVO IMPONE EN LA BASE:
--   · el token en claro NO se guarda: solo `sha256` hex + una pista de 4
--     caracteres. Se devuelve UNA vez, al crearlo, y no se audita;
--   · el enlace lo crea y revoca finanzas (o el super admin) y siempre audita;
--   · leer el estado de cuenta y registrar eventos es SOLO SERVIDOR: la página
--     pública no habla con PostgREST, habla con la Edge Function `pay-portal`;
--   · un token inválido y uno inexistente responden igual (ENLACE_INVALIDO);
--   · límite de intentos: 10 por enlace y hora, 5 por factura y hora.
--
-- Este archivo NO escribe en `payments`: eso lo hace
-- `register_provider_invoice_payment` (migración 20261010000200).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enlaces
-- ---------------------------------------------------------------------------
create table platform.payment_links (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references platform.organizations (id) on delete restrict,
  token_hash            text not null,
  token_hint            text not null,
  expires_at            timestamptz not null,
  allow_card_enrollment boolean not null default true,
  revoked_at            timestamptz,
  revoked_by            uuid references auth.users (id) on delete set null,
  revoke_reason         text,
  last_accessed_at      timestamptz,
  access_count          integer not null default 0,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),

  constraint payment_links_token_hash_uk unique (token_hash),
  -- Un hash sha256 en hex y nada más: si alguien intentara guardar el token en
  -- claro aquí, no tendría esta forma.
  constraint payment_links_token_hash_ck check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint payment_links_token_hint_ck check (token_hint ~ '^[A-Za-z0-9_-]{4}$'),
  constraint payment_links_access_count_ck check (access_count >= 0),
  constraint payment_links_expiry_ck check (expires_at > created_at),
  constraint payment_links_revocation_ck check (
    (revoked_at is null and revoke_reason is null)
    or (revoked_at is not null and length(btrim(coalesce(revoke_reason, ''))) between 1 and 500)
  )
);

comment on table platform.payment_links is
  'Enlace al estado de cuenta de una organización (M1). Solo guarda el sha256 del token '
  'y una pista de 4 caracteres; el token en claro se muestra una única vez al crearlo.';
comment on column platform.payment_links.token_hash is
  'sha256 hex del token. No es reversible y no se expone a `authenticated` (GRANT por columna).';

create index payment_links_org_ix on platform.payment_links (organization_id, created_at desc);
create index payment_links_revoked_by_ix on platform.payment_links (revoked_by);
create index payment_links_created_by_ix on platform.payment_links (created_by);

-- ---------------------------------------------------------------------------
-- 2. Eventos del enlace (append-only)
-- ---------------------------------------------------------------------------
create table platform.payment_link_events (
  id                 uuid primary key default gen_random_uuid(),
  link_id            uuid not null references platform.payment_links (id) on delete restrict,
  kind               text not null,
  invoice_id         uuid references platform.invoices (id) on delete restrict,
  external_id        text,
  error_code         text,
  amount             numeric(14,2),
  currency           char(3) references platform.currencies (code) on delete restrict,
  -- Hash de IP + User-Agent calculado por la Edge Function. Nunca la IP en claro.
  client_fingerprint text,
  created_at         timestamptz not null default now(),

  constraint payment_link_events_kind_ck check (kind in (
    'VIEW', 'CHARGE_ATTEMPT', 'CHARGE_OK', 'CHARGE_FAILED',
    'ENROLL_ATTEMPT', 'ENROLL', 'UNENROLL', 'RATE_LIMITED'
  )),
  constraint payment_link_events_fingerprint_ck check (
    client_fingerprint is null or client_fingerprint ~ '^[0-9a-f]{16,64}$'
  ),
  constraint payment_link_events_currency_ck check (currency is null or currency ~ '^[A-Z]{3}$'),
  constraint payment_link_events_amount_ck check (amount is null or amount >= 0),
  -- Un id externo es opaco (chr_/crd_), nunca una credencial ni un token de tarjeta.
  constraint payment_link_events_external_ck check (
    external_id is null or external_id !~* '^(sk|pk|tkn)_'
  ),
  constraint payment_link_events_error_code_ck check (
    error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'
  )
);

comment on table platform.payment_link_events is
  'Bitácora append-only del portal de pago: vistas, intentos, cobros, altas de tarjeta y '
  'límites aplicados. Alimenta el límite de intentos y la ficha del enlace en la consola.';

create index payment_link_events_link_ix on platform.payment_link_events (link_id, created_at desc);
create index payment_link_events_invoice_ix on platform.payment_link_events (invoice_id, created_at desc);
create index payment_link_events_currency_ix on platform.payment_link_events (currency);

create trigger payment_link_events_append_only
  before update or delete on platform.payment_link_events
  for each row execute function platform.entitlement_log_append_only();
create trigger payment_link_events_no_truncate
  before truncate on platform.payment_link_events
  for each statement execute function platform.entitlement_log_append_only();

-- ---------------------------------------------------------------------------
-- 3. RLS + GRANT. Lectura: finanzas. Escritura: solo por las RPC de abajo.
--
-- `token_hash` queda FUERA del GRANT por columna: ni siquiera finanzas puede
-- leerlo por PostgREST. Que no sea reversible no significa que deba circular.
-- ---------------------------------------------------------------------------
alter table platform.payment_links enable row level security;
alter table platform.payment_links force row level security;
alter table platform.payment_link_events enable row level security;
alter table platform.payment_link_events force row level security;

revoke all on platform.payment_links from public, anon, authenticated;
revoke all on platform.payment_link_events from public, anon, authenticated;

grant select (
  id, organization_id, token_hint, expires_at, allow_card_enrollment, revoked_at, revoked_by,
  revoke_reason, last_accessed_at, access_count, created_by, created_at
) on platform.payment_links to authenticated;
grant select on platform.payment_link_events to authenticated;
grant all on platform.payment_links to service_role;
grant select, insert on platform.payment_link_events to service_role;

create policy payment_links_select on platform.payment_links
  for select to authenticated using ((select platform.can_read_finance()));

create policy payment_link_events_select on platform.payment_link_events
  for select to authenticated using ((select platform.can_read_finance()));

-- ---------------------------------------------------------------------------
-- 4. Helpers internos (no expuestos)
-- ---------------------------------------------------------------------------

/** Correo enmascarado para mostrarlo en una página pública: `p***s@alpha.ebim.test`. */
create or replace function platform.mask_email(p_email text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_email is null or position('@' in p_email) < 2 then null
    else left(split_part(p_email, '@', 1), 1)
         || '***'
         || case when length(split_part(p_email, '@', 1)) > 2
                 then right(split_part(p_email, '@', 1), 1) else '' end
         || '@' || split_part(p_email, '@', 2)
  end;
$$;

comment on function platform.mask_email(text) is
  'Enmascara un correo para la página pública del portal. No es un control de seguridad: '
  'evita exhibir el dato completo a quien solo tiene el enlace.';

/**
 * Cuenta de cobro con tarjeta que corresponde a una factura (spec §2.2):
 *   1. perfil de cobranza vigente de su suscripción si es CULQI_CARD;
 *   2. si no, el primer candidato elegible de provider_account_candidates;
 *   3. sin suscripción (factura de partner): la cuenta CULQI activa del país de la
 *      organización que cobra la moneda, con menor routing_priority (la propia
 *      de la organización antes que la de EBIM).
 * En todos los casos la cuenta debe cobrar la MONEDA de la factura.
 * NULL = la factura no es pagable con tarjeta.
 */
create or replace function platform.resolve_invoice_card_account(p_invoice_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_invoice record;
  v_org     record;
  v_account uuid;
begin
  select i.id, i.subscription_id, i.currency, i.customer_organization_id into v_invoice
    from platform.invoices i where i.id = p_invoice_id;
  if v_invoice.id is null then
    return null;
  end if;

  if v_invoice.subscription_id is not null then
    select p.provider_account_id into v_account
      from platform.subscription_collection_profiles p
      join platform.payment_provider_accounts a on a.id = p.provider_account_id
     where p.subscription_id = v_invoice.subscription_id
       and p.effective_to is null
       and p.collection_method = 'CULQI_CARD'
       and a.status = 'ACTIVE' and a.provider_kind = 'CULQI'
       and exists (select 1 from platform.payment_provider_account_currencies c
                    where c.provider_account_id = a.id and c.currency_code = v_invoice.currency
                      and c.status = 'ACTIVE');
    if v_account is not null then
      return v_account;
    end if;

    select c.provider_account_id into v_account
      from platform.provider_account_candidates(v_invoice.subscription_id, 'CULQI_CARD') c
     where c.eligible
       and exists (select 1 from platform.payment_provider_account_currencies x
                    where x.provider_account_id = c.provider_account_id
                      and x.currency_code = v_invoice.currency and x.status = 'ACTIVE')
     order by c.route_rank
     limit 1;
    return v_account;
  end if;

  select o.id, o.country_code into v_org
    from platform.organizations o where o.id = v_invoice.customer_organization_id;

  select a.id into v_account
    from platform.payment_provider_accounts a
   where a.status = 'ACTIVE'
     and a.provider_kind = 'CULQI'
     and (a.owner_organization_id is null or a.owner_organization_id = v_org.id)
     and a.country_code = v_org.country_code
     and (a.environment = 'TEST' or a.secret_key_ref is not null)
     and exists (select 1 from platform.payment_provider_account_currencies c
                  where c.provider_account_id = a.id and c.currency_code = v_invoice.currency
                    and c.status = 'ACTIVE')
   order by (a.owner_organization_id is not null) desc, a.routing_priority, a.code
   limit 1;

  return v_account;
end;
$$;

comment on function platform.resolve_invoice_card_account(uuid) is
  'Cuenta Culqi con la que se cobra una factura con tarjeta (perfil CULQI_CARD → candidato '
  'elegible → cuenta del país para facturas sin suscripción). NULL = no pagable con tarjeta.';

/** Saldo de una factura: total − Σ pagos CONFIRMED. */
create or replace function platform.invoice_balance(p_invoice_id uuid)
returns numeric
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select round(i.total - coalesce((
           select sum(p.amount) from platform.payments p
            where p.invoice_id = i.id and p.status = 'CONFIRMED'), 0), 2)
    from platform.invoices i where i.id = p_invoice_id;
$$;

/**
 * Estado de un enlace por su hash: el enlace válido o el código de error que
 * corresponde. Un hash mal formado y uno inexistente dan el MISMO resultado.
 */
create or replace function platform.payment_link_lookup(p_token_hash text)
returns platform.payment_links
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_link platform.payment_links;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select * into v_link from platform.payment_links where token_hash = p_token_hash;
  return v_link;
end;
$$;

create or replace function platform.payment_link_error(p_link platform.payment_links)
returns text
language sql
stable
set search_path = platform, pg_catalog
as $$
  select case
    when p_link.id is null then 'ENLACE_INVALIDO'
    when p_link.revoked_at is not null then 'ENLACE_REVOCADO'
    when p_link.expires_at <= now() then 'ENLACE_VENCIDO'
    else null
  end;
$$;

/**
 * Tarjeta guardada de la organización para el estado de cuenta. M1 solo la
 * describe (brand/last4); M2 (20261010000300) la redefine para añadir la
 * autorización de cobro automático.
 */
create or replace function platform.payment_link_card_on_file(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select (
    select jsonb_build_object('brand', m.brand, 'last4', m.last4, 'authorized', false)
      from platform.provider_payment_methods m
     where m.organization_id = p_organization_id and m.status = 'ACTIVE' and m.is_default
     order by m.updated_at desc
     limit 1
  );
$$;

/**
 * ¿Ofrece el enlace guardar la tarjeta (M2)? En M1 nunca; la migración
 * 20261010000300 la redefine con la cuenta de alta y los datos que faltan.
 */
create or replace function platform.payment_link_enrollment(p_link_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select jsonb_build_object('available', false, 'link_id', p_link_id);
$$;

-- ---------------------------------------------------------------------------
-- 5. create_payment_link — finanzas o super admin
-- ---------------------------------------------------------------------------
create or replace function platform.create_payment_link(
  p_organization_id       uuid,
  p_expires_in_days       integer default 30,
  p_allow_card_enrollment boolean default true,
  p_reason                text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = platform, pg_catalog
as $$
declare
  -- Spec §2.1: por defecto +30 días; máximo 90.
  c_default_days constant integer := 30;
  c_max_days     constant integer := 90;
  v_days    integer := coalesce(p_expires_in_days, c_default_days);
  v_org     record;
  v_token   text;
  v_hash    text;
  v_id      uuid;
  v_expires timestamptz;
begin
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin generan enlaces de pago'
      using errcode = '42501';
  end if;

  if v_days < 1 or v_days > c_max_days then
    raise exception 'VIGENCIA_INVALIDA: el enlace vence entre 1 y % días (recibido %)', c_max_days, v_days
      using errcode = '23514';
  end if;

  select o.id, o.display_name, o.status into v_org
    from platform.organizations o where o.id = p_organization_id;
  if v_org.id is null then
    raise exception 'ORGANIZACION_NO_ENCONTRADA: %', p_organization_id using errcode = '23503';
  end if;
  if v_org.status <> 'ACTIVE' then
    raise exception 'ORGANIZACION_INACTIVA: % no está activa', v_org.display_name using errcode = '23514';
  end if;

  -- 32 bytes aleatorios → base64url sin relleno (43 caracteres).
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), E'+/=\n', '-_');
  v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');
  v_expires := now() + make_interval(days => v_days);

  insert into platform.payment_links (
    organization_id, token_hash, token_hint, expires_at, allow_card_enrollment, created_by
  ) values (
    p_organization_id, v_hash, right(v_token, 4), v_expires, coalesce(p_allow_card_enrollment, true), auth.uid()
  )
  returning id into v_id;

  -- Se audita SIN el token ni su hash: la pista basta para reconocerlo.
  perform platform.log_audit(
    'PAYMENT_LINK_CREATED', 'payment_link', v_id::text, p_organization_id, null,
    jsonb_build_object(
      'hint', right(v_token, 4),
      'expires_at', v_expires,
      'allow_card_enrollment', coalesce(p_allow_card_enrollment, true),
      'reason', nullif(btrim(coalesce(p_reason, '')), '')
    )
  );

  return jsonb_build_object(
    'id', v_id,
    'token', v_token,
    'hint', right(v_token, 4),
    'expires_at', v_expires
  );
end;
$$;

comment on function platform.create_payment_link(uuid, integer, boolean, text) is
  'Genera un enlace al estado de cuenta (finanzas o super admin). Devuelve el token en claro '
  'UNA sola vez; la base solo conserva su sha256 y una pista de 4 caracteres.';

-- ---------------------------------------------------------------------------
-- 6. revoke_payment_link — idempotente
-- ---------------------------------------------------------------------------
create or replace function platform.revoke_payment_link(p_link_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_link platform.payment_links;
begin
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin revocan enlaces de pago'
      using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'MOTIVO_REQUERIDO: revocar un enlace exige un motivo' using errcode = '23502';
  end if;

  select * into v_link from platform.payment_links where id = p_link_id for update;
  if v_link.id is null then
    raise exception 'ENLACE_NO_ENCONTRADO: %', p_link_id using errcode = '23503';
  end if;

  if v_link.revoked_at is not null then
    return jsonb_build_object('id', v_link.id, 'already_revoked', true, 'revoked_at', v_link.revoked_at);
  end if;

  update platform.payment_links
     set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = left(btrim(p_reason), 500)
   where id = p_link_id;

  perform platform.log_audit(
    'PAYMENT_LINK_REVOKED', 'payment_link', p_link_id::text, v_link.organization_id, null,
    jsonb_build_object('hint', v_link.token_hint, 'reason', left(btrim(p_reason), 500))
  );

  return jsonb_build_object('id', p_link_id, 'already_revoked', false, 'revoked_at', now());
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. register_payment_link_event — SOLO SERVIDOR. Aplica el límite de intentos.
-- ---------------------------------------------------------------------------
create or replace function platform.register_payment_link_event(
  p_link_id            uuid,
  p_kind               text,
  p_invoice_id         uuid default null,
  p_external_id        text default null,
  p_error_code         text default null,
  p_amount             numeric default null,
  p_currency           char(3) default null,
  p_client_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  -- Spec §2.1: 10 intentos por enlace y hora; 5 por factura y hora.
  c_link_limit    constant integer := 10;
  c_invoice_limit constant integer := 5;
  c_window        constant interval := interval '1 hour';
  v_id            uuid;
  v_link_count    integer;
  v_invoice_count integer;
begin
  if not platform.is_service_context() then
    raise exception 'NO_AUTORIZADO_SERVER_ONLY: los eventos del portal los registra el servidor'
      using errcode = '42501';
  end if;

  if not exists (select 1 from platform.payment_links where id = p_link_id) then
    raise exception 'ENLACE_NO_ENCONTRADO: %', p_link_id using errcode = '23503';
  end if;

  if p_kind in ('CHARGE_ATTEMPT', 'ENROLL_ATTEMPT') then
    -- Serializa los intentos del mismo enlace: dos peticiones simultáneas no
    -- pueden pasar ambas el límite.
    perform 1 from platform.payment_links where id = p_link_id for update;

    select count(*) into v_link_count
      from platform.payment_link_events
     where link_id = p_link_id
       and kind in ('CHARGE_ATTEMPT', 'ENROLL_ATTEMPT')
       and created_at > now() - c_window;

    if p_invoice_id is not null then
      select count(*) into v_invoice_count
        from platform.payment_link_events
       where invoice_id = p_invoice_id
         and kind = 'CHARGE_ATTEMPT'
         and created_at > now() - c_window;
    end if;

    if v_link_count >= c_link_limit or coalesce(v_invoice_count, 0) >= c_invoice_limit then
      insert into platform.payment_link_events (
        link_id, kind, invoice_id, error_code, client_fingerprint
      ) values (
        p_link_id, 'RATE_LIMITED', p_invoice_id, 'DEMASIADOS_INTENTOS', p_client_fingerprint
      )
      returning id into v_id;
      return jsonb_build_object('event_id', v_id, 'rate_limited', true);
    end if;
  end if;

  insert into platform.payment_link_events (
    link_id, kind, invoice_id, external_id, error_code, amount, currency, client_fingerprint
  ) values (
    p_link_id, p_kind, p_invoice_id, p_external_id, p_error_code, p_amount, p_currency, p_client_fingerprint
  )
  returning id into v_id;

  return jsonb_build_object('event_id', v_id, 'rate_limited', false);
end;
$$;

comment on function platform.register_payment_link_event is
  'SERVER-ONLY. Bitácora del portal. Para CHARGE_ATTEMPT/ENROLL_ATTEMPT aplica el límite '
  '(10/enlace/hora, 5/factura/hora) y, si se supera, registra RATE_LIMITED en su lugar.';

-- ---------------------------------------------------------------------------
-- 8. payment_link_statement — SOLO SERVIDOR. Estado de cuenta del enlace.
-- ---------------------------------------------------------------------------
create or replace function platform.payment_link_statement(
  p_token_hash         text,
  p_client_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_link     platform.payment_links;
  v_error    text;
  v_org      record;
  v_invoices jsonb;
  v_accounts jsonb;
begin
  if not platform.is_service_context() then
    raise exception 'NO_AUTORIZADO_SERVER_ONLY: el estado de cuenta del portal lo lee el servidor'
      using errcode = '42501';
  end if;

  v_link := platform.payment_link_lookup(p_token_hash);
  v_error := platform.payment_link_error(v_link);
  if v_error is not null then
    return jsonb_build_object('valid', false, 'error', v_error);
  end if;

  update platform.payment_links
     set last_accessed_at = now(), access_count = access_count + 1
   where id = v_link.id;

  insert into platform.payment_link_events (link_id, kind, client_fingerprint)
  values (v_link.id, 'VIEW', p_client_fingerprint);

  select o.id, o.display_name, o.billing_email, o.country_code into v_org
    from platform.organizations o where o.id = v_link.organization_id;

  with pending as (
    select i.id, i.number, i.status, i.currency, i.total, i.issue_date, i.due_date,
           i.period_start, i.period_end, i.subscription_id,
           platform.invoice_balance(i.id) as balance,
           platform.resolve_invoice_card_account(i.id) as account_id
      from platform.invoices i
     where i.customer_organization_id = v_link.organization_id
       and i.status in ('ISSUED', 'PARTIALLY_PAID')
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'number', p.number,
      'status', p.status,
      'currency', p.currency,
      'total', p.total,
      'paid', round(p.total - p.balance, 2),
      'balance', p.balance,
      'issue_date', p.issue_date,
      'due_date', p.due_date,
      'period_start', p.period_start,
      'period_end', p.period_end,
      'product', (select sp.short_name from platform.subscriptions s
                    join platform.saas_products sp on sp.id = s.saas_product_id
                   where s.id = p.subscription_id),
      'payable_by_card', p.account_id is not null,
      'account_id', p.account_id
    ) order by p.due_date nulls last, p.issue_date, p.number) filter (where p.balance > 0), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'code', a.code, 'provider_kind', a.provider_kind,
               'environment', a.environment, 'currency', a.currency,
               'public_key', a.public_key, 'secret_key_ref', a.secret_key_ref))
        from platform.payment_provider_accounts a
       where a.id in (select x.account_id from pending x where x.balance > 0)
    ), '[]'::jsonb)
    into v_invoices, v_accounts
    from pending p;

  return jsonb_build_object(
    'valid', true,
    'link', jsonb_build_object(
      'id', v_link.id,
      'expires_at', v_link.expires_at,
      'allow_card_enrollment', v_link.allow_card_enrollment
    ),
    'organization', jsonb_build_object(
      'id', v_org.id,
      'name', v_org.display_name,
      'billing_email_masked', platform.mask_email(v_org.billing_email),
      'country_code', v_org.country_code
    ),
    'invoices', v_invoices,
    'accounts', v_accounts,
    'card_on_file', platform.payment_link_card_on_file(v_org.id),
    'enrollment', platform.payment_link_enrollment(v_link.id)
  );
end;
$$;

comment on function platform.payment_link_statement(text, text) is
  'SERVER-ONLY. Estado de cuenta del enlace: organización (correo enmascarado), facturas '
  'ISSUED/PARTIALLY_PAID con saldo, cuenta Culqi resuelta por factura y tarjeta guardada. '
  'Registra VIEW. La Edge Function quita ids internos y referencias de secretos antes de responder.';

-- ---------------------------------------------------------------------------
-- 9. payment_link_charge_context — SOLO SERVIDOR. Revalida antes de cobrar.
-- ---------------------------------------------------------------------------
create or replace function platform.payment_link_charge_context(
  p_token_hash text,
  p_invoice_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_link    platform.payment_links;
  v_error   text;
  v_invoice record;
  v_balance numeric(14,2);
  v_account uuid;
  v_email   text;
begin
  if not platform.is_service_context() then
    raise exception 'NO_AUTORIZADO_SERVER_ONLY: el contexto de cobro del portal lo resuelve el servidor'
      using errcode = '42501';
  end if;

  v_link := platform.payment_link_lookup(p_token_hash);
  v_error := platform.payment_link_error(v_link);
  if v_error is not null then
    return jsonb_build_object('ok', false, 'error', v_error);
  end if;

  select i.id, i.number, i.status, i.currency, i.subscription_id, i.customer_organization_id
    into v_invoice
    from platform.invoices i where i.id = p_invoice_id;

  -- Una factura de OTRA organización responde igual que una inexistente.
  if v_invoice.id is null
     or v_invoice.customer_organization_id <> v_link.organization_id
     or v_invoice.status not in ('ISSUED', 'PARTIALLY_PAID') then
    return jsonb_build_object('ok', false, 'error', 'FACTURA_NO_PAGABLE', 'link_id', v_link.id);
  end if;

  v_balance := platform.invoice_balance(v_invoice.id);
  if v_balance <= 0 then
    return jsonb_build_object('ok', false, 'error', 'FACTURA_NO_PAGABLE', 'link_id', v_link.id);
  end if;

  v_account := platform.resolve_invoice_card_account(v_invoice.id);
  if v_account is null then
    return jsonb_build_object('ok', false, 'error', 'CUENTA_NO_CONFIGURADA', 'link_id', v_link.id);
  end if;

  select o.billing_email into v_email from platform.organizations o where o.id = v_link.organization_id;

  return jsonb_build_object(
    'ok', true,
    'link_id', v_link.id,
    'organization_id', v_link.organization_id,
    'allow_card_enrollment', v_link.allow_card_enrollment,
    'billing_email', v_email,
    'provider_account_id', v_account,
    'invoice', jsonb_build_object(
      'id', v_invoice.id, 'number', v_invoice.number, 'currency', v_invoice.currency,
      'balance', v_balance, 'subscription_id', v_invoice.subscription_id
    )
  );
end;
$$;

comment on function platform.payment_link_charge_context(text, uuid) is
  'SERVER-ONLY. Revalida enlace, pertenencia y saldo de la factura y resuelve la cuenta Culqi '
  'antes de cobrar desde el portal. No escribe nada.';

-- ---------------------------------------------------------------------------
-- 10. Vista para la consola (finanzas): estado derivado y actividad.
-- ---------------------------------------------------------------------------
create or replace view platform.v_payment_links
with (security_invoker = true) as
select
  l.id,
  l.organization_id,
  o.display_name                as organization_name,
  l.token_hint,
  case
    when l.revoked_at is not null then 'REVOKED'
    when l.expires_at <= now() then 'EXPIRED'
    else 'ACTIVE'
  end                           as status,
  l.expires_at,
  l.allow_card_enrollment,
  l.revoked_at,
  l.revoke_reason,
  l.last_accessed_at,
  l.access_count,
  l.created_by,
  l.created_at,
  (select count(*) from platform.payment_link_events e
    where e.link_id = l.id and e.kind = 'CHARGE_OK')::integer      as charges_ok,
  (select count(*) from platform.payment_link_events e
    where e.link_id = l.id and e.kind = 'CHARGE_FAILED')::integer  as charges_failed,
  (select count(*) from platform.payment_link_events e
    where e.link_id = l.id and e.kind = 'RATE_LIMITED')::integer   as rate_limited,
  (select max(e.created_at) from platform.payment_link_events e
    where e.link_id = l.id and e.kind <> 'VIEW')                    as last_event_at
from platform.payment_links l
join platform.organizations o on o.id = l.organization_id;

comment on view platform.v_payment_links is
  'Enlaces de pago con estado derivado (ACTIVE/EXPIRED/REVOKED) y actividad. Sin token ni hash.';

revoke all on platform.v_payment_links from public, anon;
grant select on platform.v_payment_links to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. GRANTS de funciones
-- ---------------------------------------------------------------------------
revoke all on function platform.mask_email(text) from public, anon, authenticated;
revoke all on function platform.resolve_invoice_card_account(uuid) from public, anon, authenticated;
revoke all on function platform.invoice_balance(uuid) from public, anon, authenticated;
revoke all on function platform.payment_link_lookup(text) from public, anon, authenticated;
revoke all on function platform.payment_link_error(platform.payment_links) from public, anon, authenticated;
revoke all on function platform.payment_link_card_on_file(uuid) from public, anon, authenticated;
revoke all on function platform.payment_link_enrollment(uuid) from public, anon, authenticated;
grant execute on function platform.payment_link_enrollment(uuid) to service_role;
grant execute on function platform.mask_email(text) to service_role;
grant execute on function platform.resolve_invoice_card_account(uuid) to service_role;
grant execute on function platform.invoice_balance(uuid) to service_role;
grant execute on function platform.payment_link_lookup(text) to service_role;
grant execute on function platform.payment_link_error(platform.payment_links) to service_role;
grant execute on function platform.payment_link_card_on_file(uuid) to service_role;

-- Consola (finanzas): la autorización real está dentro de la función.
revoke all on function platform.create_payment_link(uuid, integer, boolean, text) from public, anon;
revoke all on function platform.revoke_payment_link(uuid, text) from public, anon;
grant execute on function platform.create_payment_link(uuid, integer, boolean, text) to authenticated, service_role;
grant execute on function platform.revoke_payment_link(uuid, text) to authenticated, service_role;

-- Servidor: ni siquiera se exponen a `authenticated` por PostgREST.
revoke all on function platform.register_payment_link_event(uuid, text, uuid, text, text, numeric, char, text)
  from public, anon, authenticated;
revoke all on function platform.payment_link_statement(text, text) from public, anon, authenticated;
revoke all on function platform.payment_link_charge_context(text, uuid) from public, anon, authenticated;
grant execute on function platform.register_payment_link_event(uuid, text, uuid, text, text, numeric, char, text)
  to service_role;
grant execute on function platform.payment_link_statement(text, text) to service_role;
grant execute on function platform.payment_link_charge_context(text, uuid) to service_role;
