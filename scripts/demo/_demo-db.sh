#!/usr/bin/env bash
# Utilidades comunes de los scripts de datos demo (gerencia-v4). SOLO LOCAL.
#
# Destino, por orden:
#   1. DEMO_DB_URL (psql directo). El host DEBE ser localhost / 127.0.0.1 / ::1;
#      cualquier otro host aborta.
#   2. Contenedor Docker local `supabase_db_ebim-control-plane` (por defecto).
# No se lee ningún .env: la demo nunca toca QAS ni PRD.

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO_CONTAINER="${DEMO_DB_CONTAINER:-supabase_db_ebim-control-plane}"

demo_die() {
  echo "✖ $*" >&2
  exit 1
}

demo_guard() {
  if [[ -n "${DEMO_DB_URL:-}" ]]; then
    local rest host
    rest="${DEMO_DB_URL#*://}"
    rest="${rest#*@}"
    host="${rest%%/*}"
    host="${host%%\?*}"
    if [[ "$host" == \[*\]* ]]; then
      host="${host#[}"
      host="${host%%]*}"
    else
      host="${host%%:*}"
    fi
    case "$host" in
      localhost | 127.0.0.1 | ::1) ;;
      *) demo_die "DEMO_SOLO_LOCAL: DEMO_DB_URL apunta a '$host'. Solo localhost/127.0.0.1." ;;
    esac
    command -v psql >/dev/null 2>&1 || demo_die "psql no está instalado"
  else
    [[ "$DEMO_CONTAINER" == "supabase_db_ebim-control-plane" ]] ||
      demo_die "DEMO_SOLO_LOCAL: contenedor '$DEMO_CONTAINER' no es el stack local ebim-control-plane"
    command -v docker >/dev/null 2>&1 || demo_die "docker no está disponible"
    docker inspect -f '{{.State.Running}}' "$DEMO_CONTAINER" 2>/dev/null | grep -q true ||
      demo_die "El contenedor $DEMO_CONTAINER no está corriendo (supabase start)"
  fi
}

# Ejecuta SQL leído de stdin en UNA transacción, deteniéndose en el primer error.
demo_psql_tx() {
  if [[ -n "${DEMO_DB_URL:-}" ]]; then
    psql "$DEMO_DB_URL" -X -q -o /dev/null -v ON_ERROR_STOP=1 --single-transaction -f - "$@"
  else
    docker exec -i "$DEMO_CONTAINER" psql -U postgres -d postgres -X -q -o /dev/null \
      -v ON_ERROR_STOP=1 --single-transaction -f - "$@"
  fi
}

# Ejecuta SQL de solo lectura (con salida) leído de stdin.
demo_psql_read() {
  if [[ -n "${DEMO_DB_URL:-}" ]]; then
    psql "$DEMO_DB_URL" -X -q -v ON_ERROR_STOP=1 -f - "$@"
  else
    docker exec -i "$DEMO_CONTAINER" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -f - "$@"
  fi
}
