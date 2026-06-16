# YZ (YongZheng) Helpdesk Ticket System — Status & Runbook

Last updated: 2026-06-15

Auto-converts Yongzheng factory emails (**Mandy** `mandy@yongzheng.com.cn`, ~3–10/day)
into ERPNext Helpdesk tickets, links each to its MTMPro Order, surfaces open tickets in
Mission Control, and sends threaded replies from maestro@.

**Source of truth = ERPNext Helpdesk `HD Ticket`.** Supabase is read-only for order matching.

---

## Key handles
- ERPNext: `https://erp.lstailors.com` (self-hosted Docker / OrbStack, NY timezone) · company `L&S Tailors NY LLC`
- n8n: `https://lstailors.app.n8n.cloud`
- Supabase project: `eusjiygcqzsmqonhuxlq`
- ls-house Vercel: team `team_uo646MqFi9v6b1IdaTYgHAKq`, project `prj_FHV0U1PKdnHwanHpzzgc9y2wfhSQ`
- Raven alerts channel: `L&S Tailors-purchases`
- n8n creds: ERPNext `nJ30UGmuuVPs2Dhy` (L&S ERPNext Token Auth) · carl Gmail `DHWCbCrZ2vAduGpW` · Maestro Gmail `t2p2KJHQlEowjJP3`

## Order-ID matching (from Mandy's subject lines)
- PO number `LST-NNNNNN-N` → ERPNext `MTMPro Order` (doc name == PO). **Authoritative/fresh.**
- YZ order no `LST-YY-NNN[C]` → stored on ticket; cross-refs `yz_staging.order_no` (stale).

---

## What's BUILT & DONE
**ERPNext**
- `HD Ticket` custom fields: `lsh_mtm_pro_order` (Link→MTMPro Order), `lsh_yz_order_no`, `lsh_yz_thread_id`, `lsh_yz_message_id` (xss-exempt), `lsh_yz_breach_alerted`.
- Team **YongZheng** (carl@ + kelvin@); assignment rule **YongZheng - Support Rotation** (round-robin carl@/kelvin@).
- Status **Waiting on YZ** (Paused). Ticket type **Vendor / Factory**.
- SLA **YongZheng**: condition `agent_group=="YongZheng"`, hours 09:00–20:00 all 7 days, Medium resolution 11h → ~8pm; holiday list has 2026 US holidays.
- HD Settings: mandatory feedback OFF; auto-close Resolved after 3 days ON (global).

**n8n (both INACTIVE until creds picked in UI)**
- **YZ Helpdesk — Inbound (carl@)** `FJxErZsRDeK7uea3` — Gmail(carl@, from:yongzheng.com.cn) → parse/classify → find-by-thread → create / resolve-on-ack / reopen / skip; logs inbound Communication; pings Raven on new ticket. Also has a maestro@ trigger stub pending the Maestro Gmail cred.
- **YZ Helpdesk — SLA Breach → Raven** `tXkkcnWAyNUWdDTI` — every 30 min, posts breached YZ tickets to `L&S Tailors-purchases`, marks `lsh_yz_breach_alerted`.

**Mission Control (this repo)** — LIVE in prod
- `backend/src/routes/yz.ts` → `GET /api/yz/open-tickets`; `YZTicket` in `types.ts`; mounted in app.ts/index.ts.
- `webapp/src/lib/queries.ts` `useOpenYZTickets`; `webapp/src/components/dashboard/OpenYZTickets.tsx` on manager/super-admin Dashboard.

**Reply path** — ERPNext-native, sends from **maestro@**
- maestro@ OAuth re-authorized (owner = `maestro@lstailors.com` user); account `enable_outgoing=1`, `append_to=HD Ticket` so all HD Ticket replies route via maestro@. Incoming kept OFF for now.

---

## Incident fixed (2026-06-15)
- **All outbound email was broken since ~Jun 6**: `site_config.json` encryption_key mismatch after a site restore → couldn't decrypt Gmail OAuth tokens. Fixed by restoring the original encryption_key.
- **Scheduler was disabled** (no auto-send / SLA / auto-close). Fixed: `bench enable-scheduler` + cleared `maintenance_mode` + restarted scheduler container. Ticking every 4 min.

---

## REMAINING checklist (do from phone browser or desk)
1. **Confirm maestro@ reply** — reply to a YZ ticket in Helpdesk (`erp.lstailors.com`), verify it sends from maestro@.
2. **Activate inbound workflow** — n8n → `FJxErZsRDeK7uea3` → select **L&S ERPNext (Token Auth)** on HTTP nodes → manual-run once → toggle Active.
3. **Activate breach→Raven** — n8n → `tXkkcnWAyNUWdDTI` → select cred → Active.
4. **Change the maestro@ user's temporary password** (set during setup).
5. **Stalled mtmpro pipeline** — enable MCP access on `mtmpro-01-capture` / `-02-parse` / `-03-erp-create` so it can be diagnosed (rows stopped early June; separate from the email fix).
6. **Phase-2 maestro@ inbound** — share the Maestro Gmail credential with the n8n user, then enable the maestro@ trigger + (optionally) turn maestro@ ERPNext incoming back on.
7. **Signature** — add reply signature HTML on maestro@ (and carl@ if wanted).
8. Delete test tickets **0024 / 0025 / 0026**.

## Known separate issues
- Upstream syncs stale: `yz_staging` (May 12), `mtmpro_email_log` (May 31), `mtmpro_inbound` (Jun 6).
- Supabase RLS disabled on `campaign_control`, `campaign_sends`, `sms_send_list`.
