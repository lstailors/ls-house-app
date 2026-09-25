# L&S Fabric + CMT Estimator (`apps/fabric`)

Next.js (App Router) app for wholesale trade accounts: pick mill → fabric → garment → make,
get a per-unit estimate, the account's own retail price, and save quotes to ERPNext.

**ERPNext is the only backend.** No database. All markup math runs in server routes
(`lib/estimate.ts` → `lib/pricing.ts`); raw buying cost and multipliers never reach the browser.

## Deploy (Vercel)
New Vercel project → Root Directory `apps/fabric` (framework: Next.js; `vercel.json` handles the
monorepo install). Env vars — see `.env.example`:

| Var | Purpose |
|---|---|
| `ERP_BASE_URL` | `https://erp.lstailors.com` |
| `ERP_API_KEY` / `ERP_API_SECRET` | Dedicated service user: read Item, Item Price, Fabric Vendor Map, Customer, Currency Exchange, Portal User, Contact |
| `HKD_USD_RATE` | Fallback when no `Currency Exchange` HKD→USD row exists (default 0.128; sets `fx_fallback`) |
| `INTERNAL_CUSTOMER` | Optional: Customer used for System Manager logins that have no portal mapping |

## Auth
Login = ERPNext credentials via `/api/method/login`. The `sid` is kept in an httpOnly cookie
(`lsfe_sid`). Each request re-resolves user → Customer (Portal User, then Contact link) with the
service key. `System Manager` = internal: unlocks the Margin tab and "price as account"
(enforced in `lib/estimate.ts` and `/api/accounts`, not the UI).

Fabric Quote create/read uses the **user's own session**, so ERPNext's "own only" permission applies.

## Routes
| Route | |
|---|---|
| `POST /api/auth/login`, `POST /api/auth/logout` | |
| `GET /api/me` | account defaults |
| `GET /api/vendors` | active Fabric Vendor Map rows |
| `GET /api/fabrics/search?vendor=FAB-HS&q=1121` | descriptive only, no price |
| `POST /api/estimate` | §4 response shape (+ `margin` for internal) |
| `GET/POST /api/quotes`, `GET /api/quotes/[id]`, `GET /api/quotes/[id]/photo` | |

## Tests
`bun test lib` — `yardage.test.ts` (every surcharge combination × every garment) and
`pricing.test.ts` (worked example + §4 rules).

## Known gaps (as of build)
- **Brief's worked example vs. §3 table:** a Two Piece is 2.25 + 2.00 = **4.25 yd** by the table;
  the example uses 3.25 yd. The app follows the table. Tests pin both readings.
- `ALT-FLAT-{JKT,TRS,VST,OVC}` on `Wholesale - Alterations` don't exist yet → hardcoded
  150/50/75/150 fallback with a loud server warning.
- `Fabric Quote` has no `swatch_image` field yet → photo is attached to the quote as a File
  (shown in the app); the app sets `swatch_image` automatically once the field exists.
- Toggles (narrow/check/stripe/tall) have no Fabric Quote fields, so they're saved as a final
  `Options: …` line in `notes` and parsed back when a quote is reopened.
