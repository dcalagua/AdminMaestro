-- ============================================================================
-- EBIM Control Plane V2 — 15 · Acuerdos de canal (partner / reseller)
-- ----------------------------------------------------------------------------
-- Fases 03 y 04 de `.claude-prompts-v2`.
--
-- `organization_product_agreements` ya existía en el baseline con lo mínimo:
-- `can_resell`, `can_manage_tenants`, `margin_rate`, `default_deployment_mode`,
-- vigencia y estado. Lo que faltaba para cerrar el ciclo del canal es poder
-- expresar los LÍMITES del acuerdo de forma normalizada:
--
--   · qué modelos de despliegue puede vender ese partner en ese SaaS;
--   · qué tipos de tenant puede dar de alta;
--   · cuántos tenants como máximo;
--   · quién factura al cliente final.
--
-- Todo eso vivía antes, como mucho, en `terms jsonb` — es decir, en ningún sitio
-- comprobable. Aquí pasa a ser columnas con CHECK y un trigger que las aplica.
--
-- IMPORTANTE: NO se toca el trigger `tenants_manager_agreement_guard` del
-- baseline. Se añade uno nuevo que corre después y valida el alcance.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Quién emite la factura al cliente final.
--
--   EBIM    : EBIM factura al cliente; el partner cobra su margen aparte.
--   PARTNER : el partner factura al cliente y EBIM le factura a él (wholesale).
--   MIXED   : reparto por producto/concepto, detallado en `terms`.
-- ---------------------------------------------------------------------------
create type platform.billing_responsibility as enum ('EBIM', 'PARTNER', 'MIXED');

-- ---------------------------------------------------------------------------
-- 2. Extensión del acuerdo.
--
-- DEFAULTS PERMISIVOS, A PROPÓSITO. Una columna nueva no puede prohibir
-- retroactivamente lo que el sistema ya permitía: los acuerdos que existían antes
-- de esta migración nunca declararon límites, así que su significado real es «sin
-- límite». Ponerles `{SHARED}` por defecto habría invalidado de golpe los tenants
-- PARTNER_DEDICATED que el seed ya tenía.
--
-- La restricción es OPT-IN: se acota el acuerdo cuando el negocio lo decide, y
-- entonces el guard de §3 la aplica.
-- ---------------------------------------------------------------------------
alter table platform.organization_product_agreements
  add column allowed_deployment_modes platform.deployment_mode[] not null
    default array['SHARED', 'PARTNER_DEDICATED', 'TENANT_DEDICATED']::platform.deployment_mode[],
  add column allowed_tenant_types platform.tenant_type[] not null
    default array['PRODUCTION', 'TRIAL', 'DEMO', 'SANDBOX']::platform.tenant_type[],
  add column billing_responsibility platform.billing_responsibility not null default 'EBIM',
  add column max_tenants integer,
  add column notes text;

comment on column platform.organization_product_agreements.allowed_deployment_modes is
  'Modelos que este canal puede vender de ESTE producto. Un partner con 20 tenants '
  'en SHARED sigue siendo Shared: tener muchos clientes no lo convierte en Dedicated.';

comment on column platform.organization_product_agreements.allowed_tenant_types is
  'Tipos de tenant que el canal puede dar de alta. Se modela como array y no como tres '
  'booleanos (DEMO/TRIAL/PRODUCTION) para que añadir SANDBOX no exija otra migración.';

comment on column platform.organization_product_agreements.max_tenants is
  'Tope de tenants ACTIVOS que el canal puede administrar de este producto. '
  'NULL = ilimitado, que es lo normal.';

comment on column platform.organization_product_agreements.billing_responsibility is
  'Quién emite la factura al cliente final. No cambia quién cobra la comisión: '
  'eso lo decide el pago confirmado, no el acuerdo.';

