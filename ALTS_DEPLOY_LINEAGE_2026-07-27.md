# ls-alts deploy lineage — 2026-07-27

Ground truth from Vercel API + git. Do not assume `origin/main` is what alts.lstailors.com runs.

## ls-alts project (prj_iUBcpWVvhxTQOmf5ZBb2jeFHAmyz)

| Setting | Value |
|---|---|
| Domain | https://alts.lstailors.com |
| Root Directory | **`apps/alts`** |
| Framework | Vite |
| Build | `bun run build` |
| Output | `dist` |
| Install | `cd ../.. && bun install` |
| GitHub link | `lstailors/ls-house-app` |
| **Configured** productionBranch | **`main`** |
| Deploy hooks | none |

## What is actually live on production (Jul 27 ~08:00 ET check)

| Field | Value |
|---|---|
| Deployment | `ls-alts-jwjw59545` / `dpl_9uf42JKLuiWLSwTXdvYQS1bFFV8p` |
| meta.githubCommitRef | `main` |
| meta.githubCommitSha | **`4b141812c44bc2af969783d4acc9c29f0dc7e5c6`** |
| meta.githubCommitMessage | feat(alts): Type A/B order-pull search (TicketKind) + billing-status… |
| meta.gitDirty | **1** (CLI deploy from dirty/local tree, not clean origin checkout) |

### `git branch --contains 4b14181`

- local: `main`, `fix/alts-api-proxy`, `backup/local-main-2026-07-27`, …
- remote: `origin/arch/shipped-alts-fork`, `origin/fix/alts-api-proxy`
- **`origin/main`: NO**

### Implication

Configured production branch name is `main`, but **origin/main does not contain the live SHA**.  
Live alts is the **shipped local-main fork lineage** (Stage0 apps/alts + FOH commits), promoted via **`vercel --prod` CLI**, not via merging into origin/main.

origin/main tip (`dbb8464`) is the **competing** dual-target webapp architecture (`alts/` root + shared components) — **unshipped to alts.lstailors.com**.

## /api rewrite fix

| Item | Value |
|---|---|
| Commit | `149e445` on `fix/alts-api-proxy` |
| Change | `apps/alts/vercel.json` (+ `apps/vercel.json`): rewrite `/api/:path*` → `https://app.lstailors.com/api/:path*` |
| patch-id (stable) | `805514770e5bae6e9b71789b23f1978ce985bbf6` |
| Prior apps/alts/vercel.json commits | `5334769` Stage0 scaffold only — **different patch-id** (`a1e001fb…`) |
| origin `073ccc3` | same *idea* at path **`alts/vercel.json`** (different tree) — not identical patch |

**149e445 is not a silent redo of an earlier identical commit on this path.** First time `apps/alts/vercel.json` gained the API proxy line.

### Preview proof (rewrite works)

- Preview URL example: `https://ls-alts-qjsqj9kr6-lstailors-projects.vercel.app`
- `GET /api/print/config` → `application/json` + printer config
- Prod `alts.lstailors.com/api/print/config` still HTML until this ships via CLI/prod promote on the **fork lineage**

## PR targeting

| PR | Base | Verdict |
|---|---|---|
| #33 | `arch/shipped-alts-fork` | **Correct for shipped lineage** |
| Retarget to `origin/main`? | — | **NO** — would drag architecture merge; origin/main ≠ live alts |

How to land for real users:

1. Merge #33 → `arch/shipped-alts-fork` (or fast-forward local `main` with `149e445`)
2. From Mac Studio on that tip: `vercel link --project ls-alts` → `vercel --prod --force --yes` from monorepo root
3. Do **not** merge into origin/main until C picks architecture

## Related git refs (durable)

| Ref | Tip (at write) | Role |
|---|---|---|
| `backup/local-main-2026-07-27` | `756fa2a` | Vault before cleanup |
| `arch/shipped-alts-fork` | `756fa2a` | Remote mirror of shipped main |
| `fix/alts-api-proxy` | `149e445` | Rewrite-only PR head |
| `origin/main` | `dbb8464` | Unshipped alternate architecture |
| Live alts SHA | `4b14181` | Behind fork tip (missing later dispatch/quote/edge fixes on disk tip, but prod was frozen mid-lineage) |

Note: prod alts is at `4b14181`, while fork tip is `756fa2a` (includes later FOH + API edge fixes). Shipping rewrite alone can cherry-pick/deploy `149e445` on top of whatever is checked out; full tip deploy is a separate choice.

— Simone · 2026-07-27
