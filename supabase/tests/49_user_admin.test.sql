-- ============================================================================
-- M5 · Usuarios y perfiles (migración 20261013000100)
-- ----------------------------------------------------------------------------
-- Spec §6. Permisos (anon/authenticated/servicio), alcance de admin_list_users,
-- perfil, rol de consola (S-01: nunca EBIM_SUPER_ADMIN, nunca el último super
-- admin), membresías con familia de rol y sin escritura directa, dominio
-- operador (S-02), vínculo comercial sin acceso operativo, desactivación en
-- cascada, invitaciones y auditoría.
-- Fixtures nuevos solo en @ebim.test (S-04).
-- ============================================================================
begin;
select plan(76);

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
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end;
$$;
create or replace function pg_temp.act_as_postgres()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.super() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.padmin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.finance() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000003'::uuid $$;
create or replace function pg_temp.andina_admin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000004'::uuid $$;
create or replace function pg_temp.andina_sales() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000005'::uuid $$;
create or replace function pg_temp.carla() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000008'::uuid $$;
create or replace function pg_temp.alpha_admin() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000009'::uuid $$;
create or replace function pg_temp.ale() returns uuid language sql as $$ select '10000000-0000-4000-a000-00000000000b'::uuid $$;
create or replace function pg_temp.p1_admin() returns uuid language sql as $$ select '10000000-0000-4000-a000-00000000000c'::uuid $$;
create or replace function pg_temp.n1() returns uuid language sql as $$ select '10000000-0000-4000-a000-0000000000a1'::uuid $$;
create or replace function pg_temp.n2() returns uuid language sql as $$ select '10000000-0000-4000-a000-0000000000a2'::uuid $$;
create or replace function pg_temp.n3() returns uuid language sql as $$ select '10000000-0000-4000-a000-0000000000a3'::uuid $$;
create or replace function pg_temp.ebim_org() returns uuid language sql as $$ select '30000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.andina() returns uuid language sql as $$ select '30000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.pacifico() returns uuid language sql as $$ select '30000000-0000-4000-a000-000000000003'::uuid $$;
create or replace function pg_temp.alpha() returns uuid language sql as $$ select '30000000-0000-4000-a000-000000000004'::uuid $$;
create or replace function pg_temp.alpha_tenant() returns uuid language sql as $$ select '50000000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.equipo_ebim() returns uuid language sql as $$ select '80000000-0000-4000-a000-000000000003'::uuid $$;

create temp table qa (k text primary key, v jsonb);
grant all on qa to public;
create or replace function pg_temp.v(p_k text) returns jsonb language sql as $$ select v from qa where k = p_k $$;

-- Tres usuarios nuevos de QA (el trigger handle_new_user crea su perfil).
select pg_temp.act_as_postgres();
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', pg_temp.n1(), 'authenticated', 'authenticated',
   'm5.nuevo@ebim.test', '{"full_name":"Nora Nueva"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', pg_temp.n2(), 'authenticated', 'authenticated',
   'm5.invitado@ebim.test', '{"full_name":"Iván Invitado"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', pg_temp.n3(), 'authenticated', 'authenticated',
   'm5.cliente@ebim.test', '{"full_name":"Clara Cliente"}', now(), now());
insert into qa values ('profiles', to_jsonb((select count(*) from platform.profiles)));

-- ---------------------------------------------------------------------------
-- 1-8. Estructura y permisos
-- ---------------------------------------------------------------------------
select has_column('platform', 'profiles', 'phone', '1 profiles.phone existe');
select has_column('platform', 'profiles', 'job_title', '2 profiles.job_title existe');
select has_table('platform', 'user_invitations', '3 user_invitations existe');

select ok(
  not has_column_privilege('authenticated', 'platform.profiles', 'is_active', 'UPDATE')
  and not has_column_privilege('authenticated', 'platform.profiles', 'email', 'UPDATE')
  and not has_column_privilege('authenticated', 'platform.profiles', 'full_name', 'UPDATE')
  and has_column_privilege('authenticated', 'platform.profiles', 'settings', 'UPDATE'),
  '4 el propio perfil solo se escribe directo en settings/avatar (is_active, email y nombre van por RPC)');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'platform'
      and table_name in ('organization_memberships', 'tenant_memberships', 'user_invitations')
      and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0, '5 membresías e invitaciones no son escribibles directamente por authenticated');

