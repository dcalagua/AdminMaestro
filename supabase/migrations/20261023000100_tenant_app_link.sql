-- ============================================================================
-- Vínculo en la app de los clientes registrados a mano (tenant-inventory.v1 §8)
-- ----------------------------------------------------------------------------
-- Brecha (auditoría 2026-11-16): los clientes que ya existían en una app y se
-- registraron en el Admin Maestro con `register_manual_provisioning` (CMH,
-- ARAUCO, RIMAC, LABOFTA, Biel, ALO…) NO tienen registro de alta en la app.
-- Para la app son desconocidos: el GET de estado, entitlements.v1 y
-- lifecycle.v1 no los resuelven (404). Ni sus add-ons ni su suspensión pueden
-- llegar, y la sincronización los vería como «vínculo roto» aunque existan.
--
-- Esta migración:
--   1. Scope propio del vínculo por integración (`tenant_link_scope`,
--      <productCode>:tenants:link). La ruta es la del inventario +
--      `/{controlPlaneTenantId}/link` (PUT). Exige inventario configurado.
--   2. Estado del vínculo en la app por mapping (`app_link_status`, …). Un alta
--      hecha por el Admin Maestro ya deja el registro en la app: no lo necesita.
--   3. `tenant_sync_plan()` entrega el scope y, por vínculo, si es manual y su
--      estado en la app. La Edge Function `tenant-sync` pide el vínculo ANTES de
--      verificar (así un manual pendiente no se da por roto).
--   4. `record_tenant_app_link()`: canal servidor, guarda el resultado y lo audita.
--
-- Idempotente. Test: supabase/tests/60_tenant_app_link.test.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Scope del vínculo
-- ---------------------------------------------------------------------------
alter table platform.product_integrations
  add column if not exists tenant_link_scope text;

alter table platform.product_integrations
  drop constraint if exists product_integrations_tenant_link_scope_ck;

alter table platform.product_integrations
  -- Escribe SOLO el registro de vínculo en la app: nunca puede ser el scope de
  -- alta, ni uno de lectura, ni el de entitlements o lifecycle.
  add constraint product_integrations_tenant_link_scope_ck check (
    tenant_link_scope is null
    or (inventory_path is not null
        and tenant_link_scope ~ '^[a-z0-9][a-z0-9:._-]{2,99}$'
        and tenant_link_scope is distinct from create_scope
        and tenant_link_scope is distinct from read_scope
        and tenant_link_scope is distinct from inventory_read_scope
        and tenant_link_scope is distinct from entitlements_write_scope
        and tenant_link_scope is distinct from entitlements_read_scope
        and tenant_link_scope is distinct from lifecycle_write_scope
        and tenant_link_scope is distinct from lifecycle_read_scope
        and not (tenant_link_scope = any (additional_scopes))));

comment on column platform.product_integrations.tenant_link_scope is
  'Scope del PUT {inventory_path}/{controlPlaneTenantId}/link (tenant-inventory.v1 §8, <productCode>:tenants:link). '
  'NULL = la app no acepta vínculos. Exige inventario configurado.';

create or replace function platform.configure_tenant_link_integration(
  p_integration_id uuid,
  p_link_scope     text
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_int record;
begin
  select * into v_int from platform.product_integrations where id = p_integration_id for update;
  if v_int.id is null then
    raise exception 'INTEGRACION_NO_ENCONTRADA' using errcode = 'P0002';
  end if;
  if not platform.has_product_permission('platform.integration.manage', v_int.saas_product_id) then
    raise exception 'NO_AUTORIZADO: configurar el vínculo exige platform.integration.manage sobre el producto'
      using errcode = '42501';
  end if;
  if v_int.integration_type <> 'HTTP_M2M' then
    raise exception 'TIPO_NO_SOPORTADO: el vínculo solo viaja por HTTP_M2M' using errcode = '23514';
  end if;
  if nullif(btrim(p_link_scope), '') is not null and v_int.inventory_path is null then
    raise exception 'INVENTARIO_REQUERIDO: configura primero el inventario (configure_inventory_integration)'
      using errcode = '23514';
  end if;

  update platform.product_integrations
     set tenant_link_scope = nullif(btrim(p_link_scope), '')
   where id = p_integration_id;

  insert into platform.audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'TENANT_LINK_INTEGRATION_CONFIGURED', 'product_integration', p_integration_id::text,
          jsonb_build_object('link_scope', p_link_scope));
  return p_integration_id;
