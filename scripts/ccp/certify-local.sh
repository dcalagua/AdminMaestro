#!/usr/bin/env bash
# ============================================================================
# EBIM Commercial Control Plane · Fase 18 · certificación LOCAL 8/8 (MA-62)
# ----------------------------------------------------------------------------
# Spec §19 (SYNCHRONIZED), plan §13 MA-62. Ejecuta, en UNA corrida, las piezas
# que evidencian los 15 checks del prompt 18 para los 8 productos y escribe un
# JSON por producto (scripts/ccp/checks/summarize.mjs):
#
#   MasterAdmin  · pgTAP completo (registro, compute, snapshot, sync, uso,
#                  créditos, facturación 33–41)
#                · entitlement-sync-e2e (sync_state por GET, drift, replay)
#                · usage-x07-e2e (emisor real de cada SaaS → ingest real)
#   Por producto · X-07 MasterAdmin REAL → receptor REAL del SaaS
#                · suites de base de datos del SaaS que necesitan Docker
#
# SOLO LOCAL. Aborta (guard-env) si el destino no es el stack local. Necesita
# Docker y puertos locales: se ejecuta FUERA del sandbox de Claude. No imprime
# claves: la service_role LOCAL se lee de `supabase status -o env` a una
# variable y nunca se escribe en logs. Nada contra QAS/PRD; sin push.
#
# Uso:
#   scripts/ccp/certify-local.sh [--out DIR] [--only "ecommerce comerza …"] [--with-java-suites]
#                                [--record <producto> <paso> <log>]…
#   --with-java-suites: además corre `mvnw clean verify` de EWM y `mvnw clean test` de TMS
#   (lentas: 30–60 min); sin el flag, sus checks de suite quedan NOT_RUN.
#   --record: incorpora a esta corrida una suite ya ejecutada aparte (p. ej. las Java en
#   paralelo); copia el log y toma el rc de su última línea `EXIT=<n>`. TMS con
#   TMS_TEST_DB_URL (PostGIS 17 desechable) evita el timeout de Testcontainers (fase 12).
# Variables opcionales: JAVA_HOME (JDK 21; por defecto temurin-21),
#   COMERZA_DB_CONTAINER (comerza_ccp_db), ECHANGE_DB_CONTAINER
#   (supabase_db_echange-ccp14), EEXPENSE_DB_CONTAINER (supabase_db_eexpense-ccp),
#   ECHANGE_WORKDIR / EEXPENSE_WORKDIR (workdirs desechables de esos stacks).
# Parte de bases VACÍAS: `supabase db reset --local` de MasterAdmin y de los stacks
# desechables de eChange/eExpense (sus X-07 y pgTAP cuentan filas y el outbox es
# append-only: una corrida anterior deja residuo). Se niega si las migraciones del
# workdir difieren de las del worktree del programa.
# Sale 0 si todos los pasos ejecutados salen 0; el veredicto SYNCHRONIZED lo
# decide summarize.mjs contra spec §19.1 (incluye criterios que no son tests).
# ============================================================================
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EBIM="$(cd "$ROOT/../../.." && pwd)"
WTN=".worktrees/ebim-commercial-control-plane-v1"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$ROOT/docs/superpowers/evidence/commercial-control-plane/certification/$STAMP"
ONLY="ecommerce ewm comerza tms esupplier echange eexpense gmao"
JAVA_SUITES=0
RECORDS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --with-java-suites) JAVA_SUITES=1; shift ;;
    --record) RECORDS+=("$2|$3|$4"); shift 4 ;;
    *) echo "argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

export JAVA_HOME="${JAVA_HOME:-/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home}"
COMERZA_DB_CONTAINER="${COMERZA_DB_CONTAINER:-comerza_ccp_db}"
ECHANGE_DB_CONTAINER="${ECHANGE_DB_CONTAINER:-supabase_db_echange-ccp14}"
EEXPENSE_DB_CONTAINER="${EEXPENSE_DB_CONTAINER:-supabase_db_eexpense-ccp}"
ECHANGE_WORKDIR="${ECHANGE_WORKDIR:-/tmp/claude-501/echange-ccp14}"
EEXPENSE_WORKDIR="${EEXPENSE_WORKDIR:-/tmp/claude-501/eexpense-ccp}"

wt() { case "$1" in
  ewm) echo "$EBIM/IACLAUDE/WMS-by-EBIM/$WTN" ;;
  ecommerce) echo "$EBIM/eCommerce/$WTN" ;;
  comerza) echo "$EBIM/comerza/$WTN" ;;
  tms) echo "$EBIM/TMS/$WTN" ;;
  esupplier) echo "$EBIM/eSupplier/$WTN" ;;
  echange) echo "$EBIM/eChange/$WTN" ;;
  eexpense) echo "$EBIM/eExpenses/$WTN" ;;
  gmao) echo "$EBIM/GMAO/$WTN" ;;
  masteradmin) echo "$ROOT" ;;
esac; }

