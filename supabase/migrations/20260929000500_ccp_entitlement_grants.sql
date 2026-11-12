-- ============================================================================
-- EBIM Commercial Control Plane · Fase 07 · grants, overrides y estado deseado
-- (Task MA-14)
-- ----------------------------------------------------------------------------
-- Spec §6.1 (entitlement_grants), §3.3 (tenant_entitlement_overrides), §6.2
-- (cada cambio marca dirty), §14. Plan §4 fila 7.
-- Test: supabase/tests/31_ccp_entitlement_grants.test.sql.
--
--   · entitlement_grants: plan o add-on → capacidad, con vigencia. La columna
--     se llama `grant_value` (la spec dice `grant`, palabra reservada de SQL).
--     Origen con dos FK reales (plan_id / catalog_item_id) en vez de un
--     source_id polimórfico, para que la integridad la dé la base.
--     Inmutable salvo valid_to (solo se acorta); nunca se borra; GiST sin
--     solapes por (origen, capacidad).
--   · Forma de grant por kind (spec §6.1). Un valor no decidido NO se crea:
--     no hay defaults (sin `enforcement` o sin `included` = rechazo).
--   · tenant_entitlement_overrides: GRANT (misma forma) o DENY; reason,
--     approved_by (= quien ejecuta) y expires_at obligatorios; solo se revoca.
--     Autoridad: EBIM_FINANCE o super admin (spec §14.1).
--   · entitlement_desired_state: el "estado deseado" por tenant×producto
--     (revisión monótona + dirty). La fase 08 le cuelga los snapshots y el
--     estado de sync; hoy solo registra que algo comercial cambió.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Forma de un grant según el kind de la capacidad (pura).
-- ---------------------------------------------------------------------------
create or replace function platform.is_valid_grant_value(p_kind text, p_value jsonb)
returns boolean
language sql
immutable
set search_path = platform, pg_catalog
as $$
  -- coalesce: bool_and sobre un objeto vacío es NULL, y NULL no debe pasar por válido.
  select coalesce(case
    when p_value is null or jsonb_typeof(p_value) <> 'object' then false
    when p_kind = 'FEATURE' then
      p_value = '{"enabled": true}'::jsonb
    when p_kind = 'AI_FEATURE' then
      p_value -> 'enabled' = 'true'::jsonb
      and (select bool_and(k in ('enabled', 'creditPolicyId')) from jsonb_object_keys(p_value) k)
      and (not p_value ? 'creditPolicyId' or jsonb_typeof(p_value -> 'creditPolicyId') = 'string')
    when p_kind = 'LIMIT' then
      (select bool_and(k in ('value', 'enforcement')) from jsonb_object_keys(p_value) k)
      and jsonb_typeof(p_value -> 'value') = 'number'
      and (p_value ->> 'value')::numeric >= 0
      and (p_value ->> 'value')::numeric = trunc((p_value ->> 'value')::numeric)
      and p_value ->> 'enforcement' in ('HARD', 'SOFT')
    when p_kind = 'ALLOWANCE' then
      (select bool_and(k in ('included', 'period')) from jsonb_object_keys(p_value) k)
      and jsonb_typeof(p_value -> 'included') = 'number'
      and (p_value ->> 'included')::numeric >= 0
      and p_value ->> 'period' = 'MONTH'
    else false
  end, false);
$$;

comment on function platform.is_valid_grant_value(text, jsonb) is
  'Spec §6.1: FEATURE {"enabled":true} · AI_FEATURE + "creditPolicyId" opcional · '
  'LIMIT {"value":int>=0,"enforcement":HARD|SOFT} · ALLOWANCE {"included":>=0,"period":"MONTH"}. '
  'Sin claves extra ni defaults.';

