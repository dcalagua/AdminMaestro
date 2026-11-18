-- ============================================================================
-- Perfil comercial (2026-11-18)
-- ----------------------------------------------------------------------------
-- Pedido: «un perfil comercial que lleve recordatorio de los contratos ganados,
-- sus comisiones, y que pueda crear el tenant si lo desea». Decisiones de
-- Gerencia (2026-11-18):
--   · el comercial SOLICITA la prueba y EBIM la aprueba (se respeta
--     «comercial != acceso operativo»: el alta la ejecuta EBIM);
--   · todos los comerciales ven TODAS las solicitudes de la web;
--   · el comercial ve número, vencimiento y saldo de las facturas de SUS
--     clientes (los atribuidos a él), no sus pagos ni los de otros.
--
-- Esta migración:
--   1. `my_own_sales_agent_id()`: el registro de comercial ACTIVO del usuario
--      (no el de los comerciales de un partner que administre).
--   2. Solicitudes de la web: las lee cualquier comercial activo; quien la
--      contacta, la descarta o pide la prueba queda como «tomada por»
--      (`owner_sales_agent_id`) y ningún otro comercial puede moverla. EBIM
--      (can_manage_commercial) sigue pudiendo todo.
--   3. `trial_requests`: el comercial pide una prueba (request_trial) o la
--      retira (cancel_trial_request); EBIM la rechaza con motivo
--      (reject_trial_request) o la aprueba creando el tenant con «Nueva venta»
--      y cerrándola con complete_trial_request, que deja la atribución al
--      comercial: así ve el tenant, sus recordatorios y su comisión.
--   4. `my_sales_reminders()`: los recordatorios del comercial, calculados con
--      lo que ya existe (sin cron nuevo): facturas de sus clientes vencidas o
--      por vencer en 7 días (con saldo), renovaciones abiertas, pruebas que
--      vencen en 3 días o vencieron hace menos de 14, y la respuesta de EBIM a
--      sus pedidos de prueba de los últimos 14 días.
--
-- Nada de esto da acceso operativo: el comercial no crea tenants, no ejecuta
-- altas, no extiende pruebas y no ve pagos. Test: 62_sales_agent_profile.test.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. El comercial que es el propio usuario
-- ---------------------------------------------------------------------------
create or replace function platform.my_own_sales_agent_id()
returns uuid
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select sa.id
    from platform.sales_agents sa
   where sa.user_id = auth.uid() and sa.status = 'ACTIVE'
   order by sa.created_at
   limit 1;
$$;
comment on function platform.my_own_sales_agent_id() is
  'Registro de comercial ACTIVO del usuario de la sesión (NULL si no es comercial). '
  'A diferencia de my_sales_agent_ids(), no incluye a los comerciales del partner que administra.';
revoke all on function platform.my_own_sales_agent_id() from public, anon;
grant execute on function platform.my_own_sales_agent_id() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Solicitudes de la web para el comercial
-- ---------------------------------------------------------------------------
alter table platform.commercial_leads
  add column owner_sales_agent_id uuid references platform.sales_agents(id) on delete set null;
create index commercial_leads_owner_idx on platform.commercial_leads (owner_sales_agent_id)
  where owner_sales_agent_id is not null;
comment on column platform.commercial_leads.owner_sales_agent_id is
  'Comercial que tomó la solicitud (al contactarla, descartarla o pedir la prueba). Otro comercial ya no la mueve.';

drop policy if exists commercial_leads_read on platform.commercial_leads;
create policy commercial_leads_read on platform.commercial_leads
  for select to authenticated
  using ((select platform.can_manage_commercial()) or (select platform.is_sales_agent()));

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
  v_lead      platform.commercial_leads;
  v_ebim      boolean := platform.can_manage_commercial();
  v_agent     uuid;
