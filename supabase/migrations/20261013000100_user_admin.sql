-- ============================================================================
-- MasterAdmin · M5 · Usuarios y perfiles
-- ----------------------------------------------------------------------------
-- Spec §6 (docs/superpowers/specs/2026-10-04-masteradmin-cobro-usuarios-design.md).
-- Administrar personal EBIM, usuarios de partners y de clientes desde la consola.
--
-- Piezas:
--   · profiles gana `phone` y `job_title`. La escritura directa del propio perfil
--     queda LIMITADA a `settings` y `avatar_url` (GRANT por columna, C-06): antes
--     `profiles_update_self` permitía a cualquiera reescribir su `is_active` o su
--     `email` con un PATCH. Nombre, teléfono y cargo pasan por
--     `admin_update_profile` (auditado).
--   · user_invitations — rastro de invitaciones (EMAIL o enlace copiable LINK). El
--     enlace de invitación NUNCA se guarda: es una credencial de un solo uso.
--   · RPCs `SECURITY DEFINER` con `log_audit` para cada escritura:
--       admin_list_users, admin_update_profile, grant/revoke_platform_role,
--       upsert_organization_membership, set_organization_membership_active,
--       upsert_tenant_membership, set_tenant_membership_active,
--       link_user_sales_agent, deactivate_user, reactivate_user,
--       authorize_user_invitation, record_user_invitation, authorize_invitation_resend,
--       record_invitation_resend, accept_my_invitations.
--   · organization_memberships y tenant_memberships dejan de ser escribibles
--     directamente por `authenticated`: ningún código de src/ ni de los tests
--     escribía por PostgREST, y la RPC aplica reglas (familia de rol, membresía
--     propia, dominio operador en tenants) que una política RLS no expresa.
--
-- Invariantes que NO cambian:
--   · S-01: EBIM_SUPER_ADMIN solo recae en dcalagua@ebim.pe (trigger existente
--     `enforce_super_admin_governance`). Además, ninguna RPC lo concede: tampoco
--     a él (no es asignable, contrato §13.1).
--   · S-02: `enforce_operator_domain` sigue protegiendo organization_memberships;
--     upsert_tenant_membership aplica la misma regla a los tenants de clientes.
--   · comercial ≠ acceso operativo: vincular un usuario a un comercial no crea
--     ninguna membresía.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles: teléfono y cargo
-- ---------------------------------------------------------------------------
alter table platform.profiles
  add column phone     text,
  add column job_title text,
  add constraint profiles_phone_ck
    check (phone is null or phone ~ '^\+?[0-9][0-9 ()-]{5,22}$'),
  add constraint profiles_job_title_ck
    check (job_title is null or char_length(job_title) between 1 and 120),
  add constraint profiles_full_name_ck
    check (full_name is null or char_length(full_name) between 1 and 160);

comment on column platform.profiles.phone is
  'Teléfono de contacto (formato libre con dígitos, espacios, paréntesis y guiones). '
  'Se edita con admin_update_profile.';
comment on column platform.profiles.job_title is 'Cargo. Se edita con admin_update_profile.';

-- Escritura directa SOLO de apariencia y avatar (AppearanceProvider). Todo lo
-- demás va por RPC: un usuario no puede reactivarse ni cambiarse el correo.
revoke update on platform.profiles from authenticated;
grant update (settings, avatar_url) on platform.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. user_invitations
-- ---------------------------------------------------------------------------
create table platform.user_invitations (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  full_name    text,
  invited_by   uuid references platform.profiles (id) on delete set null,
  user_id      uuid references platform.profiles (id) on delete cascade,
  -- Acceso pedido al invitar: {kind: PLATFORM_ROLE|ORG_MEMBERSHIP|TENANT_MEMBERSHIP|
  -- PROVISIONING_ROLE, role, organization_id?, tenant_id?, company_id?}.
  access_grant jsonb not null default '{}'::jsonb,
  status       text not null default 'SENT',
  delivery     text not null,
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  constraint user_invitations_email_ck check (email = lower(email) and email like '%_@_%'),
  constraint user_invitations_status_ck check (status in ('SENT', 'ACCEPTED', 'REVOKED')),
  constraint user_invitations_delivery_ck check (delivery in ('EMAIL', 'LINK')),
  constraint user_invitations_accepted_ck check (status <> 'ACCEPTED' or accepted_at is not null)
);

create index user_invitations_user_ix on platform.user_invitations (user_id);
create index user_invitations_invited_by_ix on platform.user_invitations (invited_by);
create index user_invitations_email_ix on platform.user_invitations (email, created_at desc);
create index user_invitations_pending_ix on platform.user_invitations (user_id) where status = 'SENT';

create trigger user_invitations_no_secrets
  before insert or update of access_grant on platform.user_invitations
  for each row execute function platform.reject_secret_like_json('access_grant');

comment on table platform.user_invitations is
  'M5 · Invitaciones de usuario. delivery = EMAIL (Supabase Auth envió el correo) o LINK '
  '(sin SMTP: el operador copió el enlace). El enlace NUNCA se guarda aquí. Escritura solo '
  'por RPC (record_user_invitation / accept_my_invitations / deactivate_user).';
comment on column platform.user_invitations.access_grant is
  'Acceso pedido al invitar (spec §6.1 `grant`; renombrado: GRANT es palabra reservada).';

alter table platform.user_invitations enable row level security;
alter table platform.user_invitations force row level security;
revoke all on platform.user_invitations from public, anon, authenticated;
grant select on platform.user_invitations to authenticated;
grant all on platform.user_invitations to service_role;

