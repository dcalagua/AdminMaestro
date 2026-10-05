#!/usr/bin/env bash
# Carga (o recarga) los datos de demostración para Gerencia en el stack LOCAL.
# Idempotente: descarga lo anterior y vuelve a generar en UNA sola transacción.
#
#   bash scripts/demo/load-demo-data.sh            # carga y muestra las cifras clave
#   bash scripts/demo/load-demo-data.sh --quiet    # sin el informe de cifras
#
# Después de `supabase db reset --local` hay que volver a ejecutarlo.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_demo-db.sh"

demo_guard

echo "→ Cargando datos demo gerencia-v4 (local)…"
log="$(mktemp "${TMPDIR:-/tmp}/demo-load.XXXXXX")"
trap 'rm -f "$log"' EXIT
if ! cat "$DEMO_DIR/demo-unload.sql" "$DEMO_DIR/demo-data.sql" | demo_psql_tx >"$log" 2>&1; then
  grep -E 'ERROR|DETAIL|CONTEXT|HINT' "$log" >&2 || cat "$log" >&2
  demo_die "La carga falló y se revirtió completa (la base queda como estaba)."
fi
grep -E 'NOTICE:  DEMO' "$log" | sed 's/^NOTICE:  /  /' || true
echo "✔ Datos demo cargados."

if [[ "${1:-}" != "--quiet" ]]; then
  demo_psql_read < "$DEMO_DIR/demo-verify.sql"
fi
