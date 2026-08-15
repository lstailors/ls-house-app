# Alts data flow — counts, badges, and ERPNext

This document maps how **alts.lstailors.com** (`apps/alts`) talks to ERPNext, and where every dashboard / header / tab number is produced.

**Rule:** list endpoints may page. Badge and tile numbers must come from `GET /api/metrics`, which uses `frappe.client.get_count` (`erpCount`) — never `.length` of a row-limited list.

---

## How the app talks to ERPNext

```
Alts React (apps/alts)
  └─ React Query + api from @ls/api-client
       └─ GET/PATCH /api/...  (cookie session)
            └─ Hono backend (backend/src/index.ts and backend/src/app.ts)
                 └─ backend/src/lib/erp.ts
                      ├─ erpList  → GET /api/resource/{doctype}?limit_page_length=…
                      ├─ erpCount → GET /api/method/frappe.client.get_count
                      ├─ erpGet / erpCreate / erpUpdate
                      └─ DocType names: backend/src/lib/erpnext/doctypes.ts
```

Auth: `getAuthedUser` + role gates (`requireFloor`, `requireQc`, management checks). ERP credentials: `ERPNEXT_BASE_URL`, `ERPNEXT_API_KEY`, `ERPNEXT_API_SECRET`.

`erpList` is **capped**. Default callers pass `limit: 200–500`. Using `rows.length` as a house total is a bug.

---

## Canonical metric definitions

Implemented in `backend/src/lib/metrics.ts` and returned by `GET /api/metrics`. Timezone for “today” is **America/New_York**.

| Metric | ERPNext DocType | Filter | Notes |
|---|---|---|---|
| **open_alterations** | Alteration Ticket | `workflow_state not in [Picked Up, Cancelled]` | House-wide open tickets. |
| **tasks.open** | **ToDo** | `status = Open` | **A “task” is an ERPNext ToDo**, house-wide, not scoped to `allocated_to`. Not an HD Ticket. |
| **tasks.overdue** | ToDo | `status = Open` AND `date < today (NY)` | Empty `date` is **not** overdue. |
| **qc.waiting** | LSH QC Inspection | `qc_result = Pending` (fallback field: `result`) | Same query as `/qc` WAITING tab and the home QC tile. No make-order extras. |
| **qc.open** | LSH QC Inspection | same as waiting | Open tab is the Pending inbox (same COUNT). |
| **qc.passed / qc.failed** | LSH QC Inspection | `qc_result = Pass` / `Fail` | |
| **invoices.unpaid_count** | Sales Invoice | `docstatus = 1` AND `outstanding_amount > 0` | COUNT. |
| **invoices.unpaid_total** | Sales Invoice | same | **Sum** of `outstanding_amount` (paginated). Not a COUNT. |
| **deliveries.queued** | LSH Delivery | `lsh_status = Queued` | All currently queued. |
| **deliveries.out** | LSH Delivery | `lsh_status = Out for Delivery` | All currently out. |
| **deliveries.delivered_today** | LSH Delivery | `lsh_status = Delivered` AND `lsh_delivered_at` today NY | KPI label: **Delivered · today**. |
| **deliveries.on_hold** | LSH Delivery | `lsh_status in [Failed, Cancelled]` AND `modified >= today−6d` | KPI label: **On hold · 7d**. |
| **hd_tickets_open** | **HD Ticket** | `status not in [Closed, Resolved]` | Helpdesk, not ToDos. `/reports` OPEN HD. |
| **messages.texts** | LSH SMS Message | (all) | COUNT of SMS docs, not unread. |
| **messages.calls** | LSH Call Log | (all) | COUNT of call docs, not missed. |
| **messages.voice** | LSH Plaud Capture | (all) | |
| **messages.fittings** | Appointment | `scheduled_time` today NY `00:00:00`–`23:59:59` | Today’s appointments. |
| **messages.other** | — | reserved | Uncategorized leftover; 0 unless a new channel is added. |
| **messages.all** | — | **sum of the buckets** | `texts + calls + voice + fittings + other`. |

Task ≠ HD Ticket. Home Tasks tile and `/tasks` use ToDo COUNTs. `/reports` OPEN HD uses HD Ticket COUNT. They must each be internally consistent; they are not equal to each other.

---

## Count / badge sites (before → after)

### Home dashboard (`apps/alts/src/pages/HomeTiles.tsx`)

| Tile / strip | Was | Now |
|---|---|---|
| Tasks badge + “N open · M late” | `GET /api/tasks/open-count` — list `limit: 500`, **scoped to `allocated_to = user.email`**, `.length` | `metrics.tasks.open` / `overdue` |
| QC badge + waiting | `GET /api/qc/count` — `waitingRows().length` (list 200 + JS filter + make-order extras); gated `requireQc` | `metrics.qc.waiting` (same Pending COUNT as `/qc` WAITING) |
| Invoices unpaid $ / count | `/api/dashboard/alts-home` invoice list `limit: 500`, `.length` + summed outstanding | `metrics.invoices` |
| Strip: out for delivery / delivered today | alts-home delivery list `limit: 300`, `.length` | `metrics.deliveries.out` / `delivered_today` |
| Open alts / overdue / due today (shop live lines) | alts-home ticket list `limit: 400`, origin-filtered in JS | Shop **feeds** still from alts-home; comparable totals from metrics where listed above |

