-- ============================================================================
-- EBIM Commercial Control Plane · Fase 17 · agregados y cierre de período (MA-52)
-- ----------------------------------------------------------------------------
-- Spec §11.4, §12.5, §17 (DEMO no facturable). Plan §4 fila 18, §12.1 MA-52.
-- Test: supabase/tests/39_ccp_usage_aggregates.test.sql.
--
--   · usage_period_aggregates: uno por tenant × medidor × período (mes UTC,
--     D-10). OPEN → CLOSING (period_end + grace_hours del medidor; ventana
--     técnica, no comercial) → FINALIZED (finanzas o job). Sin retrocesos;
--     FINALIZED inmutable (55000 incluso para postgres); nunca se borran.
--   · El ingest abre el agregado OPEN del período del evento (trigger).
--   · usage_assign_period (reemplaza al de la migración …000100): política de
--     eventos tardíos. Si el período natural ya está FINALIZED, el evento se
--     imputa al SIGUIENTE período no finalizado con late=true. Nunca se reabre
--     un agregado ni una factura emitida.
--   · finalize_usage_aggregate: recalcula desde los eventos (SUM / MAX /
--     COUNT_DISTINCT_SUBJECT), guarda event_count, late_event_count y
--     source_hash (sha256 de los event_id ordenados), aplica la asignación
--     ALLOWANCE concedida al cierre del período (compute_entitlements) y marca
--     is_billable = medidor facturable (D-06) ∧ tenant no DEMO/SANDBOX (INV-7).
--     Exceso sobre la asignación: el contrato v1 solo admite overageMode BLOCK
--     (no hay precio de exceso, D-02/D-06) → alerta a finanzas, nunca factura.
--   · usage_alerts: bitácora append-only para finanzas (sin contenido).
--   · Endurece la migración …000100: service_role ya no inserta eventos ni
--     rechazos directamente (solo ingest_usage_events).
--
-- Rollback: docs/runbooks/ccp-rollback/17.sql.
-- ============================================================================

revoke insert on platform.usage_events from service_role;
revoke insert on platform.usage_ingest_rejections from service_role;

-- ---------------------------------------------------------------------------
-- 1. usage_period_aggregates
-- ---------------------------------------------------------------------------
create table platform.usage_period_aggregates (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references platform.tenants (id) on delete restrict,
  saas_product_id    uuid not null references platform.saas_products (id) on delete restrict,
  meter_id           uuid not null references platform.usage_meters (id) on delete restrict,
  meter_code         text not null,
  period_start       date not null,
  period_end         date not null,
  status             text not null default 'OPEN',
  event_count        integer not null default 0,
  late_event_count   integer not null default 0,
  quantity           numeric(20, 6) not null default 0,
  source_hash        text,
  is_billable        boolean not null default false,
  allowance_included numeric(20, 6),
  overage_quantity   numeric(20, 6),
  allowance_status   text,
  overage_policy     text,
  closing_at         timestamptz,
  finalized_at       timestamptz,
  finalized_by       uuid references platform.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint usage_period_aggregates_status_ck check (status in ('OPEN', 'CLOSING', 'FINALIZED')),
  constraint usage_period_aggregates_period_ck check (
    period_start = date_trunc('month', period_start)::date
    and period_end = (period_start + interval '1 month' - interval '1 day')::date),
  constraint usage_period_aggregates_final_ck check (
    status <> 'FINALIZED' or (finalized_at is not null and source_hash ~ '^sha256:[0-9a-f]{64}$'
                              and allowance_status is not null)),
  constraint usage_period_aggregates_allowance_ck check (
    allowance_status is null or allowance_status in ('NO_ALLOWANCE', 'WITHIN', 'OVER')),
  constraint usage_period_aggregates_policy_ck check (overage_policy is null or overage_policy in ('BLOCK', 'ALLOW')),
  constraint usage_period_aggregates_counts_ck check (event_count >= 0 and late_event_count between 0 and event_count)
);

create unique index usage_period_aggregates_uk on platform.usage_period_aggregates (tenant_id, meter_id, period_start);
create index usage_period_aggregates_status_ix on platform.usage_period_aggregates (status, period_start);
create index usage_period_aggregates_meter_ix on platform.usage_period_aggregates (meter_id);
create index usage_period_aggregates_product_ix on platform.usage_period_aggregates (saas_product_id);
create index usage_period_aggregates_finalized_by_ix on platform.usage_period_aggregates (finalized_by) where finalized_by is not null;
create trigger usage_period_aggregates_set_updated_at before update on platform.usage_period_aggregates
  for each row execute function platform.set_updated_at();

