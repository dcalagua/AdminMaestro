-- ============================================================================
-- EBIM Control Plane — SEED DEMO (determinista)
-- ----------------------------------------------------------------------------
-- NO USAR EN PRODUCCIÓN. Datos ficticios.
--
-- Gobernanza (contrato §11): ninguna cuenta real. Los usuarios de prueba usan
-- el dominio de fixtures `@ebim.test`. El super admin `dcalagua@ebim.pe` se crea
-- porque el contrato §13 lo define como el único operador de la suite, y sin él
-- no se puede demostrar el rol EBIM_SUPER_ADMIN.
--
-- Los UUID son FIJOS para que el seed sea reproducible y los tests puedan
-- referenciar sujetos concretos.
--
-- Escenarios cubiertos (docs/demo/DEMO_SCENARIOS.md):
--   1. eSupplier SHARED            - cliente directo EBIM
--   2. eSupplier SHARED            - Consultora Andina con 2 tenants
--   3. eSupplier PARTNER_DEDICATED - Consultora Andina
--   4. eSupplier TENANT_DEDICATED  - Empresa Enterprise Omega
--   5. EWM SHARED                  - 2 tenants
--   6. EWM PARTNER_DEDICATED       - Reseller Pacífico con 2 clientes
--   7. EWM TENANT_DEDICATED        - cliente Enterprise
--   8. Partner multi-SaaS          - Consultora Andina (eSupplier + EWM)
--   9. Comercial independiente     - atribuido en 2 productos, SIN membership
-- ============================================================================

set search_path = platform, public, pg_catalog;

-- ---------------------------------------------------------------------------
-- 0. Usuarios de autenticación (fixtures)
-- ---------------------------------------------------------------------------
-- Se insertan directamente en auth.users porque el seed corre server-side.
-- La contraseña es la MISMA para todos y sólo sirve en local: `Ebim.Demo2026!`.
-- No es un secreto reutilizable — está documentada en el README como credencial
-- de entorno local y no existe fuera de este stack.
do $$
declare
  v_users constant jsonb := jsonb_build_array(
    jsonb_build_object('id', '10000000-0000-4000-a000-000000000001', 'email', 'dcalagua@ebim.pe',            'name', 'Dennis Calagua (Operador)'),
    jsonb_build_object('id', '10000000-0000-4000-a000-000000000002', 'email', 'product.admin@ebim.test',     'name', 'Paula Producto'),
    jsonb_build_object('id', '10000000-0000-4000-a000-000000000003', 'email', 'finance@ebim.test',           'name', 'Fabio Finanzas'),
    jsonb_build_object('id', '10000000-0000-4000-a000-000000000004', 'email', 'admin@andina.ebim.test',      'name', 'Ana Andina (Partner Admin)'),
    jsonb_build_object('id', '10000000-0000-4000-a000-000000000005', 'email', 'ventas@andina.ebim.test',     'name', 'Beto Andina (Partner Sales)'),
    jsonb_build_object('id', '10000000-0000-4000-a000-000000000006', 'email', 'soporte@andina.ebim.test',    'name', 'Sara Andina (Partner Support)'),
    jsonb_build_object('id', '10000000-0000-4000-a000-000000000007', 'email', 'admin@pacifico.ebim.test',    'name', 'Pablo Pacífico (Partner Admin)'),
    jsonb_build_object('id', '10000000-0000-4000-a000-000000000008', 'email', 'comercial@indep.ebim.test',   'name', 'Carla Comercial (Independiente)'),
    jsonb_build_object('id', '10000000-0000-4000-a000-000000000009', 'email', 'admin@alpha.ebim.test',       'name', 'Alicia Alpha (Tenant Admin)'),
    jsonb_build_object('id', '10000000-0000-4000-a000-00000000000a', 'email', 'admin@omega.ebim.test',       'name', 'Omar Omega (Tenant Admin)'),
    jsonb_build_object('id', '10000000-0000-4000-a000-00000000000b', 'email', 'user@alpha.ebim.test',        'name', 'Ale Alpha (Tenant User)'),
    jsonb_build_object('id', '10000000-0000-4000-a000-00000000000c', 'email', 'admin@clientep1.ebim.test',   'name', 'Cesar Cliente Uno')
  );
  v_u jsonb;
begin
  for v_u in select * from jsonb_array_elements(v_users) loop
    -- Las columnas de token de GoTrue deben ser '' y NUNCA NULL: su driver las
    -- escanea como string y un NULL rompe TODO login con
    -- "Database error querying schema" (500), sin decir qué usuario ni qué
    -- columna. Es el fallo clásico de sembrar auth.users a mano.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      (v_u ->> 'id')::uuid,
      'authenticated', 'authenticated',
      v_u ->> 'email',
      extensions.crypt('Ebim.Demo2026!', extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_u ->> 'name'),
      now(), now(),
      '', '', '', '', '', '', '', ''
    )
    on conflict (id) do nothing;

    insert into auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    )
    values (
      v_u ->> 'id',
      (v_u ->> 'id')::uuid,
      jsonb_build_object('sub', v_u ->> 'id', 'email', v_u ->> 'email', 'email_verified', true),
      'email', now(), now(), now()
    )
    on conflict (provider, provider_id) do nothing;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Roles de plataforma (contrato §13)
-- ---------------------------------------------------------------------------
insert into platform.platform_admins (user_id, role) values
  ('10000000-0000-4000-a000-000000000001', 'EBIM_SUPER_ADMIN'),
  ('10000000-0000-4000-a000-000000000002', 'EBIM_PRODUCT_ADMIN'),
  ('10000000-0000-4000-a000-000000000003', 'EBIM_FINANCE')
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Catálogo de SaaS — añadir un producto es una FILA, no una columna
-- ---------------------------------------------------------------------------
insert into platform.saas_products (id, code, name, short_name, description, accent_color, billing_unit, sort_order) values
  ('20000000-0000-4000-a000-000000000001', 'esupplier', 'eSupplier by EBIM', 'eSupplier',
   'Portal y gestión de proveedores, homologación y licitaciones.', '#056769', 'TENANT', 10),
  ('20000000-0000-4000-a000-000000000002', 'ewm', 'EWM by EBIM', 'EWM',
   'Gestión de almacenes y ejecución logística.', '#5AA97F', 'WAREHOUSE', 20),
  ('20000000-0000-4000-a000-000000000003', 'tms', 'TMS by EBIM', 'TMS',
   'Gestión de transporte y distribución.', '#2B7A9B', 'TENANT', 30),
  ('20000000-0000-4000-a000-000000000004', 'gmao', 'GMAO by EBIM', 'GMAO',
   'Mantenimiento y gestión de activos (EAM/CMMS).', '#185D4A', 'TENANT', 40),
  ('20000000-0000-4000-a000-000000000005', 'echange', 'eChange by EBIM', 'eChange',
   'Mesa de ayuda y gestión del cambio.', '#8A5CB8', 'TENANT', 50)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Organizaciones
-- ---------------------------------------------------------------------------
insert into platform.organizations (id, slug, legal_name, display_name, kind, country_code, tax_id, accent_color, brand_slug, billing_email) values
  ('30000000-0000-4000-a000-000000000001', 'ebim', 'EBIM S.A.C.', 'EBIM', 'PLATFORM', 'PE', '20500000001', '#5AA97F', 'ebim', 'facturacion@grupoebim.com'),
  ('30000000-0000-4000-a000-000000000002', 'consultora-andina', 'Consultora Andina S.A.C.', 'Consultora Andina', 'COMPANY', 'PE', '20500000002', '#0B6B8F', 'andina', 'cuentas@andina.ebim.test'),
  ('30000000-0000-4000-a000-000000000003', 'reseller-pacifico', 'Reseller Pacífico S.A.', 'Reseller Pacífico', 'COMPANY', 'CL', '76500000-3', '#B06B00', 'pacifico', 'cuentas@pacifico.ebim.test'),
  ('30000000-0000-4000-a000-000000000004', 'empresa-directa-alpha', 'Empresa Directa Alpha S.A.C.', 'Empresa Directa Alpha', 'COMPANY', 'PE', '20500000004', null, 'alpha', 'pagos@alpha.ebim.test'),
  ('30000000-0000-4000-a000-000000000005', 'empresa-enterprise-omega', 'Empresa Enterprise Omega S.A.', 'Empresa Enterprise Omega', 'COMPANY', 'PE', '20500000005', '#1F3A5F', 'omega', 'tesoreria@omega.ebim.test'),
  ('30000000-0000-4000-a000-000000000006', 'cliente-partner-uno', 'Cliente Partner Uno S.A.C.', 'Cliente Partner Uno', 'COMPANY', 'PE', '20500000006', null, null, 'pagos@clientep1.ebim.test'),
  ('30000000-0000-4000-a000-000000000007', 'cliente-partner-dos', 'Cliente Partner Dos S.A.C.', 'Cliente Partner Dos', 'COMPANY', 'PE', '20500000007', null, null, 'pagos@clientep2.ebim.test'),
  ('30000000-0000-4000-a000-000000000008', 'cliente-ewm-norte', 'Cliente EWM Norte S.A.', 'Cliente EWM Norte', 'COMPANY', 'CL', '76500008-1', null, null, 'pagos@ewmnorte.ebim.test'),
  ('30000000-0000-4000-a000-000000000009', 'cliente-ewm-sur', 'Cliente EWM Sur S.A.', 'Cliente EWM Sur', 'COMPANY', 'CL', '76500009-8', null, null, 'pagos@ewmsur.ebim.test'),
  ('30000000-0000-4000-a000-00000000000a', 'industrias-titan', 'Industrias Titán S.A.C.', 'Industrias Titán', 'COMPANY', 'PE', '20500000010', null, 'titan', 'pagos@titan.ebim.test')
on conflict (slug) do nothing;

-- Capacidades. Consultora Andina es PARTNER *y* CUSTOMER: el modelo lo soporta
-- sin duplicar la cuenta (D-006).
insert into platform.organization_capabilities (organization_id, capability) values
  ('30000000-0000-4000-a000-000000000002', 'PARTNER'),
  ('30000000-0000-4000-a000-000000000002', 'CONSULTING'),
  ('30000000-0000-4000-a000-000000000002', 'CUSTOMER'),
  ('30000000-0000-4000-a000-000000000003', 'PARTNER'),
  ('30000000-0000-4000-a000-000000000003', 'RESELLER'),
  ('30000000-0000-4000-a000-000000000004', 'CUSTOMER'),
  ('30000000-0000-4000-a000-000000000005', 'CUSTOMER'),
  ('30000000-0000-4000-a000-000000000006', 'CUSTOMER'),
  ('30000000-0000-4000-a000-000000000007', 'CUSTOMER'),
  ('30000000-0000-4000-a000-000000000008', 'CUSTOMER'),
  ('30000000-0000-4000-a000-000000000009', 'CUSTOMER'),
  ('30000000-0000-4000-a000-00000000000a', 'CUSTOMER')
on conflict do nothing;

-- Sociedades (contrato §3.1 Modelo A: multipaís dentro de la misma cuenta).
insert into platform.companies (id, organization_id, name, country_code, currency, tax_id, erp_code, is_default) values
  ('31000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000004', 'Alpha Perú', 'PE', 'PEN', '20500000004', '1000', true),
  ('31000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000005', 'Omega Perú', 'PE', 'PEN', '20500000005', '1000', true),
  ('31000000-0000-4000-a000-000000000003', '30000000-0000-4000-a000-000000000005', 'Omega Colombia', 'CO', 'COP', '900500005-1', '1000', false),
  ('31000000-0000-4000-a000-000000000004', '30000000-0000-4000-a000-000000000002', 'Andina Perú', 'PE', 'PEN', '20500000002', '2000', true),
  ('31000000-0000-4000-a000-000000000005', '30000000-0000-4000-a000-000000000006', 'Cliente Partner Uno', 'PE', 'PEN', '20500000006', '3000', true),
  ('31000000-0000-4000-a000-000000000006', '30000000-0000-4000-a000-000000000007', 'Cliente Partner Dos', 'PE', 'PEN', '20500000007', '3000', true),
  ('31000000-0000-4000-a000-000000000007', '30000000-0000-4000-a000-000000000008', 'EWM Norte Chile', 'CL', 'CLP', '76500008-1', '4000', true),
  ('31000000-0000-4000-a000-000000000008', '30000000-0000-4000-a000-000000000009', 'EWM Sur Chile', 'CL', 'CLP', '76500009-8', '4000', true),
  ('31000000-0000-4000-a000-000000000009', '30000000-0000-4000-a000-00000000000a', 'Titán Perú', 'PE', 'PEN', '20500000010', '5000', true)
