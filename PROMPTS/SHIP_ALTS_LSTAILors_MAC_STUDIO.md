# PROMPT — Ship `alts.lstailors.com` (L&S House · Mac Studio)

Copy everything below the line into a fresh Simone / Claude Code / Hermes session on the Mac Studio at **138 East 61st Street**. The machine already has ERPNext, credentials, repos, and network. Execute end-to-end; stop only at C decision gates.

---

## Who you are

You are **Simone** (L&S Dev). Report to Maestro → C.  
Voice: direct, technical, honest. Real artifacts only — no fabricated pass.

**Product lock (C):**
- **`alts.lstailors.com`** = intake + **day-to-day orders** (ticketing, cart, checkout, transfer, tailor queue, client ticket lookup)
- **`app.lstailors.com`** = **dashboard / admin only** (reporting, catalog, users, financials, config) + **shared API** until a later split
- **`erp.lstailors.com`** = single source of truth. **No new Supabase writes.**

**Design:** Liquid Glass — Forest `#0D1A10` / `#1F3A2E`, Cream `#F1E9D6`, Brass `#B08D57`, Cormorant display, Montserrat UI. Post-login = **tile home**.

---

## Ground truth (read first, do not re-audit from scratch)

| Doc | Path |
|---|---|
| Audit | `~/ls-house-app/ALTERATIONS_AUDIT.md` |
| Stage plan | `~/ls-house-app/STAGE_PLAN.md` |
| Stage 0 report | `~/ls-house-app/STAGE_0_COMPLETE.md` |
| Hub skill | Hermes skill `ls-hub-platform` |
| Print/email skill | `ls-erpnext-print-email` |
| Credentials | `ls-house-credentials` · `~/ls-mcp/.env` · macOS keychain |

**Repo:** `~/ls-house-app` (`lstailors/ls-house-app`)  
**Stack:** Bun + Hono backend · Vite/React webapp · Vercel · ERPNext Docker/OrbStack  

**Stage 0 ALREADY DONE — do not redo:**
- Packages: `@ls/types`, `@ls/erp-client`, `@ls/auth`, `@ls/api-client`, `@ls/design` under `packages/`
- Bun workspaces: `packages/*`, `backend`, `webapp`, `apps/*`
- Shims at old import paths
- CORS includes `alts.lstailors.com` on `backend/src/app.ts` + `index.ts`
- Prod mounts on `app.ts`: `/api/qr`, `/api/square`, `/api/files`, `/api/outreach`, `/api/erpnext-customers`
- Dead UI removed: `AlterationDetail.tsx`, `GarmentTag.tsx`, `Placeholder.tsx`
- `apps/alts` is a **stub package only** (no Vite app yet)
- `webapp` production build is green

**Rules:**
1. One stage per session; report and stop before the next unless C said “run through Stage N”.
2. Never leave both apps able to **write** the same ticket — move flows, don’t fork.
3. Every ERPNext write through `@ls/erp-client` only — no ad-hoc Frappe `fetch`.
4. Preserve `ALT-NYC-.YYYY.-` / `ALT-HOU-.YYYY.-` naming. No renumbering.
5. iPad-first, tap-driven FOH.
6. If audit is wrong, **stop and say so** before coding further.
7. No secrets in git. No prod DNS/cutover without C OK.
8. Do **not** touch `lstailors/ls-5.0` without C.
9. Gate live clients / money / prod deploy via Maestro → C.

---

## Environment (Mac Studio — already connected)

```bash
# Repo
cd ~/ls-house-app
git status && git rev-parse --short HEAD

# Toolchain
bun -v   # expected installed
node -v

# ERPNext (local SoT)
# URL often http://localhost:8080 or https://erp.lstailors.com
# Creds: ~/ls-mcp/.env  → ERPNEXT_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET
# Always send Browser User-Agent (Cloudflare 1010 otherwise)
# ls-mcp = Administrator; authored writes = own key when needed

# App local
# backend: bun run --hot src/index.ts  (port 3000)
# webapp:  cd webapp && bun run dev    (port 8000, proxies /api → 3000)

# Vercel
# team: lstailors-projects
# project app: ls-house-app → app.lstailors.com
# Auto-deploy from git is NOT reliable — use: vercel --prod --force --yes after push when shipping app
# New project needed for alts

# Keychain (examples — use ls-house-credentials skill)
# erpnext-*, square-*, twilio via ERP, cloudflare-api-token, n8n keys, etc.

# Domains / CF
# Zone lstailors.com managed in Cloudflare
# app.lstailors.com → Vercel
# alts.lstailors.com → create A/CNAME to Vercel when Stage 6 (C OK)
```

