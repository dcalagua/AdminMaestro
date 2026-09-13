-- ============================================================================
-- EBIM Control Plane V3 — 28 · Routing regional de cobro
-- ----------------------------------------------------------------------------
-- Fase 07 de `.claude-prompts-v3-multicurrency`. Cierra G-16 (T-7).
--
-- EL PROBLEMA: una cuenta de cobro tenía `country_code 'PE'` y `currency 'PEN'`
-- por defecto y nadie los comparaba con la suscripción. La UI elegía la cuenta
-- de una lista, y nada impedía que la cuenta Culqi de Perú intentara cobrar un
-- contrato BOB de Bolivia. Culqi era, de hecho, el proveedor universal.
--
-- AHORA:
--   · la cuenta pertenece a un MERCADO y declara las MONEDAS que puede cobrar
--     (Culqi Perú cobra PEN y USD: evidencia V2.1);
--   · cada tipo de proveedor declara qué MÉTODOS soporta (Culqi = tarjeta);
--   · `provider_account_candidates()` evalúa cada cuenta contra una suscripción
--     y dice por qué sirve o no;
--   · el SERVIDOR elige la cuenta (`p_route_provider`): la UI ya no envía un
--     `provider_account_id`. Una cuenta explícita (API/soporte) solo se acepta
--     si es elegible.
--   · SERVICE_ORDER, PURCHASE_ORDER, BANK_TRANSFER y MANUAL no necesitan cuenta
--     y siguen operativos exactamente igual.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Mercado y prioridad de la cuenta
-- ---------------------------------------------------------------------------
alter table platform.payment_provider_accounts
  add column market_id uuid references platform.markets (id) on delete restrict,
  add column routing_priority integer not null default 100;

create index ppa_market_idx on platform.payment_provider_accounts (market_id);

comment on column platform.payment_provider_accounts.market_id is
  'Mercado que atiende la cuenta. Una cuenta de Perú no cobra contratos de Bolivia.';
comment on column platform.payment_provider_accounts.routing_priority is
  'Desempate entre cuentas elegibles del mismo mercado (menor = preferida). La cuenta '
  'propia de la organización que paga siempre gana a una de EBIM.';
comment on column platform.payment_provider_accounts.currency is
  'Moneda PRINCIPAL de la cuenta. Las monedas que puede cobrar están en '
  'payment_provider_account_currencies (la principal siempre incluida).';

-- Backfill: país con un único mercado activo.
update platform.payment_provider_accounts a
   set market_id = m.id
  from platform.markets m
 where a.market_id is null
   and m.country_code = a.country_code
   and m.status = 'ACTIVE'
   and (select count(*) from platform.markets m2
         where m2.country_code = a.country_code and m2.status = 'ACTIVE') = 1;

-- Sin país ni moneda implícitos: una cuenta nueva los declara (o los hereda de su mercado).
alter table platform.payment_provider_accounts alter column country_code drop default;
alter table platform.payment_provider_accounts alter column currency drop default;

-- ---------------------------------------------------------------------------
-- 2. Monedas que cobra cada cuenta
-- ---------------------------------------------------------------------------
create table platform.payment_provider_account_currencies (
  provider_account_id uuid not null references platform.payment_provider_accounts (id) on delete cascade,
  currency_code       char(3) not null references platform.currencies (code) on delete restrict,
  status              platform.entity_status not null default 'ACTIVE',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (provider_account_id, currency_code)
);

create index ppac_currency_idx on platform.payment_provider_account_currencies (currency_code);
create trigger ppac_set_updated_at before update on platform.payment_provider_account_currencies
  for each row execute function platform.set_updated_at();

comment on table platform.payment_provider_account_currencies is
  'Monedas que una cuenta de cobro puede cobrar. Deben estar admitidas por su mercado.';

