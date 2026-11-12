-- ============================================================================
-- V4 · Fase 13 — Liquidación y pago de comisiones
-- ----------------------------------------------------------------------------
-- Brecha P0 (revisión 2026-10-04): `settle_commissions` deja la liquidación
-- OPEN y no había forma de aprobarla ni de registrar su pago. Esta migración
-- cierra el ciclo con el enum que YA existía (`settlement_status`):
--
--     OPEN ──approve──▶ APPROVED ──pay──▶ PAID
--       └──────cancel──────┴──▶ CANCELLED   (libera los eventos)
--
-- REGLAS:
--   · solo finanzas o el super admin (`can_read_finance`), todo con `log_audit`;
--   · PAID y CANCELLED son terminales: una liquidación no se paga dos veces ni
--     se reabre (trigger, no solo la RPC);
--   · una liquidación APPROVED o PAID está congelada: no gana ni pierde eventos;
--     un evento solo entra en una liquidación OPEN y solo sale si la suya se
--     anula. Así un evento nunca está en dos liquidaciones vivas;
--   · el total de una liquidación PAID o CANCELLED queda fijo (es lo que se pagó
--     o lo que se anuló);
--   · un reverso de cobro posterior al pago NO toca la liquidación pagada: el
--     contra-evento negativo de `reverse_payment` (V2) nace ELEGIBLE y sin
--     liquidación, y netea en la próxima. Esta migración solo lo garantiza;
--   · los importes son los de la liquidación, en su moneda (guard V3).
--
-- El código `STL-<agente>-<YYYYMM>-<MON>` deja de ser único en la historia: una
-- liquidación anulada conserva su código y la siguiente del mismo período lo
-- reutiliza (único solo entre las no anuladas).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columnas del ciclo de vida.
-- ---------------------------------------------------------------------------
alter table platform.commission_settlements
  add column approval_note       text,
  add column paid_by             uuid references platform.profiles (id) on delete set null,
  add column payment_method      text,
  add column payment_note        text,
  add column cancelled_at        timestamptz,
  add column cancelled_by        uuid references platform.profiles (id) on delete set null,
  add column cancellation_reason text;

comment on column platform.commission_settlements.payment_method is
  'Medio con el que EBIM pagó la liquidación: BANK_TRANSFER, PAYROLL, CHECK, CASH u OTHER.';
comment on column platform.commission_settlements.cancellation_reason is
  'Motivo auditable de la anulación. Los eventos vuelven a ELEGIBLE para una próxima liquidación.';

create index if not exists commission_settlements_paid_by_ix on platform.commission_settlements (paid_by);
create index if not exists commission_settlements_cancelled_by_ix on platform.commission_settlements (cancelled_by);

-- Filas históricas (seed V2/V3 y bases ya desplegadas) que se pagaron sin medio
-- o se aprobaron sin sello: se completan antes de exigirlo.
update platform.commission_settlements
   set payment_method = 'OTHER'
 where status = 'PAID' and payment_method is null;
update platform.commission_settlements
   set approved_at = coalesce(paid_at, updated_at)
 where status in ('APPROVED', 'PAID') and approved_at is null;
update platform.commission_settlements
   set cancelled_at = updated_at,
       cancellation_reason = coalesce(cancellation_reason, 'Anulación histórica sin motivo registrado')
 where status = 'CANCELLED' and (cancelled_at is null or cancellation_reason is null);

alter table platform.commission_settlements
  add constraint settlements_payment_method_ck
    check (payment_method is null or payment_method in ('BANK_TRANSFER', 'PAYROLL', 'CHECK', 'CASH', 'OTHER')),
  add constraint settlements_paid_needs_method_ck
    check (status <> 'PAID' or payment_method is not null),
  add constraint settlements_approved_needs_stamp_ck
    check (status not in ('APPROVED', 'PAID') or approved_at is not null),
  add constraint settlements_cancel_needs_reason_ck
    check (status <> 'CANCELLED'
           or (cancelled_at is not null and nullif(trim(cancellation_reason), '') is not null));

-- Código único solo entre las liquidaciones no anuladas.
drop index if exists platform.settlements_code_uk;
create unique index settlements_code_uk
  on platform.commission_settlements (code) where status <> 'CANCELLED';

