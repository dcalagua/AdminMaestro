-- ============================================================================
-- EBIM Control Plane V3 — 30 · Moneda de reporte
-- ----------------------------------------------------------------------------
-- Fase 09 de `.claude-prompts-v3-multicurrency`. Cierra G-18.
--
-- La moneda de REPORTE es una lente gerencial, no una moneda de negocio. Cada
-- operación conserva su moneda nativa; el tablero puede mostrar ADEMÁS un
-- equivalente en la moneda de reporte con la tasa usada y su fecha.
--
-- Contrato de respuesta de todo helper de reporting:
--   native_amount / native_currency         -> el hecho, intacto
--   reporting_amount / reporting_currency   -> el equivalente (NULL si no hay tasa)
--   conversion_status                       -> SAME_CURRENCY | CONVERTED | MISSING_FX
--                                              | NO_REPORTING_CURRENCY
--   fx_*                                    -> tasa, método, fecha, id, si es DEMO
-- Una conversión que falta NUNCA es 0.
--
-- La moneda inicial (USD) es CONFIGURACIÓN: se siembra aquí como fila del
-- singleton y se cambia con `set_reporting_settings`. Ninguna función asume USD.
-- ============================================================================

create table platform.control_plane_settings (
  id                      boolean primary key default true,
  reporting_currency_code char(3) not null references platform.currencies (code) on delete restrict,
  -- Tolerancia de antigüedad de una tasa MANUAL para reporting. 31 días admite
  -- una tasa gerencial mensual; la fecha de la tasa usada se muestra siempre.
  fx_max_rate_age_days    integer not null default 31,
  updated_by              uuid references platform.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint control_plane_settings_singleton_ck check (id),
  constraint control_plane_settings_fx_age_ck check (fx_max_rate_age_days between 0 and 366)
);

create index control_plane_settings_currency_ix on platform.control_plane_settings (reporting_currency_code);
create index control_plane_settings_updated_by_ix on platform.control_plane_settings (updated_by);

create trigger control_plane_settings_set_updated_at before update on platform.control_plane_settings
  for each row execute function platform.set_updated_at();

comment on table platform.control_plane_settings is
  'Configuración global del Control Plane (una fila). reporting_currency_code = moneda de la '
  'lente consolidada; no cambia ningún documento.';

insert into platform.control_plane_settings (id, reporting_currency_code, fx_max_rate_age_days)
values (true, 'USD', 31)
on conflict (id) do nothing;

alter table platform.control_plane_settings enable row level security;
alter table platform.control_plane_settings force row level security;

grant select on platform.control_plane_settings to authenticated;
revoke insert, update, delete on platform.control_plane_settings from authenticated;
revoke all on platform.control_plane_settings from anon, public;
grant all on platform.control_plane_settings to service_role;

-- Leer qué moneda usa el consolidado no revela nada; cambiarla, solo por RPC.
create policy control_plane_settings_select on platform.control_plane_settings
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Lectura de la configuración
-- ---------------------------------------------------------------------------
create or replace function platform.reporting_settings()
returns table (reporting_currency char(3), fx_max_rate_age_days integer)
language sql
stable
security invoker
set search_path = platform, pg_catalog
as $$
  select s.reporting_currency_code, s.fx_max_rate_age_days
    from platform.control_plane_settings s
   where s.id;
$$;