-- Backfill explícito (DV3-010): la moneda principal de cada cuenta, y además
-- las dos cuentas de sistema creadas por la migración 17:
--   · culqi-pe-test cobra también USD — la evidencia V2.1 cobró PEN y USD con
--     esa misma cuenta (docs/nightly-v2-1);
--   · ebim-manual registra transferencias de Perú en ambas monedas del mercado.
insert into platform.payment_provider_account_currencies (provider_account_id, currency_code)
select a.id, a.currency from platform.payment_provider_accounts a
on conflict do nothing;

insert into platform.payment_provider_account_currencies (provider_account_id, currency_code)
select a.id, x.currency_code
  from (values ('culqi-pe-test', 'USD'), ('ebim-manual', 'PEN')) as x (code, currency_code)
  join platform.payment_provider_accounts a on a.code = x.code
on conflict do nothing;

alter table platform.payment_provider_account_currencies enable row level security;
alter table platform.payment_provider_account_currencies force row level security;

grant select on platform.payment_provider_account_currencies to authenticated;
revoke insert, update, delete on platform.payment_provider_account_currencies from authenticated;
revoke all on platform.payment_provider_account_currencies from anon, public;
grant all on platform.payment_provider_account_currencies to service_role;

-- Mismo alcance que la cuenta: quien ve la cuenta ve sus monedas.
create policy ppac_select on platform.payment_provider_account_currencies
  for select to authenticated
  using (exists (
    select 1 from platform.payment_provider_accounts a
     where a.id = payment_provider_account_currencies.provider_account_id
  ));

-- ---------------------------------------------------------------------------
-- 3. Qué métodos soporta cada tipo de proveedor.
--    Una regla de catálogo, en un único sitio. OTHER no soporta nada hasta que
--    alguien lo diseñe: no se asume.
-- ---------------------------------------------------------------------------
create or replace function platform.provider_kind_supports_method(
  p_kind   platform.provider_kind,
  p_method platform.collection_method
)
returns boolean
language sql
immutable
set search_path = platform, pg_catalog
as $$
  select case p_kind
    when 'CULQI'  then p_method = 'CULQI_CARD'
    when 'BANK'   then p_method = 'BANK_TRANSFER'
    when 'MANUAL' then p_method in ('MANUAL', 'BANK_TRANSFER', 'SERVICE_ORDER', 'PURCHASE_ORDER')
    else false
  end;
$$;

comment on function platform.provider_kind_supports_method(platform.provider_kind, platform.collection_method) is
  'CULQI = tarjeta; BANK = transferencia; MANUAL = registro manual, transferencia, OS y OC; OTHER = nada.';

-- ---------------------------------------------------------------------------
-- 4. Guards de coherencia de la cuenta
-- ---------------------------------------------------------------------------
create or replace function platform.enforce_provider_account_market()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_market     platform.markets;
  v_candidates integer;
  v_candidate  uuid;
begin
  if new.market_id is null and new.country_code is not null then
    select count(*), min(m.id::text)::uuid into v_candidates, v_candidate
      from platform.markets m where m.country_code = new.country_code and m.status = 'ACTIVE';
    if v_candidates = 1 then
      new.market_id := v_candidate;
    end if;
  end if;

  if new.market_id is null then
    -- Sin mercado ni país la fila no llega a existir: NOT NULL de country_code.
    return new;
  end if;

  select * into v_market from platform.markets where id = new.market_id;
  new.country_code := coalesce(new.country_code, v_market.country_code);

  if new.country_code <> v_market.country_code then
    raise exception 'MERCADO_PAIS_INCOHERENTE: la cuenta "%" declara país % y el mercado % es de %',
      new.code, new.country_code, v_market.code, v_market.country_code
      using errcode = '23514';
  end if;

  if new.currency is not null
     and (tg_op = 'INSERT' or new.currency is distinct from old.currency or new.market_id is distinct from old.market_id)
     and not platform.is_currency_allowed_in_market(new.market_id, new.currency) then
    raise exception 'MONEDA_NO_PERMITIDA_EN_MERCADO: la cuenta "%" no puede cobrar % en el mercado %',
      new.code, new.currency, v_market.code
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Nombre posterior a `ppa_no_secrets`: los triggers BEFORE corren en orden
-- alfabético y el rechazo de secretos debe seguir siendo lo primero.
create trigger ppa_regional_guard
  before insert or update of market_id, country_code, currency on platform.payment_provider_accounts
  for each row execute function platform.enforce_provider_account_market();

