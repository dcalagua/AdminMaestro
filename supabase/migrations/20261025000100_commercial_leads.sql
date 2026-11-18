-- Solicitudes de la web (leads.v1, 2026-11-17).
--
-- La landing de cada app de la suite (hoy eChange, `echange.ebim.pe`) recoge pedidos de prueba y de
-- contacto. Hasta acá quedaban en la app y solo se veían en su consola: quien los convierte en
-- cliente, prueba y contrato trabaja AQUÍ, y obligarlo a mirar otra consola es como se pierde un
-- prospecto. Esto los trae.
--
-- Decisiones:
--  · **MasterAdmin LEE** (GET firmado M2M, el mismo canal que la sincronización de tenants): la
--    app no necesita una llave nueva ni saber dónde vive MasterAdmin.
--  · **Canal opcional por integración** (`leads_path` + `leads_read_scope`, los dos o ninguno),
--    con scope propio: leer prospectos no es leer tenants ni dar de alta.
--  · **Cursor por destino** (`lead_sync_state`): se pide desde el último leído; idempotente por
--    (destino, id externo), así una repetición no duplica.
--  · **El seguimiento vive acá**: NEW → CONTACTED → CONVERTED | DISCARDED. Una nueva lectura
--    actualiza los datos de contacto pero NUNCA el estado ni las notas.
--  · **Lo ve y lo trabaja el área comercial de EBIM** (`can_manage_commercial`): son prospectos de
--    EBIM; un partner no los ve. Escribir solo por RPC auditada.
--  · **Convertir = crear (o elegir) la cuenta cliente**: la solicitud queda enlazada a la
--    organización, y «Nueva venta» se abre con sus datos.

-- ---------------------------------------------------------------------------
-- 1. Canal leads.v1 en la integración
-- ---------------------------------------------------------------------------
alter table platform.product_integrations
  add column if not exists leads_path       text,
  add column if not exists leads_read_scope text;

alter table platform.product_integrations
  add constraint product_integrations_leads_path_ck check (
    leads_path is null or platform.is_safe_url_path(leads_path)),
  add constraint product_integrations_leads_scope_ck check (
    leads_read_scope is null
    or (leads_read_scope ~ '^[a-z0-9]+:leads:read$'
        and leads_read_scope is distinct from create_scope
        and leads_read_scope is distinct from read_scope
        and not (leads_read_scope = any (additional_scopes)))),
  add constraint product_integrations_leads_all_or_none_ck check (
    (leads_path is null) = (leads_read_scope is null));

comment on column platform.product_integrations.leads_path is
  'Ruta relativa de GET de solicitudes de la web (contrato leads.v1). NULL = la app no publica solicitudes.';
comment on column platform.product_integrations.leads_read_scope is
  'Scope del token M2M para leer solicitudes (eChange: echange:leads:read).';

-- eChange ya publica el canal (platform-provisioning `GET /leads`).
update platform.product_integrations
   set leads_path = '/leads', leads_read_scope = 'echange:leads:read'
 where code = 'echange-provisioning-v1' and leads_path is null;

-- ---------------------------------------------------------------------------
-- 2. Las solicitudes
-- ---------------------------------------------------------------------------
create table platform.commercial_leads (
  id                    uuid primary key default gen_random_uuid(),
  saas_product_id       uuid not null references platform.saas_products(id),
  deployment_target_id  uuid not null references platform.deployment_targets(id),
  external_id           text not null check (length(external_id) between 1 and 100),
  source                text not null default 'landing' check (length(source) between 1 and 60),
  received_at           timestamptz not null,
  contact_name          text not null check (length(contact_name) between 1 and 160),
  company_name          text not null check (length(company_name) between 1 and 200),
  email                 text not null check (length(email) between 3 and 200),
  phone                 text check (phone is null or length(phone) <= 40),
  team_size             text check (team_size is null or length(team_size) <= 20),
  plan_code             text check (plan_code is null or length(plan_code) <= 100),
  country_code          char(2) check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  message               text check (message is null or length(message) <= 4000),
  status                text not null default 'NEW'
                        check (status in ('NEW', 'CONTACTED', 'CONVERTED', 'DISCARDED')),
  status_note           text check (status_note is null or length(status_note) <= 1000),
  status_changed_at     timestamptz,
  status_changed_by     uuid,
  organization_id       uuid references platform.organizations(id) on delete set null,
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  constraint commercial_leads_unique_external unique (deployment_target_id, external_id),
  constraint commercial_leads_discard_has_note_ck check (status <> 'DISCARDED' or nullif(btrim(status_note), '') is not null),
  constraint commercial_leads_converted_has_org_ck check (status <> 'CONVERTED' or organization_id is not null)
);
create index commercial_leads_status_idx on platform.commercial_leads (status, received_at desc);
create index commercial_leads_org_idx on platform.commercial_leads (organization_id) where organization_id is not null;

