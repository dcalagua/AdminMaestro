-- ============================================================================
-- EBIM Control Plane V4 — 43 · GRANTS y RLS del plano de provisioning
-- ----------------------------------------------------------------------------
-- Mismo modelo que la migración 09 del baseline:
--   anon           : NADA.
--   authenticated  : SELECT filtrado por RLS; CERO escritura directa.
--   service_role   : todo, sólo server-side.
--
-- Dos cosas concretas que este archivo hace y conviene no perder de vista:
--
--   1. `credential_profiles.secret_ref` y `public_key_ref` NO reciben GRANT de
--      SELECT para `authenticated`. Es un privilegio de COLUMNA, no una
--      política: aunque alguien escribiera mañana una política permisiva, la
--      columna seguiría fuera de alcance. La única vía es la RPC
--      `reveal_credential_secret_ref()`, que exige permiso de administración y
--      audita cada lectura.
--
--   2. Ninguna tabla nueva recibe INSERT/UPDATE/DELETE para `authenticated`.
--      Un INSERT directo en `saas_provisioning_requests` desde el navegador se
--      saltaría la resolución de destino, la idempotencia, la política y la
--      auditoría — es decir, todo lo que hace que el subsistema sea correcto.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. RLS ON + FORCE en todas las tablas nuevas
-- ---------------------------------------------------------------------------
-- El bloque de la migración 09 sólo recorrió las tablas que existían entonces.
-- Este vuelve a recorrer el schema entero, así que también deja cubierta
-- cualquier tabla futura que se olvide de activarla.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'platform' and c.relkind = 'r'
       and not (c.relrowsecurity and c.relforcerowsecurity)
  loop
    execute format('alter table platform.%I enable row level security', r.relname);
    execute format('alter table platform.%I force row level security', r.relname);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. EXECUTE de las funciones nuevas
-- ---------------------------------------------------------------------------
-- LISTA EXPLÍCITA, deliberadamente. La migración 09 del baseline usaba un
-- bucle sobre todo el schema, pero repetirlo aquí sería un ERROR grave: V2.1 y
-- V3 REVOCARON a mano el EXECUTE de varias funciones (las RPC de proveedor de
-- pago, `generate_commission_events`, las funciones de trigger) precisamente
-- para que `authenticated` no pudiera invocarlas. Un bucle genérico se las
-- devolvería en silencio y reabriría agujeros que ya se cerraron —los tests
-- 05/16/20 lo detectan, y así fue como se descubrió.
--
-- Las funciones de TRIGGER no aparecen en ninguna lista: nadie las invoca
-- directamente.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    -- Validación (inmutables, sin efectos)
    'platform.is_secret_reference(text)',
    'platform.is_service_request()',
    'platform.is_safe_url_path(text)',
    'platform.url_scheme(text)',
    'platform.url_authority(text)',
    'platform.url_host(text)',
    'platform.is_blocked_provisioning_host(text)',
    'platform.is_valid_provisioning_base_url(text, platform.provisioning_environment)',
    'platform.build_provisioning_idempotency_key(uuid, uuid, integer)',
    -- Autorización y alcance
    'platform.has_platform_permission(text)',
    'platform.has_product_permission(text, uuid)',
    'platform.my_provisioning_product_ids()',
    'platform.my_provisioning_permissions()',
    'platform.my_provisioning_actor_role()',
    'platform.can_execute_saas_provisioning(uuid)',
    'platform.can_check_deployment_health(uuid)',
    -- Resolución y diagnóstico
    'platform.resolve_deployment_target(uuid, uuid, platform.provisioning_environment)',
    'platform.require_deployment_target(uuid, uuid, platform.provisioning_environment)',
    'platform.evaluate_provisioning_policy(platform.provisioning_policy, uuid)',
    'platform.check_provisioning_preconditions(uuid)',
    -- Escritura administrativa (cada una autoriza en su primera línea)
    'platform.upsert_product_integration(uuid, text, text, platform.integration_type, text, uuid, text, text, text, text, platform.m2m_algorithm, integer, text, text, text[], text, text, text, text[], platform.provisioning_policy, boolean, platform.integration_status, jsonb, uuid)',
    'platform.upsert_credential_profile(text, text, platform.credential_profile_type, platform.provisioning_environment, uuid, text, text, platform.m2m_algorithm, text, text, integer, boolean, uuid)',
    'platform.reveal_credential_secret_ref(uuid)',
    'platform.configure_deployment_provisioning(uuid, uuid, uuid, platform.provisioning_environment, text, integer, integer, platform.deployment_target_status, boolean, platform.provisioning_policy)',
    'platform.set_deployment_health(uuid, platform.deployment_health, text)',
    'platform.upsert_product_owner(uuid, uuid, platform.product_owner_role, platform.provisioning_environment[], boolean)',
    'platform.deactivate_product_owner(uuid)',
    'platform.grant_provisioning_role(uuid, platform.provisioning_role, text)',
    'platform.revoke_provisioning_role(uuid)',
    'platform.create_saas_provisioning_request(uuid, platform.provisioning_environment, uuid, integer)',
    'platform.retry_saas_provisioning_request(uuid)',
    'platform.cancel_saas_provisioning_request(uuid, text)',
    'platform.register_manual_provisioning(uuid, text, text, text, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated, service_role', v_sig);
  end loop;
