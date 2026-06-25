# L&S Square ↔ ERPNext — two-way POS payments

Scan the master QR → push the bill to the Square Terminal → customer taps card
→ Square webhook → ERPNext posts the payment, reconciles the ticket, and prints
a receipt. Duplicate payments are blocked at two levels.

## How the scan actually works (read this)

The Square Terminal's **own camera does not call ERPNext** for arbitrary QR
codes — that's not a capability Square exposes. So the scan is done by the
**iPad / L&S House app** (or any scanner pointed at a lookup screen), which
calls `ls_square.pos.create_checkout`. ERPNext then uses the **Square Terminal
Checkout API** to push the amount to the terminal; the customer taps; Square
fires the webhook back. The master receipt QR encodes the Sales Invoice
(`/pay/{invoice}`), so the same code drives the whole flow.

(If you'd rather the *customer* scans with their phone, Square's hosted
"Pay via QR" / Payment Links is a different flow — say the word and I'll wire
that variant instead.)

## What's already live in ERPNext (done via MCP)

- **Square Integration Settings** (single) — token, signature key, location/device IDs, env, mode of payment (Square), company (LSTNY), amount tolerance, auto-print toggle
- **Square Webhook Event** — idempotent log; its *name is the Square event_id*, so a duplicate delivery can't insert twice (DB-level duplicate block)
- `copy_type = payment` added to **LSH Print Log**
- The **Square** Mode of Payment already posts to `1115 - Square Balance (Pre-Payout) - LSTNY`

## What you install on the bench

Drop the `ls_square` package next to `ls_thermal`:

```
apps/ls_alterations/ls_alterations/ls_square/__init__.py
apps/ls_alterations/ls_alterations/ls_square/client.py    # API + HMAC verify + retry
apps/ls_alterations/ls_alterations/ls_square/webhook.py   # the listener
apps/ls_alterations/ls_alterations/ls_square/pos.py       # scan -> terminal checkout
```

Also re-copy the two **updated** `ls_thermal` files (payment receipt added):
`ls_thermal/escpos_tm.py`, `ls_thermal/api.py`.

```bash
cp -r ls_square apps/ls_alterations/ls_alterations/
cp ls_thermal/escpos_tm.py ls_thermal/api.py apps/ls_alterations/ls_alterations/ls_thermal/
bench --site erp.lstailors.com clear-cache && bench restart
```

## Configure

1. **Square Integration Settings:** paste Access Token, Application ID,
   Webhook Signature Key, Location ID, Terminal Device ID. Set Environment.
   Set **Webhook Notification URL** to the EXACT public URL (it's part of the
   signature), e.g.
   `https://erp.lstailors.com/api/method/ls_alterations.ls_square.webhook.receive`
2. **Square Dashboard → Webhooks:** add that same URL as a subscription and
   enable events: `payment.updated`, `payment.created`,
   `terminal.checkout.updated`. Copy the signature key into settings.
3. **MCP allowlist** (`LS_MCP_ALLOWED_METHODS`) if you want to trigger/test from here:
   `ls_alterations.ls_square.pos.create_checkout`,
   `ls_alterations.ls_square.webhook.reprocess`,
   `ls_alterations.ls_thermal.api.print_payment_receipt`

## The two-way flow

1. Staff opens/【scans】a ticket → app calls
   `pos.create_checkout(code=<scanned QR>)` (or `invoice=` / `ticket=`).
2. ERPNext reads the invoice's **outstanding amount**, pushes a Terminal
   Checkout with `reference_id = invoice name`.
3. Customer taps card on the Square Terminal.
4. Square POSTs `terminal.checkout.updated` (COMPLETED) → `webhook.receive`:
   - verifies HMAC signature (rejects 401 if bad)
   - records the event (duplicate event → acknowledged, not reprocessed)
   - resolves invoice from `reference_id`
   - **duplicate guards:** skips if a submitted Payment Entry already has that
     Square `payment_id`, or if the invoice is already settled
   - validates amount ≤ outstanding + tolerance (overpayment → flagged, not posted)
   - posts a **Payment Entry** (Mode of Payment = Square, `reference_no` =
     Square payment_id), allocates to the invoice
   - reconciles the **Alteration Ticket** (`payment_status`,
     `square_transaction_id`, `square_payment_method`, `paid_at`)
   - prints a **payment receipt** to the TM-M30ii
   - marks the event **Processed**

## Retry & troubleshooting

- Square retries on any **5xx**. The handler returns 5xx only for genuinely
  transient errors (DB deadlock / event-record failure); everything else
  returns 200 with a status so Square doesn't hammer.
- Outbound calls to Square (terminal checkout) retry 3× with backoff on
  429/5xx/network errors.
- Every event is in **Square Webhook Event** with status + error + raw payload.
- Fix the cause of a `Failed` event, then re-run it:
  `ls_square.webhook.reprocess(event_id="evt_...")`.
- A down printer never fails a payment — the receipt error is logged on the
  event; the Payment Entry still posts.

## Test (sandbox first)

1. Set Environment = Sandbox, paste sandbox creds + a sandbox device_id
   (Square's Terminal API sandbox supports a virtual device).
2. `bench console`:
   ```python
   import ls_alterations.ls_square.pos as pos
   pos.create_checkout(invoice="ACC-SINV-2026-XXXXX")
   ```
   Confirm the checkout pushes; complete it on the virtual terminal.
3. Watch **Square Webhook Event** flip to Processed, the **Sales Invoice** go to
   Paid, the **Alteration Ticket** payment_status update, and a receipt print.
4. Re-send the same webhook from Square's dashboard → confirm it logs as
   **Duplicate** and does NOT post a second Payment Entry.
