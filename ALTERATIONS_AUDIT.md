# ALTERATIONS AUDIT — L&S House

**Scope** Everything alterations-related in `lstailors/ls-house-app`, and where it is entangled with dashboard/admin code.
**Repo state** HEAD `ecbc7e6` (2026-07-26), branch `main`, 3 dirty files. Frappe submodule `frappe/ls_alterations` HEAD `17801bd` (2026-06-01), branch `feature/payment-billing`.
**Method** Read-only. Source read directly; live ERPNext queried read-only for corroboration. No application code written, no files changed except this report.
**Live corroboration** 30 Alteration Tickets exist — **all `origin_location = NYC`, zero HOU**. States: Received 18, Picked Up 7, Ready 4, In Progress 1. `Alteration Ticket Workflow` is `is_active: 1`.

> **Two caveats that bound this audit.**
> 1. **The Frappe app is not fully on disk.** All four core alteration DocTypes, `api.py`, the Workflow doc, fixtures and patches are **deleted in the working tree** and exist only in git HEAD. On-disk `hooks.py` is a 9-line stub with **zero `doc_events`**. Claims about them are cited `HEAD:path:line`. See §3.0.
> 2. **`webapp/CLAUDE.md` could not be read** — the file tool blocked it as a suspected prompt-injection payload (`deception_hide`). Two independent agents hit the same block. Nothing here depends on it. **Flagged as a finding in §7; it warrants human review.**

---

## 1. Route + screen inventory

`webapp/src/App.tsx` — 58 routes. Column **Target**: `ALTS` → new alterations app, `ADMIN` → stays, `SHARED` → both need it.

### 1.1 Public / unauthenticated (outside `AppShell`)

| Path | Component | Purpose | Users | Target |
|---|---|---|---|---|
| `/login` | `Login.tsx` | Credential entry | all | **SHARED** |
| `/pay/:invoiceId` | `PayInvoice.tsx:389L` | Client pays invoice | client | **SHARED** |
| `/e-ticket/:ticketName` | `ETicket.tsx:214L` | Client ticket lookup | client | **ALTS** |
| `/d/:token` | `DeliveryTracking.tsx` | Delivery tracking | client | ADMIN |
| `/orders/alterations/:ticketName/tags` | `AlterationTags.tsx:178L` | Thermal garment tags | FOH | **ALTS** |
| `/orders/alterations/:ticketName/receipt` | `AlterationReceipt.tsx:191L` | Thermal receipt | FOH | **ALTS** |
| `/deliveries/:id/label` | `DeliveryLabel.tsx` | Delivery label print | driver | ADMIN |

`App.tsx:82-100`. The three print routes sit outside `AppShell` deliberately so only content renders.

### 1.2 Alterations core (inside `AppShell`)

| Path | Component | Purpose | Users | Target |
|---|---|---|---|---|
| `/intake/alterations` | `IntakeAlterations.tsx:1725L` | Intake: customer, garments, lines, cart | FOH, tailor | **ALTS** |
| `/orders/alterations` | `OrdersAlterations.tsx:194L` | Ticket list | FOH, tailor, mgr | **ALTS** |
| `/orders/alterations/:ticketName` | `TicketDetail.tsx:1433L` | Ticket detail, status, SMS, print, pay | FOH, tailor, mgr | **ALTS** |
| `/g/:ticket/:garmentId` | `GarmentJobCard.tsx:223L` | Shop-floor job card (QR target) | tailor | **ALTS** |
| `/garments/:ticketId/:garmentId` | `GarmentTagRedirect.tsx:16L` | Redirect shim to `/g/` | — | **ALTS** (retire) |
| `/scanner` | `Scanner.tsx:372L` | QR scanner | all staff | **SHARED** |

`App.tsx:131-177`. All guarded `["super_admin","store_manager","salesperson","tailor"]` except `/scanner`, which adds `driver`.

### 1.3 Not alterations, despite appearances

| Path | Component | Reality | Target |
|---|---|---|---|
| `/shop-floor` | `ShopFloor.tsx:255L` | **YZ custom-order production**, not alterations. Uses `useYzProduction` (`ShopFloor.tsx:7`); zero alteration calls. Tailor-gated, so it reads as shop work. | **ADMIN** |
| `/admin/board` | `AdminBoard.tsx:31L` | Alterations board, filed under Admin, granted to `super_admin` + `salesperson` (`App.tsx:309`) | **ALTS** |

### 1.4 Admin / management (abridged — all **ADMIN**)

`/`, `/mission-control`, `/house`, `/mission-control/agents/:slug`, `/orders/custom`, `/orders/custom/:id`, `/sales-orders`, `/sales-orders/:id`, `/invoices`, `/invoices/:id`, `/deliveries`, `/deliveries/:id`, `/communications`, `/financials`, `/settings`, `/reference/fabrics`, `/reference/styles`, `/admin/users`, `/admin/locations`, `/admin/locations/:code`, `/admin/tailors`, `/admin/overview`, `/academy`, `/tasks`, `/comms`, `/sofia`, `/dispatch`, `/customers`, `/customers/new`, `/customers/:id`, `/calendar`, `/appointments`, `/helpdesk`, `/helpdesk/:id`.

`/customers*` is **SHARED** in practice — intake needs customer search and create (`IntakeAlterations.tsx:212`).

### 1.5 Orphaned pages — routed nowhere

| File | Lines | Status |
|---|---|---|
| `webapp/src/pages/orders/AlterationDetail.tsx` | 511 | Not imported in `App.tsx`. Superseded by `TicketDetail.tsx`. **Dead.** |
| `webapp/src/pages/GarmentTag.tsx` | 251 | Not imported. Superseded by `GarmentJobCard.tsx`. **Dead.** |
| `webapp/src/pages/Placeholder.tsx` | — | Not imported. **Dead.** |

