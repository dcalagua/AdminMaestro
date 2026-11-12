#!/usr/bin/env bash
# Prueba de concurrencia de issue_entitlement_snapshot (Task MA-32).
#
# pgTAP corre en UNA transacción y no puede demostrar el advisory lock entre dos
# sesiones. Este script abre sesiones psql reales contra el stack LOCAL:
#
#   1. A emite y retiene la transacción 3 s; B emite 0,5 s después.
#      Esperado: B espera a A (≥ 2 s), ve la versión de A y NO emite otra
#      (issued=false); queda una sola versión.
#   2. A emite y retiene 3 s; C hace un cambio comercial (override) mientras.
#      Esperado: C espera al commit de A y desired_dirty queda en true: el
#      cambio no se pierde. La siguiente emisión produce la versión 2.
#
# Deja datos en la base local (los snapshots son append-only): ejecutar sobre
# un `db reset` desechable. Uso: SUPABASE_DB_URL=... scripts/ccp/entitlement-snapshot-concurrency.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
scripts/ccp/guard-env.sh >/dev/null

DB="${SUPABASE_DB_URL}"
ALPHA=50000000-0000-4000-a000-000000000001
ESUP=20000000-0000-4000-a000-000000000001
SERVICE="select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false);"
q() { psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

q "insert into platform.product_capabilities (saas_product_id, code, name, kind, status)
   values ('$ESUP', 'esupplier.cc.reports', 'CC reportes', 'FEATURE', 'ACTIVE') on conflict do nothing;
   insert into platform.tenant_product_mappings
     (tenant_id, saas_product_id, deployment_target_id, external_tenant_id, status, provisioned_at, registered_manually)
   values ('$ALPHA', '$ESUP', '40000000-0000-4000-a000-00000000000a', 'ext-alpha-cc', 'ACTIVE', now(), true)
   on conflict (tenant_id, saas_product_id) do nothing;"
before=$(q "select count(*) from platform.entitlement_snapshots where tenant_id = '$ALPHA'")
[ "$before" = "0" ] || { echo "PRECONDICION: la base no está limpia (snapshots=$before); ejecutar tras db reset" >&2; exit 3; }

echo "== Escenario 1: dos emisiones concurrentes =="
psql "$DB" -X -q -At -v ON_ERROR_STOP=1 >"$TMPDIR/cc-a.txt" <<SQL &
begin;
$SERVICE
select 'A ' || (platform.issue_entitlement_snapshot('$ALPHA', '$ESUP') ->> 'issued');
select pg_sleep(3);
commit;
SQL
PID_A=$!
sleep 0.5
t0=$(date +%s)
psql "$DB" -X -q -At -v ON_ERROR_STOP=1 >"$TMPDIR/cc-b.txt" <<SQL
begin;
$SERVICE
select 'B ' || (platform.issue_entitlement_snapshot('$ALPHA', '$ESUP') ->> 'issued');
commit;
SQL
t1=$(date +%s)
wait $PID_A
grep -h '^[AB] ' "$TMPDIR/cc-a.txt" "$TMPDIR/cc-b.txt"
echo "B esperó $((t1 - t0)) s"
versions=$(q "select string_agg(snapshot_version::text, ',' order by snapshot_version) from platform.entitlement_snapshots where tenant_id = '$ALPHA'")
echo "versiones: $versions"
[ "$(grep -h '^A ' "$TMPDIR/cc-a.txt")" = "A true" ] || { echo "FAIL: A no emitió"; exit 1; }
[ "$(grep -h '^B ' "$TMPDIR/cc-b.txt")" = "B false" ] || { echo "FAIL: B emitió una versión duplicada"; exit 1; }
[ $((t1 - t0)) -ge 2 ] || { echo "FAIL: B no esperó el advisory lock"; exit 1; }
[ "$versions" = "1" ] || { echo "FAIL: versiones inesperadas"; exit 1; }

echo "== Escenario 2: cambio comercial durante una emisión =="
psql "$DB" -X -q -At -v ON_ERROR_STOP=1 >/dev/null <<SQL &
begin;
$SERVICE
select platform.issue_entitlement_snapshot('$ALPHA', '$ESUP');
select pg_sleep(3);
commit;
SQL
PID_A=$!
sleep 0.5
t0=$(date +%s)
q "insert into platform.tenant_entitlement_overrides
     (tenant_id, capability_id, override_type, grant_value, starts_at, expires_at, reason, approved_by)
   select '$ALPHA', id, 'GRANT', '{\"enabled\": true}', now() - interval '1 minute', now() + interval '1 day',
          'Prueba de concurrencia', '10000000-0000-4000-a000-000000000003'
     from platform.product_capabilities where code = 'esupplier.cc.reports';
   select platform.mark_entitlements_dirty('$ALPHA', '$ESUP', 'CC_OVERRIDE');"
t1=$(date +%s)
wait $PID_A
dirty=$(q "select desired_dirty from platform.entitlement_desired_state where tenant_id = '$ALPHA' and saas_product_id = '$ESUP'")
echo "C esperó $((t1 - t0)) s · desired_dirty=$dirty"
[ "$dirty" = "t" ] || { echo "FAIL: el cambio concurrente se perdió (dirty=false)"; exit 1; }
v2=$(psql "$DB" -X -q -At -v ON_ERROR_STOP=1 -c "$SERVICE" -c "select platform.issue_entitlement_snapshot('$ALPHA', '$ESUP') ->> 'version'" | tail -1)
echo "siguiente emisión: versión $v2"
[ "$v2" = "2" ] || { echo "FAIL: se esperaba la versión 2"; exit 1; }
echo "CONCURRENCY: PASS"
