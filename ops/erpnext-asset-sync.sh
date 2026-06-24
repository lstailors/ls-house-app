#!/usr/bin/env bash
#
# erpnext-asset-sync.sh
#
# Fixes ERPNext "broken icons / broken CSS" caused by the backend and frontend
# Docker containers serving out-of-sync assets.
#
# WHY THIS HAPPENS
#   sites/assets in every container is a symlink -> <bench>/assets, and that
#   target lives in each container's own writable image layer, NOT in a shared
#   Docker volume. nginx (frontend container) serves CSS/JS from its own copy;
#   the backend embeds asset hash fingerprints into the HTML from its own copy.
#   When the two copies drift (e.g. `bench build` ran in only one container,
#   an app was added, or containers were recreated from different layers) the
#   backend emits hash X but nginx only has hash Y -> 404 on every asset ->
#   broken UI. The backend owns the HTML manifest, so the frontend must be
#   made to match the backend.
#
# USAGE
#   ops/erpnext-asset-sync.sh check     # diagnose only (no changes)
#   ops/erpnext-asset-sync.sh fix       # build in backend, sync to frontend, restart, verify
#   ops/erpnext-asset-sync.sh           # same as `fix`
#
# CONFIG (override via environment variables)
#   ERPNEXT_BACKEND_CONTAINER   default: erpnext-backend-1
#   ERPNEXT_FRONTEND_CONTAINER  default: erpnext-frontend-1
#   ERPNEXT_BENCH_DIR           default: /home/frappe/frappe-bench
#   ERPNEXT_SITE_URL            default: https://erp.lstailors.com
#   ERPNEXT_COMPOSE_DIR         default: /Users/Maestro_1/erpnext-docker
#   ERPNEXT_COMPOSE_PROJECT     default: erpnext
#   ERPNEXT_COMPOSE_FILES       default: the noproxy/mariadb/redis override stack
#
set -euo pipefail

BACKEND_CONTAINER="${ERPNEXT_BACKEND_CONTAINER:-erpnext-backend-1}"
FRONTEND_CONTAINER="${ERPNEXT_FRONTEND_CONTAINER:-erpnext-frontend-1}"
BENCH_DIR="${ERPNEXT_BENCH_DIR:-/home/frappe/frappe-bench}"
SITE_URL="${ERPNEXT_SITE_URL:-https://erp.lstailors.com}"
COMPOSE_DIR="${ERPNEXT_COMPOSE_DIR:-/Users/Maestro_1/erpnext-docker}"
COMPOSE_PROJECT="${ERPNEXT_COMPOSE_PROJECT:-erpnext}"
COMPOSE_FILES="${ERPNEXT_COMPOSE_FILES:--f compose.yaml -f overrides/compose.noproxy.yaml -f overrides/compose.mariadb.yaml -f overrides/compose.redis.yaml}"

# --- pretty output -----------------------------------------------------------
if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"; RED="$(printf '\033[31m')"; GRN="$(printf '\033[32m')"
  YLW="$(printf '\033[33m')"; DIM="$(printf '\033[2m')"; RST="$(printf '\033[0m')"
else
  BOLD=""; RED=""; GRN=""; YLW=""; DIM=""; RST=""
fi
log()  { printf '%s\n' "${BOLD}==>${RST} $*"; }
ok()   { printf '%s\n' "${GRN}✓${RST} $*"; }
warn() { printf '%s\n' "${YLW}!${RST} $*"; }
err()  { printf '%s\n' "${RED}✗${RST} $*" >&2; }

require_docker() {
  command -v docker >/dev/null 2>&1 || { err "docker not found on PATH"; exit 1; }
  if ! docker inspect "$BACKEND_CONTAINER" >/dev/null 2>&1; then
    err "Backend container '$BACKEND_CONTAINER' not found. Set ERPNEXT_BACKEND_CONTAINER."
    exit 1
  fi
  if ! docker inspect "$FRONTEND_CONTAINER" >/dev/null 2>&1; then
    err "Frontend container '$FRONTEND_CONTAINER' not found. Set ERPNEXT_FRONTEND_CONTAINER."
    exit 1
  fi
}

