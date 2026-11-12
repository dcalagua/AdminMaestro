-- ============================================================================
-- EBIM Commercial Control Plane · Fase 07 · ciclo de vida auditado de add-ons
-- de tenant (Task MA-16)
-- ----------------------------------------------------------------------------
-- Spec §3.2 (tenant_addons), §5.3-5.5 (precio congelado, falla cerrado), §6.2
-- (diagrama), §10 (downgrade/baja), §14.1 (autoridad). Plan §4 fila 8.
-- Test: supabase/tests/32_ccp_tenant_addon_lifecycle.test.sql (parte MA-16).
--
--   REQUESTED ──approve──► ACTIVE ──schedule_cancel──► CANCEL_SCHEDULED ──(job)──► CANCELLED
--       └──reject──► REJECTED   ▲  └─────────── reactivate ◄─────┘
--                               └──suspend──► SUSPENDED ──resume──► ACTIVE
--                                                 └──cancel──► CANCELLED
--   + cancel inmediato desde ACTIVE/CANCEL_SCHEDULED (spec §10: solo finanzas).
--
--   · Terminales: CANCELLED, REJECTED. Volver a contratar = fila NUEVA (la
--     historia no se sobrescribe). Por eso la PK pasa de (tenant_id,
--     addon_code) a `id`, con unique parcial sobre las filas no terminales.
--   · `active` se conserva (lectores existentes) y pasa a ser derivado:
--     ACTIVE o CANCEL_SCHEDULED. Una fila nueva nace REQUESTED (inactiva).
--   · request: plataforma comercial, quien administra el tenant, el comercial
--     con atribución o el SaaS (service_role). NUNCA activa.
--   · approve/reject/schedule_cancel/reactivate: can_manage_commercial().
--     approve crea el subscription_item ADDON en la MISMA transacción, con el
--     precio vigente congelado y price_ref. Sin precio → TARIFA_ADDON_NO_DEFINIDA
--     (salvo tenant DEMO, que no factura). PER_UNIT → se factura desde uso
--     (fase 18): hasta entonces no se aprueba en un tenant facturable.
--   · suspend/resume/cancel inmediato: finanzas (can_read_finance). Cuándo se
--     suspende por impago es D-07: nada lo dispara automáticamente.
--   · Cada transición: audit_logs + mark_entitlements_dirty.
--   · Retira la RPC temporal set_tenant_addon_active de la fase 03.
--
-- Backfill: filas active=true → ACTIVE (effective_from = activated_at);
-- active=false → CANCELLED (effective_to = updated_at). request_source =
-- LEGACY_BACKFILL. Sin subscription_item: los ítems ADDON existentes son
-- MANUAL y no se re-enlazan en silencio.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columnas y claves
-- ---------------------------------------------------------------------------
alter table platform.tenant_addons
  add column id                   uuid not null default gen_random_uuid(),
  add column status               text,
  add column company_id           uuid references platform.companies (id) on delete restrict,
  add column effective_from       timestamptz,
  add column effective_to         timestamptz,
  add column subscription_item_id uuid references platform.subscription_items (id) on delete set null,
  add column request_source       text,
  add column requested_by         uuid references platform.profiles (id) on delete set null,
  add column requested_at         timestamptz,
  add column approved_by          uuid references platform.profiles (id) on delete set null,
  add column approved_at          timestamptz,
  add column status_reason        text;

update platform.tenant_addons
   set status         = case when active then 'ACTIVE' else 'CANCELLED' end,
       effective_from = activated_at,
       effective_to   = case when active then null else updated_at end,
       request_source = 'LEGACY_BACKFILL',
       requested_at   = created_at;

alter table platform.tenant_addons
  alter column status set default 'REQUESTED',
  alter column status set not null,
  alter column request_source set default 'CONSOLE',
  alter column request_source set not null,
  alter column requested_at set default now(),
  alter column requested_at set not null,
  add constraint tenant_addons_status_ck
    check (status in ('REQUESTED', 'ACTIVE', 'CANCEL_SCHEDULED', 'CANCELLED', 'SUSPENDED', 'REJECTED')),
  add constraint tenant_addons_source_ck
    check (request_source in ('CONSOLE', 'TENANT', 'PARTNER', 'SAAS_M2M', 'LEAD', 'LEGACY_BACKFILL')),
  add constraint tenant_addons_effective_ck
    check (effective_to is null or effective_from is null or effective_to >= effective_from),
  add constraint tenant_addons_active_has_start_ck
    check (status not in ('ACTIVE', 'CANCEL_SCHEDULED', 'SUSPENDED') or effective_from is not null),
  add constraint tenant_addons_scheduled_has_end_ck
    check (status <> 'CANCEL_SCHEDULED' or effective_to is not null);

