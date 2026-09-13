-- ============================================================================
-- EBIM Control Plane V3 — 27 · Hardening de la moneda transaccional
-- ----------------------------------------------------------------------------
-- Fase 06 de `.claude-prompts-v3-multicurrency`. Cierra G-09..G-15 (T-1..T-6).
--
-- LA REGLA: la moneda la fija el contrato y baja por la cadena sin cambiar.
--
--   subscriptions ──> subscription_items
--        │       ──> subscription_collection_profiles
--        │       ──> subscription_commercial_documents
--        └──────> invoices ──> invoice_lines
--                         └──> payments ──> commission_events
--
-- Cada hijo HEREDA la moneda de su padre si no la indica, y si la indica
-- distinta se RECHAZA (MONEDA_INCOHERENTE). No existe en V3 un pago en moneda
-- distinta a su factura: un flujo con tipo de cambio sería un diseño explícito
-- futuro, no un hueco que se cuela por un INSERT.
--
-- `cost_entries` NO entra en la cadena: un costo USD de infraestructura sobre
-- un producto que cobra PEN es legítimo. Lo que no es legítimo es sumarlos sin
-- conversión, y eso lo resuelven las vistas de reporte (fase 10).
--
-- HISTORIA: esta migración NO reescribe filas existentes. Los triggers actúan
-- sobre escrituras nuevas; las incoherencias previas, si las hubiera, quedan a
-- la vista en `v_currency_integrity_issues` para que Finanzas las resuelva.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Herencia y coherencia hijo -> padre
-- ---------------------------------------------------------------------------
create or replace function platform.enforce_currency_chain()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_parent_table text;
  v_parent_id    uuid;
  v_parent_cur   char(3);
  v_parent_label text;
begin
  case tg_table_name
    when 'subscription_items' then
      v_parent_table := 'suscripción';
      select s.currency, s.code into v_parent_cur, v_parent_label
        from platform.subscriptions s where s.id = new.subscription_id;
    when 'subscription_collection_profiles' then
      v_parent_table := 'suscripción';
      select s.currency, s.code into v_parent_cur, v_parent_label
        from platform.subscriptions s where s.id = new.subscription_id;
    when 'subscription_commercial_documents' then
      v_parent_table := 'suscripción';
      select s.currency, s.code into v_parent_cur, v_parent_label
        from platform.subscriptions s where s.id = new.subscription_id;
    when 'invoices' then
      -- Una factura suelta (sin suscripción) declara su moneda; no hay padre.
      if new.subscription_id is null then
        return new;
      end if;
      v_parent_table := 'suscripción';
      select s.currency, s.code into v_parent_cur, v_parent_label
        from platform.subscriptions s where s.id = new.subscription_id;
    when 'invoice_lines' then
      v_parent_table := 'factura';
      select i.currency, i.number into v_parent_cur, v_parent_label
        from platform.invoices i where i.id = new.invoice_id;
    when 'payments' then
      v_parent_table := 'factura';
      select i.currency, i.number into v_parent_cur, v_parent_label
        from platform.invoices i where i.id = new.invoice_id;
    when 'commission_events' then
      v_parent_table := 'cobro';
      select p.currency, p.reference into v_parent_cur, v_parent_label
        from platform.payments p where p.id = new.payment_id;
    else
      raise exception 'enforce_currency_chain: tabla % no soportada', tg_table_name;
  end case;

  -- Padre inexistente: la FK lo rechazará con su propio error.
  if v_parent_cur is null then
    return new;
  end if;

  if new.currency is null then
    new.currency := v_parent_cur;
    return new;
  end if;

  if new.currency <> v_parent_cur then
    raise exception 'MONEDA_INCOHERENTE: % en % no coincide con la moneda % de la % %',
      new.currency, tg_table_name, v_parent_cur, v_parent_table, v_parent_label
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function platform.enforce_currency_chain() is
  'Hereda la moneda del padre si el hijo no la indica y rechaza MONEDA_INCOHERENTE si difiere. '
  'Cadena: suscripción -> líneas/perfil/documentos/facturas; factura -> líneas/cobros; cobro -> comisiones.';

create trigger subscription_items_currency_chain
  before insert or update of currency, subscription_id on platform.subscription_items
  for each row execute function platform.enforce_currency_chain();

create trigger scp_currency_chain
  before insert or update of currency, subscription_id on platform.subscription_collection_profiles
  for each row execute function platform.enforce_currency_chain();

create trigger scd_currency_chain
  before insert or update of currency, subscription_id on platform.subscription_commercial_documents
  for each row execute function platform.enforce_currency_chain();