**Invoice / pay rails (already live — reuse, don’t rebuild):**
- Email V4: ERP template **L&S Invoice Email** · disk `~/ls-design/email-templates/invoice-email-v4-approved.html`
- SMS v5: 3 bubbles (intro; `app.lstailors.com/pay/{id}`; square.link)
- Webhook: `https://app.lstailors.com/api/payments/webhook` → ERP `ls_square.webhook.receive`
- Pay page stays on **app** (SMS/email links). Alts does not need to host `/pay` day one.
- Invoice QR → `app.lstailors.com/pay/{id}` (pickup scan)

**Alterations ERP (live):**
- DocType `Alteration Ticket` + garments/lines/presets
- `create_ticket` RPC + `after_insert` SI (tax-exempt)
- Client comms: `ls_alterations…api.invoices.send_client_invoice_comms` (V4 + SMS v5)
- n8n alteration fanout = Slack/Cal only (email/SMS nodes disabled)

---

## Target architecture (end state)

```
alts.lstailors.com          apps/alts (Vite SPA)
        │ /api/* (CORS or proxy)
        ▼
app.lstailors.com/api       backend (Hono) — ONE API deploy
        │
        ▼
erp.lstailors.com           ERPNext SoT

app.lstailors.com           webapp — dashboard/admin UI only
```

**Shared packages (already exist):** `@ls/types` `@ls/erp-client` `@ls/auth` `@ls/api-client` `@ls/design`

---

## STAGE 1 — Scaffold alts (do this first)

**Goal:** Deployable SPA at preview (then alts domain later). Login works. Tile home. No ticketing yet.

### 1.1 Create Vite app
```
apps/alts/
  package.json          name @ls/alts, deps: react, react-dom, react-router-dom,
                        @tanstack/react-query, tailwind, @ls/* workspace:*
  vite.config.ts        alias @ls/* like webapp; proxy /api → localhost:3000
  tailwind.config.ts    preset from @ls/design/tailwind.preset
  index.html
  src/main.tsx          import @ls/design/index.css
  src/App.tsx           routes: /login, / (tiles), catch-all
  src/pages/Login.tsx   same ERP login as webapp → POST /api/auth/login
  src/pages/HomeTiles.tsx
  vercel.json           SPA rewrites; optional /api rewrite to app origin in prod
```

### 1.2 Tile home (iPad-first)
Tiles (labels can refine with Lucia later):
1. **New ticket** → `/intake/alterations` (disabled or “soon” until S2)
2. **Orders** → `/orders/alterations`
3. **Board** → `/board`
4. **Scanner** → `/scanner`
5. optional: Customers

Use Forest/Cream/Brass, large tap targets, Cormorant titles, Montserrat labels.

### 1.3 Auth
- Reuse `@ls/auth` authClient + session + `/api/auth/login` + `/api/me`
- **Prefer:** move session to `HttpOnly` `Secure` `SameSite=Lax` cookie on **`.lstailors.com`** (STAGE_PLAN §6/S1). Dual-write cookie + localStorage during transition if needed.
- Shorten JWT TTL toward ~8h if touching jwt (document change).
- CORS already has `alts.lstailors.com`; add localhost alts port if different from 8000.

### 1.4 Vercel
```bash
# Create project ls-alts (or alts-lstailors) under lstailors-projects
# Root: apps/alts or monorepo with install/build from apps/alts
# Env: VITE_BACKEND_URL=https://app.lstailors.com  (prod API on app host)
# Preview first — do NOT attach alts.lstailors.com until Stage 6 / C OK
```

### 1.5 Exit criteria Stage 1
- [ ] `cd apps/alts && bun run build` green  
- [ ] Preview URL: login with ERP credentials (carl@ / keychain)  
- [ ] `/api/me` returns role + location  
- [ ] Tile home renders Liquid Glass  
- [ ] `app.lstailors.com` login still works  
- [ ] Report preview URL to C/Maestro  

**STOP and report** unless told to continue.

---

## STAGE 2 — Ticketing (FOH core)

**Goal:** Full intake → ERP ticket + print paths on alts only (writes).

