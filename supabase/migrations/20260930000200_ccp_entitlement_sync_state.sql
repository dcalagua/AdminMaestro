-- ============================================================================
-- EBIM Commercial Control Plane · Fase 08 · estado deseado/aplicado (MA-33)
-- ----------------------------------------------------------------------------
-- Spec §9 (entitlement_sync_state, 13 estados, jobs push / verify /
-- registry-verify), §18 (modos de falla). Plan §4 fila 14, §10.1 MA-33.
-- Test: supabase/tests/36_ccp_entitlement_sync_state.test.sql.
-- Espejo TS: supabase/functions/_shared/entitlements/states.ts; tabla común de
-- casos: supabase/functions/_shared/entitlements/sync-state-cases.json.
--
-- Principios:
--   · Solo el GET aplicado produce IN_SYNC. La respuesta del PUT deja
--     AWAITING_VERIFY y NO toca applied_* (spec §8.3, §19).
--   · Los workers trabajan con lease (claim … FOR UPDATE SKIP LOCKED). Un
--     resultado sin el lease vigente se rechaza (LEASE_PERDIDO, 55000); un
--     lease vencido se puede retomar y cuenta como fallo.
--   · DRIFT_AHEAD, DRIFT_CHECKSUM y REJECTED no se empujan solos: son
--     incidentes para un humano (spec §9, §18).
--   · Nunca se escribe en la base del SaaS: estas funciones solo registran lo
--     que el job observó por HTTP.
--   · Enrolamiento y kill-switch: entitlements_enrollment() y
--     entitlements_push_enabled() se definen aquí con la regla mínima (cohorte
--     por tenant, LEGACY_ONLY por defecto) y la migración …0300 las redefine
--     con el eje por integración y el kill-switch.
--
-- Rollback: docs/runbooks/ccp-rollback/08.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------------
create table platform.entitlement_sync_state (
  tenant_id             uuid not null references platform.tenants (id) on delete cascade,
  saas_product_id       uuid not null references platform.saas_products (id) on delete restrict,
  desired_version       bigint,
  desired_checksum      text,
  pushing_version       bigint,
  last_pushed_version   bigint,
  last_push_at          timestamptz,
  last_push_result      text,
  applied_version       bigint,
  applied_checksum      text,
  applied_status        text not null default 'NONE',
  unknown_capabilities  text[] not null default '{}'::text[],
  last_verified_at      timestamptz,
  state                 text not null default 'NOT_PROVISIONED',
  state_reason          text,
  state_changed_at      timestamptz not null default now(),
  consecutive_failures  integer not null default 0,
  next_attempt_at       timestamptz not null default now(),
  lease_owner           text,
  lease_until           timestamptz,
  cohort_state          text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  primary key (tenant_id, saas_product_id),
  constraint entitlement_sync_state_state_ck check (state in (
    'NOT_PROVISIONED', 'NOT_ENROLLED', 'PENDING_PUSH', 'PUSHING', 'AWAITING_VERIFY', 'IN_SYNC',
    'IN_SYNC_WITH_WARNINGS', 'DRIFT_BEHIND', 'DRIFT_CHECKSUM', 'DRIFT_AHEAD', 'REJECTED', 'UNREACHABLE',
    'REGISTRY_DRIFT')),
  constraint entitlement_sync_state_applied_status_ck
    check (applied_status in ('NONE', 'APPLIED', 'APPLIED_WITH_WARNINGS')),
  constraint entitlement_sync_state_failures_ck check (consecutive_failures >= 0),
  constraint entitlement_sync_state_lease_ck check ((lease_owner is null) = (lease_until is null)),
  constraint entitlement_sync_state_pushing_ck check ((state = 'PUSHING') = (pushing_version is not null)),
  constraint entitlement_sync_state_cohort_ck check (cohort_state is null or cohort_state in (
    'LEGACY_ONLY', 'SHADOW', 'DUAL_READ', 'MASTERADMIN_PRIMARY', 'LEGACY_RETIRED')),
  constraint entitlement_sync_state_checksums_ck check (
    (desired_checksum is null or desired_checksum ~ '^sha256:[0-9a-f]{64}$')
    and (applied_checksum is null or length(applied_checksum) <= 80))
);

create index entitlement_sync_state_product_state_ix on platform.entitlement_sync_state (saas_product_id, state);
create index entitlement_sync_state_due_ix on platform.entitlement_sync_state (next_attempt_at)
  where state in ('PENDING_PUSH', 'DRIFT_BEHIND', 'UNREACHABLE', 'PUSHING');
create trigger entitlement_sync_state_set_updated_at before update on platform.entitlement_sync_state
  for each row execute function platform.set_updated_at();

