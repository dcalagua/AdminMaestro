#!/bin/bash
set -euo pipefail

PROJECT_ROOT="/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin"
PROMPT_FILE="$PROJECT_ROOT/.claude-prompts-v3-multicurrency/MASTER_PROMPT_CLI.md"
LOG_DIR="$PROJECT_ROOT/logs"
CLAUDE_CONFIG="$HOME/.claude-cuenta-2"

cd "$PROJECT_ROOT"

mkdir -p "$LOG_DIR"

TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
LOG_FILE="$LOG_DIR/claude-v3-multicurrency-$TIMESTAMP.log"

if ! command -v claude >/dev/null 2>&1; then
  echo "ERROR: claude executable not found in PATH"
  exit 1
fi

if [ ! -f "$PROMPT_FILE" ]; then
  echo "ERROR: Master prompt not found:"
  echo "$PROMPT_FILE"
  exit 1
fi

echo "=================================================="
echo "EBIM Control Plane V3 Multicurrency"
echo "Claude account/config: $CLAUDE_CONFIG"
echo "Project: $PROJECT_ROOT"
echo "Prompt: $PROMPT_FILE"
echo "Log: $LOG_FILE"
echo "=================================================="

caffeinate -dimsu env \
  CLAUDE_CONFIG_DIR="$CLAUDE_CONFIG" \
  claude \
  --permission-mode acceptEdits \
  -p "$(cat "$PROMPT_FILE")" \
  2>&1 | tee "$LOG_FILE"