end;
$$;

comment on function platform.configure_tenant_link_integration(uuid, text) is
  'Scope del vínculo de clientes existentes (tenant-inventory.v1 §8). NULL lo apaga. platform.integration.manage.';

revoke all on function platform.configure_tenant_link_integration(uuid, text) from public, anon;
grant execute on function platform.configure_tenant_link_integration(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Estado del vínculo por mapping
-- ---------------------------------------------------------------------------
alter table platform.tenant_product_mappings
  add column if not exists app_link_status     text,
  add column if not exists app_linked_at       timestamptz,
  add column if not exists app_link_checked_at timestamptz,
  add column if not exists app_link_error      text;

alter table platform.tenant_product_mappings
  drop constraint if exists tenant_product_mappings_app_link_status_ck,
  drop constraint if exists tenant_product_mappings_app_link_error_ck;

alter table platform.tenant_product_mappings
  add constraint tenant_product_mappings_app_link_status_ck check (
    app_link_status is null or app_link_status in ('LINKED', 'FAILED')),
  add constraint tenant_product_mappings_app_link_error_ck check (
    app_link_error is null or app_link_error ~ '^[A-Z][A-Z0-9_]{1,63}$');

comment on column platform.tenant_product_mappings.app_link_status is
  'Solo altas manuales: LINKED = la app ya tiene el registro que une este tenant con su cliente; '
  'FAILED = el último intento falló (app_link_error); NULL = sin intentar.';

-- ---------------------------------------------------------------------------
-- 3. Plan de la sincronización con el vínculo
-- ---------------------------------------------------------------------------
create or replace function platform.tenant_sync_plan()
returns jsonb
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
begin
  if not platform.is_system_job() then
    raise exception 'SOLO_SERVIDOR: tenant_sync_plan() resuelve configuración sensible' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'product', jsonb_build_object('id', p.id, 'code', p.code, 'short_name', p.short_name),
      'deployment', jsonb_build_object(
        'id', d.id, 'code', d.code, 'environment', d.provisioning_environment::text,
        'base_url', d.base_url, 'timeout_ms', d.timeout_ms, 'retry_count', d.retry_count,
        'enabled', d.provisioning_enabled),
      'integration', jsonb_build_object(
        'id', i.id, 'code', i.code, 'type', i.integration_type::text, 'enabled', i.enabled,
        'adapter_key', i.adapter_key::text,
        'capabilities', to_jsonb(platform.integration_capabilities(i.adapter_key, i.status_path_template, i.read_scope)),
        'issuer', i.issuer, 'audience', i.audience, 'subject', i.subject,
        'algorithm', i.algorithm::text, 'token_ttl_seconds', i.token_ttl_seconds,
        'lifecycle_path', i.lifecycle_path, 'lifecycle_read_scope', i.lifecycle_read_scope,
        'inventory_path', i.inventory_path, 'inventory_read_scope', i.inventory_read_scope,
        'tenant_link_scope', i.tenant_link_scope,
        'allowed_hosts', to_jsonb(i.allowed_hosts)),
      'credential', case when c.id is null then null else jsonb_build_object(
        'id', c.id, 'type', c.type::text, 'enabled', c.enabled, 'algorithm', c.algorithm::text,
        'token_ttl_seconds', c.token_ttl_seconds,
        -- NOMBRE del secreto. El valor lo resuelve la Edge Function.
        'secret_ref', c.secret_ref) end,
      'links', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'mapping_id', m.id, 'tenant_id', m.tenant_id, 'request_id', m.saas_provisioning_request_id,
                 'external_tenant_id', m.external_tenant_id,
                 'external_organization_id', m.external_organization_id,
                 'external_company_id', m.external_company_id,
                 'expected_state', platform.tenant_sync_expected_state(t.status),
                 'registered_manually', m.registered_manually,
                 'app_link_status', m.app_link_status)
               order by m.provisioned_at)
          from platform.tenant_product_mappings m
          join platform.tenants t on t.id = m.tenant_id
         where m.deployment_target_id = d.id and m.status = 'ACTIVE'), '[]'::jsonb)
    ) order by p.sort_order, d.code)
      from platform.deployment_targets d
      join platform.saas_products p on p.id = d.saas_product_id
      join platform.product_integrations i on i.id = d.product_integration_id
      left join platform.credential_profiles c on c.id = d.credential_profile_id
     where d.status = 'ACTIVE'
       and (d.provisioning_enabled
            or exists (select 1 from platform.tenant_product_mappings m
                        where m.deployment_target_id = d.id and m.status = 'ACTIVE'))
  ), '[]'::jsonb);
