-- ============================================================================
-- Credenciales de pasarela cifradas en Vault (migración 20261014000100)
-- ----------------------------------------------------------------------------
-- Spec §11. La llave secreta de Culqi se configura desde la consola y se guarda
-- cifrada en vault.secrets. Lo que este archivo fija:
--   · el navegador (authenticated) NUNCA lee la llave ni su puntero;
--   · solo EBIM_FINANCE / super admin la configuran, con forma y entorno válidos;
--   · reemplazar no crea otra fila en Vault; quitar la borra;
--   · la auditoría guarda la pista, nunca la llave;
--   · el servidor (service_role) es el único que la lee en claro;
--   · una cuenta LIVE es válida con llave cifrada y sin variable de entorno.
--
-- Las llaves de prueba se COMPONEN en tiempo de ejecución (`pg_temp.k`): un
-- literal completo con forma de llave dispararía `npm run secrets:scan`.
-- ============================================================================
begin;
select plan(52);

create or replace function pg_temp.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
end;
$$;
create or replace function pg_temp.act_as_service()
returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
end;
$$;
create or replace function pg_temp.act_as_postgres()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.finance() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000003'::uuid $$;
create or replace function pg_temp.product() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.partner() returns uuid language sql as $$ select '10000000-0000-4000-a000-000000000004'::uuid $$;
create or replace function pg_temp.acc() returns uuid language sql as
  $$ select id from platform.payment_provider_accounts where code = 'culqi-pe-test' $$;
create or replace function pg_temp.manual() returns uuid language sql as
  $$ select id from platform.payment_provider_accounts where code = 'ebim-manual' $$;
-- Llave compuesta: prefijo + entorno + cuerpo.
create or replace function pg_temp.k(p_env text, p_body text) returns text language sql as
  $$ select 's' || 'k_' || p_env || '_' || p_body $$;

create temp table qa (k text primary key, v jsonb);
grant all on qa to public;
create or replace function pg_temp.v(p_k text) returns jsonb language sql as $$ select v from qa where k = p_k $$;

