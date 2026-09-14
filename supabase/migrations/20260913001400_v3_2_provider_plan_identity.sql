-- ============================================================================
-- EBIM Control Plane V3.2 — 37 · Identidad del Plan del proveedor por importe
-- ----------------------------------------------------------------------------
-- CAUSA RAÍZ (P1-A). El Plan del proveedor se identificaba sin importe, en tres
-- sitios que se reforzaban entre sí:
--   · `provider_plans_uk unique (provider_account_id, plan_id, billing_interval,
--     currency)` (migración 19): la base no podía guardar el mismo plan local a
--     USD 1000 y a USD 1250 en la misma cuenta;
--   · `payment-setup` buscaba el Plan reutilizable con esas 4 columnas y le
--     pasaba su `external_plan_id` al adapter, que entonces NO crea otro: el
--     cliente B (1250) quedaba suscrito al Plan del cliente A (1000) y el PSP le
--     cobraba 1000;
--   · después hacía `upsert ... onConflict` sobre las mismas 4 columnas con
--     `amount = 1250`: la fila del Plan `P1` pasaba a decir 1250 aunque en el
--     PSP siguiera cobrando 1000.
-- Reproducido antes del fix: `docs/nightly-v3-2/evidence/phase1-*.txt`.
--
-- REGLA:
--   identidad = cuenta de cobro + plan local + intervalo + moneda + importe
--   · mismo contrato económico  → mismo Plan del proveedor (reutilizable);
--   · distinto importe          → distinto Plan del proveedor.
--   · Una fila de `provider_plans` describe un objeto EXTERNO: su identidad y
--     su `external_plan_id` no se reescriben nunca. Un precio nuevo es un Plan
--     nuevo en el PSP y una fila nueva aquí.
--
-- `amount` es `numeric(14,2)`, igual que `subscription_items.amount`: se compara
-- exacto, sin floats. La unicidad aplica a los Planes ACTIVE: un Plan retirado
-- (INACTIVE) no bloquea registrar su reemplazo.
--
-- Esta migración no toca ninguna migración anterior ni la facturación V3.1.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Unicidad por contrato económico
-- ---------------------------------------------------------------------------
-- Toda fila que cumplía la unicidad de 4 columnas cumple la de 5: el cambio no
-- puede fallar sobre datos existentes.
alter table platform.provider_plans drop constraint provider_plans_uk;

create unique index provider_plans_identity_uk
  on platform.provider_plans (provider_account_id, plan_id, billing_interval, currency, amount)
  where status = 'ACTIVE';

comment on index platform.provider_plans_identity_uk is
  'V3.2 · Un único Plan ACTIVE por contrato económico: cuenta + plan + intervalo + moneda + importe. '
  'Sirve también al lookup de find_reusable_provider_plan.';

-- Un Plan del proveedor es recurrente y cobra algo. NOT VALID: se exige a toda
-- fila nueva o modificada sin revalidar filas históricas de otros entornos.
alter table platform.provider_plans
  add constraint provider_plans_recurring_ck check (billing_interval <> 'ONE_TIME') not valid,
  add constraint provider_plans_amount_positive_ck check (amount > 0) not valid;

-- ---------------------------------------------------------------------------
-- 2 · Una fila describe un objeto externo: identidad inmutable
-- ---------------------------------------------------------------------------
create or replace function platform.guard_provider_plan_identity()
returns trigger
language plpgsql
set search_path = platform, pg_catalog
as $$
begin
  if (new.provider_account_id, new.plan_id, new.external_plan_id, new.amount, new.currency, new.billing_interval)
     is distinct from
     (old.provider_account_id, old.plan_id, old.external_plan_id, old.amount, old.currency, old.billing_interval)
  then
    raise exception 'PROVIDER_PLAN_INMUTABLE: el Plan externo % está registrado como % % % % y no se reescribe; un precio distinto es un Plan nuevo en el proveedor',
      old.external_plan_id, old.plan_id, old.billing_interval, old.currency, old.amount
      using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function platform.guard_provider_plan_identity() is
  'V3.2 · Impide cambiar cuenta, plan, intervalo, moneda, importe o external_plan_id de un Plan del '
  'proveedor ya registrado. Solo pueden cambiar status, metadata y synced_at.';

revoke all on function platform.guard_provider_plan_identity() from public, anon, authenticated;

create trigger provider_plans_guard_identity
  before update on platform.provider_plans
  for each row execute function platform.guard_provider_plan_identity();

-- ---------------------------------------------------------------------------
-- 3 · Lookup exacto del Plan reutilizable
-- ---------------------------------------------------------------------------
create or replace function platform.find_reusable_provider_plan(
  p_provider_account_id uuid,
  p_plan_id             uuid,
  p_billing_interval    platform.billing_interval,
  p_currency            char(3),
  p_amount              numeric
)
returns text
language plpgsql
stable
set search_path = platform, pg_catalog
as $$
declare
  v_external text;
begin
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'IMPORTE_NO_REPRESENTABLE: % no es un importe numeric(14,2) positivo', p_amount
      using errcode = '22023';
  end if;

  select pp.external_plan_id into v_external
    from platform.provider_plans pp
   where pp.provider_account_id = p_provider_account_id
     and pp.plan_id = p_plan_id
     and pp.billing_interval = p_billing_interval
     and pp.currency = p_currency
     and pp.amount = p_amount
     and pp.status = 'ACTIVE';

  return v_external;
end;
$$;

comment on function platform.find_reusable_provider_plan(uuid, uuid, platform.billing_interval, char, numeric) is
  'V3.2 · external_plan_id del Plan ACTIVE con exactamente esa cuenta, plan, intervalo, moneda e importe; '
  'NULL si no existe. Nunca devuelve un Plan de otro importe. Solo servidor.';

