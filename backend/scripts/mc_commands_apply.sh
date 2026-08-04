#!/bin/bash
# Hermes no_agent entrypoint: drain lsh.mc_commands (SPEC 066 + chat_run).
# Empty stdout when nothing to do / quiet success. Speaks on failure.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PY="$SCRIPT_DIR/mc_commands_apply.py"
if [[ ! -f "$PY" ]]; then
  PY="$HOME/ls-house-app/backend/scripts/mc_commands_apply.py"
fi
# Load supabase from keychain via env if present
if [[ -f "$HOME/ls-house-app/backend/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$HOME/ls-house-app/backend/.env"
  set +a
fi
out="$(python3 "$PY" 2>&1)" || {
  echo "$out"
  exit 1
}
# Quiet-ok when only the claim summary line with claimed=0
if [[ "$out" == claimed=0* ]] || [[ -z "$out" ]]; then
  exit 0
fi
echo "$out"
