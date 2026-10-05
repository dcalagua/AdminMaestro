-- ============================================================================
-- MasterAdmin · Datos de demostración para Gerencia (gerencia-v4) — CARGA
-- ----------------------------------------------------------------------------
-- SOLO STACK LOCAL (`ebim-control-plane`). Nunca en supabase/seed.sql (los
-- pgTAP dependen del seed base) ni en QAS/PRD. Se ejecuta con
-- `scripts/demo/load-demo-data.sh`, que antepone demo-unload.sql en la MISMA
-- transacción: recargar = borrar y volver a generar, sin duplicar nada.
--
-- Qué genera (detalle y cifras en scripts/demo/README.md):
--   · 18 meses de historia relativos al mes en curso (M-18 … M0) + contratos
--     anteriores a la ventana para que la curva no empiece en cero.
--   · 4 partners, 6 comerciales, 48 clientes ficticios en PE/BO/EC, los 8
--     productos de la suite, 82 contratos con altas escalonadas, expansiones,
--     contracciones y 5 clientes que se dan de baja.
--   · Facturas emitidas con la RPC real `issue_subscription_invoice` (motor de
--     cadencia), cobros con `confirm_manual_payment` (el trigger devenga las
--     comisiones), liquidaciones con `settle_commissions`, tarifa de partner con
--     `compute/issue_partner_fee_statement`, enlaces de pago con
--     `create_payment_link`, uso y créditos IA con ingest → cierre → finalize.
--   · Datos maestros (organizaciones, tenants, contratos, ítems) insertados
--     directamente con UUID deterministas, como hace el seed base: las RPCs de
--     alta escriben fechas de hoy y encolan provisioning, y aquí hace falta
--     historia. Todos los triggers de negocio siguen activos.
--
-- Marcas: `metadata ->> 'demo' = 'gerencia-v4'` (organizaciones, tenants,
-- contratos, planes, facturas, comerciales, destinos, costos, bitácora), notas
-- `DEMO gerencia-v4` en tasas, manifest `demo-gerencia-v4` en capacidades.
-- Correos solo `@ebim.test`. Empresas ficticias.
-- ============================================================================

set local search_path = platform, public, pg_catalog;
set local timezone = 'America/Lima';

-- ---------------------------------------------------------------------------
-- 0. Guardas
-- ---------------------------------------------------------------------------
do $$
begin
  -- Solo un stack de desarrollo con el seed base (fixtures @ebim.test).
  if not exists (select 1 from auth.users
                  where id = '10000000-0000-4000-a000-000000000003' and email = 'finance@ebim.test') then
    raise exception 'DEMO_SOLO_LOCAL: esta base no tiene los fixtures del seed local';
  end if;
  if inet_server_addr() is not null
     and not (inet_server_addr() << '127.0.0.0/8'::inet or inet_server_addr() << '10.0.0.0/8'::inet
              or inet_server_addr() << '172.16.0.0/12'::inet or inet_server_addr() << '192.168.0.0/16'::inet
              or inet_server_addr() = '::1'::inet) then
    raise exception 'DEMO_SOLO_LOCAL: servidor % no es local', inet_server_addr();
  end if;
  if exists (select 1 from platform.organizations where metadata ->> 'demo' = 'gerencia-v4') then
    raise exception 'DEMO_YA_CARGADO: usa scripts/demo/load-demo-data.sh (descarga y recarga en una transacción)';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Utilidades de sesión (pg_temp: desaparecen al cerrar la sesión)
-- ---------------------------------------------------------------------------
-- UUID determinista: misma clave → mismo id en cada recarga.
create function pg_temp.did(k text) returns uuid language sql immutable as $$
  select md5('ebim-demo-gerencia-v4:' || k)::uuid
$$;
-- Primer día del mes relativo al mes en curso (M0 = mes actual).
create function pg_temp.m(k int) returns date language sql stable as $$
  select (date_trunc('month', current_date) + make_interval(months => k))::date
$$;
create function pg_temp.mend(k int) returns date language sql stable as $$
  select (pg_temp.m(k + 1) - 1)
$$;
-- Pseudoaleatorio determinista 0..99.
create function pg_temp.r(k text) returns int language sql immutable as $$
  select abs(hashtext('gerencia-v4:' || k)) % 100
$$;
create function pg_temp.tag() returns jsonb language sql immutable as $$
  select '{"demo": "gerencia-v4"}'::jsonb
$$;
create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_user::text, true);
$$;
create function pg_temp.act_as_service() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true),
         set_config('request.jwt.claim.sub', '', true);
$$;
-- Actores del seed: Fabio Finanzas (EBIM_FINANCE), Paula Producto (EBIM_PRODUCT_ADMIN), super admin.
create function pg_temp.finance() returns uuid language sql immutable as $$ select '10000000-0000-4000-a000-000000000003'::uuid $$;
create function pg_temp.padmin() returns uuid language sql immutable as $$ select '10000000-0000-4000-a000-000000000002'::uuid $$;
create function pg_temp.sadmin() returns uuid language sql immutable as $$ select '10000000-0000-4000-a000-000000000001'::uuid $$;
-- Hora de negocio (15:00 Lima) de una fecha.
create function pg_temp.at15(d date) returns timestamptz language sql stable as $$
  select (d + time '15:00') at time zone 'America/Lima'
$$;

create temp table demo_audit_floor on commit drop as
  select coalesce(max(id), 0) as id from platform.audit_logs;

-- ---------------------------------------------------------------------------
-- 2. Dataset declarativo
-- ---------------------------------------------------------------------------
-- Precio de lista mensual por producto (plan Business, SHARED) y moneda.
create temp table demo_prices (product text primary key, usd numeric, pen numeric, bob numeric) on commit drop;
insert into demo_prices values
  ('esupplier', 780, 2900, 5400),
  ('ewm',       690, 2550, 4800),
  ('tms',       620, 2300, 4300),
  ('gmao',      560, 2080, 3900),
  ('echange',   380, 1400, 2650),
  ('comerza',   450, 1680, 3100),
  ('eexpense',  320, 1190, 2200),
  ('ecommerce', 520, 1930, 3600);

-- Partners. billing: EBIM factura al cliente final; PARTNER factura el partner
-- y EBIM le cobra la tarifa de plataforma (Nexo, desde M-6).
create temp table demo_partners (
  code text primary key, slug text, legal text, display text, country char(2), currency char(3),
  caps text[], products text[], margin numeric, billing text, rel text, since_k int, tax text
) on commit drop;
insert into demo_partners values
  ('ANDES',     'andes-digital-partners', 'Andes Digital Partners S.A.C.', 'Andes Digital Partners', 'PE', 'PEN',
   array['PARTNER','CONSULTING'], array['esupplier','gmao','eexpense'], 0.20, 'EBIM', 'MANAGES', -26, '20612345671'),
  ('ALTIPLANO', 'altiplano-tecnologia', 'Altiplano Tecnología S.R.L.', 'Altiplano Tecnología', 'BO', 'BOB',
   array['PARTNER','RESELLER'], array['ewm','tms','echange'], 0.18, 'EBIM', 'RESELLS_TO', -26, '3045678019'),
  ('COSTA',     'costa-cloud-consulting', 'Costa Cloud Consulting S.A.', 'Costa Cloud Consulting', 'EC', 'USD',
   array['PARTNER'], array['comerza','ecommerce'], 0.22, 'EBIM', 'MANAGES', -26, '0992345678001'),
  ('NEXO',      'nexo-integradores', 'Nexo Integradores S.A.C.', 'Nexo Integradores', 'PE', 'PEN',
   array['PARTNER','RESELLER'], array['tms','ewm'], 0.25, 'PARTNER', 'RESELLS_TO', -6, '20634567892');

-- Comerciales. plan = plan de comisión del seed (10%/5% independiente, 6% partner, 3% interno).
create temp table demo_agents (
  code text primary key, full_name text, agent_type platform.sales_agent_type, org text, plan_code text,
  email text, source platform.attribution_source
) on commit drop;
insert into demo_agents values
  ('lucia-paredes',   'Lucía Paredes',   'EBIM_INTERNAL', 'EBIM',      'ebim-internal',          'lucia.paredes@ebim.test',   'DIRECT'),
  ('mateo-quispe',    'Mateo Quispe',    'EBIM_INTERNAL', 'EBIM',      'ebim-internal',          'mateo.quispe@ebim.test',    'DIRECT'),
  ('valeria-andrade', 'Valeria Andrade', 'INDEPENDENT',   null,        'indep-standard',         'valeria.andrade@ebim.test', 'REFERRAL'),
  ('diego-salazar',   'Diego Salazar',   'PARTNER_AGENT', 'ANDES',     'partner-agent-standard', 'diego.salazar@ebim.test',   'PARTNER'),
  ('camila-rojas',    'Camila Rojas',    'PARTNER_AGENT', 'ALTIPLANO', 'partner-agent-standard', 'camila.rojas@ebim.test',    'PARTNER'),
  ('andres-vera',     'Andrés Vera',     'PARTNER_AGENT', 'COSTA',     'partner-agent-standard', 'andres.vera@ebim.test',     'PARTNER');