comment on table platform.entitlement_sync_state is
  'Deseado frente a aplicado por tenant×producto (spec §9). Solo el GET del SaaS produce IN_SYNC.';
comment on column platform.entitlement_sync_state.cohort_state is
  'Eje de entitlements por tenant (spec §15, cohorte). NULL = el del producto/integración.';

create table platform.entitlement_sync_attempts (
  id              bigint generated always as identity primary key,
  tenant_id       uuid not null references platform.tenants (id) on delete cascade,
  saas_product_id uuid not null references platform.saas_products (id) on delete restrict,
  operation       text not null,
  snapshot_version bigint,
  outcome         text not null,
  http_status     integer,
  error_code      text,
  state_before    text,
  state_after     text,
  worker          text,
  detail          jsonb not null default '{}'::jsonb,
  occurred_at     timestamptz not null default now(),
  constraint entitlement_sync_attempts_operation_ck check (operation in ('PUSH', 'VERIFY', 'LEASE')),
  constraint entitlement_sync_attempts_error_code_ck check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{1,63}$')
);

create index entitlement_sync_attempts_tenant_ix
  on platform.entitlement_sync_attempts (tenant_id, saas_product_id, occurred_at desc);
create index entitlement_sync_attempts_product_ix on platform.entitlement_sync_attempts (saas_product_id);

comment on table platform.entitlement_sync_attempts is
  'Bitácora append-only de push/GET/lease. Solo códigos, estados HTTP y versiones: nunca cuerpos, tokens ni claves.';

create table platform.entitlement_registry_checks (
  id                  bigint generated always as identity primary key,
  saas_product_id     uuid not null references platform.saas_products (id) on delete restrict,
  manifest_version    text,
  checked_at          timestamptz not null default now(),
  drift               boolean not null,
  missing_in_manifest text[] not null default '{}'::text[],
  missing_in_registry text[] not null default '{}'::text[]
);

create index entitlement_registry_checks_product_ix
  on platform.entitlement_registry_checks (saas_product_id, checked_at desc, id desc);

comment on table platform.entitlement_registry_checks is
  'registry-verify (spec §9): manifiesto del SaaS frente a product_capabilities ACTIVE, en las dos direcciones.';

-- Append-only para la bitácora y los checks (incluso para postgres).
create or replace function platform.entitlement_log_append_only()
returns trigger
language plpgsql
set search_path = platform, pg_catalog
as $$
begin
  raise exception 'BITACORA_INMUTABLE: % es append-only (%)', tg_table_name, tg_op using errcode = '55000';
end;
$$;

revoke all on function platform.entitlement_log_append_only() from public, anon, authenticated;

create trigger entitlement_sync_attempts_append_only
  before update or delete on platform.entitlement_sync_attempts
  for each row execute function platform.entitlement_log_append_only();
create trigger entitlement_sync_attempts_no_truncate
  before truncate on platform.entitlement_sync_attempts
  for each statement execute function platform.entitlement_log_append_only();
create trigger entitlement_registry_checks_append_only
  before update or delete on platform.entitlement_registry_checks
  for each row execute function platform.entitlement_log_append_only();
create trigger entitlement_registry_checks_no_truncate
  before truncate on platform.entitlement_registry_checks
  for each statement execute function platform.entitlement_log_append_only();

alter table platform.entitlement_sync_state enable row level security;
alter table platform.entitlement_sync_state force row level security;
alter table platform.entitlement_sync_attempts enable row level security;
alter table platform.entitlement_sync_attempts force row level security;
alter table platform.entitlement_registry_checks enable row level security;
alter table platform.entitlement_registry_checks force row level security;

revoke all on platform.entitlement_sync_state, platform.entitlement_sync_attempts,
              platform.entitlement_registry_checks from public, anon, authenticated;
grant select on platform.entitlement_sync_state, platform.entitlement_sync_attempts,
                platform.entitlement_registry_checks to authenticated;
grant select, insert, update on platform.entitlement_sync_state to service_role;
grant select, insert on platform.entitlement_sync_attempts, platform.entitlement_registry_checks to service_role;

create policy entitlement_sync_state_select on platform.entitlement_sync_state
  for select to authenticated using (platform.can_read_tenant(tenant_id));
create policy entitlement_sync_attempts_select on platform.entitlement_sync_attempts
  for select to authenticated using (platform.can_read_tenant(tenant_id));
