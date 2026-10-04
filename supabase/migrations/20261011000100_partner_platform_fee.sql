-- ============================================================================
-- MasterAdmin · M3 · Tarifa de plataforma de partners
-- ----------------------------------------------------------------------------
-- Spec §4. Cuando un partner factura él mismo al cliente final
-- (billing_responsibility = 'PARTNER'), EBIM no le factura al cliente: le
-- cobra al PARTNER una tarifa por usar la plataforma, configurable por acuerdo
-- (% sobre la base mensual, fijo por tenant activo, o ambos).
--
--   1. organization_product_agreements gana platform_fee_model/rate/
--      fixed_amount/currency (CHECKs) + set_agreement_platform_fee (finanzas o
--      super admin; NONE obligatorio si factura EBIM).
--   2. subscriptions.billing_channel (DIRECT | PARTNER_STATEMENT);
--      onboard_customer_subscription lo fija según el acuerdo del partner;
--      set_subscription_billing_channel lo corrige; issue_subscription_invoice
--      rechaza PARTNER_STATEMENT (SUSCRIPCION_FACTURADA_POR_PARTNER).
--   3. partner_fee_statements + partner_fee_statement_lines y las RPCs
--      compute / compute_all / issue / void, con vistas de lectura para
--      finanzas y para el PARTNER_ADMIN de su propia organización.
--   4. generate_commission_events: una línea PARTNER_PLATFORM_FEE solo
--      comisiona con una regla que la nombre (igual que USAGE_OVERAGE y
--      CREDIT_PURCHASE).
--
-- La factura al partner no tiene suscripción: el portal de pago (M1) la cobra
-- con la cuenta Culqi del país (resolve_invoice_card_account, spec §2.2).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Términos de la tarifa en el acuerdo
-- ---------------------------------------------------------------------------
alter table platform.organization_product_agreements
  add column platform_fee_model        text not null default 'NONE',
  add column platform_fee_rate         numeric(6,4),
  add column platform_fee_fixed_amount numeric(14,2),
  add column platform_fee_currency     char(3) references platform.currencies (code) on delete restrict;

alter table platform.organization_product_agreements
  add constraint opa_platform_fee_model_ck check (
    platform_fee_model in ('NONE', 'PERCENT_OF_LIST', 'FIXED_PER_TENANT', 'PERCENT_PLUS_FIXED')),
  add constraint opa_platform_fee_rate_ck check (
    platform_fee_rate is null or (platform_fee_rate > 0 and platform_fee_rate <= 1)),
  add constraint opa_platform_fee_fixed_ck check (
    platform_fee_fixed_amount is null or platform_fee_fixed_amount > 0),
  -- Cada modelo exige exactamente sus términos (y nada más).
  add constraint opa_platform_fee_terms_ck check (
    case platform_fee_model
      when 'NONE' then platform_fee_rate is null and platform_fee_fixed_amount is null and platform_fee_currency is null
      when 'PERCENT_OF_LIST' then platform_fee_rate is not null and platform_fee_fixed_amount is null
                                  and platform_fee_currency is null
      when 'FIXED_PER_TENANT' then platform_fee_rate is null and platform_fee_fixed_amount is not null
                                   and platform_fee_currency is not null
      when 'PERCENT_PLUS_FIXED' then platform_fee_rate is not null and platform_fee_fixed_amount is not null
                                     and platform_fee_currency is not null
      else false
    end),
  -- Si EBIM factura al cliente final, el partner no le debe una tarifa a EBIM.
  add constraint opa_platform_fee_responsibility_ck check (
    platform_fee_model = 'NONE' or billing_responsibility <> 'EBIM');

create index opa_platform_fee_currency_ix on platform.organization_product_agreements (platform_fee_currency)
  where platform_fee_currency is not null;

comment on column platform.organization_product_agreements.platform_fee_model is
  'Tarifa de plataforma que el partner paga a EBIM (spec §4.1): NONE, PERCENT_OF_LIST (% de la base mensual), '
  'FIXED_PER_TENANT (fijo por tenant activo) o PERCENT_PLUS_FIXED. Solo con billing_responsibility <> EBIM. '
  'Se cambia únicamente con set_agreement_platform_fee.';

-- authenticated tenía INSERT/UPDATE a nivel de TABLA en el acuerdo (la RLS
-- opa_write/opa_update limita las filas al admin de producto): eso le habría
-- dado también las columnas nuevas. Se pasa a GRANT por columna (C-06) con
-- exactamente las columnas previas: la tarifa solo cambia por la RPC (finanzas).
revoke insert, update on platform.organization_product_agreements from authenticated;
grant insert (id, organization_id, saas_product_id, can_resell, can_manage_tenants, margin_rate,
              default_deployment_mode, valid_from, valid_to, status, terms, created_at, updated_at,
              allowed_deployment_modes, allowed_tenant_types, billing_responsibility, max_tenants, notes)
  on platform.organization_product_agreements to authenticated;
grant update (id, organization_id, saas_product_id, can_resell, can_manage_tenants, margin_rate,
              default_deployment_mode, valid_from, valid_to, status, terms, created_at, updated_at,
              allowed_deployment_modes, allowed_tenant_types, billing_responsibility, max_tenants, notes)
  on platform.organization_product_agreements to authenticated;