-- Clientes. pay: P puntual · T paga tarde · X paga en dos partes · M deja de
-- pagar desde stop_k (cartera vencida 30/60/90+).
create temp table demo_customers (
  n int primary key, code text unique, slug text unique, legal text, display text, country char(2),
  currency char(3), sector text, partner text, agent text, pay char(1), stop_k int
) on commit drop;
insert into demo_customers values
  -- Perú
  ( 1, 'VSUR',       'agroexportadora-valle-sur',  'Agroexportadora Valle Sur S.A.C.',        'Agroexportadora Valle Sur',  'PE', 'USD', 'Agroindustria',   null,    'lucia-paredes',   'P', null),
  ( 2, 'HUAYLAS',    'constructora-huaylas',       'Constructora Huaylas S.A.C.',             'Constructora Huaylas',       'PE', 'PEN', 'Construcción',    'ANDES', 'diego-salazar',   'T', null),
  ( 3, 'RIMAC',      'distribuidora-rimac-norte',  'Distribuidora Rímac Norte S.A.',          'Distribuidora Rímac Norte',  'PE', 'PEN', 'Distribución',    null,    'lucia-paredes',   'P', null),
  ( 4, 'CNEGRA',     'minera-cordillera-negra',    'Minera Cordillera Negra S.A.A.',          'Minera Cordillera Negra',    'PE', 'USD', 'Minería',         null,    'lucia-paredes',   'P', null),
  ( 5, 'SECHURA',    'pesquera-bahia-sechura',     'Pesquera Bahía Sechura S.A.C.',           'Pesquera Bahía Sechura',     'PE', 'USD', 'Pesca',           'ANDES', 'diego-salazar',   'P', null),
  ( 6, 'VITALIS',    'laboratorios-vitalis',       'Laboratorios Vitalis Andino S.A.C.',      'Laboratorios Vitalis',       'PE', 'PEN', 'Farmacéutica',    null,    'lucia-paredes',   'P', null),
  ( 7, 'QHAPAQ',     'transportes-qhapaq-cargo',   'Transportes Qhapaq Cargo S.A.C.',         'Transportes Qhapaq Cargo',   'PE', 'PEN', 'Transporte',      null,    'lucia-paredes',   'M', -3),
  ( 8, 'MIRASOL',    'tiendas-mirasol',            'Tiendas Mirasol Retail S.A.C.',           'Tiendas Mirasol',            'PE', 'PEN', 'Retail',          null,    'lucia-paredes',   'P', null),
  ( 9, 'CEMANDINA',  'cementera-andina-del-sur',   'Cementera Andina del Sur S.A.',           'Cementera Andina del Sur',   'PE', 'USD', 'Industria',       null,    'lucia-paredes',   'T', null),
  (10, 'CALLAO',     'logistica-callao-express',   'Logística Callao Express S.A.C.',         'Callao Express',             'PE', 'PEN', 'Logística',       null,    'lucia-paredes',   'T', null),
  (11, 'FICUS',      'inmobiliaria-los-ficus',     'Inmobiliaria Los Ficus S.A.C.',           'Inmobiliaria Los Ficus',     'PE', 'PEN', 'Inmobiliaria',    'ANDES', 'diego-salazar',   'P', null),
  (12, 'PIMA',       'textil-pima-norte',          'Textil Pima Norte S.A.C.',                'Textil Pima Norte',          'PE', 'USD', 'Textil',          'ANDES', 'diego-salazar',   'P', null),
  (13, 'STAINES',    'clinica-santa-ines',         'Clínica Santa Inés del Pacífico S.A.C.',  'Clínica Santa Inés',         'PE', 'PEN', 'Salud',           null,    'lucia-paredes',   'P', null),
  (14, 'CHAVIN',     'alimentaria-chavin',         'Corporación Alimentaria Chavín S.A.',     'Alimentaria Chavín',         'PE', 'PEN', 'Alimentos',       null,    'lucia-paredes',   'X', null),
  (15, 'MISTI',      'energia-solar-misti',        'Energía Solar Misti S.A.C.',              'Energía Solar Misti',        'PE', 'USD', 'Energía',         null,    'lucia-paredes',   'P', null),
  (16, 'AMAUTA',     'grupo-educativo-amauta',     'Grupo Educativo Amauta S.A.C.',           'Grupo Educativo Amauta',     'PE', 'PEN', 'Educación',       'ANDES', 'diego-salazar',   'P', null),
  (17, 'AYNI',       'boticas-ayni',               'Boticas Ayni S.A.C.',                     'Boticas Ayni',               'PE', 'PEN', 'Retail farmacéutico', null, 'lucia-paredes',  'T', null),
  (18, 'CHINCHA',    'agricola-chincha-sol',       'Agrícola Chincha Sol S.A.C.',             'Agrícola Chincha Sol',       'PE', 'USD', 'Agroindustria',   'ANDES', 'diego-salazar',   'P', null),
  (19, 'ILO',        'metalmecanica-ilo',          'Metalmecánica Ilo Industrial S.A.C.',     'Metalmecánica Ilo',          'PE', 'PEN', 'Industria',       null,    'lucia-paredes',   'P', null),
  (20, 'CENTINELA',  'centinela-seguridad',        'Centinela Seguridad Integral S.A.C.',     'Centinela Seguridad',        'PE', 'PEN', 'Servicios',       null,    'lucia-paredes',   'P', null),
  (21, 'KALLPA',     'importadora-kallpa',         'Importadora Kallpa S.A.C.',               'Importadora Kallpa',         'PE', 'USD', 'Comercio',        null,    'valeria-andrade', 'P', null),
  (22, 'COLCA',      'hoteles-valle-del-colca',    'Hoteles Valle del Colca S.A.C.',          'Hoteles Valle del Colca',    'PE', 'PEN', 'Turismo',         null,    'valeria-andrade', 'M', -4),
  (23, 'FPUNO',      'ferreteria-industrial-puno', 'Ferretería Industrial Puno S.A.C.',       'Ferretería Industrial Puno', 'PE', 'PEN', 'Ferretería',      'NEXO',  null,              'P', null),
  (24, 'TFRIO',      'almacenes-tumbes-frio',      'Almacenes Tumbes Frío S.A.C.',            'Tumbes Frío',                'PE', 'USD', 'Logística',       'NEXO',  null,              'P', null),
  (25, 'HUANUCO',    'distribuidora-huanuco',      'Distribuidora Huánuco Andina S.A.C.',     'Distribuidora Huánuco',      'PE', 'PEN', 'Distribución',    'NEXO',  null,              'P', null),
  -- Bolivia
  (26, 'ILLAMPU',    'industrias-illampu',         'Industrias Illampu S.R.L.',               'Industrias Illampu',         'BO', 'BOB', 'Industria',       'ALTIPLANO', 'camila-rojas', 'P', null),
  (27, 'CHIQUI',     'comercializadora-chiquitana','Comercializadora Chiquitana S.A.',        'Chiquitana Comercial',       'BO', 'BOB', 'Comercio',        'ALTIPLANO', 'camila-rojas', 'T', null),
  (28, 'SAJAMA',     'transportes-sajama',         'Transportes Sajama S.R.L.',               'Transportes Sajama',         'BO', 'BOB', 'Transporte',      'ALTIPLANO', 'camila-rojas', 'T', null),
  (29, 'GUAPAY',     'agroindustrial-guapay',      'Agroindustrial Guapay S.A.',              'Agroindustrial Guapay',      'BO', 'USD', 'Agroindustria',   null,    'mateo-quispe',    'P', null),
  (30, 'TUNARI',     'constructora-tunari',        'Constructora Tunari S.R.L.',              'Constructora Tunari',        'BO', 'BOB', 'Construcción',    null,    'mateo-quispe',    'M', -2),
  (31, 'VALTO',      'lacteos-valle-alto',         'Lácteos Valle Alto S.A.',                 'Lácteos Valle Alto',         'BO', 'BOB', 'Alimentos',       null,    'mateo-quispe',    'P', null),
  (32, 'TARIJA',     'distribuidora-tarija-sur',   'Distribuidora Tarija Sur S.R.L.',         'Distribuidora Tarija Sur',   'BO', 'BOB', 'Distribución',    'ALTIPLANO', 'camila-rojas', 'P', null),
  (33, 'CKARI',      'minera-cerro-kari',          'Minera Cerro Kari S.A.',                  'Minera Cerro Kari',          'BO', 'USD', 'Minería',         null,    'mateo-quispe',    'P', null),
  (34, 'URKUPINA',   'clinica-urkupina',           'Clínica Urkupiña Salud S.R.L.',           'Clínica Urkupiña',           'BO', 'BOB', 'Salud',           null,    'mateo-quispe',    'M', -6),
  (35, 'ALTIPLANICA','textiles-altiplanica',       'Textiles Altiplánica S.R.L.',             'Textiles Altiplánica',       'BO', 'BOB', 'Textil',          'ALTIPLANO', 'camila-rojas', 'P', null),
  (36, 'CHACO',      'servicios-petroleros-chaco', 'Servicios Petroleros del Chaco S.A.',     'Petroleros del Chaco',       'BO', 'USD', 'Energía',         null,    'mateo-quispe',    'P', null),
  (37, 'CRUZAND',    'drogueria-cruz-andina',      'Droguería Cruz Andina S.R.L.',            'Droguería Cruz Andina',      'BO', 'BOB', 'Farmacéutica',    null,    'mateo-quispe',    'P', null),
  -- Ecuador
  (38, 'CAZUL',      'bananera-costa-azul',        'Exportadora Bananera Costa Azul S.A.',    'Bananera Costa Azul',        'EC', 'USD', 'Agroexportación', 'COSTA', 'andres-vera',     'P', null),
  (39, 'GDORADO',    'camaronera-golfo-dorado',    'Camaronera Golfo Dorado S.A.',            'Camaronera Golfo Dorado',    'EC', 'USD', 'Acuicultura',     null,    'valeria-andrade', 'P', null),
  (40, 'COTOPAXI',   'floricola-cotopaxi',         'Florícola Cotopaxi Andina S.A.',          'Florícola Cotopaxi',         'EC', 'USD', 'Floricultura',    null,    'valeria-andrade', 'T', null),
  (41, 'PICHINCHA',  'distribuidora-pichincha',    'Distribuidora Pichincha Centro S.A.',     'Pichincha Centro',           'EC', 'USD', 'Distribución',    'COSTA', 'andres-vera',     'T', null),
  (42, 'MANTA',      'logistica-puerto-manta',     'Logística Puerto Manta S.A.',             'Puerto Manta Logística',     'EC', 'USD', 'Logística',       null,    'valeria-andrade', 'M', -5),
  (43, 'AUSTRO',     'clinica-austro-salud',       'Clínica Austro Salud S.A.',               'Clínica Austro Salud',       'EC', 'USD', 'Salud',           null,    'valeria-andrade', 'P', null),
  (44, 'ESMERALDAS', 'cacaotera-esmeraldas',       'Cacaotera Esmeraldas Fina S.A.',          'Cacaotera Esmeraldas',       'EC', 'USD', 'Agroindustria',   'COSTA', 'andres-vera',     'P', null),
  (45, 'MALECON',    'comercial-malecon-moda',     'Comercial Malecón Moda S.A.',             'Malecón Moda',               'EC', 'USD', 'Retail',          'COSTA', 'andres-vera',     'T', null),
  (46, 'AZUAYA',     'ceramica-azuaya',            'Cerámica Azuaya S.A.',                    'Cerámica Azuaya',            'EC', 'USD', 'Industria',       null,    'valeria-andrade', 'P', null),
  (47, 'CORREDORA',  'corredora-andina-seguros',   'Corredora Andina de Seguros S.A.',        'Corredora Andina',           'EC', 'USD', 'Seguros',         null,    'valeria-andrade', 'P', null),
  (48, 'MANABI',     'conservas-atuneras-manabi',  'Conservas Atuneras de Manabí S.A.',       'Atuneras de Manabí',         'EC', 'USD', 'Alimentos',       'COSTA', 'andres-vera',     'P', null);

