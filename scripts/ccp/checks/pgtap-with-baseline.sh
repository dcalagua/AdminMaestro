#!/usr/bin/env bash
# ============================================================================
# EBIM CCP · Fase 18 · corre una suite pgTAP y la compara con fallas PREEXISTENTES
# documentadas (MA-62). Sale 0 solo si cada "not ok" observado está en la línea
# base Y la suite terminó; cualquier falla nueva sale 1 y se lista como
# NEW_FAILURE. Una falla de la línea base que ya no aparece se informa como
# FIXED (no rompe). La línea base es un archivo con una descripción de
# aserción por línea, tomada de la evidencia de la base original del repo.
#
#   pgtap-with-baseline.sh <archivo-línea-base> -- <comando que imprime TAP…>
# ============================================================================
set -u
baseline="$1"; shift
[ "${1:-}" = "--" ] && shift
out="$("$@" 2>&1)"; rc=$?
printf '%s\n' "$out"
observed="$(printf '%s\n' "$out" | sed -n 's/^[[:space:]]*not ok [0-9]* - \(.*\)$/\1/p' | sed 's/[[:space:]]*+*[[:space:]]*$//' | sort -u)"
known="$(grep -v '^#' "$baseline" | sed '/^[[:space:]]*$/d' | sort -u)"
new="$(comm -23 <(printf '%s\n' "$observed" | sed '/^$/d') <(printf '%s\n' "$known"))"
fixed="$(comm -13 <(printf '%s\n' "$observed" | sed '/^$/d') <(printf '%s\n' "$known"))"
oks="$(printf '%s\n' "$out" | grep -cE '^[[:space:]]*ok [0-9]+')"
# Harness que solo imprime resúmenes (`TOTAL ok=N not_ok=M`, eChange): usar ese total.
total_ok="$(printf '%s\n' "$out" | sed -n 's/^TOTAL ok=\([0-9]*\).*/\1/p' | tail -1)"
[ "$oks" -eq 0 ] && [ -n "$total_ok" ] && oks="$total_ok"
echo "---- baseline: $(printf '%s\n' "$known" | grep -c .) conocidas · observadas: $(printf '%s\n' "$observed" | grep -c .) · ok: $oks"
[ -n "$fixed" ] && printf 'FIXED: %s\n' "$fixed"
if [ -n "$new" ]; then printf 'NEW_FAILURE: %s\n' "$new"; exit 1; fi
if [ "$oks" -eq 0 ]; then echo "SIN_RESULTADOS (rc=$rc)"; exit 1; fi
if [ $rc -ne 0 ] && [ -z "$observed" ]; then echo "ERROR_DE_EJECUCION (rc=$rc)"; exit 1; fi
echo "BASELINE_OK"
