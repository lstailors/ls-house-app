# Alts — ERP deploy + 30-minute floor walkthrough

**Goal:** Hang-tag / receipt QRs open **alts.lstailors.com**, then prove the floor loop on the shop iPad in ~30 minutes.

**Status:** Alts FOH code is on `main` and live. This run is **ops + hardware**, not more app code.

**Who:** Someone with ERP desk access (Administrator or Print Settings) + one person on the NYC floor iPad.

---

## Part A — ERP deploy (10–15 min)

Do **either** A1 (fastest) **or** A2 (full app). Prefer **both** when you can: settings stay correct even if code rolls back; code stays correct even if settings drift.

### A1 — Quick win: Print Settings only (no code deploy)

1. Open ERP desk → **LSH Print Settings**
2. Set **App Base URL** to:
   ```
   https://alts.lstailors.com
   ```
   (no trailing slash)
3. Save
4. Optional: **Test Printer** — scan the QR on the slip; host must be `alts.lstailors.com`

That alone fixes ERP-baked tag/receipt QRs that read `app_base_url`.

### A2 — Deploy `ls_alterations` (thermal coerce + DocType fields)

On the ERP host (Docker / bench where `ls_alterations` lives):

```bash
# Pull latest main (includes ls_thermal/api.py coerce + Alteration Ticket Line fields)
cd /path/to/frappe-bench   # or your compose project
# sync app from git as you usually do, then:
bench --site <site> migrate
bench --site <site> clear-cache
bench restart
```

What this unlocks:

| Piece | Why |
|-------|-----|
| `ls_thermal/api.py` `_public_base()` | Forces `alts.lstailors.com` even if Print Settings still say `app.` |
| `api/scanner.py` | Accepts both `alts.` and legacy `app.` `/g/` URLs |
| Alteration Ticket Line: `line_photos`, `estimated_minutes`, `client_line_key` | Line photo mapping + minutes write for real |

### A3 — API secret (backend, not ERP)

On the API that serves `app.lstailors.com` / alts API proxy, set:

```
E_TICKET_SECRET=<long random>
```

(or ensure `JWT_SECRET` / auth secret is set — e-ticket `?k=` falls back to that). Redeploy API after.

### Pass criteria for Part A

- [ ] Print Settings `app_base_url` = `https://alts.lstailors.com` **or** thermal `api.py` with `_public_base` is live
- [ ] New ERP test print / tag QR host = `alts.lstailors.com`
- [ ] (If migrated) DocType fields exist on Alteration Ticket Line

---

## Part B — 30-minute floor walkthrough

**Where:** NYC shop · shared iPad · Epson TM-M30ii · LabelLife D520BT  
**Ticket:** Use one real open alteration ticket (or a throwaway intake).

### Pre-flight (3 min)

- [ ] iPad browser → `https://alts.lstailors.com` · logged in as store user (session stays; do not clear)
- [ ] Epson on LAN (`10.0.1.41:9100` per last known Print Settings)
- [ ] D520BT paired · LabelLife ready · 3×2 continuous stock loaded

### 1. Epson receipt (5 min)

1. Open ticket → Print → **Office + Customer receipts**
2. Confirm both print (no “invoice is required” toast)
3. Scan receipt QR with camera → host should be **`alts.lstailors.com`**

**Fail:** Wrong host → Part A not live. “invoice is required” → alts print payload bug (should already be fixed on main).

### 2. LabelLife hang tag (8 min)

1. Ticket → **Tags** (`/orders/alterations/{ticket}/tags`)
2. Share → Print → LabelLife → D520BT
3. Confirm legible QR (≥ ~52px)
4. Camera-scan tag → opens **`alts.lstailors.com/g/{ticket}/{garment}`** · job card loads

**Fail:** Blank / spinner → re-login on iPad. Opens `app.…/g/` → tag was printed before Part A (reprint after A).

### 3. In-app scanner status (8 min)

1. Alts → **Scanner** (`/scanner`)
2. Scan the same hang-tag QR
3. Confirm decode + stage options · advance one stage · confirm it stuck

### 4. Legacy bounce (optional, 3 min)

1. Manually open an old `https://app.lstailors.com/g/...` URL (from an old tag if you have one)
2. Expect redirect / usable path toward alts job card (logged-in iPad)

### 5. Pass / fail log (2 min)

| Check | Result (✓/✗) | Notes |
|-------|--------------|-------|
| Receipt QR host | | |
| Hang-tag QR host | | |
| Job card loaded | | |
| Scanner stage advance | | |
| Epson cut / quality OK | | |

---

## What this cloud agent cannot do

- No ERP credentials / bench SSH in this environment — **A1/A2 must be done by whoever runs `erp.lstailors.com`**
- No physical Epson / D520BT / shop iPad — **Part B is on-site**

After Part A + B, post the pass/fail table (Slack / HER-55 / PR comment). Any ✗ with host = `app.` means Print Settings or thermal deploy did not land.

---

## Related

- Full hardware audit: `docs/audits/HER-55-hardware-e2e.md`
- Round 5 (thermal coerce): `docs/audits/ALTS_ROUND5_2026-08-01.md`
- Round 6 (`app./g/` → alts): `docs/audits/ALTS_ROUND6_2026-08-01.md`
