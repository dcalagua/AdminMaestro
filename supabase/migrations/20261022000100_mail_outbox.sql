-- ============================================================================
-- Correo del Admin Maestro por EBIM MailHub (20261022000100)
--
--   · `mail_outbox`: bandeja durable de salida. Un evento de negocio encola UNA
--     fila por destinatario con una clave idempotente estable; la Edge Function
--     `mail-dispatch` la entrega a MailHub (plantillas `masteradmin-*`) y
--     `mailhub-callback` guarda el estado de entrega (`mail_events`).
--   · Los eventos salen de triggers sobre hechos que YA existen (nada nuevo en
--     los flujos de negocio): factura emitida, pago CONFIRMED, alerta PAST_DUE,
--     suspensión por impago y su levantamiento, tenant PENDING → ACTIVE, fin de
--     una sincronización con diferencias y alta fallida.
--   · Los triggers son CONSTRAINT TRIGGER diferidos: corren al COMMIT, cuando la
--     factura ya tiene su total y el pago ya movió el estado de la factura. Si
--     algo del correo falla, se anota un WARNING y el negocio sigue: un correo
--     nunca bloquea un cobro.
--   · RLS forzada. Lectura en la consola para super admin, producto y finanzas;
--     escritura SOLO por funciones SECURITY DEFINER. `secret_variables` (el
--     token del portal de pago mientras el correo está en vuelo) no se concede
--     a `authenticated` ni aparece en la vista.
--   · Job `MAIL_DISPATCH` en `invoke_scheduled_function` (cada minuto, solo si
--     hay correo pendiente) y disparo inmediato `_mail_kick()` al encolar. Ambos
--     necesitan los secretos de Vault del entorno; sin ellos no hacen nada y el
--     operador usa «Procesar ahora» en Gobierno › Correos.
--
-- Pruebas: supabase/tests/59_mail_outbox.test.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ¿Quién ve el correo?
-- ---------------------------------------------------------------------------
create or replace function platform.can_view_mail()
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select platform.is_super_admin()
      or platform.can_manage_platform_entities()
      or platform.can_read_finance();
$$;

comment on function platform.can_view_mail() is
  'Super admin, producto (EBIM_PRODUCT_ADMIN) o finanzas: ven y gestionan la bandeja de correo.';

revoke all on function platform.can_view_mail() from public, anon;
grant execute on function platform.can_view_mail() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Configuración (fila única)
-- ---------------------------------------------------------------------------
create table if not exists platform.mail_settings (
  id                     boolean primary key default true,
  business_mail_enabled  boolean not null default true,
  ops_recipients         text[] not null default '{}',
  updated_at             timestamptz not null default now(),
  updated_by             uuid references platform.profiles (id) on delete set null,
  constraint mail_settings_singleton_ck check (id),
  constraint mail_settings_ops_max_ck check (cardinality(ops_recipients) <= 10)
);

comment on table platform.mail_settings is
  'Interruptor del correo de negocio y destinatarios internos del resumen de operaciones. '
  'El modo de entrega (allowlist/redirect/live) es un secreto de la Edge Function, no un dato.';

insert into platform.mail_settings (id) values (true) on conflict (id) do nothing;

create index if not exists mail_settings_updated_by_ix on platform.mail_settings (updated_by);

alter table platform.mail_settings enable row level security;
alter table platform.mail_settings force row level security;
revoke all on platform.mail_settings from public, anon, authenticated;
grant select on platform.mail_settings to authenticated, service_role;
drop policy if exists mail_settings_select on platform.mail_settings;
create policy mail_settings_select on platform.mail_settings
  for select to authenticated using (platform.can_view_mail());

-- ---------------------------------------------------------------------------
-- 3. Bandeja de salida
-- ---------------------------------------------------------------------------
create table if not exists platform.mail_outbox (
  id                  uuid primary key default gen_random_uuid(),
  category            text not null,
  event_type          text not null,
  template_key        text not null,
  recipient_email     text,
  recipient_name      text,
  variables           jsonb not null default '{}'::jsonb,
  -- Credenciales de un solo uso mientras el correo está en vuelo (token del
  -- portal de pago). Se borra al cerrar el envío. Sin GRANT a authenticated.
  secret_variables    jsonb,
  needs_payment_link  boolean not null default false,
  -- Clave del EVENTO (deduplica el encolado). La clave hacia MailHub es
  -- `idempotency_key` + `-r<n>` si un operador pidió reenviar.
  idempotency_key     text not null,
  resend_count        integer not null default 0,
  organization_id     uuid references platform.organizations (id) on delete set null,
  tenant_id           uuid references platform.tenants (id) on delete set null,
  invoice_id          uuid references platform.invoices (id) on delete set null,
  payment_id          uuid references platform.payments (id) on delete set null,
  reference_label     text,
  status              text not null default 'PENDING',
  status_detail       text,
  delivery_mode       text,
  delivered_to        text,
  attempts            integer not null default 0,
  next_attempt_at     timestamptz not null default now(),
  locked_at           timestamptz,
  mailhub_email_id    text,
  mailhub_status      text,
  last_error_code     text,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  last_event_at       timestamptz,
  created_by          uuid references platform.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint mail_outbox_idempotency_uk unique (idempotency_key),
  constraint mail_outbox_category_ck check (category in ('AUTH', 'BUSINESS', 'OPS', 'TEST')),
  constraint mail_outbox_event_ck check (event_type in (
    'AUTH_INVITE', 'AUTH_RECOVERY', 'AUTH_MAGICLINK', 'AUTH_SIGNUP', 'AUTH_EMAIL_CHANGE', 'AUTH_REAUTHENTICATION',
    'INVOICE_ISSUED', 'PAYMENT_CONFIRMED', 'INVOICE_OVERDUE', 'TENANT_SUSPENDED', 'TENANT_REACTIVATED',
    'TENANT_ACTIVATED', 'OPS_SYNC_DIGEST', 'OPS_PROVISIONING_FAILED', 'TEST'
  )),
  constraint mail_outbox_template_ck check (template_key ~ '^masteradmin-[a-z0-9-]{2,60}$'),
  constraint mail_outbox_status_ck check (status in (
    'PENDING', 'SENDING', 'SENT', 'DELIVERED', 'DELAYED', 'BOUNCED', 'COMPLAINED', 'FAILED',
    'SUPPRESSED', 'HELD', 'SKIPPED', 'CANCELLED'
  )),
  constraint mail_outbox_recipient_ck check (
    recipient_email is null or recipient_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-zA-Z0-9-]{2,}$'
  ),
  constraint mail_outbox_recipient_required_ck check (recipient_email is not null or status in ('SKIPPED', 'CANCELLED')),
  constraint mail_outbox_mode_ck check (delivery_mode is null or delivery_mode in ('allowlist', 'redirect', 'live')),
  constraint mail_outbox_attempts_ck check (attempts >= 0 and resend_count >= 0),
  constraint mail_outbox_idem_len_ck check (length(idempotency_key) between 8 and 200)
);

