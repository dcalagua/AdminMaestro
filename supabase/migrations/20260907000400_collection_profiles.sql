-- ============================================================================
-- EBIM Control Plane V2 — 17 · Modelo de COBRANZA por suscripción
-- ----------------------------------------------------------------------------
-- Fase 07 de `.claude-prompts-v2`.
--
-- LA DISTINCIÓN QUE SOSTIENE TODO ESTE ARCHIVO:
--
--   `payments`  = dinero que YA entró. Es un libro mayor, no configuración.
--   este módulo = CÓMO se pretende cobrar. Es configuración, no dinero.
--
-- Mezclarlas es el error clásico: acaba habiendo filas en `payments` que no son
-- cobros sino intenciones, y entonces el MRR, la conciliación y las comisiones
-- dejan de significar nada. Aquí no se toca `payments`.
--
-- POR QUÉ POR SUSCRIPCIÓN Y NO POR CLIENTE: GRUPASA paga eSupplier con tarjeta
-- Culqi mensual y WMS con Orden de Servicio anual. Es el mismo cliente y son dos
-- métodos distintos. Colgar el método de la organización haría ese caso —que es
-- el caso real— imposible de representar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
create type platform.collection_method as enum (
  'CULQI_CARD',      -- tarjeta con cargo recurrente vía proveedor
  'SERVICE_ORDER',   -- Orden de Servicio del cliente (documento administrativo)
  'PURCHASE_ORDER',  -- Orden de Compra del cliente
  'BANK_TRANSFER',   -- transferencia, conciliada a mano
  'MANUAL'           -- cualquier otro acuerdo, registrado por finanzas
);

create type platform.provider_kind as enum ('CULQI', 'MANUAL', 'BANK', 'OTHER');

create type platform.collection_profile_status as enum ('ACTIVE', 'INACTIVE', 'PENDING_SETUP');

-- TEST y LIVE nunca comparten credenciales ni datos. Modelarlo como enum evita
-- el clásico `is_production boolean` que nadie sabe si está al revés.
create type platform.provider_environment as enum ('TEST', 'LIVE');

