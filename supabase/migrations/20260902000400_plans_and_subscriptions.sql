-- ============================================================================
-- EBIM Control Plane — 04 · Planes, precios, suscripciones y fees
-- ----------------------------------------------------------------------------
--   §2.2 SHARED            : licencia por tenant productivo, DEMO sin recurrente
--   §2.2 PARTNER_DEDICATED : licencia base Partner + N licencias + infra fee
--   §2.2 TENANT_DEDICATED  : licencia Enterprise + infra + setup + soporte
--   C-11 nombres canónicos de pricing multi-sociedad (contrato §11.1)
--   C-15 numeric(14,2) + currency explícita
-- ============================================================================

create table platform.plans (
  id               uuid primary key default gen_random_uuid(),
  code             text not null,
  name             text not null,
  saas_product_id  uuid not null references platform.saas_products (id) on delete restrict,
  -- Para qué modelo de despliegue aplica el plan. NULL = cualquiera.
  deployment_mode  platform.deployment_mode,
  -- Contrato §11.1, nombres CANÓNICOS. No renombrar.
  included_companies integer not null default 1,
  multi_country    boolean not null default false,
  is_partner_base  boolean not null default false,
  description      text,
  status           platform.entity_status not null default 'ACTIVE',
  sort_order       integer not null default 100,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint plans_code_ck check (platform.is_slug(code)),
  constraint plans_included_companies_ck check (included_companies >= 1)
);

create unique index plans_code_uk on platform.plans (code);
create index plans_product_ix on platform.plans (saas_product_id);
create trigger plans_set_updated_at before update on platform.plans
  for each row execute function platform.set_updated_at();

comment on column platform.plans.included_companies is
  'Contrato §11.1: sociedades incluidas en el plan (default 1). Las extra se cobran '
  'con el addon canónico `extra_company`.';
comment on column platform.plans.is_partner_base is
  'true = licencia BASE de partner en PARTNER_DEDICATED (§2.2): se cobra una vez por '
  'partner, aparte de las N licencias por tenant activo.';

-- ---------------------------------------------------------------------------
-- plan_prices — precio con vigencia. Nunca se edita un precio: se cierra y se
-- abre otro, para que una factura histórica siga siendo explicable.
-- ---------------------------------------------------------------------------
create table platform.plan_prices (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null references platform.plans (id) on delete cascade,
  charge_kind      platform.charge_kind not null default 'LICENSE',
  billing_interval platform.billing_interval not null default 'MONTHLY',
  amount           numeric(14,2) not null,
  currency         char(3) not null default 'USD',
  valid_from       date not null default current_date,
  valid_to         date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint plan_prices_amount_ck check (amount >= 0),
  constraint plan_prices_currency_ck check (currency ~ '^[A-Z]{3}$'),
  constraint plan_prices_period_ck check (valid_to is null or valid_to >= valid_from)
);

create index plan_prices_plan_ix on platform.plan_prices (plan_id);
create unique index plan_prices_current_uk
  on platform.plan_prices (plan_id, charge_kind, billing_interval, currency)
  where valid_to is null;
create trigger plan_prices_set_updated_at before update on platform.plan_prices
  for each row execute function platform.set_updated_at();

-- ---------------------------------------------------------------------------
-- subscriptions — el contrato recurrente vivo.
--
-- Una suscripción cuelga de una ORGANIZACIÓN (quien paga) y opcionalmente de un
-- TENANT. La licencia base de un Partner Dedicated es una suscripción SIN tenant:
-- es del partner, no de ninguno de sus clientes.
-- ---------------------------------------------------------------------------
create table platform.subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null,
  -- Quién paga.
  billed_organization_id uuid not null references platform.organizations (id) on delete restrict,
  saas_product_id       uuid not null references platform.saas_products (id) on delete restrict,
  tenant_id             uuid references platform.tenants (id) on delete restrict,
  plan_id               uuid not null references platform.plans (id) on delete restrict,
  status                platform.subscription_status not null default 'DRAFT',
  billing_interval      platform.billing_interval not null default 'MONTHLY',
  currency              char(3) not null default 'USD',
  quantity              integer not null default 1,
  started_on            date not null default current_date,
  ends_on               date,
  cancelled_at          timestamptz,
  -- Margen retenido por el canal en ESTA suscripción. Puede diferir del acuerdo
  -- general si se negoció caso a caso; si es NULL se hereda del agreement.
  channel_margin_rate   numeric(6,4),
  notes                 text,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint subscriptions_qty_ck check (quantity >= 1),
  constraint subscriptions_currency_ck check (currency ~ '^[A-Z]{3}$'),
  constraint subscriptions_margin_ck
    check (channel_margin_rate is null or (channel_margin_rate >= 0 and channel_margin_rate <= 1)),
  constraint subscriptions_period_ck check (ends_on is null or ends_on >= started_on)
);