762 lines of dead alterations UI. Deleting these before the split avoids porting them.

---

## 2. Component + module inventory

### 2.1 ALTERATIONS-ONLY

| File | Lines | Note |
|---|---|---|
| `components/alterations/AlterationsBoard.tsx` | 146 | **Consumed only by `pages/admin/AdminBoard.tsx:3`** |
| `components/alterations/AlterationDailyBrief.tsx` | 203 | |
| `components/alterations/AlterationKpiBar.tsx` | 150 | Labels hardcode "Stella WIP"/"Hugo WIP" (`:66,:72`) |
| `components/alterations/CompleteGarmentModal.tsx` | 244 | |
| `components/alterations/EditTicketDrawer.tsx` | 450 | |
| `components/alterations/SaveCartControls.tsx` | 133 | |
| `components/alterations/TransferButton.tsx` | 30 | |
| `components/alterations/TransferModal.tsx` | 490 | |
| `components/garment/*` (6 files) | 387 | Job card, work list, measurements, format |
| `components/scanner/ScannerResultSheet.tsx` | 245 | |
| `lib/thermal.ts` | 156 | ESC/POS XML builders |
| `lib/cart/parked.ts` | 38 | Types only; root twin throws "Supabase removed" |

### 2.2 SHARED — with the exact coupling named

| File | Lines | Coupling |
|---|---|---|
| `lib/api.ts` | 115 | Fetch wrapper. Reads token from `authClient`, unwraps `{data}`. Every call in both halves. |
| `lib/authClient.ts` | 42 | **`localStorage["lst_token"]`** (`:2,5`). Origin-scoped — see §6. |
| `lib/session.ts` | 36 | `useMe()` → `GET /api/me`. `RoleGuard` depends on it. |
| `lib/scope.ts` | 13 | Role predicates. **Diverges from backend — see §7 D2.** |
| `lib/locationContext.tsx` | 62 | `localStorage["lsh.activeLocationId"]`; NYC/HOU filter. Intake reads `origin`. |
| `lib/queries.ts` | 926 | **78 hooks in one file**; only 4 are alterations (`:85,219,228,237`). Import it for alterations and you pull deliveries, helpdesk, YZ, financials. |
| `lib/types.ts` | 3 | **`export * from "../../../backend/src/types"`** — reaches outside the webapp root. §8. |
| `components/glass/*` (8) | — | Design-system primitives. Clean to extract. |
| `components/pos/CustomerEditSheet.tsx` | — | Used by intake (`IntakeAlterations.tsx:13`) and custom orders. |
| `components/payments/*` (2) | 396 | Square Terminal charge + pairing; alterations and custom orders. |
| `components/shell/*` (6) | 1,129 | `Sidebar.tsx:38-100` is one `SECTIONS` array mixing Workshop/Ops/Admin. `RoleGuard.tsx` used by every route. |

### 2.3 ADMIN-ONLY (touched by alterations data, not alterations flow)

`components/dashboard/AlterationsPipeline.tsx` (120L) — renders alteration counts on the admin dashboard (`Dashboard.tsx:21,403`). Named "Alterations" but is an admin widget; **stays**.
`components/shop-floor/*` (11 files) — YZ production. **Stays.**

### 2.4 UNCLEAR

| File | Question |
|---|---|
| `lib/pricing.ts` (128L) | Custom-tailoring only (`CONSTRUCTION_LABOR`, `STYLE_UPCHARGE`). Alterations price from ERPNext presets. Named generically; likely **ADMIN**, but `suggestedDeposit()` (`:93`) may be wanted by alterations checkout. |
| `lib/shopFloor.ts` | Pure helpers (`matchesQuery`, `computeStats`); YZ-shaped but generic. |

### 2.5 Orphaned duplicate trees

`vercel.json:3-5` builds **only** `webapp/`. These root dirs are therefore not in any build:

| Path | Live twin |
|---|---|
| `components/alterations/AlterationsBoard.tsx` | `webapp/src/components/alterations/AlterationsBoard.tsx` |
| `components/alterations/SaveCartControls.tsx` | `webapp/src/components/alterations/SaveCartControls.tsx` |
| `lib/erpnext/alterations-data.ts` | `backend/src/lib/erpnext/alterations-data.ts` |
| `lib/erpnext/customer.ts`, `lib/cart/*` (3) | scattered |
| `app/api/customers/route.ts` | `backend/src/routes/customers.ts` |

Diff-level divergence was **not** established — the subagent assigned to it timed out at 600 s. Treat as *unverified duplicates*; diff before deleting.

---

## 3. Data model

### 3.0 Precondition — the app is split across git states

| Fact | Evidence |
|---|---|
| Branch `feature/payment-billing`, HEAD `17801bd` | `git -C frappe/ls_alterations log -1` |
| All 4 core DocType dirs **deleted in working tree**; only `.pyc` remain | `git status --short` |
| `hooks.py` on disk is a **9-line stub**; HEAD version is 305 lines | `frappe/ls_alterations/ls_alterations/hooks.py:1-9` |
| `api.py`, `fixtures/`, `workflow/`, `patches/`, `print_format/` all deleted | `git status --short` |
| `ls_square` module **does not exist anywhere in repo** but is imported | `.../api/invoices.py:112`, wrapped in try/except → silently no-ops |

**Consequence:** `bench migrate` from this checkout installs no alteration schema and registers zero `doc_events` — invoice auto-creation, totals, and naming series would all silently stop.

### 3.1 `ls_alterations` DocTypes — module `LS Alterations`, **none submittable**

**`Alteration Ticket`** — `HEAD:.../alteration_ticket/alteration_ticket.json`, `autoname: "naming_series:"` (`:4`)