-- Contratos: alta en el mes start_k (día start_day), baja al cierre de end_k,
-- E = Enterprise dedicado (USD). x1/x2 = usuarios adicionales (expansión y,
-- si x2 < x1, contracción).
create temp table demo_subs (
  cust int, product text, start_k int, start_day int, end_k int, kind char(1),
  x1_k int, x1_qty int, x2_k int, x2_qty int
) on commit drop;
insert into demo_subs values
  ( 1, 'esupplier', -24,  5, null, 'B', null, null, null, null),
  ( 1, 'eexpense',  -10, 12, null, 'B',   -4,    8, null, null),
  ( 2, 'gmao',      -21,  3, null, 'B', null, null, null, null),
  ( 2, 'eexpense',   -6, 15, null, 'B', null, null, null, null),
  ( 3, 'ewm',       -23, 10, null, 'B',  -12,    6, null, null),
  ( 3, 'tms',        -9,  1, null, 'B', null, null, null, null),
  ( 4, 'gmao',      -20,  1, null, 'E', null, null, null, null),
  ( 4, 'esupplier', -13,  6, null, 'B',   -5,   10, null, null),
  ( 4, 'echange',    -2, 14, null, 'B', null, null, null, null),
  ( 5, 'esupplier', -16,  8, null, 'B', null, null, null, null),
  ( 5, 'gmao',       -7, 20, null, 'B', null, null, null, null),
  ( 6, 'echange',   -17,  4, null, 'B', null, null, null, null),
  ( 6, 'eexpense',  -11,  9, null, 'B', null, null, null, null),
  ( 7, 'tms',       -22,  2, null, 'B',  -15,    4, null, null),
  ( 8, 'ecommerce', -19,  7, null, 'B',   -9,   12,   -3,    6),
  ( 8, 'comerza',    -8,  3, null, 'B', null, null, null, null),
  ( 9, 'gmao',      -24, 12, null, 'B', null, null, null, null),
  ( 9, 'ewm',       -12, 18, null, 'B', null, null, null, null),
  (10, 'ewm',       -14,  5, null, 'B', null, null, null, null),
  (10, 'tms',       -14,  5, null, 'B', null, null, null, null),
  (11, 'esupplier', -18,  9,   -7, 'B', null, null, null, null),
  (12, 'eexpense',  -15,  2, null, 'B', null, null, null, null),
  (12, 'esupplier',  -5, 11, null, 'B', null, null, null, null),
  (13, 'echange',   -12,  3, null, 'B', null, null, null, null),
  (13, 'eexpense',   -3,  7, null, 'B', null, null, null, null),
  (14, 'ewm',       -20, 15, null, 'B', null, null, null, null),
  (14, 'comerza',   -16,  6, null, 'B',   -6,    5, null, null),
  (15, 'gmao',       -9,  4, null, 'B', null, null, null, null),
  (16, 'eexpense',  -13,  1, null, 'B', null, null, null, null),
  (16, 'esupplier',  -1,  6, null, 'B', null, null, null, null),
  (17, 'ecommerce', -11, 10, null, 'B', null, null, null, null),
  (17, 'ewm',        -4,  2, null, 'B', null, null, null, null),
  (18, 'esupplier', -21,  5, null, 'B',  -10,    6, null, null),
  (18, 'gmao',       -2,  9, null, 'B', null, null, null, null),
  (19, 'gmao',      -14,  7, null, 'B', null, null, null, null),
  (19, 'eexpense',    0,  1, null, 'B', null, null, null, null),
  (20, 'echange',   -19,  3,  -10, 'B', null, null, null, null),
  (20, 'eexpense',  -17,  6,  -10, 'B', null, null, null, null),
  (21, 'comerza',    -8, 12, null, 'B', null, null, null, null),
  (21, 'ecommerce',  -8, 12, null, 'B', null, null, null, null),
  (22, 'echange',    -6,  4, null, 'B', null, null, null, null),
  (23, 'tms',        -5,  3, null, 'B', null, null, null, null),
  (24, 'ewm',        -4, 10, null, 'B', null, null, null, null),
  (25, 'tms',        -3,  1, null, 'B', null, null, null, null),
  (26, 'ewm',       -24,  4, null, 'B',  -11,    5, null, null),
  (26, 'tms',       -10,  8, null, 'B', null, null, null, null),
  (27, 'echange',   -15, 12, null, 'B', null, null, null, null),
  (28, 'tms',       -17,  1, null, 'E', null, null, null, null),
  (28, 'ewm',        -6,  5, null, 'B', null, null, null, null),
  (29, 'esupplier', -12,  9, null, 'B', null, null, null, null),
  (29, 'gmao',      -12,  9, null, 'B', null, null, null, null),
  (30, 'gmao',      -16,  3, null, 'B', null, null, null, null),
  (30, 'eexpense',   -9,  1, null, 'B', null, null, null, null),
  (31, 'ewm',        -8,  6, null, 'B', null, null, null, null),
  (32, 'tms',       -20, 10,   -5, 'B', null, null, null, null),
  (33, 'gmao',      -22,  1, null, 'B',  -13,    8,   -2,    3),
  (33, 'esupplier',  -4,  3, null, 'B', null, null, null, null),
  (34, 'echange',   -10,  7, null, 'B', null, null, null, null),
  (34, 'eexpense',   -7,  2, null, 'B', null, null, null, null),
  (35, 'ewm',        -5,  9, null, 'B', null, null, null, null),
  (36, 'esupplier',  -7, 14, null, 'B', null, null, null, null),
  (36, 'gmao',       -1,  2, null, 'B', null, null, null, null),
  (36, 'echange',     0,  2, null, 'B', null, null, null, null),
  (37, 'ecommerce', -13,  4, null, 'B', null, null, null, null),
  (37, 'comerza',    -2,  5, null, 'B', null, null, null, null),
  (38, 'comerza',   -23,  6, null, 'B',  -14,   10,   -1,    7),
  (38, 'ecommerce', -18,  2, null, 'B', null, null, null, null),
  (39, 'esupplier', -11,  3, null, 'B', null, null, null, null),
  (39, 'gmao',       -3, 12, null, 'B', null, null, null, null),
  (40, 'eexpense',  -14,  9, null, 'B', null, null, null, null),
  (41, 'comerza',   -12,  2, null, 'B', null, null, null, null),
  (41, 'ecommerce',  -6,  8, null, 'B', null, null, null, null),
  (42, 'tms',       -19,  5,   -3, 'B', null, null, null, null),
  (42, 'ewm',       -15, 11,   -3, 'B', null, null, null, null),
  (43, 'echange',    -9,  2, null, 'B', null, null, null, null),
  (43, 'eexpense',   -9,  2, null, 'B', null, null, null, null),
  (44, 'comerza',    -7,  6, null, 'B', null, null, null, null),
  (45, 'ecommerce', -10, 15, null, 'B',   -4,    4, null, null),
  (46, 'gmao',      -16,  8,   -1, 'B', null, null, null, null),
  (47, 'echange',    -4,  1, null, 'B', null, null, null, null),
  (47, 'eexpense',   -4,  1, null, 'B', null, null, null, null),
  (48, 'ecommerce',  -2,  7, null, 'B', null, null, null, null),
  (48, 'comerza',    -2,  7, null, 'B', null, null, null, null);

-- Vista de trabajo con todo lo derivado de cada contrato.
create temp table demo_sub_map on commit drop as
select
  s.*, c.code as ccode, c.slug as cslug, c.display, c.country, c.pay, c.stop_k, c.partner, c.agent,
  p.id as product_id, p.code as product_code, p.short_name,
  pg_temp.did('org:' || c.code) as org_id,
  pg_temp.did('company:' || c.code) as company_id,
  pg_temp.did('tenant:' || c.code || ':' || s.product) as tenant_id,
  pg_temp.did('sub:' || c.code || ':' || s.product) as sub_id,
  case when s.kind = 'E' then 'USD' else c.currency end::char(3) as currency,
  'SUB-' || c.code || '-' || case s.product when 'esupplier' then 'ESUP' when 'ewm' then 'EWM' when 'tms' then 'TMS'
       when 'gmao' then 'GMAO' when 'echange' then 'ECHG' when 'comerza' then 'CMZ'
       when 'eexpense' then 'EEXP' else 'ECOM' end ||
  case when s.kind = 'E' then '-ENT' else '' end as sub_code,
  (pg_temp.m(s.start_k) + (s.start_day - 1)) as started_on,
  case when s.end_k is not null then pg_temp.mend(s.end_k) end as ends_on,
  case when s.kind = 'E' then s.product || '-enterprise' else s.product || '-business' end as plan_code,
  case when c.partner is not null then pg_temp.did('org:' || c.partner) end as partner_id,
  coalesce(c.partner = 'NEXO', false) as partner_statement
from demo_subs s
join demo_customers c on c.n = s.cust
join platform.saas_products p on p.code = s.product;