comment on table platform.mail_outbox is
  'Bandeja durable de correo del Admin Maestro (MailHub). Una fila por destinatario y evento. '
  'Escriben solo las funciones de la migración 20261022000100; la consola lee por v_mail_outbox.';
comment on column platform.mail_outbox.secret_variables is
  'Token de un solo uso del portal de pago mientras el correo está en vuelo. Se borra al cerrar el envío.';

create index if not exists mail_outbox_pending_ix on platform.mail_outbox (next_attempt_at)
  where status in ('PENDING', 'SENDING');
create index if not exists mail_outbox_email_ix on platform.mail_outbox (mailhub_email_id) where mailhub_email_id is not null;
create index if not exists mail_outbox_created_ix on platform.mail_outbox (created_at desc);
create index if not exists mail_outbox_org_ix on platform.mail_outbox (organization_id);
create index if not exists mail_outbox_tenant_ix on platform.mail_outbox (tenant_id);
create index if not exists mail_outbox_invoice_ix on platform.mail_outbox (invoice_id);
create index if not exists mail_outbox_payment_ix on platform.mail_outbox (payment_id);
create index if not exists mail_outbox_created_by_ix on platform.mail_outbox (created_by);

drop trigger if exists mail_outbox_set_updated_at on platform.mail_outbox;
create trigger mail_outbox_set_updated_at before update on platform.mail_outbox
  for each row execute function platform.set_updated_at();

-- Callbacks de MailHub (deduplicados por eventId: la entrega es al menos una vez).
create table if not exists platform.mail_events (
  event_id          text primary key,
  outbox_id         uuid references platform.mail_outbox (id) on delete cascade,
  mailhub_email_id  text,
  event_type        text not null,
  message_status    text,
  recipient         text,
  occurred_at       timestamptz,
  received_at       timestamptz not null default now(),
  detail            jsonb not null default '{}'::jsonb,
  constraint mail_events_id_ck check (length(event_id) between 4 and 120),
  constraint mail_events_type_ck check (event_type ~ '^[a-z_]+\.[a-z_]+$')
);

create index if not exists mail_events_outbox_ix on platform.mail_events (outbox_id, occurred_at);
create index if not exists mail_events_received_ix on platform.mail_events (received_at desc);

comment on table platform.mail_events is
  'Eventos de entrega que MailHub envía firmados a mailhub-callback. Append-only.';

alter table platform.mail_outbox enable row level security;
alter table platform.mail_outbox force row level security;
alter table platform.mail_events enable row level security;
alter table platform.mail_events force row level security;

revoke all on platform.mail_outbox from public, anon, authenticated;
revoke all on platform.mail_events from public, anon, authenticated;
-- Lectura por columnas: todo menos `secret_variables`.
grant select (
  id, category, event_type, template_key, recipient_email, recipient_name, variables, needs_payment_link,
  idempotency_key, resend_count, organization_id, tenant_id, invoice_id, payment_id, reference_label, status,
  status_detail, delivery_mode, delivered_to, attempts, next_attempt_at, locked_at, mailhub_email_id,
  mailhub_status, last_error_code, sent_at, delivered_at, last_event_at, created_by, created_at, updated_at
) on platform.mail_outbox to authenticated;
grant select on platform.mail_outbox to service_role;
grant select on platform.mail_events to authenticated, service_role;

drop policy if exists mail_outbox_select on platform.mail_outbox;
create policy mail_outbox_select on platform.mail_outbox
  for select to authenticated using (platform.can_view_mail());
drop policy if exists mail_events_select on platform.mail_events;
create policy mail_events_select on platform.mail_events
  for select to authenticated using (platform.can_view_mail());

-- Vista de la consola (SECURITY INVOKER: la RLS de la tabla decide).
create or replace view platform.v_mail_outbox
with (security_invoker = true)
as
select
  m.id, m.category, m.event_type, m.template_key, m.recipient_email, m.recipient_name, m.variables,
  m.reference_label, m.status, m.status_detail, m.delivery_mode, m.delivered_to, m.attempts, m.resend_count,
  m.next_attempt_at, m.mailhub_email_id, m.mailhub_status, m.last_error_code, m.sent_at, m.delivered_at,
  m.last_event_at, m.created_at, m.updated_at,
  m.organization_id, o.display_name as organization_name,
  m.tenant_id, t.name as tenant_name,
  m.invoice_id, i.number as invoice_number,
  m.payment_id
from platform.mail_outbox m
left join platform.organizations o on o.id = m.organization_id
left join platform.tenants t on t.id = m.tenant_id
left join platform.invoices i on i.id = m.invoice_id;

revoke all on platform.v_mail_outbox from public, anon;
grant select on platform.v_mail_outbox to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Formato (español de negocio, hora de Lima)
-- ---------------------------------------------------------------------------
create or replace function platform._mail_money(p_amount numeric, p_currency text)
returns text
language sql
immutable
set search_path = platform, pg_catalog
as $$
  select coalesce(p_currency, '') || ' ' || to_char(coalesce(p_amount, 0), 'FM999,999,999,990.00');
$$;

create or replace function platform._mail_date(p_date date)
returns text
language sql
immutable
set search_path = platform, pg_catalog
as $$
  select coalesce(to_char(p_date, 'DD/MM/YYYY'), '—');
$$;

create or replace function platform._mail_datetime(p_at timestamptz)
returns text
language sql
stable
set search_path = platform, pg_catalog
as $$
  select coalesce(to_char(p_at at time zone 'America/Lima', 'DD/MM/YYYY HH24:MI'), '—');
$$;

revoke all on function platform._mail_money(numeric, text) from public, anon, authenticated;
revoke all on function platform._mail_date(date) from public, anon, authenticated;
revoke all on function platform._mail_datetime(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Disparo inmediato (pg_net + Vault; sin secretos no hace nada)
-- ---------------------------------------------------------------------------
create or replace function platform._mail_kick()
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_url text;
  v_key text;
begin
  -- Una sola llamada por transacción, aunque se encolen varios correos.
  if coalesce(current_setting('platform.mail_kicked', true), '') = 'on' then
    return;
  end if;
  perform set_config('platform.mail_kicked', 'on', true);

  if to_regclass('vault.decrypted_secrets') is null or to_regnamespace('net') is null then
    return;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_url using 'masteradmin_project_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_key using 'masteradmin_service_role_key';
  if nullif(v_url, '') is null or nullif(v_key, '') is null then
    return;
  end if;
  -- pg_net encola la petición en una tabla: sale DESPUÉS del commit, nunca antes.
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
    using rtrim(v_url, '/') || '/functions/v1/mail-dispatch', '{"trigger":"ENQUEUE"}'::jsonb,
          jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || v_key,
                             'x-provisioning-secret', v_key),
          30000;
exception when others then
  raise warning 'MAIL_KICK: %', sqlerrm;
end;
$$;