-- ---------------------------------------------------------------------------
-- 2. PAID y CANCELLED son terminales.
-- ---------------------------------------------------------------------------
create or replace function platform.enforce_settlement_terminal()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if old.status in ('PAID', 'CANCELLED')
     and (new.status, new.total_amount, new.currency, new.sales_agent_id, new.period_start, new.period_end,
          new.paid_at, new.payment_reference, new.payment_method, new.approved_at,
          new.cancelled_at, new.cancellation_reason)
         is distinct from
         (old.status, old.total_amount, old.currency, old.sales_agent_id, old.period_start, old.period_end,
          old.paid_at, old.payment_reference, old.payment_method, old.approved_at,
          old.cancelled_at, old.cancellation_reason) then
    raise exception 'LIQUIDACION_CERRADA: la liquidación % está %; no se modifica', old.code, old.status
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger settlements_terminal_guard
  before update on platform.commission_settlements
  for each row execute function platform.enforce_settlement_terminal();

-- ---------------------------------------------------------------------------
-- 3. Un evento entra solo en una liquidación OPEN y sale solo si la suya está
--    OPEN o anulada; el de una liquidación PAID no cambia.
--
-- Se nombra para dispararse DESPUÉS de `commission_events_settlement_currency_guard`
-- (orden alfabético): mezclar monedas sigue reportándose como LIQUIDACION_MULTIMONEDA.
-- ---------------------------------------------------------------------------
create or replace function platform.enforce_settlement_event_state()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_old record;
  v_new record;
begin
  if tg_op = 'UPDATE' and old.settlement_id is not null then
    -- FOR SHARE: una aprobación o un pago concurrente espera a esta transacción.
    select s.code, s.status into v_old
      from platform.commission_settlements s where s.id = old.settlement_id for share;

    if v_old.status = 'PAID'
       and (new.settlement_id, new.status, new.amount, new.currency)
           is distinct from (old.settlement_id, old.status, old.amount, old.currency) then
      raise exception 'EVENTO_LIQUIDADO: el evento pertenece a la liquidación pagada %; un ajuste posterior va como contra-evento', v_old.code
        using errcode = '23514';
    end if;

    if new.settlement_id is distinct from old.settlement_id then
      if new.settlement_id is not null then
        raise exception 'EVENTO_YA_LIQUIDADO: el evento ya está en la liquidación %; anúlala antes de moverlo', v_old.code
          using errcode = '23514';
      end if;
      if v_old.status = 'APPROVED' then
        raise exception 'LIQUIDACION_APROBADA: la liquidación % está aprobada; para liberar sus eventos hay que anularla', v_old.code
          using errcode = '23514';
      end if;
    end if;
  end if;

  if new.settlement_id is not null
     and (tg_op = 'INSERT' or new.settlement_id is distinct from old.settlement_id) then
    select s.code, s.status into v_new
      from platform.commission_settlements s where s.id = new.settlement_id for share;
    if v_new.status is distinct from 'OPEN' then
      raise exception 'LIQUIDACION_CERRADA: la liquidación % está %; solo una liquidación abierta recibe eventos', v_new.code, v_new.status
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger commission_events_settlement_state_guard
  before insert or update of settlement_id, status, amount, currency on platform.commission_events
  for each row execute function platform.enforce_settlement_event_state();

-- ---------------------------------------------------------------------------
-- 4. El total de una liquidación PAID o CANCELLED queda fijo.
--    Resto idéntico al baseline (20260902000600).
-- ---------------------------------------------------------------------------
create or replace function platform.recalc_settlement_total()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_settlement uuid;
begin
  foreach v_settlement in array array[
    coalesce(new.settlement_id, old.settlement_id),
    coalesce(old.settlement_id, new.settlement_id)
  ] loop
    if v_settlement is not null then
      update platform.commission_settlements s
         set total_amount = coalesce((
               select sum(e.amount) from platform.commission_events e
                where e.settlement_id = s.id and e.status <> 'VOID'
             ), 0),
             updated_at = now()
       where s.id = v_settlement
         and s.status not in ('PAID', 'CANCELLED');
    end if;
  end loop;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. settle_commissions: ignora las anuladas al buscar la liquidación del
