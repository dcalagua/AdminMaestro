-- ============================================================================
-- EBIM Commercial Control Plane · Fase 07 · entitlement efectivo (MA-17)
-- ----------------------------------------------------------------------------
-- Spec §6.1 "Cálculo del entitlement efectivo" y §10. Plan §4 fila 10.
-- Test: supabase/tests/33_ccp_compute_entitlements.test.sql.
--
--   compute_entitlements(tenant, producto, t) =
--       baseline del producto        (solo si la app está activa para el tenant)
--     ∪ grants del plan              (suscripción ACTIVE/PAST_DUE que cubre al
--                                     tenant: por tenant_id, o de su organización
--                                     si la suscripción no tiene tenant)
--     ∪ grants de cada add-on        (ACTIVE/CANCEL_SCHEDULED con t dentro de
--                                     [effective_from, effective_to))
--     ⊕ overrides vigentes           (GRANT suma una fuente; DENY retira)
--   LIMIT/ALLOWANCE se combinan con combine_rule (MAX/SUM); en LIMIT, HARD
--   gana a SOFT. Capacidades DRAFT no cuentan; DEPRECATED siguen honrando los
--   grants existentes.
--
--   PAST_DUE sigue concediendo: revocar por impago es una política de negocio
--   no decidida (D-07); el mecanismo es suspend_tenant_addon, manual.
--
--   STABLE + SECURITY INVOKER: quien llama solo "ve" lo que su RLS le deja ver,
--   así que un tenant no puede calcular (ni inferir) los entitlements de otro.
--   Las RPCs DEFINER (refresh de tenant_features, snapshot de la fase 08) la
--   llaman con los permisos del propietario.
-- ============================================================================

