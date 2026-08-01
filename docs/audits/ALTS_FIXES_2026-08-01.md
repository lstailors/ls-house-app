# Alts audit fixes — 2026-08-01

Implements prioritized fixes from `docs/audits/ALTS_LSTAILors_AUDIT_2026-08-01.md`.

## Shipped

| ID | Fix |
|---|---|
| P1-1 | Ticket-detail garment QR → `/g/:ticket/:garmentId`; route `/garments/:ticketId/:garmentId` redirect |
| P1-2 | Ticket detail lines match `garment_id` **or** `name` |
| P1-3 | Parked commit hydrates rich `cart.intake` (billing, SO, notes, promise, origin) |
| P1-4 | POD / delivery Delivered advances linked alteration ticket to Picked Up |
| P1-6 | Public `/api/pay-info` GET no longer mints Square links (stored link only) |
| P1-7 | Workflow stepper advances one step at a time |
| P1-8 | Intake draft persists/restores origin, promise date/time, rush |
| P1-9 | Intake origin defaults from `/api/me`; Dispatch uses ticket origin (not hard NYC) |
| P1-10 | Custom-order / sales-order links open `app.lstailors.com` |
| P1-11 | Quote SMS no longer falls back to notify-ready |
| P2-1 | “Create pay link” copies URL to clipboard (Pickup + Dispatch) |
| P2-3 | Home “Out to tailors” counts home origin only (not all HOU) |
| P2-6 | Duplicate active delivery rejected (409); Dispatch guards when boardDoc exists |
| P2-12 | Dispatch city/state prefilled from ticket origin (HOU → Houston/TX) |
| P3-1 | Transfers tailor picker only when dest is Home |
| P3-3 | “Released unpaid” = Picked Up unpaid only |
| P3-4 | Shop floor Pickup navigates `/pickup?ticket=` |

## Not in this PR (follow-ups)

- P1-5 e-ticket signed tokens
- P1-12 scanner/payment role gates
- P2-2 scanner action sheet first
- P2-4 store-local dates
- P2-5 pagination / aggregates beyond limit=200
- P2-7 line photo key mapping
- P2-9 edit-ticket full metadata reconcile
- Dual PWA manifests
