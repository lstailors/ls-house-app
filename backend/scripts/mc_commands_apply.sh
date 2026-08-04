#!/bin/bash
# Hermes no_agent entrypoint: drain lsh.mc_commands (SPEC 066).
# Empty stdout when quiet-ok and nothing to report. Speaks on apply lines / errors.
set -euo pipefail
export HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
# Prefer fleet root if HERMES_HOME was a profile dir
if [[ "$(basename "$(dirname "$HERMES_HOME")")" == "profiles" ]]; then
  export HERMES_HOME="$(cd "$HERMES_HOME/../.." && pwd)"
fi
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PY="$SCRIPT_DIR/mc_commands_apply.py"
if [[ ! -f "$PY" ]]; then
  PY="$HOME/ls-house-app/backend/scripts/mc_commands_apply.py"
fi
if [[ ! -f "$PY" ]]; then
  PY="$HOME/.hermes/profiles/simone/scripts/mc_commands_apply.py"
fi
exec python3 "$PY" --quiet-ok
