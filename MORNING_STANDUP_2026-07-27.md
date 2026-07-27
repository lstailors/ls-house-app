# Alts overnight standup — 2026-07-27 morning

**Author:** Simone (alts build)  
**Live:** https://alts.lstailors.com · API https://app.lstailors.com  
**Status at write:** alts **200** · API login path **401 healthy** (not broken)

---

## What shipped overnight (live on alts)

| Route | Lucia # | Status |
|---|---|---|
| `/` Home tiles + quick links | 007 | Live — + Charge & dispatch / Quote / Orders / Parked chips |
| `/intake/kind` | 017 | Live — Walk-in · Custom order (SO search) · Re-do |
| `/intake/alterations` | 002 | Live — customer edit/create, multi contact UI, park, billing from kind |
| `/shop-floor` | 003 | Live — KPIs, filters, Start→Ready→Pickup advances |
| `/pickup` | 009 | Live — search, paid/unpaid, collector name, release |
| `/dispatch` | 011 | **NEW live** — Ready queue, Pickup/HD/Courier, pay link, notify ready, release |
| `/quote` | 021 | **NEW live** — ticket pick, email+SMS preview, send hooks |
| `/lookup` | FOH search | Stronger — tickets + customers + SO → on-order intake |
| `/transfers` | 005 | Live (prior) |
| `/parked` | 018/019 | Live (prior) |
| Customer Edit sheet | 025/026 | Live multi phones/addresses/assistants UI |

Hard refresh alts after wake.

---

## Vercel failure emails — root cause & fix stance

**Cause:** Deploys of `ls-house-app` with Edge runtime were bundling the full Hono backend into Edge. Vercel rejected with:

> Edge Function "middleware" referencing unsupported modules (`@ls/erp-client/*`, `fs`, `stream`…)

That produced **Production Error** deployments and the email spam.

**What we did:**
1. Stopped promoting broken API builds to production.
2. Confirmed **app.lstailors.com** stays on last good Edge deploy (`ls-house-40o7xwhpj…`) — login healthy (~200ms).
3. Node+prebundle preview builds as “Ready” but **hung on cold request** — **not promoted**.
4. Reverted local `api/[...path].ts` + `vercel.json` back to Edge shape matching healthy prod so we don’t leave a landmine.
5. Overnight work = **alts-only deploys** (ls-alts). No more API prod deploys until a green preview is proven.

**Morning action (Simone / Maestro):** One careful API preview that stays green + fast, then promote. Includes SO search + billing_status patch after ticket create (code already in `backend/src/routes/intake-alterations.ts`).

---

## ERP wiring truth table

| Capability | UI | API on prod |
|---|---|---|
| Login | ✅ | ✅ |
| Ticket list / status advance | ✅ | ✅ |
| Create ticket | ✅ | ✅ |
| billing_status / linked SO on create | UI sends | ⏳ needs API deploy |
| Multi address/phone/assistant save | UI dual-payload | Primary fields yes; full multi ⏳ API |
| FOH SO search `/sales-orders/search` | UI + fallback `/api/search` | ⏳ dedicated endpoint |
| Pay link / notify ready / release | ✅ | ✅ |
| Quote SMS/email templates | Preview UI | Partial / may need template keys |
| Dispatch → deliveries create | Best-effort | Payload shapes may need one polish pass |

---

## Design pack matrix (Lucia 001–027)

**Working / live FOH:** 002, 003, 005 (good), 007, 009, 011 (new), 017, 018/019, 021 (new), 023 partial, 025/026 UI  
**Still thin / next:** 004 garment tag PDF, 008 standalone customer glass, 010 public e-ticket polish, 012 POD, 013 decline, 014 add work, 015 states, 016 custom-order depth, 022 thermal luxury, 024 SMS library, 027 labels (4×6 + 3×2 PDF→LabelLife)

None are pixel-locked to Lucia mocks; direction is hers, build is Liquid Glass on alts.

---

## Do not touch without C/Maestro gate

- Production API deploys (until preview proven)
- ls-5.0 marketing site
- Money auto-blasts / live client SMS campaigns beyond existing ticket notify paths
- Deleting ERP test SI/PE without C saying the word

---

## Suggested first 30 min morning test

1. Login alts → home chips visible  
2. New Ticket → kind gate → walk-in intake  
3. Shop floor Start/Ready on a test ticket  
4. Dispatch on a Ready ticket → pay link + pickup release  
5. Quote open + preview (SMS send only if OK to hit a test phone)  
6. Edit customer → multi address UI (primary save confirmed)

---

## Credits note

Stay on alts UI + one API fix pass. No thrash deploys. Preview-first for app API.

— Simone · L&S House Dev  
Generated ~2026-07-26 late night ET for 07-27 morning
