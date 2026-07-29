# HER-55 — Hardware E2E Audit
**Rocco / 2026-07-29**
**Status: code audit complete, physical dry-run pending (Jul 30-31)**

---

## 1. What Was Done (Code + HTTP Only)

Branches read: `main` (HEAD `aad321b`)
Files read: `apps/alts/src/pages/print/ThermalTicketPrint.tsx`, `GarmentTagPrint.tsx`,
`apps/alts/src/lib/printUrls.ts`, `backend/src/routes/print.ts`,
`frappe/ls_alterations/ls_alterations/ls_thermal/api.py`, `escpos_tm.py`,
`frappe/ls_alterations/ls_alterations/api/scanner.py`,
`webapp/src/pages/Scanner.tsx`, `webapp/src/components/garment/GarmentTagRedirect.tsx`,
`webapp/src/App.tsx`, `apps/alts/src/App.tsx`, `backend/src/routes/intake-alterations.ts`

Live probes: ERP `LSH Print Settings` via localhost:8080 (authenticated Administrator).

---

## 2. Findings

### P1 — Receipt button sends wrong field to `/api/print/receipt` [FIXED]

**File:** `apps/alts/src/pages/print/ThermalTicketPrint.tsx:218`
**Commit:** `b37d0bc` on `main`

`/api/print/receipt` reads `body.invoice` (print.ts:177). The UI was sending
`{ ticket_name: ticket.name, what }` for both paths. Receipt button failed 100% of the time
with `invoice is required`. Fix: split payload by path — receipts get `{ invoice }`,
ticket/all get `{ ticket_name, what }`.

**Cannot verify without live Epson** — the fix is correct per code, not print-confirmed.

---

### P2 — Tag pipeline: ERP bakes `app.lstailors.com`, alts bakes `alts.lstailors.com` [OPEN]

**Decision (Maestro 2026-07-29):** LabelLife-only for tags, Epson for receipts only.
**Canonical QR host:** `alts.lstailors.com`

**Current ERP state (live, from LSH Print Settings):**
- `app_base_url`: `https://app.lstailors.com` ← WRONG per decision
- `thermal_printer_ip`: `10.0.1.41`
- `thermal_printer_port`: `9100`

**Tag QR paths and what host they currently bake in:**

| Source | Function | Current host | Decision |
|--------|----------|--------------|----------|
| `api.py:194` `print_ticket(what=tags)` | `{base}/g/{ticket}/{garment_id}` | `app_base_url` = `app.lstailors.com` | Change to `alts.lstailors.com` |
| `api.py:234` `print_garment()` | `{base}/g/{ticket}/{garment_id}` | `app_base_url` = `app.lstailors.com` | Change to `alts.lstailors.com` |
| `printUrls.ts:13-15` `garmentJobUrl()` | `ALTS_ORIGIN/g/{ticket}/{garmentId}` | `alts.lstailors.com` ✓ | No change |
| `intake-alterations.ts:16-18` `eTicketQrUrl()` | `APP_URL/e-ticket/{ticket}` | `app.lstailors.com` | This is e-ticket (SMS QR), not hang tag — stay on `app.` |

**Routes that handle `/g/:ticket/:garmentId`:**
- `alts.lstailors.com/g/...` → `<GarmentJobCard />` (no auth guard, line 142 alts/App.tsx) ✓ correct for floor use
- `app.lstailors.com/g/...` → `<GarmentJobCard />` behind `RoleGuard` — requires login. Tags printed by ERP today scan here → 401 for unauthenticated floor staff.

**Fix required:**
1. Update `LSH Print Settings.app_base_url` in ERP from `https://app.lstailors.com` to `https://alts.lstailors.com`
2. Keep `app.lstailors.com/g/` route as-is (redirect or authenticated job card) — do not remove, covers paper in the world
3. No code change to `api.py` needed (it reads `app_base_url` dynamically from settings)

**Effort:** 10 minutes (ERP settings change) + verification print.

---

### P2 — `/g/` auth: public shell, 401 API [OPEN, gated on SSO decision]

**Decision (Maestro):** Shared iPad SSO. Long-lived session on trusted devices, do NOT remove gate.

`alts.lstailors.com/g/:ticket/:garmentId` → `<GarmentJobCard />` — no auth guard on the route.
But `GarmentJobCard` calls `/api/garment/...` which requires auth → 401 if not logged in.
Result: shell renders, data 401s, card looks broken.

**Fix:** Long-lived session on the shared iPad. Login once → session persists.
No code change to remove the gate. Scope: iPad setup procedure, not a code change.

---

### P3 — Epson: browser thermal proof-only for Sep 1 [OPEN]

