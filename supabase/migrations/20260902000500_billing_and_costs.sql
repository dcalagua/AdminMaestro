-- ============================================================================
-- EBIM Control Plane — 05 · Facturación gerencial, cobros y costos
-- ----------------------------------------------------------------------------
-- NO es contabilidad general ni SUNAT. Es la capa que permite responder
-- "¿qué SaaS / partner / tenant es rentable?" (prompt fase 7).
--
-- Regla dura: sólo `payments` CONFIRMED sobre facturas ISSUED/PARTIALLY_PAID/PAID
-- cuentan como ingreso cobrado. DRAFT y VOID nunca.
-- ============================================================================

create table platform.invoices (
  id                     uuid primary key default gen_random_uuid(),
  number                 text not null,
  customer_organization_id uuid not null references platform.organizations (id) on delete restrict,
  company_id             uuid references platform.companies (id) on delete set null,
  subscription_id        uuid references platform.subscriptions (id) on delete set null,
  status                 platform.invoice_status not null default 'DRAFT',
  currency               char(3) not null default 'USD',
  issue_date             date,
  due_date               date,
  -- Periodo de servicio facturado. Es lo que permite calcular MRR por mes.
  period_start           date,
  period_end             date,
  subtotal               numeric(14,2) not null default 0,
  tax_amount             numeric(14,2) not null default 0,
  total                  numeric(14,2) not null default 0,
  notes                  text,
  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint invoices_currency_ck check (currency ~ '^[A-Z]{3}$'),
  constraint invoices_amounts_ck check (subtotal >= 0 and tax_amount >= 0 and total >= 0),
  constraint invoices_period_ck check (period_end is null or period_start is null or period_end >= period_start),
  -- Una factura emitida necesita fecha de emisión: sin ella no hay periodo de
  -- reconocimiento y el MRR queda indefinido.
  constraint invoices_issued_needs_date_ck
    check (status = 'DRAFT' or status = 'VOID' or issue_date is not null)
);

create unique index invoices_number_uk on platform.invoices (number);
create index invoices_org_ix on platform.invoices (customer_organization_id);
create index invoices_status_ix on platform.invoices (status);
create index invoices_period_ix on platform.invoices (period_start, period_end);
create index invoices_subscription_ix on platform.invoices (subscription_id)
  where subscription_id is not null;
create trigger invoices_set_updated_at before update on platform.invoices
  for each row execute function platform.set_updated_at();

comment on table platform.invoices is
  'Factura de control gerencial. DRAFT y VOID NUNCA cuentan como ingreso (prompt fase 7).';

-- ---------------------------------------------------------------------------
-- invoice_lines — el detalle. `charge_kind` es lo que permite separar licencia
-- recurrente (MRR) de implementation fee (one-time) en los dashboards.
-- ---------------------------------------------------------------------------
create table platform.invoice_lines (
  id               uuid primary key default gen_random_uuid(),
  invoice_id       uuid not null references platform.invoices (id) on delete cascade,
  charge_kind      platform.charge_kind not null,
  description      text not null,
  saas_product_id  uuid references platform.saas_products (id) on delete set null,
  tenant_id        uuid references platform.tenants (id) on delete set null,
  subscription_item_id uuid references platform.subscription_items (id) on delete set null,
  quantity         numeric(12,2) not null default 1,
  unit_amount      numeric(14,2) not null,
  currency         char(3) not null default 'USD',
  -- Recurrente = suma a MRR. One-time (implementation/setup) = NO suma a MRR.
  is_recurring     boolean not null default true,
  amount           numeric(14,2) generated always as (round(quantity * unit_amount, 2)) stored,
  created_at       timestamptz not null default now(),
  constraint invoice_lines_qty_ck check (quantity <> 0),
  constraint invoice_lines_currency_ck check (currency ~ '^[A-Z]{3}$')
);

create index invoice_lines_invoice_ix on platform.invoice_lines (invoice_id);
create index invoice_lines_tenant_ix on platform.invoice_lines (tenant_id) where tenant_id is not null;
create index invoice_lines_product_ix on platform.invoice_lines (saas_product_id);
create index invoice_lines_kind_ix on platform.invoice_lines (charge_kind);

