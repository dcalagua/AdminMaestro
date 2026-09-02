-- ============================================================================
-- EBIM Control Plane — 02 · Identidad, organizaciones y sociedades
-- ----------------------------------------------------------------------------
--   C-03  columnas `organization_id` / `company_id` con nombre exacto
--   C-04  `erp_code` es atributo, NUNCA clave de sociedad
--   S-01  Super Admin único `dcalagua@ebim.pe` (enforcement en DB)
--   S-02  dominio operador único = `ebim.pe`
--   D-006 capacidades por relación, no enum rígido
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles — espejo mínimo de auth.users para poder mostrar nombres sin
-- exponer auth.users a PostgREST.
-- ---------------------------------------------------------------------------
create table platform.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  full_name     text,
  avatar_url    text,
  -- Apariencia por usuario: SOLO modo y densidad (contrato §4.4).
  -- El color/accent nunca es elegible por el usuario.
  settings      jsonb not null default '{"appearance":{"mode":"light","density":"equilibrada"}}'::jsonb,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint profiles_email_lower_ck check (email = lower(email))
);

create unique index profiles_email_uk on platform.profiles (email);
create trigger profiles_set_updated_at before update on platform.profiles
  for each row execute function platform.set_updated_at();

comment on table platform.profiles is
  'Perfil público mínimo del usuario. auth.users nunca se expone vía PostgREST.';
comment on column platform.profiles.settings is
  'Contrato §4.4: appearance = { mode, density }. El accent NO va aquí: lo fija el tenant.';

