-- ============================================================================
-- EBIM Control Plane V2 — 18 · Órdenes de Servicio / Órdenes de Compra
-- ----------------------------------------------------------------------------
-- Fase 08 de `.claude-prompts-v2`.
--
-- QUÉ ES Y QUÉ NO ES:
--
--   Una OS/OC es el documento ADMINISTRATIVO con el que el cliente autoriza el
--   gasto. En muchas empresas peruanas sin ella no entra ninguna factura al
--   circuito de pago, así que el Control Plane tiene que saber si existe, en qué
--   estado está y cuándo caduca.
--
--   NO es una Culqi Order y NO es un cobro. Recibir o aprobar una OS mueve el
--   trámite; no mueve dinero. Por eso este archivo:
--
--     · no inserta jamás en `platform.payments`;
--     · no toca `commission_events`;
--     · y la Fase 16 lo comprueba con un test negativo dedicado.
--
--   La comisión sigue naciendo donde nacía: de un pago CONFIRMED.
-- ============================================================================

create type platform.commercial_document_type as enum ('SERVICE_ORDER', 'PURCHASE_ORDER');

create type platform.commercial_document_status as enum (
  'REQUESTED',  -- se pidió al cliente; aún no llega
  'RECEIVED',   -- llegó, con número; pendiente de validar
  'APPROVED',   -- validada: habilita la continuidad administrativa
  'REJECTED',   -- devuelta al cliente
  'EXPIRED',    -- venció sin renovarse
  'CANCELLED'   -- anulada por acuerdo
);

create table platform.subscription_commercial_documents (
  id                uuid primary key default gen_random_uuid(),
  subscription_id   uuid not null references platform.subscriptions(id) on delete cascade,
  document_type     platform.commercial_document_type not null,
  -- Nulo mientras solo está solicitada: el cliente aún no le ha puesto número.
  document_number   text,
  status            platform.commercial_document_status not null default 'REQUESTED',

  requested_at      timestamptz not null default now(),
  received_at       timestamptz,
  approved_at       timestamptz,
  rejected_at       timestamptz,

  -- Periodo que el documento cubre. Fuera de él no autoriza nada.
  valid_from        date,
  valid_to          date,

  amount            numeric(14,2),
  currency          char(3) not null default 'USD',

  -- REFERENCIA al archivo (ruta en storage, enlace del ERP del cliente). Nunca
  -- el contenido, y nunca una URL firmada, que caduca y es un secreto de corta vida.
  external_file_ref text,

  notes             text,
  created_by        uuid references auth.users(id) on delete set null,
  updated_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint scd_currency_ck check (currency ~ '^[A-Z]{3}$'),
  constraint scd_amount_ck check (amount is null or amount >= 0),
  constraint scd_period_ck check (valid_to is null or valid_from is null or valid_to >= valid_from),

  -- Un documento recibido tiene número y fecha de recepción. Sin eso no está
  -- recibido: está solicitado.
  constraint scd_received_needs_number_ck check (
    status not in ('RECEIVED', 'APPROVED')
    or (document_number is not null and received_at is not null)
  ),
  constraint scd_approved_needs_date_ck check (
    status <> 'APPROVED' or approved_at is not null
  ),
  constraint scd_rejected_needs_date_ck check (
    status <> 'REJECTED' or rejected_at is not null
  ),
  -- Un documento aprobado sin vigencia no se puede caducar nunca, y entonces
  -- «vencida no autoriza renovación» sería inaplicable.
  constraint scd_approved_needs_validity_ck check (
    status <> 'APPROVED' or valid_to is not null
  )
);

comment on table platform.subscription_commercial_documents is
  'Orden de Servicio / Orden de Compra del cliente. Documento administrativo: '
  'aprobarlo NO crea un payment ni devenga comisión.';

comment on column platform.subscription_commercial_documents.external_file_ref is
  'Referencia al archivo (ruta de storage o enlace del ERP del cliente). Nunca el '
  'contenido ni una URL firmada.';

-- Un mismo número no puede repetirse dentro de la misma suscripción.
create unique index scd_number_uk
  on platform.subscription_commercial_documents(subscription_id, document_type, document_number)
  where document_number is not null;

-- Solo un documento vivo por suscripción y tipo: pedir dos OS a la vez para el
-- mismo contrato es un error de proceso.
create unique index scd_open_uk
  on platform.subscription_commercial_documents(subscription_id, document_type)
  where status in ('REQUESTED', 'RECEIVED', 'APPROVED');

create index scd_subscription_idx on platform.subscription_commercial_documents(subscription_id);
create index scd_status_idx on platform.subscription_commercial_documents(status);
create index scd_valid_to_idx on platform.subscription_commercial_documents(valid_to);

