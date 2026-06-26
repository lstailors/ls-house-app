# Scanner Changes Summary

## What Changed

### New: ERPNext-native scanner (canonical, replaces everything)

**Files created in `frappe/ls_alterations/`:**

| File | Purpose |
|------|---------|
| `setup.py` | Frappe app package setup |
| `requirements.txt` | Python dependencies |
| `ls_alterations/__init__.py` | App version |
| `ls_alterations/hooks.py` | Frappe app hooks |
| `ls_alterations/modules.txt` | Module registration |
| `ls_alterations/api/__init__.py` | API package |
| `ls_alterations/api/scanner.py` | `resolve_qr` + all action handlers |
| `ls_alterations/page/lsh_scanner/__init__.py` | Page package |
| `ls_alterations/page/lsh_scanner/lsh_scanner.json` | Frappe page definition |
| `ls_alterations/page/lsh_scanner/lsh_scanner.py` | Page controller |
| `ls_alterations/page/lsh_scanner/lsh_scanner.js` | Full scanner UI + dispatch |
| `ls_alterations/doctype/lsh_scan_log/__init__.py` | Scan log package |
| `ls_alterations/doctype/lsh_scan_log/lsh_scan_log.json` | Scan log DocType definition |
| `ls_alterations/doctype/lsh_scan_log/lsh_scan_log.py` | Scan log controller |

### New DocType: LSH Scan Log

Added to the `ls_alterations` app (module `LS Alterations`). Fields:

| Field | Type | Purpose |
|-------|------|---------|
| `scanned_at` | Datetime | Timestamp of scan |
| `scanned_by` | Link→User | Who scanned |
| `raw_input` | Data | Original QR payload |
| `normalized_token` | Data | After URL stripping |
| `resolved_type` | Data | e.g. `lsh_delivery`, `sales_invoice` |
| `resolved_name` | Data | ERPNext doc name |
| `outcome` | Select | Resolved / Unknown / Error / Denied |
| `error_detail` | Small Text | Error message if any |

### What the scanner now handles

All 7 QR types in the L&S ecosystem:

| # | Type | QR patterns | Actions |
|---|------|-------------|---------|
| 1 | Sales Invoice | `SINV-*`, `my.lstailors.com/i/{name}?t=…` | Open, Mark Paid, Open Payment Link |
| 2 | Alteration Ticket | `ALT-*`, `LS-ALT-*`, `/e-ticket/ALT-*` | Open, lifecycle advance, Print Tag |
| 3 | Garment tag / Delivery | raw `lsh_qr_token`, `dashboard.lstailors.com/scan/{token}` **(fixed)**, query-style | Open, Mark Delivered, Send SMS |
| 4 | Tailor Transfer | `Tailor Transfer` doc name | Open, Confirm Receipt |
| 5 | Payment link | Square URL | Open Invoice, Mark Paid, Open Pay Link |
| 6 | Delivery note | `DN-NYC-*`, `DN-HOU-*` | Open, Mark Delivered |
| 7 | Custom Order | `LST-*` | Open, Print Tags |

### Critical bug fixed

**Path-style garment URL `dashboard.lstailors.com/scan/{token}`** — printed on all physical garment tags — was never being normalized by any code. The full URL was sent as a token and always failed. The new `normalize_token()` function in `scanner.py` correctly strips this pattern (and all other URL forms) before lookup.

### Removed: React/Vercel dead scanner code

| File removed | Reason |
|--------------|--------|
| `webapp/src/pages/intake/QRScanner.tsx` | Old React scanner — had auth issues, missing 4 of 7 types |
| `backend/src/routes/scan.ts` | Hono scan route used only by old React scanner |

| File modified | Change |
|--------------|--------|
| `webapp/src/App.tsx` | Removed lazy import + `/scan` route |
| `backend/src/index.ts` | Removed `scanRouter` import + mount |
| `backend/src/app.ts` | Same as above |

### Preserved: Public delivery tracking API