select ok(
  not has_function_privilege('anon', 'platform.admin_list_users(text, uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'platform.deactivate_user(uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'platform.record_user_invitation(text, uuid, jsonb, text, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'platform.admin_list_users(text, uuid, uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'platform.deactivate_user(uuid, text)', 'EXECUTE'),
  '6 las RPC de M5 son de authenticated y servicio, nunca de anon');

select ok(
  not has_function_privilege('authenticated', 'platform.assert_user_grant(jsonb, text)', 'EXECUTE')
  and not has_function_privilege('authenticated',
        'platform.assert_org_role_assignable(uuid, platform.org_role, uuid, platform.org_role)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'platform.assert_active_profile(uuid)', 'EXECUTE'),
  '7 los validadores internos no se exponen por PostgREST');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'platform' and p.prosecdef
      and p.proname in ('admin_list_users', 'admin_update_profile', 'grant_platform_role',
        'revoke_platform_role', 'upsert_organization_membership', 'set_organization_membership_active',
        'upsert_tenant_membership', 'set_tenant_membership_active', 'link_user_sales_agent',
        'deactivate_user', 'reactivate_user', 'authorize_user_invitation', 'record_user_invitation',
        'authorize_invitation_resend', 'record_invitation_resend', 'accept_my_invitations')
      and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')),
  16, '8 las 16 RPC de M5 son SECURITY DEFINER con search_path fijo');

-- ---------------------------------------------------------------------------
-- 9-17. admin_list_users: alcance
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.super());
select is((select count(*)::int from platform.admin_list_users()), (pg_temp.v('profiles'))::int,
  '9 el super admin ve a todos los usuarios');

select pg_temp.act_as(pg_temp.finance());
select is((select count(*)::int from platform.admin_list_users()), (pg_temp.v('profiles'))::int,
  '10 un rol de consola (finanzas) también ve a todos');

select pg_temp.act_as(pg_temp.andina_admin());
insert into qa select 'andina_view', coalesce(jsonb_agg(u.id), '[]') from platform.admin_list_users() u;
select ok(
  (pg_temp.v('andina_view')) ? pg_temp.andina_admin()::text
  and (pg_temp.v('andina_view')) ? pg_temp.andina_sales()::text
  and (pg_temp.v('andina_view')) ? pg_temp.p1_admin()::text,
  '11 PARTNER_ADMIN ve a los miembros de su organización y de los tenants que administra');
select ok(
  not ((pg_temp.v('andina_view')) ? pg_temp.alpha_admin()::text)
  and not ((pg_temp.v('andina_view')) ? pg_temp.super()::text),
  '12 PARTNER_ADMIN NO ve usuarios de otras organizaciones ni al personal EBIM');
select is(
  (select count(*)::int from platform.admin_list_users()
    where platform_role is not null or provisioning_roles <> '[]'::jsonb or sales_agent is not null),
  0, '13 un admin de organización no ve roles de consola, provisioning ni vínculo comercial (S-03)');
select is(
  (select count(*)::int from platform.admin_list_users() u, jsonb_array_elements(u.organizations) e
    where (e ->> 'organization_id')::uuid <> pg_temp.andina()),
  0, '14 solo ve las membresías de SU organización');
select throws_like($$ select * from platform.admin_list_users(null, '30000000-0000-4000-a000-000000000004') $$,
  'NO_AUTORIZADO%', '15 PARTNER_ADMIN no puede acotar a una organización ajena');

select pg_temp.act_as(pg_temp.andina_sales());
select throws_like($$ select * from platform.admin_list_users() $$, 'NO_AUTORIZADO%',
  '16 PARTNER_SALES no administra usuarios');

select pg_temp.act_as(pg_temp.super());
select ok(
  (select bool_and(u.email like '%andina%' or lower(u.full_name) like '%andina%'
                   or exists (select 1 from jsonb_array_elements(u.organizations) e
                               where lower(e ->> 'organization_name') like '%andina%'))
     from platform.admin_list_users('Andina') u)
  and (select count(*) from platform.admin_list_users('Andina')) >= 3
  and (select count(*) from platform.admin_list_users(null, null, pg_temp.ale())) = 1
  and (select banned from platform.admin_list_users(null, null, pg_temp.ale())) = false,
  '17 buscador único (nombre/correo/organización) y ficha individual con baneo');

-- ---------------------------------------------------------------------------
-- 18-24. Perfil
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.ale());
select lives_ok($$ select platform.admin_update_profile('10000000-0000-4000-a000-00000000000b',
  'Ale Alpha', '+51 999 888 777', 'Analista de compras') $$, '18 el usuario edita su propio perfil');
