# BUILD PROMPT — Split Alterations onto `alts.lstailors.com`

**Hand this entire file to the coding agent as its opening instruction.**
Author: Lucia (UI/Visual Design, L&S House). Runtime: Mac Studio, full local access.
Repo: `/Users/Maestro_1/ls-house-app` — `lstailors/ls-house-app`, branch `main`.

---

## 0. YOUR ROLE AND THE TWO GROUND-TRUTH DOCUMENTS

You are completing a staged split of the L&S House app into two applications. Two
documents at the repo root are **ground truth**. Read both in full before writing
any code:

| File | What it is |
|---|---|
| `ALTERATIONS_AUDIT.md` | Forensic read-only audit. Every defect is cited `file:line`. Defect IDs (D1–D27) are referenced throughout this prompt. |
| `STAGE_PLAN.md` | The approved plan: package boundaries, file moves, route maps, rollback. |

If either document turns out to be **wrong about something**, STOP and report it
before coding. Do not silently work around it. This rule has already paid off
once — the audit missed that the repo was not a workspace at all.

### Target architecture (approved by C, 2026-07-26)

- **`app.lstailors.com` → DASHBOARD ONLY.** Reporting, catalog + pricing, user and
  role admin, financial views, configuration. No day-to-day ticketing.
- **`alts.lstailors.com` → INTAKE AND DAY-TO-DAY ORDERS.** Ticketing, cart,
  checkout, transfer of work, tailor queue, client ticket lookup. This is the
  daily-driver operational surface. **iPad-first, tap-driven, not form-heavy.**
- **ERPNext at `erp.lstailors.com` is the single source of truth.** No new Supabase
  writes, ever. Every Supabase dependency is replaced with an ERPNext equivalent
  or explicitly deferred **with a written reason**.

---

## 1. HARD RULES — violating any of these fails the stage

1. **One stage per session.** Stop at the end of each stage, report, and wait.
   Do not roll into the next stage because you have budget left.
2. **Never leave both apps able to write the same ticket.** Move a flow, don't
   fork it. Copy → verify → delete from the origin **within the same stage**.
3. **Every ERPNext read and write goes through `@ls/erp-client`.** No ad-hoc
   `fetch` to `/api/resource/*` or `/api/method/*` anywhere else.
4. **Preserve ticket numbers and naming series.** `ALT-NYC-.YYYY.-` and
   `ALT-HOU-.YYYY.-`, assigned server-side from `origin_location`. No renumbering,
   no new series, no client-side number generation.
5. **No deletions without approval** — archive or leave in git history. Git-tracked
   moves (`git mv`) are fine; `rm` of a file with unique content is not.
6. **No secrets in files or commits.** Credentials come from env / keychain.
7. **Never deploy.** No `vercel deploy`, no DNS changes, no ERPNext config writes.
   You prepare; C approves and executes. See §8.
8. **Do not touch `lstailors/ls-5.0`** (the store site). Out of scope entirely.
9. **Work on a branch**, never commit directly to `main`. Branch name:
   `feat/alts-split-stage-N`.
10. **Verify with real output.** Never report a build green without pasting the
    actual build result. No fabricated command output, ever.

---

## 2. CRITICAL: THERE IS A CONCURRENT WRITER IN THIS REPO

Another agent has been editing these files. Evidence: `webapp/vite.config.ts`
already contained `@ls/*` aliases that Lucia did not add, and a
`packages/api-client/` directory appeared unprompted.

**Therefore, on every single file you modify:**

- **Re-read the file immediately before writing to it.** Never write from a stale
  view.
- **Never use `git checkout --force`, `git reset --hard`, or `git clean`.** You
  will destroy someone else's work.
- If a file's contents differ from what this prompt describes, **reconcile, don't
  overwrite.** Report the divergence in your summary.
- Before starting, run `git status --porcelain` and `git log --oneline -5` and
  report what you find.

**Also beware over-broad regex rewrites.** A previous bulk `sed`/regex pass
flattened three files (`webapp/src/lib/api.ts`, `authClient.ts`, `session.ts`) to
single-line re-exports because the pattern matched a shim line. They were
recovered from git. **After any bulk rewrite, audit for damage:**

```bash
cd /Users/Maestro_1/ls-house-app
for f in $(git diff --name-only); do
  n=$(wc -l < "$f" 2>/dev/null || echo 0)
  [ "$n" -le 3 ] && echo "SUSPECT ($n lines): $f"
done
```

Any file that collapsed to ≤3 lines and is not an intentional shim is damage.
Restore it with `git show HEAD:<path>`.

---

## 3. EXACT CURRENT STATE — Stage 0 is ~85% done and THE BUILD IS RED

