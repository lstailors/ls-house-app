# STAGE_PLAN — Split alterations into `alts.lstailors.com`

**Ground truth:** `ALTERATIONS_AUDIT.md` (2026-07-26)  
**Repo:** `lstailors/ls-house-app`  
**Author:** Simone · plan only — no application code in this deliverable  
**Status:** Stage 0 COMPLETE (2026-07-26) — awaiting approval to start Stage 1  
**Product split (C):** `alts.lstailors.com` = intake + day-to-day orders · `app.lstailors.com` = dashboard/admin  

---

## 0. Goals (locked from brief)

| Surface | Role |
|---|---|
| **`alts.lstailors.com`** | Daily-driver ops: ticketing, cart, checkout, transfer of work, tailor queue, client ticket lookup |
| **`app.lstailors.com`** | Backend + admin only: reporting, catalog/pricing, users/roles, financials, configuration. **No day-to-day ticketing UI** |
| **`erp.lstailors.com`** | Single source of truth. No new Supabase writes. Every audit Supabase dependency → ERPNext equivalent or **deferred with reason** |
| **Design** | Liquid Glass · Forest `#0D1A10` / `#1F3A2E` · Cream `#F1E9D6` · Brass `#B08D57` · Cormorant display · Montserrat UI · Post-login **tile home** |

**Rules (non-negotiable)**
1. One stage per session; stop and report before the next.
2. Never leave both apps able to write the same ticket — **move**, don't fork.
3. Every ERPNext write goes through the shared ERP client — no ad-hoc `fetch` to Frappe.
4. Preserve `ALT-NYC-.YYYY.-` / `ALT-HOU-.YYYY.-` and existing ticket numbers.
5. iPad-first, tap-driven FOH — not form-heavy.
6. If a stage proves the audit wrong, **stop and say so** before coding further.

---

## 1. Target monorepo layout

```
ls-house-app/
  packages/
    types/          @ls/types          # Zod + DT contracts (from backend/src/types.ts)
    erp-client/     @ls/erp-client     # single ERPNext REST path (from backend/src/lib/erp.ts + erpnext/*)
    auth/           @ls/auth           # JWT mint/verify, scope predicates, cookie session helpers
    api-client/     @ls/api-client     # browser fetch wrapper (from webapp/src/lib/api.ts)
    design/         @ls/design         # tokens, tailwind preset, glass/* primitives, index.css base
  apps/
    api/            # existing backend (Hono) — one deploy initially; serves BOTH frontends
    admin/          # existing webapp → becomes app.lstailors.com (admin-only UI)
    alts/           # NEW — alts.lstailors.com
  frappe/           # ls_alterations + square paths — restore under VCS (preflight)
  ALTERATIONS_AUDIT.md
  STAGE_PLAN.md                 # this file
```

**Why monorepo (audit §8.2):** one ERPNext, one JWT shape, one workflow, types still churning. Published packages later — not day one.

**Backend stays one deployment through Stage 5.** Splitting Hono at the same time as the frontend doubles cutover risk with no day-one gain (audit §8.3). `api.lstailors.com` is **not** introduced in this plan; both SPAs call `https://app.lstailors.com/api/*` until a later API split (if ever).

---

## 2. Shared package boundary

### 2.1 `@ls/types`
| Move from | Notes |
|---|---|
| `backend/src/types.ts` (~1141L) | Canonical Zod schemas |
| Delete cross-tree imports | `webapp/src/lib/types.ts` re-export + 10+ `../../../backend/src/types` |

**Owns:** request/response contracts for alterations, payments, carts, transfers, auth/me.

### 2.2 `@ls/erp-client`
| Move from | Notes |
|---|---|
| `backend/src/lib/erp.ts` | Token auth + Cloudflare browser UA |
| `backend/src/lib/erpnext/doctypes.ts` | `DT` registry |
| `backend/src/lib/erpnext/alterations-data.ts` | **Rewrite state enums to match live workflow only** (drop invented `Complete`/`Delivered`) |
| `backend/src/lib/erpnext/parked-carts.ts`, `customer.ts`, `files.ts` | As needed |