select pg_temp.act_as_postgres();
select is((select phone || ' · ' || job_title from platform.profiles where id = pg_temp.ale()),
  '+51 999 888 777 · Analista de compras', '19 teléfono y cargo quedan guardados');

select pg_temp.act_as(pg_temp.padmin());
select throws_like($$ select platform.admin_update_profile('10000000-0000-4000-a000-00000000000b', 'X') $$,
  'NO_AUTORIZADO%', '20 un admin de producto no edita el perfil de otro');

select pg_temp.act_as(pg_temp.super());
select lives_ok($$ select platform.admin_update_profile('10000000-0000-4000-a000-00000000000b',
  'Ale Alpha Ruiz', '+51 999 888 777', 'Analista') $$, '21 el super admin edita el perfil de otro');
select throws_like($$ select platform.admin_update_profile('10000000-0000-4000-a000-00000000000b',
  'Ale', 'llámame') $$, 'TELEFONO_INVALIDO%', '22 teléfono con formato inválido se rechaza');

select pg_temp.act_as(pg_temp.ale());
select throws_ok($$ update platform.profiles set is_active = false where id = '10000000-0000-4000-a000-00000000000b' $$,
  '42501', null, '23 nadie se desactiva (ni reactiva) con un PATCH directo a su perfil');
select lives_ok($$ update platform.profiles set settings = '{"appearance":{"mode":"dark","density":"compacta"}}'
  where id = '10000000-0000-4000-a000-00000000000b' $$, '24 la apariencia propia sigue siendo escribible directo');

-- ---------------------------------------------------------------------------
-- 25-32. Rol de consola (S-01)
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.padmin());
select throws_like($$ select platform.grant_platform_role('10000000-0000-4000-a000-0000000000a1', 'EBIM_FINANCE') $$,
  'NO_AUTORIZADO%', '25 solo el super admin concede roles de consola');

select pg_temp.act_as(pg_temp.super());
select throws_like($$ select platform.grant_platform_role('10000000-0000-4000-a000-0000000000a1', 'EBIM_SUPER_ADMIN') $$,
  'SUPER_ADMIN_NO_ASIGNABLE%', '26 EBIM_SUPER_ADMIN no se concede a nadie desde la consola');
select throws_like($$ select platform.grant_platform_role('10000000-0000-4000-a000-000000000001', 'EBIM_SUPER_ADMIN') $$,
  'SUPER_ADMIN_NO_ASIGNABLE%', '27 ni siquiera al propio dcalagua@ebim.pe');
select lives_ok($$ select platform.grant_platform_role('10000000-0000-4000-a000-0000000000a1', 'EBIM_FINANCE', 'alta QA') $$,
  '28 el super admin concede EBIM_FINANCE');
select throws_like($$ select platform.grant_platform_role('10000000-0000-4000-a000-000000000001', 'EBIM_FINANCE') $$,
  'SUPER_ADMIN_PROTEGIDO%', '29 el rol del super admin no se cambia por otro');
select throws_like($$ select platform.revoke_platform_role('10000000-0000-4000-a000-0000000000a1', ' ') $$,
  'MOTIVO_REQUERIDO%', '30 revocar un rol de consola exige motivo');
select throws_like($$ select platform.revoke_platform_role('10000000-0000-4000-a000-000000000001', 'probar') $$,
  'ULTIMO_SUPER_ADMIN%', '31 no se revoca al último super admin activo');
select lives_ok($$ select platform.revoke_platform_role('10000000-0000-4000-a000-0000000000a1', 'fin de prueba') $$,
  '32 revocar EBIM_FINANCE');