-- Como product_capabilities: catálogo técnico, sin datos de tenant.
create policy entitlement_registry_checks_select on platform.entitlement_registry_checks
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 2. Funciones puras (espejo de states.ts)
-- ---------------------------------------------------------------------------
create or replace function platform.entitlement_verify_verdict(
  p_desired_version  bigint,
  p_desired_checksum text,
  p_applied_version  bigint,
  p_applied_checksum text,
  p_applied_status   text,
  p_registry_drift   boolean
)
returns text
language sql
immutable
set search_path = platform, pg_catalog
as $$
  select case
    when p_applied_status = 'NONE' or p_applied_version is null
         or p_applied_version < coalesce(p_desired_version, 0) then 'DRIFT_BEHIND'
    when p_applied_version > coalesce(p_desired_version, 0) then 'DRIFT_AHEAD'
    when p_applied_checksum is distinct from p_desired_checksum then 'DRIFT_CHECKSUM'
    when coalesce(p_registry_drift, false) then 'REGISTRY_DRIFT'
    when p_applied_status = 'APPLIED_WITH_WARNINGS' then 'IN_SYNC_WITH_WARNINGS'
    else 'IN_SYNC'
  end;
$$;

create or replace function platform.entitlement_push_transition(p_result text, p_failures integer)
returns table (state text, failures integer)
language plpgsql
immutable
set search_path = platform, pg_catalog
as $$
begin
  if p_failures is null or p_failures < 0 then
    raise exception 'FALLOS_INVALIDOS: %', p_failures using errcode = '22023';
  end if;
  case p_result
    when 'APPLIED', 'REPLAYED' then state := 'AWAITING_VERIFY'; failures := 0;
    when 'STALE' then state := 'DRIFT_AHEAD'; failures := p_failures;
    when 'CONFLICT' then state := 'DRIFT_CHECKSUM'; failures := p_failures;
    when 'REJECTED', 'INVALID_SNAPSHOT' then state := 'REJECTED'; failures := p_failures;
    when 'RETRYABLE' then
      failures := p_failures + 1;
      state := case when p_failures + 1 >= 5 then 'UNREACHABLE' else 'PENDING_PUSH' end;
    else
      raise exception 'RESULTADO_PUSH_DESCONOCIDO: %', p_result using errcode = '22023';
  end case;
  return next;
end;
$$;

create or replace function platform.entitlement_verify_failure_transition(
  p_state    text,
  p_result   text,
  p_failures integer
)
returns table (state text, failures integer)
language plpgsql
immutable
set search_path = platform, pg_catalog
as $$
begin
  if p_failures is null or p_failures < 0 then
    raise exception 'FALLOS_INVALIDOS: %', p_failures using errcode = '22023';
  end if;
  if p_result = 'REJECTED' then
    state := 'REJECTED'; failures := p_failures;
  elsif p_result = 'RETRYABLE' then
    failures := p_failures + 1;
    state := case when p_failures + 1 >= 5 then 'UNREACHABLE' else p_state end;
  else
    raise exception 'RESULTADO_VERIFY_DESCONOCIDO: %', p_result using errcode = '22023';
  end if;
  return next;
end;
$$;

create or replace function platform.entitlement_is_pushable(p_state text, p_failures integer)
returns boolean
language sql
immutable
set search_path = platform, pg_catalog
as $$
  select case
    when p_state in ('PENDING_PUSH', 'UNREACHABLE') then true
    when p_state = 'DRIFT_BEHIND' then coalesce(p_failures, 0) < 5
    else false
  end;
$$;

create or replace function platform.entitlement_retry_delay(p_failures integer)
returns interval
language sql
immutable
set search_path = platform, pg_catalog
as $$
  select make_interval(secs => least(60 * power(2, greatest(0, least(coalesce(p_failures, 0), 20) - 1)), 3600));
$$;

