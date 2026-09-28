-- ============================================================================
-- EBIM Commercial Control Plane · Fase 17 · medidores y eventos de uso (MA-50)
-- ----------------------------------------------------------------------------
-- Spec §11.1 (usage_meters), §11.3 (ingest), §12.7 (tokens = COGS interno),
-- §14 (autoridad). Plan §4 fila 17, §12.1 MA-50.
-- Test: supabase/tests/38_ccp_usage_ingest.test.sql.
-- Contrato: contracts/usage/v1/README.md (FIX-USG-v1).
--
--   · usage_meters: registro por producto. is_billable=false y
--     allows_negative=false por defecto; que un medidor sea facturable lo
--     decide finanzas (D-06) con set_usage_meter_billable.
--   · usage_ingest_credentials: clave PÚBLICA del SaaS (por producto × ambiente
--     × emisor) con la que MasterAdmin verifica el JWT ES256 del ingest. Es la
--     dirección inversa a credential_profiles (allí firma MasterAdmin y la
--     fila exige secret_ref); por eso es una tabla propia. public_key_ref es
--     el NOMBRE de la variable de entorno de la Edge Function, nunca la clave.
--   · usage_events: append-only (UPDATE/DELETE/TRUNCATE → 55000 incluso para
--     postgres), unique (producto, event_id) + event_hash (JCS/SHA-256) para
--     distinguir DUPLICATE de CONFLICT. `internal` (proveedor/modelo/tokens/
--     costo) SIN grant de columna a authenticated: finanzas lo lee por RPC.
--   · usage_ingest_rejections: bitácora append-only de rechazos (sin
--     contenido del evento); CONFLICT es la alerta de integridad.
--   · m2m_jti_replay: jti de un solo uso por emisor, con purga a TTL + skew.
--   · ingest_usage_events: DEFINER, EXECUTE solo service_role y además
--     is_service_request(). La Edge Function usage-ingest la llama SOLO tras
--     verificar firma, aud, scope, exp y jti. Desviación D-12: la credencial
--     identifica al producto; cada evento trae controlPlaneTenantId y se
--     rechaza si ese tenant no tiene mapping ACTIVE para ESE producto.
--   · usage_assign_period: gancho de período (aquí: mes UTC del evento, D-10).
--     La migración …000200 lo reemplaza por la política de eventos tardíos.
--
-- Rollback: docs/runbooks/ccp-rollback/17.sql (revoca EXECUTE; sin DROP de datos).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. usage_meters
-- ---------------------------------------------------------------------------
create table platform.usage_meters (
  id               uuid primary key default gen_random_uuid(),
  saas_product_id  uuid not null references platform.saas_products (id) on delete restrict,
  code             text not null,
  name             text not null,
  unit             text not null,
  aggregation      text not null default 'SUM',
  -- EVENT: cada acción medida emite un evento. DAILY_SNAPSHOT: el SaaS emite
  -- una foto diaria de un recurso (p. ej. almacenes activos); solo para
  -- dimensiones aprobadas (la fila nace DRAFT y un humano la activa).
  measurement      text not null default 'EVENT',
  capability_id    uuid references platform.product_capabilities (id) on delete restrict,
  is_billable      boolean not null default false,
  allows_negative  boolean not null default false,
  -- Ventana técnica de llegada tardía (spec §11.4.2). No es decisión comercial.
  grace_hours      integer not null default 72,
  status           text not null default 'DRAFT',
  billable_decided_by uuid references platform.profiles (id) on delete set null,
  billable_reason  text,
  created_by       uuid references platform.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint usage_meters_code_ck check (code ~ '^[a-z0-9]+([._][a-z0-9]+)*$' and length(code) <= 120),
  constraint usage_meters_name_ck check (length(trim(name)) > 0),
  constraint usage_meters_unit_ck check (unit ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  constraint usage_meters_aggregation_ck check (aggregation in ('SUM', 'MAX', 'COUNT_DISTINCT_SUBJECT')),
  constraint usage_meters_measurement_ck check (measurement in ('EVENT', 'DAILY_SNAPSHOT')),
  -- Una foto diaria se agrega como pico (MAX), nunca como suma de fotos.
  constraint usage_meters_snapshot_ck check (measurement <> 'DAILY_SNAPSHOT' or aggregation = 'MAX'),
  constraint usage_meters_grace_ck check (grace_hours between 0 and 720),
  constraint usage_meters_status_ck check (status in ('DRAFT', 'ACTIVE', 'DEPRECATED'))
);

create unique index usage_meters_product_code_uk on platform.usage_meters (saas_product_id, code);
create trigger usage_meters_set_updated_at before update on platform.usage_meters
  for each row execute function platform.set_updated_at();

comment on table platform.usage_meters is
  'Medidores de uso por producto (spec §11.1). is_billable=false por defecto: que un '
  'medidor sea facturable es decisión de negocio (D-06). Sin precios.';

alter table platform.usage_meters enable row level security;
alter table platform.usage_meters force row level security;
revoke all on platform.usage_meters from public, anon, authenticated;
grant select on platform.usage_meters to authenticated;
grant select on platform.usage_meters to service_role;
create policy usage_meters_select on platform.usage_meters
  for select to authenticated using (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- 2. usage_ingest_credentials (clave pública del SaaS, por referencia)
-- ---------------------------------------------------------------------------
create table platform.usage_ingest_credentials (
  id               uuid primary key default gen_random_uuid(),
  saas_product_id  uuid not null references platform.saas_products (id) on delete restrict,
  environment      platform.provisioning_environment not null,
  issuer           text not null,
  audience         text not null default 'masteradmin.ebim',
  algorithm        platform.m2m_algorithm not null default 'ES256',
  kid              text,
  public_key_ref   text not null,
  enabled          boolean not null default false,
  created_by       uuid references platform.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint usage_ingest_credentials_issuer_ck check (issuer ~ '^[a-z0-9]+(\.[a-z0-9]+)*$' and length(issuer) <= 100),
  constraint usage_ingest_credentials_audience_ck check (audience ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$'),
  -- El spec fija ES256 para el ingest (§11.3).
  constraint usage_ingest_credentials_alg_ck check (algorithm = 'ES256'),
  constraint usage_ingest_credentials_kid_ck check (kid is null or kid ~ '^[A-Za-z0-9._-]{1,64}$'),
  constraint usage_ingest_credentials_ref_ck check (platform.is_secret_reference(public_key_ref))
);

create unique index usage_ingest_credentials_issuer_uk on platform.usage_ingest_credentials (issuer, environment);
create trigger usage_ingest_credentials_set_updated_at before update on platform.usage_ingest_credentials
  for each row execute function platform.set_updated_at();

comment on table platform.usage_ingest_credentials is
  'Verificación del JWT ES256 que firma cada SaaS para el ingest de uso. public_key_ref es el '
  'NOMBRE de la variable de entorno con la JWK pública; la clave privada vive solo en el SaaS.';

alter table platform.usage_ingest_credentials enable row level security;
alter table platform.usage_ingest_credentials force row level security;
revoke all on platform.usage_ingest_credentials from public, anon, authenticated;
grant select (id, saas_product_id, environment, issuer, audience, algorithm, kid, enabled, created_at, updated_at)
  on platform.usage_ingest_credentials to authenticated;
grant select on platform.usage_ingest_credentials to service_role;
create policy usage_ingest_credentials_select on platform.usage_ingest_credentials
  for select to authenticated using (platform.can_manage_platform_entities() or platform.can_read_finance());

-- ---------------------------------------------------------------------------
-- 3. usage_events (append-only)
-- ---------------------------------------------------------------------------
create table platform.usage_events (
  id                  uuid primary key default gen_random_uuid(),
  saas_product_id     uuid not null references platform.saas_products (id) on delete restrict,
  event_id            uuid not null,
  tenant_id           uuid not null references platform.tenants (id) on delete restrict,
  meter_id            uuid not null references platform.usage_meters (id) on delete restrict,
  meter_code          text not null,
  quantity            numeric(20, 6) not null,
  unit                text not null,
  occurred_at         timestamptz not null,
  received_at         timestamptz not null default now(),
  environment         platform.provisioning_environment not null,
  external_company_id text,
  subject_ref         text,
  capability_code     text,
  internal            jsonb,
  event_hash          text not null,
  period_start        date not null,
  late                boolean not null default false,
  ingest_batch_id     uuid not null,
  constraint usage_events_hash_ck check (event_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint usage_events_period_ck check (period_start = date_trunc('month', period_start)::date),
  constraint usage_events_internal_ck check (internal is null or jsonb_typeof(internal) = 'object'),
  constraint usage_events_refs_ck check (
    (external_company_id is null or length(external_company_id) between 1 and 200)
    and (subject_ref is null or length(subject_ref) between 1 and 200))
);

create unique index usage_events_product_event_uk on platform.usage_events (saas_product_id, event_id);
create index usage_events_tenant_period_ix on platform.usage_events (tenant_id, meter_id, period_start);
create index usage_events_meter_ix on platform.usage_events (meter_id);

comment on table platform.usage_events is
  'Eventos de uso crudos (spec §11.3). Append-only: una corrección es un evento compensatorio '
  'en un medidor con allows_negative. Nunca se factura desde aquí: solo desde agregados FINALIZED.';
comment on column platform.usage_events.internal is
  'COGS interno {provider, model, inputTokens, outputTokens, cacheTokens, latencyMs, costAmount, '
  'costCurrency}. Sin grant de columna a authenticated; finanzas lo lee con usage_event_cogs().';

create or replace function platform.usage_append_only()
returns trigger
language plpgsql
set search_path = platform, pg_catalog
as $$
begin
  raise exception 'USO_INMUTABLE: % es append-only (%); una corrección es un evento o una entrada nueva',
    tg_table_name, tg_op using errcode = '55000';
end;
$$;
revoke all on function platform.usage_append_only() from public, anon, authenticated;

create trigger usage_events_no_update_delete before update or delete on platform.usage_events
  for each row execute function platform.usage_append_only();
create trigger usage_events_no_truncate before truncate on platform.usage_events
  for each statement execute function platform.usage_append_only();

alter table platform.usage_events enable row level security;
alter table platform.usage_events force row level security;
revoke all on platform.usage_events from public, anon, authenticated;
-- Grant por columna: todo menos `internal`.
grant select (id, saas_product_id, event_id, tenant_id, meter_id, meter_code, quantity, unit, occurred_at,
              received_at, environment, external_company_id, subject_ref, capability_code, event_hash,
              period_start, late, ingest_batch_id)
  on platform.usage_events to authenticated;
grant select, insert on platform.usage_events to service_role;
create policy usage_events_select on platform.usage_events
  for select to authenticated using (platform.can_read_tenant(tenant_id));

-- ---------------------------------------------------------------------------
-- 4. usage_ingest_rejections (append-only, sin contenido)
-- ---------------------------------------------------------------------------
create table platform.usage_ingest_rejections (
  id               uuid primary key default gen_random_uuid(),
  saas_product_id  uuid not null references platform.saas_products (id) on delete restrict,
  event_id         text,
  tenant_id        uuid,
  meter_code       text,
  code             text not null,
  ingest_batch_id  uuid not null,
  environment      platform.provisioning_environment not null,
  detail           jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  constraint usage_ingest_rejections_code_ck check (code ~ '^[A-Z][A-Z_]{2,60}$'),
  constraint usage_ingest_rejections_event_ck check (event_id is null or length(event_id) <= 100),
  constraint usage_ingest_rejections_meter_ck check (meter_code is null or length(meter_code) <= 120)
);
create index usage_ingest_rejections_product_ix on platform.usage_ingest_rejections (saas_product_id, created_at desc);

create trigger usage_ingest_rejections_no_update_delete before update or delete on platform.usage_ingest_rejections
  for each row execute function platform.usage_append_only();
create trigger usage_ingest_rejections_no_truncate before truncate on platform.usage_ingest_rejections
  for each statement execute function platform.usage_append_only();

alter table platform.usage_ingest_rejections enable row level security;
alter table platform.usage_ingest_rejections force row level security;
revoke all on platform.usage_ingest_rejections from public, anon, authenticated;
grant select on platform.usage_ingest_rejections to authenticated;
grant select, insert on platform.usage_ingest_rejections to service_role;
create policy usage_ingest_rejections_select on platform.usage_ingest_rejections
  for select to authenticated using (platform.can_manage_platform_entities() or platform.can_read_finance());

-- ---------------------------------------------------------------------------
-- 5. m2m_jti_replay
-- ---------------------------------------------------------------------------
create table platform.m2m_jti_replay (
  issuer     text not null,
  jti        text not null,
  expires_at timestamptz not null,
  used_at    timestamptz not null default now(),
  primary key (issuer, jti),
  constraint m2m_jti_replay_jti_ck check (length(jti) between 1 and 200),
  constraint m2m_jti_replay_issuer_ck check (length(issuer) between 1 and 200)
);
create index m2m_jti_replay_expires_ix on platform.m2m_jti_replay (expires_at);

alter table platform.m2m_jti_replay enable row level security;
alter table platform.m2m_jti_replay force row level security;
revoke all on platform.m2m_jti_replay from public, anon, authenticated;
grant select, insert, delete on platform.m2m_jti_replay to service_role;

-- true = jti nuevo (consumido ahora); false = ya usado. Purga oportunista de
-- lo vencido hace más de 10 minutos (TTL ≤ 300 s + skew).
create or replace function platform.consume_m2m_jti(p_issuer text, p_jti text, p_expires_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_rows integer;
begin
  if not platform.is_service_request() then
    raise exception 'NO_AUTORIZADO: solo el servidor consume jti' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_issuer, '')), '') is null or nullif(trim(coalesce(p_jti, '')), '') is null
     or p_expires_at is null then
    raise exception 'JTI_INVALIDO: emisor, jti y expiración son obligatorios' using errcode = '22023';
  end if;
  delete from platform.m2m_jti_replay where expires_at < now() - interval '10 minutes';
  insert into platform.m2m_jti_replay (issuer, jti, expires_at)
  values (p_issuer, p_jti, p_expires_at)
  on conflict (issuer, jti) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;
revoke all on function platform.consume_m2m_jti(text, text, timestamptz) from public, anon, authenticated;
grant execute on function platform.consume_m2m_jti(text, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Administración de medidores y credenciales
-- ---------------------------------------------------------------------------
create or replace function platform.upsert_usage_meter(
  p_product_code    text,
  p_code            text,
  p_name            text,
  p_unit            text,
  p_aggregation     text,
  p_status          text,
  p_measurement     text default 'EVENT',
  p_capability_code text default null,
  p_allows_negative boolean default false,
  p_grace_hours     integer default 72
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_product uuid;
  v_cap     uuid;
  v_kind    text;
  v_id      uuid;
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: solo EBIM_PRODUCT_ADMIN o el super admin registran medidores' using errcode = '42501';
  end if;
  select id into v_product from platform.saas_products where code = p_product_code;
  if v_product is null then
    raise exception 'PRODUCTO_NO_ENCONTRADO: %', p_product_code using errcode = 'P0002';
  end if;
  if p_capability_code is not null then
    select id, kind into v_cap, v_kind from platform.product_capabilities
     where code = p_capability_code and saas_product_id = v_product;
    if v_cap is null then
      raise exception 'CAPACIDAD_NO_ENCONTRADA: %', p_capability_code using errcode = '23503';
    end if;
    if v_kind not in ('AI_FEATURE', 'ALLOWANCE') then
      raise exception 'CAPACIDAD_NO_MEDIBLE: % es %; un medidor se liga a AI_FEATURE o ALLOWANCE', p_capability_code, v_kind
        using errcode = '23514';
    end if;
  end if;

  insert into platform.usage_meters (saas_product_id, code, name, unit, aggregation, measurement, capability_id,
                                     allows_negative, grace_hours, status, created_by)
  values (v_product, p_code, trim(p_name), p_unit, p_aggregation, coalesce(p_measurement, 'EVENT'), v_cap,
          coalesce(p_allows_negative, false), coalesce(p_grace_hours, 72), p_status, auth.uid())
  on conflict (saas_product_id, code) do update
     set name = excluded.name, unit = excluded.unit, aggregation = excluded.aggregation,
         measurement = excluded.measurement, capability_id = excluded.capability_id,
         allows_negative = excluded.allows_negative, grace_hours = excluded.grace_hours, status = excluded.status
  returning id into v_id;

  perform platform.log_audit('USAGE_METER_UPSERTED', 'usage_meter', v_id::text, null, null,
    jsonb_build_object('product', p_product_code, 'code', p_code, 'unit', p_unit, 'aggregation', p_aggregation,
                       'measurement', coalesce(p_measurement, 'EVENT'), 'status', p_status,
                       'capability', p_capability_code, 'allows_negative', coalesce(p_allows_negative, false)));
  return v_id;
end;
$$;
revoke all on function platform.upsert_usage_meter(text, text, text, text, text, text, text, text, boolean, integer) from public, anon;
grant execute on function platform.upsert_usage_meter(text, text, text, text, text, text, text, text, boolean, integer) to authenticated;

-- D-06: solo finanzas decide si un medidor es facturable, con motivo.
create or replace function platform.set_usage_meter_billable(
  p_product_code text, p_code text, p_billable boolean, p_reason text
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id uuid;
begin
  if not platform.can_read_finance() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE decide si un medidor es facturable (D-06)' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO' using errcode = '23502';
  end if;
  update platform.usage_meters m set is_billable = p_billable, billable_decided_by = auth.uid(), billable_reason = trim(p_reason)
    from platform.saas_products p
   where p.id = m.saas_product_id and p.code = p_product_code and m.code = p_code
  returning m.id into v_id;
  if v_id is null then
    raise exception 'MEDIDOR_NO_ENCONTRADO: %/%', p_product_code, p_code using errcode = 'P0002';
  end if;
  perform platform.log_audit('USAGE_METER_BILLABLE_SET', 'usage_meter', v_id::text, null, null,
    jsonb_build_object('billable', p_billable, 'reason', trim(p_reason)));
end;
$$;
revoke all on function platform.set_usage_meter_billable(text, text, boolean, text) from public, anon;
grant execute on function platform.set_usage_meter_billable(text, text, boolean, text) to authenticated;

create or replace function platform.configure_usage_ingest_credential(
  p_product_code   text,
  p_environment    platform.provisioning_environment,
  p_issuer         text,
  p_public_key_ref text,
  p_enabled        boolean,
  p_kid            text default null,
  p_audience       text default 'masteradmin.ebim'
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
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: solo EBIM_PRODUCT_ADMIN o el super admin configuran credenciales de ingest'
      using errcode = '42501';
  end if;
  select id into v_product from platform.saas_products where code = p_product_code;
  if v_product is null then
    raise exception 'PRODUCTO_NO_ENCONTRADO: %', p_product_code using errcode = 'P0002';
  end if;
  insert into platform.usage_ingest_credentials (saas_product_id, environment, issuer, audience, kid, public_key_ref,
                                                 enabled, created_by)
  values (v_product, p_environment, p_issuer, coalesce(p_audience, 'masteradmin.ebim'), p_kid, p_public_key_ref,
          coalesce(p_enabled, false), auth.uid())
  on conflict (issuer, environment) do update
     set saas_product_id = excluded.saas_product_id, audience = excluded.audience, kid = excluded.kid,
         public_key_ref = excluded.public_key_ref, enabled = excluded.enabled
  returning id into v_id;
  perform platform.log_audit('USAGE_INGEST_CREDENTIAL_CONFIGURED', 'usage_ingest_credential', v_id::text, null, null,
    jsonb_build_object('product', p_product_code, 'environment', p_environment, 'issuer', p_issuer,
                       'enabled', coalesce(p_enabled, false)));
  return v_id;
end;
$$;
revoke all on function platform.configure_usage_ingest_credential(text, platform.provisioning_environment, text, text, boolean, text, text) from public, anon;
grant execute on function platform.configure_usage_ingest_credential(text, platform.provisioning_environment, text, text, boolean, text, text) to authenticated;

-- Contexto de verificación para la Edge Function (service_role). Devuelve la
-- REFERENCIA de la clave pública y los dos interruptores: credencial y
-- product_integrations.usage_ingest_enabled (kill-switch por producto).
create or replace function platform.usage_ingest_credential(p_issuer text)
returns table (
  product_code         text,
  environment          text,
  audience             text,
  algorithm            text,
  kid                  text,
  public_key_ref       text,
  credential_enabled   boolean,
  product_ingest_enabled boolean
)
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
begin
  if not platform.is_service_request() then
    raise exception 'NO_AUTORIZADO: solo el servidor resuelve credenciales de ingest' using errcode = '42501';
  end if;
  return query
    select p.code, c.environment::text, c.audience, c.algorithm::text, c.kid, c.public_key_ref, c.enabled,
           exists (select 1 from platform.product_integrations i
                    where i.saas_product_id = c.saas_product_id and i.usage_ingest_enabled)
      from platform.usage_ingest_credentials c
      join platform.saas_products p on p.id = c.saas_product_id
     where c.issuer = p_issuer;
end;
$$;
revoke all on function platform.usage_ingest_credential(text) from public, anon, authenticated;
grant execute on function platform.usage_ingest_credential(text) to service_role;

-- Kill-switch por producto (D-12: apagado hasta aprobación).
create or replace function platform.set_usage_ingest_enabled(p_product_code text, p_enabled boolean, p_reason text)
returns integer
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_rows integer;
begin
  if not (platform.can_manage_platform_entities() or platform.can_read_finance()) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO' using errcode = '23502';
  end if;
  update platform.product_integrations i set usage_ingest_enabled = coalesce(p_enabled, false)
    from platform.saas_products p
   where p.id = i.saas_product_id and p.code = p_product_code;
  get diagnostics v_rows = row_count;
  perform platform.log_audit('USAGE_INGEST_SWITCH', 'saas_product', p_product_code, null, null,
    jsonb_build_object('enabled', coalesce(p_enabled, false), 'reason', trim(p_reason), 'integrations', v_rows));
  return v_rows;
end;
$$;
revoke all on function platform.set_usage_ingest_enabled(text, boolean, text) from public, anon;
grant execute on function platform.set_usage_ingest_enabled(text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Validación y hash del evento
-- ---------------------------------------------------------------------------
-- internal: allowlist cerrada, solo números/strings cortos. Nunca contenido.
create or replace function platform.usage_internal_is_valid(p_internal jsonb)
returns boolean
language sql
immutable
set search_path = platform, pg_catalog
as $$
  select p_internal is null
      or (jsonb_typeof(p_internal) = 'object'
          and not exists (
            select 1 from jsonb_each(p_internal) e
             where e.key not in ('provider', 'model', 'inputTokens', 'outputTokens', 'cacheTokens',
                                 'latencyMs', 'costAmount', 'costCurrency')
                or (e.key in ('provider', 'model')
                    and not (jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') between 1 and 100))
                or (e.key in ('inputTokens', 'outputTokens', 'cacheTokens', 'latencyMs')
                    and not (jsonb_typeof(e.value) = 'number' and (e.value #>> '{}')::numeric >= 0
                             and (e.value #>> '{}')::numeric = trunc((e.value #>> '{}')::numeric)
                             and (e.value #>> '{}')::numeric <= 9007199254740991))
                or (e.key = 'costAmount'
                    and not (jsonb_typeof(e.value) = 'number' and (e.value #>> '{}')::numeric >= 0))
                or (e.key = 'costCurrency'
                    and not (jsonb_typeof(e.value) = 'string' and (e.value #>> '{}') ~ '^[A-Z]{3}$'))));
$$;
revoke all on function platform.usage_internal_is_valid(jsonb) from public, anon;
grant execute on function platform.usage_internal_is_valid(jsonb) to authenticated, service_role;

-- Forma canónica del evento (sin campos de transporte) → sha256 de su JCS.
-- occurredAt se normaliza a UTC con milisegundos.
create or replace function platform.usage_event_hash(
  p_event_id uuid, p_meter_code text, p_quantity numeric, p_unit text, p_occurred_at timestamptz,
  p_tenant_id uuid, p_external_company_id text, p_subject_ref text, p_capability_code text, p_internal jsonb
)
returns text
language sql
immutable
set search_path = platform, pg_catalog
as $$
  select 'sha256:' || encode(sha256(convert_to(platform.jcs_canonical(jsonb_strip_nulls(jsonb_build_object(
    'eventId', p_event_id::text,
    'meterCode', p_meter_code,
    'quantity', p_quantity,
    'unit', p_unit,
    'occurredAt', to_char(p_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'controlPlaneTenantId', p_tenant_id::text,
    'externalCompanyId', p_external_company_id,
    'subjectRef', p_subject_ref,
    'capabilityCode', p_capability_code,
    'internal', p_internal))), 'UTF8')), 'hex');
$$;
revoke all on function platform.usage_event_hash(uuid, text, numeric, text, timestamptz, uuid, text, text, text, jsonb) from public, anon;
grant execute on function platform.usage_event_hash(uuid, text, numeric, text, timestamptz, uuid, text, text, text, jsonb) to authenticated, service_role;

-- Gancho de período (D-10: mes calendario UTC). La migración de agregados lo
-- reemplaza por la política de eventos tardíos.
create or replace function platform.usage_assign_period(
  p_tenant_id uuid, p_meter_id uuid, p_occurred_at timestamptz,
  out period_start date, out late boolean
)
language sql
stable
set search_path = platform, pg_catalog
as $$
  select date_trunc('month', p_occurred_at at time zone 'UTC')::date, false;
$$;
revoke all on function platform.usage_assign_period(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function platform.usage_assign_period(uuid, uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 8. ingest_usage_events
-- ---------------------------------------------------------------------------
-- Resultado: {"results":[{"eventId","status":"ACCEPTED|DUPLICATE|REJECTED","code"?}],
--             "accepted","duplicate","rejected"}. Orden = orden del lote.
-- Un evento rechazado no aborta el lote; un lote malformado sí (22023).
create or replace function platform.ingest_usage_events(
  p_product_code text,
  p_environment  text,
  p_events       jsonb,
  p_batch_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_product    platform.saas_products;
  v_env        platform.provisioning_environment;
  v_ev         jsonb;
  v_results    jsonb := '[]'::jsonb;
  v_acc        integer := 0;
  v_dup        integer := 0;
  v_rej        integer := 0;
  v_code       text;
  v_event_id   uuid;
  v_tenant     uuid;
  v_meter      platform.usage_meters;
  v_qty        numeric;
  v_at         timestamptz;
  v_hash       text;
  v_existing   text;
  v_map_env    text;
  v_period     record;
  v_raw_id     text;
begin
  if not platform.is_service_request() then
    raise exception 'NO_AUTORIZADO: el ingest de uso solo lo ejecuta el servidor tras verificar el M2M'
      using errcode = '42501';
  end if;
  select * into v_product from platform.saas_products where code = p_product_code;
  if v_product.id is null then
    raise exception 'PRODUCTO_NO_ENCONTRADO: %', p_product_code using errcode = 'P0002';
  end if;
  begin
    v_env := p_environment::platform.provisioning_environment;
  exception when invalid_text_representation then
    raise exception 'AMBIENTE_INVALIDO: %', p_environment using errcode = '22023';
  end;
  if p_batch_id is null then
    raise exception 'LOTE_INVALIDO: falta el id del lote' using errcode = '22023';
  end if;
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'LOTE_INVALIDO: events debe ser un arreglo' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 500 then
    raise exception 'LOTE_DEMASIADO_GRANDE: % eventos (máximo 500)', jsonb_array_length(p_events) using errcode = '22023';
  end if;

  for v_ev in select value from jsonb_array_elements(p_events) loop
    v_code := null; v_event_id := null; v_tenant := null; v_meter := null; v_hash := null;
    v_raw_id := case when jsonb_typeof(v_ev) = 'object' then left(v_ev ->> 'eventId', 100) end;

    -- Forma
    if jsonb_typeof(v_ev) <> 'object'
       or coalesce(v_ev ->> 'eventId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(v_ev ->> 'controlPlaneTenantId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(v_ev -> 'meterCode') is distinct from 'string'
       or jsonb_typeof(v_ev -> 'quantity') is distinct from 'number'
       or jsonb_typeof(v_ev -> 'unit') is distinct from 'string'
       or jsonb_typeof(v_ev -> 'occurredAt') is distinct from 'string'
       or coalesce(v_ev ->> 'occurredAt', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
       or (v_ev ? 'externalCompanyId' and (jsonb_typeof(v_ev -> 'externalCompanyId') <> 'string'
                                           or length(v_ev ->> 'externalCompanyId') not between 1 and 200))
       or (v_ev ? 'subjectRef' and (jsonb_typeof(v_ev -> 'subjectRef') <> 'string'
                                    or length(v_ev ->> 'subjectRef') not between 1 and 200))
       or (v_ev ? 'capabilityCode' and (jsonb_typeof(v_ev -> 'capabilityCode') <> 'string'
                                        or (v_ev ->> 'capabilityCode') !~ '^[a-z0-9]+(\.[a-z0-9_]+)+$'))
       or exists (select 1 from jsonb_object_keys(v_ev) k
                   where k not in ('eventId', 'meterCode', 'quantity', 'unit', 'occurredAt', 'controlPlaneTenantId',
                                   'externalCompanyId', 'subjectRef', 'capabilityCode', 'internal')) then
      v_code := 'INVALID_EVENT';
    end if;

    if v_code is null then
      v_event_id := (v_ev ->> 'eventId')::uuid;
      v_tenant := (v_ev ->> 'controlPlaneTenantId')::uuid;
      v_qty := (v_ev ->> 'quantity')::numeric;
      begin
        v_at := (v_ev ->> 'occurredAt')::timestamptz;
      exception when others then
        v_code := 'INVALID_EVENT';
      end;
    end if;
    if v_code is null and (abs(v_qty) >= 1e14 or v_qty <> round(v_qty, 6)) then
      v_code := 'INVALID_EVENT';
    end if;

    if v_code is null then
      select * into v_meter from platform.usage_meters
       where saas_product_id = v_product.id and code = v_ev ->> 'meterCode' and status = 'ACTIVE';
      if v_meter.id is null then
        v_code := 'UNKNOWN_METER';
      elsif v_qty < 0 and not v_meter.allows_negative then
        v_code := 'NEGATIVE_QUANTITY';
      elsif (v_ev ->> 'unit') <> v_meter.unit then
        v_code := 'UNIT_MISMATCH';
      elsif v_at > now() + interval '5 minutes' then
        v_code := 'OCCURRED_AT_IN_FUTURE';
      elsif not platform.usage_internal_is_valid(v_ev -> 'internal') then
        v_code := 'INTERNAL_METADATA_INVALID';
      end if;
    end if;

    if v_code is null then
      select d.provisioning_environment::text into v_map_env
        from platform.tenant_product_mappings m
        join platform.tenants t on t.id = m.tenant_id and t.saas_product_id = v_product.id
        left join platform.deployment_targets d on d.id = m.deployment_target_id
       where m.tenant_id = v_tenant and m.saas_product_id = v_product.id and m.status = 'ACTIVE';
      if not found then
        v_code := 'TENANT_NOT_MAPPED_FOR_PRODUCT';
      elsif v_map_env is distinct from v_env::text then
        v_code := 'ENVIRONMENT_MISMATCH';
      end if;
    end if;

    if v_code is null then
      v_hash := platform.usage_event_hash(v_event_id, v_meter.code, v_qty, v_meter.unit, v_at, v_tenant,
                                          v_ev ->> 'externalCompanyId', v_ev ->> 'subjectRef',
                                          v_ev ->> 'capabilityCode', v_ev -> 'internal');
      select event_hash into v_existing from platform.usage_events
       where saas_product_id = v_product.id and event_id = v_event_id;
      if found then
        if v_existing = v_hash then
          v_dup := v_dup + 1;
          v_results := v_results || jsonb_build_object('eventId', v_event_id::text, 'status', 'DUPLICATE');
          continue;
        end if;
        v_code := 'CONFLICT';
      end if;
    end if;

    if v_code is not null then
      v_rej := v_rej + 1;
      v_results := v_results || jsonb_build_object('eventId', v_raw_id, 'status', 'REJECTED', 'code', v_code);
      insert into platform.usage_ingest_rejections (saas_product_id, event_id, tenant_id, meter_code, code,
                                                    ingest_batch_id, environment, detail)
      values (v_product.id, v_raw_id, v_tenant,
              case when jsonb_typeof(v_ev) = 'object' then left(v_ev ->> 'meterCode', 120) end,
              v_code, p_batch_id, v_env,
              case when v_code = 'CONFLICT' then jsonb_build_object('storedHash', v_existing, 'receivedHash', v_hash)
                   else '{}'::jsonb end);
      continue;
    end if;

    select * into v_period from platform.usage_assign_period(v_tenant, v_meter.id, v_at);
    insert into platform.usage_events (saas_product_id, event_id, tenant_id, meter_id, meter_code, quantity, unit,
                                       occurred_at, environment, external_company_id, subject_ref, capability_code,
                                       internal, event_hash, period_start, late, ingest_batch_id)
    values (v_product.id, v_event_id, v_tenant, v_meter.id, v_meter.code, v_qty, v_meter.unit, v_at, v_env,
            v_ev ->> 'externalCompanyId', v_ev ->> 'subjectRef', v_ev ->> 'capabilityCode', v_ev -> 'internal',
            v_hash, v_period.period_start, v_period.late, p_batch_id);
    v_acc := v_acc + 1;
    v_results := v_results || jsonb_build_object('eventId', v_event_id::text, 'status', 'ACCEPTED');
  end loop;

  return jsonb_build_object('results', v_results, 'accepted', v_acc, 'duplicate', v_dup, 'rejected', v_rej);
end;
$$;
revoke all on function platform.ingest_usage_events(text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function platform.ingest_usage_events(text, text, jsonb, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 9. COGS interno: solo finanzas
-- ---------------------------------------------------------------------------
create or replace function platform.usage_event_cogs(p_tenant_id uuid, p_from timestamptz, p_to timestamptz)
returns table (event_id uuid, meter_code text, occurred_at timestamptz, quantity numeric, internal jsonb)
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
begin
  if not platform.can_read_finance() then
    raise exception 'NO_AUTORIZADO: la metadata interna de COGS es solo para EBIM_FINANCE' using errcode = '42501';
  end if;
  return query
    select e.event_id, e.meter_code, e.occurred_at, e.quantity, e.internal
      from platform.usage_events e
     where e.tenant_id = p_tenant_id and e.occurred_at >= p_from and e.occurred_at < p_to
     order by e.occurred_at, e.event_id;
end;
$$;
revoke all on function platform.usage_event_cogs(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function platform.usage_event_cogs(uuid, timestamptz, timestamptz) to authenticated;
