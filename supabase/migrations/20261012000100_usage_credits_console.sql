-- ============================================================================
-- MasterAdmin · M4 · Complementos de base para la consola de uso y créditos
-- ----------------------------------------------------------------------------
-- Spec §5 (+ huecos encontrados al construir las pantallas M4):
--   1. close_usage_aggregate — finanzas pasa un agregado OPEN a CLOSING cuando
--      su período terminó, sin depender del job close_usage_periods (D-07).
--   2. usage_alert_acks + acknowledge_usage_alert + v_usage_alerts — acuse de
--      alertas (finanzas o admin de producto). usage_alerts sigue append-only:
--      el acuse vive en su propia tabla, también append-only (un acuse por alerta).
--   3. end_ai_credit_policy — finanzas cierra la vigencia de una política
--      (respeta el guard: valid_to se fija una sola vez; sin cierre retroactivo).
--   4. v_usage_period_aggregates gana meter_id, closing_at y finalized_by AL
--      FINAL (columnas y orden previos intactos; sigue security_invoker).
--   5. clear_catalog_item_usage_binding — quitar el vínculo METER/AI_CREDIT de
--      un ítem PER_UNIT (auditado). No afecta facturas emitidas: el importe de
--      una línea ya emitida no depende del vínculo vivo.
--   6. Lectura de finanzas del eje BILLING sin gestionar integraciones:
--      v_commercial_cutover_axes y v_commercial_cutover_history, vistas
--      security_invoker sobre funciones SECURITY DEFINER que exponen SOLO
--      columnas comerciales (producto, integración, ejes, usage_ingest_enabled,
--      updated_at) a quien puede leer finanzas, gestionar lo comercial o leer
--      la integración. Ningún permiso de escritura cambia.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. close_usage_aggregate
-- ---------------------------------------------------------------------------
create or replace function platform.close_usage_aggregate(p_aggregate_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_agg platform.usage_period_aggregates;
  v_end timestamptz;
begin
  if not (platform.can_read_finance() and auth.uid() is not null) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE cierra períodos de uso' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO' using errcode = '23502';
  end if;

  select * into v_agg from platform.usage_period_aggregates where id = p_aggregate_id for update;
  if v_agg.id is null then
    raise exception 'AGREGADO_NO_ENCONTRADO: %', p_aggregate_id using errcode = 'P0002';
  end if;
  if v_agg.status = 'CLOSING' then
    return jsonb_build_object('id', v_agg.id, 'status', 'CLOSING', 'duplicate', true);
  end if;
  if v_agg.status <> 'OPEN' then
    raise exception 'AGREGADO_FINALIZADO: % ya está finalizado', p_aggregate_id using errcode = '55000';
  end if;

  -- Fin del período: primer instante del mes siguiente (UTC, D-10).
  v_end := (v_agg.period_start + interval '1 month')::timestamp at time zone 'UTC';
  if v_end > now() then
    raise exception 'PERIODO_NO_TERMINADO: el período % termina el %', v_agg.period_start, v_end
      using errcode = '55000';
  end if;

  update platform.usage_period_aggregates
     set status = 'CLOSING', closing_at = now()
   where id = v_agg.id;

  perform platform.log_audit('USAGE_AGGREGATE_CLOSED', 'usage_period_aggregate', v_agg.id::text, null, v_agg.tenant_id,
    jsonb_build_object('meter', v_agg.meter_code, 'period', v_agg.period_start, 'reason', trim(p_reason),
                       'source', 'CONSOLE'));
  return jsonb_build_object('id', v_agg.id, 'status', 'CLOSING', 'duplicate', false);
end;
$$;

comment on function platform.close_usage_aggregate(uuid, text) is
  'EBIM_FINANCE. OPEN → CLOSING de un agregado cuyo período (mes UTC) ya terminó, con motivo y auditoría. '
  'No espera la gracia del medidor: es una decisión humana. Idempotente si ya está CLOSING.';

revoke all on function platform.close_usage_aggregate(uuid, text) from public, anon;
grant execute on function platform.close_usage_aggregate(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Acuse de alertas de uso
-- ---------------------------------------------------------------------------
create table platform.usage_alert_acks (
  id               uuid primary key default gen_random_uuid(),
  alert_id         uuid not null references platform.usage_alerts (id) on delete restrict,
  note             text,
  acknowledged_by  uuid not null references platform.profiles (id) on delete restrict,
  acknowledged_at  timestamptz not null default now(),
  constraint usage_alert_acks_alert_uk unique (alert_id),
  constraint usage_alert_acks_note_ck check (note is null or length(note) between 1 and 1000)
);
create index usage_alert_acks_by_ix on platform.usage_alert_acks (acknowledged_by);

comment on table platform.usage_alert_acks is
  'Acuse de una alerta de uso (spec §5). Append-only y uno por alerta: usage_alerts no se modifica.';

create trigger usage_alert_acks_no_update_delete before update or delete on platform.usage_alert_acks
  for each row execute function platform.usage_append_only();
create trigger usage_alert_acks_no_truncate before truncate on platform.usage_alert_acks
  for each statement execute function platform.usage_append_only();

alter table platform.usage_alert_acks enable row level security;
alter table platform.usage_alert_acks force row level security;
revoke all on platform.usage_alert_acks from public, anon, authenticated;
grant select on platform.usage_alert_acks to authenticated;
grant select on platform.usage_alert_acks to service_role;
create policy usage_alert_acks_select on platform.usage_alert_acks
  for select to authenticated using (platform.can_read_finance() or platform.can_manage_platform_entities());

create or replace function platform.acknowledge_usage_alert(p_alert_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_alert platform.usage_alerts;
  v_ack   platform.usage_alert_acks;
  v_note  text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not ((platform.can_read_finance() or platform.can_manage_platform_entities()) and auth.uid() is not null) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o EBIM_PRODUCT_ADMIN dan acuse de alertas de uso'
      using errcode = '42501';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'NOTA_DEMASIADO_LARGA: máximo 1000 caracteres' using errcode = '22001';
  end if;

  select * into v_alert from platform.usage_alerts where id = p_alert_id;
  if v_alert.id is null then
    raise exception 'ALERTA_NO_ENCONTRADA: %', p_alert_id using errcode = 'P0002';
  end if;

  insert into platform.usage_alert_acks (alert_id, note, acknowledged_by)
  values (v_alert.id, v_note, auth.uid())
  on conflict (alert_id) do nothing
  returning * into v_ack;

  if v_ack.id is null then
    select * into v_ack from platform.usage_alert_acks where alert_id = v_alert.id;
    return jsonb_build_object('ack_id', v_ack.id, 'alert_id', v_alert.id, 'duplicate', true,
                              'acknowledged_at', v_ack.acknowledged_at);
  end if;

  perform platform.log_audit('USAGE_ALERT_ACKNOWLEDGED', 'usage_alert', v_alert.id::text, null, v_alert.tenant_id,
    jsonb_build_object('code', v_alert.code, 'note', v_note));
  return jsonb_build_object('ack_id', v_ack.id, 'alert_id', v_alert.id, 'duplicate', false,
                            'acknowledged_at', v_ack.acknowledged_at);
end;
$$;

comment on function platform.acknowledge_usage_alert(uuid, text) is
  'EBIM_FINANCE o EBIM_PRODUCT_ADMIN. Acuse de una alerta de uso con nota opcional; idempotente '
  '(un acuse por alerta). La alerta no cambia: usage_alerts es append-only.';

revoke all on function platform.acknowledge_usage_alert(uuid, text) from public, anon;
grant execute on function platform.acknowledge_usage_alert(uuid, text) to authenticated;

create view platform.v_usage_alerts
with (security_invoker = true) as
  select a.id, a.tenant_id, a.saas_product_id, a.aggregate_id, a.code, a.detail, a.created_at,
         k.id is not null as acknowledged,
         k.id as ack_id, k.note as ack_note, k.acknowledged_by, k.acknowledged_at,
         pr.full_name as acknowledged_by_name
    from platform.usage_alerts a
    left join platform.usage_alert_acks k on k.alert_id = a.id
    left join platform.profiles pr on pr.id = k.acknowledged_by;

comment on view platform.v_usage_alerts is
  'Alertas de uso con su acuse (security_invoker: RLS de usage_alerts y usage_alert_acks).';

revoke all on platform.v_usage_alerts from public, anon, authenticated;
grant select on platform.v_usage_alerts to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. end_ai_credit_policy
-- ---------------------------------------------------------------------------
create or replace function platform.end_ai_credit_policy(p_policy_id uuid, p_valid_to date, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_policy platform.ai_credit_policies;
begin
  if not (platform.can_read_finance() and auth.uid() is not null) then
    raise exception 'NO_AUTORIZADO: las políticas de créditos son de EBIM_FINANCE (D-03)' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO' using errcode = '23502';
  end if;
  if p_valid_to is null then
    raise exception 'FECHA_REQUERIDA: indica hasta cuándo rige la política' using errcode = '23502';
  end if;

  select * into v_policy from platform.ai_credit_policies where id = p_policy_id for update;
  if v_policy.id is null then
    raise exception 'POLITICA_NO_ENCONTRADA: %', p_policy_id using errcode = 'P0002';
  end if;
  if v_policy.valid_to is not null then
    raise exception 'POLITICA_YA_CERRADA: rige hasta %; valid_to se fija una sola vez', v_policy.valid_to
      using errcode = '55000';
  end if;
  if p_valid_to <= v_policy.valid_from then
    raise exception 'FECHA_INVALIDA: el cierre (%) debe ser posterior al inicio (%)', p_valid_to, v_policy.valid_from
      using errcode = '22023';
  end if;
  -- Sin cierre retroactivo: los períodos ya concedidos con esta política no cambian.
  if p_valid_to < current_date then
    raise exception 'CIERRE_RETROACTIVO: la vigencia no se cierra en el pasado (%)', p_valid_to using errcode = '22023';
  end if;

  update platform.ai_credit_policies set valid_to = p_valid_to where id = v_policy.id;

  perform platform.log_audit('AI_CREDIT_POLICY_ENDED', 'ai_credit_policy', v_policy.id::text, null, null,
    jsonb_build_object('valid_from', v_policy.valid_from, 'valid_to', p_valid_to, 'reason', trim(p_reason)));
  return jsonb_build_object('id', v_policy.id, 'valid_from', v_policy.valid_from, 'valid_to', p_valid_to);
end;
$$;

comment on function platform.end_ai_credit_policy(uuid, date, text) is
  'EBIM_FINANCE. Cierra la vigencia de una política de créditos (valid_to exclusivo, una sola vez, '
  'nunca en el pasado) con motivo y auditoría.';

revoke all on function platform.end_ai_credit_policy(uuid, date, text) from public, anon;
grant execute on function platform.end_ai_credit_policy(uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. v_usage_period_aggregates extendida (columnas nuevas AL FINAL)
-- ---------------------------------------------------------------------------
create or replace view platform.v_usage_period_aggregates
with (security_invoker = true) as
  select a.id, a.tenant_id, t.slug as tenant_slug, a.saas_product_id, p.code as product_code, a.meter_code,
         m.unit, a.period_start, a.period_end, a.status, a.event_count, a.late_event_count, a.quantity,
         a.allowance_included, a.overage_quantity, a.allowance_status, a.overage_policy, a.is_billable,
         a.source_hash, a.finalized_at,
         a.meter_id, a.closing_at, a.finalized_by
    from platform.usage_period_aggregates a
    join platform.tenants t on t.id = a.tenant_id
    join platform.saas_products p on p.id = a.saas_product_id
    join platform.usage_meters m on m.id = a.meter_id;
revoke all on platform.v_usage_period_aggregates from public, anon, authenticated;
grant select on platform.v_usage_period_aggregates to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. clear_catalog_item_usage_binding
-- ---------------------------------------------------------------------------
create or replace function platform.clear_catalog_item_usage_binding(p_catalog_item_code text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_item  platform.catalog_items;
  v_meter text;
begin
  if not platform.can_manage_regional_catalog() then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin deciden cómo se tarifa el uso' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO' using errcode = '23502';
  end if;
  select * into v_item from platform.catalog_items where code = p_catalog_item_code for update;
  if v_item.id is null then
    raise exception 'ADDON_NO_ENCONTRADO: %', p_catalog_item_code using errcode = '23503';
  end if;
  if v_item.per_unit_source is null then
    return jsonb_build_object('catalog_item', v_item.code, 'source', null, 'duplicate', true);
  end if;

  select code into v_meter from platform.usage_meters where id = v_item.usage_meter_id;

  update platform.catalog_items
     set per_unit_source = null, usage_meter_id = null
   where id = v_item.id;

  perform platform.log_audit('CATALOG_ITEM_USAGE_BINDING_CLEARED', 'catalog_item', v_item.id::text, null, null,
    jsonb_build_object('code', v_item.code, 'previous_source', v_item.per_unit_source,
                       'previous_meter', v_meter, 'reason', trim(p_reason)));
  return jsonb_build_object('catalog_item', v_item.code, 'source', null, 'duplicate', false);
end;
$$;

comment on function platform.clear_catalog_item_usage_binding(text, text) is
  'EBIM_FINANCE / super admin. Quita el vínculo METER/AI_CREDIT de un ítem PER_UNIT (auditado). '
  'El uso de ese medidor/pool deja de tarifarse en las facturas que se emitan después; las emitidas no cambian.';

revoke all on function platform.clear_catalog_item_usage_binding(text, text) from public, anon;
grant execute on function platform.clear_catalog_item_usage_binding(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Lectura comercial del cutover (eje BILLING) para finanzas
-- ---------------------------------------------------------------------------
-- product_integrations exige platform.integration.read (contrato M2M, rutas,
-- scopes…). Finanzas necesita el EJE, no la integración: estas funciones
-- devuelven solo columnas comerciales y filtran por fila con la misma regla.
create or replace function platform.can_read_commercial_cutover(p_saas_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select platform.can_read_finance()
      or platform.can_manage_commercial()
      or platform.has_product_permission('platform.integration.read', p_saas_product_id);
$$;

create or replace function platform.commercial_cutover_axes()
returns table (
  integration_id             uuid,
  integration_code           text,
  integration_name           text,
  saas_product_id            uuid,
  product_code               text,
  product_short_name         text,
  cutover_state_billing      text,
  cutover_state_entitlements text,
  usage_ingest_enabled       boolean,
  updated_at                 timestamptz
)
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select i.id, i.code, i.name, i.saas_product_id, p.code, p.short_name,
         i.cutover_state_billing, i.cutover_state_entitlements, i.usage_ingest_enabled, i.updated_at
    from platform.product_integrations i
    join platform.saas_products p on p.id = i.saas_product_id
   where auth.uid() is not null
     and platform.can_read_commercial_cutover(i.saas_product_id)
   order by p.short_name, i.code;
$$;

create or replace function platform.commercial_cutover_history()
returns table (
  id               bigint,
  integration_id   uuid,
  integration_code text,
  saas_product_id  uuid,
  product_code     text,
  axis             text,
  from_state       text,
  to_state         text,
  reason           text,
  actor_user_id    uuid,
  actor_name       text,
  occurred_at      timestamptz
)
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select e.id, i.id, i.code, i.saas_product_id, p.code, e.axis, e.from_state, e.to_state, e.reason,
         e.actor_user_id, pr.full_name, e.occurred_at
    from platform.commercial_cutover_events e
    join platform.product_integrations i on i.id = e.product_integration_id
    join platform.saas_products p on p.id = i.saas_product_id
    left join platform.profiles pr on pr.id = e.actor_user_id
   where auth.uid() is not null
     and e.axis = 'BILLING'
     and platform.can_read_commercial_cutover(i.saas_product_id)
   order by e.occurred_at desc, e.id desc;
$$;

revoke all on function platform.can_read_commercial_cutover(uuid) from public, anon;
revoke all on function platform.commercial_cutover_axes() from public, anon;
revoke all on function platform.commercial_cutover_history() from public, anon;
grant execute on function platform.can_read_commercial_cutover(uuid) to authenticated;
grant execute on function platform.commercial_cutover_axes() to authenticated;
grant execute on function platform.commercial_cutover_history() to authenticated;

create view platform.v_commercial_cutover_axes
with (security_invoker = true) as
  select * from platform.commercial_cutover_axes();

create view platform.v_commercial_cutover_history
with (security_invoker = true) as
  select * from platform.commercial_cutover_history();

comment on view platform.v_commercial_cutover_axes is
  'Ejes de cutover por integración (BILLING, ENTITLEMENTS) y usage_ingest_enabled, sin el contrato M2M. '
  'Visible a finanzas, gestión comercial o quien lee la integración. Solo lectura.';
comment on view platform.v_commercial_cutover_history is
  'Historial del eje BILLING (commercial_cutover_events) con la misma visibilidad que v_commercial_cutover_axes.';

revoke all on platform.v_commercial_cutover_axes from public, anon, authenticated;
revoke all on platform.v_commercial_cutover_history from public, anon, authenticated;
grant select on platform.v_commercial_cutover_axes to authenticated;
grant select on platform.v_commercial_cutover_history to authenticated;
