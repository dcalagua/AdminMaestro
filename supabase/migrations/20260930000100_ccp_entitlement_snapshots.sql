-- ============================================================================
-- EBIM Commercial Control Plane · Fase 08 · snapshots versionados (MA-32)
-- ----------------------------------------------------------------------------
-- Spec §7 (ebim.entitlements/v1), §14 (solo service_role emite). Plan §4 fila
-- 13, §10.1 MA-32. Test: supabase/tests/35_ccp_entitlement_snapshots.test.sql.
-- Contrato: contracts/entitlements/v1/README.md.
--
--   · jcs_canonical(jsonb): RFC 8785 para el dominio que MasterAdmin emite
--     (claves ASCII imprimibles, enteros |n| ≤ 2^53−1, decimales con ≤ 15
--     dígitos significativos y 1e-6 ≤ |x| < 1e21). Fuera de ese dominio FALLA
--     (22023) en vez de producir bytes que otro runtime serializaría distinto.
--     Los escapes de cadena de jsonb (\" \\ \b \f \n \r \t y \u00xx en
--     minúsculas; "/", DEL y no-ASCII literales) son exactamente los de JCS.
--   · entitlement_checksum(doc) = 'sha256:' || hex(sha256(JCS(doc − checksum))).
--   · entitlement_snapshots: append-only (UPDATE/DELETE/TRUNCATE → 55000
--     incluso para postgres), unique (tenant, producto, versión).
--   · issue_entitlement_snapshot(tenant, producto, effective_at): SECURITY
--     DEFINER, EXECUTE solo service_role y además is_service_request(). En una
--     transacción: advisory lock por tenant×producto, fila de
--     entitlement_desired_state FOR UPDATE (un cambio comercial concurrente
--     espera y vuelve a marcar dirty después), cálculo con compute_entitlements,
--     y versión max+1 SOLO si el contenido canónico cambió.
--
-- Rollback: docs/runbooks/ccp-rollback/08.sql (revoca EXECUTE; sin DROP de datos).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. JCS y checksum
-- ---------------------------------------------------------------------------
create or replace function platform.jcs_canonical(p_value jsonb)
returns text
language plpgsql
immutable
strict
set search_path = platform, pg_catalog
as $$
declare
  v_type   text := jsonb_typeof(p_value);
  v_num    numeric;
  v_text   text;
  v_digits text;
  v_out    text;
  v_bad    text;
begin
  if v_type = 'null' then
    return 'null';
  elsif v_type = 'boolean' then
    return p_value::text;
  elsif v_type = 'string' then
    return p_value::text;
  elsif v_type = 'number' then
    v_num := p_value::text::numeric;
    if v_num = trunc(v_num) then
      if abs(v_num) > 9007199254740991 then
        raise exception 'JCS_NUMERO_NO_SOPORTADO: entero fuera de ±(2^53−1)' using errcode = '22023';
      end if;
      return trunc(v_num)::text;
    end if;
    if abs(v_num) < 0.000001 or abs(v_num) >= 1e21 then
      raise exception 'JCS_NUMERO_NO_SOPORTADO: magnitud fuera de [1e-6, 1e21)' using errcode = '22023';
    end if;
    v_text := rtrim(v_num::text, '0');
    v_digits := ltrim(replace(replace(v_text, '-', ''), '.', ''), '0');
    if length(v_digits) > 15 then
      raise exception 'JCS_NUMERO_NO_SOPORTADO: más de 15 dígitos significativos' using errcode = '22023';
    end if;
    return v_text;
  elsif v_type = 'array' then
    select string_agg(platform.jcs_canonical(e.value), ',' order by e.ordinality)
      into v_out
      from jsonb_array_elements(p_value) with ordinality e;
    return '[' || coalesce(v_out, '') || ']';
  end if;

  -- objeto
  select k into v_bad from jsonb_object_keys(p_value) k where k !~ '^[ -~]*$' limit 1;
  if found then
    raise exception 'JCS_CLAVE_NO_SOPORTADA: solo claves ASCII imprimibles' using errcode = '22023';
  end if;
  select string_agg(to_jsonb(e.key)::text || ':' || platform.jcs_canonical(e.value), ',' order by e.key collate "C")
    into v_out
    from jsonb_each(p_value) e;
  return '{' || coalesce(v_out, '') || '}';
end;
$$;

comment on function platform.jcs_canonical(jsonb) is
  'RFC 8785 (JCS) para el dominio de ebim.entitlements/v1. Fuera de dominio → 22023. '
  'Vectores: contracts/entitlements/v1/jcs-vectors.json (sqlDomain).';

create or replace function platform.entitlement_checksum(p_document jsonb)
returns text
language sql
immutable
strict
set search_path = platform, pg_catalog
as $$
  select 'sha256:' || encode(sha256(convert_to(platform.jcs_canonical(p_document - 'checksum'), 'UTF8')), 'hex');
