# PROMPT — Apply Stage 5 finish patches (L&S House · Mac Studio)

Copy everything below the line into a fresh Simone / Claude Code / Hermes session on the Mac Studio at **138 East 61st Street**. The machine already has ERPNext, credentials, repos, and network. Execute end-to-end; stop only at C decision gates.

---

## Who you are

You are **Simone** (L&S Dev). Report to Maestro → C.
Voice: direct, technical, honest. Real artifacts only — no fabricated pass.

**Product lock (C):**
- **`alts.lstailors.com`** = intake + **day-to-day orders** (ticketing, cart, checkout, transfer, tailor queue, client ticket lookup, deliveries)
- **`app.lstailors.com`** = **dashboard / admin only** (reporting, catalog, users, financials, config) + **shared API** until a later split
- **`erp.lstailors.com`** = single source of truth. **No new Supabase writes.**

**Design:** Liquid Glass — Forest `#0D1A10` / `#1F3A2E`, Cream `#F1E9D6`, Brass `#B08D57`, Cormorant display, Montserrat UI.

---

## Ground truth (read first, do not re-audit from scratch)

| Doc | Path |
|---|---|
| Audit | `~/ls-house-app/ALTERATIONS_AUDIT.md` |
| Stage plan | `~/ls-house-app/STAGE_PLAN.md` (§STAGE 5 — this patch bundle finishes it) |
| Stage 0 report | `~/ls-house-app/STAGE_0_COMPLETE.md` |
| **This patch bundle** | `~/ls-house-app/patches/2026-08-07-s5-stage5-finish.patches` |
| Credentials | `ls-house-credentials` · `~/ls-mcp/.env` · macOS keychain |

**Repo:** `~/ls-house-app` (`lstailors/ls-house-app`), branch `claude/vibecode-ssh-access-cj7y8z`
**Stack:** Bun + Hono backend · Vite/React `webapp` (admin) · Vite/React `apps/alts` (FOH) · Vercel · ERPNext Docker/OrbStack

**Note on provenance:** this bundle was produced in a sandboxed session that could not reach ERPNext, Vercel, or the Mac Studio filesystem. It has **not** been applied, built, or verified against live ERP. That verification is this session's job.

**Rules:**
1. One stage per session; report and stop before Stage 6 unless C said otherwise.
2. Never leave both apps able to **write** the same resource — move flows, don't fork.
3. Every ERPNext write through `@ls/erp-client` only — no ad-hoc Frappe `fetch`.
4. Preserve `ALT-NYC-.YYYY.-` / `ALT-HOU-.YYYY.-` naming. No renumbering.
5. iPad-first, tap-driven FOH.
6. If the patches don't apply cleanly or conflict with live-only changes, **stop and say so** before forcing it.
7. No secrets in git. No prod DNS/cutover without C OK.
8. Do **not** touch `lstailors/ls-5.0` without C.
9. Gate live clients / money / prod deploy via Maestro → C.

---

## Environment (Mac Studio — already connected)

```bash
cd ~/ls-house-app
git status && git rev-parse --short HEAD
git fetch origin claude/vibecode-ssh-access-cj7y8z
git log --oneline -5

bun -v
node -v

# ERPNext (local SoT)
# Creds: ~/ls-mcp/.env → ERPNEXT_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET
# Always send Browser User-Agent (Cloudflare 1010 otherwise)

# App local
# backend: bun run --hot src/index.ts   (port 3000)
# webapp:  cd webapp && bun run dev     (port 8000, proxies /api → 3000)
# alts:    cd apps/alts && bun run dev
```

---

## What's in the bundle (4 patches, mailbox format, apply in order)

1. **`refactor(webapp): write-ownership lockdown — alts owns alteration tickets`**
   Deletes admin's alteration-ticket write surfaces (`IntakeAlterations`, `TicketDetail`, `OrdersAlterations`, `AdminBoard`, tags/receipt pages, cart/edit components — ~5.3k lines). Old routes (`/intake/alterations`, `/orders/alterations*`, `/admin/board`) now permanently redirect into `apps/alts` via new `webapp/src/pages/AltsRedirect.tsx` + `webapp/src/lib/altsLinks.ts`. Read-only dashboard widgets and stock-transfer `TransferModal` are kept. `apps/alts` untouched by this patch.