alter table platform.tenant_addons drop constraint tenant_addons_pkey;
alter table platform.tenant_addons add constraint tenant_addons_pkey primary key (id);

create unique index tenant_addons_open_uk
  on platform.tenant_addons (tenant_id, addon_code, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status in ('REQUESTED', 'ACTIVE', 'CANCEL_SCHEDULED', 'SUSPENDED');
create index tenant_addons_tenant_ix on platform.tenant_addons (tenant_id);
create index tenant_addons_company_ix on platform.tenant_addons (company_id) where company_id is not null;
create index tenant_addons_item_ix on platform.tenant_addons (subscription_item_id) where subscription_item_id is not null;
create index tenant_addons_requested_by_ix on platform.tenant_addons (requested_by);
create index tenant_addons_approved_by_ix on platform.tenant_addons (approved_by);
create index tenant_addons_scheduled_ix on platform.tenant_addons (effective_to) where status = 'CANCEL_SCHEDULED';

alter table platform.subscription_items
  add constraint subscription_items_tenant_addon_fk
    foreign key (tenant_addon_id) references platform.tenant_addons (id) on delete set null;
create index subscription_items_tenant_addon_ix on platform.subscription_items (tenant_addon_id)
  where tenant_addon_id is not null;

comment on table platform.tenant_addons is
  'Add-ons de un tenant con ciclo de vida auditado (spec §6.2). Solo se escribe por RPC. '
  'Una fila terminal (CANCELLED/REJECTED) es historia; volver a contratar crea otra fila. '
  'El PRECIO no vive aquí: se congela en el subscription_item que crea approve.';
comment on column platform.tenant_addons.active is
  'DERIVADO: status in (ACTIVE, CANCEL_SCHEDULED). Se conserva para lectores existentes.';

-- ---------------------------------------------------------------------------
-- 2. Guardas: estado derivado, identidad inmutable, transiciones del diagrama.
-- ---------------------------------------------------------------------------
create or replace function platform.enforce_tenant_addon_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
       or new.addon_code is distinct from old.addon_code or new.company_id is distinct from old.company_id then
      raise exception 'ADDON_IDENTIDAD_INMUTABLE: tenant, add-on y compañía no cambian (fila %)', old.id
        using errcode = '23514';
    end if;
    if new.status is distinct from old.status and not (
         (old.status = 'REQUESTED'        and new.status in ('ACTIVE', 'REJECTED'))
      or (old.status = 'ACTIVE'           and new.status in ('CANCEL_SCHEDULED', 'SUSPENDED', 'CANCELLED'))
      or (old.status = 'CANCEL_SCHEDULED' and new.status in ('ACTIVE', 'CANCELLED'))
      or (old.status = 'SUSPENDED'        and new.status in ('ACTIVE', 'CANCELLED'))
    ) then
      raise exception 'TRANSICION_INVALIDA: un add-on % no pasa a %', old.status, new.status
        using errcode = '23514';
    end if;
  end if;
  new.active := new.status in ('ACTIVE', 'CANCEL_SCHEDULED');
  return new;
end;
$$;

revoke all on function platform.enforce_tenant_addon_lifecycle() from public, anon, authenticated;

create trigger tenant_addons_lifecycle_guard
  before insert or update on platform.tenant_addons
  for each row execute function platform.enforce_tenant_addon_lifecycle();

-- ---------------------------------------------------------------------------
-- 3. mark_entitlements_dirty_for_source: add-ons por `status` (antes `active`).
-- ---------------------------------------------------------------------------
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
       where ci.id = p_catalog_item_id
         and a.status in ('ACTIVE', 'CANCEL_SCHEDULED', 'SUSPENDED')
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
-- 4. Transición común (interna): bloquea, valida origen, actualiza, audita,
--    marca dirty. Devuelve la fila ya actualizada.
-- ---------------------------------------------------------------------------
create or replace function platform.transition_tenant_addon(
  p_tenant_addon_id uuid,
  p_from            text[],
  p_to              text,
  p_action          text,
  p_reason          text,
  p_patch           jsonb default '{}'::jsonb
)
returns platform.tenant_addons
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_row    platform.tenant_addons;
  v_tenant record;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: toda transición de add-on lleva motivo' using errcode = '23502';
  end if;

  select * into v_row from platform.tenant_addons where id = p_tenant_addon_id for update;
  if v_row.id is null then
    raise exception 'ADDON_DE_TENANT_NO_ENCONTRADO: %', p_tenant_addon_id using errcode = '23503';
  end if;
  if not (v_row.status = any(p_from)) then
    raise exception 'TRANSICION_INVALIDA: % requiere estado %, el add-on está %', p_action, p_from, v_row.status
      using errcode = '23514';
  end if;

  update platform.tenant_addons
     set status               = p_to,
         status_reason        = trim(p_reason),
         effective_from       = case when p_patch ? 'effective_from' then (p_patch ->> 'effective_from')::timestamptz else effective_from end,
         effective_to         = case when p_patch ? 'effective_to' then (p_patch ->> 'effective_to')::timestamptz else effective_to end,
         activated_at         = case when p_to = 'ACTIVE' and v_row.status = 'REQUESTED' then now() else activated_at end,
         approved_by          = case when p_to = 'ACTIVE' and v_row.status = 'REQUESTED' then auth.uid() else approved_by end,
         approved_at          = case when p_to = 'ACTIVE' and v_row.status = 'REQUESTED' then now() else approved_at end,
         subscription_item_id = case when p_patch ? 'subscription_item_id' then (p_patch ->> 'subscription_item_id')::uuid else subscription_item_id end
   where id = p_tenant_addon_id
  returning * into v_row;

  select customer_organization_id, saas_product_id into v_tenant from platform.tenants where id = v_row.tenant_id;
  perform platform.mark_entitlements_dirty(v_row.tenant_id, v_tenant.saas_product_id, p_action);
  perform platform.log_audit(
    p_action, 'tenant_addon', v_row.id::text, v_tenant.customer_organization_id, v_row.tenant_id,
    jsonb_build_object('addon_code', v_row.addon_code, 'company_id', v_row.company_id,
                       'from', p_from, 'to', p_to, 'reason', trim(p_reason),
                       'effective_from', v_row.effective_from, 'effective_to', v_row.effective_to)
      || (p_patch - 'effective_from' - 'effective_to'));
  return v_row;
end;
$$;

revoke all on function platform.transition_tenant_addon(uuid, text[], text, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. request_tenant_addon — solicitar NUNCA activa.
-- ---------------------------------------------------------------------------
create or replace function platform.request_tenant_addon(
  p_tenant_id  uuid,
  p_addon_code text,
  p_company_id uuid default null,
  p_reason     text default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_tenant record;
  v_item   record;
  v_source text;
  v_id     uuid;
begin
  if platform.is_service_request() then
    v_source := 'SAAS_M2M';
  elsif platform.can_manage_commercial() then
    v_source := 'CONSOLE';
  elsif platform.can_manage_tenant(p_tenant_id) then
    v_source := 'TENANT';
  elsif p_tenant_id in (select platform.my_attributed_tenant_ids()) then
    v_source := 'PARTNER';
  else
    raise exception 'NO_AUTORIZADO: no puedes solicitar add-ons para este tenant' using errcode = '42501';
  end if;

  select id, customer_organization_id, saas_product_id into v_tenant from platform.tenants where id = p_tenant_id;
  if v_tenant.id is null then
    raise exception 'TENANT_NO_ENCONTRADO: %', p_tenant_id using errcode = '23503';
  end if;
  select * into v_item from platform.catalog_items where code = p_addon_code;
  if v_item.id is null then
    raise exception 'ADDON_NO_ENCONTRADO: %', p_addon_code using errcode = '23503';
  end if;
  if v_item.lifecycle_status <> 'AVAILABLE' then
    raise exception 'ADDON_NO_DISPONIBLE: % está % en el catálogo', p_addon_code, v_item.lifecycle_status
      using errcode = '23514';
  end if;
  if v_item.saas_product_id is not null and v_item.saas_product_id <> v_tenant.saas_product_id then
    raise exception 'ADDON_DE_OTRO_PRODUCTO: % no se vende para el producto de este tenant', p_addon_code
      using errcode = '23514';
  end if;
  if p_company_id is not null and not exists (
       select 1 from platform.companies c
        where c.id = p_company_id and c.organization_id = v_tenant.customer_organization_id) then
    raise exception 'COMPANIA_AJENA: la compañía no pertenece al cliente del tenant' using errcode = '23514';
  end if;
  if exists (select 1 from platform.tenant_addons a
              where a.tenant_id = p_tenant_id and a.addon_code = p_addon_code
                and a.company_id is not distinct from p_company_id
                and a.status in ('REQUESTED', 'ACTIVE', 'CANCEL_SCHEDULED', 'SUSPENDED')) then
    raise exception 'ADDON_YA_SOLICITADO: % ya está solicitado o vigente para este tenant', p_addon_code
      using errcode = '23505';
  end if;

  insert into platform.tenant_addons (
    tenant_id, addon_code, company_id, status, request_source, requested_by, requested_at, status_reason
  ) values (
    p_tenant_id, p_addon_code, p_company_id, 'REQUESTED', v_source, auth.uid(), now(), nullif(trim(coalesce(p_reason, '')), '')
  )
  returning id into v_id;

  perform platform.mark_entitlements_dirty(p_tenant_id, v_tenant.saas_product_id, 'TENANT_ADDON_REQUESTED');
  perform platform.log_audit(
    'TENANT_ADDON_REQUESTED', 'tenant_addon', v_id::text, v_tenant.customer_organization_id, p_tenant_id,
    jsonb_build_object('addon_code', p_addon_code, 'company_id', p_company_id, 'source', v_source,
                       'reason', nullif(trim(coalesce(p_reason, '')), '')));
  return v_id;
end;
$$;

comment on function platform.request_tenant_addon(uuid, text, uuid, text) is
  'Crea una solicitud REQUESTED (spec §6.2). La pueden hacer la plataforma comercial, quien '
  'administra el tenant, el comercial con atribución o el SaaS (service_role). Nunca activa.';

revoke all on function platform.request_tenant_addon(uuid, text, uuid, text) from public, anon;
grant execute on function platform.request_tenant_addon(uuid, text, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. approve_tenant_addon — activa y crea el ítem ADDON en la misma transacción.
-- ---------------------------------------------------------------------------
create or replace function platform.approve_tenant_addon(
  p_tenant_addon_id uuid,
  p_reason          text
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_row      platform.tenant_addons;
  v_tenant   record;
  v_item     record;
  v_sub      record;
  v_price    numeric;
  v_price_id uuid;
  v_si       uuid;
  v_sub_code text;
  v_currency char(3);
begin
  if not platform.can_manage_commercial() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o EBIM_PRODUCT_ADMIN aprueban add-ons' using errcode = '42501';
  end if;

  select * into v_row from platform.tenant_addons where id = p_tenant_addon_id for update;
  if v_row.id is null then
    raise exception 'ADDON_DE_TENANT_NO_ENCONTRADO: %', p_tenant_addon_id using errcode = '23503';
  end if;
  if v_row.status <> 'REQUESTED' then
    raise exception 'TRANSICION_INVALIDA: approve requiere REQUESTED, el add-on está %', v_row.status using errcode = '23514';
  end if;

  select id, tenant_type, customer_organization_id, saas_product_id into v_tenant
    from platform.tenants where id = v_row.tenant_id;
  select * into v_item from platform.catalog_items where code = v_row.addon_code;
  if v_item.lifecycle_status <> 'AVAILABLE' then
    raise exception 'ADDON_NO_DISPONIBLE: % está % en el catálogo; no se activa', v_item.code, v_item.lifecycle_status
      using errcode = '23514';
  end if;

  if v_tenant.tenant_type <> 'DEMO' then
    if v_item.billing_model = 'PER_UNIT' then
      raise exception 'MODELO_POR_USO_PENDIENTE: % se factura por uso; su activación facturable llega con los agregados de uso (fase 18)', v_item.code
        using errcode = '23514';
    end if;

    -- Contrato vigente del tenant en ese producto; si no hay, el de la organización.
    select s.* into v_sub
      from platform.subscriptions s
     where s.saas_product_id = v_tenant.saas_product_id
       and s.status in ('ACTIVE', 'PAST_DUE')
       and (s.tenant_id = v_tenant.id
            or (s.tenant_id is null and s.billed_organization_id = v_tenant.customer_organization_id))
     order by (s.tenant_id is not null) desc, s.started_on desc
     limit 1;
    if v_sub.id is null then
      raise exception 'SUSCRIPCION_REQUERIDA: un add-on facturable necesita un contrato activo del tenant en ese producto'
        using errcode = '23514';
    end if;

    v_price := platform.current_catalog_item_price(v_item.id, v_sub.market_id, 'ADDON', v_sub.billing_interval, v_sub.currency, current_date);
    v_price_id := platform.current_catalog_item_price_id(v_item.id, v_sub.market_id, 'ADDON', v_sub.billing_interval, v_sub.currency, current_date);
    if v_price is null then
      raise exception 'TARIFA_ADDON_NO_DEFINIDA: % no tiene tarifa ADDON % vigente en el mercado y moneda del contrato %',
        v_item.code, v_sub.billing_interval, v_sub.code
        using errcode = '23514';
    end if;

    insert into platform.subscription_items (
      subscription_id, charge_kind, description, quantity, unit_amount, currency, billing_interval,
      tenant_id, catalog_item_code, valid_from, source_type, tenant_addon_id, price_ref
    ) values (
      v_sub.id, 'ADDON', 'Add-on ' || v_item.name, 1, v_price, v_sub.currency, v_sub.billing_interval,
      v_tenant.id, v_item.code, current_date, 'ADDON', v_row.id, v_price_id
    )
    returning id into v_si;
    v_sub_code := v_sub.code;
    v_currency := v_sub.currency;
  end if;

  v_row := platform.transition_tenant_addon(
    p_tenant_addon_id, array['REQUESTED'], 'ACTIVE', 'TENANT_ADDON_APPROVED', p_reason,
    jsonb_strip_nulls(jsonb_build_object(
      'effective_from', now(), 'subscription_item_id', v_si,
      'subscription', v_sub_code, 'unit_amount', v_price, 'currency', v_currency, 'price_ref', v_price_id,
      'billable', v_tenant.tenant_type <> 'DEMO')));

  return jsonb_build_object('tenant_addon_id', v_row.id, 'status', v_row.status,
                            'subscription_item_id', v_si, 'unit_amount', v_price, 'currency', v_currency);
end;
$$;

comment on function platform.approve_tenant_addon(uuid, text) is
  'REQUESTED → ACTIVE. Crea el subscription_item ADDON con la tarifa vigente congelada '
  '(price_ref) en la misma transacción; TARIFA_ADDON_NO_DEFINIDA si no hay tarifa (salvo DEMO). '
  'Solo can_manage_commercial(). Auditado; marca dirty.';

revoke all on function platform.approve_tenant_addon(uuid, text) from public, anon;
grant execute on function platform.approve_tenant_addon(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. reject / schedule_cancel / reactivate (comercial)
-- ---------------------------------------------------------------------------
create or replace function platform.reject_tenant_addon(p_tenant_addon_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if not platform.can_manage_commercial() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o EBIM_PRODUCT_ADMIN rechazan solicitudes' using errcode = '42501';
  end if;
  perform platform.transition_tenant_addon(p_tenant_addon_id, array['REQUESTED'], 'REJECTED', 'TENANT_ADDON_REJECTED', p_reason);
end;
$$;

revoke all on function platform.reject_tenant_addon(uuid, text) from public, anon;
grant execute on function platform.reject_tenant_addon(uuid, text) to authenticated, service_role;

create or replace function platform.schedule_cancel_tenant_addon(
  p_tenant_addon_id uuid,
  p_reason          text,
  p_effective_to    timestamptz default null
)
returns timestamptz
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_row platform.tenant_addons;
  v_to  timestamptz;
begin
  if not platform.can_manage_commercial() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o EBIM_PRODUCT_ADMIN programan bajas' using errcode = '42501';
  end if;
  -- Por defecto, fin del periodo facturado: el primer instante del mes siguiente
  -- (la facturación es por mes calendario, issue_subscription_invoice).
  v_to := coalesce(p_effective_to, date_trunc('month', now()) + interval '1 month');
  if v_to <= now() then
    raise exception 'VIGENCIA_INVALIDA: una baja programada termina en el futuro (usa cancel para una baja inmediata)'
      using errcode = '23514';
  end if;

  v_row := platform.transition_tenant_addon(p_tenant_addon_id, array['ACTIVE'], 'CANCEL_SCHEDULED',
                                            'TENANT_ADDON_CANCEL_SCHEDULED', p_reason,
                                            jsonb_build_object('effective_to', v_to));
  if v_row.subscription_item_id is not null then
    update platform.subscription_items
       set valid_to = greatest(valid_from, (v_to - interval '1 microsecond')::date)
     where id = v_row.subscription_item_id;
  end if;
  return v_to;
end;
$$;

revoke all on function platform.schedule_cancel_tenant_addon(uuid, text, timestamptz) from public, anon;
grant execute on function platform.schedule_cancel_tenant_addon(uuid, text, timestamptz) to authenticated, service_role;

create or replace function platform.reactivate_tenant_addon(p_tenant_addon_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_row platform.tenant_addons;
begin
  if not platform.can_manage_commercial() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o EBIM_PRODUCT_ADMIN reactivan add-ons' using errcode = '42501';
  end if;
  v_row := platform.transition_tenant_addon(p_tenant_addon_id, array['CANCEL_SCHEDULED'], 'ACTIVE',
                                            'TENANT_ADDON_REACTIVATED', p_reason,
                                            jsonb_build_object('effective_to', null));
  if v_row.subscription_item_id is not null then
    update platform.subscription_items set valid_to = null where id = v_row.subscription_item_id;
  end if;
end;
$$;

revoke all on function platform.reactivate_tenant_addon(uuid, text) from public, anon;
grant execute on function platform.reactivate_tenant_addon(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. suspend / resume / cancel inmediato (finanzas)
-- ---------------------------------------------------------------------------
create or replace function platform.suspend_tenant_addon(p_tenant_addon_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if not platform.can_read_finance() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin suspenden add-ons' using errcode = '42501';
  end if;
  perform platform.transition_tenant_addon(p_tenant_addon_id, array['ACTIVE'], 'SUSPENDED', 'TENANT_ADDON_SUSPENDED', p_reason);
end;
$$;

revoke all on function platform.suspend_tenant_addon(uuid, text) from public, anon;
grant execute on function platform.suspend_tenant_addon(uuid, text) to authenticated, service_role;

create or replace function platform.resume_tenant_addon(p_tenant_addon_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if not platform.can_read_finance() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin reanudan add-ons' using errcode = '42501';
  end if;
  perform platform.transition_tenant_addon(p_tenant_addon_id, array['SUSPENDED'], 'ACTIVE', 'TENANT_ADDON_RESUMED', p_reason);
end;
$$;

revoke all on function platform.resume_tenant_addon(uuid, text) from public, anon;
grant execute on function platform.resume_tenant_addon(uuid, text) to authenticated, service_role;

create or replace function platform.cancel_tenant_addon(p_tenant_addon_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_row platform.tenant_addons;
begin
  if not platform.can_read_finance() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin dan de baja un add-on de inmediato' using errcode = '42501';
  end if;
  v_row := platform.transition_tenant_addon(p_tenant_addon_id, array['ACTIVE', 'CANCEL_SCHEDULED', 'SUSPENDED'],
                                            'CANCELLED', 'TENANT_ADDON_CANCELLED', p_reason,
                                            jsonb_build_object('effective_to', now()));
  if v_row.subscription_item_id is not null then
    update platform.subscription_items
       set valid_to = greatest(valid_from, least(coalesce(valid_to, current_date), current_date))
     where id = v_row.subscription_item_id;
  end if;
end;
$$;

revoke all on function platform.cancel_tenant_addon(uuid, text) from public, anon;
grant execute on function platform.cancel_tenant_addon(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Job: CANCEL_SCHEDULED vencidas → CANCELLED (service_role o comercial).
-- ---------------------------------------------------------------------------
create or replace function platform.complete_scheduled_addon_cancellations(p_as_of timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_count integer := 0;
  r record;
begin
  if not (platform.is_service_request() or platform.can_manage_commercial()) then
    raise exception 'NO_AUTORIZADO: solo el job de servicio o la plataforma comercial cierran bajas programadas'
      using errcode = '42501';
  end if;
  if p_as_of is null or p_as_of > now() then
    raise exception 'VIGENCIA_INVALIDA: no se cierran bajas en el futuro' using errcode = '23514';
  end if;
  for r in
    select id from platform.tenant_addons
     where status = 'CANCEL_SCHEDULED' and effective_to <= p_as_of
     order by effective_to, id
  loop
    perform platform.transition_tenant_addon(r.id, array['CANCEL_SCHEDULED'], 'CANCELLED',
                                             'TENANT_ADDON_CANCEL_COMPLETED', 'Fin del periodo facturado');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function platform.complete_scheduled_addon_cancellations(timestamptz) from public, anon;
grant execute on function platform.complete_scheduled_addon_cancellations(timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Retiro de la RPC temporal de la fase 03 (plan §4 fila 8).
-- ---------------------------------------------------------------------------
drop function if exists platform.set_tenant_addon_active(uuid, text, boolean, text);
