-- ============================================================================
-- Ciclo de vida del tenant en la suite: impago → suspensión gobernada →
-- reactivación al pagar (decisión D-07, cerrada como CONFIGURACIÓN)
-- ----------------------------------------------------------------------------
-- Brecha (diagnóstico 2026-10-11): MasterAdmin daba de alta tenants en las 8
-- apps pero no podía cortarlos ni reactivarlos, y nada corría solo:
--   · `apply_due_suspensions` cambiaba el estado, pero el entitlement de la app
--     no se marcaba como cambiado: `appActive=false` llegaba (si llegaba) en el
--     barrido diario;
--   · al pagar solo se cerraban las alertas: el tenant seguía SUSPENDED;
--   · ninguna función podía correr desde pg_cron: todas exigían un usuario
--     con rol de plataforma (`auth.uid()`), que un job no tiene.
--
-- Esta migración:
--   1. `is_system_job()`: el job de mantenimiento (pg_cron, sesión postgres sin
--      rol de PostgREST) o la clave de servicio. Un usuario `authenticated`
--      nunca lo es, aunque la sesión de pgTAP sea postgres.
--   2. Separa autorización de efecto en `set_tenant_status`,
--      `enqueue_provisioning_request` y `refresh_billing_alerts`: la RPC pública
--      conserva su guardia; el núcleo `_…_core` no tiene GRANT y solo lo usan
--      funciones de esta base.
--   3. `tenant_suspensions`: historial de suspensiones con CAUSA (impago o
--      manual). Solo una suspensión por impago se levanta sola al pagar: una
--      suspensión manual la levanta una persona.
--   4. Cada cambio de estado del tenant marca el entitlement como cambiado
--      (`appActive` del snapshot), así la app se entera en el próximo push.
--   5. `run_tenant_lifecycle_cycle()`: refresca alertas, suspende por impago y
--      reactiva lo ya pagado. Dos interruptores globales del super admin:
--      `auto_suspend_enabled` (por defecto APAGADO) y `auto_resume_enabled`
--      (encendido). Además cada suscripción conserva su `auto_suspend`.
--   6. Reactivación inmediata en el trigger de pagos CONFIRMED.
--   7. pg_cron: el ciclo diario se programa aquí (sin URL ni claves, y con la
--      suspensión apagada no corta a nadie). Los jobs HTTP (entitlement-sync y
--      payment-autocharge) se programan también, pero cada ejecución NO hace
--      nada si faltan los secretos de Vault del entorno o su interruptor.
--
-- Test: supabase/tests/56_tenant_lifecycle.test.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ¿Quién es el sistema?
-- ---------------------------------------------------------------------------
create or replace function platform.is_system_job()
returns boolean
language sql
stable
set search_path = platform, pg_catalog
as $$
  select platform.is_service_request()
      or (session_user in ('postgres', 'supabase_admin')
          and coalesce(nullif(current_setting('role', true), ''), 'none') in ('none', 'postgres')
          and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '') = '');
$$;

comment on function platform.is_system_job() is
  'true para el job de mantenimiento (pg_cron: sesión postgres, sin rol de PostgREST ni JWT) '
  'o la clave de servicio. Un usuario authenticated nunca lo es.';

revoke all on function platform.is_system_job() from public, anon;
grant execute on function platform.is_system_job() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Configuración global del ciclo de vida (fila única)
-- ---------------------------------------------------------------------------
create table platform.tenant_lifecycle_settings (
  id                       boolean primary key default true,
  auto_suspend_enabled     boolean not null default false,
  auto_resume_enabled      boolean not null default true,
  entitlement_sync_enabled boolean not null default true,
  autocharge_enabled       boolean not null default false,
  last_cycle_at            timestamptz,
  last_cycle_result        jsonb,
  updated_at               timestamptz not null default now(),
  updated_by               uuid references platform.profiles (id) on delete set null,
  constraint tenant_lifecycle_settings_singleton_ck check (id)
);

comment on table platform.tenant_lifecycle_settings is
  'Interruptores globales del ciclo de vida (D-07). auto_suspend_enabled nace APAGADO: '
  'activar el corte automático por impago es una decisión del super admin, auditada.';

insert into platform.tenant_lifecycle_settings (id) values (true) on conflict do nothing;

create index tenant_lifecycle_settings_updated_by_ix on platform.tenant_lifecycle_settings (updated_by);

alter table platform.tenant_lifecycle_settings enable row level security;
-- Solo lectura desde la consola: toda escritura pasa por las funciones de esta migración.
revoke all on platform.tenant_lifecycle_settings from public, anon, authenticated;
grant select on platform.tenant_lifecycle_settings to authenticated, service_role;

create policy tenant_lifecycle_settings_select on platform.tenant_lifecycle_settings
  for select to authenticated
  using (platform.can_manage_commercial() or platform.can_manage_platform_entities());

-- ---------------------------------------------------------------------------
-- 3. Historial de suspensiones con causa
-- ---------------------------------------------------------------------------
create table platform.tenant_suspensions (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references platform.tenants (id) on delete cascade,
  cause                   text not null,
  reason                  text not null,
  detail                  jsonb not null default '{}'::jsonb,
  suspended_at            timestamptz not null default now(),
  suspended_by            uuid references platform.profiles (id) on delete set null,
  provisioning_request_id uuid references platform.provisioning_requests (id) on delete set null,
  resumed_at              timestamptz,
  resumed_by              uuid references platform.profiles (id) on delete set null,
  resume_cause            text,
  resume_reason           text,
  resume_request_id       uuid references platform.provisioning_requests (id) on delete set null,
  constraint tenant_suspensions_cause_ck check (cause in ('NON_PAYMENT', 'MANUAL')),
  constraint tenant_suspensions_resume_cause_ck
    check (resume_cause is null or resume_cause in ('PAYMENT', 'MANUAL', 'TERMINATED')),
  constraint tenant_suspensions_resume_consistent_ck
    check ((resumed_at is null) = (resume_cause is null)),
  constraint tenant_suspensions_reason_ck check (nullif(trim(reason), '') is not null)
);

comment on table platform.tenant_suspensions is
  'Cada suspensión de un tenant y cómo terminó. Solo la causa NON_PAYMENT se levanta sola al pagar.';

-- Una sola suspensión abierta por tenant.
create unique index tenant_suspensions_open_uk on platform.tenant_suspensions (tenant_id)
  where resumed_at is null;
create index tenant_suspensions_tenant_ix on platform.tenant_suspensions (tenant_id, suspended_at desc);
create index tenant_suspensions_suspended_by_ix on platform.tenant_suspensions (suspended_by);
create index tenant_suspensions_resumed_by_ix on platform.tenant_suspensions (resumed_by);
create index tenant_suspensions_request_ix on platform.tenant_suspensions (provisioning_request_id);
create index tenant_suspensions_resume_request_ix on platform.tenant_suspensions (resume_request_id);

alter table platform.tenant_suspensions enable row level security;
-- Solo lectura desde la consola: toda escritura pasa por las funciones de esta migración.
revoke all on platform.tenant_suspensions from public, anon, authenticated;
grant select on platform.tenant_suspensions to authenticated, service_role;

-- Ve la suspensión quien ve el tenant (la RLS de tenants decide).
create policy tenant_suspensions_select on platform.tenant_suspensions
  for select to authenticated
  using (tenant_id in (select t.id from platform.tenants t));

-- ---------------------------------------------------------------------------
-- 4. Bitácora de ejecuciones programadas
-- ---------------------------------------------------------------------------
create table platform.lifecycle_job_runs (
  id      bigint generated always as identity primary key,
  job     text not null,
  ran_at  timestamptz not null default now(),
  outcome text not null,
  detail  jsonb not null default '{}'::jsonb,
  constraint lifecycle_job_runs_job_ck
    check (job in ('LIFECYCLE_CYCLE', 'ENTITLEMENT_SYNC', 'ENTITLEMENT_SWEEP', 'AUTOCHARGE')),
  constraint lifecycle_job_runs_outcome_ck
    check (outcome in ('OK', 'DISPATCHED', 'SKIPPED_DISABLED', 'SKIPPED_NOT_CONFIGURED', 'FAILED'))
);