**Collapses** the three ERP access paths (typed client / ad-hoc fetch / MCP) into **one**.  
**Rule:** route handlers may only import `@ls/erp-client` for Frappe I/O. MCP stays ops/agent-only, not request path.

### 2.3 `@ls/auth`
| Move from | Notes |
|---|---|
| `backend/src/lib/jwt.ts`, `backend/src/lib/scope.ts` | Backend predicates are canonical |
| `webapp/src/lib/authClient.ts`, `session.ts` | Client storage → **cookie** (Stage 0/1) |
| `webapp/src/components/shell/RoleGuard.tsx` | Shared guard |

**Delete (do not move):** `webapp/src/lib/scope.ts` — divergent copy (audit D2).  
**Session target:** `HttpOnly` + `Secure` + `SameSite=Lax` cookie on **`.lstailors.com`**, TTL ~8h + refresh (not 30-day localStorage JWT).

### 2.4 `@ls/api-client`
| Move from | Notes |
|---|---|
| `webapp/src/lib/api.ts` | Fetch + `{data}` unwrap + credentials |

Base URL: relative `/api` on `app.`; on `alts.` either same-origin proxy or absolute `https://app.lstailors.com/api` with CORS.

### 2.5 `@ls/design`
| Move from | Notes |
|---|---|
| `webapp/tailwind.config.ts` token block | Forest/cream/brass, fonts, glass |
| `webapp/src/index.css` (base layers) | |
| `webapp/src/components/glass/*` | 8 primitives |
| Optional: subset of `components/ui/*` | Only what alts needs |

**Tile home** ships in `@ls/design` as `TileGrid` / `ModuleTile` used by both apps' post-login `/`.

### 2.6 Explicitly NOT extracted
- `webapp/src/lib/queries.ts` (926L) — **split**: 4 alterations hooks → `apps/alts`; rest stays admin.
- `lib/pricing.ts` — custom-tailoring; stays admin (audit §2.4).
- YZ shop-floor stack — stays admin.
- Root orphan trees `./components`, `./lib`, `./app` — **diff then delete** in Stage 0 cleanup (D19); do not port.

---

## 3. Route maps

### 3.1 `alts.lstailors.com` (ALTS)

**Public / print (no AppShell chrome)**

| Path | Source today | Purpose |
|---|---|---|
| `/login` | SHARED package | Staff login |
| `/e-ticket/:ticketName` | `ETicket.tsx` | Client ticket lookup |
| `/orders/alterations/:ticketName/tags` | `AlterationTags.tsx` | Thermal garment tags |
| `/orders/alterations/:ticketName/receipt` | `AlterationReceipt.tsx` | Thermal receipt |
| `/g/:ticket/:garmentId` | `GarmentJobCard.tsx` | Shop-floor QR target |
| `/pay/:invoiceId` | **SHARED** — also kept on app with 301 | Client pay (Apple Pay / Square) |

**Authenticated (tile home → modules)**

| Path | Source today | Module tile |
|---|---|---|
| `/` | NEW tile home | — |
| `/intake/alterations` | `IntakeAlterations.tsx` | New ticket |
| `/orders/alterations` | `OrdersAlterations.tsx` | Tickets |
| `/orders/alterations/:ticketName` | `TicketDetail.tsx` | Ticket |
| `/board` | `AdminBoard.tsx` + `AlterationsBoard.tsx` | Board |
| `/scanner` | `Scanner.tsx` (SHARED package; alts build includes it) | Scan |
| `/customers`, `/customers/new`, `/customers/:id` | SHARED thin pages or deep-link to admin later | Customers (intake need) |

**Retire (do not port)**  
`/garments/:ticketId/:garmentId` shim, `AlterationDetail.tsx`, `GarmentTag.tsx`, `Placeholder.tsx` (D18).

**Not on alts**  
`/shop-floor` (YZ production — audit §1.3), mission control, financials, custom orders, deliveries ops, academy, etc.

### 3.2 `app.lstailors.com` (ADMIN) — after Stage 5

