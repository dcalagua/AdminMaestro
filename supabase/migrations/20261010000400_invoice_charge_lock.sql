-- ============================================================================
-- MasterAdmin · M1/M2 · Candado de cobro por factura (anti doble cargo)
-- ----------------------------------------------------------------------------
-- Problema: dos `/charge` simultáneos del portal sobre la misma factura (doble
-- clic, dos pestañas) o el portal y `payment-autocharge` a la vez podían llamar
-- AMBOS a la pasarela. El segundo registro fallaba con SOBRECOBRO, pero el
-- dinero ya se había cobrado dos veces.
--
-- Solución: un candado de vida corta por factura que el portal y el cobro
-- automático reclaman ANTES de llamar a la pasarela:
--   · claim_invoice_charge_lock  — atómico (FOR UPDATE de la factura +
--     INSERT … ON CONFLICT): un solo cobro en vuelo por factura. Devuelve el
--     SALDO VIGENTE leído con la factura bloqueada (el que se debe cobrar: el
--     saldo que vio la petición antes del candado puede estar viejo).
--   · release_invoice_charge_lock — RELEASE (éxito o fallo definitivo) o
--     REVIEW (fallo ambiguo / PAGO_EN_REVISION: se mantiene hasta que la
--     reconciliación registre el pago o venza la ventana de revisión).
-- Mientras el candado está tomado, otro intento responde COBRO_EN_CURSO.
--
-- Un intento PENDING de cobro automático reciente (payment_charge_attempts)
-- también cuenta como cobro en curso: si la Edge Function se cayó a mitad de
-- un cargo, el resultado es desconocido hasta que lo vea la reconciliación.
--
-- SOLO SERVIDOR. Finanzas puede leer el estado de los candados.
-- ============================================================================

create table platform.invoice_charge_locks (
  invoice_id   uuid primary key references platform.invoices (id) on delete restrict,
  lock_id      uuid not null default gen_random_uuid(),
  holder       text not null,
  holder_ref   text,
  status       text not null default 'ACTIVE',
  claimed_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  released_at  timestamptz,
  outcome_code text,

  constraint icl_lock_uk unique (lock_id),
  constraint icl_holder_ck check (holder in ('PORTAL', 'AUTOCHARGE')),
  constraint icl_holder_ref_ck check (holder_ref is null or length(holder_ref) <= 120),
  constraint icl_status_ck check (status in ('ACTIVE', 'REVIEW', 'RELEASED')),
  constraint icl_release_ck check ((status = 'RELEASED') = (released_at is not null)),
  constraint icl_expiry_ck check (expires_at > claimed_at),
  constraint icl_outcome_ck check (outcome_code is null or outcome_code ~ '^[A-Z][A-Z0-9_]{1,63}$')
);

comment on table platform.invoice_charge_locks is
  'Candado de cobro con tarjeta por factura (anti doble cargo). Una fila por factura: ACTIVE '
  '(cargo en vuelo, ~2 min), REVIEW (resultado ambiguo, se mantiene hasta registrar el pago o '
  'vencer la ventana de revisión) o RELEASED. Lo usan pay-portal y payment-autocharge.';

create index icl_active_ix on platform.invoice_charge_locks (expires_at) where status <> 'RELEASED';

alter table platform.invoice_charge_locks enable row level security;
alter table platform.invoice_charge_locks force row level security;

revoke all on platform.invoice_charge_locks from public, anon, authenticated;
grant select on platform.invoice_charge_locks to authenticated;
grant all on platform.invoice_charge_locks to service_role;

create policy icl_select on platform.invoice_charge_locks
  for select to authenticated
  using (platform.can_read_finance() or platform.can_manage_platform_entities());