-- ---------------------------------------------------------------------------
-- set_reporting_settings — solo EBIM autorizado (finanzas o super admin).
-- ---------------------------------------------------------------------------
create or replace function platform.set_reporting_settings(
  p_reporting_currency   char(3),
  p_fx_max_rate_age_days integer default null
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_currency char(3) := upper(trim(coalesce(p_reporting_currency, '')));
  v_old      platform.control_plane_settings;
begin
  if not platform.can_manage_regional_catalog() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin cambian la moneda de reporte'
      using errcode = '42501';
  end if;
  if not platform.is_currency_active(v_currency) then
    raise exception 'MONEDA_INACTIVA: "%" no existe o está inactiva; la moneda de reporte debe ser una moneda activa del catálogo', p_reporting_currency
      using errcode = '23514';
  end if;
  if p_fx_max_rate_age_days is not null and p_fx_max_rate_age_days not between 0 and 366 then
    raise exception 'ANTIGUEDAD_INVALIDA: la tolerancia de antigüedad de la tasa debe estar entre 0 y 366 días'
      using errcode = '23514';
  end if;

  select * into v_old from platform.control_plane_settings where id;

  insert into platform.control_plane_settings (id, reporting_currency_code, fx_max_rate_age_days, updated_by)
  values (true, v_currency, coalesce(p_fx_max_rate_age_days, v_old.fx_max_rate_age_days, 31), auth.uid())
  on conflict (id) do update
    set reporting_currency_code = excluded.reporting_currency_code,
        fx_max_rate_age_days = excluded.fx_max_rate_age_days,
        updated_by = excluded.updated_by;

  perform platform.log_audit(
    'REPORTING_SETTINGS_CHANGED', 'control_plane_settings', 'singleton', null, null,
    jsonb_build_object('from_currency', v_old.reporting_currency_code, 'to_currency', v_currency,
                       'from_fx_max_age_days', v_old.fx_max_rate_age_days,
                       'to_fx_max_age_days', coalesce(p_fx_max_rate_age_days, v_old.fx_max_rate_age_days, 31))
  );
end;
$$;

comment on function platform.set_reporting_settings(char, integer) is
  'Cambia la moneda de reporte (activa) y la tolerancia de antigüedad FX. Solo EBIM_FINANCE / super admin.';

-- ---------------------------------------------------------------------------
-- to_reporting_amount — el helper de todo reporting.
--
-- Recibe fecha y (opcionalmente) moneda de reporte y tolerancia; si no se
-- indican, usa la configuración. SECURITY INVOKER: sin permiso para leer tasas
-- el resultado es MISSING_FX, no un número.
-- ---------------------------------------------------------------------------
create or replace function platform.to_reporting_amount(
  p_amount             numeric,
  p_currency           char(3),
  p_as_of              date,
  p_reporting_currency char(3) default null,
  p_max_age_days       integer default null
)
returns table (
  native_amount      numeric,
  native_currency    char(3),
  reporting_amount   numeric,
  reporting_currency char(3),
  conversion_status  text,
  fx_method          text,
  fx_rate            numeric,
  fx_rate_date       date,
  fx_rate_id         uuid,
  fx_is_demo         boolean
)
language sql
stable
security invoker
set search_path = platform, pg_catalog
as $$
  with cfg as (
    select coalesce(upper(p_reporting_currency), (select s.reporting_currency from platform.reporting_settings() s)) as rc,
           coalesce(p_max_age_days, (select s.fx_max_rate_age_days from platform.reporting_settings() s), 0) as age
  )
  select
    p_amount,
    upper(p_currency)::char(3),
    case when cfg.rc is null then null else c.amount end,
    cfg.rc::char(3),
    case
      when cfg.rc is null then 'NO_REPORTING_CURRENCY'
      when c.status = 'IDENTITY' then 'SAME_CURRENCY'
      when c.status in ('DIRECT', 'RECIPROCAL') then 'CONVERTED'
      else 'MISSING_FX'
    end,
    case when cfg.rc is null then null else c.status end,
    c.rate, c.rate_date, c.rate_id, c.is_demo
  from cfg
  left join lateral platform.fx_convert(p_amount, p_currency, cfg.rc::char(3), p_as_of, cfg.age) c on cfg.rc is not null;
$$;

comment on function platform.to_reporting_amount(numeric, char, date, char, integer) is
  'native_* intacto + reporting_* (NULL si falta tasa) + conversion_status. Nunca convierte a 0.';

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
       and p.proname in ('reporting_settings', 'set_reporting_settings', 'to_reporting_amount')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;