revoke all on function platform._mail_kick() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Encolar (interno: solo lo llaman los triggers y las RPC de esta migración)
-- ---------------------------------------------------------------------------
create or replace function platform._mail_enqueue(
  p_category        text,
  p_event_type      text,
  p_template_key    text,
  p_to              text,
  p_to_name         text,
  p_variables       jsonb,
  p_idempotency_key text,
  p_organization_id uuid default null,
  p_tenant_id       uuid default null,
  p_invoice_id      uuid default null,
  p_payment_id      uuid default null,
  p_reference_label text default null,
  p_needs_link      boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_to      text := lower(nullif(btrim(coalesce(p_to, '')), ''));
  v_enabled boolean;
  v_status  text := 'PENDING';
  v_detail  text;
  v_id      uuid;
begin
  select business_mail_enabled into v_enabled from platform.mail_settings where id;

  if v_to is null or v_to !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-zA-Z0-9-]{2,}$' then
    v_to := null;
    v_status := 'SKIPPED';
    v_detail := 'Sin destinatario: falta el correo de contacto';
  elsif p_category in ('BUSINESS', 'OPS') and not coalesce(v_enabled, true) then
    v_status := 'SKIPPED';
    v_detail := 'El correo de negocio está desactivado (Gobierno › Correos)';
  end if;

  insert into platform.mail_outbox (
    category, event_type, template_key, recipient_email, recipient_name, variables, idempotency_key,
    organization_id, tenant_id, invoice_id, payment_id, reference_label, needs_payment_link, status, status_detail,
    created_by
  ) values (
    p_category, p_event_type, p_template_key, v_to, nullif(btrim(coalesce(p_to_name, '')), ''),
    coalesce(p_variables, '{}'::jsonb), p_idempotency_key, p_organization_id, p_tenant_id, p_invoice_id, p_payment_id,
    left(p_reference_label, 200), coalesce(p_needs_link, false), v_status, v_detail,
    (select p.id from platform.profiles p where p.id = auth.uid())
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is not null and v_status = 'PENDING' then
    perform platform._mail_kick();
  end if;
  return v_id;
end;
$$;

revoke all on function platform._mail_enqueue(text, text, text, text, text, jsonb, text, uuid, uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;

-- Contacto de facturación de una organización (o el administrador del tenant).
create or replace function platform._mail_billing_contact(p_org uuid, p_fallback text default null)
returns table (email text, name text, org_name text)
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select coalesce(nullif(btrim(o.billing_email), ''), p_fallback),
         nullif(btrim(concat_ws(' ', o.billing_first_name, o.billing_last_name)), ''),
         coalesce(nullif(btrim(o.legal_name), ''), o.display_name)
    from platform.organizations o
   where o.id = p_org;
$$;

revoke all on function platform._mail_billing_contact(uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Eventos de negocio (constraint triggers diferidos: corren al COMMIT)
-- ---------------------------------------------------------------------------

-- 7.1 Factura emitida (con enlace al portal de pago, que se genera al ENVIAR).
create or replace function platform._mail_on_invoice_issued()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_inv     platform.invoices;
  v_contact record;
begin
  select * into v_inv from platform.invoices where id = new.id;
  -- Al commit: si ya quedó pagada (alta automática de un cobro Culqi) o anulada, no se avisa.
  if v_inv.id is null or v_inv.status not in ('ISSUED', 'PARTIALLY_PAID') or v_inv.total <= 0 then
    return null;
  end if;
  select * into v_contact from platform._mail_billing_contact(v_inv.customer_organization_id);
  perform platform._mail_enqueue(
    'BUSINESS', 'INVOICE_ISSUED', 'masteradmin-factura-emitida', v_contact.email, v_contact.name,
    jsonb_build_object(
      'cliente', v_contact.org_name,
      'numero', v_inv.number,
      'periodo', case when v_inv.period_start is null then '—'
                      else platform._mail_date(v_inv.period_start) || ' – ' || platform._mail_date(v_inv.period_end) end,
      'emision', platform._mail_date(v_inv.issue_date),
      'vencimiento', platform._mail_date(v_inv.due_date),
      'monto', platform._mail_money(v_inv.total, v_inv.currency)
    ),
    'invoice-issued-' || v_inv.id::text,
    v_inv.customer_organization_id, null, v_inv.id, null, v_inv.number, true
  );
  return null;
exception when others then
  raise warning 'MAIL_INVOICE_ISSUED %: %', new.id, sqlerrm;
  return null;
end;
$$;

drop trigger if exists invoices_mail_issued on platform.invoices;
create constraint trigger invoices_mail_issued
  after insert or update of status on platform.invoices
  deferrable initially deferred
  for each row when (new.status = 'ISSUED')
  execute function platform._mail_on_invoice_issued();

-- 7.2 Pago confirmado: recibo.
create or replace function platform._mail_on_payment_confirmed()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_pay     platform.payments;
  v_inv     platform.invoices;
  v_paid    numeric;
  v_contact record;
begin
  select * into v_pay from platform.payments where id = new.id;
  if v_pay.id is null or v_pay.status <> 'CONFIRMED' then
    return null;
  end if;
  select * into v_inv from platform.invoices where id = v_pay.invoice_id;
  select coalesce(sum(p.amount), 0) into v_paid
    from platform.payments p where p.invoice_id = v_inv.id and p.status = 'CONFIRMED';
  select * into v_contact from platform._mail_billing_contact(v_inv.customer_organization_id);
  perform platform._mail_enqueue(
    'BUSINESS', 'PAYMENT_CONFIRMED', 'masteradmin-pago-confirmado', v_contact.email, v_contact.name,
    jsonb_build_object(
      'cliente', v_contact.org_name,
      'numero', v_inv.number,
      'monto', platform._mail_money(v_pay.amount, v_pay.currency),
      'fecha_pago', platform._mail_date((v_pay.paid_at at time zone 'America/Lima')::date),
      'medio', case upper(coalesce(v_pay.method, ''))
                 when 'CULQI_CARD' then 'Tarjeta'
                 when 'CARD' then 'Tarjeta'
                 when 'TRANSFER' then 'Transferencia bancaria'
                 when 'DEPOSIT' then 'Depósito'
                 when 'CASH' then 'Efectivo'
                 when '' then 'No especificado'
                 else initcap(replace(lower(v_pay.method), '_', ' ')) end,
      'referencia', coalesce(nullif(split_part(v_pay.reference, ':', 2), ''), v_pay.reference),
      'saldo', platform._mail_money(greatest(v_inv.total - v_paid, 0), v_inv.currency),
      'estado_factura', case v_inv.status when 'PAID' then 'Pagada'
                                          when 'PARTIALLY_PAID' then 'Pago parcial'
                                          else 'Emitida' end
    ),
    'payment-confirmed-' || v_pay.id::text,
    v_inv.customer_organization_id, null, v_inv.id, v_pay.id, v_inv.number, false
  );
  return null;
exception when others then
  raise warning 'MAIL_PAYMENT_CONFIRMED %: %', new.id, sqlerrm;
  return null;
end;
$$;

drop trigger if exists payments_mail_confirmed on platform.payments;
create constraint trigger payments_mail_confirmed
  after insert or update of status on platform.payments
  deferrable initially deferred
  for each row when (new.status = 'CONFIRMED')
  execute function platform._mail_on_payment_confirmed();

-- 7.3 Factura vencida: una vez por factura (alerta PAST_DUE, deduplicada por el motor).
create or replace function platform._mail_on_past_due_alert()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_inv     platform.invoices;
  v_paid    numeric;
  v_contact record;
begin
  select * into v_inv from platform.invoices where id = new.invoice_id;
  if v_inv.id is null or v_inv.status not in ('ISSUED', 'PARTIALLY_PAID') then
    return null;
  end if;
  select coalesce(sum(p.amount), 0) into v_paid
    from platform.payments p where p.invoice_id = v_inv.id and p.status = 'CONFIRMED';
  if v_inv.total - v_paid <= 0 then
    return null;
  end if;
  select * into v_contact from platform._mail_billing_contact(v_inv.customer_organization_id);
  perform platform._mail_enqueue(
    'BUSINESS', 'INVOICE_OVERDUE', 'masteradmin-factura-vencida', v_contact.email, v_contact.name,
    jsonb_build_object(
      'cliente', v_contact.org_name,
      'numero', v_inv.number,
      'vencimiento', platform._mail_date(v_inv.due_date),
      'dias_vencida', greatest((current_date - v_inv.due_date), 0)::text,
      'saldo', platform._mail_money(v_inv.total - v_paid, v_inv.currency)
    ),
    'invoice-overdue-' || v_inv.id::text,
    v_inv.customer_organization_id, null, v_inv.id, null, v_inv.number, true
  );
  return null;
exception when others then
  raise warning 'MAIL_INVOICE_OVERDUE %: %', new.id, sqlerrm;
  return null;
end;
$$;

drop trigger if exists billing_alerts_mail_past_due on platform.billing_alerts;
create constraint trigger billing_alerts_mail_past_due
  after insert on platform.billing_alerts
  deferrable initially deferred
  for each row when (new.alert_type = 'PAST_DUE' and new.invoice_id is not null)
  execute function platform._mail_on_past_due_alert();

-- 7.4 Suspensión por impago y su levantamiento.
create or replace function platform._mail_on_tenant_suspension()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_s       platform.tenant_suspensions;
  v_tenant  record;
  v_contact record;
begin
  select * into v_s from platform.tenant_suspensions where id = new.id;
  if v_s.id is null or v_s.cause <> 'NON_PAYMENT' then
    return null;
  end if;
  select t.id, t.name, t.admin_email, t.customer_organization_id, p.lockup_name
    into v_tenant
    from platform.tenants t join platform.saas_products p on p.id = t.saas_product_id
   where t.id = v_s.tenant_id;
  select * into v_contact from platform._mail_billing_contact(v_tenant.customer_organization_id, v_tenant.admin_email);

  if tg_op = 'INSERT' then
    perform platform._mail_enqueue(
      'BUSINESS', 'TENANT_SUSPENDED', 'masteradmin-tenant-suspendido', v_contact.email, v_contact.name,
      jsonb_build_object(
        'cliente', v_contact.org_name,
        'tenant', v_tenant.name,
        'app', v_tenant.lockup_name,
        'fecha', platform._mail_date((v_s.suspended_at at time zone 'America/Lima')::date),
        'motivo', left(v_s.reason, 300)
      ),
      'tenant-suspended-' || v_s.id::text,
      v_tenant.customer_organization_id, v_tenant.id, null, null, v_tenant.name, true
    );
  elsif v_s.resumed_at is not null and v_s.resume_cause in ('PAYMENT', 'MANUAL') then
    perform platform._mail_enqueue(
      'BUSINESS', 'TENANT_REACTIVATED', 'masteradmin-tenant-reactivado', v_contact.email, v_contact.name,
      jsonb_build_object(
        'cliente', v_contact.org_name,
        'tenant', v_tenant.name,
        'app', v_tenant.lockup_name,
        'fecha', platform._mail_date((v_s.resumed_at at time zone 'America/Lima')::date)
      ),
      'tenant-reactivated-' || v_s.id::text,
      v_tenant.customer_organization_id, v_tenant.id, null, null, v_tenant.name, false
    );
  end if;
  return null;
exception when others then
  raise warning 'MAIL_TENANT_SUSPENSION %: %', new.id, sqlerrm;
  return null;
end;
$$;

drop trigger if exists tenant_suspensions_mail_insert on platform.tenant_suspensions;
create constraint trigger tenant_suspensions_mail_insert
  after insert on platform.tenant_suspensions
  deferrable initially deferred
  for each row when (new.cause = 'NON_PAYMENT')
  execute function platform._mail_on_tenant_suspension();

drop trigger if exists tenant_suspensions_mail_resume on platform.tenant_suspensions;
create constraint trigger tenant_suspensions_mail_resume
  after update of resumed_at on platform.tenant_suspensions
  deferrable initially deferred
  for each row when (old.resumed_at is null and new.resumed_at is not null and new.cause = 'NON_PAYMENT')
  execute function platform._mail_on_tenant_suspension();

-- 7.5 Tenant activo por primera vez (PENDING → ACTIVE): bienvenida al administrador del cliente.
--     No se avisa a un tenant REGISTRADO a mano (ya operaba en la app antes de existir aquí).
create or replace function platform._mail_on_tenant_activated()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_t   record;
  v_org text;
begin
  select t.id, t.name, t.admin_email, t.environment, t.customer_organization_id, t.status, p.lockup_name
    into v_t
    from platform.tenants t join platform.saas_products p on p.id = t.saas_product_id
   where t.id = new.id;
  if v_t.id is null or v_t.status <> 'ACTIVE' then
    return null;
  end if;
  if exists (select 1 from platform.tenant_product_mappings m
              where m.tenant_id = v_t.id and m.registered_manually) then
    return null;
  end if;
  select coalesce(nullif(btrim(o.legal_name), ''), o.display_name) into v_org
    from platform.organizations o where o.id = v_t.customer_organization_id;
  perform platform._mail_enqueue(
    'BUSINESS', 'TENANT_ACTIVATED', 'masteradmin-tenant-bienvenida', v_t.admin_email, null,
    jsonb_build_object(
      'cliente', v_org,
      'tenant', v_t.name,
      'app', v_t.lockup_name,
      'email', v_t.admin_email,
      'ambiente', case v_t.environment::text
                    when 'PRODUCTION' then 'Producción'
                    when 'DEMO' then 'Demostración'
                    when 'TRIAL' then 'Prueba gratuita'
                    when 'SANDBOX' then 'Pruebas'
                    when 'STAGING' then 'Pre-producción'
                    else initcap(lower(v_t.environment::text)) end,
      'como_ingresar', v_t.lockup_name || ' le enviará a esta misma dirección un correo para crear su contraseña. '
                       || 'Si no lo recibe en 24 horas, contacte a su ejecutivo de EBIM.'
    ),
    'tenant-activated-' || v_t.id::text,
    v_t.customer_organization_id, v_t.id, null, null, v_t.name, false
  );
  return null;
exception when others then
  raise warning 'MAIL_TENANT_ACTIVATED %: %', new.id, sqlerrm;
  return null;
end;
$$;

drop trigger if exists tenants_mail_activated on platform.tenants;
create constraint trigger tenants_mail_activated
  after update of status on platform.tenants
  deferrable initially deferred
  for each row when (old.status = 'PENDING' and new.status = 'ACTIVE')
  execute function platform._mail_on_tenant_activated();

-- 7.6 Operaciones (interno EBIM): sincronización con diferencias y altas fallidas.
create or replace function platform._mail_ops(
  p_event_type text, p_titulo text, p_motivo text, p_nuevas integer, p_enlace_path text, p_key text,
  p_tenant uuid default null
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_to       text;
  v_abiertas integer;
  v_fallidas integer;
begin
  select count(*) into v_abiertas from platform.tenant_sync_findings f where f.status = 'OPEN';
  select count(*) into v_fallidas from platform.saas_provisioning_requests r
   where r.status = 'FAILED' and r.updated_at > now() - interval '24 hours';
  for v_to in select unnest(s.ops_recipients) from platform.mail_settings s where s.id loop
    perform platform._mail_enqueue(
      'OPS', p_event_type, 'masteradmin-ops-resumen', v_to, null,
      jsonb_build_object(
        'titulo', p_titulo,
        'motivo', p_motivo,
        'diferencias_nuevas', coalesce(p_nuevas, 0)::text,
        'diferencias_abiertas', v_abiertas::text,
        'altas_fallidas', v_fallidas::text,
        'fecha', platform._mail_datetime(now()),
        -- La Edge Function antepone MASTERADMIN_APP_URL a las rutas relativas.
        'enlace', p_enlace_path
      ),
      p_key || '-' || md5(v_to),
      null, p_tenant, null, null, p_titulo, false
    );
  end loop;
end;
$$;

revoke all on function platform._mail_ops(text, text, text, integer, text, text, uuid) from public, anon, authenticated, service_role;

create or replace function platform._mail_on_sync_run_finished()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if new.findings_opened > 0 or new.status in ('FAILED', 'PARTIAL') then
    perform platform._mail_ops(
      'OPS_SYNC_DIGEST',
      case when new.status = 'FAILED' then 'La sincronización con las apps falló'
           when new.findings_opened > 0 then 'Sincronización con ' || new.findings_opened || ' diferencias nuevas'
           else 'Sincronización con las apps incompleta' end,
      case when new.status = 'FAILED' then 'La corrida no pudo terminar' || coalesce(' (' || new.error_code || ')', '') || '. Revise las apps.'
           when new.status = 'PARTIAL' then 'Algunas apps no se pudieron comprobar; revise el detalle por app.'
           else 'La sincronización terminó con diferencias que una persona debe revisar.' end,
      new.findings_opened, '/apps?tab=sincronizacion-apps', 'ops-sync-' || new.id::text
    );
  end if;
  return null;
exception when others then
  raise warning 'MAIL_SYNC_DIGEST %: %', new.id, sqlerrm;
  return null;
end;
$$;

drop trigger if exists tenant_sync_runs_mail_finished on platform.tenant_sync_runs;
create constraint trigger tenant_sync_runs_mail_finished
  after update of status on platform.tenant_sync_runs
  deferrable initially deferred
  for each row when (old.status = 'RUNNING' and new.status <> 'RUNNING')
  execute function platform._mail_on_sync_run_finished();

create or replace function platform._mail_on_provisioning_failed()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_t record;
begin
  select t.name, p.lockup_name into v_t
    from platform.tenants t join platform.saas_products p on p.id = t.saas_product_id
   where t.id = new.tenant_id;
  perform platform._mail_ops(
    'OPS_PROVISIONING_FAILED',
    'Alta fallida: ' || coalesce(v_t.name, 'tenant'),
    'El alta de ' || coalesce(v_t.name, 'un tenant') || ' en ' || coalesce(v_t.lockup_name, 'la app') || ' falló'
      || coalesce(': ' || left(new.last_error_code, 80), '') || '.',
    0, '/apps?tab=altas', 'ops-prov-failed-' || new.id::text || '-' || txid_current()::text, new.tenant_id
  );
  return null;
exception when others then
  raise warning 'MAIL_PROVISIONING_FAILED %: %', new.id, sqlerrm;
  return null;
end;
$$;

drop trigger if exists saas_provisioning_requests_mail_failed on platform.saas_provisioning_requests;
create constraint trigger saas_provisioning_requests_mail_failed
  after update of status on platform.saas_provisioning_requests
  deferrable initially deferred
  for each row when (new.status = 'FAILED' and old.status is distinct from 'FAILED')
  execute function platform._mail_on_provisioning_failed();

revoke all on function platform._mail_on_invoice_issued() from public, anon, authenticated, service_role;
revoke all on function platform._mail_on_payment_confirmed() from public, anon, authenticated, service_role;
revoke all on function platform._mail_on_past_due_alert() from public, anon, authenticated, service_role;
revoke all on function platform._mail_on_tenant_suspension() from public, anon, authenticated, service_role;
revoke all on function platform._mail_on_tenant_activated() from public, anon, authenticated, service_role;
revoke all on function platform._mail_on_sync_run_finished() from public, anon, authenticated, service_role;
revoke all on function platform._mail_on_provisioning_failed() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Canal servidor (Edge Functions con la clave de servicio)
-- ---------------------------------------------------------------------------

-- 8.1 Tomar un lote: PENDING vencidos y SENDING colgados (> 10 min).
create or replace function platform.mail_claim_batch(p_limit integer default 20)
returns setof platform.mail_outbox
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if not platform.is_service_request() then
    raise exception 'SOLO_SERVIDOR: el envío lo hace mail-dispatch' using errcode = '42501';
  end if;
  return query
  with claimed as (
    update platform.mail_outbox m
       set status = 'SENDING', locked_at = now(), attempts = m.attempts + 1
     where m.id in (
       select x.id from platform.mail_outbox x
        where (x.status = 'PENDING' and x.next_attempt_at <= now())
           or (x.status = 'SENDING' and x.locked_at < now() - interval '10 minutes')
        order by x.next_attempt_at
        limit greatest(1, least(coalesce(p_limit, 20), 100))
        for update skip locked
     )
    returning m.*
  )
  select * from claimed;
end;
$$;

-- 8.2 Enlace al portal de pago para un correo que VA a salir. Idempotente:
--     un reintento reutiliza el mismo token (la clave de MailHub no cambia).
create or replace function platform.mail_payment_link(p_outbox_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_m       platform.mail_outbox;
  v_org     record;
  v_token   text;
  v_expires timestamptz;
  v_link    uuid;
begin
  if not platform.is_service_request() then
    raise exception 'SOLO_SERVIDOR' using errcode = '42501';
  end if;
  select * into v_m from platform.mail_outbox where id = p_outbox_id for update;
  if v_m.id is null or not v_m.needs_payment_link then
    raise exception 'SIN_ENLACE: el correo % no lleva portal de pago', p_outbox_id using errcode = '22023';
  end if;
  if v_m.status <> 'SENDING' then
    raise exception 'ESTADO_INVALIDO: el enlace se genera solo al enviar' using errcode = '23514';
  end if;
  if v_m.secret_variables ? 'payment_link_token' then
    return v_m.secret_variables;
  end if;

  select o.id, o.status, o.display_name into v_org from platform.organizations o where o.id = v_m.organization_id;
  if v_org.id is null or v_org.status <> 'ACTIVE' then
    raise exception 'ORGANIZACION_INACTIVA: no se genera portal de pago' using errcode = '23514';
  end if;

  -- Mismo formato que create_payment_link: 32 bytes → base64url; solo se guarda el sha256.
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), E'+/=\n', '-_');
  v_expires := now() + interval '30 days';
  insert into platform.payment_links (organization_id, token_hash, token_hint, expires_at, allow_card_enrollment, created_by)
  values (v_org.id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), right(v_token, 4), v_expires, true, null)
  returning id into v_link;

  perform platform.log_audit(
    'PAYMENT_LINK_CREATED', 'payment_link', v_link::text, v_org.id, v_m.tenant_id,
    jsonb_build_object('hint', right(v_token, 4), 'expires_at', v_expires, 'allow_card_enrollment', true,
                       'reason', 'Correo automático ' || v_m.event_type || coalesce(' · ' || v_m.reference_label, ''),
                       'mail_outbox_id', v_m.id)
  );

  update platform.mail_outbox
     set secret_variables = jsonb_build_object('payment_link_token', v_token,
                                               'payment_link_expires', to_char(v_expires at time zone 'America/Lima', 'DD/MM/YYYY'))
   where id = v_m.id;
  return jsonb_build_object('payment_link_token', v_token,
                            'payment_link_expires', to_char(v_expires at time zone 'America/Lima', 'DD/MM/YYYY'));
end;
$$;

-- 8.3 Resultado del envío.
create or replace function platform.mail_mark_result(
  p_id               uuid,
  p_status           text,
  p_detail           text default null,
  p_mailhub_email_id text default null,
  p_mailhub_status   text default null,
  p_error_code       text default null,
  p_retry_in_seconds integer default null,
  p_delivered_to     text default null,
  p_delivery_mode    text default null
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if not platform.is_service_request() then
    raise exception 'SOLO_SERVIDOR' using errcode = '42501';
  end if;
  if p_status not in ('PENDING', 'SENT', 'FAILED', 'HELD', 'SKIPPED', 'SUPPRESSED') then
    raise exception 'ESTADO_INVALIDO: %', p_status using errcode = '22023';
  end if;
  update platform.mail_outbox
     set status          = p_status,
         status_detail   = left(p_detail, 500),
         mailhub_email_id = coalesce(p_mailhub_email_id, mailhub_email_id),
         mailhub_status  = coalesce(p_mailhub_status, mailhub_status),
         last_error_code = case when p_status in ('PENDING', 'FAILED') then left(p_error_code, 80) else null end,
         next_attempt_at = case when p_status = 'PENDING'
                                then now() + make_interval(secs => greatest(coalesce(p_retry_in_seconds, 60), 5))
                                else next_attempt_at end,
         locked_at       = null,
         sent_at         = case when p_status = 'SENT' then coalesce(sent_at, now()) else sent_at end,
         delivered_to    = coalesce(p_delivered_to, delivered_to),
         delivery_mode   = coalesce(p_delivery_mode, delivery_mode),
         -- La credencial de un solo uso no sobrevive al cierre del envío.
         secret_variables = case when p_status = 'PENDING' then secret_variables else null end
   where id = p_id;
end;
$$;

-- 8.4 Correo de Auth (lo envía auth-email-hook en línea; aquí solo queda constancia, sin enlace ni código).
create or replace function platform.mail_record_auth(
  p_event_type       text,
  p_template_key     text,
  p_to               text,
  p_to_name          text,
  p_variables        jsonb,
  p_idempotency_key  text,
  p_status           text,
  p_detail           text default null,
  p_mailhub_email_id text default null,
  p_mailhub_status   text default null,
  p_error_code       text default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id uuid;
begin
  if not platform.is_service_request() then
    raise exception 'SOLO_SERVIDOR' using errcode = '42501';
  end if;
  if p_event_type not like 'AUTH\_%' then
    raise exception 'EVENTO_INVALIDO: %', p_event_type using errcode = '22023';
  end if;
  if p_variables ?| array['enlace', 'codigo', 'token', 'token_hash'] then
    raise exception 'VARIABLES_CON_CREDENCIAL: el enlace o el código no se guardan' using errcode = '22023';
  end if;
  insert into platform.mail_outbox (
    category, event_type, template_key, recipient_email, recipient_name, variables, idempotency_key,
    status, status_detail, mailhub_email_id, mailhub_status, last_error_code, attempts, sent_at, delivery_mode,
    delivered_to, reference_label
  ) values (
    'AUTH', p_event_type, p_template_key, lower(p_to), nullif(btrim(coalesce(p_to_name, '')), ''),
    coalesce(p_variables, '{}'::jsonb), p_idempotency_key, p_status, left(p_detail, 500), p_mailhub_email_id,
    p_mailhub_status, left(p_error_code, 80), 1, case when p_status = 'SENT' then now() end, 'live',
    case when p_status = 'SENT' then lower(p_to) end, lower(p_to)
  )
  on conflict (idempotency_key) do update
     set status = excluded.status, status_detail = excluded.status_detail,
         mailhub_email_id = coalesce(excluded.mailhub_email_id, platform.mail_outbox.mailhub_email_id),
         mailhub_status = coalesce(excluded.mailhub_status, platform.mail_outbox.mailhub_status),
         last_error_code = excluded.last_error_code, attempts = platform.mail_outbox.attempts + 1
  returning id into v_id;
  return v_id;
end;
$$;

-- 8.5 Callback de MailHub: deduplica por eventId y avanza el estado (sin retroceder).
create or replace function platform._mail_status_rank(p_status text)
returns integer
language sql
immutable
set search_path = platform, pg_catalog
as $$
  select case p_status
           when 'SENT' then 1 when 'DELAYED' then 2 when 'DELIVERED' then 3
           when 'BOUNCED' then 4 when 'COMPLAINED' then 4 when 'FAILED' then 4 when 'SUPPRESSED' then 4
           else 0 end;
$$;

revoke all on function platform._mail_status_rank(text) from public, anon, authenticated;

create or replace function platform.mail_apply_event(
  p_event_id         text,
  p_event_type       text,
  p_mailhub_email_id text,
  p_message_status   text,
  p_recipient        text,
  p_occurred_at      timestamptz,
  p_detail           jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_outbox uuid;
  v_new    text;
  v_cur    text;
  v_rows   integer;
begin
  if not platform.is_service_request() then
    raise exception 'SOLO_SERVIDOR' using errcode = '42501';
  end if;

  select id, status into v_outbox, v_cur from platform.mail_outbox
   where mailhub_email_id = p_mailhub_email_id and p_mailhub_email_id is not null
   order by created_at desc limit 1;

  insert into platform.mail_events (event_id, outbox_id, mailhub_email_id, event_type, message_status, recipient,
                                    occurred_at, detail)
  values (p_event_id, v_outbox, p_mailhub_email_id, p_event_type, left(p_message_status, 40), lower(left(p_recipient, 320)),
          p_occurred_at, coalesce(p_detail, '{}'::jsonb))
  on conflict (event_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('duplicate', true, 'outbox_id', v_outbox);
  end if;
  if v_outbox is null then
    return jsonb_build_object('duplicate', false, 'outbox_id', null, 'matched', false);
  end if;

  v_new := case p_event_type
             when 'email.accepted' then 'SENT'
             when 'email.sent' then 'SENT'
             when 'email.delivered' then 'DELIVERED'
             when 'email.delivery_delayed' then 'DELAYED'
             when 'email.bounced' then 'BOUNCED'
             when 'email.complained' then 'COMPLAINED'
             when 'email.failed' then 'FAILED'
             when 'email.suppressed' then 'SUPPRESSED'
             else null end;

  update platform.mail_outbox
     set status = case when v_new is not null
                        and v_cur not in ('HELD', 'SKIPPED', 'CANCELLED')
                        and platform._mail_status_rank(v_new) >= platform._mail_status_rank(v_cur)
                       then v_new else status end,
         status_detail = case when v_new in ('BOUNCED', 'FAILED', 'COMPLAINED', 'SUPPRESSED')
                              then left(coalesce(p_detail ->> 'reason', status_detail), 500) else status_detail end,
         mailhub_status = coalesce(left(p_message_status, 40), mailhub_status),
         delivered_at = case when v_new = 'DELIVERED' then coalesce(delivered_at, p_occurred_at, now()) else delivered_at end,
         last_event_at = greatest(coalesce(last_event_at, p_occurred_at), coalesce(p_occurred_at, now()))
   where id = v_outbox;

  return jsonb_build_object('duplicate', false, 'outbox_id', v_outbox, 'matched', true);
end;
$$;

revoke all on function platform.mail_claim_batch(integer) from public, anon, authenticated;
revoke all on function platform.mail_payment_link(uuid) from public, anon, authenticated;
revoke all on function platform.mail_mark_result(uuid, text, text, text, text, text, integer, text, text) from public, anon, authenticated;
revoke all on function platform.mail_record_auth(text, text, text, text, jsonb, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function platform.mail_apply_event(text, text, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function platform.mail_claim_batch(integer) to service_role;
grant execute on function platform.mail_payment_link(uuid) to service_role;
grant execute on function platform.mail_mark_result(uuid, text, text, text, text, text, integer, text, text) to service_role;
grant execute on function platform.mail_record_auth(text, text, text, text, jsonb, text, text, text, text, text, text) to service_role;
grant execute on function platform.mail_apply_event(text, text, text, text, text, timestamptz, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 9. Consola (JWT; la base decide)
-- ---------------------------------------------------------------------------

-- 9.1 Reenviar un correo fallido o rebotado (nueva clave hacia MailHub).
create or replace function platform.mail_retry(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_m platform.mail_outbox;
begin
  if not (platform.is_super_admin() or platform.can_read_finance()) then
    raise exception 'NO_AUTORIZADO: reenviar un correo exige super admin o finanzas' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: indique por qué se reenvía' using errcode = '23502';
  end if;
  select * into v_m from platform.mail_outbox where id = p_id for update;
  if v_m.id is null then
    raise exception 'CORREO_NO_ENCONTRADO: %', p_id using errcode = '23503';
  end if;
  if v_m.category = 'AUTH' then
    raise exception 'NO_REENVIABLE: los accesos se reenvían desde Usuarios (el enlace anterior ya no vale)' using errcode = '23514';
  end if;
  if v_m.status not in ('FAILED', 'BOUNCED', 'SUPPRESSED') then
    raise exception 'ESTADO_INVALIDO: solo se reenvía un correo fallido, rebotado o suprimido (está en %)', v_m.status
      using errcode = '23514';
  end if;
  update platform.mail_outbox
     set status = 'PENDING', status_detail = 'Reenvío: ' || left(btrim(p_reason), 300), resend_count = resend_count + 1,
         attempts = 0, next_attempt_at = now(), mailhub_email_id = null, mailhub_status = null, last_error_code = null,
         sent_at = null, delivered_at = null, last_event_at = null
   where id = p_id;
  perform platform.log_audit('MAIL_RESENT', 'mail_outbox', p_id::text, v_m.organization_id, v_m.tenant_id,
                             jsonb_build_object('event_type', v_m.event_type, 'reason', left(btrim(p_reason), 300)));
  perform platform._mail_kick();
  return jsonb_build_object('id', p_id, 'status', 'PENDING');
end;
$$;

-- 9.2 Cancelar un correo que aún no salió (pendiente o retenido).
create or replace function platform.mail_cancel(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_m platform.mail_outbox;
begin
  if not (platform.is_super_admin() or platform.can_read_finance()) then
    raise exception 'NO_AUTORIZADO: cancelar un correo exige super admin o finanzas' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: indique por qué se cancela' using errcode = '23502';
  end if;
  select * into v_m from platform.mail_outbox where id = p_id for update;
  if v_m.id is null then
    raise exception 'CORREO_NO_ENCONTRADO: %', p_id using errcode = '23503';
  end if;
  if v_m.status not in ('PENDING', 'HELD') then
    raise exception 'ESTADO_INVALIDO: solo se cancela un correo pendiente o retenido (está en %)', v_m.status
      using errcode = '23514';
  end if;
  update platform.mail_outbox
     set status = 'CANCELLED', status_detail = 'Cancelado: ' || left(btrim(p_reason), 300), secret_variables = null
   where id = p_id;
  perform platform.log_audit('MAIL_CANCELLED', 'mail_outbox', p_id::text, v_m.organization_id, v_m.tenant_id,
                             jsonb_build_object('event_type', v_m.event_type, 'reason', left(btrim(p_reason), 300)));
  return jsonb_build_object('id', p_id, 'status', 'CANCELLED');
end;
$$;

-- 9.3 Correo de prueba de una plantilla (solo a direcciones internas de EBIM).
create or replace function platform.mail_send_test(p_template_key text, p_to text)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_to text := lower(btrim(coalesce(p_to, '')));
  v_id uuid;
begin
  if not platform.is_super_admin() then
    raise exception 'NO_AUTORIZADO: solo el super admin envía pruebas' using errcode = '42501';
  end if;
  if coalesce(p_template_key, '') !~ '^masteradmin-[a-z0-9-]{2,60}$' then
    raise exception 'PLANTILLA_INVALIDA: %', p_template_key using errcode = '22023';
  end if;
  -- Una prueba nunca sale hacia un cliente: solo buzones de EBIM.
  if v_to !~ '^[^@[:space:]]+@([a-z0-9-]+\.)*(ebim\.pe|grupoebim\.com)$' then
    raise exception 'DESTINO_NO_PERMITIDO: las pruebas van solo a direcciones @ebim.pe o @grupoebim.com'
      using errcode = '23514';
  end if;
  v_id := platform._mail_enqueue(
    'TEST', 'TEST', p_template_key, v_to, null, jsonb_build_object('_sample', true),
    'test-' || p_template_key || '-' || gen_random_uuid()::text,
    null, null, null, null, 'Prueba · ' || p_template_key, false
  );
  perform platform.log_audit('MAIL_TEST_QUEUED', 'mail_outbox', v_id::text, null, null,
                             jsonb_build_object('template_key', p_template_key, 'to', v_to));
  return jsonb_build_object('id', v_id, 'status', 'PENDING');
end;
$$;

-- 9.4 Destinatarios internos del resumen de operaciones y el interruptor.
create or replace function platform.set_mail_settings(p_business_mail_enabled boolean, p_ops_recipients text[])
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_list text[];
  v_bad  text;
begin
  if not platform.is_super_admin() then
    raise exception 'NO_AUTORIZADO: solo el super admin configura el correo' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct lower(btrim(x))) filter (where nullif(btrim(x), '') is not null), '{}')
    into v_list from unnest(coalesce(p_ops_recipients, '{}')) x;
  select x into v_bad from unnest(v_list) x
   where x !~ '^[^@[:space:]]+@([a-z0-9-]+\.)*(ebim\.pe|grupoebim\.com)$' limit 1;
  if v_bad is not null then
    raise exception 'DESTINO_NO_PERMITIDO: el resumen de operaciones es interno (%)', v_bad using errcode = '23514';
  end if;
  if cardinality(v_list) > 10 then
    raise exception 'DEMASIADOS_DESTINATARIOS: máximo 10' using errcode = '23514';
  end if;
  update platform.mail_settings
     set business_mail_enabled = coalesce(p_business_mail_enabled, business_mail_enabled),
         ops_recipients = v_list, updated_at = now(),
         updated_by = (select p.id from platform.profiles p where p.id = auth.uid())
   where id;
  perform platform.log_audit('MAIL_SETTINGS_UPDATED', 'mail_settings', 'singleton', null, null,
                             jsonb_build_object('business_mail_enabled', p_business_mail_enabled,
                                                'ops_recipients', cardinality(v_list)));
  return jsonb_build_object('business_mail_enabled', coalesce(p_business_mail_enabled, true), 'ops_recipients', v_list);
end;
$$;

revoke all on function platform.mail_retry(uuid, text) from public, anon;
revoke all on function platform.mail_cancel(uuid, text) from public, anon;
revoke all on function platform.mail_send_test(text, text) from public, anon;
revoke all on function platform.set_mail_settings(boolean, text[]) from public, anon;
grant execute on function platform.mail_retry(uuid, text) to authenticated;
grant execute on function platform.mail_cancel(uuid, text) to authenticated;
grant execute on function platform.mail_send_test(text, text) to authenticated;
grant execute on function platform.set_mail_settings(boolean, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Job programado MAIL_DISPATCH
--     (copia literal de 20261021000100 §8 con una rama más)
-- ---------------------------------------------------------------------------
alter table platform.tenant_lifecycle_settings
  add column if not exists mail_dispatch_enabled boolean not null default true;

comment on column platform.tenant_lifecycle_settings.mail_dispatch_enabled is
  'Envío programado de la bandeja de correo (mail-dispatch). Encendido por defecto.';

alter table platform.lifecycle_job_runs drop constraint if exists lifecycle_job_runs_job_ck;
alter table platform.lifecycle_job_runs
  add constraint lifecycle_job_runs_job_ck
  check (job in ('LIFECYCLE_CYCLE', 'ENTITLEMENT_SYNC', 'ENTITLEMENT_SWEEP', 'AUTOCHARGE', 'TENANT_SYNC', 'MAIL_DISPATCH'));

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
    when 'TENANT_SYNC' then
      v_function := 'tenant-sync'; v_body := '{"trigger":"SCHEDULED"}'::jsonb;
      v_enabled := v_settings.tenant_sync_enabled;
    when 'MAIL_DISPATCH' then
      v_function := 'mail-dispatch'; v_body := '{"trigger":"SCHEDULED"}'::jsonb;
      v_enabled := v_settings.mail_dispatch_enabled;
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
        execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
           into v_request
          using rtrim(v_url, '/') || '/functions/v1/' || v_function, v_body,
                jsonb_build_object('content-type', 'application/json',
                                   'authorization', 'Bearer ' || v_key,
                                   'x-provisioning-secret', v_key),
                -- La sincronización recorre las 8 apps: más margen que un push.
                case when p_job = 'TENANT_SYNC' then 150000 else 30000 end;
        v_outcome := 'DISPATCHED';
        v_detail := jsonb_build_object('function', v_function, 'net_request_id', v_request);
      exception when others then
        v_outcome := 'FAILED';
        v_detail := jsonb_build_object('function', v_function, 'error', sqlerrm);
      end;
    end if;
  end if;

  -- Un «no hice nada» se anota una vez al día por job, no en cada disparo. El
  -- correo corre cada minuto: un DISPATCHED también se anota a lo sumo cada hora.
  if (v_outcome not like 'SKIPPED%' and (p_job <> 'MAIL_DISPATCH' or v_outcome <> 'DISPATCHED'))
     or not exists (select 1 from platform.lifecycle_job_runs j
                     where j.job = p_job and j.outcome = v_outcome
                       and j.ran_at > now() - case when v_outcome like 'SKIPPED%' then interval '1 day' else interval '1 hour' end) then
    insert into platform.lifecycle_job_runs (job, outcome, detail) values (p_job, v_outcome, v_detail);
  end if;

  return jsonb_build_object('job', p_job, 'outcome', v_outcome) || v_detail;
end;
$$;

comment on function platform.invoke_scheduled_function(text) is
  'Dispara una Edge Function desde pg_cron con pg_net y los secretos de Vault del entorno. '
  'Sin secretos o con el interruptor apagado no hace nada. Solo el job del sistema.';

revoke all on function platform.invoke_scheduled_function(text) from public, anon, authenticated, service_role;

-- Cada minuto, y solo si hay algo que enviar (sin cola no se llama a nadie).
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('ebim-mail-dispatch', '* * * * *',
      $job$select platform.invoke_scheduled_function('MAIL_DISPATCH')
             where exists (select 1 from platform.mail_outbox m
                            where (m.status = 'PENDING' and m.next_attempt_at <= now())
                               or (m.status = 'SENDING' and m.locked_at < now() - interval '10 minutes'))$job$);
  else
    raise notice 'pg_cron no disponible: el envío de correo se programa a mano (docs/runbooks/mail.md)';
  end if;
end;
$$;