select pg_temp.act_as_postgres();
select ok(
  (select not is_active from platform.platform_admins where user_id = pg_temp.n1())
  and (select count(*) from platform.audit_logs
        where action in ('PLATFORM_ROLE_GRANTED', 'PLATFORM_ROLE_REVOKED')
          and entity_id = pg_temp.n1()::text and actor_user_id = pg_temp.super()) = 2
  and (select count(*)::int from platform.platform_admins where role = 'EBIM_SUPER_ADMIN' and is_active) = 1,
  '33 rol inactivo, conceder y revocar auditados, y sigue habiendo UN super admin');

-- ---------------------------------------------------------------------------
-- 34-44. Membresías de organización
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.andina_admin());
select lives_ok($$ select platform.upsert_organization_membership('10000000-0000-4000-a000-0000000000a1',
  '30000000-0000-4000-a000-000000000002', 'PARTNER_SALES', null, 'nuevo vendedor') $$,
  '34 PARTNER_ADMIN suma un PARTNER_SALES a su organización');
select throws_like($$ select platform.upsert_organization_membership('10000000-0000-4000-a000-0000000000a3',
  '30000000-0000-4000-a000-000000000002', 'ORG_ADMIN') $$,
  'ROL_FUERA_DE_ALCANCE%', '35 PARTNER_ADMIN no asigna roles de la familia cliente (ORG_*)');
select throws_like($$ select platform.upsert_organization_membership('10000000-0000-4000-a000-0000000000a3',
  '30000000-0000-4000-a000-000000000003', 'PARTNER_SALES') $$,
  'NO_AUTORIZADO%', '36 PARTNER_ADMIN no administra miembros de otro partner');
select throws_like($$ select platform.upsert_organization_membership('10000000-0000-4000-a000-000000000004',
  '30000000-0000-4000-a000-000000000002', 'PARTNER_SALES') $$,
  'MEMBRESIA_PROPIA%', '37 un admin de organización no toca su propia membresía');

select pg_temp.act_as(pg_temp.alpha_admin());
select lives_ok($$ select platform.upsert_organization_membership('10000000-0000-4000-a000-0000000000a3',
  '30000000-0000-4000-a000-000000000004', 'ORG_ADMIN') $$, '38 ORG_ADMIN asigna ORG_ADMIN (su mismo nivel)');
select throws_like($$ select platform.upsert_organization_membership('10000000-0000-4000-a000-0000000000a3',
  '30000000-0000-4000-a000-000000000004', 'PARTNER_SALES') $$,
  'ROL_FUERA_DE_ALCANCE%', '39 ORG_ADMIN no asigna roles de partner');
select lives_ok($$ select platform.set_organization_membership_active(
  (select id from platform.organization_memberships where user_id = '10000000-0000-4000-a000-0000000000a3'
     and organization_id = '30000000-0000-4000-a000-000000000004'), false, 'ya no trabaja aquí') $$,
  '40 ORG_ADMIN desactiva una membresía de su organización');

select pg_temp.act_as(pg_temp.padmin());
select throws_like($$ select platform.upsert_organization_membership('10000000-0000-4000-a000-0000000000a3',
  '30000000-0000-4000-a000-000000000004', 'PARTNER_ADMIN') $$,
  'ROL_NO_CORRESPONDE_ORGANIZACION%', '41 PARTNER_* solo en organizaciones partner o reseller');
select throws_like($$ select platform.upsert_organization_membership('10000000-0000-4000-a000-000000000001',
  '30000000-0000-4000-a000-000000000004', 'ORG_VIEWER') $$,
  'DOMINIO_OPERADOR_BLOQUEADO%', '42 S-02: @ebim.pe no es miembro de una organización cliente');
select throws_like($$ select platform.upsert_organization_membership('10000000-0000-4000-a000-0000000000a3',
  '30000000-0000-4000-a000-000000000001', 'ORG_VIEWER') $$,
  'ORGANIZACION_PLATAFORMA_PROTEGIDA%', '43 la organización EBIM solo la administra el super admin');
