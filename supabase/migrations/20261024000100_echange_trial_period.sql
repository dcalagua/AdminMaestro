-- ============================================================================
-- Periodo de prueba configurable por producto (eChange: 7 días) y vencimiento
-- por tenant, con entrega a la app por el contrato trial.v1
-- ----------------------------------------------------------------------------
-- Pedido: «el periodo de prueba debe ser de 7 días, que sea configurable desde
-- MasterAdmin». MasterAdmin es la FUENTE de la configuración (días por
-- producto) y de la fecha de vencimiento de cada tenant TRIAL; la app (eChange)
-- aplica el vencimiento por su cuenta con lo que recibe.
--
-- Esta migración:
--   1. `saas_products.trial_days` (1..90, por defecto 7) y la RPC dedicada
--      `set_product_trial_days`. NO va en `metadata`: `upsert_saas_product` la
--      sobrescribe entera y el formulario del producto no la manda.
--   2. `tenants.trial_days` (días concedidos al nacer), `trial_ends_at` y
--      `trial_converted_at`. Un trigger los fija al crear un tenant TRIAL (todas
--      las puertas: onboarding, create_tenant, registro manual de tenant-sync)
--      y bloquea que un PATCH directo de la consola los toque: RLS decide filas,
--      no columnas (C-06), y `tenants_update` deja escribir a quien administra
--      el tenant. Una prueba extendida a mano es acceso operativo regalado.
--   3. `set_tenant_trial_end`: extender (fecha futura) o convertir (NULL = sin
--      vencimiento, pasa a PRODUCTION). Solo plataforma, con motivo y auditado.
--      Si el tenant estaba suspendido por prueba vencida, se reactiva.
--   4. Payload estándar de provisioning: clave `trial` SOLO para tenants TRIAL.
--   5. Canal trial.v1 (docs/platform-provisioning/TRIAL_CONTRACT.md):
--      `product_integrations.trial_path` + `trial_write_scope`,
--      `tenant_trial_delivery` (deseado/aplicado) y claim/contexto/resultado
--      para el job `trial` de entitlement-sync (viaja en `job: "all"`).
--   6. `apply_due_trial_expirations(p_as_of, p_mode)`: DRY_RUN lista; LIVE
--      suspende con el núcleo de suspensión. NO se programa (igual que el
--      precedente `apply_due_suspensions`): correrlo es una decisión del super
--      admin. Runbook en TRIAL_CONTRACT.md §6.
--   7. `v_tenant_overview` suma las columnas de prueba AL FINAL.
--
-- Tenants TRIAL que ya existían: NO se les inventa un vencimiento retroactivo
-- (quedaría vencido al migrar). Quedan «sin vencimiento registrado» y la
-- consola ofrece «Extender prueba» para fijarlo.
--
-- Test: supabase/tests/61_trial_period.test.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Fecha ISO-8601 en UTC sin milisegundos (la misma forma en SQL y en TS)
-- ---------------------------------------------------------------------------
create or replace function platform.trial_iso_utc(p_at timestamptz)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;

comment on function platform.trial_iso_utc(timestamptz) is
  'Fecha del contrato trial.v1: ISO-8601 UTC sin milisegundos (2026-11-24T15:04:05Z).';

