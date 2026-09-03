# Alterations Checkout Access + Intake Payments Plan

> **For Hermes:** Implement this plan task-by-task with strict test-first development.

**Goal:** Put Checkout beside + New and add a payment-today section to Intake Review supporting no payment, full payment, or a partial amount with every supported tender.

**Architecture:** Reuse the production Checkout PWA for arbitrary-order payments. In Intake Review, collect a payment plan before the ticket exists; after Schedule creates the ticket and submitted Sales Invoice, the confirmation screen exposes real payment actions using that amount. Centralize amount validation so Square Terminal, card-on-file, cash/check/handheld, and pay-link payments cannot exceed the live invoice outstanding.

**Tech Stack:** React 18, TypeScript, Hono, Square Terminal/Checkout APIs, ERPNext Payment Entry, Bun tests, Vite.

---

### Task 1: Add the top Checkout action

**Files:**
- Modify: `apps/alts/src/pages/HomeTiles.tsx`
- Modify: `apps/alts/src/styles/alts-pos.contract.test.ts`

1. Test that the header order is `+ New`, `Checkout`, `Pickup`.
2. Link Checkout to `https://checkout.lstailors.com/` using the existing primary action style.
3. Run the focused contract test.

### Task 2: Define safe payment plans

**Files:**
- Create: `apps/alts/src/lib/intakePayment.ts`
- Create: `apps/alts/src/lib/intakePayment.test.ts`
- Create: `backend/src/lib/payment-amount.ts`
- Create: `backend/src/lib/payment-amount.test.ts`

1. Test full, partial, pay-later, invalid, zero, and overpayment cases.
2. Implement cent-safe normalization and live-outstanding validation.
3. Run focused frontend and backend tests.

### Task 3: Add Payment Today to Intake Review

**Files:**
- Create: `apps/alts/src/components/intake/IntakePaymentPlan.tsx`
- Modify: `apps/alts/src/pages/IntakeStepped.tsx`
- Modify: `apps/alts/src/styles/alts-pos.contract.test.ts`

1. Test that Review offers Pay later, Pay in full, and Partial.
2. Test that every supported method is visible: Counter Terminal, Mobile Terminal, Card on file, Cash, Check, Square handheld, and Pay link / QR.
3. Add partial-amount validation and persist the plan through parked/resumed carts.
4. Explain that the confirmed charge occurs after Finish creates the invoice.

### Task 4: Make the post-create payment section operational

**Files:**
- Modify: `apps/alts/src/components/intake/IntakeConfirm.tsx`
- Modify: `apps/alts/src/components/payments/OutsideTenderButtons.tsx`
- Modify: `apps/alts/src/components/payments/ChargeTerminalButton.tsx`

1. Pass the planned amount/method into confirmation.
2. Show an editable, bounded amount and real controls for Terminal, card on file, Cash, Check, Square handheld, and Pay link/QR.
3. Preserve Carl's explicit confirmation before any charge.

### Task 5: Enforce partial-payment safety server-side

**Files:**
- Modify: `backend/src/routes/payments.ts`
- Modify: `backend/src/lib/square-checkout.ts`

1. Validate requested amounts against the submitted invoice's current outstanding balance.
2. For Terminal requests with an explicit amount, use the direct Square path so partial amounts are honored instead of silently charging the full balance.
3. Reuse only same-amount open Terminal checkouts.
4. For partial payment links, mint an amount-specific link and do not overwrite the invoice's canonical full-balance link.

### Task 6: Verify and ship

1. Run focused tests, baseline-aware full tests, typecheck, and production builds for Alterations and backend.
2. Run independent diff review.
3. Fetch/reconcile `origin/main`, commit, push, open/merge PR, and deploy the existing Alterations project.
4. Verify the production header button, Review payment section, and the existing Checkout destination without making a real charge.