-- La moneda principal siempre está entre las que la cuenta cobra.
create or replace function platform.sync_provider_account_primary_currency()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  insert into platform.payment_provider_account_currencies (provider_account_id, currency_code, status)
  values (new.id, new.currency, 'ACTIVE')
  on conflict (provider_account_id, currency_code) do update set status = 'ACTIVE';
  return null;
end;
$$;

create trigger ppa_primary_currency_sync
  after insert or update of currency on platform.payment_provider_accounts
  for each row execute function platform.sync_provider_account_primary_currency();

create or replace function platform.enforce_provider_account_currency()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_account record;
begin
  if new.status <> 'ACTIVE' then
    return new;
  end if;

  select a.code, a.market_id, m.code as market_code into v_account
    from platform.payment_provider_accounts a
    left join platform.markets m on m.id = a.market_id
   where a.id = new.provider_account_id;

  if v_account.market_id is not null
     and not platform.is_currency_allowed_in_market(v_account.market_id, new.currency_code) then
    raise exception 'MONEDA_NO_PERMITIDA_EN_MERCADO: la cuenta "%" (mercado %) no puede cobrar %',
      v_account.code, v_account.market_code, new.currency_code
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger ppac_market_guard
  before insert or update on platform.payment_provider_account_currencies
  for each row execute function platform.enforce_provider_account_currency();

-- ---------------------------------------------------------------------------
-- 5. Elegibilidad: la regla de routing, en UN sitio.
--
-- SECURITY INVOKER a propósito: llamada desde la UI respeta RLS (un admin de
-- organización solo ve sus propias cuentas); llamada desde el trigger o la RPC
-- de perfil (SECURITY DEFINER) ve todas y decide.
--
-- Orden de los motivos = orden en que se evalúan. `route_rank` 1 es la cuenta
-- que el servidor asigna: la propia de quien paga antes que la de EBIM, luego
-- `routing_priority`, luego código (determinista).
-- ---------------------------------------------------------------------------
create or replace function platform.provider_account_candidates(
  p_subscription_id   uuid,
  p_collection_method platform.collection_method
)
returns table (
  provider_account_id   uuid,
  account_code          text,
  account_name          text,
  provider_kind         platform.provider_kind,
  environment           platform.provider_environment,
  owner_organization_id uuid,
  market_code           text,
  currencies            text[],
  eligible              boolean,
  reason                text,
  route_rank            integer
)
language sql
stable
security invoker
set search_path = platform, pg_catalog
as $$
  with sub as (
    select s.id, s.billed_organization_id, s.currency, s.market_id, o.country_code as billed_country
      from platform.subscriptions s
      join platform.organizations o on o.id = s.billed_organization_id
     where s.id = p_subscription_id
  ),
  evaluated as (
    select
      a.id, a.code, a.name, a.provider_kind, a.environment, a.owner_organization_id,
      m.code as market_code, a.routing_priority,
      (select array_agg(c.currency_code::text order by c.currency_code)
         from platform.payment_provider_account_currencies c
        where c.provider_account_id = a.id and c.status = 'ACTIVE') as currencies,
      case
        when a.status <> 'ACTIVE' then 'CUENTA_PROVEEDOR_INACTIVA'
        when not platform.provider_kind_supports_method(a.provider_kind, p_collection_method)
          then 'PROVEEDOR_INCOMPATIBLE'
        when a.owner_organization_id is not null and a.owner_organization_id <> sub.billed_organization_id
          then 'CUENTA_PROVEEDOR_AJENA'
        when sub.market_id is not null and a.market_id is distinct from sub.market_id
          then 'CUENTA_PROVEEDOR_OTRO_MERCADO'
        -- Contrato fuera del modelo regional (sin mercado): solo cuentas del país de quien paga.
        when sub.market_id is null and a.country_code <> sub.billed_country
          then 'CUENTA_PROVEEDOR_OTRO_MERCADO'
        when not exists (
          select 1 from platform.payment_provider_account_currencies c
           where c.provider_account_id = a.id and c.currency_code = sub.currency and c.status = 'ACTIVE'
        ) then 'MONEDA_NO_SOPORTADA_POR_CUENTA'
        when a.environment = 'LIVE' and a.secret_key_ref is null then 'PROVEEDOR_LIVE_SIN_SECRETO'
        else null
      end as reason
    from sub
    cross join platform.payment_provider_accounts a
    left join platform.markets m on m.id = a.market_id
  )
  select
    e.id, e.code, e.name, e.provider_kind, e.environment, e.owner_organization_id, e.market_code,
    e.currencies,
    e.reason is null,
    e.reason,
    case when e.reason is null then
      (row_number() over (
         partition by (e.reason is null)
         order by (e.owner_organization_id is not null) desc, e.routing_priority, e.code
       ))::integer
    end
  from evaluated e
  order by (e.reason is null) desc, e.routing_priority, e.code;
