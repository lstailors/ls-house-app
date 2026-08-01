# Alts NYC-only + audit round 4 — 2026-08-01

## NYC only

Houston is retired from the alterations FOH app:

- Intake locks origin to **NYC** (no HOU toggle)
- Transfers: **NYC Store** or **At-home** only
- Shop floor / delivery origin chips no longer offer HOU
- Presets, sell warehouse, DN series, companies → NYC / LSTNY
- Transfer API rejects `HOU`
- Ticket create + parked commit coerce to NYC

## Remaining audit items

| ID | Fix |
|----|-----|
| **P2-10** | Paid “Print Receipt” uses Sales Invoice → payment receipt (not ticket slip) |
| **P2-11** | Due-date PATCH also sets `promised_date` |
| **P2-13** | Canonical pay URL is `alts.lstailors.com/pay/…` (print QR, SMS, create response) |
| **P2-16** | Print routes wrapped in RoleGuard |
| **P3-6** | Home hours line uses full East 61st address |
| **P3-7** | Delivery label stays NYC (HOU branches removed) |
| **P3-8** | Removed stale `@/*` → webapp tsconfig alias |
| **P3-9** | Trimmed `queries.ts` to delivery hooks only |

## Ops

Existing HOU-origin tickets in ERP still readable; new alts work is NYC-only.