revoke all on function platform.is_valid_grant_value(text, jsonb) from public, anon;
grant execute on function platform.is_valid_grant_value(text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. entitlement_desired_state
-- ---------------------------------------------------------------------------
create table platform.entitlement_desired_state (
  tenant_id          uuid not null references platform.tenants (id) on delete cascade,
  saas_product_id    uuid not null references platform.saas_products (id) on delete restrict,
  desired_revision   bigint not null default 0,
  desired_dirty      boolean not null default false,
  dirty_since        timestamptz,
  last_change_reason text,
  last_change_at     timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (tenant_id, saas_product_id),
  constraint entitlement_desired_state_revision_ck check (desired_revision >= 0)
);

create index entitlement_desired_state_product_ix on platform.entitlement_desired_state (saas_product_id);
create index entitlement_desired_state_dirty_ix on platform.entitlement_desired_state (saas_product_id)
  where desired_dirty;
create trigger entitlement_desired_state_set_updated_at before update on platform.entitlement_desired_state
  for each row execute function platform.set_updated_at();

comment on table platform.entitlement_desired_state is
  'Estado deseado de entitlements por tenant×producto: revisión monótona y marca dirty que '
  'pone cada cambio comercial (spec §6.2). La fase 08 emite el snapshot a partir de aquí.';

create or replace function platform.mark_entitlements_dirty(
  p_tenant_id uuid,
  p_product_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if p_tenant_id is null or p_product_id is null then
    return;
  end if;
  insert into platform.entitlement_desired_state as s (
    tenant_id, saas_product_id, desired_revision, desired_dirty, dirty_since, last_change_reason, last_change_at
  ) values (
    p_tenant_id, p_product_id, 1, true, now(), p_reason, now()
  )
  on conflict (tenant_id, saas_product_id) do update
    set desired_revision   = s.desired_revision + 1,
        desired_dirty      = true,
        dirty_since        = coalesce(s.dirty_since, now()),
        last_change_reason = excluded.last_change_reason,
        last_change_at     = now();
end;
$$;

comment on function platform.mark_entitlements_dirty(uuid, uuid, text) is
  'Interna: la llaman las RPCs comerciales DEFINER. Sin EXECUTE para authenticated.';

revoke all on function platform.mark_entitlements_dirty(uuid, uuid, text) from public, anon, authenticated;
grant execute on function platform.mark_entitlements_dirty(uuid, uuid, text) to service_role;

-- Tenants afectados por un cambio en un plan o un add-on. La versión de esta
-- migración lee tenant_addons.active; …0600 la redefine sobre `status`.
create or replace function platform.mark_entitlements_dirty_for_source(
  p_plan_id         uuid,
  p_catalog_item_id uuid,
  p_reason          text
)
returns integer
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_count integer := 0;
  r record;
begin
  if p_plan_id is not null then
    for r in
      select distinct t.id as tenant_id, t.saas_product_id
        from platform.subscriptions s
        join platform.tenants t
          on (t.id = s.tenant_id)
          or (s.tenant_id is null and t.customer_organization_id = s.billed_organization_id
              and t.saas_product_id = s.saas_product_id)
       where s.plan_id = p_plan_id
         and s.status in ('ACTIVE', 'PAST_DUE', 'PAUSED')
    loop
      perform platform.mark_entitlements_dirty(r.tenant_id, r.saas_product_id, p_reason);
      v_count := v_count + 1;
    end loop;
  end if;

  if p_catalog_item_id is not null then
    for r in
      select distinct t.id as tenant_id, t.saas_product_id
        from platform.tenant_addons a
        join platform.catalog_items ci on ci.code = a.addon_code
        join platform.tenants t on t.id = a.tenant_id
       where ci.id = p_catalog_item_id and a.active
    loop
      perform platform.mark_entitlements_dirty(r.tenant_id, r.saas_product_id, p_reason);
      v_count := v_count + 1;
    end loop;
  end if;

  return v_count;
end;
$$;

revoke all on function platform.mark_entitlements_dirty_for_source(uuid, uuid, text) from public, anon, authenticated;
grant execute on function platform.mark_entitlements_dirty_for_source(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. entitlement_grants
-- ---------------------------------------------------------------------------
create table platform.entitlement_grants (
  id              uuid primary key default gen_random_uuid(),
  source_type     text not null,
  plan_id         uuid references platform.plans (id) on delete restrict,
  catalog_item_id uuid references platform.catalog_items (id) on delete restrict,
  capability_id   uuid not null references platform.product_capabilities (id) on delete restrict,
  grant_value     jsonb not null,
  valid_from      date not null default current_date,
  valid_to        date,
  created_by      uuid references platform.profiles (id) on delete set null default auth.uid(),
  closed_by       uuid references platform.profiles (id) on delete set null,
  close_reason    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint entitlement_grants_source_ck check (
    (source_type = 'PLAN' and plan_id is not null and catalog_item_id is null)
    or (source_type = 'CATALOG_ITEM' and catalog_item_id is not null and plan_id is null)),
  constraint entitlement_grants_period_ck check (valid_to is null or valid_to >= valid_from),
  constraint entitlement_grants_no_overlap_ex
    exclude using gist (
      (coalesce(plan_id, catalog_item_id)) with =,
      capability_id with =,
      daterange(valid_from, valid_to, '[]') with &&
    )
);

create index entitlement_grants_plan_ix on platform.entitlement_grants (plan_id) where plan_id is not null;
create index entitlement_grants_item_ix on platform.entitlement_grants (catalog_item_id) where catalog_item_id is not null;
create index entitlement_grants_capability_ix on platform.entitlement_grants (capability_id);
create index entitlement_grants_created_by_ix on platform.entitlement_grants (created_by);
create index entitlement_grants_closed_by_ix on platform.entitlement_grants (closed_by);
create trigger entitlement_grants_set_updated_at before update on platform.entitlement_grants
  for each row execute function platform.set_updated_at();

comment on table platform.entitlement_grants is
  'Plan o add-on → capacidad con vigencia (spec §6.1). Inmutable salvo acortar valid_to; '
  'un valor nuevo es un grant nuevo. Nunca lleva precios.';

create or replace function platform.enforce_entitlement_grant_rules()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_cap          platform.product_capabilities;
  v_source_prod  uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'GRANT_INMUTABLE: un grant no se borra; se cierra su vigencia (grant %)', old.id
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if new.source_type is distinct from old.source_type
       or new.plan_id is distinct from old.plan_id
       or new.catalog_item_id is distinct from old.catalog_item_id
       or new.capability_id is distinct from old.capability_id
       or new.grant_value is distinct from old.grant_value
       or new.valid_from is distinct from old.valid_from
       or new.created_by is distinct from old.created_by then
      raise exception 'GRANT_INMUTABLE: solo se cierra la vigencia (grant %)', old.id using errcode = '23514';
    end if;
    if old.valid_to is not null and (new.valid_to is null or new.valid_to > old.valid_to) then
      raise exception 'GRANT_INMUTABLE: una vigencia cerrada no se alarga ni se reabre (grant %)', old.id
        using errcode = '23514';
    end if;
    return new;
  end if;

  select * into v_cap from platform.product_capabilities where id = new.capability_id;
  if v_cap.id is null then
    raise exception 'CAPACIDAD_NO_ENCONTRADA: %', new.capability_id using errcode = '23503';
  end if;
  if v_cap.is_baseline then
    raise exception 'CAPACIDAD_BASELINE: % va incluida con la app; no se otorga', v_cap.code using errcode = '23514';
  end if;
  if v_cap.status = 'DEPRECATED' then
    raise exception 'CAPACIDAD_DEPRECADA: % no recibe grants nuevos', v_cap.code using errcode = '23514';
  end if;
  if not platform.is_valid_grant_value(v_cap.kind, new.grant_value) then
    raise exception 'GRANT_INVALIDO: % no es un grant válido para % (%)', new.grant_value, v_cap.code, v_cap.kind
      using errcode = '23514';
  end if;

  if new.source_type = 'PLAN' then
    select saas_product_id into v_source_prod from platform.plans where id = new.plan_id;
    if v_source_prod is distinct from v_cap.saas_product_id then
      raise exception 'GRANT_DE_OTRO_PRODUCTO: el plan no pertenece al producto de %', v_cap.code using errcode = '23514';
    end if;
  else
    select saas_product_id into v_source_prod from platform.catalog_items where id = new.catalog_item_id;
    -- null = add-on transversal (extra_company, white_label…): vale para cualquier producto.
    if v_source_prod is not null and v_source_prod <> v_cap.saas_product_id then
      raise exception 'GRANT_DE_OTRO_PRODUCTO: el add-on es de otro producto que %', v_cap.code using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function platform.enforce_entitlement_grant_rules() from public, anon, authenticated;

create trigger entitlement_grants_rules_guard
  before insert or update or delete on platform.entitlement_grants
  for each row execute function platform.enforce_entitlement_grant_rules();

-- ---------------------------------------------------------------------------
-- 3. tenant_entitlement_overrides
-- ---------------------------------------------------------------------------
create table platform.tenant_entitlement_overrides (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references platform.tenants (id) on delete cascade,
  capability_id uuid not null references platform.product_capabilities (id) on delete restrict,
  override_type text not null,
  grant_value   jsonb not null default '{}'::jsonb,
  reason        text not null,
  approved_by   uuid not null references platform.profiles (id) on delete restrict,
  starts_at     timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  revoked_by    uuid references platform.profiles (id) on delete set null,
  revoke_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint teo_type_ck check (override_type in ('GRANT', 'DENY')),
  constraint teo_deny_empty_ck check (override_type = 'GRANT' or grant_value = '{}'::jsonb),
  constraint teo_reason_ck check (length(trim(reason)) > 0),
  constraint teo_period_ck check (expires_at > starts_at),
  constraint teo_revoke_ck check ((revoked_at is null) = (revoke_reason is null)),
  constraint teo_no_overlap_ex
    exclude using gist (
      tenant_id with =,
      capability_id with =,
      tstzrange(starts_at, greatest(starts_at, coalesce(revoked_at, expires_at))) with &&
    )
);

create index teo_capability_ix on platform.tenant_entitlement_overrides (capability_id);
create index teo_approved_by_ix on platform.tenant_entitlement_overrides (approved_by);
create index teo_revoked_by_ix on platform.tenant_entitlement_overrides (revoked_by);
create trigger teo_set_updated_at before update on platform.tenant_entitlement_overrides
  for each row execute function platform.set_updated_at();

comment on table platform.tenant_entitlement_overrides is
  'Excepción manual auditada (cortesía, piloto, bloqueo). reason, approved_by y expires_at '
  'obligatorios; GRANT respeta la forma del kind; DENY retira la capacidad. Solo se revoca.';

create or replace function platform.enforce_entitlement_override_rules()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_cap    platform.product_capabilities;
  v_tenant record;
begin
  if tg_op = 'DELETE' then
    raise exception 'OVERRIDE_INMUTABLE: un override no se borra; se revoca (override %)', old.id using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if (new.tenant_id, new.capability_id, new.override_type, new.grant_value, new.reason, new.approved_by,
        new.starts_at, new.expires_at)
       is distinct from
       (old.tenant_id, old.capability_id, old.override_type, old.grant_value, old.reason, old.approved_by,
        old.starts_at, old.expires_at) then
      raise exception 'OVERRIDE_INMUTABLE: un override solo se revoca (override %)', old.id using errcode = '23514';
    end if;
    if old.revoked_at is not null then
      raise exception 'OVERRIDE_YA_REVOCADO: %', old.id using errcode = '23514';
    end if;
    return new;
  end if;

  select * into v_cap from platform.product_capabilities where id = new.capability_id;
  select id, saas_product_id into v_tenant from platform.tenants where id = new.tenant_id;
  if v_cap.id is null or v_tenant.id is null then
    raise exception 'OVERRIDE_REFERENCIA_INVALIDA' using errcode = '23503';
  end if;
  if v_cap.saas_product_id <> v_tenant.saas_product_id then
    raise exception 'OVERRIDE_DE_OTRO_PRODUCTO: % no es una capacidad del producto del tenant', v_cap.code
      using errcode = '23514';
  end if;
  if new.override_type = 'GRANT' and not platform.is_valid_grant_value(v_cap.kind, new.grant_value) then
    raise exception 'GRANT_INVALIDO: % no es válido para % (%)', new.grant_value, v_cap.code, v_cap.kind
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function platform.enforce_entitlement_override_rules() from public, anon, authenticated;

create trigger teo_rules_guard
  before insert or update or delete on platform.tenant_entitlement_overrides
  for each row execute function platform.enforce_entitlement_override_rules();

-- ---------------------------------------------------------------------------
-- 4. RLS y grants
-- ---------------------------------------------------------------------------
alter table platform.entitlement_grants enable row level security;
alter table platform.entitlement_grants force row level security;
alter table platform.tenant_entitlement_overrides enable row level security;
alter table platform.tenant_entitlement_overrides force row level security;
alter table platform.entitlement_desired_state enable row level security;
alter table platform.entitlement_desired_state force row level security;

revoke all on platform.entitlement_grants, platform.tenant_entitlement_overrides,
              platform.entitlement_desired_state from public, anon, authenticated;
grant select on platform.entitlement_grants, platform.tenant_entitlement_overrides,
                platform.entitlement_desired_state to authenticated;
grant all on platform.entitlement_grants, platform.tenant_entitlement_overrides,
             platform.entitlement_desired_state to service_role;

-- Qué incluye un plan o un add-on es catálogo (como plans/catalog_items): sin montos.
create policy entitlement_grants_select on platform.entitlement_grants
  for select to authenticated using (true);
create policy teo_select on platform.tenant_entitlement_overrides
  for select to authenticated using (platform.can_read_tenant(tenant_id));
create policy entitlement_desired_state_select on platform.entitlement_desired_state
  for select to authenticated using (platform.can_read_tenant(tenant_id));

-- ---------------------------------------------------------------------------
-- 5. RPCs de grants (EBIM_PRODUCT_ADMIN / super admin)
-- ---------------------------------------------------------------------------
create or replace function platform.create_entitlement_grant(
  p_source_type     text,
  p_source_code     text,
  p_capability_code text,
  p_grant_value     jsonb,
  p_valid_from      date default current_date,
  p_reason          text default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_plan  uuid;
  v_item  uuid;
  v_cap   uuid;
  v_clash record;
  v_id    uuid;
  v_dirty integer;
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: solo EBIM_PRODUCT_ADMIN o el super admin mapean planes/add-ons a capacidades'
      using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: todo cambio de grants lleva motivo' using errcode = '23502';
  end if;
  if p_valid_from is null then
    raise exception 'VIGENCIA_INVALIDA: el grant necesita fecha de inicio' using errcode = '23502';
  end if;

  if p_source_type = 'PLAN' then
    select id into v_plan from platform.plans where code = p_source_code;
  elsif p_source_type = 'CATALOG_ITEM' then
    select id into v_item from platform.catalog_items where code = p_source_code;
  else
    raise exception 'ORIGEN_INVALIDO: % (PLAN o CATALOG_ITEM)', p_source_type using errcode = '23514';
  end if;
  if v_plan is null and v_item is null then
    raise exception 'ORIGEN_NO_ENCONTRADO: % %', p_source_type, p_source_code using errcode = '23503';
  end if;

  select id into v_cap from platform.product_capabilities where code = p_capability_code;
  if v_cap is null then
    raise exception 'CAPACIDAD_NO_ENCONTRADA: %', p_capability_code using errcode = '23503';
  end if;

  select g.id, g.valid_from, g.valid_to into v_clash
    from platform.entitlement_grants g
   where coalesce(g.plan_id, g.catalog_item_id) = coalesce(v_plan, v_item)
     and g.capability_id = v_cap
     and daterange(g.valid_from, g.valid_to, '[]') && daterange(p_valid_from, null, '[]')
   limit 1;
  if v_clash.id is not null then
    raise exception 'GRANT_SOLAPADO: % ya tiene un grant de % vigente desde % hasta %; ciérralo antes',
      p_source_code, p_capability_code, v_clash.valid_from, coalesce(v_clash.valid_to::text, 'sin fin')
      using errcode = '23514';
  end if;

  insert into platform.entitlement_grants (source_type, plan_id, catalog_item_id, capability_id, grant_value, valid_from)
  values (p_source_type, v_plan, v_item, v_cap, p_grant_value, p_valid_from)
  returning id into v_id;

  v_dirty := platform.mark_entitlements_dirty_for_source(v_plan, v_item, 'ENTITLEMENT_GRANT_CREATED');

  perform platform.log_audit(
    'ENTITLEMENT_GRANT_CREATED', 'entitlement_grant', v_id::text, null, null,
    jsonb_build_object('source_type', p_source_type, 'source', p_source_code, 'capability', p_capability_code,
                       'grant_value', p_grant_value, 'valid_from', p_valid_from, 'reason', trim(p_reason),
                       'tenants_marked', v_dirty));
  return v_id;
end;
$$;

comment on function platform.create_entitlement_grant(text, text, text, jsonb, date, text) is
  'Mapea un plan o add-on a una capacidad con vigencia. Solo can_manage_platform_entities(); '
  'rechaza solapes, formas inválidas y capacidades baseline/deprecadas. Marca dirty y audita.';

revoke all on function platform.create_entitlement_grant(text, text, text, jsonb, date, text) from public, anon;
grant execute on function platform.create_entitlement_grant(text, text, text, jsonb, date, text) to authenticated, service_role;

create or replace function platform.close_entitlement_grant(
  p_grant_id uuid,
  p_valid_to date,
  p_reason   text
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_grant platform.entitlement_grants;
  v_dirty integer;
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: solo EBIM_PRODUCT_ADMIN o el super admin cierran grants' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: todo cambio de grants lleva motivo' using errcode = '23502';
  end if;

  select * into v_grant from platform.entitlement_grants where id = p_grant_id for update;
  if v_grant.id is null then
    raise exception 'GRANT_NO_ENCONTRADO: %', p_grant_id using errcode = '23503';
  end if;
  if p_valid_to is null or p_valid_to < v_grant.valid_from then
    raise exception 'VIGENCIA_INVALIDA: el cierre (%) no puede ser anterior al inicio (%)', p_valid_to, v_grant.valid_from
      using errcode = '23514';
  end if;

  update platform.entitlement_grants
     set valid_to = p_valid_to, closed_by = auth.uid(), close_reason = trim(p_reason)
   where id = p_grant_id;

  v_dirty := platform.mark_entitlements_dirty_for_source(v_grant.plan_id, v_grant.catalog_item_id, 'ENTITLEMENT_GRANT_CLOSED');

  perform platform.log_audit(
    'ENTITLEMENT_GRANT_CLOSED', 'entitlement_grant', p_grant_id::text, null, null,
    jsonb_build_object('valid_to', p_valid_to, 'previous_valid_to', v_grant.valid_to,
                       'reason', trim(p_reason), 'tenants_marked', v_dirty));
end;
$$;

revoke all on function platform.close_entitlement_grant(uuid, date, text) from public, anon;
grant execute on function platform.close_entitlement_grant(uuid, date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. RPCs de overrides (EBIM_FINANCE / super admin)
-- ---------------------------------------------------------------------------
create or replace function platform.create_entitlement_override(
  p_tenant_id       uuid,
  p_capability_code text,
  p_override_type   text,
  p_grant_value     jsonb,
  p_expires_at      timestamptz,
  p_reason          text,
  p_starts_at       timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_tenant record;
  v_cap    uuid;
  v_clash  uuid;
  v_id     uuid;
begin
  if not platform.can_read_finance() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin crean overrides de entitlement'
      using errcode = '42501';
  end if;
  if auth.uid() is null then
    raise exception 'APROBADOR_REQUERIDO: un override lo aprueba una persona identificada' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: un override lleva motivo' using errcode = '23502';
  end if;
  if p_expires_at is null then
    raise exception 'VENCIMIENTO_REQUERIDO: un override siempre vence' using errcode = '23502';
  end if;
  if p_expires_at <= greatest(now(), coalesce(p_starts_at, now())) then
    raise exception 'VENCIMIENTO_INVALIDO: el override vencería antes de empezar' using errcode = '23514';
  end if;
  if p_override_type not in ('GRANT', 'DENY') then
    raise exception 'OVERRIDE_TIPO_INVALIDO: % (GRANT o DENY)', p_override_type using errcode = '23514';
  end if;

  select id, customer_organization_id, saas_product_id into v_tenant from platform.tenants where id = p_tenant_id;
  if v_tenant.id is null then
    raise exception 'TENANT_NO_ENCONTRADO: %', p_tenant_id using errcode = '23503';
  end if;
  select id into v_cap from platform.product_capabilities where code = p_capability_code;
  if v_cap is null then
    raise exception 'CAPACIDAD_NO_ENCONTRADA: %', p_capability_code using errcode = '23503';
  end if;

  select o.id into v_clash
    from platform.tenant_entitlement_overrides o
   where o.tenant_id = p_tenant_id and o.capability_id = v_cap
     and tstzrange(o.starts_at, greatest(o.starts_at, coalesce(o.revoked_at, o.expires_at)))
         && tstzrange(coalesce(p_starts_at, now()), p_expires_at)
   limit 1;
  if v_clash is not null then
    raise exception 'OVERRIDE_SOLAPADO: ya hay un override vigente de % para el tenant; revócalo antes', p_capability_code
      using errcode = '23514';
  end if;

  insert into platform.tenant_entitlement_overrides (
    tenant_id, capability_id, override_type, grant_value, reason, approved_by, starts_at, expires_at
  ) values (
    p_tenant_id, v_cap, p_override_type, coalesce(p_grant_value, '{}'::jsonb), trim(p_reason), auth.uid(),
    coalesce(p_starts_at, now()), p_expires_at
  )
  returning id into v_id;

  perform platform.mark_entitlements_dirty(p_tenant_id, v_tenant.saas_product_id, 'ENTITLEMENT_OVERRIDE_CREATED');
  perform platform.log_audit(
    'ENTITLEMENT_OVERRIDE_CREATED', 'tenant_entitlement_override', v_id::text,
    v_tenant.customer_organization_id, p_tenant_id,
    jsonb_build_object('capability', p_capability_code, 'type', p_override_type, 'grant_value', p_grant_value,
                       'starts_at', coalesce(p_starts_at, now()), 'expires_at', p_expires_at, 'reason', trim(p_reason)));
  return v_id;
end;
$$;

revoke all on function platform.create_entitlement_override(uuid, text, text, jsonb, timestamptz, text, timestamptz) from public, anon;
grant execute on function platform.create_entitlement_override(uuid, text, text, jsonb, timestamptz, text, timestamptz) to authenticated, service_role;

create or replace function platform.revoke_entitlement_override(
  p_override_id uuid,
  p_reason      text
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_ovr    platform.tenant_entitlement_overrides;
  v_tenant record;
begin
  if not platform.can_read_finance() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin revocan overrides' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: revocar un override lleva motivo' using errcode = '23502';
  end if;

  select * into v_ovr from platform.tenant_entitlement_overrides where id = p_override_id for update;
  if v_ovr.id is null then
    raise exception 'OVERRIDE_NO_ENCONTRADO: %', p_override_id using errcode = '23503';
  end if;
  if v_ovr.revoked_at is not null then
    raise exception 'OVERRIDE_YA_REVOCADO: %', p_override_id using errcode = '23514';
  end if;

  update platform.tenant_entitlement_overrides
     set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = trim(p_reason)
   where id = p_override_id;

  select customer_organization_id, saas_product_id into v_tenant from platform.tenants where id = v_ovr.tenant_id;
  perform platform.mark_entitlements_dirty(v_ovr.tenant_id, v_tenant.saas_product_id, 'ENTITLEMENT_OVERRIDE_REVOKED');
  perform platform.log_audit(
    'ENTITLEMENT_OVERRIDE_REVOKED', 'tenant_entitlement_override', p_override_id::text,
    v_tenant.customer_organization_id, v_ovr.tenant_id,
    jsonb_build_object('reason', trim(p_reason)));
end;
$$;

revoke all on function platform.revoke_entitlement_override(uuid, text) from public, anon;
grant execute on function platform.revoke_entitlement_override(uuid, text) to authenticated, service_role;