-- ---------------------------------------------------------------------------
-- 3. Tipos de cambio DEMO (1.º de cada mes; la regla de reporte admite 31 días)
-- ---------------------------------------------------------------------------
insert into platform.exchange_rates (rate_date, base_currency, quote_currency, rate, source, is_demo, notes)
select pg_temp.m(k), 'USD', q.quote,
       case q.quote when 'PEN' then round(3.80 - 0.0125 * (k + 24) + (pg_temp.r('fx-pen' || k) - 50) / 2500.0, 4)
                    else 7.00 end,
       'MANUAL', true, 'DEMO gerencia-v4 · valor ficticio para la presentación local; no es una cotización real'
  from generate_series(-24, 0) k
 cross join (values ('PEN'), ('BOB')) q (quote)
 where not exists (select 1 from platform.exchange_rates er
                    where er.rate_date = pg_temp.m(k) and er.base_currency = 'USD'
                      and er.quote_currency = q.quote and er.status = 'ACTIVE');

-- ---------------------------------------------------------------------------
-- 4. Planes y tarifas regionales (Business por producto + 2 Enterprise)
-- ---------------------------------------------------------------------------
insert into platform.plans (id, code, name, saas_product_id, deployment_mode, included_companies, multi_country,
                            is_partner_base, description, sort_order, metadata)
select pg_temp.did('plan:' || p.code || '-business'), p.code || '-business', p.short_name || ' Business', p.id,
       'SHARED'::platform.deployment_mode, 1, false, false, 'Licencia por tenant en infraestructura compartida, con usuarios adicionales.',
       100 + p.sort_order, pg_temp.tag()
  from platform.saas_products p join demo_prices dp on dp.product = p.code
union all
select pg_temp.did('plan:' || p.code || '-enterprise'), p.code || '-enterprise', p.short_name || ' Enterprise', p.id,
       'TENANT_DEDICATED'::platform.deployment_mode, 3, true, false, 'Licencia Enterprise con infraestructura exclusiva, soporte y SLA.',
       200 + p.sort_order, pg_temp.tag()
  from platform.saas_products p where p.code in ('gmao', 'tms');

insert into platform.plan_prices (plan_id, market_id, charge_kind, billing_interval, amount, currency, valid_from)
select pg_temp.did('plan:' || dp.product || '-business'), mk.id, k.kind::platform.charge_kind, k.interval::platform.billing_interval,
       case cur.code when 'USD' then dp.usd when 'PEN' then dp.pen else dp.bob end * k.mult,
       cur.code, pg_temp.m(-30)
  from demo_prices dp
 cross join (values ('LICENSE', 'MONTHLY', 1), ('IMPLEMENTATION_FEE', 'ONE_TIME', 3)) k (kind, interval, mult)
 cross join (values ('PE', 'PEN'), ('PE', 'USD'), ('BO', 'BOB'), ('BO', 'USD'), ('EC', 'USD')) cur (market, code)
  join platform.markets mk on mk.code = cur.market;

insert into platform.plan_prices (plan_id, market_id, charge_kind, billing_interval, amount, currency, valid_from)
select pg_temp.did('plan:' || e.product || '-enterprise'), mk.id, e.kind::platform.charge_kind,
       e.interval::platform.billing_interval, e.amount, 'USD', pg_temp.m(-30)
  from (values ('gmao', 'LICENSE', 'MONTHLY', 2900), ('gmao', 'INFRASTRUCTURE_FEE', 'MONTHLY', 950),
               ('gmao', 'SUPPORT_FEE', 'MONTHLY', 450), ('gmao', 'IMPLEMENTATION_FEE', 'ONE_TIME', 18000),
               ('tms', 'LICENSE', 'MONTHLY', 2600), ('tms', 'INFRASTRUCTURE_FEE', 'MONTHLY', 900),
               ('tms', 'SUPPORT_FEE', 'MONTHLY', 400), ('tms', 'IMPLEMENTATION_FEE', 'ONE_TIME', 15000))
       e (product, kind, interval, amount)
 cross join platform.markets mk
 where mk.code in ('PE', 'BO', 'EC');

-- ---------------------------------------------------------------------------
-- 5. Infraestructura: compartida para los productos sin destino y exclusiva
--    para los dos Enterprise
-- ---------------------------------------------------------------------------
insert into platform.deployment_targets (id, code, name, provider, deployment_mode, environment, region,
                                         owner_organization_id, saas_product_id, cost_center, metadata)
select pg_temp.did('target:shared:' || p.code), 'shared-' || p.code || '-sa-east',
       'Shared ' || p.short_name || ' · sa-east-1', 'SUPABASE', 'SHARED', 'PRODUCTION', 'sa-east-1',
       null, p.id, 'CC-SHARED-' || upper(p.code), pg_temp.tag()
  from platform.saas_products p
 where p.code in ('tms', 'gmao', 'echange', 'comerza', 'eexpense', 'ecommerce');

-- (los exclusivos se crean tras las organizaciones: su dueño es el cliente)

-- ---------------------------------------------------------------------------
-- 6. Organizaciones, sociedades, capacidades, acuerdos y relaciones
-- ---------------------------------------------------------------------------
insert into platform.organizations (id, slug, legal_name, display_name, kind, country_code, tax_id, status,
                                    billing_email, metadata)
select pg_temp.did('org:' || code), slug, legal, display, 'COMPANY', country, tax, 'ACTIVE',
       'cuentas@' || lower(code) || '.ebim.test', pg_temp.tag() || jsonb_build_object('rol', 'partner')
  from demo_partners;

insert into platform.organizations (id, slug, legal_name, display_name, kind, country_code, tax_id, status,
                                    billing_email, billing_first_name, billing_last_name, billing_address,
                                    billing_city, billing_phone, metadata)
select pg_temp.did('org:' || code), slug, legal, display, 'COMPANY', country,
       case country when 'PE' then '206' || lpad(((n * 7919) % 100000000)::text, 8, '0')
                    when 'BO' then '10' || lpad(((n * 6113) % 100000000)::text, 8, '0')
                    else '09' || lpad(((n * 5227) % 100000000)::text, 8, '0') || '001' end,
       'ACTIVE', 'facturacion@' || lower(code) || '.ebim.test',
       'Contacto', 'Facturación',
       'Av. Demostración ' || (100 + n) || ', Oficina ' || (200 + n),
       case country when 'PE' then 'Lima' when 'BO' then 'Santa Cruz de la Sierra' else 'Guayaquil' end,
       case country when 'PE' then '5199' when 'BO' then '5917' else '5939' end || lpad((n * 104729 % 10000000)::text, 7, '0'),
       pg_temp.tag() || jsonb_build_object('sector', sector, 'rol', 'cliente')
  from demo_customers;

insert into platform.organization_capabilities (organization_id, capability)
select pg_temp.did('org:' || p.code), cap::platform.org_capability from demo_partners p, unnest(p.caps) cap
union all
select pg_temp.did('org:' || code), 'CUSTOMER'::platform.org_capability from demo_customers;

insert into platform.companies (id, organization_id, name, country_code, currency, tax_id, is_default)
select pg_temp.did('company:' || p.code), pg_temp.did('org:' || p.code), p.display, p.country, p.currency, p.tax, true
  from demo_partners p
union all
select pg_temp.did('company:' || c.code), pg_temp.did('org:' || c.code), c.display, c.country, c.currency,
       o.tax_id, true
  from demo_customers c join platform.organizations o on o.id = pg_temp.did('org:' || c.code);

insert into platform.organization_product_agreements
  (organization_id, saas_product_id, can_resell, can_manage_tenants, margin_rate, default_deployment_mode,
   valid_from, terms, billing_responsibility, notes)
select pg_temp.did('org:' || p.code), sp.id, true, true, p.margin, 'SHARED', pg_temp.m(p.since_k),
       jsonb_build_object('nivel', case when p.billing = 'PARTNER' then 'SILVER' else 'GOLD' end, 'demo', 'gerencia-v4'),
       p.billing::platform.billing_responsibility,
       case when p.billing = 'PARTNER' then 'El partner factura al cliente final; EBIM cobra tarifa de plataforma.'
            else 'EBIM factura al cliente final; el canal gestiona y retiene margen.' end
  from demo_partners p, unnest(p.products) prod
  join platform.saas_products sp on sp.code = prod;

insert into platform.organization_relationships (parent_organization_id, child_organization_id, relationship_type)
select distinct pg_temp.did('org:' || c.partner), pg_temp.did('org:' || c.code), p.rel::platform.org_relationship_type
  from demo_customers c join demo_partners p on p.code = c.partner;

insert into platform.workspace_apps (organization_id, saas_product_id, status, activated_at)
select distinct on (m.org_id, m.product_id) m.org_id, m.product_id,
       case when m.ends_on is null then 'active' else 'suspended' end, pg_temp.at15(m.started_on)
  from demo_sub_map m order by m.org_id, m.product_id, m.started_on;

insert into platform.deployment_targets (id, code, name, provider, deployment_mode, environment, region,
                                         owner_organization_id, saas_product_id, cost_center, metadata)
select pg_temp.did('target:dedicated:' || m.ccode), lower(m.ccode) || '-' || m.product_code || '-dedicated',
       m.display || ' · ' || m.short_name || ' exclusivo', 'SUPABASE', 'TENANT_DEDICATED', 'PRODUCTION', 'sa-east-1',
       m.org_id, m.product_id, 'CC-TD-' || m.ccode, pg_temp.tag()
  from demo_sub_map m where m.kind = 'E';

-- ---------------------------------------------------------------------------
-- 7. Comerciales
-- ---------------------------------------------------------------------------
insert into platform.sales_agents (id, code, full_name, organization_id, agent_type, contact_email, valid_from, metadata)
select pg_temp.did('agent:' || a.code), a.code, a.full_name,
       case when a.org = 'EBIM' then '30000000-0000-4000-a000-000000000001'::uuid
            when a.org is not null then pg_temp.did('org:' || a.org) end,
       a.agent_type, a.email, pg_temp.m(-30), pg_temp.tag()
  from demo_agents a;

-- ---------------------------------------------------------------------------
-- 8. Tenants (uno por contrato) + 3 trials en evaluación
-- ---------------------------------------------------------------------------
insert into platform.tenants (id, slug, name, saas_product_id, customer_organization_id, managing_organization_id,
                              company_id, tenant_type, status, deployment_mode, environment, admin_email,
                              activated_at, metadata)
