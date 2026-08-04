#!/bin/bash
# Hermes no_agent entrypoint: kanban.db → Supabase lsh.kanban_snapshot.
# Empty stdout when apply ok (quiet-ok). Speaks on failure.
# Stage: job created paused until C OK + migration applied.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PY="$SCRIPT_DIR/kanban_snapshot.py"
if [[ ! -f "$PY" ]]; then
  PY="$HOME/ls-house-app/backend/scripts/kanban_snapshot.py"
fi
exec python3 "$PY" --apply --quiet-ok