begin
  if not v_ebim then
    v_agent := platform.my_own_sales_agent_id();
    if v_agent is null then
      raise exception 'NO_AUTORIZADO: las solicitudes las trabaja el área comercial' using errcode = '42501';
    end if;
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

  if not v_ebim then
    if v_lead.owner_sales_agent_id is not null and v_lead.owner_sales_agent_id <> v_agent then
      raise exception 'SOLICITUD_DE_OTRO_COMERCIAL: otro comercial ya la está trabajando' using errcode = '42501';
    end if;
    if v_lead.status = 'CONVERTED' then
      raise exception 'SOLICITUD_CERRADA: ya es cliente' using errcode = '22023';
    end if;
  end if;

  update platform.commercial_leads
     set status = p_status,
         status_note = coalesce(nullif(btrim(p_note), ''), case when p_status = v_lead.status then status_note end),
         status_changed_at = now(), status_changed_by = auth.uid(),
         organization_id = case when p_status = 'NEW' then null else organization_id end,
         -- El comercial que la mueve la toma; reabrirla (NEW) la libera. EBIM no cambia el dueño.
         owner_sales_agent_id = case
           when v_ebim then owner_sales_agent_id
           when p_status = 'NEW' then null
           else v_agent end
   where id = p_lead_id;

  perform platform.log_audit('COMMERCIAL_LEAD_STATUS_CHANGED', 'commercial_lead', p_lead_id::text,
    v_lead.organization_id, null,
    jsonb_build_object('from', v_lead.status, 'to', p_status, 'note', nullif(btrim(p_note), ''),
                       'sales_agent_id', v_agent));
  return p_lead_id;
end;
$$;
revoke all on function platform.set_commercial_lead_status(uuid, text, text) from public, anon;
grant execute on function platform.set_commercial_lead_status(uuid, text, text) to authenticated, service_role;

-- Convenciones de platform que 20261025000100 dejó sin cumplir (00_structure):
-- RLS FORZADA en toda tabla y un índice por FK.
alter table platform.commercial_leads force row level security;
alter table platform.lead_sync_state force row level security;
create index if not exists commercial_leads_product_idx on platform.commercial_leads (saas_product_id);