revoke all on function platform.trial_iso_utc(timestamptz) from public, anon;
grant execute on function platform.trial_iso_utc(timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Días de prueba por producto
-- ---------------------------------------------------------------------------
alter table platform.saas_products
  add column trial_days smallint not null default 7,
  add constraint saas_products_trial_days_ck check (trial_days between 1 and 90);

comment on column platform.saas_products.trial_days is
  'Días de prueba que recibe un tenant TRIAL nuevo de este producto (1..90, por defecto 7). '
  'Solo se cambia con set_product_trial_days; no altera los vencimientos ya fijados.';

-- La tabla tiene UPDATE a nivel de tabla para la consola (RLS: plataforma). Un
-- PATCH directo no cambia los días: sin rastro de auditoría no hay cambio.
create or replace function platform.guard_product_trial_days()
returns trigger
language plpgsql
set search_path = platform, pg_catalog
as $$
begin
  if current_user in ('authenticated', 'anon') and new.trial_days is distinct from old.trial_days then
    raise exception 'NO_AUTORIZADO: los días de prueba se cambian con set_product_trial_days (auditado)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function platform.guard_product_trial_days() from public, anon, authenticated, service_role;

create trigger saas_products_trial_days_guard
  before update of trial_days on platform.saas_products
  for each row execute function platform.guard_product_trial_days();

create or replace function platform.set_product_trial_days(p_product_id uuid, p_days integer)
returns smallint
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_prod record;
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: solo EBIM_PRODUCT_ADMIN o el super admin configuran la prueba de un producto'
      using errcode = '42501';
  end if;
  if p_days is null or p_days not between 1 and 90 then
    raise exception 'DIAS_PRUEBA_INVALIDOS: la prueba dura entre 1 y 90 días; recibido %', p_days
      using errcode = '23514';
  end if;

  select id, code, trial_days into v_prod from platform.saas_products where id = p_product_id for update;
  if v_prod.id is null then
    raise exception 'PRODUCTO_NO_ENCONTRADO: %', p_product_id using errcode = '23503';
  end if;

  if v_prod.trial_days <> p_days then
    update platform.saas_products set trial_days = p_days where id = p_product_id;
    perform platform.log_audit(
      'PRODUCT_TRIAL_DAYS_CHANGED', 'saas_product', p_product_id::text, null, null,
      jsonb_build_object('code', v_prod.code, 'from', v_prod.trial_days, 'to', p_days)
    );
  end if;

  return p_days::smallint;
end;
$$;

comment on function platform.set_product_trial_days(uuid, integer) is
  'Días de prueba de un producto (1..90). Solo plataforma, auditado. Afecta a los tenants TRIAL que se creen después.';

revoke all on function platform.set_product_trial_days(uuid, integer) from public, anon;
grant execute on function platform.set_product_trial_days(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Vencimiento por tenant
-- ---------------------------------------------------------------------------
alter table platform.tenants
  add column trial_days         smallint,
  add column trial_ends_at      timestamptz,
  add column trial_converted_at timestamptz,
  add constraint tenants_trial_days_ck check (trial_days is null or trial_days between 1 and 90),
  -- Convertida = sin vencimiento.
  add constraint tenants_trial_converted_ck check (trial_converted_at is null or trial_ends_at is null);

comment on column platform.tenants.trial_days is
  'Días de prueba concedidos al nacer (copia de saas_products.trial_days en ese momento).';
comment on column platform.tenants.trial_ends_at is
  'Vencimiento de la prueba (UTC). NULL = sin vencimiento. Solo lo escriben el alta y set_tenant_trial_end.';
comment on column platform.tenants.trial_converted_at is
  'Cuándo la prueba se convirtió en cliente de pago (set_tenant_trial_end con NULL).';

create index tenants_trial_due_ix on platform.tenants (trial_ends_at)
  where tenant_type = 'TRIAL' and trial_ends_at is not null;

-- SECURITY INVOKER a propósito: `current_user` distingue un PATCH directo de
-- PostgREST (authenticated/anon) de una función de esta base (su dueño).
create or replace function platform.apply_tenant_trial_defaults()
returns trigger
language plpgsql
set search_path = platform, pg_catalog
as $$
declare
  v_direct boolean := current_user in ('authenticated', 'anon');
  v_days   smallint;
begin
  if tg_op = 'UPDATE' and v_direct and (
       new.trial_days is distinct from old.trial_days
       or new.trial_ends_at is distinct from old.trial_ends_at
       or new.trial_converted_at is distinct from old.trial_converted_at
       -- Salir de TRIAL por PATCH sería esquivar el vencimiento sin auditoría.
       or (old.tenant_type = 'TRIAL') <> (new.tenant_type = 'TRIAL')) then
    raise exception 'NO_AUTORIZADO: la prueba de un tenant se cambia con set_tenant_trial_end (auditado)'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' and v_direct then
    -- Quien inserta por la API no elige su propio vencimiento.
    new.trial_days := null;
    new.trial_ends_at := null;
    new.trial_converted_at := null;
  end if;

  if new.tenant_type = 'TRIAL'
     and new.trial_ends_at is null and new.trial_converted_at is null
     and (tg_op = 'INSERT' or old.tenant_type is distinct from 'TRIAL') then
    select p.trial_days into v_days from platform.saas_products p where p.id = new.saas_product_id;
    new.trial_days := coalesce(new.trial_days, v_days, 7);
    new.trial_ends_at := date_trunc('second', now()) + make_interval(days => new.trial_days);
  end if;

  return new;
end;
$$;

revoke all on function platform.apply_tenant_trial_defaults() from public, anon, authenticated, service_role;

create trigger tenants_trial_defaults
  before insert or update of tenant_type, trial_days, trial_ends_at, trial_converted_at on platform.tenants
  for each row execute function platform.apply_tenant_trial_defaults();

-- ---------------------------------------------------------------------------
-- 3. Canal trial.v1 en la integración
-- ---------------------------------------------------------------------------
alter table platform.product_integrations
  add column trial_path        text,
  add column trial_write_scope text;

alter table platform.product_integrations
  add constraint product_integrations_trial_path_ck check (
    trial_path is null or platform.is_safe_url_path(trial_path)),
  add constraint product_integrations_trial_scope_ck check (
    trial_write_scope is null
    or (trial_write_scope ~ '^[a-z0-9][a-z0-9:._-]{2,99}$'
        -- Una credencial de alta o de entitlements no extiende pruebas. La de
        -- lifecycle sí puede (eChange usa echange:lifecycle:write para ambos).
        and trial_write_scope is distinct from create_scope
        and trial_write_scope is distinct from read_scope
        and trial_write_scope is distinct from entitlements_write_scope
        and trial_write_scope is distinct from entitlements_read_scope
        and not (trial_write_scope = any (additional_scopes)))),
  add constraint product_integrations_trial_all_or_none_ck check (
    (trial_path is null) = (trial_write_scope is null));

comment on column platform.product_integrations.trial_path is
  'Plantilla relativa de PUT/GET /tenants/{controlPlaneTenantId}/trial (contrato trial.v1). NULL = sin canal.';
comment on column platform.product_integrations.trial_write_scope is
  'Scope del token M2M para el PUT trial.v1 (eChange: echange:lifecycle:write).';

create or replace function platform.configure_trial_integration(
  p_integration_id uuid,
  p_trial_path     text,
  p_write_scope    text
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
    raise exception 'NO_AUTORIZADO: configurar trial.v1 exige platform.integration.manage sobre el producto'
      using errcode = '42501';
  end if;
  if v_int.integration_type <> 'HTTP_M2M' then
    raise exception 'TIPO_NO_SOPORTADO: el contrato trial.v1 solo viaja por HTTP_M2M' using errcode = '23514';
  end if;

  update platform.product_integrations
     set trial_path = nullif(btrim(p_trial_path), ''),
         trial_write_scope = nullif(btrim(p_write_scope), '')
   where id = p_integration_id;

  perform platform.log_audit(
    'TRIAL_INTEGRATION_CONFIGURED', 'product_integration', p_integration_id::text, null, null,
    jsonb_build_object('trial_path', p_trial_path, 'write_scope', p_write_scope)
  );
  return p_integration_id;
end;
$$;

comment on function platform.configure_trial_integration(uuid, text, text) is
  'Ruta y scope del contrato trial.v1 de una integración HTTP_M2M (los dos o ninguno). platform.integration.manage.';

revoke all on function platform.configure_trial_integration(uuid, text, text) from public, anon;
grant execute on function platform.configure_trial_integration(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Estado deseado y aplicado de la prueba en la app
-- ---------------------------------------------------------------------------
-- El cuerpo de trial.v1 no lleva versión (es declarativo: «la prueba vence en
-- X»). `desired_version` es interna: sirve para que un cambio que llega con un
-- PUT en vuelo no se dé por aplicado con la respuesta del anterior.
create table platform.tenant_trial_delivery (
  tenant_id        uuid primary key references platform.tenants (id) on delete restrict,
  saas_product_id  uuid not null references platform.saas_products (id) on delete restrict,
  desired_ends_at  timestamptz,
  desired_reason   text not null,
  desired_version  integer not null default 1,
  desired_at       timestamptz not null default now(),
  applied_version  integer,
  applied_ends_at  timestamptz,
  applied_state    text,
  applied_at       timestamptz,
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  lease_owner      text,
  lease_until      timestamptz,
  last_attempt_at  timestamptz,
  last_result      text,
  last_http_status integer,
  last_error_code  text,
  updated_at       timestamptz not null default now(),
  constraint tenant_trial_delivery_reason_ck
    check (desired_reason in ('STARTED', 'EXTENDED', 'CONVERTED', 'MANUAL')),
  -- Convertir es lo único que manda «sin vencimiento».
  constraint tenant_trial_delivery_converted_ck
    check ((desired_reason = 'CONVERTED') = (desired_ends_at is null)),
  constraint tenant_trial_delivery_version_ck check (desired_version >= 1
    and (applied_version is null or applied_version >= 1)),
  constraint tenant_trial_delivery_applied_ck check (
    (applied_version is null) = (applied_state is null)
    and (applied_state is null or applied_state in ('TRIAL', 'EXPIRED', 'CONVERTED'))),
  constraint tenant_trial_delivery_result_ck check (last_result is null or last_result in (
    'APPLIED', 'RETRYABLE', 'REJECTED', 'NOT_CONFIGURED')),
  constraint tenant_trial_delivery_error_ck check (
    last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$')
);

create index tenant_trial_delivery_product_idx on platform.tenant_trial_delivery (saas_product_id);
create index tenant_trial_delivery_pending_idx on platform.tenant_trial_delivery (next_attempt_at)
  where applied_version is distinct from desired_version;

comment on table platform.tenant_trial_delivery is
  'Contrato trial.v1: el vencimiento que MasterAdmin quiere (desired_*) y lo que la app confirmó (applied_*). Escribe solo el servidor.';

alter table platform.tenant_trial_delivery enable row level security;
alter table platform.tenant_trial_delivery force row level security;

create policy tenant_trial_delivery_select on platform.tenant_trial_delivery
  for select to authenticated
  using (tenant_id in (select t.id from platform.tenants t));

revoke all on platform.tenant_trial_delivery from public, anon, authenticated;
grant select on platform.tenant_trial_delivery to authenticated, service_role;

-- Núcleo sin guardia ni grants: recalcula lo que hay que decirle a la app.
create or replace function platform._mark_trial_desired(p_tenant_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_tenant record;
  v_row    record;
  v_reason text := p_reason;
begin
  select t.id, t.saas_product_id, t.tenant_type, t.trial_ends_at, t.trial_converted_at
    into v_tenant from platform.tenants t where t.id = p_tenant_id;
  if v_tenant.id is null then
    return;
  end if;

  -- Solo hay algo que decir a la app si el tenant existe allí.
  if not exists (select 1 from platform.tenant_product_mappings m
                  where m.tenant_id = p_tenant_id and m.status = 'ACTIVE') then
    return;
  end if;

  if v_tenant.trial_converted_at is not null then
    v_reason := 'CONVERTED';
  elsif v_tenant.tenant_type <> 'TRIAL' or v_tenant.trial_ends_at is null then
    return;  -- No es (ni fue) una prueba con vencimiento: nada que entregar.
  end if;

  select * into v_row from platform.tenant_trial_delivery where tenant_id = p_tenant_id for update;
  if v_row.tenant_id is null then
    insert into platform.tenant_trial_delivery (tenant_id, saas_product_id, desired_ends_at, desired_reason)
    values (p_tenant_id, v_tenant.saas_product_id,
            case when v_reason = 'CONVERTED' then null else v_tenant.trial_ends_at end, v_reason);
    return;
  end if;

  -- El alta en la app (STARTED) no pisa una decisión posterior ya registrada.
  if p_reason = 'STARTED' then
    return;
  end if;

  if v_row.desired_ends_at is not distinct from
       (case when v_reason = 'CONVERTED' then null else v_tenant.trial_ends_at end)
     and v_row.desired_reason = v_reason then
    return;
  end if;

  update platform.tenant_trial_delivery
     set desired_ends_at = case when v_reason = 'CONVERTED' then null else v_tenant.trial_ends_at end,
         desired_reason = v_reason,
         desired_version = greatest(desired_version, coalesce(applied_version, 0)) + 1,
         desired_at = now(),
         attempts = 0,
         next_attempt_at = now(),
         updated_at = now()
   where tenant_id = p_tenant_id;
end;
$$;

revoke all on function platform._mark_trial_desired(uuid, text) from public, anon, authenticated, service_role;

-- El alta en la app (mapping ACTIVE) le entrega la prueba aunque el payload de
-- provisioning ya la llevara: el canal confirma, el payload solo informa.
create or replace function platform.on_tenant_mapping_marks_trial()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  perform platform._mark_trial_desired(new.tenant_id, 'STARTED');
  return null;
end;
$$;

revoke all on function platform.on_tenant_mapping_marks_trial() from public, anon, authenticated, service_role;

create trigger tenant_product_mappings_marks_trial
  after insert or update of status on platform.tenant_product_mappings
  for each row
  when (new.status = 'ACTIVE')
  execute function platform.on_tenant_mapping_marks_trial();

-- ---------------------------------------------------------------------------
-- 5. Extender / convertir la prueba de un tenant
-- ---------------------------------------------------------------------------
create or replace function platform.set_tenant_trial_end(
  p_tenant_id uuid,
  p_ends_at   timestamptz,
  p_reason    text
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_tenant  record;
  v_ends    timestamptz := date_trunc('second', p_ends_at);
  v_code    text;
  v_susp    record;
  v_request uuid;
  v_resumed boolean := false;
  v_action  text;
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: extender o convertir una prueba es una decisión de plataforma (comercial != acceso operativo)'
      using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: extender o convertir una prueba exige un motivo auditable'
      using errcode = '23502';
  end if;

  select * into v_tenant from platform.tenants where id = p_tenant_id for update;
  if v_tenant.id is null then
    raise exception 'TENANT_NO_ENCONTRADO: %', p_tenant_id using errcode = '23503';
  end if;
  if v_tenant.tenant_type <> 'TRIAL' then
    raise exception 'TENANT_NO_ES_PRUEBA: % es %, no TRIAL', v_tenant.slug, v_tenant.tenant_type
      using errcode = '23514';
  end if;
  if v_tenant.status in ('CHURNED', 'ARCHIVED') then
    raise exception 'TENANT_INACTIVO: % está %; su prueba ya no se gestiona', v_tenant.slug, v_tenant.status
      using errcode = '23514';
  end if;

  if p_ends_at is null then
    v_code := 'CONVERTED';
    update platform.tenants
       set tenant_type = 'PRODUCTION', trial_ends_at = null, trial_converted_at = now()
     where id = p_tenant_id;
  else
    if v_ends <= now() then
      raise exception 'FECHA_PASADA: el nuevo vencimiento (%) tiene que ser futuro', platform.trial_iso_utc(v_ends)
        using errcode = '22023';
    end if;
    if v_ends > now() + interval '365 days' then
      raise exception 'PRUEBA_DEMASIADO_LARGA: una prueba no se extiende más de 365 días; conviértela en cliente'
        using errcode = '22023';
    end if;
    v_code := case when v_tenant.trial_ends_at is not null and v_ends > v_tenant.trial_ends_at
                   then 'EXTENDED' else 'MANUAL' end;
    update platform.tenants set trial_ends_at = v_ends where id = p_tenant_id;
  end if;

  -- Si estaba suspendido POR prueba vencida, extender o convertir lo reactiva.
  -- Una suspensión por otra causa (impago, manual) la sigue levantando una persona.
  select su.* into v_susp
    from platform.tenant_suspensions su
   where su.tenant_id = p_tenant_id and su.resumed_at is null
     and su.detail ->> 'source' = 'TRIAL_EXPIRED'
   for update;
  if v_susp.id is not null and v_tenant.status = 'SUSPENDED' then
    -- Se cierra ANTES del cambio de estado: así el núcleo no la cierra como genérica.
    update platform.tenant_suspensions
       set resumed_at = now(), resumed_by = auth.uid(), resume_cause = 'MANUAL',
           resume_reason = case when v_code = 'CONVERTED' then 'Prueba convertida: ' else 'Prueba extendida: ' end
                           || trim(p_reason)
     where id = v_susp.id;
    perform platform._tenant_status_transition(p_tenant_id, 'ACTIVE', trim(p_reason));
    v_request := platform._enqueue_provisioning_core(
      'RESUME_TENANT', p_tenant_id, null, null, 'DRY_RUN',
      jsonb_build_object('reason', trim(p_reason), 'cause', 'TRIAL_' || v_code, 'suspension_id', v_susp.id),
      'RESUME_TENANT:' || v_susp.id::text,
      'Reactivación por prueba ' || case when v_code = 'CONVERTED' then 'convertida' else 'extendida' end
    );
    update platform.tenant_suspensions set resume_request_id = v_request where id = v_susp.id;
    v_resumed := true;
  end if;

  perform platform._mark_trial_desired(p_tenant_id, v_code);

  v_action := case when p_ends_at is null then 'TENANT_TRIAL_CONVERTED' else 'TENANT_TRIAL_EXTENDED' end;
  perform platform.log_audit(
    v_action, 'tenant', p_tenant_id::text, v_tenant.customer_organization_id, p_tenant_id,
    jsonb_build_object('from', case when v_tenant.trial_ends_at is null then null
                                    else platform.trial_iso_utc(v_tenant.trial_ends_at) end,
                       'to', case when p_ends_at is null then null else platform.trial_iso_utc(v_ends) end,
                       'reason_code', v_code, 'reason', trim(p_reason), 'resumed', v_resumed)
  );

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'ends_at', case when p_ends_at is null then null else platform.trial_iso_utc(v_ends) end,
    'reason', v_code,
    'resumed', v_resumed
  );
end;
$$;

comment on function platform.set_tenant_trial_end(uuid, timestamptz, text) is
  'Extiende (fecha futura, ≤ 365 días) o convierte (NULL: sin vencimiento, pasa a PRODUCTION) la prueba de un '
  'tenant TRIAL. Solo plataforma, con motivo, auditado; reactiva si estaba suspendido por prueba vencida.';

revoke all on function platform.set_tenant_trial_end(uuid, timestamptz, text) from public, anon;
grant execute on function platform.set_tenant_trial_end(uuid, timestamptz, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Canal servidor de trial.v1: reclamar, contexto y resultado
-- ---------------------------------------------------------------------------
create or replace function platform.trial_channel_of(p_tenant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select i.id
    from platform.tenant_product_mappings m
    join platform.deployment_targets dt on dt.id = m.deployment_target_id
    join platform.product_integrations i on i.id = dt.product_integration_id
   where m.tenant_id = p_tenant_id
     and m.status = 'ACTIVE'
     and i.integration_type = 'HTTP_M2M'
     and i.trial_path is not null
     and i.trial_write_scope is not null
   limit 1
$$;

revoke all on function platform.trial_channel_of(uuid) from public, anon, authenticated, service_role;

create or replace function platform.claim_trial_deliveries(
  p_worker        text,
  p_limit         integer default 20,
  p_lease_seconds integer default 120
)
returns table (
  tenant_id       uuid,
  saas_product_id uuid,
  desired_version integer,
  desired_ends_at timestamptz,
  desired_reason  text,
  desired_at      timestamptz
)
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
#variable_conflict use_column
begin
  if not platform.is_service_request() then
    raise exception 'SOLO_SERVIDOR: claim_trial_deliveries() es del canal servidor' using errcode = '42501';
  end if;
  if p_worker is null or length(p_worker) not between 1 and 200 then
    raise exception 'PETICION_INVALIDA: worker' using errcode = '22023';
  end if;

  return query
  with c as (
    select d.tenant_id
      from platform.tenant_trial_delivery d
     where d.applied_version is distinct from d.desired_version
       and d.next_attempt_at <= now()
       and (d.lease_until is null or d.lease_until < now())
       and platform.trial_channel_of(d.tenant_id) is not null
     order by d.next_attempt_at
     limit least(greatest(coalesce(p_limit, 20), 1), 100)
     for update skip locked
  )
  update platform.tenant_trial_delivery d
     set lease_owner = p_worker,
         lease_until = now() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 120), 10), 900)),
         attempts = d.attempts + 1,
         last_attempt_at = now(),
         updated_at = now()
    from c
   where d.tenant_id = c.tenant_id
  returning d.tenant_id, d.saas_product_id, d.desired_version, d.desired_ends_at, d.desired_reason, d.desired_at;
end;
$$;

comment on function platform.claim_trial_deliveries(text, integer, integer) is
  'Reclama entregas trial.v1 pendientes (FOR UPDATE SKIP LOCKED) con lease. Solo service_role.';

revoke all on function platform.claim_trial_deliveries(text, integer, integer) from public, anon, authenticated;
grant execute on function platform.claim_trial_deliveries(text, integer, integer) to service_role;

create or replace function platform.trial_delivery_context(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_map  record;
  v_dep  record;
  v_int  record;
  v_cred record;
  v_prod record;
begin
  if not platform.is_service_request() then
    raise exception 'SOLO_SERVIDOR: trial_delivery_context() resuelve configuración sensible' using errcode = '42501';
  end if;

  select m.* into v_map from platform.tenant_product_mappings m
   where m.tenant_id = p_tenant_id and m.status = 'ACTIVE';
  if v_map.id is null then
    raise exception 'TENANT_NO_APROVISIONADO' using errcode = 'P0002';
  end if;
  select * into v_dep from platform.deployment_targets where id = v_map.deployment_target_id;
  select * into v_int from platform.product_integrations where id = v_dep.product_integration_id;
  select * into v_cred from platform.credential_profiles where id = v_dep.credential_profile_id;
  select * into v_prod from platform.saas_products where id = v_map.saas_product_id;

  return jsonb_build_object(
    'tenant', jsonb_build_object('controlPlaneTenantId', p_tenant_id, 'productCode', v_prod.code),
    'deployment', case when v_dep.id is null then null else jsonb_build_object(
      'id', v_dep.id, 'environment', v_dep.provisioning_environment::text, 'base_url', v_dep.base_url,
      'timeout_ms', v_dep.timeout_ms, 'retry_count', v_dep.retry_count) end,
    'integration', case when v_int.id is null then null else jsonb_build_object(
      'id', v_int.id, 'type', v_int.integration_type::text, 'issuer', v_int.issuer, 'audience', v_int.audience,
      'subject', v_int.subject, 'algorithm', v_int.algorithm::text, 'token_ttl_seconds', v_int.token_ttl_seconds,
      'trial_path', v_int.trial_path, 'trial_write_scope', v_int.trial_write_scope,
      'allowed_hosts', to_jsonb(v_int.allowed_hosts)) end,
    'credential', case when v_cred.id is null then null else jsonb_build_object(
      'id', v_cred.id, 'type', v_cred.type::text, 'enabled', v_cred.enabled, 'algorithm', v_cred.algorithm::text,
      'token_ttl_seconds', v_cred.token_ttl_seconds, 'secret_ref', v_cred.secret_ref) end
  );
end;
$$;

comment on function platform.trial_delivery_context(uuid) is
  'Destino, ruta y scope trial.v1 y NOMBRE del secreto para el PUT. Solo service_role.';

revoke all on function platform.trial_delivery_context(uuid) from public, anon, authenticated;
grant execute on function platform.trial_delivery_context(uuid) to service_role;

create or replace function platform.record_trial_delivery_result(
  p_tenant_id     uuid,
  p_worker        text,
  p_version       integer,
  p_result        text,
  p_http_status   integer default null,
  p_error_code    text default null,
  p_applied_state text default null
)
returns text
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_row  record;
  v_code text := case when p_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$' then p_error_code
                      when p_error_code is null then null else 'ERROR' end;
begin
  if not platform.is_service_request() then
    raise exception 'SOLO_SERVIDOR: record_trial_delivery_result() es del canal servidor' using errcode = '42501';
  end if;
  if p_result not in ('APPLIED', 'RETRYABLE', 'REJECTED', 'NOT_CONFIGURED') then
    raise exception 'PETICION_INVALIDA: result' using errcode = '22023';
  end if;

  select * into v_row from platform.tenant_trial_delivery where tenant_id = p_tenant_id for update;
  if v_row.tenant_id is null then
    raise exception 'ENTREGA_NO_ENCONTRADA' using errcode = 'P0002';
  end if;
  if v_row.lease_owner is distinct from p_worker then
    return 'LEASE_PERDIDO';  -- El lease venció y otro worker la tomó: su resultado manda.
  end if;

  if p_result = 'APPLIED' then
    if coalesce(p_applied_state, '') not in ('TRIAL', 'EXPIRED', 'CONVERTED') or p_version is null or p_version < 1 then
      raise exception 'PETICION_INVALIDA: versión o estado aplicado' using errcode = '22023';
    end if;
    -- Lo aplicado es lo que se ENVIÓ con esa versión. Si mientras tanto cambió
    -- el deseado (versión mayor), la entrega sigue pendiente.
    update platform.tenant_trial_delivery
       set applied_version = p_version,
           applied_ends_at = case when p_version = desired_version then desired_ends_at else applied_ends_at end,
           applied_state = p_applied_state,
           applied_at = now(),
           attempts = 0,
           next_attempt_at = now()
     where tenant_id = p_tenant_id;
    perform platform.log_audit(
      'TENANT_TRIAL_DELIVERED', 'tenant', p_tenant_id::text, null, p_tenant_id,
      jsonb_build_object('source', 'SYSTEM', 'version', p_version, 'state', p_applied_state,
                         'ends_at', case when v_row.desired_ends_at is null then null
                                         else platform.trial_iso_utc(v_row.desired_ends_at) end,
                         'reason', v_row.desired_reason)
    );
  elsif p_result = 'RETRYABLE' then
    update platform.tenant_trial_delivery
       set next_attempt_at = now() + make_interval(mins => power(2, least(greatest(attempts, 1) - 1, 5))::int)
     where tenant_id = p_tenant_id;
  else
    -- REJECTED / NOT_CONFIGURED: requiere a una persona; se reintenta cada hora.
    update platform.tenant_trial_delivery
       set next_attempt_at = now() + interval '1 hour'
     where tenant_id = p_tenant_id;
  end if;

  update platform.tenant_trial_delivery
     set lease_owner = null,
         lease_until = null,
         last_result = p_result,
         last_http_status = p_http_status,
         last_error_code = v_code,
         updated_at = now()
   where tenant_id = p_tenant_id;

  return p_result;
end;
$$;

comment on function platform.record_trial_delivery_result(uuid, text, integer, text, integer, text, text) is
  'Registra el resultado de un PUT trial.v1 (libera el lease, backoff). Solo service_role.';

revoke all on function platform.record_trial_delivery_result(uuid, text, integer, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function platform.record_trial_delivery_result(uuid, text, integer, text, integer, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. Vencimiento: pruebas vencidas → suspensión (DRY_RUN solo informa)
-- ---------------------------------------------------------------------------
create or replace function platform.apply_due_trial_expirations(
  p_as_of timestamptz default now(),
  p_mode  text default 'DRY_RUN'
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  r         record;
  v_due     jsonb := '[]'::jsonb;
  v_applied integer := 0;
  v_skipped integer := 0;
  v_susp    uuid;
  v_request uuid;
  v_reason  text;
  v_as_of   timestamptz := coalesce(p_as_of, now());
begin
  if not (platform.can_manage_platform_entities() or platform.is_super_admin() or platform.is_system_job()) then
    raise exception 'NO_AUTORIZADO: vencer pruebas exige rol de plataforma' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('DRY_RUN', 'LIVE') then
    raise exception 'MODO_INVALIDO: mode debe ser DRY_RUN o LIVE; recibido "%"', p_mode using errcode = '23514';
  end if;
  if p_mode = 'LIVE' and not (platform.is_super_admin() or platform.is_system_job()) then
    raise exception 'LIVE_NO_AUTORIZADO: suspender pruebas vencidas lo decide el super admin de la suite (contrato §13)'
      using errcode = '42501';
  end if;

  for r in
    select t.id, t.name, t.slug, t.status, t.trial_ends_at, t.customer_organization_id, p.short_name as product
      from platform.tenants t
      join platform.saas_products p on p.id = t.saas_product_id
     where t.tenant_type = 'TRIAL'
       and t.trial_converted_at is null
       and t.trial_ends_at is not null
       and t.trial_ends_at <= v_as_of
     order by t.trial_ends_at, t.name
  loop
    if r.status <> 'ACTIVE' then
      -- PENDING aún no opera; SUSPENDED/CHURNED/ARCHIVED ya no operan.
      v_skipped := v_skipped + 1;
      v_due := v_due || jsonb_build_object(
        'tenant_id', r.id, 'tenant', r.name, 'product', r.product, 'status', r.status,
        'trial_ends_at', platform.trial_iso_utc(r.trial_ends_at), 'action', 'SKIPPED_NOT_ACTIVE');
      continue;
    end if;

    if p_mode = 'DRY_RUN' then
      v_due := v_due || jsonb_build_object(
        'tenant_id', r.id, 'tenant', r.name, 'product', r.product, 'status', r.status,
        'trial_ends_at', platform.trial_iso_utc(r.trial_ends_at), 'action', 'WOULD_SUSPEND');
      continue;
    end if;

    v_reason := 'Prueba vencida el ' || platform.trial_iso_utc(r.trial_ends_at);

    -- La fila va ANTES del cambio de estado (como en el impago): así queda la
    -- marca TRIAL_EXPIRED que set_tenant_trial_end usa para reactivar.
    insert into platform.tenant_suspensions (tenant_id, cause, reason, detail, suspended_at, suspended_by)
    values (r.id, 'MANUAL', v_reason,
            jsonb_build_object('source', 'TRIAL_EXPIRED', 'trial_ends_at', platform.trial_iso_utc(r.trial_ends_at)),
            v_as_of, auth.uid())
    returning id into v_susp;

    perform platform._tenant_status_transition(r.id, 'SUSPENDED', v_reason);

    -- Igual que el ciclo de vida: la orden de infraestructura queda en
    -- simulación; el apagado operativo viaja por lifecycle.v1 (trigger de estado).
    v_request := platform._enqueue_provisioning_core(
      'SUSPEND_TENANT', r.id, null, null, 'DRY_RUN',
      jsonb_build_object('reason', v_reason, 'cause', 'TRIAL_EXPIRED', 'suspension_id', v_susp),
      'SUSPEND_TENANT:' || v_susp::text,
      'Suspensión por prueba vencida'
    );
    update platform.tenant_suspensions set provisioning_request_id = v_request where id = v_susp;

    v_applied := v_applied + 1;
    v_due := v_due || jsonb_build_object(
      'tenant_id', r.id, 'tenant', r.name, 'product', r.product, 'status', 'SUSPENDED',
      'trial_ends_at', platform.trial_iso_utc(r.trial_ends_at), 'action', 'SUSPENDED',
      'suspension_id', v_susp);
  end loop;

  if v_applied > 0 then
    perform platform.log_audit(
      'TRIAL_EXPIRATIONS_APPLIED', 'tenant', null, null, null,
      jsonb_build_object('as_of', v_as_of, 'applied', v_applied, 'skipped', v_skipped, 'mode', p_mode,
                         'details', v_due)
    );
  end if;

  return jsonb_build_object(
    'as_of', v_as_of, 'mode', p_mode, 'applied', v_applied, 'skipped', v_skipped, 'due', v_due
  );
end;
$$;

comment on function platform.apply_due_trial_expirations(timestamptz, text) is
  'Pruebas TRIAL vencidas (no convertidas). DRY_RUN solo las lista; LIVE (super admin o job del sistema) las '
  'suspende con causa MANUAL y detail.source = TRIAL_EXPIRED. No está programada (TRIAL_CONTRACT.md §6).';

revoke all on function platform.apply_due_trial_expirations(timestamptz, text) from public, anon;
grant execute on function platform.apply_due_trial_expirations(timestamptz, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Payload estándar de provisioning: clave `trial` para tenants TRIAL
-- ----------------------------------------------------------------------------
-- Copia literal de 20260921000100_v4_contract_adapters.sql (líneas 243–414)
-- con UN añadido: `|| case … 'trial' …` al final de la expresión de `payload`.
-- La firma no cambia, así que los grants (solo service_role) siguen vigentes.
-- ---------------------------------------------------------------------------
create or replace function platform.provisioning_execution_context(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_req    record;
  v_tenant record;
  v_prod   record;
  v_target record;
  v_int    record;
  v_cred   record;
  v_org    record;
  v_comp   record;
  v_plan   record;
  v_map    record;
begin
  if not platform.is_service_request() then
    raise exception 'SOLO_SERVIDOR: provisioning_execution_context() resuelve configuración sensible '
                    'y sólo la invoca el orquestador server-side'
      using errcode = '42501';
  end if;

  select * into v_req from platform.saas_provisioning_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'SOLICITUD_NO_ENCONTRADA' using errcode = 'P0002';
  end if;

  select * into v_tenant from platform.tenants where id = v_req.tenant_id;
  select * into v_prod from platform.saas_products where id = v_req.saas_product_id;
  select * into v_org from platform.organizations where id = v_tenant.customer_organization_id;
  select * into v_comp from platform.companies where id = v_tenant.company_id;

  -- El SELECT INTO se ejecuta SIEMPRE, aunque el identificador sea NULL.
  -- Es deliberado: en PL/pgSQL, leer un campo de un RECORD que nunca fue
  -- destino de un INTO lanza 55000 («tuple structure is indeterminate»), no
  -- devuelve NULL. Un SELECT sin filas, en cambio, deja el record asignado y
  -- con todos sus campos en NULL — que es exactamente lo que el resto del
  -- cuerpo espera poder comprobar.
  select * into v_target from platform.deployment_targets
   where id = v_req.deployment_target_id;
  -- La integración efectiva es la del destino; si el destino no la fija todavía,
  -- la que quedó anotada en la solicitud.
  select * into v_int from platform.product_integrations
   where id = coalesce(v_target.product_integration_id, v_req.product_integration_id);
  select * into v_cred from platform.credential_profiles
   where id = v_target.credential_profile_id;

  select p.code, p.name into v_plan
    from platform.subscriptions s join platform.plans p on p.id = s.plan_id
   where s.id = v_req.subscription_id;

  -- Mapping externo de ESTA solicitud (null si todavía no existe).
  select * into v_map from platform.tenant_product_mappings
   where saas_provisioning_request_id = p_request_id;

  return jsonb_build_object(
    'request', jsonb_build_object(
      'id', v_req.id,
      'status', v_req.status::text,
      'idempotency_key', v_req.idempotency_key,
      'correlation_id', v_req.correlation_id,
      'attempt_count', v_req.attempt_count,
      'max_attempts', v_req.max_attempts,
      'request_version', v_req.request_version,
      'environment', v_req.provisioning_environment::text,
      'policy', v_req.provisioning_policy::text,
      'requested_by', v_req.requested_by,
      'subscription_id', v_req.subscription_id
    ),
    'product', jsonb_build_object(
      'id', v_prod.id, 'code', v_prod.code, 'short_name', v_prod.short_name
    ),
    'deployment', case when v_target.id is null then null else jsonb_build_object(
      'id', v_target.id,
      'code', v_target.code,
      'deployment_mode', v_target.deployment_mode::text,
      'environment', v_target.provisioning_environment::text,
      'base_url', v_target.base_url,
      'timeout_ms', v_target.timeout_ms,
      'retry_count', v_target.retry_count,
      'status', v_target.provisioning_status::text,
      'enabled', v_target.provisioning_enabled,
      'health_status', v_target.health_status::text
    ) end,
    'integration', case when v_int.id is null then null else jsonb_build_object(
      'id', v_int.id,
      'code', v_int.code,
      'type', v_int.integration_type::text,
      'contract_version', v_int.contract_version,
      'status', v_int.status::text,
      'enabled', v_int.enabled,
      'issuer', v_int.issuer,
      'audience', v_int.audience,
      'subject', v_int.subject,
      'algorithm', v_int.algorithm::text,
      'token_ttl_seconds', v_int.token_ttl_seconds,
      'create_scope', v_int.create_scope,
      'read_scope', v_int.read_scope,
      'additional_scopes', to_jsonb(v_int.additional_scopes),
      'create_path_template', v_int.create_path_template,
      'status_path_template', v_int.status_path_template,
      'health_path_template', v_int.health_path_template,
      'allowed_hosts', to_jsonb(v_int.allowed_hosts)
    ) end,
    'credential', case when v_cred.id is null then null else jsonb_build_object(
      'id', v_cred.id,
      'code', v_cred.code,
      'type', v_cred.type::text,
      'enabled', v_cred.enabled,
      'algorithm', v_cred.algorithm::text,
      'token_ttl_seconds', v_cred.token_ttl_seconds,
      -- NOMBRE del secreto. El valor lo resuelve la Edge Function contra su
      -- propio almacén; esta base no lo conoce ni puede conocerlo.
      'secret_ref', v_cred.secret_ref,
      'public_key_ref', v_cred.public_key_ref
    ) end,
    -- ---- Payload ESTÁNDAR del contrato de provisioning --------------------
    -- Es el mismo para todos los productos. Un SaaS que necesite más datos los
    -- pide al contrato, no a MasterAdmin conociendo sus tablas.
    'payload', jsonb_build_object(
      'tenantCode', v_tenant.slug,
      'tenantName', v_tenant.name,
      'adminEmail', v_tenant.admin_email,
      'tenantType', v_tenant.tenant_type::text,
      'environment', v_req.provisioning_environment::text,
      'deploymentMode', v_tenant.deployment_mode::text,
      'organization', jsonb_build_object(
        'code', v_org.slug, 'legalName', v_org.legal_name,
        'displayName', v_org.display_name, 'countryCode', v_org.country_code,
        'taxId', v_org.tax_id),
      'company', case when v_comp.id is null then null else jsonb_build_object(
        'code', v_comp.erp_code, 'name', v_comp.name,
        'countryCode', v_comp.country_code, 'currency', v_comp.currency,
        'taxId', v_comp.tax_id) end,
      'plan', case when v_plan.code is null then null else jsonb_build_object(
        'code', v_plan.code, 'name', v_plan.name) end,
      'masterAdmin', jsonb_build_object(
        'tenantId', v_tenant.id, 'productCode', v_prod.code,
        'requestId', v_req.id, 'correlationId', v_req.correlation_id,
        'contractVersion', coalesce(v_int.contract_version, 'v1'))
    )
    -- 20261024000100 · Periodo de prueba: aditivo y solo para tenants TRIAL con
    -- vencimiento. Un tenant PRODUCTION recibe exactamente el payload de antes.
    || case when v_tenant.tenant_type = 'TRIAL' and v_tenant.trial_ends_at is not null then
         jsonb_build_object('trial', jsonb_build_object(
           'days', v_tenant.trial_days,
           'endsAt', platform.trial_iso_utc(v_tenant.trial_ends_at)))
       else '{}'::jsonb end
    ,
    -- ---- Identidades de MasterAdmin para los codecs de contrato -----------
    -- Claves HERMANAS de `payload`; la expresión de `payload` no se toca.
    -- Nada aquí es específico de un producto.
    'source', jsonb_build_object(
      'tenant', jsonb_build_object('id', v_tenant.id, 'slug', v_tenant.slug, 'name', v_tenant.name,
                                   'admin_email', v_tenant.admin_email,
                                   'deployment_mode', v_tenant.deployment_mode::text),
      'organization', jsonb_build_object('id', v_org.id, 'slug', v_org.slug,
                                   'legal_name', v_org.legal_name, 'display_name', v_org.display_name,
                                   'country_code', v_org.country_code, 'tax_id', v_org.tax_id),
      'company', case when v_comp.id is null then null else jsonb_build_object(
                                   'id', v_comp.id, 'name', v_comp.name, 'erp_code', v_comp.erp_code,
                                   'country_code', v_comp.country_code, 'currency', v_comp.currency,
                                   'tax_id', v_comp.tax_id) end,
      'mapping', case when v_map.id is null then null else jsonb_build_object(
                                   'external_tenant_id', v_map.external_tenant_id,
                                   'external_organization_id', v_map.external_organization_id,
                                   'external_company_id', v_map.external_company_id) end,
      'product_configuration', v_req.product_configuration),
    'adapter', jsonb_build_object(
      'key', coalesce(v_int.adapter_key, 'GENERIC')::text,
      'capabilities', to_jsonb(platform.integration_capabilities(
                        coalesce(v_int.adapter_key, 'GENERIC'),
                        v_int.status_path_template, v_int.read_scope)))
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 9. v_tenant_overview: columnas de prueba AL FINAL (copia literal de
--    20260913000800 §1 + cuatro columnas). SECURITY INVOKER, grants intactos.
-- ---------------------------------------------------------------------------
create or replace view platform.v_tenant_overview
with (security_invoker = true) as
select
  t.id                    as tenant_id,
  t.slug,
  t.name,
  t.tenant_type,
  t.status,
  t.deployment_mode,
  t.environment,
  t.admin_email,
  t.admin_activated_at,
  t.created_at,
  t.activated_at,
  sp.id                   as saas_product_id,
  sp.code                 as product_code,
  sp.short_name           as product_short_name,
  sp.lockup_name          as product_lockup,
  co.id                   as customer_organization_id,
  co.display_name         as customer_name,
  mo.id                   as managing_organization_id,
  mo.display_name         as managing_name,
  dt.id                   as deployment_target_id,
  dt.code                 as deployment_target_code,
  dt.provider             as deployment_provider,
  dt.region               as deployment_region,
  coalesce(mrr.mrr, 0)    as mrr,
  coalesce(mrr.currency, sub.currency, anysub.currency)::bpchar as currency,
  sub.id                  as subscription_id,
  pl.name                 as plan_name,
  coalesce(mk.code, anymk.code) as market_code,
  -- 20261024000100 · periodo de prueba (al final, sin mover columnas)
  t.trial_days,
  t.trial_ends_at,
  t.trial_converted_at,
  sp.trial_days           as product_trial_days
from platform.tenants t
join platform.saas_products sp on sp.id = t.saas_product_id
join platform.organizations co on co.id = t.customer_organization_id
left join platform.organizations mo on mo.id = t.managing_organization_id
left join platform.tenant_deployments td
  on td.tenant_id = t.id and td.is_primary and td.status = 'ACTIVE'
left join platform.deployment_targets dt on dt.id = td.deployment_target_id
left join lateral (
  select v.mrr, v.currency from platform.v_subscription_mrr v where v.tenant_id = t.id limit 1
) mrr on true
left join lateral (
  select s.id, s.plan_id, s.currency, s.market_id from platform.subscriptions s
   where s.tenant_id = t.id and s.status = 'ACTIVE' limit 1
) sub on true
left join lateral (
  select s.currency, s.market_id from platform.subscriptions s
   where s.tenant_id = t.id order by s.started_on desc limit 1
) anysub on true
left join platform.plans pl on pl.id = sub.plan_id
left join platform.markets mk on mk.id = sub.market_id
left join platform.markets anymk on anymk.id = anysub.market_id;