select m.tenant_id, m.cslug || '-' || m.product_code, m.display || ' · ' || m.short_name, m.product_id, m.org_id,
       m.partner_id, m.company_id, 'PRODUCTION', 'ACTIVE',
       case when m.kind = 'E' then 'TENANT_DEDICATED' else 'SHARED' end::platform.deployment_mode,
       'PRODUCTION', 'admin.' || m.product_code || '@' || lower(m.ccode) || '.ebim.test',
       pg_temp.at15(m.started_on), pg_temp.tag()
  from demo_sub_map m;

insert into platform.tenants (id, slug, name, saas_product_id, customer_organization_id, managing_organization_id,
                              company_id, tenant_type, status, deployment_mode, environment, admin_email,
                              activated_at, metadata)
select pg_temp.did('tenant:' || t.code || ':trial:' || t.product), t.slug || '-' || t.product || '-trial',
       t.display || ' · ' || p.short_name || ' (prueba)', p.id, pg_temp.did('org:' || t.code), null,
       pg_temp.did('company:' || t.code), 'TRIAL', 'ACTIVE', 'SHARED', 'TRIAL',
       'trial.' || t.product || '@' || lower(t.code) || '.ebim.test', now() - make_interval(days => t.days),
       pg_temp.tag()
  from (select c.code, c.slug, c.display, x.product, x.days
          from demo_customers c
          join (values ('MISTI', 'tms', 12), ('VALTO', 'gmao', 6), ('ESMERALDAS', 'ecommerce', 18)) x (code, product, days)
            on x.code = c.code) t
  join platform.saas_products p on p.code = t.product;

insert into platform.tenant_deployments (tenant_id, deployment_target_id, deployed_at)
select t.id,
       case when t.deployment_mode = 'TENANT_DEDICATED' then pg_temp.did('target:dedicated:' ||
                 (select m.ccode from demo_sub_map m where m.tenant_id = t.id))
            when p.code = 'esupplier' then '40000000-0000-4000-a000-000000000001'::uuid
            when p.code = 'ewm' then '40000000-0000-4000-a000-000000000002'::uuid
            else pg_temp.did('target:shared:' || p.code) end,
       t.activated_at
  from platform.tenants t join platform.saas_products p on p.id = t.saas_product_id
 where t.metadata ->> 'demo' = 'gerencia-v4';

-- ---------------------------------------------------------------------------
-- 9. Contratos, ítems, perfiles de cobro y atribuciones
-- ---------------------------------------------------------------------------
insert into platform.subscriptions (id, code, billed_organization_id, saas_product_id, tenant_id, plan_id, market_id,
                                    status, billing_interval, currency, quantity, started_on, ends_on,
                                    channel_margin_rate, billing_channel, notes, metadata)
select m.sub_id, m.sub_code, m.org_id, m.product_id, m.tenant_id, pg_temp.did('plan:' || m.plan_code), mk.id,
       'ACTIVE', 'MONTHLY', m.currency, 1, m.started_on, m.ends_on,
       case when m.partner is not null and not m.partner_statement then dp.margin end,
       case when m.partner_statement then 'PARTNER_STATEMENT' else 'DIRECT' end,
       case when m.partner_statement then 'Facturado por el partner; EBIM cobra la tarifa de plataforma.'
            when m.partner is not null then 'Venta por canal; EBIM factura al cliente final.'
            else 'Venta directa EBIM.' end,
       pg_temp.tag() || jsonb_build_object('origin', 'demo')
  from demo_sub_map m
  join platform.markets mk on mk.code = m.country
  left join demo_partners dp on dp.code = m.partner;

-- Ítems: licencia (o licencia + infra + soporte en Enterprise), implementación
-- única (solo altas dentro de la ventana) y usuarios adicionales.
insert into platform.subscription_items (subscription_id, charge_kind, description, quantity, unit_amount, currency,
                                         billing_interval, tenant_id, valid_from, valid_to)
select m.sub_id, 'LICENSE'::platform.charge_kind, 'Licencia ' || m.short_name || ' Business', 1,
       case m.currency when 'USD' then dp.usd when 'PEN' then dp.pen else dp.bob end,
       m.currency, 'MONTHLY'::platform.billing_interval, m.tenant_id, m.started_on, m.ends_on
  from demo_sub_map m join demo_prices dp on dp.product = m.product_code
 where m.kind = 'B'
union all
select m.sub_id, e.kind::platform.charge_kind, e.descr || ' ' || m.short_name || ' Enterprise', 1, e.amount, 'USD',
       'MONTHLY'::platform.billing_interval, m.tenant_id, m.started_on, m.ends_on
  from demo_sub_map m
  join (values ('gmao', 'LICENSE', 'Licencia', 2900), ('gmao', 'INFRASTRUCTURE_FEE', 'Infraestructura exclusiva', 950),
               ('gmao', 'SUPPORT_FEE', 'Soporte premium', 450),
               ('tms', 'LICENSE', 'Licencia', 2600), ('tms', 'INFRASTRUCTURE_FEE', 'Infraestructura exclusiva', 900),
               ('tms', 'SUPPORT_FEE', 'Soporte premium', 400)) e (product, kind, descr, amount)
    on e.product = m.product_code
 where m.kind = 'E'
union all
select m.sub_id, 'IMPLEMENTATION_FEE'::platform.charge_kind, 'Implementación y puesta en marcha ' || m.short_name, 1,
       case when m.kind = 'E' then case m.product_code when 'gmao' then 18000 else 15000 end
            else 3 * case m.currency when 'USD' then dp.usd when 'PEN' then dp.pen else dp.bob end end,
       m.currency, 'ONE_TIME'::platform.billing_interval, m.tenant_id, m.started_on,
       -- Altas anteriores a la ventana: su implementación ya se facturó antes de M-18.
       case when m.start_k < -18 then m.started_on + 30 end
  from demo_sub_map m join demo_prices dp on dp.product = m.product_code
 where not m.partner_statement
union all
select m.sub_id, 'ADDON'::platform.charge_kind, 'Usuarios adicionales (' || m.x1_qty || ')', m.x1_qty,
       case m.currency when 'USD' then 24 when 'PEN' then 90 else 165 end, m.currency, 'MONTHLY'::platform.billing_interval, m.tenant_id,
       pg_temp.m(m.x1_k), coalesce(pg_temp.m(m.x2_k) - 1, m.ends_on)
  from demo_sub_map m where m.x1_k is not null
union all
select m.sub_id, 'ADDON'::platform.charge_kind, 'Usuarios adicionales (' || m.x2_qty || ')', m.x2_qty,
       case m.currency when 'USD' then 24 when 'PEN' then 90 else 165 end, m.currency, 'MONTHLY'::platform.billing_interval, m.tenant_id,
       pg_temp.m(m.x2_k), m.ends_on
  from demo_sub_map m where m.x2_k is not null and m.x2_qty > 0;

insert into platform.subscription_collection_profiles (subscription_id, collection_method, provider_account_id,
  auto_charge, invoice_lead_days, renewal_notice_days, payment_due_days, grace_period_days, document_lead_days,
  auto_suspend, currency, status, effective_from, notes)
select m.sub_id, x.method::platform.collection_method,
       case x.method when 'CULQI_CARD' then (select id from platform.payment_provider_accounts where code = 'culqi-pe-test')
                     when 'BANK_TRANSFER' then (select id from platform.payment_provider_accounts
                                                 where code = case m.country when 'BO' then 'banco-bo-demo'
                                                                             when 'EC' then 'banco-ec-demo' end) end,
       x.method = 'CULQI_CARD', 0, 5, 15, 30, 45, false, m.currency, 'ACTIVE', m.started_on,
       case x.method when 'CULQI_CARD' then 'Cargo recurrente con tarjeta (Culqi TEST/MOCK).'
                     when 'MANUAL' then 'Facturado por el partner.'
                     else 'Transferencia conciliada por finanzas.' end
  from demo_sub_map m
 cross join lateral (select case when m.partner_statement then 'MANUAL'
                                 when m.country = 'PE' and m.currency = 'USD' and m.partner is null
                                      and pg_temp.r('culqi' || m.ccode) < 60 then 'CULQI_CARD'
                                 else 'BANK_TRANSFER' end as method) x;

insert into platform.sales_attributions (id, sales_agent_id, saas_product_id, tenant_id, subscription_id,
  customer_organization_id, channel_organization_id, attribution_pct, source, commission_plan_id, valid_from, notes)
select pg_temp.did('attr:' || m.sub_code), pg_temp.did('agent:' || m.agent), m.product_id, m.tenant_id, m.sub_id,
       m.org_id, m.partner_id, 1.0, a.source, cp.id, m.started_on,
       'Atribución de la venta (demo gerencia-v4). Sin acceso operativo al tenant.'
  from demo_sub_map m
  join demo_agents a on a.code = m.agent
  join platform.commission_plans cp on cp.code = a.plan_code;

-- ---------------------------------------------------------------------------
-- 10. Facturación mensual con el motor real (issue_subscription_invoice)
--     M-18 … M0. Se emite el 1.º de cada mes y vence a los 15 días.
-- ---------------------------------------------------------------------------
do $$
declare
  v_k    int;
  v_ps   date;
  v_sub  record;
  v_res  jsonb;
  v_n    int := 0;
begin
  perform pg_temp.act_as(pg_temp.finance());
  for v_k in -18 .. 0 loop
    v_ps := pg_temp.m(v_k);
    for v_sub in
      select m.sub_id from demo_sub_map m
       where not m.partner_statement
         and m.started_on <= pg_temp.mend(v_k)
         and (m.ends_on is null or m.ends_on >= v_ps)
       order by m.sub_code
    loop
      continue when not exists (select 1 from platform.subscription_due_items(v_sub.sub_id, v_ps));
      v_res := platform.issue_subscription_invoice(v_sub.sub_id, v_ps);
      update platform.invoices
         set issue_date = v_ps, due_date = v_ps + 15,
             notes = 'Factura del periodo ' || to_char(v_ps, 'MM/YYYY'),
             metadata = metadata || pg_temp.tag()
       where id = (v_res ->> 'invoice_id')::uuid;
      v_n := v_n + 1;
    end loop;
  end loop;
  raise notice 'DEMO · facturas emitidas: %', v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Cobros con confirm_manual_payment (el trigger devenga las comisiones)