create or replace function platform.set_agreement_platform_fee(
  p_agreement_id uuid,
  p_model        text,
  p_rate         numeric default null,
  p_fixed_amount numeric default null,
  p_currency     char(3) default null,
  p_reason       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_agreement platform.organization_product_agreements;
  v_rate      numeric(6,4);
  v_fixed     numeric(14,2);
  v_currency  char(3);
begin
  if not ((platform.can_read_finance() or platform.is_super_admin()) and auth.uid() is not null) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin fijan la tarifa de plataforma'
      using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO' using errcode = '23502';
  end if;
  if p_model is null or p_model not in ('NONE', 'PERCENT_OF_LIST', 'FIXED_PER_TENANT', 'PERCENT_PLUS_FIXED') then
    raise exception 'MODELO_TARIFA_INVALIDO: % (NONE, PERCENT_OF_LIST, FIXED_PER_TENANT o PERCENT_PLUS_FIXED)',
      coalesce(p_model, 'NULL') using errcode = '22023';
  end if;

  select * into v_agreement from platform.organization_product_agreements where id = p_agreement_id for update;
  if v_agreement.id is null then
    raise exception 'ACUERDO_NO_ENCONTRADO: %', p_agreement_id using errcode = 'P0002';
  end if;
  if p_model <> 'NONE' and v_agreement.billing_responsibility = 'EBIM' then
    raise exception 'TARIFA_PARTNER_REQUIERE_FACTURACION_PARTNER: el acuerdo lo factura EBIM al cliente final; '
                    'el partner no le debe una tarifa de plataforma'
      using errcode = '23514';
  end if;

  if p_model in ('PERCENT_OF_LIST', 'PERCENT_PLUS_FIXED') then
    if p_rate is null or p_rate <= 0 or p_rate > 1 then
      raise exception 'TARIFA_PORCENTAJE_INVALIDO: el porcentaje va de 0 (excluido) a 1' using errcode = '22023';
    end if;
    v_rate := p_rate;
  end if;
  if p_model in ('FIXED_PER_TENANT', 'PERCENT_PLUS_FIXED') then
    if p_fixed_amount is null or p_fixed_amount <= 0 then
      raise exception 'TARIFA_FIJA_INVALIDA: el fijo por tenant debe ser mayor que 0' using errcode = '22023';
    end if;
    if p_currency is null or not exists (select 1 from platform.currencies c where c.code = upper(p_currency)) then
      raise exception 'MONEDA_INVALIDA: % no es una moneda registrada', coalesce(p_currency, 'NULL') using errcode = '22023';
    end if;
    v_fixed := round(p_fixed_amount, 2);
    v_currency := upper(p_currency);
  end if;

  update platform.organization_product_agreements
     set platform_fee_model = p_model, platform_fee_rate = v_rate,
         platform_fee_fixed_amount = v_fixed, platform_fee_currency = v_currency
   where id = v_agreement.id;

  perform platform.log_audit('AGREEMENT_PLATFORM_FEE_SET', 'organization_product_agreement', v_agreement.id::text,
    v_agreement.organization_id, null,
    jsonb_build_object('model', p_model, 'rate', v_rate, 'fixed_amount', v_fixed, 'currency', v_currency,
                       'previous', jsonb_build_object('model', v_agreement.platform_fee_model,
                                                      'rate', v_agreement.platform_fee_rate,
                                                      'fixed_amount', v_agreement.platform_fee_fixed_amount,
                                                      'currency', v_agreement.platform_fee_currency),
                       'reason', trim(p_reason)));

  return jsonb_build_object('agreement_id', v_agreement.id, 'model', p_model, 'rate', v_rate,
                            'fixed_amount', v_fixed, 'currency', v_currency);
end;
$$;

comment on function platform.set_agreement_platform_fee(uuid, text, numeric, numeric, char, text) is
  'EBIM_FINANCE / super admin. Fija la tarifa de plataforma del acuerdo (spec §4.1). Rechaza un modelo '
  'distinto de NONE si el acuerdo lo factura EBIM (TARIFA_PARTNER_REQUIERE_FACTURACION_PARTNER). Auditado.';

revoke all on function platform.set_agreement_platform_fee(uuid, text, numeric, numeric, char, text) from public, anon;
grant execute on function platform.set_agreement_platform_fee(uuid, text, numeric, numeric, char, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Canal de facturación de la suscripción
-- ---------------------------------------------------------------------------
alter table platform.subscriptions
  add column billing_channel text not null default 'DIRECT';
alter table platform.subscriptions
  add constraint subscriptions_billing_channel_ck check (billing_channel in ('DIRECT', 'PARTNER_STATEMENT'));

comment on column platform.subscriptions.billing_channel is
  'DIRECT: EBIM factura al cliente (issue_subscription_invoice). PARTNER_STATEMENT: el partner factura al '
  'cliente final y EBIM le cobra al partner la tarifa de plataforma (spec §4.2).';

/** Canal que corresponde a un tenant: PARTNER_STATEMENT si su partner factura el producto. */
create or replace function platform.partner_billing_channel_for(p_tenant_id uuid, p_at date default current_date)
returns text
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select case when exists (
           select 1
             from platform.tenants t
             join platform.organization_product_agreements a
               on a.organization_id = t.managing_organization_id
              and a.saas_product_id = t.saas_product_id
            where t.id = p_tenant_id
              and a.status = 'ACTIVE'
              and a.billing_responsibility = 'PARTNER'
              and a.valid_from <= coalesce(p_at, current_date)
              and (a.valid_to is null or a.valid_to >= coalesce(p_at, current_date)))
         then 'PARTNER_STATEMENT' else 'DIRECT' end;
$$;
revoke all on function platform.partner_billing_channel_for(uuid, date) from public, anon, authenticated;

create or replace function platform.set_subscription_billing_channel(
  p_subscription_id uuid,
  p_channel         text,
  p_reason          text
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_sub    platform.subscriptions;
  v_tenant platform.tenants;
  v_resp   platform.billing_responsibility;
begin
  if not ((platform.can_read_finance() or platform.is_super_admin()) and auth.uid() is not null) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin cambian el canal de facturación'
      using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO' using errcode = '23502';
  end if;
  if p_channel is null or p_channel not in ('DIRECT', 'PARTNER_STATEMENT') then
    raise exception 'CANAL_INVALIDO: % (DIRECT o PARTNER_STATEMENT)', coalesce(p_channel, 'NULL') using errcode = '22023';
  end if;

  select * into v_sub from platform.subscriptions where id = p_subscription_id for update;
  if v_sub.id is null then
    raise exception 'SUSCRIPCION_NO_ENCONTRADA: %', p_subscription_id using errcode = '23503';
  end if;
  if v_sub.billing_channel = p_channel then
    return jsonb_build_object('subscription_id', v_sub.id, 'billing_channel', p_channel, 'duplicate', true);
  end if;

  if p_channel = 'PARTNER_STATEMENT' then
    select * into v_tenant from platform.tenants where id = v_sub.tenant_id;
    if v_tenant.managing_organization_id is null then
      raise exception 'SUSCRIPCION_SIN_PARTNER: el tenant de % no lo gestiona un partner', v_sub.code
        using errcode = '23514';
    end if;
    select a.billing_responsibility into v_resp
      from platform.organization_product_agreements a
     where a.organization_id = v_tenant.managing_organization_id
       and a.saas_product_id = v_sub.saas_product_id
       and a.status = 'ACTIVE';
    if v_resp is null or v_resp = 'EBIM' then
      raise exception 'PARTNER_NO_FACTURA: el acuerdo del partner con este producto lo factura EBIM'
        using errcode = '23514';
    end if;
  end if;

  update platform.subscriptions set billing_channel = p_channel where id = v_sub.id;

  perform platform.log_audit('SUBSCRIPTION_BILLING_CHANNEL_SET', 'subscription', v_sub.id::text,
    v_sub.billed_organization_id, v_sub.tenant_id,
    jsonb_build_object('code', v_sub.code, 'from', v_sub.billing_channel, 'to', p_channel, 'reason', trim(p_reason)));
  return jsonb_build_object('subscription_id', v_sub.id, 'billing_channel', p_channel, 'duplicate', false);
end;
$$;

comment on function platform.set_subscription_billing_channel(uuid, text, text) is
  'EBIM_FINANCE / super admin. Corrige el canal de facturación de un contrato (spec §4.2). '
  'PARTNER_STATEMENT exige un partner que facture el producto. Auditado.';

revoke all on function platform.set_subscription_billing_channel(uuid, text, text) from public, anon;
grant execute on function platform.set_subscription_billing_channel(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Funciones recreadas (copia EXACTA de su última definición + cambios «M3»)
-- ---------------------------------------------------------------------------

-- 3.1 onboard_customer_subscription — última definición: 20260913000300_v3_regional_pricing.
--     Cambio M3: billing_channel según el acuerdo del partner que gestiona el tenant.
create or replace function platform.onboard_customer_subscription(
  p_saas_product_code        text,
  p_customer_organization_id uuid,
  p_tenant_slug              text,
  p_tenant_name              text,
  p_admin_email              text,
  p_plan_id                  uuid,
  p_market_code              text,
  p_billing_interval         platform.billing_interval default 'MONTHLY',
  p_currency                 char(3) default null,
  p_tenant_type              platform.tenant_type default 'PRODUCTION',
  p_deployment_mode          platform.deployment_mode default 'SHARED',
  p_managing_organization_id uuid default null,
  p_company_id               uuid default null,
  p_started_on               date default current_date,
  p_quantity                 integer default 1,
  p_license_amount           numeric default null,
  p_implementation_fee       numeric default null,
  p_infrastructure_fee       numeric default null,
  p_support_fee              numeric default null,
  p_channel_margin_rate      numeric default null,
  p_sales_agent_id           uuid default null,
  p_commission_plan_id       uuid default null,
  p_attribution_pct          numeric default 1.0,
  p_attribution_source       platform.attribution_source default 'DIRECT',
  p_provisioning_mode        text default 'DRY_RUN',
  p_deployment_target_id     uuid default null,
  p_activate                 boolean default false,
  p_notes                    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_tenant_id       uuid;
  v_subscription_id uuid;
  v_attribution_id  uuid;
  v_provisioning_id uuid;
  v_product_id      uuid;
  v_plan            record;
  v_market          platform.markets;
  v_currency        char(3);
  v_started_on      date := coalesce(p_started_on, current_date);
  v_list_license    numeric(14,2);
  v_license_amount  numeric(14,2);
  v_is_demo         boolean := p_tenant_type = 'DEMO';
  v_recurring       boolean;
  v_needs_contract  boolean;
  v_items           jsonb := '[]'::jsonb;
  v_item_id         uuid;
  v_sub_interval    platform.billing_interval;
  -- M3 (spec §4.2)
  v_billing_channel text := 'DIRECT';
begin
  -- ---- Autorización ANTES de revelar nada del catálogo ------------------
  -- create_tenant y create_subscription vuelven a autorizar; esta línea evita
  -- que un usuario sin rol aprenda por el mensaje de error si una tarifa existe.
  if not (platform.can_manage_platform_entities() or platform.can_manage_commercial()) then
    raise exception 'NO_AUTORIZADO: el alta de clientes requiere un rol de plataforma o de finanzas de EBIM'
      using errcode = '42501';
  end if;

  -- ---- Validaciones previas ---------------------------------------------
  select id into v_product_id from platform.saas_products where code = p_saas_product_code;
  if v_product_id is null then
    raise exception 'PRODUCTO_NO_ENCONTRADO: no existe el SaaS con código "%"', p_saas_product_code
      using errcode = '23503';
  end if;

  select * into v_plan from platform.plans where id = p_plan_id;
  if v_plan is null then
    raise exception 'PLAN_NO_ENCONTRADO: %', p_plan_id using errcode = '23503';
  end if;
  if v_plan.saas_product_id <> v_product_id then
    raise exception 'PLAN_INCOMPATIBLE: el plan "%" no pertenece al producto %', v_plan.code, p_saas_product_code
      using errcode = '23514';
  end if;
  if v_plan.deployment_mode is not null and v_plan.deployment_mode <> p_deployment_mode then
    raise exception 'PLAN_MODO_INCOMPATIBLE: el plan "%" es para % y la venta es %',
      v_plan.code, v_plan.deployment_mode, p_deployment_mode
      using errcode = '23514';
  end if;

  if p_provisioning_mode not in ('DRY_RUN', 'LIVE') then
    raise exception 'MODO_INVALIDO: provisioning_mode debe ser DRY_RUN o LIVE' using errcode = '23514';
  end if;

  -- ---- Mercado, moneda y tarifa: se resuelven ANTES de crear nada --------
  v_market   := platform.require_active_market(p_market_code);
  v_currency := platform.resolve_market_currency(v_market.id, p_currency);

  v_recurring := not v_is_demo and p_billing_interval <> 'ONE_TIME';
  v_needs_contract := v_recurring
     or coalesce(p_implementation_fee, 0) > 0
     or coalesce(p_infrastructure_fee, 0) > 0
     or coalesce(p_support_fee, 0) > 0;

  if v_recurring then
    v_list_license := coalesce(
      platform.current_plan_price(p_plan_id, v_market.id, 'LICENSE', p_billing_interval, v_currency, v_started_on),
      platform.current_plan_price(p_plan_id, v_market.id, 'TENANT_LICENSE', p_billing_interval, v_currency, v_started_on)
    );
    if v_list_license is null then
      raise exception 'TARIFA_REGIONAL_NO_DEFINIDA: el plan "%" no tiene licencia % vigente en % para el mercado %',
        v_plan.code, p_billing_interval, v_currency, v_market.code
        using errcode = '23502';
    end if;
    v_license_amount := coalesce(p_license_amount, v_list_license);
    if v_license_amount <= 0 then
      raise exception 'TARIFA_NO_DEFINIDA: la licencia recurrente del plan "%" en % no puede ser 0',
        v_plan.code, v_market.code
        using errcode = '23502';
    end if;
  elsif v_needs_contract
        and not platform.plan_has_regional_price(p_plan_id, v_market.id, v_currency, v_started_on) then
    raise exception 'TARIFA_REGIONAL_NO_DEFINIDA: el plan "%" no tiene tarifas vigentes en % para el mercado %',
      v_plan.code, v_currency, v_market.code
      using errcode = '23502';
  end if;

  -- ---- 1) Tenant. Se REUTILIZA create_tenant().
  v_tenant_id := platform.create_tenant(
    p_saas_product_code,
    p_customer_organization_id,
    p_tenant_slug,
    p_tenant_name,
    p_admin_email,
    p_tenant_type,
    p_deployment_mode,
    p_managing_organization_id,
    p_company_id,
    jsonb_build_object('onboarded_at', now(), 'plan_code', v_plan.code, 'market', v_market.code)
  );

  -- ---- 2-4) Suscripción y líneas, todas en la moneda contractual.
  v_sub_interval := case when v_recurring then p_billing_interval else 'ONE_TIME' end;

  if v_needs_contract then
    v_subscription_id := platform.create_subscription(
      p_customer_organization_id,
      v_product_id,
      p_plan_id,
      v_sub_interval,
      v_market.code,
      v_currency,
      v_tenant_id,
      null,
      coalesce(p_quantity, 1),
      v_started_on,
      null,
      p_channel_margin_rate,
      'DRAFT',
      p_notes,
      jsonb_build_object('origin', 'onboarding', 'demo', v_is_demo,
                         'list_license_amount', v_list_license)
    );

    -- M3 (spec §4.2): si el partner que gestiona el tenant factura este producto
    -- al cliente final, EBIM no le factura al cliente: cobra al partner.
    v_billing_channel := platform.partner_billing_channel_for(v_tenant_id, current_date);
    if v_billing_channel = 'PARTNER_STATEMENT' then
      update platform.subscriptions set billing_channel = v_billing_channel where id = v_subscription_id;
    end if;

    if v_recurring then
      v_item_id := platform.upsert_subscription_item(
        v_subscription_id, 'LICENSE',
        'Licencia ' || v_plan.name,
        coalesce(p_quantity, 1), v_license_amount, p_billing_interval,
        v_currency, v_tenant_id, null, v_started_on, null
      );
      v_items := v_items || jsonb_build_object('charge_kind', 'LICENSE', 'id', v_item_id,
                                               'amount', v_license_amount, 'currency', v_currency);
    end if;

    if coalesce(p_implementation_fee, 0) > 0 then
      v_item_id := platform.upsert_subscription_item(
        v_subscription_id, 'IMPLEMENTATION_FEE',
        'Implementación y puesta en marcha',
        1, p_implementation_fee, 'ONE_TIME',
        v_currency, v_tenant_id, null, v_started_on, null
      );
      v_items := v_items || jsonb_build_object('charge_kind', 'IMPLEMENTATION_FEE', 'id', v_item_id,
                                               'amount', p_implementation_fee, 'currency', v_currency);
    end if;

    if coalesce(p_infrastructure_fee, 0) > 0 then
      if p_deployment_mode = 'SHARED' then
        raise exception 'INFRA_FEE_EN_SHARED: un fee de infraestructura dedicada no aplica a un tenant compartido'
          using errcode = '23514';
      end if;
      v_item_id := platform.upsert_subscription_item(
        v_subscription_id, 'INFRASTRUCTURE_FEE',
        'Infraestructura dedicada',
        1, p_infrastructure_fee,
        case when v_recurring then p_billing_interval else 'ONE_TIME' end,
        v_currency, v_tenant_id, null, v_started_on, null
      );
      v_items := v_items || jsonb_build_object('charge_kind', 'INFRASTRUCTURE_FEE', 'id', v_item_id,
                                               'amount', p_infrastructure_fee, 'currency', v_currency);
    end if;

    if coalesce(p_support_fee, 0) > 0 then
      v_item_id := platform.upsert_subscription_item(
        v_subscription_id, 'SUPPORT_FEE',
        'Soporte y SLA',
        1, p_support_fee,
        case when v_recurring then p_billing_interval else 'ONE_TIME' end,
        v_currency, v_tenant_id, null, v_started_on, null
      );
      v_items := v_items || jsonb_build_object('charge_kind', 'SUPPORT_FEE', 'id', v_item_id,
                                               'amount', p_support_fee, 'currency', v_currency);
    end if;

    if p_activate then
      perform platform.set_subscription_status(v_subscription_id, 'ACTIVE', 'Alta de cliente');
    end if;
  end if;

  -- ---- 5) Atribución comercial (opcional). NO crea tenant_membership.
  if p_sales_agent_id is not null then
    v_attribution_id := platform.create_sales_attribution(
      p_sales_agent_id,
      v_product_id,
      p_customer_organization_id,
      coalesce(p_attribution_pct, 1.0),
      v_tenant_id,
      v_subscription_id,
      p_managing_organization_id,
      p_attribution_source,
      p_commission_plan_id,
      v_started_on,
      null,
      'Atribución creada en el alta del cliente'
    );
  end if;

  -- ---- 6) Provisioning. DRY_RUN por defecto; LIVE lo rechaza la RPC salvo super admin.
  v_provisioning_id := platform.enqueue_provisioning_request(
    (case when p_deployment_mode = 'SHARED' then 'CREATE_TENANT_SPACE'
          else 'CREATE_DEDICATED_TARGET' end)::platform.provisioning_action,
    v_tenant_id,
    p_deployment_target_id,
    v_product_id,
    p_provisioning_mode,
    jsonb_build_object(
      'slug', p_tenant_slug,
      'deployment_mode', p_deployment_mode,
      'plan_code', v_plan.code,
      'origin', 'onboarding'
    ),
    null
  );

  perform platform.log_audit(
    'CUSTOMER_ONBOARDED', 'tenant', v_tenant_id::text,
    p_customer_organization_id, v_tenant_id,
    jsonb_build_object(
      'product', p_saas_product_code,
      'plan', v_plan.code,
      'market', v_market.code,
      'currency', v_currency,
      'list_license_amount', v_list_license,
      'license_amount', v_license_amount,
      'deployment_mode', p_deployment_mode,
      'tenant_type', p_tenant_type,
      'subscription_id', v_subscription_id,
      'recurring', v_recurring,
      'items', v_items,
      'attribution_id', v_attribution_id,
      'provisioning_id', v_provisioning_id,
      'provisioning_mode', p_provisioning_mode,
      'managing_organization_id', p_managing_organization_id,
      'billing_channel', case when v_subscription_id is not null then v_billing_channel end
    )
  );

  return jsonb_build_object(
    'tenant_id', v_tenant_id,
    'subscription_id', v_subscription_id,
    'attribution_id', v_attribution_id,
    'provisioning_request_id', v_provisioning_id,
    'market_code', v_market.code,
    'currency', v_currency,
    'recurring', v_recurring,
    'list_license_amount', v_list_license,
    'license_amount', v_license_amount,
    'items', v_items,
    'billing_channel', case when v_subscription_id is not null then v_billing_channel end
  );
end;
$$;

-- 3.2 issue_subscription_invoice — última definición: 20261008000200_ccp_issue_invoice_usage.
--     Cambio M3: rechaza PARTNER_STATEMENT (SUSCRIPCION_FACTURADA_POR_PARTNER).
create or replace function platform.issue_subscription_invoice(
  p_subscription_id uuid,
  p_period_start    date default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_sub          record;
  v_period_start date;
  v_period_end   date;
  v_existing     record;
  v_invoice_id   uuid;
  v_base_number  text;
  v_number       text;
  v_seq          integer := 1;
  v_due_count    integer;
  v_due_total    numeric(14,2);
  v_lines        integer := 0;
  v_due_days     integer;
  v_total        numeric(14,2);
  -- CCP fase 18
  v_usage        jsonb;
  v_usage_count  integer := 0;
  v_usage_total  numeric(14,2) := 0;
  v_usage_lines  integer := 0;
begin
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin emiten facturas'
      using errcode = '42501';
  end if;

  select s.*, m.code as market_code into v_sub
    from platform.subscriptions s left join platform.markets m on m.id = s.market_id
   where s.id = p_subscription_id;
  if v_sub.id is null then
    raise exception 'SUSCRIPCION_NO_ENCONTRADA: %', p_subscription_id using errcode = '23503';
  end if;
  if v_sub.status not in ('ACTIVE', 'PAST_DUE') then
    raise exception 'SUSCRIPCION_NO_FACTURABLE: la suscripción % está %; solo se factura un contrato activo',
      v_sub.code, v_sub.status
      using errcode = '23514';
  end if;
  -- M3 (spec §4.2): el partner factura al cliente final; EBIM le cobra al partner
  -- con el estado de cuenta de la tarifa de plataforma.
  if v_sub.billing_channel = 'PARTNER_STATEMENT' then
    raise exception 'SUSCRIPCION_FACTURADA_POR_PARTNER: la suscripción % la factura el partner al cliente final; '
                    'EBIM le cobra al partner la tarifa de plataforma',
      v_sub.code
      using errcode = '23514';
  end if;

  v_period_start := date_trunc('month', coalesce(p_period_start, current_date))::date;
  v_period_end   := (v_period_start + interval '1 month' - interval '1 day')::date;

  -- Dos emisiones concurrentes del mismo (suscripción, periodo) se serializan:
  -- la segunda ve la factura de la primera y la devuelve.
  perform pg_advisory_xact_lock(
    hashtextextended('platform.issue_subscription_invoice:' || p_subscription_id::text || ':' || v_period_start::text, 0));

  select i.id, i.number, i.status, i.total, i.currency into v_existing
    from platform.invoices i
   where i.subscription_id = p_subscription_id
     and i.period_start = v_period_start
     and i.status <> 'VOID'
   order by i.created_at
   limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('invoice_id', v_existing.id, 'number', v_existing.number, 'created', false,
                              'currency', v_existing.currency, 'total', v_existing.total, 'status', v_existing.status,
                              'period_start', v_period_start, 'period_end', v_period_end);
  end if;

  -- Billing cadence ANTES de insertar: sin cargos debidos no nace ninguna factura.
  -- CCP P-01: el total debido es FIRMADO (DISCOUNT resta), igual que la factura.
  select count(*), coalesce(sum(platform.signed_line_amount(d.charge_kind, d.amount)), 0)
    into v_due_count, v_due_total
    from platform.subscription_due_items(v_sub.id, v_period_start) d;

  -- CCP fase 18: consumo vencido (agregados FINALIZED y exceso de créditos IA).
  v_usage := platform.subscription_usage_lines(v_sub.id, v_period_start);
  select count(*), coalesce(sum(round((u ->> 'quantity')::numeric * (u ->> 'unit_amount')::numeric, 2)), 0)
    into v_usage_count, v_usage_total
    from jsonb_array_elements(v_usage) u;

  if v_due_count + v_usage_count = 0 then
    raise exception 'SIN_LINEAS_FACTURABLES: la suscripción % no tiene cargos facturables en el periodo %',
      v_sub.code, to_char(v_period_start, 'MM/YYYY')
      using errcode = '23514';
  end if;
  if v_due_total + v_usage_total <= 0 then
    raise exception 'SIN_IMPORTE_FACTURABLE: los cargos de la suscripción % en el periodo % suman %; no se emite una factura en cero',
      v_sub.code, to_char(v_period_start, 'MM/YYYY'), v_due_total + v_usage_total
      using errcode = '23514';
  end if;

  select coalesce(p.payment_due_days, 15) into v_due_days
    from platform.v_subscription_collection p where p.subscription_id = p_subscription_id;

  -- Una anulada conserva su número: la re-emisión del periodo lleva sufijo -R2, -R3…
  v_base_number := 'INV-' || to_char(v_period_start, 'YYYYMM') || '-' || v_sub.code;
  v_number := v_base_number;
  while exists (select 1 from platform.invoices where number = v_number) loop
    v_seq := v_seq + 1;
    v_number := v_base_number || '-R' || v_seq;
  end loop;

  -- Sin `currency`: la hereda del contrato (guard de moneda transaccional).
  insert into platform.invoices (
    number, customer_organization_id, subscription_id, status, issue_date, due_date,
    period_start, period_end, notes, metadata
  ) values (
    v_number, v_sub.billed_organization_id, v_sub.id, 'ISSUED', current_date,
    current_date + coalesce(v_due_days, 15), v_period_start, v_period_end,
    'Factura gerencial del periodo emitida desde la consola',
    jsonb_build_object('origin', 'console', 'market', v_sub.market_code, 'billing_cadence', 'v3.1')
      || case when v_usage_count > 0 then jsonb_build_object('usage_lines', v_usage_count) else '{}'::jsonb end
  )
  returning id into v_invoice_id;

  -- CCP fase 18: cada línea conserva el ítem de catálogo y la tarifa que fijaron su importe;
  -- un correctivo se emite NEGATIVO y apunta a la línea que corrige (spec §13.2).
  insert into platform.invoice_lines (
    invoice_id, charge_kind, description, saas_product_id, tenant_id, subscription_item_id,
    quantity, unit_amount, is_recurring, catalog_item_id, price_ref, corrects_line_id, ai_credit_entry_id
  )
  select v_invoice_id, d.charge_kind, d.description, v_sub.saas_product_id,
         coalesce(d.tenant_id, v_sub.tenant_id), d.subscription_item_id, d.quantity,
         case when si.corrects_line_id is not null then -abs(d.unit_amount) else d.unit_amount end,
         d.billing_interval <> 'ONE_TIME', ci.id, si.price_ref, si.corrects_line_id, si.ai_credit_entry_id
    from platform.subscription_due_items(v_sub.id, v_period_start) d
    join platform.subscription_items si on si.id = d.subscription_item_id
    left join platform.catalog_items ci on ci.code = si.catalog_item_code;
  get diagnostics v_lines = row_count;

  insert into platform.invoice_lines (
    invoice_id, charge_kind, description, saas_product_id, tenant_id, quantity, unit_amount, is_recurring,
    usage_aggregate_id, meter_code, catalog_item_id, price_ref, usage_basis, ai_credit_pool_key,
    usage_period_start, usage_source_hash
  )
  select v_invoice_id, 'USAGE_OVERAGE', u.description, v_sub.saas_product_id, u.tenant_id, u.quantity, u.unit_amount, false,
         u.usage_aggregate_id, u.meter_code, u.catalog_item_id, u.price_ref, u.usage_basis, u.ai_credit_pool_key,
         u.usage_period_start, u.usage_source_hash
    from jsonb_to_recordset(v_usage) as u(
           description text, tenant_id uuid, quantity numeric, unit_amount numeric, usage_aggregate_id uuid,
           meter_code text, catalog_item_id uuid, price_ref uuid, usage_basis text, ai_credit_pool_key text,
           usage_period_start date, usage_source_hash text);
  get diagnostics v_usage_lines = row_count;
  v_lines := v_lines + v_usage_lines;

  select total into v_total from platform.invoices where id = v_invoice_id;

  perform platform.log_audit(
    'INVOICE_ISSUED', 'invoice', v_invoice_id::text, v_sub.billed_organization_id, v_sub.tenant_id,
    jsonb_build_object('number', v_number, 'subscription', v_sub.code, 'currency', v_sub.currency,
                       'total', v_total, 'lines', v_lines, 'period_start', v_period_start)
      || case when v_usage_lines > 0 then jsonb_build_object('usage_lines', v_usage_lines) else '{}'::jsonb end
  );

  return jsonb_build_object('invoice_id', v_invoice_id, 'number', v_number, 'created', true,
                            'currency', v_sub.currency, 'total', v_total, 'status', 'ISSUED',
                            'period_start', v_period_start, 'period_end', v_period_end, 'lines', v_lines);
end;
$$;


-- 3.3 generate_commission_events — última definición: 20261008000100_ccp_invoice_lines_usage.
--     Cambio M3: PARTNER_PLATFORM_FEE solo comisiona con una regla que lo nombre.
create or replace function platform.generate_commission_events(p_payment_id uuid)
returns integer
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_payment      record;
  v_invoice      record;
  v_line         record;
  v_attr         record;
  v_rule         record;
  v_paid_ratio   numeric(12,8);
  v_base         numeric(14,2);
  v_amount       numeric(14,2);
  v_accrued      numeric(14,2);
  v_months       integer;
  v_prior_events integer;
  v_created      integer := 0;
begin
  select * into v_payment from platform.payments where id = p_payment_id;
  if v_payment is null then
    raise exception 'PAGO_NO_ENCONTRADO: %', p_payment_id using errcode = '23503';
  end if;

  if v_payment.status <> 'CONFIRMED' then
    return 0;
  end if;

  select * into v_invoice from platform.invoices where id = v_payment.invoice_id;
  if v_invoice.status in ('DRAFT', 'VOID') then
    return 0;
  end if;
  if coalesce(v_invoice.total, 0) <= 0 then
    return 0;
  end if;

  v_paid_ratio := least(v_payment.amount / v_invoice.total, 1.0);

  for v_line in
    select l.* from platform.invoice_lines l
     where l.invoice_id = v_invoice.id and l.amount > 0
       -- CCP P-01: un DISCOUNT no es base de comisión (ni suma ni resta; D-11 abierto).
       and l.charge_kind <> 'DISCOUNT'
  loop
    for v_attr in
      select a.*
        from platform.sales_attributions a
       where a.status = 'ACTIVE'
         and a.commission_plan_id is not null
         and a.saas_product_id = coalesce(v_line.saas_product_id, a.saas_product_id)
         and (
           (v_line.tenant_id is not null and a.tenant_id = v_line.tenant_id)
           or (v_invoice.subscription_id is not null and a.subscription_id = v_invoice.subscription_id)
           or (v_line.tenant_id is not null and a.subscription_id is not null and exists (
                 select 1 from platform.subscriptions s
                  where s.id = a.subscription_id and s.tenant_id = v_line.tenant_id))
         )
         and a.valid_from <= coalesce(v_payment.paid_at::date, current_date)
         and (a.valid_to is null or a.valid_to >= coalesce(v_payment.paid_at::date, current_date))
    loop
      for v_rule in
        select r.*
          from platform.commission_rules r
         where r.commission_plan_id = v_attr.commission_plan_id
           and r.status = 'ACTIVE'
           and r.valid_from <= coalesce(v_payment.paid_at::date, current_date)
           and (r.valid_to is null or r.valid_to >= coalesce(v_payment.paid_at::date, current_date))
           and (
             (r.basis = 'COLLECTED_LICENSE' and v_line.charge_kind in
                ('LICENSE', 'TENANT_LICENSE', 'PARTNER_BASE_LICENSE'))
             or (r.basis = 'COLLECTED_IMPLEMENTATION' and v_line.charge_kind = 'IMPLEMENTATION_FEE')
             or (r.basis = 'COLLECTED_ANY')
             or (r.basis = 'FIXED_AMOUNT')
           )
           and (r.charge_kind is null or r.charge_kind = v_line.charge_kind)
           -- CCP fase 18 (spec §13.1, D-11): uso y compra de créditos solo comisionan con una
           -- regla que los nombre explícitamente; COLLECTED_ANY/FIXED_AMOUNT genéricos no los incluyen.
           -- M3 (spec §1.2): la tarifa de plataforma del partner, igual.
           and (v_line.charge_kind not in ('USAGE_OVERAGE', 'CREDIT_PURCHASE', 'PARTNER_PLATFORM_FEE')
                or r.charge_kind = v_line.charge_kind)
         order by r.priority, r.created_at
      loop
        -- V3: un importe fijo o un tope solo tienen sentido en la moneda de la regla.
        if (v_rule.basis = 'FIXED_AMOUNT' or v_rule.max_total_amount is not null)
           and v_rule.currency <> v_line.currency then
          continue;
        end if;

        select count(*) into v_prior_events
          from platform.commission_events e
         where e.sales_attribution_id = v_attr.id
           and e.commission_rule_id = v_rule.id
           and e.status <> 'VOID';

        if not v_rule.is_recurring and v_prior_events > 0 then
          continue;
        end if;

        if v_rule.max_months is not null then
          v_months := (extract(year from age(coalesce(v_payment.paid_at::date, current_date), v_attr.valid_from)) * 12
                     + extract(month from age(coalesce(v_payment.paid_at::date, current_date), v_attr.valid_from)))::integer;
          if v_months >= v_rule.max_months then
            continue;
          end if;
        end if;

        -- Base = porción COBRADA de la línea, en la moneda ORIGINAL del cobro.
        v_base := round(v_line.amount * v_paid_ratio, 2);

        if v_rule.basis = 'FIXED_AMOUNT' then
          v_amount := round(v_rule.fixed_amount * v_attr.attribution_pct, 2);
        else
          v_amount := round(v_base * v_rule.rate * v_attr.attribution_pct, 2);
        end if;

        if v_amount <= 0 then
          continue;
        end if;

        if v_rule.max_total_amount is not null then
          select coalesce(sum(e.amount), 0) into v_accrued
            from platform.commission_events e
           where e.sales_attribution_id = v_attr.id
             and e.commission_rule_id = v_rule.id
             and e.currency = v_rule.currency
             and e.status <> 'VOID';

          if v_accrued >= v_rule.max_total_amount then
            continue;
          end if;
          v_amount := least(v_amount, v_rule.max_total_amount - v_accrued);
        end if;

        insert into platform.commission_events (
          sales_agent_id, sales_attribution_id, commission_rule_id, payment_id,
          invoice_line_id, saas_product_id, tenant_id, status,
          base_amount, applied_rate, attribution_pct, amount, currency, earned_on, calculation
        )
        values (
          v_attr.sales_agent_id, v_attr.id, v_rule.id, v_payment.id,
          v_line.id, v_attr.saas_product_id, coalesce(v_line.tenant_id, v_attr.tenant_id), 'ELIGIBLE',
          v_base, v_rule.rate, v_attr.attribution_pct, v_amount, v_line.currency,
          coalesce(v_payment.paid_at::date, current_date),
          jsonb_build_object(
            'rule_name', v_rule.name,
            'basis', v_rule.basis,
            'charge_kind', v_line.charge_kind,
            'rate', v_rule.rate,
            'fixed_amount', v_rule.fixed_amount,
            'rule_currency', v_rule.currency,
            'payment_currency', v_line.currency,
            'invoice_line_amount', v_line.amount,
            'payment_ratio', round(v_paid_ratio, 6),
            'base_amount', v_base,
            'attribution_pct', v_attr.attribution_pct,
            'max_months', v_rule.max_months,
            'max_total_amount', v_rule.max_total_amount,
            'formula', case when v_rule.basis = 'FIXED_AMOUNT'
                            then 'fixed_amount * attribution_pct'
                            else 'invoice_line_amount * payment_ratio * rate * attribution_pct' end
          )
        )
        on conflict do nothing;

        if found then
          v_created := v_created + 1;
        end if;
      end loop;
    end loop;
  end loop;

  return v_created;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Estado de cuenta mensual del partner
-- ---------------------------------------------------------------------------
create table platform.partner_fee_statements (
  id                      uuid primary key default gen_random_uuid(),
  partner_organization_id uuid not null references platform.organizations (id) on delete restrict,
  period_start            date not null,
  period_end              date not null,
  currency                char(3) not null references platform.currencies (code) on delete restrict,
  status                  text not null default 'DRAFT',
  tenant_count            integer not null default 0,
  line_count              integer not null default 0,
  base_total              numeric(14,2) not null default 0,
  fee_total               numeric(14,2) not null default 0,
  invoice_id              uuid references platform.invoices (id) on delete restrict,
  source_hash             text not null,
  computed_at             timestamptz not null default now(),
  computed_by             uuid references platform.profiles (id) on delete set null,
  issued_at               timestamptz,
  issued_by               uuid references platform.profiles (id) on delete set null,
  voided_at               timestamptz,
  voided_by               uuid references platform.profiles (id) on delete set null,
  void_reason             text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint pfs_status_ck check (status in ('DRAFT', 'ISSUED', 'VOID')),
  constraint pfs_period_ck check (
    period_start = date_trunc('month', period_start)::date
    and period_end = (period_start + interval '1 month' - interval '1 day')::date),
  constraint pfs_amounts_ck check (base_total >= 0 and fee_total >= 0 and tenant_count >= 0 and line_count >= 0),
  constraint pfs_hash_ck check (source_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint pfs_issued_ck check (status <> 'ISSUED' or (invoice_id is not null and issued_at is not null)),
  constraint pfs_void_ck check ((status = 'VOID') = (voided_at is not null)
                                and (status <> 'VOID' or length(trim(coalesce(void_reason, ''))) > 0))
);

comment on table platform.partner_fee_statements is
  'Estado de cuenta mensual de la tarifa de plataforma de un partner (spec §4.3), uno por partner × período × '
  'moneda mientras no esté VOID. DRAFT se recalcula; ISSUED tiene su factura al partner; VOID la anula.';

create unique index pfs_active_uk on platform.partner_fee_statements (partner_organization_id, period_start, currency)
  where status <> 'VOID';
create index pfs_period_ix on platform.partner_fee_statements (period_start, status);
create index pfs_invoice_ix on platform.partner_fee_statements (invoice_id) where invoice_id is not null;
create index pfs_currency_ix on platform.partner_fee_statements (currency);
create index pfs_computed_by_ix on platform.partner_fee_statements (computed_by) where computed_by is not null;
create index pfs_issued_by_ix on platform.partner_fee_statements (issued_by) where issued_by is not null;
create index pfs_voided_by_ix on platform.partner_fee_statements (voided_by) where voided_by is not null;

create trigger partner_fee_statements_set_updated_at before update on platform.partner_fee_statements
  for each row execute function platform.set_updated_at();

create table platform.partner_fee_statement_lines (
  id               uuid primary key default gen_random_uuid(),
  statement_id     uuid not null references platform.partner_fee_statements (id) on delete cascade,
  agreement_id     uuid not null references platform.organization_product_agreements (id) on delete restrict,
  saas_product_id  uuid not null references platform.saas_products (id) on delete restrict,
  tenant_id        uuid not null references platform.tenants (id) on delete restrict,
  subscription_id  uuid references platform.subscriptions (id) on delete set null,
  line_kind        text not null,
  currency         char(3) not null references platform.currencies (code) on delete restrict,
  base_list_amount numeric(14,2) not null default 0,
  fee_rate         numeric(6,4),
  fee_fixed_amount numeric(14,2),
  fee_amount       numeric(14,2) not null,
  basis            jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),

  constraint pfsl_kind_ck check (line_kind in ('TENANT', 'FIXED_SEPARATE')),
  constraint pfsl_amounts_ck check (base_list_amount >= 0 and fee_amount >= 0
                                    and (fee_fixed_amount is null or fee_fixed_amount >= 0)),
  constraint pfsl_separate_ck check (line_kind <> 'FIXED_SEPARATE'
                                     or (fee_rate is null and fee_fixed_amount is not null and base_list_amount = 0))
);

comment on table platform.partner_fee_statement_lines is
  'Detalle por tenant × producto del estado de cuenta del partner. TENANT: base mensualizada en la moneda de la '
  'suscripción, % y (si coincide la moneda) el fijo. FIXED_SEPARATE: el fijo por tenant en platform_fee_currency '
  'cuando difiere de la moneda de la suscripción.';

create index pfsl_statement_ix on platform.partner_fee_statement_lines (statement_id);
create index pfsl_agreement_ix on platform.partner_fee_statement_lines (agreement_id);
create index pfsl_product_ix on platform.partner_fee_statement_lines (saas_product_id);
create index pfsl_tenant_ix on platform.partner_fee_statement_lines (tenant_id);
create index pfsl_subscription_ix on platform.partner_fee_statement_lines (subscription_id) where subscription_id is not null;
create index pfsl_currency_ix on platform.partner_fee_statement_lines (currency);

alter table platform.partner_fee_statements enable row level security;
alter table platform.partner_fee_statements force row level security;
alter table platform.partner_fee_statement_lines enable row level security;
alter table platform.partner_fee_statement_lines force row level security;

revoke all on platform.partner_fee_statements from public, anon, authenticated;
revoke all on platform.partner_fee_statement_lines from public, anon, authenticated;
grant select on platform.partner_fee_statements to authenticated;
grant select on platform.partner_fee_statement_lines to authenticated;
grant all on platform.partner_fee_statements to service_role;
grant all on platform.partner_fee_statement_lines to service_role;

-- Finanzas ve todo; el admin del partner ve SOLO los de su organización.
create policy pfs_select on platform.partner_fee_statements
  for select to authenticated
  using (platform.can_read_finance() or platform.is_super_admin() or platform.is_org_admin(partner_organization_id));

create policy pfsl_select on platform.partner_fee_statement_lines
  for select to authenticated
  using (exists (select 1 from platform.partner_fee_statements s where s.id = statement_id));

-- ---------------------------------------------------------------------------
-- 4.1 Cálculo
-- ---------------------------------------------------------------------------

/**
 * Líneas de la tarifa de un partner en un período (sin escribir nada).
 *
 * Base por tenant (spec §4.3): tenants ACTIVE de tipo PRODUCTION/TRIAL que
 * gestiona el partner, del producto con acuerdo ACTIVE vigente en el período,
 * modelo ≠ NONE y facturación del partner; suscripciones ACTIVE en el período;
 * ítems recurrentes vigentes LICENSE/TENANT_LICENSE/ADDON mensualizados
 * (QUARTERLY/3, YEARLY/12; ONE_TIME fuera). Uso y créditos fuera (D-01/D-02).
 * fee = round(base × rate, 2) + fijo. Una línea por tenant y moneda de la
 * suscripción; el fijo en otra moneda va en una línea FIXED_SEPARATE.
 */
create or replace function platform.partner_fee_lines(p_partner_id uuid, p_period_start date)
returns table (
  agreement_id     uuid,
  saas_product_id  uuid,
  tenant_id        uuid,
  subscription_id  uuid,
  line_kind        text,
  currency         char(3),
  base_list_amount numeric,
  fee_rate         numeric,
  fee_fixed_amount numeric,
  fee_amount       numeric,
  basis            jsonb
)
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  with period as (
    select date_trunc('month', p_period_start)::date as ps,
           (date_trunc('month', p_period_start) + interval '1 month' - interval '1 day')::date as pe
  ),
  agreements as (
    select a.* from platform.organization_product_agreements a, period
     where a.organization_id = p_partner_id
       and a.status = 'ACTIVE'
       and a.platform_fee_model <> 'NONE'
       and a.billing_responsibility <> 'EBIM'
       and a.valid_from <= period.pe
       and (a.valid_to is null or a.valid_to >= period.ps)
  ),
  tenants as (
    select t.id, t.slug, t.saas_product_id, ag.id as agreement_id, ag.platform_fee_model as model,
           ag.platform_fee_rate as rate, ag.platform_fee_fixed_amount as fixed, ag.platform_fee_currency as fixed_currency
      from platform.tenants t
      join agreements ag on ag.saas_product_id = t.saas_product_id
     where t.managing_organization_id = p_partner_id
       and t.status = 'ACTIVE'
       and t.tenant_type in ('PRODUCTION', 'TRIAL')
  ),
  subs as (
    select s.id, s.code, s.tenant_id, s.currency
      from platform.subscriptions s, period
     where s.status = 'ACTIVE'
       and s.tenant_id in (select id from tenants)
       and s.started_on <= period.pe
       and (s.ends_on is null or s.ends_on >= period.ps)
  ),
  items as (
    select su.tenant_id, su.currency, su.id as subscription_id, i.id as item_id, i.charge_kind, i.billing_interval,
           i.amount,
           round(i.amount / case i.billing_interval when 'QUARTERLY' then 3 when 'YEARLY' then 12 else 1 end, 2)
             as monthly
      from subs su
      join platform.subscription_items i on i.subscription_id = su.id, period
     where i.charge_kind in ('LICENSE', 'TENANT_LICENSE', 'ADDON')
       and i.billing_interval <> 'ONE_TIME'
       and i.valid_from <= period.pe
       and (i.valid_to is null or i.valid_to >= period.ps)
  ),
  -- Una fila por tenant × moneda de suscripción.
  per_tenant as (
    select t.id as tenant_id, t.slug, t.saas_product_id, t.agreement_id, t.model, t.rate, t.fixed, t.fixed_currency,
           su.currency,
           (select coalesce(sum(it.monthly), 0) from items it where it.tenant_id = t.id and it.currency = su.currency)
             as base,
           case when count(distinct su.id) = 1 then min(su.id::text)::uuid end as subscription_id,
           jsonb_agg(distinct su.code) as subscriptions,
           (select coalesce(jsonb_agg(jsonb_build_object('item', it.item_id, 'kind', it.charge_kind,
                                                         'interval', it.billing_interval, 'amount', it.amount,
                                                         'monthly', it.monthly) order by it.item_id), '[]'::jsonb)
              from items it where it.tenant_id = t.id and it.currency = su.currency) as items
      from tenants t
      join subs su on su.tenant_id = t.id
     group by t.id, t.slug, t.saas_product_id, t.agreement_id, t.model, t.rate, t.fixed, t.fixed_currency, su.currency
  ),
  -- El fijo se cobra una vez por tenant: en su moneda si coincide con alguna
  -- suscripción del tenant; si no, en una línea aparte.
  fixed_home as (
    select pt.tenant_id,
           (select p2.currency from per_tenant p2
             where p2.tenant_id = pt.tenant_id and p2.currency = pt.fixed_currency limit 1) as same_currency
      from per_tenant pt
     where pt.model in ('FIXED_PER_TENANT', 'PERCENT_PLUS_FIXED')
     group by pt.tenant_id, pt.fixed_currency
  )
  select pt.agreement_id, pt.saas_product_id, pt.tenant_id, pt.subscription_id, 'TENANT', pt.currency,
         round(pt.base, 2),
         case when pt.model in ('PERCENT_OF_LIST', 'PERCENT_PLUS_FIXED') then pt.rate end,
         case when fh.same_currency = pt.currency then pt.fixed end,
         round(case when pt.model in ('PERCENT_OF_LIST', 'PERCENT_PLUS_FIXED') then round(pt.base * pt.rate, 2) else 0 end
               + case when fh.same_currency = pt.currency then pt.fixed else 0 end, 2),
         jsonb_build_object('model', pt.model, 'tenant', pt.slug, 'subscriptions', pt.subscriptions, 'items', pt.items)
    from per_tenant pt
    left join fixed_home fh on fh.tenant_id = pt.tenant_id
   where pt.model <> 'FIXED_PER_TENANT' or fh.same_currency = pt.currency
  union all
  select * from (
  select distinct on (pt.tenant_id)
         pt.agreement_id, pt.saas_product_id, pt.tenant_id, null::uuid, 'FIXED_SEPARATE', pt.fixed_currency,
         0, null::numeric, pt.fixed, pt.fixed,
         jsonb_build_object('model', pt.model, 'tenant', pt.slug, 'subscriptions', pt.subscriptions,
                            'note', 'Fijo por tenant en la moneda de la tarifa (distinta de la suscripción)')
    from per_tenant pt
    join fixed_home fh on fh.tenant_id = pt.tenant_id
   where pt.model in ('FIXED_PER_TENANT', 'PERCENT_PLUS_FIXED') and fh.same_currency is null
   order by pt.tenant_id
  ) separate
   order by 3, 5, 6;
$$;
revoke all on function platform.partner_fee_lines(uuid, date) from public, anon, authenticated;

create or replace function platform.compute_partner_fee_statement(p_partner_id uuid, p_period_start date)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_ps       date := date_trunc('month', coalesce(p_period_start, current_date))::date;
  v_pe       date;
  v_currency char(3);
  v_hash     text;
  v_existing platform.partner_fee_statements;
  v_id       uuid;
  v_result   jsonb := '[]'::jsonb;
  v_removed  integer := 0;
  v_base     numeric(14,2);
  v_fee      numeric(14,2);
  v_tenants  integer;
  v_lines    integer;
begin
  if not ((platform.can_read_finance() or platform.is_super_admin()) and auth.uid() is not null) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin calculan tarifas de partners'
      using errcode = '42501';
  end if;
  if not exists (select 1 from platform.organizations where id = p_partner_id) then
    raise exception 'ORGANIZACION_NO_ENCONTRADA: %', p_partner_id using errcode = 'P0002';
  end if;
  v_pe := (v_ps + interval '1 month' - interval '1 day')::date;

  -- Un cálculo a la vez por partner y período.
  perform pg_advisory_xact_lock(hashtextextended('platform.partner_fee:' || p_partner_id::text || ':' || v_ps::text, 0));

  if to_regclass('pg_temp.pfs_calc') is null then
    create temp table pfs_calc (
    agreement_id uuid, saas_product_id uuid, tenant_id uuid, subscription_id uuid, line_kind text,
    currency char(3), base_list_amount numeric, fee_rate numeric, fee_fixed_amount numeric, fee_amount numeric,
    basis jsonb
    ) on commit drop;
  end if;
  delete from pg_temp.pfs_calc;
  insert into pg_temp.pfs_calc select * from platform.partner_fee_lines(p_partner_id, v_ps);

  for v_currency in select distinct c.currency from pg_temp.pfs_calc c order by 1 loop
    -- Hash estable: solo el contenido económico de las líneas, en orden fijo.
    select 'sha256:' || encode(sha256(convert_to(coalesce(string_agg(
             concat_ws('|', c.agreement_id, c.tenant_id, c.subscription_id, c.line_kind, c.currency,
                       c.base_list_amount::numeric(14,2), c.fee_rate::numeric(6,4), c.fee_fixed_amount::numeric(14,2),
                       c.fee_amount::numeric(14,2)),
             ';' order by c.tenant_id::text, c.line_kind, c.agreement_id::text), ''), 'UTF8')), 'hex'),
           coalesce(sum(c.base_list_amount), 0), coalesce(sum(c.fee_amount), 0),
           count(distinct c.tenant_id), count(*)
      into v_hash, v_base, v_fee, v_tenants, v_lines
      from pg_temp.pfs_calc c where c.currency = v_currency;

    select * into v_existing from platform.partner_fee_statements s
     where s.partner_organization_id = p_partner_id and s.period_start = v_ps and s.currency = v_currency
       and s.status <> 'VOID'
     for update;

    if v_existing.id is not null and v_existing.status = 'ISSUED' then
      v_result := v_result || jsonb_build_object('statement_id', v_existing.id, 'currency', v_currency,
        'status', 'ISSUED', 'changed', false, 'note', 'Emitido: no se recalcula',
        'stale', v_existing.source_hash <> v_hash);
      continue;
    end if;

    if v_existing.id is not null and v_existing.source_hash = v_hash then
      v_result := v_result || jsonb_build_object('statement_id', v_existing.id, 'currency', v_currency,
        'status', 'DRAFT', 'changed', false, 'fee_total', v_existing.fee_total, 'base_total', v_existing.base_total);
      continue;
    end if;

    if v_existing.id is null then
      insert into platform.partner_fee_statements (
        partner_organization_id, period_start, period_end, currency, status, tenant_count, line_count,
        base_total, fee_total, source_hash, computed_at, computed_by
      ) values (
        p_partner_id, v_ps, v_pe, v_currency, 'DRAFT', v_tenants, v_lines, v_base, v_fee, v_hash, now(), auth.uid()
      ) returning id into v_id;
    else
      v_id := v_existing.id;
      delete from platform.partner_fee_statement_lines where statement_id = v_id;
      update platform.partner_fee_statements
         set tenant_count = v_tenants, line_count = v_lines, base_total = v_base, fee_total = v_fee,
             source_hash = v_hash, computed_at = now(), computed_by = auth.uid()
       where id = v_id;
    end if;

    insert into platform.partner_fee_statement_lines (
      statement_id, agreement_id, saas_product_id, tenant_id, subscription_id, line_kind, currency,
      base_list_amount, fee_rate, fee_fixed_amount, fee_amount, basis
    )
    select v_id, c.agreement_id, c.saas_product_id, c.tenant_id, c.subscription_id, c.line_kind, c.currency,
           c.base_list_amount, c.fee_rate, c.fee_fixed_amount, c.fee_amount, c.basis
      from pg_temp.pfs_calc c where c.currency = v_currency;

    perform platform.log_audit('PARTNER_FEE_STATEMENT_COMPUTED', 'partner_fee_statement', v_id::text, p_partner_id, null,
      jsonb_build_object('period_start', v_ps, 'currency', v_currency, 'base_total', v_base, 'fee_total', v_fee,
                         'tenants', v_tenants, 'lines', v_lines, 'source_hash', v_hash));

    v_result := v_result || jsonb_build_object('statement_id', v_id, 'currency', v_currency, 'status', 'DRAFT',
      'changed', true, 'fee_total', v_fee, 'base_total', v_base, 'tenants', v_tenants);
  end loop;

  -- Un borrador de una moneda que ya no tiene líneas sobra (no tiene factura).
  with gone as (
    delete from platform.partner_fee_statements s
     where s.partner_organization_id = p_partner_id and s.period_start = v_ps and s.status = 'DRAFT'
       and not exists (select 1 from pg_temp.pfs_calc c where c.currency = s.currency)
    returning s.id
  )
  select count(*) into v_removed from gone;

  return jsonb_build_object('partner_organization_id', p_partner_id, 'period_start', v_ps,
                            'statements', v_result, 'removed_drafts', v_removed);
end;
$$;

comment on function platform.compute_partner_fee_statement(uuid, date) is
  'EBIM_FINANCE / super admin. Recalcula el estado de cuenta DRAFT del partner en el período, uno por moneda '
  '(idempotente: mismo source_hash = sin cambios). Nunca toca un ISSUED.';

revoke all on function platform.compute_partner_fee_statement(uuid, date) from public, anon;
grant execute on function platform.compute_partner_fee_statement(uuid, date) to authenticated;

/** «Calcular todos»: cada partner con algún acuerdo de tarifa vigente en el período. */
create or replace function platform.compute_all_partner_fee_statements(p_period_start date)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_ps      date := date_trunc('month', coalesce(p_period_start, current_date))::date;
  v_partner uuid;
  v_out     jsonb := '[]'::jsonb;
begin
  if not ((platform.can_read_finance() or platform.is_super_admin()) and auth.uid() is not null) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin calculan tarifas de partners'
      using errcode = '42501';
  end if;
  for v_partner in
    select distinct a.organization_id
      from platform.organization_product_agreements a
     where a.status = 'ACTIVE' and a.platform_fee_model <> 'NONE' and a.billing_responsibility <> 'EBIM'
       and a.valid_from <= (v_ps + interval '1 month' - interval '1 day')::date
       and (a.valid_to is null or a.valid_to >= v_ps)
     order by 1
  loop
    v_out := v_out || platform.compute_partner_fee_statement(v_partner, v_ps);
  end loop;
  return jsonb_build_object('period_start', v_ps, 'partners', jsonb_array_length(v_out), 'results', v_out);
end;
$$;

revoke all on function platform.compute_all_partner_fee_statements(date) from public, anon;
grant execute on function platform.compute_all_partner_fee_statements(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4.2 Emisión y anulación
-- ---------------------------------------------------------------------------
create or replace function platform.issue_partner_fee_statement(p_statement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  c_due_days    constant integer := 15;
  v_st          platform.partner_fee_statements;
  v_partner     platform.organizations;
  v_invoice     platform.invoices;
  v_invoice_id  uuid;
  v_base_number text;
  v_number      text;
  v_seq         integer := 1;
  v_lines       integer;
  v_total       numeric(14,2);
begin
  if not ((platform.can_read_finance() or platform.is_super_admin()) and auth.uid() is not null) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin emiten facturas a partners'
      using errcode = '42501';
  end if;

  select * into v_st from platform.partner_fee_statements where id = p_statement_id for update;
  if v_st.id is null then
    raise exception 'ESTADO_DE_CUENTA_NO_ENCONTRADO: %', p_statement_id using errcode = 'P0002';
  end if;
  if v_st.status = 'ISSUED' then
    select * into v_invoice from platform.invoices where id = v_st.invoice_id;
    return jsonb_build_object('statement_id', v_st.id, 'invoice_id', v_invoice.id, 'number', v_invoice.number,
                              'total', v_invoice.total, 'currency', v_invoice.currency, 'created', false);
  end if;
  if v_st.status <> 'DRAFT' then
    raise exception 'ESTADO_DE_CUENTA_ANULADO: % está %', v_st.id, v_st.status using errcode = '55000';
  end if;
  if v_st.fee_total <= 0 then
    raise exception 'SIN_IMPORTE_FACTURABLE: el estado de cuenta suma %; no se emite una factura en cero', v_st.fee_total
      using errcode = '23514';
  end if;

  select * into v_partner from platform.organizations where id = v_st.partner_organization_id;

  -- Mismo esquema de numeración que las facturas de suscripción:
  -- INV-<AAAAMM>-<referencia>, y -R2, -R3… si una anulada conserva el número.
  v_base_number := 'INV-' || to_char(v_st.period_start, 'YYYYMM') || '-PFEE-' || upper(v_partner.slug)
                   || '-' || v_st.currency;
  v_number := v_base_number;
  while exists (select 1 from platform.invoices where number = v_number) loop
    v_seq := v_seq + 1;
    v_number := v_base_number || '-R' || v_seq;
  end loop;

  insert into platform.invoices (
    number, customer_organization_id, subscription_id, status, currency, issue_date, due_date,
    period_start, period_end, notes, metadata
  ) values (
    v_number, v_st.partner_organization_id, null, 'ISSUED', v_st.currency, current_date, current_date + c_due_days,
    v_st.period_start, v_st.period_end,
    'Tarifa de plataforma del partner (estado de cuenta mensual)',
    jsonb_build_object('origin', 'partner_fee_statement', 'statement_id', v_st.id, 'source_hash', v_st.source_hash)
  )
  returning id into v_invoice_id;

  insert into platform.invoice_lines (
    invoice_id, charge_kind, description, saas_product_id, tenant_id, quantity, unit_amount, currency, is_recurring
  )
  select v_invoice_id, 'PARTNER_PLATFORM_FEE',
         left('Tarifa de plataforma · ' || p.short_name || ' · ' || t.slug
              || case when l.line_kind = 'FIXED_SEPARATE' then ' (fijo por tenant)' else '' end, 200),
         l.saas_product_id, l.tenant_id, 1, l.fee_amount, l.currency, true
    from platform.partner_fee_statement_lines l
    join platform.saas_products p on p.id = l.saas_product_id
    join platform.tenants t on t.id = l.tenant_id
   where l.statement_id = v_st.id and l.fee_amount > 0
   order by p.short_name, t.slug, l.line_kind;
  get diagnostics v_lines = row_count;

  select total into v_total from platform.invoices where id = v_invoice_id;

  update platform.partner_fee_statements
     set status = 'ISSUED', invoice_id = v_invoice_id, issued_at = now(), issued_by = auth.uid()
   where id = v_st.id;

  perform platform.log_audit('PARTNER_FEE_STATEMENT_ISSUED', 'partner_fee_statement', v_st.id::text,
    v_st.partner_organization_id, null,
    jsonb_build_object('invoice_id', v_invoice_id, 'number', v_number, 'total', v_total, 'currency', v_st.currency,
                       'period_start', v_st.period_start, 'lines', v_lines));

  return jsonb_build_object('statement_id', v_st.id, 'invoice_id', v_invoice_id, 'number', v_number,
                            'total', v_total, 'currency', v_st.currency, 'created', true, 'lines', v_lines);
end;
$$;

comment on function platform.issue_partner_fee_statement(uuid) is
  'EBIM_FINANCE / super admin. Emite la factura ISSUED al partner (sin suscripción, líneas PARTNER_PLATFORM_FEE '
  'por tenant y producto, vencimiento a 15 días). Idempotente.';

revoke all on function platform.issue_partner_fee_statement(uuid) from public, anon;
grant execute on function platform.issue_partner_fee_statement(uuid) to authenticated;

create or replace function platform.void_partner_fee_statement(p_statement_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_st platform.partner_fee_statements;
begin
  if not ((platform.can_read_finance() or platform.is_super_admin()) and auth.uid() is not null) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin anulan estados de cuenta de partners'
      using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO' using errcode = '23502';
  end if;

  select * into v_st from platform.partner_fee_statements where id = p_statement_id for update;
  if v_st.id is null then
    raise exception 'ESTADO_DE_CUENTA_NO_ENCONTRADO: %', p_statement_id using errcode = 'P0002';
  end if;
  if v_st.status = 'VOID' then
    return jsonb_build_object('statement_id', v_st.id, 'status', 'VOID', 'duplicate', true);
  end if;

  if v_st.invoice_id is not null then
    if exists (select 1 from platform.payments p where p.invoice_id = v_st.invoice_id and p.status = 'CONFIRMED') then
      raise exception 'FACTURA_CON_PAGOS_CONFIRMADOS: la factura del estado de cuenta ya tiene cobros; se corrige, no se anula'
        using errcode = '23514';
    end if;
    update platform.invoices set status = 'VOID' where id = v_st.invoice_id;
  end if;

  update platform.partner_fee_statements
     set status = 'VOID', voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
   where id = v_st.id;

  perform platform.log_audit('PARTNER_FEE_STATEMENT_VOIDED', 'partner_fee_statement', v_st.id::text,
    v_st.partner_organization_id, null,
    jsonb_build_object('previous_status', v_st.status, 'invoice_id', v_st.invoice_id, 'reason', trim(p_reason)));

  return jsonb_build_object('statement_id', v_st.id, 'status', 'VOID', 'invoice_id', v_st.invoice_id,
                            'duplicate', false);
end;
$$;

comment on function platform.void_partner_fee_statement(uuid, text) is
  'EBIM_FINANCE / super admin. Anula el estado de cuenta y, si estaba emitido, su factura (solo sin cobros '
  'CONFIRMED). Un nuevo cálculo del período crea otro borrador.';

revoke all on function platform.void_partner_fee_statement(uuid, text) from public, anon;
grant execute on function platform.void_partner_fee_statement(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4.3 Vistas de lectura (security_invoker: RLS de cada tabla)
-- ---------------------------------------------------------------------------
create view platform.v_partner_fee_statements
with (security_invoker = true) as
  select s.id, s.partner_organization_id, o.display_name as partner_name, o.slug as partner_slug,
         s.period_start, s.period_end, s.currency, s.status, s.tenant_count, s.line_count,
         s.base_total, s.fee_total, s.source_hash, s.computed_at, s.computed_by,
         s.issued_at, s.issued_by, s.voided_at, s.voided_by, s.void_reason,
         s.invoice_id, i.number as invoice_number, i.status as invoice_status, i.due_date as invoice_due_date,
         i.total as invoice_total,
         case when i.id is null then null
              else round(i.total - coalesce((select sum(p.amount) from platform.payments p
                                              where p.invoice_id = i.id and p.status = 'CONFIRMED'), 0), 2)
         end as invoice_balance,
         s.created_at, s.updated_at
    from platform.partner_fee_statements s
    join platform.organizations o on o.id = s.partner_organization_id
    left join platform.invoices i on i.id = s.invoice_id;

create view platform.v_partner_fee_statement_lines
with (security_invoker = true) as
  select l.id, l.statement_id, l.agreement_id, l.saas_product_id, p.code as product_code,
         p.short_name as product_short_name, l.tenant_id, t.slug as tenant_slug, t.name as tenant_name,
         l.subscription_id, su.code as subscription_code, l.line_kind, l.currency, l.base_list_amount,
         l.fee_rate, l.fee_fixed_amount, l.fee_amount, l.basis, l.created_at
    from platform.partner_fee_statement_lines l
    join platform.saas_products p on p.id = l.saas_product_id
    left join platform.tenants t on t.id = l.tenant_id
    left join platform.subscriptions su on su.id = l.subscription_id;

comment on view platform.v_partner_fee_statements is
  'Estados de cuenta de la tarifa de partners con su factura y saldo. Finanzas ve todos; el admin del partner, los suyos.';

revoke all on platform.v_partner_fee_statements from public, anon, authenticated;
revoke all on platform.v_partner_fee_statement_lines from public, anon, authenticated;
grant select on platform.v_partner_fee_statements to authenticated, service_role;
grant select on platform.v_partner_fee_statement_lines to authenticated, service_role;
