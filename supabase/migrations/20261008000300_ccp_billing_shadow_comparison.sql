-- ============================================================================
-- EBIM Commercial Control Plane · Fase 18 · comparación BILLING_SHADOW (D-14)
-- ----------------------------------------------------------------------------
-- Spec §15.2: en BILLING_SHADOW "MasterAdmin genera lo que facturaría para los
-- mismos tenants y período; un reporte compara línea a línea contra el biller
-- local; nadie cobra desde MasterAdmin". Spec §19.1(8): diff = 0 para el
-- período certificado. D-14 regla 5 (DEV/LOCAL): eExpense y GMAO avanzan SOLO
-- a BILLING_SHADOW y el diff material debe ser 0; nunca MASTERADMIN_AUTHORITY.
--
-- Hasta aquí el "diff" lo decidía el SaaS: eExpense comparaba solo códigos de
-- ítems contra su copia local del snapshot (sin importes) y GMAO recibía un
-- entero externo. Esta migración pone el cálculo en MasterAdmin:
--
--   · billing_shadow_expected_lines(producto, tenant, período) — SOLO LECTURA.
--     Lo que MasterAdmin facturaría: la MISMA fuente única que emite
--     (subscription_due_items, con signo de DISCOUNT) + consumo vencido
--     (subscription_usage_lines). No inserta facturas ni reserva números.
--   · record_billing_shadow_comparison(producto, tenant, período, local, actor)
--     — compara línea a línea por itemCode (cantidad, importe al centavo,
--     moneda) y guarda el reporte canónico + sha256 en una tabla append-only.
--     Solo con el eje de facturación del producto en BILLING_SHADOW.
--
-- Claves de línea (itemCode):
--   add-on/ítem de catálogo  → código del catalog_item
--   licencia sin ítem        → 'plan:' || plans.code (plan de la suscripción)
--   otros cargos             → 'charge:' || charge_kind
--   consumo                  → 'usage:' || meter_code
-- Líneas con la misma clave se suman (cantidad e importe firmado).
--
-- Nada se inventa: sin suscripción ACTIVE/PAST_DUE del producto no hay
-- expectativa (SUSCRIPCION_NO_ENCONTRADA). Sin FX ni impuestos (D-13): una
-- moneda distinta es una diferencia material.
--
-- Rollback: docs/runbooks/ccp-rollback/18.sql (revocar EXECUTE; la tabla se
-- conserva como evidencia).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Reportes de comparación (append-only)
-- ---------------------------------------------------------------------------
create table platform.billing_shadow_comparisons (
  id               uuid primary key default gen_random_uuid(),
  saas_product_id  uuid not null references platform.saas_products (id) on delete restrict,
  tenant_id        uuid not null references platform.tenants (id) on delete restrict,
  subscription_id  uuid not null references platform.subscriptions (id) on delete restrict,
  period_start     date not null,
  source           text not null,
  expected         jsonb not null,
  local            jsonb not null,
  diffs            jsonb not null,
  mismatches       integer not null,
  report_checksum  text not null,
  actor            text not null,
  actor_user_id    uuid,
  created_at       timestamptz not null default now(),
  constraint billing_shadow_comparisons_period_ck check (period_start = date_trunc('month', period_start)::date),
  constraint billing_shadow_comparisons_mismatches_ck check (mismatches >= 0 and mismatches = jsonb_array_length(diffs)),
  constraint billing_shadow_comparisons_checksum_ck check (report_checksum ~ '^sha256:[0-9a-f]{64}$'),
  constraint billing_shadow_comparisons_actor_ck check (length(btrim(actor)) between 1 and 200),
  constraint billing_shadow_comparisons_source_ck check (length(btrim(source)) between 1 and 120)
);

comment on table platform.billing_shadow_comparisons is
  'BILLING_SHADOW (spec §15.2, D-14): reporte línea a línea MasterAdmin vs biller local por tenant y período. '
  'Append-only. Solo lo escribe record_billing_shadow_comparison.';

create index billing_shadow_comparisons_tenant_ix
  on platform.billing_shadow_comparisons (tenant_id, saas_product_id, period_start);