The `GET /api/scan/:token` and `POST /api/scan/:token/pod` endpoints used by the public driver delivery tracking page (`/d/:token`) have been **migrated** from the deleted `scan.ts` into a new dedicated `backend/src/routes/tracking.ts` file, mounted at `/api/scan`. No changes to `DeliveryTracking.tsx`.

### Updated: Scanner navigation links

Scanner links in the webapp now open `erp.lstailors.com/app/lsh-scanner` in a new tab instead of the deleted `/scan` route. (Frappe desk pages are served under `/app/<page>`; the bare `/lsh-scanner` path returns 404.)
- `webapp/src/components/shell/Sidebar.tsx`
- `webapp/src/components/shell/TopBar.tsx`
- `webapp/src/pages/Dashboard.tsx`

---

## Deploy Steps (run on `erpnext-backend-1`)

```bash
# 1. Copy app from this repo to the frappe-bench apps directory
#    (adjust path to your bench — commonly /home/frappe/frappe-bench)
cd /home/frappe/frappe-bench

# 2. Install the app if not already installed
bench get-app /path/to/repo/frappe/ls_alterations
bench --site erp.lstailors.com install-app ls_alterations

# 3. Migrate (creates LSH Scan Log DocType)
bench --site erp.lstailors.com migrate

# 4. Build (compiles JS assets, makes lsh_scanner.js available)
bench --site erp.lstailors.com build --app ls_alterations

# 5. Clear cache
bench --site erp.lstailors.com clear-cache

# 6. Restart workers (if using supervisor/systemd)
bench restart

# 7. Verify
#    Open https://erp.lstailors.com/app/lsh-scanner on an iPhone (must be logged into the Frappe desk)
#    Should show camera viewfinder with brass/forest-green design
```

### If already installed (update):

```bash
cd /home/frappe/frappe-bench
bench --site erp.lstailors.com migrate
bench --site erp.lstailors.com build --app ls_alterations
bench --site erp.lstailors.com clear-cache
bench restart
```

---

## Test Matrix

Use this matrix to verify on iPhone Safari after deploy:

| Type | Test input | Expected |
|------|-----------|----------|
| Delivery (token) | Raw `lsh_qr_token` value | Mark Delivered button |
| Delivery (path URL) | `https://dashboard.lstailors.com/scan/TOKEN` | Same as raw — bug fixed |
| Delivery (query URL) | `https://dashboard.lstailors.com/scan?token=TOKEN` | Same as raw |
| Delivery (DN name) | `DN-NYC-2026-00082` | Open + Mark Delivered |
| Alteration | `ALT-NYC-2026-00042` | Open + lifecycle buttons |
| Invoice | `SINV-NYC-2026-00100` | Open + Mark Paid |
| Invoice URL | `https://my.lstailors.com/i/SINV-NYC-2026-00100?t=tok` | Open + Mark Paid |
| Square URL | `https://squareup.com/pay-link/…` | Reverse-lookup → invoice |
| Custom Order | `LST-260001-1` | Open + Print Tags |
| Unknown | `garbage-token-xyz` | "Not an L&S code" message |
| Network down | Any token, airplane mode | "Can't reach server. Check connection." |
| Camera denied | Tap "Allow" then deny | How-to-enable instructions card |
| Session expired | Log out, try scan | "Session Expired" + Sign In button |
| Double-scan | Scan same token twice < 2s | Second scan ignored |

---

## Open Questions

1. **Tailor Transfer QR format** — What does the `qr_code` field on `Tailor Transfer Item` contain? If it stores the alteration ticket ID (`ALT-*`), then `ALT-` prefix detection already covers garment-level scans. If it's a separate UUID/token, a secondary lookup against `Tailor Transfer Item.qr_code` should be added to `_fallback_lookup()` in `scanner.py`.

2. **External driver POD endpoint** — The old `POST /api/scan/:token/pod` has been migrated to `tracking.ts`. If any external driver mobile app (outside this repo) calls this endpoint, it will continue to work unchanged. No action needed unless you move the endpoint path.