create policy user_invitations_select on platform.user_invitations
  for select to authenticated
  using (
    platform.is_platform_admin()
    or invited_by = (select auth.uid())
    or user_id = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 3. Membresías: sin escritura directa (todo por RPC)
-- ---------------------------------------------------------------------------
revoke insert, update, delete on platform.organization_memberships from authenticated;
revoke insert, update, delete on platform.tenant_memberships from authenticated;
drop policy if exists org_memberships_write on platform.organization_memberships;
drop policy if exists org_memberships_update on platform.organization_memberships;
drop policy if exists org_memberships_delete on platform.organization_memberships;
drop policy if exists tenant_memberships_write on platform.tenant_memberships;
drop policy if exists tenant_memberships_update on platform.tenant_memberships;
drop policy if exists tenant_memberships_delete on platform.tenant_memberships;

comment on table platform.organization_memberships is
  'Membresía de un usuario en una organización. PARTNER_ADMIN sólo ve SU organización. '
  'M5: escritura SOLO por upsert_organization_membership / set_organization_membership_active '
  '(familia de rol, nunca por encima del propio, nunca la propia membresía).';
comment on table platform.tenant_memberships is
  'Acceso OPERACIONAL a un tenant. Regla de negocio §2.3: haber vendido un tenant NO '
  'crea una fila aquí. La atribución comercial vive en sales_attributions. M5: escritura '
  'SOLO por upsert_tenant_membership / set_tenant_membership_active (can_manage_tenant).';

-- ---------------------------------------------------------------------------
-- 4. Utilidades internas
-- ---------------------------------------------------------------------------

-- Familia de un rol de organización: PARTNER_* (partner/reseller) u ORG_* (cliente).
create or replace function platform.org_role_family(p_role platform.org_role)
returns text
language sql
immutable
set search_path = platform, pg_catalog
as $$
  select case when p_role::text like 'PARTNER\_%' then 'PARTNER' else 'ORG' end;
$$;

-- Rango dentro de la familia: un admin nunca asigna un rol por encima del suyo.
create or replace function platform.org_role_rank(p_role platform.org_role)
returns int
language sql
immutable
set search_path = platform, pg_catalog
as $$
  select case p_role
           when 'PARTNER_ADMIN' then 3
           when 'PARTNER_SALES' then 2
           when 'PARTNER_SUPPORT' then 1
           when 'ORG_ADMIN' then 2
           when 'ORG_VIEWER' then 1
         end;
$$;

-- Perfil existente y activo; devuelve su correo.
create or replace function platform.assert_active_profile(p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_email  text;
  v_active boolean;
begin
  select p.email, p.is_active into v_email, v_active from platform.profiles p where p.id = p_user_id;
  if v_email is null then
    raise exception 'USUARIO_NO_ENCONTRADO: no existe el usuario %', p_user_id using errcode = 'P0002';
  end if;
  if not v_active then
    raise exception 'USUARIO_INACTIVO: el usuario está desactivado; reactívalo antes de darle accesos'
      using errcode = '23514';
  end if;
  return v_email;
end;
$$;

/*
 * ¿Puede el llamante asignar `p_role` en `p_org` (opcionalmente sobre una
 * membresía que hoy tiene `p_existing_role`, del usuario `p_target`)?
 *   · Organización EBIM (kind PLATFORM): solo el super admin (como su edición).
 *   · EBIM_PRODUCT_ADMIN / super admin: cualquier rol en cualquier otra org.
 *   · PARTNER_ADMIN / ORG_ADMIN de esa org: solo roles de SU familia, nunca por
 *     encima del suyo, nunca sobre una membresía de otra familia o superior y
 *     nunca sobre su propia membresía.
 *   · Un rol PARTNER_* exige que la organización sea PARTNER o RESELLER.
 * Levanta excepción; no devuelve nada.
 */
create or replace function platform.assert_org_role_assignable(
  p_org           uuid,
  p_role          platform.org_role,
  p_target        uuid default null,
  p_existing_role platform.org_role default null
)
returns void
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_kind        platform.org_kind;
  v_caller_role platform.org_role;
begin
  select o.kind into v_kind from platform.organizations o where o.id = p_org;
  if v_kind is null then
    raise exception 'ORGANIZACION_NO_ENCONTRADA: %', p_org using errcode = 'P0002';
  end if;

  if v_kind = 'PLATFORM' then
    if not platform.is_super_admin() then
      raise exception 'ORGANIZACION_PLATAFORMA_PROTEGIDA: solo el super admin administra las membresías de la organización EBIM (contrato §13)'
        using errcode = '42501';
    end if;
  elsif not platform.can_manage_platform_entities() then
    select m.role into v_caller_role
      from platform.organization_memberships m
     where m.user_id = auth.uid() and m.organization_id = p_org and m.is_active
       and m.role in ('PARTNER_ADMIN', 'ORG_ADMIN');
    if v_caller_role is null then
      raise exception 'NO_AUTORIZADO: solo EBIM o el administrador de la organización gestiona sus miembros'
        using errcode = '42501';
    end if;
    if p_target is not null and p_target = auth.uid() then
      raise exception 'MEMBRESIA_PROPIA: un administrador de organización no modifica su propia membresía'
        using errcode = '42501';
    end if;
    if platform.org_role_family(p_role) <> platform.org_role_family(v_caller_role)
       or platform.org_role_rank(p_role) > platform.org_role_rank(v_caller_role) then
      raise exception 'ROL_FUERA_DE_ALCANCE: % no puede asignar el rol %', v_caller_role, p_role
        using errcode = '42501';
    end if;
    if p_existing_role is not null
       and (platform.org_role_family(p_existing_role) <> platform.org_role_family(v_caller_role)
            or platform.org_role_rank(p_existing_role) > platform.org_role_rank(v_caller_role)) then
      raise exception 'ROL_FUERA_DE_ALCANCE: la membresía actual (%) está fuera del alcance de %', p_existing_role, v_caller_role
        using errcode = '42501';
    end if;
  end if;

  if platform.org_role_family(p_role) = 'PARTNER'
     and not exists (
       select 1 from platform.organization_capabilities c
        where c.organization_id = p_org and c.capability in ('PARTNER', 'RESELLER')
     ) then
    raise exception 'ROL_NO_CORRESPONDE_ORGANIZACION: los roles PARTNER_* solo existen en organizaciones partner o reseller'
      using errcode = '23514';
  end if;
end;
$$;

/*
 * S-02 para tenants: un correo @ebim.pe no es actor de negocio en el tenant de
 * una organización cliente (misma regla que create_tenant y que el trigger de
 * organization_memberships).
 */
create or replace function platform.assert_tenant_member_domain(p_tenant_id uuid, p_email text)
returns void
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_kind platform.org_kind;
begin
  select o.kind into v_kind
    from platform.tenants t
    join platform.organizations o on o.id = t.customer_organization_id
   where t.id = p_tenant_id;
  if v_kind is null then
    raise exception 'TENANT_NO_ENCONTRADO: %', p_tenant_id using errcode = 'P0002';
  end if;
  if v_kind <> 'PLATFORM' and lower(coalesce(p_email, '')) like '%@ebim.pe' then
    raise exception 'DOMINIO_OPERADOR_BLOQUEADO: % pertenece al dominio operador @ebim.pe y no puede ser miembro del tenant de un cliente (contrato §13.2)', p_email
      using errcode = '42501';
  end if;
end;
$$;

/*
 * Valida un acceso pedido al invitar (`access_grant`) con las MISMAS reglas que
 * la RPC que luego lo aplica, y lo devuelve normalizado. Se usa ANTES de crear el
 * usuario en Auth: sin esto, cualquiera con sesión podría crear cuentas.
 */
create or replace function platform.assert_user_grant(p_grant jsonb, p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_kind   text := upper(coalesce(p_grant ->> 'kind', ''));
  v_email  text := lower(trim(coalesce(p_email, '')));
  v_prole  platform.platform_role;
  v_orole  platform.org_role;
  v_trole  platform.tenant_role;
  v_vrole  platform.provisioning_role;
  v_org    uuid;
  v_tenant uuid;
  v_company uuid;
  v_okind  platform.org_kind;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'EMAIL_INVALIDO: «%» no es un correo válido', p_email using errcode = '22023';
  end if;

  begin
    if v_kind = 'PLATFORM_ROLE' then
      v_prole := (p_grant ->> 'role')::platform.platform_role;
    elsif v_kind = 'ORG_MEMBERSHIP' then
      v_orole := (p_grant ->> 'role')::platform.org_role;
      v_org := (p_grant ->> 'organization_id')::uuid;
      v_company := nullif(p_grant ->> 'company_id', '')::uuid;
    elsif v_kind = 'TENANT_MEMBERSHIP' then
      v_trole := (p_grant ->> 'role')::platform.tenant_role;
      v_tenant := (p_grant ->> 'tenant_id')::uuid;
    elsif v_kind = 'PROVISIONING_ROLE' then
      v_vrole := (p_grant ->> 'role')::platform.provisioning_role;
    else
      raise exception 'ACCESO_INVALIDO: tipo de acceso desconocido «%»', v_kind using errcode = '22023';
    end if;
  exception
    when invalid_text_representation then
      raise exception 'ACCESO_INVALIDO: el rol o el identificador del acceso no son válidos'
        using errcode = '22023';
  end;

  if v_kind = 'PLATFORM_ROLE' then
    if not platform.is_super_admin() then
      raise exception 'NO_AUTORIZADO: solo el super admin EBIM concede roles de consola' using errcode = '42501';
    end if;
    if v_prole is null then
      raise exception 'ACCESO_INVALIDO: falta el rol de consola' using errcode = '22023';
    end if;
    if v_prole = 'EBIM_SUPER_ADMIN' then
      raise exception 'SUPER_ADMIN_NO_ASIGNABLE: EBIM_SUPER_ADMIN no se concede desde la consola (contrato §13.1)'
        using errcode = '42501';
    end if;
    return jsonb_build_object('kind', v_kind, 'role', v_prole::text);
  end if;

  if v_kind = 'PROVISIONING_ROLE' then
    if not platform.is_super_admin() then
      raise exception 'NO_AUTORIZADO: solo el super admin EBIM concede roles del plano de provisioning'
        using errcode = '42501';
    end if;
    if v_vrole is null or v_vrole = 'PRODUCT_OWNER' then
      raise exception 'ROL_POR_PRODUCTO: PRODUCT_OWNER se concede con upsert_product_owner()' using errcode = '23514';
    end if;
    return jsonb_build_object('kind', v_kind, 'role', v_vrole::text);
  end if;

  if v_kind = 'ORG_MEMBERSHIP' then
    if v_org is null or v_orole is null then
      raise exception 'ACCESO_INVALIDO: la membresía exige organización y rol' using errcode = '22023';
    end if;
    perform platform.assert_org_role_assignable(v_org, v_orole, null, null);
    select o.kind into v_okind from platform.organizations o where o.id = v_org;
    if v_okind <> 'PLATFORM' and v_email like '%@ebim.pe' then
      raise exception 'DOMINIO_OPERADOR_BLOQUEADO: % pertenece al dominio operador @ebim.pe y no puede ser actor de negocio de una organización cliente (contrato §13.2)', v_email
        using errcode = '42501';
    end if;
    if v_company is not null and not exists (
      select 1 from platform.companies c where c.id = v_company and c.organization_id = v_org
    ) then
      raise exception 'EMPRESA_NO_PERTENECE: la sociedad no es de esa organización' using errcode = '23514';
    end if;
    return jsonb_strip_nulls(jsonb_build_object('kind', v_kind, 'role', v_orole::text,
      'organization_id', v_org, 'company_id', v_company));
  end if;

  -- TENANT_MEMBERSHIP
  if v_tenant is null or v_trole is null then
    raise exception 'ACCESO_INVALIDO: la membresía de tenant exige tenant y rol' using errcode = '22023';
  end if;
  if not platform.can_manage_tenant(v_tenant) then
    raise exception 'NO_AUTORIZADO: no administra ese tenant' using errcode = '42501';
  end if;
  perform platform.assert_tenant_member_domain(v_tenant, v_email);
  return jsonb_build_object('kind', v_kind, 'role', v_trole::text, 'tenant_id', v_tenant);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. admin_list_users — lectura con alcance
-- ---------------------------------------------------------------------------
/*
 * Lista de usuarios para «Usuarios y accesos».
 *   · Rol de consola activo (cualquiera): todos los usuarios.
 *   · PARTNER_ADMIN / ORG_ADMIN: los miembros de SUS organizaciones y de los
 *     tenants de esas organizaciones; solo ve esas membresías, y nunca roles de
 *     consola, de provisioning ni el vínculo comercial (S-03).
 *   · Cualquier otro: NO_AUTORIZADO.
 * `p_scope_org_id` acota a una organización (un admin de org solo a las suyas);
 * `p_user_id` devuelve una sola fila (ficha de usuario).
 * Lee `auth.users` (último ingreso, baneo, invitación pendiente) sin exponerla.
 */
create or replace function platform.admin_list_users(
  p_search       text default null,
  p_scope_org_id uuid default null,
  p_user_id      uuid default null
)
returns table (
  id                 uuid,
  email              text,
  full_name          text,
  phone              text,
  job_title          text,
  is_active          boolean,
  created_at         timestamptz,
  last_sign_in_at    timestamptz,
  invited_at         timestamptz,
  email_confirmed_at timestamptz,
  banned             boolean,
  platform_role      platform.platform_role,
  platform_role_active boolean,
  organizations      jsonb,
  tenants            jsonb,
  provisioning_roles jsonb,
  product_ownerships jsonb,
  sales_agent        jsonb
)
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
#variable_conflict use_column
declare
  v_all     boolean := platform.is_platform_admin();
  v_orgs    uuid[];
  v_tenants uuid[];
  v_needle  text := nullif(lower(trim(coalesce(p_search, ''))), '');
begin
  if not v_all then
    select coalesce(array_agg(m.organization_id), '{}') into v_orgs
      from platform.organization_memberships m
     where m.user_id = auth.uid() and m.is_active and m.role in ('PARTNER_ADMIN', 'ORG_ADMIN');
    if cardinality(v_orgs) = 0 then
      raise exception 'NO_AUTORIZADO: la administración de usuarios es de EBIM o del administrador de la organización'
        using errcode = '42501';
    end if;
    if p_scope_org_id is not null and not (p_scope_org_id = any (v_orgs)) then
      raise exception 'NO_AUTORIZADO: no administra esa organización' using errcode = '42501';
    end if;
  end if;

  if p_scope_org_id is not null then
    v_orgs := array[p_scope_org_id];
  end if;
  if v_orgs is not null then
    select coalesce(array_agg(t.id), '{}') into v_tenants
      from platform.tenants t
     where t.customer_organization_id = any (v_orgs) or t.managing_organization_id = any (v_orgs);
  end if;

  return query
  with scoped as (
    select p.id from platform.profiles p where v_orgs is null
    union
    select m.user_id from platform.organization_memberships m where m.organization_id = any (v_orgs)
    union
    select tm.user_id from platform.tenant_memberships tm where tm.tenant_id = any (v_tenants)
  ),
  listed as (
    select
      p.id, p.email, p.full_name, p.phone, p.job_title, p.is_active, p.created_at,
      u.last_sign_in_at, u.invited_at, u.email_confirmed_at,
      coalesce(u.banned_until > now(), false) as banned,
      case when v_all then pa.role end as platform_role,
      case when v_all then pa.is_active end as platform_role_active,
      coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', m.id, 'organization_id', m.organization_id,
                 'organization_name', o.display_name, 'organization_kind', o.kind,
                 'is_partner', exists (select 1 from platform.organization_capabilities c
                                        where c.organization_id = o.id
                                          and c.capability in ('PARTNER', 'RESELLER')),
                 'role', m.role, 'company_id', m.company_id, 'is_active', m.is_active)
               order by o.display_name)
          from platform.organization_memberships m
          join platform.organizations o on o.id = m.organization_id
         where m.user_id = p.id and (v_all and p_scope_org_id is null or m.organization_id = any (v_orgs))
      ), '[]'::jsonb) as organizations,
      coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', tm.id, 'tenant_id', tm.tenant_id, 'tenant_name', t.name, 'tenant_slug', t.slug,
                 'product_name', sp.name, 'customer_organization_id', t.customer_organization_id,
                 'role', tm.role, 'is_active', tm.is_active)
               order by t.name)
          from platform.tenant_memberships tm
          join platform.tenants t on t.id = tm.tenant_id
          join platform.saas_products sp on sp.id = t.saas_product_id
         where tm.user_id = p.id and (v_all and p_scope_org_id is null or tm.tenant_id = any (v_tenants))
      ), '[]'::jsonb) as tenants,
      case when v_all then coalesce((
        select jsonb_agg(jsonb_build_object('id', r.id, 'role', r.role, 'is_active', r.is_active,
                                            'granted_at', r.granted_at) order by r.granted_at desc)
          from platform.provisioning_role_members r where r.user_id = p.id
      ), '[]'::jsonb) else '[]'::jsonb end as provisioning_roles,
      case when v_all then coalesce((
        select jsonb_agg(jsonb_build_object('id', po.id, 'saas_product_id', po.saas_product_id,
                                            'product_name', sp.name, 'role', po.role,
                                            'is_active', po.is_active) order by sp.name)
          from platform.product_owners po
          join platform.saas_products sp on sp.id = po.saas_product_id
         where po.user_id = p.id
      ), '[]'::jsonb) else '[]'::jsonb end as product_ownerships,
      case when v_all then (
        select jsonb_build_object('id', sa.id, 'code', sa.code, 'full_name', sa.full_name,
                                  'agent_type', sa.agent_type, 'status', sa.status)
          from platform.sales_agents sa where sa.user_id = p.id
      ) end as sales_agent
    from platform.profiles p
    join scoped s on s.id = p.id
    left join auth.users u on u.id = p.id
    left join platform.platform_admins pa on pa.user_id = p.id
    where (p_user_id is null or p.id = p_user_id)
  )
  select r.id, r.email, r.full_name, r.phone, r.job_title, r.is_active, r.created_at,
         r.last_sign_in_at, r.invited_at, r.email_confirmed_at, r.banned,
         r.platform_role, r.platform_role_active, r.organizations, r.tenants,
         r.provisioning_roles, r.product_ownerships, r.sales_agent
    from listed r
   where v_needle is null
      or r.email like '%' || v_needle || '%'
      or lower(coalesce(r.full_name, '')) like '%' || v_needle || '%'
      or exists (select 1 from jsonb_array_elements(r.organizations) e
                  where lower(e ->> 'organization_name') like '%' || v_needle || '%')
   order by r.is_active desc, lower(coalesce(r.full_name, r.email)), r.email
   limit 2000;
