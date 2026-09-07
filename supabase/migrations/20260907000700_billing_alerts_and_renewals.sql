-- ============================================================================
-- EBIM Control Plane V2 — 20 · Renovaciones, alertas y suspensión
-- ----------------------------------------------------------------------------
-- Fase 11 de `.claude-prompts-v2`.
--
-- Convierte la CONFIGURACIÓN de cobranza (Fase 07) en trabajo pendiente medible.
--
-- DOS REGLAS QUE DEFINEN EL DISEÑO:
--
-- 1. DETERMINISMO. `refresh_billing_alerts(p_as_of)` recibe la fecha como
--    parámetro. Con la misma fecha y los mismos datos produce exactamente el
--    mismo resultado, así que un test puede afirmar igualdad en vez de
--    aproximaciones, y un fallo se reproduce.
--
-- 2. NADA SE SUSPENDE COMO EFECTO COLATERAL. Calcular alertas nunca cambia el
--    estado de un tenant. La suspensión es una función APARTE
--    (`apply_due_suspensions`) que hay que llamar a propósito. Un SELECT que
--    apaga clientes es la clase de sorpresa que nadie quiere depurar a las 3 AM.
-- ============================================================================

create type platform.billing_alert_type as enum (
  'REQUEST_DOCUMENT',  -- toca pedir la OS/OC al cliente
  'RENEWAL_NOTICE',    -- avisar de la renovación próxima
  'PAYMENT_DUE',       -- factura emitida, vencimiento cerca
  'PAST_DUE',          -- vencida y sin cobrar
  'GRACE_ENDING',      -- se acaba el periodo de gracia
  'SUSPENSION_DUE',    -- procede suspender según la política
  'PAYMENT_FAILURE',   -- el proveedor reportó un cobro fallido
  'DOCUMENT_EXPIRING'  -- la OS/OC aprobada vence pronto
);

create type platform.billing_alert_status as enum (
  'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED'
);

create table platform.billing_alerts (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references platform.subscriptions(id) on delete cascade,
  alert_type      platform.billing_alert_type not null,
  status          platform.billing_alert_status not null default 'OPEN',

  -- Cuándo hay que actuar. Es la fecha por la que se ordena el trabajo del día.
  due_at          timestamptz not null,
  -- Fecha del hecho que la origina (renovación, vencimiento de factura...).
  reference_date  date,

  /**
   * Clave de deduplicación. Es lo que hace idempotente al motor: la alerta
   * «PAST_DUE de la factura X» tiene siempre la misma clave, así que recalcular
   * mil veces no crea mil filas.
   */
  dedupe_key      text not null,

  severity        text not null default 'INFO',
  title           text not null,
  message         text,
  metadata        jsonb not null default '{}'::jsonb,

  invoice_id      uuid references platform.invoices(id) on delete set null,
  document_id     uuid references platform.subscription_commercial_documents(id) on delete set null,

  created_at      timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at     timestamptz,
  resolved_by     uuid references auth.users(id) on delete set null,

  constraint billing_alerts_dedupe_uk unique (dedupe_key),
  constraint billing_alerts_severity_ck check (severity in ('INFO', 'WARNING', 'CRITICAL'))
);

comment on table platform.billing_alerts is
  'Trabajo de cobranza pendiente, materializado. `dedupe_key` hace que recalcular '
  'sea idempotente: la misma situación no genera una alerta nueva cada vez.';

create index billing_alerts_subscription_idx on platform.billing_alerts(subscription_id);
create index billing_alerts_status_due_idx on platform.billing_alerts(status, due_at);
create index billing_alerts_type_idx on platform.billing_alerts(alert_type);
create index billing_alerts_invoice_idx on platform.billing_alerts(invoice_id);
create index billing_alerts_document_idx on platform.billing_alerts(document_id);
create index billing_alerts_resolved_by_idx on platform.billing_alerts(resolved_by);

