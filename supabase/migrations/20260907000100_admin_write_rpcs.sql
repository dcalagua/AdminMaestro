-- ============================================================================
-- EBIM Control Plane V2 — 14 · RPCs de escritura administrativa
-- ----------------------------------------------------------------------------
-- Fase 02 de `.claude-prompts-v2`.
--
-- POR QUÉ RPCs Y NO GRANTs (decisión DV2-001):
-- La migración 09 del baseline REVOCA deliberadamente INSERT/UPDATE/DELETE a
-- `authenticated` sobre plans, plan_prices, subscriptions, subscription_items,
-- sales_agents, sales_attributions, commission_*, deployment_targets y
-- provisioning_*. Abrir esos GRANTs para "poder editar desde la UI" desmontaría
-- el modelo del baseline: cualquiera con la clave publishable podría escribir
-- directo por PostgREST. En su lugar, cada escritura entra por una RPC que:
--
--   1. es `security definer` con `search_path = platform, pg_catalog`;
--   2. AUTORIZA en la primera línea del cuerpo, con los helpers existentes;
--   3. valida IDs y estado previo antes de tocar nada;
--   4. deja rastro con `platform.log_audit()`;
--   5. revoca `public, anon` y concede lo mínimo.
--
-- `create_tenant()` NO se redefine aquí: se reutiliza tal cual (regla de la fase).
--
-- Nota sobre `security definer` y RLS FORCE: las tablas tienen FORCE ROW LEVEL
-- SECURITY, así que ni el owner se salta las políticas. Estas funciones son
-- propiedad de `postgres` (superusuario), que sí las elude — por eso la
-- autorización explícita del punto 2 no es decorativa: es la única barrera.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Helper de autorización comercial/financiera reutilizable.
--    No existe en el baseline y lo necesitan varias RPCs de abajo.
-- ---------------------------------------------------------------------------
create or replace function platform.can_manage_commercial()
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select platform.can_read_finance()
      or platform.can_manage_platform_entities();
$$;

comment on function platform.can_manage_commercial() is
  'EBIM_FINANCE o EBIM_PRODUCT_ADMIN (o el super admin, que ambas incluyen). '
  'Alcance: catálogo comercial, suscripciones y comisiones. NO da acceso operativo.';

revoke all on function platform.can_manage_commercial() from public, anon;
grant execute on function platform.can_manage_commercial() to authenticated, service_role;


-- ############################################################################
-- 1. CATÁLOGO DE PRODUCTO SaaS
-- ############################################################################