-- Índices de apoyo de las FKs a auth.users. Sin ellos, borrar un usuario obliga a
-- un seq scan de esta tabla para aplicar el ON DELETE SET NULL — y el test 12 de
-- `00_structure.test.sql` exige que toda FK del schema tenga índice que la cubra.
create index scd_created_by_idx on platform.subscription_commercial_documents(created_by);
create index scd_updated_by_idx on platform.subscription_commercial_documents(updated_by);

create trigger scd_set_updated_at
  before update on platform.subscription_commercial_documents
  for each row execute function platform.set_updated_at();

-- ---------------------------------------------------------------------------
-- Máquina de estados. Un documento no salta de solicitado a aprobado sin pasar
-- por recibido: aprobar algo que no ha llegado es exactamente el agujero que
-- este modelo existe para cerrar.
-- ---------------------------------------------------------------------------
create or replace function platform.enforce_document_transition()
returns trigger
language plpgsql
set search_path = platform, pg_catalog
as $$
declare
  v_valid boolean;
begin
  if old.status = new.status then
    return new;
  end if;

  v_valid := case old.status
    when 'REQUESTED' then new.status in ('RECEIVED', 'CANCELLED', 'EXPIRED')
    when 'RECEIVED'  then new.status in ('APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED')
    when 'APPROVED'  then new.status in ('EXPIRED', 'CANCELLED')
    when 'REJECTED'  then new.status in ('RECEIVED', 'CANCELLED')
    else false  -- EXPIRED y CANCELLED son terminales
  end;

  if not v_valid then
    raise exception 'TRANSICION_DOCUMENTO_INVALIDA: no se puede pasar de % a % (una OS/OC se recibe antes de aprobarse)',
      old.status, new.status
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger scd_transition_guard
  before update of status on platform.subscription_commercial_documents
  for each row execute function platform.enforce_document_transition();

-- ---------------------------------------------------------------------------
-- RLS + FORCE
-- ---------------------------------------------------------------------------
alter table platform.subscription_commercial_documents enable row level security;
alter table platform.subscription_commercial_documents force row level security;

grant select on platform.subscription_commercial_documents to authenticated;
revoke insert, update, delete on platform.subscription_commercial_documents from authenticated;

create policy scd_select on platform.subscription_commercial_documents
  for select to authenticated
  using (
    exists (
      select 1 from platform.subscriptions s
       where s.id = subscription_commercial_documents.subscription_id
         and (
           platform.can_read_finance()
           or platform.can_manage_platform_entities()
           or s.billed_organization_id in (select platform.my_org_ids())
           or (s.tenant_id is not null and s.tenant_id in (select platform.my_tenant_ids()))
         )
    )
  );

-- ---------------------------------------------------------------------------
-- Helper de autorización, para no repetirlo en las cinco RPCs.
-- ---------------------------------------------------------------------------
create or replace function platform.can_manage_subscription_documents(p_subscription_id uuid)
returns boolean
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select exists (
    select 1 from platform.subscriptions s
     where s.id = p_subscription_id
       and (
         platform.can_manage_commercial()
         or platform.is_org_admin(s.billed_organization_id)
       )
  );
$$;