### Already completed and verified

| Item | Detail |
|---|---|
| Bun workspace | Root `package.json` has `"workspaces": ["packages/*","backend","webapp"]` |
| **zod unified** | `4.1.11` in root, backend **and** webapp. Was a v3/v4 split. Verified resolved. |
| `@ls/types` | `backend/src/types.ts` (1,141 lines) → `packages/types/src/index.ts` via `git mv` |
| `@ls/auth` | `lib/jwt.ts`, `lib/scope.ts` → `packages/auth/src/` |
| `@ls/erp-client` | `lib/erp.ts` + `lib/erpnext/` (12 modules) → `packages/erp-client/src/` |
| `@ls/design` | 8 glass components, **49** `ui/` primitives, `use-mobile`, `use-toast`, `format.ts`, `utils.ts`, `index.css`, `tokens.ts`, `tailwind.preset.ts`. **Fully self-contained — zero `@/` imports remain inside it.** |
| Backend shims | `backend/src/types.ts`, `lib/jwt.ts`, `lib/scope.ts`, `lib/erp.ts` are now thin re-exports, so 100+ backend imports did not churn |
| Deleted | `webapp/src/lib/scope.ts` (divergent copy — **audit D2**) and `webapp/src/lib/types.ts` (cross-tree re-export) |
| Moved back | `useAppointments.ts` → `webapp/src/hooks/` (app logic, not design) |
| Rewired | `webapp/vite.config.ts` alias **array** (order-sensitive), `webapp/tailwind.config.ts` uses `lsPreset`, `main.tsx` imports `@ls/design/src/index.css` |
| ~215 imports | Rewritten across 106+ webapp files to `@ls/*` |

### THE ONE REMAINING BUILD ERROR

```
[vite]: Rollup failed to resolve import "@tanstack/react-query"
from "/Users/Maestro_1/ls-house-app/packages/auth/src/session.ts"
```

`packages/auth/src/session.ts` also imports `@ls/api-client`. Neither is a
declared dependency of `packages/auth`.

### RESOLUTION — DO THIS, IT IS DECIDED

The concurrent writer put client-side React code inside `@ls/auth`, which also
contains server-side JWT signing. That boundary is wrong: it forces a
server-side package to depend on React Query and `import.meta.env`.

**Correct boundary — implement exactly this:**

| Package | Contents | Environment |
|---|---|---|
| `@ls/auth` | `jwt.ts`, `scope.ts` **only** | Server / edge. Deps: `@ls/types`, `hono`. |
| `@ls/api-client` | `api.ts`, `authClient.ts`, `session.ts` | Browser. Deps: `@ls/types`, `@tanstack/react-query`. |

Steps:
1. `git mv packages/auth/src/session.ts packages/auth/src/authClient.ts` → `packages/api-client/src/`
2. Move `webapp/src/lib/api.ts` → `packages/api-client/src/api.ts`
3. `packages/auth/src/index.ts` exports **only** `./jwt` and `./scope`
4. `packages/api-client/src/index.ts` exports `api`, token helpers, `useMe`, `useInvalidateMe`, `ME_KEY`
5. Declare deps in both `package.json`s
6. Add matching **order-sensitive** aliases to `webapp/vite.config.ts` — specific
   subpaths **before** the bare package alias, or `@ls/design` swallows
   `@ls/design/ui/button`
7. Leave `webapp/src/lib/api.ts` as a one-line re-export shim so existing imports survive

**This corrects `STAGE_PLAN.md` §1.3.** Patch that document to match, and note the
correction in your report.

---

## 4. VERIFICATION GATES — exact commands, paste real output

### The backend already fails typecheck at baseline. This is expected.

**45 pre-existing errors** across 8 files: `locations.ts` (16), `sofia.ts` (14),
`raven.ts` (4), `agents.ts` (4), `square-terminal.ts` (3), `jwt.ts` (2),
`pay-info.ts` (1), `intake-alterations.ts` (1).

The 2 in `jwt.ts` are inside a file Stage 0 extracts — **fix those two**. Leave
the other 43 alone; they are unrelated scope creep across Sofia, locations and
Raven. **Do not "helpfully" fix them.**

```bash
cd /Users/Maestro_1/ls-house-app

# GATE 1 — webapp build MUST be green
cd webapp && bun run build 2>&1 | tail -5
# Expect: "✓ built in Ns". Baseline was 3.62s / ~2,100 modules.

# GATE 2 — backend errors must be ≤43 and no NEW file may appear
cd ../backend && bun run typecheck 2>&1 | grep -cE "error TS"
bun run typecheck 2>&1 | grep -oE "^src/[a-zA-Z0-9/_-]+\.ts" | sort | uniq -c | sort -rn

# GATE 3 — alts build green (from Stage 1 onward)
cd ../alts && bun run build 2>&1 | tail -5
```

