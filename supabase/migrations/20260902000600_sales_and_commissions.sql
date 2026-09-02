-- ============================================================================
-- EBIM Control Plane — 06 · Comerciales, atribución y comisiones
-- ----------------------------------------------------------------------------
-- Reglas de negocio (prompt §2.3 y fase 6):
--   · Un comercial que vendió un tenant ve información COMERCIAL, no operativa.
--   · Ser comercial NO crea tenant_membership.
--   · La comisión se genera desde COBROS elegibles, no desde el alta de tenant.
--   · Nunca se paga comisión sobre facturas impagas.
--   · La regla usada queda registrada en el evento: una comisión de hace un año
--     debe seguir siendo explicable aunque la regla ya haya cambiado.
-- ============================================================================

create table platform.sales_agents (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  full_name       text not null,
  -- Opcional: un comercial puede existir en el modelo comercial sin tener login.
  user_id         uuid references platform.profiles (id) on delete set null,
  -- Opcional: NULL = comercial independiente.
  organization_id uuid references platform.organizations (id) on delete set null,
  agent_type      platform.sales_agent_type not null default 'INDEPENDENT',
  contact_email   text,
  status          platform.entity_status not null default 'ACTIVE',
  valid_from      date not null default current_date,
  valid_to        date,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint sales_agents_code_ck check (platform.is_slug(code)),
  constraint sales_agents_period_ck check (valid_to is null or valid_to >= valid_from),
  -- Coherencia: un agente de partner necesita organización; uno independiente no.
  constraint sales_agents_org_ck check (
    (agent_type = 'PARTNER_AGENT' and organization_id is not null)
    or (agent_type <> 'PARTNER_AGENT')
  )
);

create unique index sales_agents_code_uk on platform.sales_agents (code);
create unique index sales_agents_user_uk on platform.sales_agents (user_id) where user_id is not null;
create index sales_agents_org_ix on platform.sales_agents (organization_id) where organization_id is not null;
create trigger sales_agents_set_updated_at before update on platform.sales_agents
  for each row execute function platform.set_updated_at();

comment on table platform.sales_agents is
  'Comercial: independiente, de partner o interno EBIM. Crear un agente NUNCA crea una '
  'fila en tenant_memberships (regla §2.3).';

-- ---------------------------------------------------------------------------
-- sales_attributions — quién se lleva el crédito de una venta.
-- Una venta puede tener varios participantes, pero la suma de sus porcentajes
-- vigentes sobre el mismo objeto no puede pasar del 100%: ahí es donde nace la
-- comisión duplicada.
-- ---------------------------------------------------------------------------
create table platform.sales_attributions (
  id                    uuid primary key default gen_random_uuid(),
  sales_agent_id        uuid not null references platform.sales_agents (id) on delete restrict,
  saas_product_id       uuid not null references platform.saas_products (id) on delete restrict,
  -- Objeto atribuible. Al menos uno debe estar presente.
  tenant_id             uuid references platform.tenants (id) on delete cascade,
  subscription_id       uuid references platform.subscriptions (id) on delete cascade,
  customer_organization_id uuid not null references platform.organizations (id) on delete restrict,
  -- Canal por el que entró la venta (partner/reseller). NULL = directo.
  channel_organization_id uuid references platform.organizations (id) on delete set null,
  attribution_pct       numeric(6,4) not null default 1,
  source                platform.attribution_source not null default 'DIRECT',
  commission_plan_id    uuid,  -- FK añadida más abajo (dependencia de orden)
  valid_from            date not null default current_date,
  valid_to              date,
  status                platform.entity_status not null default 'ACTIVE',
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint sales_attr_pct_ck check (attribution_pct > 0 and attribution_pct <= 1),
  constraint sales_attr_period_ck check (valid_to is null or valid_to >= valid_from),
  constraint sales_attr_target_ck check (tenant_id is not null or subscription_id is not null)
);

create index sales_attr_agent_ix on platform.sales_attributions (sales_agent_id);
create index sales_attr_tenant_ix on platform.sales_attributions (tenant_id) where tenant_id is not null;
create index sales_attr_sub_ix on platform.sales_attributions (subscription_id) where subscription_id is not null;
create index sales_attr_org_ix on platform.sales_attributions (customer_organization_id);
create index sales_attr_channel_ix on platform.sales_attributions (channel_organization_id)
  where channel_organization_id is not null;
create trigger sales_attr_set_updated_at before update on platform.sales_attributions
  for each row execute function platform.set_updated_at();