# Print the hashed desk CSS bundle filename the backend currently has.
backend_desk_bundle() {
  docker exec "$BACKEND_CONTAINER" sh -c "ls $BENCH_DIR/assets/frappe/dist/css/ 2>/dev/null" \
    | grep -E '^desk\..*\.css$' | head -1 || true
}

# HTTP status nginx returns for a given asset path.
served_status() {
  curl -s -o /dev/null -w '%{http_code}' "$SITE_URL/assets/frappe/dist/css/$1"
}

# Returns 0 if backend's desk bundle is actually served by nginx, 1 otherwise.
# Echoes a human summary. Sets global LAST_BUNDLE.
check() {
  require_docker
  log "Reading the desk CSS bundle the backend embeds in HTML…"
  LAST_BUNDLE="$(backend_desk_bundle)"
  if [ -z "$LAST_BUNDLE" ]; then
    err "Could not find a desk.*.css bundle in the backend. Has 'bench build' ever run?"
    return 2
  fi
  printf '    backend bundle: %s%s%s\n' "$DIM" "$LAST_BUNDLE" "$RST"
  log "Checking whether nginx (frontend) serves that exact file…"
  local code; code="$(served_status "$LAST_BUNDLE")"
  printf '    %s/assets/frappe/dist/css/%s -> HTTP %s\n' "$SITE_URL" "$LAST_BUNDLE" "$code"
  if [ "$code" = "200" ]; then
    ok "In sync — backend and frontend agree on asset hashes."
    return 0
  else
    warn "Out of sync — backend embeds '$LAST_BUNDLE' but nginx returns $code for it."
    return 1
  fi
}

fix() {
  require_docker

  log "Step 1/4 — Building fresh assets in the backend (owns the HTML manifest)…"
  docker exec "$BACKEND_CONTAINER" sh -c "cd $BENCH_DIR && bench build --hard-link 2>&1 | tail -5"
  ok "Backend build complete."

  log "Step 2/4 — Copying backend assets into the frontend (so nginx matches)…"
  local tmp; tmp="$(mktemp -d "${TMPDIR:-/tmp}/erp-assets-sync.XXXXXX")"
  trap 'rm -rf "$tmp"' RETURN
  docker cp "$BACKEND_CONTAINER:$BENCH_DIR/assets" "$tmp/"
  docker cp "$tmp/assets" "$FRONTEND_CONTAINER:$BENCH_DIR/"
  ok "Frontend assets replaced with the backend's copy."

  log "Step 3/4 — Restarting the backend so it picks up the fresh manifest…"
  if [ -d "$COMPOSE_DIR" ]; then
    ( cd "$COMPOSE_DIR" && PULL_POLICY=never docker compose -p "$COMPOSE_PROJECT" $COMPOSE_FILES restart backend )
  else
    warn "Compose dir '$COMPOSE_DIR' not found; falling back to 'docker restart $BACKEND_CONTAINER'."
    docker restart "$BACKEND_CONTAINER" >/dev/null
  fi
  ok "Backend restarted."

  log "Step 4/4 — Verifying the served assets now match…"
  # Give the backend a moment to come back up.
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if check >/dev/null 2>&1; then break; fi
    sleep 2
  done
  if check; then
    ok "Done. Hard-refresh the browser (Cmd+Shift+R) to drop any cached 404s."
  else
    err "Assets still out of sync after the fix. Inspect both containers' $BENCH_DIR/assets manually."
    exit 1
  fi
}

usage() {
  sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'
}

case "${1:-fix}" in
  check)        check ;;
  fix)          fix ;;
  -h|--help|help) usage ;;
  *) err "Unknown command: $1"; echo; usage; exit 2 ;;
esac
