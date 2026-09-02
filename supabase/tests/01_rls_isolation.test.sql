-- ============================================================================
-- Tests de AISLAMIENTO RLS (positivos y negativos)
-- ----------------------------------------------------------------------------
-- Se simula una sesión de Supabase Auth fijando el rol `authenticated` y el
-- claim `sub` en `request.jwt.claims` — que es exactamente de donde `auth.uid()`
-- lee el usuario. No se falsean las políticas: se ejecutan tal cual en producción.
--
-- Sujetos (del seed):
--   dcalagua@ebim.pe            -> EBIM_SUPER_ADMIN
--   finance@ebim.test           -> EBIM_FINANCE
--   admin@andina.ebim.test      -> PARTNER_ADMIN de Consultora Andina
--   admin@pacifico.ebim.test    -> PARTNER_ADMIN de Reseller Pacífico
--   comercial@indep.ebim.test   -> SALES_AGENT independiente (Carla)
--   admin@alpha.ebim.test       -> TENANT_ADMIN de alpha-esupplier
--   admin@omega.ebim.test       -> TENANT_ADMIN de omega-esupplier
-- ============================================================================
begin;
select plan(20);

create or replace function pg_temp.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end;
$$;

create or replace function pg_temp.act_as_postgres()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1-2. EBIM_SUPER_ADMIN administra entidades globales.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000001');

select is(
  (select count(*)::int from platform.organizations), 10,
  'SUPER_ADMIN ve las 10 organizaciones'
);
select is(
  (select count(*)::int from platform.tenants), 13,
  'SUPER_ADMIN ve los 13 tenants de todos los productos'
);

-- ---------------------------------------------------------------------------
-- 3-6. PARTNER_ADMIN: sólo su organización. Cross-partner DENEGADO.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000004');  -- Andina

select ok(
  exists (select 1 from platform.organizations
           where id = '30000000-0000-4000-a000-000000000002'),
  'PARTNER_ADMIN de Andina ve su propia organización'
);

-- NEGATIVO: Reseller Pacífico es otro partner, sin relación con Andina.
select ok(
  not exists (select 1 from platform.organizations
               where id = '30000000-0000-4000-a000-000000000003'),
  'CROSS-PARTNER DENEGADO: Andina no ve a Reseller Pacífico'
);

select ok(
  (select count(*) from platform.tenants
    where managing_organization_id = '30000000-0000-4000-a000-000000000002') >= 4,
  'PARTNER_ADMIN de Andina ve los tenants que administra'
);

-- NEGATIVO: los tenants de Pacífico son de otro partner.
select is(
  (select count(*)::int from platform.tenants
    where managing_organization_id = '30000000-0000-4000-a000-000000000003'), 0,
  'CROSS-PARTNER DENEGADO: Andina no ve ningún tenant de Reseller Pacífico'
);

-- ---------------------------------------------------------------------------
-- 7-8. Un partner no ve las finanzas de otra organización.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from platform.invoices
    where customer_organization_id = '30000000-0000-4000-a000-000000000003'), 0,
  'CROSS-ORG DENEGADO: Andina no ve facturas de Reseller Pacífico'
);

-- Los costos son información interna de EBIM: ningún partner los ve.
select is(
  (select count(*)::int from platform.cost_entries), 0,
  'Un PARTNER_ADMIN no ve NINGÚN cost_entry (costos = interno EBIM)'
);

-- ---------------------------------------------------------------------------
-- 9-11. TENANT_ADMIN: sólo su tenant. Cross-tenant DENEGADO.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000009');  -- Alicia Alpha

select ok(
  exists (select 1 from platform.tenants
           where id = '50000000-0000-4000-a000-000000000001'),
  'TENANT_ADMIN de Alpha ve su tenant alpha-esupplier'
);

-- NEGATIVO: omega-esupplier es de otra organización.
select ok(
  not exists (select 1 from platform.tenants
               where id = '50000000-0000-4000-a000-000000000007'),
  'CROSS-TENANT DENEGADO: el admin de Alpha no ve el tenant de Omega'
);

select ok(
  not exists (select 1 from platform.tenant_settings
               where tenant_id = '50000000-0000-4000-a000-000000000007'),
  'CROSS-TENANT DENEGADO: tampoco ve los settings del tenant de Omega'
);

-- ---------------------------------------------------------------------------
-- 12-16. SALES_AGENT: dominio COMERCIAL, nunca operacional.
--        Este es el bloque que prueba la regla §2.3 del prompt.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('10000000-0000-4000-a000-000000000008');  -- Carla

select ok(
  (select count(*) from platform.sales_attributions) >= 2,
  'SALES_AGENT ve sus propias atribuciones (2 productos distintos)'
);

-- NEGATIVO: las atribuciones de OTRO comercial no se ven.
select is(
  (select count(*)::int from platform.sales_attributions
    where sales_agent_id = '80000000-0000-4000-a000-000000000002'), 0,
  'SALES_AGENT no ve las atribuciones de otro comercial (Beto)'
);

-- NEGATIVO: tampoco sus comisiones.
select is(
  (select count(*)::int from platform.commission_events
    where sales_agent_id <> '80000000-0000-4000-a000-000000000001'), 0,
  'SALES_AGENT no ve NINGÚN commission_event de otro comercial'
);

select ok(
  (select count(*) from platform.commission_events
    where sales_agent_id = '80000000-0000-4000-a000-000000000001') > 0,
  'SALES_AGENT sí ve sus propias comisiones devengadas'
);

-- CLAVE (§2.3): vender un tenant NO da acceso operacional.
-- Carla vendió alpha-esupplier y titan-ewm; no tiene membership en ninguno.
select is(
  (select count(*)::int from platform.tenant_memberships
    where tenant_id in ('50000000-0000-4000-a000-000000000001',
                        '50000000-0000-4000-a000-00000000000d')
      and user_id = '10000000-0000-4000-a000-000000000008'), 0,
  'ACCESO OPERACIONAL DENEGADO: el comercial que vendió el tenant NO es miembro'
);

-- ---------------------------------------------------------------------------
-- 17-18. Un usuario SIN membresías no obtiene filas privadas.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-4000-a000-0000000000ff');  -- no existe

select is(
  (select count(*)::int from platform.tenants), 0,
  'Un usuario sin membership no ve NINGÚN tenant'
);
select is(
  (select count(*)::int from platform.invoices), 0,
  'Un usuario sin membership no ve NINGUNA factura'
);

-- ---------------------------------------------------------------------------
-- 19-20. anon está cerrado. Ni siquiera puede resolver el schema.
-- ---------------------------------------------------------------------------
select pg_temp.act_as_anon();

select throws_ok(
  'select count(*) from platform.tenants',
  '42501',
  null,
  'anon NO puede consultar platform.tenants (permiso denegado)'
);
select throws_ok(
  'select count(*) from platform.invoices',
  '42501',
  null,
  'anon NO puede consultar platform.invoices (permiso denegado)'
);

select pg_temp.act_as_postgres();
select * from finish();
rollback;
