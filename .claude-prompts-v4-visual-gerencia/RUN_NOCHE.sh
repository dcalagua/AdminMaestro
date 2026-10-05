#!/bin/bash
# =============================================================================
# MasterAdmin V4 — corrida nocturna visual para Gerencia
#
# Uso:  bash .claude-prompts-v4-visual-gerencia/RUN_NOCHE.sh            # todas las fases pendientes
#       bash .claude-prompts-v4-visual-gerencia/RUN_NOCHE.sh 09_DASHBOARD_EJECUTIVO   # solo una fase
#
# Una sesión de Claude por fase (contexto limpio). El estado vive en STATE.md;
# volver a ejecutar retoma desde la primera fase que no esté DONE.
# Todo es LOCAL: sin push, sin nube, sin QAS/PRD.
# =============================================================================
set -uo pipefail

ROOT="/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin"
PACK="$ROOT/.claude-prompts-v4-visual-gerencia"
WT="$ROOT/.worktrees/visual-gerencia"
BRANCH="feature/masteradmin-visual-gerencia"
BASE="dev"
CLAUDE_CONFIG="$HOME/.claude-cuenta-2"
LOG_DIR="$PACK/logs"
RUNNER_LOG="$LOG_DIR/runner.log"
ONLY="${1:-}"

# Fases que pueden fallar sin detener la noche (no bloquean a las siguientes).
OPTIONAL_PHASES=" 13_MODULO_LIQUIDACION_COMISIONES 14_MODO_PRESENTACION "

mkdir -p "$LOG_DIR"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$RUNNER_LOG"; }

# --- Mantener la Mac despierta mientras dure este script ----------------------
caffeinate -dimsu -w $$ &

# --- Preflight -----------------------------------------------------------------
command -v claude >/dev/null 2>&1 || { log "ERROR: no encuentro el ejecutable 'claude'"; exit 1; }
command -v supabase >/dev/null 2>&1 || { log "ERROR: no encuentro 'supabase' CLI"; exit 1; }
docker info >/dev/null 2>&1 || { log "ERROR: Docker no responde. Abre Docker Desktop y reintenta."; exit 1; }

# --- Worktree aislado ------------------------------------------------------------
if [ ! -d "$WT" ]; then
  if git -C "$ROOT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git -C "$ROOT" worktree add "$WT" "$BRANCH" || { log "ERROR: no pude crear el worktree"; exit 1; }
  else
    git -C "$ROOT" worktree add -b "$BRANCH" "$WT" "$BASE" || { log "ERROR: no pude crear el worktree"; exit 1; }
  fi
  log "Worktree creado en $WT (rama $BRANCH desde $BASE)"
fi
[ -e "$WT/node_modules" ] || ln -s ../../node_modules "$WT/node_modules"

# --- Supabase LOCAL ----------------------------------------------------------------
if ! supabase status --workdir "$WT" >/dev/null 2>&1; then
  log "Levantando Supabase local (ebim-control-plane)…"
  supabase start --workdir "$WT" >>"$RUNNER_LOG" 2>&1 || { log "ERROR: supabase start falló"; exit 1; }
fi

# --- Entorno de la app apuntando SOLO al stack local -----------------------------------
# .env.development.local tiene prioridad sobre .env.local en `vite` (modo development),
# así la app y Playwright nunca apuntan a la nube aunque exista un .env.local.
API_URL="$(supabase status -o env --workdir "$WT" 2>/dev/null | sed -n 's/^API_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
ANON_KEY="$(supabase status -o env --workdir "$WT" 2>/dev/null | sed -n 's/^ANON_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
case "$API_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) log "ERROR: la API de Supabase no es local ('$API_URL'). Aborto por seguridad."; exit 1 ;;
esac
umask 077
printf 'VITE_SUPABASE_URL=%s\nVITE_SUPABASE_ANON_KEY=%s\nVITE_APP_ENV=LOCAL\n' "$API_URL" "$ANON_KEY" > "$WT/.env.development.local"
umask 022
log "Entorno local listo ($API_URL)"