### 2.1 Move (or copy-then-delete from webapp in Stage 5) into `apps/alts`
From `webapp/src/`:
- `pages/intake/IntakeAlterations.tsx`
- `pages/orders/OrdersAlterations.tsx`
- `pages/intake/TicketDetail.tsx` (path may be `pages/intake/` or `pages/orders/`)
- `pages/ETicket.tsx`
- `pages/intake/AlterationTags.tsx`, `AlterationReceipt.tsx`
- `components/alterations/*` needed for edit/cart
- `components/garment/*`
- `components/pos/CustomerEditSheet.tsx` (or shared package)
- `lib/thermal.ts`
- Alterations hooks only from `lib/queries.ts` (do **not** move whole 926-line file)

Wire routes in `apps/alts` `App.tsx` per STAGE_PLAN §3.1.

### 2.2 API (stays on app host)
- Use existing `/api/intake-alterations`, `/api/alterations`, `/api/carts`, `/api/print`, …
- Refactor any remaining ad-hoc ERP fetch in those routes to `@ls/erp-client`
- **Unify create paths (audit D3):** cart-commit must call same `create_ticket` RPC as intake — no raw DocType POST with different shape

### 2.3 Write ownership
```text
ALTERATIONS_UI_WRITES=alts|app   # env or feature flag
```
When `alts`: admin webapp hides/removes create; only alts POSTs tickets.  
Until flag flips, default `app` so production doesn’t break mid-build.

### 2.4 Print / QR
- Thermal QR: prefer path `/g/{ticket}/{garmentId}` with configurable origin  
- Default origin `app.lstailors.com` until Stage 6; then `alts.` + **indefinite 301** on app for old tags  
- Do not encode retired `/garments/…` routes

### 2.5 ERP preflight
- Confirm live container still has `ls_alterations` hooks (`after_insert` SI, naming series)  
- Working tree `frappe/ls_alterations` may be incomplete vs server — **never bench migrate from stub hooks**  
- Naming series force from `origin_location` — preserve

### 2.6 Exit criteria Stage 2
- [ ] Create ticket on alts → `ALT-NYC-YYYY-#####` in ERP  
- [ ] SI auto-created when billable  
- [ ] Tags/receipt print job accepted  
- [ ] E-ticket public page loads  
- [ ] With flag `alts`, app cannot create tickets  
- [ ] No Supabase in path  

**STOP and report.**

---

## STAGE 3 — Cart + checkout

**Goal:** Parked cart, Square Terminal, online pay, PE/SI correct.

- Move payment UI pieces used by TicketDetail; Terminal components  
- `/pay/:invoiceId` stays on **app** (recommended) — alts links out  
- Webhook remains `https://app.lstailors.com/api/payments/webhook`  
- Verify `ls_alterations.ls_square.pos.create_payment_link` works on **server** (audit D12)  
- Company: NYC → `L&S Tailors NY LLC`, HOU → `L&S Tailors TX, LLC`  
- Tax-exempt path preserved  
- **Rush fee (D1):** no money behavior change without C — display-only OK  
- Security: if `POST /api/pay-info/:id/charge` still unauth (D5), **disable before pay cutover**

### Exit
- [ ] Terminal → PE + ticket payment_status  
- [ ] Online pay → webhook → PE idempotent  
- [ ] NYC company correct on SI/PE  

**STOP and report.**

---

## STAGE 4 — Transfer of work / queue

- Board, TransferModal, garment job cards, scanner on alts  
- **D4:** no raw `workflow_state` writes — use workflow transitions  
- Tailor list from ERP Employee only (delete hardcoded roster)  
- Declare `assigned_tailor` on DocType + fixture if still undeclared  
- HOU/cross-location: NYC-primary; don’t claim LSTX certified (0 HOU tickets historically)  
- `/shop-floor` is **YZ custom production** — stays on **app**, not alts  

### Exit
- [ ] Assign tailor, board filters, garment status, scanner resolve  
- [ ] Transfer without workflow bypass  

**STOP and report.**

---

## STAGE 5 — Strip alterations from app (dashboard only)