create index lifecycle_job_runs_job_ix on platform.lifecycle_job_runs (job, ran_at desc);

alter table platform.lifecycle_job_runs enable row level security;
-- Solo lectura desde la consola: toda escritura pasa por las funciones de esta migración.
revoke all on platform.lifecycle_job_runs from public, anon, authenticated;
grant select on platform.lifecycle_job_runs to authenticated, service_role;

create policy lifecycle_job_runs_select on platform.lifecycle_job_runs
  for select to authenticated
  using (platform.can_manage_commercial() or platform.can_manage_platform_entities());

-- ---------------------------------------------------------------------------
-- 5. Núcleo del cambio de estado del tenant (sin guardia) + RPC pública
-- ---------------------------------------------------------------------------
create or replace function platform._tenant_status_transition(
  p_tenant_id uuid,
  p_status    platform.tenant_status,
  p_reason    text
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_tenant record;
  v_valid  boolean;
begin
  select * into v_tenant from platform.tenants where id = p_tenant_id for update;
  if v_tenant is null then
    raise exception 'TENANT_NO_ENCONTRADO: %', p_tenant_id using errcode = '23503';
  end if;

  if v_tenant.status = p_status then
    return;
  end if;

  -- Máquina de estados del tenant. ARCHIVED y CHURNED no vuelven solos.
  v_valid := case v_tenant.status
    when 'PENDING'   then p_status in ('ACTIVE', 'ARCHIVED')
    when 'ACTIVE'    then p_status in ('SUSPENDED', 'CHURNED')
    when 'SUSPENDED' then p_status in ('ACTIVE', 'CHURNED', 'ARCHIVED')
    when 'CHURNED'   then p_status in ('ARCHIVED')
    else false
  end;

  if not v_valid then
    raise exception 'TRANSICION_TENANT_INVALIDA: no se puede pasar de % a %', v_tenant.status, p_status
      using errcode = '23514';
  end if;

  -- Suspender o dar de baja no es reversible sin dejar constancia del motivo.
  if p_status in ('SUSPENDED', 'CHURNED')
     and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: suspender o dar de baja un tenant exige un motivo auditable'
      using errcode = '23502';
  end if;

  -- Historial: quien suspende por impago ya dejó su fila NON_PAYMENT abierta;
  -- cualquier otra suspensión es MANUAL.
  if p_status = 'SUSPENDED'
     and not exists (select 1 from platform.tenant_suspensions s
                      where s.tenant_id = p_tenant_id and s.resumed_at is null) then
    insert into platform.tenant_suspensions (tenant_id, cause, reason, suspended_by)
    values (p_tenant_id, 'MANUAL', p_reason, auth.uid());
  end if;

  -- Salir de SUSPENDED cierra la suspensión abierta (si el cobro no la cerró ya).
  if v_tenant.status = 'SUSPENDED' then
    update platform.tenant_suspensions
       set resumed_at    = now(),
           resumed_by    = auth.uid(),
           resume_cause  = case when p_status = 'ACTIVE' then 'MANUAL' else 'TERMINATED' end,
           resume_reason = coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Cambio de estado a ' || p_status)
     where tenant_id = p_tenant_id and resumed_at is null;
  end if;

  update platform.tenants
     set status = p_status,
         activated_at = case when p_status = 'ACTIVE' then coalesce(activated_at, now()) else activated_at end,
         churned_at   = case when p_status = 'CHURNED' then now() else churned_at end
   where id = p_tenant_id;

  perform platform.log_audit(
    'TENANT_STATUS_CHANGED', 'tenant', p_tenant_id::text,
    v_tenant.customer_organization_id, p_tenant_id,
    jsonb_build_object('from', v_tenant.status, 'to', p_status, 'reason', p_reason,
                       'source', case when auth.uid() is null then 'SYSTEM' else 'USER' end)
  );
end;
$$;

comment on function platform._tenant_status_transition(uuid, platform.tenant_status, text) is
  'Núcleo SIN guardia del cambio de estado del tenant (máquina de estados, historial, auditoría). '
  'Sin GRANT: solo lo invocan set_tenant_status y el ciclo de vida.';

revoke all on function platform._tenant_status_transition(uuid, platform.tenant_status, text)
  from public, anon, authenticated, service_role;

create or replace function platform.set_tenant_status(
  p_tenant_id uuid,
  p_status    platform.tenant_status,
  p_reason    text default null
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_slug text;
begin
  select slug into v_slug from platform.tenants where id = p_tenant_id;
  if v_slug is null then
    raise exception 'TENANT_NO_ENCONTRADO: %', p_tenant_id using errcode = '23503';
  end if;

  if not platform.can_manage_tenant(p_tenant_id) then
    raise exception 'NO_AUTORIZADO: no administra el tenant %', v_slug using errcode = '42501';
  end if;

  perform platform._tenant_status_transition(p_tenant_id, p_status, p_reason);
end;
$$;

comment on function platform.set_tenant_status is
  'Único camino auditado para cambiar el estado de un tenant. Suspender o dar de '
  'baja exige motivo: un tenant apagado sin explicación es un incidente, no una operación.';

-- ---------------------------------------------------------------------------
-- 6. Núcleo del encolado de provisioning (sin guardia) + RPC pública
-- ---------------------------------------------------------------------------
create or replace function platform._enqueue_provisioning_core(
  p_action               platform.provisioning_action,
  p_tenant_id            uuid,
  p_deployment_target_id uuid,
  p_saas_product_id      uuid,
  p_mode                 text,
  p_payload              jsonb,
  p_idempotency_key      text,
  p_origin               text default 'Solicitud encolada desde la consola'
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id       uuid;
  v_key      text;
  v_tenant   record;
  v_existing uuid;
begin
  if p_mode not in ('DRY_RUN', 'LIVE') then
    raise exception 'MODO_INVALIDO: mode debe ser DRY_RUN o LIVE; recibido "%"', p_mode using errcode = '23514';
  end if;

  if p_tenant_id is not null then
    select * into v_tenant from platform.tenants where id = p_tenant_id;
    if v_tenant is null then
      raise exception 'TENANT_NO_ENCONTRADO: %', p_tenant_id using errcode = '23503';
    end if;
  end if;

  v_key := coalesce(
    nullif(trim(coalesce(p_idempotency_key, '')), ''),
    p_action::text || ':' || coalesce(p_tenant_id::text, '-') || ':'
      || coalesce(p_deployment_target_id::text, '-') || ':' || p_mode
  );

  select id into v_existing from platform.provisioning_requests where idempotency_key = v_key;
  if v_existing is not null then
    return v_existing;  -- Idempotente: la misma intención no encola dos veces.
  end if;

  insert into platform.provisioning_requests (
    idempotency_key, action, status, mode, tenant_id, deployment_target_id,
    saas_product_id, requested_by, payload
  ) values (
    v_key, p_action, 'PENDING', p_mode, p_tenant_id, p_deployment_target_id,
    coalesce(p_saas_product_id, v_tenant.saas_product_id), auth.uid(),
    coalesce(p_payload, '{}'::jsonb)
  )
  returning id into v_id;

  insert into platform.provisioning_events (provisioning_request_id, status, message, detail)
  values (v_id, 'PENDING', p_origin, jsonb_build_object('mode', p_mode));

  perform platform.log_audit(
    'PROVISIONING_ENQUEUED', 'provisioning_request', v_id::text,
    v_tenant.customer_organization_id, p_tenant_id,
    jsonb_build_object('action', p_action, 'mode', p_mode, 'idempotency_key', v_key)
  );

  return v_id;
end;
$$;

revoke all on function platform._enqueue_provisioning_core(
  platform.provisioning_action, uuid, uuid, uuid, text, jsonb, text, text
) from public, anon, authenticated, service_role;

create or replace function platform.enqueue_provisioning_request(
  p_action               platform.provisioning_action,
  p_tenant_id            uuid default null,
  p_deployment_target_id uuid default null,
  p_saas_product_id      uuid default null,
  p_mode                 text default 'DRY_RUN',
  p_payload              jsonb default '{}'::jsonb,
  p_idempotency_key      text default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: solo EBIM encola provisioning' using errcode = '42501';
  end if;

  -- LIVE toca infraestructura real: solo el super admin puede pedirlo.
  if p_mode = 'LIVE' and not platform.is_super_admin() then
    raise exception 'LIVE_NO_AUTORIZADO: el provisioning LIVE requiere el super admin de la suite (contrato §13)'
      using errcode = '42501';
  end if;

  return platform._enqueue_provisioning_core(
    p_action, p_tenant_id, p_deployment_target_id, p_saas_product_id, p_mode, p_payload, p_idempotency_key
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Alertas de cobranza: núcleo (cuerpo idéntico al de 20260907000700 sin la
--    guardia) y RPC pública que además acepta al job del sistema.
-- ---------------------------------------------------------------------------
create or replace function platform._refresh_billing_alerts_core(p_as_of timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  r           record;
  v_today     date := p_as_of::date;
  v_created   integer := 0;
  v_renewal   date;
  v_dedupe    text;
  v_grace_end date;
begin

  -- =======================================================================
  -- A) Alertas ligadas al ciclo de la SUSCRIPCIÓN (renovación y documentos)
  -- =======================================================================
  for r in
    select c.*,
           platform.next_renewal_date(c.started_on, c.ends_on, c.billing_interval, v_today) as renewal_on
      from platform.v_subscription_collection c
     where c.subscription_status in ('ACTIVE', 'PAST_DUE')
  loop
    v_renewal := r.renewal_on;
    if v_renewal is null then
      continue;  -- ONE_TIME no renueva
    end if;

    -- A.1) Pedir la OS/OC con la antelación configurada, si el método la exige
    --      y no hay ya un documento vivo que cubra la renovación.
    if (r.requires_service_order or r.requires_purchase_order)
       and v_today >= v_renewal - coalesce(r.document_lead_days, 45)
       and not exists (
         select 1 from platform.subscription_commercial_documents d
          where d.subscription_id = r.subscription_id
            and d.status in ('REQUESTED', 'RECEIVED', 'APPROVED')
            and (d.valid_to is null or d.valid_to >= v_renewal)
       )
    then
      v_dedupe := r.subscription_id::text || ':REQUEST_DOCUMENT:' || v_renewal::text;
      insert into platform.billing_alerts (
        subscription_id, alert_type, due_at, reference_date, dedupe_key,
        severity, title, message, metadata
      ) values (
        r.subscription_id, 'REQUEST_DOCUMENT',
        (v_renewal - coalesce(r.document_lead_days, 45))::timestamptz, v_renewal, v_dedupe,
        'WARNING',
        'Solicitar ' || case when r.requires_purchase_order then 'Orden de Compra' else 'Orden de Servicio' end,
        'La renovación del ' || v_renewal || ' necesita documento del cliente y no hay ninguno vigente que la cubra.',
        jsonb_build_object('renewal_on', v_renewal, 'lead_days', r.document_lead_days,
                           'product', r.product_code, 'organization', r.billed_organization_name)
      )
      on conflict (dedupe_key) do nothing;
      if found then v_created := v_created + 1; end if;
    end if;

    -- A.2) Aviso de renovación
    if v_today >= v_renewal - coalesce(r.renewal_notice_days, 30) then
      v_dedupe := r.subscription_id::text || ':RENEWAL_NOTICE:' || v_renewal::text;
      insert into platform.billing_alerts (
        subscription_id, alert_type, due_at, reference_date, dedupe_key,
        severity, title, message, metadata
      ) values (
        r.subscription_id, 'RENEWAL_NOTICE',
        (v_renewal - coalesce(r.renewal_notice_days, 30))::timestamptz, v_renewal, v_dedupe,
        'INFO',
        'Renovación próxima',
        'La suscripción ' || r.subscription_code || ' renueva el ' || v_renewal || '.',
        jsonb_build_object('renewal_on', v_renewal, 'method', r.collection_method,
                           'product', r.product_code, 'organization', r.billed_organization_name)
      )
      on conflict (dedupe_key) do nothing;
      if found then v_created := v_created + 1; end if;
    end if;
  end loop;

  -- =======================================================================
  -- B) Documento aprobado que vence pronto
  -- =======================================================================
  for r in
    select d.id as document_id, d.subscription_id, d.document_number, d.valid_to,
           c.document_lead_days, c.subscription_code
      from platform.subscription_commercial_documents d
      join platform.v_subscription_collection c on c.subscription_id = d.subscription_id
     where d.status = 'APPROVED'
       and d.valid_to is not null
       and d.valid_to >= v_today
       and d.valid_to <= v_today + coalesce(c.document_lead_days, 45)
  loop
    v_dedupe := r.document_id::text || ':DOCUMENT_EXPIRING:' || r.valid_to::text;
    insert into platform.billing_alerts (
      subscription_id, alert_type, due_at, reference_date, dedupe_key,
      severity, title, message, document_id, metadata
    ) values (
      r.subscription_id, 'DOCUMENT_EXPIRING', r.valid_to::timestamptz, r.valid_to, v_dedupe,
      'WARNING', 'Documento por vencer',
      'La ' || coalesce(r.document_number, 'OS/OC') || ' vence el ' || r.valid_to ||
        '. Una vencida no autoriza la renovación.',
      r.document_id,
      jsonb_build_object('document_number', r.document_number, 'valid_to', r.valid_to)
    )
    on conflict (dedupe_key) do nothing;
    if found then v_created := v_created + 1; end if;
  end loop;

  -- =======================================================================
  -- C) Alertas ligadas a FACTURAS impagas
  -- =======================================================================
  for r in
    select i.id as invoice_id, i.number, i.due_date, i.total, i.currency, i.status as invoice_status,
           c.subscription_id, c.subscription_code, c.payment_due_days, c.grace_period_days,
           c.auto_suspend, c.tenant_id, c.billed_organization_name,
           coalesce((select sum(p.amount) from platform.payments p
                      where p.invoice_id = i.id and p.status = 'CONFIRMED'), 0) as paid
      from platform.invoices i
      join platform.v_subscription_collection c on c.subscription_id = i.subscription_id
     where i.status in ('ISSUED', 'PARTIALLY_PAID')
       and i.due_date is not null
  loop
    -- Ya cobrada del todo: no genera nada.
    if r.paid >= r.total then
      continue;
    end if;

    v_grace_end := r.due_date + coalesce(r.grace_period_days, 10);

    if v_today < r.due_date then
      -- C.1) Vencimiento próximo
      if v_today >= r.due_date - coalesce(r.payment_due_days, 15) then
        v_dedupe := r.invoice_id::text || ':PAYMENT_DUE';
        insert into platform.billing_alerts (
          subscription_id, alert_type, due_at, reference_date, dedupe_key,
          severity, title, message, invoice_id, metadata
        ) values (
          r.subscription_id, 'PAYMENT_DUE', r.due_date::timestamptz, r.due_date, v_dedupe,
          'INFO', 'Factura por vencer',
          'La factura ' || r.number || ' vence el ' || r.due_date || '.',
          r.invoice_id,
          jsonb_build_object('total', r.total, 'paid', r.paid, 'currency', r.currency)
        )
        on conflict (dedupe_key) do nothing;
        if found then v_created := v_created + 1; end if;
      end if;

    elsif v_today <= v_grace_end then
      -- C.2) Vencida, dentro de gracia
      v_dedupe := r.invoice_id::text || ':PAST_DUE';
      insert into platform.billing_alerts (
        subscription_id, alert_type, due_at, reference_date, dedupe_key,
        severity, title, message, invoice_id, metadata
      ) values (
        r.subscription_id, 'PAST_DUE', r.due_date::timestamptz, r.due_date, v_dedupe,
        'WARNING', 'Factura vencida',
        'La factura ' || r.number || ' venció el ' || r.due_date ||
          '. Periodo de gracia hasta el ' || v_grace_end || '.',
        r.invoice_id,
        jsonb_build_object('total', r.total, 'paid', r.paid, 'currency', r.currency,
                           'grace_ends_on', v_grace_end)
      )
      on conflict (dedupe_key) do nothing;
      if found then v_created := v_created + 1; end if;

      -- C.3) Últimos tres días de gracia: sube la urgencia
      if v_today >= v_grace_end - 3 then
        v_dedupe := r.invoice_id::text || ':GRACE_ENDING';
        insert into platform.billing_alerts (
          subscription_id, alert_type, due_at, reference_date, dedupe_key,
          severity, title, message, invoice_id, metadata
        ) values (
          r.subscription_id, 'GRACE_ENDING', v_grace_end::timestamptz, v_grace_end, v_dedupe,
          'CRITICAL', 'Se acaba la gracia',
          'El periodo de gracia de la factura ' || r.number || ' termina el ' || v_grace_end ||
            case when r.auto_suspend then '. Después se suspenderá automáticamente.' else '.' end,
          r.invoice_id,
          jsonb_build_object('grace_ends_on', v_grace_end, 'auto_suspend', r.auto_suspend)
        )
        on conflict (dedupe_key) do nothing;
        if found then v_created := v_created + 1; end if;
      end if;

    else
      -- C.4) Pasada la gracia: procede suspender según la política
      v_dedupe := r.invoice_id::text || ':SUSPENSION_DUE';
      insert into platform.billing_alerts (
        subscription_id, alert_type, due_at, reference_date, dedupe_key,
        severity, title, message, invoice_id, metadata
      ) values (
        r.subscription_id, 'SUSPENSION_DUE', v_grace_end::timestamptz, v_grace_end, v_dedupe,
        'CRITICAL',
        case when r.auto_suspend then 'Suspensión programada' else 'Suspensión sugerida' end,
        'La factura ' || r.number || ' lleva impaga desde el ' || r.due_date ||
          ' y la gracia terminó el ' || v_grace_end || '.',
        r.invoice_id,
        jsonb_build_object('auto_suspend', r.auto_suspend, 'tenant_id', r.tenant_id,
                           'grace_ended_on', v_grace_end)
      )
      on conflict (dedupe_key) do nothing;
      if found then v_created := v_created + 1; end if;
    end if;
  end loop;

  -- =======================================================================
  -- D) Cobro fallido reportado por el proveedor
  -- =======================================================================
  for r in
    select ps.subscription_id, ps.last_error_code, ps.last_error_message,
           ps.synced_at, s.code as subscription_code
      from platform.provider_subscriptions ps
      join platform.subscriptions s on s.id = ps.subscription_id
     where ps.provider_status = 'payment_failed'
       and ps.status = 'ACTIVE'
  loop
    -- La clave incluye la fecha de sincronización: un fallo nuevo genera una
    -- alerta nueva, pero el mismo fallo no se duplica al recalcular.
    v_dedupe := r.subscription_id::text || ':PAYMENT_FAILURE:' || r.synced_at::date::text;
    insert into platform.billing_alerts (
      subscription_id, alert_type, due_at, reference_date, dedupe_key,
      severity, title, message, metadata
    ) values (
      r.subscription_id, 'PAYMENT_FAILURE', r.synced_at, r.synced_at::date, v_dedupe,
      'CRITICAL', 'Cobro rechazado por el proveedor',
      coalesce(r.last_error_message, 'El proveedor no pudo cobrar la suscripción ' || r.subscription_code),
      jsonb_build_object('error_code', r.last_error_code)
    )
    on conflict (dedupe_key) do nothing;
    if found then v_created := v_created + 1; end if;
  end loop;

  if v_created > 0 then
    perform platform.log_audit(
      'BILLING_ALERTS_REFRESHED', 'billing_alert', null, null, null,
      jsonb_build_object('as_of', p_as_of, 'created', v_created)
    );
  end if;

  return v_created;