If a gate fails, fix it or report it. **Never describe a gate as passing without
the pasted output.**

---

## 5. STAGE 0 — FINISH IT (this session)

1. Report `git status --porcelain` + `git log --oneline -5` (concurrent-writer check).
2. Implement the §3 package boundary fix.
3. **Fix audit D16 — production is missing routers.** `backend/src/index.ts` mounts
   `qrRouter` `/api/qr`, `squareRouter` `/api/square`, `filesRouter`,
   `outreachRouter`, `erpnextCustomersRouter`; **`backend/src/app.ts` (the Vercel
   entry) does not.** `app.ts:1-3` claims parity — it is false. Mount all five in
   `app.ts`. **`/api/qr` missing is why ERPNext tag-print QRs are broken in
   production right now.** Fix this in Stage 0 so Stage 2 doesn't appear to cause it.
4. Update `vercel.json` `installCommand` for the workspace (single root
   `bun install` now suffices).
5. Run all gates. Paste output.
6. Commit to `feat/alts-split-stage-0`. **Do not merge.**
7. **STOP. Report.**

---

## 6. STAGES 1–6

### Stage 1 — Scaffold `alts/`

New Vite + React + TS app at `alts/`, added to root `workspaces`.

- Consumes `@ls/design` (Liquid Glass), `@ls/types`, `@ls/api-client`, `@ls/erp-client`.
- **Tile-based post-login home** — not a sidebar. Tiles: **Intake · Tickets · Shop
  Floor · Scanner · Transfers**. Each tile launches a module.
- **iPad-first:** minimum 88×88pt tap targets (`TAP_TARGET_MIN_PX` in
  `@ls/design/tokens`), thumb-reachable primary actions, no dense forms in the
  front-of-house path.
- Liquid Glass, from tokens only — **no new colours, no new fonts:**
  Forest `#0D1A10` / `#1F3A2E`, Cream `#F1E9D6`, Brass `#B08D57` (the **sole**
  accent), Cormorant Garamond display, Montserrat UI caps.
- **Auth — the hardest coupling.** Today: HS256 JWT in `localStorage["lst_token"]`,
  origin-scoped, role baked in for **30 days**. Change to a cookie scoped to
  `.lstailors.com` (`Secure`, `HttpOnly`, `SameSite=Lax`) and shorten to **8h with
  refresh** so role changes land within a shift. `credentials: true` is already set
  (`backend/src/index.ts:73`); `api.ts` switches to `credentials: "include"`.
  **`JWT_SECRET` must be identical on both projects or the shared cookie is worthless.**
- **Add `alts.lstailors.com` to the CORS allow-list in BOTH `backend/src/index.ts:56-67`
  AND `backend/src/app.ts:60-71`.** They diverge; `index.ts` has no `ALLOWED_ORIGINS`
  env override, so it must be edited directly.
- Gate: `alts/` builds, deploys to a preview URL, and a real user can log in.
  **Nothing else works yet — that is correct.**

### Stage 2 — Ticketing

Move intake through printed ticket. Files per `STAGE_PLAN.md` §2.2.

- **Fix audit D3 first — two creation paths that disagree.** Intake posts to
  `POST /api/intake-alterations/tickets` → RPC `ls_alterations.api.create_ticket`
  (sends `preset: null`, lets the server assign state, garment IDs and series).
  Parked-cart commit posts **raw** to `/api/resource/Alteration Ticket`
  (`packages/erp-client/src/erpnext/parked-carts.ts:~142`) setting
  `workflow_state`, `preset`, `garment_status`, `line_status` itself. A ticket's
  shape depends on which door it came through. **Both must route through one
  `writeTicket()` façade in `@ls/erp-client` that calls `create_ticket`.**
- **Fix audit D1 — the $25 rush fee is displayed and never billed.** Hardcoded in
  the UI at `IntakeAlterations.tsx:1083` and `:1699`; the API sends only
  `is_rush`. **Ask C before changing what a client is charged.** Default: surface
  it as a real line item; do not silently drop it.
- Alterations are **tax-exempt** — `taxes_and_charges: ''`. Preserve that.
- **Fix audit D20** — printed tags encode the retired `/garments/…` route
  (`thermal.ts:130`). Point at `/g/:ticket/:garmentId`.
- **Fix audit D17** — QR images hotlink `api.qrserver.com`
  (`intake-alterations.ts:18`), leaking ticket URLs to a third party. Use the
  first-party `/api/qr` you mounted in Stage 0.
