-- ============================================================================
-- EBIM Control Plane V3 — 29 · Motor FX para reporting
-- ----------------------------------------------------------------------------
-- Fase 08 de `.claude-prompts-v3-multicurrency`. Cierra G-17.
--
-- QUÉ ES: tipos de cambio AUDITABLES para mostrar equivalentes gerenciales.
-- QUÉ NO ES: una herramienta para reescribir documentos. Ninguna factura, pago
-- ni comisión cambia de moneda ni de importe por un tipo de cambio. PEN 5000
-- sigue siendo PEN 5000; el tablero puede decir además «≈ USD 1 333,33 al TC
-- MANUAL del 2026-09-13».
--
-- SEMÁNTICA DE UNA TASA: 1 base_currency = rate quote_currency.
--   (USD, PEN, 3.75)  =>  1 USD = 3.75 PEN
--
-- REGLAS DE BÚSQUEDA (fx_rate_lookup), deterministas y documentadas (DV3-012):
--   1. misma moneda                 -> IDENTITY, tasa 1, sin fila.
--   2. tasa DIRECTA base->quote     -> la más reciente ACTIVA con
--                                      rate_date ∈ [as_of - max_age, as_of].
--   3. si no hay directa, RECÍPROCA -> 1 / (tasa quote->base) con la misma regla.
--   4. si tampoco                   -> MISSING. Nunca se inventa, nunca se usa
--                                      una tasa futura, nunca se triangula
--                                      (PEN->USD->BOB) de forma implícita.
--   `p_max_age_days` por defecto 0 = SOLO la fecha exacta. Quien tolera una tasa
--   de días anteriores lo declara (la moneda de reporte lo toma de su setting).
--
-- FUENTE: solo MANUAL en V3. Sin BCRP / BCB / BCE ni APIs externas.
-- ============================================================================

create type platform.fx_rate_source as enum ('MANUAL');
create type platform.fx_rate_status as enum ('ACTIVE', 'SUPERSEDED', 'VOIDED');

create table platform.exchange_rates (
  id              uuid primary key default gen_random_uuid(),
  rate_date       date not null,
  base_currency   char(3) not null references platform.currencies (code) on delete restrict,
  quote_currency  char(3) not null references platform.currencies (code) on delete restrict,
  rate            numeric(20,10) not null,
  source          platform.fx_rate_source not null default 'MANUAL',
  status          platform.fx_rate_status not null default 'ACTIVE',
  -- Una tasa de demostración no es una cotización: la UI la rotula como tal.
  is_demo         boolean not null default false,
  notes           text,
  created_by      uuid references platform.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  status_changed_by uuid references platform.profiles (id) on delete set null,
  status_changed_at timestamptz,
  status_reason   text,
  superseded_by   uuid references platform.exchange_rates (id) on delete restrict,
  updated_at      timestamptz not null default now(),
  constraint exchange_rates_pair_ck check (base_currency <> quote_currency),
  constraint exchange_rates_rate_ck check (rate > 0),
  constraint exchange_rates_status_reason_ck check (status = 'ACTIVE' or status_reason is not null)
);

-- Una sola tasa ACTIVA por fecha, par y fuente. Las sustituidas y anuladas se conservan.
create unique index exchange_rates_active_uk
  on platform.exchange_rates (rate_date, base_currency, quote_currency, source)
  where status = 'ACTIVE';

create index exchange_rates_lookup_ix
  on platform.exchange_rates (base_currency, quote_currency, rate_date desc)
  where status = 'ACTIVE';
create index exchange_rates_base_ix on platform.exchange_rates (base_currency);
create index exchange_rates_quote_ix on platform.exchange_rates (quote_currency);
create index exchange_rates_created_by_ix on platform.exchange_rates (created_by);
create index exchange_rates_status_changed_by_ix on platform.exchange_rates (status_changed_by);
create index exchange_rates_superseded_by_ix on platform.exchange_rates (superseded_by);

create trigger exchange_rates_set_updated_at before update on platform.exchange_rates
  for each row execute function platform.set_updated_at();

comment on table platform.exchange_rates is
  'Tipos de cambio para REPORTING. 1 base = rate quote. Nunca alteran documentos. Una tasa no '
  'se edita: se sustituye (SUPERSEDED) o se anula (VOIDED) con motivo, y la historia queda.';
comment on column platform.exchange_rates.is_demo is
  'true = valor de demostración (seed local). No es una cotización real y se rotula DEMO.';

-- ---------------------------------------------------------------------------
-- Inmutabilidad: solo el estado avanza (ACTIVE -> SUPERSEDED | VOIDED).
-- ---------------------------------------------------------------------------
create or replace function platform.enforce_exchange_rate_immutability()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if new.rate_date is distinct from old.rate_date
     or new.base_currency is distinct from old.base_currency
     or new.quote_currency is distinct from old.quote_currency
     or new.rate is distinct from old.rate
     or new.source is distinct from old.source
     or new.is_demo is distinct from old.is_demo
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'TIPO_CAMBIO_INMUTABLE: una tasa no se edita; publica otra para esa fecha (sustituye a la anterior) o anúlala con motivo'
      using errcode = '23514';
  end if;

  if old.status <> 'ACTIVE' and new.status is distinct from old.status then
    raise exception 'TIPO_CAMBIO_CERRADO: la tasa % ya está %; su estado no vuelve atrás', old.id, old.status
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger exchange_rates_immutability_guard
  before update on platform.exchange_rates
  for each row execute function platform.enforce_exchange_rate_immutability();