on conflict (id) do nothing;

-- Relaciones comerciales.
insert into platform.organization_relationships (parent_organization_id, child_organization_id, relationship_type) values
  ('30000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000006', 'MANAGES'),
  ('30000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000007', 'MANAGES'),
  ('30000000-0000-4000-a000-000000000003', '30000000-0000-4000-a000-000000000008', 'RESELLS_TO'),
  ('30000000-0000-4000-a000-000000000003', '30000000-0000-4000-a000-000000000009', 'RESELLS_TO')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Memberships
-- ---------------------------------------------------------------------------
insert into platform.organization_memberships (user_id, organization_id, role) values
  ('10000000-0000-4000-a000-000000000004', '30000000-0000-4000-a000-000000000002', 'PARTNER_ADMIN'),
  ('10000000-0000-4000-a000-000000000005', '30000000-0000-4000-a000-000000000002', 'PARTNER_SALES'),
  ('10000000-0000-4000-a000-000000000006', '30000000-0000-4000-a000-000000000002', 'PARTNER_SUPPORT'),
  ('10000000-0000-4000-a000-000000000007', '30000000-0000-4000-a000-000000000003', 'PARTNER_ADMIN'),
  ('10000000-0000-4000-a000-000000000009', '30000000-0000-4000-a000-000000000004', 'ORG_ADMIN'),
  ('10000000-0000-4000-a000-00000000000a', '30000000-0000-4000-a000-000000000005', 'ORG_ADMIN'),
  ('10000000-0000-4000-a000-00000000000c', '30000000-0000-4000-a000-000000000006', 'ORG_ADMIN')