| field | type | options / note | reqd | line |
|---|---|---|---|---|
| `naming_series` | Select | `ALT-NYC-.YYYY.-`, `ALT-HOU-.YYYY.-` | ✔ | :56 |
| `customer` | Link → Customer | | ✔ | :63 |
| `customer_name` / `customer_phone` | Data | fetch_from customer | | :74,:83 |
| `origin_location` | Select | `NYC`, `HOU` | ✔ | :94 |
| `ticket_date` / `due_date` / `promised_date` | Date | | ✔/✔/– | :103,:111,:119 |
| `is_rush` | Check | default 0 | | :125 |
| `workflow_state` | Select | Received / In Progress / Ready / Picked Up / Cancelled | ✔ | :133 |
| `garments` | **Table** → Alteration Ticket Garment | | ✔ | :147 |
| `lines` | **Table** → Alteration Ticket Line | | ✔ | :159 |
| `ticket_total` | Currency USD | read_only | | :171 |
| `sales_invoice` | Link → Sales Invoice | read_only | | :183 |
| `payment_status` | Select | Unpaid / Partially Paid / Paid / Overdue / N/A — read_only | | :193 |
| `linked_sales_order` | Link → Sales Order | | | :203 |
| `included_in_custom` | Check | | | :214 |
| `billing_status` | Select | Billable / Included in Custom Order / Warranty | | :220 |
| `delivery_method` | Select | Pickup / Hand Delivery / Courier | ✔ | :235 |
| `notified_ready_at` / `picked_up_at` / `paid_at` | Datetime | read_only | | :245,:252,:275 |
| `square_transaction_id` / `square_payment_method` | Data / Select | | | :263,:269 |
| `paid_by_employee` | Link → Employee | | | :282 |
| `internal_notes` / `customer_notes` | Text | | | :294,:299 |
| `invoice_ninja_id` | Data | **legacy debt** | | :310 |
| **`supabase_id`** | Data | **Supabase UUID — debt, §7** | | :316 |

**`assigned_tailor` is NOT defined** in the JSON, yet is filtered on by `backend/src/routes/alterations.ts:174-175` and patched by `intake-alterations.ts:414`. Live data shows it populated (`ALT-NYC-2026-00047.assigned_tailor = HR-EMP-00004`), so it exists as an **undeclared live DB column**.