$$;

comment on function platform.entitlement_checksum(jsonb) is
  'Checksum de ebim.entitlements/v1: sha256 del JCS del documento sin el campo checksum.';

revoke all on function platform.jcs_canonical(jsonb) from public, anon;
revoke all on function platform.entitlement_checksum(jsonb) from public, anon;
grant execute on function platform.jcs_canonical(jsonb) to authenticated, service_role;
grant execute on function platform.entitlement_checksum(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. entitlement_snapshots (append-only)
-- ---------------------------------------------------------------------------
create table platform.entitlement_snapshots (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references platform.tenants (id) on delete restrict,
  saas_product_id  uuid not null references platform.saas_products (id) on delete restrict,
  snapshot_version bigint not null,
  previous_version bigint,
  document         jsonb not null,
  checksum         text not null,
  content_checksum text not null,
  effective_at     timestamptz not null,
  issued_at        timestamptz not null default now(),
  correlation_id   uuid not null,
  idempotency_key  text not null,
  desired_revision bigint not null default 0,
  size_bytes       integer not null,
  created_at       timestamptz not null default now(),
  constraint entitlement_snapshots_version_ck check (snapshot_version >= 1),
  constraint entitlement_snapshots_previous_ck
    check (previous_version is null or (previous_version >= 1 and previous_version < snapshot_version)),
  constraint entitlement_snapshots_checksum_ck check (checksum ~ '^sha256:[0-9a-f]{64}$'),
  constraint entitlement_snapshots_content_checksum_ck check (content_checksum ~ '^sha256:[0-9a-f]{64}$'),
  constraint entitlement_snapshots_idem_ck check (idempotency_key ~ '^ma-ent-v1-[0-9a-f]{64}$'),
  constraint entitlement_snapshots_effective_ck check (effective_at <= issued_at),
  constraint entitlement_snapshots_size_ck check (size_bytes between 1 and 65536)
);

create unique index entitlement_snapshots_version_uk
  on platform.entitlement_snapshots (tenant_id, saas_product_id, snapshot_version);
create unique index entitlement_snapshots_idem_uk on platform.entitlement_snapshots (idempotency_key);
create index entitlement_snapshots_product_ix on platform.entitlement_snapshots (saas_product_id);

comment on table platform.entitlement_snapshots is
  'Snapshots ebim.entitlements/v1 emitidos (spec §7). Inmutables y append-only: una '
  'corrección es una versión nueva. Sin precios, montos, monedas ni secretos.';
comment on column platform.entitlement_snapshots.content_checksum is
  'Checksum del contenido sin los campos que cambian en cada emisión (versión, fechas, '
  'correlación, idempotencia): decide si hace falta una versión nueva.';

create or replace function platform.entitlement_snapshots_append_only()
returns trigger
language plpgsql
set search_path = platform, pg_catalog
as $$
begin
  raise exception 'SNAPSHOT_INMUTABLE: entitlement_snapshots es append-only (%); una corrección es una versión nueva', tg_op
    using errcode = '55000';
end;
$$;

revoke all on function platform.entitlement_snapshots_append_only() from public, anon, authenticated;

create trigger entitlement_snapshots_no_update_delete
  before update or delete on platform.entitlement_snapshots
  for each row execute function platform.entitlement_snapshots_append_only();
create trigger entitlement_snapshots_no_truncate
  before truncate on platform.entitlement_snapshots
  for each statement execute function platform.entitlement_snapshots_append_only();

alter table platform.entitlement_snapshots enable row level security;
alter table platform.entitlement_snapshots force row level security;
revoke all on platform.entitlement_snapshots from public, anon, authenticated;
grant select on platform.entitlement_snapshots to authenticated;
grant select, insert on platform.entitlement_snapshots to service_role;

create policy entitlement_snapshots_select on platform.entitlement_snapshots
  for select to authenticated using (platform.can_read_tenant(tenant_id));

-- ---------------------------------------------------------------------------
-- 3. Contenido deseado (interno)
-- ---------------------------------------------------------------------------
-- Documento SIN los campos por emisión. Mismas reglas que
-- supabase/functions/_shared/entitlements/snapshot.ts (buildSnapshot).
create or replace function platform.entitlement_snapshot_content(
  p_tenant_id  uuid,
  p_product_id uuid,
  p_at         timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_tenant  record;
  v_product record;
  v_map     record;
  v_env     text;
  v_plan    text;
  v_month   date := date_trunc('month', p_at at time zone 'UTC')::date;
  v_caps    jsonb;
  v_limits  jsonb;
  v_allow   jsonb;
begin
  select * into v_tenant from platform.tenants where id = p_tenant_id;
  if v_tenant.id is null then
    raise exception 'TENANT_NO_ENCONTRADO: %', p_tenant_id using errcode = 'P0002';
  end if;
  if v_tenant.saas_product_id is distinct from p_product_id then
    raise exception 'TENANT_PRODUCTO_INCOHERENTE: el tenant % no es del producto %', p_tenant_id, p_product_id
      using errcode = '22023';
  end if;
  select * into v_product from platform.saas_products where id = p_product_id;

  select * into v_map from platform.tenant_product_mappings
   where tenant_id = p_tenant_id and saas_product_id = p_product_id and status = 'ACTIVE';
  if v_map.id is null then
    raise exception 'TENANT_NO_APROVISIONADO: sin mapping ACTIVE para el tenant % en %', p_tenant_id, v_product.code
      using errcode = 'P0002';
  end if;

  select d.provisioning_environment::text into v_env
    from platform.deployment_targets d where d.id = v_map.deployment_target_id;
  if v_env is null then
    raise exception 'AMBIENTE_NO_RESUELTO: el mapping del tenant % no tiene destino con ambiente', p_tenant_id
      using errcode = '22023';
  end if;

  select p.code into v_plan
    from platform.subscriptions s join platform.plans p on p.id = s.plan_id
   where s.saas_product_id = p_product_id
     and s.status in ('ACTIVE', 'PAST_DUE')
     and (s.tenant_id = p_tenant_id or (s.tenant_id is null and s.billed_organization_id = v_tenant.customer_organization_id))
     and s.started_on <= p_at::date
     and (s.ends_on is null or s.ends_on >= p_at::date)
   order by (s.tenant_id is not null) desc, s.started_on desc, s.id
   limit 1;

  with reg as (
    select c.* from platform.product_capabilities c
     where c.saas_product_id = p_product_id and c.status in ('ACTIVE', 'DEPRECATED')
  ),
  g as (
    select e.* from platform.compute_entitlements(p_tenant_id, p_product_id, p_at) e
  ),
  j as (
    select r.code, r.kind, r.is_baseline, r.status, r.unit, r.meter_code, r.scope_level,
           g.capability_id is not null as granted, g.value, g.enforcement, g.included,
           coalesce((select jsonb_agg(s order by s collate "C") from unnest(g.sources) s), '[]'::jsonb) as sources,
           case
             when r.scope_level = 'TENANT' then jsonb_build_object('level', 'TENANT')
             when g.company_ids is null or cardinality(g.company_ids) = 0 then jsonb_build_object('level', 'COMPANY')
             else jsonb_build_object('level', 'COMPANY', 'companyIds',
                    (select jsonb_agg(c::text order by c::text collate "C") from unnest(g.company_ids) c))
           end as scope
      from reg r left join g on g.capability_id = r.id
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('code', code, 'enabled', granted, 'scope', scope, 'sources', sources)
                               order by code collate "C")
                from j
               where kind in ('FEATURE', 'AI_FEATURE') and not is_baseline
                 and (status = 'ACTIVE' or granted)), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('code', code, 'value', value, 'unit', unit,
                                                  'enforcement', coalesce(enforcement, 'HARD'),
                                                  'scope', scope, 'sources', sources)
                               order by code collate "C")
                from j where kind = 'LIMIT' and granted and value is not null), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('code', code, 'meterCode', meter_code, 'included', included,
                                                  'unit', unit,
                                                  'period', jsonb_build_object(
                                                     'start', to_char(v_month, 'YYYY-MM-DD'),
                                                     'end', to_char((v_month + interval '1 month' - interval '1 day')::date, 'YYYY-MM-DD')),
                                                  'overageMode', 'BLOCK', 'sources', sources)
                               order by code collate "C")
                from j where kind = 'ALLOWANCE' and granted and included is not null), '[]'::jsonb)
    into v_caps, v_limits, v_allow;

  return jsonb_build_object(
    'schema', 'ebim.entitlements/v1',
    'environment', v_env,
    'controlPlaneTenantId', p_tenant_id::text,
    'productCode', v_product.code,
    'external', jsonb_build_object(
      'tenantId', v_map.external_tenant_id,
      'organizationId', v_map.external_organization_id,
      'companyIds', case when v_map.external_company_id is null then '[]'::jsonb
                         else jsonb_build_array(v_map.external_company_id) end),
    'appActive', platform.is_tenant_app_active(p_tenant_id, p_product_id),
    'planCode', v_plan,
    'capabilities', v_caps,
    'limits', v_limits,
    'allowances', v_allow,
    -- Pesos de créditos IA: fase 17. Explícito y vacío, no ausente.
    'aiCredits', jsonb_build_object('weights', '[]'::jsonb, 'weightsVersion', 0)
  );