end;
$$;

comment on function platform._refresh_billing_alerts_core(timestamptz) is
  'Núcleo SIN guardia de refresh_billing_alerts (mismo cuerpo que en 20260907000700). Sin GRANT.';

revoke all on function platform._refresh_billing_alerts_core(timestamptz)
  from public, anon, authenticated, service_role;

create or replace function platform.refresh_billing_alerts(p_as_of timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if not (platform.can_manage_commercial() or platform.is_super_admin() or platform.is_system_job()) then
    raise exception 'NO_AUTORIZADO: solo EBIM recalcula las alertas de cobranza'
      using errcode = '42501';
  end if;
  return platform._refresh_billing_alerts_core(p_as_of);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Deuda vencida por tenant
--
-- Una factura cubre al tenant como lo hace el entitlement (compute_entitlements):
-- por `subscriptions.tenant_id`, o por la organización si la suscripción no
-- tiene tenant. Saldo = total − cobros CONFIRMED. La gracia y `auto_suspend`
-- son los del perfil de cobranza vigente (10 días si no hay perfil, como las
-- alertas). SECURITY INVOKER: cada quien ve la deuda que su RLS le deja ver.
-- ---------------------------------------------------------------------------
create or replace function platform.tenant_overdue_invoices(
  p_as_of     date default current_date,
  p_tenant_id uuid default null
)
returns table (
  tenant_id         uuid,
  invoice_id        uuid,
  invoice_number    text,
  subscription_id   uuid,
  subscription_code text,
  currency          char(3),
  total             numeric,
  paid              numeric,
  balance           numeric,
  due_date          date,
  grace_ends_on     date,
  auto_suspend      boolean,
  days_past_due     integer
)
language sql
stable
security invoker
set search_path = platform, pg_catalog
as $$
  select t.id, i.id, i.number, s.id, s.code, i.currency, i.total,
         coalesce(pay.paid, 0), i.total - coalesce(pay.paid, 0),
         i.due_date, i.due_date + coalesce(p.grace_period_days, 10),
         coalesce(p.auto_suspend, false), (p_as_of - i.due_date)
    from platform.tenants t
    join platform.subscriptions s
      on s.saas_product_id = t.saas_product_id
     and (s.tenant_id = t.id or (s.tenant_id is null and s.billed_organization_id = t.customer_organization_id))
    join platform.invoices i on i.subscription_id = s.id
    left join platform.subscription_collection_profiles p
      on p.subscription_id = s.id and p.effective_to is null
    left join lateral (
      select sum(pm.amount) as paid
        from platform.payments pm
       where pm.invoice_id = i.id and pm.status = 'CONFIRMED'
    ) pay on true
   where (p_tenant_id is null or t.id = p_tenant_id)
     and i.status in ('ISSUED', 'PARTIALLY_PAID')
     and i.due_date is not null
     and i.due_date < p_as_of
     and i.total - coalesce(pay.paid, 0) > 0;
$$;

comment on function platform.tenant_overdue_invoices(date, uuid) is
  'Facturas vencidas con saldo que cubren a cada tenant, con su fin de gracia y auto_suspend. SECURITY INVOKER.';

revoke all on function platform.tenant_overdue_invoices(date, uuid) from public, anon;
grant execute on function platform.tenant_overdue_invoices(date, uuid) to authenticated, service_role;

-- Deuda que impide operar: alguna factura con la gracia ya vencida.
create or replace function platform.tenant_has_blocking_debt(p_tenant_id uuid, p_as_of date default current_date)
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select exists (
    select 1 from platform.tenant_overdue_invoices(p_as_of, p_tenant_id) d
     where p_as_of > d.grace_ends_on
  );
$$;

revoke all on function platform.tenant_has_blocking_debt(uuid, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Suspender por impago y reactivar por pago (núcleos sin guardia)
-- ---------------------------------------------------------------------------
create or replace function platform._suspend_tenant_for_nonpayment(
  p_tenant_id uuid,
  p_as_of     timestamptz,
  p_mode      text,
  p_detail    jsonb
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_tenant  record;
  v_id      uuid;
  v_request uuid;
  v_reason  text := 'Suspensión por impago: deuda vencida fuera del periodo de gracia';
begin
  select * into v_tenant from platform.tenants where id = p_tenant_id for update;
  if v_tenant is null or v_tenant.status <> 'ACTIVE' then
    return null;
  end if;

  -- La fila NON_PAYMENT va ANTES del cambio de estado: así el núcleo no la
  -- registra como suspensión manual.
  insert into platform.tenant_suspensions (tenant_id, cause, reason, detail, suspended_at, suspended_by)
  values (p_tenant_id, 'NON_PAYMENT', v_reason, coalesce(p_detail, '{}'::jsonb), p_as_of, auth.uid())
  returning id into v_id;

  perform platform._tenant_status_transition(p_tenant_id, 'SUSPENDED', v_reason);

  v_request := platform._enqueue_provisioning_core(
    'SUSPEND_TENANT', p_tenant_id, null, null, p_mode,
    jsonb_build_object('reason', v_reason, 'cause', 'NON_PAYMENT', 'suspension_id', v_id),
    'SUSPEND_TENANT:' || v_id::text,
    'Suspensión por impago (ciclo de vida)'
  );

  update platform.tenant_suspensions set provisioning_request_id = v_request where id = v_id;

  -- La alerta «suspensión programada/sugerida» de estas suscripciones ya se cumplió.
  update platform.billing_alerts a
     set status = 'RESOLVED', resolved_at = now(),
         metadata = a.metadata || jsonb_build_object('suspended_at', p_as_of, 'suspension_id', v_id)
    from platform.subscriptions s
   where a.subscription_id = s.id
     and a.alert_type = 'SUSPENSION_DUE'
     and a.status in ('OPEN', 'ACKNOWLEDGED')
     and s.saas_product_id = v_tenant.saas_product_id
     and (s.tenant_id = v_tenant.id
          or (s.tenant_id is null and s.billed_organization_id = v_tenant.customer_organization_id));

  return v_id;
end;
$$;

revoke all on function platform._suspend_tenant_for_nonpayment(uuid, timestamptz, text, jsonb)
  from public, anon, authenticated, service_role;

create or replace function platform._resume_tenant_after_payment(
  p_tenant_id uuid,
  p_as_of     date,
  p_source    text
)
returns boolean
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_susp    record;
  v_mode    text;
  v_request uuid;
  v_reason  text := 'Reactivación automática: deuda vencida saldada';
begin
  select s.* into v_susp
    from platform.tenant_suspensions s
    join platform.tenants t on t.id = s.tenant_id
   where s.tenant_id = p_tenant_id and s.resumed_at is null
     and s.cause = 'NON_PAYMENT' and t.status = 'SUSPENDED'
   for update of s;
  if v_susp is null then
    return false;
  end if;

  if platform.tenant_has_blocking_debt(p_tenant_id, p_as_of) then
    return false;
  end if;

  -- Se cierra ANTES del cambio de estado: así el núcleo no la cierra como MANUAL.
  update platform.tenant_suspensions
     set resumed_at = now(), resumed_by = auth.uid(), resume_cause = 'PAYMENT',
         resume_reason = v_reason || ' (' || p_source || ')'
   where id = v_susp.id;

  perform platform._tenant_status_transition(p_tenant_id, 'ACTIVE', v_reason);

  select r.mode into v_mode from platform.provisioning_requests r where r.id = v_susp.provisioning_request_id;
  v_request := platform._enqueue_provisioning_core(
    'RESUME_TENANT', p_tenant_id, null, null, coalesce(v_mode, 'DRY_RUN'),
    jsonb_build_object('reason', v_reason, 'cause', 'PAYMENT', 'suspension_id', v_susp.id, 'source', p_source),
    'RESUME_TENANT:' || v_susp.id::text,
    'Reactivación por pago (ciclo de vida)'
  );

  update platform.tenant_suspensions set resume_request_id = v_request where id = v_susp.id;
  return true;
end;
$$;

revoke all on function platform._resume_tenant_after_payment(uuid, date, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. RPC manuales de suspender / reanudar: misma guardia que antes, y una
--     clave de idempotencia POR SUSPENSIÓN (antes la clave fija por tenant
--     devolvía la solicitud de la primera suspensión en la segunda).
-- ---------------------------------------------------------------------------
create or replace function platform.request_tenant_suspension(
  p_tenant_id uuid,
  p_reason    text,
  p_mode      text default 'DRY_RUN'
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_request    uuid;
  v_suspension uuid;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: suspender un tenant exige un motivo auditable'
      using errcode = '23502';
  end if;

  -- La autorización y la máquina de estados viven en set_tenant_status.
  perform platform.set_tenant_status(p_tenant_id, 'SUSPENDED', p_reason);

  select id into v_suspension from platform.tenant_suspensions
   where tenant_id = p_tenant_id and resumed_at is null;

  v_request := platform.enqueue_provisioning_request(
    'SUSPEND_TENANT', p_tenant_id, null, null, p_mode,
    jsonb_build_object('reason', p_reason, 'cause', 'MANUAL', 'suspension_id', v_suspension),
    'SUSPEND_TENANT:' || coalesce(v_suspension::text, p_tenant_id::text)
  );

  update platform.tenant_suspensions
     set provisioning_request_id = coalesce(provisioning_request_id, v_request)
   where id = v_suspension;

  return jsonb_build_object('tenant_id', p_tenant_id, 'provisioning_request_id', v_request,
                            'suspension_id', v_suspension);
end;
$$;

create or replace function platform.request_tenant_resume(
  p_tenant_id uuid,
  p_reason    text default 'Reactivación administrativa',
  p_mode      text default 'DRY_RUN'
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_request    uuid;
  v_suspension uuid;
begin
  select id into v_suspension from platform.tenant_suspensions
   where tenant_id = p_tenant_id and resumed_at is null;

  perform platform.set_tenant_status(p_tenant_id, 'ACTIVE', p_reason);

  v_request := platform.enqueue_provisioning_request(
    'RESUME_TENANT', p_tenant_id, null, null, p_mode,
    jsonb_build_object('reason', p_reason, 'suspension_id', v_suspension),
    'RESUME_TENANT:' || coalesce(v_suspension::text, gen_random_uuid()::text)
  );

  update platform.tenant_suspensions set resume_request_id = v_request where id = v_suspension;

  return jsonb_build_object('tenant_id', p_tenant_id, 'provisioning_request_id', v_request);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. apply_due_suspensions: misma semántica (alertas SUSPENSION_DUE con
--     auto_suspend), ahora con historial NON_PAYMENT y apta para el job.
-- ---------------------------------------------------------------------------
create or replace function platform.apply_due_suspensions(
  p_as_of timestamptz default now(),
  p_mode  text default 'DRY_RUN'
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  r          record;
  v_applied  integer := 0;
  v_skipped  integer := 0;
  v_details  jsonb := '[]'::jsonb;
begin
  if not (platform.can_manage_platform_entities() or platform.is_super_admin() or platform.is_system_job()) then
    raise exception 'NO_AUTORIZADO: suspender exige rol de plataforma' using errcode = '42501';
  end if;
  if p_mode = 'LIVE' and not platform.is_super_admin() then
    raise exception 'LIVE_NO_AUTORIZADO: el provisioning LIVE requiere el super admin de la suite (contrato §13)'
      using errcode = '42501';
  end if;

  for r in
    select a.id as alert_id, a.subscription_id, a.invoice_id,
           s.tenant_id, s.code as subscription_code,
           (a.metadata ->> 'auto_suspend')::boolean as auto_suspend,
           t.status as tenant_status, t.name as tenant_name
      from platform.billing_alerts a
      join platform.subscriptions s on s.id = a.subscription_id
      left join platform.tenants t on t.id = s.tenant_id
     where a.alert_type = 'SUSPENSION_DUE'
       and a.status in ('OPEN', 'ACKNOWLEDGED')
       and a.due_at <= p_as_of
  loop
    -- Sin política de suspensión automática, la alerta es una sugerencia para
    -- una persona: no se actúa sola.
    if not coalesce(r.auto_suspend, false) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if r.tenant_id is null then
      -- Una licencia base de partner no tiene tenant que apagar.
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if r.tenant_status <> 'ACTIVE' then
      -- Ya estaba suspendido o dado de baja: la alerta se cierra, no se repite.
      update platform.billing_alerts
         set status = 'RESOLVED', resolved_at = now()
       where id = r.alert_id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    perform platform._suspend_tenant_for_nonpayment(
      r.tenant_id, p_as_of, p_mode,
      jsonb_build_object('subscription', r.subscription_code, 'alert_id', r.alert_id,
                         'invoice_id', r.invoice_id, 'source', 'APPLY_DUE_SUSPENSIONS')
    );

    update platform.billing_alerts
       set status = 'RESOLVED', resolved_at = now(),
           metadata = metadata || jsonb_build_object('suspended_at', p_as_of)
     where id = r.alert_id;

    v_applied := v_applied + 1;
    v_details := v_details || jsonb_build_object(
      'tenant', r.tenant_name, 'subscription', r.subscription_code
    );
  end loop;

  if v_applied > 0 then
    perform platform.log_audit(
      'BILLING_SUSPENSIONS_APPLIED', 'billing_alert', null, null, null,
      jsonb_build_object('as_of', p_as_of, 'applied', v_applied, 'skipped', v_skipped,
                         'mode', p_mode, 'details', v_details)
    );
  end if;

  return jsonb_build_object(
    'applied', v_applied, 'skipped', v_skipped, 'mode', p_mode, 'details', v_details
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. El ciclo de vida completo (job diario o «Ejecutar ahora» de la consola)
-- ---------------------------------------------------------------------------
create or replace function platform.run_tenant_lifecycle_cycle(
  p_as_of   timestamptz default now(),
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_settings  platform.tenant_lifecycle_settings;
  v_day       date := p_as_of::date;
  v_alerts    integer := 0;
  r           record;
  v_item      jsonb;
  v_suspended jsonb := '[]'::jsonb;
  v_resumed   jsonb := '[]'::jsonb;
  v_pend_susp jsonb := '[]'::jsonb;
  v_pend_res  jsonb := '[]'::jsonb;
  v_result    jsonb;
begin
  if not (platform.is_system_job() or platform.can_manage_platform_entities()) then
    raise exception 'NO_AUTORIZADO: el ciclo de vida lo ejecuta el job del sistema o un administrador de plataforma'
      using errcode = '42501';
  end if;

  select * into v_settings from platform.tenant_lifecycle_settings where id;

  if not p_dry_run then
    v_alerts := platform._refresh_billing_alerts_core(p_as_of);
  end if;

  -- A) Suspensiones: tenant ACTIVO con deuda fuera de gracia y suscripción con auto_suspend.
  for r in
    select d.tenant_id, t.name as tenant_name, p.short_name as product,
           min(d.grace_ends_on) as grace_ended_on,
           array_agg(distinct d.invoice_number order by d.invoice_number) as invoices
      from platform.tenant_overdue_invoices(v_day) d
      join platform.tenants t on t.id = d.tenant_id
      join platform.saas_products p on p.id = t.saas_product_id
     where t.status = 'ACTIVE'
       and v_day > d.grace_ends_on
       and d.auto_suspend
     group by d.tenant_id, t.name, p.short_name
     order by t.name
  loop
    v_item := jsonb_build_object('tenant_id', r.tenant_id, 'tenant', r.tenant_name, 'product', r.product,
                                 'grace_ended_on', r.grace_ended_on, 'invoices', to_jsonb(r.invoices));
    if p_dry_run or not v_settings.auto_suspend_enabled then
      v_pend_susp := v_pend_susp || v_item;
    elsif platform._suspend_tenant_for_nonpayment(
            r.tenant_id, p_as_of, 'DRY_RUN',
            jsonb_build_object('invoices', to_jsonb(r.invoices), 'grace_ended_on', r.grace_ended_on,
                               'source', 'LIFECYCLE_CYCLE')) is not null then
      v_suspended := v_suspended || v_item;
    end if;
  end loop;

  -- B) Reactivaciones: suspensión por impago cuya deuda bloqueante ya no existe
  --    (red de seguridad del trigger de pagos).
  for r in
    select s.tenant_id, t.name as tenant_name, p.short_name as product
      from platform.tenant_suspensions s
      join platform.tenants t on t.id = s.tenant_id
      join platform.saas_products p on p.id = t.saas_product_id
     where s.resumed_at is null and s.cause = 'NON_PAYMENT' and t.status = 'SUSPENDED'
       and not platform.tenant_has_blocking_debt(s.tenant_id, v_day)
     order by t.name
  loop
    v_item := jsonb_build_object('tenant_id', r.tenant_id, 'tenant', r.tenant_name, 'product', r.product);
    if p_dry_run or not v_settings.auto_resume_enabled then
      v_pend_res := v_pend_res || v_item;
    elsif platform._resume_tenant_after_payment(r.tenant_id, v_day, 'LIFECYCLE_CYCLE') then
      v_resumed := v_resumed || v_item;
    end if;
  end loop;

  v_result := jsonb_build_object(
    'as_of', p_as_of,
    'dry_run', p_dry_run,
    'auto_suspend_enabled', v_settings.auto_suspend_enabled,
    'auto_resume_enabled', v_settings.auto_resume_enabled,
    'alerts_created', v_alerts,
    'suspended', v_suspended,
    'resumed', v_resumed,
    'pending_suspensions', v_pend_susp,
    'pending_resumes', v_pend_res
  );

  if not p_dry_run then
    update platform.tenant_lifecycle_settings
       set last_cycle_at = now(), last_cycle_result = v_result
     where id;

    insert into platform.lifecycle_job_runs (job, outcome, detail)
    values ('LIFECYCLE_CYCLE', 'OK', jsonb_build_object(
      'alerts_created', v_alerts,
      'suspended', jsonb_array_length(v_suspended), 'resumed', jsonb_array_length(v_resumed),
      'pending_suspensions', jsonb_array_length(v_pend_susp), 'pending_resumes', jsonb_array_length(v_pend_res),
      'source', case when auth.uid() is null then 'SYSTEM' else 'USER' end));

    -- La bitácora no crece sin límite: 90 días bastan para operar.
    delete from platform.lifecycle_job_runs where ran_at < now() - interval '90 days';

    if jsonb_array_length(v_suspended) + jsonb_array_length(v_resumed) > 0 then
      perform platform.log_audit('TENANT_LIFECYCLE_CYCLE', 'tenant_lifecycle', null, null, null, v_result);
    end if;
  end if;

  return v_result;
end;
$$;

comment on function platform.run_tenant_lifecycle_cycle(timestamptz, boolean) is
  'Ciclo de vida: refresca alertas, suspende por impago (solo con auto_suspend_enabled global y '
  'auto_suspend de la suscripción) y reactiva lo pagado. p_dry_run=true solo informa.';

-- ---------------------------------------------------------------------------
-- 13. Interruptores globales (solo el super admin, auditado)
-- ---------------------------------------------------------------------------
create or replace function platform.set_tenant_lifecycle_settings(
  p_auto_suspend_enabled     boolean default null,
  p_auto_resume_enabled      boolean default null,
  p_entitlement_sync_enabled boolean default null,
  p_autocharge_enabled       boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_old platform.tenant_lifecycle_settings;
  v_new platform.tenant_lifecycle_settings;
begin
  if not platform.is_super_admin() then
    raise exception 'NO_AUTORIZADO: solo el super admin cambia la política del ciclo de vida'
      using errcode = '42501';
  end if;

  select * into v_old from platform.tenant_lifecycle_settings where id for update;

  update platform.tenant_lifecycle_settings
     set auto_suspend_enabled     = coalesce(p_auto_suspend_enabled, auto_suspend_enabled),
         auto_resume_enabled      = coalesce(p_auto_resume_enabled, auto_resume_enabled),
         entitlement_sync_enabled = coalesce(p_entitlement_sync_enabled, entitlement_sync_enabled),
         autocharge_enabled       = coalesce(p_autocharge_enabled, autocharge_enabled),
         updated_at = now(),
         updated_by = auth.uid()
   where id
  returning * into v_new;

  perform platform.log_audit(
    'TENANT_LIFECYCLE_SETTINGS_CHANGED', 'tenant_lifecycle_settings', null, null, null,
    jsonb_build_object(
      'from', jsonb_build_object('auto_suspend_enabled', v_old.auto_suspend_enabled,
                                 'auto_resume_enabled', v_old.auto_resume_enabled,
                                 'entitlement_sync_enabled', v_old.entitlement_sync_enabled,
                                 'autocharge_enabled', v_old.autocharge_enabled),
      'to', jsonb_build_object('auto_suspend_enabled', v_new.auto_suspend_enabled,
                               'auto_resume_enabled', v_new.auto_resume_enabled,
                               'entitlement_sync_enabled', v_new.entitlement_sync_enabled,
                               'autocharge_enabled', v_new.autocharge_enabled))
  );

  return jsonb_build_object(
    'auto_suspend_enabled', v_new.auto_suspend_enabled,
    'auto_resume_enabled', v_new.auto_resume_enabled,
    'entitlement_sync_enabled', v_new.entitlement_sync_enabled,
    'autocharge_enabled', v_new.autocharge_enabled
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. Triggers: el estado del tenant llega a la app; el pago reactiva
-- ---------------------------------------------------------------------------
create or replace function platform.on_tenant_status_changed()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  -- appActive del snapshot depende del estado: la app se entera en el próximo push.
  perform platform.mark_entitlements_dirty(new.id, new.saas_product_id, 'TENANT_STATUS_' || new.status::text);
  return null;
end;
$$;

revoke all on function platform.on_tenant_status_changed() from public, anon, authenticated, service_role;

create trigger tenants_status_marks_entitlements
  after update of status on platform.tenants
  for each row
  when (old.status is distinct from new.status)
  execute function platform.on_tenant_status_changed();

create or replace function platform.resume_tenants_on_payment()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  r record;
begin
  if not coalesce((select s.auto_resume_enabled from platform.tenant_lifecycle_settings s where s.id), false) then
    return null;
  end if;

  for r in
    select distinct su.tenant_id
      from platform.invoices i
      join platform.subscriptions s on s.id = i.subscription_id
      join platform.tenants t
        on t.saas_product_id = s.saas_product_id
       and (s.tenant_id = t.id or (s.tenant_id is null and s.billed_organization_id = t.customer_organization_id))
      join platform.tenant_suspensions su
        on su.tenant_id = t.id and su.resumed_at is null and su.cause = 'NON_PAYMENT'
     where i.id = new.invoice_id
  loop
    -- Un fallo al reactivar NUNCA tumba el registro del cobro: queda auditado
    -- y el ciclo diario lo vuelve a intentar.
    begin
      perform platform._resume_tenant_after_payment(r.tenant_id, current_date, 'PAYMENT');
    exception when others then
      perform platform.log_audit(
        'TENANT_AUTO_RESUME_FAILED', 'tenant', r.tenant_id::text, null, r.tenant_id,
        jsonb_build_object('payment_id', new.id, 'error', sqlerrm)
      );
    end;
  end loop;

  return null;
end;
$$;

revoke all on function platform.resume_tenants_on_payment() from public, anon, authenticated, service_role;

create trigger payments_resume_suspended_tenants
  after insert or update of status on platform.payments
  for each row
  when (new.status = 'CONFIRMED')
  execute function platform.resume_tenants_on_payment();

-- ---------------------------------------------------------------------------
-- 15. Read model de la consola: cada tenant de la suite con su estado
--     comercial, de cobranza y de entrega a la app. SECURITY INVOKER.
-- ---------------------------------------------------------------------------
create or replace view platform.v_tenant_lifecycle
with (security_invoker = true) as
with debt as (
  select d.tenant_id,
         count(*)::int                                          as overdue_invoices,
         case when count(distinct d.currency) = 1 then sum(d.balance) end as overdue_balance,
         case when count(distinct d.currency) = 1 then min(d.currency) end as overdue_currency,
         min(d.due_date)                                        as oldest_due_date,
         max(d.days_past_due)                                   as days_past_due,
         min(d.grace_ends_on)                                   as grace_ends_on,
         bool_or(current_date > d.grace_ends_on)                as grace_expired,
         bool_or(current_date > d.grace_ends_on and d.auto_suspend) as auto_suspend_due
    from platform.tenant_overdue_invoices(current_date) d
   group by d.tenant_id
)
select t.id                          as tenant_id,
       t.name                        as tenant_name,
       t.slug                        as tenant_slug,
       t.status                      as tenant_status,
       t.environment,
       t.deployment_mode,
       t.customer_organization_id,
       o.display_name                as organization_name,
       t.managing_organization_id,
       mo.display_name               as managing_organization_name,
       t.saas_product_id,
       p.code                        as product_code,
       p.short_name                  as product_short_name,
       p.accent_color                as product_accent_color,
       p.sort_order                  as product_sort_order,
       coalesce(debt.overdue_invoices, 0) as overdue_invoices,
       debt.overdue_balance,
       debt.overdue_currency,
       debt.oldest_due_date,
       debt.days_past_due,
       debt.grace_ends_on,
       coalesce(debt.grace_expired, false)    as grace_expired,
       coalesce(debt.auto_suspend_due, false) as auto_suspend_due,
       su.id                         as open_suspension_id,
       su.cause                      as suspension_cause,
       su.reason                     as suspension_reason,
       su.suspended_at,
       case
         when t.status = 'SUSPENDED' and su.cause = 'NON_PAYMENT' then 'SUSPENDED_NON_PAYMENT'
         when t.status = 'SUSPENDED'                              then 'SUSPENDED_MANUAL'
         when t.status <> 'ACTIVE'                                then 'INACTIVE'
         when coalesce(debt.auto_suspend_due, false)              then 'SUSPENSION_SCHEDULED'
         when coalesce(debt.grace_expired, false)                 then 'SUSPENSION_SUGGESTED'
         when coalesce(debt.overdue_invoices, 0) > 0              then 'IN_GRACE'
         else 'CURRENT'
       end                           as lifecycle_stage,
       es.state                      as sync_state,
       es.cohort_state,
       es.desired_version,
       es.applied_version,
       es.last_push_at,
       es.last_verified_at,
       coalesce(ds.desired_dirty, false) as desired_dirty,
       ds.last_change_reason,
       ds.last_change_at,
       ig.code                       as integration_code,
       coalesce(ig.entitlements_push_enabled, false) as push_enabled
  from platform.tenants t
  join platform.organizations o on o.id = t.customer_organization_id
  join platform.saas_products p on p.id = t.saas_product_id
  left join platform.organizations mo on mo.id = t.managing_organization_id
  left join debt on debt.tenant_id = t.id
  left join platform.tenant_suspensions su on su.tenant_id = t.id and su.resumed_at is null
  left join platform.entitlement_sync_state es
    on es.tenant_id = t.id and es.saas_product_id = t.saas_product_id
  left join platform.entitlement_desired_state ds
    on ds.tenant_id = t.id and ds.saas_product_id = t.saas_product_id
  left join lateral (
    select i.code, i.entitlements_push_enabled
      from platform.tenant_product_mappings m
      join platform.deployment_targets dt on dt.id = m.deployment_target_id
      join platform.product_integrations i on i.id = dt.product_integration_id
     where m.tenant_id = t.id and m.saas_product_id = t.saas_product_id and m.status = 'ACTIVE'
     limit 1
  ) ig on true;

comment on view platform.v_tenant_lifecycle is
  'Matriz de la suite: tenant × app con estado, deuda, etapa de ciclo de vida y entrega a la app. SECURITY INVOKER.';

revoke all on platform.v_tenant_lifecycle from public, anon;
grant select on platform.v_tenant_lifecycle to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 16. Jobs HTTP programados (entitlement-sync, payment-autocharge)
--
-- La URL del proyecto y la clave de servicio son del ENTORNO: viven en Vault
-- (`masteradmin_project_url`, `masteradmin_service_role_key`), las carga el
-- operador y nunca se commitean. Sin ellas, o con el interruptor apagado, la
-- ejecución no hace nada y lo deja anotado (una vez al día, no cada 5 minutos).
-- ---------------------------------------------------------------------------
create or replace function platform.invoke_scheduled_function(p_job text)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_settings platform.tenant_lifecycle_settings;
  v_function text;
  v_body     jsonb;
  v_enabled  boolean;
  v_url      text;
  v_key      text;
  v_request  bigint;
  v_outcome  text;
  v_detail   jsonb := '{}'::jsonb;
begin
  if not platform.is_system_job() then
    raise exception 'SOLO_SISTEMA: los jobs programados los dispara pg_cron' using errcode = '42501';
  end if;

  select * into v_settings from platform.tenant_lifecycle_settings where id;

  case p_job
    when 'ENTITLEMENT_SYNC' then
      v_function := 'entitlement-sync'; v_body := '{"job":"all","limit":20}'::jsonb;
      v_enabled := v_settings.entitlement_sync_enabled;
    when 'ENTITLEMENT_SWEEP' then
      v_function := 'entitlement-sync'; v_body := '{"job":"issue","sweep":true,"limit":100}'::jsonb;
      v_enabled := v_settings.entitlement_sync_enabled;
    when 'AUTOCHARGE' then
      v_function := 'payment-autocharge'; v_body := '{"run":true}'::jsonb;
      v_enabled := v_settings.autocharge_enabled;
    else
      raise exception 'JOB_DESCONOCIDO: %', p_job using errcode = '22023';
  end case;

  if not v_enabled then
    v_outcome := 'SKIPPED_DISABLED';
  elsif to_regclass('vault.decrypted_secrets') is null or to_regnamespace('net') is null then
    v_outcome := 'SKIPPED_NOT_CONFIGURED';
    v_detail := jsonb_build_object('missing', 'vault/pg_net');
  else
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
       into v_url using 'masteradmin_project_url';
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1'
       into v_key using 'masteradmin_service_role_key';
    if nullif(v_url, '') is null or nullif(v_key, '') is null then
      v_outcome := 'SKIPPED_NOT_CONFIGURED';
      v_detail := jsonb_build_object('missing', 'masteradmin_project_url/masteradmin_service_role_key');
    else
      begin
        execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 30000)'
           into v_request
          using rtrim(v_url, '/') || '/functions/v1/' || v_function, v_body,
                jsonb_build_object('content-type', 'application/json',
                                   'authorization', 'Bearer ' || v_key,
                                   'x-provisioning-secret', v_key);
        v_outcome := 'DISPATCHED';
        v_detail := jsonb_build_object('function', v_function, 'net_request_id', v_request);
      exception when others then
        v_outcome := 'FAILED';
        v_detail := jsonb_build_object('function', v_function, 'error', sqlerrm);
      end;
    end if;
  end if;

  -- Un «no hice nada» se anota una vez al día por job, no en cada disparo.
  if v_outcome not like 'SKIPPED%'
     or not exists (select 1 from platform.lifecycle_job_runs j
                     where j.job = p_job and j.outcome = v_outcome and j.ran_at > now() - interval '1 day') then
    insert into platform.lifecycle_job_runs (job, outcome, detail) values (p_job, v_outcome, v_detail);
  end if;

  return jsonb_build_object('job', p_job, 'outcome', v_outcome) || v_detail;
end;
$$;

comment on function platform.invoke_scheduled_function(text) is
  'Dispara una Edge Function desde pg_cron con pg_net y los secretos de Vault del entorno. '
  'Sin secretos o con el interruptor apagado no hace nada. Solo el job del sistema.';

revoke all on function platform.invoke_scheduled_function(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 17. GRANTS de las RPC públicas nuevas
-- ---------------------------------------------------------------------------
revoke all on function platform.run_tenant_lifecycle_cycle(timestamptz, boolean) from public, anon;
grant execute on function platform.run_tenant_lifecycle_cycle(timestamptz, boolean) to authenticated, service_role;
revoke all on function platform.set_tenant_lifecycle_settings(boolean, boolean, boolean, boolean) from public, anon;
grant execute on function platform.set_tenant_lifecycle_settings(boolean, boolean, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 18. Programación (pg_cron). Horas en UTC; Lima = UTC−5.
--     Si el entorno no tiene pg_cron o pg_net, la migración sigue: los jobs se
--     programan luego a mano (docs/runbooks/tenant-lifecycle.md).
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron no disponible (%): el ciclo de vida se programa a mano', sqlerrm;
  end;
  begin
    create extension if not exists pg_net with schema extensions;
  exception when others then
    raise notice 'pg_net no disponible (%): los jobs HTTP quedarán SKIPPED_NOT_CONFIGURED', sqlerrm;
  end;

  if to_regnamespace('cron') is not null then
    -- 06:00 Lima: alertas, suspensiones por impago (si están habilitadas) y reactivaciones.
    perform cron.schedule('ebim-tenant-lifecycle', '0 11 * * *',
      'select platform.run_tenant_lifecycle_cycle()');
    -- Cada 5 minutos: emitir, empujar y verificar entitlements en las apps.
    perform cron.schedule('ebim-entitlement-sync', '*/5 * * * *',
      $job$select platform.invoke_scheduled_function('ENTITLEMENT_SYNC')$job$);
    -- 00:15 Lima: barrido por paso del tiempo (vigencias, bajas programadas).
    perform cron.schedule('ebim-entitlement-sweep', '15 5 * * *',
      $job$select platform.invoke_scheduled_function('ENTITLEMENT_SWEEP')$job$);
    -- 08:00 Lima: cobro con tarjeta guardada (apagado por defecto).
    perform cron.schedule('ebim-payment-autocharge', '0 13 * * *',
      $job$select platform.invoke_scheduled_function('AUTOCHARGE')$job$);
  end if;
end;
$$;
