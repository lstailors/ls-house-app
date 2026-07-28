# HER-21 — alts deploy lineage reconciliation

Date: 2026-07-28  
Author: Marco  
Status: **EXECUTED 2026-07-28** — C go-ahead (“commit and push to main”). `origin/main` force-with-lease → `eccb400` (= `arch/shipped-alts-fork` tip = live prod). Backup tags pushed. Vercel `productionBranch` left as `main` (now correct). Residual HER WIP remains on `feat/alts-print-pack`.  
Constraint honored: no new deploys in this workstream.

---

## 0. Live production (re-verified this session)

| Field | Value |
|---|---|
| Domain | https://alts.lstailors.com |
| Vercel project | `ls-alts` / `prj_iUBcpWVvhxTQOmf5ZBb2jeFHAmyz` |
| Production deployment | `dpl_F629Z9FnLFQ1Uw7Leu5YwmKQs4qc` |
| Status | Ready |
| Git branch deployed | **`arch/shipped-alts-fork`** |
| Git commit deployed | **`eccb400`** — `Merge pull request #33 from lstailors/fix/alts-api-proxy` |
| Root Directory | **`apps/alts`** |
| Framework / build | Vite · `bun run build` · out `dist` · install `cd ../.. && bun install` |
| Git alias on deploy | `ls-alts-git-arch-shipped-alts-fork-lstailors-projects.vercel.app` |
| Configured `productionBranch` (per lineage doc / issue) | **`main`** ← **MISMATCH with what actually ships** |

Implication unchanged: Vercel Git auto-deploy off `main` would ship the **wrong tree**. Prod today is CLI/branch promote of the fork lineage, not `origin/main`.

---

## 1. Three-lineage map

```
common ancestor (booking cutover)
1228086 feat(booking): cutover availability engine to per-tailor calendars
        |
        +---------------------------+---------------------------+
        |                                                   |
        v                                                   v
 LINEAGE A — origin/main                          LINEAGE B — arch/shipped-alts-fork
 tip dbb8464                                      tip eccb400  ★ LIVE ON alts.lstailors.com
 tree: alts/ + webapp/src/alts/*                  tree: apps/alts + packages/* (STAGE_PLAN)
 (dual-target same webapp)                        (real monorepo split)
        |                                                   |
        | 3 commits only on A                               | ~18 commits only on B
        | (see §1.A)                                        | (Stage0/1 + FOH + API edge + PR33)
        |                                                   |
        |                                                   v
        |                                         LINEAGE C — feat/alts-print-pack
        |                                         tip 829edac  (checked out locally)
        |                                         merge-base with B = eccb400
        |                                         arch is strict ancestor of feat  → clean FF
        |                                         +8 commits (print pack, SO cart, photos, …)
        x  no path to B without architecture pick
```

### Divergence table

| | **A. `origin/main`** | **B. `origin/arch/shipped-alts-fork`** | **C. `feat/alts-print-pack`** |
|---|---|---|---|
| Tip SHA | `dbb8464` | `eccb400` ★ prod | `829edac` |
| Alts app path | `alts/` + `webapp/src/alts/*` | **`apps/alts`** | **`apps/alts`** |
| `packages/` monorepo | no (not this layout) | yes | yes |
| Contains prod SHA `eccb400` | **NO** | YES (tip) | YES (ancestor) |
| Contains older live SHA `4b14181` | NO | YES | YES |
| Relation to B | diverged at `1228086` | — | **fast-forward of B** (+8) |
| Relation to STAGE_PLAN | **Competing arch** (dual-target webapp) | **Matches plan** (`apps/alts`) | Matches plan + WIP features |
| What it is | Unshipped alternate POS packaging | **Shipped production lineage** | Local/remote WIP ahead of shipped |
| Safe to auto-deploy as prod? | **NO** — wrong tree, missing shipped fixes | YES (already is) | Not until review/QA — but correct line |

### 1.A — commits on A not on B (`origin/main`.. exclusive)

| SHA | Summary | Keep? |
|---|---|---|
| `013ab7c` | Fix prod route drift, harden api client, pin printed-QR origin (backend register split + webapp publicOrigin) | **Review cherry-pick** into B/C — some backend/webapp hardening may still be valuable; not alts `apps/` |
| `073ccc3` | Build alterations POS as second target of same webapp (`alts/` + `webapp/src/alts/*`) | **Do not merge as architecture** — superseded by Stage0 `apps/alts` on B |
| `dbb8464` | Compress intake garment photos before upload (`webapp/.../IntakeAlterations.tsx`) | **Cherry-pick candidate** onto admin webapp path on B if still needed there |

### 1.B — commits on B not on A (shipped line; abbreviated)

