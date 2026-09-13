-- ============================================================================
-- EBIM Control Plane V3 — 25 · Sociedades regionales
-- ----------------------------------------------------------------------------
-- Fase 03 de `.claude-prompts-v3-multicurrency`. Cierra G-03.
--
-- EBIM opera en Perú, Bolivia y Ecuador como UNA organización (la única de tipo
-- PLATFORM) con TRES sociedades. No se crean tres organizaciones: el modelo del
-- contrato §3.1 (Modelo A) ya es «una cuenta, N sociedades multipaís», y partir
-- EBIM en tres cuentas rompería `organizations_single_platform_uk` y la
-- gobernanza del super admin único.
--
-- Lo que faltaba es que la sociedad sepa en qué MERCADO opera y que país y
-- moneda sean coherentes con él: una sociedad BO en PEN es un error de datos.
-- ============================================================================

alter table platform.companies
  add column market_id uuid references platform.markets (id) on delete restrict;

create index companies_market_ix on platform.companies (market_id);

comment on column platform.companies.market_id is
  'Mercado en el que opera la sociedad. NULL = sociedad fuera de los mercados '
  'comerciales de EBIM (p. ej. Colombia o Chile en el seed). Si no es NULL, '
  'country_code coincide con el del mercado y currency está admitida por él.';

-- ---------------------------------------------------------------------------
-- Coherencia sociedad ↔ mercado.
--
-- Si no se indica mercado y el país tiene EXACTAMENTE un mercado activo, se
-- asigna: no hay ambigüedad que resolver. Si hay varios o ninguno, se deja
-- NULL y la sociedad queda fuera del modelo regional, sin inventar nada.
-- ---------------------------------------------------------------------------
create or replace function platform.enforce_company_market()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_market     record;
  v_candidates integer;
begin
  if new.market_id is null then
    select count(*) into v_candidates
      from platform.markets m where m.country_code = new.country_code and m.status = 'ACTIVE';
    if v_candidates = 1 then
      select m.id into new.market_id
        from platform.markets m where m.country_code = new.country_code and m.status = 'ACTIVE';
    else
      return new;
    end if;
  end if;

  select * into v_market from platform.markets where id = new.market_id;

  if v_market.country_code <> new.country_code then
    raise exception 'MERCADO_PAIS_INCOHERENTE: la sociedad "%" declara país % y el mercado % es de %',
      new.name, new.country_code, v_market.code, v_market.country_code
      using errcode = '23514';
  end if;

  -- Solo se valida la moneda cuando cambia algo que la afecta: una sociedad
  -- histórica no se vuelve inválida porque el mercado retire una moneda.
  if tg_op = 'INSERT'
     or new.currency is distinct from old.currency
     or new.market_id is distinct from old.market_id then
    if not platform.is_currency_allowed_in_market(new.market_id, new.currency) then
      raise exception 'MONEDA_NO_PERMITIDA_EN_MERCADO: % no está admitida en el mercado % (sociedad "%")',
        new.currency, v_market.code, new.name
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger companies_market_guard
  before insert or update of market_id, country_code, currency on platform.companies
  for each row execute function platform.enforce_company_market();

-- ---------------------------------------------------------------------------
-- Backfill: sociedades existentes cuyo país tiene un único mercado activo y
-- cuya moneda ese mercado admite. El resto queda NULL (fuera del modelo).
-- Se usa un UPDATE de `market_id` para que el guard valide cada fila.
-- ---------------------------------------------------------------------------
update platform.companies c
   set market_id = m.id
  from platform.markets m
 where c.market_id is null
   and m.country_code = c.country_code
   and m.status = 'ACTIVE'
   and (select count(*) from platform.markets m2
         where m2.country_code = c.country_code and m2.status = 'ACTIVE') = 1
   and platform.is_currency_allowed_in_market(m.id, c.currency);

-- ---------------------------------------------------------------------------
-- upsert_company — sin defaults PE/PEN.
--
-- La firma V2 tenía `p_country_code default 'PE'` y `p_currency default 'PEN'`:
-- una sociedad de Ecuador creada sin esos dos parámetros nacía peruana. Ahora:
--   · con mercado  -> país del mercado; moneda = la indicada o la sugerida;
--   · sin mercado  -> país y moneda OBLIGATORIOS y explícitos.
-- ---------------------------------------------------------------------------
drop function if exists platform.upsert_company(uuid, text, character, character, text, text, boolean, platform.entity_status, uuid);