# --- Herramientas permitidas / prohibidas para cada sesión -----------------------------
ALLOWED=(
  "Read" "Glob" "Grep" "Edit" "Write" "Skill" "Agent"
  "Bash(npm *)" "Bash(npx *)" "Bash(node *)" "Bash(python3 *)" "Bash(deno *)"
  "Bash(git status*)" "Bash(git log*)" "Bash(git diff*)" "Bash(git show*)" "Bash(git rev-parse*)"
  "Bash(git branch*)" "Bash(git add *)" "Bash(git commit *)" "Bash(git checkout -- *)"
  "Bash(supabase start*)" "Bash(supabase status*)" "Bash(supabase db reset --local*)"
  "Bash(supabase test db*)" "Bash(supabase gen types*)"
  "Bash(docker ps*)" "Bash(docker exec*)" "Bash(bash scripts/demo/*)"
  "Bash(ls *)" "Bash(rg *)" "Bash(mkdir *)" "Bash(wc *)"
)
DISALLOWED=(
  "Bash(git push*)" "Bash(gh *)" "Bash(git reset --hard*)" "Bash(git clean*)" "Bash(rm -rf*)"
  "Bash(supabase link*)" "Bash(supabase db push*)" "Bash(supabase functions deploy*)"
  "Bash(supabase secrets*)" "Bash(zsh -ic*)" "Bash(supabase-cli-ebim*)"
)

run_phase() {
  local id="$1" file="$2" attempt="$3" extra="$4"
  local plog="$LOG_DIR/${id}-intento${attempt}-$(date '+%Y%m%d-%H%M%S').log"
  local prompt
  prompt="$(cat "$PACK/00_CONTEXTO_COMUN.md")

---
${extra}
# FASE A EJECUTAR: ${id}

$(cat "$file")"
  log "▶ $id (intento $attempt) — log: $plog"
  (
    cd "$WT" && env CLAUDE_CONFIG_DIR="$CLAUDE_CONFIG" claude \
      --permission-mode auto \
      --add-dir "$PACK" \
      --allowedTools "${ALLOWED[@]}" \
      --disallowedTools "${DISALLOWED[@]}" \
      -p "$prompt"
  ) >"$plog" 2>&1
  local code=$?
  if [ $code -eq 0 ] && grep -q "FASE_RESULTADO=DONE" "$plog" && grep -q "^${id}: DONE" "$PACK/STATE.md"; then
    log "✔ $id DONE"
    return 0
  fi
  log "✖ $id no terminó (exit $code). Revisa $plog"
  return 1
}

log "=========== Inicio de la noche V4 visual ==========="
for file in "$PACK"/fases/*.md; do
  id="$(basename "$file" .md)"
  if [ -n "$ONLY" ] && [ "$id" != "$ONLY" ]; then continue; fi
  if [ -z "$ONLY" ] && grep -q "^${id}: DONE" "$PACK/STATE.md"; then
    log "· $id ya está DONE, se salta"
    continue
  fi

  if run_phase "$id" "$file" 1 ""; then continue; fi
  if run_phase "$id" "$file" 2 "REANUDACIÓN: el intento anterior de esta fase no terminó. Revisa PACK/STATE.md, \`git log\` y \`git status\` del WORKTREE, conserva lo que esté bien y completa lo que falte."; then continue; fi

  if [[ "$OPTIONAL_PHASES" == *" $id "* ]]; then
    log "⚠ $id quedó sin terminar pero es opcional: se continúa con la siguiente fase"
    continue
  fi
  log "■ Se detiene la noche en $id. Al volver a ejecutar el runner se retoma aquí."
  exit 1
done
log "=========== Fin de la noche V4 visual ==========="
grep -E "^[0-9]{2}_|NOCHE_RESULTADO" "$PACK/STATE.md" | tee -a "$RUNNER_LOG"
