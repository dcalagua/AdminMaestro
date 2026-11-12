-- ============================================================================
-- MasterAdmin · Credenciales de pasarela cifradas (Supabase Vault)
-- ----------------------------------------------------------------------------
-- Spec §11 (docs/superpowers/specs/2026-10-04-masteradmin-cobro-usuarios-design.md).
--
-- Requisito del dueño: la llave secreta de Culqi (`sk_test_…`/`sk_live_…`) se
-- introduce DESDE LA PLATAFORMA, no como secret de Edge Function, y se guarda
-- CIFRADA. Hasta ahora `payment_provider_accounts.secret_key_ref` solo guardaba
-- el NOMBRE de una variable de entorno que alguien tenía que cargar con
-- `supabase secrets set`.
--
-- Piezas:
--   · La llave vive en `vault.secrets` (extensión `supabase_vault`, cifrado
--     autenticado con una clave que la base no expone). La tabla de cuentas solo
--     gana METADATOS: `secret_vault_id` (puntero, oculto por privilegio de
--     columna), `secret_hint` (`sk_test_…abcd`), `secret_set_at`, `secret_set_by`.
--   · `api_base_url`: URL base de la API (no es secreta). NULL = se mantiene el
--     comportamiento anterior (variable `CULQI_API_BASE` del servidor; sin ella,
--     modo de prueba MOCK). No se inventa un valor por defecto.
--   · RPCs de consola (EBIM_FINANCE o super admin, la misma autorización que
--     `upsert_payment_provider_account`):
--       set_payment_provider_secret, clear_payment_provider_secret,
--       set_payment_provider_api_base.
--   · RPC de SERVIDOR: `payment_provider_account_secret` — única forma de leer el
--     texto plano; EXECUTE solo para `service_role`.
--   · `secret_key_ref` sigue funcionando como alternativa (variable de entorno)
--     para no romper despliegues existentes. Allí donde la base preguntaba
--     «¿la cuenta LIVE declara su secreto?» ahora se acepta cualquiera de las dos.
--
-- Invariantes que NO cambian:
--   · `ppa_no_real_keys_ck`: ninguna columna de texto plano guarda una llave.
--   · `CULQI_ALLOW_LIVE` sigue siendo un interruptor de ENTORNO (no editable
--     desde la UI): activarlo cobra dinero real.
--   · La llave nunca aparece en audit_logs, en mensajes de error ni en avisos.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columnas nuevas
-- ---------------------------------------------------------------------------
alter table platform.payment_provider_accounts
  add column secret_vault_id uuid,
  add column secret_hint     text,
  add column secret_set_at   timestamptz,
  -- Sin FK: es un dato de rastro (como audit_logs.actor_user_id), no una relación.
  add column secret_set_by   uuid,
  add column api_base_url    text;

alter table platform.payment_provider_accounts
  add constraint ppa_secret_vault_id_uk unique (secret_vault_id),
  -- Una pista es «sk_test_…abcd»: prefijo + 4 caracteres finales. La forma
  -- exacta impide que una llave completa acabe aquí por error.
  add constraint ppa_secret_hint_ck check (
    secret_hint is null or secret_hint ~ '^sk_(test|live)_…[A-Za-z0-9]{4}$'
  ),
  -- Puntero, pista y fecha van juntos: o hay llave cifrada o no hay nada.
  add constraint ppa_secret_vault_consistent_ck check (
    (secret_vault_id is null) = (secret_hint is null)
    and (secret_vault_id is null) = (secret_set_at is null)
  ),
  -- La llave cifrada corresponde al entorno de la cuenta (respaldo del trigger
  -- `ppa_secret_env_guard`, que da el mensaje legible).
  add constraint ppa_secret_hint_env_ck check (
    secret_hint is null
    or (environment = 'TEST' and secret_hint like 'sk\_test\_%')
    or (environment = 'LIVE' and secret_hint like 'sk\_live\_%')
  ),
  add constraint ppa_api_base_url_ck check (
    api_base_url is null
    or (
      length(api_base_url) <= 200
      and api_base_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?$'
      and api_base_url !~* '(sk|pk)_(test|live)_'
    )
  );