| Keep | Notes |
|---|---|
| `/`, `/mission-control/*`, `/house` | Admin home / MC |
| `/orders/custom/*`, `/sales-orders/*`, `/invoices/*` | Custom + finance views |
| `/deliveries/*`, `/communications`, `/financials`, `/settings` | Ops admin |
| `/reference/*`, `/admin/*`, `/academy`, `/tasks`, `/comms`, `/sofia`, `/dispatch` | |
| `/customers*` | Admin CRM (alts has its own thin copy or shared package) |
| `/calendar`, `/appointments`, `/helpdesk/*` | |
| `/shop-floor` | YZ only |
| `/pay/:invoiceId` | Keep + 301 optional dual-host |
| `/api/*` | **All API remains here** |

| Remove from admin UI (Stage 5) | Redirect |
|---|---|
| `/intake/alterations` | → `https://alts.lstailors.com/intake/alterations` |
| `/orders/alterations`, `/orders/alterations/:id` | → alts |
| `/orders/alterations/:id/tags\|receipt` | → alts |
| `/g/*` | → alts (and **indefinite** 301 — physical tags) |
| `/e-ticket/*` | → alts (indefinite 301) |
| `/admin/board` | → `https://alts.lstailors.com/board` |
| Workshop → Alterations sidebar | Link out to alts host |

| Stay on admin as **widget only** | |
|---|---|
| `AlterationsPipeline` on dashboard | Read-only counts — not ticketing |

### 3.3 Write ownership (anti-fork)

| Flow | Writer after move | Forbidden |
|---|---|---|
| Create ticket | **alts UI only** → `POST /api/intake-alterations/tickets` | Admin UI must not offer create |
| Cart park/commit | alts only | |
| Status / tailor / transfer | alts only | |
| Terminal / link pay from ticket | alts TicketDetail | |
| SI/PE in ERPNext | Frappe hooks + webhook (unchanged source of truth) | App must not double-create SI |
| Mark paid / financials | admin invoices (role-gated) | alts uses payment flows, not mark-paid |

Until Stage 5 cut of admin routes: **feature flag** `ALTERATIONS_UI=alts|app` so only one host renders write UI (default `app` until Stage 5 flip).

---

## 4. Stage definitions

### Stage 0 — Extract shared packages (no behavior change)

**Objective:** Both current `webapp` and a stub `apps/alts` (or temporary second Vite entry) build green off packages. Zero UX change on `app.lstailors.com`.

**File moves (exact)**

