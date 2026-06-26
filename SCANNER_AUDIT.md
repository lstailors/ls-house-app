# L&S Unified QR Scanner — Audit Report

**Date:** 2026-06-26  
**Repo:** `lstailors/ls-house-app`  
**Branch:** `cursor/qr-scanner-overhaul-2669`

---

## 1. Where the Scanner Lives Now

### Canonical target (ERPNext-native Frappe page)

| Item | Expected path | Status |
|------|--------------|--------|
| Frappe app root | `frappe/ls_alterations/` | **Empty directory — app does not exist in this repo** |
| Page definition | `frappe/ls_alterations/ls_alterations/page/lsh_scanner/lsh_scanner.json` | ❌ Does not exist |
| Page controller (Python) | `frappe/ls_alterations/ls_alterations/page/lsh_scanner/lsh_scanner.py` | ❌ Does not exist |
| Scanner UI (JS) | `frappe/ls_alterations/ls_alterations/page/lsh_scanner/lsh_scanner.js` | ❌ Does not exist |
| Resolver | `frappe/ls_alterations/ls_alterations/api/scanner.py` | ❌ Does not exist |

**Finding:** The ERPNext-native `lsh-scanner` page **does not exist anywhere in this repository.** `frappe/ls_alterations/` is an empty placeholder. The scanner page must be built from scratch and deployed to `erpnext-backend-1`. This explains the "blank screens / silent failures" — the canonical scanner was never created.

### Competing React/Vercel scanner (dead code — confirmed present)

| File | Route/purpose | Status |
|------|--------------|--------|
| `webapp/src/pages/intake/QRScanner.tsx` | React camera component, Html5Qrcode | ❌ Dead — to be removed |
| `webapp/src/App.tsx` line 44 + 157–160 | Lazy-loads QRScanner at `/scan` route | ❌ Route to be removed |
| `backend/src/routes/scan.ts` | Hono `GET /api/scan/:token` and `POST /api/scan/:token/pod` | ❌ Dead — to be removed |
| `backend/src/index.ts` line 16 + 73 | Mounts `scanRouter` at `/api/scan` | ❌ Import + mount to be removed |

**Note:** The `POST /api/scan/:token/pod` route in `scan.ts` contains POD (proof of delivery) photo-upload logic for external drivers. This is **separate from staff scanning** — the delivery team's `POST /api/deliveries/:id/pod` route in `deliveries.ts` covers the internal POD path. Confirm before removal whether any external driver app still hits this endpoint.

### Existing lsh_house Frappe app (in-repo, deployed)

`backend/erpnext/lsh_house/` contains the `lsh_house` Frappe app. It has no `page/` directory — no scanner page there. It does have `LSH Audit Log` doctype that can serve as a scan log.

---

## 2. resolve_qr Coverage Map

**There is no `resolve_qr` function today.** The closest equivalent is the Hono route `GET /api/scan/:token` in `backend/src/routes/scan.ts`, which is dead/incompatible (React-only, wrong auth model). The table below audits that dead code and the React `QRScanner.tsx` dispatch together, as if they were the "current scanner."

| # | Type | QR payload | Current detection | Branch | Coverage |
|---|------|-----------|-------------------|--------|----------|
| 1 | **Sales Invoice** | `SINV-*`, `my.lstailors.com/i/<name>?t=<token>` | None in dead scanner. `pay-info.ts` has invoice lookup but it's for the customer payment page, not staff scanner. | — | ❌ Missing |
| 2 | **Alteration Ticket** | `ALT-*`, `/e-ticket/ALT-*` | `QRScanner.tsx` regex `/^ALT-[A-Z]+-\d{4}-\d+$/` → direct navigate; `/e-ticket/` URL → direct navigate. Neither goes through API. No status, no advance-lifecycle action. | `handleToken()` lines 117–128 | ⚠️ Partial |
| 3 | **Garment tag** (delivery token) | raw `lsh_qr_token`, `dashboard.lstailors.com/scan/{token}` (path), `/scan?token=` (query) | `scan.ts` `GET /:token` looks up `LSH Delivery` by `lsh_qr_token`. **Path-style URL is NOT normalized** — raw URL string is sent as the token. Query-style is also not stripped. Only raw token works. | `scanRouter.get("/:token")` | ⚠️ Partial |
| 4 | **Garment transfer** (Tailor Transfer) | `Tailor Transfer` name or item `qr_code` field | Not handled anywhere | — | ❌ Missing |
| 5 | **Payment link** (Square pay URL) | Square URL `squareup.com/…` → reverse-lookup invoice | Not handled. Would hit `scan.ts` which does `LSH Delivery` lookup → returns 404. | — | ❌ Missing |
| 6 | **Delivery note** | `DN-NYC-*`, `DN-HOU-*` | `scan.ts` queries `LSH Delivery` by `lsh_qr_token`. If the DN name itself is scanned raw, it does NOT query by `name`. **DN-* names that aren't stored as QR tokens will fail.** | `scanRouter.get("/:token")` | ⚠️ Partial |
| 7 | **Custom order / Sales Order** | `LST-*` (LSH Custom Order name), linked Sales Order name | `QRScanner.tsx` has no detection. `scan.ts` does `LSH Delivery` lookup only → returns 404. | — | ❌ Missing |