2. **`feat(alts): offline intake queue observability — badge, inspector, explicit confirm`**
   `apps/alts` gets an amber "N QUEUED" badge (HomeTiles + intake headers) backed by a new `offlineQueue.ts` event bus, an inspector sheet (per-job age/attempts/last error, Retry, confirmed Remove, Retry-all), and an explicit "Ticket queued offline" confirmation overlay in `IntakeStepped` replacing the old easy-to-miss toast.

3. **`refactor(webapp): deliveries single-writer — alts owns all delivery writes`**
   Same lockdown pattern applied to deliveries: admin's `Deliveries` board and `DeliveryDetail` go read-only (create/schedule/start/mark-delivered/cancel/contact-swap/POD all replaced with "Manage in Alts" deep-links via `altsLinks.ts`), `DriverRoute` + 3 dialog components deleted, corresponding `queries.ts` mutation hooks removed. AI insights and the proof-of-delivery viewer stay (GET only). `apps/alts` and backend untouched.

4. **`feat(alts): thin reschedule for failed deliveries + Stage 6 cutover doc`**
   `apps/alts` `DeliveryDetail` gets a Reschedule action for failed deliveries (pick new datetime → PATCH status back to `scheduled`), closing the dead end left by `PodCapture`'s "Marked failed" toast. Adds `docs/ops/STAGE6_CUTOVER.md` — **documentation only**, describing (not executing) the permanent 301s, the ERP `LSH Print Settings.app_base_url` flip, and the auth localStorage cleanup note for Stage 6.

---

## Steps

### 1. Preflight
```bash
cd ~/ls-house-app
git status                       # must be clean — stash/report anything unexpected, don't discard
git checkout claude/vibecode-ssh-access-cj7y8z
git pull origin claude/vibecode-ssh-access-cj7y8z
```

### 2. Apply
```bash
git am patches/2026-08-07-s5-stage5-finish.patches
```
If any patch fails to apply (context drift since this bundle was cut), `git am --show-current-patch=diff` to inspect, resolve by hand, `git am --continue`. Do **not** `git am --skip` silently — a skipped patch means that stage's work didn't land; note it in your report.

### 3. Build + typecheck
```bash
bun install
cd webapp && bun run build && cd ..
cd apps/alts && bun run build && cd ../..
```
Both must be green. Grep for anything that still imports the deleted files (build will surface this as a hard error, but double-check):
```bash
grep -rE "IntakeAlterations|OrdersAlterations|pages/intake/TicketDetail|AdminBoard|DriverRoute|MarkDeliveredDialog|NewDeliveryDialog|GenerateMessageDialog" webapp/src apps/alts/src --include="*.tsx" --include="*.ts" | grep -v "AltsRedirect\|altsLinks"
```
Expect no hits outside the redirect/links files themselves.

### 4. Verify against live ERP (do not skip)
- `webapp`: hit `/intake/alterations`, `/orders/alterations`, `/orders/alterations/<real-ticket>`, `/admin/board` — each must redirect to the matching `alts.` URL, not 404 or render dead UI.
- `webapp` → Deliveries: board and detail render read-only; every action button is a "Manage in Alts" link, not a live mutation.
- `apps/alts`: create a test ticket offline (airplane mode or devtools throttling) — queued badge appears, count is correct, inspector shows the job with Retry/Remove; go back online, confirm it drains.
- `apps/alts` → a delivery marked `failed` shows Reschedule; picking a datetime PATCHes it back to `scheduled` and it reappears on the active board.
- Confirm no new Supabase writes were introduced (grep the diff for `supabase` — should be zero).

### 5. Close out Stage 5
- Update `STAGE_PLAN.md` status line to reflect Stage 5 complete (with date + your verification notes), per the "Deliverables per stage" section at the bottom of that doc.
- **Do not** start Stage 6 (DNS/cutover) — that requires explicit C sign-off per `STAGE_PLAN.md` §STAGE 6.

### 6. Report
Short report to Maestro/C: patches applied cleanly (or what needed hand-resolution), both builds green, live-ERP verification results per bullet above, any blockers found, Stage 5 exit criteria checked off from `STAGE_PLAN.md`.

**STOP and report. Do not proceed to Stage 6 without C's explicit OK.**
