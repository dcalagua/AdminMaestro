-- ============================================================================
-- Tests de ESTRUCTURA y HARDENING
-- Verifican invariantes que no se ven leyendo una pantalla.
-- ============================================================================
begin;
select plan(14);

-- (1) Toda tabla del schema `platform` tiene RLS habilitada.
select is(
  (select count(*)::int
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform' and c.relkind = 'r' and not c.relrowsecurity),
  0,
  'Toda tabla de platform tiene RLS habilitada'
);

-- (2) ...y FORCE, para que ni el owner se la salte.
select is(
  (select count(*)::int
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform' and c.relkind = 'r' and not c.relforcerowsecurity),
  0,
  'Toda tabla de platform tiene FORCE ROW LEVEL SECURITY'
);

-- (3) Toda tabla con RLS tiene al menos una política (si no, es inaccesible por
--     accidente y alguien la "arreglará" desactivando RLS).
select is(
  (select count(*)::int from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform' and c.relkind = 'r' and c.relrowsecurity
      and not exists (select 1 from pg_policies p
                       where p.schemaname = 'platform' and p.tablename = c.relname)),
  0,
  'Toda tabla con RLS tiene al menos una política'
);

-- (4) `anon` no tiene USAGE sobre el schema platform.
select ok(
  not has_schema_privilege('anon', 'platform', 'USAGE'),
  'anon NO tiene USAGE sobre el schema platform'
);

-- (5) `anon` no tiene ningún privilegio sobre ninguna tabla de platform.
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'platform' and grantee = 'anon'),
  0,
  'anon no tiene ningún GRANT sobre tablas de platform'
);

-- (6) `public` tampoco.
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'platform' and grantee = 'PUBLIC'),
  0,
  'PUBLIC no tiene ningún GRANT sobre tablas de platform'
);

-- (7) Toda función SECURITY DEFINER de platform fija su search_path.
--     Sin esto, un schema temporal del atacante puede shadowear una tabla.
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform' and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
         where cfg like 'search_path=%')),
  0,
  'Toda función SECURITY DEFINER de platform fija search_path'
);

-- (8) Las vistas usan security_invoker: si no, son un bypass de RLS.
select is(
  (select count(*)::int from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform' and c.relkind = 'v'
      and coalesce(
            (select option_value from pg_options_to_table(c.reloptions)
              where option_name = 'security_invoker'), 'false') <> 'true'),
  0,
  'Toda vista de platform usa security_invoker = true'
);

-- (9) audit_logs es append-only REAL: authenticated no tiene UPDATE ni DELETE.
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'platform' and table_name = 'audit_logs'
      and grantee = 'authenticated' and privilege_type in ('UPDATE', 'DELETE')),
  0,
  'audit_logs es append-only: authenticated no tiene UPDATE/DELETE'
);

-- (10) Contrato §2.6 lección 1: el precio del catálogo NO es escribible por el
--      cliente. La protección es de GRANT (columna/tabla), no sólo de RLS.
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'platform' and table_name = 'catalog_items'
      and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'catalog_items (donde vive el precio) no es escribible por authenticated'
);

-- (11) No hay tabla monetaria con columnas de punto flotante.
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'platform'
      and data_type in ('real', 'double precision')
      and (column_name like '%amount%' or column_name like '%price%'
        or column_name like '%total%' or column_name like '%rate%')),
  0,
  'Ninguna columna monetaria usa punto flotante binario'
);

-- (12) Toda FK tiene índice de apoyo (o es la primera columna de uno).
select is(
  (select count(*)::int
     from pg_constraint con
     join pg_class c on c.oid = con.conrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'platform' and con.contype = 'f'
      -- Un índice "cubre" la FK si sus primeras columnas son exactamente las de
      -- la FK (un índice sobre (a,b) sirve para una FK sobre (a), no al revés).
      and not exists (
        select 1 from pg_index i
         where i.indrelid = con.conrelid
           and (i.indkey::int2[])[0:array_length(con.conkey, 1) - 1] = con.conkey
      )),
  0,
  'Toda FK de platform tiene un índice que la cubre'
);

-- (13) El catálogo no tiene columnas por producto (is_esupplier, is_wms...).
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'platform' and table_name = 'saas_products'
      and (column_name ilike 'is\_%supplier%' or column_name ilike 'is\_%wms%'
        or column_name ilike 'is\_%ewm%' or column_name ilike 'is\_%gmao%')),
  0,
  'saas_products no tiene columnas hardcodeadas por producto'
);

-- (14) Existen los 5 productos iniciales del catálogo.
select is(
  (select count(*)::int from platform.saas_products
    where code in ('esupplier', 'ewm', 'tms', 'gmao', 'echange')),
  5,
  'El catálogo contiene los 5 SaaS iniciales de EBIM'
);

select * from finish();
rollback;