-- ---------------------------------------------------------------------------
-- 3. Pruebas solicitadas por un comercial
-- ---------------------------------------------------------------------------
create table platform.trial_requests (
  id               uuid primary key default gen_random_uuid(),
  sales_agent_id   uuid not null references platform.sales_agents(id) on delete restrict,
  lead_id          uuid references platform.commercial_leads(id) on delete set null,
  saas_product_id  uuid not null references platform.saas_products(id),
  plan_id          uuid references platform.plans(id),
  company_name     text not null check (length(btrim(company_name)) between 2 and 200),
  contact_name     text not null check (length(btrim(contact_name)) between 1 and 160),
  admin_email      text not null check (length(admin_email) <= 200 and admin_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  country_code     char(2) check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  notes            text check (notes is null or length(notes) <= 2000),
  status           text not null default 'PENDING'
                   check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  decision_note    text check (decision_note is null or length(decision_note) <= 1000),
  decided_at       timestamptz,
  decided_by       uuid,
  organization_id  uuid references platform.organizations(id) on delete set null,
  tenant_id        uuid references platform.tenants(id) on delete set null,
  requested_by     uuid,
  created_at       timestamptz not null default now(),
  constraint trial_requests_reject_has_note_ck
    check (status <> 'REJECTED' or nullif(btrim(decision_note), '') is not null),
  constraint trial_requests_approved_has_tenant_ck
    check (status <> 'APPROVED' or tenant_id is not null)
);
-- Una sola prueba pendiente por app y administrador: un doble clic no pide dos.
create unique index trial_requests_one_pending_uk
  on platform.trial_requests (saas_product_id, lower(admin_email)) where status = 'PENDING';
create index trial_requests_status_idx on platform.trial_requests (status, created_at desc);
create index trial_requests_agent_idx on platform.trial_requests (sales_agent_id, created_at desc);

comment on table platform.trial_requests is
  'Pruebas que pide un comercial para su prospecto. EBIM las aprueba creando el tenant (Nueva venta) o las rechaza con motivo.';

create index trial_requests_lead_idx on platform.trial_requests (lead_id) where lead_id is not null;
create index trial_requests_plan_idx on platform.trial_requests (plan_id) where plan_id is not null;
create index trial_requests_org_idx on platform.trial_requests (organization_id) where organization_id is not null;
create index trial_requests_tenant_idx on platform.trial_requests (tenant_id) where tenant_id is not null;

alter table platform.trial_requests enable row level security;
alter table platform.trial_requests force row level security;
revoke all on table platform.trial_requests from public, anon, authenticated;
grant select on table platform.trial_requests to authenticated;
grant all on table platform.trial_requests to service_role;
create policy trial_requests_read on platform.trial_requests
  for select to authenticated
  using ((select platform.can_manage_commercial())
         or sales_agent_id in (select platform.my_sales_agent_ids()));

create or replace function platform.request_trial(
  p_saas_product_id uuid,
  p_company_name    text,
  p_contact_name    text,
  p_admin_email     text,
  p_plan_id         uuid default null,
  p_country_code    text default null,
  p_notes           text default null,
  p_lead_id         uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_agent uuid := platform.my_own_sales_agent_id();
  v_lead  platform.commercial_leads;
  v_id    uuid;
begin
  if v_agent is null then
    raise exception 'NO_AUTORIZADO: solo un comercial activo pide pruebas (EBIM las crea con Nueva venta)'
      using errcode = '42501';
  end if;
  if not exists (select 1 from platform.saas_products p where p.id = p_saas_product_id and p.status = 'ACTIVE') then
    raise exception 'PRODUCTO_NO_ENCONTRADO' using errcode = 'P0002';
  end if;
  if p_plan_id is not null and not exists (
       select 1 from platform.plans pl where pl.id = p_plan_id and pl.saas_product_id = p_saas_product_id) then
    raise exception 'PLAN_INVALIDO: el plan no es de esa app' using errcode = '22023';
  end if;

  if p_lead_id is not null then
    select * into v_lead from platform.commercial_leads where id = p_lead_id for update;
    if v_lead.id is null then
      raise exception 'SOLICITUD_NO_ENCONTRADA' using errcode = 'P0002';
    end if;
    if v_lead.owner_sales_agent_id is not null and v_lead.owner_sales_agent_id <> v_agent then
      raise exception 'SOLICITUD_DE_OTRO_COMERCIAL: otro comercial ya la está trabajando' using errcode = '42501';
    end if;
    if v_lead.status in ('CONVERTED', 'DISCARDED') then
      raise exception 'SOLICITUD_CERRADA: la solicitud ya está convertida o descartada' using errcode = '22023';
    end if;
  end if;

  begin
    insert into platform.trial_requests (
      sales_agent_id, lead_id, saas_product_id, plan_id, company_name, contact_name, admin_email,
      country_code, notes, requested_by)
    values (
      v_agent, p_lead_id, p_saas_product_id, p_plan_id, btrim(p_company_name), btrim(p_contact_name),
      lower(btrim(p_admin_email)), nullif(upper(btrim(coalesce(p_country_code, ''))), ''),
      nullif(btrim(p_notes), ''), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'PRUEBA_YA_SOLICITADA: ya hay una prueba pendiente de esa app para ese administrador'
      using errcode = '23505';
  end;

  if p_lead_id is not null then
    update platform.commercial_leads
       set owner_sales_agent_id = v_agent,
           status = case when status = 'NEW' then 'CONTACTED' else status end,
           status_changed_at = case when status = 'NEW' then now() else status_changed_at end,
           status_changed_by = case when status = 'NEW' then auth.uid() else status_changed_by end
     where id = p_lead_id;
  end if;

  perform platform.log_audit('TRIAL_REQUESTED', 'trial_request', v_id::text, null, null,
    jsonb_build_object('saas_product_id', p_saas_product_id, 'lead_id', p_lead_id,
                       'company', btrim(p_company_name), 'sales_agent_id', v_agent));
  return v_id;
end;
$$;
revoke all on function platform.request_trial(uuid, text, text, text, uuid, text, text, uuid) from public, anon;
grant execute on function platform.request_trial(uuid, text, text, text, uuid, text, text, uuid) to authenticated, service_role;

create or replace function platform.cancel_trial_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_req platform.trial_requests;
begin
  select * into v_req from platform.trial_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'PRUEBA_NO_ENCONTRADA' using errcode = 'P0002';
  end if;
  if v_req.sales_agent_id is distinct from platform.my_own_sales_agent_id() then
    raise exception 'NO_AUTORIZADO: solo quien la pidió la retira' using errcode = '42501';
  end if;
  if v_req.status <> 'PENDING' then
    raise exception 'PRUEBA_YA_RESUELTA: %', v_req.status using errcode = '22023';
  end if;
  update platform.trial_requests
     set status = 'CANCELLED', decided_at = now(), decided_by = auth.uid()
   where id = p_request_id;
  perform platform.log_audit('TRIAL_REQUEST_CANCELLED', 'trial_request', p_request_id::text, null, null, '{}'::jsonb);
  return p_request_id;
end;
$$;
revoke all on function platform.cancel_trial_request(uuid) from public, anon;
grant execute on function platform.cancel_trial_request(uuid) to authenticated, service_role;

create or replace function platform.reject_trial_request(p_request_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_req platform.trial_requests;
begin
  if not platform.can_manage_commercial() then
    raise exception 'NO_AUTORIZADO: las pruebas las aprueba o rechaza EBIM' using errcode = '42501';
  end if;
  if nullif(btrim(p_note), '') is null then
    raise exception 'MOTIVO_REQUERIDO: rechazar una prueba exige decir por qué' using errcode = '22023';
  end if;
  select * into v_req from platform.trial_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'PRUEBA_NO_ENCONTRADA' using errcode = 'P0002';
  end if;
  if v_req.status <> 'PENDING' then
    raise exception 'PRUEBA_YA_RESUELTA: %', v_req.status using errcode = '22023';
  end if;
  update platform.trial_requests
     set status = 'REJECTED', decision_note = btrim(p_note), decided_at = now(), decided_by = auth.uid()
   where id = p_request_id;
  perform platform.log_audit('TRIAL_REQUEST_REJECTED', 'trial_request', p_request_id::text, null, null,
    jsonb_build_object('note', btrim(p_note), 'sales_agent_id', v_req.sales_agent_id));
  return p_request_id;
end;
$$;
revoke all on function platform.reject_trial_request(uuid, text) from public, anon;
grant execute on function platform.reject_trial_request(uuid, text) to authenticated, service_role;

-- Cierra la prueba con el tenant que EBIM creó en «Nueva venta». Deja al comercial
-- atribuido (si «Nueva venta» no lo hizo ya) y convierte la solicitud de la web.
create or replace function platform.complete_trial_request(p_request_id uuid, p_tenant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_req    platform.trial_requests;
  v_tenant platform.tenants;
begin
  if not platform.can_manage_commercial() then
    raise exception 'NO_AUTORIZADO: las pruebas las aprueba EBIM' using errcode = '42501';
  end if;
  select * into v_req from platform.trial_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'PRUEBA_NO_ENCONTRADA' using errcode = 'P0002';
  end if;
  if v_req.status <> 'PENDING' then
    raise exception 'PRUEBA_YA_RESUELTA: %', v_req.status using errcode = '22023';
  end if;
  select * into v_tenant from platform.tenants where id = p_tenant_id;
  if v_tenant.id is null then
    raise exception 'TENANT_NO_ENCONTRADO' using errcode = 'P0002';
  end if;
  if v_tenant.saas_product_id <> v_req.saas_product_id then
    raise exception 'TENANT_DE_OTRA_APP: el tenant no es de la app pedida' using errcode = '22023';
  end if;

  update platform.trial_requests
     set status = 'APPROVED', tenant_id = v_tenant.id, organization_id = v_tenant.customer_organization_id,
         decided_at = now(), decided_by = auth.uid()
   where id = p_request_id;

  if not exists (
       select 1 from platform.sales_attributions a
        where a.sales_agent_id = v_req.sales_agent_id and a.tenant_id = v_tenant.id and a.status = 'ACTIVE') then
    insert into platform.sales_attributions (
      sales_agent_id, saas_product_id, tenant_id, customer_organization_id, source, notes)
    values (
      v_req.sales_agent_id, v_tenant.saas_product_id, v_tenant.id, v_tenant.customer_organization_id,
      'DIRECT', 'Prueba solicitada por el comercial');
  end if;

  if v_req.lead_id is not null then
    update platform.commercial_leads
       set organization_id = v_tenant.customer_organization_id, status = 'CONVERTED',
           owner_sales_agent_id = coalesce(owner_sales_agent_id, v_req.sales_agent_id),
           status_changed_at = now(), status_changed_by = auth.uid()
     where id = v_req.lead_id and status <> 'CONVERTED';
  end if;

  perform platform.log_audit('TRIAL_REQUEST_APPROVED', 'trial_request', p_request_id::text,
    v_tenant.customer_organization_id, v_tenant.id,
    jsonb_build_object('sales_agent_id', v_req.sales_agent_id));
  return p_request_id;
end;
$$;
revoke all on function platform.complete_trial_request(uuid, uuid) from public, anon;
grant execute on function platform.complete_trial_request(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Recordatorios del comercial
-- ---------------------------------------------------------------------------
-- Lo suyo y nada más: se calcula con SU id de comercial y sus atribuciones
-- ACTIVAS. Devuelve identidad, fechas y saldo; nunca pagos ni datos de otro.
create or replace function platform.my_sales_reminders()
returns jsonb
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_agent uuid := platform.my_own_sales_agent_id();
begin
  if v_agent is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(r order by r->>'date')
      from (
        -- Facturas de sus clientes: vencidas o por vencer en 7 días, con saldo.
        select jsonb_build_object(
                 'type', case when b.due_date < current_date then 'INVOICE_OVERDUE' else 'INVOICE_DUE_SOON' end,
                 'ref_id', b.invoice_id,
                 'title', coalesce(b.number, 'Factura sin número'),
                 'organization_id', b.customer_organization_id,
                 'organization_name', b.organization_name,
                 'product', null,
                 'date', b.due_date,
                 'amount', b.balance,
                 'currency', b.currency,
                 'tenant_id', null,
                 'note', null) as r
          from platform.v_invoice_balances b
         where b.customer_organization_id in (
                 select a.customer_organization_id from platform.sales_attributions a
                  where a.sales_agent_id = v_agent and a.status = 'ACTIVE')
           and b.balance > 0
           and b.due_date is not null
           and b.due_date <= current_date + 7

        union all
        -- Renovaciones abiertas de sus contratos.
        select jsonb_build_object(
                 'type', 'RENEWAL',
                 'ref_id', ba.id,
                 'title', coalesce(s.code, 'Contrato'),
                 'organization_id', s.billed_organization_id,
                 'organization_name', o.display_name,
                 'product', p.short_name,
                 'date', coalesce(ba.reference_date, ba.due_at::date),
                 'amount', null, 'currency', null, 'tenant_id', s.tenant_id,
                 'note', ba.title)
          from platform.billing_alerts ba
          join platform.subscriptions s on s.id = ba.subscription_id
          left join platform.organizations o on o.id = s.billed_organization_id
          left join platform.saas_products p on p.id = s.saas_product_id
         where ba.status = 'OPEN'
           and ba.alert_type = 'RENEWAL_NOTICE'
           and exists (
                 select 1 from platform.sales_attributions a
                  where a.sales_agent_id = v_agent and a.status = 'ACTIVE'
                    and (a.subscription_id = s.id
                         or (a.tenant_id is not null and a.tenant_id = s.tenant_id)))

        union all
        -- Pruebas de sus tenants: vencen en 3 días o vencieron hace menos de 14.
        select jsonb_build_object(
                 'type', case when t.trial_ends_at <= now() then 'TRIAL_EXPIRED' else 'TRIAL_ENDING' end,
                 'ref_id', t.id,
                 'title', t.name,
                 'organization_id', t.customer_organization_id,
                 'organization_name', o.display_name,
                 'product', p.short_name,
                 'date', t.trial_ends_at,
                 'amount', null, 'currency', null, 'tenant_id', t.id, 'note', null)
          from platform.tenants t
          left join platform.organizations o on o.id = t.customer_organization_id
          left join platform.saas_products p on p.id = t.saas_product_id
         where t.tenant_type = 'TRIAL'
           and t.trial_converted_at is null
           and t.trial_ends_at is not null
           and t.trial_ends_at <= now() + interval '3 days'
           and t.trial_ends_at >= now() - interval '14 days'
           and exists (
                 select 1 from platform.sales_attributions a
                  where a.sales_agent_id = v_agent and a.status = 'ACTIVE' and a.tenant_id = t.id)

        union all
        -- Lo que EBIM respondió a sus pedidos de prueba (últimos 14 días).
        select jsonb_build_object(
                 'type', case when tr.status = 'APPROVED' then 'TRIAL_APPROVED' else 'TRIAL_REJECTED' end,
                 'ref_id', tr.id,
                 'title', tr.company_name,
                 'organization_id', tr.organization_id,
                 'organization_name', null,
                 'product', p.short_name,
                 'date', tr.decided_at,
                 'amount', null, 'currency', null, 'tenant_id', tr.tenant_id,
                 'note', tr.decision_note)
          from platform.trial_requests tr
          left join platform.saas_products p on p.id = tr.saas_product_id
         where tr.sales_agent_id = v_agent
           and tr.status in ('APPROVED', 'REJECTED')
           and tr.decided_at >= now() - interval '14 days'
      ) x
  ), '[]'::jsonb);
end;
$$;
comment on function platform.my_sales_reminders() is
  'Recordatorios del comercial de la sesión: facturas de sus clientes (vencidas o por vencer en 7 días), '
  'renovaciones abiertas, pruebas por vencer o vencidas y la respuesta a sus pedidos de prueba. Solo lo atribuido a él.';
revoke all on function platform.my_sales_reminders() from public, anon;
grant execute on function platform.my_sales_reminders() to authenticated, service_role;