- Gate: create a real ticket in ERPNext, series preserved, thermal tag prints.

### Stage 3 — Cart + checkout

- Square Terminal (card-present) and Square hosted online checkout. **The Web
  Payments SDK is deliberately absent** — hosted `square.link` only, so Apple Pay
  works. Do not re-add the SDK.
- Sales Invoice + Payment Entry correct **per company**:
  `NYC → "L&S Tailors NY LLC"`, `HOU → "L&S Tailors TX, LLC"`.
- **`ls_square` is missing from the repo but LIVE on the server** — the pay loop is
  proven working in production. Do not rebuild it. Bring it under version control
  as a separate task and report.
- **Rewire the last live Supabase write:** `n8n/square-terminal-webhook.json`
  (nodes ~124-129, ~172-177, credential `supabase-ls-house`) writes to Supabase.
  Move to ERPNext. This is the only remaining runtime Supabase write.
- **Known n8n hazard:** WF-10 matches Payment Entry by **amount**, not
  `reference_id`, so it mis-posts when two open invoices share a value.
  **Collision-check before any live payment test.**
- Gate: a real Payment Entry lands against the right company.

### Stage 4 — Transfer of work

- **Fix audit D4 — workflow bypass.** `backend/src/routes/transfers.ts:83,88`
  writes `workflow_state` directly while `Alteration Ticket Workflow` is
  `is_active: 1`. Use `frappe.model.workflow.apply_workflow` with named actions:
  `Start Work`, `Mark Ready`, `Mark Picked Up`, `Cancel`, `Reopen`.
- **Fix audit D7 — Houston hardcoded out.** `transfers.ts:102,109` posts the
  tailor-payment Journal Entry to `Subcontractor Expense - LSTNY` / `Cash - LSTNY`
  regardless of location. Parameterise by company. **This route has no role gate
  despite creating GL entries — add one (`canSeeFinancials` or stricter).**
- **Fix audit D21** — hardcoded tailors `HR-EMP-00020/21` in KPI queries and
  response field names (`stellaWip`/`hugoWip`), plus a static 4-person roster in
  `transfers.ts:8-11`. Query ERPNext Employee like `garment.ts:112` already does.
- Cross-location transfer currently only overwrites `origin_location` — no company
  change, no stock move, no validation. **Live data: all 30 tickets are NYC, zero
  HOU. This path has never run in production.** Treat as unproven.
- Gate: every transition goes through the workflow engine; state verified in ERPNext.

### Stage 5 — Reduce `app.` to dashboard only

- Delete alterations routes and components per `STAGE_PLAN.md` §2.2, plus **audit
  D18**: `pages/orders/AlterationDetail.tsx` (511 lines),
  `pages/GarmentTag.tsx` (251), `pages/Placeholder.tsx` — all dead, routed nowhere.
- Prune the nav array `components/shell/Sidebar.tsx:38-100`.
- **`/shop-floor` STAYS on `app.`** — it is YZ custom-order production, *not*
  alterations, despite being tailor-gated (audit §1.3).
- **`components/dashboard/AlterationsPipeline.tsx` STAYS** — reporting is a
  dashboard concern.
- **Ship in both:** `/scanner`, `/pay/:invoiceId`, `/customers*`.
- **BEFORE deleting anything: `git tag pre-alts-cutover`.** This tag is the rollback
  artifact — Stage 5 is what makes rollback non-trivial, not Stage 6.
- Remove the dead `@supabase/supabase-js` dep from `webapp`.

### Stage 6 — Cutover (C executes the infra parts)

1. Vercel project `ls-alts`, root dir `alts/`. **All 8 crons stay on `app.`**
   (`vercel.json:11-44`).
2. Verify on `*.vercel.app` first: login + one full ticket end to end.
3. DNS `alts.lstailors.com` → Vercel. **TTL lowered to 300s ≥24h beforehand.**
4. CORS live in both entries. Cookie domain `.lstailors.com`.
5. ERPNext `LSH Print Settings.app_base_url` → `https://alts.lstailors.com`.
6. Square redirect + webhook URLs.
7. **PERMANENT 301s** on `app.` for `/intake/alterations`, `/orders/alterations/*`,
   `/g/*`, `/garments/*`, `/e-ticket/*`, `/pay/*`, `/admin/board`.
   **Printed garment tags are physical objects that outlive any deploy — garments
   tagged before cutover will keep arriving for months. These redirects are
   forever, not temporary.**
8. 48h watch.

