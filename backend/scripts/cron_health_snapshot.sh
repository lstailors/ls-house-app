#!/bin/bash
# Hermes no_agent entrypoint: fleet cron health → Supabase lsh.cron_health.
# Empty stdout when green/amber only (quiet-ok). Speaks on reds or apply failure.
# Stage: job created paused until C OK + migration applied.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Prefer repo copy if present (dev), else sibling .py in profile scripts
PY="$SCRIPT_DIR/cron_health_snapshot.py"
if [[ ! -f "$PY" ]]; then
  PY="$HOME/ls-house-app/backend/scripts/cron_health_snapshot.py"
fi
exec python3 "$PY" --apply --quiet-ok
