#!/usr/bin/env bash
# Guarda de entorno del programa EBIM Commercial Control Plane (Task MA-00).
#
# Las fases 03-18 son SOLO LOCALES. Este script aborta (exit 2) si el destino
# declarado en VITE_SUPABASE_URL / SUPABASE_DB_URL no es el stack local, o si
# aparece cualquier ref de un proyecto remoto conocido (QAS de MasterAdmin y
# los dos proyectos que el programa trata como PRD). Nunca imprime los valores:
# una URL de conexión puede llevar contraseña.
#
# Uso: VITE_SUPABASE_URL=... SUPABASE_DB_URL=... scripts/ccp/guard-env.sh
set -u

REMOTE_REFS=(jivgwrczgdpsuvqcwqku uvjmdphlnpyhtohobvzx xikbhkfeaosasdltartg)

stop() {
  echo "HARD STOP: $1" >&2
  exit 2
}

declared=0
for name in VITE_SUPABASE_URL SUPABASE_DB_URL; do
  value="${!name:-}"
  [ -z "$value" ] && continue
  declared=1

  for ref in "${REMOTE_REFS[@]}"; do
    case "$value" in
      *"$ref"*) stop "$name apunta al proyecto remoto $ref" ;;
    esac
  done

  # Host = lo que va entre '://' (y un 'user:pass@' opcional) y el siguiente ':' '/' o '?'.
  rest="${value#*://}"
  rest="${rest##*@}"
  host="${rest%%[:/?]*}"
  case "$host" in
    127.0.0.1 | localhost) ;;
    *) stop "$name no apunta al stack local (host no permitido)" ;;
  esac
done

[ "$declared" -eq 1 ] || stop "no hay destino declarado (VITE_SUPABASE_URL o SUPABASE_DB_URL)"

echo "guard-env: destino local verificado"