on conflict (user_id, organization_id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Acuerdos por producto — ESCENARIO 8: partner multi-SaaS con condiciones
--    DIFERENTES por producto.
-- ---------------------------------------------------------------------------
insert into platform.organization_product_agreements
  (organization_id, saas_product_id, can_resell, can_manage_tenants, margin_rate, default_deployment_mode, terms) values
  -- Consultora Andina: eSupplier con 25% de margen...
  ('30000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000001', true, true, 0.2500, 'SHARED',
   '{"nivel":"GOLD","soporte_incluido":true,"incluye_implementacion":true}'::jsonb),
  -- ...y EWM con 18%: mismo partner, condiciones distintas (contrato §11.1).
  ('30000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000002', true, true, 0.1800, 'SHARED',
   '{"nivel":"SILVER","soporte_incluido":false,"incluye_implementacion":false}'::jsonb),
  -- Reseller Pacífico: sólo EWM, con infraestructura dedicada por defecto.
  ('30000000-0000-4000-a000-000000000003', '20000000-0000-4000-a000-000000000002', true, true, 0.2000, 'PARTNER_DEDICATED',
   '{"nivel":"GOLD","region":"CL"}'::jsonb)
on conflict do nothing;

insert into platform.workspace_apps (organization_id, saas_product_id, status, activated_at) values
  ('30000000-0000-4000-a000-000000000004', '20000000-0000-4000-a000-000000000001', 'active', now()),
  ('30000000-0000-4000-a000-000000000005', '20000000-0000-4000-a000-000000000001', 'active', now()),
  ('30000000-0000-4000-a000-000000000006', '20000000-0000-4000-a000-000000000001', 'active', now()),
  ('30000000-0000-4000-a000-000000000007', '20000000-0000-4000-a000-000000000001', 'active', now()),
  ('30000000-0000-4000-a000-000000000008', '20000000-0000-4000-a000-000000000002', 'active', now()),
  ('30000000-0000-4000-a000-000000000009', '20000000-0000-4000-a000-000000000002', 'active', now()),
  ('30000000-0000-4000-a000-00000000000a', '20000000-0000-4000-a000-000000000002', 'active', now())
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 6. Deployment targets — la infraestructura FÍSICA
-- ---------------------------------------------------------------------------
insert into platform.deployment_targets
  (id, code, name, provider, deployment_mode, environment, region, provider_project_ref, owner_organization_id, saas_product_id, cost_center) values
  ('40000000-0000-4000-a000-000000000001', 'shared-esupplier-sa-east', 'Shared eSupplier · sa-east-1', 'SUPABASE', 'SHARED', 'PRODUCTION', 'sa-east-1', 'demoesupshared01', null, '20000000-0000-4000-a000-000000000001', 'CC-SHARED-ESUP'),
  ('40000000-0000-4000-a000-000000000002', 'shared-ewm-sa-east', 'Shared EWM · sa-east-1', 'SUPABASE', 'SHARED', 'PRODUCTION', 'sa-east-1', 'demoewmshared01', null, '20000000-0000-4000-a000-000000000002', 'CC-SHARED-EWM'),
  ('40000000-0000-4000-a000-000000000003', 'andina-esupplier-dedicated', 'Consultora Andina · eSupplier dedicado', 'SUPABASE', 'PARTNER_DEDICATED', 'PRODUCTION', 'sa-east-1', 'demoandinaesup01', '30000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000001', 'CC-PD-ANDINA'),
  ('40000000-0000-4000-a000-000000000004', 'pacifico-ewm-dedicated', 'Reseller Pacífico · EWM dedicado', 'SUPABASE', 'PARTNER_DEDICATED', 'PRODUCTION', 'us-west-1', 'demopacificoewm1', '30000000-0000-4000-a000-000000000003', '20000000-0000-4000-a000-000000000002', 'CC-PD-PACIFICO'),
  ('40000000-0000-4000-a000-000000000005', 'omega-esupplier-dedicated', 'Empresa Enterprise Omega · eSupplier exclusivo', 'SUPABASE', 'TENANT_DEDICATED', 'PRODUCTION', 'sa-east-1', 'demoomegaesup001', '30000000-0000-4000-a000-000000000005', '20000000-0000-4000-a000-000000000001', 'CC-TD-OMEGA'),
  ('40000000-0000-4000-a000-000000000006', 'titan-ewm-dedicated', 'Industrias Titán · EWM exclusivo', 'SUPABASE', 'TENANT_DEDICATED', 'PRODUCTION', 'sa-east-1', 'demotitanewm0001', '30000000-0000-4000-a000-00000000000a', '20000000-0000-4000-a000-000000000002', 'CC-TD-TITAN')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Tenants — los 9 escenarios.
--
-- Se insertan directamente (no vía create_tenant) porque el seed corre como
-- superusuario sin sesión auth: create_tenant exige autorización de un actor.
-- La regla ADMIN_EMAIL_REQUERIDO se respeta igual — la columna es NOT NULL y
-- todos traen su administrador nombrado.
-- ---------------------------------------------------------------------------
insert into platform.tenants
  (id, slug, name, saas_product_id, customer_organization_id, managing_organization_id, company_id,
   tenant_type, status, deployment_mode, environment, admin_email, activated_at) values

  -- ESCENARIO 1 — eSupplier SHARED, venta DIRECTA de EBIM
  ('50000000-0000-4000-a000-000000000001', 'alpha-esupplier', 'Empresa Directa Alpha · eSupplier',
   '20000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000004', null,
   '31000000-0000-4000-a000-000000000001', 'PRODUCTION', 'ACTIVE', 'SHARED', 'PRODUCTION',
   'admin@alpha.ebim.test', now() - interval '8 months'),

  -- ESCENARIO 2 — eSupplier SHARED, Consultora Andina administra 2 tenants
  -- en la MISMA infraestructura compartida.
  ('50000000-0000-4000-a000-000000000002', 'cliente-p1-esupplier', 'Cliente Partner Uno · eSupplier',
   '20000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000006', '30000000-0000-4000-a000-000000000002',
   '31000000-0000-4000-a000-000000000005', 'PRODUCTION', 'ACTIVE', 'SHARED', 'PRODUCTION',
   'admin@clientep1.ebim.test', now() - interval '6 months'),
  ('50000000-0000-4000-a000-000000000003', 'cliente-p2-esupplier', 'Cliente Partner Dos · eSupplier',
   '20000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000007', '30000000-0000-4000-a000-000000000002',
   '31000000-0000-4000-a000-000000000006', 'PRODUCTION', 'ACTIVE', 'SHARED', 'PRODUCTION',
   'admin@clientep2.ebim.test', now() - interval '5 months'),

  -- Un DEMO en Shared: no genera cobro recurrente (regla §2.2).
  -- Andina es aquí el CLIENTE de su propio demo (usa su capacidad CUSTOMER), no
  -- el partner que lo administra: managing_organization_id queda NULL.
  ('50000000-0000-4000-a000-000000000004', 'demo-andina-esupplier', 'Demo Andina · eSupplier',
   '20000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000002', null,
   '31000000-0000-4000-a000-000000000004', 'DEMO', 'ACTIVE', 'SHARED', 'DEMO',
   'demo@andina.ebim.test', now() - interval '1 month'),

  -- ESCENARIO 3 — eSupplier PARTNER_DEDICATED (Consultora Andina)
  ('50000000-0000-4000-a000-000000000005', 'andina-pd-cliente-a', 'Andina PD · Cliente A',
   '20000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000006', '30000000-0000-4000-a000-000000000002',
   '31000000-0000-4000-a000-000000000005', 'PRODUCTION', 'ACTIVE', 'PARTNER_DEDICATED', 'PRODUCTION',
   'pd-a@clientep1.ebim.test', now() - interval '4 months'),
  ('50000000-0000-4000-a000-000000000006', 'andina-pd-cliente-b', 'Andina PD · Cliente B',
   '20000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000007', '30000000-0000-4000-a000-000000000002',
   '31000000-0000-4000-a000-000000000006', 'PRODUCTION', 'ACTIVE', 'PARTNER_DEDICATED', 'PRODUCTION',
   'pd-b@clientep2.ebim.test', now() - interval '3 months'),

  -- ESCENARIO 4 — eSupplier TENANT_DEDICATED (Empresa Enterprise Omega)
  ('50000000-0000-4000-a000-000000000007', 'omega-esupplier', 'Empresa Enterprise Omega · eSupplier',
   '20000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000005', null,
   '31000000-0000-4000-a000-000000000002', 'PRODUCTION', 'ACTIVE', 'TENANT_DEDICATED', 'PRODUCTION',
   'admin@omega.ebim.test', now() - interval '10 months'),

  -- ESCENARIO 5 — EWM SHARED, 2 tenants
  ('50000000-0000-4000-a000-000000000008', 'alpha-ewm', 'Empresa Directa Alpha · EWM',
   '20000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000004', null,
   '31000000-0000-4000-a000-000000000001', 'PRODUCTION', 'ACTIVE', 'SHARED', 'PRODUCTION',
   'ewm@alpha.ebim.test', now() - interval '4 months'),
  ('50000000-0000-4000-a000-000000000009', 'p1-ewm', 'Cliente Partner Uno · EWM',
   '20000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000006', '30000000-0000-4000-a000-000000000002',
   '31000000-0000-4000-a000-000000000005', 'PRODUCTION', 'ACTIVE', 'SHARED', 'PRODUCTION',
   'ewm@clientep1.ebim.test', now() - interval '2 months'),

  -- Un TRIAL en EWM Shared
  ('50000000-0000-4000-a000-00000000000a', 'trial-ewm-alpha', 'Trial EWM · Alpha',
   '20000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000004', null,
   '31000000-0000-4000-a000-000000000001', 'TRIAL', 'ACTIVE', 'SHARED', 'TRIAL',
   'trial@alpha.ebim.test', now() - interval '20 days'),

  -- ESCENARIO 6 — EWM PARTNER_DEDICATED (Reseller Pacífico, 2 clientes finales)
  ('50000000-0000-4000-a000-00000000000b', 'ewm-norte', 'Cliente EWM Norte · EWM',
   '20000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000008', '30000000-0000-4000-a000-000000000003',
   '31000000-0000-4000-a000-000000000007', 'PRODUCTION', 'ACTIVE', 'PARTNER_DEDICATED', 'PRODUCTION',
   'admin@ewmnorte.ebim.test', now() - interval '7 months'),
  ('50000000-0000-4000-a000-00000000000c', 'ewm-sur', 'Cliente EWM Sur · EWM',
   '20000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000009', '30000000-0000-4000-a000-000000000003',
   '31000000-0000-4000-a000-000000000008', 'PRODUCTION', 'ACTIVE', 'PARTNER_DEDICATED', 'PRODUCTION',
   'admin@ewmsur.ebim.test', now() - interval '6 months'),

  -- ESCENARIO 7 — EWM TENANT_DEDICATED (Industrias Titán, Enterprise)
  ('50000000-0000-4000-a000-00000000000d', 'titan-ewm', 'Industrias Titán · EWM',
   '20000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-00000000000a', null,
   '31000000-0000-4000-a000-000000000009', 'PRODUCTION', 'ACTIVE', 'TENANT_DEDICATED', 'PRODUCTION',
   'admin@titan.ebim.test', now() - interval '9 months')
on conflict (id) do nothing;

-- Memberships operacionales de tenant. Nótese que Carla (la comercial) NO
-- aparece aquí: vendió y cobra comisión, pero no entra al tenant (§2.3).
insert into platform.tenant_memberships (user_id, tenant_id, role) values
  ('10000000-0000-4000-a000-000000000009', '50000000-0000-4000-a000-000000000001', 'TENANT_ADMIN'),
  ('10000000-0000-4000-a000-00000000000b', '50000000-0000-4000-a000-000000000001', 'TENANT_USER'),
  ('10000000-0000-4000-a000-00000000000a', '50000000-0000-4000-a000-000000000007', 'TENANT_ADMIN'),
  ('10000000-0000-4000-a000-00000000000c', '50000000-0000-4000-a000-000000000002', 'TENANT_ADMIN')
on conflict (user_id, tenant_id) do nothing;

-- Asignación a infraestructura.
insert into platform.tenant_deployments (tenant_id, deployment_target_id, deployed_at) values
  ('50000000-0000-4000-a000-000000000001', '40000000-0000-4000-a000-000000000001', now() - interval '8 months'),
  ('50000000-0000-4000-a000-000000000002', '40000000-0000-4000-a000-000000000001', now() - interval '6 months'),
  ('50000000-0000-4000-a000-000000000003', '40000000-0000-4000-a000-000000000001', now() - interval '5 months'),
  ('50000000-0000-4000-a000-000000000004', '40000000-0000-4000-a000-000000000001', now() - interval '1 month'),
  ('50000000-0000-4000-a000-000000000005', '40000000-0000-4000-a000-000000000003', now() - interval '4 months'),
  ('50000000-0000-4000-a000-000000000006', '40000000-0000-4000-a000-000000000003', now() - interval '3 months'),
  ('50000000-0000-4000-a000-000000000007', '40000000-0000-4000-a000-000000000005', now() - interval '10 months'),
  ('50000000-0000-4000-a000-000000000008', '40000000-0000-4000-a000-000000000002', now() - interval '4 months'),
  ('50000000-0000-4000-a000-000000000009', '40000000-0000-4000-a000-000000000002', now() - interval '2 months'),
  ('50000000-0000-4000-a000-00000000000a', '40000000-0000-4000-a000-000000000002', now() - interval '20 days'),
  ('50000000-0000-4000-a000-00000000000b', '40000000-0000-4000-a000-000000000004', now() - interval '7 months'),
  ('50000000-0000-4000-a000-00000000000c', '40000000-0000-4000-a000-000000000004', now() - interval '6 months'),
  ('50000000-0000-4000-a000-00000000000d', '40000000-0000-4000-a000-000000000006', now() - interval '9 months')
on conflict do nothing;

-- Feature flags y settings de ejemplo.
insert into platform.tenant_features (tenant_id, feature_key, enabled, source) values
  ('50000000-0000-4000-a000-000000000001', 'licitaciones', true,  'PLAN'),
  ('50000000-0000-4000-a000-000000000001', 'homologacion', true,  'PLAN'),
  ('50000000-0000-4000-a000-000000000001', 'ocr',          false, 'ADDON'),
  ('50000000-0000-4000-a000-000000000007', 'licitaciones', true,  'PLAN'),
  ('50000000-0000-4000-a000-000000000007', 'sla_premium',  true,  'ADDON'),
  ('50000000-0000-4000-a000-000000000007', 'white_label',  true,  'ADDON'),
  ('50000000-0000-4000-a000-00000000000d', 'multi_almacen', true, 'PLAN'),
  ('50000000-0000-4000-a000-00000000000d', 'rf_terminales', true, 'PLAN')
on conflict do nothing;

insert into platform.platform_defaults (id, config) values
  (1, '{"branding":{"color":"#5AA97F","portal_name":"EBIM"},"locale":{"lang":"es","timezone":"America/Lima"},"fiscal":{"tax_id_label":"RUC","currency":"PEN","country":"PE"}}'::jsonb)
on conflict (id) do update set config = excluded.config;

insert into platform.org_config (organization_id, config) values
  ('30000000-0000-4000-a000-000000000005', '{"branding":{"portal_name":"Portal Proveedores Omega"},"workflow":{"approval_levels":3}}'::jsonb)
on conflict (organization_id) do nothing;

insert into platform.company_config (company_id, config) values
  ('31000000-0000-4000-a000-000000000003', '{"fiscal":{"tax_id_label":"NIT","currency":"COP","country":"CO"},"locale":{"timezone":"America/Bogota"}}'::jsonb)
on conflict (company_id) do nothing;

-- Catálogo de addons (contrato §6, nombres canónicos de §11.1).
insert into platform.catalog_items (code, name, description, saas_product_id, item_type, scope, available, price_month, currency) values
  ('extra_company',   'Sociedad adicional', 'Sociedad extra sobre las incluidas en el plan.', null, 'addon', 'per-company', true, 120.00, 'USD'),
  ('multi_country',   'Multi-país', 'Sociedades en más de un country_code.', null, 'addon', 'org-wide', true, 250.00, 'USD'),
  ('consolidation',   'Consolidado multi-tenant', 'Reporte agregado entre tenants de la organización.', null, 'addon', 'org-wide', true, 300.00, 'USD'),
  ('white_label',     'Marca blanca', 'Sustituye isotipo, wordmark y acento por los del tenant.', null, 'addon', 'org-wide', true, 400.00, 'USD'),
  ('sla_premium',     'Soporte premium / SLA', 'SLA de respuesta garantizado y soporte dedicado.', null, 'service', 'org-wide', true, 800.00, 'USD'),
  ('licitaciones',    'Licitaciones', 'Módulo de licitaciones y adjudicación.', '20000000-0000-4000-a000-000000000001', 'module', 'per-company', true, 350.00, 'USD'),
  ('echange_desk',    'Mesa de ayuda eChange', 'Entrega de tickets a eChange desde el portal de proveedores.', '20000000-0000-4000-a000-000000000001', 'connector', 'org-wide', false, 0.00, 'USD'),
  ('compras_repuestos','Compras de repuestos', 'Integración eSupplier ↔ GMAO para repuestos.', '20000000-0000-4000-a000-000000000004', 'connector', 'org-wide', false, 0.00, 'USD')
on conflict (code) do nothing;

insert into platform.tenant_addons (tenant_id, addon_code) values
  ('50000000-0000-4000-a000-000000000001', 'licitaciones'),
  ('50000000-0000-4000-a000-000000000007', 'licitaciones'),
  ('50000000-0000-4000-a000-000000000007', 'white_label'),
  ('50000000-0000-4000-a000-000000000007', 'sla_premium'),
  ('50000000-0000-4000-a000-000000000007', 'multi_country'),
  ('50000000-0000-4000-a000-00000000000d', 'sla_premium')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 8. Planes y precios (montos ficticios, documentados en DEMO_SCENARIOS.md)
-- ---------------------------------------------------------------------------
insert into platform.plans (id, code, name, saas_product_id, deployment_mode, included_companies, multi_country, is_partner_base, description) values
  ('60000000-0000-4000-a000-000000000001', 'esupplier-shared-standard', 'eSupplier Shared Standard', '20000000-0000-4000-a000-000000000001', 'SHARED', 1, false, false, 'Licencia por tenant productivo en infraestructura compartida.'),
  ('60000000-0000-4000-a000-000000000002', 'esupplier-partner-base', 'eSupplier Partner Base', '20000000-0000-4000-a000-000000000001', 'PARTNER_DEDICATED', 1, false, true, 'Licencia base del partner con infraestructura dedicada.'),
  ('60000000-0000-4000-a000-000000000003', 'esupplier-partner-tenant', 'eSupplier Partner · Tenant', '20000000-0000-4000-a000-000000000001', 'PARTNER_DEDICATED', 1, false, false, 'Licencia por tenant activo dentro del dedicado del partner.'),
  ('60000000-0000-4000-a000-000000000004', 'esupplier-enterprise', 'eSupplier Enterprise', '20000000-0000-4000-a000-000000000001', 'TENANT_DEDICATED', 3, true, false, 'Licencia Enterprise con infraestructura exclusiva.'),
  ('60000000-0000-4000-a000-000000000005', 'ewm-shared-standard', 'EWM Shared Standard', '20000000-0000-4000-a000-000000000002', 'SHARED', 1, false, false, 'Licencia EWM en infraestructura compartida.'),
  ('60000000-0000-4000-a000-000000000006', 'ewm-partner-base', 'EWM Partner Base', '20000000-0000-4000-a000-000000000002', 'PARTNER_DEDICATED', 1, false, true, 'Licencia base del partner EWM con infraestructura dedicada.'),
  ('60000000-0000-4000-a000-000000000007', 'ewm-partner-tenant', 'EWM Partner · Tenant', '20000000-0000-4000-a000-000000000002', 'PARTNER_DEDICATED', 1, false, false, 'Licencia por tenant activo del partner EWM.'),
  ('60000000-0000-4000-a000-000000000008', 'ewm-enterprise', 'EWM Enterprise', '20000000-0000-4000-a000-000000000002', 'TENANT_DEDICATED', 2, false, false, 'Licencia Enterprise EWM con infraestructura exclusiva.'),
  ('60000000-0000-4000-a000-000000000009', 'esupplier-demo', 'eSupplier Demo', '20000000-0000-4000-a000-000000000001', 'SHARED', 1, false, false, 'Demo sin cobro recurrente (regla §2.2).')
on conflict (code) do nothing;

insert into platform.plan_prices (plan_id, charge_kind, billing_interval, amount, currency) values
  ('60000000-0000-4000-a000-000000000001', 'LICENSE',              'MONTHLY',  850.00,  'USD'),
  ('60000000-0000-4000-a000-000000000001', 'IMPLEMENTATION_FEE',   'ONE_TIME', 3500.00, 'USD'),
  ('60000000-0000-4000-a000-000000000002', 'PARTNER_BASE_LICENSE', 'MONTHLY',  2200.00, 'USD'),
  ('60000000-0000-4000-a000-000000000002', 'INFRASTRUCTURE_FEE',   'MONTHLY',  900.00,  'USD'),
  ('60000000-0000-4000-a000-000000000002', 'IMPLEMENTATION_FEE',   'ONE_TIME', 8000.00, 'USD'),
  ('60000000-0000-4000-a000-000000000003', 'TENANT_LICENSE',       'MONTHLY',  480.00,  'USD'),
  ('60000000-0000-4000-a000-000000000004', 'LICENSE',              'MONTHLY',  4200.00, 'USD'),
  ('60000000-0000-4000-a000-000000000004', 'INFRASTRUCTURE_FEE',   'MONTHLY',  1500.00, 'USD'),
  ('60000000-0000-4000-a000-000000000004', 'SUPPORT_FEE',          'MONTHLY',  800.00,  'USD'),
  ('60000000-0000-4000-a000-000000000004', 'IMPLEMENTATION_FEE',   'ONE_TIME', 18000.00,'USD'),
  ('60000000-0000-4000-a000-000000000005', 'LICENSE',              'MONTHLY',  700.00,  'USD'),
  ('60000000-0000-4000-a000-000000000005', 'IMPLEMENTATION_FEE',   'ONE_TIME', 2800.00, 'USD'),
  ('60000000-0000-4000-a000-000000000006', 'PARTNER_BASE_LICENSE', 'MONTHLY',  1900.00, 'USD'),
  ('60000000-0000-4000-a000-000000000006', 'INFRASTRUCTURE_FEE',   'MONTHLY',  1100.00, 'USD'),
  ('60000000-0000-4000-a000-000000000007', 'TENANT_LICENSE',       'MONTHLY',  520.00,  'USD'),
  ('60000000-0000-4000-a000-000000000008', 'LICENSE',              'MONTHLY',  3800.00, 'USD'),
  ('60000000-0000-4000-a000-000000000008', 'INFRASTRUCTURE_FEE',   'MONTHLY',  1400.00, 'USD'),
  ('60000000-0000-4000-a000-000000000008', 'IMPLEMENTATION_FEE',   'ONE_TIME', 15000.00,'USD'),
  ('60000000-0000-4000-a000-000000000009', 'LICENSE',              'MONTHLY',  0.00,    'USD')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 9. Suscripciones e ítems
-- ---------------------------------------------------------------------------
insert into platform.subscriptions
  (id, code, billed_organization_id, saas_product_id, tenant_id, plan_id, status, billing_interval, currency, started_on, channel_margin_rate) values
  -- Escenario 1: directo EBIM, Shared.
  ('70000000-0000-4000-a000-000000000001', 'SUB-ALPHA-ESUP', '30000000-0000-4000-a000-000000000004', '20000000-0000-4000-a000-000000000001', '50000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000001', 'ACTIVE', 'MONTHLY', 'USD', current_date - interval '8 months', null),
  -- Escenario 2: Shared vía partner. El partner factura, retiene margen.
  ('70000000-0000-4000-a000-000000000002', 'SUB-P1-ESUP', '30000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000001', '50000000-0000-4000-a000-000000000002', '60000000-0000-4000-a000-000000000001', 'ACTIVE', 'MONTHLY', 'USD', current_date - interval '6 months', 0.2500),
  ('70000000-0000-4000-a000-000000000003', 'SUB-P2-ESUP', '30000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000001', '50000000-0000-4000-a000-000000000003', '60000000-0000-4000-a000-000000000001', 'ACTIVE', 'MONTHLY', 'USD', current_date - interval '5 months', 0.2500),
  -- Escenario 3: licencia BASE del partner (sin tenant) + licencias por tenant.
  ('70000000-0000-4000-a000-000000000004', 'SUB-ANDINA-PD-BASE', '30000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000001', null, '60000000-0000-4000-a000-000000000002', 'ACTIVE', 'MONTHLY', 'USD', current_date - interval '4 months', 0.2500),
  ('70000000-0000-4000-a000-000000000005', 'SUB-ANDINA-PD-A', '30000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000001', '50000000-0000-4000-a000-000000000005', '60000000-0000-4000-a000-000000000003', 'ACTIVE', 'MONTHLY', 'USD', current_date - interval '4 months', 0.2500),
  ('70000000-0000-4000-a000-000000000006', 'SUB-ANDINA-PD-B', '30000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000001', '50000000-0000-4000-a000-000000000006', '60000000-0000-4000-a000-000000000003', 'ACTIVE', 'MONTHLY', 'USD', current_date - interval '3 months', 0.2500),
  -- Escenario 4: Enterprise dedicado.
  ('70000000-0000-4000-a000-000000000007', 'SUB-OMEGA-ESUP', '30000000-0000-4000-a000-000000000005', '20000000-0000-4000-a000-000000000001', '50000000-0000-4000-a000-000000000007', '60000000-0000-4000-a000-000000000004', 'ACTIVE', 'MONTHLY', 'USD', current_date - interval '10 months', null),
  -- Escenario 5: EWM Shared.
  ('70000000-0000-4000-a000-000000000008', 'SUB-ALPHA-EWM', '30000000-0000-4000-a000-000000000004', '20000000-0000-4000-a000-000000000002', '50000000-0000-4000-a000-000000000008', '60000000-0000-4000-a000-000000000005', 'ACTIVE', 'MONTHLY', 'USD', current_date - interval '4 months', null),
  ('70000000-0000-4000-a000-000000000009', 'SUB-P1-EWM', '30000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000002', '50000000-0000-4000-a000-000000000009', '60000000-0000-4000-a000-000000000005', 'ACTIVE', 'MONTHLY', 'USD', current_date - interval '2 months', 0.1800),
  -- Escenario 6: EWM Partner Dedicated (Reseller Pacífico).
  ('70000000-0000-4000-a000-00000000000a', 'SUB-PACIFICO-BASE', '30000000-0000-4000-a000-000000000003', '20000000-0000-4000-a000-000000000002', null, '60000000-0000-4000-a000-000000000006', 'ACTIVE', 'MONTHLY', 'USD', current_date - interval '7 months', 0.2000),
  ('70000000-0000-4000-a000-00000000000b', 'SUB-EWM-NORTE', '30000000-0000-4000-a000-000000000003', '20000000-0000-4000-a000-000000000002', '50000000-0000-4000-a000-00000000000b', '60000000-0000-4000-a000-000000000007', 'ACTIVE', 'MONTHLY', 'USD', current_date - interval '7 months', 0.2000),
  ('70000000-0000-4000-a000-00000000000c', 'SUB-EWM-SUR', '30000000-0000-4000-a000-000000000003', '20000000-0000-4000-a000-000000000002', '50000000-0000-4000-a000-00000000000c', '60000000-0000-4000-a000-000000000007', 'ACTIVE', 'MONTHLY', 'USD', current_date - interval '6 months', 0.2000),
  -- Escenario 7: EWM Enterprise dedicado.
  ('70000000-0000-4000-a000-00000000000d', 'SUB-TITAN-EWM', '30000000-0000-4000-a000-00000000000a', '20000000-0000-4000-a000-000000000002', '50000000-0000-4000-a000-00000000000d', '60000000-0000-4000-a000-000000000008', 'ACTIVE', 'MONTHLY', 'USD', current_date - interval '9 months', null)
on conflict (code) do nothing;

insert into platform.subscription_items (subscription_id, charge_kind, description, quantity, unit_amount, currency, billing_interval, tenant_id) values
  -- Escenario 1 — licencia Shared + implementation fee (one-time, no suma a MRR)
  ('70000000-0000-4000-a000-000000000001', 'LICENSE', 'Licencia eSupplier Shared', 1, 850.00, 'USD', 'MONTHLY', '50000000-0000-4000-a000-000000000001'),
  ('70000000-0000-4000-a000-000000000001', 'IMPLEMENTATION_FEE', 'Implementación eSupplier', 1, 3500.00, 'USD', 'ONE_TIME', '50000000-0000-4000-a000-000000000001'),
  ('70000000-0000-4000-a000-000000000001', 'ADDON', 'Addon Licitaciones', 1, 350.00, 'USD', 'MONTHLY', '50000000-0000-4000-a000-000000000001'),
  -- Escenario 2 — Shared vía partner
  ('70000000-0000-4000-a000-000000000002', 'LICENSE', 'Licencia eSupplier Shared', 1, 850.00, 'USD', 'MONTHLY', '50000000-0000-4000-a000-000000000002'),
  ('70000000-0000-4000-a000-000000000002', 'IMPLEMENTATION_FEE', 'Implementación (canal Andina)', 1, 2500.00, 'USD', 'ONE_TIME', '50000000-0000-4000-a000-000000000002'),
  ('70000000-0000-4000-a000-000000000003', 'LICENSE', 'Licencia eSupplier Shared', 1, 850.00, 'USD', 'MONTHLY', '50000000-0000-4000-a000-000000000003'),
  -- Escenario 3 — Partner Dedicated: base + infra + N tenants
  ('70000000-0000-4000-a000-000000000004', 'PARTNER_BASE_LICENSE', 'Licencia base Partner eSupplier', 1, 2200.00, 'USD', 'MONTHLY', null),
  ('70000000-0000-4000-a000-000000000004', 'INFRASTRUCTURE_FEE', 'Infraestructura dedicada Andina', 1, 900.00, 'USD', 'MONTHLY', null),
  ('70000000-0000-4000-a000-000000000004', 'IMPLEMENTATION_FEE', 'Setup infraestructura dedicada', 1, 8000.00, 'USD', 'ONE_TIME', null),
  ('70000000-0000-4000-a000-000000000005', 'TENANT_LICENSE', 'Licencia tenant PD · Cliente A', 1, 480.00, 'USD', 'MONTHLY', '50000000-0000-4000-a000-000000000005'),
  ('70000000-0000-4000-a000-000000000006', 'TENANT_LICENSE', 'Licencia tenant PD · Cliente B', 1, 480.00, 'USD', 'MONTHLY', '50000000-0000-4000-a000-000000000006'),
  -- Escenario 4 — Enterprise: licencia + infra + soporte premium + setup
  ('70000000-0000-4000-a000-000000000007', 'LICENSE', 'Licencia eSupplier Enterprise', 1, 4200.00, 'USD', 'MONTHLY', '50000000-0000-4000-a000-000000000007'),
  ('70000000-0000-4000-a000-000000000007', 'INFRASTRUCTURE_FEE', 'Infraestructura exclusiva Omega', 1, 1500.00, 'USD', 'MONTHLY', '50000000-0000-4000-a000-000000000007'),
  ('70000000-0000-4000-a000-000000000007', 'SUPPORT_FEE', 'Soporte premium / SLA', 1, 800.00, 'USD', 'MONTHLY', '50000000-0000-4000-a000-000000000007'),
  ('70000000-0000-4000-a000-000000000007', 'IMPLEMENTATION_FEE', 'Setup Enterprise', 1, 18000.00, 'USD', 'ONE_TIME', '50000000-0000-4000-a000-000000000007'),
  ('70000000-0000-4000-a000-000000000007', 'ADDON', 'Marca blanca + multi-país', 1, 650.00, 'USD', 'MONTHLY', '50000000-0000-4000-a000-000000000007'),
  -- Escenario 5 — EWM Shared
  ('70000000-0000-4000-a000-000000000008', 'LICENSE', 'Licencia EWM Shared', 1, 700.00, 'USD', 'MONTHLY', '50000000-0000-4000-a000-000000000008'),
  ('70000000-0000-4000-a000-000000000008', 'IMPLEMENTATION_FEE', 'Implementación EWM', 1, 2800.00, 'USD', 'ONE_TIME', '50000000-0000-4000-a000-000000000008'),
  ('70000000-0000-4000-a000-000000000009', 'LICENSE', 'Licencia EWM Shared', 1, 700.00, 'USD', 'MONTHLY', '50000000-0000-4000-a000-000000000009'),
  -- Escenario 6 — EWM Partner Dedicated
  ('70000000-0000-4000-a000-00000000000a', 'PARTNER_BASE_LICENSE', 'Licencia base Partner EWM', 1, 1900.00, 'USD', 'MONTHLY', null),
  ('70000000-0000-4000-a000-00000000000a', 'INFRASTRUCTURE_FEE', 'Infraestructura dedicada Pacífico', 1, 1100.00, 'USD', 'MONTHLY', null),
  ('70000000-0000-4000-a000-00000000000b', 'TENANT_LICENSE', 'Licencia tenant EWM Norte', 1, 520.00, 'USD', 'MONTHLY', '50000000-0000-4000-a000-00000000000b'),
  ('70000000-0000-4000-a000-00000000000c', 'TENANT_LICENSE', 'Licencia tenant EWM Sur', 1, 520.00, 'USD', 'MONTHLY', '50000000-0000-4000-a000-00000000000c'),
  -- Escenario 7 — EWM Enterprise
  ('70000000-0000-4000-a000-00000000000d', 'LICENSE', 'Licencia EWM Enterprise', 1, 3800.00, 'USD', 'MONTHLY', '50000000-0000-4000-a000-00000000000d'),
  ('70000000-0000-4000-a000-00000000000d', 'INFRASTRUCTURE_FEE', 'Infraestructura exclusiva Titán', 1, 1400.00, 'USD', 'MONTHLY', '50000000-0000-4000-a000-00000000000d'),
  ('70000000-0000-4000-a000-00000000000d', 'IMPLEMENTATION_FEE', 'Setup Enterprise EWM', 1, 15000.00, 'USD', 'ONE_TIME', '50000000-0000-4000-a000-00000000000d')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 10. Comerciales, planes de comisión y atribuciones
--
-- ESCENARIO 9: Carla Comercial es INDEPENDIENTE (sin organización) y tiene
-- atribuciones en DOS productos distintos. NO tiene tenant_membership en ninguno
-- de los tenants que vendió — ese es justamente el test de §2.3.
-- ---------------------------------------------------------------------------
insert into platform.sales_agents (id, code, full_name, user_id, organization_id, agent_type, contact_email) values
  ('80000000-0000-4000-a000-000000000001', 'carla-independiente', 'Carla Comercial',
   '10000000-0000-4000-a000-000000000008', null, 'INDEPENDENT', 'comercial@indep.ebim.test'),
  ('80000000-0000-4000-a000-000000000002', 'beto-andina', 'Beto Andina',
   '10000000-0000-4000-a000-000000000005', '30000000-0000-4000-a000-000000000002', 'PARTNER_AGENT', 'ventas@andina.ebim.test'),
  ('80000000-0000-4000-a000-000000000003', 'equipo-ebim', 'Equipo Comercial EBIM',
   null, '30000000-0000-4000-a000-000000000001', 'EBIM_INTERNAL', 'comercial@grupoebim.com')
on conflict (code) do nothing;

-- valid_from explícito en el pasado: si se dejara el default (current_date), las
-- reglas no aplicarían a los cobros históricos que carga este mismo seed.
insert into platform.commission_plans (id, code, name, description, saas_product_id, valid_from) values
  ('90000000-0000-4000-a000-000000000001', 'indep-standard', 'Comercial independiente · estándar',
   '10% sobre licencia cobrada durante 12 meses + 5% del implementation fee cobrado.', null, current_date - interval '2 years'),
  ('90000000-0000-4000-a000-000000000002', 'partner-agent-standard', 'Comercial de partner · estándar',
   '6% sobre licencia cobrada, recurrente sin tope de meses.', null, current_date - interval '2 years'),
  ('90000000-0000-4000-a000-000000000003', 'ebim-internal', 'Equipo EBIM · interno',
   '3% sobre cualquier cobro elegible.', null, current_date - interval '2 years')
on conflict (code) do nothing;

insert into platform.commission_rules
  (commission_plan_id, name, basis, charge_kind, rate, fixed_amount, is_recurring, max_months, max_total_amount, priority, valid_from) values
  -- Plan independiente: dos reglas complementarias.
  ('90000000-0000-4000-a000-000000000001', '10% licencia cobrada (12 meses)', 'COLLECTED_LICENSE', null, 0.1000, null, true, 12, null, 10, current_date - interval '2 years'),
  ('90000000-0000-4000-a000-000000000001', '5% implementation fee cobrado (una vez)', 'COLLECTED_IMPLEMENTATION', 'IMPLEMENTATION_FEE', 0.0500, null, false, null, null, 20, current_date - interval '2 years'),
  -- Plan de comercial de partner.
  ('90000000-0000-4000-a000-000000000002', '6% licencia cobrada (recurrente)', 'COLLECTED_LICENSE', null, 0.0600, null, true, null, null, 10, current_date - interval '2 years'),
  -- Plan interno EBIM.
  ('90000000-0000-4000-a000-000000000003', '3% sobre cualquier cobro', 'COLLECTED_ANY', null, 0.0300, null, true, null, null, 10, current_date - interval '2 years')
on conflict do nothing;

insert into platform.sales_attributions
  (id, sales_agent_id, saas_product_id, tenant_id, subscription_id, customer_organization_id,
   channel_organization_id, attribution_pct, source, commission_plan_id, valid_from) values
  -- Carla, venta 1: eSupplier directo a Empresa Directa Alpha.
  ('a0000000-0000-4000-a000-000000000001', '80000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001',
   '50000000-0000-4000-a000-000000000001', '70000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000004',
   null, 1.0000, 'DIRECT', '90000000-0000-4000-a000-000000000001', current_date - interval '8 months'),
  -- Carla, venta 2: EWM a Industrias Titán. MISMA comercial, OTRO producto.
  ('a0000000-0000-4000-a000-000000000002', '80000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002',
   '50000000-0000-4000-a000-00000000000d', '70000000-0000-4000-a000-00000000000d', '30000000-0000-4000-a000-00000000000a',
   null, 1.0000, 'REFERRAL', '90000000-0000-4000-a000-000000000001', current_date - interval '9 months'),
  -- Beto (comercial del partner Andina): tenants captados por el canal.
  ('a0000000-0000-4000-a000-000000000003', '80000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000001',
   '50000000-0000-4000-a000-000000000002', '70000000-0000-4000-a000-000000000002', '30000000-0000-4000-a000-000000000006',
   '30000000-0000-4000-a000-000000000002', 1.0000, 'PARTNER', '90000000-0000-4000-a000-000000000002', current_date - interval '6 months'),
  ('a0000000-0000-4000-a000-000000000004', '80000000-0000-4000-a000-000000000002', '20000000-0000-4000-a000-000000000001',
   '50000000-0000-4000-a000-000000000005', '70000000-0000-4000-a000-000000000005', '30000000-0000-4000-a000-000000000006',
   '30000000-0000-4000-a000-000000000002', 1.0000, 'PARTNER', '90000000-0000-4000-a000-000000000002', current_date - interval '4 months'),
  -- Equipo EBIM: la Enterprise de Omega.
  ('a0000000-0000-4000-a000-000000000005', '80000000-0000-4000-a000-000000000003', '20000000-0000-4000-a000-000000000001',
   '50000000-0000-4000-a000-000000000007', '70000000-0000-4000-a000-000000000007', '30000000-0000-4000-a000-000000000005',
   null, 1.0000, 'DIRECT', '90000000-0000-4000-a000-000000000003', current_date - interval '10 months')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 11. Facturación y cobros — 3 meses de historia para que el dashboard tenga
-- números reales. Los pagos CONFIRMED disparan el devengo de comisión por el
-- trigger `payments_generate_commissions`.
-- ---------------------------------------------------------------------------
do $$
declare
  v_sub record;
  v_item record;
  v_month integer;
  v_period_start date;
  v_invoice_id uuid;
  v_number text;
  v_seq integer := 0;
  v_cust uuid;
  v_has_lines boolean;
begin
  for v_month in reverse 2 .. 0 loop
    v_period_start := date_trunc('month', current_date - (v_month || ' months')::interval)::date;

    for v_sub in
      select s.*, t.customer_organization_id as tenant_customer
        from platform.subscriptions s
        left join platform.tenants t on t.id = s.tenant_id
       where s.status = 'ACTIVE' and s.started_on <= v_period_start
       order by s.code
    loop
      v_seq := v_seq + 1;
      v_number := 'INV-' || to_char(v_period_start, 'YYYYMM') || '-' || lpad(v_seq::text, 4, '0');
      -- Se factura a quien paga (el partner en modelo canal, el cliente en directo).
      v_cust := v_sub.billed_organization_id;

      insert into platform.invoices (
        number, customer_organization_id, subscription_id, status, currency,
        issue_date, due_date, period_start, period_end
      )
      values (
        v_number, v_cust, v_sub.id, 'ISSUED', v_sub.currency,
        v_period_start, v_period_start + 15,
        v_period_start, (v_period_start + interval '1 month' - interval '1 day')::date
      )
      returning id into v_invoice_id;

      v_has_lines := false;

      for v_item in
        select si.* from platform.subscription_items si
         where si.subscription_id = v_sub.id
           -- El fee de implementación se cobra UNA sola vez: en el primer mes
           -- del histórico, no todos los meses.
           and (si.billing_interval <> 'ONE_TIME' or v_month = 2)
      loop
        insert into platform.invoice_lines (
          invoice_id, charge_kind, description, saas_product_id, tenant_id,
          subscription_item_id, quantity, unit_amount, currency, is_recurring
        )
        values (
          v_invoice_id, v_item.charge_kind, v_item.description, v_sub.saas_product_id,
          coalesce(v_item.tenant_id, v_sub.tenant_id), v_item.id,
          v_item.quantity, v_item.unit_amount, v_item.currency,
          v_item.billing_interval <> 'ONE_TIME'
        );
        v_has_lines := true;
      end loop;

      if not v_has_lines then
        delete from platform.invoices where id = v_invoice_id;
        continue;
      end if;

      -- Los dos meses cerrados se cobran; el mes en curso queda ISSUED sin pagar
      -- (así el dashboard muestra facturado != cobrado, que es el punto).
      if v_month > 0 then
        insert into platform.payments (invoice_id, reference, status, amount, currency, paid_at, method)
        select v_invoice_id, 'PAY-' || v_number, 'CONFIRMED', i.total, i.currency,
               (v_period_start + 12)::timestamptz, 'TRANSFER'
          from platform.invoices i where i.id = v_invoice_id and i.total > 0;
      end if;
    end loop;
  end loop;
end;
$$;

-- Una factura VOID y una DRAFT: los tests verifican que NO cuentan como ingreso.
insert into platform.invoices (number, customer_organization_id, status, currency, issue_date, period_start, period_end, tax_amount)
values ('INV-VOID-0001', '30000000-0000-4000-a000-000000000004', 'VOID', 'USD', current_date - 40, date_trunc('month', current_date - interval '1 month')::date, (date_trunc('month', current_date)::date - 1), 0),
       ('INV-DRAFT-0001', '30000000-0000-4000-a000-000000000004', 'DRAFT', 'USD', null, date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date, 0)
on conflict (number) do nothing;

insert into platform.invoice_lines (invoice_id, charge_kind, description, saas_product_id, tenant_id, quantity, unit_amount, currency, is_recurring)
select i.id, 'LICENSE', 'Licencia anulada (no debe contar)', '20000000-0000-4000-a000-000000000001', '50000000-0000-4000-a000-000000000001', 1, 9999.00, 'USD', true
  from platform.invoices i where i.number in ('INV-VOID-0001', 'INV-DRAFT-0001')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 12. Costos e imputación
-- ---------------------------------------------------------------------------
do $$
declare
  v_month integer;
  v_ps date;
  v_pe date;
  v_cost uuid;
begin
  for v_month in reverse 2 .. 0 loop
    v_ps := date_trunc('month', current_date - (v_month || ' months')::interval)::date;
    v_pe := (v_ps + interval '1 month' - interval '1 day')::date;

    -- Costo del target Shared de eSupplier -> se reparte entre sus tenants activos.
    insert into platform.cost_entries (category, description, vendor, amount, currency, period_start, period_end)
    values ('DATABASE', 'Supabase Pro · Shared eSupplier', 'Supabase', 599.00, 'USD', v_ps, v_pe)
    returning id into v_cost;
    insert into platform.cost_allocations (cost_entry_id, scope, deployment_target_id, weight, allocation_rule)
    values (v_cost, 'DEPLOYMENT_TARGET', '40000000-0000-4000-a000-000000000001', 1, 'POR_TENANTS_ACTIVOS');

    insert into platform.cost_entries (category, description, vendor, amount, currency, period_start, period_end)
    values ('DATABASE', 'Supabase Pro · Shared EWM', 'Supabase', 499.00, 'USD', v_ps, v_pe)
    returning id into v_cost;
    insert into platform.cost_allocations (cost_entry_id, scope, deployment_target_id, weight, allocation_rule)
    values (v_cost, 'DEPLOYMENT_TARGET', '40000000-0000-4000-a000-000000000002', 1, 'POR_TENANTS_ACTIVOS');

    -- Infraestructura dedicada de partner.
    insert into platform.cost_entries (category, description, vendor, amount, currency, period_start, period_end)
    values ('DEDICATED_INFRA', 'Proyecto dedicado · Consultora Andina (eSupplier)', 'Supabase', 620.00, 'USD', v_ps, v_pe)
    returning id into v_cost;
    insert into platform.cost_allocations (cost_entry_id, scope, deployment_target_id, weight, allocation_rule)
    values (v_cost, 'DEPLOYMENT_TARGET', '40000000-0000-4000-a000-000000000003', 1, 'DIRECTO');

    insert into platform.cost_entries (category, description, vendor, amount, currency, period_start, period_end)
    values ('DEDICATED_INFRA', 'Proyecto dedicado · Reseller Pacífico (EWM)', 'Supabase', 780.00, 'USD', v_ps, v_pe)
    returning id into v_cost;
    insert into platform.cost_allocations (cost_entry_id, scope, deployment_target_id, weight, allocation_rule)
    values (v_cost, 'DEPLOYMENT_TARGET', '40000000-0000-4000-a000-000000000004', 1, 'DIRECTO');

    -- Infraestructura exclusiva de tenant Enterprise.
    insert into platform.cost_entries (category, description, vendor, amount, currency, period_start, period_end)
    values ('DEDICATED_INFRA', 'Proyecto exclusivo · Omega (eSupplier)', 'Supabase', 1150.00, 'USD', v_ps, v_pe)
    returning id into v_cost;
    insert into platform.cost_allocations (cost_entry_id, scope, tenant_id, weight, allocation_rule)
    values (v_cost, 'TENANT', '50000000-0000-4000-a000-000000000007', 1, 'DIRECTO');

    insert into platform.cost_entries (category, description, vendor, amount, currency, period_start, period_end)
    values ('DEDICATED_INFRA', 'Proyecto exclusivo · Titán (EWM)', 'Supabase', 980.00, 'USD', v_ps, v_pe)
    returning id into v_cost;
    insert into platform.cost_allocations (cost_entry_id, scope, tenant_id, weight, allocation_rule)
    values (v_cost, 'TENANT', '50000000-0000-4000-a000-00000000000d', 1, 'DIRECTO');

    -- Soporte premium imputado al tenant que lo contrató.
    insert into platform.cost_entries (category, description, vendor, amount, currency, period_start, period_end)
    values ('SUPPORT', 'Soporte premium dedicado · Omega', 'EBIM', 420.00, 'USD', v_ps, v_pe)
    returning id into v_cost;
    insert into platform.cost_allocations (cost_entry_id, scope, tenant_id, weight, allocation_rule)
    values (v_cost, 'TENANT', '50000000-0000-4000-a000-000000000007', 1, 'DIRECTO');

    -- Costo repartido 60/40 entre los dos productos principales: regla EXPLÍCITA.
    insert into platform.cost_entries (category, description, vendor, amount, currency, period_start, period_end)
    values ('MESSAGING', 'WhatsApp + correo transaccional de la suite', 'Twilio/M365', 300.00, 'USD', v_ps, v_pe)
    returning id into v_cost;
    insert into platform.cost_allocations (cost_entry_id, scope, saas_product_id, weight, allocation_rule) values
      (v_cost, 'PRODUCT', '20000000-0000-4000-a000-000000000001', 0.6000, 'REPARTO_60_40'),
      (v_cost, 'PRODUCT', '20000000-0000-4000-a000-000000000002', 0.4000, 'REPARTO_60_40');

    -- Costo de plataforma, no imputable a un producto concreto.
    insert into platform.cost_entries (category, description, vendor, amount, currency, period_start, period_end)
    values ('FRONTEND_HOSTING', 'Hosting frontend + dominios de la suite', 'Vercel/Cloudflare', 180.00, 'USD', v_ps, v_pe)
    returning id into v_cost;
    insert into platform.cost_allocations (cost_entry_id, scope, weight, allocation_rule)
    values (v_cost, 'PLATFORM', 1, 'GLOBAL');
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Liquidaciones de comisión (una cerrada y pagada, otra abierta)
-- ---------------------------------------------------------------------------
do $$
declare
  v_settlement uuid;
  v_period_start date := date_trunc('month', current_date - interval '2 months')::date;
  v_period_end   date := (date_trunc('month', current_date - interval '1 month') - interval '1 day')::date;
begin
  -- Se abre OPEN y luego se cierra: el CHECK settlements_paid_needs_ref_ck exige
  -- que una liquidación PAID traiga fecha y referencia de pago.
  insert into platform.commission_settlements (code, sales_agent_id, period_start, period_end, currency, status)
  values ('STL-carla-independiente-' || to_char(v_period_start, 'YYYYMM'),
          '80000000-0000-4000-a000-000000000001', v_period_start, v_period_end, 'USD', 'OPEN')
  on conflict (code) do nothing
  returning id into v_settlement;

  if v_settlement is not null then
    update platform.commission_events
       set settlement_id = v_settlement, status = 'PAID', updated_at = now()
     where sales_agent_id = '80000000-0000-4000-a000-000000000001'
       and earned_on between v_period_start and v_period_end
       and status = 'ELIGIBLE';

    update platform.commission_settlements
       set status = 'PAID',
           approved_at = now() - interval '20 days',
           approved_by = '10000000-0000-4000-a000-000000000003',
           paid_at = now() - interval '15 days',
           payment_reference = 'TRF-CARLA-001'
     where id = v_settlement;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. Provisioning en DRY_RUN — la cola con sus estados y timeline
-- ---------------------------------------------------------------------------
insert into platform.provisioning_requests
  (id, idempotency_key, action, status, mode, tenant_id, deployment_target_id, saas_product_id,
   requested_by, payload, result, error_message, attempts, started_at, finished_at) values
  ('b0000000-0000-4000-a000-000000000001', 'prov-alpha-esupplier-0001', 'ATTACH_TENANT_TO_TARGET', 'SUCCEEDED', 'DRY_RUN',
   '50000000-0000-4000-a000-000000000001', '40000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000001',
   '10000000-0000-4000-a000-000000000002',
   '{"tenant_slug":"alpha-esupplier","region":"sa-east-1"}'::jsonb,
   '{"simulated":true,"target":"shared-esupplier-sa-east","would_create":["schema","rls_policies","seed_roles"]}'::jsonb,
   null, 1, now() - interval '8 months', now() - interval '8 months'),
  ('b0000000-0000-4000-a000-000000000002', 'prov-andina-dedicated-0001', 'CREATE_DEDICATED_TARGET', 'SUCCEEDED', 'DRY_RUN',
   null, '40000000-0000-4000-a000-000000000003', '20000000-0000-4000-a000-000000000001',
   '10000000-0000-4000-a000-000000000002',
   '{"organization_slug":"consultora-andina","region":"sa-east-1","plan":"pro"}'::jsonb,
   '{"simulated":true,"would_create_project":"andina-esupplier-dedicated"}'::jsonb,
   null, 1, now() - interval '4 months', now() - interval '4 months'),
  ('b0000000-0000-4000-a000-000000000003', 'prov-titan-ewm-0001', 'CREATE_TENANT_SPACE', 'FAILED', 'DRY_RUN',
   '50000000-0000-4000-a000-00000000000d', '40000000-0000-4000-a000-000000000006', '20000000-0000-4000-a000-000000000002',
   '10000000-0000-4000-a000-000000000002',
   '{"tenant_slug":"titan-ewm","warehouses":4}'::jsonb,
   '{}'::jsonb,
   'VALIDACION_FALLIDA: el target exclusivo aún no reporta estado ACTIVE (simulado)', 2,
   now() - interval '9 months', now() - interval '9 months'),
  ('b0000000-0000-4000-a000-000000000004', 'prov-ewm-sur-0001', 'ATTACH_TENANT_TO_TARGET', 'PENDING', 'DRY_RUN',
   '50000000-0000-4000-a000-00000000000c', '40000000-0000-4000-a000-000000000004', '20000000-0000-4000-a000-000000000002',
   '10000000-0000-4000-a000-000000000002',
   '{"tenant_slug":"ewm-sur"}'::jsonb, '{}'::jsonb, null, 0, null, null)
on conflict (idempotency_key) do nothing;

insert into platform.provisioning_events (provisioning_request_id, status, message, detail, occurred_at) values
  ('b0000000-0000-4000-a000-000000000001', 'PENDING',    'Solicitud encolada', '{}'::jsonb, now() - interval '8 months'),
  ('b0000000-0000-4000-a000-000000000001', 'VALIDATING', 'Validando slug y capacidad del target compartido', '{"checks":["slug_unico","capacidad"]}'::jsonb, now() - interval '8 months' + interval '1 minute'),
  ('b0000000-0000-4000-a000-000000000001', 'RUNNING',    'Ejecutando en modo DRY_RUN (sin llamadas remotas)', '{"mode":"DRY_RUN"}'::jsonb, now() - interval '8 months' + interval '2 minutes'),
  ('b0000000-0000-4000-a000-000000000001', 'SUCCEEDED',  'Simulación completada', '{"simulated":true}'::jsonb, now() - interval '8 months' + interval '3 minutes'),
  ('b0000000-0000-4000-a000-000000000003', 'PENDING',    'Solicitud encolada', '{}'::jsonb, now() - interval '9 months'),
  ('b0000000-0000-4000-a000-000000000003', 'VALIDATING', 'Validando target exclusivo', '{}'::jsonb, now() - interval '9 months' + interval '1 minute'),
  ('b0000000-0000-4000-a000-000000000003', 'FAILED',     'El target exclusivo no está ACTIVE (simulado)', '{"retryable":true}'::jsonb, now() - interval '9 months' + interval '2 minutes')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 15. Auditoría de ejemplo
-- ---------------------------------------------------------------------------
insert into platform.audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, organization_id, tenant_id, metadata) values
  ('10000000-0000-4000-a000-000000000002', 'product.admin@ebim.test', 'TENANT_CREATED', 'tenant', '50000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-000000000004', '50000000-0000-4000-a000-000000000001', '{"product":"esupplier","deployment_mode":"SHARED"}'::jsonb),
  ('10000000-0000-4000-a000-000000000002', 'product.admin@ebim.test', 'AGREEMENT_GRANTED', 'organization_product_agreement', null, '30000000-0000-4000-a000-000000000002', null, '{"product":"ewm","margin_rate":0.18}'::jsonb),
  ('10000000-0000-4000-a000-000000000003', 'finance@ebim.test', 'COMMISSIONS_SETTLED', 'commission_settlement', null, null, null, '{"agent":"carla-independiente"}'::jsonb),
  ('10000000-0000-4000-a000-000000000001', 'dcalagua@ebim.pe', 'PLATFORM_ROLE_GRANTED', 'platform_admin', '10000000-0000-4000-a000-000000000003', null, null, '{"role":"EBIM_FINANCE"}'::jsonb);