**Decision (Maestro):** Fix the `invoice`/`ticket_name` bug (done), stop there for Sep 1.
Driver work is post-launch.

**Cannot verify without hardware.** The ESC/POS byte build in `escpos_tm.py` is standard
but QR module size, cut, and actual print quality on real stock must be verified on the device.

---

### P3 — D520BT (LabelLife) [OPEN — hardware only]

`GarmentTagPrint.tsx` generates a print-ready 3in × 2in PDF page with QR at `ALTS_ORIGIN/g/...`.
Path: browser → system print dialog → Share → LabelLife. No Web Bluetooth in the code.
This is the correct architecture per the Sep 1 decision.

**Cannot verify without device.** What needs human hands:
- D520BT paired to iPad via Bluetooth
- LabelLife configured with the printer
- Actual tag stock loaded (3in × 2in continuous)
- Print one tag, confirm QR prints at legible size (52px or larger)
- Scan printed tag with iPad camera → should land on `alts.lstailors.com/g/{ticket}/{garment}`

---

### Scanner — `webapp/src/pages/Scanner.tsx` [code only]

Scanner reads camera, decodes QR, routes by payload format.
`frappe/ls_alterations/ls_alterations/api/scanner.py` handles scan-to-status calls.
No live device test was performed.

---

## 3. Floor Dry-Run Checklist
**For: C or designated tailor. Date: Jul 30-31, 2026. Duration: 2-4h.**
**Post results as a comment on HER-55.**

### Pre-flight (5 min)
- [ ] iPad logged in to `alts.lstailors.com` as a store user
- [ ] Epson TM-M30ii powered, connected to LAN at `10.0.1.41`
- [ ] D520BT powered, paired to iPad via LabelLife
- [ ] Tag stock loaded in D520BT (3in × 2in continuous)

### A. Epson — Office Receipt (5 min)
1. Open any alteration ticket in alts → Print → "Office + Customer receipts"
2. Expected: two receipts print from Epson. QR on receipt decodes to ticket URL.
3. Failure signal: toast "invoice is required" or no print → verify commit `b37d0bc` is deployed.
4. Record: did office copy print? Customer copy print? QR scan target?

### B. Epson — Ticket All (5 min)
1. Same ticket → Print → "Full ticket (all)"
2. Expected: office + customer + one tag per garment from Epson.
3. Record: did all three parts print? Tag layout legible? QR on tag points to which host?

### C. LabelLife — Garment Hang Tag (10 min)
1. Same ticket → Tags page (`/orders/alterations/{ticket}/tags`)
2. Confirm tags render on screen — ticket short code, customer name, due date, QR
3. Press Share → Print → LabelLife → D520BT
4. Expected: one 3in × 2in tag per garment. QR must be >= 52px and clean.
5. Record: did it print? Legible? QR intact?

### D. QR Scan — Garment Job Card (10 min)
1. Scan the printed LabelLife tag with iPad camera
2. Expected: opens `alts.lstailors.com/g/{ticket}/{garment}` → GarmentJobCard loads
3. Failure: if it opens `app.lstailors.com/g/...` → ERP `app_base_url` not yet updated (see P2 fix above)
4. Failure: if GarmentJobCard shows spinner/blank → session expired, log in again
5. Record: which host did the QR resolve to? Did the job card load?

### E. Scan-to-Status (10 min)
1. In alts, open Scanner (`/scanner`)
2. Scan the same printed tag QR
3. Expected: scanner decodes, shows ticket info, allows stage transition
4. Record: did scanner decode? What stage options appeared? Did stage update commit?

### F. Epson Printer Test (2 min)
1. ERP desk → LSH Print Settings → Test Printer
2. Expected: small diagnostic slip prints, QR prints on the slip
3. Record: did it print? What URL does the QR on the test slip point to? (Should be `app_base_url` — note it for the P2 settings fix)

### G. Tag pipeline host audit (manual, 5 min)
1. Print one ERP-side hang tag (via ERP form button, not alts)
2. Scan the QR
3. Record: which host? `app.` or `alts.`?
4. If `app.` → confirm P2 settings fix is needed before Sep 1

---

## 4. What Was Not Verified
- Physical Epson print quality, cut, QR decode from printed paper
- D520BT pairing, LabelLife workflow
- Camera decode of any printed QR
- Real scan-to-status on a live ticket
- `LSH Print Settings.app_base_url` effect on ERP-generated tags (settings confirm value is `app.lstailors.com`, fix is identified but not applied)

---

## 5. Next Actions (Rocco)
1. Apply P2 settings fix: update `app_base_url` to `https://alts.lstailors.com` in ERP — waiting for C confirmation before changing production data
2. Scanner state machine audit (2-4h code)
3. `/g/` SSO setup procedure