select throws_ok($$ insert into platform.organization_memberships (user_id, organization_id, role)
  values ('10000000-0000-4000-a000-0000000000a3', '30000000-0000-4000-a000-000000000006', 'ORG_VIEWER') $$,
  '42501', null, '44 ni EBIM escribe membresías por PostgREST: todo pasa por la RPC');

select pg_temp.act_as_postgres();
select ok(
  (select is_active from platform.organization_memberships where user_id = pg_temp.n1() and organization_id = pg_temp.andina())
  and not (select is_active from platform.organization_memberships where user_id = pg_temp.n3() and organization_id = pg_temp.alpha())
  and (select count(*) from platform.audit_logs where action = 'ORG_MEMBERSHIP_GRANTED'
         and metadata ->> 'user_id' = pg_temp.n1()::text and organization_id = pg_temp.andina()) = 1
  and (select count(*) from platform.audit_logs where action = 'ORG_MEMBERSHIP_DEACTIVATED'
         and metadata ->> 'reason' = 'ya no trabaja aquí') = 1,
  '45 membresías aplicadas y auditadas con usuario, organización y motivo');

-- ---------------------------------------------------------------------------
-- 46-50. Membresías de tenant
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.alpha_admin());
select lives_ok($$ select platform.upsert_tenant_membership('10000000-0000-4000-a000-0000000000a1',
  '50000000-0000-4000-a000-000000000001', 'TENANT_USER', 'acceso operativo') $$,
  '46 quien administra el tenant suma un TENANT_USER');
select throws_like($$ select platform.set_tenant_membership_active(
  (select id from platform.tenant_memberships where user_id = '10000000-0000-4000-a000-000000000009'
     and tenant_id = '50000000-0000-4000-a000-000000000001'), false) $$,
  'MEMBRESIA_PROPIA%', '47 un admin de tenant no desactiva su propia membresía');

select pg_temp.act_as(pg_temp.ale());
select throws_like($$ select platform.upsert_tenant_membership('10000000-0000-4000-a000-0000000000a3',
  '50000000-0000-4000-a000-000000000001', 'TENANT_ADMIN') $$, 'NO_AUTORIZADO%',
  '48 un TENANT_USER no administra membresías');

select pg_temp.act_as(pg_temp.andina_admin());
select throws_like($$ select platform.upsert_tenant_membership('10000000-0000-4000-a000-0000000000a3',
  '50000000-0000-4000-a000-000000000001', 'TENANT_USER') $$, 'NO_AUTORIZADO%',
  '49 un partner no administra tenants de un cliente directo de EBIM');

select pg_temp.act_as(pg_temp.padmin());
select throws_like($$ select platform.upsert_tenant_membership('10000000-0000-4000-a000-000000000001',
  '50000000-0000-4000-a000-000000000001', 'TENANT_USER') $$, 'DOMINIO_OPERADOR_BLOQUEADO%',
  '50 S-02: @ebim.pe no es miembro del tenant de un cliente');

-- ---------------------------------------------------------------------------
-- 51-53. Vínculo comercial (comercial ≠ acceso operativo)
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.andina_admin());
select throws_like($$ select platform.link_user_sales_agent('80000000-0000-4000-a000-000000000003',
  '10000000-0000-4000-a000-0000000000a1') $$, 'NO_AUTORIZADO%', '51 vincular comerciales es administración comercial EBIM');

select pg_temp.act_as(pg_temp.finance());
select throws_like($$ select platform.link_user_sales_agent('80000000-0000-4000-a000-000000000003',
  '10000000-0000-4000-a000-000000000008') $$, 'USUARIO_YA_VINCULADO%', '52 un usuario no se vincula a dos comerciales');
select pg_temp.act_as_postgres();
insert into qa values ('tm_n1', to_jsonb((select count(*) from platform.tenant_memberships where user_id = pg_temp.n1())));
select pg_temp.act_as(pg_temp.finance());
insert into qa select 'link', to_jsonb(platform.link_user_sales_agent(pg_temp.equipo_ebim(), pg_temp.n1(), 'cuenta del equipo'));
select pg_temp.act_as_postgres();
select ok(
  (select user_id from platform.sales_agents where id = pg_temp.equipo_ebim()) = pg_temp.n1()
  and (select count(*) from platform.tenant_memberships where user_id = pg_temp.n1()) = (pg_temp.v('tm_n1'))::int
  and (select count(*) from platform.audit_logs where action = 'SALES_AGENT_USER_LINKED'
         and entity_id = pg_temp.equipo_ebim()::text) = 1,
  '53 vincular un usuario a un comercial no crea ninguna membresía operativa (y se audita)');

