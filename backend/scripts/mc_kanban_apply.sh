#!/bin/bash
# DEPRECATED shim → mc_commands_apply.sh (SPEC 066)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -x "$SCRIPT_DIR/mc_commands_apply.sh" ]]; then
  exec "$SCRIPT_DIR/mc_commands_apply.sh"
fi
if [[ -x "$HOME/ls-house-app/backend/scripts/mc_commands_apply.sh" ]]; then
  exec "$HOME/ls-house-app/backend/scripts/mc_commands_apply.sh"
fi
exec "$HOME/.hermes/profiles/simone/scripts/mc_commands_apply.sh"