comment on table platform.usage_period_aggregates is
  'Agregado de uso por tenant × medidor × período (spec §11.4). La única fuente de facturación '
  'de uso: nunca se factura desde eventos crudos. FINALIZED es inmutable.';

create or replace function platform.usage_aggregates_guard()
returns trigger
language plpgsql
set search_path = platform, pg_catalog
as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    raise exception 'AGREGADO_INMUTABLE: los agregados de uso no se borran' using errcode = '55000';
  end if;
  if old.status = 'FINALIZED' then
    raise exception 'AGREGADO_FINALIZADO: % es inmutable; un evento tardío va al período siguiente', old.id
      using errcode = '55000';
  end if;
  if (old.status = 'CLOSING' and new.status = 'OPEN') then
    raise exception 'TRANSICION_INVALIDA: % → %', old.status, new.status using errcode = '55000';
  end if;
  if new.tenant_id <> old.tenant_id or new.meter_id <> old.meter_id or new.period_start <> old.period_start then
    raise exception 'AGREGADO_INMUTABLE: la clave del agregado no cambia' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function platform.usage_aggregates_guard() from public, anon, authenticated;

create trigger usage_period_aggregates_guard before update or delete on platform.usage_period_aggregates
  for each row execute function platform.usage_aggregates_guard();
create trigger usage_period_aggregates_no_truncate before truncate on platform.usage_period_aggregates
  for each statement execute function platform.usage_aggregates_guard();

alter table platform.usage_period_aggregates enable row level security;
alter table platform.usage_period_aggregates force row level security;
revoke all on platform.usage_period_aggregates from public, anon, authenticated;
grant select on platform.usage_period_aggregates to authenticated;
grant select on platform.usage_period_aggregates to service_role;
create policy usage_period_aggregates_select on platform.usage_period_aggregates
  for select to authenticated using (platform.can_read_tenant(tenant_id));

create view platform.v_usage_period_aggregates
with (security_invoker = true) as
  select a.id, a.tenant_id, t.slug as tenant_slug, a.saas_product_id, p.code as product_code, a.meter_code,
         m.unit, a.period_start, a.period_end, a.status, a.event_count, a.late_event_count, a.quantity,
         a.allowance_included, a.overage_quantity, a.allowance_status, a.overage_policy, a.is_billable,
         a.source_hash, a.finalized_at
    from platform.usage_period_aggregates a
    join platform.tenants t on t.id = a.tenant_id
    join platform.saas_products p on p.id = a.saas_product_id
    join platform.usage_meters m on m.id = a.meter_id;
revoke all on platform.v_usage_period_aggregates from public, anon, authenticated;
grant select on platform.v_usage_period_aggregates to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. usage_alerts (append-only)
-- ---------------------------------------------------------------------------
create table platform.usage_alerts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid references platform.tenants (id) on delete restrict,
  saas_product_id uuid references platform.saas_products (id) on delete restrict,
  aggregate_id    uuid references platform.usage_period_aggregates (id) on delete restrict,
  code            text not null,
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  constraint usage_alerts_code_ck check (code ~ '^[A-Z][A-Z_]{2,60}$')
);
create index usage_alerts_aggregate_ix on platform.usage_alerts (aggregate_id);
create index usage_alerts_created_ix on platform.usage_alerts (created_at desc);
create index usage_alerts_tenant_ix on platform.usage_alerts (tenant_id) where tenant_id is not null;
create index usage_alerts_product_ix on platform.usage_alerts (saas_product_id) where saas_product_id is not null;

create trigger usage_alerts_no_update_delete before update or delete on platform.usage_alerts
  for each row execute function platform.usage_append_only();
create trigger usage_alerts_no_truncate before truncate on platform.usage_alerts
  for each statement execute function platform.usage_append_only();

