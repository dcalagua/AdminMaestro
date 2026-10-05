#!/usr/bin/env bash
# Borra del stack LOCAL los datos de demostración gerencia-v4 (y solo esos).
# Idempotente: sin datos demo no hace nada. El seed base queda intacto.
#
#   bash scripts/demo/unload-demo-data.sh
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_demo-db.sh"

demo_guard

echo "→ Descargando datos demo gerencia-v4 (local)…"
log="$(mktemp "${TMPDIR:-/tmp}/demo-unload.XXXXXX")"
trap 'rm -f "$log"' EXIT
if ! demo_psql_tx <"$DEMO_DIR/demo-unload.sql" >"$log" 2>&1; then
  grep -E 'ERROR|DETAIL|CONTEXT|HINT' "$log" >&2 || cat "$log" >&2
  demo_die "La descarga falló y se revirtió completa."
fi
grep -E 'NOTICE:  DEMO' "$log" | sed 's/^NOTICE:  /  /' || true
echo "✔ Datos demo eliminados."