end;
$$;

-- ---- Funciones de TRIGGER: EXECUTE para nadie ------------------------------
-- PostgreSQL concede EXECUTE a PUBLIC en toda función nueva, y `anon` y
-- `authenticated` heredan de PUBLIC. El `alter default privileges` del baseline
-- NO lo evita en la práctica (comprobado: estas tres aparecían con EXECUTE para
-- anon tras el reset), así que la revocación tiene que ser explícita. Los tests
-- 16 #6 y #7 son exactamente los que lo destaparon.
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'platform.enforce_deployment_provisioning_coherence()',
    'platform.enforce_saas_provisioning_transition()',
    'platform.reject_hard_delete()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_sig);
  end loop;
end;
$$;

-- `log_provisioning_config_change` NO se concede a `authenticated`: escribe en
-- la bitácora, y quien pudiera invocarla a mano podría fabricar un historial de
-- cambios que nunca ocurrieron. Las RPC definer la llaman como `postgres`.
revoke all on function platform.log_provisioning_config_change(text, uuid, text, jsonb, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function platform.log_provisioning_config_change(text, uuid, text, jsonb, jsonb, uuid)
  to service_role;

-- ---- Funciones EXCLUSIVAS del servidor -------------------------------------
-- Resuelven configuración sensible (incluida la referencia de secreto) o mueven
-- la máquina de estados de ejecución. `authenticated` queda fuera aunque tenga
-- el JWT de un super admin: el camino humano es la Edge Function, que primero
-- comprueba el permiso y sólo después asume el rol de servidor.
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'platform.provisioning_execution_context(uuid)',
    'platform.begin_saas_provisioning(uuid, uuid, text)',
    'platform.complete_saas_provisioning(uuid, text, text, text, jsonb, text, uuid, text)',
    'platform.fail_saas_provisioning(uuid, text, text, integer, uuid, text, jsonb)',
    'platform.record_provisioning_event(uuid, text, text, jsonb, uuid, text, integer)',
    'platform.deployment_health_context(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Catálogo de permisos y roles — lectura para todos los autenticados
-- ---------------------------------------------------------------------------
-- Saber que existe el permiso `platform.provisioning.execute` no concede nada.
-- La UI lo necesita para explicar qué hace falta para una acción bloqueada.
-- ---------------------------------------------------------------------------
grant select on platform.platform_permissions to authenticated;
grant select on platform.provisioning_role_permissions to authenticated;

create policy platform_permissions_select on platform.platform_permissions
  for select to authenticated using (true);

create policy provisioning_role_permissions_select on platform.provisioning_role_permissions
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 4. Membresías de rol
-- ---------------------------------------------------------------------------
grant select on platform.provisioning_role_members to authenticated;

create policy provisioning_role_members_select on platform.provisioning_role_members
  for select to authenticated
  using (
    -- Cada uno ve sus propios roles; el reparto completo es del super admin.
    user_id = auth.uid() or platform.is_super_admin()
  );

-- ---------------------------------------------------------------------------
-- 5. Propiedad técnica por producto
-- ---------------------------------------------------------------------------
grant select on platform.product_owners to authenticated;

create policy product_owners_select on platform.product_owners
  for select to authenticated
  using (
    user_id = auth.uid()
    or platform.has_platform_permission('platform.product_owner.manage')
    -- Un owner ve a sus co-owners del mismo producto: necesita saber a quién
    -- avisar. No ve a los owners de otros productos.
    or saas_product_id in (select platform.my_provisioning_product_ids())
  );

-- ---------------------------------------------------------------------------
-- 6. Integraciones de producto
-- ---------------------------------------------------------------------------
grant select on platform.product_integrations to authenticated;
revoke insert, update, delete on platform.product_integrations from authenticated;

create policy product_integrations_select on platform.product_integrations
  for select to authenticated
  using (platform.has_product_permission('platform.integration.read', saas_product_id));

comment on policy product_integrations_select on platform.product_integrations is
  'Un TECHNICAL_OWNER de EWM ve la integración de EWM y ninguna más. El alcance '
  'transversal viene de un rol global, no de ser owner de algo.';

-- ---------------------------------------------------------------------------
-- 7. Perfiles de credencial — privilegio de COLUMNA, no sólo política
-- ---------------------------------------------------------------------------
-- `secret_ref` y `public_key_ref` quedan deliberadamente fuera de la lista. No
-- hay forma de leerlos por PostgREST con la clave publicable: ni con una
-- política permisiva, ni con un `select *`, ni con un embed.
-- ---------------------------------------------------------------------------
grant select (
  id, code, name, saas_product_id, type, environment, secret_configured,
  algorithm, issuer, audience, token_ttl_seconds, enabled, created_at, updated_at
) on platform.credential_profiles to authenticated;

create policy credential_profiles_select on platform.credential_profiles
  for select to authenticated
  using (platform.has_product_permission('platform.credentials.read', saas_product_id));

comment on policy credential_profiles_select on platform.credential_profiles is
  'Da acceso a la METADATA. El nombre del secreto está fuera por privilegio de '
  'columna: la política puede cambiar mañana y `secret_ref` seguirá cerrado.';

-- ---------------------------------------------------------------------------
-- 8. Destinos de provisioning
-- ---------------------------------------------------------------------------
-- `deployment_targets` YA tiene GRANT de SELECT y una política del baseline.
-- Se AÑADE una política permisiva (las políticas se combinan con OR): el owner
-- técnico de un producto ve sus destinos aunque no pertenezca a ninguna de las
-- organizaciones implicadas. No se toca ni se reemplaza la política existente.
-- ---------------------------------------------------------------------------
create policy deployment_targets_select_provisioning on platform.deployment_targets
  for select to authenticated
  using (platform.has_product_permission('platform.deployment.read', saas_product_id));

grant select on platform.v_provisioning_targets to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Solicitudes de provisioning SaaS
-- ---------------------------------------------------------------------------
grant select on platform.saas_provisioning_requests to authenticated;
revoke insert, update, delete on platform.saas_provisioning_requests from authenticated;

create policy saas_prov_requests_select on platform.saas_provisioning_requests
  for select to authenticated
  using (
    platform.has_product_permission('platform.provisioning.read', saas_product_id)
    -- El cliente y el partner que administra el tenant ven el estado de SU
    -- tenant: es información suya. No ven configuración, credenciales ni
    -- destinos ajenos — sólo en qué estado está su alta.
    or tenant_id in (select platform.my_tenant_ids())
  );

grant select on platform.tenant_product_mappings to authenticated;
revoke insert, update, delete on platform.tenant_product_mappings from authenticated;

create policy tenant_product_mappings_select on platform.tenant_product_mappings
  for select to authenticated
  using (
    platform.has_product_permission('platform.provisioning.read', saas_product_id)
    or tenant_id in (select platform.my_tenant_ids())
  );

grant select on platform.saas_provisioning_events to authenticated;
revoke insert, update, delete on platform.saas_provisioning_events from authenticated;

create policy saas_prov_events_select on platform.saas_provisioning_events
  for select to authenticated
  using (
    exists (
      select 1 from platform.saas_provisioning_requests r
       where r.id = saas_provisioning_events.saas_provisioning_request_id
         and (platform.has_product_permission('platform.provisioning.read', r.saas_product_id)
              or r.tenant_id in (select platform.my_tenant_ids()))
    )
  );

comment on table platform.saas_provisioning_events is
  'Timeline append-only. APPEND-ONLY REAL: `authenticated` tiene SELECT y nada '
  'más, no hay política de escritura y un trigger bloquea el DELETE incluso para '
  'service_role. El COMMENT describe el enforcement que existe, no una intención.';

grant select on platform.v_saas_provisioning to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Cierre: `anon` fuera de todo lo nuevo
-- ---------------------------------------------------------------------------
-- El baseline ya revoca USAGE del schema a `anon`, así que esto es redundante
-- por diseño. Se repite porque una revocación redundante cuesta nada y una
-- revocación olvidada cuesta una filtración.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.relname, c.relkind
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'platform' and c.relkind in ('r', 'v')
  loop
    execute format('revoke all on platform.%I from anon, public', r.relname);
  end loop;
end;
$$;

-- El bucle anterior sólo toca `anon` y `PUBLIC`: los GRANT de `authenticated`
-- siguen intactos. Este segundo bucle asegura que las tablas y vistas NUEVAS
-- tengan el acceso completo de `service_role`, que es lo que usa el orquestador.
do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'platform' and c.relkind in ('r', 'v')
  loop
    execute format('grant all on platform.%I to service_role', r.relname);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Índices de apoyo para las FK nuevas
-- ---------------------------------------------------------------------------
-- Invariante estructural del proyecto (test 00_structure #12): toda FK tiene un
-- índice que la cubre. Sin él, borrar o actualizar la fila referenciada obliga a
-- un escaneo secuencial de la tabla hija, y el coste aparece meses después como
-- un bloqueo inexplicable.
-- ---------------------------------------------------------------------------
create index provisioning_role_members_granted_by_ix
  on platform.provisioning_role_members (granted_by) where granted_by is not null;
create index provisioning_role_permissions_code_ix
  on platform.provisioning_role_permissions (permission_code);
create index product_owners_granted_by_ix
  on platform.product_owners (granted_by) where granted_by is not null;
create index saas_prov_integration_ix
  on platform.saas_provisioning_requests (product_integration_id)
  where product_integration_id is not null;
create index saas_prov_requested_by_ix
  on platform.saas_provisioning_requests (requested_by) where requested_by is not null;
create index tenant_product_mappings_target_ix
  on platform.tenant_product_mappings (deployment_target_id)
  where deployment_target_id is not null;
create index saas_prov_events_actor_ix
  on platform.saas_provisioning_events (actor_user_id) where actor_user_id is not null;