create trigger invoices_currency_chain
  before insert or update of currency, subscription_id on platform.invoices
  for each row execute function platform.enforce_currency_chain();

create trigger invoice_lines_currency_chain
  before insert or update of currency, invoice_id on platform.invoice_lines
  for each row execute function platform.enforce_currency_chain();

create trigger payments_currency_chain
  before insert or update of currency, invoice_id on platform.payments
  for each row execute function platform.enforce_currency_chain();

create trigger commission_events_currency_chain
  before insert or update of currency, payment_id on platform.commission_events
  for each row execute function platform.enforce_currency_chain();

-- ---------------------------------------------------------------------------
-- 2. Inmutabilidad de la moneda de un padre con historia (T-6)
--
-- Cambiar la moneda de un contrato con líneas o facturas es reescribir la
-- historia: PEN 5000 facturados pasarían a leerse como USD 5000.
-- ---------------------------------------------------------------------------
create or replace function platform.enforce_currency_immutability()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if new.currency is not distinct from old.currency then
    return new;
  end if;

  if tg_table_name = 'subscriptions' then
    if exists (select 1 from platform.subscription_items where subscription_id = old.id)
       or exists (select 1 from platform.invoices where subscription_id = old.id)
       or exists (select 1 from platform.subscription_collection_profiles where subscription_id = old.id)
       or exists (select 1 from platform.subscription_commercial_documents where subscription_id = old.id) then
      raise exception 'MONEDA_CONTRACTUAL_INMUTABLE: la suscripción % ya tiene líneas, facturas o documentos en %; crea un contrato nuevo en %',
        old.code, old.currency, new.currency
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'invoices' then
    if exists (select 1 from platform.invoice_lines where invoice_id = old.id)
       or exists (select 1 from platform.payments where invoice_id = old.id) then
      raise exception 'MONEDA_DOCUMENTO_INMUTABLE: la factura % ya tiene líneas o cobros en %',
        old.number, old.currency
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'payments' then
    if exists (select 1 from platform.commission_events where payment_id = old.id) then
      raise exception 'MONEDA_DOCUMENTO_INMUTABLE: el cobro % ya devengó comisiones en %',
        old.reference, old.currency
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger subscriptions_currency_immutable
  before update of currency on platform.subscriptions
  for each row execute function platform.enforce_currency_immutability();

create trigger invoices_currency_immutable
  before update of currency on platform.invoices
  for each row execute function platform.enforce_currency_immutability();

create trigger payments_currency_immutable
  before update of currency on platform.payments
  for each row execute function platform.enforce_currency_immutability();

-- ---------------------------------------------------------------------------
-- 3. Fuera los defaults de moneda de las columnas.
--
-- Un `default 'USD'` hace que un INSERT sin moneda (seed, service_role, una
-- Edge Function) no falle: nace en USD sin que nadie lo haya decidido. Sin
-- default, las tablas de la cadena heredan del padre por el trigger de arriba
-- y las raíces (suscripción, factura suelta, costo, regla, liquidación...)
-- exigen la moneda explícita: NOT NULL lo hace cumplir.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'platform'
       and c.column_name = 'currency'
       and c.column_default is not null
       -- La cuenta de cobro es CONFIGURACIÓN, no un documento: su país/moneda se
       -- rediseñan con el routing regional (fase 07, migración 28).
       and c.table_name <> 'payment_provider_accounts'
  loop
    execute format('alter table platform.%I alter column currency drop default', r.table_name);
  end loop;
end;
$$;

-- El país de una sociedad sale de su mercado o se declara (DV3-005): tampoco
-- tiene sentido un 'PE' implícito.
alter table platform.companies alter column country_code drop default;

-- ---------------------------------------------------------------------------
-- 4. Incoherencias históricas, a la vista (no se corrigen en silencio).
--    security_invoker: cada rol ve solo las filas que RLS le deja ver.
-- ---------------------------------------------------------------------------
create or replace view platform.v_currency_integrity_issues
with (security_invoker = true) as
select 'SUBSCRIPTION_ITEM'::text as issue_kind, si.id as record_id, si.currency as record_currency,
       'subscription'::text as parent_kind, s.id as parent_id, s.currency as parent_currency
  from platform.subscription_items si join platform.subscriptions s on s.id = si.subscription_id
 where si.currency <> s.currency
union all
select 'COLLECTION_PROFILE', p.id, p.currency, 'subscription', s.id, s.currency
  from platform.subscription_collection_profiles p join platform.subscriptions s on s.id = p.subscription_id
 where p.currency <> s.currency
union all
select 'COMMERCIAL_DOCUMENT', d.id, d.currency, 'subscription', s.id, s.currency
  from platform.subscription_commercial_documents d join platform.subscriptions s on s.id = d.subscription_id
 where d.currency <> s.currency
