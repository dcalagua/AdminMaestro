-- ============================================================================
-- EBIM Control Plane V2.1 — 23 · Datos de contacto de facturación
-- ----------------------------------------------------------------------------
-- Fase 6 del hardening.
--
-- POR QUÉ EXISTE ESTA MIGRACIÓN
-- -----------------------------
-- El objeto Customer de Culqi exige SIETE campos. Verificado contra la API TEST
-- el 2026-09-07, enviando cuerpos incompletos hasta agotar las validaciones:
--
--     first_name    (< 50 car.)
--     last_name     (< 50 car.)
--     email         (formato válido)
--     address       (5 a 100 car.)
--     address_city  (2 a 30 car.)
--     country_code  (ISO-3166-1 alfa-2)
--     phone_number  (5 a 15 car.)
--
-- El Control Plane solo tenía `billing_email` y `country_code`. Faltaban cinco.
--
-- La alternativa fácil habría sido rellenarlos con literales ("Lima", "N/A",
-- "999999999"). Se descarta: esos datos viajan a la pasarela, acaban en el
-- recibo del cliente y en la conciliación del comercio. Un domicilio inventado
-- en un dato fiscal no es un atajo, es una falsificación pequeña que después
-- nadie sabe de dónde salió.
--
-- Así que se modela el dato, se pide en la UI, se valida, y solo entonces se
-- crea el Customer. Si falta, el alta se detiene con un error que dice
-- exactamente qué campo falta.
-- ============================================================================

alter table platform.organizations
  add column billing_first_name text,
  add column billing_last_name  text,
  add column billing_address    text,
  add column billing_city       text,
  add column billing_phone      text;

comment on column platform.organizations.billing_first_name is
  'Nombre del titular de facturación. Requerido por el Customer del PSP.';
comment on column platform.organizations.billing_address is
  'Domicilio de facturación. NO se inventa: si falta, el alta de cobro se detiene.';
comment on column platform.organizations.billing_phone is
  'Teléfono de facturación en formato internacional, sin símbolos (ej. 51987654321).';

-- Longitudes alineadas con lo que la pasarela acepta, para fallar aquí —con un
-- mensaje nuestro— y no allí, con uno suyo.
alter table platform.organizations
  add constraint org_billing_first_name_ck
    check (billing_first_name is null or char_length(billing_first_name) between 2 and 50),
  add constraint org_billing_last_name_ck
    check (billing_last_name is null or char_length(billing_last_name) between 2 and 50),
  add constraint org_billing_address_ck
    check (billing_address is null or char_length(billing_address) between 5 and 100),
  add constraint org_billing_city_ck
    check (billing_city is null or char_length(billing_city) between 2 and 30),
  -- Solo dígitos: la pasarela rechaza espacios, guiones y paréntesis.
  add constraint org_billing_phone_ck
    check (billing_phone is null or billing_phone ~ '^[0-9]{5,15}$');

-- ---------------------------------------------------------------------------
-- Vista: ¿está esta organización lista para domiciliar un cobro con tarjeta?
--
-- Devuelve la lista EXACTA de lo que falta, para que la UI no tenga que
-- reimplementar la regla y para que el mensaje sea accionable.
-- ---------------------------------------------------------------------------
create or replace view platform.v_billing_contact_readiness
with (security_invoker = true) as
select
  o.id                      as organization_id,
  o.display_name            as organization_name,
  o.billing_email,
  o.billing_first_name,
  o.billing_last_name,
  o.billing_address,
  o.billing_city,
  o.billing_phone,
  o.country_code,
  array_remove(array[
    case when coalesce(trim(o.billing_first_name), '') = '' then 'billing_first_name' end,
    case when coalesce(trim(o.billing_last_name),  '') = '' then 'billing_last_name'  end,
    case when coalesce(trim(o.billing_email),      '') = '' then 'billing_email'      end,
    case when coalesce(trim(o.billing_address),    '') = '' then 'billing_address'    end,
    case when coalesce(trim(o.billing_city),       '') = '' then 'billing_city'       end,
    case when coalesce(trim(o.billing_phone),      '') = '' then 'billing_phone'      end,
    case when coalesce(trim(o.country_code),       '') = '' then 'country_code'       end
  ], null)                  as missing_fields,
  (coalesce(trim(o.billing_first_name), '') <> ''
   and coalesce(trim(o.billing_last_name),  '') <> ''
   and coalesce(trim(o.billing_email),      '') <> ''
   and coalesce(trim(o.billing_address),    '') <> ''
   and coalesce(trim(o.billing_city),       '') <> ''
   and coalesce(trim(o.billing_phone),      '') <> ''
   and coalesce(trim(o.country_code),       '') <> '') as ready_for_card_payment