revoke all on function platform.entitlement_verify_verdict(bigint, text, bigint, text, text, boolean) from public, anon;
revoke all on function platform.entitlement_push_transition(text, integer) from public, anon;
revoke all on function platform.entitlement_verify_failure_transition(text, text, integer) from public, anon;
revoke all on function platform.entitlement_is_pushable(text, integer) from public, anon;
revoke all on function platform.entitlement_retry_delay(integer) from public, anon;
grant execute on function platform.entitlement_verify_verdict(bigint, text, bigint, text, text, boolean) to authenticated, service_role;
grant execute on function platform.entitlement_push_transition(text, integer) to authenticated, service_role;
grant execute on function platform.entitlement_verify_failure_transition(text, text, integer) to authenticated, service_role;
grant execute on function platform.entitlement_is_pushable(text, integer) to authenticated, service_role;
grant execute on function platform.entitlement_retry_delay(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Enrolamiento, kill-switch y drift de registro (internas)
-- ---------------------------------------------------------------------------
-- Versión mínima; …0300 las redefine con product_integrations.
create or replace function platform.entitlements_enrollment(p_tenant_id uuid, p_product_id uuid)
returns text
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select coalesce((select s.cohort_state from platform.entitlement_sync_state s
                    where s.tenant_id = p_tenant_id and s.saas_product_id = p_product_id), 'LEGACY_ONLY');
$$;

create or replace function platform.entitlements_push_enabled(p_tenant_id uuid, p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select p_tenant_id is not null and p_product_id is not null;
$$;

create or replace function platform.entitlement_registry_drift(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select coalesce((select c.drift from platform.entitlement_registry_checks c
                    where c.saas_product_id = p_product_id
                    order by c.checked_at desc, c.id desc limit 1), false);
$$;

-- NOT_PROVISIONED / NOT_ENROLLED, o NULL si el tenant se puede sincronizar.
create or replace function platform.entitlement_gate_state(p_tenant_id uuid, p_product_id uuid)
returns text
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select case
    when not exists (select 1 from platform.tenant_product_mappings m
                      where m.tenant_id = p_tenant_id and m.saas_product_id = p_product_id and m.status = 'ACTIVE')
      then 'NOT_PROVISIONED'
    when platform.entitlements_enrollment(p_tenant_id, p_product_id) = 'LEGACY_ONLY' then 'NOT_ENROLLED'
    else null
  end;
$$;

revoke all on function platform.entitlements_enrollment(uuid, uuid) from public, anon, authenticated;
revoke all on function platform.entitlements_push_enabled(uuid, uuid) from public, anon, authenticated;
revoke all on function platform.entitlement_registry_drift(uuid) from public, anon, authenticated;
revoke all on function platform.entitlement_gate_state(uuid, uuid) from public, anon, authenticated;
grant execute on function platform.entitlements_enrollment(uuid, uuid) to service_role;
grant execute on function platform.entitlements_push_enabled(uuid, uuid) to service_role;
grant execute on function platform.entitlement_registry_drift(uuid) to service_role;
grant execute on function platform.entitlement_gate_state(uuid, uuid) to service_role;

-- Bitácora. `p_detail` solo con claves conocidas: se filtra aquí, no en el llamante.
create or replace function platform.log_entitlement_sync_attempt(
  p_tenant_id uuid, p_product_id uuid, p_operation text, p_version bigint, p_outcome text,
  p_state_before text, p_state_after text, p_worker text, p_detail jsonb
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_code text := p_detail ->> 'errorCode';
begin
  insert into platform.entitlement_sync_attempts
    (tenant_id, saas_product_id, operation, snapshot_version, outcome, http_status, error_code,
     state_before, state_after, worker, detail)
  values
    (p_tenant_id, p_product_id, p_operation, p_version, p_outcome,
     case when jsonb_typeof(p_detail -> 'httpStatus') = 'number' then (p_detail ->> 'httpStatus')::integer end,
     case when v_code ~ '^[A-Z][A-Z0-9_]{1,63}$' then v_code end,
     p_state_before, p_state_after, left(p_worker, 64),
     jsonb_strip_nulls(jsonb_build_object(
       'appliedVersion', case when jsonb_typeof(p_detail -> 'appliedVersion') = 'number' then p_detail -> 'appliedVersion' end,
       'appliedChecksum', case when p_detail ->> 'appliedChecksum' ~ '^sha256:[0-9a-f]{64}$' then p_detail -> 'appliedChecksum' end,
       'status', case when p_detail ->> 'status' in ('NONE', 'APPLIED', 'APPLIED_WITH_WARNINGS') then p_detail -> 'status' end,
       'unknownCapabilities', case when jsonb_typeof(p_detail -> 'unknownCapabilities') = 'array'
                                   then (select jsonb_agg(x) from (
                                           select x from jsonb_array_elements_text(p_detail -> 'unknownCapabilities') x
                                            where x ~ '^[a-z0-9]+(\.[a-z0-9_]+)+$' limit 50) q) end)));
end;
$$;

revoke all on function platform.log_entitlement_sync_attempt(uuid, uuid, text, bigint, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function platform.log_entitlement_sync_attempt(uuid, uuid, text, bigint, text, text, text, text, jsonb)
  to service_role;

create or replace function platform.assert_entitlement_sync_service()
returns void
language plpgsql
stable
set search_path = platform, pg_catalog
as $$
begin
  if not platform.is_service_request() then
    raise exception 'SOLO_SERVIDOR: el estado de sincronización lo mueve el job de entitlements'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function platform.assert_entitlement_sync_service() from public, anon, authenticated;
grant execute on function platform.assert_entitlement_sync_service() to service_role;

-- ---------------------------------------------------------------------------
-- 4. Refresco de puertas y alta de versión deseada
-- ---------------------------------------------------------------------------
create or replace function platform.refresh_entitlement_sync_state(p_tenant_id uuid, p_product_id uuid)
returns text
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_row  platform.entitlement_sync_state;
  v_gate text;
begin
  perform platform.assert_entitlement_sync_service();

  insert into platform.entitlement_sync_state (tenant_id, saas_product_id)
  values (p_tenant_id, p_product_id)
  on conflict (tenant_id, saas_product_id) do nothing;
  select * into v_row from platform.entitlement_sync_state
   where tenant_id = p_tenant_id and saas_product_id = p_product_id for update;

  if v_row.state = 'PUSHING' and v_row.lease_until > now() then
    return v_row.state;
  end if;

  v_gate := platform.entitlement_gate_state(p_tenant_id, p_product_id);
  if v_gate is not null then
    update platform.entitlement_sync_state
       set state = v_gate, state_reason = v_gate, state_changed_at = now(),
           lease_owner = null, lease_until = null, pushing_version = null
     where tenant_id = p_tenant_id and saas_product_id = p_product_id and state is distinct from v_gate;
    return v_gate;
  end if;

  if v_row.state in ('NOT_PROVISIONED', 'NOT_ENROLLED', 'PUSHING') then
    update platform.entitlement_sync_state
       set state = 'PENDING_PUSH', state_reason = 'ENROLADO', state_changed_at = now(),
           next_attempt_at = now(), lease_owner = null, lease_until = null, pushing_version = null
     where tenant_id = p_tenant_id and saas_product_id = p_product_id;
    return 'PENDING_PUSH';
  end if;
  return v_row.state;
end;
$$;

comment on function platform.refresh_entitlement_sync_state(uuid, uuid) is
  'Reevalúa las puertas NOT_PROVISIONED / NOT_ENROLLED de un tenant×producto. Solo service_role.';

-- Cada versión nueva emitida actualiza lo deseado y, si procede, pide push.
create or replace function platform.on_entitlement_snapshot_issued()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_row  platform.entitlement_sync_state;
  v_gate text;
begin
  insert into platform.entitlement_sync_state (tenant_id, saas_product_id)
  values (new.tenant_id, new.saas_product_id)
  on conflict (tenant_id, saas_product_id) do nothing;
  select * into v_row from platform.entitlement_sync_state
   where tenant_id = new.tenant_id and saas_product_id = new.saas_product_id for update;

  update platform.entitlement_sync_state
     set desired_version = new.snapshot_version, desired_checksum = new.checksum
   where tenant_id = new.tenant_id and saas_product_id = new.saas_product_id;

  v_gate := platform.entitlement_gate_state(new.tenant_id, new.saas_product_id);
  if v_gate is not null then
    update platform.entitlement_sync_state
       set state = v_gate, state_reason = v_gate,
           state_changed_at = case when state = v_gate then state_changed_at else now() end
     where tenant_id = new.tenant_id and saas_product_id = new.saas_product_id and state <> 'PUSHING';
  elsif v_row.state = 'DRIFT_AHEAD' and coalesce(v_row.applied_version, 0) >= new.snapshot_version then
    null; -- el SaaS sigue por delante: incidente abierto, sin push automático
  elsif v_row.state <> 'PUSHING' then
    update platform.entitlement_sync_state
       set state = 'PENDING_PUSH', state_reason = 'NUEVA_VERSION_DESEADA', state_changed_at = now(),
           consecutive_failures = 0, next_attempt_at = now()
     where tenant_id = new.tenant_id and saas_product_id = new.saas_product_id;
  end if;
  return new;
end;
$$;

revoke all on function platform.on_entitlement_snapshot_issued() from public, anon, authenticated;

create trigger entitlement_snapshots_to_sync_state
  after insert on platform.entitlement_snapshots
  for each row execute function platform.on_entitlement_snapshot_issued();

-- ---------------------------------------------------------------------------
-- 5. Push: claim con lease y registro del resultado
-- ---------------------------------------------------------------------------
create or replace function platform.claim_entitlement_pushes(
  p_worker        text,
  p_limit         integer default 20,
  p_lease_seconds integer default 120
)
returns table (
  tenant_id        uuid,
  saas_product_id  uuid,
  snapshot_version bigint,
  checksum         text,
  document         jsonb,
  attempt          integer
)
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  r record;
begin
  perform platform.assert_entitlement_sync_service();
  if coalesce(trim(p_worker), '') = '' or p_limit not between 1 and 100 or p_lease_seconds not between 10 and 900 then
    raise exception 'PARAMETROS_INVALIDOS: worker, límite 1..100 y lease 10..900 s' using errcode = '22023';
  end if;

  for r in
    select s.tenant_id, s.saas_product_id, s.state, s.desired_version, s.consecutive_failures
      from platform.entitlement_sync_state s
     where s.desired_version is not null
       and ((s.state = 'PUSHING' and s.lease_until < now())
            or (platform.entitlement_is_pushable(s.state, s.consecutive_failures) and s.next_attempt_at <= now()))
       and platform.entitlement_gate_state(s.tenant_id, s.saas_product_id) is null
       and platform.entitlements_push_enabled(s.tenant_id, s.saas_product_id)
     order by s.next_attempt_at, s.tenant_id
     limit p_limit
       for update of s skip locked
  loop
    if r.state = 'PUSHING' then
      perform platform.log_entitlement_sync_attempt(r.tenant_id, r.saas_product_id, 'LEASE', r.desired_version,
        'LEASE_EXPIRED', 'PUSHING', 'PUSHING', p_worker, '{}'::jsonb);
    end if;

    update platform.entitlement_sync_state s
       set state = 'PUSHING', pushing_version = s.desired_version,
           lease_owner = p_worker, lease_until = now() + make_interval(secs => p_lease_seconds),
           consecutive_failures = s.consecutive_failures + case when r.state = 'PUSHING' then 1 else 0 end,
           state_changed_at = case when r.state = 'PUSHING' then s.state_changed_at else now() end
     where s.tenant_id = r.tenant_id and s.saas_product_id = r.saas_product_id;

    return query
      select es.tenant_id, es.saas_product_id, es.snapshot_version, es.checksum, es.document,
             (select s.consecutive_failures + 1 from platform.entitlement_sync_state s
               where s.tenant_id = r.tenant_id and s.saas_product_id = r.saas_product_id)
        from platform.entitlement_snapshots es
       where es.tenant_id = r.tenant_id and es.saas_product_id = r.saas_product_id
         and es.snapshot_version = r.desired_version;
  end loop;
end;
$$;

comment on function platform.claim_entitlement_pushes(text, integer, integer) is
  'entitlement-push (spec §9): toma PENDING_PUSH/DRIFT_BEHIND/UNREACHABLE vencidos y PUSHING con '
  'lease vencido, FOR UPDATE SKIP LOCKED, y devuelve el snapshot deseado. Solo service_role.';

create or replace function platform.record_entitlement_push_result(
  p_tenant_id  uuid,
  p_product_id uuid,
  p_worker     text,
  p_version    bigint,
  p_outcome    jsonb
)
returns text
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_row    platform.entitlement_sync_state;
  v_result text := p_outcome ->> 'result';
  v_next   record;
begin
  perform platform.assert_entitlement_sync_service();
  select * into v_row from platform.entitlement_sync_state
   where tenant_id = p_tenant_id and saas_product_id = p_product_id for update;
  if v_row.tenant_id is null or v_row.state <> 'PUSHING' or v_row.lease_owner is distinct from p_worker
     or v_row.pushing_version is distinct from p_version then
    raise exception 'LEASE_PERDIDO: el worker % no tiene el push de la versión % de este tenant', p_worker, p_version
      using errcode = '55000';
  end if;

  select * into v_next from platform.entitlement_push_transition(v_result, v_row.consecutive_failures);

  update platform.entitlement_sync_state
     set state = v_next.state,
         state_reason = coalesce(case when p_outcome ->> 'errorCode' ~ '^[A-Z][A-Z0-9_]{1,63}$'
                                      then p_outcome ->> 'errorCode' end, v_result),
         state_changed_at = now(),
         consecutive_failures = v_next.failures,
         next_attempt_at = case v_next.state
                             when 'PENDING_PUSH' then now() + platform.entitlement_retry_delay(v_next.failures)
                             when 'UNREACHABLE' then now() + interval '1 hour'
                             else now() end,
         lease_owner = null, lease_until = null, pushing_version = null,
         last_push_at = now(), last_push_result = v_result,
         last_pushed_version = case when v_result in ('APPLIED', 'REPLAYED') then p_version else last_pushed_version end
   where tenant_id = p_tenant_id and saas_product_id = p_product_id;

  perform platform.log_entitlement_sync_attempt(p_tenant_id, p_product_id, 'PUSH', p_version, v_result,
    'PUSHING', v_next.state, p_worker, p_outcome);
  return v_next.state;
end;
$$;

comment on function platform.record_entitlement_push_result(uuid, uuid, text, bigint, jsonb) is
  'Registra el resultado clasificado de un PUT. Nunca produce IN_SYNC ni toca applied_*. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 6. Verify: el GET decide
-- ---------------------------------------------------------------------------
create or replace function platform.claim_entitlement_verifications(
  p_worker         text,
  p_limit          integer default 20,
  p_lease_seconds  integer default 60,
  p_resample_after interval default interval '6 hours'
)
returns table (
  tenant_id        uuid,
  saas_product_id  uuid,
  state            text,
  desired_version  bigint,
  desired_checksum text
)
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  r record;
begin
  perform platform.assert_entitlement_sync_service();
  if coalesce(trim(p_worker), '') = '' or p_limit not between 1 and 100 or p_lease_seconds not between 10 and 900
     or p_resample_after is null or p_resample_after < interval '0' then
    raise exception 'PARAMETROS_INVALIDOS' using errcode = '22023';
  end if;

  for r in
    select s.tenant_id, s.saas_product_id
      from platform.entitlement_sync_state s
     where (s.lease_until is null or s.lease_until < now())
       and (s.state = 'AWAITING_VERIFY'
            or (s.state in ('IN_SYNC', 'IN_SYNC_WITH_WARNINGS', 'REGISTRY_DRIFT', 'DRIFT_AHEAD', 'DRIFT_CHECKSUM')
                and coalesce(s.last_verified_at, '-infinity'::timestamptz) <= now() - p_resample_after))
       and platform.entitlement_gate_state(s.tenant_id, s.saas_product_id) is null
     order by (s.state = 'AWAITING_VERIFY') desc, s.last_verified_at nulls first, s.tenant_id
     limit p_limit
       for update of s skip locked
  loop
    update platform.entitlement_sync_state s
       set lease_owner = p_worker, lease_until = now() + make_interval(secs => p_lease_seconds)
     where s.tenant_id = r.tenant_id and s.saas_product_id = r.saas_product_id;
    return query
      select s.tenant_id, s.saas_product_id, s.state, s.desired_version, s.desired_checksum
        from platform.entitlement_sync_state s
       where s.tenant_id = r.tenant_id and s.saas_product_id = r.saas_product_id;
  end loop;
end;
$$;

comment on function platform.claim_entitlement_verifications(text, integer, integer, interval) is
  'entitlement-verify (spec §9): AWAITING_VERIFY y una muestra periódica de estados verificados. Solo service_role.';

create or replace function platform.record_entitlement_verify_result(
  p_tenant_id  uuid,
  p_product_id uuid,
  p_worker     text,
  p_observed   jsonb
)
returns text
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_row      platform.entitlement_sync_state;
  v_result   text := p_observed ->> 'result';
  v_state    text;
  v_failures integer;
  v_version  bigint;
  v_status   text;
  v_unknown  text[];
  v_next     record;
begin
  perform platform.assert_entitlement_sync_service();
  select * into v_row from platform.entitlement_sync_state
   where tenant_id = p_tenant_id and saas_product_id = p_product_id for update;
  if v_row.tenant_id is null or v_row.state = 'PUSHING' or v_row.lease_owner is distinct from p_worker then
    raise exception 'LEASE_PERDIDO: el worker % no tiene la verificación de este tenant', p_worker using errcode = '55000';
  end if;

  if v_result = 'OBSERVED' then
    v_status := coalesce(p_observed ->> 'status', 'NONE');
    if v_status not in ('NONE', 'APPLIED', 'APPLIED_WITH_WARNINGS') then
      raise exception 'OBSERVACION_INVALIDA: status %', v_status using errcode = '22023';
    end if;
    v_version := case when jsonb_typeof(p_observed -> 'appliedVersion') = 'number'
                      then (p_observed ->> 'appliedVersion')::bigint end;
    v_unknown := coalesce((select array_agg(x order by x collate "C")
                             from jsonb_array_elements_text(case when jsonb_typeof(p_observed -> 'unknownCapabilities') = 'array'
                                                                 then p_observed -> 'unknownCapabilities' else '[]'::jsonb end) x
                            where x ~ '^[a-z0-9]+(\.[a-z0-9_]+)+$'), '{}'::text[]);
    v_state := platform.entitlement_verify_verdict(v_row.desired_version, v_row.desired_checksum, v_version,
                 left(p_observed ->> 'appliedChecksum', 80), v_status, platform.entitlement_registry_drift(p_product_id));
    v_failures := case when v_state = 'DRIFT_BEHIND' then v_row.consecutive_failures + 1 else 0 end;

    update platform.entitlement_sync_state
       set state = v_state, state_reason = v_state,
           state_changed_at = case when state = v_state then state_changed_at else now() end,
           applied_version = v_version, applied_checksum = left(p_observed ->> 'appliedChecksum', 80),
           applied_status = v_status, unknown_capabilities = v_unknown, last_verified_at = now(),
           consecutive_failures = v_failures, next_attempt_at = now(),
           lease_owner = null, lease_until = null
     where tenant_id = p_tenant_id and saas_product_id = p_product_id;
  elsif v_result in ('RETRYABLE', 'REJECTED') then
    select * into v_next from platform.entitlement_verify_failure_transition(v_row.state, v_result, v_row.consecutive_failures);
    v_state := v_next.state;
    update platform.entitlement_sync_state
       set state = v_state,
           state_reason = coalesce(case when p_observed ->> 'errorCode' ~ '^[A-Z][A-Z0-9_]{1,63}$'
                                        then p_observed ->> 'errorCode' end, v_result),
           state_changed_at = case when state = v_state then state_changed_at else now() end,
           consecutive_failures = v_next.failures,
           next_attempt_at = case when v_state = 'UNREACHABLE' then now() + interval '1 hour' else next_attempt_at end,
           lease_owner = null, lease_until = null
     where tenant_id = p_tenant_id and saas_product_id = p_product_id;
  else
    raise exception 'RESULTADO_VERIFY_DESCONOCIDO: %', v_result using errcode = '22023';
  end if;

  perform platform.log_entitlement_sync_attempt(p_tenant_id, p_product_id, 'VERIFY', v_row.desired_version, v_result,
    v_row.state, v_state, p_worker, p_observed);
  return v_state;
end;
$$;

comment on function platform.record_entitlement_verify_result(uuid, uuid, text, jsonb) is
  'Registra lo que devolvió el GET aplicado: única vía hacia IN_SYNC (spec §8.3, §19). Solo service_role.';

-- ---------------------------------------------------------------------------
-- 7. registry-verify
-- ---------------------------------------------------------------------------
create or replace function platform.record_entitlement_registry_check(
  p_product_id       uuid,
  p_manifest_version text,
  p_codes            text[]
)
returns boolean
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_missing_manifest text[];
  v_missing_registry text[];
  v_drift            boolean;
begin
  perform platform.assert_entitlement_sync_service();
  if p_codes is null then
    raise exception 'MANIFIESTO_INVALIDO: sin lista de códigos' using errcode = '22023';
  end if;

  select coalesce(array_agg(c.code order by c.code collate "C"), '{}'::text[]) into v_missing_manifest
    from platform.product_capabilities c
   where c.saas_product_id = p_product_id and c.status = 'ACTIVE' and not (c.code = any (p_codes));
  select coalesce(array_agg(q.x order by q.x collate "C"), '{}'::text[]) into v_missing_registry
    from (select distinct x from unnest(p_codes) x
           where not exists (select 1 from platform.product_capabilities c
                              where c.saas_product_id = p_product_id and c.status = 'ACTIVE' and c.code = x)) q;
  v_drift := cardinality(v_missing_manifest) > 0 or cardinality(v_missing_registry) > 0;

  insert into platform.entitlement_registry_checks
    (saas_product_id, manifest_version, drift, missing_in_manifest, missing_in_registry)
  values (p_product_id, left(p_manifest_version, 64), v_drift, v_missing_manifest, v_missing_registry);

  if v_drift then
    update platform.entitlement_sync_state
       set state = 'REGISTRY_DRIFT', state_reason = 'REGISTRY_DRIFT', state_changed_at = now()
     where saas_product_id = p_product_id and state in ('IN_SYNC', 'IN_SYNC_WITH_WARNINGS');
  else
    update platform.entitlement_sync_state
       set state = 'AWAITING_VERIFY', state_reason = 'REGISTRY_RESUELTO', state_changed_at = now()
     where saas_product_id = p_product_id and state = 'REGISTRY_DRIFT';
  end if;
  return v_drift;
end;
$$;

comment on function platform.record_entitlement_registry_check(uuid, text, text[]) is
  'registry-verify: compara el manifiesto del SaaS con las capacidades ACTIVE del registro. Solo service_role.';

revoke all on function platform.refresh_entitlement_sync_state(uuid, uuid) from public, anon, authenticated;
revoke all on function platform.claim_entitlement_pushes(text, integer, integer) from public, anon, authenticated;
revoke all on function platform.record_entitlement_push_result(uuid, uuid, text, bigint, jsonb) from public, anon, authenticated;
revoke all on function platform.claim_entitlement_verifications(text, integer, integer, interval) from public, anon, authenticated;
revoke all on function platform.record_entitlement_verify_result(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function platform.record_entitlement_registry_check(uuid, text, text[]) from public, anon, authenticated;
grant execute on function platform.refresh_entitlement_sync_state(uuid, uuid) to service_role;
grant execute on function platform.claim_entitlement_pushes(text, integer, integer) to service_role;
grant execute on function platform.record_entitlement_push_result(uuid, uuid, text, bigint, jsonb) to service_role;
grant execute on function platform.claim_entitlement_verifications(text, integer, integer, interval) to service_role;
grant execute on function platform.record_entitlement_verify_result(uuid, uuid, text, jsonb) to service_role;
grant execute on function platform.record_entitlement_registry_check(uuid, text, text[]) to service_role;