-- ---------------------------------------------------------------------------
-- 16. Verificación del seed — falla ruidosamente si algo no cuadra.
-- ---------------------------------------------------------------------------
do $$
declare
  v_products integer;
  v_tenants  integer;
  v_modes    integer;
  v_events   integer;
  v_mrr      numeric;
begin
  select count(*) into v_products from platform.saas_products;
  select count(*) into v_tenants  from platform.tenants;
  select count(distinct deployment_mode) into v_modes from platform.tenants;
  select count(*) into v_events   from platform.commission_events;
  select coalesce(sum(mrr), 0) into v_mrr from platform.v_subscription_mrr;

  if v_products < 5 then
    raise exception 'SEED_INCOMPLETO: se esperaban 5 productos SaaS, hay %', v_products;
  end if;
  if v_tenants < 13 then
    raise exception 'SEED_INCOMPLETO: se esperaban >=13 tenants, hay %', v_tenants;
  end if;
  if v_modes < 3 then
    raise exception 'SEED_INCOMPLETO: faltan modos de despliegue, hay % de 3', v_modes;
  end if;
  if v_events = 0 then
    raise exception 'SEED_INCOMPLETO: no se devengó ninguna comisión — el trigger de pagos no corrió';
  end if;
  if v_mrr <= 0 then
    raise exception 'SEED_INCOMPLETO: el MRR calculado es %, se esperaba > 0', v_mrr;
  end if;

  raise notice 'SEED OK · productos=% tenants=% modos=% eventos_comision=% MRR=%',
    v_products, v_tenants, v_modes, v_events, v_mrr;