comment on table platform.commercial_leads is
  'Solicitudes de prueba y contacto de las landings de la suite (leads.v1). Las escribe lead-sync; el seguimiento lo lleva el área comercial.';

alter table platform.commercial_leads enable row level security;
revoke all on table platform.commercial_leads from public, anon, authenticated;
grant select on table platform.commercial_leads to authenticated;
grant all on table platform.commercial_leads to service_role;

create policy commercial_leads_read on platform.commercial_leads
  for select to authenticated
  using ((select platform.can_manage_commercial()));

-- Estado de la lectura por destino.
create table platform.lead_sync_state (
  deployment_target_id  uuid primary key references platform.deployment_targets(id) on delete cascade,
  cursor                text check (cursor is null or length(cursor) <= 500),
  last_run_at           timestamptz,
  last_outcome          text check (last_outcome is null or last_outcome in ('OK', 'FAILED', 'NOT_CONFIGURED')),
  last_error_code       text check (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  last_received         integer not null default 0,
  last_new              integer not null default 0
);
alter table platform.lead_sync_state enable row level security;
revoke all on table platform.lead_sync_state from public, anon, authenticated;
grant select on table platform.lead_sync_state to authenticated;
grant all on table platform.lead_sync_state to service_role;
create policy lead_sync_state_read on platform.lead_sync_state
  for select to authenticated
  using ((select platform.can_manage_commercial()));

-- ---------------------------------------------------------------------------
-- 3. Plan y registro de la lectura (solo servidor)
-- ---------------------------------------------------------------------------
create or replace function platform.lead_sync_plan()
returns jsonb
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
begin
  if not platform.is_system_job() then
    raise exception 'SOLO_SERVIDOR: lead_sync_plan() resuelve configuración sensible' using errcode = '42501';
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
        'adapter_key', i.adapter_key::text, 'capabilities', '[]'::jsonb,
        'issuer', i.issuer, 'audience', i.audience, 'subject', i.subject,
        'algorithm', i.algorithm::text, 'token_ttl_seconds', i.token_ttl_seconds,
        'lifecycle_path', null, 'lifecycle_read_scope', null,
        'inventory_path', null, 'inventory_read_scope', null,
        'leads_path', i.leads_path, 'leads_read_scope', i.leads_read_scope,
        'allowed_hosts', to_jsonb(i.allowed_hosts)),
      'credential', case when c.id is null then null else jsonb_build_object(
        'id', c.id, 'type', c.type::text, 'enabled', c.enabled, 'algorithm', c.algorithm::text,
        'token_ttl_seconds', c.token_ttl_seconds,
        'secret_ref', c.secret_ref) end,
      'links', '[]'::jsonb,
      'cursor', s.cursor
    ) order by p.sort_order, d.code)
      from platform.deployment_targets d
      join platform.saas_products p on p.id = d.saas_product_id
      join platform.product_integrations i on i.id = d.product_integration_id
      left join platform.credential_profiles c on c.id = d.credential_profile_id
      left join platform.lead_sync_state s on s.deployment_target_id = d.id
     where d.status = 'ACTIVE' and i.enabled and i.leads_path is not null
  ), '[]'::jsonb);
end;
$$;
revoke all on function platform.lead_sync_plan() from public, anon, authenticated;
grant execute on function platform.lead_sync_plan() to service_role;

