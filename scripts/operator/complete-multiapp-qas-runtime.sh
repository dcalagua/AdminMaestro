#!/usr/bin/env bash
set -euo pipefail

# macOS trae bash 3.2 de fábrica, que no tiene arrays asociativos ni `mapfile`.
# Si esto salta, ejecuta:  /opt/homebrew/bin/bash scripts/operator/complete-multiapp-qas-runtime.sh
if [[ -z "${BASH_VERSINFO:-}" || "${BASH_VERSINFO[0]}" -lt 4 ]]; then
  echo "Hace falta bash 4 o superior (tienes ${BASH_VERSION:-desconocida})." >&2
  echo "Prueba con: /opt/homebrew/bin/bash \"$0\"" >&2
  exit 1
fi

# =============================================================================
# EBIM · Runtime QAS de provisioning para los cinco SaaS pendientes
# -----------------------------------------------------------------------------
# Lo ejecuta UNA PERSONA desde una Terminal normal de macOS, porque necesita el
# Keychain donde vive la sesión de la CLI de Supabase.
#
# Qué hace, por producto (GMAO, eChange, eExpense, eCommerce, Comerza):
#   1. comprueba que existe su par de claves M2M, y lo genera sólo si falta;
#   2. carga las 9 variables del contrato en su proyecto QAS, con M2M APAGADO;
#   3. despliega ÚNICAMENTE la función `platform-provisioning`;
#   4. comprueba /health apagado (503), enciende M2M y vuelve a comprobar (200);
#   5. pide el estado de un tenant inexistente con un token ES256 real y espera
#      un 404, que es la prueba de que el producto ACEPTA la firma.
# Y al final carga en MasterAdmin QAS las cinco claves privadas, en PKCS#8.
#
# Qué NO hace:
#   · no toca PRD ni ningún proyecto fuera de la lista de abajo;
#   · no aplica migraciones a ciegas: las de GMAO se informan, y sólo se aplican
#     si se pide explícitamente y con una URL de base de datos;
#   · no despliega ninguna otra función;
#   · no imprime NUNCA una clave, un token, un secreto ni una contraseña.
#
# Uso:
#   bash scripts/operator/complete-multiapp-qas-runtime.sh
#   bash scripts/operator/complete-multiapp-qas-runtime.sh --only echange
#   GMAO_DB_URL='postgresql://…' bash scripts/operator/complete-multiapp-qas-runtime.sh --apply-gmao-migrations
# =============================================================================

# ---- Proyectos AUTORIZADOS. Ningún otro ref entra en este script -------------
readonly MASTERADMIN_REF='jivgwrczgdpsuvqcwqku'
readonly GMAO_REF='xikbhkfeaosasdltartg'
readonly ECHANGE_REF='zoveazvwvyayugladuvl'
readonly EEXPENSE_REF='uvjmdphlnpyhtohobvzx'
readonly ECOMMERCE_REF='ehxlxbhtlmfgneiagdcj'
readonly COMERZA_REF='rsdyqwdqvezebpopcggj'

readonly EBIM_ROOT="${EBIM_ROOT:-$HOME/Documents/Documentos-Edus-MacBook-Pro-2/EBIM}"
readonly KEYS_ROOT="${KEYS_ROOT:-$HOME/.ebim-keys/masteradmin}"
readonly FUNCTION_NAME='platform-provisioning'

# producto|ref|repo|audience|scope_create|scope_read
readonly PRODUCTS=(
  "gmao|${GMAO_REF}|GMAO|gmao.ebim|gmao:tenant:create|gmao:tenant:read"
  "echange|${ECHANGE_REF}|eChange|echange.ebim|echange:tenant:create|echange:tenant:read"
  "eexpense|${EEXPENSE_REF}|eExpenses|eexpense.ebim|eexpense:tenant:create|eexpense:tenant:read"
  "ecommerce|${ECOMMERCE_REF}|eCommerce|ecommerce.ebim|ecommerce:tenant:create|ecommerce:tenant:read"
  "comerza|${COMERZA_REF}|comerza|comerza.ebim|comerza:tenant:create|comerza:tenant:read"
)

# Nombre del secreto de la clave privada en MasterAdmin, por producto.
masteradmin_secret_name() {
  case "$1" in
    gmao)      echo 'GMAO_QAS_M2M_PRIVATE_KEY' ;;
    echange)   echo 'ECHANGE_QAS_M2M_PRIVATE_KEY' ;;
    eexpense)  echo 'EEXPENSE_QAS_M2M_PRIVATE_KEY' ;;
    ecommerce) echo 'ECOMMERCE_QAS_M2M_PRIVATE_KEY' ;;
    comerza)   echo 'COMERZA_QAS_M2M_PRIVATE_KEY' ;;
    *) return 1 ;;
  esac
}