comment on column platform.invoice_lines.is_recurring is
  'true = entra en MRR. IMPLEMENTATION_FEE y setup son false: cobrarlos no aumenta el '
  'recurrente, y mezclarlos infla el MRR (fórmula en docs/finance/COST_MARGIN_MODEL.md).';

-- Mantiene los totales de la factura coherentes con sus líneas.
create or replace function platform.recalc_invoice_totals()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_invoice uuid := coalesce(new.invoice_id, old.invoice_id);
  v_subtotal numeric(14,2);
begin
  select coalesce(sum(l.amount), 0) into v_subtotal
    from platform.invoice_lines l where l.invoice_id = v_invoice;

  update platform.invoices i
     set subtotal = v_subtotal,
         total = round(v_subtotal + i.tax_amount, 2),
         updated_at = now()
   where i.id = v_invoice;

  return null;
end;
$$;

create trigger invoice_lines_recalc
  after insert or update or delete on platform.invoice_lines
  for each row execute function platform.recalc_invoice_totals();

-- ---------------------------------------------------------------------------
-- payments — cobros. La comisión se dispara desde AQUÍ, nunca desde el alta de
-- un tenant ni desde la emisión de una factura (prompt fase 6).
-- ---------------------------------------------------------------------------
create table platform.payments (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references platform.invoices (id) on delete restrict,
  reference    text not null,
  status       platform.payment_status not null default 'PENDING',
  amount       numeric(14,2) not null,
  currency     char(3) not null default 'USD',
  paid_at      timestamptz,
  method       text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint payments_amount_ck check (amount > 0),
  constraint payments_currency_ck check (currency ~ '^[A-Z]{3}$'),
  constraint payments_confirmed_needs_date_ck
    check (status <> 'CONFIRMED' or paid_at is not null)
);

create unique index payments_reference_uk on platform.payments (reference);
create index payments_invoice_ix on platform.payments (invoice_id);
create index payments_status_ix on platform.payments (status);
create index payments_paid_at_ix on platform.payments (paid_at) where status = 'CONFIRMED';
create trigger payments_set_updated_at before update on platform.payments
  for each row execute function platform.set_updated_at();

-- Un cobro no puede aplicarse a una factura DRAFT o VOID.
create or replace function platform.enforce_payment_invoice_status()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_status platform.invoice_status;
begin
  select i.status into v_status from platform.invoices i where i.id = new.invoice_id;

  if new.status = 'CONFIRMED' and v_status in ('DRAFT', 'VOID') then
    raise exception 'COBRO_SOBRE_FACTURA_NO_EMITIDA: no se puede confirmar un pago sobre una factura % (prompt fase 7)', v_status
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger payments_invoice_status_guard
  before insert or update of status, invoice_id on platform.payments
  for each row execute function platform.enforce_payment_invoice_status();

-- Al confirmarse un cobro, la factura avanza a PARTIALLY_PAID / PAID.
create or replace function platform.sync_invoice_payment_status()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_invoice uuid := coalesce(new.invoice_id, old.invoice_id);
  v_paid numeric(14,2);
  v_total numeric(14,2);
  v_status platform.invoice_status;
begin
  select coalesce(sum(p.amount), 0) into v_paid
    from platform.payments p where p.invoice_id = v_invoice and p.status = 'CONFIRMED';

  select i.total, i.status into v_total, v_status
    from platform.invoices i where i.id = v_invoice;

  if v_status in ('DRAFT', 'VOID', 'UNCOLLECTIBLE') then
    return null;
  end if;

  update platform.invoices i
     set status = case
                    when v_paid <= 0 then 'ISSUED'::platform.invoice_status
                    when v_paid >= i.total then 'PAID'::platform.invoice_status
                    else 'PARTIALLY_PAID'::platform.invoice_status
                  end,
         updated_at = now()
   where i.id = v_invoice;

  return null;