create or replace function platform.record_lead_sync(
  p_target_id  uuid,
  p_items      jsonb,
  p_cursor     text,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_product uuid;
  v_item    jsonb;
  v_new     integer := 0;
  v_seen    integer := 0;
  v_inserted boolean;
begin
  if not platform.is_system_job() then
    raise exception 'SOLO_SERVIDOR: las solicitudes las registra lead-sync' using errcode = '42501';
  end if;
  select saas_product_id into v_product from platform.deployment_targets where id = p_target_id;
  if v_product is null then
    raise exception 'DESTINO_NO_ENCONTRADO' using errcode = 'P0002';
  end if;

  if p_error_code is null then
    for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
      -- Un ítem sin lo mínimo se salta: no rompe la lectura de los demás.
      continue when nullif(v_item->>'externalId', '') is null
                 or nullif(btrim(v_item->>'name'), '') is null
                 or nullif(btrim(v_item->>'company'), '') is null
                 or nullif(btrim(v_item->>'email'), '') is null
                 or (v_item->>'receivedAt') is null;
      v_seen := v_seen + 1;
      insert into platform.commercial_leads as l (
        saas_product_id, deployment_target_id, external_id, source, received_at,
        contact_name, company_name, email, phone, team_size, plan_code, country_code, message)
      values (
        v_product, p_target_id, left(v_item->>'externalId', 100),
        coalesce(left(nullif(v_item->>'source', ''), 60), 'landing'),
        (v_item->>'receivedAt')::timestamptz,
        left(btrim(v_item->>'name'), 160), left(btrim(v_item->>'company'), 200),
        left(lower(btrim(v_item->>'email')), 200),
        left(nullif(btrim(v_item->>'phone'), ''), 40), left(nullif(v_item->>'teamSize', ''), 20),
        left(nullif(v_item->>'planInterest', ''), 100),
        case when (v_item->>'country') ~ '^[A-Z]{2}$' then v_item->>'country' end,
        left(nullif(btrim(v_item->>'message'), ''), 4000))
      on conflict (deployment_target_id, external_id) do update
        set contact_name = excluded.contact_name, company_name = excluded.company_name,
            email = excluded.email, phone = excluded.phone, team_size = excluded.team_size,
            plan_code = excluded.plan_code, country_code = excluded.country_code,
            message = excluded.message, last_seen_at = now()
      returning (xmax = 0) into v_inserted;
      if v_inserted then v_new := v_new + 1; end if;
    end loop;
  end if;

  insert into platform.lead_sync_state as s (deployment_target_id, cursor, last_run_at, last_outcome, last_error_code, last_received, last_new)
  values (p_target_id, nullif(p_cursor, ''), now(),
          case when p_error_code is null then 'OK'
               when p_error_code like '%NOT_CONFIGURED%' then 'NOT_CONFIGURED' else 'FAILED' end,
          p_error_code, v_seen, v_new)
  on conflict (deployment_target_id) do update
    set cursor = case when p_error_code is null then coalesce(nullif(p_cursor, ''), s.cursor) else s.cursor end,
        last_run_at = now(), last_outcome = excluded.last_outcome, last_error_code = excluded.last_error_code,
        last_received = excluded.last_received, last_new = excluded.last_new;

  return jsonb_build_object('received', v_seen, 'new', v_new);
end;
$$;
revoke all on function platform.record_lead_sync(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function platform.record_lead_sync(uuid, jsonb, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. El seguimiento comercial (auditado)
-- ---------------------------------------------------------------------------
create or replace function platform.set_commercial_lead_status(
  p_lead_id uuid,
  p_status  text,
  p_note    text default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_lead platform.commercial_leads;
begin
  if not platform.can_manage_commercial() then
    raise exception 'NO_AUTORIZADO: las solicitudes las trabaja el área comercial de EBIM' using errcode = '42501';
  end if;
  if p_status not in ('NEW', 'CONTACTED', 'DISCARDED') then
    -- CONVERTED se llega enlazando la cuenta (link_commercial_lead_organization).
    raise exception 'ESTADO_INVALIDO: %', p_status using errcode = '22023';
  end if;
  if p_status = 'DISCARDED' and nullif(btrim(p_note), '') is null then
    raise exception 'MOTIVO_REQUERIDO: descartar una solicitud exige decir por qué' using errcode = '22023';
  end if;
  select * into v_lead from platform.commercial_leads where id = p_lead_id for update;
  if v_lead.id is null then
    raise exception 'SOLICITUD_NO_ENCONTRADA' using errcode = 'P0002';
  end if;

  update platform.commercial_leads
     set status = p_status,
         status_note = coalesce(nullif(btrim(p_note), ''), case when p_status = v_lead.status then status_note end),
         status_changed_at = now(), status_changed_by = auth.uid(),
         organization_id = case when p_status = 'NEW' then null else organization_id end
   where id = p_lead_id;

  perform platform.log_audit('COMMERCIAL_LEAD_STATUS_CHANGED', 'commercial_lead', p_lead_id::text,
    v_lead.organization_id, null,
    jsonb_build_object('from', v_lead.status, 'to', p_status, 'note', nullif(btrim(p_note), '')));
  return p_lead_id;
end;
$$;
revoke all on function platform.set_commercial_lead_status(uuid, text, text) from public, anon;
grant execute on function platform.set_commercial_lead_status(uuid, text, text) to authenticated, service_role;

create or replace function platform.link_commercial_lead_organization(
  p_lead_id         uuid,
  p_organization_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_lead platform.commercial_leads;
begin
  if not platform.can_manage_commercial() then
    raise exception 'NO_AUTORIZADO: las solicitudes las trabaja el área comercial de EBIM' using errcode = '42501';
  end if;
  if not exists (select 1 from platform.organizations o where o.id = p_organization_id) then
    raise exception 'ORGANIZACION_NO_ENCONTRADA' using errcode = 'P0002';
  end if;
  select * into v_lead from platform.commercial_leads where id = p_lead_id for update;
  if v_lead.id is null then
    raise exception 'SOLICITUD_NO_ENCONTRADA' using errcode = 'P0002';
  end if;

  update platform.commercial_leads
     set organization_id = p_organization_id, status = 'CONVERTED',
         status_changed_at = now(), status_changed_by = auth.uid()
   where id = p_lead_id;

  perform platform.log_audit('COMMERCIAL_LEAD_CONVERTED', 'commercial_lead', p_lead_id::text,
    p_organization_id, null, jsonb_build_object('from', v_lead.status));
  return p_lead_id;
end;
$$;
revoke all on function platform.link_commercial_lead_organization(uuid, uuid) from public, anon;
grant execute on function platform.link_commercial_lead_organization(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. El job: cada 10 minutos, por la misma puerta que los demás
-- ---------------------------------------------------------------------------
alter table platform.lifecycle_job_runs drop constraint if exists lifecycle_job_runs_job_ck;
alter table platform.lifecycle_job_runs
  add constraint lifecycle_job_runs_job_ck
  check (job in ('LIFECYCLE_CYCLE', 'ENTITLEMENT_SYNC', 'ENTITLEMENT_SWEEP', 'AUTOCHARGE', 'TENANT_SYNC', 'MAIL_DISPATCH', 'LEAD_SYNC'));

-- Se inyecta la rama nueva sobre la definición vigente (no se transcribe la función).
do $$
declare
  v_def text := pg_get_functiondef('platform.invoke_scheduled_function(text)'::regprocedure);
  v_marca text := $m$    else
      raise exception 'JOB_DESCONOCIDO: %', p_job using errcode = '22023';$m$;
begin
  if position('''LEAD_SYNC''' in v_def) > 0 then
    return;
  end if;
  if position(v_marca in v_def) = 0 then
    raise exception 'invoke_scheduled_function cambió: no se encontró la rama ELSE';
  end if;
  v_def := replace(v_def, v_marca, $m$    when 'LEAD_SYNC' then
      v_function := 'lead-sync'; v_body := '{"trigger":"SCHEDULED"}'::jsonb;
      v_enabled := true;
$m$ || v_marca);
  execute v_def;
end $$;
revoke all on function platform.invoke_scheduled_function(text) from public, anon, authenticated, service_role;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('ebim-lead-sync', '*/10 * * * *',
      $job$select platform.invoke_scheduled_function('LEAD_SYNC')
             where exists (select 1 from platform.product_integrations i where i.enabled and i.leads_path is not null)$job$);
  end if;
end $$;
