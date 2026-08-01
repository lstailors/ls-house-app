# Alts adaptive + remaining audit fixes — 2026-08-01

## Responsive (phone · iPad · desktop)

- **Dispatch / Transfers / Quote** — removed TabletOnly gate; use `phone-stack` like Pickup
- **TicketKind** — phone-stack for SO picker columns
- **LandscapeGate** — only on print routes (tags/thermal/receipt/label), not every page
- **Print routes** — `PrintSurface` previews on phone with tip; full print on tablet/desktop
- **Ticket detail** — `alts-root`, wrapping actions, scrollable stepper
- **Customers** — KPI grid stacks on phone
- **Board** — card list on phone, table on ≥720px

## Remaining audit items

- **P1-5 e-ticket** — signed `?k=` required for full public detail; status-only without key; SMS/QR use signed alts `/t/…?k=`
- **P1-12 scanner/payment roles** — mark-paid / card-on-file FOH only; advance/transfer floor roles; deliver FOH+driver
- **P2-2 scanner sheet** — show action sheet instead of auto-navigating (except garment `/g/` tags)
- **P2-4 store dates** — `storeToday()` America/New_York (not UTC) for Home/Orders/ShopFloor
- **P2-5 list cap** — ticket fetches raised to 500 (backend max 500)

## Env

Set `E_TICKET_SECRET` (or reuse `JWT_SECRET`) on the backend so e-ticket keys stay stable across deploys.