alter table platform.billing_alerts enable row level security;
alter table platform.billing_alerts force row level security;

grant select on platform.billing_alerts to authenticated;
revoke insert, update, delete on platform.billing_alerts from authenticated;

create policy billing_alerts_select on platform.billing_alerts
  for select to authenticated
  using (
    exists (
      select 1 from platform.subscriptions s
       where s.id = billing_alerts.subscription_id
         and (
           platform.can_read_finance()
           or platform.can_manage_platform_entities()
           or s.billed_organization_id in (select platform.my_org_ids())
         )
    )
  );

-- ---------------------------------------------------------------------------
-- next_renewal_date — cuándo toca renovar.
--
-- Si la suscripción tiene fecha de fin explícita, esa manda. Si no, se avanza
-- desde el inicio en saltos del intervalo hasta pasar la fecha de referencia.
-- Se hace con aritmética de fechas y no con un bucle para que sea inmutable y
-- pueda usarse en índices y vistas.
-- ---------------------------------------------------------------------------
create or replace function platform.next_renewal_date(
  p_started_on       date,
  p_ends_on          date,
  p_billing_interval platform.billing_interval,
  p_as_of            date default current_date
)
returns date
language plpgsql
immutable
as $$
declare
  v_step_months integer;
  v_elapsed     integer;
  v_periods     integer;
  v_candidate   date;
begin
  -- Una fecha de fin explícita manda sobre cualquier proyección.
  if p_ends_on is not null then
    return p_ends_on;
  end if;
  if p_billing_interval = 'ONE_TIME' then
    return null;  -- un cargo único no renueva
  end if;

  v_step_months := case p_billing_interval
    when 'MONTHLY'   then 1
    when 'QUARTERLY' then 3
    when 'YEARLY'    then 12
    else 1
  end;

  if p_as_of <= p_started_on then
    return p_started_on;
  end if;

  -- Meses completos transcurridos. Se usa `age()` y no epoch/30 días: un mes no
  -- son 30 días, y con epoch el aniversario se desplaza unos días cada año.
  v_elapsed := (extract(year from age(p_as_of, p_started_on)) * 12
              + extract(month from age(p_as_of, p_started_on)))::integer;

  v_periods := v_elapsed / v_step_months;
  v_candidate := (p_started_on + (v_periods * v_step_months) * interval '1 month')::date;

  -- Si hoy ES el aniversario, la renovación es hoy, no la siguiente.
  if v_candidate >= p_as_of then
    return v_candidate;
  end if;

  return (p_started_on + ((v_periods + 1) * v_step_months) * interval '1 month')::date;
end;
$$;

comment on function platform.next_renewal_date is
  'Próxima renovación. `ends_on` explícito manda; si no, se proyecta desde el '
  'inicio con el intervalo de facturación. ONE_TIME no renueva: devuelve NULL.';