comment on table platform.sales_attributions is
  'Atribución comercial con vigencia. Permite venta compartida (varios agentes) sin '
  'duplicar comisión: la suma de attribution_pct vigentes por objeto se valida ≤ 1.';

create or replace function platform.enforce_attribution_total()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_sum numeric(10,4);
begin
  if new.status <> 'ACTIVE' then
    return null;
  end if;

  select coalesce(sum(a.attribution_pct), 0) into v_sum
    from platform.sales_attributions a
   where a.status = 'ACTIVE'
     and a.saas_product_id = new.saas_product_id
     and a.tenant_id is not distinct from new.tenant_id
     and a.subscription_id is not distinct from new.subscription_id
     -- Sólo las que se solapan en el tiempo con la nueva.
     and (a.valid_to is null or a.valid_to >= new.valid_from)
     and (new.valid_to is null or new.valid_to >= a.valid_from);

  if v_sum > 1.0001 then
    raise exception 'ATRIBUCION_EXCEDIDA: las atribuciones vigentes sobre este objeto suman %, máximo 1 (prompt fase 6)', v_sum
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger sales_attributions_total_guard
  after insert or update on platform.sales_attributions
  deferrable initially deferred
  for each row execute function platform.enforce_attribution_total();

-- ---------------------------------------------------------------------------
-- commission_plans / commission_rules
-- ---------------------------------------------------------------------------
create table platform.commission_plans (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  name            text not null,
  description     text,
  saas_product_id uuid references platform.saas_products (id) on delete cascade,
  status          platform.entity_status not null default 'ACTIVE',
  valid_from      date not null default current_date,
  valid_to        date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint commission_plans_code_ck check (platform.is_slug(code)),
  constraint commission_plans_period_ck check (valid_to is null or valid_to >= valid_from)
);

create unique index commission_plans_code_uk on platform.commission_plans (code);
create trigger commission_plans_set_updated_at before update on platform.commission_plans
  for each row execute function platform.set_updated_at();

alter table platform.sales_attributions
  add constraint sales_attr_commission_plan_fk
  foreign key (commission_plan_id) references platform.commission_plans (id) on delete set null;

create table platform.commission_rules (
  id                 uuid primary key default gen_random_uuid(),
  commission_plan_id uuid not null references platform.commission_plans (id) on delete cascade,
  name               text not null,
  basis              platform.commission_basis not null,
  -- Sobre qué charge_kind aplica. NULL = cualquiera compatible con el basis.
  charge_kind        platform.charge_kind,
  rate               numeric(6,4),
  fixed_amount       numeric(14,2),
  currency           char(3) not null default 'USD',
  -- Recurrente = se paga en cada cobro. No recurrente = sólo el primero.
  is_recurring       boolean not null default true,
  -- Tope de meses desde el inicio de la atribución (NULL = sin tope).
  max_months         integer,
  -- Tope de monto acumulado por atribución (NULL = sin tope).
  max_total_amount   numeric(14,2),
  priority           integer not null default 100,
  valid_from         date not null default current_date,
  valid_to           date,
  status             platform.entity_status not null default 'ACTIVE',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint commission_rules_rate_ck check (rate is null or (rate >= 0 and rate <= 1)),
  constraint commission_rules_fixed_ck check (fixed_amount is null or fixed_amount >= 0),
  constraint commission_rules_period_ck check (valid_to is null or valid_to >= valid_from),
  constraint commission_rules_max_months_ck check (max_months is null or max_months > 0),
  -- Coherencia: un basis porcentual exige rate; FIXED_AMOUNT exige monto.
  constraint commission_rules_basis_ck check (
    (basis = 'FIXED_AMOUNT' and fixed_amount is not null and rate is null)
    or (basis <> 'FIXED_AMOUNT' and rate is not null and fixed_amount is null)
  )
);

create index commission_rules_plan_ix on platform.commission_rules (commission_plan_id);
create trigger commission_rules_set_updated_at before update on platform.commission_rules
  for each row execute function platform.set_updated_at();

comment on table platform.commission_rules is
  'Reglas con vigencia. Una regla NUNCA se edita retroactivamente: se cierra (valid_to) '
  'y se abre otra, para que un commission_event viejo siga siendo explicable.';