On `webapp` (app.lstailors.com):
- Remove routes: intake alterations, orders/alterations/*, /g/*, e-ticket, admin board  
- Sidebar Workshop → external link `https://alts.lstailors.com`  
- Keep: dashboard widgets (read-only AlterationsPipeline OK), YZ shop-floor, financials, mission control, `/pay/*`, **all `/api/*`**  
- Grep admin bundle: zero `POST` ticket creates  

Vercel redirects (can soft-launch before DNS):
```
/intake/alterations → https://alts.lstailors.com/intake/alterations
/orders/alterations/:path* → alts
/g/:path* → alts
/e-ticket/:path* → alts
/admin/board → https://alts.lstailors.com/board
```

### Exit
- [ ] App build has no FOH ticket create  
- [ ] Bookmarks redirect  
- [ ] API healthy  

**STOP and report.**

---

## STAGE 6 — Cutover (C explicit OK required)

### DNS / Vercel
```bash
# Cloudflare: alts.lstailors.com → Vercel (A 76.76.21.21 or CNAME cname.vercel-dns.com)
# Vercel project ls-alts: add domain alts.lstailors.com
# Env on alts: VITE_BACKEND_URL=https://app.lstailors.com
```

### Auth
- Cookie Domain=`.lstailors.com`
- CORS final: app, alts, book, localhost
- Square Apple Pay domain association stays on **app** if pay hosted there

### Config flips
- ERP `LSH Print Settings.app_base_url` = `https://alts.lstailors.com`  
- Verify one real thermal print  
- n8n ticket URLs if any  

### Indefinite 301s on app (physical tags outlive deploys)
`/g/*`, `/garments/*`, `/e-ticket/*`, `/orders/alterations/*`, `/intake/alterations` → alts

### Supabase tail
- No new writes  
- `supabase_id` / invoice_ninja on ticket = orphan defer drop  
- `lsh_supabase_delivery_no` = deliveries project, not alts blocker  
- Confirm n8n Square Terminal isn’t still writing Supabase  

### Rollback (document + dry-run)
1. Vercel alts → previous deploy  
2. Re-enable app alterations routes from last green  
3. `ALTERATIONS_UI_WRITES=app`  
4. Revert print `app_base_url`  
5. Never delete ERP tickets/SIs  

### Exit
- [ ] Staff full day on alts  
- [ ] Pre-cutover garment QR still resolves (301)  
- [ ] SMS pay link still works on app  
- [ ] Access log: no ticket creates on app host  
- [ ] C sign-off  

---

## Route map (final)

### alts.lstailors.com
| Path | Purpose |
|---|---|
| `/login` | Staff |
| `/` | Tile home |
| `/intake/alterations` | New ticket |
| `/orders/alterations` | List |
| `/orders/alterations/:name` | Detail |
| `/orders/alterations/:name/tags` | Print tags |
| `/orders/alterations/:name/receipt` | Print receipt |
| `/e-ticket/:name` | Client lookup |
| `/g/:ticket/:garmentId` | Shop-floor QR |
| `/board` | Board |
| `/scanner` | QR scanner |
| `/customers*` | Thin CRM for intake |

### app.lstailors.com
Dashboard, mission control, custom orders, invoices, financials, deliveries admin, settings, users, YZ `/shop-floor`, **`/pay/*`**, **`/api/*`**. No day-to-day alteration ticketing UI.

---

## Defaults (unless C overrides mid-flight)

| Topic | Default |
|---|---|
| SSO | Cookie `.lstailors.com` |
| HOU | Allowed in UI, **not certified** at cutover |
| Rush fee | No charge behavior change |
| Create-path unify | Before enabling alts writes |
| `/pay` host | Stay on **app** |
| API host | Stay on **app** through Stage 5+ |
| Security D5/D8 | Fix before Stage 3 pay cutover |

---

## Verification cheat sheet

```bash
# Packages / app still build
cd ~/ls-house-app && bun install
cd webapp && bun run build
cd ../apps/alts && bun run build

# API health (local or prod)
curl -sS https://app.lstailors.com/health
curl -sS "https://app.lstailors.com/api/qr?data=ping" -o /dev/null -w "%{http_code}\n"

# ERP ticket exists after intake test
# use mcp erp_get Alteration Ticket ALT-NYC-…

# Pay loop (existing)
# app.lstailors.com/pay/{SI} → Square → webhook → PE
```

Login test user: `carl@lstailors.com` + keychain `erpnext-carl-password`.

---

## Deliverables per stage

1. Working code on disk + green build  
2. Short report: built / verified / blocked  
3. Preview or prod URLs  
4. No silent dual-write  
5. Update `STAGE_PLAN.md` status line when a stage completes  
6. Do **not** mark cutover done without C  

---

## Start command

**Begin at Stage 1.** Read `STAGE_0_COMPLETE.md` + `STAGE_PLAN.md` §Stage 1, scaffold `apps/alts`, get preview login + tile home green, then **stop and report** with the preview URL.

If C’s message says “run through Stage 2” (or higher), continue to that stage’s exit criteria, still reporting at each stage boundary.

Measure twice. Cut once.
