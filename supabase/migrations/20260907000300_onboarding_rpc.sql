-- ============================================================================
-- EBIM Control Plane V2 — 16 · Onboarding transaccional de una venta
-- ----------------------------------------------------------------------------
-- Fases 05 y 06 de `.claude-prompts-v2`.
--
-- EL PROBLEMA QUE RESUELVE: hasta ahora dar de alta un cliente eran cinco
-- llamadas independientes (tenant, suscripción, líneas, atribución, provisioning).
-- Si la tercera fallaba quedaba un tenant sin contrato y una atribución sin venta:
-- inconsistencias que después nadie sabe reconstruir. Una función plpgsql corre
-- dentro de UNA transacción, así que o queda todo o no queda nada.
--
-- NO duplica seguridad: reutiliza `platform.create_tenant()` — con su
-- ADMIN_EMAIL_REQUERIDO, su bloqueo del dominio operador y su autorización — y
-- los triggers de acuerdo de canal. Lo que añade es la orquestación.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper: tarifa vigente de un plan para un tipo de cargo e intervalo.
-- Devuelve NULL si no hay tarifa: quien llama decide si eso es un error.
-- ---------------------------------------------------------------------------
create or replace function platform.current_plan_price(
  p_plan_id          uuid,
  p_charge_kind      platform.charge_kind,
  p_billing_interval platform.billing_interval,
  p_currency         char(3),
  p_as_of            date default current_date
)
returns numeric
language sql
stable
security definer
set search_path = platform, pg_catalog
as $$
  select pp.amount
    from platform.plan_prices pp
   where pp.plan_id = p_plan_id
     and pp.charge_kind = p_charge_kind
     and pp.billing_interval = p_billing_interval
     and pp.currency = p_currency
     and pp.valid_from <= p_as_of
     and (pp.valid_to is null or pp.valid_to >= p_as_of)
   order by pp.valid_from desc
   limit 1;
$$;