-- ---------------------------------------------------------------------------
-- request_commercial_document — se pide la OS/OC al cliente.
-- ---------------------------------------------------------------------------
create or replace function platform.request_commercial_document(
  p_subscription_id uuid,
  p_document_type   platform.commercial_document_type,
  p_valid_from      date default null,
  p_valid_to        date default null,
  p_amount          numeric default null,
  p_currency        char(3) default null,
  p_notes           text default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id  uuid;
  v_sub record;
begin
  select * into v_sub from platform.subscriptions where id = p_subscription_id;
  if v_sub is null then
    raise exception 'SUSCRIPCION_NO_ENCONTRADA: %', p_subscription_id using errcode = '23503';
  end if;
  if not platform.can_manage_subscription_documents(p_subscription_id) then
    raise exception 'NO_AUTORIZADO: no puede gestionar documentos de la suscripción %', v_sub.code
      using errcode = '42501';
  end if;

  insert into platform.subscription_commercial_documents (
    subscription_id, document_type, status, requested_at,
    valid_from, valid_to, amount, currency, notes, created_by, updated_by
  ) values (
    p_subscription_id, p_document_type, 'REQUESTED', now(),
    p_valid_from, p_valid_to, p_amount, coalesce(p_currency, v_sub.currency),
    p_notes, auth.uid(), auth.uid()
  )
  returning id into v_id;

  perform platform.log_audit(
    'COMMERCIAL_DOCUMENT_REQUESTED', 'subscription_commercial_document', v_id::text,
    v_sub.billed_organization_id, v_sub.tenant_id,
    jsonb_build_object('subscription', v_sub.code, 'type', p_document_type,
                       'valid_from', p_valid_from, 'valid_to', p_valid_to, 'amount', p_amount)
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- receive_commercial_document — el cliente la envió, con número.
-- ---------------------------------------------------------------------------
create or replace function platform.receive_commercial_document(
  p_document_id      uuid,
  p_document_number  text,
  p_valid_from       date default null,
  p_valid_to         date default null,
  p_amount           numeric default null,
  p_external_file_ref text default null,
  p_notes            text default null
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_doc record;
  v_sub record;
begin
  select * into v_doc from platform.subscription_commercial_documents where id = p_document_id;
  if v_doc is null then
    raise exception 'DOCUMENTO_NO_ENCONTRADO: %', p_document_id using errcode = '23503';
  end if;
  if not platform.can_manage_subscription_documents(v_doc.subscription_id) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_document_number, '')), '') is null then
    raise exception 'NUMERO_REQUERIDO: registrar una OS/OC recibida exige su número de documento'
      using errcode = '23502';
  end if;

  select * into v_sub from platform.subscriptions where id = v_doc.subscription_id;

  update platform.subscription_commercial_documents
     set status = 'RECEIVED',
         document_number = trim(p_document_number),
         received_at = now(),
         valid_from = coalesce(p_valid_from, valid_from),
         valid_to = coalesce(p_valid_to, valid_to),
         amount = coalesce(p_amount, amount),
         external_file_ref = coalesce(p_external_file_ref, external_file_ref),
         notes = coalesce(p_notes, notes),
         updated_by = auth.uid()
   where id = p_document_id;

  perform platform.log_audit(
    'COMMERCIAL_DOCUMENT_RECEIVED', 'subscription_commercial_document', p_document_id::text,
    v_sub.billed_organization_id, v_sub.tenant_id,
    jsonb_build_object('document_number', trim(p_document_number), 'amount', p_amount,
                       'note', 'Recibir una OS/OC no registra ningún cobro')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- approve_commercial_document — habilita la continuidad administrativa.
--
-- Lo que NO hace, y es el punto entero de la fase: no crea un `payment`, no
-- marca la factura como pagada y no devenga comisión.
-- ---------------------------------------------------------------------------
create or replace function platform.approve_commercial_document(
  p_document_id uuid,
  p_valid_to    date default null,
  p_notes       text default null
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_doc record;
  v_sub record;
  v_valid_to date;
begin
  select * into v_doc from platform.subscription_commercial_documents where id = p_document_id;
  if v_doc is null then
    raise exception 'DOCUMENTO_NO_ENCONTRADO: %', p_document_id using errcode = '23503';
  end if;
  if not platform.can_manage_subscription_documents(v_doc.subscription_id) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501';
  end if;
  if v_doc.status <> 'RECEIVED' then
    raise exception 'DOCUMENTO_NO_RECIBIDO: solo se aprueba una OS/OC que ya llegó (esta está %)', v_doc.status
      using errcode = '23514';
  end if;

  v_valid_to := coalesce(p_valid_to, v_doc.valid_to);
  if v_valid_to is null then
    raise exception 'VIGENCIA_REQUERIDA: una OS/OC aprobada necesita fecha de vencimiento, o no se podría caducar nunca'
      using errcode = '23502';
  end if;

  select * into v_sub from platform.subscriptions where id = v_doc.subscription_id;

  update platform.subscription_commercial_documents
     set status = 'APPROVED',
         approved_at = now(),
         valid_to = v_valid_to,
         valid_from = coalesce(valid_from, current_date),
         notes = coalesce(p_notes, notes),
         updated_by = auth.uid()
   where id = p_document_id;

  perform platform.log_audit(
    'COMMERCIAL_DOCUMENT_APPROVED', 'subscription_commercial_document', p_document_id::text,
    v_sub.billed_organization_id, v_sub.tenant_id,
    jsonb_build_object(
      'document_number', v_doc.document_number,
      'valid_to', v_valid_to,
      'creates_payment', false,
      'accrues_commission', false,
      'note', 'Aprobar habilita la continuidad administrativa, no equivale a un cobro'
    )
  );
end;
$$;

comment on function platform.approve_commercial_document is
  'Aprobar una OS/OC NO crea un payment ni devenga comisión. La comisión sigue '
  'naciendo exclusivamente de un pago CONFIRMED (regla 7 del contrato V2).';

-- ---------------------------------------------------------------------------
-- reject / cancel
-- ---------------------------------------------------------------------------
create or replace function platform.reject_commercial_document(
  p_document_id uuid,
  p_reason      text
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_doc record;
  v_sub record;
begin
  select * into v_doc from platform.subscription_commercial_documents where id = p_document_id;
  if v_doc is null then
    raise exception 'DOCUMENTO_NO_ENCONTRADO: %', p_document_id using errcode = '23503';
  end if;
  if not platform.can_manage_subscription_documents(v_doc.subscription_id) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: rechazar una OS/OC exige explicar por qué' using errcode = '23502';
  end if;

  select * into v_sub from platform.subscriptions where id = v_doc.subscription_id;

  update platform.subscription_commercial_documents
     set status = 'REJECTED', rejected_at = now(),
         notes = coalesce(notes || E'\n', '') || 'Rechazada: ' || p_reason,
         updated_by = auth.uid()
   where id = p_document_id;

  perform platform.log_audit(
    'COMMERCIAL_DOCUMENT_REJECTED', 'subscription_commercial_document', p_document_id::text,
    v_sub.billed_organization_id, v_sub.tenant_id,
    jsonb_build_object('reason', p_reason)
  );
end;
$$;

create or replace function platform.cancel_commercial_document(
  p_document_id uuid,
  p_reason      text default null
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_doc record;
  v_sub record;
begin
  select * into v_doc from platform.subscription_commercial_documents where id = p_document_id;
  if v_doc is null then
    raise exception 'DOCUMENTO_NO_ENCONTRADO: %', p_document_id using errcode = '23503';
  end if;
  if not platform.can_manage_subscription_documents(v_doc.subscription_id) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501';
  end if;

  select * into v_sub from platform.subscriptions where id = v_doc.subscription_id;

  update platform.subscription_commercial_documents
     set status = 'CANCELLED',
         notes = coalesce(notes || E'\n', '') || 'Anulada: ' || coalesce(p_reason, 'sin motivo'),
         updated_by = auth.uid()
   where id = p_document_id;

  perform platform.log_audit(
    'COMMERCIAL_DOCUMENT_CANCELLED', 'subscription_commercial_document', p_document_id::text,
    v_sub.billed_organization_id, v_sub.tenant_id,
    jsonb_build_object('reason', p_reason)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- expire_commercial_documents — caducidad determinista e idempotente.
--
-- Recibe `p_as_of` para que los tests puedan fijar la fecha. Idempotente: correrla
-- dos veces con la misma fecha no cambia nada la segunda vez.
-- ---------------------------------------------------------------------------
create or replace function platform.expire_commercial_documents(p_as_of date default current_date)
returns integer
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_count integer;
begin
  if not (platform.can_manage_commercial() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo EBIM caduca documentos comerciales' using errcode = '42501';
  end if;

  update platform.subscription_commercial_documents
     set status = 'EXPIRED'
   where status in ('REQUESTED', 'RECEIVED', 'APPROVED')
     and valid_to is not null
     and valid_to < p_as_of;

  get diagnostics v_count = row_count;

  if v_count > 0 then
    perform platform.log_audit(
      'COMMERCIAL_DOCUMENTS_EXPIRED', 'subscription_commercial_document', null, null, null,
      jsonb_build_object('as_of', p_as_of, 'expired', v_count)
    );
  end if;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Vista: estado documental por suscripción.
--
-- `document_ok` es la pregunta que de verdad importa: ¿esta suscripción tiene
-- hoy la autorización administrativa que su método de cobro exige?
-- ---------------------------------------------------------------------------
create or replace view platform.v_subscription_documents
with (security_invoker = true) as
select
  c.subscription_id,
  c.subscription_code,
  c.billed_organization_id,
  c.billed_organization_name,
  c.product_code,
  c.tenant_name,
  c.collection_method,
  c.requires_service_order,
  c.requires_purchase_order,
  c.document_lead_days,
  d.id                as document_id,
  d.document_type,
  d.document_number,
  d.status            as document_status,
  d.requested_at,
  d.received_at,
  d.approved_at,
  d.valid_from,
  d.valid_to,
  d.amount            as document_amount,
  d.currency          as document_currency,
  d.external_file_ref,
  -- ¿Hace falta documento? Solo si el perfil de cobro lo exige.
  (c.requires_service_order or c.requires_purchase_order) as document_required,
  -- ¿Está cubierta HOY? Aprobada y dentro de vigencia.
  (d.status = 'APPROVED'
   and (d.valid_from is null or d.valid_from <= current_date)
   and (d.valid_to is null or d.valid_to >= current_date))  as document_ok
from platform.v_subscription_collection c
left join platform.subscription_commercial_documents d
       on d.subscription_id = c.subscription_id
      and d.status in ('REQUESTED', 'RECEIVED', 'APPROVED');

comment on view platform.v_subscription_documents is
  '`document_ok` responde a: ¿tiene esta suscripción la autorización administrativa '
  'vigente que su método de cobro exige? Nada aquí implica que se haya cobrado.';

grant select on platform.v_subscription_documents to authenticated;
revoke all on platform.v_subscription_documents from anon;

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
         'can_manage_subscription_documents',
         'request_commercial_document', 'receive_commercial_document',
         'approve_commercial_document', 'reject_commercial_document',
         'cancel_commercial_document', 'expire_commercial_documents',
         'enforce_document_transition'
       )
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;