-- Texto del error que lanza una sentencia (para comprobar que NO cita la llave).
create or replace function pg_temp.error_text(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- Estructura y privilegios
-- ---------------------------------------------------------------------------
select ok(
  (select count(*) = 5 from information_schema.columns
    where table_schema = 'platform' and table_name = 'payment_provider_accounts'
      and column_name in ('secret_vault_id', 'secret_hint', 'secret_set_at', 'secret_set_by', 'api_base_url')),
  '01 la cuenta gana secret_vault_id, secret_hint, secret_set_at, secret_set_by y api_base_url');

select ok(
  not has_column_privilege('authenticated', 'platform.payment_provider_accounts', 'secret_vault_id', 'SELECT')
  and not has_column_privilege('anon', 'platform.payment_provider_accounts', 'secret_vault_id', 'SELECT'),
  '02 secret_vault_id NO es seleccionable por authenticated ni anon (privilegio de columna)');

select ok(
  has_column_privilege('authenticated', 'platform.payment_provider_accounts', 'secret_hint', 'SELECT')
  and has_column_privilege('authenticated', 'platform.payment_provider_accounts', 'secret_set_at', 'SELECT')
  and has_column_privilege('authenticated', 'platform.payment_provider_accounts', 'api_base_url', 'SELECT')
  and has_column_privilege('authenticated', 'platform.payment_provider_accounts', 'public_key', 'SELECT'),
  '03 la pista, la fecha, la URL y la llave pública siguen legibles para la consola (RLS decide las filas)');

select ok(
  not has_function_privilege('authenticated', 'platform.payment_provider_account_secret(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'platform.payment_provider_account_secret(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'platform.payment_provider_account_secret(uuid)', 'EXECUTE'),
  '04 payment_provider_account_secret: EXECUTE solo para service_role');

select ok(
  has_function_privilege('authenticated', 'platform.set_payment_provider_secret(uuid, text, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'platform.clear_payment_provider_secret(uuid, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'platform.set_payment_provider_api_base(uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'platform.set_payment_provider_secret(uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'platform.clear_payment_provider_secret(uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'platform.set_payment_provider_api_base(uuid, text)', 'EXECUTE'),
  '05 las RPCs de consola: authenticated sí (decide la RPC), anon no');

select ok(
  (select prosecdef and proconfig is not null from pg_proc
    where oid = 'platform.set_payment_provider_secret(uuid, text, text)'::regprocedure)
  and (select prosecdef and proconfig is not null from pg_proc
    where oid = 'platform.payment_provider_account_secret(uuid)'::regprocedure),
  '06 las RPCs de llave son SECURITY DEFINER con search_path fijo');

select ok(
  exists (select 1 from pg_constraint where conname = 'ppa_no_real_keys_ck'
           and conrelid = 'platform.payment_provider_accounts'::regclass),
  '07 ppa_no_real_keys_ck sigue en pie: ninguna columna de texto guarda una llave');

-- ---------------------------------------------------------------------------
-- Autorización
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.product());
select throws_ok(
  format('select platform.set_payment_provider_secret(%L, %L, null)', pg_temp.acc(), pg_temp.k('test', 'Prod0000Admin1')),
  '42501', null,
  '08 un admin de producto (sin finanzas) no configura llaves');

select pg_temp.act_as(pg_temp.partner());
select throws_ok(
  format('select platform.set_payment_provider_secret(%L, %L, null)', pg_temp.acc(), pg_temp.k('test', 'Partner00Admin')),
  '42501', null,
  '09 un admin de partner no configura llaves');
select throws_ok(
  format('select platform.clear_payment_provider_secret(%L, %L)', pg_temp.acc(), 'motivo'),
  '42501', null,
  '10 ni las quita');
select throws_ok(
  format('select platform.set_payment_provider_api_base(%L, %L)', pg_temp.acc(), 'https://api.culqi.com/v2'),
  '42501', null,
  '11 ni cambia la URL de la API');

-- ---------------------------------------------------------------------------
-- Validación de forma y entorno
-- ---------------------------------------------------------------------------
select pg_temp.act_as(pg_temp.finance());

select throws_like(
  format('select platform.set_payment_provider_secret(%L, %L, null)', pg_temp.acc(), 'pk_test_' || 'Abcdefghij12'),
  'LLAVE_SECRETA_INVALIDA%',
  '12 una llave pública no se acepta como llave secreta');
select throws_like(
  format('select platform.set_payment_provider_secret(%L, %L, null)', pg_temp.acc(), pg_temp.k('test', 'corta')),
  'LLAVE_SECRETA_INVALIDA%',
  '13 una llave demasiado corta se rechaza');
select throws_like(
  format('select platform.set_payment_provider_secret(%L, %L, null)', pg_temp.acc(), pg_temp.k('test', 'con-guion-0123')),
  'LLAVE_SECRETA_INVALIDA%',
  '14 caracteres fuera de [A-Za-z0-9] se rechazan');
select throws_like(
  format('select platform.set_payment_provider_secret(%L, %L, null)', pg_temp.acc(), pg_temp.k('live', 'Live0123456789')),
  'LLAVE_NO_COINCIDE_CON_ENTORNO%',
  '15 una llave de producción en una cuenta TEST se rechaza');
select ok(
  position('Malformada9-x' in pg_temp.error_text(
    format('select platform.set_payment_provider_secret(%L, %L, null)', pg_temp.acc(), pg_temp.k('test', 'Malformada9-x')))) = 0
  and position('Live0123456789' in pg_temp.error_text(
    format('select platform.set_payment_provider_secret(%L, %L, null)', pg_temp.acc(), pg_temp.k('live', 'Live0123456789')))) = 0,
  '16 el mensaje de error nunca repite la llave recibida');
select throws_like(
  format('select platform.set_payment_provider_secret(%L, %L, %L)', pg_temp.acc(), pg_temp.k('test', 'Primera0000AAAA'),
         'pegué ' || pg_temp.k('test', 'Primera0000AAAA')),
  'MOTIVO_CON_LLAVE%',
  '17 un motivo con la llave pegada se rechaza (acabaría en la auditoría)');
select throws_like(
  format('select platform.set_payment_provider_secret(%L, %L, null)', pg_temp.manual(), pg_temp.k('test', 'Manual00000000')),
  'PROVEEDOR_SIN_LLAVE%',
  '18 una cuenta MANUAL no usa llave de pasarela');

-- ---------------------------------------------------------------------------
-- Configurar → reemplazar
-- ---------------------------------------------------------------------------
insert into qa values ('set1', platform.set_payment_provider_secret(pg_temp.acc(), pg_temp.k('test', 'Primera0000AAAA'), 'alta inicial'));
select is(pg_temp.v('set1') ->> 'hint', 'sk_test_…AAAA', '19 configurar devuelve solo la pista sk_test_…AAAA');
select is((pg_temp.v('set1') ->> 'replaced')::boolean, false, '20 primera vez: no es un reemplazo');
select ok(position('Primera0000AAAA' in pg_temp.v('set1')::text) = 0, '21 la respuesta no contiene la llave');

select is(
  (select secret_hint from platform.payment_provider_accounts where id = pg_temp.acc()),
  'sk_test_…AAAA', '22 finanzas lee la pista de la cuenta');
select ok(
  (select secret_set_at is not null from platform.payment_provider_accounts where id = pg_temp.acc()),
  '23 y la fecha de configuración');
select throws_ok(
  format('select secret_vault_id from platform.payment_provider_accounts where id = %L', pg_temp.acc()),
  '42501', null,
  '24 finanzas NO puede seleccionar secret_vault_id');
select throws_ok(
  'select * from platform.payment_provider_accounts',
  '42501', null,
  '25 un select * tampoco lo filtra: falla en vez de devolver el puntero');
select throws_ok(
  'select count(*) from vault.decrypted_secrets',
  '42501', null,
  '26 finanzas no tiene acceso a vault.decrypted_secrets');
select throws_ok(
  format('select platform.payment_provider_account_secret(%L)', pg_temp.acc()),
  '42501', null,
  '27 finanzas no puede invocar la lectura en claro');

-- Reemplazo: misma fila de Vault, nuevo valor.
insert into qa values ('set2', platform.set_payment_provider_secret(pg_temp.acc(), pg_temp.k('test', 'Segunda000BBBB'), null));
select is((pg_temp.v('set2') ->> 'replaced')::boolean, true, '28 segunda vez: reemplazo');

select pg_temp.act_as_postgres();
insert into qa select 'vault1', to_jsonb(secret_vault_id) from platform.payment_provider_accounts where id = pg_temp.acc();
select is(
  (select count(*)::int from vault.secrets where name = 'payment_provider:' || pg_temp.acc()::text),
  1, '29 reemplazar NO crea otra fila en Vault');
select is(
  (select secret_set_by from platform.payment_provider_accounts where id = pg_temp.acc()),
  pg_temp.finance(), '30 queda quién la configuró');
select ok(
  (select s.secret <> pg_temp.k('test', 'Segunda000BBBB') and position('Segunda000BBBB' in s.secret) = 0
     from vault.secrets s where s.id = (pg_temp.v('vault1') #>> '{}')::uuid),
  '31 en vault.secrets la llave está cifrada, no en claro');

-- ---------------------------------------------------------------------------
-- Servidor: lectura en claro
-- ---------------------------------------------------------------------------
select pg_temp.act_as_service();
select is(platform.payment_provider_account_secret(pg_temp.acc()), pg_temp.k('test', 'Segunda000BBBB'),
  '32 service_role lee la llave vigente en claro');
select is(platform.payment_provider_account_secret(pg_temp.manual()), null,
  '33 una cuenta sin llave cifrada devuelve NULL');
select pg_temp.act_as_postgres();

-- ---------------------------------------------------------------------------
-- Auditoría sin secreto
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(action order by id)::text[] from platform.audit_logs
    where entity_type = 'payment_provider_account' and entity_id = pg_temp.acc()::text
      and action like 'PROVIDER_ACCOUNT_KEY_%'),
  array['PROVIDER_ACCOUNT_KEY_SET', 'PROVIDER_ACCOUNT_KEY_REPLACED'],
  '34 configurar y reemplazar quedan auditados');
select ok(
  not exists (select 1 from platform.audit_logs
               where metadata::text like '%Primera0000AAAA%' or metadata::text like '%Segunda000BBBB%'),
  '35 ninguna fila de auditoría contiene la llave');
select is(
  (select metadata ->> 'key_hint' from platform.audit_logs
    where entity_id = pg_temp.acc()::text and action = 'PROVIDER_ACCOUNT_KEY_REPLACED'),
  'sk_test_…BBBB', '36 la auditoría guarda la pista');

-- ---------------------------------------------------------------------------
-- Integridad de la tabla
-- ---------------------------------------------------------------------------
select throws_ok(
  format('update platform.payment_provider_accounts set secret_hint = %L where id = %L',
         pg_temp.k('test', 'Completa00000000'), pg_temp.acc()),
  '23514', null,
  '37 secret_hint no admite una llave completa');
select throws_like(
  format('update platform.payment_provider_accounts set environment = ''LIVE'' where id = %L', pg_temp.acc()),
  'LLAVE_NO_COINCIDE_CON_ENTORNO%',
  '38 no se cambia a LIVE una cuenta con llave sk_test_ cifrada');
select throws_ok(
  format('update platform.payment_provider_accounts set secret_hint = null where id = %L', pg_temp.acc()),
  '23514', null,
  '39 puntero y pista van juntos');

-- El upsert de la ficha (que reescribe la fila) conserva la llave cifrada.
select pg_temp.act_as(pg_temp.finance());
select lives_ok(
  format($q$select platform.upsert_payment_provider_account(
      p_code => 'culqi-pe-test', p_name => 'Culqi Perú (TEST)', p_provider_kind => 'CULQI',
      p_environment => 'TEST', p_market_code => 'PE', p_currencies => array['PEN']::char(3)[],
      p_id => %L)$q$, pg_temp.acc()),
  '40 editar la ficha de la cuenta funciona con llave cifrada');
select is(
  (select secret_hint from platform.payment_provider_accounts where id = pg_temp.acc()),
  'sk_test_…BBBB', '41 y no toca la llave');

-- ---------------------------------------------------------------------------
-- URL de la API
-- ---------------------------------------------------------------------------
select throws_like(
  format('select platform.set_payment_provider_api_base(%L, %L)', pg_temp.acc(), 'http://api.culqi.com/v2'),
  'URL_API_INVALIDA%', '42 la URL de la API exige https');
select throws_like(
  format('select platform.set_payment_provider_api_base(%L, %L)', pg_temp.acc(), 'https://user:pw@api.culqi.com/v2'),
  'URL_API_INVALIDA%', '43 sin credenciales en la URL');
select is(
  platform.set_payment_provider_api_base(pg_temp.acc(), ' https://api.culqi.com/v2/ ') ->> 'api_base_url',
  'https://api.culqi.com/v2', '44 se guarda normalizada (sin espacios ni barra final)');
select is(
  platform.set_payment_provider_api_base(pg_temp.acc(), '') ->> 'api_base_url',
  null, '45 vacía la retira (vuelve a CULQI_API_BASE del servidor)');

-- ---------------------------------------------------------------------------
-- Cuenta LIVE con llave cifrada
-- ---------------------------------------------------------------------------
insert into qa values ('live', to_jsonb(platform.upsert_payment_provider_account(
  p_code => 'culqi-pe-live-qa', p_name => 'Culqi Perú LIVE (QA)', p_provider_kind => 'CULQI',
  p_environment => 'LIVE', p_market_code => 'PE', p_currencies => array['PEN', 'USD']::char(3)[],
  p_secret_key_ref => 'CULQI_LIVE_SECRET_KEY')));
create or replace function pg_temp.live() returns uuid language sql as $$ select (pg_temp.v('live') #>> '{}')::uuid $$;

select lives_ok(
  format('select platform.set_payment_provider_secret(%L, %L, %L)', pg_temp.live(), pg_temp.k('live', 'Produccion0LLLL'), 'alta LIVE'),
  '46 una cuenta LIVE acepta una llave sk_live_');

select pg_temp.act_as_postgres();
select lives_ok(
  format('update platform.payment_provider_accounts set secret_key_ref = null where id = %L', pg_temp.live()),
  '47 ppa_live_needs_secret_ref_ck: una cuenta LIVE es válida con la llave cifrada y sin variable de entorno');
select is(
  (select c.reason from platform.subscriptions s
     cross join lateral platform.provider_account_candidates(s.id, 'CULQI_CARD') c
    where s.code = 'SUB-ALPHA-ESUP' and c.provider_account_id = pg_temp.live()),
  null, '48 y el routing no la descarta por PROVEEDOR_LIVE_SIN_SECRETO');

select pg_temp.act_as(pg_temp.finance());
select throws_like(
  format('select platform.clear_payment_provider_secret(%L, %L)', pg_temp.live(), 'rotación'),
  'LIVE_SIN_LLAVE%',
  '49 una cuenta LIVE sin variable de entorno no se queda sin llave');

-- ---------------------------------------------------------------------------
-- Quitar
-- ---------------------------------------------------------------------------
select throws_like(
  format('select platform.clear_payment_provider_secret(%L, %L)', pg_temp.acc(), '  '),
  'MOTIVO_REQUERIDO%', '50 quitar exige motivo');

insert into qa values ('clear1', platform.clear_payment_provider_secret(pg_temp.acc(), 'rotación de llaves'));
insert into qa values ('clear2', platform.clear_payment_provider_secret(pg_temp.acc(), 'otra vez'));

select pg_temp.act_as_postgres();
select ok(
  (pg_temp.v('clear1') ->> 'cleared')::boolean
  and not (pg_temp.v('clear2') ->> 'cleared')::boolean
  and not exists (select 1 from vault.secrets where id = (pg_temp.v('vault1') #>> '{}')::uuid)
  and (select secret_vault_id is null and secret_hint is null and secret_set_at is null
         from platform.payment_provider_accounts where id = pg_temp.acc())
  and exists (select 1 from platform.audit_logs where entity_id = pg_temp.acc()::text
                and action = 'PROVIDER_ACCOUNT_KEY_CLEARED' and metadata ->> 'reason' = 'rotación de llaves'),
  '51 quitar borra la fila de Vault, limpia la cuenta, es idempotente y queda auditado');

select pg_temp.act_as_service();
select is(platform.payment_provider_account_secret(pg_temp.acc()), null,
  '52 tras quitarla, el servidor ya no obtiene llave (la cuenta TEST vuelve a MOCK)');

select * from finish();
rollback;