-- ---------------------------------------------------------------------------
-- 54-62. Desactivar / reactivar
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.super());
insert into qa select 'prov', to_jsonb(platform.grant_provisioning_role(pg_temp.n1(), 'PROVISIONING_VIEWER', 'QA'));

select pg_temp.act_as(pg_temp.padmin());
select throws_like($$ select platform.deactivate_user('10000000-0000-4000-a000-0000000000a1', 'x') $$,
  'NO_AUTORIZADO%', '54 solo el super admin desactiva usuarios');

select pg_temp.act_as(pg_temp.super());
select throws_like($$ select platform.deactivate_user('10000000-0000-4000-a000-0000000000a1', '') $$,
  'MOTIVO_REQUERIDO%', '55 desactivar exige motivo');
select throws_like($$ select platform.deactivate_user('10000000-0000-4000-a000-000000000001', 'probar') $$,
  'ULTIMO_SUPER_ADMIN%', '56 nunca se desactiva al último super admin');

insert into qa select 'deact', platform.deactivate_user(pg_temp.n1(), 'salida de la empresa');
select is(
  (select v - 'user_id' from qa where k = 'deact'),
  '{"was_active": true, "console_roles": 0, "org_memberships": 1, "tenant_memberships": 1,
    "provisioning_roles": 1, "product_ownerships": 0, "invitations": 0}'::jsonb,
  '57 la desactivación en cascada informa lo que apagó');

select pg_temp.act_as_postgres();
select ok(
  not (select is_active from platform.profiles where id = pg_temp.n1())
  and not exists (select 1 from platform.organization_memberships where user_id = pg_temp.n1() and is_active)
  and not exists (select 1 from platform.tenant_memberships where user_id = pg_temp.n1() and is_active)
  and not exists (select 1 from platform.provisioning_role_members where user_id = pg_temp.n1() and is_active)
  and (select user_id from platform.sales_agents where id = pg_temp.equipo_ebim()) = pg_temp.n1(),
  '58 perfil, membresías y provisioning inactivos; el vínculo comercial (historia) se conserva');
select is((select count(*)::int from platform.audit_logs where action = 'USER_DEACTIVATED'
            and entity_id = pg_temp.n1()::text and metadata ->> 'reason' = 'salida de la empresa'),
  1, '59 la desactivación queda auditada con su motivo');

select pg_temp.act_as(pg_temp.super());
select throws_like($$ select platform.upsert_organization_membership('10000000-0000-4000-a000-0000000000a1',
  '30000000-0000-4000-a000-000000000002', 'PARTNER_SALES') $$, 'USUARIO_INACTIVO%',
  '60 a un usuario desactivado no se le dan accesos');
select lives_ok($$ select platform.reactivate_user('10000000-0000-4000-a000-0000000000a1', 'reingreso') $$,
  '61 el super admin reactiva el usuario');
select pg_temp.act_as_postgres();
select ok(
  (select is_active from platform.profiles where id = pg_temp.n1())
  and not exists (select 1 from platform.organization_memberships where user_id = pg_temp.n1() and is_active),
  '62 reactivar solo reactiva el perfil: los accesos se otorgan de nuevo explícitamente');

-- ---------------------------------------------------------------------------
-- 63-76. Invitaciones
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.andina_admin());
select throws_like($$ select platform.authorize_user_invitation('nuevo@andina.ebim.test',
  '{"kind":"PLATFORM_ROLE","role":"EBIM_FINANCE"}') $$, 'NO_AUTORIZADO%',
  '63 un admin de partner no invita con rol de consola');
select is(
  (platform.authorize_user_invitation('Nuevo@Andina.ebim.test',
     jsonb_build_object('kind', 'ORG_MEMBERSHIP', 'role', 'PARTNER_SUPPORT',
                        'organization_id', pg_temp.andina())) -> 'grant' ->> 'role'),
  'PARTNER_SUPPORT', '64 un admin de partner invita a su organización con un rol de su familia');