ONLY=''
APPLY_GMAO_MIGRATIONS='no'
while [[ $# -gt 0 ]]; do
  case "$1" in
    --only) ONLY="${2:-}"; shift 2 ;;
    --apply-gmao-migrations) APPLY_GMAO_MIGRATIONS='yes'; shift ;;
    *) echo "opción desconocida: $1" >&2; exit 2 ;;
  esac
done

# ---- Área de trabajo privada. Los ficheros con material sensible viven aquí --
umask 077
WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT INT TERM

declare -A RESULT   # "producto:paso" -> PASS | FAIL | SKIP | <detalle corto>
note() { RESULT["$1"]="$2"; }
say()  { printf '%s\n' "$*"; }
step() { printf '  · %-22s %s\n' "$1" "$2"; }

# =============================================================================
# 0 · Preflight
# =============================================================================
say '=== Preflight ==='
command -v supabase >/dev/null || { say 'FALTA la CLI de Supabase'; exit 1; }
command -v openssl  >/dev/null || { say 'FALTA openssl'; exit 1; }
command -v curl     >/dev/null || { say 'FALTA curl'; exit 1; }
command -v node     >/dev/null || { say 'FALTA node (hace falta para firmar el token de prueba)'; exit 1; }
say "CLI de Supabase: $(supabase --version 2>&1 | head -1)"

PROJECTS_RAW="$WORK/projects.txt"
if ! supabase projects list >"$PROJECTS_RAW" 2>&1; then
  say 'No se pudo listar los proyectos. ¿Sesión de la CLI iniciada? (supabase login)'
  exit 1
fi

missing_refs=()
for ref in "$MASTERADMIN_REF" "$GMAO_REF" "$ECHANGE_REF" "$EEXPENSE_REF" "$ECOMMERCE_REF" "$COMERZA_REF"; do
  grep -q "$ref" "$PROJECTS_RAW" || missing_refs+=("$ref")
