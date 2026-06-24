# ERPNext UI — Broken Icons / CSS (Asset Sync) — Runbook

ERPNext (`https://erp.lstailors.com`, self-hosted Docker / OrbStack) sometimes
loads with **black-blob icons, a collapsed sidebar/navbar, and some pages broken
while others look fine** — and `Cmd+Shift+R` doesn't help. This is an asset-hash
mismatch between Docker containers. There's a one-command fix below.

## TL;DR

```bash
# From this repo, on the Docker host (the Mac running erpnext-docker):
ops/erpnext-asset-sync.sh check   # is it this issue?
ops/erpnext-asset-sync.sh fix     # build → sync → restart → verify
# then hard-refresh the browser: Cmd+Shift+R
```

## Root cause

- `sites/assets` inside every container is a symlink → `<bench>/assets`.
- That target lives in **each container's own writable image layer**, *not* in
  the shared `erpnext_sites` Docker volume.
- **nginx** (frontend container) serves CSS/JS from *its own* copy of `assets`.
- The **backend** generates HTML embedding asset hash fingerprints from *its
  own* copy of `assets`.
- When the two copies drift, the backend embeds hash `X7G7CBRQ` in the HTML but
  nginx only has `DSFBOBQP` → **404 on every CSS/JS file → broken UI**.

The backend owns the HTML manifest, so the fix is always: rebuild in the
backend, then make the frontend's copy match.

### What knocks them out of sync

- Running `bench build` (or `bench build --app helpdesk`) in **only one**
  container.
- A full `bench build` running in the backend via scheduler or by hand.
- Containers recreated at different times picking up different image layers.

## Confirm it's this issue

```bash
# Hash the backend embeds in HTML:
docker exec erpnext-backend-1 sh -c \
  "ls /home/frappe/frappe-bench/assets/frappe/dist/css/" | grep desk

# Is that same file served by nginx? (404 = out of sync)
curl -s -o /dev/null -w "%{http_code}" \
  "https://erp.lstailors.com/assets/frappe/dist/css/desk.bundle.XXXX.css"
```

`ops/erpnext-asset-sync.sh check` automates exactly this comparison.

## The fix (what the script does, in order)

1. **Build fresh assets in the backend** — `bench build --hard-link`.
2. **Copy backend assets into the frontend** — via `docker cp` through a temp
   dir, so nginx serves matching files.
3. **Restart the backend** — so it picks up the fresh manifest.
4. **Verify** — re-check that nginx now returns `200` for the backend's bundle.

Then **hard-refresh** the browser (`Cmd+Shift+R`) to drop any cached 404s.

### Manual equivalent (if you can't run the script)

```bash
# 1. Build in backend
docker exec erpnext-backend-1 sh -c "bench build --hard-link 2>&1 | tail -5"

# 2. Sync backend → frontend
mkdir -p /tmp/erp-assets-sync
docker cp erpnext-backend-1:/home/frappe/frappe-bench/assets /tmp/erp-assets-sync/
docker cp /tmp/erp-assets-sync/assets erpnext-frontend-1:/home/frappe/frappe-bench/

# 3. Restart backend
cd /Users/Maestro_1/erpnext-docker && PULL_POLICY=never docker compose -p erpnext \
  -f compose.yaml \
  -f overrides/compose.noproxy.yaml \
  -f overrides/compose.mariadb.yaml \
  -f overrides/compose.redis.yaml \
  restart backend

# 4. Hard-refresh browser: Cmd+Shift+R
```

## Config / overrides

The script defaults match the current setup but everything is overridable via
env vars (container names, bench dir, site URL, compose dir/project/files). See
the header of [`ops/erpnext-asset-sync.sh`](../ops/erpnext-asset-sync.sh).

## Symptoms checklist

- ERPNext loads but icons render as solid black blobs.
- Sidebar/navbar layout is collapsed or broken.
- Some pages look fine, others broken (browser cached some assets, not others).
- `Cmd+Shift+R` alone doesn't fix it.
