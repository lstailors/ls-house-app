# Offline design — alts.lstailors.com

Local-first counter for L&S Alterations. ERPNext stays the source of truth.
This document is the spec. **Tier 1 (read-everything offline) is implemented.
Tier 2 (outbox writes) and Tier 3 (hardening) are specified here and not built yet — stop for review.**

---

## Step 0 — Current architecture

| Piece | What it is |
|---|---|
| App | `apps/alts` — React 18 + Vite CSR SPA (no SSR). Port 8010. |
| API | `backend` — Hono on Bun, port 3000. Alts talks to `/api/*` (same origin in prod; Vite proxy in dev). |
| ERPNext | Backend is the only ERP client (`erpList` / `erpGet` / `erpCount` / `erpCreate` / `erpUpdate`). The browser never calls Frappe directly. |
| Auth | HttpOnly cookie `lst_session` (8h sliding refresh via `POST /api/auth/refresh`) + optional Bearer fallback. `GET /api/me` is the session probe. `RoleGuard` blocks routes until `/api/me` resolves. |
| Data on screen | TanStack Query. Most lists hit Hono every 30–90s. Home live board polls `GET /api/metrics/live-home`. |
| Existing offline scraps | `vite-plugin-pwa` + Workbox already precaches the POS shell. `offlineQueue.ts` queues **intake ticket creates only** in `localStorage` (not IndexedDB, not idempotent, no local IDs). Intake drafts live in `localStorage`. |
| Rendering | Client-side only. Cold start needs `index.html` + hashed JS/CSS. Google Fonts are loaded from `fonts.googleapis.com` (must be cached for a true offline shell). |

### Routes (FOH)

`/`, `/login`, `/lookup`, `/scanner`, `/shop-floor`, `/progress`, `/pickup`, `/parked`, `/orders/alterations`, `/orders/alterations/:ticket`, `/intake/kind`, `/intake/alterations`, `/dispatch`, `/quote`, `/transfers`, `/appointments`, `/tasks`, `/messages`, `/house`, `/qc`, `/qc/:id`, `/customers`, `/customers/:id`, `/invoices`, `/invoices/:id`, `/deliveries`, `/deliveries/:id`, `/reports`, `/settings`, print/tag/receipt/pay/e-ticket surfaces.

---

## Write operations (Tier 2 spec)

Every write in the alts app. **can-work-offline?** is the contract for the outbox.

| Operation | ERPNext doctype | can-work-offline? | Notes |
|---|---|---|---|
| Create walk-in / custom / re-do ticket | Alteration Ticket (+ garments, lines, optional SI) | **queue** | Local ID `LOCAL-…`. Idempotency key required. |
| Create customer at intake | Customer | **queue** | Parent of ticket; sync first. |
| Park / delete parked cart | LSH Parked Cart | **queue** | Device-local until sync. |
| Status change (Received → In Progress → Ready → Picked Up) | Alteration Ticket | **queue** | Apply only if still a valid move on the server. |
| Mark progress / complete garment / hang-tag scan | Alteration Ticket Garment | **queue** | Scan resolve itself is read-only. |
| Assign tailor / due date / delay reason / transfer | Alteration Ticket | **queue** | Field LWW except money. |
| Add note / internal comment | Communication / ticket notes | **queue** | |
| Add work lines | Alteration Ticket Line | **queue** | |
| QC create / pass / fail / per-check | LSH QC Inspection | **queue** | Photos as IndexedDB blobs. |
| QC MTM status on Sales Order | Sales Order / MTMPro Order | **queue** | Valid-transition only. |
| Record **cash** payment + mark picked up | Sales Invoice + Alteration Ticket | **queue** | Money clash → always flag, never auto-resolve. |
| Ticket / garment / QC photos | File | **queue** | Blob in IDB; cap + warning. |
| Close / create house ToDo | ToDo | **queue** | |
| Appointment status | Appointment | **queue** | |
| Delivery create / status / POD | LSH Delivery | **queue** | POD photos as blobs. |
| Customer profile edit (name/phone/email) | Customer | **queue** | No notes/history bodies offline. |
| Send SMS / email / ready-text / unpaid-release SMS | LSH SMS Message + Twilio | **never** | “Needs internet — will be available when you're back online.” |
| Card-on-file charge | Square | **never** | |
| Terminal charge | Square Terminal | **never** | |
| Payment link / quote email | Square + email | **never** | |
| Text invoice receipt | Twilio | **never** | |
| DocuSeal sign / QC settings | DocuSeal | **never** | |
| Ask Rocco / brew espresso | LLM | **never** | Last cached espresso body is readable. |
| Reports / AI delivery copy | LLM + live aggregates | **never** | Last snapshot OK to show. |
| Address autocomplete / maps | Google | **never** | |