create or replace function platform.is_tenant_app_active(p_tenant_id uuid, p_product_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = platform, pg_catalog
as $$
  select coalesce((
    select t.status = 'ACTIVE'
       and (exists (select 1 from platform.workspace_apps w
                     where w.organization_id = t.customer_organization_id
                       and w.saas_product_id = t.saas_product_id
                       and w.status = 'active')
            or exists (select 1 from platform.tenant_product_mappings m
                        where m.tenant_id = t.id and m.saas_product_id = t.saas_product_id
                          and m.status = 'ACTIVE'))
      from platform.tenants t
     where t.id = p_tenant_id and t.saas_product_id = p_product_id
  ), false);
$$;

comment on function platform.is_tenant_app_active(uuid, uuid) is
  'appActive del snapshot (spec §7.1): tenant ACTIVE del producto y la app activa en el '
  'workspace de su organización o un mapping de provisioning ACTIVE.';

revoke all on function platform.is_tenant_app_active(uuid, uuid) from public, anon;
grant execute on function platform.is_tenant_app_active(uuid, uuid) to authenticated, service_role;

create or replace function platform.compute_entitlements(
  p_tenant_id  uuid,
  p_product_id uuid,
  p_at         timestamptz default now()
)
returns table (
  capability_id   uuid,
  capability_code text,
  kind            text,
  scope_level     text,
  enabled         boolean,
  value           numeric,
  enforcement     text,
  included        numeric,
  period          text,
  unit            text,
  meter_code      text,
  sources         text[],
  company_ids     uuid[]
)
language sql
stable
security invoker
set search_path = platform, pg_catalog
as $$
  with tenant as (
    select t.id, t.customer_organization_id
      from platform.tenants t
     where t.id = p_tenant_id and t.saas_product_id = p_product_id
  ),
  caps as (
    select c.* from platform.product_capabilities c
     where c.saas_product_id = p_product_id and c.status in ('ACTIVE', 'DEPRECATED')
  ),
  baseline as (
    select c.id as capability_id, 'BASELINE'::text as source, '{"enabled": true}'::jsonb as grant_value,
           null::uuid as company_id
      from caps c, tenant t
     where c.is_baseline and platform.is_tenant_app_active(t.id, p_product_id)
  ),
  plan_grants as (
    select g.capability_id, 'PLAN'::text as source, g.grant_value, null::uuid as company_id
      from tenant t
      join platform.subscriptions s
        on s.saas_product_id = p_product_id
       and s.status in ('ACTIVE', 'PAST_DUE')
       and (s.tenant_id = t.id or (s.tenant_id is null and s.billed_organization_id = t.customer_organization_id))
       and s.started_on <= p_at::date
       and (s.ends_on is null or s.ends_on >= p_at::date)
      join platform.entitlement_grants g
        on g.plan_id = s.plan_id
       and g.valid_from <= p_at::date
       and (g.valid_to is null or g.valid_to >= p_at::date)
  ),
  addon_grants as (
    select g.capability_id, 'ADDON'::text as source, g.grant_value, a.company_id
      from tenant t
      join platform.tenant_addons a
        on a.tenant_id = t.id
       and a.status in ('ACTIVE', 'CANCEL_SCHEDULED')
       and a.effective_from <= p_at
       and (a.effective_to is null or p_at < a.effective_to)
      join platform.catalog_items ci on ci.code = a.addon_code
      join platform.entitlement_grants g
        on g.catalog_item_id = ci.id
       and g.valid_from <= p_at::date
       and (g.valid_to is null or g.valid_to >= p_at::date)
  ),
  live_overrides as (
    select o.* from tenant t
      join platform.tenant_entitlement_overrides o
        on o.tenant_id = t.id
       and o.starts_at <= p_at
       and p_at < least(o.expires_at, coalesce(o.revoked_at, o.expires_at))
  ),
  override_grants as (
    select o.capability_id, 'OVERRIDE'::text as source, o.grant_value, null::uuid as company_id
      from live_overrides o where o.override_type = 'GRANT'
  ),
  sourced as (
    select * from baseline
    union all select * from plan_grants
    union all select * from addon_grants
    union all select * from override_grants
  )
  select c.id,
         c.code,
         c.kind,
         c.scope_level,
         true,
         case when c.kind = 'LIMIT' then
           case c.combine_rule when 'SUM' then sum((x.grant_value ->> 'value')::numeric)
                               else max((x.grant_value ->> 'value')::numeric) end end,
         case when c.kind = 'LIMIT' then
           case when bool_or(x.grant_value ->> 'enforcement' = 'HARD') then 'HARD' else 'SOFT' end end,
         case when c.kind = 'ALLOWANCE' then
           case c.combine_rule when 'SUM' then sum((x.grant_value ->> 'included')::numeric)
                               else max((x.grant_value ->> 'included')::numeric) end end,
         case when c.kind = 'ALLOWANCE' then 'MONTH' end,
         c.unit,
         c.meter_code,
         array_agg(distinct x.source order by x.source),
         -- COMPANY: null = todas las compañías (alguna fuente es a nivel tenant).
         case when c.scope_level = 'COMPANY' and not bool_or(x.company_id is null)
              then array_agg(distinct x.company_id order by x.company_id) end
    from sourced x
    join caps c on c.id = x.capability_id
   where not exists (select 1 from live_overrides d
                      where d.capability_id = c.id and d.override_type = 'DENY')
   group by c.id, c.code, c.kind, c.scope_level, c.combine_rule, c.unit, c.meter_code;
$$;

comment on function platform.compute_entitlements(uuid, uuid, timestamptz) is
  'Entitlement efectivo de un tenant en un producto en el instante t (spec §6.1): baseline ∪ '
  'plan ∪ add-ons ⊕ overrides, con combine_rule. STABLE, SECURITY INVOKER (RLS del llamante). '
  'Una fila por capacidad concedida; lo no listado está denegado.';

revoke all on function platform.compute_entitlements(uuid, uuid, timestamptz) from public, anon;
grant execute on function platform.compute_entitlements(uuid, uuid, timestamptz) to authenticated, service_role;