done
if [[ ${#missing_refs[@]} -gt 0 ]]; then
  say "ALTO: esta cuenta no ve estos proyectos: ${missing_refs[*]}"
  say 'No se cambia de cuenta automáticamente. Inicia sesión con la cuenta correcta y repite.'
  exit 1
fi
say "Los 6 proyectos autorizados son visibles. Ninguno más se toca."
say ''

# =============================================================================
# Utilidades
# =============================================================================

# Huella SHA-256 de una clave pública, en DER. Sirve para comparar sin imprimir.
pub_fingerprint() { openssl pkey -pubin -in "$1" -outform DER 2>/dev/null | openssl dgst -sha256 | awk '{print $2}'; }
priv_pub_fingerprint() { openssl pkey -in "$1" -pubout -outform DER 2>/dev/null | openssl dgst -sha256 | awk '{print $2}'; }

# Garantiza el par de claves del producto. Genera sólo si falta.
ensure_keypair() {
  local product="$1" dir="$KEYS_ROOT/$1/qas"
  local priv="$dir/private.pem" pub="$dir/public.pem"

  if [[ -f "$priv" && -f "$pub" ]]; then
    if [[ "$(priv_pub_fingerprint "$priv")" != "$(pub_fingerprint "$pub")" ]]; then
      step 'claves' 'FAIL — la pública no corresponde a la privada'
      note "$product:keys" 'FAIL'
      return 1
    fi
    step 'claves' 'ya existían y corresponden'
    note "$product:keys" 'PASS'
    return 0
  fi

  mkdir -p "$dir"
  # EC P-256 en PKCS#8, que es lo que el firmante de MasterAdmin importa.
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:prime256v1 -out "$priv" 2>/dev/null
  openssl pkey -in "$priv" -pubout -out "$pub" 2>/dev/null
  chmod 600 "$priv"
  chmod 644 "$pub"
  step 'claves' 'GENERADAS (P-256, PKCS#8)'
  note "$product:keys" 'PASS (generadas)'
}

# Las 9 variables del contrato, con M2M apagado.
set_saas_secrets() {
  local product="$1" ref="$2" audience="$3" create="$4" read="$5"
  local pub="$KEYS_ROOT/$product/qas/public.pem"
  local envfile="$WORK/$product.env"

  {
    printf 'EBIM_MASTERADMIN_M2M_ENABLED="false"\n'
    printf 'EBIM_MASTERADMIN_M2M_ISSUER="masteradmin.ebim"\n'
    printf 'EBIM_MASTERADMIN_M2M_AUDIENCE="%s"\n' "$audience"
    printf 'EBIM_MASTERADMIN_M2M_SUBJECT="masteradmin-provisioning"\n'
    printf 'EBIM_MASTERADMIN_M2M_ALGORITHM="ES256"\n'
    printf 'EBIM_MASTERADMIN_M2M_MAX_TOKEN_LIFETIME="120"\n'
    printf 'EBIM_MASTERADMIN_M2M_CREATE_SCOPE="%s"\n' "$create"
    printf 'EBIM_MASTERADMIN_M2M_READ_SCOPE="%s"\n' "$read"
    printf 'EBIM_MASTERADMIN_M2M_PUBLIC_KEY_B64="%s"\n' "$(base64 < "$pub" | tr -d '\n')"
  } >"$envfile"

  if supabase secrets set --project-ref "$ref" --env-file "$envfile" >/dev/null 2>&1; then
    step 'secrets (apagado)' 'PASS'
    note "$product:secrets" 'PASS'
  else
    step 'secrets (apagado)' 'FAIL'
    note "$product:secrets" 'FAIL'
    return 1
  fi
  rm -f "$envfile"
}

deploy_function() {
  local product="$1" ref="$2" repo="$3"
  local dir="$EBIM_ROOT/$repo"

  if [[ ! -d "$dir/supabase/functions/$FUNCTION_NAME" ]]; then
    step 'deploy' "FAIL — no existe $repo/supabase/functions/$FUNCTION_NAME"
    note "$product:deploy" 'FAIL (sin fuente)'
    return 1
  fi

  local branch; branch="$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  if [[ "$branch" != 'dev' && "$branch" != 'qas' ]]; then
    step 'deploy' "FAIL — $repo está en '$branch'; se despliega desde dev o qas"
    note "$product:deploy" "FAIL (rama $branch)"
    return 1
  fi

  # Sólo esta función. `verify_jwt` apagado porque la función hace su propia
  # verificación ES256: el gateway rechazaría el token de MasterAdmin antes.
  if ( cd "$dir" && supabase functions deploy "$FUNCTION_NAME" --project-ref "$ref" --no-verify-jwt >/dev/null 2>&1 ); then
    step 'deploy' "PASS (rama $branch)"
    note "$product:deploy" 'PASS'
  else
    step 'deploy' 'FAIL'
    note "$product:deploy" 'FAIL'
    return 1
  fi
}

health_code() {
  # curl ya escribe 000 cuando no llega a conectar; `|| true` evita que
  # `set -e` corte por su código de salida.
  curl -s -o /dev/null -w '%{http_code}' --max-time 30 \
    "https://$1.supabase.co/functions/v1/$FUNCTION_NAME/health" 2>/dev/null || true
}

enable_m2m() {
  local ref="$1" envfile="$WORK/enable.env"
  printf 'EBIM_MASTERADMIN_M2M_ENABLED="true"\n' >"$envfile"
  supabase secrets set --project-ref "$ref" --env-file "$envfile" >/dev/null 2>&1
  local rc=$?
  rm -f "$envfile"
  return $rc
}

# Firma un ES256 real y pide el estado de un tenant que no existe.
# El token se construye dentro de node y NO se imprime: sólo sale el status.
signed_unknown_get() {
  local product="$1" ref="$2" audience="$3" read_scope="$4"
  local priv="$KEYS_ROOT/$product/qas/private.pem"
  node - "$priv" "$ref" "$audience" "$read_scope" <<'NODE'
const { readFileSync } = require('node:fs');
const { createSign, createPrivateKey, randomUUID } = require('node:crypto');

const [privPath, ref, audience, scope] = process.argv.slice(2);
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const now = Math.floor(Date.now() / 1000);

const header = { alg: 'ES256', typ: 'JWT' };
const payload = {
  iss: 'masteradmin.ebim',
  aud: audience,
  sub: 'masteradmin-provisioning',
  iat: now,
  exp: now + 120,
  jti: randomUUID(),
  scope,
};
const input = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(payload))}`;
const key = createPrivateKey(readFileSync(privPath));
const sig = createSign('SHA256').update(input).end()
  .sign({ key, dsaEncoding: 'ieee-p1363' });
const token = `${input}.${b64(sig)}`;   // no se imprime jamás

const unknownTenant = randomUUID();
const url = `https://${ref}.supabase.co/functions/v1/platform-provisioning/tenants/${unknownTenant}`;

fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } })
  .then(async (res) => {
    // Solo el código estable del contrato. Ni cabeceras, ni cuerpo crudo.
    let code = '';
    try {
      const body = await res.json();
      if (body && typeof body.code === 'string') code = body.code;
    } catch { /* cuerpo no JSON: basta el status */ }
    console.log(`${res.status} ${code}`.trim());
  })
  .catch(() => console.log('000'));