-- ---------------------------------------------------------------------------
-- claim_invoice_charge_lock — SOLO SERVIDOR
-- ---------------------------------------------------------------------------
create or replace function platform.claim_invoice_charge_lock(
  p_invoice_id  uuid,
  p_holder      text,
  p_holder_ref  text default null,
  p_ttl_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  -- Ventana durante la que un intento PENDING de cobro automático se considera
  -- «en vuelo» (igual que la ventana de revisión del candado).
  c_review_window constant interval := interval '30 minutes';
  v_invoice record;
  v_balance numeric(14,2);
  v_lock    uuid;
  v_current platform.invoice_charge_locks;
  v_ttl     integer;
begin
  if not platform.is_service_context() then
    raise exception 'NO_AUTORIZADO_SERVER_ONLY: el candado de cobro lo gestiona el servidor'
      using errcode = '42501';
  end if;
  if p_holder is null or p_holder not in ('PORTAL', 'AUTOCHARGE') then
    raise exception 'ORIGEN_INVALIDO: %', coalesce(p_holder, 'NULL') using errcode = '22023';
  end if;
  v_ttl := least(greatest(coalesce(p_ttl_seconds, 120), 30), 600);

  -- Serializa con cualquier otro cobro, candado o pago de esta factura.
  select i.id, i.status into v_invoice from platform.invoices i where i.id = p_invoice_id for update;
  if v_invoice.id is null or v_invoice.status not in ('ISSUED', 'PARTIALLY_PAID') then
    return jsonb_build_object('ok', false, 'error', 'FACTURA_NO_PAGABLE');
  end if;

  v_balance := platform.invoice_balance(p_invoice_id);
  if coalesce(v_balance, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'FACTURA_NO_PAGABLE');
  end if;

  if exists (select 1 from platform.payment_charge_attempts a
              where a.invoice_id = p_invoice_id and a.status = 'PENDING'
                and a.created_at > now() - c_review_window) then
    return jsonb_build_object('ok', false, 'error', 'COBRO_EN_CURSO');
  end if;

  insert into platform.invoice_charge_locks as l (
    invoice_id, lock_id, holder, holder_ref, status, claimed_at, expires_at
  ) values (
    p_invoice_id, gen_random_uuid(), p_holder, left(p_holder_ref, 120), 'ACTIVE', now(),
    now() + make_interval(secs => v_ttl)
  )
  on conflict (invoice_id) do update
     set lock_id = excluded.lock_id,
         holder = excluded.holder,
         holder_ref = excluded.holder_ref,
         status = 'ACTIVE',
         claimed_at = excluded.claimed_at,
         expires_at = excluded.expires_at,
         released_at = null,
         outcome_code = null
   where l.status = 'RELEASED' or l.expires_at <= now()
  returning l.lock_id into v_lock;

  if v_lock is null then
    select * into v_current from platform.invoice_charge_locks where invoice_id = p_invoice_id;
    return jsonb_build_object(
      'ok', false, 'error', 'COBRO_EN_CURSO',
      'retry_after_seconds', greatest(ceil(extract(epoch from (v_current.expires_at - now()))), 1)::integer
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'lock_id', v_lock, 'balance', v_balance,
    'expires_at', now() + make_interval(secs => v_ttl)
  );
end;
$$;

comment on function platform.claim_invoice_charge_lock(uuid, text, text, integer) is
  'SERVER-ONLY. Reclama el candado de cobro de una factura (TTL 30–600 s, 120 por defecto) y '
  'devuelve el saldo vigente. {ok:false, error:COBRO_EN_CURSO} si hay otro cobro en vuelo o en '
  'revisión; FACTURA_NO_PAGABLE si la factura ya no tiene saldo.';

-- ---------------------------------------------------------------------------
-- release_invoice_charge_lock — SOLO SERVIDOR
-- ---------------------------------------------------------------------------
create or replace function platform.release_invoice_charge_lock(
  p_lock_id      uuid,
  p_outcome      text default 'RELEASE',
  p_outcome_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  c_review_window constant interval := interval '30 minutes';
  v_lock platform.invoice_charge_locks;
  v_code text;
begin
  if not platform.is_service_context() then
    raise exception 'NO_AUTORIZADO_SERVER_ONLY: el candado de cobro lo gestiona el servidor'
      using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('RELEASE', 'REVIEW') then
    raise exception 'RESULTADO_INVALIDO: %', coalesce(p_outcome, 'NULL') using errcode = '22023';
  end if;
  v_code := case when p_outcome_code ~ '^[A-Z][A-Z0-9_]{1,63}$' then p_outcome_code end;

  select * into v_lock from platform.invoice_charge_locks where lock_id = p_lock_id for update;
  -- Un candado ya reclamado por otro (lock_id distinto) o inexistente: nada que hacer.
  if v_lock.invoice_id is null then
    return jsonb_build_object('ok', false, 'error', 'CANDADO_NO_ENCONTRADO');
  end if;
  if v_lock.status = 'RELEASED' then
    return jsonb_build_object('ok', true, 'status', 'RELEASED', 'duplicate', true);
  end if;

  if p_outcome = 'RELEASE' then
    update platform.invoice_charge_locks
       set status = 'RELEASED', released_at = now(), outcome_code = coalesce(v_code, outcome_code)
     where lock_id = p_lock_id;
    return jsonb_build_object('ok', true, 'status', 'RELEASED');
  end if;

  update platform.invoice_charge_locks
     set status = 'REVIEW',
         expires_at = greatest(expires_at, now() + c_review_window),
         outcome_code = coalesce(v_code, outcome_code)
   where lock_id = p_lock_id;
  return jsonb_build_object('ok', true, 'status', 'REVIEW');
end;
$$;

comment on function platform.release_invoice_charge_lock(uuid, text, text) is
  'SERVER-ONLY. RELEASE: libera el candado (cobro registrado o fallo definitivo). REVIEW: lo '
  'mantiene 30 min más (resultado ambiguo, PAGO_EN_REVISION) hasta que la reconciliación o el '
  'webhook registren el pago. Solo actúa sobre el lock_id vigente.';

-- ---------------------------------------------------------------------------
-- Un pago CONFIRMED de la factura (webhook, reconciliación, manual) resuelve
-- el candado en REVIEW: el resultado ya no es ambiguo.
-- ---------------------------------------------------------------------------
create or replace function platform.release_review_charge_lock_on_payment()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if new.status = 'CONFIRMED' then
    update platform.invoice_charge_locks
       set status = 'RELEASED', released_at = now(), outcome_code = 'PAGO_REGISTRADO'
     where invoice_id = new.invoice_id and status = 'REVIEW';
  end if;
  return null;
end;
$$;

create trigger payments_release_review_charge_lock
  after insert or update of status on platform.payments
  for each row execute function platform.release_review_charge_lock_on_payment();

revoke all on function platform.release_review_charge_lock_on_payment() from public, anon, authenticated;
revoke all on function platform.claim_invoice_charge_lock(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function platform.release_invoice_charge_lock(uuid, text, text) from public, anon, authenticated;
grant execute on function platform.claim_invoice_charge_lock(uuid, text, text, integer) to service_role;
grant execute on function platform.release_invoice_charge_lock(uuid, text, text) to service_role;