### `/qc` (`QcGlass.tsx` + `backend/src/routes/qc.ts`)

| Site | Was | Now |
|---|---|---|
| WAITING tab body | `waitingRows()`: list **all** inspections `limit: 200`, then `qcResultOf === "Pending"` + `isQcInspectionName`, plus MTM make-order extras | ERP filter `qc_result = Pending` (fallback `result`). Inspections only. |
| WAITING badge | Active-tab `shown.length` | `metrics.qc.waiting` |
| OPEN / PASSED / FAILED badges | Active-tab list length | `metrics.qc.open / passed / failed` |
| Home QC tile | same broken `waitingRows` | same Pending COUNT |

**Why WAITING showed 0 while ERP had 7 Pending (`LSH-QC-2026-00008/00012/00011`, `date_received` 2026-08-13):** the list pulled the 200 most recently *modified* inspections, then filtered in JS. Completed Pass/Fail rows crowded out the Pending ones. COUNT/list with an explicit Pending filter returns those 7.

### `/tasks` (`TasksGlass.tsx` + `backend/src/routes/tasks.ts`)

| Site | Was | Now |
|---|---|---|
| Header OPEN / OVERDUE | `GET /api/tasks?status=open&limit=200` then `openRows.length` / overdue-from-that-array → **200 cap leak** | `metrics.tasks` |
| Home Tasks tile | personal `open-count` list 500 → 165/164 | same house ToDo COUNTs |
| List | first 200, no pagination | `limit`/`start`, house `scope=house`; header is COUNT not page length |

ERP at audit: **312 open ToDos**, **370 open HD Tickets**.

### `/reports` (`Reports.tsx` + `GET /api/dashboard/floor-reports`)

| Site | Was | Now |
|---|---|---|
| Snapshot **OPEN HD** | HD Ticket `erpList` **`limit: 300`** then `.length` → **300** | `metrics.hd_tickets_open` (370 at audit) |
| Snapshot deliveries queued | list lengths | `metrics.deliveries.queued + out` |
| QC rates tiles | `/api/qc?tab=*` list lengths (last 200) | `metrics.qc.*` |

### `/deliveries` (`Deliveries.tsx` + `GET /api/deliveries`)

| Site | Meaning | Label |
|---|---|---|
| KPI Queued | COUNT currently Queued | **Queued** |
| KPI Out | COUNT currently Out for Delivery | **Out** |
| KPI Delivered | COUNT Delivered **today (NY)** | **Delivered · today** |
| KPI On hold | COUNT Failed+Cancelled **modified in last 7 days** | **On hold · 7d** |
| Column badge | Rows **in this view** (active + last **7d** history, not a 50-row cap) | Column title + **· this view** |

Was: KPI = `.length` of the loaded list (delivered history **limit 50** → KPI 50) vs column after search/filter (e.g. 18). Those are different questions; they are now labeled.

### `/messages` (`MessagesGlass.tsx`)

| Badge | Was | Now |
|---|---|---|
| ALL | `sms.length + calls + recordings + appts` (loaded window) | `metrics.messages.all` |
| TEXTS | `counts.unreadSms` (unread, not all texts) | `metrics.messages.texts` |
| CALLS | `counts.missedCalls` | `metrics.messages.calls` |
| VOICE | recordings in the feed | `metrics.messages.voice` |
| FITTINGS | today’s appointments | `metrics.messages.fittings` |
| Other | hidden leftovers | `metrics.messages.other` if > 0 |

Every message belongs to exactly one bucket. **ALL = texts + calls + voice + fittings + other.** Tab *contents* still show the live feed, but every loaded row is shown in its bucket (not unread/missed-only).

### `/pickup` bag (`PickupCounter.tsx`)

| Figure | Was | Now |
|---|---|---|
| Bag total | `sum(item.total)` | same, from `selectedItems` |
| Due | `sum(item.outstanding)` | same list |
| Ticket count | `kind === "ticket"` only → **0** when the bag is invoices that carry `ticketRef` | `kind === "ticket"` **or** `ticketRef` set |
| Invoice count | `kind === "invoice"` | invoices **without** `ticketRef` |

If bag total ≠ due, the header shows **paid vs due** (`paid = total − outstanding`). All three figures come from the same `selectedItems` array.

---

## Timezone / date rendering

- Store ERP datetimes as site wall clock (naive) or UTC-with-offset.
- Render in **America/New_York** (`packages/design/src/format.ts`).
- **Date-only** source (`YYYY-MM-DD`, or midnight `00:00:00`) → **“Jul 2”**, never “Jul 2, 12:00 AM”.
- Naive datetimes without `Z` are America/New_York wall clock (do not treat as UTC).

---

## Drift guard

`backend/src/lib/metrics.drift.test.ts`:

1. Unit: mocked `erpCount` — `getAltsMetrics()` COUNTs must match independent `erpCount` calls with the **same `METRIC_FILTERS`**.
2. Live (skipped unless `ERPNEXT_BASE_URL` is set): fetch metrics and re-COUNT each definition against ERPNext; fail on drift.

Wired in `.github/workflows/typecheck.yml` as `bun test` on the backend.
