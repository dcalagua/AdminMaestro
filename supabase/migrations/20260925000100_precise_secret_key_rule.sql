-- ============================================================================
-- El guardia de secretos deja de confundir "path" con "PAT"
-- ----------------------------------------------------------------------------
-- `reject_secret_like_json()` compara cada clave contra una lista de palabras
-- con `like '%' || f || '%'`. Para casi todas está bien: `password`, `token` o
-- `api_key` dentro de una clave ya son señal suficiente.
--
-- Con `pat` no. La palabra que se quería atrapar es PAT, el token personal de
-- acceso; pero como subcadena atrapa también `path`, `patient`, `compatible` o
-- `despatch`. Y eso NO es teoría: el alta de eChange en QAS (2026-09-25) murió
-- con `MAPPING_WRITE_FAILED` porque el producto devolvió `resources.portalPath`,
-- y eCommerce habría muerto igual por `backofficePath`. Un falso positivo aquí
-- no avisa: aborta una transacción de alta que por lo demás fue correcta, y el
-- tenant queda creado del lado del SaaS sin mapeo de este lado.
--
-- El arreglo es acotado: `pat` pasa a exigir que sea la clave ENTERA o que vaya
-- rodeada de separadores (`m2m_pat`, `pat-github`, `patToken`). El resto de la
-- lista no cambia, y ninguna clave que antes se rechazaba por otra palabra
-- empieza a pasar ahora.
--
-- Aditiva: sólo se reemplaza el cuerpo de la función. Ni tablas, ni triggers,
-- ni datos.
-- ============================================================================

create or replace function platform.reject_secret_like_json()
returns trigger
language plpgsql
set search_path = platform, pg_catalog
as $$
declare
  v_col text := tg_argv[0];
  v_doc jsonb := to_jsonb(new) -> v_col;
  v_key text;
  -- Palabras que delatan una credencial estén donde estén dentro de la clave.
  v_forbidden constant text[] := array[
    'password', 'passwd', 'secret', 'service_role', 'service_key', 'api_key',
    'apikey', 'token', 'private_key', 'connection_string', 'dsn', 'jwt_secret'
  ];
  -- `pat` aparte: palabra suelta, no subcadena. `portalPath` no es un secreto.
  v_pat_word constant text := '(^|[^a-z0-9])pat([^a-z0-9]|$)';
begin
  if v_doc is null or jsonb_typeof(v_doc) <> 'object' then
    return new;
  end if;

  for v_key in select jsonb_object_keys(v_doc) loop
    if exists (select 1 from unnest(v_forbidden) f where lower(v_key) like '%' || f || '%')
       or lower(v_key) ~ v_pat_word then
      raise exception 'METADATA_CON_SECRETO: la clave "%" de %.% parece una credencial. Los secretos van en secrets del servidor, nunca en tablas de aplicación (prompt fase 8)',
        v_key, tg_table_name, v_col
        using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$$;

comment on function platform.reject_secret_like_json() is
  'Trigger genérico: rechaza claves con pinta de credencial en una columna JSONB. '
  'Se pasa el nombre de la columna como argumento del trigger. `pat` se exige '
  'como palabra suelta: "portalPath" no es un secreto, "m2m_pat" sí.';