revoke all on function platform.current_plan_price from public, anon;
grant execute on function platform.current_plan_price to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- onboard_customer_subscription — una venta completa, atómica.
--
-- Devuelve un jsonb con todo lo creado para que la UI pueda enlazarlo sin
-- adivinar. Si algo falla, la excepción aborta la transacción entera.
-- ---------------------------------------------------------------------------
create or replace function platform.onboard_customer_subscription(
  p_saas_product_code        text,
  p_customer_organization_id uuid,
  p_tenant_slug              text,
  p_tenant_name              text,
  p_admin_email              text,
  p_plan_id                  uuid,
  p_billing_interval         platform.billing_interval default 'MONTHLY',
  p_currency                 char(3) default 'USD',
  p_tenant_type              platform.tenant_type default 'PRODUCTION',
  p_deployment_mode          platform.deployment_mode default 'SHARED',
  p_managing_organization_id uuid default null,
  p_company_id               uuid default null,
  p_started_on               date default current_date,
  p_quantity                 integer default 1,
  -- Importe de la licencia. NULL => se toma la tarifa vigente del plan.
  p_license_amount           numeric default null,
  -- Cargos one-time y recurrentes opcionales. 0 o NULL => no se crea la línea.
  p_implementation_fee       numeric default null,
  p_infrastructure_fee       numeric default null,
  p_support_fee              numeric default null,
  -- Snapshot del margen del canal en el momento de la venta (0-1).
  p_channel_margin_rate      numeric default null,
  -- Atribución comercial opcional.
  p_sales_agent_id           uuid default null,
  p_commission_plan_id       uuid default null,
  p_attribution_pct          numeric default 1.0,
  p_attribution_source       platform.attribution_source default 'DIRECT',
  -- Provisioning: siempre DRY_RUN salvo autorización explícita del super admin.
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
  v_license_amount  numeric(14,2);
  v_is_demo         boolean := p_tenant_type = 'DEMO';
  v_recurring       boolean;
  v_items           jsonb := '[]'::jsonb;
  v_item_id         uuid;
  v_sub_interval    platform.billing_interval;
begin
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
  -- Un plan que declara modelo tiene que coincidir con el que se está vendiendo.
  if v_plan.deployment_mode is not null and v_plan.deployment_mode <> p_deployment_mode then
    raise exception 'PLAN_MODO_INCOMPATIBLE: el plan "%" es para % y la venta es %',
      v_plan.code, v_plan.deployment_mode, p_deployment_mode
      using errcode = '23514';
  end if;

  if p_provisioning_mode not in ('DRY_RUN', 'LIVE') then
    raise exception 'MODO_INVALIDO: provisioning_mode debe ser DRY_RUN o LIVE' using errcode = '23514';
  end if;

  -- ---- 1) Tenant. Se REUTILIZA create_tenant(): ahí viven ADMIN_EMAIL_REQUERIDO,
  --         el bloqueo de @ebim.pe y la autorización. No se replica nada.
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
    jsonb_build_object('onboarded_at', now(), 'plan_code', v_plan.code)
  );

  -- ---- 2) ¿Hay recurrente?
  -- Regla dura: un tenant DEMO NUNCA genera suscripción recurrente. El trigger
  -- `subscriptions_demo_guard` lo impediría igualmente, pero fallar aquí con un
  -- mensaje claro es mejor que chocar contra el trigger a mitad del alta.
  v_recurring := not v_is_demo and p_billing_interval <> 'ONE_TIME';

  v_license_amount := coalesce(
    p_license_amount,
    platform.current_plan_price(p_plan_id, 'LICENSE', p_billing_interval, p_currency, p_started_on),
    platform.current_plan_price(p_plan_id, 'TENANT_LICENSE', p_billing_interval, p_currency, p_started_on),
    0
  );

  if v_recurring and v_license_amount <= 0 then
    raise exception 'TARIFA_NO_DEFINIDA: el plan "%" no tiene tarifa % vigente en % y no se indicó importe',
      v_plan.code, p_billing_interval, p_currency
      using errcode = '23502';
  end if;

  -- ---- 3) Suscripción.
  -- Para DEMO la suscripción solo existe si hay cargos one-time que cobrar
  -- (una implementación de demo, por ejemplo). Si no hay nada que cobrar, el
  -- tenant se queda sin contrato, que es lo correcto.
  v_sub_interval := case when v_recurring then p_billing_interval else 'ONE_TIME' end;

  if v_recurring
     or coalesce(p_implementation_fee, 0) > 0
     or coalesce(p_infrastructure_fee, 0) > 0
     or coalesce(p_support_fee, 0) > 0 then

    v_subscription_id := platform.create_subscription(
      p_customer_organization_id,
      v_product_id,
      p_plan_id,
      v_sub_interval,
      p_currency,
      v_tenant_id,
      null,                         -- código autogenerado
      coalesce(p_quantity, 1),
      p_started_on,
      null,                         -- sin fecha de fin
      p_channel_margin_rate,
      'DRAFT',
      p_notes,
      jsonb_build_object('origin', 'onboarding', 'demo', v_is_demo)
    );

    -- ---- 4) Líneas.
    if v_recurring then
      v_item_id := platform.upsert_subscription_item(
        v_subscription_id, 'LICENSE',
        'Licencia ' || v_plan.name,
        coalesce(p_quantity, 1), v_license_amount, p_billing_interval,
        p_currency, v_tenant_id, null, p_started_on, null
      );
      v_items := v_items || jsonb_build_object('charge_kind', 'LICENSE', 'id', v_item_id,
                                               'amount', v_license_amount);
    end if;

    -- Implementación: ONE_TIME siempre. `upsert_subscription_item` lo exige, y por
    -- eso mismo no infla el MRR (`v_subscription_mrr` solo cuenta lo recurrente).
    if coalesce(p_implementation_fee, 0) > 0 then
      v_item_id := platform.upsert_subscription_item(
        v_subscription_id, 'IMPLEMENTATION_FEE',
        'Implementación y puesta en marcha',
        1, p_implementation_fee, 'ONE_TIME',
        p_currency, v_tenant_id, null, p_started_on, null
      );
      v_items := v_items || jsonb_build_object('charge_kind', 'IMPLEMENTATION_FEE', 'id', v_item_id,
                                               'amount', p_implementation_fee);
    end if;

    -- Infraestructura dedicada: recurrente, porque el costo lo es.
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
        p_currency, v_tenant_id, null, p_started_on, null
      );
      v_items := v_items || jsonb_build_object('charge_kind', 'INFRASTRUCTURE_FEE', 'id', v_item_id,
                                               'amount', p_infrastructure_fee);
    end if;

    if coalesce(p_support_fee, 0) > 0 then
      v_item_id := platform.upsert_subscription_item(
        v_subscription_id, 'SUPPORT_FEE',
        'Soporte y SLA',
        1, p_support_fee,
        case when v_recurring then p_billing_interval else 'ONE_TIME' end,
        p_currency, v_tenant_id, null, p_started_on, null
      );
      v_items := v_items || jsonb_build_object('charge_kind', 'SUPPORT_FEE', 'id', v_item_id,
                                               'amount', p_support_fee);
    end if;

    if p_activate then
      perform platform.set_subscription_status(v_subscription_id, 'ACTIVE', 'Alta de cliente');
    end if;
  end if;

  -- ---- 5) Atribución comercial (opcional).
  -- COMERCIAL != ACCESO OPERATIVO: esto NO crea ninguna `tenant_membership`.
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
      p_started_on,
      null,
      'Atribución creada en el alta del cliente'
    );
  end if;

  -- ---- 6) Provisioning. DRY_RUN por defecto; LIVE lo rechaza la RPC salvo super admin.
  v_provisioning_id := platform.enqueue_provisioning_request(
    -- El cast es necesario: un CASE de literales se infiere como `text`, no como
    -- el enum, y plpgsql no encuentra la sobrecarga.
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

  -- ---- 7) Auditoría del alta completa, no solo de sus partes.
  perform platform.log_audit(
    'CUSTOMER_ONBOARDED', 'tenant', v_tenant_id::text,
    p_customer_organization_id, v_tenant_id,
    jsonb_build_object(
      'product', p_saas_product_code,
      'plan', v_plan.code,
      'deployment_mode', p_deployment_mode,
      'tenant_type', p_tenant_type,
      'subscription_id', v_subscription_id,
      'recurring', v_recurring,
      'items', v_items,
      'attribution_id', v_attribution_id,
      'provisioning_id', v_provisioning_id,
      'provisioning_mode', p_provisioning_mode,
      'managing_organization_id', p_managing_organization_id
    )
  );

  return jsonb_build_object(
    'tenant_id', v_tenant_id,
    'subscription_id', v_subscription_id,
    'attribution_id', v_attribution_id,
    'provisioning_request_id', v_provisioning_id,
    'recurring', v_recurring,
    'license_amount', v_license_amount,
    'items', v_items
  );
