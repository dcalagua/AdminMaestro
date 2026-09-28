-- ============================================================================
-- EBIM Commercial Control Plane · Fase 17 · créditos IA (MA-53)
-- ----------------------------------------------------------------------------
-- Spec §12, §14, §20 (D-02, D-03, D-04). Plan §4 fila 19, §12.1 MA-53.
-- Test: supabase/tests/40_ccp_ai_credits.test.sql.
--
-- NADA se siembra: sin pesos, políticas, créditos incluidos, precio del
-- crédito, rollover ni expiración. Son decisiones de negocio pendientes; sin
-- ellas el sistema alerta y no inventa consumo ni saldo.
--
--   · ai_credit_weights: créditos por unidad de una capacidad AI_FEATURE, con
--     vigencia [valid_from, valid_to). Solo finanzas. Un peso nuevo cierra el
--     vigente y nunca empieza antes que él. Inmutable salvo cerrar valid_to.
--     Compatibilidad con cuotas por acción (peso 1): solo si un humano lo
--     aprueba y lo registra aquí (D-03).
--   · ai_credit_policies: por plan o add-on. pool_scope, included_credits y
--     overage_mode nullable = NO DECIDIDO. rollover/expiry forzados a NULL
--     hasta D-04 (CHECK).
--   · ai_credit_ledger: append-only (55000 incluso para postgres), unique
--     (tenant, entry_idempotency_key), signo por tipo (CHECK):
--       + GRANT_PERIOD (incluidos) · GRANT_PURCHASE (comprados) · GRANT_BONUS
--         · RESERVE_RELEASE · ROLLOVER_IN
--       − CONSUME (usados) · RESERVE (reservados) · EXPIRE · ROLLOVER_OUT
--       ± ADJUST (finanzas, motivo obligatorio) · REVERSAL (= −original, una vez)
--   · CONSUME solo al FINALIZAR un agregado de un medidor ligado a una
--     AI_FEATURE (trigger): créditos = Σ(cantidad × peso vigente en
--     occurred_at), una entrada por peso, con el peso aplicado guardado.
--     Sin política → POLITICA_CREDITOS_NO_DEFINIDA; sin peso →
--     PESO_CREDITO_NO_DEFINIDO; saldo < 0 → CREDIT_OVERAGE (BLOCK/ALLOW/
--     NO_DEFINIDO). Ninguna de estas alertas factura (la línea USAGE_OVERAGE
--     es de la fase 18 y además exige precio, D-02).
--   · v_ai_credit_balances (security_invoker): saldo derivado por tenant ×
--     pool × período, con incluidos/comprados/bono/reservado/usado/expirado/
--     ajuste; una REVERSAL cuenta en la categoría de la entrada revertida.
--   · aiCredits del snapshot: ai_credit_weights_snapshot(); se parchea la
--     única expresión que lo emitía vacío en entitlement_snapshot_content.
--
-- Rollback: docs/runbooks/ccp-rollback/17.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ai_credit_weights
-- ---------------------------------------------------------------------------
create table platform.ai_credit_weights (
  id               uuid primary key default gen_random_uuid(),
  capability_id    uuid not null references platform.product_capabilities (id) on delete restrict,
  credits_per_unit numeric(15, 6) not null,
  unit             text not null,
  valid_from       timestamptz not null,
  valid_to         timestamptz,
  reason           text not null,
  created_by       uuid references platform.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint ai_credit_weights_value_ck check (credits_per_unit >= 0 and credits_per_unit < 1000000000),
  constraint ai_credit_weights_unit_ck check (unit ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  constraint ai_credit_weights_range_ck check (valid_to is null or valid_to > valid_from),
  constraint ai_credit_weights_reason_ck check (length(trim(reason)) > 0),
  constraint ai_credit_weights_no_overlap exclude using gist (
    capability_id with =, tstzrange(valid_from, coalesce(valid_to, 'infinity'::timestamptz)) with &&)
);
create index ai_credit_weights_capability_ix on platform.ai_credit_weights (capability_id, valid_from);

comment on table platform.ai_credit_weights is
  'Créditos EBIM por unidad de cada capacidad AI_FEATURE, con vigencia (spec §12.1). Configuración '
  'comercial (D-03): no se siembra. Los tokens del proveedor nunca son la unidad comercial.';

create or replace function platform.ai_credit_config_guard()
returns trigger
language plpgsql
set search_path = platform, pg_catalog
as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'CONFIGURACION_INMUTABLE: % no se borra; se cierra su vigencia', tg_table_name using errcode = '55000';
  end if;
  if old.valid_to is not null or new.valid_to is null
     or (to_jsonb(new) - 'valid_to') is distinct from (to_jsonb(old) - 'valid_to') then
    raise exception 'CONFIGURACION_INMUTABLE: en % solo se puede cerrar valid_to una vez', tg_table_name using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function platform.ai_credit_config_guard() from public, anon, authenticated;

create trigger ai_credit_weights_guard before update or delete on platform.ai_credit_weights
  for each row execute function platform.ai_credit_config_guard();
create trigger ai_credit_weights_no_truncate before truncate on platform.ai_credit_weights
  for each statement execute function platform.ai_credit_config_guard();

alter table platform.ai_credit_weights enable row level security;
alter table platform.ai_credit_weights force row level security;
revoke all on platform.ai_credit_weights from public, anon, authenticated;
grant select on platform.ai_credit_weights to authenticated;
grant select on platform.ai_credit_weights to service_role;
create policy ai_credit_weights_select on platform.ai_credit_weights
  for select to authenticated using (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- 2. ai_credit_policies
-- ---------------------------------------------------------------------------
create table platform.ai_credit_policies (
  id               uuid primary key default gen_random_uuid(),
  saas_product_id  uuid not null references platform.saas_products (id) on delete restrict,
  source_type      text not null,
  plan_id          uuid references platform.plans (id) on delete restrict,
  catalog_item_id  uuid references platform.catalog_items (id) on delete restrict,
  pool_scope       text,
  included_credits numeric(15, 6),
  overage_mode     text,
  rollover_policy  text,
  expiry_policy    text,
  valid_from       date not null,
  valid_to         date,
  reason           text not null,
  created_by       uuid references platform.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint ai_credit_policies_source_ck check (
    (source_type = 'PLAN' and plan_id is not null and catalog_item_id is null)
    or (source_type = 'CATALOG_ITEM' and catalog_item_id is not null and plan_id is null)),
  constraint ai_credit_policies_pool_ck check (pool_scope is null or pool_scope in ('TENANT', 'PRODUCT')),
  constraint ai_credit_policies_included_ck check (included_credits is null or (included_credits >= 0 and included_credits < 1000000000)),
  constraint ai_credit_policies_overage_ck check (overage_mode is null or overage_mode in ('BLOCK', 'ALLOW')),
  -- D-04: rollover y expiración no están decididos; no se pueden configurar.
  constraint ai_credit_policies_d04_ck check (rollover_policy is null and expiry_policy is null),
  constraint ai_credit_policies_range_ck check (valid_to is null or valid_to > valid_from),
  constraint ai_credit_policies_reason_ck check (length(trim(reason)) > 0),
  constraint ai_credit_policies_no_overlap exclude using gist (
    coalesce(plan_id, catalog_item_id) with =, daterange(valid_from, valid_to) with &&)
);

comment on table platform.ai_credit_policies is
  'Política de créditos IA por plan o add-on (spec §12). Campos comerciales nullable = no decidido '
  '(D-02/D-03). Rollover y expiración bloqueados hasta D-04.';

create trigger ai_credit_policies_guard before update or delete on platform.ai_credit_policies
  for each row execute function platform.ai_credit_config_guard();
create trigger ai_credit_policies_no_truncate before truncate on platform.ai_credit_policies
  for each statement execute function platform.ai_credit_config_guard();

alter table platform.ai_credit_policies enable row level security;
alter table platform.ai_credit_policies force row level security;
revoke all on platform.ai_credit_policies from public, anon, authenticated;
grant select on platform.ai_credit_policies to authenticated;
grant select on platform.ai_credit_policies to service_role;
create policy ai_credit_policies_select on platform.ai_credit_policies
  for select to authenticated using (platform.can_read_finance() or platform.can_manage_platform_entities());

-- ---------------------------------------------------------------------------
-- 3. ai_credit_ledger (append-only)
-- ---------------------------------------------------------------------------
create table platform.ai_credit_ledger (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references platform.tenants (id) on delete restrict,
  saas_product_id       uuid not null references platform.saas_products (id) on delete restrict,
  pool_key              text not null,
  period_start          date not null,
  entry_type            text not null,
  credits               numeric(20, 6) not null,
  entry_idempotency_key text not null,
  usage_aggregate_id    uuid references platform.usage_period_aggregates (id) on delete restrict,
  capability_id         uuid references platform.product_capabilities (id) on delete restrict,
  weight_id             uuid references platform.ai_credit_weights (id) on delete restrict,
  weight_applied        numeric(15, 6),
  quantity              numeric(20, 6),
  policy_id             uuid references platform.ai_credit_policies (id) on delete restrict,
  reverses_entry_id     uuid references platform.ai_credit_ledger (id) on delete restrict,
  reason                text,
  created_by            uuid references platform.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  constraint ai_credit_ledger_type_ck check (entry_type in (
    'GRANT_PERIOD', 'GRANT_PURCHASE', 'GRANT_BONUS', 'CONSUME', 'RESERVE', 'RESERVE_RELEASE',
    'ADJUST', 'EXPIRE', 'ROLLOVER_OUT', 'ROLLOVER_IN', 'REVERSAL')),
  constraint ai_credit_ledger_sign_ck check (case
    when entry_type in ('GRANT_PERIOD', 'GRANT_PURCHASE', 'GRANT_BONUS', 'RESERVE_RELEASE', 'ROLLOVER_IN') then credits > 0
    when entry_type in ('CONSUME', 'RESERVE', 'EXPIRE', 'ROLLOVER_OUT') then credits < 0
    else credits <> 0 end),
  constraint ai_credit_ledger_reverses_ck check (
    (entry_type in ('REVERSAL', 'RESERVE_RELEASE')) = (reverses_entry_id is not null)),
  constraint ai_credit_ledger_consume_ck check (
    entry_type <> 'CONSUME' or (usage_aggregate_id is not null and weight_id is not null and weight_applied is not null)),
  constraint ai_credit_ledger_pool_ck check (pool_key = 'TENANT' or pool_key ~ '^PRODUCT:[a-z0-9]+$'),
  constraint ai_credit_ledger_period_ck check (period_start = date_trunc('month', period_start)::date),
  constraint ai_credit_ledger_key_ck check (length(entry_idempotency_key) between 1 and 200),
  constraint ai_credit_ledger_reason_ck check (
    entry_type not in ('ADJUST', 'GRANT_BONUS', 'GRANT_PURCHASE', 'REVERSAL') or length(trim(coalesce(reason, ''))) > 0)
);
create unique index ai_credit_ledger_key_uk on platform.ai_credit_ledger (tenant_id, entry_idempotency_key);
create unique index ai_credit_ledger_reverses_uk on platform.ai_credit_ledger (reverses_entry_id) where reverses_entry_id is not null;
create index ai_credit_ledger_balance_ix on platform.ai_credit_ledger (tenant_id, pool_key, period_start);
create index ai_credit_ledger_aggregate_ix on platform.ai_credit_ledger (usage_aggregate_id) where usage_aggregate_id is not null;

comment on table platform.ai_credit_ledger is
  'Ledger append-only de créditos IA (spec §12.3). El saldo es derivado (v_ai_credit_balances); '
  'una corrección es una entrada nueva (ADJUST o REVERSAL), nunca un UPDATE.';

create trigger ai_credit_ledger_no_update_delete before update or delete on platform.ai_credit_ledger
  for each row execute function platform.usage_append_only();
create trigger ai_credit_ledger_no_truncate before truncate on platform.ai_credit_ledger
  for each statement execute function platform.usage_append_only();

alter table platform.ai_credit_ledger enable row level security;
alter table platform.ai_credit_ledger force row level security;
revoke all on platform.ai_credit_ledger from public, anon, authenticated;
grant select on platform.ai_credit_ledger to authenticated;
grant select on platform.ai_credit_ledger to service_role;
create policy ai_credit_ledger_select on platform.ai_credit_ledger
  for select to authenticated using (platform.can_read_tenant(tenant_id));

create view platform.v_ai_credit_balances
with (security_invoker = true) as
  with l as (
    select e.tenant_id, e.saas_product_id, e.pool_key, e.period_start, e.credits,
           case when e.entry_type in ('REVERSAL', 'RESERVE_RELEASE') then o.entry_type else e.entry_type end as category
      from platform.ai_credit_ledger e
      left join platform.ai_credit_ledger o on o.id = e.reverses_entry_id
  )
  select tenant_id, saas_product_id, pool_key, period_start,
         coalesce(sum(credits) filter (where category = 'GRANT_PERIOD'), 0)    as included,
         coalesce(sum(credits) filter (where category = 'GRANT_PURCHASE'), 0)  as purchased,
         coalesce(sum(credits) filter (where category = 'GRANT_BONUS'), 0)     as bonus,
         coalesce(-sum(credits) filter (where category = 'RESERVE'), 0)        as reserved,
         coalesce(-sum(credits) filter (where category = 'CONSUME'), 0)        as used,
         coalesce(-sum(credits) filter (where category = 'EXPIRE'), 0)         as expired,
         coalesce(sum(credits) filter (where category = 'ADJUST'), 0)          as adjusted,
         coalesce(sum(credits) filter (where category in ('ROLLOVER_IN', 'ROLLOVER_OUT')), 0) as rollover_net,
         sum(credits)                                                          as balance
    from l
   group by tenant_id, saas_product_id, pool_key, period_start;
revoke all on platform.v_ai_credit_balances from public, anon, authenticated;
grant select on platform.v_ai_credit_balances to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------------
-- Políticas aplicables a un tenant en una fecha: la del plan vigente (misma
-- regla que el snapshot) y las de sus add-ons ACTIVE.
create or replace function platform.ai_credit_applicable_policies(p_tenant_id uuid, p_at date)
returns setof platform.ai_credit_policies
language sql
stable
set search_path = platform, pg_catalog
as $$
  with t as (
    select id, saas_product_id, customer_organization_id from platform.tenants where id = p_tenant_id
  ),
  plan as (
    select s.plan_id
      from platform.subscriptions s, t
     where s.saas_product_id = t.saas_product_id
       and s.status in ('ACTIVE', 'PAST_DUE')
       and (s.tenant_id = t.id or (s.tenant_id is null and s.billed_organization_id = t.customer_organization_id))
       and s.started_on <= p_at and (s.ends_on is null or s.ends_on >= p_at)
     order by (s.tenant_id is not null) desc, s.started_on desc, s.id
     limit 1
  ),
  addons as (
    select ci.id as catalog_item_id
      from platform.tenant_addons ta
      join platform.catalog_items ci on ci.code = ta.addon_code
     where ta.tenant_id = p_tenant_id and ta.status = 'ACTIVE'
       and (ta.effective_from is null or ta.effective_from::date <= p_at)
       and (ta.effective_to is null or ta.effective_to::date > p_at)
  )
  select p.* from platform.ai_credit_policies p, t
   where p.saas_product_id = t.saas_product_id
     and p.valid_from <= p_at and (p.valid_to is null or p.valid_to > p_at)
     and (p.plan_id in (select plan_id from plan) or p.catalog_item_id in (select catalog_item_id from addons));
$$;
revoke all on function platform.ai_credit_applicable_policies(uuid, date) from public, anon, authenticated;

create or replace function platform.ai_credit_pool_key(p_scope text, p_product_id uuid)
returns text
language sql
stable
set search_path = platform, pg_catalog
as $$
  select case p_scope when 'TENANT' then 'TENANT'
                      when 'PRODUCT' then 'PRODUCT:' || (select code from platform.saas_products where id = p_product_id) end;
$$;
revoke all on function platform.ai_credit_pool_key(text, uuid) from public, anon, authenticated;

create or replace function platform.ai_credit_assert_pool(p_tenant_id uuid, p_pool_key text)
returns uuid
language plpgsql
stable
set search_path = platform, pg_catalog
as $$
declare
  v_product uuid;
  v_code    text;
begin
  select t.saas_product_id, p.code into v_product, v_code
    from platform.tenants t join platform.saas_products p on p.id = t.saas_product_id where t.id = p_tenant_id;
  if v_product is null then
    raise exception 'TENANT_NO_ENCONTRADO: %', p_tenant_id using errcode = 'P0002';
  end if;
  if p_pool_key is distinct from 'TENANT' and p_pool_key is distinct from 'PRODUCT:' || v_code then
    raise exception 'POOL_INVALIDO: % no es un pool del tenant (TENANT o PRODUCT:%)', p_pool_key, v_code using errcode = '22023';
  end if;
  return v_product;
end;
$$;
revoke all on function platform.ai_credit_assert_pool(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Configuración (finanzas)
-- ---------------------------------------------------------------------------
create or replace function platform.set_ai_credit_weight(
  p_capability_code text, p_credits_per_unit numeric, p_unit text, p_valid_from timestamptz, p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_cap  platform.product_capabilities;
  v_open platform.ai_credit_weights;
  v_id   uuid;
begin
  if not (platform.can_read_finance() and auth.uid() is not null) then
    raise exception 'NO_AUTORIZADO: el peso de crédito es una decisión comercial de EBIM_FINANCE (D-03)' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO' using errcode = '23502';
  end if;
  if p_credits_per_unit is null or p_credits_per_unit < 0 then
    raise exception 'PESO_INVALIDO: los créditos por unidad son ≥ 0' using errcode = '23514';
  end if;
  select * into v_cap from platform.product_capabilities where code = p_capability_code;
  if v_cap.id is null then
    raise exception 'CAPACIDAD_NO_ENCONTRADA: %', p_capability_code using errcode = '23503';
  end if;
  if v_cap.kind <> 'AI_FEATURE' then
    raise exception 'CAPACIDAD_NO_IA: % es %', p_capability_code, v_cap.kind using errcode = '23514';
  end if;
  if p_valid_from is null then
    raise exception 'VIGENCIA_REQUERIDA' using errcode = '23502';
  end if;
  if exists (select 1 from platform.ai_credit_weights where capability_id = v_cap.id and valid_from >= p_valid_from) then
    raise exception 'VIGENCIA_INVALIDA: un peso nuevo no empieza antes ni a la vez que uno existente' using errcode = '23514';
  end if;

  select * into v_open from platform.ai_credit_weights where capability_id = v_cap.id and valid_to is null for update;
  if v_open.id is not null then
    update platform.ai_credit_weights set valid_to = p_valid_from where id = v_open.id;
  end if;
  insert into platform.ai_credit_weights (capability_id, credits_per_unit, unit, valid_from, reason, created_by)
  values (v_cap.id, p_credits_per_unit, p_unit, p_valid_from, trim(p_reason), auth.uid())
  returning id into v_id;

  -- Los pesos viajan en el snapshot: los tenants enrolados del producto se re-emiten.
  perform platform.mark_entitlements_dirty(d.tenant_id, d.saas_product_id, 'AI_CREDIT_WEIGHT_CHANGED')
     from platform.entitlement_desired_state d where d.saas_product_id = v_cap.saas_product_id;
  perform platform.log_audit('AI_CREDIT_WEIGHT_SET', 'ai_credit_weight', v_id::text, null, null,
    jsonb_build_object('capability', p_capability_code, 'credits_per_unit', p_credits_per_unit, 'unit', p_unit,
                       'valid_from', p_valid_from, 'previous', v_open.id, 'reason', trim(p_reason)));
  return v_id;
end;
$$;
revoke all on function platform.set_ai_credit_weight(text, numeric, text, timestamptz, text) from public, anon;
grant execute on function platform.set_ai_credit_weight(text, numeric, text, timestamptz, text) to authenticated;

create or replace function platform.create_ai_credit_policy(
  p_source_type text, p_source_code text, p_pool_scope text, p_included_credits numeric,
  p_overage_mode text, p_valid_from date, p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_plan    uuid;
  v_item    uuid;
  v_product uuid;
  v_id      uuid;
begin
  if not (platform.can_read_finance() and auth.uid() is not null) then
    raise exception 'NO_AUTORIZADO: las políticas de créditos son de EBIM_FINANCE (D-03)' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO' using errcode = '23502';
  end if;
  if p_source_type = 'PLAN' then
    select id, saas_product_id into v_plan, v_product from platform.plans where code = p_source_code;
  elsif p_source_type = 'CATALOG_ITEM' then
    select id, saas_product_id into v_item, v_product from platform.catalog_items where code = p_source_code;
  else
    raise exception 'FUENTE_INVALIDA: % (PLAN o CATALOG_ITEM)', p_source_type using errcode = '22023';
  end if;
  if v_plan is null and v_item is null then
    raise exception 'FUENTE_NO_ENCONTRADA: %', p_source_code using errcode = '23503';
  end if;
  if v_product is null then
    raise exception 'FUENTE_SIN_PRODUCTO: los créditos se definen por producto' using errcode = '22023';
  end if;
  insert into platform.ai_credit_policies (saas_product_id, source_type, plan_id, catalog_item_id, pool_scope,
                                           included_credits, overage_mode, valid_from, reason, created_by)
  values (v_product, p_source_type, v_plan, v_item, p_pool_scope, p_included_credits, p_overage_mode,
          coalesce(p_valid_from, current_date), trim(p_reason), auth.uid())
  returning id into v_id;
  perform platform.log_audit('AI_CREDIT_POLICY_CREATED', 'ai_credit_policy', v_id::text, null, null,
    jsonb_build_object('source', p_source_type, 'code', p_source_code, 'pool_scope', p_pool_scope,
                       'included', p_included_credits, 'overage_mode', p_overage_mode, 'reason', trim(p_reason)));
  return v_id;
end;
$$;
revoke all on function platform.create_ai_credit_policy(text, text, text, numeric, text, date, text) from public, anon;
grant execute on function platform.create_ai_credit_policy(text, text, text, numeric, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Movimientos
-- ---------------------------------------------------------------------------
-- GRANT_PERIOD de los incluidos (servidor o finanzas). Idempotente por política × período.
create or replace function platform.open_ai_credit_period(p_tenant_id uuid, p_period_start date)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_tenant  platform.tenants;
  v_pol     platform.ai_credit_policies;
  v_found   boolean := false;
  v_granted integer := 0;
  v_rows    integer;
begin
  if not (platform.is_service_request() or (platform.can_read_finance() and auth.uid() is not null)) then
    raise exception 'NO_AUTORIZADO: job de servidor o EBIM_FINANCE' using errcode = '42501';
  end if;
  if p_period_start is null or p_period_start <> date_trunc('month', p_period_start)::date then
    raise exception 'PERIODO_INVALIDO: el período empieza el día 1' using errcode = '22023';
  end if;
  select * into v_tenant from platform.tenants where id = p_tenant_id;
  if v_tenant.id is null then
    raise exception 'TENANT_NO_ENCONTRADO: %', p_tenant_id using errcode = 'P0002';
  end if;

  for v_pol in select * from platform.ai_credit_applicable_policies(p_tenant_id, p_period_start)
                where included_credits is not null and pool_scope is not null loop
    v_found := true;
    if v_pol.included_credits = 0 then
      continue;
    end if;
    insert into platform.ai_credit_ledger (tenant_id, saas_product_id, pool_key, period_start, entry_type, credits,
                                           entry_idempotency_key, policy_id, reason)
    values (p_tenant_id, v_tenant.saas_product_id, platform.ai_credit_pool_key(v_pol.pool_scope, v_tenant.saas_product_id),
            p_period_start, 'GRANT_PERIOD', v_pol.included_credits,
            'grant:' || v_pol.id || ':' || p_period_start, v_pol.id, 'Incluidos del período')
    on conflict (tenant_id, entry_idempotency_key) do nothing;
    get diagnostics v_rows = row_count;
    v_granted := v_granted + v_rows;
  end loop;

  if not v_found then
    insert into platform.usage_alerts (tenant_id, saas_product_id, code, detail)
    values (p_tenant_id, v_tenant.saas_product_id, 'POLITICA_CREDITOS_NO_DEFINIDA',
            jsonb_build_object('period', p_period_start, 'step', 'GRANT_PERIOD'));
    return jsonb_build_object('granted', 0, 'code', 'POLITICA_CREDITOS_NO_DEFINIDA');
  end if;
  return jsonb_build_object('granted', v_granted);
end;
$$;
revoke all on function platform.open_ai_credit_period(uuid, date) from public, anon;
grant execute on function platform.open_ai_credit_period(uuid, date) to authenticated, service_role;

-- Compra, bono o ajuste manual de finanzas. Idempotente por clave.
create or replace function platform.record_ai_credit_entry(
  p_tenant_id uuid, p_pool_key text, p_period_start date, p_entry_type text, p_credits numeric,
  p_reason text, p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_product uuid;
  v_prev    platform.ai_credit_ledger;
  v_id      uuid;
begin
  if not (platform.can_read_finance() and auth.uid() is not null) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE registra movimientos manuales de créditos' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO' using errcode = '23502';
  end if;
  if p_entry_type not in ('GRANT_PURCHASE', 'GRANT_BONUS', 'ADJUST') then
    raise exception 'TIPO_NO_MANUAL: % (manual: GRANT_PURCHASE, GRANT_BONUS, ADJUST)', p_entry_type using errcode = '22023';
  end if;
  v_product := platform.ai_credit_assert_pool(p_tenant_id, p_pool_key);

  select * into v_prev from platform.ai_credit_ledger
   where tenant_id = p_tenant_id and entry_idempotency_key = p_idempotency_key;
  if v_prev.id is not null then
    if v_prev.entry_type = p_entry_type and v_prev.credits = p_credits and v_prev.pool_key = p_pool_key
       and v_prev.period_start = p_period_start then
      return v_prev.id;
    end if;
    raise exception 'CLAVE_EN_CONFLICTO: % ya existe con otro contenido', p_idempotency_key using errcode = '23505';
  end if;

  insert into platform.ai_credit_ledger (tenant_id, saas_product_id, pool_key, period_start, entry_type, credits,
                                         entry_idempotency_key, reason, created_by)
  values (p_tenant_id, v_product, p_pool_key, p_period_start, p_entry_type, p_credits, p_idempotency_key,
          trim(p_reason), auth.uid())
  returning id into v_id;
  perform platform.log_audit('AI_CREDIT_ENTRY', 'ai_credit_ledger', v_id::text, null, p_tenant_id,
    jsonb_build_object('type', p_entry_type, 'credits', p_credits, 'pool', p_pool_key, 'period', p_period_start,
                       'reason', trim(p_reason)));
  return v_id;
end;
$$;
revoke all on function platform.record_ai_credit_entry(uuid, text, date, text, numeric, text, text) from public, anon;
grant execute on function platform.record_ai_credit_entry(uuid, text, date, text, numeric, text, text) to authenticated;

create or replace function platform.reverse_ai_credit_entry(p_entry_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_orig platform.ai_credit_ledger;
  v_id   uuid;
begin
  if not (platform.can_read_finance() and auth.uid() is not null) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE revierte movimientos de créditos' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO' using errcode = '23502';
  end if;
  select * into v_orig from platform.ai_credit_ledger where id = p_entry_id;
  if v_orig.id is null then
    raise exception 'ENTRADA_NO_ENCONTRADA: %', p_entry_id using errcode = 'P0002';
  end if;
  if v_orig.entry_type in ('REVERSAL', 'RESERVE_RELEASE') then
    raise exception 'NO_REVERSIBLE: una % no se revierte', v_orig.entry_type using errcode = '22023';
  end if;
  insert into platform.ai_credit_ledger (tenant_id, saas_product_id, pool_key, period_start, entry_type, credits,
                                         entry_idempotency_key, reverses_entry_id, reason, created_by)
  values (v_orig.tenant_id, v_orig.saas_product_id, v_orig.pool_key, v_orig.period_start, 'REVERSAL', -v_orig.credits,
          'reversal:' || v_orig.id, v_orig.id, trim(p_reason), auth.uid())
  returning id into v_id;
  perform platform.log_audit('AI_CREDIT_REVERSAL', 'ai_credit_ledger', v_id::text, null, v_orig.tenant_id,
    jsonb_build_object('reverses', v_orig.id, 'type', v_orig.entry_type, 'credits', -v_orig.credits, 'reason', trim(p_reason)));
  return v_id;
end;
$$;
revoke all on function platform.reverse_ai_credit_entry(uuid, text) from public, anon;
grant execute on function platform.reverse_ai_credit_entry(uuid, text) to authenticated;

-- Reservas del servidor (pre-chequeo de un consumo en curso).
create or replace function platform.reserve_ai_credits(
  p_tenant_id uuid, p_pool_key text, p_period_start date, p_credits numeric, p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_product uuid;
  v_id      uuid;
begin
  if not platform.is_service_request() then
    raise exception 'NO_AUTORIZADO: las reservas son del servidor' using errcode = '42501';
  end if;
  if p_credits is null or p_credits <= 0 then
    raise exception 'RESERVA_INVALIDA: créditos > 0' using errcode = '22023';
  end if;
  v_product := platform.ai_credit_assert_pool(p_tenant_id, p_pool_key);
  insert into platform.ai_credit_ledger (tenant_id, saas_product_id, pool_key, period_start, entry_type, credits,
                                         entry_idempotency_key)
  values (p_tenant_id, v_product, p_pool_key, p_period_start, 'RESERVE', -p_credits, p_idempotency_key)
  on conflict (tenant_id, entry_idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from platform.ai_credit_ledger
     where tenant_id = p_tenant_id and entry_idempotency_key = p_idempotency_key and entry_type = 'RESERVE'
       and credits = -p_credits;
    if v_id is null then
      raise exception 'CLAVE_EN_CONFLICTO: %', p_idempotency_key using errcode = '23505';
    end if;
  end if;
  return v_id;
end;
$$;
revoke all on function platform.reserve_ai_credits(uuid, text, date, numeric, text) from public, anon, authenticated;
grant execute on function platform.reserve_ai_credits(uuid, text, date, numeric, text) to service_role;

create or replace function platform.release_ai_credit_reservation(p_reservation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_res platform.ai_credit_ledger;
  v_id  uuid;
begin
  if not platform.is_service_request() then
    raise exception 'NO_AUTORIZADO: las reservas son del servidor' using errcode = '42501';
  end if;
  select * into v_res from platform.ai_credit_ledger where id = p_reservation_id and entry_type = 'RESERVE';
  if v_res.id is null then
    raise exception 'RESERVA_NO_ENCONTRADA: %', p_reservation_id using errcode = 'P0002';
  end if;
  insert into platform.ai_credit_ledger (tenant_id, saas_product_id, pool_key, period_start, entry_type, credits,
                                         entry_idempotency_key, reverses_entry_id)
  values (v_res.tenant_id, v_res.saas_product_id, v_res.pool_key, v_res.period_start, 'RESERVE_RELEASE', -v_res.credits,
          'release:' || v_res.id, v_res.id)
  on conflict (tenant_id, entry_idempotency_key) do nothing
  returning id into v_id;
  return coalesce(v_id, (select id from platform.ai_credit_ledger where reverses_entry_id = v_res.id));
end;
$$;
revoke all on function platform.release_ai_credit_reservation(uuid) from public, anon, authenticated;
grant execute on function platform.release_ai_credit_reservation(uuid) to service_role;

-- D-04: sin política de expiración/rollover no hay entradas EXPIRE/ROLLOVER.
-- La CHECK de ai_credit_policies impide configurarla, así que hoy siempre falla.
create or replace function platform.expire_ai_credits(p_tenant_id uuid, p_pool_key text, p_period_start date)
returns integer
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if not (platform.is_service_request() or (platform.can_read_finance() and auth.uid() is not null)) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501';
  end if;
  if not exists (select 1 from platform.ai_credit_applicable_policies(p_tenant_id, p_period_start)
                  where expiry_policy is not null or rollover_policy is not null) then
    raise exception 'POLITICA_EXPIRACION_NO_DEFINIDA: sin decisión D-04 no se expiran ni se trasladan créditos';
  end if;
  raise exception 'NO_IMPLEMENTADO: la política D-04 aún no tiene reglas' using errcode = '0A000';
end;
$$;
revoke all on function platform.expire_ai_credits(uuid, text, date) from public, anon;
grant execute on function platform.expire_ai_credits(uuid, text, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. CONSUME al finalizar un agregado de IA
-- ---------------------------------------------------------------------------
create or replace function platform.ai_credits_on_aggregate_finalized()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_meter   platform.usage_meters;
  v_kind    text;
  v_scopes  text[];
  v_modes   text[];
  v_pool    text;
  v_mode    text;
  v_policy  uuid;
  v_g       record;
  v_missing numeric;
  v_missing_n integer;
  v_balance numeric;
begin
  select * into v_meter from platform.usage_meters where id = new.meter_id;
  select kind into v_kind from platform.product_capabilities where id = v_meter.capability_id;
  if v_kind is distinct from 'AI_FEATURE' then
    return null;
  end if;
  if v_meter.aggregation <> 'SUM' then
    insert into platform.usage_alerts (tenant_id, saas_product_id, aggregate_id, code, detail)
    values (new.tenant_id, new.saas_product_id, new.id, 'CREDIT_METER_NOT_SUM', jsonb_build_object('meter', v_meter.code));
    return null;
  end if;

  select array_agg(distinct pool_scope) filter (where pool_scope is not null),
         array_agg(distinct coalesce(overage_mode, 'NO_DEFINIDO')),
         min(id::text)::uuid
    into v_scopes, v_modes, v_policy
    from platform.ai_credit_applicable_policies(new.tenant_id, new.period_start);
  if coalesce(cardinality(v_scopes), 0) = 0 then
    insert into platform.usage_alerts (tenant_id, saas_product_id, aggregate_id, code, detail)
    values (new.tenant_id, new.saas_product_id, new.id, 'POLITICA_CREDITOS_NO_DEFINIDA',
            jsonb_build_object('meter', v_meter.code, 'period', new.period_start, 'quantity', new.quantity));
    return null;
  end if;
  if cardinality(v_scopes) > 1 then
    insert into platform.usage_alerts (tenant_id, saas_product_id, aggregate_id, code, detail)
    values (new.tenant_id, new.saas_product_id, new.id, 'POOL_SCOPE_CONFLICT', jsonb_build_object('scopes', v_scopes));
    return null;
  end if;
  v_pool := platform.ai_credit_pool_key(v_scopes[1], new.saas_product_id);

  -- Un CONSUME por peso vigente en occurred_at de cada evento del agregado.
  for v_g in
    select w.id as weight_id, w.credits_per_unit, sum(e.quantity) as qty
      from platform.usage_events e
      join platform.ai_credit_weights w
        on w.capability_id = v_meter.capability_id
       and w.valid_from <= e.occurred_at and (w.valid_to is null or w.valid_to > e.occurred_at)
     where e.tenant_id = new.tenant_id and e.meter_id = new.meter_id and e.period_start = new.period_start
     group by w.id, w.credits_per_unit
  loop
    if v_g.qty * v_g.credits_per_unit > 0 then
      insert into platform.ai_credit_ledger (tenant_id, saas_product_id, pool_key, period_start, entry_type, credits,
                                             entry_idempotency_key, usage_aggregate_id, capability_id, weight_id,
                                             weight_applied, quantity, policy_id)
      values (new.tenant_id, new.saas_product_id, v_pool, new.period_start, 'CONSUME',
              -(v_g.qty * v_g.credits_per_unit), 'consume:' || new.id || ':' || v_g.weight_id, new.id,
              v_meter.capability_id, v_g.weight_id, v_g.credits_per_unit, v_g.qty, v_policy)
      on conflict (tenant_id, entry_idempotency_key) do nothing;
    end if;
  end loop;

  select count(*), coalesce(sum(e.quantity), 0) into v_missing_n, v_missing
    from platform.usage_events e
   where e.tenant_id = new.tenant_id and e.meter_id = new.meter_id and e.period_start = new.period_start
     and not exists (select 1 from platform.ai_credit_weights w
                      where w.capability_id = v_meter.capability_id
                        and w.valid_from <= e.occurred_at and (w.valid_to is null or w.valid_to > e.occurred_at));
  if v_missing_n > 0 then
    insert into platform.usage_alerts (tenant_id, saas_product_id, aggregate_id, code, detail)
    values (new.tenant_id, new.saas_product_id, new.id, 'PESO_CREDITO_NO_DEFINIDO',
            jsonb_build_object('meter', v_meter.code, 'events', v_missing_n, 'quantity', v_missing));
  end if;

  select sum(credits) into v_balance from platform.ai_credit_ledger
   where tenant_id = new.tenant_id and pool_key = v_pool and period_start = new.period_start;
  if coalesce(v_balance, 0) < 0 then
    v_mode := case when 'BLOCK' = any(v_modes) then 'BLOCK'
                   when 'NO_DEFINIDO' = any(v_modes) then 'NO_DEFINIDO'
                   else 'ALLOW' end;
    insert into platform.usage_alerts (tenant_id, saas_product_id, aggregate_id, code, detail)
    values (new.tenant_id, new.saas_product_id, new.id, 'CREDIT_OVERAGE',
            jsonb_build_object('pool', v_pool, 'period', new.period_start, 'balance', v_balance, 'overageMode', v_mode));
  end if;
  return null;
end;
$$;
revoke all on function platform.ai_credits_on_aggregate_finalized() from public, anon, authenticated;

create trigger usage_period_aggregates_ai_credits after update of status on platform.usage_period_aggregates
  for each row when (new.status = 'FINALIZED' and old.status is distinct from 'FINALIZED')
  execute function platform.ai_credits_on_aggregate_finalized();

-- ---------------------------------------------------------------------------
-- 8. aiCredits del snapshot
-- ---------------------------------------------------------------------------
create or replace function platform.ai_credit_weights_snapshot(p_product_id uuid, p_at timestamptz)
returns jsonb
language sql
stable
set search_path = platform, pg_catalog
as $$
  select jsonb_build_object(
    'weights', coalesce((
      select jsonb_agg(jsonb_build_object('capabilityCode', c.code, 'creditsPerUnit', trim_scale(w.credits_per_unit),
                                          'unit', w.unit) order by c.code collate "C")
        from platform.ai_credit_weights w
        join platform.product_capabilities c on c.id = w.capability_id
       where c.saas_product_id = p_product_id and c.status in ('ACTIVE', 'DEPRECATED')
         and w.valid_from <= p_at and (w.valid_to is null or w.valid_to > p_at)), '[]'::jsonb),
    -- Revisión monótona de la configuración: cada alta y cada cierre suma uno.
    'weightsVersion', (
      select (count(*) + count(w.valid_to))::int
        from platform.ai_credit_weights w
        join platform.product_capabilities c on c.id = w.capability_id
       where c.saas_product_id = p_product_id));
$$;
revoke all on function platform.ai_credit_weights_snapshot(uuid, timestamptz) from public, anon;
grant execute on function platform.ai_credit_weights_snapshot(uuid, timestamptz) to authenticated, service_role;

do $$
declare
  v_def text := pg_get_functiondef('platform.entitlement_snapshot_content(uuid, uuid, timestamptz)'::regprocedure);
  v_old text := $x$jsonb_build_object('weights', '[]'::jsonb, 'weightsVersion', 0)$x$;
  v_new text := 'platform.ai_credit_weights_snapshot(p_product_id, p_at)';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'CCP17_PATCH_DRIFT: entitlement_snapshot_content no tiene exactamente una expresión aiCredits vacía';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$$;