alter table platform.usage_alerts enable row level security;
alter table platform.usage_alerts force row level security;
revoke all on platform.usage_alerts from public, anon, authenticated;
grant select on platform.usage_alerts to authenticated;
grant select on platform.usage_alerts to service_role;
create policy usage_alerts_select on platform.usage_alerts
  for select to authenticated using (platform.can_read_finance() or platform.can_manage_platform_entities());

-- ---------------------------------------------------------------------------
-- 3. Ingest → agregado OPEN; política de eventos tardíos
-- ---------------------------------------------------------------------------
create or replace function platform.usage_events_open_aggregate()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  insert into platform.usage_period_aggregates (tenant_id, saas_product_id, meter_id, meter_code, period_start, period_end)
  values (new.tenant_id, new.saas_product_id, new.meter_id, new.meter_code, new.period_start,
          (new.period_start + interval '1 month' - interval '1 day')::date)
  on conflict (tenant_id, meter_id, period_start) do nothing;
  return null;
end;
$$;
revoke all on function platform.usage_events_open_aggregate() from public, anon, authenticated;

create trigger usage_events_open_aggregate after insert on platform.usage_events
  for each row execute function platform.usage_events_open_aggregate();

create or replace function platform.usage_assign_period(
  p_tenant_id uuid, p_meter_id uuid, p_occurred_at timestamptz,
  out period_start date, out late boolean
)
language plpgsql
stable
set search_path = platform, pg_catalog
as $$
declare
  v_natural date := date_trunc('month', p_occurred_at at time zone 'UTC')::date;
  v_period  date := v_natural;
begin
  -- Avanza mientras el período esté FINALIZED (un agregado ausente es abierto).
  while exists (select 1 from platform.usage_period_aggregates a
                 where a.tenant_id = p_tenant_id and a.meter_id = p_meter_id
                   and a.period_start = v_period and a.status = 'FINALIZED') loop
    v_period := (v_period + interval '1 month')::date;
  end loop;
  period_start := v_period;
  late := v_period <> v_natural;