Stage0 scaffold `5334769` → erp-client refactors → FOH (customer edit, park, lookup/transfers, TicketKind, dispatch/quote) → edge-safe API fixes → build fix `756fa2a` → API proxy `149e445` → lineage doc → **PR #33 merge `eccb400`**.

### 1.C — commits on C not on B (WIP on correct line)

```
ac58fc3 feat(alts): print pack — 3×2 tags, thermal master/customer, 4×6 labels
f92f911 docs+ui: lock parked=hold until use/delete; warranty=re-do
1870397 feat(alts): Lucia 030 work step — custom lines, notes, photos
ee3ecd7 ui(alts): Re-do kind copy — full prices, no SI
084d0cc feat(alts): SO custom-order cart — items + pieces on the right
5b892a6 fix(alts): ship soCart module + align intake seed key
67bd4d6 fix(backend): SO detail handler clean; ensure soCart tracked
829edac feat(alts): garment take-photo / library on intake (023)
```

Also: local `main` at `756fa2a` is **behind** B (ancestor of `eccb400`); it is not a fourth architecture — just a stale pointer on the B line.

---

## 2. STAGE_PLAN.md assumption check

STAGE_PLAN §1 / Stage 0–1 target layout is:

- monorepo with **`apps/alts`** (Vite SPA)
- shared **`packages/*`**
- backend stays one deploy on app host; alts calls `/api` (rewrite or CORS)
- cutover host `alts.lstailors.com` → Vercel project root **`apps/alts`**

| Assumption | Still holds? |
|---|---|
| `apps/alts` is the alts product tree | **YES on B and C** (and on live Vercel root dir) |
| `origin/main` is that monorepo tip | **NO** — `origin/main` is the dual-target `alts/` experiment |
| Prod tracks main | **NO** — prod tracks `arch/shipped-alts-fork` @ `eccb400` |

**Conclusion:** STAGE_PLAN architecture is still the plan of record. The bug is that **git `main` never received the staged monorepo line**; the fork remote did.

---

## 3. Recommendation (canonical going forward)

### Canonical line = **B (`arch/shipped-alts-fork`), then make that tip the new `main`**

Why this is not ambiguous:

1. It is what customers/staff hit on **alts.lstailors.com** today.
2. It matches **STAGE_PLAN** and Vercel **Root Directory `apps/alts`**.
3. **C is already a clean fast-forward** of B — no rebase needed to keep print-pack WIP.
4. **A is the competing packaging** (dual-target webapp). Merging A into B as-is would fight the monorepo split and drop/confuse shipped FOH.

### What does *not* become canonical

- `origin/main` dual-target (`073ccc3` family) — archive only.
- `feat/alts-print-pack` as productionBranch — too hot; land via PR after main is honest.

---

## 4. Concrete migration path (no deploys until step gates pass)

**Gate 0 — Maestro/C confirm (THIS ISSUE STOPS HERE UNTIL YES)**  
Confirm: “Canonical alts line = shipped fork monorepo (`apps/alts`); rewrite `main` to that tip; discard dual-target `alts/` tree as architecture.”

**Step 1 — vault refs (no push risk)**
```bash
git fetch origin
git tag backup/origin-main-pre-reconcile-2026-07-28 origin/main          # dbb8464
git tag backup/arch-shipped-alts-fork-eccb400 origin/arch/shipped-alts-fork
git tag backup/feat-alts-print-pack-829edac feat/alts-print-pack
# optional local: backup/local-main-2026-07-27 already at 756fa2a
git push origin --tags
```

**Step 2 — short-term safety (pick one; prefer 2a if C wants zero force-push yet)**

- **2a. Vercel only:** set `ls-alts` `productionBranch` → `arch/shipped-alts-fork`  
  Matches reality immediately. Git auto-deploy can no longer ship A by accident.
- **2b. Git main rewrite (after confirm):**  
  ```bash
  git checkout -B main origin/arch/shipped-alts-fork   # main == eccb400
  git push --force-with-lease origin main
  ```
  Then set Vercel `productionBranch` → `main`.

**Step 3 — recover anything useful from A (cherry-pick, do not merge)**
- Evaluate `013ab7c` (api client / publicOrigin / backend register) on top of new main.
- Evaluate `dbb8464` photo compress for **webapp** intake path.
- Leave `073ccc3` behind the backup tag only.

**Step 4 — land C**
```bash
# after main == eccb400 (or PR base = arch/shipped-alts-fork)
git checkout feat/alts-print-pack   # already FF from eccb400
# open PR → main (or merge when QA green)
# still: no prod deploy from this HER-21 workstream unless C orders it
```

**Step 5 — hygiene**
- Protect `main` (PR required).
- Delete or freeze `arch/shipped-alts-fork` after main catches it (keep tag).
- Update `ALTS_DEPLOY_LINEAGE_2026-07-27.md` pointer to this doc.
- Tell agents: never `vercel --prod` off dirty local unrelated to canonical tip.