--    período y extiende el fin del período si se vuelve a liquidar más tarde.
--    Resto idéntico a la versión V3 (20260913000900).
-- ---------------------------------------------------------------------------
create or replace function platform.settle_commissions(
  p_sales_agent_id uuid,
  p_period_start   date,
  p_period_end     date,
  p_currency       char(3)
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_settlement record;
  v_code       text;
  v_currency   char(3) := upper(nullif(trim(coalesce(p_currency, '')), ''));
  v_count      integer;
begin
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: sólo EBIM_FINANCE o el super admin liquidan comisiones'
      using errcode = '42501';
  end if;

  if v_currency is null then
    raise exception 'MONEDA_REQUERIDA: una liquidación es mono-moneda; indica PEN, BOB, USD...'
      using errcode = '23502';
  end if;
  if not exists (select 1 from platform.currencies c where c.code = v_currency) then
    raise exception 'MONEDA_INVALIDA: "%" no está en el catálogo', p_currency using errcode = '23503';
  end if;

  if p_period_start is null or p_period_end is null then
    raise exception 'PERIODO_REQUERIDO: indica el inicio y el fin del período' using errcode = '23502';
  end if;
  if p_period_end < p_period_start then
    raise exception 'PERIODO_INVALIDO: el fin (%) es anterior al inicio (%)', p_period_end, p_period_start
      using errcode = '22007';
  end if;

  select 'STL-' || sa.code || '-' || to_char(p_period_start, 'YYYYMM') || '-' || v_currency into v_code
    from platform.sales_agents sa where sa.id = p_sales_agent_id;

  if v_code is null then
    raise exception 'COMERCIAL_NO_ENCONTRADO: %', p_sales_agent_id using errcode = '23503';
  end if;

  select * into v_settlement
    from platform.commission_settlements
   where code = v_code and status <> 'CANCELLED'
   for update;

  if v_settlement.id is not null and v_settlement.status <> 'OPEN' then
    raise exception 'LIQUIDACION_CERRADA: la liquidación % está %; no admite eventos nuevos',
      v_code, v_settlement.status
      using errcode = '23514';
  end if;

  if v_settlement.id is null then
    insert into platform.commission_settlements (
      code, sales_agent_id, period_start, period_end, currency, status
    )
    values (v_code, p_sales_agent_id, p_period_start, p_period_end, v_currency, 'OPEN')
    returning * into v_settlement;
  elsif p_period_end > v_settlement.period_end then
    update platform.commission_settlements
       set period_end = p_period_end
     where id = v_settlement.id;
  end if;

  update platform.commission_events e
     set settlement_id = v_settlement.id,
         status = 'ACCRUED',
         updated_at = now()
   where e.sales_agent_id = p_sales_agent_id
     and e.settlement_id is null
     and e.status = 'ELIGIBLE'
     and e.currency = v_currency
     and e.earned_on between p_period_start and p_period_end;

  get diagnostics v_count = row_count;

  perform platform.log_audit(
    'COMMISSIONS_SETTLED', 'commission_settlement', v_settlement.id::text,
    null, null,
    jsonb_build_object('code', v_code, 'currency', v_currency, 'events', v_count,
                       'period_start', p_period_start, 'period_end', p_period_end)
  );

  return v_settlement.id;
end;
$$;

comment on function platform.settle_commissions(uuid, date, date, char) is
  'Liquidación MONO-MONEDA por comercial, periodo y moneda (código STL-<agente>-<YYYYMM>-<MON>). '
  'Moneda obligatoria. No toca liquidaciones APPROVED/PAID; una anulada no se reutiliza.';

-- ---------------------------------------------------------------------------
-- 6. approve_commission_settlement — OPEN → APPROVED.
-- ---------------------------------------------------------------------------
create or replace function platform.approve_commission_settlement(
  p_settlement_id uuid,
  p_note          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_s      record;
  v_events integer;
  v_note   text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin aprueban liquidaciones'
      using errcode = '42501';
  end if;

  select * into v_s from platform.commission_settlements where id = p_settlement_id for update;
  if v_s.id is null then
    raise exception 'LIQUIDACION_NO_ENCONTRADA: %', p_settlement_id using errcode = '23503';
  end if;

  if v_s.status = 'APPROVED' then
    return jsonb_build_object('settlement_id', v_s.id, 'code', v_s.code, 'status', v_s.status,
                              'already_approved', true);
  end if;
  if v_s.status = 'PAID' then
    raise exception 'LIQUIDACION_YA_PAGADA: la liquidación % ya se pagó', v_s.code using errcode = '23514';
  end if;
  if v_s.status = 'CANCELLED' then
    raise exception 'LIQUIDACION_ANULADA: la liquidación % está anulada', v_s.code using errcode = '23514';
  end if;

  select count(*) into v_events
    from platform.commission_events e where e.settlement_id = v_s.id and e.status <> 'VOID';
  if v_events = 0 then
    raise exception 'LIQUIDACION_VACIA: la liquidación % no tiene eventos; anúlala en lugar de aprobarla', v_s.code
      using errcode = '23514';
  end if;
  if v_s.total_amount < 0 then
    raise exception 'LIQUIDACION_NEGATIVA: la liquidación % suma % %; los reversos superan lo devengado y no hay nada que pagar',
      v_s.code, v_s.currency, v_s.total_amount
      using errcode = '23514';
  end if;

  update platform.commission_settlements
     set status = 'APPROVED',
         approved_at = now(),
         approved_by = auth.uid(),
         approval_note = v_note
   where id = v_s.id;

  perform platform.log_audit(
    'COMMISSION_SETTLEMENT_APPROVED', 'commission_settlement', v_s.id::text, null, null,
    jsonb_build_object('code', v_s.code, 'currency', v_s.currency, 'total', v_s.total_amount,
                       'events', v_events, 'note', v_note)
  );

  return jsonb_build_object('settlement_id', v_s.id, 'code', v_s.code, 'status', 'APPROVED',
                            'total', v_s.total_amount, 'currency', v_s.currency, 'events', v_events,
                            'already_approved', false);
end;
$$;

comment on function platform.approve_commission_settlement(uuid, text) is
  'Aprueba una liquidación OPEN con eventos y total >= 0 (finanzas o super admin). Desde aquí la '
  'liquidación no gana ni pierde eventos. Repetirla sobre una APPROVED no hace nada.';

-- ---------------------------------------------------------------------------
-- 7. pay_commission_settlement — APPROVED → PAID; sus eventos pasan a PAID.
--
-- `p_paid_at` es la FECHA del pago (lo que el usuario sabe); se guarda a las
-- 12:00 UTC para que ningún huso de la región la mueva de día.
-- ---------------------------------------------------------------------------
create or replace function platform.pay_commission_settlement(
  p_settlement_id     uuid,
  p_paid_at           date,
  p_payment_reference text,
  p_method            text,
  p_note              text default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_s      record;
  v_ref    text := nullif(trim(coalesce(p_payment_reference, '')), '');
  v_method text := upper(nullif(trim(coalesce(p_method, '')), ''));
  v_note   text := nullif(trim(coalesce(p_note, '')), '');
  v_events integer;
begin
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin registran el pago de una liquidación'
      using errcode = '42501';
  end if;

  select * into v_s from platform.commission_settlements where id = p_settlement_id for update;
  if v_s.id is null then
    raise exception 'LIQUIDACION_NO_ENCONTRADA: %', p_settlement_id using errcode = '23503';
  end if;

  if v_ref is null then
    raise exception 'REFERENCIA_REQUERIDA: indica la referencia del pago (número de operación, planilla...)'
      using errcode = '23502';
  end if;

  -- Reintento del mismo pago (doble clic, red): no hace nada. Otro pago: rechazo.
  if v_s.status = 'PAID' then
    if v_s.payment_reference = v_ref then
      return jsonb_build_object('settlement_id', v_s.id, 'code', v_s.code, 'status', v_s.status,
                                'already_paid', true);
    end if;
    raise exception 'LIQUIDACION_YA_PAGADA: la liquidación % ya se pagó con la referencia %', v_s.code, v_s.payment_reference
      using errcode = '23514';
  end if;
  if v_s.status = 'CANCELLED' then
    raise exception 'LIQUIDACION_ANULADA: la liquidación % está anulada', v_s.code using errcode = '23514';
  end if;
  if v_s.status <> 'APPROVED' then
    raise exception 'LIQUIDACION_NO_APROBADA: la liquidación % está %; apruébala antes de registrar el pago', v_s.code, v_s.status
      using errcode = '23514';
  end if;

  if v_method is null then
    raise exception 'MEDIO_REQUERIDO: indica cómo se pagó (transferencia, planilla, cheque, efectivo u otro)'
      using errcode = '23502';
  end if;
  if v_method not in ('BANK_TRANSFER', 'PAYROLL', 'CHECK', 'CASH', 'OTHER') then
    raise exception 'MEDIO_INVALIDO: "%" no es un medio de pago de comisiones', p_method using errcode = '23514';
  end if;

  if p_paid_at is null then
    raise exception 'FECHA_REQUERIDA: indica la fecha del pago' using errcode = '23502';
  end if;
  if p_paid_at > current_date then
    raise exception 'FECHA_FUTURA: el pago no puede tener fecha posterior a hoy (%)', current_date
      using errcode = '22007';
  end if;
  if p_paid_at < v_s.period_start then
    raise exception 'FECHA_INVALIDA: el pago (%) es anterior al inicio del período liquidado (%)', p_paid_at, v_s.period_start
      using errcode = '22007';
  end if;

  -- Primero los eventos (la liquidación aún APPROVED), luego la cabecera.
  update platform.commission_events
     set status = 'PAID', updated_at = now()
   where settlement_id = v_s.id and status = 'ACCRUED';
  get diagnostics v_events = row_count;

  update platform.commission_settlements
     set status = 'PAID',
         paid_at = (p_paid_at + time '12:00') at time zone 'UTC',
         paid_by = auth.uid(),
         payment_reference = v_ref,
         payment_method = v_method,
         payment_note = v_note
   where id = v_s.id;

  perform platform.log_audit(
    'COMMISSION_SETTLEMENT_PAID', 'commission_settlement', v_s.id::text, null, null,
    jsonb_build_object('code', v_s.code, 'currency', v_s.currency, 'total', v_s.total_amount,
                       'events', v_events, 'paid_on', p_paid_at, 'reference', v_ref,
                       'method', v_method, 'note', v_note)
  );

  return jsonb_build_object('settlement_id', v_s.id, 'code', v_s.code, 'status', 'PAID',
                            'total', v_s.total_amount, 'currency', v_s.currency, 'events', v_events,
                            'already_paid', false);
end;
$$;

comment on function platform.pay_commission_settlement(uuid, date, text, text, text) is
  'Registra el pago de una liquidación APPROVED (fecha, referencia y medio obligatorios). La deja '
  'PAID y sus eventos PAID. Repetir con la misma referencia no hace nada; con otra, se rechaza.';

-- ---------------------------------------------------------------------------
-- 8. cancel_commission_settlement — OPEN/APPROVED → CANCELLED, libera eventos.
-- ---------------------------------------------------------------------------
create or replace function platform.cancel_commission_settlement(
  p_settlement_id uuid,
  p_reason        text
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_s      record;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_ids    uuid[];
begin
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin anulan liquidaciones'
      using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception 'MOTIVO_REQUERIDO: anular una liquidación exige un motivo auditable'
      using errcode = '23502';
  end if;

  select * into v_s from platform.commission_settlements where id = p_settlement_id for update;
  if v_s.id is null then
    raise exception 'LIQUIDACION_NO_ENCONTRADA: %', p_settlement_id using errcode = '23503';
  end if;

  if v_s.status = 'CANCELLED' then
    return jsonb_build_object('settlement_id', v_s.id, 'code', v_s.code, 'status', v_s.status,
                              'already_cancelled', true);
  end if;
  if v_s.status = 'PAID' then
    raise exception 'LIQUIDACION_YA_PAGADA: la liquidación % ya se pagó y no se anula; un reverso posterior genera un contra-evento para la próxima', v_s.code
      using errcode = '23514';
  end if;

  -- La cabecera primero: su total queda fijo y sus eventos ya se pueden liberar.
  update platform.commission_settlements
     set status = 'CANCELLED',
         cancelled_at = now(),
         cancelled_by = auth.uid(),
         cancellation_reason = v_reason
   where id = v_s.id;

  with freed as (
    update platform.commission_events
       set settlement_id = null,
           status = case when status = 'ACCRUED' then 'ELIGIBLE'::platform.commission_status else status end,
           updated_at = now()
     where settlement_id = v_s.id
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_ids from freed;

  perform platform.log_audit(
    'COMMISSION_SETTLEMENT_CANCELLED', 'commission_settlement', v_s.id::text, null, null,
    jsonb_build_object('code', v_s.code, 'currency', v_s.currency, 'total', v_s.total_amount,
                       'previous_status', v_s.status, 'reason', v_reason,
                       'events', cardinality(v_ids), 'event_ids', to_jsonb(v_ids))
  );

  return jsonb_build_object('settlement_id', v_s.id, 'code', v_s.code, 'status', 'CANCELLED',
                            'events_released', cardinality(v_ids), 'already_cancelled', false);
end;
$$;

comment on function platform.cancel_commission_settlement(uuid, text) is
  'Anula una liquidación OPEN o APPROVED con motivo y devuelve sus eventos a ELEGIBLE para una '
  'próxima liquidación. Una PAID no se anula. Repetirla sobre una CANCELLED no hace nada.';

-- ---------------------------------------------------------------------------
-- 9. GRANTS
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
         'settle_commissions', 'approve_commission_settlement', 'pay_commission_settlement',
         'cancel_commission_settlement'
       )
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;

-- Funciones de trigger: no son API (H-2/H-3, grants mínimos).
revoke all on function platform.enforce_settlement_terminal() from public, anon, authenticated;
revoke all on function platform.enforce_settlement_event_state() from public, anon, authenticated;
revoke all on function platform.recalc_settlement_total() from public, anon, authenticated;