end;
$$;
revoke all on function platform.usage_assign_period(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function platform.usage_assign_period(uuid, uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Cierre
-- ---------------------------------------------------------------------------
create or replace function platform.close_usage_periods(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_now  timestamptz := least(coalesce(p_now, now()), now());
  v_rows integer;
begin
  if not platform.is_service_request() then
    raise exception 'NO_AUTORIZADO: el cierre de períodos lo ejecuta el job de servidor' using errcode = '42501';
  end if;
  update platform.usage_period_aggregates a
     set status = 'CLOSING', closing_at = now()
    from platform.usage_meters m
   where m.id = a.meter_id and a.status = 'OPEN'
     and ((a.period_start + interval '1 month')::timestamp at time zone 'UTC') + make_interval(hours => m.grace_hours) <= v_now;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
revoke all on function platform.close_usage_periods(timestamptz) from public, anon, authenticated;
grant execute on function platform.close_usage_periods(timestamptz) to service_role;

-- Núcleo de la finalización (sin control de autoridad; lo llaman las RPCs).
create or replace function platform.usage_finalize_core(p_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_agg      platform.usage_period_aggregates;
  v_meter    platform.usage_meters;
  v_type     platform.tenant_type;
  v_qty      numeric;
  v_count    integer;
  v_late     integer;
  v_hash     text;
  v_included numeric;
  v_status   text;
  v_overage  numeric;
  v_policy   text;
  v_billable boolean;
begin
  select * into v_agg from platform.usage_period_aggregates where id = p_id for update;
  if v_agg.id is null then
    raise exception 'AGREGADO_NO_ENCONTRADO: %', p_id using errcode = 'P0002';
  end if;
  if v_agg.status = 'FINALIZED' then
    raise exception 'AGREGADO_FINALIZADO: % ya está finalizado' , p_id using errcode = '55000';
  end if;
  if v_agg.status <> 'CLOSING' then
    raise exception 'AGREGADO_ABIERTO: % sigue OPEN; se finaliza tras su ventana de gracia', p_id using errcode = '55000';
  end if;
  select * into v_meter from platform.usage_meters where id = v_agg.meter_id;
  select tenant_type into v_type from platform.tenants where id = v_agg.tenant_id;

  select case v_meter.aggregation
           when 'SUM' then coalesce(sum(e.quantity), 0)
           when 'MAX' then coalesce(max(e.quantity), 0)
           else count(distinct e.subject_ref)::numeric
         end,
         count(*)::int,
         count(*) filter (where e.late)::int,
         'sha256:' || encode(sha256(convert_to(coalesce(string_agg(e.event_id::text, ',' order by e.event_id::text), ''), 'UTF8')), 'hex')
    into v_qty, v_count, v_late, v_hash
    from platform.usage_events e
   where e.tenant_id = v_agg.tenant_id and e.meter_id = v_agg.meter_id and e.period_start = v_agg.period_start;

  -- Asignación concedida al cierre del período (último instante del mes).
  select sum(c.included) into v_included
    from platform.compute_entitlements(
           v_agg.tenant_id, v_agg.saas_product_id,
           ((v_agg.period_start + interval '1 month')::timestamp at time zone 'UTC') - interval '1 second') c
   where c.kind = 'ALLOWANCE' and c.meter_code = v_meter.code and c.included is not null;

  if v_included is null then
    v_status := 'NO_ALLOWANCE';
  else
    v_overage := greatest(v_qty - v_included, 0);
    v_status := case when v_overage > 0 then 'OVER' else 'WITHIN' end;
    -- Contrato v1: overageMode BLOCK (sin precio de exceso, D-02/D-06).
    v_policy := case when v_overage > 0 then 'BLOCK' end;
  end if;
  v_billable := v_meter.is_billable and v_type not in ('DEMO', 'SANDBOX');

  update platform.usage_period_aggregates
     set status = 'FINALIZED', quantity = v_qty, event_count = v_count, late_event_count = v_late,
         source_hash = v_hash, allowance_included = v_included, overage_quantity = v_overage,
         allowance_status = v_status, overage_policy = v_policy, is_billable = v_billable,
         finalized_at = now(), finalized_by = p_actor
   where id = p_id;

  if v_status = 'OVER' then
    insert into platform.usage_alerts (tenant_id, saas_product_id, aggregate_id, code, detail)
    values (v_agg.tenant_id, v_agg.saas_product_id, p_id, 'OVERAGE_UNDER_BLOCK_POLICY',
            jsonb_build_object('meter', v_meter.code, 'period', v_agg.period_start, 'quantity', v_qty,
                               'included', v_included, 'overage', v_overage));
  end if;

  perform platform.log_audit('USAGE_AGGREGATE_FINALIZED', 'usage_period_aggregate', p_id::text, null, v_agg.tenant_id,
    jsonb_build_object('meter', v_meter.code, 'period', v_agg.period_start, 'quantity', v_qty, 'events', v_count,
                       'late', v_late, 'source_hash', v_hash, 'allowance', v_status, 'billable', v_billable));
  return jsonb_build_object('id', p_id, 'quantity', v_qty, 'eventCount', v_count, 'lateEventCount', v_late,
                            'sourceHash', v_hash, 'allowanceStatus', v_status, 'overage', v_overage,
                            'isBillable', v_billable);
end;
$$;
revoke all on function platform.usage_finalize_core(uuid, uuid) from public, anon, authenticated;

-- Finanzas (persona identificada) o el job de servidor.
create or replace function platform.finalize_usage_aggregate(p_aggregate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if not (platform.is_service_request() or (platform.can_read_finance() and auth.uid() is not null)) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el job de servidor finalizan agregados de uso'
      using errcode = '42501';
  end if;
  return platform.usage_finalize_core(p_aggregate_id, case when platform.is_service_request() then null else auth.uid() end);
end;
$$;
revoke all on function platform.finalize_usage_aggregate(uuid) from public, anon;
grant execute on function platform.finalize_usage_aggregate(uuid) to authenticated, service_role;

create or replace function platform.finalize_due_usage_aggregates(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id uuid;
  v_n  integer := 0;
begin
  if not platform.is_service_request() then
    raise exception 'NO_AUTORIZADO: job de servidor' using errcode = '42501';
  end if;
  for v_id in
    select id from platform.usage_period_aggregates
     where status = 'CLOSING'
     order by period_start, id
     limit greatest(1, least(coalesce(p_limit, 100), 1000))
     for update skip locked
  loop
    perform platform.usage_finalize_core(v_id, null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function platform.finalize_due_usage_aggregates(integer) from public, anon, authenticated;
grant execute on function platform.finalize_due_usage_aggregates(integer) to service_role;