-- Una cuenta Culqi LIVE ACTIVA exige una llave: cifrada (Vault) o por variable
-- de entorno. Antes la exigencia no miraba el estado, y con la llave cifrada eso
-- era un callejón sin salida: la llave se configura sobre una cuenta que ya
-- existe, así que una cuenta LIVE nueva no podía crearse. El circuito ahora es
-- «crear INACTIVA → configurar llave → activar». Una cuenta inactiva no cobra:
-- el routing (provider_account_candidates), resolve_*_card_account y las Edge
-- Functions exigen status = ACTIVE, y una LIVE sin llave falla ruidosamente.
alter table platform.payment_provider_accounts drop constraint ppa_live_needs_secret_ref_ck;
alter table platform.payment_provider_accounts
  add constraint ppa_live_needs_secret_ref_ck check (
    environment = 'TEST' or provider_kind <> 'CULQI' or status <> 'ACTIVE'
    or secret_key_ref is not null or secret_vault_id is not null
  );

comment on column platform.payment_provider_accounts.secret_vault_id is
  'Id de la llave secreta en vault.secrets (cifrada). NO seleccionable por authenticated/anon '
  '(privilegio de columna). El texto plano solo lo lee el servidor con '
  'payment_provider_account_secret().';
comment on column platform.payment_provider_accounts.secret_hint is
  'Pista NO secreta de la llave cifrada: prefijo + 4 últimos caracteres (sk_test_…abcd).';
comment on column platform.payment_provider_accounts.secret_set_at is
  'Cuándo se configuró o reemplazó la llave cifrada.';
comment on column platform.payment_provider_accounts.secret_set_by is
  'Quién configuró o reemplazó la llave cifrada.';
comment on column platform.payment_provider_accounts.api_base_url is
  'URL base https de la API del proveedor. NULL = variable CULQI_API_BASE del servidor; '
  'sin ninguna de las dos la cuenta opera en modo de prueba (MOCK).';
comment on column platform.payment_provider_accounts.secret_key_ref is
  'Alternativa avanzada: NOMBRE de la variable de entorno del servidor con la llave '
  '(ej. CULQI_SECRET_KEY). La vía normal es la llave cifrada (secret_vault_id). '
  'Un CHECK rechaza cualquier valor con forma de clave real.';

-- ---------------------------------------------------------------------------
-- 2. Privilegio de COLUMNA: `secret_vault_id` fuera de alcance del navegador.
--
-- Mismo patrón que `credential_profiles.secret_ref` (migración 43): no es una
-- política, es un GRANT por columna; aunque mañana alguien escriba una política
-- permisiva, la columna sigue cerrada. Ojo: una columna nueva de esta tabla ya
-- NO queda visible automáticamente para `authenticated`; hay que añadirla aquí.
-- ---------------------------------------------------------------------------
revoke select on platform.payment_provider_accounts from authenticated, anon;
grant select (
  id, code, name, provider_kind, environment, owner_organization_id, country_code, currency,
  public_key, secret_key_ref, rsa_public_key_ref, rsa_id_ref, webhook_endpoint, status, metadata,
  created_at, updated_at, market_id, routing_priority,
  secret_hint, secret_set_at, secret_set_by, api_base_url
) on platform.payment_provider_accounts to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Guard: cambiar el entorno de una cuenta con llave cifrada del otro entorno.
-- ---------------------------------------------------------------------------
create or replace function platform.enforce_provider_account_secret_env()
returns trigger
language plpgsql
set search_path = platform, pg_catalog
as $$
begin
  if new.secret_hint is not null
     and ((new.environment = 'TEST' and new.secret_hint not like 'sk\_test\_%')
       or (new.environment = 'LIVE' and new.secret_hint not like 'sk\_live\_%')) then
    raise exception 'LLAVE_NO_COINCIDE_CON_ENTORNO: la cuenta "%" tiene configurada una llave % y se quiere marcar como %. Quita o reemplaza la llave antes de cambiar el entorno',
      new.code, split_part(new.secret_hint, '_', 2), new.environment
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger ppa_secret_env_guard
  before insert or update of environment, secret_hint on platform.payment_provider_accounts
  for each row execute function platform.enforce_provider_account_secret_env();