$$;

comment on function platform.provider_account_candidates(uuid, platform.collection_method) is
  'Evalúa cada cuenta de cobro visible contra una suscripción y un método: elegible o el motivo '
  '(inactiva, método, ajena, otro mercado, moneda, LIVE sin secreto). route_rank = 1 es la '
  'cuenta que asigna el servidor.';

-- ---------------------------------------------------------------------------
-- 6. Guard del perfil: la cuenta indicada debe ser ELEGIBLE.
--
-- Solo se evalúa cuando cambia algo que afecta al routing (alta, cuenta,
-- método o suscripción). Cerrar la vigencia de un perfil histórico no vuelve a
-- juzgar una cuenta que era válida cuando se configuró.
-- ---------------------------------------------------------------------------
create or replace function platform.enforce_collection_profile_scope()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_candidate record;
  v_sub       record;
begin
  if new.provider_account_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.provider_account_id is not distinct from old.provider_account_id
     and new.collection_method is not distinct from old.collection_method
     and new.subscription_id is not distinct from old.subscription_id then
    return new;
  end if;

  select * into v_candidate
    from platform.provider_account_candidates(new.subscription_id, new.collection_method) c
   where c.provider_account_id = new.provider_account_id;

  if v_candidate.eligible then
    return new;
  end if;

  select s.code, s.currency, m.code as market_code into v_sub
    from platform.subscriptions s left join platform.markets m on m.id = s.market_id
   where s.id = new.subscription_id;

  case v_candidate.reason
    when 'CUENTA_PROVEEDOR_AJENA' then
      raise exception 'CUENTA_PROVEEDOR_AJENA: la cuenta "%" pertenece a otra organización y no puede cobrar la suscripción %',
        v_candidate.account_code, v_sub.code
        using errcode = '42501';
    when 'CUENTA_PROVEEDOR_INACTIVA' then
      raise exception 'CUENTA_PROVEEDOR_INACTIVA: la cuenta "%" no está activa', v_candidate.account_code
        using errcode = '23514';
    when 'PROVEEDOR_INCOMPATIBLE' then
      raise exception 'PROVEEDOR_INCOMPATIBLE: el método % no lo soporta la cuenta "%" (%)',
        new.collection_method, v_candidate.account_code, v_candidate.provider_kind
        using errcode = '23514';
    when 'CUENTA_PROVEEDOR_OTRO_MERCADO' then
      raise exception 'CUENTA_PROVEEDOR_OTRO_MERCADO: la cuenta "%" es del mercado % y la suscripción % se vendió en %',
        v_candidate.account_code, coalesce(v_candidate.market_code, '—'), v_sub.code, coalesce(v_sub.market_code, 'ningún mercado')
        using errcode = '23514';
    when 'MONEDA_NO_SOPORTADA_POR_CUENTA' then
      raise exception 'MONEDA_NO_SOPORTADA_POR_CUENTA: la cuenta "%" no cobra % (cobra %) y la suscripción % es en %',
        v_candidate.account_code, v_sub.currency, array_to_string(v_candidate.currencies, ', '), v_sub.code, v_sub.currency
        using errcode = '23514';
    when 'PROVEEDOR_LIVE_SIN_SECRETO' then
      raise exception 'PROVEEDOR_LIVE_SIN_SECRETO: la cuenta "%" es LIVE pero no declara la referencia de su clave secreta',
        v_candidate.account_code
        using errcode = '23514';
    else
      raise exception 'CUENTA_PROVEEDOR_NO_ENCONTRADA: %', new.provider_account_id using errcode = '23503';
  end case;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. set_subscription_collection_profile — con routing en servidor.