end;
$$;

comment on function platform.tenant_sync_plan() is
  'Destinos y vínculos activos que revisa la sincronización, con la configuración M2M (nombre del secreto, no su valor) '
  'y, por vínculo, si es un alta manual y su estado de vínculo en la app. Solo el canal servidor.';

revoke all on function platform.tenant_sync_plan() from public, anon, authenticated;
grant execute on function platform.tenant_sync_plan() to service_role;

-- ---------------------------------------------------------------------------
-- 4. Resultado del vínculo (canal servidor)
-- ---------------------------------------------------------------------------
create or replace function platform.record_tenant_app_link(
  p_mapping_id  uuid,
  p_outcome     text,
  p_http_status integer default null,
  p_error_code  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_map   record;
  v_error text := nullif(btrim(coalesce(p_error_code, '')), '');
begin
  if not platform.is_system_job() then
    raise exception 'SOLO_SERVIDOR: record_tenant_app_link() es del canal servidor' using errcode = '42501';
  end if;
  if p_outcome not in ('LINKED', 'FAILED') then
    raise exception 'RESULTADO_INVALIDO: LINKED o FAILED' using errcode = '22023';
  end if;
  if v_error is not null and v_error !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    v_error := 'ERROR';
  end if;

  select m.*, i.tenant_link_scope
    into v_map
    from platform.tenant_product_mappings m
    left join platform.deployment_targets d on d.id = m.deployment_target_id
    left join platform.product_integrations i on i.id = d.product_integration_id
   where m.id = p_mapping_id
   for update of m;
  if v_map.id is null then
    raise exception 'VINCULO_NO_ENCONTRADO' using errcode = 'P0002';
  end if;
  if not v_map.registered_manually then
    raise exception 'NO_ES_ALTA_MANUAL: el alta del Admin Maestro ya deja el registro en la app' using errcode = '23514';
  end if;

  update platform.tenant_product_mappings
     set app_link_status     = p_outcome,
         app_link_checked_at = now(),
         app_linked_at       = case when p_outcome = 'LINKED' then coalesce(app_linked_at, now()) else app_linked_at end,
         app_link_error      = case when p_outcome = 'LINKED' then null else coalesce(v_error, 'ERROR') end,
         updated_at          = now()
   where id = p_mapping_id;

  -- Solo los cambios dejan rastro: un vínculo ya hecho que la app confirma
  -- (ALREADY_LINKED) en cada corrida no llena la auditoría.
  if v_map.app_link_status is distinct from p_outcome
     or (p_outcome = 'FAILED' and v_map.app_link_error is distinct from coalesce(v_error, 'ERROR')) then
    insert into platform.audit_logs (actor_user_id, action, entity_type, entity_id, tenant_id, metadata)
    values (null,
            case when p_outcome = 'LINKED' then 'TENANT_APP_LINKED' else 'TENANT_APP_LINK_FAILED' end,
            'tenant_product_mapping', p_mapping_id::text, v_map.tenant_id,
            jsonb_build_object('external_tenant_id', v_map.external_tenant_id,
                               'http_status', p_http_status, 'error_code', v_error));
  end if;

  return jsonb_build_object('mapping_id', p_mapping_id, 'app_link_status', p_outcome,
                            'app_link_error', case when p_outcome = 'LINKED' then null else coalesce(v_error, 'ERROR') end);
end;
$$;

comment on function platform.record_tenant_app_link(uuid, text, integer, text) is
  'Guarda el resultado del PUT …/link de un alta manual (tenant-inventory.v1 §8). Solo el canal servidor.';

revoke all on function platform.record_tenant_app_link(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function platform.record_tenant_app_link(uuid, text, integer, text) to service_role;
