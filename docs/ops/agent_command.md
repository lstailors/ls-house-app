# Mission Control — one-shot Agent Command (SPEC 069)

## What shipped

- **UI:** `AgentCommand` replaces multi-turn `AgentChat` on `AgentDetail.tsx` (same center-column slot).
- **API:** `POST/GET/cancel` under `/api/agents/:slug/commands` → `lsh.mc_commands` (`kind=chat_run`, `action=send`).
- **Worker:** `backend/scripts/mc_commands_apply.py` (+ `.sh`) drains the queue; `chat_run` uses Hermes `-z` (no double-background, argv prompt, pid/session written to payload, cancel honors status + SIGTERM process group).
- **Migration (staged):** `backend/supabase/migration_009_mc_commands.sql` (SPEC 066 table).

## Status mapping (DB → UI)

| `mc_commands.status` | UI |
|---|---|
| pending | queued |
| leased | running |
| applied | done |
| failed + `payload.timed_out` | timeout |
| failed | error |
| cancelled | cancelled |

## Apply order (needs C OK for prod)

1. Apply migration 009 (psql or `apply_mc_migrations.py` after C OK).
2. Schedule Hermes no_agent cron every 1m: `backend/scripts/mc_commands_apply.sh` (profile maestro or simone — fleet home).
3. Deploy app (Vercel) with this branch / PR.
4. Smoke: open `/agents/simone` → send a short command → watch queued → running (pid) → done.

## Auth

- Enqueue / cancel: **super_admin** only.
- Poll: super_admin + store_manager.
- API uses service_role (bypasses RLS); RLS still gates direct client inserts to super_admin.

## Non-goals (SPEC 069)

No transcript history, no streaming, no multi-agent broadcast, no slash commands.