---

## Tier 1 — Read everything offline (implemented)

1. **PWA shell** — Workbox precache of JS/CSS/html/fonts/icons. `navigateFallback: /index.html` for all non-`/api` routes. `/api/*` stays NetworkOnly (data lives in IndexedDB, not the SW).
2. **IndexedDB (`Dexie`, db `alts-offline`)** — collections: `tickets`, `houseOrders`, `appointments`, `customers`, `invoices`, `catalog`, `qc`, `meta` (`lastSyncedAt` per collection).
3. **Hydrate** — `GET /api/offline/snapshot` on login and every 3 minutes while a heartbeat says ERP is reachable. Incremental via `?since=`.
4. **Local-first reads** — list/detail queryFns try network, fall back to Dexie. Also faster when online (stale-while-revalidate).
5. **Banner** — “Offline — showing shop data as of 4:12 PM. Changes will sync when you're back.”
6. **LIVE chip** — fourth state `OFFLINE` (gray dot).
7. **Live-only** — Reports, Messages inbox, activity ticker: “Needs connection” + last cached snapshot when we have one.

Session: `/api/me` is cached in `sessionStorage` so a reload while offline does not bounce to login.

---

## Tier 2 — Outbox + sync (not built — review gate)

- Single `writeOperation()` layer.
- Online: today’s Hono routes.
- Offline / network fail: outbox row `{id: uuid, type, payload, doctype, localTimestamp, deviceId, status}` + optimistic local row + pending badge.
- Never-offline ops: block with the copy above. Do not queue.
- Local IDs: `LOCAL-<uuid>`. Hang-tag QR encodes the local UUID. Permanent `localId → erpName` map.
- Sync: `online` event + ERP heartbeat (captive wifi lies). FIFO, one at a time, rewrite local IDs after parents land.
- Idempotency: client uuid on every create; server pre-check / unique field so a mid-flight retry cannot duplicate.
- Failures: exponential backoff; after N, `needs attention`. Never drop.
- Header: “Syncing 4 of 9…” → “All changes saved ✓”.
- Conflicts: status = apply if still valid else flag. Fields = LWW except **money / payments always flagged**. Sync review screen.

**Acceptance (when built):** offline walk-in + two pieces done + cash pickup → pending badges → reconnect → each doc once in ERPNext → IDs swap. Kill mid-sync → no duplicates.

---

## Tier 3 — Hardening (not built)

- `deviceId` on every op. Two iPads offline: FIFO + idempotency; same-field edits → Sync review.
- Quota warning. Queue survives logout; clear Dexie only on explicit logout, and only after “You have N unsynced changes.”
- Playwright: cold-start offline, full Tier-2 flow, mid-sync kill, conflict path.

---

## Sync sequence (Tier 2)

```
offline write → outbox(pending) + optimistic IDB
     │
reconnect / heartbeat OK
     │
FIFO: for each op
     ├─ rewrite LOCAL-* via idMap
     ├─ POST/PATCH with client uuid
     ├─ success → idMap, swap name, clear badge, drop outbox
     └─ fail → backoff; money fail → needs-attention (no blind retry)
```

## Local-ID lifecycle (Tier 2)

1. Create offline → `LOCAL-a1b2c3` on the ticket, pending badge, QR = local uuid.
2. Sync → ERP assigns `ALT-NYC-2026-00xxx`.
3. `idMap` keeps both keys forever. Lookup / scan resolves either.

## Adding a new offline-capable operation (future)

1. Add a row to the table above (`queue` vs `never`).
2. Route the UI through `writeOperation({ type, payload, doctype })`.
3. If it creates a doc, mint a local ID and register the map on success.
4. If it touches money, set `money: true` so conflicts never auto-resolve.
5. Add a Playwright case that goes offline, performs it, reconnects, asserts one ERP row.