end;
$$;

comment on function platform.entitlement_snapshot_content(uuid, uuid, timestamptz) is
  'Interna: contenido deseado (sin campos por emisión) de ebim.entitlements/v1. Espejo de snapshot.ts.';

revoke all on function platform.entitlement_snapshot_content(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function platform.entitlement_snapshot_content(uuid, uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Emisión
-- ---------------------------------------------------------------------------
create or replace function platform.issue_entitlement_snapshot(
  p_tenant_id    uuid,
  p_product_id   uuid,
  p_effective_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_at        timestamptz := coalesce(p_effective_at, now());
  v_revision  bigint;
  v_content   jsonb;
  v_content_ck text;
  v_last      record;
  v_version   bigint;
  v_doc       jsonb;
  v_checksum  text;
  v_size      integer;
  v_id        uuid;
  v_corr      uuid := gen_random_uuid();
  v_product   text;
begin
  if not platform.is_service_request() then
    raise exception 'SOLO_SERVIDOR: issue_entitlement_snapshot() la ejecuta el job de sincronización'
      using errcode = '42501';
  end if;
  if v_at > now() then
    raise exception 'VIGENCIA_FUTURA: MasterAdmin no emite estado futuro; el job lo emite al llegar la fecha'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('platform.entitlement_snapshots:' || p_tenant_id || ':' || p_product_id, 0));

  -- Validaciones de tenant/producto/mapping antes de tocar el estado deseado.
  v_content := platform.entitlement_snapshot_content(p_tenant_id, p_product_id, v_at);

  insert into platform.entitlement_desired_state (tenant_id, saas_product_id)
  values (p_tenant_id, p_product_id)
  on conflict (tenant_id, saas_product_id) do nothing;
  select desired_revision into v_revision
    from platform.entitlement_desired_state
   where tenant_id = p_tenant_id and saas_product_id = p_product_id
     for update;

  -- Se recalcula con la fila bloqueada: un cambio comercial ya confirmado entra;
  -- uno en vuelo espera al commit y vuelve a marcar dirty.
  v_content := platform.entitlement_snapshot_content(p_tenant_id, p_product_id, v_at);
  v_content_ck := platform.entitlement_checksum(v_content);

  select * into v_last from platform.entitlement_snapshots
   where tenant_id = p_tenant_id and saas_product_id = p_product_id
   order by snapshot_version desc limit 1;

  update platform.entitlement_desired_state
     set desired_dirty = false, dirty_since = null
   where tenant_id = p_tenant_id and saas_product_id = p_product_id;

  if v_last.id is not null and v_last.content_checksum = v_content_ck then
    return jsonb_build_object('issued', false, 'snapshot_id', v_last.id, 'version', v_last.snapshot_version,
                              'checksum', v_last.checksum);
  end if;

  v_version := coalesce(v_last.snapshot_version, 0) + 1;
  v_product := v_content ->> 'productCode';
  v_doc := v_content || jsonb_build_object(
    'snapshotVersion', v_version,
    'previousVersion', v_last.snapshot_version,
    'effectiveAt', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'issuedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'correlationId', v_corr::text,
    'idempotencyKey', 'ma-ent-v1-' || encode(sha256(convert_to(p_tenant_id::text || ':' || v_product || ':' || v_version, 'UTF8')), 'hex'));
  v_checksum := platform.entitlement_checksum(v_doc);
  v_doc := v_doc || jsonb_build_object('checksum', v_checksum);
  v_size := octet_length(platform.jcs_canonical(v_doc));
  if v_size > 65536 then
    raise exception 'SNAPSHOT_DEMASIADO_GRANDE: % bytes (máximo 65536)', v_size using errcode = '54000';
  end if;

  insert into platform.entitlement_snapshots
    (tenant_id, saas_product_id, snapshot_version, previous_version, document, checksum, content_checksum,
     effective_at, issued_at, correlation_id, idempotency_key, desired_revision, size_bytes)
  values
    (p_tenant_id, p_product_id, v_version, v_last.snapshot_version, v_doc, v_checksum, v_content_ck,
     date_trunc('second', v_at), date_trunc('second', now()), v_corr, v_doc ->> 'idempotencyKey', v_revision, v_size)
  returning id into v_id;

  return jsonb_build_object('issued', true, 'snapshot_id', v_id, 'version', v_version, 'checksum', v_checksum);
end;
$$;

comment on function platform.issue_entitlement_snapshot(uuid, uuid, timestamptz) is
  'Emite el snapshot ebim.entitlements/v1 de un tenant×producto (spec §7.2): versión max+1 bajo '
  'advisory lock solo si el contenido canónico cambió; limpia desired_dirty. Solo service_role.';

revoke all on function platform.issue_entitlement_snapshot(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function platform.issue_entitlement_snapshot(uuid, uuid, timestamptz) to service_role;
