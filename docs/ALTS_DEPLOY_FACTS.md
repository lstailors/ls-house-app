# ALTS DEPLOY FACTS — established 2026-07-27, verified against Vercel API

Durable record so no future pass re-derives this. Written by Lucia.
Everything below was verified by command output, not inferred.

## The three-leg question: which branch does ls-alts promote to production?

### Leg 1 — project settings (Vercel API v9, prj_iUBcpWVvhxTQOmf5ZBb2jeFHAmyz)
    name              ls-alts
    rootDirectory     apps/alts
    link.type         github  lstailors/ls-house-app
    productionBranch  main
    deployHooks       []

### Leg 2 — the live production deployment
    alts.lstailors.com -> dpl_9uf42JKLuiWLSwTXdvYQS1bFFV8p
                          ls-alts-jwjw59545, created 26 Jul 22:51 EDT
    source            cli          <-- NOT a git push
    gitSource         None
    meta.githubCommitSha   4b141812c44bc2af969783d4acc9c29f0dc7e5c6  (4b14181)
    meta.githubCommitRef   main
    meta.gitDirty          1       <-- built from a DIRTY working tree

### Leg 3 — lineage of 4b14181
    local branches containing it:
      backup/local-main-2026-07-27, fix-build-errors-backup,
      fix/alts-api-proxy, main
    remote branches containing it:
      origin/arch/shipped-alts-fork, origin/fix/alts-api-proxy
    on origin/main?  NO (merge-base --is-ancestor = false)

## THE CONCLUSION — the two answers disagree

ls-alts is CONFIGURED to promote `main`. But the deployment actually serving
alts.lstailors.com was pushed from a LAPTOP via CLI, from a DIRTY tree, at a
commit (4b14181) that has NEVER existed on origin/main.

So: the configured production branch is origin/main, and origin/main has NEVER
produced the live deployment. Nothing on origin built what customers use.
4b14181 is also 4 commits behind local main (which is at 756fa2a).

IMPLICATION FOR PR TARGETING: a PR merged into ANY branch changes nothing about
alts.lstailors.com until someone either (a) runs `vercel --prod` from a laptop
again, or (b) pushes the lineage to origin/main and lets the GitHub integration
build it. Merging is necessary but NOT sufficient. This is the real gap.

RECOMMENDED (needs C): push local main to origin/main so the configured
production branch and the live artifact finally agree, and stop CLI-deploying
production from dirty trees. Until then "which branch to target" has no
technically correct answer -- the deploy source is a person's laptop.

## PR / BRANCH STATE 2026-07-27
    PR 32  hotfix-build-errors      -> origin/main            OPEN  (TS build fix, 0731844)
    PR 33  fix/alts-api-proxy       -> arch/shipped-alts-fork  OPEN  (rewrite only, 149e445)
    origin/arch/shipped-alts-fork == local main == 756fa2a
    origin/main == dbb8464 (3 commits local main does not have)
    local main vs origin/main: 15 local-only / 3 origin-only (TWO-WAY divergence)
    backup/local-main-2026-07-27 exists (created 07:55 this session, per reflog)

## THE /api PROXY FIX (149e445, authored 08:04:50 this session by Carl)
Hand-applied, NOT cherry-picked. origin's alts/vercel.json calls `bun run
build:alts`, a script that does not exist in local webapp/package.json, so
cherry-picking would deploy a broken build command.

Two lines, one rule each, in apps/alts/vercel.json AND apps/vercel.json:
    { "source": "/api/:path*", "destination": "https://app.lstailors.com/api/:path*" }
MUST be ordered BEFORE the SPA catch-all. That ordering is the whole fix.

Verified on a throwaway public Vercel project (since deleted):
    /api/print/config -> 200 application/json (was HTML on prod)
    /api/locations    -> 401 JSON  <-- proves it reached the real backend+auth
    /                 -> 200 text/html
Closes REVIEW 1 finding 4.

## PITFALLS THAT COST TIME THIS PASS
1. `git log -p origin/main ^main -- vercel.json next.config.* middleware.*`
   returns EMPTY. The rewrite is a NEW FILE at origin's alts/vercel.json, not a
   change to root vercel.json. Path-scoped log will tell you there is no rewrite.
2. `tsc --noEmit` in apps/alts reports 28 errors -- IDENTICAL count on main.
   All pre-existing in webapp/src. Never gate an alts change on clean tsc;
   use `bun run build` (exits 0).
3. ls-alts rootDirectory is apps/alts, so `vercel --yes` from apps/alts fails
   ("path apps/alts/apps/alts does not exist") and from repo root it deploys
   ls-house-app instead (root .vercel points at the WRONG project).
4. Normal previews sit behind Vercel SSO -> curl gets 302 to vercel.com/sso-api.
   For curl-able proof, deploy a throwaway public project, then remove it.
5. A timed-out `vercel` command left the checkout back on `main`. Re-verify
   `git status -sb` after any vercel CLI timeout before trusting the tree.
6. Auth is a Bearer token from localStorage (webapp/src/lib/api.ts:19), NOT
   cookies -- so a same-origin /api proxy carries no cookie/CORS risk.

## STILL OPEN, RE-VERIFIED 2026-07-27 ~08:00
    D13   GET app.lstailors.com/api/print/config -> 200 UNAUTHENTICATED,
          leaks printer_ip 10.0.1.41 port 9100. Fix: getAuthedUser at
          backend/src/routes/print.ts:87. FOUR briefs old.
    app_base_url still "https://app.lstailors.com" -> printed tags open the
          admin shell, not the POS job card. Do not print production tags.
    SPEC 028 (brief cqd7g3hn2t) job-card 401/404/network error states NOT built.
    QR now proxies to goqr.me at ECC L (spec is M) with margin=1 (spec is 4).
          Brief gvmc05q01h, question Q15 for C.
    backend tsc errors (locations.ts, sofia.ts, square-terminal.ts) were routed
          around, not fixed -- Vercel only compiles webapp/.