-- ---------------------------------------------------------------------------
-- RLS: lectura EBIM (plataforma o finanzas); escritura solo por RPC.
-- ---------------------------------------------------------------------------
alter table platform.exchange_rates enable row level security;
alter table platform.exchange_rates force row level security;

grant select on platform.exchange_rates to authenticated;
revoke insert, update, delete on platform.exchange_rates from authenticated;
revoke all on platform.exchange_rates from anon, public;
grant all on platform.exchange_rates to service_role;

create policy exchange_rates_select on platform.exchange_rates
  for select to authenticated
  using (platform.is_platform_admin() or platform.can_read_finance());

-- ---------------------------------------------------------------------------
-- Búsqueda de tasa. SECURITY INVOKER: quien no puede leer tasas obtiene MISSING,
-- no una conversión.
-- ---------------------------------------------------------------------------
create or replace function platform.fx_rate_lookup(
  p_base         char(3),
  p_quote        char(3),
  p_as_of        date,
  p_max_age_days integer default 0
)
returns table (
  status      text,       -- IDENTITY | DIRECT | RECIPROCAL | MISSING
  rate        numeric,    -- 1 p_base = rate p_quote (NULL si MISSING)
  rate_id     uuid,
  rate_date   date,
  source      platform.fx_rate_source,
  is_demo     boolean
)
language plpgsql
stable
security invoker
set search_path = platform, pg_catalog
as $$
declare
  v_base  char(3) := upper(p_base);
  v_quote char(3) := upper(p_quote);
  v_age   integer := greatest(coalesce(p_max_age_days, 0), 0);
  v_row   platform.exchange_rates;
begin
  if p_as_of is null or v_base is null or v_quote is null then
    return query select 'MISSING'::text, null::numeric, null::uuid, null::date,
                        null::platform.fx_rate_source, null::boolean;
    return;
  end if;

  if v_base = v_quote then
    return query select 'IDENTITY'::text, 1::numeric, null::uuid, p_as_of,
                        null::platform.fx_rate_source, false;
    return;
  end if;

  -- Directa: la más reciente dentro de la ventana; desempate determinista por id.
  select * into v_row
    from platform.exchange_rates er
   where er.base_currency = v_base and er.quote_currency = v_quote
     and er.status = 'ACTIVE'
     and er.rate_date <= p_as_of and er.rate_date >= p_as_of - v_age
   order by er.rate_date desc, er.source, er.id
   limit 1;
  if v_row.id is not null then
    return query select 'DIRECT'::text, v_row.rate, v_row.id, v_row.rate_date, v_row.source, v_row.is_demo;
    return;
  end if;

  -- Recíproca de la tasa inversa, con la misma ventana.
  select * into v_row
    from platform.exchange_rates er
   where er.base_currency = v_quote and er.quote_currency = v_base
     and er.status = 'ACTIVE'
     and er.rate_date <= p_as_of and er.rate_date >= p_as_of - v_age
   order by er.rate_date desc, er.source, er.id
   limit 1;
  if v_row.id is not null then
    return query select 'RECIPROCAL'::text, round(1 / v_row.rate, 10), v_row.id, v_row.rate_date,
                        v_row.source, v_row.is_demo;
    return;
  end if;

  return query select 'MISSING'::text, null::numeric, null::uuid, null::date,
                      null::platform.fx_rate_source, null::boolean;
end;
$$;

comment on function platform.fx_rate_lookup(char, char, date, integer) is
  'Tasa aplicable: IDENTITY, DIRECT (preferida), RECIPROCAL (1/inversa) o MISSING. Solo tasas '
  'ACTIVE con fecha en [as_of - max_age_days, as_of]; max_age_days 0 = fecha exacta. Sin '
  'triangulación ni tasas futuras.';

-- Conversión explícita de un importe. Redondea a los decimales ISO de la moneda
-- destino. Con MISSING devuelve importe NULL: nunca 0.
create or replace function platform.fx_convert(
  p_amount       numeric,
  p_from         char(3),
  p_to           char(3),
  p_as_of        date,
  p_max_age_days integer default 0
)
returns table (
  status        text,
  amount        numeric,
  rate          numeric,
  rate_id       uuid,
  rate_date     date,
  is_demo       boolean
)
language sql
stable
security invoker
set search_path = platform, pg_catalog
as $$
  select
    l.status,
    case when l.rate is null or p_amount is null then null
         else round(p_amount * l.rate, coalesce((select c.decimals from platform.currencies c where c.code = upper(p_to)), 2))
    end,
    l.rate, l.rate_id, l.rate_date, l.is_demo
  from platform.fx_rate_lookup(p_from, p_to, p_as_of, p_max_age_days) l;