end;
$$;

comment on function platform.onboard_customer_subscription is
  'Convierte una venta en tenant + suscripción + líneas + atribución + provisioning '
  'DRY_RUN en UNA transacción. Reutiliza create_tenant() y las RPCs de la Fase 02: '
  'no duplica ni una comprobación de seguridad. Un DEMO nunca genera recurrente.';

revoke all on function platform.onboard_customer_subscription from public, anon;
grant execute on function platform.onboard_customer_subscription to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Suspender / reanudar un tenant a través de la cola de provisioning.
--
-- Fase 06 §"UI/acciones": suspender no puede ser un UPDATE suelto. Cambia el
-- estado Y encola el trabajo de infraestructura, en la misma transacción.
-- ---------------------------------------------------------------------------
create or replace function platform.request_tenant_suspension(
  p_tenant_id uuid,
  p_reason    text,
  p_mode      text default 'DRY_RUN'
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_request uuid;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: suspender un tenant exige un motivo auditable'
      using errcode = '23502';
  end if;

  -- La autorización y la máquina de estados viven en set_tenant_status.
  perform platform.set_tenant_status(p_tenant_id, 'SUSPENDED', p_reason);

  v_request := platform.enqueue_provisioning_request(
    'SUSPEND_TENANT', p_tenant_id, null, null, p_mode,
    jsonb_build_object('reason', p_reason), null
  );

  return jsonb_build_object('tenant_id', p_tenant_id, 'provisioning_request_id', v_request);
end;
$$;

create or replace function platform.request_tenant_resume(
  p_tenant_id uuid,
  p_reason    text default 'Reactivación administrativa',
  p_mode      text default 'DRY_RUN'
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_request uuid;
begin
  perform platform.set_tenant_status(p_tenant_id, 'ACTIVE', p_reason);

  v_request := platform.enqueue_provisioning_request(
    'RESUME_TENANT', p_tenant_id, null, null, p_mode,
    jsonb_build_object('reason', p_reason), null
  );

  return jsonb_build_object('tenant_id', p_tenant_id, 'provisioning_request_id', v_request);
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'platform'
       and p.proname in ('request_tenant_suspension', 'request_tenant_resume')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;