end;
$$;

comment on function platform.admin_list_users(text, uuid, uuid) is
  'M5 · Usuarios con perfil, rol de consola, membresías, provisioning, comercial, último '
  'ingreso y baneo. EBIM ve todo; un admin de organización solo sus miembros y sus '
  'membresías (nunca roles de consola: S-03).';

-- ---------------------------------------------------------------------------
-- 6. Perfil
-- ---------------------------------------------------------------------------
create or replace function platform.admin_update_profile(
  p_user_id   uuid,
  p_full_name text,
  p_phone     text default null,
  p_job_title text default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_name  text := nullif(trim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_title text := nullif(trim(coalesce(p_job_title, '')), '');
  v_prev  record;
begin
  if not (p_user_id = auth.uid() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo el propio usuario o el super admin editan este perfil'
      using errcode = '42501';
  end if;

  select p.full_name, p.phone, p.job_title into v_prev from platform.profiles p where p.id = p_user_id;
  if not found then
    raise exception 'USUARIO_NO_ENCONTRADO: no existe el usuario %', p_user_id using errcode = 'P0002';
  end if;
  if v_name is null then
    raise exception 'NOMBRE_REQUERIDO: el nombre no puede quedar vacío' using errcode = '23502';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9][0-9 ()-]{5,22}$' then
    raise exception 'TELEFONO_INVALIDO: usa solo dígitos, espacios, paréntesis, guiones y un + inicial'
      using errcode = '23514';
  end if;
  if v_title is not null and char_length(v_title) > 120 then
    raise exception 'CARGO_DEMASIADO_LARGO: máximo 120 caracteres' using errcode = '23514';
  end if;

  update platform.profiles
     set full_name = v_name, phone = v_phone, job_title = v_title
   where id = p_user_id;

  perform platform.log_audit('USER_PROFILE_UPDATED', 'profile', p_user_id::text, null, null,
    jsonb_build_object(
      'user_id', p_user_id,
      'self', p_user_id = auth.uid(),
      'changed', to_jsonb(array_remove(array[
        case when v_prev.full_name is distinct from v_name then 'full_name' end,
        case when v_prev.phone is distinct from v_phone then 'phone' end,
        case when v_prev.job_title is distinct from v_title then 'job_title' end
      ], null))));
  return p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Rol de consola (super admin)
-- ---------------------------------------------------------------------------
create or replace function platform.grant_platform_role(
  p_user_id uuid,
  p_role    platform.platform_role,
  p_reason  text default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_prev platform.platform_admins%rowtype;
begin
  if not platform.is_super_admin() then
    raise exception 'NO_AUTORIZADO: solo el super admin EBIM concede roles de consola' using errcode = '42501';
  end if;
  if p_role is null then
    raise exception 'ROL_REQUERIDO: indica el rol de consola' using errcode = '23502';
  end if;
  if p_role = 'EBIM_SUPER_ADMIN' then
    raise exception 'SUPER_ADMIN_NO_ASIGNABLE: EBIM_SUPER_ADMIN no se concede desde la consola (contrato §13.1)'
      using errcode = '42501';
  end if;
  perform platform.assert_active_profile(p_user_id);

  select * into v_prev from platform.platform_admins where user_id = p_user_id;
  if v_prev.role = 'EBIM_SUPER_ADMIN' then
    raise exception 'SUPER_ADMIN_PROTEGIDO: el rol del super admin no se cambia (contrato §13.1)'
      using errcode = '42501';
  end if;

  insert into platform.platform_admins as pa (user_id, role, is_active, granted_by)
  values (p_user_id, p_role, true, auth.uid())
  on conflict (user_id) do update
    set role = excluded.role, is_active = true, granted_by = excluded.granted_by;

  perform platform.log_audit('PLATFORM_ROLE_GRANTED', 'platform_admin', p_user_id::text, null, null,
    jsonb_strip_nulls(jsonb_build_object(
      'user_id', p_user_id, 'role', p_role::text,
      'previous_role', case when v_prev.is_active then v_prev.role::text end,
      'reason', nullif(trim(coalesce(p_reason, '')), ''))));
  return p_user_id;
end;
$$;

create or replace function platform.revoke_platform_role(p_user_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_prev platform.platform_admins%rowtype;
begin
  if not platform.is_super_admin() then
    raise exception 'NO_AUTORIZADO: solo el super admin EBIM revoca roles de consola' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: revocar un rol de consola exige un motivo auditable' using errcode = '23502';
  end if;

  select * into v_prev from platform.platform_admins where user_id = p_user_id and is_active;
  if not found then
    raise exception 'ROL_NO_ENCONTRADO: el usuario no tiene un rol de consola activo' using errcode = 'P0002';
  end if;
  if v_prev.role = 'EBIM_SUPER_ADMIN'
     and (select count(*) from platform.platform_admins
           where role = 'EBIM_SUPER_ADMIN' and is_active) <= 1 then
    raise exception 'ULTIMO_SUPER_ADMIN: no se puede dejar la suite sin su super admin activo (contrato §13.1)'
      using errcode = '42501';
  end if;

  update platform.platform_admins set is_active = false where user_id = p_user_id;

  perform platform.log_audit('PLATFORM_ROLE_REVOKED', 'platform_admin', p_user_id::text, null, null,
    jsonb_build_object('user_id', p_user_id, 'role', v_prev.role::text, 'reason', trim(p_reason)));
  return p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Membresías de organización
-- ---------------------------------------------------------------------------
create or replace function platform.upsert_organization_membership(
  p_user_id    uuid,
  p_org_id     uuid,
  p_role       platform.org_role,
  p_company_id uuid default null,
  p_reason     text default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_prev platform.organization_memberships%rowtype;
  v_id   uuid;
begin
  if p_role is null then
    raise exception 'ROL_REQUERIDO: indica el rol en la organización' using errcode = '23502';
  end if;
  select * into v_prev from platform.organization_memberships
   where user_id = p_user_id and organization_id = p_org_id;

  perform platform.assert_org_role_assignable(p_org_id, p_role, p_user_id, v_prev.role);
  perform platform.assert_active_profile(p_user_id);

  if p_company_id is not null and not exists (
    select 1 from platform.companies c where c.id = p_company_id and c.organization_id = p_org_id
  ) then
    raise exception 'EMPRESA_NO_PERTENECE: la sociedad no es de esa organización' using errcode = '23514';
  end if;

  -- El trigger `org_memberships_operator_domain_guard` aplica S-02.
  insert into platform.organization_memberships as m (user_id, organization_id, role, company_id, is_active)
  values (p_user_id, p_org_id, p_role, p_company_id, true)
  on conflict (user_id, organization_id) do update
    set role = excluded.role, company_id = excluded.company_id, is_active = true
  returning m.id into v_id;

  perform platform.log_audit(
    case when v_prev.id is null then 'ORG_MEMBERSHIP_GRANTED' else 'ORG_MEMBERSHIP_UPDATED' end,
    'organization_membership', v_id::text, p_org_id, null,
    jsonb_strip_nulls(jsonb_build_object(
      'user_id', p_user_id, 'role', p_role::text,
      'previous_role', v_prev.role::text,
      'previous_active', v_prev.is_active,
      'company_id', p_company_id,
      'reason', nullif(trim(coalesce(p_reason, '')), ''))));
  return v_id;
end;
$$;

create or replace function platform.set_organization_membership_active(
  p_membership_id uuid,
  p_active        boolean,
  p_reason        text default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_m platform.organization_memberships%rowtype;
begin
  select * into v_m from platform.organization_memberships where id = p_membership_id;
  if not found then
    raise exception 'MEMBRESIA_NO_ENCONTRADA: %', p_membership_id using errcode = 'P0002';
  end if;
  perform platform.assert_org_role_assignable(v_m.organization_id, v_m.role, v_m.user_id, v_m.role);
  if p_active then
    perform platform.assert_active_profile(v_m.user_id);
  end if;

  update platform.organization_memberships set is_active = coalesce(p_active, false)
   where id = p_membership_id;

  perform platform.log_audit(
    case when p_active then 'ORG_MEMBERSHIP_ACTIVATED' else 'ORG_MEMBERSHIP_DEACTIVATED' end,
    'organization_membership', p_membership_id::text, v_m.organization_id, null,
    jsonb_strip_nulls(jsonb_build_object(
      'user_id', v_m.user_id, 'role', v_m.role::text,
      'reason', nullif(trim(coalesce(p_reason, '')), ''))));
  return p_membership_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Membresías de tenant
-- ---------------------------------------------------------------------------
create or replace function platform.upsert_tenant_membership(
  p_user_id   uuid,
  p_tenant_id uuid,
  p_role      platform.tenant_role,
  p_reason    text default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_email text;
  v_prev  platform.tenant_memberships%rowtype;
  v_org   uuid;
  v_id    uuid;
begin
  if p_role is null then
    raise exception 'ROL_REQUERIDO: indica el rol en el tenant' using errcode = '23502';
  end if;
  select t.customer_organization_id into v_org from platform.tenants t where t.id = p_tenant_id;
  if v_org is null then
    raise exception 'TENANT_NO_ENCONTRADO: %', p_tenant_id using errcode = 'P0002';
  end if;
  if not platform.can_manage_tenant(p_tenant_id) then
    raise exception 'NO_AUTORIZADO: no administra ese tenant' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() and not platform.can_manage_platform_entities() then
    raise exception 'MEMBRESIA_PROPIA: un administrador de tenant no modifica su propia membresía'
      using errcode = '42501';
  end if;
  v_email := platform.assert_active_profile(p_user_id);
  perform platform.assert_tenant_member_domain(p_tenant_id, v_email);

  select * into v_prev from platform.tenant_memberships where user_id = p_user_id and tenant_id = p_tenant_id;

  insert into platform.tenant_memberships as tm (user_id, tenant_id, role, is_active)
  values (p_user_id, p_tenant_id, p_role, true)
  on conflict (user_id, tenant_id) do update set role = excluded.role, is_active = true
  returning tm.id into v_id;

  perform platform.log_audit(
    case when v_prev.id is null then 'TENANT_MEMBERSHIP_GRANTED' else 'TENANT_MEMBERSHIP_UPDATED' end,
    'tenant_membership', v_id::text, v_org, p_tenant_id,
    jsonb_strip_nulls(jsonb_build_object(
      'user_id', p_user_id, 'role', p_role::text,
      'previous_role', v_prev.role::text,
      'previous_active', v_prev.is_active,
      'reason', nullif(trim(coalesce(p_reason, '')), ''))));
  return v_id;
end;
$$;

create or replace function platform.set_tenant_membership_active(
  p_membership_id uuid,
  p_active        boolean,
  p_reason        text default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_m   platform.tenant_memberships%rowtype;
  v_org uuid;
begin
  select * into v_m from platform.tenant_memberships where id = p_membership_id;
  if not found then
    raise exception 'MEMBRESIA_NO_ENCONTRADA: %', p_membership_id using errcode = 'P0002';
  end if;
  if not platform.can_manage_tenant(v_m.tenant_id) then
    raise exception 'NO_AUTORIZADO: no administra ese tenant' using errcode = '42501';
  end if;
  if v_m.user_id = auth.uid() and not platform.can_manage_platform_entities() then
    raise exception 'MEMBRESIA_PROPIA: un administrador de tenant no modifica su propia membresía'
      using errcode = '42501';
  end if;
  if p_active then
    perform platform.assert_tenant_member_domain(v_m.tenant_id, platform.assert_active_profile(v_m.user_id));
  end if;

  update platform.tenant_memberships set is_active = coalesce(p_active, false) where id = p_membership_id;
  select t.customer_organization_id into v_org from platform.tenants t where t.id = v_m.tenant_id;

  perform platform.log_audit(
    case when p_active then 'TENANT_MEMBERSHIP_ACTIVATED' else 'TENANT_MEMBERSHIP_DEACTIVATED' end,
    'tenant_membership', p_membership_id::text, v_org, v_m.tenant_id,
    jsonb_strip_nulls(jsonb_build_object(
      'user_id', v_m.user_id, 'role', v_m.role::text,
      'reason', nullif(trim(coalesce(p_reason, '')), ''))));
  return p_membership_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Vínculo usuario ↔ comercial (comercial ≠ acceso operativo)
-- ---------------------------------------------------------------------------
create or replace function platform.link_user_sales_agent(
  p_sales_agent_id uuid,
  p_user_id        uuid,
  p_reason         text default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_agent platform.sales_agents%rowtype;
begin
  if not platform.can_manage_commercial() then
    raise exception 'NO_AUTORIZADO: vincular usuarios a comerciales es de administración comercial EBIM'
      using errcode = '42501';
  end if;
  select * into v_agent from platform.sales_agents where id = p_sales_agent_id;
  if not found then
    raise exception 'COMERCIAL_NO_ENCONTRADO: %', p_sales_agent_id using errcode = 'P0002';
  end if;
  if p_user_id is not null then
    perform platform.assert_active_profile(p_user_id);
    if exists (select 1 from platform.sales_agents sa where sa.user_id = p_user_id and sa.id <> p_sales_agent_id) then
      raise exception 'USUARIO_YA_VINCULADO: el usuario ya está vinculado a otro comercial' using errcode = '23505';
    end if;
  end if;

  update platform.sales_agents set user_id = p_user_id where id = p_sales_agent_id;

  perform platform.log_audit(
    case when p_user_id is null then 'SALES_AGENT_USER_UNLINKED' else 'SALES_AGENT_USER_LINKED' end,
    'sales_agent', p_sales_agent_id::text, v_agent.organization_id, null,
    jsonb_strip_nulls(jsonb_build_object(
      'user_id', p_user_id, 'previous_user_id', v_agent.user_id,
      'reason', nullif(trim(coalesce(p_reason, '')), ''))));
  return p_sales_agent_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Desactivar / reactivar (super admin)
-- ---------------------------------------------------------------------------
/*
 * Desactiva el perfil y, en cascada, el rol de consola, las membresías de
 * organización y de tenant, los roles de provisioning y la propiedad técnica de
 * productos (los helpers RLS ya filtran por `is_active` de esas filas). Las
 * invitaciones pendientes quedan REVOKED. El vínculo comercial NO se toca:
 * cobrar comisiones históricas no es acceso. Nunca el último super admin.
 * El baneo en Auth lo hace la Edge Function `user-admin` (ban) tras esta RPC.
 */
create or replace function platform.deactivate_user(p_user_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_was_active boolean;
  v_console int;
  v_orgs    int;
  v_tenants int;
  v_prov    int;
  v_owner   int;
  v_inv     int;
begin
  if not platform.is_super_admin() then
    raise exception 'NO_AUTORIZADO: solo el super admin EBIM desactiva usuarios' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: desactivar un usuario exige un motivo auditable' using errcode = '23502';
  end if;
  select p.is_active into v_was_active from platform.profiles p where p.id = p_user_id;
  if v_was_active is null then
    raise exception 'USUARIO_NO_ENCONTRADO: no existe el usuario %', p_user_id using errcode = 'P0002';
  end if;
  if exists (select 1 from platform.platform_admins pa
              where pa.user_id = p_user_id and pa.role = 'EBIM_SUPER_ADMIN' and pa.is_active)
     and (select count(*) from platform.platform_admins pa2
           join platform.profiles pr on pr.id = pa2.user_id
          where pa2.role = 'EBIM_SUPER_ADMIN' and pa2.is_active and pr.is_active) <= 1 then
    raise exception 'ULTIMO_SUPER_ADMIN: no se puede desactivar al último super admin activo (contrato §13.1)'
      using errcode = '42501';
  end if;

  update platform.profiles set is_active = false where id = p_user_id;
  update platform.platform_admins set is_active = false where user_id = p_user_id and is_active;
  get diagnostics v_console = row_count;
  update platform.organization_memberships set is_active = false where user_id = p_user_id and is_active;
  get diagnostics v_orgs = row_count;
  update platform.tenant_memberships set is_active = false where user_id = p_user_id and is_active;
  get diagnostics v_tenants = row_count;
  update platform.provisioning_role_members set is_active = false where user_id = p_user_id and is_active;
  get diagnostics v_prov = row_count;
  update platform.product_owners set is_active = false where user_id = p_user_id and is_active;
  get diagnostics v_owner = row_count;
  update platform.user_invitations set status = 'REVOKED', revoked_at = now()
   where user_id = p_user_id and status = 'SENT';
  get diagnostics v_inv = row_count;

  perform platform.log_audit('USER_DEACTIVATED', 'profile', p_user_id::text, null, null,
    jsonb_build_object(
      'user_id', p_user_id, 'reason', trim(p_reason), 'was_active', v_was_active,
      'console_roles', v_console, 'org_memberships', v_orgs, 'tenant_memberships', v_tenants,
      'provisioning_roles', v_prov, 'product_ownerships', v_owner, 'invitations', v_inv));

  return jsonb_build_object(
    'user_id', p_user_id, 'was_active', v_was_active,
    'console_roles', v_console, 'org_memberships', v_orgs, 'tenant_memberships', v_tenants,
    'provisioning_roles', v_prov, 'product_ownerships', v_owner, 'invitations', v_inv);
end;
$$;

-- Solo el perfil: los accesos se vuelven a otorgar explícitamente (spec §6.2).
create or replace function platform.reactivate_user(p_user_id uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_was_active boolean;
begin
  if not platform.is_super_admin() then
    raise exception 'NO_AUTORIZADO: solo el super admin EBIM reactiva usuarios' using errcode = '42501';
  end if;
  select p.is_active into v_was_active from platform.profiles p where p.id = p_user_id;
  if v_was_active is null then
    raise exception 'USUARIO_NO_ENCONTRADO: no existe el usuario %', p_user_id using errcode = 'P0002';
  end if;

  update platform.profiles set is_active = true where id = p_user_id;

  perform platform.log_audit('USER_REACTIVATED', 'profile', p_user_id::text, null, null,
    jsonb_strip_nulls(jsonb_build_object(
      'user_id', p_user_id, 'was_active', v_was_active,
      'reason', nullif(trim(coalesce(p_reason, '')), ''))));
  return p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Invitaciones
-- ---------------------------------------------------------------------------

/*
 * La Edge Function `user-admin` la llama con el JWT del operador ANTES de crear
 * la cuenta en Auth: si el operador no podría aplicar el acceso pedido, no se
 * crea nada. Devuelve el acceso normalizado.
 */
create or replace function platform.authorize_user_invitation(p_email text, p_grant jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
begin
  return jsonb_build_object('ok', true, 'email', lower(trim(p_email)),
                            'grant', platform.assert_user_grant(p_grant, p_email));
end;
$$;

create or replace function platform.record_user_invitation(
  p_email     text,
  p_user_id   uuid,
  p_grant     jsonb,
  p_delivery  text,
  p_full_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_grant jsonb;
  v_id    uuid;
begin
  v_grant := platform.assert_user_grant(p_grant, v_email);
  if p_delivery is null or p_delivery not in ('EMAIL', 'LINK') then
    raise exception 'ENTREGA_INVALIDA: la invitación se entrega por EMAIL o LINK' using errcode = '22023';
  end if;
  if not exists (select 1 from platform.profiles p where p.id = p_user_id and p.email = v_email) then
    raise exception 'INVITACION_INCOHERENTE: el usuario no corresponde al correo invitado' using errcode = '23514';
  end if;

  insert into platform.user_invitations (email, full_name, invited_by, user_id, access_grant, status, delivery)
  values (v_email, nullif(trim(coalesce(p_full_name, '')), ''), auth.uid(), p_user_id, v_grant, 'SENT', p_delivery)
  returning id into v_id;

  perform platform.log_audit('USER_INVITED', 'profile', p_user_id::text,
    (v_grant ->> 'organization_id')::uuid, (v_grant ->> 'tenant_id')::uuid,
    jsonb_build_object('user_id', p_user_id, 'invitation_id', v_id, 'email', v_email,
                       'delivery', p_delivery, 'access_kind', v_grant ->> 'kind',
                       'role', v_grant ->> 'role'));
  return v_id;
end;
$$;

/*
 * Reenvío de una invitación PENDIENTE (el invitado aún no fijó su contraseña).
 * Puede reenviarla el super admin, un admin de producto EBIM o quien la emitió.
 * Nunca sirve para una cuenta ya activada: entregarle al operador un enlace de
 * acceso de alguien que ya usa su cuenta sería suplantación. Para eso existe
 * «¿Olvidaste tu contraseña?», que solo llega al correo del titular.
 */
create or replace function platform.assert_can_resend_invitation(p_user_id uuid)
returns platform.user_invitations
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_inv platform.user_invitations%rowtype;
begin
  perform platform.assert_active_profile(p_user_id);
  -- Pendiente = hubo invitación y ninguna fue aceptada. Una invitación REVOKED
  -- por una desactivación se puede reenviar tras reactivar el perfil.
  select * into v_inv from platform.user_invitations i
   where i.user_id = p_user_id
   order by i.created_at desc limit 1;
  if v_inv.id is null or exists (
    select 1 from platform.user_invitations i where i.user_id = p_user_id and i.status = 'ACCEPTED'
  ) then
    raise exception 'INVITACION_NO_PENDIENTE: el usuario no tiene una invitación pendiente'
      using errcode = '23514';
  end if;
  if not (platform.can_manage_platform_entities()
          or exists (select 1 from platform.user_invitations i
                      where i.user_id = p_user_id and i.invited_by = auth.uid())) then
    raise exception 'NO_AUTORIZADO: solo EBIM o quien emitió la invitación la reenvía' using errcode = '42501';
  end if;
  return v_inv;
end;
$$;

create or replace function platform.authorize_invitation_resend(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_inv platform.user_invitations%rowtype := platform.assert_can_resend_invitation(p_user_id);
begin
  return jsonb_build_object('ok', true, 'email', v_inv.email, 'full_name', v_inv.full_name);
end;
$$;

create or replace function platform.record_invitation_resend(p_user_id uuid, p_delivery text)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_prev platform.user_invitations%rowtype := platform.assert_can_resend_invitation(p_user_id);
  v_id   uuid;
begin
  if p_delivery is null or p_delivery not in ('EMAIL', 'LINK') then
    raise exception 'ENTREGA_INVALIDA: la invitación se entrega por EMAIL o LINK' using errcode = '22023';
  end if;
  insert into platform.user_invitations (email, full_name, invited_by, user_id, access_grant, status, delivery)
  values (v_prev.email, v_prev.full_name, auth.uid(), p_user_id, v_prev.access_grant, 'SENT', p_delivery)
  returning id into v_id;

  perform platform.log_audit('USER_INVITATION_RESENT', 'profile', p_user_id::text,
    (v_prev.access_grant ->> 'organization_id')::uuid, (v_prev.access_grant ->> 'tenant_id')::uuid,
    jsonb_build_object('user_id', p_user_id, 'invitation_id', v_id, 'previous_invitation_id', v_prev.id,
                       'delivery', p_delivery));
  return v_id;
end;
$$;

-- La llama /bienvenida cuando el invitado fija su contraseña.
create or replace function platform.accept_my_invitations()
returns int
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'NO_AUTENTICADO: se requiere sesión' using errcode = '42501';
  end if;
  update platform.user_invitations
     set status = 'ACCEPTED', accepted_at = now()
   where user_id = auth.uid() and status = 'SENT';
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform platform.log_audit('USER_INVITATION_ACCEPTED', 'profile', auth.uid()::text, null, null,
      jsonb_build_object('user_id', auth.uid(), 'invitations', v_count));
  end if;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Permisos de ejecución
-- ---------------------------------------------------------------------------
-- Internas: solo se invocan desde otras funciones definer (como owner).
revoke all on function platform.org_role_family(platform.org_role) from public, anon, authenticated;
revoke all on function platform.org_role_rank(platform.org_role) from public, anon, authenticated;
revoke all on function platform.assert_active_profile(uuid) from public, anon, authenticated;
revoke all on function platform.assert_org_role_assignable(uuid, platform.org_role, uuid, platform.org_role) from public, anon, authenticated;
revoke all on function platform.assert_tenant_member_domain(uuid, text) from public, anon, authenticated;
revoke all on function platform.assert_user_grant(jsonb, text) from public, anon, authenticated;
revoke all on function platform.assert_can_resend_invitation(uuid) from public, anon, authenticated;
grant execute on function platform.org_role_family(platform.org_role) to service_role;
grant execute on function platform.org_role_rank(platform.org_role) to service_role;
grant execute on function platform.assert_active_profile(uuid) to service_role;
grant execute on function platform.assert_org_role_assignable(uuid, platform.org_role, uuid, platform.org_role) to service_role;
grant execute on function platform.assert_tenant_member_domain(uuid, text) to service_role;
grant execute on function platform.assert_user_grant(jsonb, text) to service_role;
grant execute on function platform.assert_can_resend_invitation(uuid) to service_role;

-- Consola: `authenticated` (cada RPC decide quién) y servicio.
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'platform.admin_list_users(text, uuid, uuid)',
    'platform.admin_update_profile(uuid, text, text, text)',
    'platform.grant_platform_role(uuid, platform.platform_role, text)',
    'platform.revoke_platform_role(uuid, text)',
    'platform.upsert_organization_membership(uuid, uuid, platform.org_role, uuid, text)',
    'platform.set_organization_membership_active(uuid, boolean, text)',
    'platform.upsert_tenant_membership(uuid, uuid, platform.tenant_role, text)',
    'platform.set_tenant_membership_active(uuid, boolean, text)',
    'platform.link_user_sales_agent(uuid, uuid, text)',
    'platform.deactivate_user(uuid, text)',
    'platform.reactivate_user(uuid, text)',
    'platform.authorize_user_invitation(text, jsonb)',
    'platform.record_user_invitation(text, uuid, jsonb, text, text)',
    'platform.authorize_invitation_resend(uuid)',
    'platform.record_invitation_resend(uuid, text)',
    'platform.accept_my_invitations()'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated, service_role', v_sig);
  end loop;
end;
$$;