alter table platform.organization_product_agreements
  add constraint opa_allowed_modes_ck
    check (array_length(allowed_deployment_modes, 1) >= 1),
  add constraint opa_allowed_types_ck
    check (array_length(allowed_tenant_types, 1) >= 1),
  add constraint opa_max_tenants_ck
    check (max_tenants is null or max_tenants >= 1),
  -- El modo por defecto tiene que estar entre los permitidos, o el acuerdo se
  -- contradice a sí mismo.
  add constraint opa_default_mode_allowed_ck
    check (default_deployment_mode = any (allowed_deployment_modes));

-- El modo por defecto está permitido POR DEFINICIÓN. Como un `default` de columna no
-- puede leer otra columna, se normaliza con un trigger: cualquier fila que declare un
-- `default_deployment_mode` fuera de su lista lo incorpora en vez de romper.
--
-- Esto no debilita el CHECK: la RPC `upsert_product_agreement` sigue rechazando
-- explícitamente la combinación contradictoria con MODO_DEFECTO_NO_PERMITIDO, así que
-- desde la consola el error se ve. El trigger existe para las inserciones directas
-- (seed, migraciones de datos) que solo indican el modo por defecto.
create or replace function platform.normalize_agreement_modes()
returns trigger
language plpgsql
set search_path = platform, pg_catalog
as $$
begin
  if not (new.default_deployment_mode = any (new.allowed_deployment_modes)) then
    new.allowed_deployment_modes :=
      new.allowed_deployment_modes || new.default_deployment_mode;
  end if;
  return new;
end;
$$;

create trigger opa_normalize_modes
  before insert or update on platform.organization_product_agreements
  for each row execute function platform.normalize_agreement_modes();

-- Filas ya existentes: se alinean con lo que siempre representaron.
update platform.organization_product_agreements
   set allowed_deployment_modes = allowed_deployment_modes || default_deployment_mode
 where not (default_deployment_mode = any (allowed_deployment_modes));

-- ---------------------------------------------------------------------------
-- 3. Guard de alcance del acuerdo sobre `tenants`.
--
-- El baseline ya comprueba que exista acuerdo activo con `can_manage_tenants`
-- (`tenants_manager_agreement_guard`). Este trigger añade los límites nuevos.
-- Su nombre va después alfabéticamente, así que corre el segundo: si no hay
-- acuerdo, el error que ve el usuario sigue siendo PARTNER_SIN_ACUERDO.
-- ---------------------------------------------------------------------------
create or replace function platform.enforce_agreement_scope()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_agreement record;
  v_active    integer;
  v_product   text;
begin
  if new.managing_organization_id is null then
    return new;
  end if;

  select a.* into v_agreement
    from platform.organization_product_agreements a
   where a.organization_id = new.managing_organization_id
     and a.saas_product_id = new.saas_product_id
     and a.status = 'ACTIVE'
     and a.can_manage_tenants
     and a.valid_from <= current_date
     and (a.valid_to is null or a.valid_to >= current_date);

  -- Sin acuerdo no se llega aquí: el guard del baseline ya habrá abortado.
  if v_agreement is null then
    return new;
  end if;

  select sp.code into v_product from platform.saas_products sp where sp.id = new.saas_product_id;

  if not (new.deployment_mode = any (v_agreement.allowed_deployment_modes)) then
    raise exception 'MODO_NO_AUTORIZADO: el acuerdo del canal para % permite % y se pidió %',
      v_product, v_agreement.allowed_deployment_modes, new.deployment_mode
      using errcode = '42501';
  end if;

  if not (new.tenant_type = any (v_agreement.allowed_tenant_types)) then
    raise exception 'TIPO_TENANT_NO_AUTORIZADO: el acuerdo del canal para % permite % y se pidió %',
      v_product, v_agreement.allowed_tenant_types, new.tenant_type
      using errcode = '42501';
  end if;

  -- El tope cuenta tenants VIVOS, no históricos: dar de baja uno libera cupo.
  if v_agreement.max_tenants is not null then
    select count(*) into v_active
      from platform.tenants t
     where t.managing_organization_id = new.managing_organization_id
       and t.saas_product_id = new.saas_product_id
       and t.status in ('PENDING', 'ACTIVE', 'SUSPENDED')
       and t.id is distinct from new.id;

    if v_active >= v_agreement.max_tenants then
      raise exception 'LIMITE_TENANTS_ALCANZADO: el acuerdo del canal para % permite % tenants y ya administra %',
        v_product, v_agreement.max_tenants, v_active
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger tenants_v2_agreement_scope_guard
  before insert or update of deployment_mode, tenant_type, managing_organization_id, saas_product_id
  on platform.tenants
  for each row execute function platform.enforce_agreement_scope();