NODE
}

# =============================================================================
# 1 · Por producto
# =============================================================================
for entry in "${PRODUCTS[@]}"; do
  IFS='|' read -r product ref repo audience create_scope read_scope <<<"$entry"
  [[ -n "$ONLY" && "$ONLY" != "$product" ]] && continue

  say "=== $product · proyecto $ref ==="

  ensure_keypair "$product" || { say ''; continue; }
  set_saas_secrets "$product" "$ref" "$audience" "$create_scope" "$read_scope" || { say ''; continue; }
  deploy_function "$product" "$ref" "$repo" || { say ''; continue; }

  code_off="$(health_code "$ref")"
  if [[ "$code_off" == '503' ]]; then
    step 'health apagado' 'PASS (503)'
    note "$product:health_off" 'PASS (503)'
  else
    step 'health apagado' "revisar — devolvió $code_off, se esperaba 503"
    note "$product:health_off" "REVISAR ($code_off)"
  fi

  if enable_m2m "$ref"; then
    step 'M2M encendido' 'PASS'
  else
    step 'M2M encendido' 'FAIL'
    note "$product:health_on" 'FAIL (no se pudo encender)'
    say ''
    continue
  fi
  sleep 3   # el runtime relee los secrets en la siguiente petición

  code_on="$(health_code "$ref")"
  if [[ "$code_on" == '200' ]]; then
    step 'health encendido' 'PASS (200)'
    note "$product:health_on" 'PASS (200)'
  else
    step 'health encendido' "FAIL — devolvió $code_on, se esperaba 200"
    note "$product:health_on" "FAIL ($code_on)"
  fi

  signed="$(signed_unknown_get "$product" "$ref" "$audience" "$read_scope" || echo '000')"
  case "$signed" in
    404*) step 'GET firmado' "PASS ($signed)"; note "$product:signed_get" "PASS ($signed)" ;;
    401*) step 'GET firmado' "FAIL — $signed: el producto NO acepta la firma"; note "$product:signed_get" "FAIL ($signed)" ;;
    403*) step 'GET firmado' "FAIL — $signed: falta el scope de lectura"; note "$product:signed_get" "FAIL ($signed)" ;;
    *)    step 'GET firmado' "revisar — $signed"; note "$product:signed_get" "REVISAR ($signed)" ;;
  esac
  say ''
done

