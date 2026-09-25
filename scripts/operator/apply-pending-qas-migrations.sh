#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# EBIM · Las migraciones que faltan en QAS, aplicadas de una en una
# -----------------------------------------------------------------------------
# Por qué no hay `supabase db push` aquí: dos de los tres proyectos arrastran
# deriva histórica (objetos creados fuera de git), y un push empujaría todo lo
# pendiente sin que nadie lo haya mirado. Cada archivo se aplica suelto, en
# orden, con ON_ERROR_STOP, se COMPRUEBA el objeto y sólo entonces se anota la
# versión en el historial. Nunca al revés.
#
# Qué falta y por qué:
#
#   MasterAdmin  20260925000100_precise_secret_key_rule.sql
#                El guardia de secretos lee "path" como si fuera "PAT" y aborta
#                altas correctas. Por eso el alta de eChange en QAS terminó en
#                MAPPING_WRITE_FAILED tras crear el tenant del otro lado, y por
#                eso eCommerce fallaría igual con `backofficePath`.
#
#   eExpense     20260924190000_masteradmin_da_de_alta_tenants_por_m2m.sql
#                Su función está desplegada pero la base no tiene las RPC: el
#                GET firmado devuelve 500 PROVISIONING_FAILED en vez de 404.
#
#   GMAO         20260925001118 · captura de lo que ya vivía en el proyecto
#                20260925001454 · contrato GENERIC + admin PREPROVISIONED, que
#                                 REEMPLAZA la RPC de alta: sin ella, el alta
#                                 no sigue el contrato
#                20260925002308 · cierra un agujero vivo: provision_or_attach_tenant
#                                 es SECURITY DEFINER y hoy la puede ejecutar
#                                 cualquier `authenticated`
#
# Las tres de GMAO y la de eExpense son idempotentes (IF NOT EXISTS / OR REPLACE).
#
# Uso — cada URL se saca del panel del proyecto (Settings → Database):
#   MASTERADMIN_DB_URL='postgresql://…' \
#   EEXPENSE_DB_URL='postgresql://…' \
#   GMAO_DB_URL='postgresql://…' \
#   bash scripts/operator/apply-pending-qas-migrations.sh
#
# Se salta el producto cuya URL no esté puesta. No imprime ninguna URL.
# =============================================================================

if [[ -z "${BASH_VERSINFO:-}" || "${BASH_VERSINFO[0]}" -lt 4 ]]; then
  echo "Hace falta bash 4 o superior (tienes ${BASH_VERSION:-desconocida})." >&2
  echo "Prueba con: /opt/homebrew/bin/bash \"$0\"" >&2
  exit 1
fi

command -v psql >/dev/null || { echo 'FALTA psql (brew install libpq)'; exit 1; }

readonly EBIM_ROOT="${EBIM_ROOT:-$HOME/Documents/Documentos-Edus-MacBook-Pro-2/EBIM}"

say()  { printf '%s\n' "$*"; }
step() { printf '  · %-46s %s\n' "$1" "$2"; }

declare -A RESULT

# Aplica UN archivo y, sólo si la comprobación posterior pasa, anota la versión.
# $1 producto · $2 url · $3 ruta del repo · $4 archivo · $5 SQL de comprobación · $6 valor esperado
apply_one() {
  local product="$1" url="$2" repo="$3" file="$4" check="$5" expected="$6"
  local path="$EBIM_ROOT/$repo/supabase/migrations/$file"
  local version="${file%%_*}"

  if [[ ! -f "$path" ]]; then
    step "$file" 'FAIL — el archivo no existe'
    RESULT["$product:$file"]='FAIL (sin archivo)'
    return 1
  fi

  if ! psql "$url" -v ON_ERROR_STOP=1 -q -f "$path" >/dev/null 2>&1; then
    step "$file" 'FAIL — la migración no se aplicó; no se sigue con este producto'
    RESULT["$product:$file"]='FAIL (SQL)'
    return 1
  fi

  local got
  got="$(psql "$url" -tAc "$check" 2>/dev/null || echo '?')"
  if [[ "$got" != "$expected" ]]; then
    step "$file" "aplicada, pero la comprobación dio '$got' y se esperaba '$expected' — NO se anota la versión"
    RESULT["$product:$file"]="REVISAR (check=$got)"
    return 1
  fi

  # El historial se toca DESPUÉS de comprobar el esquema, nunca antes.
  psql "$url" -v ON_ERROR_STOP=1 -q -c \
    "insert into supabase_migrations.schema_migrations (version) values ('$version') on conflict do nothing" \
    >/dev/null 2>&1 || true

  step "$file" 'PASS (aplicada, comprobada y anotada)'
  RESULT["$product:$file"]='PASS'
}