**Summary:** 0 types fully covered. 3 types partially covered. 4 types entirely missing.

---

## 3. Normalizer Audit

### Current normalizer code

The React `QRScanner.tsx` has three client-side normalizers before the API call:

```
Pattern A:  /\/garments\/([^/?#]+)\/([^/?#]+)/           → navigate to garment page
Pattern B:  /\/e-ticket\/(ALT-[^/?#\s]+)/                → navigate to alteration
Pattern C:  /^ALT-[A-Z]+-\d{4}-\d+$/                    → navigate to alteration
```

Everything else is passed raw to `/api/scan/{token}`.

The Hono `scan.ts` does **zero** normalization — it passes the raw token directly to `erpList` filter.

### URL forms from the field — pass/fail

| URL / token form | Stripped? | Resolves? |
|-----------------|-----------|-----------|
| Raw `lsh_qr_token` (e.g. `a1b2c3d4…`) | — (no strip needed) | ✅ Yes, via `LSH Delivery` lookup |
| `dashboard.lstailors.com/scan/a1b2c3d4` **(path-style)** | ❌ Not stripped | ❌ Fails — full URL sent as token |
| `dashboard.lstailors.com/scan?token=a1b2c3d4` **(query-style)** | ❌ Not stripped | ❌ Fails |
| `delivered.lstailors.com/…` | ❌ Not stripped | ❌ Fails |
| `my.lstailors.com/i/SINV-NYC-001?t=tok` | ❌ Not stripped | ❌ Fails (no invoice lookup) |
| `ALT-NYC-2026-00042` (bare) | Pattern C → navigate | ⚠️ Navigates but no action dispatch |
| `/e-ticket/ALT-NYC-2026-00042` | Pattern B → navigate | ⚠️ Navigates but no action dispatch |
| Square pay URL `squareup.com/pay/…` | ❌ Not handled | ❌ Fails |
| `DN-NYC-2026-00082` (delivery name bare) | No strip needed | ❌ Fails — scan.ts queries by lsh_qr_token, not name |
| `LST-260001-1` (custom order) | Not handled | ❌ Fails |
| Token with whitespace / trailing `?` | Not trimmed | ❌ Fails |

**Prime suspect confirmed:** Path-style URL `dashboard.lstailors.com/scan/{token}` is what the physical garment tags print, and it is **not normalized by any current code path.** The full URL hits the API as the token, `LSH Delivery` lookup finds nothing, scanner shows error or blank.

---

## 4. JS Dispatch Audit

The React `QRScanner.tsx` action dispatch:

| Resolved type | Dialog rendered | Actions available | Broken? |
|--------------|----------------|-------------------|---------|
| `delivery` | Bottom sheet with name, customer, status, address | "Open" (navigate to `/deliveries/:name`) + "Scan again" | ⚠️ Opens the delivery detail page in the React app. No Mark Delivered, no POD trigger from scanner. |
| `alteration` | Bottom sheet with name, customer, status | "Open" (`/orders/alterations/:name`) + "Scan again" | ⚠️ Opens ticket. No advance-lifecycle action. |
| `sales_order` | Bottom sheet with name, customer, status | "Open" (`/sales-orders/:name`) + "Scan again" | Dead — `/sales-orders/:name` route exists but resolution never reaches it |
| `invoice` | Bottom sheet with name, customer, outstanding | "Open" (`/invoices/:name`) + "Scan again" | Dead — resolution never reaches invoice |
| `unknown` | Error card: "Could not look up this code." | "Scan again" | Visible but vague |
| Camera error | Text error with "Try again" link | — | ⚠️ No troubleshooting instructions |
| Network error | `setResult({ type: 'unknown' })` → "Could not look up this code." | — | ❌ Network errors indistinguishable from unknown tokens |