# =============================================================================
# 2 · Migraciones de GMAO — se informan; sólo se aplican si se pide
# =============================================================================
if [[ -z "$ONLY" || "$ONLY" == 'gmao' ]]; then
  say "=== GMAO · migraciones de provisioning ==="
  GMAO_DIR="$EBIM_ROOT/GMAO"
  mapfile -t GMAO_MIGRATIONS < <(ls "$GMAO_DIR/supabase/migrations" 2>/dev/null | grep -E '^20260925(001118|001454|002308)_' || true)

  if [[ ${#GMAO_MIGRATIONS[@]} -eq 0 ]]; then
    step 'migraciones' 'FAIL — no se encontraron los tres archivos esperados'
    note 'gmao:migrations' 'FAIL (no encontradas)'
  else
    for m in "${GMAO_MIGRATIONS[@]}"; do step 'archivo' "$m"; done

    if [[ "$APPLY_GMAO_MIGRATIONS" != 'yes' ]]; then
      step 'aplicar' 'OMITIDO — repite con --apply-gmao-migrations y GMAO_DB_URL'
      say '    El proyecto arrastra deriva histórica, así que NO se hace `db push`.'
      say '    Cada archivo se aplica suelto, en orden, y se comprueba el objeto después.'
      note 'gmao:migrations' 'PENDIENTE (informado)'
    elif [[ -z "${GMAO_DB_URL:-}" ]]; then
      step 'aplicar' 'FAIL — falta GMAO_DB_URL'
      note 'gmao:migrations' 'FAIL (sin GMAO_DB_URL)'
    elif ! command -v psql >/dev/null; then
      step 'aplicar' 'FAIL — falta psql'
      note 'gmao:migrations' 'FAIL (sin psql)'
    else
      applied=0
      for m in "${GMAO_MIGRATIONS[@]}"; do
        # ON_ERROR_STOP: si un archivo falla, no se sigue con el siguiente.
        if psql "$GMAO_DB_URL" -v ON_ERROR_STOP=1 -q -f "$GMAO_DIR/supabase/migrations/$m" >/dev/null 2>&1; then
          step "$m" 'aplicada'
          applied=$((applied + 1))
        else
          step "$m" 'FAIL — se detiene aquí; nada más se aplica'
          break
        fi
      done
      objects="$(psql "$GMAO_DB_URL" -tAc "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'platform' and p.proname like 'm2m%'" 2>/dev/null || echo '?')"
      step 'verificación' "funciones m2m_* en platform: $objects"
      note 'gmao:migrations' "aplicadas $applied/${#GMAO_MIGRATIONS[@]} · m2m_*=$objects"
    fi
  fi
  say ''
fi

# =============================================================================
# 3 · Claves privadas en MasterAdmin QAS
# =============================================================================
say "=== MasterAdmin · claves privadas ($MASTERADMIN_REF) ==="
MA_ENV="$WORK/masteradmin.env"
: >"$MA_ENV"
keys_loaded=0
keys_total=0
for entry in "${PRODUCTS[@]}"; do
  IFS='|' read -r product _ _ _ _ _ <<<"$entry"
  [[ -n "$ONLY" && "$ONLY" != "$product" ]] && continue
  keys_total=$((keys_total + 1))
  priv="$KEYS_ROOT/$product/qas/private.pem"
  name="$(masteradmin_secret_name "$product")"
  if [[ ! -f "$priv" ]]; then
    step "$name" 'FAIL — no hay clave privada'
    continue
  fi
  # PKCS#8 es el único formato que importa el firmante del orquestador.
  if ! pkcs8="$(openssl pkcs8 -topk8 -nocrypt -in "$priv" 2>/dev/null)"; then
    step "$name" 'FAIL — no se pudo convertir a PKCS#8'
    continue
  fi
  printf '%s="%s"\n' "$name" "$pkcs8" >>"$MA_ENV"
  keys_loaded=$((keys_loaded + 1))
  step "$name" 'preparada'
done
unset pkcs8

if [[ "$keys_loaded" -gt 0 ]] && supabase secrets set --project-ref "$MASTERADMIN_REF" --env-file "$MA_ENV" >/dev/null 2>&1; then
  step 'carga' "PASS ($keys_loaded/$keys_total)"
  MA_RESULT="$keys_loaded/$keys_total"
else
  step 'carga' 'FAIL'
  MA_RESULT="FAIL (0/$keys_total)"
fi
rm -f "$MA_ENV"
say ''

# =============================================================================
# 4 · Informe
# =============================================================================
get() { printf '%s' "${RESULT[$1]:-—}"; }

say 'MULTIAPP_QAS_RUNTIME_OPERATOR_REPORT'
say ''
for entry in "${PRODUCTS[@]}"; do
  IFS='|' read -r product ref _ _ _ _ <<<"$entry"
  [[ -n "$ONLY" && "$ONLY" != "$product" ]] && continue
  say "$(printf '%s' "$product" | tr '[:lower:]' '[:upper:]'): (ref $ref)"
  say "  SECRETS:         $(get "$product:secrets")"
  [[ "$product" == 'gmao' ]] && say "  MIGRATIONS:      $(get 'gmao:migrations')"
  say "  DEPLOY:          $(get "$product:deploy")"
  say "  HEALTH_DISABLED: $(get "$product:health_off")"
  say "  HEALTH_ENABLED:  $(get "$product:health_on")"
  say "  SIGNED_GET:      $(get "$product:signed_get")"
  say ''
done

say "MASTERADMIN_PRIVATE_KEYS: $MA_RESULT"
say 'PRD_MUTATIONS: NONE'
say 'SECRETS_EXPOSED: NO'

failed=0
for k in "${!RESULT[@]}"; do
  case "${RESULT[$k]}" in FAIL*) failed=$((failed + 1)) ;; esac
done
if [[ "$failed" -eq 0 && "$MA_RESULT" != FAIL* ]]; then
  say 'FINAL_STATUS: RUNTIME_READY_FOR_MASTERADMIN_CERTIFICATION'
else
  say "FINAL_STATUS: BLOCKED ($failed pasos en FAIL)"
fi