-- Una cuenta borrada (solo posible desde el servidor) no deja su llave huérfana.
create or replace function platform.purge_provider_account_vault_secret()
returns trigger
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
begin
  if old.secret_vault_id is not null then
    delete from vault.secrets where id = old.secret_vault_id;
  end if;
  return old;
end;
$$;

create trigger ppa_purge_vault_secret
  after delete on platform.payment_provider_accounts
  for each row execute function platform.purge_provider_account_vault_secret();

-- ---------------------------------------------------------------------------
-- 4. set_payment_provider_secret — configura o reemplaza la llave cifrada.
--
-- La llave entra UNA vez por parámetro y se escribe directamente en Vault. No
-- se devuelve, no se audita (solo su pista) y ningún mensaje de error la cita.
-- ---------------------------------------------------------------------------
create or replace function platform.set_payment_provider_secret(
  p_account_id uuid,
  p_secret     text,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_acc      record;
  v_secret   text := btrim(coalesce(p_secret, ''));
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_kind     text;
  v_hint     text;
  v_name     text;
  v_vault    uuid;
  v_replaced boolean;
  v_now      timestamptz := now();
begin
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin configuran llaves de cobro'
      using errcode = '42501';
  end if;

  select a.id, a.code, a.provider_kind, a.environment, a.owner_organization_id, a.secret_vault_id
    into v_acc
    from platform.payment_provider_accounts a
   where a.id = p_account_id
   for update;
  if v_acc.id is null then
    raise exception 'CUENTA_NO_ENCONTRADA: %', p_account_id using errcode = '23503';
  end if;

  if v_acc.provider_kind <> 'CULQI' then
    raise exception 'PROVEEDOR_SIN_LLAVE: la cuenta "%" es de tipo % y no usa llave secreta de pasarela',
      v_acc.code, v_acc.provider_kind
      using errcode = '23514';
  end if;

  -- El mensaje NO incluye el valor recibido: describe la forma esperada.
  if v_secret !~ '^sk_(test|live)_[A-Za-z0-9]{10,}$' or length(v_secret) > 200 then
    raise exception 'LLAVE_SECRETA_INVALIDA: la llave secreta empieza por sk_test_ o sk_live_ seguida de al menos 10 letras o dígitos'
      using errcode = '22023';
  end if;

  v_kind := split_part(v_secret, '_', 2);
  if (v_kind = 'test') <> (v_acc.environment = 'TEST') then
    raise exception 'LLAVE_NO_COINCIDE_CON_ENTORNO: la cuenta "%" es % y la llave es de %',
      v_acc.code, v_acc.environment, case v_kind when 'test' then 'pruebas (sk_test_)' else 'producción (sk_live_)' end
      using errcode = '23514';
  end if;

  -- Un motivo con la llave pegada la dejaría en audit_logs en claro.
  if v_reason is not null
     and (v_reason ~* 'sk_(test|live)_' or position(v_secret in v_reason) > 0) then
    raise exception 'MOTIVO_CON_LLAVE: el motivo no puede contener la llave' using errcode = '22023';
  end if;

  v_hint := 'sk_' || v_kind || '_…' || right(v_secret, 4);
  v_name := 'payment_provider:' || v_acc.id::text;
  v_replaced := v_acc.secret_vault_id is not null;

  if v_replaced and exists (select 1 from vault.secrets s where s.id = v_acc.secret_vault_id) then
    perform vault.update_secret(
      v_acc.secret_vault_id, v_secret, v_name, 'Llave secreta de la cuenta de cobro ' || v_acc.code);
    v_vault := v_acc.secret_vault_id;
  else
    -- Un resto con el mismo nombre (p. ej. una cuenta restaurada) se descarta:
    -- el nombre es único en Vault y la cuenta solo apunta a una llave.
    delete from vault.secrets s where s.name = v_name;
    v_vault := vault.create_secret(
      v_secret, v_name, 'Llave secreta de la cuenta de cobro ' || v_acc.code);
  end if;

  update platform.payment_provider_accounts
     set secret_vault_id = v_vault, secret_hint = v_hint,
         secret_set_at = v_now, secret_set_by = auth.uid()
   where id = v_acc.id;

  perform platform.log_audit(
    case when v_replaced then 'PROVIDER_ACCOUNT_KEY_REPLACED' else 'PROVIDER_ACCOUNT_KEY_SET' end,
    'payment_provider_account', v_acc.id::text, v_acc.owner_organization_id, null,
    jsonb_build_object(
      'code', v_acc.code, 'environment', v_acc.environment,
      'key_hint', v_hint, 'credential_store', 'VAULT', 'reason', v_reason
    )
  );

  return jsonb_build_object('account_id', v_acc.id, 'hint', v_hint, 'set_at', v_now, 'replaced', v_replaced);
end;
$$;

comment on function platform.set_payment_provider_secret(uuid, text, text) is
  'Configura o reemplaza la llave secreta de una cuenta Culqi CIFRADA en Vault. Valida forma '
  'y entorno (sk_test_ ↔ TEST, sk_live_ ↔ LIVE). Audita solo la pista. EBIM_FINANCE o super admin.';

-- ---------------------------------------------------------------------------
-- 5. clear_payment_provider_secret — quita la llave cifrada.
--
-- Decisión: una cuenta Culqi LIVE ACTIVA no se queda sin llave. Si no declara
-- la alternativa por variable de entorno (`secret_key_ref`) se rechaza con
-- LIVE_SIN_LLAVE: se reemplaza la llave, o se desactiva la cuenta y luego se
-- quita. Una cuenta TEST sin llave vuelve al modo de prueba (MOCK).
-- ---------------------------------------------------------------------------
create or replace function platform.clear_payment_provider_secret(
  p_account_id uuid,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_acc    record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin configuran llaves de cobro'
      using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception 'MOTIVO_REQUERIDO: indica por qué se quita la llave' using errcode = '23502';
  end if;
  if v_reason ~* 'sk_(test|live)_' then
    raise exception 'MOTIVO_CON_LLAVE: el motivo no puede contener una llave' using errcode = '22023';
  end if;

  select a.id, a.code, a.provider_kind, a.environment, a.status, a.owner_organization_id,
         a.secret_vault_id, a.secret_hint, a.secret_key_ref
    into v_acc
    from platform.payment_provider_accounts a
   where a.id = p_account_id
   for update;
  if v_acc.id is null then
    raise exception 'CUENTA_NO_ENCONTRADA: %', p_account_id using errcode = '23503';
  end if;

  -- Idempotente: quitar lo que no está no es un error (doble clic, otra pestaña).
  if v_acc.secret_vault_id is null then
    return jsonb_build_object('account_id', v_acc.id, 'cleared', false);
  end if;

  if v_acc.environment = 'LIVE' and v_acc.provider_kind = 'CULQI' and v_acc.status = 'ACTIVE'
     and v_acc.secret_key_ref is null then
    raise exception 'LIVE_SIN_LLAVE: la cuenta "%" es LIVE y está activa: quedaría sin llave. Reemplaza la llave, o desactiva la cuenta antes de quitarla',
      v_acc.code
      using errcode = '23514';
  end if;

  delete from vault.secrets s where s.id = v_acc.secret_vault_id;

  update platform.payment_provider_accounts
     set secret_vault_id = null, secret_hint = null, secret_set_at = null, secret_set_by = null
   where id = v_acc.id;

  perform platform.log_audit(
    'PROVIDER_ACCOUNT_KEY_CLEARED', 'payment_provider_account', v_acc.id::text,
    v_acc.owner_organization_id, null,
    jsonb_build_object(
      'code', v_acc.code, 'environment', v_acc.environment,
      'key_hint', v_acc.secret_hint, 'credential_store', 'VAULT', 'reason', v_reason
    )
  );

  return jsonb_build_object('account_id', v_acc.id, 'cleared', true);
end;
$$;

comment on function platform.clear_payment_provider_secret(uuid, text) is
  'Borra de Vault la llave cifrada de la cuenta (motivo obligatorio, auditado). Una cuenta Culqi '
  'LIVE ACTIVA sin variable de entorno alternativa no puede quedarse sin llave (LIVE_SIN_LLAVE).';

-- ---------------------------------------------------------------------------
-- 6. set_payment_provider_api_base — URL base de la API (no secreta).
-- ---------------------------------------------------------------------------
create or replace function platform.set_payment_provider_api_base(
  p_account_id   uuid,
  p_api_base_url text
)
returns jsonb
language plpgsql
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_acc record;
  v_url text := nullif(rtrim(btrim(coalesce(p_api_base_url, '')), '/'), '');
begin
  if not (platform.can_read_finance() or platform.is_super_admin()) then
    raise exception 'NO_AUTORIZADO: solo EBIM_FINANCE o el super admin configuran cuentas de cobro'
      using errcode = '42501';
  end if;

  select a.id, a.code, a.owner_organization_id, a.api_base_url into v_acc
    from platform.payment_provider_accounts a where a.id = p_account_id for update;
  if v_acc.id is null then
    raise exception 'CUENTA_NO_ENCONTRADA: %', p_account_id using errcode = '23503';
  end if;

  if v_url is not null and (
       length(v_url) > 200
       or v_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?$'
       or v_url ~* '(sk|pk)_(test|live)_') then
    raise exception 'URL_API_INVALIDA: indica una URL https sin usuario, parámetros ni llaves (ej. https://api.culqi.com/v2)'
      using errcode = '22023';
  end if;

  if v_url is not distinct from v_acc.api_base_url then
    return jsonb_build_object('account_id', v_acc.id, 'api_base_url', v_url, 'changed', false);
  end if;

  update platform.payment_provider_accounts set api_base_url = v_url where id = v_acc.id;

  perform platform.log_audit(
    'PROVIDER_ACCOUNT_API_BASE_SET', 'payment_provider_account', v_acc.id::text,
    v_acc.owner_organization_id, null,
    jsonb_build_object('code', v_acc.code, 'api_base_url', v_url, 'previous_api_base_url', v_acc.api_base_url)
  );

  return jsonb_build_object('account_id', v_acc.id, 'api_base_url', v_url, 'changed', true);
end;
$$;

comment on function platform.set_payment_provider_api_base(uuid, text) is
  'Fija (o con NULL/vacío, retira) la URL base https de la API del proveedor de la cuenta. Auditado.';

-- ---------------------------------------------------------------------------
-- 7. payment_provider_account_secret — lectura en claro, SOLO servidor.
--
-- Doble barrera: EXECUTE solo para service_role (el navegador recibe 42501 de
-- PostgREST) y, por si un GRANT cambiara mañana, el guard de contexto de
-- servidor de la migración 22 más un rechazo explícito de los roles de API.
-- ---------------------------------------------------------------------------
create or replace function platform.payment_provider_account_secret(p_account_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = platform, pg_catalog
as $$
declare
  v_vault  uuid;
  v_secret text;
begin
  if not platform.is_service_context()
     or coalesce(current_setting('role', true), '') in ('anon', 'authenticated') then
    raise exception 'NO_AUTORIZADO_SERVER_ONLY: la llave secreta solo la lee el servidor'
      using errcode = '42501';
  end if;

  select a.secret_vault_id into v_vault
    from platform.payment_provider_accounts a where a.id = p_account_id;
  if v_vault is null then
    return null;
  end if;

  select d.decrypted_secret into v_secret from vault.decrypted_secrets d where d.id = v_vault;
  return v_secret;
end;
$$;

comment on function platform.payment_provider_account_secret(uuid) is
  'SERVER-ONLY. Devuelve en claro la llave secreta cifrada de la cuenta (NULL si no tiene). '
  'Solo service_role (Edge Functions de pago).';

-- ---------------------------------------------------------------------------
-- 8. Elegibilidad: «¿la cuenta LIVE tiene llave?» acepta Vault o entorno.
--
-- Se recrean desde su ÚLTIMA definición (regional 20260913000500, enlaces de
-- pago 20261010000100 y tarjeta guardada 20261010000300) cambiando solo esa
-- condición. Se pregunta por `secret_hint` y no por `secret_vault_id`:
-- `provider_account_candidates` es SECURITY INVOKER y `authenticated` no puede
-- leer el puntero; el CHECK `ppa_secret_vault_consistent_ck` garantiza que la
-- pista existe si y solo si existe la llave cifrada.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.provider_account_candidates(p_subscription_id uuid, p_collection_method platform.collection_method)
 RETURNS TABLE(provider_account_id uuid, account_code text, account_name text, provider_kind platform.provider_kind, environment platform.provider_environment, owner_organization_id uuid, market_code text, currencies text[], eligible boolean, reason text, route_rank integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'platform', 'pg_catalog'
AS $function$
  with sub as (
    select s.id, s.billed_organization_id, s.currency, s.market_id, o.country_code as billed_country
      from platform.subscriptions s
      join platform.organizations o on o.id = s.billed_organization_id
     where s.id = p_subscription_id
  ),
  evaluated as (
    select
      a.id, a.code, a.name, a.provider_kind, a.environment, a.owner_organization_id,
      m.code as market_code, a.routing_priority,
      (select array_agg(c.currency_code::text order by c.currency_code)
         from platform.payment_provider_account_currencies c
        where c.provider_account_id = a.id and c.status = 'ACTIVE') as currencies,
      case
        when a.status <> 'ACTIVE' then 'CUENTA_PROVEEDOR_INACTIVA'
        when not platform.provider_kind_supports_method(a.provider_kind, p_collection_method)
          then 'PROVEEDOR_INCOMPATIBLE'
        when a.owner_organization_id is not null and a.owner_organization_id <> sub.billed_organization_id
          then 'CUENTA_PROVEEDOR_AJENA'
        when sub.market_id is not null and a.market_id is distinct from sub.market_id
          then 'CUENTA_PROVEEDOR_OTRO_MERCADO'
        -- Contrato fuera del modelo regional (sin mercado): solo cuentas del país de quien paga.
        when sub.market_id is null and a.country_code <> sub.billed_country
          then 'CUENTA_PROVEEDOR_OTRO_MERCADO'
        when not exists (
          select 1 from platform.payment_provider_account_currencies c
           where c.provider_account_id = a.id and c.currency_code = sub.currency and c.status = 'ACTIVE'
        ) then 'MONEDA_NO_SOPORTADA_POR_CUENTA'
        -- Llave cifrada (pista) o variable de entorno: cualquiera de las dos.
        when a.environment = 'LIVE' and a.secret_key_ref is null and a.secret_hint is null
          then 'PROVEEDOR_LIVE_SIN_SECRETO'
        else null
      end as reason
    from sub
    cross join platform.payment_provider_accounts a
    left join platform.markets m on m.id = a.market_id
  )
  select
    e.id, e.code, e.name, e.provider_kind, e.environment, e.owner_organization_id, e.market_code,
    e.currencies,
    e.reason is null,
    e.reason,
    case when e.reason is null then
      (row_number() over (
         partition by (e.reason is null)
         order by (e.owner_organization_id is not null) desc, e.routing_priority, e.code
       ))::integer
    end
  from evaluated e
  order by (e.reason is null) desc, e.routing_priority, e.code;
$function$;

CREATE OR REPLACE FUNCTION platform.resolve_invoice_card_account(p_invoice_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'platform', 'pg_catalog'
AS $function$
declare
  v_invoice record;
  v_org     record;
  v_account uuid;
begin
  select i.id, i.subscription_id, i.currency, i.customer_organization_id into v_invoice
    from platform.invoices i where i.id = p_invoice_id;
  if v_invoice.id is null then
    return null;
  end if;

  if v_invoice.subscription_id is not null then
    select p.provider_account_id into v_account
      from platform.subscription_collection_profiles p
      join platform.payment_provider_accounts a on a.id = p.provider_account_id
     where p.subscription_id = v_invoice.subscription_id
       and p.effective_to is null
       and p.collection_method = 'CULQI_CARD'
       and a.status = 'ACTIVE' and a.provider_kind = 'CULQI'
       and exists (select 1 from platform.payment_provider_account_currencies c
                    where c.provider_account_id = a.id and c.currency_code = v_invoice.currency
                      and c.status = 'ACTIVE');
    if v_account is not null then
      return v_account;
    end if;

    select c.provider_account_id into v_account
      from platform.provider_account_candidates(v_invoice.subscription_id, 'CULQI_CARD') c
     where c.eligible
       and exists (select 1 from platform.payment_provider_account_currencies x
                    where x.provider_account_id = c.provider_account_id
                      and x.currency_code = v_invoice.currency and x.status = 'ACTIVE')
     order by c.route_rank
     limit 1;
    return v_account;
  end if;

  select o.id, o.country_code into v_org
    from platform.organizations o where o.id = v_invoice.customer_organization_id;

  select a.id into v_account
    from platform.payment_provider_accounts a
   where a.status = 'ACTIVE'
     and a.provider_kind = 'CULQI'
     and (a.owner_organization_id is null or a.owner_organization_id = v_org.id)
     and a.country_code = v_org.country_code
     and (a.environment = 'TEST' or a.secret_key_ref is not null or a.secret_vault_id is not null)
     and exists (select 1 from platform.payment_provider_account_currencies c
                  where c.provider_account_id = a.id and c.currency_code = v_invoice.currency
                    and c.status = 'ACTIVE')
   order by (a.owner_organization_id is not null) desc, a.routing_priority, a.code
   limit 1;

  return v_account;
end;
$function$;

CREATE OR REPLACE FUNCTION platform.resolve_org_card_account(p_organization_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'platform', 'pg_catalog'
AS $function$
declare
  v_account uuid;
  v_sub     record;
begin
  for v_sub in
    select s.id from platform.subscriptions s
     where s.billed_organization_id = p_organization_id and s.status in ('ACTIVE', 'PAST_DUE')
     order by s.code
  loop
    select c.provider_account_id into v_account
      from platform.provider_account_candidates(v_sub.id, 'CULQI_CARD') c
     where c.eligible
     order by c.route_rank
     limit 1;
    if v_account is not null then
      return v_account;
    end if;
  end loop;

  select a.id into v_account
    from platform.payment_provider_accounts a
    join platform.organizations o on o.id = p_organization_id
   where a.status = 'ACTIVE' and a.provider_kind = 'CULQI'
     and (a.owner_organization_id is null or a.owner_organization_id = o.id)
     and a.country_code = o.country_code
     and (a.environment = 'TEST' or a.secret_key_ref is not null or a.secret_vault_id is not null)
   order by (a.owner_organization_id is not null) desc, a.routing_priority, a.code
   limit 1;
  return v_account;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 9. GRANTS
-- ---------------------------------------------------------------------------
-- Funciones de trigger: nadie las invoca directamente.
revoke all on function platform.enforce_provider_account_secret_env() from public, anon, authenticated;
revoke all on function platform.purge_provider_account_vault_secret() from public, anon, authenticated;

-- Consola: `authenticated` (la RPC decide quién) y servicio.
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'platform.set_payment_provider_secret(uuid, text, text)',
    'platform.clear_payment_provider_secret(uuid, text)',
    'platform.set_payment_provider_api_base(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated, service_role', v_sig);
  end loop;
end;
$$;

-- Servidor: solo service_role.
revoke all on function platform.payment_provider_account_secret(uuid) from public, anon, authenticated;
grant execute on function platform.payment_provider_account_secret(uuid) to service_role;