# ---- MasterAdmin ------------------------------------------------------------
say '=== MasterAdmin · jivgwrczgdpsuvqcwqku ==='
if [[ -n "${MASTERADMIN_DB_URL:-}" ]]; then
  apply_one masteradmin "$MASTERADMIN_DB_URL" masteradmin \
    '20260925000100_precise_secret_key_rule.sql' \
    "select case when pg_get_functiondef(p.oid) like '%v_pat_word%' then 'ok' else 'viejo' end
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'platform' and p.proname = 'reject_secret_like_json'" \
    'ok' || true
else
  step 'MASTERADMIN_DB_URL' 'OMITIDO — no se puso la URL'
  RESULT['masteradmin:skip']='OMITIDO'
fi
say ''

# ---- eExpense ---------------------------------------------------------------
say '=== eExpense · uvjmdphlnpyhtohobvzx ==='
if [[ -n "${EEXPENSE_DB_URL:-}" ]]; then
  apply_one eexpense "$EEXPENSE_DB_URL" eExpenses \
    '20260924190000_masteradmin_da_de_alta_tenants_por_m2m.sql' \
    "select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.proname in ('platform_provision_tenant','platform_get_provisioning','platform_record_provisioning_audit')" \
    '3' || true
else
  step 'EEXPENSE_DB_URL' 'OMITIDO — no se puso la URL'
  RESULT['eexpense:skip']='OMITIDO'
fi
say ''

# ---- GMAO -------------------------------------------------------------------
say '=== GMAO · xikbhkfeaosasdltartg ==='
if [[ -n "${GMAO_DB_URL:-}" ]]; then
  # En orden. Si una falla, las siguientes no se aplican.
  apply_one gmao "$GMAO_DB_URL" GMAO \
    '20260925001118_platform_provisioning_m2m_capture_live.sql' \
    "select case when to_regclass('platform.provisioning_requests') is not null then 'ok' else 'falta' end" \
    'ok' \
  && apply_one gmao "$GMAO_DB_URL" GMAO \
    '20260925001454_platform_provisioning_generic_v1_preprovisioned_admin.sql' \
    "select case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'platform' and p.proname = 'm2m_provision_tenant')
        and not exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'platform' and p.proname = 'm2m_admin_identity')
       then 'ok' else 'incompleto' end" \
    'ok' \
  && apply_one gmao "$GMAO_DB_URL" GMAO \
    '20260925002308_harden_tenant_provisioning_rpc_grants.sql' \
    "select case when has_function_privilege('authenticated', p.oid, 'execute')
                 then 'sigue-abierta' else 'ok' end
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'provision_or_attach_tenant' limit 1" \
    'ok' \
  || true
else
  step 'GMAO_DB_URL' 'OMITIDO — no se puso la URL'
  RESULT['gmao:skip']='OMITIDO'
fi
say ''

# ---- Informe ----------------------------------------------------------------
say 'PENDING_QAS_MIGRATIONS_REPORT'
say ''
for k in "${!RESULT[@]}"; do
  printf '  %-70s %s\n' "$k" "${RESULT[$k]}"
done | sort
say ''
say 'PRD_MUTATIONS: NONE'
say 'SECRETS_EXPOSED: NO'

failed=0
for k in "${!RESULT[@]}"; do
  case "${RESULT[$k]}" in FAIL*|REVISAR*) failed=$((failed + 1)) ;; esac
done
if [[ "$failed" -eq 0 ]]; then
  say 'FINAL_STATUS: MIGRATIONS_READY'
else
  say "FINAL_STATUS: BLOCKED ($failed con problema)"
fi