**Key dispatch problems:**
1. Scanner dispatches using the `type` string from the API response (`delivery`, `alteration`, `sales_order`, `invoice`), but the API (`scan.ts`) only ever returns `delivery`. All non-delivery types use the React-side sniff patterns only.
2. No in-scanner actions for any type — everything just navigates to a separate page. Staff can't Mark Delivered, Mark Paid, or advance lifecycle directly from a scan.
3. Debounce is handled by `scannedRef.current` (one-shot lock), but this requires page reset to scan again — no 2s debounce for multi-scan workflows.
4. Garment tag types (`garment`, `payment_link`, `warehouse_transfer`, `custom_order`) have zero dispatch logic.

---

## 5. Failure-Handling Audit

| Failure condition | Current behavior | Handled? |
|------------------|-----------------|----------|
| Unknown token | `setResult({ type: 'unknown', error: 'Could not look up this code.' })` | ⚠️ Visible but generic |
| Expired/revoked token | Same as unknown — no distinction | ❌ No |
| Malformed input / whitespace | Passed raw to API → 404 | ❌ No pre-sanitization |
| Network error | Caught in try/catch → same unknown result card | ❌ No "check connection" message |
| Camera permission denied | `setError('Camera access denied. Allow camera in browser settings.')` | ⚠️ Text only — no how-to-enable steps |
| Server 500 | Caught → unknown result card | ❌ No distinction from "not found" |
| Unauthenticated session | The `/scan` route in React has no `RoleGuard` — page loads but API calls may 401. The error is swallowed as "unknown." | ❌ No re-auth prompt |
| Blank screen on load | `Html5Qrcode` initialization can fail silently on some iOS Safari versions if video element isn't fully mounted yet | ❌ No guard |
| Double-scan of same token | `scannedRef.current` prevents double-resolve — but resets on page reset | ✅ One-time |
| Scanner still running on unmount | `useEffect` cleanup calls `stopScanner()` | ✅ Yes |

---

## 6. Competing / Dead Scanner Code in ls-house-app

### Files to remove

| File | What it is | Action |
|------|-----------|--------|
| `webapp/src/pages/intake/QRScanner.tsx` | React camera + dispatch component, the old scanner | **Delete** |
| `backend/src/routes/scan.ts` | Hono `/api/scan/:token` (GET delivery lookup + POST POD) | **Delete** (see note below on POD) |

### Lines to remove from existing files

| File | Lines | What |
|------|-------|------|
| `webapp/src/App.tsx` line 44 | `const QRScanner = lazy(...)` | Delete import |
| `webapp/src/App.tsx` lines 157–160 | `path="/scan"` + `<QRScanner />` Route | Delete route |
| `backend/src/index.ts` line 16 | `import { scanRouter } from "./routes/scan"` | Delete import |
| `backend/src/index.ts` line 73 | `app.route("/api/scan", scanRouter)` | Delete mount |

### POD endpoint note

`POST /api/scan/:token/pod` in `scan.ts` handles external driver proof-of-delivery photo upload. Before deleting, **confirm** whether any external driver app (mobile) still calls this endpoint. If so, the endpoint must be preserved or migrated to a clean non-scanner route (e.g. `/api/deliveries/:token/pod-public`). The internal delivery POD flow in `deliveries.ts` (`POST /api/deliveries/:id/pod`) covers the staff-side flow.

### No other scanner remnants found

- No `src/server/routes/scan.ts` (the file is at `backend/src/routes/scan.ts`)
- No React component named `ScanPage` or `Scanner` (only `QRScanner.tsx`)
- No `/pod` route
- No `pod-photos` Supabase storage logic (Supabase has been fully removed from this repo)
- The delivery dispatch board, delivery list, and delivery detail pages are untouched