end;
$$;

-- ############################################################################
-- ############################################################################
-- SEED V2 · Escenarios de negocio de la Fase 15
-- ----------------------------------------------------------------------------
-- Se AÑADE sobre el seed original sin tocar ninguno de sus escenarios: los ids
-- de V2 empiezan donde acaban los del baseline.
--
-- Qué añade, y por qué cada cosa:
--
--   · perfiles de cobro para los escenarios que ya existían (hasta ahora todos
--     se cobraban «manualmente por omisión»);
--   · GRUPASA, el caso que justifica todo el modelo de cobranza: UN cliente,
--     DOS SaaS, DOS métodos de cobro distintos;
--   · Órdenes de Servicio en sus tres estados vivos, para poder enseñar el ciclo;
--   · una renovación vencida y en gracia, para que el tablero de alertas tenga
--     algo real que mostrar;
--   · un cobro Culqi fallido en modo MOCK, para la reconciliación.
--
-- REGLA DE SEGURIDAD DEL SEED: ni una credencial. Los identificadores externos
-- llevan el prefijo `mock_` justamente para que sea imposible confundirlos con
-- datos reales de un proveedor.
-- ############################################################################

-- ---------------------------------------------------------------------------
-- 0. Perfiles de cobro para los escenarios del baseline.
--
-- Sin esto, las 13 suscripciones del seed original aparecen en la conciliación
-- como MISSING_COLLECTION_PROFILE, que es correcto pero poco demostrativo.
-- ---------------------------------------------------------------------------