-- ---------------------------------------------------------------------------
-- refresh_billing_alerts — el motor. Determinista e idempotente.
--
-- `p_as_of` es obligatoriamente un parámetro para que los tests fijen la fecha.
-- Devuelve cuántas alertas NUEVAS creó: en una segunda pasada con la misma
-- fecha debe devolver 0.
-- ---------------------------------------------------------------------------
create or replace function platform.refresh_billing_alerts(p_as_of timestamptz default now())
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
  if not (platform.can_manage_commercial() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo EBIM recalcula las alertas de cobranza'
      using errcode = '42501';
  end if;

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

comment on function platform.refresh_billing_alerts is
  'Recalcula el trabajo de cobranza pendiente. Determinista (recibe la fecha) e '
  'idempotente (dedupe_key). NUNCA cambia el estado de un tenant.';

-- ---------------------------------------------------------------------------
-- Resolución automática al cobrarse una factura.
--
-- Esto es lo que evita que el tablero se llene de alertas zombis: cuando entra
-- el dinero, las alertas de esa factura se cierran solas, sin esperar a que
-- alguien ejecute el refresh.
-- ---------------------------------------------------------------------------
create or replace function platform.resolve_alerts_on_payment()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_total numeric(14,2);
  v_paid  numeric(14,2);
begin
  if new.status <> 'CONFIRMED' then
    return null;
  end if;

  select i.total into v_total from platform.invoices i where i.id = new.invoice_id;

  select coalesce(sum(p.amount), 0) into v_paid
    from platform.payments p
   where p.invoice_id = new.invoice_id and p.status = 'CONFIRMED';

  -- Un pago parcial no cierra nada: la factura sigue vencida por el resto.
  if v_paid < v_total then
    return null;
  end if;

  update platform.billing_alerts
     set status = 'RESOLVED', resolved_at = now()
   where invoice_id = new.invoice_id
     and status in ('OPEN', 'ACKNOWLEDGED')
     and alert_type in ('PAYMENT_DUE', 'PAST_DUE', 'GRACE_ENDING', 'SUSPENSION_DUE');

  -- Un cobro correcto también cierra el fallo previo del proveedor.
  update platform.billing_alerts a
     set status = 'RESOLVED', resolved_at = now()
    from platform.invoices i
   where i.id = new.invoice_id
     and a.subscription_id = i.subscription_id
     and a.alert_type = 'PAYMENT_FAILURE'
     and a.status in ('OPEN', 'ACKNOWLEDGED');

  return null;
end;
$$;

create trigger payments_resolve_alerts
  after insert or update of status on platform.payments
  for each row execute function platform.resolve_alerts_on_payment();

-- ---------------------------------------------------------------------------
-- apply_due_suspensions — la ÚNICA función que suspende.
--
-- Separada del refresh a propósito: calcular no puede apagar clientes. Además
-- solo actúa sobre alertas cuya política dice `auto_suspend`, y encola el
-- trabajo de infraestructura en DRY_RUN.
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
  if not (platform.can_manage_platform_entities() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: suspender exige rol de plataforma' using errcode = '42501';
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

    perform platform.request_tenant_suspension(
      r.tenant_id,
      'Suspensión automática por impago de la suscripción ' || r.subscription_code,
      p_mode
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

comment on function platform.apply_due_suspensions is
  'ÚNICA función que suspende por impago. Separada del cálculo de alertas a '
  'propósito: un SELECT no puede apagar clientes.';

-- ---------------------------------------------------------------------------
-- Gestión manual de una alerta
-- ---------------------------------------------------------------------------
create or replace function platform.set_billing_alert_status(
  p_alert_id uuid,
  p_status   platform.billing_alert_status,
  p_note     text default null
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_alert record;
begin
  select a.*, s.billed_organization_id
    into v_alert
    from platform.billing_alerts a
    join platform.subscriptions s on s.id = a.subscription_id
   where a.id = p_alert_id;

  if v_alert is null then
    raise exception 'ALERTA_NO_ENCONTRADA: %', p_alert_id using errcode = '23503';
  end if;

  if not (
    platform.can_manage_commercial()
    or platform.is_org_admin(v_alert.billed_organization_id)
  ) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501';
  end if;

  update platform.billing_alerts
     set status = p_status,
         acknowledged_at = case when p_status = 'ACKNOWLEDGED' then now() else acknowledged_at end,
         resolved_at = case when p_status in ('RESOLVED', 'CANCELLED') then now() else resolved_at end,
         resolved_by = case when p_status in ('RESOLVED', 'CANCELLED') then auth.uid() else resolved_by end,
         metadata = case when p_note is null then metadata
                         else metadata || jsonb_build_object('note', p_note) end
   where id = p_alert_id;

  perform platform.log_audit(
    'BILLING_ALERT_STATUS_CHANGED', 'billing_alert', p_alert_id::text,
    v_alert.billed_organization_id, null,
    jsonb_build_object('from', v_alert.status, 'to', p_status, 'note', p_note)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Vista del tablero de renovaciones (7/15/30/45/60 días).
-- ---------------------------------------------------------------------------
create or replace view platform.v_renewal_dashboard
with (security_invoker = true) as
select
  c.subscription_id,
  c.subscription_code,
  c.subscription_status,
  c.billed_organization_id,
  c.billed_organization_name,
  c.product_code,
  c.product_short_name,
  c.tenant_id,
  c.tenant_name,
  c.collection_method,
  c.provider_account_code,
  c.billing_interval,
  c.currency,
  c.auto_suspend,
  c.grace_period_days,
  platform.next_renewal_date(c.started_on, c.ends_on, c.billing_interval, current_date) as renewal_on,
  (platform.next_renewal_date(c.started_on, c.ends_on, c.billing_interval, current_date) - current_date)
    as days_to_renewal,
  -- Ventana comercial: es como gerencia mira la cartera.
  case
    when platform.next_renewal_date(c.started_on, c.ends_on, c.billing_interval, current_date) is null
      then 'SIN_RENOVACION'
    when platform.next_renewal_date(c.started_on, c.ends_on, c.billing_interval, current_date) - current_date <= 7  then 'D7'
    when platform.next_renewal_date(c.started_on, c.ends_on, c.billing_interval, current_date) - current_date <= 15 then 'D15'
    when platform.next_renewal_date(c.started_on, c.ends_on, c.billing_interval, current_date) - current_date <= 30 then 'D30'
    when platform.next_renewal_date(c.started_on, c.ends_on, c.billing_interval, current_date) - current_date <= 45 then 'D45'
    when platform.next_renewal_date(c.started_on, c.ends_on, c.billing_interval, current_date) - current_date <= 60 then 'D60'
    else 'LEJOS'
  end as renewal_window,
  (select count(*) from platform.billing_alerts a
    where a.subscription_id = c.subscription_id and a.status = 'OPEN')                  as open_alerts,
  (select count(*) from platform.billing_alerts a
    where a.subscription_id = c.subscription_id and a.status = 'OPEN'
      and a.severity = 'CRITICAL')                                                      as critical_alerts,
  (select bool_or(a.alert_type = 'PAST_DUE') from platform.billing_alerts a
    where a.subscription_id = c.subscription_id and a.status = 'OPEN')                  as is_past_due,
  (select bool_or(a.alert_type = 'GRACE_ENDING') from platform.billing_alerts a
    where a.subscription_id = c.subscription_id and a.status = 'OPEN')                  as in_grace,
  (select bool_or(a.alert_type = 'SUSPENSION_DUE') from platform.billing_alerts a
    where a.subscription_id = c.subscription_id and a.status = 'OPEN')                  as suspension_pending
from platform.v_subscription_collection c
where c.subscription_status in ('ACTIVE', 'PAST_DUE');

grant select on platform.v_renewal_dashboard to authenticated;
revoke all on platform.v_renewal_dashboard from anon;

-- ---------------------------------------------------------------------------
-- GRANTS
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'platform'
       and p.proname in (
         'next_renewal_date', 'refresh_billing_alerts', 'apply_due_suspensions',
         'set_billing_alert_status', 'resolve_alerts_on_payment'
       )
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cómo activarlo por cron en producción (NO se activa aquí).
--
--   select cron.schedule(
--     'ebim-billing-alerts', '0 6 * * *',
--     $cron$ select platform.refresh_billing_alerts(); $cron$
--   );
--   select cron.schedule(
--     'ebim-billing-suspensions', '30 6 * * *',
--     $cron$ select platform.apply_due_suspensions(now(), 'DRY_RUN'); $cron$
--   );
--
-- Se deja documentado y NO programado a propósito: activar un cron que suspende
-- clientes es una decisión del operador, no un efecto de aplicar una migración.
-- Requiere `create extension pg_cron` y que el operador lo autorice.
-- ---------------------------------------------------------------------------