-- ---------------------------------------------------------------------------
-- commission_settlements — liquidación por comercial y periodo
-- ---------------------------------------------------------------------------
create table platform.commission_settlements (
  id             uuid primary key default gen_random_uuid(),
  code           text not null,
  sales_agent_id uuid not null references platform.sales_agents (id) on delete restrict,
  period_start   date not null,
  period_end     date not null,
  currency       char(3) not null default 'USD',
  status         platform.settlement_status not null default 'OPEN',
  total_amount   numeric(14,2) not null default 0,
  approved_at    timestamptz,
  approved_by    uuid references platform.profiles (id) on delete set null,
  paid_at        timestamptz,
  payment_reference text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint settlements_period_ck check (period_end >= period_start),
  constraint settlements_currency_ck check (currency ~ '^[A-Z]{3}$'),
  constraint settlements_paid_needs_ref_ck
    check (status <> 'PAID' or (paid_at is not null and payment_reference is not null))
);

create unique index settlements_code_uk on platform.commission_settlements (code);
create index settlements_agent_ix on platform.commission_settlements (sales_agent_id);
create index settlements_period_ix on platform.commission_settlements (period_start, period_end);
create trigger settlements_set_updated_at before update on platform.commission_settlements
  for each row execute function platform.set_updated_at();

-- ---------------------------------------------------------------------------
-- commission_events — la comisión devengada por un COBRO concreto
-- ---------------------------------------------------------------------------
create table platform.commission_events (
  id                    uuid primary key default gen_random_uuid(),
  sales_agent_id        uuid not null references platform.sales_agents (id) on delete restrict,
  sales_attribution_id  uuid not null references platform.sales_attributions (id) on delete restrict,
  commission_rule_id    uuid not null references platform.commission_rules (id) on delete restrict,
  -- Origen del devengo: SIEMPRE un cobro confirmado.
  payment_id            uuid not null references platform.payments (id) on delete restrict,
  invoice_line_id       uuid references platform.invoice_lines (id) on delete set null,
  saas_product_id       uuid not null references platform.saas_products (id) on delete restrict,
  tenant_id             uuid references platform.tenants (id) on delete set null,
  settlement_id         uuid references platform.commission_settlements (id) on delete set null,
  status                platform.commission_status not null default 'ELIGIBLE',
  -- Trazabilidad del cálculo: base × rate × attribution_pct = amount.
  base_amount           numeric(14,2) not null,
  applied_rate          numeric(6,4),
  attribution_pct       numeric(6,4) not null,
  amount                numeric(14,2) not null,
  currency              char(3) not null default 'USD',
  earned_on             date not null,
  -- Snapshot de la regla al momento del cálculo. Si la regla cambia mañana,
  -- este evento sigue explicando por qué se pagó lo que se pagó.
  calculation           jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint commission_events_amount_ck check (amount >= 0),
  constraint commission_events_currency_ck check (currency ~ '^[A-Z]{3}$'),
  constraint commission_events_pct_ck check (attribution_pct > 0 and attribution_pct <= 1)
);

-- Idempotencia: reprocesar un pago no duplica la comisión.
create unique index commission_events_idempotency_uk
  on platform.commission_events (payment_id, sales_attribution_id, commission_rule_id, coalesce(invoice_line_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index commission_events_agent_ix on platform.commission_events (sales_agent_id);
create index commission_events_status_ix on platform.commission_events (status);
create index commission_events_settlement_ix on platform.commission_events (settlement_id)
  where settlement_id is not null;
create index commission_events_earned_ix on platform.commission_events (earned_on);
create trigger commission_events_set_updated_at before update on platform.commission_events
  for each row execute function platform.set_updated_at();

comment on table platform.commission_events is
  'Devengo de comisión originado en un COBRO confirmado (payment_id NOT NULL). '
  'Nunca se genera por crear un tenant ni por emitir una factura.';
comment on column platform.commission_events.calculation is
  'Snapshot del cálculo: { rule_name, basis, rate, base, attribution_pct, caps }. '
  'Permite explicar una comisión histórica aunque la regla haya cambiado.';

-- El total de una liquidación es la suma de sus eventos: no se teclea a mano.
create or replace function platform.recalc_settlement_total()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_settlement uuid;
begin
  foreach v_settlement in array array[
    coalesce(new.settlement_id, old.settlement_id),
    coalesce(old.settlement_id, new.settlement_id)
  ] loop
    if v_settlement is not null then
      update platform.commission_settlements s
         set total_amount = coalesce((
               select sum(e.amount) from platform.commission_events e
                where e.settlement_id = s.id and e.status <> 'VOID'
             ), 0),
             updated_at = now()
       where s.id = v_settlement;
    end if;
  end loop;
  return null;
end;
$$;

create trigger commission_events_recalc_settlement
  after insert or update or delete on platform.commission_events
  for each row execute function platform.recalc_settlement_total();