-- Escenario 1 · Alpha / eSupplier directo EBIM -> Culqi TEST (adapter en MOCK)
insert into platform.subscription_collection_profiles (
  id, subscription_id, collection_method, provider_account_id, auto_charge,
  invoice_lead_days, renewal_notice_days, payment_due_days, grace_period_days,
  document_lead_days, auto_suspend, currency, status, effective_from, notes
)
select
  'c0000000-0000-4000-a000-000000000001', s.id, 'CULQI_CARD',
  (select id from platform.payment_provider_accounts where code = 'culqi-pe-test'),
  true, 0, 30, 15, 10, 45, false, s.currency, 'ACTIVE', current_date - 200,
  'Cobro con tarjeta. Sin credenciales configuradas: el adapter opera en MOCK.'
from platform.subscriptions s where s.code = 'SUB-ALPHA-ESUP';

-- Escenario 5 · Omega Enterprise dedicado -> transferencia, para contrastar
insert into platform.subscription_collection_profiles (
  id, subscription_id, collection_method, auto_charge,
  invoice_lead_days, renewal_notice_days, payment_due_days, grace_period_days,
  document_lead_days, auto_suspend, currency, status, effective_from, notes
)
select
  'c0000000-0000-4000-a000-000000000002', s.id, 'BANK_TRANSFER', false,
  10, 60, 30, 15, 45, false, s.currency, 'ACTIVE', current_date - 200,
  'Enterprise: transferencia conciliada por finanzas, sin domiciliación.'
