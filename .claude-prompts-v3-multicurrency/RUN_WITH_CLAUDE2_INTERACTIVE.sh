#!/bin/bash
set -e
PROJECT_ROOT="/Users/edudavidmorenoccama/Documents/Documentos-Edus-MacBook-Pro-2/EBIM/masteradmin"
cd "$PROJECT_ROOT"
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -dimsu claude-2 --permission-mode acceptEdits
else
  claude-2 --permission-mode acceptEdits
fi
