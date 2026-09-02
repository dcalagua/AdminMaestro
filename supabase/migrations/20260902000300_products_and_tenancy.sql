-- ============================================================================
-- EBIM Control Plane — 03 · Catálogo SaaS, acuerdos de producto y tenancy
-- ----------------------------------------------------------------------------
--   Invariantes (prompt fase 3):
--     Organization != database · Tenant != database
--     Tenant es específico de UN SaaS · Organization participa en varios SaaS
--   C-12  catálogo central de addons (contrato §5/§6)
--   C-08  config en 3 capas con deep merge (hub §2)
--   C-10  ADMIN_EMAIL_REQUERIDO en el alta de tenant (contrato §3.2) -> mig. 11
-- ============================================================================

-- ---------------------------------------------------------------------------
-- saas_products — catálogo. Añadir un SaaS = INSERT, nunca una columna nueva.
-- ---------------------------------------------------------------------------
create table platform.saas_products (
  id             uuid primary key default gen_random_uuid(),
  code           text not null,
  name           text not null,
  short_name     text not null,
  description    text,
  -- Lockup del contrato §4.6: "<Producto> by EBIM".
  lockup_name    text generated always as (short_name || ' by EBIM') stored,
  accent_color   text,
  status         platform.entity_status not null default 'ACTIVE',
  is_billable    boolean not null default true,
  -- Unidad de cobro: la suite NO es homogénea (contrato §11.1: WMS cobra por
  -- almacén, no por sociedad). Se declara por producto en vez de asumirla.
  billing_unit   text not null default 'TENANT',
  sort_order     integer not null default 100,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint saas_products_code_ck check (platform.is_slug(code)),
  constraint saas_products_accent_ck check (accent_color is null or accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint saas_products_billing_unit_ck
    check (billing_unit in ('TENANT', 'COMPANY', 'WAREHOUSE', 'USER'))
);

create unique index saas_products_code_uk on platform.saas_products (code);
create trigger saas_products_set_updated_at before update on platform.saas_products
  for each row execute function platform.set_updated_at();

comment on table platform.saas_products is
  'Catálogo de SaaS EBIM. PROHIBIDO añadir columnas is_esupplier/is_wms: un producto '
  'nuevo es una FILA (prompt fase 3).';
comment on column platform.saas_products.billing_unit is
  'Contrato §11.1: la unidad de cobro varía por producto (TENANT, COMPANY, WAREHOUSE). '
  'Lo canónico es la jerarquía y los nombres de addon, no la unidad.';

-- ---------------------------------------------------------------------------
-- organization_product_agreements — qué SaaS puede comercializar/administrar
-- una organización, y bajo qué condiciones (contrato §11.1)
-- ---------------------------------------------------------------------------
create table platform.organization_product_agreements (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references platform.organizations (id) on delete cascade,
  saas_product_id       uuid not null references platform.saas_products (id) on delete restrict,
  -- Qué puede hacer con ese producto.
  can_resell            boolean not null default false,
  can_manage_tenants    boolean not null default true,
  -- Margen que retiene el canal sobre la licencia (0..1). Distinto de la comisión
  -- del comercial: el margen es del canal, la comisión es de la persona.
  margin_rate           numeric(6,4) not null default 0,
  default_deployment_mode platform.deployment_mode not null default 'SHARED',
  valid_from            date not null default current_date,
  valid_to              date,
  status                platform.entity_status not null default 'ACTIVE',
  -- Condiciones específicas por producto (pueden diferir entre eSupplier y EWM
  -- para el MISMO partner — contrato §11.1 / prompt fase 5 caso C).
  terms                 jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint opa_margin_ck check (margin_rate >= 0 and margin_rate <= 1),
  constraint opa_period_ck check (valid_to is null or valid_to >= valid_from)
);

create unique index opa_active_uk
  on platform.organization_product_agreements (organization_id, saas_product_id)
  where status = 'ACTIVE';
create index opa_product_ix on platform.organization_product_agreements (saas_product_id);
create trigger opa_set_updated_at before update on platform.organization_product_agreements
  for each row execute function platform.set_updated_at();

comment on table platform.organization_product_agreements is
  'Habilita a una organización para un SaaS. Un partner multi-SaaS tiene N filas, cada '
  'una con margen/condiciones propias (prompt fase 5, caso C).';

-- ---------------------------------------------------------------------------
-- tenants — espacio de UN producto SaaS para UNA organización cliente
-- ---------------------------------------------------------------------------
create table platform.tenants (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text not null,
  name                    text not null,
  saas_product_id         uuid not null references platform.saas_products (id) on delete restrict,
  customer_organization_id uuid not null references platform.organizations (id) on delete restrict,
  -- Partner/consultora que lo administra. NULL = venta directa EBIM.
  -- NO se usa parent_tenant_id: el modelo partner es organizacional (prompt fase 5).
  managing_organization_id uuid references platform.organizations (id) on delete restrict,
  -- Sociedad concreta del cliente (contrato §3.1 Modelo A). Opcional.
  company_id              uuid references platform.companies (id) on delete set null,
  tenant_type             platform.tenant_type not null default 'PRODUCTION',
  status                  platform.tenant_status not null default 'PENDING',
  deployment_mode         platform.deployment_mode not null default 'SHARED',
  environment             platform.environment_kind not null default 'PRODUCTION',
  -- Correo del administrador nombrado en el alta (contrato §3.2).
  admin_email             text not null,
  admin_activated_at      timestamptz,
  accent_color            text,
  logo_url                text,
  white_label             boolean not null default false,
  activated_at            timestamptz,
  churned_at              timestamptz,
  metadata                jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint tenants_slug_ck check (platform.is_slug(slug)),
  constraint tenants_admin_email_ck
    check (admin_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-zA-Z]{2,}$'),
  -- Contrato §13.2: el dominio operador nunca es actor de negocio de un cliente.
  constraint tenants_admin_not_operator_ck check (admin_email not like '%@ebim.pe'),
  constraint tenants_accent_ck check (accent_color is null or accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  -- El partner que administra no puede ser el propio cliente.
  constraint tenants_manager_not_customer_ck
    check (managing_organization_id is null or managing_organization_id <> customer_organization_id)
);

-- El slug es único POR PRODUCTO: "alpha" puede existir en eSupplier y en EWM.
create unique index tenants_product_slug_uk on platform.tenants (saas_product_id, slug);
create index tenants_customer_ix on platform.tenants (customer_organization_id);
create index tenants_manager_ix on platform.tenants (managing_organization_id)
  where managing_organization_id is not null;
create index tenants_product_status_ix on platform.tenants (saas_product_id, status);
create index tenants_deployment_mode_ix on platform.tenants (deployment_mode);
create index tenants_type_ix on platform.tenants (tenant_type);
create trigger tenants_set_updated_at before update on platform.tenants
  for each row execute function platform.set_updated_at();

comment on table platform.tenants is
  'Tenant = espacio de UN SaaS para UNA organización cliente. Tenant != base de datos: '
  'el aislamiento físico lo decide deployment_mode + tenant_deployments.';
comment on column platform.tenants.admin_email is
  'Contrato §3.2: el alta EXIGE administrador nombrado. NOT NULL + CHECK aquí, y '
  'validación explícita con error ADMIN_EMAIL_REQUERIDO en platform.create_tenant().';
comment on column platform.tenants.managing_organization_id is
  'Partner/consultora que administra. NULL = venta directa EBIM. Reemplaza a un '
  'parent_tenant_id, que confundiría jerarquía comercial con infraestructura.';

-- La organización que administra debe tener acuerdo ACTIVO para ese producto.
create or replace function platform.enforce_tenant_manager_agreement()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if new.managing_organization_id is null then
    return new;
  end if;

  if not exists (
    select 1
      from platform.organization_product_agreements a
     where a.organization_id = new.managing_organization_id
       and a.saas_product_id = new.saas_product_id
       and a.status = 'ACTIVE'
       and a.can_manage_tenants
       and a.valid_from <= current_date
       and (a.valid_to is null or a.valid_to >= current_date)
  ) then
    raise exception 'PARTNER_SIN_ACUERDO: la organización % no tiene acuerdo activo para administrar tenants del producto %',
      new.managing_organization_id, new.saas_product_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger tenants_manager_agreement_guard
  before insert or update of managing_organization_id, saas_product_id on platform.tenants
  for each row execute function platform.enforce_tenant_manager_agreement();

-- ---------------------------------------------------------------------------
-- tenant_memberships — usuario ↔ tenant. Un comercial NO entra por aquí (§2.3).
-- ---------------------------------------------------------------------------
create table platform.tenant_memberships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references platform.profiles (id) on delete cascade,
  tenant_id   uuid not null references platform.tenants (id) on delete cascade,
  role        platform.tenant_role not null default 'TENANT_USER',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index tenant_memberships_uk on platform.tenant_memberships (user_id, tenant_id);
create index tenant_memberships_tenant_ix on platform.tenant_memberships (tenant_id) where is_active;
create index tenant_memberships_user_ix on platform.tenant_memberships (user_id) where is_active;
create trigger tenant_memberships_set_updated_at before update on platform.tenant_memberships
  for each row execute function platform.set_updated_at();

comment on table platform.tenant_memberships is
  'Acceso OPERACIONAL a un tenant. Regla de negocio §2.3: haber vendido un tenant NO '
  'crea una fila aquí. La atribución comercial vive en sales_attributions.';

-- ---------------------------------------------------------------------------
-- tenant_features — feature flags por tenant
-- ---------------------------------------------------------------------------
create table platform.tenant_features (
  tenant_id    uuid not null references platform.tenants (id) on delete cascade,
  feature_key  text not null,
  enabled      boolean not null default false,
  -- Origen del flag: PLAN (viene del plan), ADDON (contratado), MANUAL (operador).
  source       text not null default 'MANUAL',
  value        jsonb not null default '{}'::jsonb,
  updated_by   uuid references platform.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (tenant_id, feature_key),
  constraint tenant_features_key_ck check (feature_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  constraint tenant_features_source_ck check (source in ('PLAN', 'ADDON', 'MANUAL'))
);

create trigger tenant_features_set_updated_at before update on platform.tenant_features
  for each row execute function platform.set_updated_at();

-- ---------------------------------------------------------------------------
-- tenant_settings — override de config por tenant (capa más específica)
-- ---------------------------------------------------------------------------
create table platform.tenant_settings (
  tenant_id  uuid primary key references platform.tenants (id) on delete cascade,
  config     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tenant_settings_set_updated_at before update on platform.tenant_settings
  for each row execute function platform.set_updated_at();

comment on table platform.tenant_settings is
  'Contrato §4.1: shape { branding, fiscal, locale, workflow, features, custom_fields }. '
  'Claves propias de cada app bajo su namespace (esupplier.*, gmao.*).';

-- ---------------------------------------------------------------------------
-- Config en 3 capas (hub §2) — default plataforma → organización → sociedad
-- ---------------------------------------------------------------------------
create table platform.platform_defaults (
  id         integer primary key default 1,
  config     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint platform_defaults_singleton_ck check (id = 1)
);

create table platform.org_config (
  organization_id uuid primary key references platform.organizations (id) on delete cascade,
  config          jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);

create table platform.company_config (
  company_id uuid primary key references platform.companies (id) on delete cascade,
  config     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Merge recursivo de JSONB: las claves de `b` ganan, los objetos anidados se fusionan.
-- Copiado del hub EBIM (EBIM-DISENO-HUB-IDENTIDAD.md §2) para no divergir.
create or replace function platform.jsonb_deep_merge(a jsonb, b jsonb)
returns jsonb
language sql
immutable
set search_path = platform, pg_catalog
as $$
  select case
    when a is null then b
    when b is null then a
    when jsonb_typeof(a) <> 'object' or jsonb_typeof(b) <> 'object' then b
    else (
      select coalesce(
        jsonb_object_agg(
          k,
          case
            when a ? k and b ? k then platform.jsonb_deep_merge(a -> k, b -> k)
            when b ? k then b -> k
            else a -> k
          end
        ),
        '{}'::jsonb
      )
      from (
        select jsonb_object_keys(a) as k
        union
        select jsonb_object_keys(b)
      ) keys
    )
  end;
$$;

comment on function platform.jsonb_deep_merge(jsonb, jsonb) is
  'Deep merge de config (hub EBIM §2). Implementación 1:1 con el hub para no divergir.';

-- Config EFECTIVA de una sociedad = default → org → company.
create or replace function platform.effective_config(p_company uuid)
returns jsonb
language sql
stable
set search_path = platform, pg_catalog
as $$
  select platform.jsonb_deep_merge(
    platform.jsonb_deep_merge(
      coalesce((select d.config from platform.platform_defaults d where d.id = 1), '{}'::jsonb),
      coalesce((
        select oc.config
          from platform.companies cm
          join platform.org_config oc on oc.organization_id = cm.organization_id
         where cm.id = p_company
      ), '{}'::jsonb)
    ),
    coalesce((select cc.config from platform.company_config cc where cc.company_id = p_company), '{}'::jsonb)
  );
$$;

-- Config efectiva de un TENANT = capas de la sociedad + override del tenant.
create or replace function platform.effective_tenant_config(p_tenant uuid)
returns jsonb
language sql
stable
set search_path = platform, pg_catalog
as $$
  select platform.jsonb_deep_merge(
    coalesce(
      platform.effective_config((select t.company_id from platform.tenants t where t.id = p_tenant)),
      coalesce((select d.config from platform.platform_defaults d where d.id = 1), '{}'::jsonb)
    ),
    coalesce((select ts.config from platform.tenant_settings ts where ts.tenant_id = p_tenant), '{}'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- catalog_items / tenant_addons / workspace_apps — nombres del hub (contrato §6)
-- ---------------------------------------------------------------------------
create table platform.catalog_items (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  name            text not null,
  description     text,
  saas_product_id uuid references platform.saas_products (id) on delete cascade,
  item_type       text not null default 'addon',
  -- Contrato §11.1: el catálogo marca el scope, el operador no elige caso a caso.
  scope           text not null default 'per-company',
  available       boolean not null default false,
  price_month     numeric(14,2) not null default 0,
  currency        char(3) not null default 'USD',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint catalog_items_code_ck check (code ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  constraint catalog_items_scope_ck check (scope in ('org-wide', 'per-company')),
  constraint catalog_items_type_ck check (item_type in ('addon', 'connector', 'module', 'service')),
  constraint catalog_items_price_ck check (price_month >= 0),
  constraint catalog_items_currency_ck check (currency ~ '^[A-Z]{3}$')
);

create unique index catalog_items_code_uk on platform.catalog_items (code);
create trigger catalog_items_set_updated_at before update on platform.catalog_items
  for each row execute function platform.set_updated_at();

comment on column platform.catalog_items.scope is
  'Contrato §11.1: addon.scope ∈ {org-wide, per-company}.';

create table platform.tenant_addons (
  tenant_id   uuid not null references platform.tenants (id) on delete cascade,
  addon_code  text not null references platform.catalog_items (code) on update cascade on delete restrict,
  active      boolean not null default true,
  activated_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, addon_code)
);

create trigger tenant_addons_set_updated_at before update on platform.tenant_addons
  for each row execute function platform.set_updated_at();

comment on table platform.tenant_addons is
  'Activación de addons. Contrato §2.6 lección 1: el PRECIO no vive aquí — vive en '
  'catalog_items, donde el tenant no tiene GRANT de escritura. RLS decide filas, no columnas.';

create table platform.workspace_apps (
  organization_id uuid not null references platform.organizations (id) on delete cascade,
  saas_product_id uuid not null references platform.saas_products (id) on delete cascade,
  status          text not null default 'requested',
  activated_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (organization_id, saas_product_id),
  constraint workspace_apps_status_ck check (status in ('requested', 'active', 'suspended'))
);

create trigger workspace_apps_set_updated_at before update on platform.workspace_apps
  for each row execute function platform.set_updated_at();

comment on table platform.workspace_apps is
  'Qué apps de la suite tiene activas una cuenta (hub §1). Alimenta también la vitrina '
  'cruzada del contrato §6.1: lo que NO está aquí es candidato a cross-sell.';