create or replace function platform.upsert_company(
  p_organization_id uuid,
  p_name            text,
  p_market_code     text default null,
  p_country_code    char(2) default null,
  p_currency        char(3) default null,
  p_tax_id          text default null,
  p_erp_code        text default null,
  p_is_default      boolean default false,
  p_status          platform.entity_status default 'ACTIVE',
  p_id              uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id       uuid;
  v_is_new   boolean := p_id is null;
  v_market   record;
  v_market_id   uuid;
  v_market_code text;
  v_country  char(2);
  v_currency char(3);
begin
  if not (platform.can_manage_platform_entities() or platform.is_org_admin(p_organization_id)) then
    raise exception 'NO_AUTORIZADO: no administra esta organización' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then
    raise exception 'NOMBRE_REQUERIDO: la sociedad necesita nombre' using errcode = '23502';
  end if;

  if nullif(trim(coalesce(p_market_code, '')), '') is not null then
    select * into v_market from platform.markets where code = upper(trim(p_market_code));
    if v_market.id is null then
      raise exception 'MERCADO_NO_ENCONTRADO: "%"', p_market_code using errcode = '23503';
    end if;
    if p_country_code is not null and upper(p_country_code) <> v_market.country_code then
      raise exception 'MERCADO_PAIS_INCOHERENTE: el mercado % es de % y se indicó %',
        v_market.code, v_market.country_code, p_country_code
        using errcode = '23514';
    end if;
    v_market_id   := v_market.id;
    v_market_code := v_market.code;
    v_country  := v_market.country_code;
    v_currency := upper(coalesce(p_currency, v_market.default_currency_code));
  else
    if p_country_code is null or p_currency is null then
      raise exception 'PAIS_Y_MONEDA_REQUERIDOS: una sociedad sin mercado exige país y moneda explícitos'
        using errcode = '23502';
    end if;
    v_country  := upper(p_country_code);
    v_currency := upper(p_currency);
  end if;

  if not platform.is_currency_active(v_currency) and v_is_new then
    raise exception 'MONEDA_INACTIVA: % no existe o está inactiva', v_currency using errcode = '23514';
  end if;

  if v_is_new then
    insert into platform.companies (
      organization_id, name, market_id, country_code, currency, tax_id, erp_code, is_default, status
    ) values (
      p_organization_id, trim(p_name), v_market_id, v_country, v_currency, p_tax_id, p_erp_code,
      coalesce(p_is_default, false), p_status
    )
    returning id into v_id;
  else
    update platform.companies
       set name = trim(p_name), market_id = v_market_id, country_code = v_country,
           currency = v_currency, tax_id = p_tax_id, erp_code = p_erp_code,
           is_default = coalesce(p_is_default, false), status = p_status
     where id = p_id and organization_id = p_organization_id
    returning id into v_id;
    if v_id is null then
      raise exception 'SOCIEDAD_NO_ENCONTRADA: % en la organización %', p_id, p_organization_id
        using errcode = '23503';
    end if;
  end if;

  perform platform.log_audit(
    case when v_is_new then 'COMPANY_CREATED' else 'COMPANY_UPDATED' end,
    'company', v_id::text, p_organization_id, null,
    jsonb_build_object('name', p_name, 'market', v_market_code, 'country', v_country,
                       'currency', v_currency, 'status', p_status)
  );

  return v_id;
end;
$$;

comment on function platform.upsert_company is
  'Sociedad de una organización. Con mercado, el país sale del mercado y la moneda debe '
  'estar admitida. Sin mercado, país y moneda son obligatorios: no hay defaults PE/PEN.';

-- ---------------------------------------------------------------------------
-- Vista de sociedades con su mercado, para la UI.
-- ---------------------------------------------------------------------------
create or replace view platform.v_company_markets
with (security_invoker = true) as
select
  c.id                      as company_id,
  c.organization_id,
  o.display_name            as organization_name,
  o.kind                    as organization_kind,
  c.name,
  c.country_code,
  c.currency,
  c.is_default,
  c.status,
  c.market_id,
  m.code                    as market_code,
  m.name                    as market_name,
  m.default_currency_code   as market_default_currency,
  (c.market_id is not null) as in_regional_model
from platform.companies c
join platform.organizations o on o.id = c.organization_id
left join platform.markets m on m.id = c.market_id;

comment on view platform.v_company_markets is
  'Sociedades con su mercado. in_regional_model = false para sociedades fuera de PE/BO/EC.';

grant select on platform.v_company_markets to authenticated, service_role;
revoke all on platform.v_company_markets from anon, public;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'platform'
       and p.proname in ('enforce_company_market', 'upsert_company')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;