---

## 7. The Fix List — Ordered, File-by-File

### A. Create the ERPNext Frappe app structure

The `ls_alterations` app files need to be created in `frappe/ls_alterations/`. Since the scanner is the only feature being built into this app (the existing `lsh_house` handles all other doctype/agent logic), we create a minimal app scaffold with just the page and scanner API.

**Files to create:**
```
frappe/ls_alterations/
  setup.py
  ls_alterations/
    __init__.py
    hooks.py
    modules.txt
    api/
      __init__.py
      scanner.py          ← resolve_qr + action methods
    page/
      lsh_scanner/
        __init__.py
        lsh_scanner.json  ← Frappe page definition
        lsh_scanner.py    ← page controller
        lsh_scanner.js    ← camera UI + dispatch
```

**Doctype for scan log:** Use the existing `LSH Audit Log` in `lsh_house` if its schema fits (it has: `customer`, `channel`, `content` style fields). Otherwise, add a minimal `LSH Scan Log` doctype to `lsh_house` with fields: `scanned_at`, `raw_input`, `normalized_token`, `resolved_type`, `resolved_name`, `outcome`, `scanned_by`.

### B. `frappe/ls_alterations/ls_alterations/api/scanner.py`

1. **`normalize_token(raw)`** — centralized normalizer. Strip whitespace. Detect and strip:
   - `dashboard.lstailors.com/scan/{token}` → token (path-style — **prime bug fix**)
   - `dashboard.lstailors.com/scan?token={token}` → token
   - `delivered.lstailors.com/…/scan/{token}` → token  
   - `my.lstailors.com/i/{name}?t={token}` → return `(name, token)` tuple for invoice flow
   - Square pay URL `squareup.com/pay-link/…` or `square.link/…` → keep full URL (type detected later)
   - Fragments `#…` stripped, trailing `?&` stripped

2. **`detect_type(token)`** — ordered type detection:
   1. Square URL → `payment_link`
   2. `my.lstailors.com/i/` URL → `sales_invoice`
   3. `SINV-` prefix → `sales_invoice`
   4. `ALT-` or `LS-ALT-` prefix → `alteration_ticket`
   5. `DN-NYC-` or `DN-HOU-` prefix → `lsh_delivery`
   6. `LST-` prefix → `custom_order` (LSH Custom Order name) or `sales_order`
   7. `TAG-` prefix → garment tag token
   8. Fallback: token-style (UUID/hash) → query `LSH Delivery.lsh_qr_token`; also query any other doctype that uses token field

3. **Resolver for each type:**
   - `sales_invoice`: `frappe.get_doc("Sales Invoice", name)` → return balance, square link, web invoice URL
   - `alteration_ticket`: `frappe.get_doc("Alteration Ticket", name)` → workflow state, available transitions
   - `lsh_delivery`: lookup by `name` or by `lsh_qr_token` → status, address, customer
   - `custom_order`: `frappe.get_doc("LSH Custom Order", name)` → garments, status
   - `tailor_transfer`: **NEED TO CONFIRM** — from `transfers.ts` the doctype is `Tailor Transfer` with `qr_code` child field. Scanning likely presents the item's `qr_code` value or the Tailor Transfer name. **Flag for confirmation before implementing.**
   - `payment_link`: `frappe.get_list("Sales Invoice", filters=[["lsh_square_payment_link","=",url]])` → invoice
   - `garment_tag` (TAG-* or raw token): query LSH Delivery first, then expand to other garment tables

4. **Consistent return shape** per spec (see Phase 2 in task)
5. **Permission check** via `frappe.has_permission` before returning doc data
6. **Scan log**: write to `LSH Audit Log` or new `LSH Scan Log` on every call
7. **Action methods** (whitelisted): `mark_delivered`, `mark_paid`, `advance_alteration_status`, `confirm_transfer` — each idempotent

### C. `frappe/ls_alterations/ls_alterations/page/lsh_scanner/lsh_scanner.js`