mkdir -p "$OUT/logs"
STEPS="$OUT/steps.tsv"
[ -f "$STEPS" ] || printf 'product\tstep\trc\tstarted_at\tended_at\tlog\n' > "$STEPS"

# run <product> <step> <cwd> -- <comando…>   (env adicional vía `env K=V …`)
run() {
  local product="$1" step="$2" cwd="$3"; shift 4
  local log="$OUT/logs/$product-$step.txt" started rc
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "▸ $product · $step"
  ( cd "$cwd" && "$@" ) > "$log" 2>&1
  rc=$?
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$product" "$step" "$rc" "$started" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "logs/$product-$step.txt" >> "$STEPS"
  [ $rc -eq 0 ] && echo "  ok" || echo "  FALLO (rc=$rc) → logs/$product-$step.txt"
  return 0
}
wants() { case " $ONLY " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

# ---- 0 · guarda de entorno y stack local de MasterAdmin -----------------------
cd "$ROOT" || exit 2
LOCAL_ENV="$(supabase status -o env 2>/dev/null)" || { echo "HARD STOP: el stack local de MasterAdmin no está arriba" >&2; exit 2; }
SUPABASE_URL="$(printf '%s\n' "$LOCAL_ENV" | sed -n 's/^API_URL="\(.*\)"$/\1/p')"
SUPABASE_DB_URL="$(printf '%s\n' "$LOCAL_ENV" | sed -n 's/^DB_URL="\(.*\)"$/\1/p')"
SUPABASE_SERVICE_ROLE_KEY="$(printf '%s\n' "$LOCAL_ENV" | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p')"
unset LOCAL_ENV
VITE_SUPABASE_URL="$SUPABASE_URL" SUPABASE_DB_URL="$SUPABASE_DB_URL" "$ROOT/scripts/ccp/guard-env.sh" || exit 2
export SUPABASE_URL SUPABASE_DB_URL SUPABASE_SERVICE_ROLE_KEY

{
  echo "stamp=$STAMP"
  for p in masteradmin $ONLY; do echo "head.$p=$(git -C "$(wt "$p")" rev-parse HEAD 2>/dev/null) dirty=$(git -C "$(wt "$p")" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"; done
} > "$OUT/heads.txt"

X07="node --experimental-transform-types"

# ---- 0b · bases vacías (solo stacks LOCALES) --------------------------------------
# reset_workdir <producto> <workdir>: el workdir desechable debe tener las migraciones del worktree.
reset_workdir() {
  if ! diff -rq "$(wt "$1")/supabase/migrations" "$2/supabase/migrations" >/dev/null 2>&1; then
    echo "HARD STOP: migraciones de $2 difieren de $(wt "$1")" >&2
    printf '%s\tdb-reset\t2\t-\t-\t-\n' "$1" >> "$STEPS"
    return 0
  fi
  run "$1" db-reset "$2" -- supabase db reset --local --workdir "$2"
}
run masteradmin db-reset "$ROOT" -- supabase db reset --local
wants echange && reset_workdir echange "$ECHANGE_WORKDIR"
wants eexpense && reset_workdir eexpense "$EEXPENSE_WORKDIR"

# ---- 1 · MasterAdmin --------------------------------------------------------
run masteradmin pgtap "$ROOT" -- supabase test db
# INV-1: contrato CREATE/REPLAY/GET de provisioning (golden de adaptadores, sin editar).
run masteradmin provisioning-golden "$ROOT" -- npx vitest run supabase/functions/_shared/provisioning
run masteradmin entitlement-sync-e2e "$ROOT" -- $X07 scripts/ccp/entitlement-sync-e2e.mts
run masteradmin usage-x07 "$ROOT" -- npx tsx scripts/ccp/usage-x07-e2e.mts

# ---- 2 · productos ----------------------------------------------------------
if wants ecommerce; then
  run ecommerce test-db "$(wt ecommerce)" -- npm run -s test:db
  run ecommerce x07 "$ROOT" -- env ECOMMERCE_WT="$(wt ecommerce)" $X07 scripts/ccp/ecommerce-pilot-e2e.mts
fi
if wants ewm; then
  run ewm x07 "$ROOT" -- env EWM_WT="$(wt ewm)" $X07 scripts/ccp/ewm-x07-e2e.mts
  [ "$JAVA_SUITES" = 1 ] && run ewm suite "$(wt ewm)/backend/wms-api" -- ./mvnw -B clean verify
fi
if wants comerza; then
  run comerza test-db "$(wt comerza)" -- env COMERZA_DB_CONTAINER="$COMERZA_DB_CONTAINER" npm run -s test:db
  run comerza rebuild-scratch "$(wt comerza)" -- env COMERZA_DB_CONTAINER="$COMERZA_DB_CONTAINER" \
    COMERZA_SCRATCH_DB=ccp_cert_comerza bash scripts/db-rebuild-check.sh --with-seed --keep
  run comerza x07 "$ROOT" -- env COMERZA_WT="$(wt comerza)" COMERZA_DB_CONTAINER="$COMERZA_DB_CONTAINER" \
    COMERZA_SCRATCH_DB=ccp_cert_comerza $X07 scripts/ccp/comerza-x07-e2e.mts
  docker exec "$COMERZA_DB_CONTAINER" psql -U postgres -q -c 'drop database if exists ccp_cert_comerza with (force)' >/dev/null 2>&1 || true
fi
if wants tms; then
  run tms x07 "$ROOT" -- env TMS_WT="$(wt tms)" $X07 scripts/ccp/tms-x07-e2e.mts
  [ "$JAVA_SUITES" = 1 ] && run tms suite "$(wt tms)/backend/tms-api" -- ./mvnw -B clean test
fi
if wants esupplier; then
  run esupplier sql-and-golden "$(wt esupplier)" -- env CCP_KEEP_CONTAINER=1 bash supabase/tests/ccp/run_ccp_sql_tests.sh
  run esupplier x07 "$ROOT" -- env ESUPPLIER_WT="$(wt esupplier)" ESUPPLIER_DB_CONTAINER=esupplier-ccp-pg \
    $X07 scripts/ccp/esupplier-x07-e2e.mts
  docker rm -f esupplier-ccp-pg >/dev/null 2>&1 || true
fi
if wants echange; then
  ECHANGE_DB_PORT="$(docker port "$ECHANGE_DB_CONTAINER" 5432/tcp 2>/dev/null | head -1 | sed 's/.*://')"
  run echange pgtap "$(wt echange)" -- "$ROOT/scripts/ccp/checks/pgtap-with-baseline.sh" \
    "$ROOT/scripts/ccp/checks/baselines/echange-pgtap.txt" -- \
    env DB_URL="postgresql://postgres:postgres@127.0.0.1:${ECHANGE_DB_PORT}/postgres" \
    bash docs/superpowers/evidence/commercial-control-plane/harness-docker/run-sql-tests.sh
  run echange golden-parity "$(wt echange)/web" -- env ECHANGE_CCP_DB_CONTAINER="$ECHANGE_DB_CONTAINER" \
    npx vitest run src/edge/platformEntitlementsGolden.test.ts src/edge/platformEntitlementsParidad.test.ts
  run echange x07 "$ROOT" -- env ECHANGE_WT="$(wt echange)" ECHANGE_DB_CONTAINER="$ECHANGE_DB_CONTAINER" \
    $X07 scripts/ccp/echange-x07-e2e.mts
fi
if wants eexpense; then
  EEXPENSE_DB_PORT="$(docker port "$EEXPENSE_DB_CONTAINER" 5432/tcp 2>/dev/null | head -1 | sed 's/.*://')"
  run eexpense pgtap "$(wt eexpense)" -- env DB_URL="postgresql://postgres:postgres@127.0.0.1:${EEXPENSE_DB_PORT}/postgres" \
    bash docs/superpowers/evidence/commercial-control-plane/harness/run-sql-tests.sh
  run eexpense golden "$(wt eexpense)/web" -- env EEXPENSE_CCP_DB_CONTAINER="$EEXPENSE_DB_CONTAINER" \
    npx vitest run src/edge/platformEntitlementsGolden.test.ts
  run eexpense x07 "$ROOT" -- env EEXPENSE_WT="$(wt eexpense)" EEXPENSE_DB_CONTAINER="$EEXPENSE_DB_CONTAINER" \
    $X07 scripts/ccp/eexpense-x07-e2e.mts
fi
if wants gmao; then
  # GMAO no puede `db reset` (esquema base no versionado): PGlite sobre el esquema capturado es su harness.
  run gmao sql "$(wt gmao)/supabase/tests" -- sh -c 'node run_tests.mjs && node run_provisioning_tests.mjs && node run_ccp_tests.mjs && node run_ccp16_tests.mjs && node run_ccp17_tests.mjs'
  run gmao deno "$(wt gmao)/supabase/functions" -- deno test -A
  run gmao x07 "$ROOT" -- env GMAO_WT="$(wt gmao)" $X07 scripts/ccp/gmao-x07-e2e.mts
fi

unset SUPABASE_SERVICE_ROLE_KEY

# ---- 2b · suites ejecutadas aparte (--record) ----------------------------------
for r in "${RECORDS[@]+"${RECORDS[@]}"}"; do
  IFS='|' read -r product step src <<< "$r"
  cp "$src" "$OUT/logs/$product-$step.txt"
  rc="$(sed -n 's/^EXIT=\([0-9]*\).*/\1/p' "$src" | tail -1)"
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$product" "$step" "${rc:-1}" "$ts" "$ts" "logs/$product-$step.txt" >> "$STEPS"
  echo "▸ $product · $step (registrado de $src) rc=${rc:-sin EXIT}"
done

# ---- 3 · veredicto por producto ------------------------------------------------
node "$ROOT/scripts/ccp/checks/summarize.mjs" "$OUT"
awk -F'\t' 'NR > 1 && $3 != 0 { bad = 1 } END { exit bad }' "$STEPS"