-- ---------------------------------------------------------------------------
do $$
declare
  v_inv     record;
  v_k       int;
  v_r       int;
  v_off     int;
  v_amount  numeric(14,2);
  v_paid    timestamptz;
  v_n       int := 0;
  v_plan    jsonb;
  v_part    jsonb;
begin
  perform pg_temp.act_as(pg_temp.finance());
  for v_inv in
    select i.id, i.number, i.total, i.issue_date, m.pay, m.stop_k, m.ccode,
           coalesce(cp.collection_method::text, 'BANK_TRANSFER') as method
      from platform.invoices i
      join demo_sub_map m on m.sub_id = i.subscription_id
      left join platform.subscription_collection_profiles cp
        on cp.subscription_id = i.subscription_id and cp.status = 'ACTIVE'
     where i.metadata ->> 'demo' = 'gerencia-v4' and i.total > 0
     order by i.issue_date, i.number
  loop
    v_k := (extract(year from v_inv.issue_date)::int * 12 + extract(month from v_inv.issue_date)::int)
         - (extract(year from current_date)::int * 12 + extract(month from current_date)::int);
    v_r := pg_temp.r('pay:' || v_inv.number);

    -- Calendario de pagos: [{días desde la emisión, fracción}]
    v_plan := case
      when v_inv.pay = 'M' and v_k >= v_inv.stop_k then '[]'::jsonb
      when v_inv.pay in ('T', 'M') then jsonb_build_array(jsonb_build_array(30 + v_r % 46, 1))
      when v_inv.pay = 'X' then jsonb_build_array(jsonb_build_array(9 + v_r % 4, 0.6), jsonb_build_array(38 + v_r % 10, 1))
      when v_inv.method = 'CULQI_CARD' then jsonb_build_array(jsonb_build_array(1 + v_r % 3, 1))
      when v_r < 12 then jsonb_build_array(jsonb_build_array(25 + v_r * 3, 1))  -- puntual que se retrasa
      else jsonb_build_array(jsonb_build_array(3 + v_r % 12, 1))
    end;

    for v_part in select value from jsonb_array_elements(v_plan) loop
      v_paid := pg_temp.at15(v_inv.issue_date + (v_part ->> 0)::int);
      exit when v_paid > now();
      -- fracción acumulada → importe de esta parte (la última salda la factura)
      v_amount := round(v_inv.total * (v_part ->> 1)::numeric, 2)
                - coalesce((select sum(p.amount) from platform.payments p
                             where p.invoice_id = v_inv.id and p.status = 'CONFIRMED'), 0);
      continue when v_amount <= 0;
      perform platform.confirm_manual_payment(
        v_inv.id, v_amount,
        'OP-' || to_char(v_paid, 'YYMMDD') || '-' || upper(substr(md5(v_inv.number || (v_part ->> 0)), 1, 6)),
        case when v_inv.method = 'CULQI_CARD' then 'CULQI_CARD' else 'BANK_TRANSFER' end,
        v_paid, null);
      v_n := v_n + 1;
    end loop;
  end loop;
  raise notice 'DEMO · cobros confirmados: %', v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Bajas: el contrato se cierra al final de su último mes facturado
-- ---------------------------------------------------------------------------
update platform.subscriptions s
   set status = 'CANCELLED', cancelled_at = pg_temp.at15(m.ends_on - 20),
       notes = 'Baja del cliente al cierre de ' || to_char(m.ends_on, 'MM/YYYY') || '.'
  from demo_sub_map m
 where s.id = m.sub_id and m.ends_on is not null;

update platform.tenants t
   set status = 'CHURNED', churned_at = pg_temp.at15(m.ends_on)
  from demo_sub_map m
 where t.id = m.tenant_id and m.ends_on is not null;

update platform.subscription_collection_profiles cp
   set status = 'INACTIVE', effective_to = m.ends_on
  from demo_sub_map m
 where cp.subscription_id = m.sub_id and m.ends_on is not null;

-- Cliente sin ningún contrato vivo → cuenta inactiva.
update platform.organizations o
   set status = 'INACTIVE'
 where o.metadata ->> 'demo' = 'gerencia-v4'
   and exists (select 1 from demo_sub_map m where m.org_id = o.id)
   and not exists (select 1 from demo_sub_map m where m.org_id = o.id and m.ends_on is null);

-- ---------------------------------------------------------------------------
-- 13. Liquidaciones: trimestres cerrados PAGADOS (aprobar → pagar con las
--     RPCs reales de la fase 13); del trimestre anterior, la de Lucía (USD)
--     queda ABIERTA y la primera de otro comercial queda APROBADA a la espera
--     del pago; el resto de comisiones recientes, ELEGIBLES.
-- ---------------------------------------------------------------------------
do $$
declare
  v_q        record;
  v_stl      uuid;
  v_open_q   date := (date_trunc('quarter', current_date) - interval '3 months')::date;
  v_approved boolean := false;
begin
  perform pg_temp.act_as(pg_temp.finance());
  for v_q in
    select distinct e.sales_agent_id, a.code, e.currency,
           date_trunc('quarter', e.earned_on)::date as qs,
           (date_trunc('quarter', e.earned_on) + interval '3 months' - interval '1 day')::date as qe
      from platform.commission_events e
      join platform.sales_agents a on a.id = e.sales_agent_id
     where a.metadata ->> 'demo' = 'gerencia-v4' and e.status = 'ELIGIBLE'
       and date_trunc('quarter', e.earned_on)::date <= v_open_q
     order by qs, a.code, e.currency
  loop
    if v_q.qs = v_open_q then
      if v_q.code = 'lucia-paredes' and v_q.currency = 'USD' then
        perform platform.settle_commissions(v_q.sales_agent_id, v_q.qs, v_q.qe, v_q.currency);
      elsif not v_approved then
        v_stl := platform.settle_commissions(v_q.sales_agent_id, v_q.qs, v_q.qe, v_q.currency);
        perform platform.approve_commission_settlement(v_stl, 'Revisada contra cobros del trimestre.');
        -- Nunca en el futuro: el trimestre puede haber cerrado hace menos de 8 días.
        update platform.commission_settlements
           set approved_at = least(pg_temp.at15(v_q.qe + 8), now() - interval '1 hour') where id = v_stl;
        v_approved := true;
      end if;
      continue;
    end if;
    v_stl := platform.settle_commissions(v_q.sales_agent_id, v_q.qs, v_q.qe, v_q.currency);
    perform platform.approve_commission_settlement(v_stl, null);
    -- La aprobación se fecha en su día real antes de pagar (luego es terminal).
    update platform.commission_settlements set approved_at = pg_temp.at15(v_q.qe + 8) where id = v_stl;
    perform platform.pay_commission_settlement(
      v_stl, v_q.qe + 15,
      'LIQ-' || to_char(v_q.qs, 'YYYY') || 'Q' || extract(quarter from v_q.qs) || '-' || upper(left(v_q.code, 6)),
      'BANK_TRANSFER', 'Liquidación trimestral pagada por transferencia.');
  end loop;

  -- Generadas en su día real (2 h antes de aprobarse), nunca en el futuro.
  update platform.commission_settlements s
     set created_at = least(pg_temp.at15(s.period_end + 8) - interval '2 hours', now() - interval '2 hours')
    from platform.sales_agents a
   where a.id = s.sales_agent_id and a.metadata ->> 'demo' = 'gerencia-v4';
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. Costos de infraestructura y operación (USD), por producto y plataforma.
--     Solo meses cerrados (M-18 … M-1): el costo del mes se reconoce al cierre,
--     cuando llegan las facturas de proveedores.
-- ---------------------------------------------------------------------------
create temp table demo_cost_base on commit drop as
select k, p.id as product_id, p.code, p.short_name,
       (select count(*) from demo_sub_map m
         where m.product_id = p.id and m.started_on <= pg_temp.mend(k)
           and (m.ends_on is null or m.ends_on >= pg_temp.m(k)))::int as tenants
  from generate_series(-18, -1) k cross join platform.saas_products p
 where p.code in (select product from demo_prices);

create temp table demo_cost_rows on commit drop as
select pg_temp.did('cost:' || b.code || ':' || c.cat || ':' || b.k) as id, b.k, b.product_id, c.cat,
       c.descr || ' · ' || b.short_name as description, c.vendor,
       round(c.base + c.per_tenant * b.tenants + (pg_temp.r('cost' || b.code || c.cat || b.k) - 50) / 10.0, 2) as amount
  from demo_cost_base b
 cross join (values ('DATABASE', 'Base de datos compartida', 'Supabase', 140, 18),
                    ('COMPUTE', 'Cómputo y funciones', 'Supabase', 90, 14),
                    ('SUPPORT', 'Soporte N1/N2', 'EBIM', 40, 42),
                    ('THIRD_PARTY', 'Inferencia IA', 'Proveedor IA', 0, 22)) c (cat, descr, vendor, base, per_tenant)
 where b.tenants > 0 and (c.cat <> 'THIRD_PARTY' or b.code in ('esupplier', 'ewm', 'eexpense'))
union all
select pg_temp.did('cost:platform:' || x.cat || ':' || k), k, null, x.cat, x.descr, x.vendor,
       round(x.base + x.slope * (k + 18) + (pg_temp.r('costp' || x.cat || k) - 50) / 10.0, 2)
  from generate_series(-18, -1) k
 cross join (values ('FRONTEND_HOSTING', 'Hosting y CDN de la suite', 'Vercel/Cloudflare', 260, 7),
                    ('MESSAGING', 'Correo y WhatsApp transaccional', 'Twilio/M365', 120, 9),
                    ('DOMAIN', 'Dominios y certificados', 'Cloudflare', 35, 0)) x (cat, descr, vendor, base, slope)