comment on function platform.enforce_agreement_scope() is
  'Aplica los LÍMITES del acuerdo de canal (modos, tipos, tope de tenants). '
  'Complementa a enforce_tenant_manager_agreement del baseline, que no se toca.';

-- ---------------------------------------------------------------------------
-- 4. RPC de alta/edición del acuerdo.
--
-- SOLO EBIM. Un partner no puede concederse a sí mismo margen, modos ni cupo:
-- por eso `authenticated` conserva su GRANT de INSERT/UPDATE sobre la tabla
-- (viene del baseline) pero la consola entra siempre por aquí, y la Fase 16
-- comprueba que un partner admin recibe 42501 al llamar esta función.
-- ---------------------------------------------------------------------------
create or replace function platform.upsert_product_agreement(
  p_organization_id         uuid,
  p_saas_product_id         uuid,
  p_can_resell              boolean default true,
  p_can_manage_tenants      boolean default true,
  p_margin_rate             numeric default 0,
  p_default_deployment_mode platform.deployment_mode default 'SHARED',
  p_allowed_deployment_modes platform.deployment_mode[]
    default array['SHARED','PARTNER_DEDICATED','TENANT_DEDICATED']::platform.deployment_mode[],
  p_allowed_tenant_types    platform.tenant_type[]
    default array['PRODUCTION','TRIAL','DEMO','SANDBOX']::platform.tenant_type[],
  p_billing_responsibility  platform.billing_responsibility default 'EBIM',
  p_max_tenants             integer default null,
  p_valid_from              date default current_date,
  p_valid_to                date default null,
  p_status                  platform.entity_status default 'ACTIVE',
  p_notes                   text default null,
  p_terms                   jsonb default '{}'::jsonb,
  p_id                      uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id      uuid;
  v_is_new  boolean := p_id is null;
  v_product text;
  v_org     text;
  v_existing uuid;
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: solo EBIM define las condiciones comerciales de un canal'
      using errcode = '42501';
  end if;

  select display_name into v_org from platform.organizations where id = p_organization_id;
  if v_org is null then
    raise exception 'ORGANIZACION_NO_ENCONTRADA: %', p_organization_id using errcode = '23503';
  end if;

  select code into v_product from platform.saas_products where id = p_saas_product_id;
  if v_product is null then
    raise exception 'PRODUCTO_NO_ENCONTRADO: %', p_saas_product_id using errcode = '23503';
  end if;

  if coalesce(p_margin_rate, 0) < 0 or coalesce(p_margin_rate, 0) > 1 then
    raise exception 'MARGEN_INVALIDO: margin_rate debe estar en [0, 1]; recibido %', p_margin_rate
      using errcode = '23514';
  end if;
  if array_length(p_allowed_deployment_modes, 1) is null then
    raise exception 'MODOS_REQUERIDOS: el acuerdo debe permitir al menos un modelo de despliegue'
      using errcode = '23514';
  end if;
  if not (p_default_deployment_mode = any (p_allowed_deployment_modes)) then
    raise exception 'MODO_DEFECTO_NO_PERMITIDO: el modelo por defecto % no está entre los permitidos %',
      p_default_deployment_mode, p_allowed_deployment_modes
      using errcode = '23514';
  end if;
  if p_max_tenants is not null and p_max_tenants < 1 then
    raise exception 'TOPE_INVALIDO: max_tenants debe ser >= 1 o NULL para ilimitado'
      using errcode = '23514';
  end if;

  -- El índice parcial `opa_active_uk` ya impide dos acuerdos ACTIVE por
  -- organización+producto. Se reutiliza el existente en vez de chocar con él.
  if v_is_new then
    select id into v_existing
      from platform.organization_product_agreements
     where organization_id = p_organization_id
       and saas_product_id = p_saas_product_id
       and status = 'ACTIVE';
    p_id := v_existing;
    v_is_new := v_existing is null;
  end if;

  if v_is_new then
    insert into platform.organization_product_agreements (
      organization_id, saas_product_id, can_resell, can_manage_tenants, margin_rate,
      default_deployment_mode, allowed_deployment_modes, allowed_tenant_types,
      billing_responsibility, max_tenants, valid_from, valid_to, status, notes, terms
    ) values (
      p_organization_id, p_saas_product_id, p_can_resell, p_can_manage_tenants,
      coalesce(p_margin_rate, 0), p_default_deployment_mode, p_allowed_deployment_modes,
      p_allowed_tenant_types, p_billing_responsibility, p_max_tenants,
      p_valid_from, p_valid_to, p_status, p_notes, coalesce(p_terms, '{}'::jsonb)
    )
    returning id into v_id;
  else
    update platform.organization_product_agreements
       set can_resell = p_can_resell,
           can_manage_tenants = p_can_manage_tenants,
           margin_rate = coalesce(p_margin_rate, 0),
           default_deployment_mode = p_default_deployment_mode,
           allowed_deployment_modes = p_allowed_deployment_modes,
           allowed_tenant_types = p_allowed_tenant_types,
           billing_responsibility = p_billing_responsibility,
           max_tenants = p_max_tenants,
           valid_from = p_valid_from,
           valid_to = p_valid_to,
           status = p_status,
           notes = p_notes,
           terms = coalesce(p_terms, '{}'::jsonb)
     where id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception 'ACUERDO_NO_ENCONTRADO: %', p_id using errcode = '23503';
    end if;
  end if;

  perform platform.log_audit(
    case when v_is_new then 'AGREEMENT_CREATED' else 'AGREEMENT_UPDATED' end,
    'organization_product_agreement', v_id::text, p_organization_id, null,
    jsonb_build_object(
      'organization', v_org, 'product', v_product,
      'margin_rate', p_margin_rate, 'can_resell', p_can_resell,
      'can_manage_tenants', p_can_manage_tenants,
      'allowed_deployment_modes', to_jsonb(p_allowed_deployment_modes),
      'allowed_tenant_types', to_jsonb(p_allowed_tenant_types),
      'billing_responsibility', p_billing_responsibility,
      'max_tenants', p_max_tenants
    )
  );

  return v_id;
end;
$$;

comment on function platform.upsert_product_agreement is
  'Condiciones de un canal para UN producto. Un partner puede tener N acuerdos con '
  'márgenes distintos: eSupplier al 25% y WMS al 18% son dos filas, no dos partners.';

-- ---------------------------------------------------------------------------
-- 5. Cierre de acuerdo. No se borra: los tenants vivos y las comisiones ya
--    devengadas se explican por el acuerdo que estaba vigente entonces.
-- ---------------------------------------------------------------------------
create or replace function platform.end_product_agreement(
  p_agreement_id uuid,
  p_valid_to     date default current_date,
  p_reason       text default null
)
returns void
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_agreement record;
  v_tenants   integer;
begin
  if not platform.can_manage_platform_entities() then
    raise exception 'NO_AUTORIZADO: solo EBIM cierra acuerdos de canal' using errcode = '42501';
  end if;

  select * into v_agreement
    from platform.organization_product_agreements where id = p_agreement_id;
  if v_agreement is null then
    raise exception 'ACUERDO_NO_ENCONTRADO: %', p_agreement_id using errcode = '23503';
  end if;

  select count(*) into v_tenants
    from platform.tenants t
   where t.managing_organization_id = v_agreement.organization_id
     and t.saas_product_id = v_agreement.saas_product_id
     and t.status in ('PENDING', 'ACTIVE');

  if v_tenants > 0 then
    raise exception 'ACUERDO_CON_TENANTS_VIVOS: el canal aún administra % tenant(s) de este producto; traspásalos o dales de baja antes de cerrar el acuerdo',
      v_tenants
      using errcode = '23514';
  end if;

  update platform.organization_product_agreements
     set status = 'INACTIVE', valid_to = p_valid_to
   where id = p_agreement_id;

  perform platform.log_audit(
    'AGREEMENT_ENDED', 'organization_product_agreement', p_agreement_id::text,
    v_agreement.organization_id, null,
    jsonb_build_object('valid_to', p_valid_to, 'reason', p_reason)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Vista 360 del canal: qué vende, cuántos tenants administra y bajo qué
--    condiciones. Alimenta la pantalla de Partners (Fase 04 §6).
-- ---------------------------------------------------------------------------
-- `security_invoker = true` NO es opcional: sin él la vista se ejecuta con los
-- privilegios de su dueño y se convierte en un bypass de RLS — un partner vería
-- los acuerdos de otro. El test 8 de `00_structure.test.sql` lo comprueba.
create or replace view platform.v_partner_agreements
with (security_invoker = true) as
select
  a.id                        as agreement_id,
  a.organization_id,
  o.display_name              as organization_name,
  o.slug                      as organization_slug,
  a.saas_product_id,
  p.code                      as product_code,
  p.short_name                as product_short_name,
  a.can_resell,
  a.can_manage_tenants,
  a.margin_rate,
  a.default_deployment_mode,
  a.allowed_deployment_modes,
  a.allowed_tenant_types,
  a.billing_responsibility,
  a.max_tenants,
  a.valid_from,
  a.valid_to,
  a.status,
  a.notes,
  -- Tenants vivos que este canal administra de este producto.
  (select count(*) from platform.tenants t
    where t.managing_organization_id = a.organization_id
      and t.saas_product_id = a.saas_product_id
      and t.status in ('PENDING', 'ACTIVE', 'SUSPENDED'))          as managed_tenants,
  (select count(*) from platform.tenants t
    where t.managing_organization_id = a.organization_id
      and t.saas_product_id = a.saas_product_id
      and t.status = 'ACTIVE'
      and t.deployment_mode = 'SHARED')                            as shared_tenants,
  -- MRR atribuible al canal en ese producto, sin mezclar monedas.
  (select coalesce(sum(m.mrr), 0) from platform.v_subscription_mrr m
     join platform.subscriptions s on s.id = m.subscription_id
     left join platform.tenants t on t.id = s.tenant_id
    where s.saas_product_id = a.saas_product_id
      and (s.billed_organization_id = a.organization_id
        or t.managing_organization_id = a.organization_id))        as channel_mrr
from platform.organization_product_agreements a
join platform.organizations o on o.id = a.organization_id
join platform.saas_products  p on p.id = a.saas_product_id;

comment on view platform.v_partner_agreements is
  'Acuerdos de canal con su uso real. `shared_tenants` existe para dejar claro que un '
  'partner con muchos tenants en SHARED sigue siendo Shared, no Partner Dedicated.';

-- Con security_invoker la vista evalúa las políticas de sus tablas base con el rol
-- que consulta, así que un partner admin solo ve sus propios acuerdos.
grant select on platform.v_partner_agreements to authenticated;
revoke all on platform.v_partner_agreements from anon;

-- ---------------------------------------------------------------------------
-- 7. GRANTS
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'platform'
       and p.proname in ('upsert_product_agreement', 'end_product_agreement', 'enforce_agreement_scope')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;
