# Part A — run on Mac Studio NOW (ERP Print Settings flip)

Paste into a terminal on the **Mac Studio** (138 East 61st — has `~/ls-mcp/.env`).

```bash
cd ~/ls-house-app
git fetch origin main && git checkout main && git pull origin main

cd backend
bun run set:alts-print-url
# Expect: ✓ LSH Print Settings.app_base_url → https://alts.lstailors.com
```

Dry-run first (optional):

```bash
DRY_RUN=1 bun run set:alts-print-url
```

## Alternate — from a logged-in super_admin browser session

After this PR is live on `app.lstailors.com` (Vercel):

```js
// DevTools console on alts.lstailors.com or app.lstailors.com (logged in as super_admin)
await fetch('/api/print/config/app-base-url', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://alts.lstailors.com' }),
}).then(r => r.json())
```

## Then — Part B (30 min on shop iPad)

Follow `docs/ops/ALTS_ERP_AND_FLOOR_WALKTHROUGH.md` Part B.
