# C decisions lock — 2026-07-26

Source: C answers to the 9-question pack (grouped by cost-to-delay).  
Owner: Simone builds · Lucia designs around these.

---

## Blocks Stage 3 / money path

### 1. Rush fee
**Decision: REMOVE for now.** Maybe add later.  
- Do not charge rush.  
- Do not show rush as a billable line in POS/mocks going forward.  
- Existing display-only rush can be stripped from alts intake UI when we touch it.  
- Revisit as a later feature, not Stage 3.

### 2. Pay link vs dispatch
**Decision: C — dispatch on send for all.**  
- Sending a pay link does **not** hold dispatch.  
- Goods can leave after pay link sent (known risk accepted).  
- Unpaid-release SMS still applies if released with balance.

### 3. Hand delivery fails
**Decision: A — requeue once, then counter pickup.**  
- Fail 1 → one requeue for another delivery attempt.  
- Fail 2 → convert to **counter pickup** (no third driver burn).  
- No automatic refund unwind on failed HD (money already taken at Ready when charged).

---

## Schema (cheaper now)

### 4. Absorbed fitting costs (MTM / on custom order)
**Decision: B — real cost entry on the ledger.**  
- Alteration lines on **Included in Custom Order** still carry $ amounts.  
- Those amounts must hit cost basis / COGS for the custom-made order (not reporting-only).  
- Goal: later report $ spent on own clothing, avg alteration cost per MTM/bespoke.  
- Implementation detail for Stage 2/3+: JE or stock/COGS path — **needs clean ERP design; may need Melena/accountant pass on account heads** before prod write.  
- Still **no client payment** / `payment_status = N/A` / no SI to client for Included.

### 5. Parked carts — fields
**Decision: A — real DocType fields, not buried in JSON.**  
Add on `LSH Parked Cart` (or equivalent):  
- `expected_garment_count`  
- `remind_at`  
(Even if nag policy is “nobody” for now — fields enable jobs later without migration pain.)

### 6. Warranty vs custom-order
**Decision: SEPARATE buckets. Warranty = Re-do path (one setup).**  
| Mode | Meaning | System |
|---|---|---|
| **On custom order** | MTM/bespoke fitting work; $ → COGS of the make; no client charge | `billing_status = Included in Custom Order` · linked SO |
| **Warranty / Re-do** | Fix on something **we already did**, **no cost to customer** | Kind `redo` · UI **Re-do** · `billing_status = Warranty` · $0 · no invoice |

**C 2026-07-28:** Warranty is not a fourth kind — it **is** Re-do. Same intake, same $0, same reporting bucket.  
Label in UI: **“Re-do”** (subtitle may say Warranty). Do not invent a separate warranty workflow.  
Report warranty/re-do apart from included-in-custom — rising re-do = quality signal.

---

## Policy (design around)

### 7. High fitting-cost warning
**Decision: A — dashboard only.**  
- No counter hard-stop / warn threshold in POS v1.  
- Managers see high absorbed cost on dashboard/reporting.

### 8. Parked carts
**Decision (C 2026-07-28): Hold until whenever. Resume/use or delete — nothing else.**  
- No auto-expiry, no stale nag SMS/push to parker or floor (v1).  
- Park = mid-intake freeze; no ticket number burned until submit.  
- Actions only: **Resume** · **Submit ticket** · **Drop (delete)**.  
- `remind_at` may exist on schema for a future toggle — **off**.

### 9. Quote send
**Decision: A — email + SMS with accept link.**  
- Parked **Quote** can be sent to client via email and SMS.  
- Include accept link (path TBD: alts or app).  
- Accept → resume/commit flow toward ticket (build detail later).

---

## Derived build notes

- Rush: strip from Lucia mock billables if still shown as +$25.  
- Dispatch: never gate on pay-link cleared.  
- HD failure state machine: `out` → fail → `requeue` (max 1) → `counter_pickup`.  
- MTM included: ledger COGS entry + separate from Re-do.  
- Park: schema fields + quote comms; no nag jobs.  
- Pickup counter priority: pay at Ready still primary; unpaid release exception unchanged.

## Still open (not in this pack)
- Intake 001 vs 002 winner  
- Cutover timing / HOU  
- Post-pay L&S confirm channels  
- Test SI cleanup word  
- Exact ERP accounts for absorbed COGS (Melena)

— Simone
