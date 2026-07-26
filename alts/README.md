# alts.lstailors.com — Alterations POS

This directory holds **only** the Vercel configuration for the POS. All the
source lives in `../webapp` and is shared with the admin dashboard; the POS is a
second build target of that same Vite project, selected with
`VITE_APP_TARGET=alts`.

```
webapp/  ──bun run build ─────▶ webapp/dist ──▶ ls-house-app ──▶ app.lstailors.com  (+ /api/*)
   │                                                                      ▲
   └─────bun run build:alts ──▶ alts/dist   ──▶ ls-alts      ──▶ alts.lstailors.com ┘
                                                              (static; /api proxied)
```

## Why this directory exists at all

Vercel reads `vercel.json` from a project's **Root Directory**. The repo-root
`vercel.json` defines 8 cron jobs (Maestro and Sofia briefs, UniFi sync). A
second project sharing that config would fire every one of them twice. Giving
the POS its own Root Directory is what keeps the crons on one project.

## Vercel project settings (must be set in the dashboard)

| Setting | Value |
|---|---|
| Git repository | `lstailors/ls-house-app` (same repo as `ls-house-app`) |
| Root Directory | `alts` |
| Include files outside the Root Directory | **enabled** — the build reaches `../webapp` and `../backend` |
| Domain | `alts.lstailors.com` |

Environment variables: `VITE_SQUARE_APPLICATION_ID`, `VITE_SQUARE_LOCATION_ID`.

Do **not** set `VITE_BACKEND_URL`. `/api` is proxied to app.lstailors.com by the
rewrite below, which keeps every request same-origin from the browser's point of
view — no CORS, no preflight round-trip, and no chance of a stray relative fetch
silently receiving `index.html`.

## Local development

```bash
cd ../webapp && bun run dev:alts
```

## Notes

- There is **no serverless function here** and there must not be. The API lives
  on `app.lstailors.com`, which is where every webhook (Twilio, Square, ERPNext)
  already points, and where the Apple Pay domain-association file is served.
- `/pay`, `/e-ticket` and `/d/:token` are deliberately absent — those are
  customer-facing URLs already printed and emailed with `app.lstailors.com` in
  them. See the header of `webapp/src/alts/AltsApp.tsx`.
- The `/api` rewrite must stay **above** the SPA catch-all. If it is removed or
  reordered, unmatched `/api` calls return `index.html` with a 200 status.
  `webapp/src/lib/api.ts` throws on that rather than rendering an empty screen,
  but the ordering is the real fix.