union all
select pg_temp.did('cost:dedicated:' || m.ccode || ':' || k), k, null, 'DEDICATED_INFRA',
       'Proyecto exclusivo · ' || m.display || ' (' || m.short_name || ')', 'Supabase',
       case m.product_code when 'gmao' then 780 else 690 end
  from demo_sub_map m cross join generate_series(-18, -1) k
 where m.kind = 'E' and m.started_on <= pg_temp.mend(k);

insert into platform.cost_entries (id, category, description, vendor, amount, currency, period_start, period_end, metadata)
select id, cat::platform.cost_category, description, vendor, amount, 'USD', pg_temp.m(k), pg_temp.mend(k), pg_temp.tag()
  from demo_cost_rows;

insert into platform.cost_allocations (cost_entry_id, scope, saas_product_id, tenant_id, weight, allocation_rule)
select r.id,
       case when r.cat = 'DEDICATED_INFRA' then 'TENANT' when r.product_id is null then 'PLATFORM' else 'PRODUCT' end::platform.cost_scope,
       r.product_id,
       case when r.cat = 'DEDICATED_INFRA' then
         (select m.tenant_id from demo_sub_map m where m.kind = 'E' and r.id = pg_temp.did('cost:dedicated:' || m.ccode || ':' || r.k)) end,
       1, case when r.cat = 'DEDICATED_INFRA' then 'DIRECTO' when r.product_id is null then 'GLOBAL' else 'DEMO_PRODUCTO' end
  from demo_cost_rows r;

-- ---------------------------------------------------------------------------
-- 15. Uso y créditos IA (eSupplier y EWM, M-6 … M0) con las RPCs reales
-- ---------------------------------------------------------------------------
create temp table demo_usage_tenants (ccode text, product text, intensity numeric) on commit drop;
insert into demo_usage_tenants values
  ('VSUR', 'esupplier', 0.8), ('CNEGRA', 'esupplier', 1.6), ('CHINCHA', 'esupplier', 0.6),
  ('GUAPAY', 'esupplier', 0.5), ('GDORADO', 'esupplier', 0.7),
  ('RIMAC', 'ewm', 0.9), ('CEMANDINA', 'ewm', 0.6), ('ILLAMPU', 'ewm', 1.4);

select pg_temp.act_as(pg_temp.padmin());
select platform.import_capability_manifest('esupplier', '{
  "schema": "ebim.capabilities/v1", "productCode": "esupplier", "manifestVersion": "demo-gerencia-v4",
  "capabilities": [
    {"code": "esupplier.ai.copilot", "name": "Copiloto de compras", "kind": "AI_FEATURE", "meterCode": "esupplier.ai.calls", "status": "ACTIVE"},
    {"code": "esupplier.ai.ocr", "name": "Lectura inteligente de comprobantes", "kind": "AI_FEATURE", "meterCode": "esupplier.ai.ocr_pages", "status": "ACTIVE"}
  ]}'::jsonb);
select platform.import_capability_manifest('ewm', '{
  "schema": "ebim.capabilities/v1", "productCode": "ewm", "manifestVersion": "demo-gerencia-v4",
  "capabilities": [
    {"code": "ewm.ai.forecast", "name": "Pronóstico de demanda", "kind": "AI_FEATURE", "meterCode": "ewm.ai.forecast_runs", "status": "ACTIVE"}
  ]}'::jsonb);
select platform.upsert_usage_meter('esupplier', 'esupplier.ai.calls', 'Consultas al copiloto', 'call', 'SUM', 'ACTIVE',
                                   p_capability_code => 'esupplier.ai.copilot');
select platform.upsert_usage_meter('esupplier', 'esupplier.ai.ocr_pages', 'Páginas leídas por OCR', 'page', 'SUM', 'ACTIVE',
                                   p_capability_code => 'esupplier.ai.ocr');
select platform.upsert_usage_meter('esupplier', 'esupplier.docs.purchase_orders', 'Órdenes de compra emitidas', 'document',
                                   'SUM', 'ACTIVE');
select platform.upsert_usage_meter('ewm', 'ewm.ai.forecast_runs', 'Corridas de pronóstico', 'run', 'SUM', 'ACTIVE',
                                   p_capability_code => 'ewm.ai.forecast');

-- Los eventos se reciben por el destino DEV del producto (adaptador local).
insert into platform.tenant_product_mappings (tenant_id, saas_product_id, deployment_target_id, external_tenant_id,
  external_organization_id, external_company_id, status, provisioned_at, registered_manually, metadata)
select m.tenant_id, m.product_id,
       case m.product_code when 'esupplier' then '40000000-0000-4000-a000-00000000000a'::uuid
                           else '40000000-0000-4000-a000-000000000007'::uuid end,
       'ext-' || lower(m.ccode) || '-' || m.product_code, 'ext-org-' || lower(m.ccode), 'ext-co-' || lower(m.ccode),
       'ACTIVE', pg_temp.at15(m.started_on), true, pg_temp.tag()
  from demo_sub_map m join demo_usage_tenants u on u.ccode = m.ccode and u.product = m.product_code;

select pg_temp.act_as(pg_temp.finance());
select platform.set_ai_credit_weight('esupplier.ai.copilot', 2, 'call', pg_temp.at15(pg_temp.m(-7)),
                                     'DEMO gerencia-v4 · peso ficticio para la presentación local');
select platform.set_ai_credit_weight('esupplier.ai.ocr', 0.5, 'page', pg_temp.at15(pg_temp.m(-7)),
                                     'DEMO gerencia-v4 · peso ficticio para la presentación local');
select platform.set_ai_credit_weight('ewm.ai.forecast', 8, 'run', pg_temp.at15(pg_temp.m(-7)),
                                     'DEMO gerencia-v4 · peso ficticio para la presentación local');
select platform.create_ai_credit_policy('PLAN', 'esupplier-business', 'TENANT', 2500, 'ALLOW', pg_temp.m(-7),
                                        'DEMO gerencia-v4 · 2.500 créditos incluidos al mes; exceso permitido');
select platform.create_ai_credit_policy('PLAN', 'ewm-business', 'TENANT', 600, 'BLOCK', pg_temp.m(-7),
                                        'DEMO gerencia-v4 · 600 créditos incluidos al mes; exceso bloqueado');

do $$
declare
  v_t   record;
  v_k   int;
  v_ev  jsonb;
  v_day int;