union all
select 'INVOICE', i.id, i.currency, 'subscription', s.id, s.currency
  from platform.invoices i join platform.subscriptions s on s.id = i.subscription_id
 where i.currency <> s.currency
union all
select 'INVOICE_LINE', l.id, l.currency, 'invoice', i.id, i.currency
  from platform.invoice_lines l join platform.invoices i on i.id = l.invoice_id
 where l.currency <> i.currency
union all
select 'PAYMENT', p.id, p.currency, 'invoice', i.id, i.currency
  from platform.payments p join platform.invoices i on i.id = p.invoice_id
 where p.currency <> i.currency
union all
select 'COMMISSION_EVENT', e.id, e.currency, 'payment', p.id, p.currency
  from platform.commission_events e join platform.payments p on p.id = e.payment_id
 where e.currency <> p.currency;

comment on view platform.v_currency_integrity_issues is
  'Filas cuya moneda difiere de la de su padre, anteriores a los guards V3. Se listan para '
  'corregirlas con criterio contable; la migración no las reescribe. Vacía = cadena íntegra.';

grant select on platform.v_currency_integrity_issues to authenticated, service_role;
revoke all on platform.v_currency_integrity_issues from anon, public;

-- ---------------------------------------------------------------------------
-- 5. upsert_catalog_item sin `p_currency default 'USD'`.
--
-- El precio de un addon y su moneda se deciden juntos: el catálogo no sabe en
-- qué país se venderá, así que no hay contexto del que heredar y un USD
-- implícito sería inventar. Se mantiene la posición del parámetro (default
-- NULL) para no romper llamadas por nombre, y se exige explícito.
-- ---------------------------------------------------------------------------
drop function if exists platform.upsert_catalog_item(text, text, uuid, text, text, boolean, numeric, character, text, uuid);

create or replace function platform.upsert_catalog_item(
  p_code            text,
  p_name            text,
  p_saas_product_id uuid default null,
  p_item_type       text default 'addon',
  p_scope           text default 'per-company',
  p_available       boolean default true,
  p_price_month     numeric default 0,
  p_currency        char(3) default null,
  p_description     text default null,
  p_id              uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id       uuid;
  v_is_new   boolean := p_id is null;
  v_currency char(3) := upper(nullif(trim(coalesce(p_currency, '')), ''));
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: solo EBIM_PRODUCT_ADMIN o el super admin administran el catálogo'
      using errcode = '42501';
  end if;

  if lower(trim(coalesce(p_code, ''))) !~ '^[a-z0-9]+(_[a-z0-9]+)*$' then
    raise exception 'CODIGO_INVALIDO: "%" debe ser snake_case en minúsculas (ej. extra_company)', p_code
      using errcode = '23514';
  end if;

  if p_scope not in ('org-wide', 'per-company') then
    raise exception 'SCOPE_INVALIDO: "%" debe ser org-wide o per-company (contrato §11.1)', p_scope
      using errcode = '23514';
  end if;

  if v_currency is null then
    raise exception 'MONEDA_REQUERIDA: el precio de un addon declara su moneda explícitamente'
      using errcode = '23502';
  end if;
  if not platform.is_currency_active(v_currency) then
    raise exception 'MONEDA_INACTIVA: % no existe o está inactiva en el catálogo', v_currency
      using errcode = '23514';
  end if;

  if v_is_new then
    insert into platform.catalog_items (
      code, name, description, saas_product_id, item_type, scope, available, price_month, currency
    ) values (
      lower(trim(p_code)), trim(p_name), p_description, p_saas_product_id,
      p_item_type, p_scope, p_available, coalesce(p_price_month, 0), v_currency
    )
    returning id into v_id;
  else
    update platform.catalog_items
       set name = trim(p_name), description = p_description, saas_product_id = p_saas_product_id,
           item_type = p_item_type, scope = p_scope, available = p_available,
           price_month = coalesce(p_price_month, 0), currency = v_currency
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'ADDON_NO_ENCONTRADO: %', p_id using errcode = '23503';
    end if;
  end if;

  perform platform.log_audit(
    case when v_is_new then 'CATALOG_ITEM_CREATED' else 'CATALOG_ITEM_UPDATED' end,
    'catalog_item', v_id::text, null, null,
    jsonb_build_object('code', p_code, 'scope', p_scope, 'available', p_available,
                       'price_month', p_price_month, 'currency', v_currency)
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. GRANTS
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'platform'
       and p.proname in ('enforce_currency_chain', 'enforce_currency_immutability', 'upsert_catalog_item')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;