from platform.subscriptions s where s.code = 'SUB-OMEGA-ESUP';

-- Escenarios 2 y 3 · tenants del partner Andina -> manual con margen de canal.
-- SUB-P1-EWM y SUB-P2-ESUP quedan fuera a propósito: reciben más abajo su
-- propio perfil con Orden de Servicio / de Compra (escenario 7).
insert into platform.subscription_collection_profiles (
  id, subscription_id, collection_method, auto_charge,
  invoice_lead_days, renewal_notice_days, payment_due_days, grace_period_days,
  document_lead_days, auto_suspend, currency, status, effective_from, notes
)
select
  ('c0000000-0000-4000-a000-0000000000' || lpad((10 + row_number() over (order by s.code))::text, 2, '0'))::uuid,
  s.id, 'MANUAL', false, 0, 30, 15, 10, 45, false, s.currency, 'ACTIVE', current_date - 150,
  'Facturación consolidada al partner.'
from platform.subscriptions s
where s.code in ('SUB-ANDINA-PD-A', 'SUB-ANDINA-PD-B', 'SUB-P1-ESUP');

-- ---------------------------------------------------------------------------
-- 6. GRUPASA — el caso que justifica el modelo entero.
--
-- Una sola organización, dos productos, DOS MÉTODOS DE COBRO DISTINTOS:
--   eSupplier -> tarjeta Culqi, mensual
--   WMS/EWM   -> Orden de Servicio, anual, pedida con 45 días de antelación
--
-- Si el método colgara de la organización en vez de la suscripción, este caso
-- —que es un caso real— sería irrepresentable.
-- ---------------------------------------------------------------------------
insert into platform.organizations (
  id, slug, legal_name, display_name, kind, country_code, tax_id, status,
  billing_email, accent_color, metadata
) values (
  '30000000-0000-4000-a000-00000000000b', 'grupasa', 'Grupo Agroindustrial GRUPASA S.A.C.',
  'GRUPASA', 'COMPANY', 'PE', '20501234567', 'ACTIVE',
  'facturacion@grupasa.ebim.test', '#1B6B4A',
  jsonb_build_object('sector', 'agroindustria', 'escenario', 'multi-producto multi-método')
);

insert into platform.organization_capabilities (organization_id, capability)
values ('30000000-0000-4000-a000-00000000000b', 'CUSTOMER');

insert into platform.companies (id, organization_id, name, country_code, currency, tax_id, is_default, status)
values (
  'c1000000-0000-4000-a000-000000000001', '30000000-0000-4000-a000-00000000000b',
  'GRUPASA Perú', 'PE', 'PEN', '20501234567', true, 'ACTIVE'
);

insert into platform.tenants (
  id, slug, name, saas_product_id, customer_organization_id, company_id,
  tenant_type, status, deployment_mode, environment, admin_email, activated_at, metadata
) values
(
  '50000000-0000-4000-a000-00000000000e', 'grupasa-esupplier', 'GRUPASA · eSupplier',
  (select id from platform.saas_products where code = 'esupplier'),
  '30000000-0000-4000-a000-00000000000b', 'c1000000-0000-4000-a000-000000000001',
  'PRODUCTION', 'ACTIVE', 'SHARED', 'PRODUCTION',
  'admin@grupasa.ebim.test', now() - interval '8 months', '{}'::jsonb
),
(
  '50000000-0000-4000-a000-00000000000f', 'grupasa-ewm', 'GRUPASA · EWM',
  (select id from platform.saas_products where code = 'ewm'),
  '30000000-0000-4000-a000-00000000000b', 'c1000000-0000-4000-a000-000000000001',
  'PRODUCTION', 'ACTIVE', 'SHARED', 'PRODUCTION',
  'admin@grupasa.ebim.test', now() - interval '6 months', '{}'::jsonb
);

-- Ambos tenants viven en la MISMA infraestructura compartida.
insert into platform.tenant_deployments (tenant_id, deployment_target_id, is_primary, status, deployed_at)
values
('50000000-0000-4000-a000-00000000000e',
 (select id from platform.deployment_targets where code = 'shared-esupplier-sa-east'),
 true, 'ACTIVE', now() - interval '8 months'),
('50000000-0000-4000-a000-00000000000f',
 (select id from platform.deployment_targets where code = 'shared-ewm-sa-east'),
 true, 'ACTIVE', now() - interval '6 months');

insert into platform.subscriptions (
  id, code, billed_organization_id, saas_product_id, tenant_id, plan_id, status,
  billing_interval, currency, quantity, started_on, notes, metadata
) values
(
  '70000000-0000-4000-a000-00000000000e', 'SUB-GRUPASA-ESUP',
  '30000000-0000-4000-a000-00000000000b',
  (select id from platform.saas_products where code = 'esupplier'),
  '50000000-0000-4000-a000-00000000000e',
  (select id from platform.plans where code = 'esupplier-shared-standard'),
  'ACTIVE', 'MONTHLY', 'USD', 1, (current_date - interval '8 months')::date,
  'Cobro con tarjeta, mensual.', '{}'::jsonb
),
(
  '70000000-0000-4000-a000-00000000000f', 'SUB-GRUPASA-EWM',
  '30000000-0000-4000-a000-00000000000b',
  (select id from platform.saas_products where code = 'ewm'),
  '50000000-0000-4000-a000-00000000000f',
  (select id from platform.plans where code = 'ewm-shared-standard'),
  'ACTIVE', 'YEARLY', 'USD', 1, (current_date - interval '6 months')::date,
  'Cobro por Orden de Servicio anual: el circuito de compras del cliente lo exige.',
  '{}'::jsonb
);

insert into platform.subscription_items (
  subscription_id, charge_kind, description, quantity, unit_amount, currency,
  billing_interval, tenant_id, valid_from
) values
('70000000-0000-4000-a000-00000000000e', 'LICENSE', 'Licencia eSupplier mensual',
 1, 850, 'USD', 'MONTHLY', '50000000-0000-4000-a000-00000000000e', (current_date - interval '8 months')::date),
('70000000-0000-4000-a000-00000000000f', 'LICENSE', 'Licencia EWM anual',
 1, 24000, 'USD', 'YEARLY', '50000000-0000-4000-a000-00000000000f', (current_date - interval '6 months')::date),
('70000000-0000-4000-a000-00000000000f', 'IMPLEMENTATION_FEE', 'Implementación EWM',
 1, 12000, 'USD', 'ONE_TIME', '50000000-0000-4000-a000-00000000000f', (current_date - interval '6 months')::date);

-- LOS DOS MÉTODOS DISTINTOS, sobre el mismo cliente.
insert into platform.subscription_collection_profiles (
  id, subscription_id, collection_method, provider_account_id, auto_charge,
  requires_service_order, invoice_lead_days, renewal_notice_days, payment_due_days,
  grace_period_days, document_lead_days, auto_suspend, currency, status, effective_from, notes
) values
(
  'c0000000-0000-4000-a000-000000000021', '70000000-0000-4000-a000-00000000000e',
  'CULQI_CARD', (select id from platform.payment_provider_accounts where code = 'culqi-pe-test'),
  true, false, 0, 30, 15, 10, 45, false, 'USD', 'ACTIVE', (current_date - interval '8 months')::date,
  'eSupplier: tarjeta con cargo recurrente.'
),
(
  'c0000000-0000-4000-a000-000000000022', '70000000-0000-4000-a000-00000000000f',
  'SERVICE_ORDER', null,
  false, true, 0, 60, 30, 15, 45, true, 'USD', 'ACTIVE', (current_date - interval '6 months')::date,
  'EWM: Orden de Servicio anual, solicitada 45 días antes de la renovación.'
);

-- Mapeo Culqi en MOCK para la suscripción con tarjeta.
insert into platform.provider_customers (
  id, provider_account_id, organization_id, external_customer_id, status
) values (
  'd0000000-0000-4000-a000-000000000001',
  (select id from platform.payment_provider_accounts where code = 'culqi-pe-test'),
  '30000000-0000-4000-a000-00000000000b', 'cus_mock_grupasa01', 'ACTIVE'
);

insert into platform.provider_payment_methods (
  id, provider_account_id, organization_id, provider_customer_id,
  external_payment_method_id, brand, last4, exp_month, exp_year, is_default, status
) values (
  'd0000000-0000-4000-a000-000000000002',
  (select id from platform.payment_provider_accounts where code = 'culqi-pe-test'),
  '30000000-0000-4000-a000-00000000000b', 'd0000000-0000-4000-a000-000000000001',
  'crd_mock_grupasa01', 'VISA', '4242', 12, 2030, true, 'ACTIVE'
);

insert into platform.provider_subscriptions (
  id, provider_account_id, subscription_id, external_subscription_id,
  external_plan_id, external_payment_method_id, external_customer_id,
  provider_status, next_billing_at, status, metadata
) values (
  'd0000000-0000-4000-a000-000000000003',
  (select id from platform.payment_provider_accounts where code = 'culqi-pe-test'),
  '70000000-0000-4000-a000-00000000000e', 'sxn_mock_grupasa01',
  'pln_mock_esup850', 'crd_mock_grupasa01', 'cus_mock_grupasa01',
  'active', now() + interval '12 days', 'ACTIVE',
  jsonb_build_object('mode', 'MOCK')
);