select throws_like($$ select platform.authorize_user_invitation('x@andina.ebim.test',
  '{"kind":"ROOT","role":"ALL"}') $$, 'ACCESO_INVALIDO%', '65 un tipo de acceso desconocido se rechaza');

select pg_temp.act_as(pg_temp.super());
select throws_like($$ select platform.authorize_user_invitation('otro@ebim.test',
  '{"kind":"PLATFORM_ROLE","role":"EBIM_SUPER_ADMIN"}') $$, 'SUPER_ADMIN_NO_ASIGNABLE%',
  '66 ni por invitación se concede EBIM_SUPER_ADMIN');
select throws_like($$ select platform.authorize_user_invitation('alguien@ebim.pe',
  '{"kind":"ORG_MEMBERSHIP","role":"ORG_VIEWER","organization_id":"30000000-0000-4000-a000-000000000004"}') $$,
  'DOMINIO_OPERADOR_BLOQUEADO%', '67 S-02 también al invitar');

select pg_temp.act_as(pg_temp.andina_admin());
insert into qa select 'inv', to_jsonb(platform.record_user_invitation('m5.invitado@ebim.test', pg_temp.n2(),
  jsonb_build_object('kind', 'ORG_MEMBERSHIP', 'role', 'PARTNER_SALES', 'organization_id', pg_temp.andina()),
  'LINK', 'Iván Invitado'));
select throws_like($$ select platform.record_user_invitation('otro@ebim.test', '10000000-0000-4000-a000-0000000000a2',
  '{"kind":"ORG_MEMBERSHIP","role":"PARTNER_SALES","organization_id":"30000000-0000-4000-a000-000000000002"}', 'LINK') $$,
  'INVITACION_INCOHERENTE%', '68 la invitación exige que el usuario corresponda al correo');
select is((select count(*)::int from platform.user_invitations where invited_by = pg_temp.andina_admin()),
  1, '69 quien invita ve su invitación');

select pg_temp.act_as(pg_temp.alpha_admin());
select is((select count(*)::int from platform.user_invitations), 0, '70 otro admin no ve invitaciones ajenas');

select pg_temp.act_as(pg_temp.andina_admin());
select is((platform.authorize_invitation_resend(pg_temp.n2())) ->> 'email', 'm5.invitado@ebim.test',
  '71 quien emitió la invitación puede reenviarla mientras está pendiente');
select lives_ok($$ select platform.record_invitation_resend('10000000-0000-4000-a000-0000000000a2', 'EMAIL') $$,
  '72 el reenvío queda registrado');

select pg_temp.act_as(pg_temp.alpha_admin());
select throws_like($$ select platform.authorize_invitation_resend('10000000-0000-4000-a000-0000000000a2') $$,
  'NO_AUTORIZADO%', '73 un admin ajeno no reenvía la invitación');

select pg_temp.act_as(pg_temp.n2());
select is(platform.accept_my_invitations(), 2, '74 el invitado acepta (todas sus invitaciones pendientes) al fijar su contraseña');

select pg_temp.act_as(pg_temp.super());
select throws_like($$ select platform.authorize_invitation_resend('10000000-0000-4000-a000-0000000000a2') $$,
  'INVITACION_NO_PENDIENTE%', '75 una cuenta ya activada no recibe enlaces de invitación (ni del super admin)');
select pg_temp.act_as_postgres();
select ok(
  (select status = 'ACCEPTED' and accepted_at is not null and delivery = 'LINK'
     from platform.user_invitations where id = (pg_temp.v('inv') #>> '{}')::uuid)
  and (select count(*) from platform.audit_logs where action = 'USER_INVITED'
         and entity_id = pg_temp.n2()::text and organization_id = pg_temp.andina()) = 1
  and (select count(*) from platform.audit_logs where action = 'USER_INVITATION_RESENT'
         and entity_id = pg_temp.n2()::text) = 1
  and (select count(*) from platform.audit_logs where action = 'USER_INVITATION_ACCEPTED'
         and entity_id = pg_temp.n2()::text) = 1,
  '76 invitación ACCEPTED, y emitir/reenviar/aceptar quedan auditados');

select * from finish();
rollback;
