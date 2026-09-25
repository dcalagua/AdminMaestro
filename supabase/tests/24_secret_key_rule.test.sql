-- ============================================================================
-- El guardia de secretos: qué clave es una credencial y qué clave sólo lo parece
-- ----------------------------------------------------------------------------
-- La pregunta que responde este archivo es una sola: ¿sigue atrapando lo que
-- debe atrapar, ahora que `pat` dejó de ser una subcadena?
--
-- El caso que lo motivó es real: el alta de eChange en QAS murió con
-- MAPPING_WRITE_FAILED porque el producto devolvió `resources.portalPath`. El
-- tenant quedó creado del lado del SaaS y sin mapeo de este lado. Un guardia
-- que aborta altas correctas no protege: estorba.
-- ============================================================================
begin;
select plan(12);

create or replace function pg_temp.rejects(p_key text)
returns boolean language plpgsql as $$
declare
  v_id uuid;
begin
  -- Se prueba sobre `deployment_targets`, que lleva el mismo trigger genérico.
  begin
    insert into platform.deployment_targets (code, name, provider, deployment_mode, metadata)
    values ('secret-rule-probe', 'Sonda del guardia', 'SUPABASE', 'SHARED',
            jsonb_build_object(p_key, 'x'))
    returning id into v_id;
    delete from platform.deployment_targets where id = v_id;
    return false;
  exception when insufficient_privilege then
    return true;
  end;
end;
$$;

-- ── Lo que SÍ es una credencial ─────────────────────────────────────────────
select ok(pg_temp.rejects('password'),        'password se rechaza');
select ok(pg_temp.rejects('db_passwd'),       'passwd se rechaza dentro de la clave');
select ok(pg_temp.rejects('client_secret'),   'secret se rechaza');
select ok(pg_temp.rejects('accessToken'),     'token se rechaza dentro de la clave');
select ok(pg_temp.rejects('apiKey'),          'apikey se rechaza');
select ok(pg_temp.rejects('service_role'),    'service_role se rechaza');

-- ── `pat` como PALABRA, no como subcadena ───────────────────────────────────
select ok(pg_temp.rejects('pat'),             'pat a secas se rechaza: es el token personal');
select ok(pg_temp.rejects('m2m_pat'),         'pat separado por guion bajo se rechaza');
select ok(pg_temp.rejects('pat-github'),      'pat separado por guion se rechaza');

-- ── Lo que sólo lo parecía ──────────────────────────────────────────────────
-- Estas tres son las que rompían el alta. Si alguna vuelve a rechazarse, el
-- provisioning de eChange y eCommerce deja de poder completarse.
select ok(not pg_temp.rejects('portalPath'),     'portalPath se admite: eChange lo devuelve en resources');
select ok(not pg_temp.rejects('backofficePath'), 'backofficePath se admite: eCommerce lo devuelve');
select ok(not pg_temp.rejects('compatible'),     'compatible se admite');

select * from finish();
rollback;