-- ---------------------------------------------------------------------------
-- 7. Órdenes de Servicio en sus tres estados vivos.
-- ---------------------------------------------------------------------------

-- (a) APROBADA y vigente: GRUPASA / EWM. Cubre el periodo en curso.
insert into platform.subscription_commercial_documents (
  id, subscription_id, document_type, document_number, status,
  requested_at, received_at, approved_at, valid_from, valid_to,
  amount, currency, external_file_ref, notes
) values (
  'e0000000-0000-4000-a000-000000000001', '70000000-0000-4000-a000-00000000000f',
  'SERVICE_ORDER', 'OS-2026-0455', 'APPROVED',
  now() - interval '7 months', now() - interval '6 months 20 days', now() - interval '6 months 15 days',
  (current_date - interval '6 months')::date, (current_date + interval '6 months')::date,
  24000, 'USD', 'storage://os/2026/os-2026-0455.pdf',
  'Aprobada. Habilita la continuidad administrativa; NO es un cobro.'
);

-- (b) RECIBIDA, pendiente de aprobar: Cliente Partner Uno / EWM.
insert into platform.subscription_collection_profiles (
  id, subscription_id, collection_method, requires_service_order,
  invoice_lead_days, renewal_notice_days, payment_due_days, grace_period_days,
  document_lead_days, auto_suspend, currency, status, effective_from, notes
)
select
  'c0000000-0000-4000-a000-000000000031', s.id, 'SERVICE_ORDER', true,
  0, 45, 30, 15, 45, false, s.currency, 'ACTIVE', current_date - 120,
  'Circuito de compras del cliente: exige OS.'
from platform.subscriptions s where s.code = 'SUB-P1-EWM';

insert into platform.subscription_commercial_documents (
  id, subscription_id, document_type, document_number, status,
  requested_at, received_at, valid_from, valid_to, amount, currency, notes
)
select
  'e0000000-0000-4000-a000-000000000002', s.id, 'SERVICE_ORDER', 'OS-2026-0512', 'RECEIVED',
  now() - interval '20 days', now() - interval '3 days',
  current_date, (current_date + interval '1 year')::date, 9600, 'USD',
  'Recibida del cliente; pendiente de validación por finanzas.'
from platform.subscriptions s where s.code = 'SUB-P1-EWM';

-- (c) SOLICITADA, aún sin llegar: Cliente Partner Dos / eSupplier.
insert into platform.subscription_collection_profiles (
  id, subscription_id, collection_method, requires_purchase_order,
  invoice_lead_days, renewal_notice_days, payment_due_days, grace_period_days,
  document_lead_days, auto_suspend, currency, status, effective_from, notes
)
select
  'c0000000-0000-4000-a000-000000000032', s.id, 'PURCHASE_ORDER', true,
  0, 30, 30, 10, 45, false, s.currency, 'ACTIVE', current_date - 90,
  'Requiere Orden de Compra del cliente.'
from platform.subscriptions s where s.code = 'SUB-P2-ESUP';

insert into platform.subscription_commercial_documents (
  id, subscription_id, document_type, status, requested_at, valid_from, valid_to,
  amount, currency, notes
)
select
  'e0000000-0000-4000-a000-000000000003', s.id, 'PURCHASE_ORDER', 'REQUESTED',
  now() - interval '5 days', current_date, (current_date + interval '1 year')::date,
  7200, 'USD', 'Solicitada al cliente; todavía sin número de documento.'
from platform.subscriptions s where s.code = 'SUB-P2-ESUP';

-- ---------------------------------------------------------------------------
-- 8. Renovación vencida y en periodo de gracia.
--
-- Factura emitida hace 40 días, vencida hace 12 y con 15 días de gracia: está
-- DENTRO de la gracia, así que `refresh_billing_alerts` genera PAST_DUE pero
-- todavía no SUSPENSION_DUE. Es el estado más útil para enseñar el tablero.
-- ---------------------------------------------------------------------------
insert into platform.subscription_collection_profiles (
  id, subscription_id, collection_method, auto_charge,
  invoice_lead_days, renewal_notice_days, payment_due_days, grace_period_days,
  document_lead_days, auto_suspend, currency, status, effective_from, notes
)
select
  'c0000000-0000-4000-a000-000000000041', s.id, 'BANK_TRANSFER', false,
  0, 30, 15, 15, 45, true, s.currency, 'ACTIVE', current_date - 300,
  'Con suspensión automática al acabar la gracia.'
from platform.subscriptions s where s.code = 'SUB-EWM-NORTE';

insert into platform.invoices (
  id, number, customer_organization_id, subscription_id, status, currency,
  issue_date, due_date, period_start, period_end, subtotal, tax_amount, total, notes
)
select
  'f0000000-0000-4000-a000-000000000001', 'INV-DEMO-GRACIA',
  s.billed_organization_id, s.id, 'ISSUED', s.currency,
  current_date - 40, current_date - 12,
  (current_date - interval '2 months')::date, (current_date - interval '1 month')::date,
  1800, 0, 1800,
  'Escenario de demostración: vencida y dentro del periodo de gracia.'
from platform.subscriptions s where s.code = 'SUB-EWM-NORTE';

insert into platform.invoice_lines (
  invoice_id, charge_kind, description, saas_product_id, tenant_id,
  quantity, unit_amount, currency, is_recurring
)
select
  'f0000000-0000-4000-a000-000000000001', 'LICENSE', 'Licencia EWM Norte',
  s.saas_product_id, s.tenant_id, 1, 1800, 'USD', true
from platform.subscriptions s where s.code = 'SUB-EWM-NORTE';

-- ---------------------------------------------------------------------------
-- 9. Cobro Culqi fallido, en MOCK.
--
-- Un fallo NO crea `payments`: solo marca el mapeo del proveedor y deja el
-- evento en el ledger. Es lo que alimenta la alerta PAYMENT_FAILURE y el
-- hallazgo de reconciliación.
-- ---------------------------------------------------------------------------
insert into platform.provider_subscriptions (
  id, provider_account_id, subscription_id, external_subscription_id,
  external_plan_id, external_customer_id, provider_status,
  last_error_code, last_error_message, next_billing_at, status, metadata
)
select
  'd0000000-0000-4000-a000-000000000011',
  (select id from platform.payment_provider_accounts where code = 'culqi-pe-test'),
  s.id, 'sxn_mock_alpha01', 'pln_mock_esup850', 'cus_mock_alpha01',
  'payment_failed', 'card_declined', 'Tarjeta rechazada por el emisor',
  now() + interval '3 days', 'ACTIVE', jsonb_build_object('mode', 'MOCK')
from platform.subscriptions s where s.code = 'SUB-ALPHA-ESUP';

insert into platform.provider_webhook_events (
  provider_account_id, external_event_key, event_type, payload, status,
  subscription_id, error_code, error_message, received_at, processed_at
)
select
  (select id from platform.payment_provider_accounts where code = 'culqi-pe-test'),
  'evt_mock_failed_alpha01', 'charge.failed',
  jsonb_build_object('type', 'charge.failed', 'subscription_id', 'sxn_mock_alpha01', 'simulated', true),
  'PROCESSED', s.id, 'card_declined', 'Tarjeta rechazada por el emisor',
  now() - interval '2 days', now() - interval '2 days'
from platform.subscriptions s where s.code = 'SUB-ALPHA-ESUP';

-- Un evento repetido, ya IGNORADO: demuestra la idempotencia en pantalla.
insert into platform.provider_webhook_events (
  provider_account_id, external_event_key, event_type, payload, status,
  error_code, error_message, received_at, processed_at
) values (
  (select id from platform.payment_provider_accounts where code = 'culqi-pe-test'),
  'evt_mock_duplicado_demo', 'charge.succeeded',
  jsonb_build_object('type', 'charge.succeeded', 'simulated', true),
  'IGNORED', 'PAGO_YA_REGISTRADO', 'Entrega repetida: el cargo ya estaba registrado',
  now() - interval '1 day', now() - interval '1 day'
);

-- ---------------------------------------------------------------------------
-- Atribución comercial de GRUPASA (escenario 1 del prompt, aplicado aquí).
-- Crear la atribución NO crea ninguna `tenant_membership`.
-- ---------------------------------------------------------------------------
insert into platform.sales_attributions (
  id, sales_agent_id, saas_product_id, tenant_id, subscription_id,
  customer_organization_id, attribution_pct, source, commission_plan_id,
  valid_from, status, notes
) values (
  'a1000000-0000-4000-a000-000000000001',
  (select id from platform.sales_agents where code = 'carla-independiente'),
  (select id from platform.saas_products where code = 'esupplier'),
  '50000000-0000-4000-a000-00000000000e', '70000000-0000-4000-a000-00000000000e',
  '30000000-0000-4000-a000-00000000000b', 1.0, 'REFERRAL',
  (select id from platform.commission_plans where code = 'indep-standard'),
  (current_date - interval '8 months')::date, 'ACTIVE',
  'Venta referida. Comercial sin acceso operativo al tenant.'
);

-- ---------------------------------------------------------------------------
-- Alertas materializadas, para que el tablero no arranque vacío.
-- `refresh_billing_alerts` es idempotente: volver a ejecutarlo no duplica nada.
-- ---------------------------------------------------------------------------
do $$
declare
  v_created integer;
begin
  -- El seed corre como superusuario, que no pasa por los helpers de rol; se
  -- llama a la función igualmente porque `security definer` la ejecuta como
  -- owner y `can_manage_commercial()` no aplica a `postgres`.
  perform set_config('request.jwt.claim.sub',
    (select id::text from auth.users where email = 'dcalagua@ebim.pe'), true);
  select platform.refresh_billing_alerts(now()) into v_created;
  raise notice 'SEED V2 · alertas de cobranza generadas: %', v_created;
end;
$$;

-- ---------------------------------------------------------------------------
-- Verificación del seed V2. Si algo falta, el reset FALLA en vez de dejar una
-- demo silenciosamente incompleta.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profiles  integer;
  v_methods   integer;
  v_grupasa   integer;
  v_docs      integer;
  v_alerts    integer;
  v_failed    integer;
begin
  select count(*) into v_profiles from platform.subscription_collection_profiles;

  -- El corazón del escenario 6: un cliente con DOS métodos distintos.
  select count(distinct p.collection_method) into v_methods
    from platform.subscription_collection_profiles p
    join platform.subscriptions s on s.id = p.subscription_id
   where s.billed_organization_id = '30000000-0000-4000-a000-00000000000b';

  select count(*) into v_grupasa from platform.tenants
   where customer_organization_id = '30000000-0000-4000-a000-00000000000b';

  select count(distinct status) into v_docs
    from platform.subscription_commercial_documents
   where status in ('REQUESTED', 'RECEIVED', 'APPROVED');

  select count(*) into v_alerts from platform.billing_alerts;

  select count(*) into v_failed from platform.provider_subscriptions
   where provider_status = 'payment_failed';

  if v_profiles < 10 then
    raise exception 'SEED_V2_INCOMPLETO: se esperaban >=10 perfiles de cobro, hay %', v_profiles;
  end if;
  if v_methods < 2 then
    raise exception 'SEED_V2_INCOMPLETO: GRUPASA debe tener 2 métodos de cobro distintos, tiene %', v_methods;
  end if;
  if v_grupasa < 2 then
    raise exception 'SEED_V2_INCOMPLETO: GRUPASA debe tener 2 tenants, tiene %', v_grupasa;
  end if;
  if v_docs < 3 then
    raise exception 'SEED_V2_INCOMPLETO: faltan estados de OS/OC, hay % de 3', v_docs;
  end if;
  if v_alerts = 0 then
    raise exception 'SEED_V2_INCOMPLETO: no se generó ninguna alerta de cobranza';
  end if;
  if v_failed = 0 then
    raise exception 'SEED_V2_INCOMPLETO: falta el escenario de cobro fallido';
  end if;

  raise notice 'SEED V2 OK · perfiles=% metodos_grupasa=% tenants_grupasa=% estados_os=% alertas=% fallos=%',
    v_profiles, v_methods, v_grupasa, v_docs, v_alerts, v_failed;
end;
$$;