create unique index subscriptions_code_uk on platform.subscriptions (code);
create index subscriptions_org_ix on platform.subscriptions (billed_organization_id);
create index subscriptions_tenant_ix on platform.subscriptions (tenant_id) where tenant_id is not null;
create index subscriptions_product_status_ix on platform.subscriptions (saas_product_id, status);
create trigger subscriptions_set_updated_at before update on platform.subscriptions
  for each row execute function platform.set_updated_at();

comment on table platform.subscriptions is
  'Contrato recurrente. tenant_id NULL = suscripción de nivel partner (licencia base '
  'de PARTNER_DEDICATED) o de nivel organización.';

-- Regla de negocio §2.2: un tenant DEMO no genera cobro recurrente.
create or replace function platform.enforce_demo_not_recurring()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_type platform.tenant_type;
begin
  if new.tenant_id is null or new.billing_interval = 'ONE_TIME' then
    return new;
  end if;

  select t.tenant_type into v_type from platform.tenants t where t.id = new.tenant_id;

  if v_type = 'DEMO' and new.status = 'ACTIVE' then
    raise exception 'DEMO_SIN_RECURRENTE: un tenant DEMO no puede tener una suscripción recurrente activa (regla §2.2)'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger subscriptions_demo_guard
  before insert or update of status, tenant_id, billing_interval on platform.subscriptions
  for each row execute function platform.enforce_demo_not_recurring();

-- ---------------------------------------------------------------------------
-- subscription_items — las líneas de la suscripción. Aquí conviven la licencia
-- recurrente, el fee de implementación y el fee de infraestructura dedicada.
-- ---------------------------------------------------------------------------
create table platform.subscription_items (
  id               uuid primary key default gen_random_uuid(),
  subscription_id  uuid not null references platform.subscriptions (id) on delete cascade,
  charge_kind      platform.charge_kind not null,
  description      text not null,
  quantity         numeric(12,2) not null default 1,
  unit_amount      numeric(14,2) not null,
  currency         char(3) not null default 'USD',
  billing_interval platform.billing_interval not null default 'MONTHLY',
  -- Un ítem puede referirse a un tenant concreto dentro de una suscripción de
  -- partner (N licencias por tenant activo en PARTNER_DEDICATED).
  tenant_id        uuid references platform.tenants (id) on delete set null,
  catalog_item_code text references platform.catalog_items (code) on update cascade on delete set null,
  valid_from       date not null default current_date,
  valid_to         date,
  amount           numeric(14,2) generated always as (round(quantity * unit_amount, 2)) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint subscription_items_qty_ck check (quantity > 0),
  constraint subscription_items_currency_ck check (currency ~ '^[A-Z]{3}$'),
  constraint subscription_items_period_ck check (valid_to is null or valid_to >= valid_from)
);

create index subscription_items_sub_ix on platform.subscription_items (subscription_id);
create index subscription_items_tenant_ix on platform.subscription_items (tenant_id)
  where tenant_id is not null;
create index subscription_items_kind_ix on platform.subscription_items (charge_kind);
create trigger subscription_items_set_updated_at before update on platform.subscription_items
  for each row execute function platform.set_updated_at();

comment on table platform.subscription_items is
  'Líneas del contrato. charge_kind distingue LICENSE recurrente de IMPLEMENTATION_FEE '
  '(one-time) e INFRASTRUCTURE_FEE (recurrente de infra dedicada) — §2.2.';