-- Alta automática del profile al crearse el usuario en auth.
create or replace function platform.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  insert into platform.profiles (id, email, full_name)
  values (
    new.id,
    lower(new.email),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

comment on function platform.handle_new_user() is
  'Trigger en auth.users: crea/actualiza platform.profiles. SECURITY DEFINER porque '
  'escribe en platform desde el contexto de GoTrue.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function platform.handle_new_user();

-- ---------------------------------------------------------------------------
-- platform_admins — roles de CONSOLA del operador (contrato §13)
-- ---------------------------------------------------------------------------
create table platform.platform_admins (
  user_id     uuid primary key references platform.profiles (id) on delete cascade,
  role        platform.platform_role not null,
  is_active   boolean not null default true,
  granted_by  uuid references platform.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index platform_admins_role_ix on platform.platform_admins (role) where is_active;
create trigger platform_admins_set_updated_at before update on platform.platform_admins
  for each row execute function platform.set_updated_at();

comment on table platform.platform_admins is
  'Roles de consola EBIM. Contrato §13.2: estos roles NO son visibles ni asignables '
  'desde la UI de un tenant.';

-- Contrato §13.1/§13.4: el rol EBIM_SUPER_ADMIN sólo puede recaer en el correo del
-- super admin único de la suite, y no es auto-asignable. Enforcement en la DB —
-- un guard sólo de UI se saltea con un PATCH directo.
create or replace function platform.enforce_super_admin_governance()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_email text;
  v_super constant text := 'dcalagua@ebim.pe';
begin
  if new.role <> 'EBIM_SUPER_ADMIN' then
    return new;
  end if;

  select p.email into v_email from platform.profiles p where p.id = new.user_id;

  if v_email is distinct from v_super then
    raise exception 'SUPER_ADMIN_NO_TRANSFERIBLE: el rol EBIM_SUPER_ADMIN sólo corresponde a % (contrato §13.1)', v_super
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger platform_admins_super_admin_guard
  before insert or update on platform.platform_admins
  for each row execute function platform.enforce_super_admin_governance();

-- ---------------------------------------------------------------------------
-- organizations — la CUENTA (contrato §3)
-- ---------------------------------------------------------------------------
create table platform.organizations (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null,
  legal_name    text not null,
  display_name  text not null,
  kind          platform.org_kind not null default 'COMPANY',
  country_code  char(2) not null default 'PE',
  tax_id        text,
  status        platform.entity_status not null default 'ACTIVE',
  -- Contrato §4.3: interfaz de branding homologada.
  accent_color  text,
  logo_url      text,
  white_label   boolean not null default false,
  brand_slug    text,
  billing_email text,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz,
  constraint organizations_slug_ck check (platform.is_slug(slug)),
  constraint organizations_brand_slug_ck check (brand_slug is null or platform.is_slug(brand_slug)),
  constraint organizations_accent_ck check (accent_color is null or accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint organizations_country_ck check (country_code ~ '^[A-Z]{2}$')
);

create unique index organizations_slug_uk on platform.organizations (slug);
create unique index organizations_brand_slug_uk on platform.organizations (brand_slug)
  where brand_slug is not null;
-- Sólo puede existir UNA organización de plataforma (EBIM).
create unique index organizations_single_platform_uk on platform.organizations ((kind))
  where kind = 'PLATFORM';
create index organizations_status_ix on platform.organizations (status);
create trigger organizations_set_updated_at before update on platform.organizations
  for each row execute function platform.set_updated_at();

comment on table platform.organizations is
  'Cuenta que compra y se factura (contrato §3). Puede ser partner, reseller, cliente '
  'o varias cosas a la vez: las capacidades viven en organization_capabilities (D-006).';
comment on column platform.organizations.brand_slug is
  'Contrato §4.3: identificador de marca usado en el link de ingreso `?t=<slug>`.';

-- ---------------------------------------------------------------------------
-- organization_capabilities — qué SABE HACER una organización (D-006)
-- ---------------------------------------------------------------------------
create table platform.organization_capabilities (
  organization_id uuid not null references platform.organizations (id) on delete cascade,
  capability      platform.org_capability not null,
  granted_at      timestamptz not null default now(),
  notes           text,
  primary key (organization_id, capability)
);

comment on table platform.organization_capabilities is
  'Una organización acumula capacidades (PARTNER + CUSTOMER a la vez). Evita un enum '
  'rígido en organizations que obligaría a duplicar la cuenta.';

-- ---------------------------------------------------------------------------
-- companies — SOCIEDAD legal multipaís bajo la cuenta (contrato §3.1 Modelo A)
-- ---------------------------------------------------------------------------
create table platform.companies (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references platform.organizations (id) on delete cascade,
  name            text not null,
  country_code    char(2) not null default 'PE',
  currency        char(3) not null default 'PEN',
  tax_id          text,
  -- C-04: erp_code se REPITE entre países; nunca es clave.
  erp_code        text,
  is_default      boolean not null default false,
  status          platform.entity_status not null default 'ACTIVE',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint companies_country_ck check (country_code ~ '^[A-Z]{2}$'),
  constraint companies_currency_ck check (currency ~ '^[A-Z]{3}$')
);

create index companies_org_ix on platform.companies (organization_id);
create unique index companies_default_uk on platform.companies (organization_id)
  where is_default;
create trigger companies_set_updated_at before update on platform.companies
  for each row execute function platform.set_updated_at();

comment on table platform.companies is
  'Sociedad legal (contrato §3). La sociedad pertenece a la ORGANIZACIÓN, no al tenant, '
  'para que Modelo A y Modelo B (§3.1) compartan el mismo dato de fondo.';
comment on column platform.companies.erp_code is
  'Contrato §8: código SAP/ERP. Es un ATRIBUTO — puede repetirse entre países. '
  'La sociedad se identifica SIEMPRE por company_id (uuid).';

-- ---------------------------------------------------------------------------
-- organization_relationships — aristas entre organizaciones, con vigencia
-- ---------------------------------------------------------------------------
create table platform.organization_relationships (
  id                    uuid primary key default gen_random_uuid(),
  parent_organization_id uuid not null references platform.organizations (id) on delete cascade,
  child_organization_id  uuid not null references platform.organizations (id) on delete cascade,
  relationship_type     platform.org_relationship_type not null,
  valid_from            date not null default current_date,
  valid_to              date,
  status                platform.entity_status not null default 'ACTIVE',
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint org_rel_no_self_ck check (parent_organization_id <> child_organization_id),
  constraint org_rel_period_ck check (valid_to is null or valid_to >= valid_from)
);

create unique index org_rel_active_uk
  on platform.organization_relationships (parent_organization_id, child_organization_id, relationship_type)
  where status = 'ACTIVE';
create index org_rel_child_ix on platform.organization_relationships (child_organization_id);
create trigger org_rel_set_updated_at before update on platform.organization_relationships
  for each row execute function platform.set_updated_at();

comment on table platform.organization_relationships is
  'Grafo comercial: quién administra / revende a quién. NO es jerarquía de infraestructura.';

-- ---------------------------------------------------------------------------
-- organization_memberships — usuario ↔ organización + rol
-- ---------------------------------------------------------------------------
create table platform.organization_memberships (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references platform.profiles (id) on delete cascade,
  organization_id uuid not null references platform.organizations (id) on delete cascade,
  role            platform.org_role not null default 'ORG_VIEWER',
  -- Sociedad por defecto del usuario dentro de la organización (opcional).
  company_id      uuid references platform.companies (id) on delete set null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index org_memberships_uk
  on platform.organization_memberships (user_id, organization_id);
create index org_memberships_org_ix on platform.organization_memberships (organization_id)
  where is_active;
create index org_memberships_user_ix on platform.organization_memberships (user_id)
  where is_active;
create trigger org_memberships_set_updated_at before update on platform.organization_memberships
  for each row execute function platform.set_updated_at();

comment on table platform.organization_memberships is
  'Membresía de un usuario en una organización. PARTNER_ADMIN sólo ve SU organización '
  '(contrato §13.2 / prompt fase 4).';

-- Contrato §13.2 + §11: `@ebim.pe` es dominio OPERADOR. Un correo @ebim.pe no puede
-- ser actor de negocio dentro de una organización cliente. `@grupoebim.com` SÍ puede
-- (es dominio de negocio normal) — la lista bloqueada es exactamente ["ebim.pe"].
create or replace function platform.enforce_operator_domain()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_email text;
  v_kind  platform.org_kind;
begin
  select p.email into v_email from platform.profiles p where p.id = new.user_id;
  select o.kind into v_kind from platform.organizations o where o.id = new.organization_id;

  if v_kind = 'PLATFORM' then
    return new;  -- EBIM sí puede tener a su propia gente
  end if;

  if v_email like '%@ebim.pe' then
    raise exception 'DOMINIO_OPERADOR_BLOQUEADO: % pertenece al dominio operador @ebim.pe y no puede ser actor de negocio de una organización cliente (contrato §13.2)', v_email
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger org_memberships_operator_domain_guard
  before insert or update on platform.organization_memberships
  for each row execute function platform.enforce_operator_domain();