### Paths rejected

| Path | Why not |
|---|---|
| Merge A → B | Architecture collision; loses clarity; doesn't match live Root Directory |
| FF main to A and deploy | Would unship entire apps/alts FOH line |
| Rebase C onto A | Destroys shipped monorepo history for WIP |
| Cherry-pick only PR33 onto A | Still missing Stage0/1 + FOH stack under `apps/alts` |

---

## 5. Rollback path audit (STAGE_PLAN §6.6)

| Step | STAGE_PLAN action | Still accurate? | Notes |
|---|---|---|---|
| R1 | Point `alts.lstailors.com` to previous Vercel deployment | **YES** | Instant via Vercel promote/rollback of `dpl_*`. **Use this — not git revert on main.** |
| R2 | Re-enable alterations routes on `app` from last green admin build | **YES** | Admin app is separate project `ls-house-app` |
| R3 | Feature flag `ALTERATIONS_UI_WRITES=app` | **YES if flag exists in env** | Verify live env before relying |
| R4 | Revert `app_base_url` print setting | **YES** | ERP print setting |
| R5 | DNS CNAME alts → app temporary | **YES** | last resort |
| R6 | Do not reverse ERP ticket/SI data | **YES** | ERP SoT |
| R7 | 301s harmless | **YES** | |

### Gap to document (added by this reconciliation)

| ID | Gap | Fix |
|---|---|---|
| R1b | **Do not rollback by merging/reverting `main`** while `productionBranch=main` but prod SHA lives only on fork — git motion on main may not touch live, or may later auto-deploy the wrong tree | Rollback = **Vercel deployment rollback** to known good `dpl_*` (current good = `dpl_F629Z9FnLFQ1Uw7Leu5YwmKQs4qc` / `eccb400`). After migration, keep a written “last known good dpl + SHA” in this file. |
| R1c | productionBranch mismatch is itself a rollback hazard (auto git deploy surprises) | Close via Step 2a/2b above |

**Last known good prod (2026-07-28):**  
`dpl_F629Z9FnLFQ1Uw7Leu5YwmKQs4qc` · branch `arch/shipped-alts-fork` · sha `eccb400c337328fddbda44bf76eb5ee88e09be23`

§6.6 core procedure remains valid once R1b/R1c are understood. No rewrite of STAGE_PLAN body required for rollback mechanics — only the git/Vercel branch truth needed correcting.

---

## 6. Decision needed from Maestro/C

Reply YES/NO (or amend):

1. **Canonical = shipped monorepo line (B)** and rewrite `main` to `eccb400` (then FF C later)?  
2. **Immediate Vercel `productionBranch` → `arch/shipped-alts-fork`** even before main rewrite (recommended safety)?  
3. Cherry-pick pass on `013ab7c` / `dbb8464` after rewrite — do now as follow-up issue, or skip?

Until YES: **no force-push, no productionBranch change, no deploy** (per HER-21 scope).

---

## 7. Deliverable checklist

| # | Item | Status |
|---|---|---|
| 1 | Diagram/table of three lineages + divergence | **Done** (this doc §1) |
| 2 | Recommendation + migration path | **Done** (§3–4) — canonical B→main; C FF; A archive+cherry-pick |
| 3 | Fix Vercel productionBranch | **Blocked on Maestro/C** (§6) |
| 4 | Rollback path verified | **Done** (§5) — §6.6 still good + R1b/R1c notes |

File: `/Users/Maestro_1/ls-house-app/ALTS_LINEAGE_RECONCILIATION_HER-21.md`


---

## 6. Execution log (2026-07-28)

C comment on HER-21: “whatever you need to do. Commit And push to main.”

| Step | Result |
|---|---|
| Backup tags | `backup/origin-main-pre-reconcile-2026-07-28` → `dbb8464`; `backup/arch-shipped-alts-fork-eccb400`; `backup/feat-alts-print-pack-829edac` pushed to origin |
| `origin/main` rewrite | `git push --force-with-lease` `dbb8464` → **`eccb400`** |
| `origin/main` == `origin/arch/shipped-alts-fork` | **YES** |
| Vercel `productionBranch` | Still **`main`** — now correct (was mismatched when main was dual-target A). API rejects direct `productionBranch` patch; no longer needed. |
| Live prod | Unchanged intent: still `eccb400` / `dpl_F629Z9FnLFQ1Uw7Leu5YwmKQs4qc`. A force-push of main to same SHA may no-op or redeploy same commit. |
| Dual-target A | Recoverable only via backup tag (do not merge as architecture). |
| Lineage C WIP | Stays on `feat/alts-print-pack` (+ uncommitted HER-14/15/16/22 follow-ups) for PR onto new main. |

Rollback unchanged: promote prior Vercel `dpl_*`; do not use git motion on main to roll back the live site.