end;
$$;

create trigger payments_sync_invoice
  after insert or update or delete on platform.payments
  for each row execute function platform.sync_invoice_payment_status();

-- ---------------------------------------------------------------------------
-- cost_entries — costo real incurrido
-- ---------------------------------------------------------------------------
create table platform.cost_entries (
  id           uuid primary key default gen_random_uuid(),
  category     platform.cost_category not null,
  description  text not null,
  vendor       text,
  amount       numeric(14,2) not null,
  currency     char(3) not null default 'USD',
  period_start date not null,
  period_end   date not null,
  is_recurring boolean not null default true,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint cost_entries_amount_ck check (amount >= 0),
  constraint cost_entries_currency_ck check (currency ~ '^[A-Z]{3}$'),
  constraint cost_entries_period_ck check (period_end >= period_start)
);

create index cost_entries_period_ix on platform.cost_entries (period_start, period_end);
create index cost_entries_category_ix on platform.cost_entries (category);
create trigger cost_entries_set_updated_at before update on platform.cost_entries
  for each row execute function platform.set_updated_at();

-- ---------------------------------------------------------------------------
-- cost_allocations — a QUÉ se imputa cada costo. Un costo compartido se reparte
-- con una regla EXPLÍCITA (weight), nunca con un prorrateo implícito.
-- ---------------------------------------------------------------------------
create table platform.cost_allocations (
  id                  uuid primary key default gen_random_uuid(),
  cost_entry_id       uuid not null references platform.cost_entries (id) on delete cascade,
  scope               platform.cost_scope not null,
  saas_product_id     uuid references platform.saas_products (id) on delete cascade,
  organization_id     uuid references platform.organizations (id) on delete cascade,
  tenant_id           uuid references platform.tenants (id) on delete cascade,
  deployment_target_id uuid,  -- FK añadida en la migración 07 (dependencia de orden)
  -- Fracción del costo imputada a este destino. La suma por cost_entry se valida
  -- con un trigger: repartir el 120% de un costo es un error de datos, no un matiz.
  weight              numeric(6,4) not null default 1,
  allocation_rule     text not null default 'MANUAL',
  created_at          timestamptz not null default now(),
  constraint cost_alloc_weight_ck check (weight > 0 and weight <= 1),
  constraint cost_alloc_scope_target_ck check (
    (scope = 'PLATFORM'          and saas_product_id is null and organization_id is null and tenant_id is null and deployment_target_id is null)
    or (scope = 'PRODUCT'        and saas_product_id is not null)
    or (scope = 'ORGANIZATION'   and organization_id is not null)
    or (scope = 'TENANT'         and tenant_id is not null)
    or (scope = 'DEPLOYMENT_TARGET' and deployment_target_id is not null)
  )
);

create index cost_alloc_entry_ix on platform.cost_allocations (cost_entry_id);
create index cost_alloc_tenant_ix on platform.cost_allocations (tenant_id) where tenant_id is not null;
create index cost_alloc_org_ix on platform.cost_allocations (organization_id) where organization_id is not null;
create index cost_alloc_product_ix on platform.cost_allocations (saas_product_id) where saas_product_id is not null;

comment on column platform.cost_allocations.weight is
  'Fracción del cost_entry imputada. La suma por cost_entry no puede exceder 1 — '
  'validado por trigger, no "por convención".';

create or replace function platform.enforce_cost_allocation_weight()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_entry uuid := coalesce(new.cost_entry_id, old.cost_entry_id);
  v_sum numeric(10,4);
begin
  select coalesce(sum(a.weight), 0) into v_sum
    from platform.cost_allocations a where a.cost_entry_id = v_entry;

  if v_sum > 1.0001 then
    raise exception 'ASIGNACION_COSTO_EXCEDIDA: el costo % tiene asignaciones que suman %, máximo 1', v_entry, v_sum
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger cost_allocations_weight_guard
  after insert or update on platform.cost_allocations
  deferrable initially deferred
  for each row execute function platform.enforce_cost_allocation_weight();