-- ---------------------------------------------------------------------------
-- upsert_saas_product — alta y edición del catálogo canónico.
-- `p_id` null => alta. `p_code` es inmutable tras el alta: es la clave que usan
-- las apps de la suite y renombrarla rompería integraciones silenciosamente.
-- ---------------------------------------------------------------------------
create or replace function platform.upsert_saas_product(
  p_code         text,
  p_name         text,
  p_short_name   text,
  p_description  text default null,
  p_accent_color text default null,
  p_status       platform.entity_status default 'ACTIVE',
  p_is_billable  boolean default true,
  p_billing_unit text default 'TENANT',
  p_sort_order   integer default 100,
  p_metadata     jsonb default '{}'::jsonb,
  -- `p_id` va al final y con default: null = alta, valor = edición. Estar al
  -- final lo hace realmente OPCIONAL, y el generador de tipos lo refleja.
  p_id           uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id      uuid;
  -- `saas_products.code` está protegido por CHECK platform.is_slug(): kebab-case
  -- en minúsculas (`esupplier`, `ewm`, `gmao`). No es un código en mayúsculas.
  v_code    text := lower(nullif(trim(coalesce(p_code, '')), ''));
  v_is_new  boolean := p_id is null;
  v_old     record;
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: solo EBIM_PRODUCT_ADMIN o el super admin administran el catálogo de productos'
      using errcode = '42501';
  end if;

  if v_code is null then
    raise exception 'CODIGO_REQUERIDO: el producto necesita un código estable (ej. esupplier)'
      using errcode = '23502';
  end if;
  if not platform.is_slug(v_code) then
    raise exception 'CODIGO_INVALIDO: "%" debe ser kebab-case en minúsculas (a-z, 0-9, guiones), como los códigos existentes esupplier/ewm/gmao', v_code
      using errcode = '23514';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null
     or nullif(trim(coalesce(p_short_name, '')), '') is null then
    raise exception 'NOMBRE_REQUERIDO: name y short_name son obligatorios'
      using errcode = '23502';
  end if;

  if v_is_new then
    -- `lockup_name` NO se pasa: es una columna GENERATED ALWAYS
    -- (`short_name || ' by EBIM'`) que materializa el lockup del contrato §4.6 / U-02.
    insert into platform.saas_products (
      code, name, short_name, description, accent_color,
      status, is_billable, billing_unit, sort_order, metadata
    ) values (
      v_code, trim(p_name), trim(p_short_name), p_description, p_accent_color,
      p_status, p_is_billable, coalesce(nullif(trim(p_billing_unit), ''), 'TENANT'),
      p_sort_order, coalesce(p_metadata, '{}'::jsonb)
    )
    returning id into v_id;
  else
    select * into v_old from platform.saas_products where id = p_id;
    if v_old is null then
      raise exception 'PRODUCTO_NO_ENCONTRADO: %', p_id using errcode = '23503';
    end if;
    -- El código es la clave de integración con la suite: no se renombra.
    if v_old.code <> v_code then
      raise exception 'CODIGO_INMUTABLE: el código de un producto no se cambia (% -> %); crea otro producto si es otro SaaS', v_old.code, v_code
        using errcode = '23514';
    end if;

    update platform.saas_products
       set name         = trim(p_name),
           short_name   = trim(p_short_name),
           description  = p_description,
           accent_color = p_accent_color,
           status       = p_status,
           is_billable  = p_is_billable,
           billing_unit = coalesce(nullif(trim(p_billing_unit), ''), 'TENANT'),
           sort_order   = p_sort_order,
           metadata     = coalesce(p_metadata, '{}'::jsonb)
     where id = p_id
    returning id into v_id;
  end if;

  perform platform.log_audit(
    case when v_is_new then 'PRODUCT_CREATED' else 'PRODUCT_UPDATED' end,
    'saas_product', v_id::text, null, null,
    jsonb_build_object('code', v_code, 'status', p_status, 'is_billable', p_is_billable)
  );

  return v_id;
end;
$$;

comment on function platform.upsert_saas_product is
  'Alta/edición de un SaaS de la suite. Añadir un producto es insertar una fila: '
  'no requiere cambio de código ni migración (Fase 03).';

-- ---------------------------------------------------------------------------
-- archive_saas_product — archivar solo si no rompe contratos vivos.
-- ---------------------------------------------------------------------------
create or replace function platform.archive_saas_product(
  p_product_id uuid,
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_code    text;
  v_subs    integer;
  v_tenants integer;
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: solo EBIM_PRODUCT_ADMIN o el super admin archivan productos'
      using errcode = '42501';
  end if;

  select code into v_code from platform.saas_products where id = p_product_id;
  if v_code is null then
    raise exception 'PRODUCTO_NO_ENCONTRADO: %', p_product_id using errcode = '23503';
  end if;

  select count(*) into v_subs
    from platform.subscriptions s
   where s.saas_product_id = p_product_id
     and s.status in ('ACTIVE', 'PAST_DUE', 'PAUSED');

  select count(*) into v_tenants
    from platform.tenants t
   where t.saas_product_id = p_product_id
     and t.status in ('ACTIVE', 'PENDING', 'SUSPENDED');

  if v_subs > 0 or v_tenants > 0 then
    raise exception 'PRODUCTO_CON_DEPENDENCIAS: % tiene % suscripción(es) y % tenant(s) vivos; cancélalos o migra antes de archivar',
      v_code, v_subs, v_tenants
      using errcode = '23514';
  end if;

  update platform.saas_products set status = 'ARCHIVED' where id = p_product_id;

  perform platform.log_audit(
    'PRODUCT_ARCHIVED', 'saas_product', p_product_id::text, null, null,
    jsonb_build_object('code', v_code, 'reason', p_reason)
  );
end;
$$;


-- ############################################################################
-- 2. PLANES Y PRECIOS
-- ############################################################################

create or replace function platform.upsert_plan(
  p_code              text,
  p_name              text,
  p_saas_product_id   uuid,
  p_deployment_mode   platform.deployment_mode default null,
  p_included_companies integer default 1,
  p_multi_country     boolean default false,
  p_is_partner_base   boolean default false,
  p_description       text default null,
  p_status            platform.entity_status default 'ACTIVE',
  p_sort_order        integer default 100,
  p_metadata          jsonb default '{}'::jsonb,
  -- `p_id` va al final y con default: null = alta, valor = edición. Estar al
  -- final lo hace realmente OPCIONAL, y el generador de tipos lo refleja.
  p_id           uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id     uuid;
  v_code   text := lower(nullif(trim(coalesce(p_code, '')), ''));
  v_is_new boolean := p_id is null;
  v_old    record;
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: solo EBIM_PRODUCT_ADMIN o el super admin administran planes'
      using errcode = '42501';
  end if;

  if v_code is null then
    raise exception 'CODIGO_REQUERIDO: el plan necesita código' using errcode = '23502';
  end if;
  -- Mismo CHECK is_slug() que el baseline: `esupplier-shared-standard`, no `ESUPPLIER_STD`.
  if not platform.is_slug(v_code) then
    raise exception 'CODIGO_INVALIDO: "%" debe ser kebab-case en minúsculas (ej. esupplier-shared-standard)', v_code
      using errcode = '23514';
  end if;
  if not exists (select 1 from platform.saas_products where id = p_saas_product_id) then
    raise exception 'PRODUCTO_NO_ENCONTRADO: %', p_saas_product_id using errcode = '23503';
  end if;
  if coalesce(p_included_companies, 1) < 1 then
    raise exception 'SOCIEDADES_INVALIDAS: included_companies debe ser >= 1' using errcode = '23514';
  end if;

  -- Un plan base de partner describe la licencia del canal, no la de un tenant:
  -- solo tiene sentido en PARTNER_DEDICATED.
  if p_is_partner_base and coalesce(p_deployment_mode, 'PARTNER_DEDICATED') <> 'PARTNER_DEDICATED' then
    raise exception 'PLAN_BASE_INCOHERENTE: is_partner_base solo aplica a planes PARTNER_DEDICATED'
      using errcode = '23514';
  end if;

  if v_is_new then
    insert into platform.plans (
      code, name, saas_product_id, deployment_mode, included_companies,
      multi_country, is_partner_base, description, status, sort_order, metadata
    ) values (
      v_code, trim(p_name), p_saas_product_id, p_deployment_mode, coalesce(p_included_companies, 1),
      coalesce(p_multi_country, false), coalesce(p_is_partner_base, false), p_description,
      p_status, p_sort_order, coalesce(p_metadata, '{}'::jsonb)
    )
    returning id into v_id;
  else
    select * into v_old from platform.plans where id = p_id;
    if v_old is null then
      raise exception 'PLAN_NO_ENCONTRADO: %', p_id using errcode = '23503';
    end if;
    if v_old.saas_product_id <> p_saas_product_id then
      raise exception 'PRODUCTO_INMUTABLE: un plan no cambia de producto SaaS' using errcode = '23514';
    end if;

    update platform.plans
       set code = v_code, name = trim(p_name), deployment_mode = p_deployment_mode,
           included_companies = coalesce(p_included_companies, 1),
           multi_country = coalesce(p_multi_country, false),
           is_partner_base = coalesce(p_is_partner_base, false),
           description = p_description, status = p_status,
           sort_order = p_sort_order, metadata = coalesce(p_metadata, '{}'::jsonb)
     where id = p_id
    returning id into v_id;
  end if;

  perform platform.log_audit(
    case when v_is_new then 'PLAN_CREATED' else 'PLAN_UPDATED' end,
    'plan', v_id::text, null, null,
    jsonb_build_object('code', v_code, 'product', p_saas_product_id, 'is_partner_base', p_is_partner_base)
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_plan_price — versiona la tarifa. NUNCA edita una tarifa histórica.
--
-- El precio de un plan es un hecho con fecha: una factura emitida en marzo se
-- calculó con la tarifa de marzo. Si se pudiera editar en sitio, la contabilidad
-- pasada dejaría de reconstruirse. Por eso esta función CIERRA la tarifa abierta
-- (`valid_to = p_valid_from - 1 día`) y abre una nueva.
--
-- El índice `plan_prices_current_uk` (plan, charge_kind, interval, currency)
-- WHERE valid_to IS NULL garantiza que solo haya una tarifa abierta por combo.
-- ---------------------------------------------------------------------------
create or replace function platform.set_plan_price(
  p_plan_id          uuid,
  p_charge_kind      platform.charge_kind,
  p_billing_interval platform.billing_interval,
  p_amount           numeric,
  p_currency         char(3),
  p_valid_from       date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id      uuid;
  v_current record;
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: solo EBIM_PRODUCT_ADMIN o el super admin fijan tarifas'
      using errcode = '42501';
  end if;

  if not exists (select 1 from platform.plans where id = p_plan_id) then
    raise exception 'PLAN_NO_ENCONTRADO: %', p_plan_id using errcode = '23503';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'IMPORTE_INVALIDO: la tarifa no puede ser negativa' using errcode = '23514';
  end if;

  select * into v_current
    from platform.plan_prices
   where plan_id = p_plan_id
     and charge_kind = p_charge_kind
     and billing_interval = p_billing_interval
     and currency = p_currency
     and valid_to is null;

  if v_current.id is not null then
    if v_current.valid_from >= p_valid_from then
      raise exception 'VIGENCIA_INVALIDA: la tarifa abierta empieza el % y la nueva pretende empezar el %; una tarifa nueva no puede solapar hacia atrás',
        v_current.valid_from, p_valid_from
        using errcode = '23514';
    end if;
    if v_current.amount = p_amount then
      -- Nada que versionar: no se crea ruido histórico por un "guardar" sin cambio.
      return v_current.id;
    end if;

    update platform.plan_prices
       set valid_to = p_valid_from - 1
     where id = v_current.id;
  end if;

  insert into platform.plan_prices (
    plan_id, charge_kind, billing_interval, amount, currency, valid_from
  ) values (
    p_plan_id, p_charge_kind, p_billing_interval, p_amount, p_currency, p_valid_from
  )
  returning id into v_id;

  perform platform.log_audit(
    'PLAN_PRICE_VERSIONED', 'plan_price', v_id::text, null, null,
    jsonb_build_object(
      'plan_id', p_plan_id, 'charge_kind', p_charge_kind, 'billing_interval', p_billing_interval,
      'amount', p_amount, 'currency', p_currency, 'valid_from', p_valid_from,
      'closed_price_id', v_current.id, 'previous_amount', v_current.amount
    )
  );

  return v_id;
end;
$$;

comment on function platform.set_plan_price is
  'Versiona la tarifa cerrando la anterior. Una tarifa histórica NUNCA se edita: '
  'las facturas ya emitidas se calcularon con ella.';

-- ---------------------------------------------------------------------------
-- upsert_catalog_item — addons del catálogo central (contrato §5/§6, C-12).
-- ---------------------------------------------------------------------------
create or replace function platform.upsert_catalog_item(
  p_code            text,
  p_name            text,
  p_saas_product_id uuid default null,
  p_item_type       text default 'addon',
  p_scope           text default 'per-company',
  p_available       boolean default true,
  p_price_month     numeric default 0,
  p_currency        char(3) default 'USD',
  p_description     text default null,
  -- `p_id` va al final y con default: null = alta, valor = edición. Estar al
  -- final lo hace realmente OPCIONAL, y el generador de tipos lo refleja.
  p_id           uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id uuid;
  v_is_new boolean := p_id is null;
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: solo EBIM_PRODUCT_ADMIN o el super admin administran el catálogo'
      using errcode = '42501';
  end if;

  -- `catalog_items.code` usa snake_case (CHECK del baseline): extra_company, sla_premium.
  if lower(trim(coalesce(p_code, ''))) !~ '^[a-z0-9]+(_[a-z0-9]+)*$' then
    raise exception 'CODIGO_INVALIDO: "%" debe ser snake_case en minúsculas (ej. extra_company)', p_code
      using errcode = '23514';
  end if;

  -- Nombres canónicos del contrato §11.1: el scope de un addon es org-wide o per-company.
  if p_scope not in ('org-wide', 'per-company') then
    raise exception 'SCOPE_INVALIDO: "%" debe ser org-wide o per-company (contrato §11.1)', p_scope
      using errcode = '23514';
  end if;

  if v_is_new then
    insert into platform.catalog_items (
      code, name, description, saas_product_id, item_type, scope, available, price_month, currency
    ) values (
      lower(trim(p_code)), trim(p_name), p_description, p_saas_product_id,
      p_item_type, p_scope, p_available, coalesce(p_price_month, 0), p_currency
    )
    returning id into v_id;
  else
    update platform.catalog_items
       set name = trim(p_name), description = p_description, saas_product_id = p_saas_product_id,
           item_type = p_item_type, scope = p_scope, available = p_available,
           price_month = coalesce(p_price_month, 0), currency = p_currency
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'ADDON_NO_ENCONTRADO: %', p_id using errcode = '23503';
    end if;
  end if;

  perform platform.log_audit(
    case when v_is_new then 'CATALOG_ITEM_CREATED' else 'CATALOG_ITEM_UPDATED' end,
    'catalog_item', v_id::text, null, null,
    jsonb_build_object('code', p_code, 'scope', p_scope, 'available', p_available)
  );

  return v_id;
end;
$$;


-- ############################################################################
-- 3. ORGANIZACIONES, CAPACIDADES Y SOCIEDADES
-- ############################################################################

-- ---------------------------------------------------------------------------
-- upsert_organization — alta/edición de cliente, partner o reseller.
--
-- Partner y Reseller NO son tipos excluyentes: son `organization_capabilities`
-- acumulables (Fase 04). Por eso esta función recibe un ARRAY de capacidades y
-- las sincroniza en la misma transacción que la organización.
-- ---------------------------------------------------------------------------
create or replace function platform.upsert_organization(
  p_slug          text,
  p_legal_name    text,
  p_display_name  text,
  p_country_code  char(2) default 'PE',
  p_tax_id        text default null,
  p_billing_email text default null,
  p_capabilities  platform.org_capability[] default array['CUSTOMER']::platform.org_capability[],
  p_status        platform.entity_status default 'ACTIVE',
  p_accent_color  text default null,
  p_logo_url      text default null,
  p_white_label   boolean default false,
  p_brand_slug    text default null,
  p_metadata      jsonb default '{}'::jsonb,
  -- `p_id` va al final y con default: null = alta, valor = edición. Estar al
  -- final lo hace realmente OPCIONAL, y el generador de tipos lo refleja.
  p_id           uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id     uuid;
  v_slug   text := lower(nullif(trim(coalesce(p_slug, '')), ''));
  v_is_new boolean := p_id is null;
  v_old    record;
  v_caps   platform.org_capability[] := coalesce(p_capabilities, array[]::platform.org_capability[]);
begin
  -- Alta: solo EBIM. Edición: EBIM o un admin de esa misma organización.
  if v_is_new then
    if not platform.can_manage_platform_entities() then
      raise exception 'NO_AUTORIZADO: solo EBIM_PRODUCT_ADMIN o el super admin dan de alta organizaciones'
        using errcode = '42501';
    end if;
  else
    if not (platform.can_manage_platform_entities() or platform.is_org_admin(p_id)) then
      raise exception 'NO_AUTORIZADO: no administra esta organización' using errcode = '42501';
    end if;
  end if;

  if v_slug is null or v_slug !~ '^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])?$' then
    raise exception 'SLUG_INVALIDO: "%" debe ser minúsculas/números/guiones, 2-48 caracteres', p_slug
      using errcode = '23514';
  end if;
  if nullif(trim(coalesce(p_legal_name, '')), '') is null
     or nullif(trim(coalesce(p_display_name, '')), '') is null then
    raise exception 'NOMBRE_REQUERIDO: legal_name y display_name son obligatorios' using errcode = '23502';
  end if;

  -- `kind` se queda siempre en COMPANY: la única organización PLATFORM es EBIM y
  -- el índice parcial `organizations_single_platform_uk` la protege. No se expone
  -- como parámetro para que nadie se declare plataforma desde la consola.
  if v_is_new then
    insert into platform.organizations (
      slug, legal_name, display_name, kind, country_code, tax_id, status,
      accent_color, logo_url, white_label, brand_slug, billing_email, metadata
    ) values (
      v_slug, trim(p_legal_name), trim(p_display_name), 'COMPANY', p_country_code, p_tax_id, p_status,
      p_accent_color, p_logo_url, coalesce(p_white_label, false), p_brand_slug, p_billing_email,
      coalesce(p_metadata, '{}'::jsonb)
    )
    returning id into v_id;
  else
    select * into v_old from platform.organizations where id = p_id;
    if v_old is null then
      raise exception 'ORGANIZACION_NO_ENCONTRADA: %', p_id using errcode = '23503';
    end if;
    if v_old.kind = 'PLATFORM' and not platform.is_super_admin() then
      raise exception 'ORGANIZACION_PLATAFORMA_PROTEGIDA: solo el super admin edita la organización EBIM (contrato §13)'
        using errcode = '42501';
    end if;

    update platform.organizations
       set slug = v_slug, legal_name = trim(p_legal_name), display_name = trim(p_display_name),
           country_code = p_country_code, tax_id = p_tax_id, status = p_status,
           accent_color = p_accent_color, logo_url = p_logo_url,
           white_label = coalesce(p_white_label, false), brand_slug = p_brand_slug,
           billing_email = p_billing_email, metadata = coalesce(p_metadata, '{}'::jsonb),
           archived_at = case when p_status = 'ARCHIVED' then coalesce(v_old.archived_at, now()) else null end
     where id = p_id
    returning id into v_id;
  end if;

  -- Capacidades: solo EBIM las decide. Un partner no se auto-concede RESELLER.
  if platform.can_manage_platform_entities() and array_length(v_caps, 1) is not null then
    delete from platform.organization_capabilities
     where organization_id = v_id and capability <> all (v_caps);

    insert into platform.organization_capabilities (organization_id, capability)
    select v_id, unnest(v_caps)
    on conflict (organization_id, capability) do nothing;
  end if;

  perform platform.log_audit(
    case when v_is_new then 'ORGANIZATION_CREATED' else 'ORGANIZATION_UPDATED' end,
    'organization', v_id::text, v_id, null,
    jsonb_build_object('slug', v_slug, 'status', p_status, 'capabilities', to_jsonb(v_caps))
  );

  return v_id;
end;
$$;

comment on function platform.upsert_organization is
  'Alta/edición de organización. PARTNER/RESELLER/CONSULTING/CUSTOMER son capacidades '
  'ACUMULABLES, no tipos excluyentes. Solo EBIM concede capacidades.';

-- ---------------------------------------------------------------------------
-- upsert_company — sociedad dentro de una organización (contrato §8, C-04).
-- ---------------------------------------------------------------------------
create or replace function platform.upsert_company(
  p_organization_id uuid,
  p_name            text,
  p_country_code    char(2) default 'PE',
  p_currency        char(3) default 'PEN',
  p_tax_id          text default null,
  p_erp_code        text default null,
  p_is_default      boolean default false,
  p_status          platform.entity_status default 'ACTIVE',
  -- `p_id` va al final y con default: null = alta, valor = edición. Estar al
  -- final lo hace realmente OPCIONAL, y el generador de tipos lo refleja.
  p_id           uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id uuid;
  v_is_new boolean := p_id is null;
begin
  if not (platform.can_manage_platform_entities() or platform.is_org_admin(p_organization_id)) then
    raise exception 'NO_AUTORIZADO: no administra esta organización' using errcode = '42501';
  end if;

  if v_is_new then
    insert into platform.companies (
      organization_id, name, country_code, currency, tax_id, erp_code, is_default, status
    ) values (
      p_organization_id, trim(p_name), p_country_code, p_currency, p_tax_id, p_erp_code,
      coalesce(p_is_default, false), p_status
    )
    returning id into v_id;
  else
    update platform.companies
       set name = trim(p_name), country_code = p_country_code, currency = p_currency,
           tax_id = p_tax_id, erp_code = p_erp_code,
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
    jsonb_build_object('name', p_name, 'country', p_country_code, 'status', p_status)
  );

  return v_id;
end;
$$;


-- ############################################################################
-- 4. TENANTS — estado, configuración y features
-- ############################################################################

-- ---------------------------------------------------------------------------
-- set_tenant_status — activar/suspender/dar de baja con motivo y auditoría.
--
-- El baseline concede UPDATE directo sobre `tenants` a `authenticated`, así que
-- técnicamente se podría cambiar el estado por PostgREST. Esta RPC existe porque
-- ese camino NO deja motivo ni rastro: la consola usa siempre esta función y la
-- Fase 16 comprueba que el cambio quedó en `audit_logs`.
-- ---------------------------------------------------------------------------
create or replace function platform.set_tenant_status(
  p_tenant_id uuid,
  p_status    platform.tenant_status,
  p_reason    text default null
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_tenant record;
  v_valid  boolean;
begin
  select * into v_tenant from platform.tenants where id = p_tenant_id;
  if v_tenant is null then
    raise exception 'TENANT_NO_ENCONTRADO: %', p_tenant_id using errcode = '23503';
  end if;

  if not platform.can_manage_tenant(p_tenant_id) then
    raise exception 'NO_AUTORIZADO: no administra el tenant %', v_tenant.slug using errcode = '42501';
  end if;

  if v_tenant.status = p_status then
    return;
  end if;

  -- Máquina de estados del tenant. ARCHIVED y CHURNED no vuelven solos.
  v_valid := case v_tenant.status
    when 'PENDING'   then p_status in ('ACTIVE', 'ARCHIVED')
    when 'ACTIVE'    then p_status in ('SUSPENDED', 'CHURNED')
    when 'SUSPENDED' then p_status in ('ACTIVE', 'CHURNED', 'ARCHIVED')
    when 'CHURNED'   then p_status in ('ARCHIVED')
    else false
  end;

  if not v_valid then
    raise exception 'TRANSICION_TENANT_INVALIDA: no se puede pasar de % a %', v_tenant.status, p_status
      using errcode = '23514';
  end if;

  -- Suspender o dar de baja no es reversible sin dejar constancia del motivo.
  if p_status in ('SUSPENDED', 'CHURNED')
     and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: suspender o dar de baja un tenant exige un motivo auditable'
      using errcode = '23502';
  end if;

  update platform.tenants
     set status = p_status,
         activated_at = case when p_status = 'ACTIVE' then coalesce(activated_at, now()) else activated_at end,
         churned_at   = case when p_status = 'CHURNED' then now() else churned_at end
   where id = p_tenant_id;

  perform platform.log_audit(
    'TENANT_STATUS_CHANGED', 'tenant', p_tenant_id::text,
    v_tenant.customer_organization_id, p_tenant_id,
    jsonb_build_object('from', v_tenant.status, 'to', p_status, 'reason', p_reason)
  );
end;
$$;

comment on function platform.set_tenant_status is
  'Único camino auditado para cambiar el estado de un tenant. Suspender o dar de '
  'baja exige motivo: un tenant apagado sin explicación es un incidente, no una operación.';

-- ---------------------------------------------------------------------------
-- update_tenant — campos seguros. NO permite mover el tenant de organización ni
-- de producto: eso sería una venta distinta, no una edición.
-- ---------------------------------------------------------------------------
create or replace function platform.update_tenant(
  p_tenant_id    uuid,
  p_name         text,
  p_admin_email  text default null,
  p_accent_color text default null,
  p_logo_url     text default null,
  p_white_label  boolean default null,
  p_metadata     jsonb default null
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_tenant record;
  v_email  text := lower(nullif(trim(coalesce(p_admin_email, '')), ''));
begin
  select * into v_tenant from platform.tenants where id = p_tenant_id;
  if v_tenant is null then
    raise exception 'TENANT_NO_ENCONTRADO: %', p_tenant_id using errcode = '23503';
  end if;
  if not platform.can_manage_tenant(p_tenant_id) then
    raise exception 'NO_AUTORIZADO: no administra el tenant %', v_tenant.slug using errcode = '42501';
  end if;

  -- Mismas reglas que create_tenant: el correo de admin es del cliente, nunca del operador.
  if v_email is not null then
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-zA-Z]{2,}$' then
      raise exception 'ADMIN_EMAIL_REQUERIDO: "%" no es un correo válido (contrato §3.2)', p_admin_email
        using errcode = '23514';
    end if;
    if v_email like '%@ebim.pe' then
      raise exception 'DOMINIO_OPERADOR_BLOQUEADO: % pertenece al dominio operador (contrato §13.2)', v_email
        using errcode = '42501';
    end if;
  end if;

  update platform.tenants
     set name         = coalesce(nullif(trim(p_name), ''), name),
         admin_email  = coalesce(v_email, admin_email),
         accent_color = coalesce(p_accent_color, accent_color),
         logo_url     = coalesce(p_logo_url, logo_url),
         white_label  = coalesce(p_white_label, white_label),
         metadata     = coalesce(p_metadata, metadata)
   where id = p_tenant_id;

  perform platform.log_audit(
    'TENANT_UPDATED', 'tenant', p_tenant_id::text,
    v_tenant.customer_organization_id, p_tenant_id,
    jsonb_build_object('name', p_name, 'admin_email_changed', v_email is not null)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- set_tenant_feature — toggle de feature flag auditado.
-- ---------------------------------------------------------------------------
create or replace function platform.set_tenant_feature(
  p_tenant_id   uuid,
  p_feature_key text,
  p_enabled     boolean,
  p_value       jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_tenant record;
begin
  select * into v_tenant from platform.tenants where id = p_tenant_id;
  if v_tenant is null then
    raise exception 'TENANT_NO_ENCONTRADO: %', p_tenant_id using errcode = '23503';
  end if;
  if not platform.can_manage_tenant(p_tenant_id) then
    raise exception 'NO_AUTORIZADO: no administra el tenant %', v_tenant.slug using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_feature_key, '')), '') is null then
    raise exception 'FEATURE_KEY_REQUERIDA' using errcode = '23502';
  end if;

  insert into platform.tenant_features (tenant_id, feature_key, enabled, source, value, updated_by)
  values (p_tenant_id, trim(p_feature_key), p_enabled, 'MANUAL', coalesce(p_value, '{}'::jsonb), auth.uid())
  on conflict (tenant_id, feature_key) do update
    set enabled = excluded.enabled,
        source = 'MANUAL',
        value = excluded.value,
        updated_by = excluded.updated_by;

  perform platform.log_audit(
    'TENANT_FEATURE_SET', 'tenant_feature', p_tenant_id::text || ':' || trim(p_feature_key),
    v_tenant.customer_organization_id, p_tenant_id,
    jsonb_build_object('feature_key', trim(p_feature_key), 'enabled', p_enabled)
  );
end;
$$;


-- ############################################################################
-- 5. COMERCIAL — agentes, atribuciones, planes de comisión
-- ############################################################################

create or replace function platform.upsert_sales_agent(
  p_code            text,
  p_full_name       text,
  p_agent_type      platform.sales_agent_type default 'INDEPENDENT',
  p_organization_id uuid default null,
  p_contact_email   text default null,
  p_user_id         uuid default null,
  p_status          platform.entity_status default 'ACTIVE',
  p_valid_from      date default current_date,
  p_valid_to        date default null,
  p_metadata        jsonb default '{}'::jsonb,
  -- `p_id` va al final y con default: null = alta, valor = edición. Estar al
  -- final lo hace realmente OPCIONAL, y el generador de tipos lo refleja.
  p_id           uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id uuid;
  v_is_new boolean := p_id is null;
begin
  -- EBIM administra cualquier comercial; un partner admin solo los de SU organización.
  if not (
    platform.can_manage_commercial()
    or (p_organization_id is not null and platform.is_org_admin(p_organization_id))
  ) then
    raise exception 'NO_AUTORIZADO: no puede administrar comerciales de esta organización'
      using errcode = '42501';
  end if;

  -- `sales_agents.code` usa is_slug(): beto-andina, carla-independiente.
  if not platform.is_slug(lower(trim(coalesce(p_code, '')))) then
    raise exception 'CODIGO_INVALIDO: "%" debe ser kebab-case en minúsculas (ej. beto-andina)', p_code
      using errcode = '23514';
  end if;

  -- Coherencia del tipo de agente con su organización.
  if p_agent_type = 'PARTNER_AGENT' and p_organization_id is null then
    raise exception 'AGENTE_PARTNER_SIN_ORG: un PARTNER_AGENT pertenece a una organización'
      using errcode = '23514';
  end if;
  if p_agent_type = 'INDEPENDENT' and p_organization_id is not null then
    raise exception 'AGENTE_INDEPENDIENTE_CON_ORG: un comercial INDEPENDENT no pertenece a una organización; usa PARTNER_AGENT'
      using errcode = '23514';
  end if;

  if v_is_new then
    insert into platform.sales_agents (
      code, full_name, user_id, organization_id, agent_type, contact_email,
      status, valid_from, valid_to, metadata
    ) values (
      lower(trim(p_code)), trim(p_full_name), p_user_id, p_organization_id, p_agent_type,
      lower(nullif(trim(coalesce(p_contact_email, '')), '')), p_status,
      p_valid_from, p_valid_to, coalesce(p_metadata, '{}'::jsonb)
    )
    returning id into v_id;
  else
    update platform.sales_agents
       set code = lower(trim(p_code)), full_name = trim(p_full_name),
           user_id = p_user_id, organization_id = p_organization_id, agent_type = p_agent_type,
           contact_email = lower(nullif(trim(coalesce(p_contact_email, '')), '')),
           status = p_status, valid_from = p_valid_from, valid_to = p_valid_to,
           metadata = coalesce(p_metadata, '{}'::jsonb)
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'COMERCIAL_NO_ENCONTRADO: %', p_id using errcode = '23503';
    end if;
  end if;

  perform platform.log_audit(
    case when v_is_new then 'SALES_AGENT_CREATED' else 'SALES_AGENT_UPDATED' end,
    'sales_agent', v_id::text, p_organization_id, null,
    jsonb_build_object('code', p_code, 'agent_type', p_agent_type, 'status', p_status)
  );

  return v_id;
end;
$$;

comment on function platform.upsert_sales_agent is
  'Alta/edición de comercial. IMPORTANTE: crear un comercial NO crea ninguna '
  'tenant_membership. Comercial != acceso operativo (regla 6 del contrato V2).';

-- ---------------------------------------------------------------------------
-- create_sales_attribution — atribución comercial. El trigger
-- `sales_attributions_total_guard` ya impide superar el 100%; aquí se valida
-- antes para devolver un error legible en lugar de un fallo de constraint.
-- ---------------------------------------------------------------------------
create or replace function platform.create_sales_attribution(
  p_sales_agent_id           uuid,
  p_saas_product_id          uuid,
  p_customer_organization_id uuid,
  p_attribution_pct          numeric,
  p_tenant_id                uuid default null,
  p_subscription_id          uuid default null,
  p_channel_organization_id  uuid default null,
  p_source                   platform.attribution_source default 'DIRECT',
  p_commission_plan_id       uuid default null,
  p_valid_from               date default current_date,
  p_valid_to                 date default null,
  p_notes                    text default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id  uuid;
  v_sum numeric(10,4);
begin
  if not (
    platform.can_manage_commercial()
    or (p_channel_organization_id is not null and platform.is_org_admin(p_channel_organization_id))
  ) then
    raise exception 'NO_AUTORIZADO: no puede crear atribuciones comerciales' using errcode = '42501';
  end if;

  if p_attribution_pct is null or p_attribution_pct <= 0 or p_attribution_pct > 1 then
    raise exception 'PORCENTAJE_INVALIDO: attribution_pct debe estar en (0, 1]; recibido %', p_attribution_pct
      using errcode = '23514';
  end if;
  if not exists (select 1 from platform.sales_agents where id = p_sales_agent_id) then
    raise exception 'COMERCIAL_NO_ENCONTRADO: %', p_sales_agent_id using errcode = '23503';
  end if;

  -- Comprobación previa legible del mismo invariante que enforce_attribution_total.
  select coalesce(sum(a.attribution_pct), 0) into v_sum
    from platform.sales_attributions a
   where a.status = 'ACTIVE'
     and a.saas_product_id = p_saas_product_id
     and a.tenant_id is not distinct from p_tenant_id
     and a.subscription_id is not distinct from p_subscription_id
     and (a.valid_to is null or a.valid_to >= p_valid_from)
     and (p_valid_to is null or p_valid_to >= a.valid_from);

  if v_sum + p_attribution_pct > 1.0001 then
    raise exception 'ATRIBUCION_EXCEDIDA: ya hay % atribuido sobre este objeto y se pretende añadir %; el total no puede superar 1',
      v_sum, p_attribution_pct
      using errcode = '23514';
  end if;

  insert into platform.sales_attributions (
    sales_agent_id, saas_product_id, tenant_id, subscription_id, customer_organization_id,
    channel_organization_id, attribution_pct, source, commission_plan_id,
    valid_from, valid_to, status, notes
  ) values (
    p_sales_agent_id, p_saas_product_id, p_tenant_id, p_subscription_id, p_customer_organization_id,
    p_channel_organization_id, p_attribution_pct, p_source, p_commission_plan_id,
    p_valid_from, p_valid_to, 'ACTIVE', p_notes
  )
  returning id into v_id;

  perform platform.log_audit(
    'SALES_ATTRIBUTION_CREATED', 'sales_attribution', v_id::text,
    p_customer_organization_id, p_tenant_id,
    jsonb_build_object(
      'sales_agent_id', p_sales_agent_id, 'attribution_pct', p_attribution_pct,
      'source', p_source, 'commission_plan_id', p_commission_plan_id
    )
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- end_sales_attribution — cierra vigencia. No borra: las comisiones ya
-- devengadas apuntan a esta atribución y deben seguir siendo reconstruibles.
-- ---------------------------------------------------------------------------
create or replace function platform.end_sales_attribution(
  p_attribution_id uuid,
  p_valid_to       date default current_date,
  p_reason         text default null
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_attr record;
begin
  select * into v_attr from platform.sales_attributions where id = p_attribution_id;
  if v_attr is null then
    raise exception 'ATRIBUCION_NO_ENCONTRADA: %', p_attribution_id using errcode = '23503';
  end if;
  if not (
    platform.can_manage_commercial()
    or (v_attr.channel_organization_id is not null and platform.is_org_admin(v_attr.channel_organization_id))
  ) then
    raise exception 'NO_AUTORIZADO: no puede cerrar esta atribución' using errcode = '42501';
  end if;
  if p_valid_to < v_attr.valid_from then
    raise exception 'VIGENCIA_INVALIDA: el cierre (%) es anterior al inicio (%)', p_valid_to, v_attr.valid_from
      using errcode = '22007';
  end if;

  update platform.sales_attributions
     set valid_to = p_valid_to,
         status = 'INACTIVE',
         notes = coalesce(notes || E'\n', '') || 'Cerrada: ' || coalesce(p_reason, 'sin motivo')
   where id = p_attribution_id;

  perform platform.log_audit(
    'SALES_ATTRIBUTION_ENDED', 'sales_attribution', p_attribution_id::text,
    v_attr.customer_organization_id, v_attr.tenant_id,
    jsonb_build_object('valid_to', p_valid_to, 'reason', p_reason)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- upsert_commission_plan / upsert_commission_rule
--
-- Retroactividad: cambiar la tarifa de una regla ya usada reescribiría comisiones
-- pasadas. Por eso `upsert_commission_rule` NO deja editar `rate`, `basis` ni
-- `fixed_amount` de una regla que ya generó eventos: hay que crear una versión
-- nueva y cerrar la anterior con `deactivate_commission_rule`.
-- ---------------------------------------------------------------------------
create or replace function platform.upsert_commission_plan(
  p_code            text,
  p_name            text,
  p_saas_product_id uuid default null,
  p_description     text default null,
  p_status          platform.entity_status default 'ACTIVE',
  p_valid_from      date default current_date,
  p_valid_to        date default null,
  -- `p_id` va al final y con default: null = alta, valor = edición. Estar al
  -- final lo hace realmente OPCIONAL, y el generador de tipos lo refleja.
  p_id           uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id uuid;
  v_is_new boolean := p_id is null;
begin
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin definen planes de comisión'
      using errcode = '42501';
  end if;

  -- `commission_plans.code` usa is_slug(): ebim-internal, indep-standard.
  if not platform.is_slug(lower(trim(coalesce(p_code, '')))) then
    raise exception 'CODIGO_INVALIDO: "%" debe ser kebab-case en minúsculas (ej. indep-standard)', p_code
      using errcode = '23514';
  end if;

  if v_is_new then
    insert into platform.commission_plans (code, name, description, saas_product_id, status, valid_from, valid_to)
    values (lower(trim(p_code)), trim(p_name), p_description, p_saas_product_id, p_status, p_valid_from, p_valid_to)
    returning id into v_id;
  else
    update platform.commission_plans
       set code = lower(trim(p_code)), name = trim(p_name), description = p_description,
           saas_product_id = p_saas_product_id, status = p_status,
           valid_from = p_valid_from, valid_to = p_valid_to
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'PLAN_COMISION_NO_ENCONTRADO: %', p_id using errcode = '23503';
    end if;
  end if;

  perform platform.log_audit(
    case when v_is_new then 'COMMISSION_PLAN_CREATED' else 'COMMISSION_PLAN_UPDATED' end,
    'commission_plan', v_id::text, null, null,
    jsonb_build_object('code', p_code, 'status', p_status)
  );

  return v_id;
end;
$$;

create or replace function platform.upsert_commission_rule(
  p_commission_plan_id uuid,
  p_name               text,
  p_basis              platform.commission_basis,
  p_rate               numeric default null,
  p_fixed_amount       numeric default null,
  p_currency           char(3) default 'USD',
  p_charge_kind        platform.charge_kind default null,
  p_is_recurring       boolean default true,
  p_max_months         integer default null,
  p_max_total_amount   numeric default null,
  p_priority           integer default 100,
  p_valid_from         date default current_date,
  p_valid_to           date default null,
  p_status             platform.entity_status default 'ACTIVE',
  -- `p_id` va al final y con default: null = alta, valor = edición. Estar al
  -- final lo hace realmente OPCIONAL, y el generador de tipos lo refleja.
  p_id           uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id     uuid;
  v_is_new boolean := p_id is null;
  v_used   integer;
begin
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin definen reglas de comisión'
      using errcode = '42501';
  end if;

  if p_basis = 'FIXED_AMOUNT' then
    if coalesce(p_fixed_amount, 0) <= 0 then
      raise exception 'IMPORTE_FIJO_REQUERIDO: una regla FIXED_AMOUNT necesita fixed_amount > 0'
        using errcode = '23514';
    end if;
  else
    if p_rate is null or p_rate <= 0 or p_rate > 1 then
      raise exception 'TASA_INVALIDA: rate debe estar en (0, 1]; recibido %', p_rate using errcode = '23514';
    end if;
  end if;

  if v_is_new then
    insert into platform.commission_rules (
      commission_plan_id, name, basis, rate, fixed_amount, currency, charge_kind,
      is_recurring, max_months, max_total_amount, priority, valid_from, valid_to, status
    ) values (
      p_commission_plan_id, trim(p_name), p_basis, p_rate, p_fixed_amount, p_currency, p_charge_kind,
      coalesce(p_is_recurring, true), p_max_months, p_max_total_amount, p_priority,
      p_valid_from, p_valid_to, p_status
    )
    returning id into v_id;
  else
    -- Si la regla ya devengó comisiones, sus términos económicos son historia.
    select count(*) into v_used
      from platform.commission_events where commission_rule_id = p_id and status <> 'VOID';

    if v_used > 0 then
      if exists (
        select 1 from platform.commission_rules r
         where r.id = p_id
           and (r.basis is distinct from p_basis
             or r.rate is distinct from p_rate
             or r.fixed_amount is distinct from p_fixed_amount
             or r.charge_kind is distinct from p_charge_kind)
      ) then
        raise exception 'REGLA_YA_DEVENGADA: la regla % ya generó % comisión(es); no se pueden cambiar sus términos económicos retroactivamente. Cierra esta regla y crea una versión nueva.',
          p_id, v_used
          using errcode = '23514';
      end if;
    end if;

    update platform.commission_rules
       set name = trim(p_name), basis = p_basis, rate = p_rate, fixed_amount = p_fixed_amount,
           currency = p_currency, charge_kind = p_charge_kind,
           is_recurring = coalesce(p_is_recurring, true), max_months = p_max_months,
           max_total_amount = p_max_total_amount, priority = p_priority,
           valid_from = p_valid_from, valid_to = p_valid_to, status = p_status
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'REGLA_NO_ENCONTRADA: %', p_id using errcode = '23503';
    end if;
  end if;

  perform platform.log_audit(
    case when v_is_new then 'COMMISSION_RULE_CREATED' else 'COMMISSION_RULE_UPDATED' end,
    'commission_rule', v_id::text, null, null,
    jsonb_build_object('plan', p_commission_plan_id, 'basis', p_basis, 'rate', p_rate,
                       'fixed_amount', p_fixed_amount, 'is_recurring', p_is_recurring)
  );

  return v_id;
end;
$$;

comment on function platform.upsert_commission_rule is
  'Una regla que ya devengó comisiones no cambia de base/tasa: eso reescribiría el '
  'pasado. Se cierra con deactivate_commission_rule y se crea una versión nueva.';

create or replace function platform.deactivate_commission_rule(
  p_rule_id  uuid,
  p_valid_to date default current_date,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin cierran reglas de comisión'
      using errcode = '42501';
  end if;

  update platform.commission_rules
     set status = 'INACTIVE', valid_to = p_valid_to
   where id = p_rule_id;

  if not found then
    raise exception 'REGLA_NO_ENCONTRADA: %', p_rule_id using errcode = '23503';
  end if;

  perform platform.log_audit(
    'COMMISSION_RULE_DEACTIVATED', 'commission_rule', p_rule_id::text, null, null,
    jsonb_build_object('valid_to', p_valid_to, 'reason', p_reason)
  );
end;
$$;


-- ############################################################################
-- 6. SUSCRIPCIONES
-- ############################################################################

-- ---------------------------------------------------------------------------
-- create_subscription — contrato de cobro. La Fase 05 la envuelve en el
-- onboarding transaccional; aquí es la unidad reutilizable.
-- ---------------------------------------------------------------------------
create or replace function platform.create_subscription(
  p_billed_organization_id uuid,
  p_saas_product_id        uuid,
  p_plan_id                uuid,
  p_billing_interval       platform.billing_interval,
  p_currency               char(3),
  p_tenant_id              uuid default null,
  p_code                   text default null,
  p_quantity               integer default 1,
  p_started_on             date default current_date,
  p_ends_on                date default null,
  p_channel_margin_rate    numeric default null,
  p_status                 platform.subscription_status default 'DRAFT',
  p_notes                  text default null,
  p_metadata               jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id      uuid;
  v_code    text;
  v_product text;
begin
  if not platform.can_manage_commercial() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o EBIM_PRODUCT_ADMIN crean suscripciones'
      using errcode = '42501';
  end if;

  select code into v_product from platform.saas_products where id = p_saas_product_id;
  if v_product is null then
    raise exception 'PRODUCTO_NO_ENCONTRADO: %', p_saas_product_id using errcode = '23503';
  end if;
  if not exists (select 1 from platform.plans where id = p_plan_id and saas_product_id = p_saas_product_id) then
    raise exception 'PLAN_INCOMPATIBLE: el plan % no pertenece al producto %', p_plan_id, v_product
      using errcode = '23514';
  end if;
  if p_tenant_id is not null
     and not exists (select 1 from platform.tenants where id = p_tenant_id and saas_product_id = p_saas_product_id) then
    raise exception 'TENANT_INCOMPATIBLE: el tenant no pertenece al producto %', v_product using errcode = '23514';
  end if;
  if coalesce(p_channel_margin_rate, 0) < 0 or coalesce(p_channel_margin_rate, 0) > 1 then
    raise exception 'MARGEN_INVALIDO: channel_margin_rate debe estar en [0, 1]' using errcode = '23514';
  end if;

  -- Código legible y estable: SUB-<PRODUCTO>-<correlativo>. `subscriptions.code` no
  -- tiene CHECK is_slug(); el seed usa el estilo SUB-ALPHA-ESUP, así que se respeta.
  v_code := coalesce(
    nullif(trim(coalesce(p_code, '')), ''),
    'SUB-' || upper(v_product) || '-' || lpad((
      select coalesce(count(*), 0) + 1 from platform.subscriptions where saas_product_id = p_saas_product_id
    )::text, 4, '0')
  );

  insert into platform.subscriptions (
    code, billed_organization_id, saas_product_id, tenant_id, plan_id, status,
    billing_interval, currency, quantity, started_on, ends_on, channel_margin_rate, notes, metadata
  ) values (
    v_code, p_billed_organization_id, p_saas_product_id, p_tenant_id, p_plan_id, p_status,
    p_billing_interval, p_currency, coalesce(p_quantity, 1), p_started_on, p_ends_on,
    p_channel_margin_rate, p_notes, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  perform platform.log_audit(
    'SUBSCRIPTION_CREATED', 'subscription', v_id::text, p_billed_organization_id, p_tenant_id,
    jsonb_build_object('code', v_code, 'product', v_product, 'plan_id', p_plan_id,
                       'billing_interval', p_billing_interval, 'status', p_status)
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_subscription_status — activar/pausar/cancelar.
-- El trigger `subscriptions_demo_guard` bloquea activar recurrente sobre DEMO.
-- ---------------------------------------------------------------------------
create or replace function platform.set_subscription_status(
  p_subscription_id uuid,
  p_status          platform.subscription_status,
  p_reason          text default null
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_sub   record;
  v_valid boolean;
begin
  if not platform.can_manage_commercial() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o EBIM_PRODUCT_ADMIN cambian el estado de una suscripción'
      using errcode = '42501';
  end if;

  select * into v_sub from platform.subscriptions where id = p_subscription_id;
  if v_sub is null then
    raise exception 'SUSCRIPCION_NO_ENCONTRADA: %', p_subscription_id using errcode = '23503';
  end if;
  if v_sub.status = p_status then
    return;
  end if;

  v_valid := case v_sub.status
    when 'DRAFT'     then p_status in ('ACTIVE', 'CANCELLED')
    when 'ACTIVE'    then p_status in ('PAST_DUE', 'PAUSED', 'CANCELLED')
    when 'PAST_DUE'  then p_status in ('ACTIVE', 'PAUSED', 'CANCELLED')
    when 'PAUSED'    then p_status in ('ACTIVE', 'CANCELLED')
    else false  -- CANCELLED es terminal
  end;

  if not v_valid then
    raise exception 'TRANSICION_SUSCRIPCION_INVALIDA: no se puede pasar de % a %', v_sub.status, p_status
      using errcode = '23514';
  end if;

  update platform.subscriptions
     set status = p_status,
         cancelled_at = case when p_status = 'CANCELLED' then now() else cancelled_at end,
         notes = case when p_reason is null then notes
                      else coalesce(notes || E'\n', '') || p_status || ': ' || p_reason end
   where id = p_subscription_id;

  perform platform.log_audit(
    'SUBSCRIPTION_STATUS_CHANGED', 'subscription', p_subscription_id::text,
    v_sub.billed_organization_id, v_sub.tenant_id,
    jsonb_build_object('from', v_sub.status, 'to', p_status, 'reason', p_reason)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- upsert_subscription_item — línea de licencia, fee o addon.
-- ---------------------------------------------------------------------------
create or replace function platform.upsert_subscription_item(
  p_subscription_id   uuid,
  p_charge_kind       platform.charge_kind,
  p_description       text,
  p_quantity          numeric,
  p_unit_amount       numeric,
  p_billing_interval  platform.billing_interval,
  p_currency          char(3) default null,
  p_tenant_id         uuid default null,
  p_catalog_item_code text default null,
  p_valid_from        date default current_date,
  p_valid_to          date default null,
  -- `p_id` va al final y con default: null = alta, valor = edición. Estar al
  -- final lo hace realmente OPCIONAL, y el generador de tipos lo refleja.
  p_id           uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id  uuid;
  v_sub record;
  v_is_new boolean := p_id is null;
begin
  if not platform.can_manage_commercial() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o EBIM_PRODUCT_ADMIN editan líneas de suscripción'
      using errcode = '42501';
  end if;

  select * into v_sub from platform.subscriptions where id = p_subscription_id;
  if v_sub is null then
    raise exception 'SUSCRIPCION_NO_ENCONTRADA: %', p_subscription_id using errcode = '23503';
  end if;
  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'CANTIDAD_INVALIDA: quantity debe ser > 0' using errcode = '23514';
  end if;
  if coalesce(p_unit_amount, -1) < 0 then
    raise exception 'IMPORTE_INVALIDO: unit_amount no puede ser negativo' using errcode = '23514';
  end if;

  -- Un fee de implementación es ONE_TIME por definición: si entrara como MONTHLY
  -- inflaría el MRR para siempre (gap D-2 de la GAP_MATRIX).
  if p_charge_kind = 'IMPLEMENTATION_FEE' and p_billing_interval <> 'ONE_TIME' then
    raise exception 'FEE_IMPLEMENTACION_RECURRENTE: IMPLEMENTATION_FEE debe ser ONE_TIME; recurrente inflaría el MRR'
      using errcode = '23514';
  end if;

  if v_is_new then
    insert into platform.subscription_items (
      subscription_id, charge_kind, description, quantity, unit_amount, currency,
      billing_interval, tenant_id, catalog_item_code, valid_from, valid_to
    ) values (
      p_subscription_id, p_charge_kind, trim(p_description), p_quantity, p_unit_amount,
      coalesce(p_currency, v_sub.currency), p_billing_interval,
      coalesce(p_tenant_id, v_sub.tenant_id), p_catalog_item_code, p_valid_from, p_valid_to
    )
    returning id into v_id;
  else
    update platform.subscription_items
       set charge_kind = p_charge_kind, description = trim(p_description),
           quantity = p_quantity, unit_amount = p_unit_amount,
           currency = coalesce(p_currency, currency), billing_interval = p_billing_interval,
           tenant_id = coalesce(p_tenant_id, tenant_id), catalog_item_code = p_catalog_item_code,
           valid_from = p_valid_from, valid_to = p_valid_to
     where id = p_id and subscription_id = p_subscription_id
    returning id into v_id;
    if v_id is null then
      raise exception 'LINEA_NO_ENCONTRADA: % en la suscripción %', p_id, p_subscription_id
        using errcode = '23503';
    end if;
  end if;

  perform platform.log_audit(
    case when v_is_new then 'SUBSCRIPTION_ITEM_CREATED' else 'SUBSCRIPTION_ITEM_UPDATED' end,
    'subscription_item', v_id::text, v_sub.billed_organization_id, v_sub.tenant_id,
    jsonb_build_object('subscription_id', p_subscription_id, 'charge_kind', p_charge_kind,
                       'quantity', p_quantity, 'unit_amount', p_unit_amount,
                       'billing_interval', p_billing_interval)
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- end_subscription_item — cierra la vigencia de una línea. No borra: puede
-- haber `invoice_lines` que la referencian.
-- ---------------------------------------------------------------------------
create or replace function platform.end_subscription_item(
  p_item_id  uuid,
  p_valid_to date default current_date
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_item record;
begin
  if not platform.can_manage_commercial() then
    raise exception 'NO_AUTORIZADO' using errcode = '42501';
  end if;

  select si.*, s.billed_organization_id into v_item
    from platform.subscription_items si
    join platform.subscriptions s on s.id = si.subscription_id
   where si.id = p_item_id;

  if v_item is null then
    raise exception 'LINEA_NO_ENCONTRADA: %', p_item_id using errcode = '23503';
  end if;

  update platform.subscription_items set valid_to = p_valid_to where id = p_item_id;

  perform platform.log_audit(
    'SUBSCRIPTION_ITEM_ENDED', 'subscription_item', p_item_id::text,
    v_item.billed_organization_id, v_item.tenant_id,
    jsonb_build_object('valid_to', p_valid_to)
  );
end;
$$;


-- ############################################################################
-- 7. INFRAESTRUCTURA — targets y provisioning
-- ############################################################################

create or replace function platform.upsert_deployment_target(
  p_code                 text,
  p_name                 text,
  p_provider             platform.infra_provider,
  p_deployment_mode      platform.deployment_mode,
  p_environment          platform.environment_kind default 'PRODUCTION',
  p_region               text default null,
  p_provider_project_ref text default null,
  p_owner_organization_id uuid default null,
  p_saas_product_id      uuid default null,
  p_cost_center          text default null,
  p_status               platform.entity_status default 'ACTIVE',
  p_metadata             jsonb default '{}'::jsonb,
  -- `p_id` va al final y con default: null = alta, valor = edición. Estar al
  -- final lo hace realmente OPCIONAL, y el generador de tipos lo refleja.
  p_id           uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id uuid;
  v_is_new boolean := p_id is null;
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: solo EBIM administra infraestructura' using errcode = '42501';
  end if;

  -- `deployment_targets.code` usa is_slug(): shared-esupplier-sa-east.
  if not platform.is_slug(lower(trim(coalesce(p_code, '')))) then
    raise exception 'CODIGO_INVALIDO: "%" debe ser kebab-case en minúsculas (ej. shared-esupplier-sa-east)', p_code
      using errcode = '23514';
  end if;

  -- Coherencia dueño/modo: un target dedicado sin dueño no es dedicado de nadie.
  if p_deployment_mode in ('PARTNER_DEDICATED', 'TENANT_DEDICATED') and p_owner_organization_id is null then
    raise exception 'TARGET_DEDICADO_SIN_DUENO: un target % exige owner_organization_id', p_deployment_mode
      using errcode = '23514';
  end if;
  if p_deployment_mode = 'SHARED' and p_owner_organization_id is not null then
    raise exception 'TARGET_COMPARTIDO_CON_DUENO: un target SHARED no pertenece a una organización concreta'
      using errcode = '23514';
  end if;

  -- El trigger `deployment_targets_no_secrets` ya rechaza claves sospechosas en
  -- metadata; aquí se refuerza el mensaje para que la UI lo explique bien.
  if p_metadata ?| array['secret_key', 'service_role_key', 'password', 'db_url'] then
    raise exception 'TARGET_CON_SECRETO: un deployment target guarda referencias, nunca credenciales'
      using errcode = '42501';
  end if;

  if v_is_new then
    insert into platform.deployment_targets (
      code, name, provider, deployment_mode, environment, region, provider_project_ref,
      owner_organization_id, saas_product_id, status, cost_center, metadata
    ) values (
      lower(trim(p_code)), trim(p_name), p_provider, p_deployment_mode, p_environment, p_region,
      p_provider_project_ref, p_owner_organization_id, p_saas_product_id, p_status, p_cost_center,
      coalesce(p_metadata, '{}'::jsonb)
    )
    returning id into v_id;
  else
    update platform.deployment_targets
       set name = trim(p_name), provider = p_provider, deployment_mode = p_deployment_mode,
           environment = p_environment, region = p_region, provider_project_ref = p_provider_project_ref,
           owner_organization_id = p_owner_organization_id, saas_product_id = p_saas_product_id,
           status = p_status, cost_center = p_cost_center, metadata = coalesce(p_metadata, '{}'::jsonb)
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'TARGET_NO_ENCONTRADO: %', p_id using errcode = '23503';
    end if;
  end if;

  perform platform.log_audit(
    case when v_is_new then 'DEPLOYMENT_TARGET_CREATED' else 'DEPLOYMENT_TARGET_UPDATED' end,
    'deployment_target', v_id::text, p_owner_organization_id, null,
    jsonb_build_object('code', p_code, 'mode', p_deployment_mode, 'provider', p_provider)
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- attach_tenant_to_target — el trigger `tenant_deployments_coherence_guard`
-- impone la coherencia dura (modo, producto, dueño, exclusividad). Aquí solo se
-- añade autorización y auditoría.
-- ---------------------------------------------------------------------------
create or replace function platform.attach_tenant_to_target(
  p_tenant_id           uuid,
  p_deployment_target_id uuid,
  p_is_primary          boolean default true,
  p_notes               text default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id     uuid;
  v_tenant record;
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: solo EBIM adjunta tenants a infraestructura' using errcode = '42501';
  end if;

  select * into v_tenant from platform.tenants where id = p_tenant_id;
  if v_tenant is null then
    raise exception 'TENANT_NO_ENCONTRADO: %', p_tenant_id using errcode = '23503';
  end if;

  -- Si ya está adjunto a ese target, no se duplica el vínculo.
  select id into v_id
    from platform.tenant_deployments
   where tenant_id = p_tenant_id and deployment_target_id = p_deployment_target_id;

  if v_id is not null then
    update platform.tenant_deployments
       set status = 'ACTIVE', is_primary = coalesce(p_is_primary, is_primary), notes = p_notes
     where id = v_id;
  else
    -- Un tenant tiene un solo despliegue primario activo (índice parcial del baseline).
    if coalesce(p_is_primary, true) then
      update platform.tenant_deployments
         set is_primary = false
       where tenant_id = p_tenant_id and is_primary and status = 'ACTIVE';
    end if;

    insert into platform.tenant_deployments (
      tenant_id, deployment_target_id, is_primary, status, deployed_at, notes
    ) values (
      p_tenant_id, p_deployment_target_id, coalesce(p_is_primary, true), 'ACTIVE', now(), p_notes
    )
    returning id into v_id;
  end if;

  perform platform.log_audit(
    'TENANT_ATTACHED_TO_TARGET', 'tenant_deployment', v_id::text,
    v_tenant.customer_organization_id, p_tenant_id,
    jsonb_build_object('deployment_target_id', p_deployment_target_id, 'is_primary', p_is_primary)
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- enqueue_provisioning_request — encola trabajo para el worker.
--
-- DRY_RUN es el DEFAULT y así se queda hasta que el operador autorice LIVE
-- (regla 14 del contrato V2). La `idempotency_key` es determinista, así que
-- pulsar dos veces "Aprovisionar" devuelve la MISMA solicitud, no dos.
-- ---------------------------------------------------------------------------
create or replace function platform.enqueue_provisioning_request(
  p_action               platform.provisioning_action,
  p_tenant_id            uuid default null,
  p_deployment_target_id uuid default null,
  p_saas_product_id      uuid default null,
  p_mode                 text default 'DRY_RUN',
  p_payload              jsonb default '{}'::jsonb,
  p_idempotency_key      text default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id      uuid;
  v_key     text;
  v_tenant  record;
  v_existing uuid;
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: solo EBIM encola provisioning' using errcode = '42501';
  end if;

  if p_mode not in ('DRY_RUN', 'LIVE') then
    raise exception 'MODO_INVALIDO: mode debe ser DRY_RUN o LIVE; recibido "%"', p_mode using errcode = '23514';
  end if;
  -- LIVE toca infraestructura real: solo el super admin puede pedirlo.
  if p_mode = 'LIVE' and not platform.is_super_admin() then
    raise exception 'LIVE_NO_AUTORIZADO: el provisioning LIVE requiere el super admin de la suite (contrato §13)'
      using errcode = '42501';
  end if;

  if p_tenant_id is not null then
    select * into v_tenant from platform.tenants where id = p_tenant_id;
    if v_tenant is null then
      raise exception 'TENANT_NO_ENCONTRADO: %', p_tenant_id using errcode = '23503';
    end if;
  end if;

  v_key := coalesce(
    nullif(trim(coalesce(p_idempotency_key, '')), ''),
    p_action::text || ':' || coalesce(p_tenant_id::text, '-') || ':'
      || coalesce(p_deployment_target_id::text, '-') || ':' || p_mode
  );

  select id into v_existing from platform.provisioning_requests where idempotency_key = v_key;
  if v_existing is not null then
    return v_existing;  -- Idempotente: la misma intención no encola dos veces.
  end if;

  insert into platform.provisioning_requests (
    idempotency_key, action, status, mode, tenant_id, deployment_target_id,
    saas_product_id, requested_by, payload
  ) values (
    v_key, p_action, 'PENDING', p_mode, p_tenant_id, p_deployment_target_id,
    coalesce(p_saas_product_id, v_tenant.saas_product_id), auth.uid(),
    coalesce(p_payload, '{}'::jsonb)
  )
  returning id into v_id;

  insert into platform.provisioning_events (provisioning_request_id, status, message, detail)
  values (v_id, 'PENDING', 'Solicitud encolada desde la consola', jsonb_build_object('mode', p_mode));

  perform platform.log_audit(
    'PROVISIONING_ENQUEUED', 'provisioning_request', v_id::text,
    v_tenant.customer_organization_id, p_tenant_id,
    jsonb_build_object('action', p_action, 'mode', p_mode, 'idempotency_key', v_key)
  );

  return v_id;
end;
$$;

comment on function platform.enqueue_provisioning_request is
  'Encola una acción de provisioning. DRY_RUN por defecto; LIVE exige super admin. '
  'La clave de idempotencia evita encolar dos veces la misma intención.';

-- ---------------------------------------------------------------------------
-- retry_provisioning_request — reintento como solicitud NUEVA que referencia a
-- la fallida. No se muta el historial de la original.
-- ---------------------------------------------------------------------------
create or replace function platform.retry_provisioning_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_old record;
  v_new uuid;
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO' using errcode = '42501';
  end if;

  select * into v_old from platform.provisioning_requests where id = p_request_id;
  if v_old is null then
    raise exception 'SOLICITUD_NO_ENCONTRADA: %', p_request_id using errcode = '23503';
  end if;
  if v_old.status <> 'FAILED' then
    raise exception 'REINTENTO_INVALIDO: solo se reintenta una solicitud FAILED (esta está %)', v_old.status
      using errcode = '23514';
  end if;

  v_new := platform.enqueue_provisioning_request(
    v_old.action, v_old.tenant_id, v_old.deployment_target_id, v_old.saas_product_id, v_old.mode,
    v_old.payload || jsonb_build_object('retry_of', p_request_id::text),
    v_old.idempotency_key || ':retry:' || extract(epoch from now())::bigint::text
  );

  perform platform.log_audit(
    'PROVISIONING_RETRIED', 'provisioning_request', v_new::text,
    null, v_old.tenant_id,
    jsonb_build_object('retry_of', p_request_id, 'action', v_old.action)
  );

  return v_new;
end;
$$;


-- ############################################################################
-- 8. GRANTS — revocar a public/anon, conceder lo mínimo
-- ############################################################################
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'platform'
       and p.proname in (
         'can_manage_commercial',
         'upsert_saas_product', 'archive_saas_product',
         'upsert_plan', 'set_plan_price', 'upsert_catalog_item',
         'upsert_organization', 'upsert_company',
         'set_tenant_status', 'update_tenant', 'set_tenant_feature',
         'upsert_sales_agent', 'create_sales_attribution', 'end_sales_attribution',
         'upsert_commission_plan', 'upsert_commission_rule', 'deactivate_commission_rule',
         'create_subscription', 'set_subscription_status',
         'upsert_subscription_item', 'end_subscription_item',
         'upsert_deployment_target', 'attach_tenant_to_target',
         'enqueue_provisioning_request', 'retry_provisioning_request'
       )
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;