$$;

comment on function platform.fx_convert(numeric, char, char, date, integer) is
  'Equivalente de reporting de un importe. No escribe nada. MISSING => amount NULL.';

-- ---------------------------------------------------------------------------
-- RPCs de mantenimiento (EBIM_FINANCE o super admin: can_manage_regional_catalog)
-- ---------------------------------------------------------------------------
create or replace function platform.set_exchange_rate(
  p_rate_date date,
  p_base      char(3),
  p_quote     char(3),
  p_rate      numeric,
  p_notes     text default null,
  p_is_demo   boolean default false,
  p_source    platform.fx_rate_source default 'MANUAL'
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_base    char(3) := upper(trim(coalesce(p_base, '')));
  v_quote   char(3) := upper(trim(coalesce(p_quote, '')));
  v_current platform.exchange_rates;
  v_id      uuid;
begin
  if not platform.can_manage_regional_catalog() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin publican tipos de cambio'
      using errcode = '42501';
  end if;
  if p_rate_date is null then
    raise exception 'FECHA_REQUERIDA: una tasa se publica para una fecha' using errcode = '23502';
  end if;
  if v_base = v_quote then
    raise exception 'PAR_INVALIDO: la moneda base y la cotizada deben ser distintas (%)', v_base
      using errcode = '23514';
  end if;
  if p_rate is null or p_rate <= 0 then
    raise exception 'TASA_INVALIDA: el tipo de cambio debe ser mayor que 0 (se recibió %)', p_rate
      using errcode = '23514';
  end if;
  if not platform.is_currency_active(v_base) or not platform.is_currency_active(v_quote) then
    raise exception 'MONEDA_INACTIVA: % o % no existe o está inactiva', v_base, v_quote
      using errcode = '23514';
  end if;

  select * into v_current
    from platform.exchange_rates
   where rate_date = p_rate_date and base_currency = v_base and quote_currency = v_quote
     and source = p_source and status = 'ACTIVE';

  if v_current.id is not null and v_current.rate = p_rate and v_current.is_demo = coalesce(p_is_demo, false) then
    return v_current.id;  -- mismo valor: no se genera historia vacía
  end if;

  if v_current.id is not null then
    update platform.exchange_rates
       set status = 'SUPERSEDED', status_changed_by = auth.uid(), status_changed_at = now(),
           status_reason = 'Sustituida por una nueva publicación para la misma fecha'
     where id = v_current.id;
  end if;

  insert into platform.exchange_rates (
    rate_date, base_currency, quote_currency, rate, source, is_demo, notes, created_by
  ) values (
    p_rate_date, v_base, v_quote, p_rate, p_source, coalesce(p_is_demo, false), p_notes, auth.uid()
  )
  returning id into v_id;

  if v_current.id is not null then
    update platform.exchange_rates set superseded_by = v_id where id = v_current.id;
  end if;

  perform platform.log_audit(
    case when v_current.id is null then 'FX_RATE_PUBLISHED' else 'FX_RATE_REPLACED' end,
    'exchange_rate', v_id::text, null, null,
    jsonb_build_object('rate_date', p_rate_date, 'base', v_base, 'quote', v_quote, 'rate', p_rate,
                       'source', p_source, 'is_demo', coalesce(p_is_demo, false),
                       'replaced_rate_id', v_current.id, 'replaced_value', v_current.rate)
  );

  return v_id;
end;
$$;

comment on function platform.set_exchange_rate is
  'Publica 1 base = rate quote para una fecha. Si ya había una ACTIVE, queda SUPERSEDED (no se edita).';

create or replace function platform.void_exchange_rate(
  p_rate_id uuid,
  p_reason  text
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_rate platform.exchange_rates;
begin
  if not platform.can_manage_regional_catalog() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin anulan tipos de cambio'
      using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: anular una tasa exige un motivo auditable' using errcode = '23502';
  end if;

  select * into v_rate from platform.exchange_rates where id = p_rate_id;
  if v_rate.id is null then
    raise exception 'TIPO_CAMBIO_NO_ENCONTRADO: %', p_rate_id using errcode = '23503';
  end if;
  if v_rate.status <> 'ACTIVE' then
    raise exception 'TIPO_CAMBIO_CERRADO: la tasa ya está %', v_rate.status using errcode = '23514';
  end if;

  update platform.exchange_rates
     set status = 'VOIDED', status_changed_by = auth.uid(), status_changed_at = now(),
         status_reason = trim(p_reason)
   where id = p_rate_id;

  perform platform.log_audit(
    'FX_RATE_VOIDED', 'exchange_rate', p_rate_id::text, null, null,
    jsonb_build_object('rate_date', v_rate.rate_date, 'base', v_rate.base_currency,
                       'quote', v_rate.quote_currency, 'rate', v_rate.rate, 'reason', p_reason)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- GRANTS
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
         'enforce_exchange_rate_immutability', 'fx_rate_lookup', 'fx_convert',
         'set_exchange_rate', 'void_exchange_rate'
       )
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;