**Rollback triggers:** staff cannot create or pay a ticket, or any ticket writes
wrong data. Fastest path is Vercel instant rollback to the `pre-alts-cutover`
deployment. Keep that deployment immutable — never delete it. Printing rolls back
by reverting one ERPNext field, no deploy needed.

---

## 7. SECURITY — REQUIRED BEFORE STAGE 6, ASK C FIRST

These are live on `app.` right now and get worse behind a new public domain.
**Report to C and get explicit go-ahead before touching payment code.**

| ID | Defect | Location |
|---|---|---|
| **D5** | **Unauthenticated payment endpoint with caller-controlled amount.** `POST /api/pay-info/:id/charge` — no auth, no rate limit, `amount_cents` from the request body goes straight to Square. No caller exists in the repo (the Web Payments SDK was removed). | `backend/src/routes/pay-info.ts:391-424` |
| **D8** | **Live shared secret committed to source** — `DISPATCH_WEBHOOK_KEY` defaults to `"lsd_dsp_9k2fQ7xWm4vT"`. | `backend/src/routes/dispatch.ts:13` |
| **D9** | **Three webhook guards fail OPEN** when their env var is unset (`if (secret && …)`): `/api/alterations/erp-webhook/ready`, `/api/webhooks/unifi`, `/api/maestro/brief`. Only `outreach.ts:11` fails closed. | as cited |
| **D10** | `POST /api/invoices/:id/mark-paid` omits the `canSeeFinancials` gate its siblings enforce — any authenticated role can zero an invoice. | `backend/src/routes/invoices.ts:150` |
| **D6** | Public ticket endpoint is enumerable (sequential `ALT-NYC-2026-000NN`), exposing customer name, totals, garments. | `backend/src/routes/intake-alterations.ts:91-118` |
| **D13** | `GET /api/print/config` unauthenticated — leaks LAN printer IP/port. Every sibling checks auth. | `backend/src/routes/print.ts:87` |

---

## 8. WHAT YOU MUST NOT DO — these are C's, not yours

Prepare and document these; do not execute:

1. Creating the Vercel project or deploying anything.
2. DNS changes.
3. Setting env vars on the new project (`ERPNEXT_API_KEY`/`_SECRET`,
   `ERPNEXT_MCP_TOKEN`, `JWT_SECRET`, `SQUARE_ACCESS_TOKEN`,
   `SQUARE_LOCATION_ID`, `TWILIO_*`).
4. Writing ERPNext configuration (including `LSH Print Settings`).
5. Square dashboard changes.
6. Merging to `main`.

**Note:** Apple Pay needs **no** new domain association — checkout is hosted on
`square.link`, so Apple Pay runs on Square's domain. The `.well-known` blob served
at `backend/src/app.ts:93` stays with `app.` as-is.

**ERPNext writes:** direct Frappe REST from this host is **WAF-blocked (403, code
1010)**. Use the MCP `erp_*` tools for any manual ERPNext inspection or write.

---

## 9. OPEN DECISION — do not guess

**Houston / LSTX.** Zero HOU tickets have ever existed and cross-location transfer
has never run. C has not confirmed whether LSTX is required at cutover.

**Build location-parameterised anyway** — never hardcode `LSTNY`, and remove the
existing hardcodes in `transfers.ts:102,109`. But **verify only NYC** and report
HOU as unproven. Do not invent Houston test data in production.

---

## 10. REPORTING FORMAT — end every stage with this

```
STAGE N COMPLETE — <one line>

CONCURRENT WRITER CHECK
  git status / git log findings; any divergence from this prompt

CHANGED
  <file:line> — what and why   (group logically)

GATES  (paste real output)
  webapp build:      <result>
  backend typecheck: <count> errors (baseline 45, gate ≤43)
  alts build:        <result>

AUDIT DEFECTS FIXED
  D<n> — how, verified by <what>

AUDIT WRONG ABOUT
  anything ground truth got wrong — or "nothing"

DEFERRED (with reason)
  item — why, and which stage picks it up

NEEDS C
  decisions or access required before the next stage

NOT DONE
  anything attempted and abandoned, and why
```

**Honesty over polish.** A blocker reported plainly is worth more than a green
checkmark that isn't real. If a tool, install, or network call fails and blocks
the real path, say so and try an alternative — never substitute plausible-looking
output for a result you could not produce.

---

## 11. START HERE

1. Read `ALTERATIONS_AUDIT.md` and `STAGE_PLAN.md` in full.
2. Run the concurrent-writer check (§2).
3. Complete Stage 0 (§5).
4. Run all gates and paste real output.
5. Commit to `feat/alts-split-stage-0`.
6. **STOP and report in the §10 format.**

Do not begin Stage 1 in the same session.