**`Alteration Ticket Garment`** (`istable:1`) — `garment_id`✔, `garment_type`✔ (10 opts), `color`, `fabric_notes`, `garment_description`, `garment_total`, `garment_status` (Received/In Progress/Ready/Picked Up).
**`Alteration Ticket Line`** (`istable:1`) — `garment_ref`✔ (**free-text `Data`, not a Link** — integrity by convention only), `preset` → Alteration Preset, `description`✔, `price`✔, `tailor` → Employee, `line_status` (Pending/In Progress/Done), `line_notes`.
**`Alteration Preset`** — `autoname: field:preset_name`; `default_price`✔ + `default_price_hou`, `estimated_minutes`, `is_active`. Option list **omits** `Suit (2pc)`/`Suit (3pc)` that the garment child has — schema drift.
**`LSH Scan Log`** (on disk) — scan audit trail; `outcome` ∈ Resolved/Unknown/Error/**Denied** (never written).

### 3.2 Custom fields on stock DocTypes

**Declared by fixture — exactly one:** `Sales Invoice.alteration_ticket_ref` (Link → Alteration Ticket, read_only) — `HEAD:fixtures/custom_field.json:1-15`.

**Used but declared nowhere in the repo** (live DB rows only — `lsh_house/fixtures/custom_field.json` defines only `Customer-custom_*` ×19 and `User-lst_location`):

| DocType | Field | Used at |
|---|---|---|
| Sales Invoice | `lsh_square_payment_link` | `invoices.py:109,117-123`; `scanner.py:175` |
| Sales Invoice | `lsh_invoice_web_url` | `invoices.py:97-105` |
| Sales Invoice | `lsh_square_payment_id` | `invoices.py:27-29` |
| Sales Order | `lsh_square_payment_id` | `invoices.py:54-56` |
| LSH Delivery | `lsh_status`, `lsh_qr_token`, `lsh_alteration_ticket`, `lsh_supabase_delivery_no`, +5 | `scanner.py`, `deliveries.ts` |
| User | `lst_location` | `scope.ts:50,65` |

**No `qr_`-prefixed custom field exists on any stock DocType.** `Alteration Ticket Garment.qr_token` exists live (confirmed via ERPNext) but is populated on **zero** rows.
**`LSH Delivery`, `Tailor Transfer`, `LSH Notification Log` have no DocType JSON under version control**, despite being mutated by `scanner.py` and `transfers.ts`. `Tailor Transfer` + `Tailor Transfer Item` confirmed live in module `LS Alterations`.

### 3.3 Naming series

`ALT-NYC-.YYYY.-` / `ALT-HOU-.YYYY.-` — options at `HEAD:alteration_ticket.json:59`; **force-assigned from `origin_location`** in `before_insert` (`alteration_ticket.py:23-26`), so the Select is derived, not chosen. Same hook assigns garment IDs `G1..Gn` (`:27-29`).
Company routing `alteration_ticket.py:12-15`: `{"NYC": "L&S Tailors NY LLC", "HOU": "L&S Tailors TX, LLC"}` — **note these full names differ from the LSTNY/LSTX abbreviations**, which appear only in GL account strings and invoice prefixes.

### 3.4 Workflow — one active definition, **three divergent code copies**

Live `Alteration Ticket Workflow`, `is_active:1`, field `workflow_state`, all states `doc_status:0`:

| From | Action | To | Allowed |
|---|---|---|---|
| Received | Start Work | In Progress | Sales User |
| In Progress | Mark Ready | Ready | Sales User |
| Ready | Mark Picked Up | Picked Up | Sales User |
| Received / In Progress / Ready | Cancel | Cancelled | Sales Manager |
| Cancelled | Reopen | Received | Sales Manager |

Divergent copies: `scanner.py:594-598` (3 transitions, **no Cancel/Reopen**); `backend/src/routes/alterations.ts:41-67` (includes Cancel/Reopen, gated on app roles); `alterations-data.ts:9-13` adds states **`Complete`** and **`Delivered`** that exist in neither.

**Five write paths — three bypass the engine:**

| # | Mechanism | Location | Bypass |
|---|---|---|---|
| 1 | `apply_workflow` | `alteration_ticket.py:412` | no |
| 2 | **raw SQL `UPDATE`** | `HEAD:api.py:194-198` | **yes, deliberate** (docstring `:157-158`) |
| 3 | `frappe.db.set_value` | `scanner.py:615` | **yes** |
| 4 | direct assign on insert | `HEAD:api.py:74`; `parked-carts.ts:123` | create |
| 5 | `apply_workflow` via REST | `alterations.ts:350`; `intake-alterations.ts:478` | no |
| 6 | **`erpUpdate(workflow_state)`** | **`transfers.ts:83,88`** | **yes** — see §7 D4 |

Other enums: `payment_status` — **`Overdue` never written** (dead). `billing_status` — `Warranty` settable only by hand. `garment_status` rolled up in `validate` (`alteration_ticket.py:77-115`). **`current_location` does not exist anywhere in the repo** (grep-verified zero matches).

### 3.5 Permissions / roles — three vocabularies

| Layer | Vocabulary |
|---|---|
| DocType JSON + Workflow | `System Manager`, **`Sales User`**, **`Sales Manager`** |
| Scanner page + `LSH Scan Log` | **`LST Super Admin`**, `LST Store Manager`, `LST Salesperson`, `LST Tailor` |
| App backend | **`super_admin`**, `store_manager`, `salesperson`, `tailor`, `driver` (`scope.ts:21-30`) |

An `LST Tailor` can open the scanner page but has **no declared permission on Alteration Ticket** — every `frappe.has_permission("Alteration Ticket", …, throw=True)` (`scanner.py:182,600`) would throw unless granted separately in the live DB. **No `frappe.has_role` check exists in any Python file**; gating is declarative only. `ignore_permissions=True` is used for Item, Sales Invoice, Payment Entry and scan-log writes (`alteration_ticket.py:135,210`; `invoices.py:24,51`).

### 3.6 Server hooks + invoice auto-creation

`HEAD:hooks.py:141-165` — `before_insert: set_naming_series`; `validate: ensure_rush_surcharge, compute_totals, rollup_line_to_garment, set_payment_status_na`; **`after_insert: create_sales_invoice, notify_n8n`**; `on_update: auto_notify_when_all_ready, notify_n8n_on_state_change`; `Payment Entry on_submit: sync_payment_to_ticket`. Second app `lsh_house/hooks.py:16` **also** hooks `Alteration Ticket on_update`.

`create_sales_invoice` (`alteration_ticket.py:138-212`) skips when: invoice exists; `billing_status ∈ {Warranty, Included in Custom Order}` → `payment_status='N/A'`; `ticket_total <= 0`. Sets `company` from `ORIGIN_COMPANY`, `currency USD`, and **`taxes_and_charges: ""` + `taxes: []`** — alterations are tax-exempt (this is HEAD's commit subject). Links back via `alteration_ticket_ref`.
Invoice docstatus follows ticket state (`:215-233`): → `Picked Up` submits the invoice; → `Cancelled` cancels it; **cancelled with an already-submitted invoice only writes `frappe.log_error("Manual credit note required")` — a logged, unresolved accounting gap.**

`ensure_rush_surcharge` exists in HEAD hooks (`:145`) — but the **frontend never sends a rush amount and the API never computes one**. See §7 D1.

### 3.7 Supabase in the data model

| Item | Verdict |
|---|---|
| `Alteration Ticket.supabase_id` (`HEAD:…json:316`) | **Orphaned column, zero writers in repo.** Clean drop. |
| `Alteration Ticket.invoice_ninja_id` (`:310`) | Same category. |
| `LSH Delivery.lsh_supabase_delivery_no` | **Blocker** — still the primary customer-facing tracking number (`tracking.ts:60`, `deliveries.ts:109,856`). |
| `backend/supabase/migration.sql` (572L) | Superseded legacy schema. Its `alteration_status` enum is **still the vocabulary the app API speaks** (`alterations.ts:28-37`). |
| `supabase/` dir | No migrations — only `.temp/linked-project.json` (still-linked project). |
| `@supabase/supabase-js` in `webapp/bun.lock:36` | **Dead dependency**, no import. |
| `n8n/square-terminal-webhook.json:124-129,172-177` | **LIVE Supabase writes** in the Square Terminal workflow — must be rewired before decommission. |
| `backend/scripts/migrate-deliveries-to-erp.ts` | Only remaining client; documented one-off. |

**No runtime request path holds a Supabase client.** Migration is essentially done; the tail is the n8n workflow and the tracking-number field.

---

## 4. API surface

### 4.1 How the backend reaches ERPNext — three parallel paths, three credential sets

| Path | Auth | Where |
|---|---|---|
| Typed REST client `lib/erp.ts` | `Authorization: token ${ERPNEXT_API_KEY}:${ERPNEXT_API_SECRET}` + **spoofed browser User-Agent** to defeat Cloudflare 1010 | `erp.ts:16-22` |
| Ad-hoc `fetch` to `/api/resource/…` | same env pair, re-read locally | `intake-alterations.ts:49-58` and ~30 sites |
| **MCP JSON-RPC** `POST {ERPNEXT_MCP_URL}/mcp` | `Bearer ${ERPNEXT_MCP_TOKEN}` | `intake-alterations.ts:22-47` |

Missing creds → **silent empty result**, not an error (`erp.ts:35,52,64`). `ERPNEXT_API_TOKEN` is read then abandoned (`intake-alterations.ts:11,50`).

### 4.2 Alterations endpoints (abridged; ~75 total across 18 route files)

**`/api/intake-alterations`** — `intake-alterations.ts`

| Method | Path | Auth | Note |
|---|---|---|---|
| GET | `/public/tickets/:name` | **PUBLIC** | Customer name, totals, garments. **Enumerable** (§7 D6) |
| GET | `/presets?origin=` | JWT | HOU price override |
| GET | `/tailors`, `/customers/search`, `/tickets`, `/tickets/:name` | JWT | |
| **POST** | **`/tickets`** | JWT | → RPC `ls_alterations.api.create_ticket` (`:380`) |
| PATCH | `/tickets/:name/tailor` \| `/status` \| `/due-date` \| `/transfer` | JWT | `/status` walks workflow actions (`:439-462`); `/transfer` just flips `origin_location`, **no validation** |
| POST | `/tickets/:name/sms` \| `/notify-ready` \| `/email` \| `/photos` | JWT | Twilio; ERP Communication |
| GET | `/tickets/:name/receipt` | JWT | ERP PDF proxy |

**`/api/alterations`** — list/detail/KPIs/brief/transitions/state/full/garment-status, all JWT; plus `POST /erp-webhook/ready` guarded by `x-webhook-secret` **that is skipped entirely if the env var is unset** (`:575`).
**`/api/carts`** — park/list/get/abandon/**commit**; commit posts **raw** to `/api/resource/Alteration Ticket` (`parked-carts.ts:142`).
**`/api/payments`, `/api/square`** — Square link, Terminal checkout, device pairing, webhook proxy.
**`/api/pay-info`** — public invoice detail + OG card + **public charge** (§7 D5).
**`/api/transfers`** — hardcoded tailor list, create+submit Tailor Transfer, bulk ticket update, Journal Entry.
**`/api/garment`, `/api/scanner`, `/api/print`, `/api/qr`, `/api/scan`** — job card, QR resolution, thermal printing, public delivery tracking.

### 4.3 Mount divergence — production is missing routers

`backend/src/index.ts` (Bun/local) mounts routers that **`backend/src/app.ts` (Vercel prod) does not**: `qrRouter` `/api/qr`, `squareRouter` `/api/square`, `filesRouter`, `outreachRouter`, `erpnextCustomersRouter`. `app.ts:1-3` claims the two are identical — they are not. **`/api/qr` missing in prod means ERPNext tag-print QR images render broken.**

### 4.4 Outbound third parties

| Target | Endpoint | Credentials |
|---|---|---|
| Square | `connect.squareup.com/v2/{terminals,devices,payments,online-checkout}` | `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`; `Square-Version "2024-12-18"` **hardcoded in 5 places** |
| Twilio | `api.twilio.com/2010-04-01/…/Messages.json` | Basic auth; **`From` number and owner mobile hardcoded** (`twilio.ts:1,10`) |
| **api.qrserver.com** | QR PNG for MMS | none — **leaks ticket URLs to a third party** (`intake-alterations.ts:18`) |
| n8n | `lstailors.app.n8n.cloud/webhook/{dispatch-send,dispatch-compose,maestro-command,po-approved}` | `X-Dispatch-Key`; **maestro calls send none** |
| xAI | `api.x.ai/v1/chat/completions`, `grok-3-mini` | `XAI_API_KEY` (absent from `.env.example`) |
| Email | ERP `frappe.core.doctype.communication.email.make` | ERP key pair — no Resend/SendGrid anywhere |

**Square Web Payments SDK is not present.** Removed per `PayInvoice.tsx:2-4`; hosted `square.link` only. The two `source_id` endpoints (`square-terminal.ts:140`, `pay-info.ts:391`) therefore have **no caller in this repo** — live orphaned code, one of them unauthenticated.

---

## 5. The four core flows — actual behaviour

### 5a. TICKETING

1. `/intake/alterations`. Customer via `GET /customers/search` (3-tier fallback) or inline create.
2. Garment tiles append `{id, ref:"G1".., garmentType, …, lines[]}` to React state (`IntakeAlterations.tsx:1408-1426`). Removal renumbers refs (`:1436`).
3. Lines chosen from ERPNext `Alteration Preset` via `GET /presets?origin=` — **price comes from ERPNext, not `lib/pricing.ts`** (that file is custom-tailoring only).
4. Submit → `POST /api/intake-alterations/tickets` (`:1470`) → RPC `create_ticket` → `before_insert` assigns `ALT-{NYC|HOU}-YYYY-#####`, `after_insert` creates the Sales Invoice.
5. Print: `/tags` and `/receipt` build ESC/POS XML client-side (`thermal.ts:59,122`), posted through `/api/print/*` to a LAN printer configured in `LSH Print Settings`.
6. Client lookup: `/e-ticket/:ticketName` → **public** `GET /public/tickets/:name`.

**Two creation paths that disagree** — see §7 D3. **Thermal tags encode the retired `/garments/…` route** (`thermal.ts:130`).

### 5b. CART

Client-side only. `garmentSubtotal` = Σ line prices; `rushFee = isRush ? 25 : 0` (`IntakeAlterations.tsx:1083`), repeated at `:1699`. **No discounts, no modifiers, no tax** — `taxes_and_charges: ''` in both creation paths (`intake-alterations.ts:340`, `parked-carts.ts:125`), comment "Alterations are tax-exempt (services, not goods)" (`:169`).
Park/resume via `LSH Parked Cart` (`POST /api/carts`), soft-deleted as `Abandoned`.
**The $25 rush fee is displayed and then discarded** — §7 D1.

### 5c. CHECKOUT

Intake collects `paymentMethod` ∈ `pay_now|deposit|on_account` and `deposit` (`:1387-1388`) and posts them (`:1464-1465`) — the API maps them onto the ticket (`:341-342`) but **takes no payment at intake**. Payment happens later from `TicketDetail`:
- `POST /api/payments/link` → ERP `ls_alterations.ls_square.pos.create_payment_link` → **module absent from repo**, import wrapped in try/except → **silently no-ops**.
- `POST /api/payments/terminal-checkout` → Square Terminal.
- Client self-serve at `/pay/:invoiceId` → hosted `square.link` (Apple Pay + cards).
- Square webhook → `/api/payments/webhook` → proxied to ERP; ERP creates the Payment Entry; `Payment Entry on_submit → sync_payment_to_ticket` derives `payment_status` from `outstanding_amount`.
- Receipt/SMS via `/api/print/receipt` and `/tickets/:name/sms`.

### 5d. TRANSFER OF WORK

- **Assignment:** `PATCH /tickets/:name/tailor` → `assigned_tailor` (an **undeclared field**, §3.2). Tailor list is **hardcoded** in `transfers.ts:8-11`, while `garment.ts:112` queries ERPNext for the same thing.
- **Queue:** `/shop-floor` is **YZ, not alterations**. Real alterations movement is `garment_status` per garment, rolled up by `validate`.
- **Cross-location LSTNY↔LSTX:** `PATCH /tickets/:name/transfer` **only overwrites `origin_location`** (`intake-alterations.ts:534`). No company change, no stock movement, no invoice re-issue, no validation of the value. Live data: **0 HOU tickets — never exercised.**
- **Tailor transfer:** `POST /api/transfers` creates + submits `Tailor Transfer`, bulk-writes `workflow_state` directly (§7 D4), and on `Return` with a check posts a Journal Entry to **hardcoded LSTNY accounts** (§7 D7). **No role gate despite creating GL entries.**
- **Hand-off:** `Mark Picked Up` submits the Sales Invoice; or `POST /api/deliveries/from-order` then force `status: 'Picked Up'` (`TicketDetail.tsx:949-955`).

---

## 6. Auth + session

**Flow:** `POST /api/auth/login` → ERPNext `/api/method/login` validates credentials (`auth.ts:20-24`) → backend fetches `full_name` + roles + `lst_location` → **mints its own HS256 JWT with role and location embedded** (`auth.ts:56-61`) → stored in **`localStorage["lst_token"]`** (`authClient.ts:2,9`) → sent as `Authorization: Bearer` (`api.ts:25`).

- **IdP:** ERPNext is the credential authority; the app is its own token issuer. No OAuth/OIDC/SSO.
- **Roles:** ERPNext `LST *` roles → app roles (`scope.ts:21-30`); default `salesperson`; `System Manager` → `super_admin`. Enrichment failure **fails open to `salesperson`** (`scope.ts:46-47`).
- **Expiry: 30 days** (`jwt.ts:44`). Fast path trusts role/location **from the token without re-checking ERPNext** (`scope.ts:83-96`) → **a role change or de-provisioned user is not honoured for up to 30 days.**
- **No auth middleware.** `getAuthedUser(c)` is called per handler; omitting one line silently makes a route public — the root cause of every gap in §7.
- Logout is client-side only; no revocation list (`auth.ts:70-73`). No rate limiting on login.

### What breaks on a second domain

| # | Breakage | Cause |
|---|---|---|
| 1 | **Staff must log in again on `alts.`** and stay logged in twice | `localStorage` is origin-scoped (`authClient.ts:2`) |
| 2 | **All API calls fail CORS** | Allow-list is `app.` and `book.` only — `alts.` absent (`index.ts:56-67`, `app.ts:60-71`). `index.ts` has **no** `ALLOWED_ORIGINS` override |
| 3 | Role changes stay stale up to 30 days **per domain** | Two independent 30-day tokens |
| 4 | Pay links keep pointing at `app.` | `pay-info.ts:226`, `intake-alterations.ts:14` |
| 5 | ERP calls advertise the wrong origin | Spoofed UA hardcodes `app.lstailors.com` (`erp.ts:20`) |
| 6 | Printed tag QRs resolve to `app.` | `app_base_url` from `LSH Print Settings` |

Cookie-based sessions on `.lstailors.com` would fix 1 and 3; `credentials: true` is already set (`index.ts:73`).

---

## 7. Debt register

### Ranked defects

| # | Severity | Finding | Evidence |
|---|---|---|---|
| **D5** | **Critical** | **Unauthenticated payment endpoint with caller-controlled amount.** `POST /api/pay-info/:id/charge` — no auth, no rate limit, `amount_cents` from the request body passed straight to Square. No caller in this repo. | `pay-info.ts:391-424` |
| **D8** | **Critical** | **Live shared secret committed to source:** `DISPATCH_WEBHOOK_KEY` defaults to `"lsd_dsp_9k2fQ7xWm4vT"` | `dispatch.ts:13` |
| **D9** | **High** | **Three webhook guards fail OPEN** when their env var is unset (`if (secret && …)`) — `/api/alterations/erp-webhook/ready`, `/api/webhooks/unifi`, `/api/maestro/brief`. Only `outreach.ts:11` fails closed. | `alterations.ts:575`; `webhooks.ts:38`; `maestro.ts:125` |
| **D10** | **High** | **`POST /api/invoices/:id/mark-paid` omits `canSeeFinancials`** that all its siblings enforce — any authenticated role can zero an invoice. | `invoices.ts:150` vs `:44,88,111` |
| **D1** | **High** | **Rush fee charged to nobody.** `$25` hardcoded in the UI twice; the API sends only `is_rush` and never a surcharge line. | `IntakeAlterations.tsx:1083,1699`; `intake-alterations.ts:339` |
| **D3** | **High** | **Two ticket-creation paths that disagree.** Intake → RPC `create_ticket` (`preset:null`, server assigns state/IDs). Cart-commit → **raw DocType POST** setting `workflow_state`, `preset`, `garment_status`, `line_status`. Ticket shape depends on the door used. | `intake-alterations.ts:361,380` vs `parked-carts.ts:116-152` |
| **D4** | **High** | **Workflow bypass.** `transfers.ts` writes `workflow_state` directly under a live active workflow — in a repo whose own comment says such writes "are reverted by the engine". | `transfers.ts:83,88` vs `intake-alterations.ts:437` |
| **D11** | **High** | **Frappe app deleted from working tree**; `hooks.py` stubbed to zero `doc_events`. A migrate from this checkout disables invoice creation, totals and naming. | §3.0 |
| **D12** | **High** | **`ls_square` module imported but absent** → Square link minting silently no-ops. | `invoices.py:112` |
| **D6** | **Medium** | **Public ticket endpoint is enumerable** — sequential `ALT-NYC-2026-000NN`, exposes customer name, totals, garments. | `intake-alterations.ts:91-118` |
| **D13** | **Medium** | **`GET /api/print/config` unauthenticated** — leaks LAN printer IP/port. Every sibling checks auth. | `print.ts:87` |
| **D2** | **Medium** | **Permission divergence** — frontend `canSeeFinancials` = `super_admin` only; backend allows `store_manager`. Backend wins; UI hiding is cosmetic. | `webapp/src/lib/scope.ts:6-8` vs `backend/src/lib/scope.ts:146-148` |
| **D7** | **Medium** | **Houston hardcoded out** — tailor-payment JE posts to `Subcontractor Expense - LSTNY` / `Cash - LSTNY` regardless of location. | `transfers.ts:102,109` |
| **D14** | **Medium** | **Accounting gap logged, not resolved** — cancelling a ticket whose invoice is already submitted only writes "Manual credit note required". | `alteration_ticket.py:228-233` |
| **D15** | **Medium** | **Three "ready" notifiers race** to stamp `notified_ready_at`; both Frappe apps hook `on_update` on the same DocType, so hook order decides the winner. | `alteration_ticket.py:371-451`; `HEAD:api.py:200-219`; `lsh_house/…/alteration.py:10-39` |
| **D16** | **Medium** | **Prod mount divergence** — `qr`, `square`, `files`, `outreach`, `erpnext-customers` missing from `app.ts`; `/api/qr` breaks tag QR printing on Vercel. | `index.ts:110-119` vs `app.ts` |
| **D17** | **Medium** | **QR hotlinked to `api.qrserver.com`** — leaks ticket URLs to a third party. | `intake-alterations.ts:18` |
| **D18** | **Low** | **762 lines of dead UI** — `AlterationDetail.tsx` (511), `GarmentTag.tsx` (251), `Placeholder.tsx`. | §1.5 |
| **D19** | **Low** | **Orphaned root trees** `./app`, `./components`, `./lib` not in any build. Divergence unverified. | `vercel.json:3-5` |
| **D20** | **Low** | **Printed tags encode a retired route** `/garments/…`. | `thermal.ts:130` |
| **D21** | **Low** | **Hardcoded people** — `HR-EMP-00020/21` in KPI queries and response field names (`stellaWip`/`hugoWip`); 4-tailor static roster; "Stella"/"Hugo" in UI labels and the AI prompt; `carl@lstailors.com` as a ToDo assignee. | `alterations.ts:174-175,203`; `transfers.ts:8-11`; `AlterationKpiBar.tsx:66,72`; `notifications.ts:37` |
| **D22** | **Low** | **State machine triplicated** with inconsistent sets; `alterations-data.ts:11-12` invents `Complete`/`Delivered`. | §3.4 |
| **D23** | **Low** | **No boot validation** — `env.ts:7-12` validates 3 optional vars; no ERP/Square/Twilio/JWT check. 13 env vars used but undocumented. Misconfiguration surfaces as silent empty results. | `env.ts`; `erp.ts:35`; `twilio.ts:7` |
| **D24** | **Low** | **Silent catch blocks** — all 8 notification sources wrapped in bare `catch {}`. | `notifications.ts:32,60,80,97,126,149,174,207` |
| **D25** | **Low** | **`garment_ref` is free text**, not a Link — no referential integrity between lines and garments. | `alteration_ticket_line.json:20` |
| **D26** | **Low** | **Dead enum values** — `payment_status='Overdue'`, `LSH Scan Log.outcome='Denied'`, and `Alteration Ticket Garment.qr_token` (exists, populated on 0 rows). | §3.1 |
| **D27** | **Security review** | **`webapp/CLAUDE.md` blocked by two independent agents as a suspected prompt-injection payload** (`deception_hide`). An instruction file inside the repo tripping injection detection is itself a finding. Not read; nothing here depends on it. | — |

### Dual writes / two sources of truth

1. **Ticket creation** — RPC vs raw DocType POST (D3).
2. **Workflow state** — six write paths, three bypassing the engine (§3.4).
3. **Tailor roster** — hardcoded array (`transfers.ts:8-11`) vs ERPNext Employee query (`garment.ts:112`).
4. **Tracking number** — `lsh_supabase_delivery_no ?? name` served publicly (`tracking.ts:60`).
5. **Square integration** — `ls_alterations.ls_square.*` and legacy `square_integration.api.*` (`square-terminal.ts:218`) coexist.
6. **QR generation** — first-party `/api/qr` (missing in prod) vs third-party `api.qrserver.com`.

---

## 8. Split assessment

### 8.1 What must be extracted — named files

**`@ls/types`** — the blocking dependency.
`backend/src/types.ts` (1,141 L). Today `webapp/src/lib/types.ts:3` is `export * from "../../../backend/src/types"`, and **10+ components import across the tree directly** (`components/appointments/*.tsx:3-9`, `components/dispatch/BatchPanel.tsx:6`). No path alias — `webapp/tsconfig.json:6-7` maps only `@/*`.

**`@ls/erp-client`** — `backend/src/lib/erp.ts` (141 L, incl. the Cloudflare UA workaround), `backend/src/lib/erpnext/doctypes.ts` (the `DT` name registry), `alterations-data.ts`, `parked-carts.ts`, `customer.ts`, `files.ts`. Collapses the three access paths into one.

**`@ls/auth`** — `backend/src/lib/jwt.ts`, `backend/src/lib/scope.ts` (241 L, the canonical predicates), `webapp/src/lib/authClient.ts`, `session.ts`, `components/shell/RoleGuard.tsx`. **`webapp/src/lib/scope.ts` must be deleted, not moved** — it is the divergent copy (D2).

**`@ls/design`** — `webapp/tailwind.config.ts:64-113` (forest/cream/brass/signal, Cormorant + Montserrat, glass gradients and shadows), `webapp/src/index.css`, `components/glass/*` (8 files), `components/ui/*`. Cleanest extraction; zero business coupling.

**`@ls/api-client`** — `webapp/src/lib/api.ts` (115 L).

**Do not extract** `webapp/src/lib/queries.ts` — 926 lines, 78 hooks, 4 alterations-related. Split it: alterations hooks (`:85,219,228,237`) move; the rest stays.

### 8.2 Monorepo vs separate repo — **monorepo with shared packages**

The two halves share a live, still-moving contract: one ERPNext instance, one JWT format, one Frappe workflow, and a `types.ts` the frontend already reaches across the tree to import. A published-client boundary would force a version bump and a two-repo release dance for every DocType field added — while the schema is provably still churning (four DocTypes currently deleted from the working tree, `lsh_*` custom fields undeclared, `assigned_tailor` live but unmodelled). Monorepo now, with the packages above as real workspace boundaries; revisit a published client only once the ERPNext schema stops moving and `ls_alterations` is fully under version control.

### 8.3 Hardest coupling, and the cut line

**Hardest: shared session identity across two origins.** Not the types — those are a mechanical refactor. The token lives in `localStorage` on one origin (`authClient.ts:2`), carries role and location **baked in for 30 days** (`jwt.ts:44`, `scope.ts:83-96`), and the CORS allow-list omits `alts.` entirely with no env override in `index.ts`. Every screen depends on `useMe()` → `RoleGuard`.

**Proposed cut line — three steps, in order:**
1. **Move the session to a cookie scoped to `.lstailors.com`** (`Secure`, `HttpOnly`, `SameSite=Lax`), add `alts.lstailors.com` to both allow-lists, and shorten the token to ~8 h with refresh so role changes propagate within a shift. `credentials: true` is already set.
2. **Extract `@ls/types` + `@ls/erp-client` + `@ls/auth`**, delete `webapp/src/lib/scope.ts`, and replace all `../../../backend/src/types` imports with the package name.
3. **Cut the frontend at the route boundary** in §1: `/intake/alterations`, `/orders/alterations/*`, `/g/*`, `/e-ticket/*`, the two print routes and `/admin/board` move; everything else stays. `/scanner`, `/pay/*` and `/customers*` ship in both from shared packages.

Backend stays one deployment initially — splitting the Hono API at the same time as the frontend doubles the risk for no day-one gain.

### 8.4 What breaks for staff on day one

| # | Breakage | Mitigation |
|---|---|---|
| 1 | **Second login on `alts.`**, and role changes stale up to 30 days per domain | Step 1 above, before cutover |
| 2 | **Every API call fails CORS** until `alts.` is allow-listed | One-line change in *both* `index.ts:56` and `app.ts:60` |
| 3 | **Printed tags and pay links point at `app.`** — QRs on garments already in the shop keep resolving to the old host | Keep `app.lstailors.com/g/*`, `/e-ticket/*`, `/pay/*` 301-redirecting to `alts.` **indefinitely** — physical tags outlive any deploy |
| 4 | **Thermal printing** — printer IP comes from `LSH Print Settings.app_base_url`; QR content flips to `alts.` only after that record is updated | Update the singleton at cutover; verify on a real printer |
| 5 | **`/api/qr` is already missing in prod** (D16) — tag QRs are broken today, independent of the split | Mount `qrRouter` in `app.ts` first |
| 6 | Muscle memory — bookmarks, `/orders/alterations` in the old sidebar | Leave the Workshop → Alterations item pointing at the new host |
| 7 | **Houston is untested** — zero HOU tickets have ever existed; cross-location transfer only flips a field | Do not treat HOU as working at cutover |

---

## Questions for C

1. **Rush fee — bill it or drop it?** `$25` is shown to the client at intake and never charged (D1). Fixing it changes what clients pay; deleting it changes what they see. Not my call.
2. **Is Houston in scope for the split, or NYC-only at cutover?** Zero HOU tickets exist, the tailor-payment JE is hardcoded to LSTNY accounts (D7), and cross-location transfer only overwrites a field. This decides whether LSTX is a cutover requirement or a later project.
3. **Single sign-on across `app.` and `alts.`, or two separate logins?** This is the single largest engineering item in the split (§8.3) and it is a product decision about how staff work, not a technical preference.
4. **Unify the two ticket-creation paths before or after the split?** (D3) Before is safer and slower; after means porting a known inconsistency.
5. **Priority call on the security items.** D5 (unauthenticated charge with caller-controlled amount) and D8 (committed secret) are, in my read, fix-this-week regardless of the split — but they sit outside my lane and I want your explicit go-ahead before Simone is redirected onto them.
6. **`webapp/CLAUDE.md`** (D27) was blocked as a suspected prompt-injection payload. Do you want it reviewed by a human, and do you know who added it?
7. **Confirm the three unverified items** I could not close: root-tree duplicate divergence (D19 — the subagent timed out), the true contents of the deleted Frappe files on the *server* versus git HEAD (§3.0), and whether `assigned_tailor` and the `lsh_*` fields should be brought under version control as fixtures.
