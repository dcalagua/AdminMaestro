-- ============================================================================
-- EBIM Control Plane V3 — 35 · Sin país por defecto en organizaciones
-- ----------------------------------------------------------------------------
-- Fase 98 (auditoría final) de `.claude-prompts-v3-multicurrency`.
--
-- La auditoría de defaults encontró el último valor regional implícito:
-- `organizations.country_code default 'PE'` y `upsert_organization(p_country_code
-- default 'PE')`. No es un importe, pero en V3 el país de la organización SUGIERE
-- el mercado —y con él la moneda— de cada venta: una organización de Bolivia
-- creada sin país nacía peruana y el wizard le proponía PE/PEN.
--
-- Se exige el país explícito. Las organizaciones existentes no cambian.
-- El cuerpo es el de V2 (migración 14) con la validación añadida.
-- ============================================================================

alter table platform.organizations alter column country_code drop default;

drop function if exists platform.upsert_organization(
  text, text, text, character, text, text, platform.org_capability[], platform.entity_status,
  text, text, boolean, text, jsonb, uuid
);

create or replace function platform.upsert_organization(
  p_slug          text,
  p_legal_name    text,
  p_display_name  text,
  -- V3: sin país por defecto. El país sugiere el mercado de cada venta; un 'PE'
  -- implícito hacía nacer peruana a una organización boliviana.
  p_country_code  char(2) default null,
  p_tax_id        text default null,
  p_billing_email text default null,
  p_capabilities  platform.org_capability[] default array['CUSTOMER']::platform.org_capability[],
  p_status        platform.entity_status default 'ACTIVE',
  p_accent_color  text default null,
  p_logo_url      text default null,
  p_white_label   boolean default false,
  p_brand_slug    text default null,
  p_metadata      jsonb default '{}'::jsonb,
  -- `p_id` va al final y con default: null = alta, valor = edición. Estar al
  -- final lo hace realmente OPCIONAL, y el generador de tipos lo refleja.
  p_id           uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_id     uuid;
  v_slug   text := lower(nullif(trim(coalesce(p_slug, '')), ''));
  v_is_new boolean := p_id is null;
  v_old    record;
  v_caps   platform.org_capability[] := coalesce(p_capabilities, array[]::platform.org_capability[]);
  v_country char(2) := upper(nullif(trim(coalesce(p_country_code, '')), ''));
begin
  -- Alta: solo EBIM. Edición: EBIM o un admin de esa misma organización.
  if v_is_new then
    if not platform.can_manage_platform_entities() then
      raise exception 'NO_AUTORIZADO: solo EBIM_PRODUCT_ADMIN o el super admin dan de alta organizaciones'
        using errcode = '42501';
    end if;
  else
    if not (platform.can_manage_platform_entities() or platform.is_org_admin(p_id)) then
      raise exception 'NO_AUTORIZADO: no administra esta organización' using errcode = '42501';
    end if;
  end if;

  if v_slug is null or v_slug !~ '^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])?$' then
    raise exception 'SLUG_INVALIDO: "%" debe ser minúsculas/números/guiones, 2-48 caracteres', p_slug
      using errcode = '23514';
  end if;
  if nullif(trim(coalesce(p_legal_name, '')), '') is null
     or nullif(trim(coalesce(p_display_name, '')), '') is null then
    raise exception 'NOMBRE_REQUERIDO: legal_name y display_name son obligatorios' using errcode = '23502';
  end if;

  if v_country is null or v_country !~ '^[A-Z]{2}$' then
    raise exception 'PAIS_REQUERIDO: la organización declara su país ISO 3166 de dos letras (PE, BO, EC, CL...)'
      using errcode = '23502';
  end if;

  -- `kind` se queda siempre en COMPANY: la única organización PLATFORM es EBIM y
  -- el índice parcial `organizations_single_platform_uk` la protege. No se expone
  -- como parámetro para que nadie se declare plataforma desde la consola.
  if v_is_new then
    insert into platform.organizations (
      slug, legal_name, display_name, kind, country_code, tax_id, status,
      accent_color, logo_url, white_label, brand_slug, billing_email, metadata
    ) values (
      v_slug, trim(p_legal_name), trim(p_display_name), 'COMPANY', v_country, p_tax_id, p_status,
      p_accent_color, p_logo_url, coalesce(p_white_label, false), p_brand_slug, p_billing_email,
      coalesce(p_metadata, '{}'::jsonb)
    )
    returning id into v_id;
  else
    select * into v_old from platform.organizations where id = p_id;
    if v_old is null then
      raise exception 'ORGANIZACION_NO_ENCONTRADA: %', p_id using errcode = '23503';
    end if;
    if v_old.kind = 'PLATFORM' and not platform.is_super_admin() then
      raise exception 'ORGANIZACION_PLATAFORMA_PROTEGIDA: solo el super admin edita la organización EBIM (contrato §13)'
        using errcode = '42501';
    end if;

    update platform.organizations
       set slug = v_slug, legal_name = trim(p_legal_name), display_name = trim(p_display_name),
           country_code = v_country, tax_id = p_tax_id, status = p_status,
           accent_color = p_accent_color, logo_url = p_logo_url,
           white_label = coalesce(p_white_label, false), brand_slug = p_brand_slug,
           billing_email = p_billing_email, metadata = coalesce(p_metadata, '{}'::jsonb),
           archived_at = case when p_status = 'ARCHIVED' then coalesce(v_old.archived_at, now()) else null end
     where id = p_id
    returning id into v_id;
  end if;

  -- Capacidades: solo EBIM las decide. Un partner no se auto-concede RESELLER.
  if platform.can_manage_platform_entities() and array_length(v_caps, 1) is not null then
    delete from platform.organization_capabilities
     where organization_id = v_id and capability <> all (v_caps);

    insert into platform.organization_capabilities (organization_id, capability)
    select v_id, unnest(v_caps)
    on conflict (organization_id, capability) do nothing;
  end if;

  perform platform.log_audit(
    case when v_is_new then 'ORGANIZATION_CREATED' else 'ORGANIZATION_UPDATED' end,
    'organization', v_id::text, v_id, null,
    jsonb_build_object('slug', v_slug, 'status', p_status, 'capabilities', to_jsonb(v_caps))
  );

  return v_id;
end;
$$;

comment on function platform.upsert_organization is
  'Alta/edición de organización con país ISO explícito (sugiere el mercado de sus ventas). '
  'PARTNER/RESELLER/CONSULTING/CUSTOMER son capacidades ACUMULABLES. Solo EBIM concede capacidades.';

revoke all on function platform.upsert_organization(
  text, text, text, character, text, text, platform.org_capability[], platform.entity_status,
  text, text, boolean, text, jsonb, uuid
) from public, anon;
grant execute on function platform.upsert_organization(
  text, text, text, character, text, text, platform.org_capability[], platform.entity_status,
  text, text, boolean, text, jsonb, uuid
) to authenticated, service_role;