--
-- Se añade `p_route_provider` AL FINAL (compatibilidad posicional con V2):
--   · true  -> la cuenta la elige el servidor (route_rank 1). No se admite una
--              cuenta explícita a la vez: una discrepancia es un intento de
--              imponer la cuenta, igual que en `payment-setup`.
--   · false -> comportamiento V2: cuenta explícita o ninguna, validada por el
--              guard de elegibilidad.
-- ---------------------------------------------------------------------------
drop function if exists platform.set_subscription_collection_profile(
  uuid, platform.collection_method, uuid, boolean, boolean, boolean, integer, integer, integer,
  integer, integer, boolean, character, platform.collection_profile_status, date, text
);

create or replace function platform.set_subscription_collection_profile(
  p_subscription_id        uuid,
  p_collection_method      platform.collection_method,
  p_provider_account_id    uuid default null,
  p_auto_charge            boolean default null,
  p_requires_service_order boolean default null,
  p_requires_purchase_order boolean default null,
  p_invoice_lead_days      integer default 0,
  p_renewal_notice_days    integer default 30,
  p_payment_due_days       integer default 15,
  p_grace_period_days      integer default 10,
  p_document_lead_days     integer default 45,
  p_auto_suspend           boolean default false,
  p_currency               char(3) default null,
  p_status                 platform.collection_profile_status default 'ACTIVE',
  p_effective_from         date default current_date,
  p_notes                  text default null,
  p_route_provider         boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id       uuid;
  v_sub      record;
  v_current  record;
  v_auto     boolean;
  v_needs_so boolean;
  v_needs_po boolean;
  v_account  uuid := p_provider_account_id;
  v_route    record;
begin
  select s.*, m.code as market_code into v_sub
    from platform.subscriptions s left join platform.markets m on m.id = s.market_id
   where s.id = p_subscription_id;
  if v_sub.id is null then
    raise exception 'SUSCRIPCION_NO_ENCONTRADA: %', p_subscription_id using errcode = '23503';
  end if;

  if not (
    platform.can_manage_commercial()
    or platform.is_org_admin(v_sub.billed_organization_id)
  ) then
    raise exception 'NO_AUTORIZADO: no puede configurar la cobranza de la suscripción %', v_sub.code
      using errcode = '42501';
  end if;

  v_auto     := coalesce(p_auto_charge, p_collection_method = 'CULQI_CARD');
  v_needs_so := coalesce(p_requires_service_order, p_collection_method = 'SERVICE_ORDER');
  v_needs_po := coalesce(p_requires_purchase_order, p_collection_method = 'PURCHASE_ORDER');

  -- ---- Routing regional en servidor ---------------------------------------
  if coalesce(p_route_provider, false) then
    if p_provider_account_id is not null then
      raise exception 'CUENTA_PROVEEDOR_NO_COINCIDE: con routing del servidor la cuenta no se indica; la decide el mercado, la moneda y el método'
        using errcode = '42501';
    end if;
    -- Solo el cobro automático necesita cuenta. OS, OC, transferencia y manual no.
    if v_auto then
      select * into v_route
        from platform.provider_account_candidates(p_subscription_id, p_collection_method) c
       where c.eligible
       order by c.route_rank
       limit 1;
      if v_route.provider_account_id is null then
        raise exception 'PROVEEDOR_NO_DISPONIBLE_EN_MERCADO: no hay cuenta activa que cobre % con % en el mercado % para la suscripción %',
          v_sub.currency, p_collection_method, coalesce(v_sub.market_code, 'sin mercado'), v_sub.code
          using errcode = '23514';
      end if;
      v_account := v_route.provider_account_id;
    end if;
  end if;

  if v_auto and v_account is null then
    raise exception 'PROVEEDOR_REQUERIDO: el método % exige una cuenta de proveedor con la que cobrar', p_collection_method
      using errcode = '23502';
  end if;

  if p_auto_suspend and coalesce(p_grace_period_days, 0) < 1 then
    raise exception 'GRACIA_REQUERIDA: la suspensión automática exige al menos 1 día de gracia tras el vencimiento'
      using errcode = '23514';
  end if;

  if v_needs_so and v_needs_po then
    raise exception 'DOCUMENTOS_DUPLICADOS: exigir Orden de Servicio Y Orden de Compra a la vez requiere una configuración explícita; elige uno como método'
      using errcode = '23514';
  end if;

  select * into v_current
    from platform.subscription_collection_profiles
   where subscription_id = p_subscription_id and effective_to is null;

  if v_current.id is not null then
    if v_current.effective_from >= p_effective_from then
      raise exception 'VIGENCIA_INVALIDA: el perfil vigente empieza el % y el nuevo pretende empezar el %',
        v_current.effective_from, p_effective_from
        using errcode = '23514';
    end if;
    update platform.subscription_collection_profiles
       set effective_to = p_effective_from - 1
     where id = v_current.id;
  end if;

  insert into platform.subscription_collection_profiles (
    subscription_id, collection_method, provider_account_id, auto_charge,
    requires_service_order, requires_purchase_order,
    invoice_lead_days, renewal_notice_days, payment_due_days, grace_period_days,
    document_lead_days, auto_suspend, currency, status, effective_from, notes
  ) values (
    p_subscription_id, p_collection_method, v_account, v_auto,
    v_needs_so, v_needs_po,
    p_invoice_lead_days, p_renewal_notice_days, p_payment_due_days, p_grace_period_days,
    p_document_lead_days, p_auto_suspend, coalesce(p_currency, v_sub.currency),
    p_status, p_effective_from, p_notes
  )
  returning id into v_id;

  perform platform.log_audit(
    'COLLECTION_PROFILE_SET', 'subscription_collection_profile', v_id::text,
    v_sub.billed_organization_id, v_sub.tenant_id,
    jsonb_build_object(
      'subscription', v_sub.code,
      'method', p_collection_method,
      'provider_account_id', v_account,
      'routed_by_server', coalesce(p_route_provider, false),
      'market', v_sub.market_code,
      'currency', v_sub.currency,
      'auto_charge', v_auto,
      'auto_suspend', p_auto_suspend,
      'previous_profile_id', v_current.id,
      'previous_method', v_current.collection_method
    )
  );

  return v_id;
end;
$$;

comment on function platform.set_subscription_collection_profile is
  'Versiona el perfil de cobro. Con p_route_provider = true la cuenta la elige el servidor por '
  'mercado + moneda + método (provider_account_candidates). No registra ningún cobro.';

-- ---------------------------------------------------------------------------
-- 8. upsert_payment_provider_account — mercado y monedas explícitos.
--
-- Se retiran `p_country_code default 'PE'` y `p_currency default 'PEN'`: el
-- país sale del mercado y las monedas se declaran. Los parámetros nuevos tienen
-- default NULL solo para que la autorización hable primero; sin ellos se
-- rechaza con MERCADO_REQUERIDO / MONEDAS_REQUERIDAS.
-- ---------------------------------------------------------------------------
drop function if exists platform.upsert_payment_provider_account(
  text, text, platform.provider_kind, platform.provider_environment, uuid, character, character,
  text, text, text, text, text, platform.entity_status, jsonb, uuid
);

create or replace function platform.upsert_payment_provider_account(
  p_code                  text,
  p_name                  text,
  p_provider_kind         platform.provider_kind,
  p_environment           platform.provider_environment default 'TEST',
  p_owner_organization_id uuid default null,
  p_market_code           text default null,
  p_currencies            char(3)[] default null,
  p_public_key            text default null,
  p_secret_key_ref        text default null,
  p_rsa_public_key_ref    text default null,
  p_rsa_id_ref            text default null,
  p_webhook_endpoint      text default null,
  p_status                platform.entity_status default 'ACTIVE',
  p_metadata              jsonb default '{}'::jsonb,
  p_routing_priority      integer default 100,
  p_id                    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id         uuid;
  v_is_new     boolean := p_id is null;
  v_market     platform.markets;
  v_currencies char(3)[];
  v_primary    char(3);
  v_old        record;
  v_c          char(3);
begin
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin configuran cuentas de cobro'
      using errcode = '42501';
  end if;

  if not platform.is_slug(lower(trim(coalesce(p_code, '')))) then
    raise exception 'CODIGO_INVALIDO: "%" debe ser kebab-case en minúsculas (ej. culqi-pe-test)', p_code
      using errcode = '23514';
  end if;

  if coalesce(p_secret_key_ref, '') ~* '^(sk|pk)_(test|live)_' then
    raise exception 'SECRETO_EN_BASE: "secret_key_ref" es el NOMBRE de la variable del servidor (ej. CULQI_SECRET_KEY), no la clave. Una clave real no se guarda nunca en la base'
      using errcode = '42501';
  end if;

  v_market := platform.require_active_market(p_market_code);

  select array_agg(distinct upper(trim(c))) into v_currencies
    from unnest(coalesce(p_currencies, array[]::char(3)[])) c
   where nullif(trim(c), '') is not null;
  if v_currencies is null then
    raise exception 'MONEDAS_REQUERIDAS: una cuenta de cobro declara qué monedas cobra en el mercado %', v_market.code
      using errcode = '23502';
  end if;

  foreach v_c in array v_currencies loop
    perform platform.resolve_market_currency(v_market.id, v_c);
  end loop;

  v_primary := case when v_market.default_currency_code = any (v_currencies)
                    then v_market.default_currency_code
                    else (select min(c) from unnest(v_currencies) c) end;

  if v_is_new then
    insert into platform.payment_provider_accounts (
      code, name, provider_kind, environment, owner_organization_id, market_id, country_code, currency,
      public_key, secret_key_ref, rsa_public_key_ref, rsa_id_ref, webhook_endpoint, status, metadata,
      routing_priority
    ) values (
      lower(trim(p_code)), trim(p_name), p_provider_kind, p_environment, p_owner_organization_id,
      v_market.id, v_market.country_code, v_primary, p_public_key, p_secret_key_ref, p_rsa_public_key_ref,
      p_rsa_id_ref, p_webhook_endpoint, p_status, coalesce(p_metadata, '{}'::jsonb),
      coalesce(p_routing_priority, 100)
    )
    returning id into v_id;
  else
    select * into v_old from platform.payment_provider_accounts where id = p_id;
    if v_old.id is null then
      raise exception 'CUENTA_NO_ENCONTRADA: %', p_id using errcode = '23503';
    end if;
    -- Mover de mercado una cuenta que cobra contratos vigentes los dejaría
    -- cobrándose desde otro país sin que nadie lo decida contrato a contrato.
    if v_old.market_id is distinct from v_market.id and exists (
      select 1 from platform.subscription_collection_profiles p
       where p.provider_account_id = p_id and p.effective_to is null
    ) then
      raise exception 'CUENTA_EN_USO: la cuenta "%" cobra suscripciones vigentes; no cambia de mercado', v_old.code
        using errcode = '23514';
    end if;

    update platform.payment_provider_accounts
       set code = lower(trim(p_code)), name = trim(p_name), provider_kind = p_provider_kind,
           environment = p_environment, owner_organization_id = p_owner_organization_id,
           market_id = v_market.id, country_code = v_market.country_code, currency = v_primary,
           public_key = p_public_key, secret_key_ref = p_secret_key_ref,
           rsa_public_key_ref = p_rsa_public_key_ref, rsa_id_ref = p_rsa_id_ref,
           webhook_endpoint = p_webhook_endpoint, status = p_status,
           metadata = coalesce(p_metadata, '{}'::jsonb),
           routing_priority = coalesce(p_routing_priority, routing_priority)
     where id = p_id
    returning id into v_id;
  end if;

  insert into platform.payment_provider_account_currencies (provider_account_id, currency_code, status)
  select v_id, c, 'ACTIVE' from unnest(v_currencies) c
  on conflict (provider_account_id, currency_code) do update set status = 'ACTIVE';

  update platform.payment_provider_account_currencies
     set status = 'INACTIVE'
   where provider_account_id = v_id and currency_code <> all (v_currencies) and status = 'ACTIVE';

  perform platform.log_audit(
    case when v_is_new then 'PROVIDER_ACCOUNT_CREATED' else 'PROVIDER_ACCOUNT_UPDATED' end,
    'payment_provider_account', v_id::text, p_owner_organization_id, null,
    jsonb_build_object(
      'code', p_code, 'provider_kind', p_provider_kind, 'environment', p_environment,
      'market', v_market.code, 'currencies', to_jsonb(v_currencies),
      -- V2 auditaba 'has_secret_ref' y el guard anti-secretos de audit_logs
      -- rechaza toda clave que contenga «secret»: la RPC nunca completaba un alta.
      'routing_priority', p_routing_priority, 'server_credential_configured', p_secret_key_ref is not null
    )
  );

  return v_id;
end;
$$;

comment on function platform.upsert_payment_provider_account is
  'Cuenta de cobro de un mercado con sus monedas. Sin país/moneda por defecto. No guarda secretos.';

-- ---------------------------------------------------------------------------
-- 9. Vista de rutas para la UI de administración.
-- ---------------------------------------------------------------------------
create or replace view platform.v_provider_account_routes
with (security_invoker = true) as
select
  a.id                    as provider_account_id,
  a.code,
  a.name,
  a.provider_kind,
  a.environment,
  a.status,
  a.owner_organization_id,
  a.market_id,
  m.code                  as market_code,
  m.name                  as market_name,
  a.country_code,
  a.currency              as primary_currency,
  (select array_agg(c.currency_code::text order by c.currency_code)
     from platform.payment_provider_account_currencies c
    where c.provider_account_id = a.id and c.status = 'ACTIVE') as currencies,
  (select array_agg(x.method::text order by x.method::text)
     from unnest(enum_range(null::platform.collection_method)) as x (method)
    where platform.provider_kind_supports_method(a.provider_kind, x.method)) as supported_methods,
  a.routing_priority,
  (a.environment = 'LIVE') as is_live
from platform.payment_provider_accounts a
left join platform.markets m on m.id = a.market_id;

comment on view platform.v_provider_account_routes is
  'Cuentas de cobro con mercado, monedas y métodos soportados. Sin secretos.';

grant select on platform.v_provider_account_routes to authenticated, service_role;
revoke all on platform.v_provider_account_routes from anon, public;

-- ---------------------------------------------------------------------------
-- 10. GRANTS
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
         'provider_kind_supports_method', 'enforce_provider_account_market',
         'sync_provider_account_primary_currency', 'enforce_provider_account_currency',
         'provider_account_candidates', 'enforce_collection_profile_scope',
         'set_subscription_collection_profile', 'upsert_payment_provider_account'
       )
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;