revoke all on function platform.find_reusable_provider_plan(uuid, uuid, platform.billing_interval, char, numeric)
  from public, anon, authenticated;
grant execute on function platform.find_reusable_provider_plan(uuid, uuid, platform.billing_interval, char, numeric)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4 · Registro del Plan tras hablar con el proveedor. Nunca sobrescribe.
-- ---------------------------------------------------------------------------
create or replace function platform.register_provider_plan(
  p_provider_account_id uuid,
  p_plan_id             uuid,
  p_billing_interval    platform.billing_interval,
  p_currency            char(3),
  p_amount              numeric,
  p_external_plan_id    text,
  p_metadata            jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_by_external record;
  v_canonical   record;
  v_id          uuid;
begin
  -- Un Plan del proveedor solo lo afirma el proceso que habló con el proveedor.
  if not platform.is_service_context() then
    raise exception 'NO_AUTORIZADO_SERVER_ONLY: el Plan del proveedor lo registra el servidor tras crearlo o reutilizarlo en la pasarela'
      using errcode = '42501';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'IMPORTE_NO_REPRESENTABLE: % no es un importe numeric(14,2) positivo', p_amount
      using errcode = '22023';
  end if;
  if p_billing_interval is null or p_billing_interval = 'ONE_TIME' then
    raise exception 'INTERVALO_NO_RECURRENTE: un Plan del proveedor es recurrente' using errcode = '22023';
  end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'MONEDA_INVALIDA: %', p_currency using errcode = '22023';
  end if;
  if coalesce(btrim(p_external_plan_id), '') = '' then
    raise exception 'PLAN_EXTERNO_REQUERIDO' using errcode = '22023';
  end if;

  -- Serializa altas concurrentes del mismo contrato económico. `round(…, 2)`
  -- para que 1250 y 1250.00 tomen el mismo lock.
  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws('|', 'provider_plan', p_provider_account_id, p_plan_id, p_billing_interval, p_currency,
              round(p_amount, 2)::text), 0));

  -- (a) ¿Ya conocemos este objeto externo? Entonces su identidad manda.
  select * into v_by_external
    from platform.provider_plans
   where provider_account_id = p_provider_account_id
     and external_plan_id = p_external_plan_id;

  if v_by_external.id is not null then
    if (v_by_external.plan_id, v_by_external.billing_interval, v_by_external.currency, v_by_external.amount)
       is distinct from (p_plan_id, p_billing_interval, p_currency, p_amount) then
      raise exception 'PROVIDER_PLAN_IDENTIDAD_DISTINTA: el Plan externo % está registrado como % % % y no representa % % %',
        p_external_plan_id, v_by_external.billing_interval, v_by_external.currency, v_by_external.amount,
        p_billing_interval, p_currency, p_amount
        using errcode = '23514';
    end if;

    update platform.provider_plans set synced_at = now() where id = v_by_external.id;
    return jsonb_build_object(
      'provider_plan_id', v_by_external.id, 'external_plan_id', p_external_plan_id,
      'registered', false, 'reused', true, 'canonical', v_by_external.status = 'ACTIVE');
  end if;

  -- (b) Objeto externo nuevo. Si ya hay un Plan ACTIVE para este contrato
  --     económico (dos altas simultáneas crearon dos Planes iguales), no se
  --     pisa: el nuevo se registra como INACTIVE, fiel a que existe en el PSP.
  select * into v_canonical
    from platform.provider_plans
   where provider_account_id = p_provider_account_id
     and plan_id = p_plan_id
     and billing_interval = p_billing_interval
     and currency = p_currency
     and amount = p_amount
     and status = 'ACTIVE';

  insert into platform.provider_plans (
    provider_account_id, plan_id, external_plan_id, amount, currency, billing_interval,
    status, metadata, synced_at
  ) values (
    p_provider_account_id, p_plan_id, p_external_plan_id, p_amount, p_currency, p_billing_interval,
    case when v_canonical.id is null then 'ACTIVE' else 'INACTIVE' end::platform.provider_mapping_status,
    coalesce(p_metadata, '{}'::jsonb)
      || case when v_canonical.id is null then '{}'::jsonb
              else jsonb_build_object('duplicate_of', v_canonical.external_plan_id) end,
    now()
  )
  returning id into v_id;

  perform platform.log_audit(
    'PROVIDER_PLAN_REGISTERED', 'provider_plan', v_id::text, null, null,
    jsonb_build_object(
      'external_plan_id', p_external_plan_id, 'plan_id', p_plan_id,
      'billing_interval', p_billing_interval, 'currency', p_currency, 'amount', p_amount,
      'canonical', v_canonical.id is null
    )
  );

  return jsonb_build_object(
    'provider_plan_id', v_id, 'external_plan_id', p_external_plan_id,
    'registered', true, 'reused', false, 'canonical', v_canonical.id is null,
    'canonical_external_plan_id', coalesce(v_canonical.external_plan_id, p_external_plan_id));
end;
$$;

comment on function platform.register_provider_plan(uuid, uuid, platform.billing_interval, char, numeric, text, jsonb) is
  'V3.2 · Registra el Plan del proveedor que payment-setup creó o reutilizó. Solo servidor. Nunca '
  'reasigna un external_plan_id a otra identidad ni sobrescribe el Plan ACTIVE de un contrato económico.';

revoke all on function platform.register_provider_plan(uuid, uuid, platform.billing_interval, char, numeric, text, jsonb)
  from public, anon, authenticated;
grant execute on function platform.register_provider_plan(uuid, uuid, platform.billing_interval, char, numeric, text, jsonb)
  to service_role;