1. Camera via `frappe.ui.Scanner` (Html5-QRCode native Frappe wrapper) — rear camera default
2. Camera-denied → glass card with iOS/Android how-to-enable steps
3. Manual entry text input fallback → same `resolve_qr` call
4. 2-second debounce on duplicate reads (Set + setTimeout)
5. Haptic (`navigator.vibrate`) + success toast before action dialog
6. Dispatch on `result.type` (machine key) — render contextual dialog per type
7. Action dialog per type:
   - `sales_invoice`: "Open in ERPNext" | "Mark Paid" | "Open Square Link" | "Scan Again"
   - `alteration_ticket`: "Open Ticket" | advance-status buttons from `result.actions` | "Print Tag" | "Scan Again"
   - `lsh_delivery`: "Open Delivery" | "Mark Delivered" (triggers POD flow) | "Send SMS" | "Scan Again"
   - `custom_order`: "Open Order" | "Print Tags" | "Scan Again"
   - `tailor_transfer`: "Open Transfer" | "Confirm Receipt" | "Scan Again"
   - `payment_link`: "Open Invoice" | "Open Payment Link" | "Mark Paid" | "Scan Again"
   - `garment_tag`: "Open Garment/Delivery" | lifecycle-advance buttons | "Scan Again"
8. Error states:
   - Unknown → "Not an L&S code, or no longer active." + Scan Again
   - Expired/revoked → "This QR code is no longer active. Contact the shop."
   - Network → "Can't reach the server. Check connection and retry."
   - Camera → troubleshooting card
   - Session expired → re-auth prompt (redirect to ERPNext login, return to scanner)
9. Mobile-first CSS (no white backgrounds; Forest Green / Brushed Brass design system)

### D. `frappe/ls_alterations/ls_alterations/page/lsh_scanner/lsh_scanner.json`

Frappe page definition: `name: "lsh-scanner"`, `module: "LS Alterations"`, `page_name: "lsh-scanner"`, requires `System User` role minimum.

### E. Action handlers in `scanner.py`

- `mark_delivered(delivery_name)` — idempotent; check `lsh_status == "Delivered"` before update
- `mark_paid(invoice_name, method)` — check `outstanding_amount == 0` before creating JE
- `advance_alteration_status(ticket_name, to_state)` — validate transition is allowed; idempotent
- `confirm_transfer(transfer_name)` — mark items received; idempotent double-scan guard
- All return `{"ok": True/False, "message": "..."}` shape

### F. Dead code removal (ls-house-app)

1. Delete `webapp/src/pages/intake/QRScanner.tsx`
2. Remove lazy import + `/scan` route from `webapp/src/App.tsx`
3. Delete `backend/src/routes/scan.ts` (after confirming external POD endpoint fate)
4. Remove import + mount of `scanRouter` from `backend/src/index.ts`

### G. Scan log doctype (lsh_house app)

Add `LSH Scan Log` doctype to `backend/erpnext/generate_doctypes.py` and regenerate. Fields:
- `scanned_at` (Datetime, reqd)
- `scanned_by` (Link: User)
- `raw_input` (Data)
- `normalized_token` (Data)
- `resolved_type` (Data)
- `resolved_name` (Data)
- `outcome` (Select: Resolved / Unknown / Error / Denied)
- `error_detail` (Small Text)

### Open question before Phase 2

> **Tailor Transfer QR format (#4):** `transfers.ts` creates `Tailor Transfer` docs with child items that have a `qr_code` field. What value does that field contain — the alteration ticket ID (`ALT-*`), a standalone UUID, or something else? Scanning a physical QR code on a transferred garment would give that value. If `qr_code` stores the alteration ticket ID, then ALT-* detection already covers this. If it's a standalone token, the resolver needs to query `Tailor Transfer Item.qr_code`. **Confirm before implementing #4.**

---

## Summary of Current State

| Item | Status |
|------|--------|
| ERPNext-native `lsh-scanner` page | Does not exist — must be built from scratch |
| `resolve_qr` Python function | Does not exist — must be built from scratch |
| React/Vercel scanner | Exists, partially functional for 3 of 7 types, auth-unsafe, dead-code |
| Path-style garment URL normalization | Broken — confirmed root cause of "scanned but won't resolve" |
| Payment link reverse-lookup | Missing entirely |
| Warehouse transfer scanning | Missing entirely |
| Sales Invoice scanning | Missing entirely |
| Custom order scanning | Missing entirely |
| Failure messages | Generic; network ≡ unknown; camera ≡ one-liner |
| Scan audit log | None |