from platform.organizations o;

comment on view platform.v_billing_contact_readiness is
  '`ready_for_card_payment` responde a: ¿tenemos los 7 datos que el PSP exige para '
  'crear el Customer? `missing_fields` dice cuáles faltan, sin que la UI reimplemente la regla.';

grant select on platform.v_billing_contact_readiness to authenticated;
revoke all on platform.v_billing_contact_readiness from anon;

-- ---------------------------------------------------------------------------
-- RPC de actualización. Solo los datos de facturación, nada más: no es un
-- `upsert_organization` encubierto.
-- ---------------------------------------------------------------------------
create or replace function platform.set_billing_contact(
  p_organization_id  uuid,
  p_first_name       text,
  p_last_name        text,
  p_email            text,
  p_address          text,
  p_city             text,
  p_phone            text
)
returns uuid
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_org   record;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  select * into v_org from platform.organizations where id = p_organization_id;
  if v_org is null then
    raise exception 'ORGANIZACION_NO_ENCONTRADA: %', p_organization_id using errcode = '23503';
  end if;

  if not (platform.can_manage_commercial() or platform.is_org_admin(p_organization_id)) then
    raise exception 'NO_AUTORIZADO: no administra los datos de facturación de esta organización'
      using errcode = '42501';
  end if;

  if coalesce(trim(p_email), '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-zA-Z]{2,}$' then
    raise exception 'CORREO_INVALIDO: "%" no es un correo de facturación válido', p_email
      using errcode = '23514';
  end if;
  if char_length(v_phone) < 5 or char_length(v_phone) > 15 then
    raise exception 'TELEFONO_INVALIDO: el teléfono debe tener entre 5 y 15 dígitos (recibido "%")', p_phone
      using errcode = '23514';
  end if;

  update platform.organizations
     set billing_first_name = trim(p_first_name),
         billing_last_name  = trim(p_last_name),
         billing_email      = lower(trim(p_email)),
         billing_address    = trim(p_address),
         billing_city       = trim(p_city),
         billing_phone      = v_phone
   where id = p_organization_id;

  perform platform.log_audit(
    'BILLING_CONTACT_UPDATED', 'organization', p_organization_id::text,
    p_organization_id, null,
    -- Se auditan los CAMPOS actualizados, no sus valores: un domicilio y un
    -- teléfono son datos personales y la bitácora es de lectura amplia.
    jsonb_build_object('fields', array['first_name','last_name','email','address','city','phone'])
  );

  return p_organization_id;
end;
$$;

revoke all on function platform.set_billing_contact from public, anon;
grant execute on function platform.set_billing_contact to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Los datos de facturación de los clientes de demostración NO se cargan aquí.
--
-- Las migraciones corren ANTES que `seed.sql`, así que una sentencia sobre
-- `platform.organizations` en este archivo no encuentra ninguna fila y no
-- falla: actualiza cero registros, en silencio. Se detectó porque el alta de
-- cobro seguía respondiendo DATOS_FACTURACION_INCOMPLETOS con los "fixtures"
-- supuestamente aplicados.
--
-- Los fixtures viven donde viven los demás datos de demostración: en
-- `supabase/seed.sql`.
-- ---------------------------------------------------------------------------