begin
  -- Períodos de créditos abiertos (GRANT_PERIOD) M-6 … M0
  perform pg_temp.act_as(pg_temp.finance());
  for v_t in select m.tenant_id from demo_sub_map m
               join demo_usage_tenants u on u.ccode = m.ccode and u.product = m.product_code loop
    for v_k in -6 .. 0 loop
      perform platform.open_ai_credit_period(v_t.tenant_id, pg_temp.m(v_k));
    end loop;
  end loop;

  -- Eventos: 4 por mes y medidor (días 3, 10, 17, 24), creciendo con el tiempo.
  perform pg_temp.act_as_service();
  for v_t in select m.tenant_id, m.ccode, m.product_code, u.intensity from demo_sub_map m
               join demo_usage_tenants u on u.ccode = m.ccode and u.product = m.product_code loop
    v_ev := '[]'::jsonb;
    for v_k in -6 .. 0 loop
      foreach v_day in array array[3, 10, 17, 24] loop
        continue when pg_temp.m(v_k) + (v_day - 1) >= current_date;
        v_ev := v_ev || (
          select jsonb_agg(jsonb_build_object(
                   'eventId', pg_temp.did('event:' || v_t.ccode || ':' || mt.code || ':' || v_k || ':' || v_day)::text,
                   'meterCode', mt.code, 'quantity', greatest(1, round(mt.base * v_t.intensity * (1 + (v_k + 6) * 0.08)
                                                     * (0.8 + pg_temp.r(v_t.ccode || mt.code || v_k || v_day) / 250.0))),
                   'unit', mt.unit,
                   'occurredAt', to_char((pg_temp.m(v_k) + (v_day - 1) + time '14:30') at time zone 'UTC',
                                         'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                   'controlPlaneTenantId', v_t.tenant_id::text)
                   || case when mt.cap is not null then jsonb_build_object('capabilityCode', mt.cap) else '{}'::jsonb end)
            from (values ('esupplier', 'esupplier.ai.calls', 'call', 'esupplier.ai.copilot', 140),
                         ('esupplier', 'esupplier.ai.ocr_pages', 'page', 'esupplier.ai.ocr', 260),
                         ('esupplier', 'esupplier.docs.purchase_orders', 'document', null, 85),
                         ('ewm', 'ewm.ai.forecast_runs', 'run', 'ewm.ai.forecast', 11)) mt (product, code, unit, cap, base)
           where mt.product = v_t.product_code);
      end loop;
    end loop;
    perform platform.ingest_usage_events(v_t.product_code, 'DEV', v_ev, pg_temp.did('batch:' || v_t.ccode));
  end loop;

  -- Cierre (pasada la gracia) y finalización: el consumo de créditos nace aquí.
  perform platform.close_usage_periods(now());
  perform pg_temp.act_as(pg_temp.finance());
  for v_t in select a.id from platform.usage_period_aggregates a
              where a.tenant_id in (select m.tenant_id from demo_sub_map m) and a.status = 'CLOSING'
              order by a.period_start, a.meter_code loop
    perform platform.finalize_usage_aggregate(v_t.id);
  end loop;

  -- Un bono comercial por renovación.
  perform platform.record_ai_credit_entry(pg_temp.did('tenant:CNEGRA:esupplier'), 'TENANT', pg_temp.m(0), 'GRANT_BONUS',
                                          1000, 'Bono comercial por ampliación de contrato (demo gerencia-v4)',
                                          'demo-gerencia-v4:bono-cnegra');
end;
$$;

-- ---------------------------------------------------------------------------
-- 16. Tarifa de plataforma de Nexo (factura el partner): 30 % de la lista.
--     M-2 emitida y cobrada; M-1 calculada (borrador).
-- ---------------------------------------------------------------------------
do $$
declare
  v_agr  record;
  v_res  jsonb;
  v_stmt uuid;
  v_inv  record;
begin
  perform pg_temp.act_as(pg_temp.finance());
  for v_agr in select a.id from platform.organization_product_agreements a
                where a.organization_id = pg_temp.did('org:NEXO') loop
    perform platform.set_agreement_platform_fee(v_agr.id, 'PERCENT_OF_LIST', 0.30, null, null,
                                                'Tarifa de plataforma acordada con el partner (demo gerencia-v4)');
  end loop;

  perform platform.compute_partner_fee_statement(pg_temp.did('org:NEXO'), pg_temp.m(-2));
  perform platform.compute_partner_fee_statement(pg_temp.did('org:NEXO'), pg_temp.m(-1));

  for v_stmt in select s.id from platform.partner_fee_statements s
                 where s.partner_organization_id = pg_temp.did('org:NEXO') and s.period_start = pg_temp.m(-2)
                   and s.status = 'DRAFT' loop
    perform platform.issue_partner_fee_statement(v_stmt);
  end loop;

  for v_inv in select i.id, i.total, i.currency from platform.invoices i
                join platform.partner_fee_statements s on s.invoice_id = i.id
               where s.partner_organization_id = pg_temp.did('org:NEXO') loop
    update platform.invoices
       set issue_date = pg_temp.m(-1) + 2, due_date = pg_temp.m(-1) + 17, metadata = metadata || pg_temp.tag()
     where id = v_inv.id;
    update platform.partner_fee_statements set issued_at = pg_temp.at15(pg_temp.m(-1) + 2)
     where invoice_id = v_inv.id;
    if v_inv.total > 0 then
      perform platform.confirm_manual_payment(v_inv.id, v_inv.total,
        'OP-' || to_char(pg_temp.m(-1) + 12, 'YYMMDD') || '-NEXO-' || v_inv.currency, 'BANK_TRANSFER',
        pg_temp.at15(pg_temp.m(-1) + 12), 'Tarifa de plataforma del partner');
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 17. Enlaces de pago para dos clientes con deuda vencida
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.finance());
select platform.create_payment_link(pg_temp.did('org:QHAPAQ'), 15, true,
                                    'Regularización de facturas vencidas (demo gerencia-v4)');
select platform.create_payment_link(pg_temp.did('org:CALLAO'), 30, false,
                                    'Pago del periodo en curso (demo gerencia-v4)');

-- ---------------------------------------------------------------------------
-- 18. Alertas de cobranza (idempotente) y bitácora de la carga
-- ---------------------------------------------------------------------------
-- refresh_billing_alerts es global: lo que genere o cambie fuera de la demo se
-- revierte, para que la carga no toque el estado del seed base.
create temp table demo_alerts_before on commit drop as select * from platform.billing_alerts;
select pg_temp.act_as(pg_temp.sadmin());
select platform.refresh_billing_alerts(now());
delete from platform.billing_alerts a
 where a.subscription_id not in (select sub_id from demo_sub_map)
   and not exists (select 1 from demo_alerts_before b where b.id = a.id);
update platform.billing_alerts a
   set status = b.status, severity = b.severity, title = b.title, message = b.message, metadata = b.metadata,
       due_at = b.due_at, reference_date = b.reference_date, acknowledged_at = b.acknowledged_at,
       resolved_at = b.resolved_at, resolved_by = b.resolved_by
  from demo_alerts_before b
 where b.id = a.id
   and (a.status, a.severity, a.title, a.message, a.metadata, a.due_at, a.reference_date, a.acknowledged_at,
        a.resolved_at, a.resolved_by)
       is distinct from
       (b.status, b.severity, b.title, b.message, b.metadata, b.due_at, b.reference_date, b.acknowledged_at,
        b.resolved_at, b.resolved_by);

-- La bitácora queda con la fecha de negocio (no la de la carga) y etiquetada
-- para que demo-unload.sql la retire.
update platform.audit_logs l
   set occurred_at = pg_temp.at15(i.issue_date) - interval '6 hours'
  from platform.invoices i
 where l.id > (select id from demo_audit_floor) and l.action = 'INVOICE_ISSUED' and l.entity_id = i.id::text;
update platform.audit_logs l
   set occurred_at = p.paid_at
  from platform.payments p
 where l.id > (select id from demo_audit_floor) and l.action = 'MANUAL_PAYMENT_CONFIRMED' and l.entity_id = p.id::text;
update platform.audit_logs l
   set occurred_at = case l.action
                       when 'COMMISSION_SETTLEMENT_PAID' then s.paid_at
                       when 'COMMISSION_SETTLEMENT_APPROVED' then s.approved_at
                       else least(pg_temp.at15(s.period_end + 8) - interval '2 hours', s.created_at) end
  from platform.commission_settlements s
 where l.id > (select id from demo_audit_floor)
   and l.action in ('COMMISSIONS_SETTLED', 'COMMISSION_SETTLEMENT_APPROVED', 'COMMISSION_SETTLEMENT_PAID')
   and l.entity_id = s.id::text;
update platform.audit_logs
   set metadata = metadata || pg_temp.tag()
 where id > (select id from demo_audit_floor);

-- ---------------------------------------------------------------------------
-- 19. Verificación: si algo no cuadra, la carga falla y no queda nada
-- ---------------------------------------------------------------------------
do $$
declare
  v_customers int; v_subs int; v_churned int; v_invoices int; v_payments int; v_events int;
  v_desync int; v_integrity int; v_buckets int; v_paid_stl int; v_open_stl int; v_appr_stl int; v_ledger int;
  v_links int; v_stmts int; v_products int;
begin
  select count(*) into v_customers from platform.organizations o
   where o.metadata ->> 'demo' = 'gerencia-v4' and o.metadata ->> 'rol' = 'cliente';
  select count(*), count(*) filter (where status = 'CANCELLED') into v_subs, v_churned
    from platform.subscriptions where metadata ->> 'demo' = 'gerencia-v4';
  select count(distinct saas_product_id) into v_products from platform.subscriptions where metadata ->> 'demo' = 'gerencia-v4';
  select count(*) into v_invoices from platform.invoices where metadata ->> 'demo' = 'gerencia-v4';
  select count(*) into v_payments from platform.payments p
    join platform.invoices i on i.id = p.invoice_id where i.metadata ->> 'demo' = 'gerencia-v4';
  select count(*) into v_events from platform.commission_events e
    join platform.payments p on p.id = e.payment_id
    join platform.invoices i on i.id = p.invoice_id where i.metadata ->> 'demo' = 'gerencia-v4';
  -- Estado de factura sincronizado con sus cobros (misma regla que sync_invoice_payment_status).
  select count(*) into v_desync from platform.v_invoice_balances b
    join platform.invoices i on i.id = b.invoice_id
   where i.metadata ->> 'demo' = 'gerencia-v4'
     and b.status <> case when b.confirmed_paid <= 0 then 'ISSUED'::platform.invoice_status
                          when b.confirmed_paid >= b.total then 'PAID'::platform.invoice_status
                          else 'PARTIALLY_PAID'::platform.invoice_status end;
  select count(*) into v_integrity from platform.v_currency_integrity_issues;
  select count(distinct b.aging_bucket) into v_buckets from platform.v_invoice_balances b
    join platform.invoices i on i.id = b.invoice_id
   where i.metadata ->> 'demo' = 'gerencia-v4' and b.aging_bucket in ('D1_30', 'D31_60', 'D61_90', 'D90_MAS');
  select count(*) filter (where s.status = 'PAID'), count(*) filter (where s.status = 'OPEN'),
         count(*) filter (where s.status = 'APPROVED')
    into v_paid_stl, v_open_stl, v_appr_stl
    from platform.commission_settlements s join platform.sales_agents a on a.id = s.sales_agent_id
   where a.metadata ->> 'demo' = 'gerencia-v4';
  select count(*) into v_ledger from platform.ai_credit_ledger
   where tenant_id in (select id from platform.tenants where metadata ->> 'demo' = 'gerencia-v4');
  select count(*) into v_links from platform.payment_links
   where organization_id in (select id from platform.organizations where metadata ->> 'demo' = 'gerencia-v4');
  select count(*) into v_stmts from platform.partner_fee_statements where partner_organization_id = pg_temp.did('org:NEXO');

  if v_customers < 35 or v_subs < 60 or v_products < 8 then
    raise exception 'DEMO_INCOMPLETO: clientes=% contratos=% productos=%', v_customers, v_subs, v_products;
  end if;
  if v_churned < 4 then raise exception 'DEMO_INCOMPLETO: bajas=%', v_churned; end if;
  if v_events = 0 then raise exception 'DEMO_INCOMPLETO: los cobros no devengaron comisiones'; end if;
  if v_desync > 0 then raise exception 'DEMO_INCOHERENTE: % facturas con estado distinto a sus cobros', v_desync; end if;
  if v_integrity > 0 then raise exception 'DEMO_INCOHERENTE: % filas con moneda distinta a su padre', v_integrity; end if;
  if v_buckets < 4 then raise exception 'DEMO_INCOMPLETO: cartera vencida solo en % bandas de 4', v_buckets; end if;
  if v_paid_stl = 0 or v_open_stl <> 1 or v_appr_stl <> 1 then
    raise exception 'DEMO_INCOMPLETO: liquidaciones pagadas=% abiertas=% aprobadas=%', v_paid_stl, v_open_stl, v_appr_stl;
  end if;
  if v_ledger = 0 then raise exception 'DEMO_INCOMPLETO: sin movimientos de créditos IA'; end if;
  if v_links < 2 then raise exception 'DEMO_INCOMPLETO: enlaces de pago=%', v_links; end if;
  if v_stmts < 2 then raise exception 'DEMO_INCOMPLETO: estados de cuenta de partner=%', v_stmts; end if;

  raise notice 'DEMO gerencia-v4 OK · clientes=% contratos=% bajas=% facturas=% cobros=% comisiones=% liquidaciones(pagadas/aprobadas/abiertas)=%/%/% creditos=% enlaces=% estados_partner=%',
    v_customers, v_subs, v_churned, v_invoices, v_payments, v_events, v_paid_stl, v_appr_stl, v_open_stl, v_ledger, v_links, v_stmts;
end;
$$;