-- ---------------------------------------------------------------------------
-- 2. Cuentas de proveedor de cobro.
--
-- REGLA ABSOLUTA: aquí NO hay secretos. `secret_key_ref` guarda el NOMBRE de la
-- variable donde el servidor encuentra la clave (`CULQI_SECRET_KEY`), nunca la
-- clave. El CHECK de más abajo rechaza cualquier cosa con forma de credencial
-- Culqi real, para que un copiar-pegar despistado falle en vez de filtrarse.
-- ---------------------------------------------------------------------------
create table platform.payment_provider_accounts (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null,
  name                   text not null,
  provider_kind          platform.provider_kind not null,
  environment            platform.provider_environment not null default 'TEST',
  owner_organization_id  uuid references platform.organizations(id) on delete restrict,
  country_code           char(2) not null default 'PE',
  currency               char(3) not null default 'PEN',
  -- La llave PÚBLICA sí puede vivir aquí: el navegador la necesita para tokenizar.
  public_key             text,
  -- Referencias a secretos del servidor. NUNCA el valor.
  secret_key_ref         text,
  rsa_public_key_ref     text,
  rsa_id_ref             text,
  webhook_endpoint       text,
  status                 platform.entity_status not null default 'ACTIVE',
  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint ppa_code_uk unique (code),
  constraint ppa_code_ck check (platform.is_slug(code)),
  constraint ppa_country_ck check (country_code ~ '^[A-Z]{2}$'),
  constraint ppa_currency_ck check (currency ~ '^[A-Z]{3}$'),

  -- Una referencia es un NOMBRE de variable, no una credencial.
  constraint ppa_secret_ref_is_reference_ck check (
    secret_key_ref is null or secret_key_ref ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  constraint ppa_rsa_refs_are_references_ck check (
    (rsa_public_key_ref is null or rsa_public_key_ref ~ '^[A-Z][A-Z0-9_]{2,63}$')
    and (rsa_id_ref is null or rsa_id_ref ~ '^[A-Z][A-Z0-9_]{2,63}$')
  ),
  -- Defensa explícita contra pegar una clave real en cualquiera de los campos.
  constraint ppa_no_real_keys_ck check (
    coalesce(secret_key_ref, '') !~* '^(sk|pk)_(test|live)_'
    and coalesce(public_key, '') !~* '^sk_'
  ),
  -- Una cuenta LIVE sin referencia de secreto no puede cobrar nada: es un error
  -- de configuración, no un estado válido.
  constraint ppa_live_needs_secret_ref_ck check (
    environment = 'TEST' or provider_kind <> 'CULQI' or secret_key_ref is not null
  )
);

comment on table platform.payment_provider_accounts is
  'Cuentas de cobro. NO almacena secretos: `secret_key_ref` es el nombre de la '
  'variable de servidor donde vive la clave (contrato S-05).';

comment on column platform.payment_provider_accounts.public_key is
  'Llave PÚBLICA del proveedor. Es pública por diseño: el navegador la usa para '
  'tokenizar la tarjeta sin que el PAN toque nunca nuestro servidor.';

comment on column platform.payment_provider_accounts.secret_key_ref is
  'NOMBRE de la variable de entorno/secreto del servidor (ej. CULQI_SECRET_KEY). '
  'Un CHECK rechaza cualquier valor con forma de clave real.';

create index ppa_owner_idx on platform.payment_provider_accounts(owner_organization_id);
create index ppa_kind_env_idx on platform.payment_provider_accounts(provider_kind, environment);

create trigger ppa_set_updated_at
  before update on platform.payment_provider_accounts
  for each row execute function platform.set_updated_at();

create trigger ppa_no_secrets
  before insert or update on platform.payment_provider_accounts
  for each row execute function platform.reject_secret_like_json('metadata');

-- ---------------------------------------------------------------------------
-- 3. Perfil de cobro por suscripción.
--
-- Versionado por vigencia: `effective_to is null` = perfil vigente. Cambiar de
-- método no borra el anterior, lo cierra — así una factura del año pasado sigue
-- explicándose con la política que estaba activa entonces.
-- ---------------------------------------------------------------------------
create table platform.subscription_collection_profiles (
  id                     uuid primary key default gen_random_uuid(),
  subscription_id        uuid not null references platform.subscriptions(id) on delete cascade,
  collection_method      platform.collection_method not null,
  provider_account_id    uuid references platform.payment_provider_accounts(id) on delete restrict,

  auto_charge            boolean not null default false,
  requires_service_order boolean not null default false,
  requires_purchase_order boolean not null default false,

  -- Política temporal de cobranza. Alimenta el motor de renovaciones (Fase 11).
  invoice_lead_days      integer not null default 0,   -- emitir factura N días antes
  renewal_notice_days    integer not null default 30,  -- avisar renovación N días antes
  payment_due_days       integer not null default 15,  -- vencimiento tras emisión
  grace_period_days      integer not null default 10,  -- gracia tras el vencimiento
  document_lead_days     integer not null default 45,  -- pedir la OS/OC N días antes
  auto_suspend           boolean not null default false,

  currency               char(3) not null default 'USD',
  status                 platform.collection_profile_status not null default 'ACTIVE',
  effective_from         date not null default current_date,
  effective_to           date,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint scp_currency_ck check (currency ~ '^[A-Z]{3}$'),
  constraint scp_period_ck check (effective_to is null or effective_to >= effective_from),

  -- Rangos razonables: un aviso a 3 años vista o un vencimiento negativo son
  -- errores de captura, no configuraciones.
  constraint scp_days_ck check (
    invoice_lead_days between 0 and 365
    and renewal_notice_days between 0 and 365
    and payment_due_days between 0 and 365
    and grace_period_days between 0 and 365
    and document_lead_days between 0 and 365
  ),

  -- Coherencia método <-> configuración.
  constraint scp_culqi_needs_provider_ck check (
    collection_method <> 'CULQI_CARD' or provider_account_id is not null
  ),
  constraint scp_culqi_autocharge_ck check (
    collection_method <> 'CULQI_CARD' or auto_charge
  ),
  constraint scp_service_order_ck check (
    collection_method <> 'SERVICE_ORDER' or requires_service_order
  ),
  constraint scp_purchase_order_ck check (
    collection_method <> 'PURCHASE_ORDER' or requires_purchase_order
  ),
  -- El cargo automático solo tiene sentido con un proveedor que pueda cobrar.
  constraint scp_autocharge_needs_provider_ck check (
    not auto_charge or provider_account_id is not null
  ),
  -- Suspender automáticamente sin gracia deja al cliente sin margen de reacción.
  constraint scp_autosuspend_needs_grace_ck check (
    not auto_suspend or grace_period_days >= 1
  )
);

comment on table platform.subscription_collection_profiles is
  'CÓMO se cobra cada suscripción. No es dinero: el dinero está en `payments`. '
  'Un mismo cliente puede tener eSupplier con tarjeta y WMS con Orden de Servicio.';

-- Un solo perfil VIGENTE por suscripción. Los cerrados se conservan.
create unique index scp_current_uk
  on platform.subscription_collection_profiles(subscription_id)
  where effective_to is null;

create index scp_subscription_idx on platform.subscription_collection_profiles(subscription_id);
create index scp_provider_idx on platform.subscription_collection_profiles(provider_account_id);
create index scp_method_idx on platform.subscription_collection_profiles(collection_method);

create trigger scp_set_updated_at
  before update on platform.subscription_collection_profiles
  for each row execute function platform.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3.1 Guard cross-organización.
--
-- Una cuenta de proveedor que pertenece a un partner no puede usarse para cobrar
-- la suscripción de otro: sería cobrar en la pasarela equivocada.
-- ---------------------------------------------------------------------------
create or replace function platform.enforce_collection_profile_scope()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_sub      record;
  v_account  record;
begin
  if new.provider_account_id is null then
    return new;
  end if;

  select s.billed_organization_id, s.currency, s.code
    into v_sub from platform.subscriptions s where s.id = new.subscription_id;

  select a.owner_organization_id, a.provider_kind, a.environment, a.secret_key_ref, a.code, a.status
    into v_account from platform.payment_provider_accounts a where a.id = new.provider_account_id;

  if v_account.status <> 'ACTIVE' then
    raise exception 'CUENTA_PROVEEDOR_INACTIVA: la cuenta "%" no está activa', v_account.code
      using errcode = '23514';
  end if;

  -- Una cuenta sin dueño es de EBIM y sirve a cualquiera. Una con dueño, solo a él.
  if v_account.owner_organization_id is not null
     and v_account.owner_organization_id <> v_sub.billed_organization_id then
    raise exception 'CUENTA_PROVEEDOR_AJENA: la cuenta "%" pertenece a otra organización y no puede cobrar la suscripción %',
      v_account.code, v_sub.code
      using errcode = '42501';
  end if;

  if new.collection_method = 'CULQI_CARD' and v_account.provider_kind <> 'CULQI' then
    raise exception 'PROVEEDOR_INCOMPATIBLE: el método CULQI_CARD exige una cuenta de tipo CULQI y "%" es %',
      v_account.code, v_account.provider_kind
      using errcode = '23514';
  end if;

  -- Coherencia con el CHECK de la cuenta, repetida aquí para dar un mensaje que
  -- explique el problema en términos del PERFIL, no de la cuenta.
  if v_account.environment = 'LIVE' and v_account.secret_key_ref is null then
    raise exception 'PROVEEDOR_LIVE_SIN_SECRETO: la cuenta "%" es LIVE pero no declara la referencia de su clave secreta',
      v_account.code
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger scp_scope_guard
  before insert or update on platform.subscription_collection_profiles
  for each row execute function platform.enforce_collection_profile_scope();

-- ---------------------------------------------------------------------------
-- 4. RLS + FORCE. Las tablas nuevas NO heredan RLS del bucle de la migración 09.
-- ---------------------------------------------------------------------------
alter table platform.payment_provider_accounts enable row level security;
alter table platform.payment_provider_accounts force row level security;
alter table platform.subscription_collection_profiles enable row level security;
alter table platform.subscription_collection_profiles force row level security;

-- Lectura: EBIM ve todo; una organización ve sus propias cuentas.
grant select on platform.payment_provider_accounts to authenticated;
revoke insert, update, delete on platform.payment_provider_accounts from authenticated;

create policy ppa_select on platform.payment_provider_accounts
  for select to authenticated
  using (
    platform.can_manage_platform_entities()
    or platform.can_read_finance()
    or (owner_organization_id is not null and owner_organization_id in (select platform.my_org_ids()))
  );

-- El perfil de cobro sigue el alcance de SU suscripción: quien puede ver la
-- suscripción puede ver cómo se cobra.
grant select on platform.subscription_collection_profiles to authenticated;
revoke insert, update, delete on platform.subscription_collection_profiles from authenticated;

create policy scp_select on platform.subscription_collection_profiles
  for select to authenticated
  using (
    exists (
      select 1 from platform.subscriptions s
       where s.id = subscription_collection_profiles.subscription_id
         and (
           platform.can_read_finance()
           or platform.can_manage_platform_entities()
           or s.billed_organization_id in (select platform.my_org_ids())
           or (s.tenant_id is not null and s.tenant_id in (select platform.my_tenant_ids()))
         )
    )
  );

-- ---------------------------------------------------------------------------
-- 5. RPCs
-- ---------------------------------------------------------------------------

create or replace function platform.upsert_payment_provider_account(
  p_code                  text,
  p_name                  text,
  p_provider_kind         platform.provider_kind,
  p_environment           platform.provider_environment default 'TEST',
  p_owner_organization_id uuid default null,
  p_country_code          char(2) default 'PE',
  p_currency              char(3) default 'PEN',
  p_public_key            text default null,
  p_secret_key_ref        text default null,
  p_rsa_public_key_ref    text default null,
  p_rsa_id_ref            text default null,
  p_webhook_endpoint      text default null,
  p_status                platform.entity_status default 'ACTIVE',
  p_metadata              jsonb default '{}'::jsonb,
  p_id                    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id uuid;
  v_is_new boolean := p_id is null;
begin
  -- Solo EBIM configura pasarelas: es dinero de la plataforma.
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin configuran cuentas de cobro'
      using errcode = '42501';
  end if;

  if not platform.is_slug(lower(trim(coalesce(p_code, '')))) then
    raise exception 'CODIGO_INVALIDO: "%" debe ser kebab-case en minúsculas (ej. culqi-pe-test)', p_code
      using errcode = '23514';
  end if;

  -- Mensaje explícito antes de que salte el CHECK: es el error más fácil de cometer.
  if coalesce(p_secret_key_ref, '') ~* '^(sk|pk)_(test|live)_' then
    raise exception 'SECRETO_EN_BASE: "secret_key_ref" es el NOMBRE de la variable del servidor (ej. CULQI_SECRET_KEY), no la clave. Una clave real no se guarda nunca en la base'
      using errcode = '42501';
  end if;

  if v_is_new then
    insert into platform.payment_provider_accounts (
      code, name, provider_kind, environment, owner_organization_id, country_code, currency,
      public_key, secret_key_ref, rsa_public_key_ref, rsa_id_ref, webhook_endpoint, status, metadata
    ) values (
      lower(trim(p_code)), trim(p_name), p_provider_kind, p_environment, p_owner_organization_id,
      p_country_code, p_currency, p_public_key, p_secret_key_ref, p_rsa_public_key_ref,
      p_rsa_id_ref, p_webhook_endpoint, p_status, coalesce(p_metadata, '{}'::jsonb)
    )
    returning id into v_id;
  else
    update platform.payment_provider_accounts
       set code = lower(trim(p_code)), name = trim(p_name), provider_kind = p_provider_kind,
           environment = p_environment, owner_organization_id = p_owner_organization_id,
           country_code = p_country_code, currency = p_currency, public_key = p_public_key,
           secret_key_ref = p_secret_key_ref, rsa_public_key_ref = p_rsa_public_key_ref,
           rsa_id_ref = p_rsa_id_ref, webhook_endpoint = p_webhook_endpoint,
           status = p_status, metadata = coalesce(p_metadata, '{}'::jsonb)
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'CUENTA_NO_ENCONTRADA: %', p_id using errcode = '23503';
    end if;
  end if;

  perform platform.log_audit(
    case when v_is_new then 'PROVIDER_ACCOUNT_CREATED' else 'PROVIDER_ACCOUNT_UPDATED' end,
    'payment_provider_account', v_id::text, p_owner_organization_id, null,
    jsonb_build_object(
      'code', p_code, 'provider_kind', p_provider_kind, 'environment', p_environment,
      'has_secret_ref', p_secret_key_ref is not null
    )
  );

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_subscription_collection_profile — versiona el perfil de cobro.
--
-- Cierra el vigente (`effective_to = effective_from - 1`) y abre el nuevo, en la
-- misma transacción. Nunca se edita en sitio: cambiar de tarjeta a transferencia
-- en marzo no puede reescribir cómo se cobró en febrero.
-- ---------------------------------------------------------------------------
create or replace function platform.set_subscription_collection_profile(
  p_subscription_id        uuid,
  p_collection_method      platform.collection_method,
  p_provider_account_id    uuid default null,
  p_auto_charge            boolean default null,
  p_requires_service_order boolean default null,
  p_requires_purchase_order boolean default null,
  p_invoice_lead_days      integer default 0,
  p_renewal_notice_days    integer default 30,
  p_payment_due_days       integer default 15,
  p_grace_period_days      integer default 10,
  p_document_lead_days     integer default 45,
  p_auto_suspend           boolean default false,
  p_currency               char(3) default null,
  p_status                 platform.collection_profile_status default 'ACTIVE',
  p_effective_from         date default current_date,
  p_notes                  text default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id       uuid;
  v_sub      record;
  v_current  record;
  v_auto     boolean;
  v_needs_so boolean;
  v_needs_po boolean;
begin
  select * into v_sub from platform.subscriptions where id = p_subscription_id;
  if v_sub is null then
    raise exception 'SUSCRIPCION_NO_ENCONTRADA: %', p_subscription_id using errcode = '23503';
  end if;

  -- EBIM finanzas/producto, o el admin de la organización a la que se factura.
  if not (
    platform.can_manage_commercial()
    or platform.is_org_admin(v_sub.billed_organization_id)
  ) then
    raise exception 'NO_AUTORIZADO: no puede configurar la cobranza de la suscripción %', v_sub.code
      using errcode = '42501';
  end if;

  -- Los flags se derivan del método salvo que se indiquen explícitamente. Así la
  -- UI puede limitarse a "elige método" sin dejar el perfil incoherente.
  v_auto     := coalesce(p_auto_charge, p_collection_method = 'CULQI_CARD');
  v_needs_so := coalesce(p_requires_service_order, p_collection_method = 'SERVICE_ORDER');
  v_needs_po := coalesce(p_requires_purchase_order, p_collection_method = 'PURCHASE_ORDER');

  -- Comprobación anticipada: sin esto el error que ve el usuario es una violación
  -- de CHECK cruda, que no explica qué falta.
  if v_auto and p_provider_account_id is null then
    raise exception 'PROVEEDOR_REQUERIDO: el método % exige una cuenta de proveedor con la que cobrar', p_collection_method
      using errcode = '23502';
  end if;

  -- Suspender sin gracia deja al cliente sin margen de reacción. El CHECK lo
  -- impide igualmente; aquí se explica.
  if p_auto_suspend and coalesce(p_grace_period_days, 0) < 1 then
    raise exception 'GRACIA_REQUERIDA: la suspensión automática exige al menos 1 día de gracia tras el vencimiento'
      using errcode = '23514';
  end if;

  if v_needs_so and v_needs_po then
    raise exception 'DOCUMENTOS_DUPLICADOS: exigir Orden de Servicio Y Orden de Compra a la vez requiere una configuración explícita; elige uno como método'
      using errcode = '23514';
  end if;

  select * into v_current
    from platform.subscription_collection_profiles
   where subscription_id = p_subscription_id and effective_to is null;

  if v_current.id is not null then
    if v_current.effective_from >= p_effective_from then
      raise exception 'VIGENCIA_INVALIDA: el perfil vigente empieza el % y el nuevo pretende empezar el %',
        v_current.effective_from, p_effective_from
        using errcode = '23514';
    end if;
    update platform.subscription_collection_profiles
       set effective_to = p_effective_from - 1
     where id = v_current.id;
  end if;

  insert into platform.subscription_collection_profiles (
    subscription_id, collection_method, provider_account_id, auto_charge,
    requires_service_order, requires_purchase_order,
    invoice_lead_days, renewal_notice_days, payment_due_days, grace_period_days,
    document_lead_days, auto_suspend, currency, status, effective_from, notes
  ) values (
    p_subscription_id, p_collection_method, p_provider_account_id, v_auto,
    v_needs_so, v_needs_po,
    p_invoice_lead_days, p_renewal_notice_days, p_payment_due_days, p_grace_period_days,
    p_document_lead_days, p_auto_suspend, coalesce(p_currency, v_sub.currency),
    p_status, p_effective_from, p_notes
  )
  returning id into v_id;

  perform platform.log_audit(
    'COLLECTION_PROFILE_SET', 'subscription_collection_profile', v_id::text,
    v_sub.billed_organization_id, v_sub.tenant_id,
    jsonb_build_object(
      'subscription', v_sub.code,
      'method', p_collection_method,
      'provider_account_id', p_provider_account_id,
      'auto_charge', v_auto,
      'auto_suspend', p_auto_suspend,
      'previous_profile_id', v_current.id,
      'previous_method', v_current.collection_method
    )
  );

  return v_id;
end;
$$;

comment on function platform.set_subscription_collection_profile is
  'Versiona el perfil de cobro de una suscripción. Configurar CÓMO se cobra no '
  'registra ningún cobro: `payments` no se toca aquí.';

-- ---------------------------------------------------------------------------
-- 6. Vista de cobranza para la UI y para el motor de renovaciones.
-- ---------------------------------------------------------------------------
create or replace view platform.v_subscription_collection
with (security_invoker = true) as
select
  s.id                      as subscription_id,
  s.code                    as subscription_code,
  s.status                  as subscription_status,
  s.billing_interval,
  s.started_on,
  s.ends_on,
  s.billed_organization_id,
  o.display_name            as billed_organization_name,
  s.saas_product_id,
  pr.code                   as product_code,
  pr.short_name             as product_short_name,
  s.tenant_id,
  t.name                    as tenant_name,
  t.slug                    as tenant_slug,
  p.id                      as profile_id,
  p.collection_method,
  p.provider_account_id,
  a.code                    as provider_account_code,
  a.provider_kind,
  a.environment             as provider_environment,
  p.auto_charge,
  p.requires_service_order,
  p.requires_purchase_order,
  p.invoice_lead_days,
  p.renewal_notice_days,
  p.payment_due_days,
  p.grace_period_days,
  p.document_lead_days,
  p.auto_suspend,
  coalesce(p.currency, s.currency) as currency,
  p.status                  as profile_status,
  p.effective_from,
  -- Una suscripción sin perfil se cobra a mano: es un hecho, no un dato faltante.
  (p.id is null)            as profile_missing
from platform.subscriptions s
join platform.organizations o on o.id = s.billed_organization_id
join platform.saas_products pr on pr.id = s.saas_product_id
left join platform.tenants t on t.id = s.tenant_id
left join platform.subscription_collection_profiles p
       on p.subscription_id = s.id and p.effective_to is null
left join platform.payment_provider_accounts a on a.id = p.provider_account_id;

comment on view platform.v_subscription_collection is
  '`profile_missing = true` significa cobro manual por omisión, no un error. La '
  'Fase 11 la usa para calcular vencimientos y alertas.';

grant select on platform.v_subscription_collection to authenticated;
revoke all on platform.v_subscription_collection from anon;

-- ---------------------------------------------------------------------------
-- 7. GRANTS de funciones
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
         'upsert_payment_provider_account',
         'set_subscription_collection_profile',
         'enforce_collection_profile_scope'
       )
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Cuenta de proveedor por defecto en modo TEST.
--
-- Se crea sin `public_key` y sin `secret_key_ref`: queda como PENDING de
-- configuración. Es intencional — el proyecto tiene que arrancar y demostrarse
-- sin credenciales Culqi, y esta fila hace visible que faltan.
-- ---------------------------------------------------------------------------
insert into platform.payment_provider_accounts (
  code, name, provider_kind, environment, country_code, currency, status, metadata
) values (
  'culqi-pe-test', 'Culqi Perú (TEST)', 'CULQI', 'TEST', 'PE', 'PEN', 'ACTIVE',
  jsonb_build_object(
    'setup_pending', true,
    'note', 'Sin credenciales configuradas: el adapter opera en modo MOCK'
  )
), (
  'ebim-manual', 'Cobro manual EBIM', 'MANUAL', 'TEST', 'PE', 'USD', 'ACTIVE',
  jsonb_build_object('note', 'Transferencias y cobros registrados por finanzas')
)
on conflict (code) do nothing;