create index billing_shadow_comparisons_product_ix on platform.billing_shadow_comparisons (saas_product_id);
create index billing_shadow_comparisons_subscription_ix on platform.billing_shadow_comparisons (subscription_id);

create trigger billing_shadow_comparisons_append_only
  before update or delete on platform.billing_shadow_comparisons
  for each row execute function platform.entitlement_log_append_only();
create trigger billing_shadow_comparisons_no_truncate
  before truncate on platform.billing_shadow_comparisons
  for each statement execute function platform.entitlement_log_append_only();

alter table platform.billing_shadow_comparisons enable row level security;
alter table platform.billing_shadow_comparisons force row level security;
revoke all on platform.billing_shadow_comparisons from public, anon, authenticated, service_role;
grant select on platform.billing_shadow_comparisons to authenticated, service_role;

create policy billing_shadow_comparisons_select on platform.billing_shadow_comparisons
  for select to authenticated using ((select platform.can_read_finance()));

-- ---------------------------------------------------------------------------
-- 2. Lo que MasterAdmin facturaría (solo lectura)
-- ---------------------------------------------------------------------------
create or replace function platform.billing_shadow_expected_lines(
  p_saas_product_code text,
  p_tenant_id         uuid,
  p_period_start      date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_product uuid;
  v_sub     record;
  v_period  date := date_trunc('month', p_period_start)::date;
  v_lines   jsonb;
  v_usage   jsonb;
begin
  if not (platform.can_read_finance() or platform.is_service_request()) then
    raise exception 'NO_AUTORIZADO: la expectativa de facturación es de finanzas' using errcode = '42501';
  end if;
  if p_period_start is null then
    raise exception 'PERIODO_REQUERIDO' using errcode = '22023';
  end if;

  select id into v_product from platform.saas_products where code = p_saas_product_code;
  if v_product is null then
    raise exception 'PRODUCTO_NO_ENCONTRADO: %', p_saas_product_code using errcode = 'P0002';
  end if;

  -- La suscripción vigente del tenant para el producto; nada se infiere si no existe.
  select s.id, s.currency, p.code as plan_code into v_sub
    from platform.subscriptions s join platform.plans p on p.id = s.plan_id
   where s.saas_product_id = v_product and s.tenant_id = p_tenant_id
     and s.status in ('ACTIVE', 'PAST_DUE')
   order by s.created_at desc
   limit 1;
  if v_sub.id is null then
    raise exception 'SUSCRIPCION_NO_ENCONTRADA: el tenant no tiene una suscripción ACTIVE/PAST_DUE de %', p_saas_product_code
      using errcode = 'P0002';
  end if;

  -- Consumo vencido (vacío para DEMO/SANDBOX: no facturables).
  v_usage := platform.subscription_usage_lines(v_sub.id, v_period);

  select coalesce(jsonb_agg(jsonb_build_object(
           'itemCode', k.item_code, 'quantity', k.quantity, 'amount', k.amount, 'currency', k.currency)
           order by k.item_code), '[]'::jsonb)
    into v_lines
    from (
      select x.item_code, sum(x.quantity)::numeric(14,2) as quantity, sum(x.amount)::numeric(14,2) as amount,
             min(x.currency) as currency
        from (
          select case
                   when si.catalog_item_code is not null then si.catalog_item_code
                   when d.charge_kind in ('LICENSE', 'PARTNER_BASE_LICENSE', 'TENANT_LICENSE') then 'plan:' || v_sub.plan_code
                   else 'charge:' || d.charge_kind::text
                 end as item_code,
                 d.quantity,
                 platform.signed_line_amount(d.charge_kind, d.amount) as amount,
                 d.currency::text as currency
            from platform.subscription_due_items(v_sub.id, v_period) d
            join platform.subscription_items si on si.id = d.subscription_item_id
          union all
          select 'usage:' || (u ->> 'meter_code'),
                 (u ->> 'quantity')::numeric,
                 round((u ->> 'quantity')::numeric * (u ->> 'unit_amount')::numeric, 2),
                 v_sub.currency::text
            from jsonb_array_elements(v_usage) u
        ) x
       group by x.item_code
    ) k;

  return jsonb_build_object(
    'subscriptionId', v_sub.id,
    'periodStart', v_period,
    'currency', v_sub.currency,
    'lines', v_lines,
    'total', coalesce((select sum((l ->> 'amount')::numeric) from jsonb_array_elements(v_lines) l), 0)::numeric(14,2));
end;
$$;

comment on function platform.billing_shadow_expected_lines(text, uuid, date) is
  'BILLING_SHADOW: líneas que MasterAdmin facturaría al tenant en el mes (subscription_due_items con signo + consumo '
  'vencido). Solo lectura: no emite ni reserva números. Finanzas o service_role.';

revoke all on function platform.billing_shadow_expected_lines(text, uuid, date) from public, anon;
grant execute on function platform.billing_shadow_expected_lines(text, uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Comparación línea a línea y registro
-- ---------------------------------------------------------------------------
create or replace function platform.record_billing_shadow_comparison(
  p_saas_product_code text,
  p_tenant_id         uuid,
  p_period_start      date,
  p_local             jsonb,
  p_actor             text
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_product   uuid;
  v_expected  jsonb;
  v_local_cur text;
  v_diffs     jsonb;
  v_report    jsonb;
  v_checksum  text;
  v_id        uuid;
  v_local_tot numeric(14,2);
begin
  if not (platform.can_read_finance() or platform.is_service_request()) then
    raise exception 'NO_AUTORIZADO: la comparación de facturación es de finanzas' using errcode = '42501';
  end if;
  if coalesce(length(btrim(p_actor)), 0) = 0 then
    raise exception 'ACTOR_REQUERIDO' using errcode = '23514';
  end if;

  select id into v_product from platform.saas_products where code = p_saas_product_code;
  if v_product is null then
    raise exception 'PRODUCTO_NO_ENCONTRADO: %', p_saas_product_code using errcode = 'P0002';
  end if;
  if not exists (select 1 from platform.product_integrations i
                  where i.saas_product_id = v_product and i.cutover_state_billing = 'BILLING_SHADOW') then
    raise exception 'BILLING_NOT_IN_SHADOW: el eje de facturación de % no está en BILLING_SHADOW', p_saas_product_code
      using errcode = '55000';
  end if;

  -- Entrada local: {source?, currency, lines:[{itemCode, quantity, amount, currency?}]}; itemCode único.
  if jsonb_typeof(p_local) is distinct from 'object' or jsonb_typeof(p_local -> 'lines') is distinct from 'array'
     or coalesce(p_local ->> 'currency', '') !~ '^[A-Z]{3}$' then
    raise exception 'LOCAL_INVALIDO: se espera {currency, lines[]}' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_local -> 'lines') l
              where coalesce(l ->> 'itemCode', '') = '' or jsonb_typeof(l -> 'amount') is distinct from 'number'
                 or jsonb_typeof(l -> 'quantity') is distinct from 'number')
     or (select count(*) from jsonb_array_elements(p_local -> 'lines') l)
        <> (select count(distinct l ->> 'itemCode') from jsonb_array_elements(p_local -> 'lines') l) then
    raise exception 'LOCAL_INVALIDO: cada línea necesita itemCode único, quantity y amount numéricos' using errcode = '22023';
  end if;

  v_expected := platform.billing_shadow_expected_lines(p_saas_product_code, p_tenant_id, p_period_start);
  v_local_cur := p_local ->> 'currency';

  with e as (
    select l ->> 'itemCode' as item, (l ->> 'quantity')::numeric(14,2) as qty, (l ->> 'amount')::numeric(14,2) as amt
      from jsonb_array_elements(v_expected -> 'lines') l
  ), lo as (
    select l ->> 'itemCode' as item, (l ->> 'quantity')::numeric(14,2) as qty, (l ->> 'amount')::numeric(14,2) as amt,
           coalesce(l ->> 'currency', v_local_cur) as cur
      from jsonb_array_elements(p_local -> 'lines') l
  ), d as (
    select '*' as item, 'CURRENCY_MISMATCH' as type, to_jsonb(v_expected ->> 'currency') as ma, to_jsonb(v_local_cur) as local
     where v_local_cur is distinct from (v_expected ->> 'currency')
    union all
    select lo.item, 'CURRENCY_MISMATCH', to_jsonb(v_expected ->> 'currency'), to_jsonb(lo.cur)
      from lo where lo.cur is distinct from v_local_cur
    union all
    select coalesce(e.item, lo.item),
           case when e.item is null then 'ONLY_LOCAL'
                when lo.item is null then 'ONLY_MASTERADMIN'
                when e.qty <> lo.qty then 'QUANTITY_MISMATCH'
                else 'AMOUNT_MISMATCH' end,
           case when e.item is null then null else jsonb_build_object('quantity', e.qty, 'amount', e.amt) end,
           case when lo.item is null then null else jsonb_build_object('quantity', lo.qty, 'amount', lo.amt) end
      from e full join lo on lo.item = e.item
     where e.item is null or lo.item is null or e.qty <> lo.qty or e.amt <> lo.amt
  )
  select coalesce(jsonb_agg(jsonb_build_object('itemCode', d.item, 'type', d.type, 'masteradmin', d.ma, 'local', d.local)
                            order by d.item, d.type), '[]'::jsonb)
    into v_diffs
    from d;

  select coalesce(sum((l ->> 'amount')::numeric), 0)::numeric(14,2) into v_local_tot
    from jsonb_array_elements(p_local -> 'lines') l;

  -- Reporte canónico: líneas ordenadas por itemCode e importes normalizados a 2 decimales.
  v_report := jsonb_build_object(
    'product', p_saas_product_code,
    'tenantId', p_tenant_id,
    'periodStart', v_expected ->> 'periodStart',
    'expected', v_expected - 'subscriptionId',
    'local', jsonb_build_object(
      'currency', v_local_cur,
      'lines', coalesce((select jsonb_agg(jsonb_build_object(
                           'itemCode', l ->> 'itemCode', 'quantity', (l ->> 'quantity')::numeric(14,2),
                           'amount', (l ->> 'amount')::numeric(14,2),
                           'currency', coalesce(l ->> 'currency', v_local_cur)) order by l ->> 'itemCode')
                           from jsonb_array_elements(p_local -> 'lines') l), '[]'::jsonb),
      'total', v_local_tot),
    'diffs', v_diffs);
  v_checksum := 'sha256:' || encode(sha256(convert_to(v_report::text, 'UTF8')), 'hex');

  insert into platform.billing_shadow_comparisons
    (saas_product_id, tenant_id, subscription_id, period_start, source, expected, local, diffs, mismatches,
     report_checksum, actor, actor_user_id)
  values (v_product, p_tenant_id, (v_expected ->> 'subscriptionId')::uuid, (v_expected ->> 'periodStart')::date,
          left(coalesce(nullif(btrim(p_local ->> 'source'), ''), 'local'), 120),
          v_expected, v_report -> 'local', v_diffs, jsonb_array_length(v_diffs), v_checksum,
          left(btrim(p_actor), 200), auth.uid())
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'mismatches', jsonb_array_length(v_diffs),
    'green', jsonb_array_length(v_diffs) = 0,
    'reportChecksum', v_checksum,
    'expectedTotal', (v_expected ->> 'total')::numeric,
    'localTotal', v_local_tot,
    'periodStart', v_expected ->> 'periodStart',
    'diffs', v_diffs);
end;
$$;

comment on function platform.record_billing_shadow_comparison(text, uuid, date, jsonb, text) is
  'BILLING_SHADOW (spec §15.2, D-14): compara línea a línea el cálculo del biller local contra lo que MasterAdmin '
  'facturaría y registra el reporte (append-only) con sha256. Solo con el eje de facturación en BILLING_SHADOW. '
  'Nunca emite facturas ni cobra. Finanzas o service_role.';

revoke all on function platform.record_billing_shadow_comparison(text, uuid, date, jsonb, text) from public, anon;
grant execute on function platform.record_billing_shadow_comparison(text, uuid, date, jsonb, text) to authenticated, service_role;
