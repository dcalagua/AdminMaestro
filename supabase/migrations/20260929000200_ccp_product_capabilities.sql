-- ============================================================================
-- EBIM Commercial Control Plane · Fase 07 · registro de capacidades (MA-11)
-- ----------------------------------------------------------------------------
-- Spec §3.3 (product_capabilities, capability_aliases), §4 (reglas), §14.
-- Plan §4 fila 4. Test: supabase/tests/29_ccp_capabilities.test.sql.
--
-- Qué es: el catálogo TÉCNICO de lo que cada SaaS sabe hacer cumplir. No lleva
-- precios, valores de límites ni asignaciones: eso vive en entitlement_grants
-- (migración …0500) y solo se crea cuando el valor está decidido (D-05).
--
-- Reglas:
--   · código canónico `<producto>.<segmento>(.<segmento>)*`, minúsculas; el
--     prefijo ES el code del producto (spec §4.1);
--   · la registración nace del SaaS: MasterAdmin importa su manifiesto, no
--     inventa códigos (spec §4.2). Una capacidad ausente del manifiesto NO se
--     borra: se informa como drift de registro (spec §9);
--   · `kind` y `code` son inmutables (los grants dependen de ellos);
--   · escritura solo por RPC DEFINER con gate can_manage_platform_entities()
--     (EBIM_PRODUCT_ADMIN, super admin). authenticated lee (catálogo técnico).
--
-- Rollback: docs/runbooks/ccp-rollback/07.sql (revoca EXECUTE; sin DROP de datos).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. product_capabilities
-- ---------------------------------------------------------------------------
create table platform.product_capabilities (
  id                     uuid primary key default gen_random_uuid(),
  saas_product_id        uuid not null references platform.saas_products (id) on delete restrict,
  code                   text not null,
  name                   text not null,
  description            text,
  kind                   text not null,
  is_baseline            boolean not null default false,
  unit                   text,
  combine_rule           text,
  scope_level            text not null default 'TENANT',
  meter_code             text,
  status                 text not null default 'DRAFT',
  introduced_in_contract text,
  manifest_version       text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint product_capabilities_code_ck check (code ~ '^[a-z0-9]+(\.[a-z0-9_]+)+$'),
  constraint product_capabilities_name_ck check (length(trim(name)) > 0),
  constraint product_capabilities_kind_ck check (kind in ('FEATURE', 'LIMIT', 'ALLOWANCE', 'AI_FEATURE')),
  constraint product_capabilities_scope_ck check (scope_level in ('TENANT', 'COMPANY')),
  constraint product_capabilities_status_ck check (status in ('DRAFT', 'ACTIVE', 'DEPRECATED')),
  -- MAX/SUM solo tiene sentido para magnitudes (spec §4, §6.1 paso 5).
  constraint product_capabilities_combine_ck check (
    case when kind in ('LIMIT', 'ALLOWANCE') then coalesce(combine_rule in ('MAX', 'SUM'), false)
         else combine_rule is null end),
  -- Una asignación siempre se mide contra un medidor (spec §11.1).
  constraint product_capabilities_meter_ck check (kind <> 'ALLOWANCE' or meter_code is not null),
  constraint product_capabilities_meter_format_ck
    check (meter_code is null or meter_code ~ '^[a-z0-9]+([._][a-z0-9]+)*$'),
  constraint product_capabilities_unit_ck check (unit is null or unit ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  -- Un baseline se incluye siempre con la app activa: no se vende ni se limita.
  constraint product_capabilities_baseline_ck check (not is_baseline or kind = 'FEATURE')
);

create unique index product_capabilities_product_code_uk
  on platform.product_capabilities (saas_product_id, code);
create unique index product_capabilities_code_uk on platform.product_capabilities (code);
create trigger product_capabilities_set_updated_at before update on platform.product_capabilities
  for each row execute function platform.set_updated_at();

comment on table platform.product_capabilities is
  'Registro de capacidades por producto (spec §4). Lo declara el SaaS en su manifiesto y '
  'MasterAdmin lo importa (import_capability_manifest). Sin precios ni valores de límites.';
comment on column platform.product_capabilities.is_baseline is
  'Incluida siempre que la app esté activa para el tenant, sin entitlement (patrón eCommerce).';
comment on column platform.product_capabilities.combine_rule is
  'LIMIT/ALLOWANCE: cómo se combinan plan, add-ons y overrides (MAX o SUM). NULL en features.';

-- Prefijo = producto; code, producto y kind inmutables.
create or replace function platform.enforce_product_capability_rules()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_product_code text;
begin
  if tg_op = 'UPDATE' then
    if new.saas_product_id is distinct from old.saas_product_id
       or new.code is distinct from old.code then
      raise exception 'CAPACIDAD_INMUTABLE: el código y el producto de % no se cambian', old.code
        using errcode = '23514';
    end if;
    if new.kind is distinct from old.kind then
      raise exception 'CAPACIDAD_KIND_INMUTABLE: % es %, no puede pasar a %', old.code, old.kind, new.kind
        using errcode = '23514';
    end if;
    return new;
  end if;

  select code into v_product_code from platform.saas_products where id = new.saas_product_id;
  if v_product_code is null then
    raise exception 'PRODUCTO_NO_ENCONTRADO: %', new.saas_product_id using errcode = '23503';
  end if;
  if split_part(new.code, '.', 1) <> v_product_code then
    raise exception 'CAPACIDAD_DE_OTRO_PRODUCTO: % no pertenece al producto %', new.code, v_product_code
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger product_capabilities_rules_guard
  before insert or update on platform.product_capabilities
  for each row execute function platform.enforce_product_capability_rules();

-- Funciones de trigger: nadie las ejecuta directamente (H-2/H-3).
revoke all on function platform.enforce_product_capability_rules() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. capability_aliases — códigos legacy (SaaS local, hub GMAO) → canónico
-- ---------------------------------------------------------------------------
create table platform.capability_aliases (
  id              uuid primary key default gen_random_uuid(),
  saas_product_id uuid not null references platform.saas_products (id) on delete restrict,
  capability_id   uuid not null references platform.product_capabilities (id) on delete restrict,
  alias_source    text not null,
  alias_code      text not null,
  created_at      timestamptz not null default now(),
  constraint capability_aliases_source_ck
    check (alias_source in ('LOCAL_ADDON', 'LOCAL_FEATURE', 'LOCAL_CAPABILITY', 'GMAO_HUB', 'LEGACY_CATALOG')),
  constraint capability_aliases_code_ck check (alias_code ~ '^[a-z0-9]+([._-][a-z0-9]+)*$')
);

create unique index capability_aliases_uk
  on platform.capability_aliases (saas_product_id, alias_source, alias_code);
create index capability_aliases_capability_ix on platform.capability_aliases (capability_id);

comment on table platform.capability_aliases is
  'Traduce códigos legacy (snake_case de cada SaaS, hub GMAO) al código canónico. Los SaaS '
  'NO renombran sus códigos (spec §4.1).';

create or replace function platform.enforce_capability_alias_product()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if not exists (select 1 from platform.product_capabilities c
                  where c.id = new.capability_id and c.saas_product_id = new.saas_product_id) then
    raise exception 'ALIAS_DE_OTRO_PRODUCTO: el alias %/% apunta a una capacidad de otro producto',
      new.alias_source, new.alias_code
      using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger capability_aliases_product_guard
  before insert or update on platform.capability_aliases
  for each row execute function platform.enforce_capability_alias_product();

revoke all on function platform.enforce_capability_alias_product() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. RLS y grants (spec §14.2.1): lectura para authenticated, escritura por RPC.
-- ---------------------------------------------------------------------------
alter table platform.product_capabilities enable row level security;
alter table platform.product_capabilities force row level security;
alter table platform.capability_aliases enable row level security;
alter table platform.capability_aliases force row level security;

revoke all on platform.product_capabilities, platform.capability_aliases from public, anon, authenticated;
grant select on platform.product_capabilities, platform.capability_aliases to authenticated;
grant all on platform.product_capabilities, platform.capability_aliases to service_role;

create policy product_capabilities_select on platform.product_capabilities
  for select to authenticated using (true);
create policy capability_aliases_select on platform.capability_aliases
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 4. upsert_capability_alias
-- ---------------------------------------------------------------------------
create or replace function platform.upsert_capability_alias(
  p_product_code    text,
  p_alias_source    text,
  p_alias_code      text,
  p_capability_code text
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_product    uuid;
  v_capability uuid;
  v_existing   record;
  v_id         uuid;
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: solo EBIM_PRODUCT_ADMIN o el super admin registran alias'
      using errcode = '42501';
  end if;

  select id into v_product from platform.saas_products where code = p_product_code;
  if v_product is null then
    raise exception 'PRODUCTO_NO_ENCONTRADO: %', p_product_code using errcode = '23503';
  end if;
  select id into v_capability from platform.product_capabilities
   where saas_product_id = v_product and code = p_capability_code;
  if v_capability is null then
    raise exception 'CAPACIDAD_NO_ENCONTRADA: % en %', p_capability_code, p_product_code
      using errcode = '23503';
  end if;

  select * into v_existing from platform.capability_aliases
   where saas_product_id = v_product and alias_source = p_alias_source and alias_code = p_alias_code;
  if v_existing.id is not null then
    if v_existing.capability_id <> v_capability then
      raise exception 'ALIAS_YA_ASIGNADO: %/% ya traduce a otra capacidad', p_alias_source, p_alias_code
        using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  insert into platform.capability_aliases (saas_product_id, capability_id, alias_source, alias_code)
  values (v_product, v_capability, p_alias_source, p_alias_code)
  returning id into v_id;

  perform platform.log_audit(
    'CAPABILITY_ALIAS_REGISTERED', 'capability_alias', v_id::text, null, null,
    jsonb_build_object('product', p_product_code, 'source', p_alias_source,
                       'alias', p_alias_code, 'capability', p_capability_code));
  return v_id;
end;
$$;

comment on function platform.upsert_capability_alias(text, text, text, text) is
  'Registra un alias legacy → capacidad canónica. Idempotente; nunca reasigna un alias en silencio.';

revoke all on function platform.upsert_capability_alias(text, text, text, text) from public, anon;
grant execute on function platform.upsert_capability_alias(text, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. import_capability_manifest — el SaaS declara, MasterAdmin registra.
--
-- Manifiesto `ebim.capabilities/v1`:
--   { "schema": "ebim.capabilities/v1", "productCode": "<code>", "manifestVersion": "…",
--     "capabilities": [ { "code", "name", "kind", "isBaseline"?, "unit"?, "combineRule"?,
--                         "scopeLevel"?, "meterCode"?, "status"?, "description"?,
--                         "introducedInContract"?, "aliases"?: [ {"source", "code"} ] } ] }
-- Claves desconocidas se rechazan: un manifiesto no trae valores comerciales.
-- ---------------------------------------------------------------------------
create or replace function platform.import_capability_manifest(
  p_product_code text,
  p_manifest     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_product    uuid;
  v_cap        jsonb;
  v_alias      jsonb;
  v_existing   platform.product_capabilities;
  v_row        platform.product_capabilities;
  v_id         uuid;
  v_inserted   integer := 0;
  v_updated    integer := 0;
  v_unchanged  integer := 0;
  v_aliases    integer := 0;
  v_codes      text[] := '{}';
  v_missing    jsonb;
  v_bad_keys   text;
  v_version    text;
  v_audit      bigint;
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: solo EBIM_PRODUCT_ADMIN o el super admin importan capacidades'
      using errcode = '42501';
  end if;

  select id into v_product from platform.saas_products where code = p_product_code;
  if v_product is null then
    raise exception 'PRODUCTO_NO_ENCONTRADO: %', p_product_code using errcode = '23503';
  end if;

  if p_manifest is null or jsonb_typeof(p_manifest) <> 'object'
     or p_manifest ->> 'schema' is distinct from 'ebim.capabilities/v1'
     or jsonb_typeof(p_manifest -> 'capabilities') is distinct from 'array' then
    raise exception 'MANIFIESTO_INVALIDO: se espera ebim.capabilities/v1 con un arreglo capabilities'
      using errcode = '23514';
  end if;
  if p_manifest ->> 'productCode' is distinct from p_product_code then
    raise exception 'MANIFIESTO_DE_OTRO_PRODUCTO: el manifiesto es de % y se importa en %',
      p_manifest ->> 'productCode', p_product_code
      using errcode = '23514';
  end if;
  v_version := nullif(trim(coalesce(p_manifest ->> 'manifestVersion', '')), '');

  for v_cap in select * from jsonb_array_elements(p_manifest -> 'capabilities') loop
    select string_agg(k, ', ') into v_bad_keys
      from jsonb_object_keys(v_cap) k
     where k not in ('code', 'name', 'kind', 'isBaseline', 'unit', 'combineRule', 'scopeLevel',
                     'meterCode', 'status', 'description', 'introducedInContract', 'aliases');
    if v_bad_keys is not null then
      raise exception 'MANIFIESTO_CLAVE_DESCONOCIDA: % en %', v_bad_keys, v_cap ->> 'code'
        using errcode = '23514';
    end if;

    v_row := null;
    v_row.saas_product_id        := v_product;
    v_row.code                   := v_cap ->> 'code';
    v_row.name                   := v_cap ->> 'name';
    v_row.description            := v_cap ->> 'description';
    v_row.kind                   := v_cap ->> 'kind';
    v_row.is_baseline            := coalesce((v_cap ->> 'isBaseline')::boolean, false);
    v_row.unit                   := v_cap ->> 'unit';
    v_row.combine_rule           := v_cap ->> 'combineRule';
    v_row.scope_level            := coalesce(v_cap ->> 'scopeLevel', 'TENANT');
    v_row.meter_code             := v_cap ->> 'meterCode';
    v_row.status                 := coalesce(v_cap ->> 'status', 'DRAFT');
    v_row.introduced_in_contract := v_cap ->> 'introducedInContract';

    if v_row.code is null or v_row.code !~ '^[a-z0-9]+(\.[a-z0-9_]+)+$' then
      raise exception 'CODIGO_CAPACIDAD_INVALIDO: "%" debe ser <producto>.<segmento> en minúsculas', v_row.code
        using errcode = '23514';
    end if;
    if v_row.code = any(v_codes) then
      raise exception 'MANIFIESTO_CODIGO_DUPLICADO: %', v_row.code using errcode = '23514';
    end if;
    v_codes := v_codes || v_row.code;

    select * into v_existing from platform.product_capabilities
     where saas_product_id = v_product and code = v_row.code;

    if v_existing.id is null then
      insert into platform.product_capabilities (
        saas_product_id, code, name, description, kind, is_baseline, unit, combine_rule,
        scope_level, meter_code, status, introduced_in_contract, manifest_version
      ) values (
        v_product, v_row.code, v_row.name, v_row.description, v_row.kind, v_row.is_baseline,
        v_row.unit, v_row.combine_rule, v_row.scope_level, v_row.meter_code, v_row.status,
        v_row.introduced_in_contract, v_version
      )
      returning id into v_id;
      v_inserted := v_inserted + 1;
    else
      v_id := v_existing.id;
      if (v_existing.name, v_existing.description, v_existing.kind, v_existing.is_baseline,
          v_existing.unit, v_existing.combine_rule, v_existing.scope_level, v_existing.meter_code,
          v_existing.status, v_existing.introduced_in_contract)
         is distinct from
         (v_row.name, v_row.description, v_row.kind, v_row.is_baseline, v_row.unit,
          v_row.combine_rule, v_row.scope_level, v_row.meter_code, v_row.status,
          v_row.introduced_in_contract) then
        update platform.product_capabilities
           set name = v_row.name, description = v_row.description, kind = v_row.kind,
               is_baseline = v_row.is_baseline, unit = v_row.unit, combine_rule = v_row.combine_rule,
               scope_level = v_row.scope_level, meter_code = v_row.meter_code, status = v_row.status,
               introduced_in_contract = v_row.introduced_in_contract, manifest_version = v_version
         where id = v_id;
        v_updated := v_updated + 1;
      else
        v_unchanged := v_unchanged + 1;
      end if;
    end if;

    if v_cap ? 'aliases' then
      if jsonb_typeof(v_cap -> 'aliases') <> 'array' then
        raise exception 'MANIFIESTO_INVALIDO: aliases de % debe ser un arreglo', v_row.code using errcode = '23514';
      end if;
      for v_alias in select * from jsonb_array_elements(v_cap -> 'aliases') loop
        if not exists (select 1 from platform.capability_aliases
                        where saas_product_id = v_product
                          and alias_source = v_alias ->> 'source'
                          and alias_code = v_alias ->> 'code'
                          and capability_id = v_id) then
          perform platform.upsert_capability_alias(p_product_code, v_alias ->> 'source',
                                                   v_alias ->> 'code', v_row.code);
          v_aliases := v_aliases + 1;
        end if;
      end loop;
    end if;
  end loop;

  select coalesce(jsonb_agg(c.code order by c.code), '[]'::jsonb) into v_missing
    from platform.product_capabilities c
   where c.saas_product_id = v_product and c.code <> all(v_codes);

  v_audit := platform.log_audit(
    'CAPABILITY_MANIFEST_IMPORTED', 'saas_product', p_product_code, null, null,
    jsonb_build_object('manifest_version', v_version, 'inserted', v_inserted, 'updated', v_updated,
                       'unchanged', v_unchanged, 'aliases', v_aliases, 'missing', v_missing));

  return jsonb_build_object('product', p_product_code, 'inserted', v_inserted, 'updated', v_updated,
                            'unchanged', v_unchanged, 'aliases', v_aliases, 'missing', v_missing,
                            'import_id', v_audit);
end;
$$;

comment on function platform.import_capability_manifest(text, jsonb) is
  'Importa el manifiesto ebim.capabilities/v1 de un SaaS. Idempotente; no borra capacidades '
  'ausentes (las devuelve en `missing` = drift de registro); kind/código inmutables. Auditado.';

revoke all on function platform.import_capability_manifest(text, jsonb) from public, anon;
grant execute on function platform.import_capability_manifest(text, jsonb) to authenticated, service_role;