| Action | Path |
|---|---|
| CREATE | `packages/types/package.json`, `src/index.ts` ← move body of `backend/src/types.ts` |
| CREATE | `packages/erp-client/...` ← `backend/src/lib/erp.ts`, `lib/erpnext/*` |
| CREATE | `packages/auth/...` ← jwt + **backend** scope + RoleGuard + authClient (still localStorage in S0) |
| CREATE | `packages/api-client/...` ← `webapp/src/lib/api.ts` |
| CREATE | `packages/design/...` ← tokens, glass/*, base css |
| REWIRE | `backend` imports → `@ls/types`, `@ls/erp-client`, `@ls/auth` |
| REWIRE | `webapp` imports → packages; delete `webapp/src/lib/scope.ts` |
| FIX | Mount `qrRouter` in `backend/src/app.ts` (D16) — **behavior fix required for tags; ship in S0** |
| FIX | CORS allow-list add `http://localhost:*` alts dev origin only |
| CLEAN | Delete dead UI: `AlterationDetail.tsx`, `GarmentTag.tsx`, `Placeholder.tsx` (D18) |
| CLEAN | Diff root `./components`, `./lib`, `./app` vs `webapp/`; delete if identical/orphan (D19) |
| PREFLIGHT | Restore `frappe/ls_alterations` from git HEAD onto disk; confirm live Docker site-packages still has hooks (audit §3.0 / D11). **Do not `bench migrate` from stub hooks.** |
| TOOLING | Root workspaces (`bun`/`npm`); `tsconfig` paths; CI `bun run build` for `webapp` + packages |

**Exit criteria**
- [ ] `cd webapp && bun run build` green  
- [ ] `cd backend && bun run typecheck` (or tsc) green  
- [ ] No `../../../backend/src/types` imports remain  
- [ ] `/api/qr` responds 200 on production build path (`app.ts`)  
- [ ] App behavior unchanged for staff (smoke: login, open one ticket, open intake)

**Rollback:** Revert single PR; packages unused if webapp still has vendored copies briefly — prefer one atomic PR.

**Stop and report.**

---

### Stage 1 — Scaffold `alts.lstailors.com`

**Objective:** Deployable SPA that logs in, shows Liquid Glass **tile home**, hits `/api/me`. No ticketing yet.

**File creates**

| Path | Notes |
|---|---|
| `apps/alts/` | Vite + React + TS (mirror webapp stack) |
| `apps/alts/src/App.tsx` | Routes: `/login`, `/` tiles only |
| `apps/alts/src/pages/HomeTiles.tsx` | Tiles: Intake, Tickets, Board, Scanner (disabled/coming soon except login) |
| `apps/alts/src/main.tsx`, `index.html`, `tailwind.config.ts` | extends `@ls/design` |
| `apps/alts/vercel.json` | SPA rewrite; optional `/api` proxy to app origin **or** CORS |

**Backend (still single API)**
- CORS: add `https://alts.lstailors.com` + preview URLs to **both** `index.ts` and `app.ts` (audit §6).
- Auth: implement **cookie session on `.lstailors.com`** (or dual-write cookie + localStorage during transition). Shorten JWT TTL.
- `POST /api/auth/login` sets cookie; `GET /api/me` reads cookie or Bearer.

**DNS / Vercel (staging)**
- Project `ls-alts` (or monorepo multi-project) → preview domain first; production hostname wired in Stage 6.

**Exit criteria**
- [ ] Preview URL loads Liquid Glass shell  
- [ ] Login with ERPNext credentials succeeds  
- [ ] `/api/me` returns role + location  
- [ ] Cookie visible on `.lstailors.com` (or documented interim)  
- [ ] `app.` login still works  

**Rollback:** Remove CORS entries; tear down preview project; app untouched.

**Stop and report.**

---

### Stage 2 — Ticketing (intake → print → ERPNext)

**Objective:** Full intake through printed ticket; **only alts** creates tickets once flag flipped.

**Moves into `apps/alts`**

| From `webapp/src/` | To |
|---|---|
| `pages/intake/IntakeAlterations.tsx` | `apps/alts/src/pages/intake/` |
| `pages/orders/OrdersAlterations.tsx` | `apps/alts/src/pages/orders/` |
| `pages/orders/TicketDetail.tsx` (read + status/SMS/print; pay buttons can stub to S3) | `apps/alts/...` |
| `pages/ETicket.tsx` | public route |
| `pages/intake/AlterationTags.tsx`, `AlterationReceipt.tsx` | print routes |
| `components/alterations/*` needed for edit/save cart | |
| `components/garment/*` | |
| `components/pos/CustomerEditSheet.tsx` | shared or copy via package later |
| `lib/thermal.ts` | `apps/alts/src/lib/thermal.ts` |
| alterations hooks from `lib/queries.ts` | `apps/alts/src/lib/queries-alterations.ts` |

**API (still on app host, used by alts)**
- `intake-alterations.ts`, `alterations.ts`, `carts.ts`, `print.ts`, `scanner` subset  
- **All ERP writes via `@ls/erp-client` only** — refactor ad-hoc fetch in intake routes this stage  
- **Unify creation paths (D3) before port:** cart-commit must call same `create_ticket` RPC as intake (no raw DocType POST). Prefer fix in API first, then UI move.

**ERPNext**
- Naming series unchanged (`set_naming_series` from `origin_location`).  
- `after_insert` SI creation remains Frappe-side (already live).  
- Ensure `ls_alterations` hooks present on server (preflight).

**Print**
- Fix thermal QR paths to `/g/{ticket}/{garmentId}` on **alts** host via `LSH Print Settings` **only after** dual-host redirects exist — or keep encoding `app.` until Stage 6 and 301. Prefer: encode path-only `/g/...` + configurable origin (Stage 2 implement origin from settings; default `app.` until cutover).

**Feature flag**
- `VITE_ALTERATIONS_HOST=alts` on alts; admin hides Workshop create when `ALTERATIONS_UI_WRITES=alts`.

**Exit criteria**
- [ ] Create ticket on alts → row in ERPNext with correct `ALT-NYC-…` series  
- [ ] SI auto-created (billable)  
- [ ] Tags + receipt print job accepted  
- [ ] E-ticket public page loads  
- [ ] Admin cannot create a second ticket for same flow (writes disabled or redirected)  
- [ ] No Supabase calls in path  

**Rollback:** Flag back to `app`; alts intake route 503; admin UI restored.

**Stop and report.**

---

### Stage 3 — Cart + checkout (Square Terminal + online)

**Objective:** Parked cart, terminal charge, online `square.link`, PE + SI correct per company (LSTNY / LSTX).

**Moves / wiring**
| Piece | Action |
|---|---|
| `SaveCartControls`, carts API | alts only |
| `components/payments/*` | package or alts; Terminal + pairing |
| `TicketDetail` pay actions | alts |
| `/pay/:invoiceId` | SHARED component in package; deployed on **both** hosts or app-only with links pointing app until S6 |
| Webhook | remains `app.lstailors.com/api/payments/webhook` → ERP `ls_square.webhook.receive` |

**ERP / Square**
- Confirm `ls_alterations.ls_square.pos.create_payment_link` lives on **server** (audit D12 / missing in some checkouts). If missing → block stage.  
- Company: `ORIGIN_COMPANY` NYC→`L&S Tailors NY LLC`, HOU→`L&S Tailors TX, LLC` — do not use LSTNY string as company name.  
- Mode of Payment Square + PE `on_submit` → `sync_payment_to_ticket`.  
- Tax-exempt path preserved (`taxes_and_charges: ""`).

**Debt to close in this stage (in-scope)**
- D12 silent no-op Square mint — must work or stage fails.  
- Rush fee (D1): **do not change money behavior without C answer** — if still undecided, keep display-only and log TODO (no silent charge).

**Exit criteria**
- [ ] Terminal checkout completes → PE + ticket `payment_status`  
- [ ] Online pay via `/pay/{si}` → webhook → PE  
- [ ] NYC company on PE/SI for NYC ticket  
- [ ] Idempotent webhook (no double PE)  
- [ ] SMS/email paths unchanged (existing V4 / v5) |

**Rollback:** Disable pay buttons on alts; payment remains from old TicketDetail on app if flag reverted.

**Stop and report.**

---

### Stage 4 — Transfer of work

**Objective:** Tailor assignment, queue, station/garment status, cross-location transfer, status transitions — all on alts; **workflow engine honored**.

**Moves**
| From | To |
|---|---|
| `TransferModal`, `TransferButton`, `CompleteGarmentModal` | alts |
| `GarmentJobCard`, garment API | alts |
| `AlterationsBoard`, KPI/brief | alts `/board` |
| `transfers.ts` consumers | alts only |

**Hardening (required this stage)**
- **D4:** Stop raw `workflow_state` writes in `transfers.ts`; use `apply_workflow` / same transition walker as intake.  
- **Single tailor roster:** ERPNext Employee query only — delete hardcoded list (`transfers.ts:8-11`).  
- **Declare `assigned_tailor`** on Alteration Ticket DocType + fixture (live column exists).  
- Cross-location: document honestly — today only flips `origin_location` (audit §5d). Either implement real company/SI rules or **label UI “experimental / NYC-only”** and do not claim LSTX ready (zero HOU tickets ever).  
- JE on tailor return (D7): if kept, company-aware accounts; else gate behind `super_admin` and NYC-only.

**Queue**
- Not `/shop-floor` (YZ). Queue = board + garment statuses + `/g/` cards.

**Exit criteria**
- [ ] Assign tailor persists and filters board  
- [ ] Garment status rollup → ticket state via allowed transitions only  
- [ ] Transfer doc created without workflow bypass  
- [ ] Scanner resolves garment/ticket on alts  

**Rollback:** Re-enable board/transfer on app; feature flag.

**Stop and report.**

---

### Stage 5 — Strip alterations UI from `app.lstailors.com`

**Objective:** Admin app no longer presents day-to-day ticketing. API stays.

**File actions**
| Action | Path |
|---|---|
| REMOVE routes | `App.tsx` alterations blocks (§3.2 table) |
| REMOVE or slim | sidebar Workshop → Alterations (external link) |
| KEEP | `AlterationsPipeline` dashboard widget (read-only) |
| KEEP | `/pay/*`, `/api/*`, YZ `/shop-floor` |
| DELETE | unused alterations page files from `webapp` after move verified |
| REDIRECTS | middleware/vercel redirects for old paths → alts (can soft-launch before DNS) |

**Dual-write check**
- Grep admin bundle for `intake-alterations/tickets` POST — must be zero.  
- Cart commit only referenced from alts.

**Exit criteria**
- [ ] Production app build has no intake route  
- [ ] Bookmarks to old paths redirect  
- [ ] Admin login → no FOH ticket create  
- [ ] API health unchanged  

**Rollback:** Revert webapp route PR; keep alts live read-only if needed.

**Stop and report.**

---

### Stage 6 — Cutover

**Objective:** Production DNS and permanent redirects; physical tags keep working forever.

#### 6.1 DNS / Vercel
| Host | Project |
|---|---|
| `alts.lstailors.com` | alts Vercel project → `apps/alts` output |
| `app.lstailors.com` | existing → `webapp` (admin) + API |

#### 6.2 Auth callbacks
- Cookie domain `.lstailors.com`  
- CORS final list: `app.`, `alts.`, `book.` as needed  
- ERPNext allowed redirect URLs if any  
- Square redirect/Apple Pay domain verification: keep `app.` for `/pay`; add `alts.` if pay hosted there  

#### 6.3 Indefinite 301s on `app.lstailors.com` (physical media)

| From | To |
|---|---|
| `/g/:ticket/:garmentId` | `https://alts.lstailors.com/g/:ticket/:garmentId` |
| `/garments/:ticketId/:garmentId` | alts `/g/...` |
| `/e-ticket/:name` | alts `/e-ticket/:name` |
| `/orders/alterations/*` | alts equivalent |
| `/intake/alterations` | alts |
| `/admin/board` | alts `/board` |

`/pay/*` may remain on app (recommended — payment domain already trusted) **or** dual-host; do not break existing SMS/email links.

#### 6.4 Config flips
- `LSH Print Settings.app_base_url` → `https://alts.lstailors.com` (verify one real print)  
- n8n payloads that embed ticket URLs (if any)  
- OG/pay-info absolute links  

#### 6.5 Supabase tail (audit §3.7)

| Item | Action at cutover |
|---|---|
| `Alteration Ticket.supabase_id` | **Drop later** — orphan; no write path. Defer migrate. |
| `invoice_ninja_id` | Defer drop |
| `LSH Delivery.lsh_supabase_delivery_no` | **DEFER** — still public tracking number; not alterations-blocking. Document owner: deliveries. |
| n8n Square Terminal → Supabase | **Rewire or disable** before claiming Supabase decommission (not alts-block if terminal path uses ERP PE only — verify live WF) |
| `@supabase/supabase-js` in webapp lockfile | Remove dead dependency in S5/S6 cleanup |

#### 6.6 Rollback plan (Stage 6)

| Step | Action | RTO target |
|---|---|---|
| R1 | Point `alts.lstailors.com` Vercel to previous deployment (instant) | minutes |
| R2 | Re-enable alterations routes on `app` from last green admin build | minutes |
| R3 | Set feature flag `ALTERATIONS_UI_WRITES=app` | minutes |
| R4 | Revert `app_base_url` print setting to `https://app.lstailors.com` | minutes |
| R5 | DNS: if alts CNAME wrong, repoint to app as temporary synonym | <1h |
| R6 | **Do not** reverse ERP ticket numbers or SI — data stays; only UI host changes | — |
| R7 | 301s stay in place even during rollback (harmless) or remove if looping | — |

**Data plane:** ERPNext is SoT — rollback never deletes tickets. Worst case: staff use app UI again against same DocTypes.

**Exit criteria**
- [ ] Staff login once, use alts for full day  
- [ ] Scan garment tag printed pre-cutover → lands correctly  
- [ ] Pay link from SMS still works  
- [ ] No ticket creates on app host (access log grep)  
- [ ] Rollback drill documented with timestamped run  

**Stop and report final cutover.**

---

## 5. Supabase → ERPNext map

| Dependency | Verdict | Stage |
|---|---|---|
| Runtime Supabase client in app | None | — |
| `supabase_id` on ticket | Orphan column | Defer drop post-S6 |
| `invoice_ninja_id` | Orphan | Defer |
| `lsh_supabase_delivery_no` | Still tracking SoT-ish | **Defer** (deliveries project) |
| n8n → Supabase square log | Live risk | Verify S3; rewire before Supabase off |
| `backend/supabase/migration.sql` | Legacy enum vocabulary only | Replace API enums with ERP workflow states S2 |
| `@supabase/supabase-js` lockfile | Dead | Delete S5 |

**No new Supabase tables or writes in any stage.**

---

## 6. Security items (out of stage path but flagged)

Audit asks explicit go-ahead. **Not scheduled inside S0–S6 unless C prioritizes:**

| ID | Issue | Recommend |
|---|---|---|
| D5 | Unauth `/api/pay-info/:id/charge` | Disable/delete **before** S3 if still mounted |
| D8 | Committed dispatch secret default | Rotate + remove default |
| D9 | Webhooks fail-open | Fail closed |
| D10 | `mark-paid` role gap | Align `canSeeFinancials` |

These can ship as a **parallel hotfix PR** without blocking Stage 0.

---

## 7. Open decisions (from audit §Questions for C)

Plan proceeds with **defaults** below unless C overrides at approval:

| # | Question | Plan default until told otherwise |
|---|---|---|
| 1 | Rush fee bill or drop? | **No behavior change** in S2–S3; still display-only |
| 2 | Houston in scope? | **NYC primary**; HOU UI allowed but not certified at cutover |
| 3 | SSO cookie vs two logins? | **Cookie on `.lstailors.com`** (S1) |
| 4 | Unify create paths when? | **Before** S2 write cutover (in S2 API work) |
| 5 | Security hotfix priority? | **Await C** — recommend D5/D8 this week |
| 6 | `webapp/CLAUDE.md` injection flag | Human review; not required for split |
| 7 | Fixtures for `assigned_tailor` / `lsh_*` | **Yes in S4 / S3** under version control |

---

## 8. Risk register (split-specific)

| Risk | Mitigation |
|---|---|
| Dual UI writes same ticket | Feature flag + S5 route strip + grep gate |
| Frappe hooks missing on deploy | S0 preflight against live container + restore git tree |
| `ls_square` missing | S3 blocker test |
| Cookie auth breaks mobile Safari | S1 soak on iPad |
| Printed QR → app forever | Indefinite 301s |
| HOU untested | Don't market multi-location at cutover |
| types.ts churn mid-split | Monorepo packages, one PR train |
| Audit wrong | Stop rule — re-open STAGE_PLAN delta |

---

## 9. Suggested PR train

1. `chore(s0): packages + qr mount + dead UI purge`  
2. `feat(s1): apps/alts scaffold + cookie auth + CORS`  
3. `feat(s2): alts ticketing + create_ticket unify`  
4. `feat(s3): alts checkout + square verify`  
5. `feat(s4): alts transfers + workflow harden`  
6. `feat(s5): strip alts routes from admin`  
7. `chore(s6): dns redirects print base_url cutover`  

---

## 10. Approval gate

**This document is the only Stage 0 input.**  

Please approve or amend:
1. Monorepo + single API host (app) through S5  
2. Cookie SSO default  
3. NYC-first / HOU uncertified  
4. Rush fee freeze  
5. Security hotfixes in or out of critical path  
6. Any route map changes (especially `/pay` and `/customers` placement)

**No Stage 0 code until explicit approval.**
