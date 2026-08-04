# Mission Control — Unified Command Queue (`lsh.mc_commands`)

SPEC: `~/ls-design/briefs/SPEC_066_COMMAND_QUEUE_INFRA.md`

## What

Write-path only. Every MC mutation (board, cron toggle, fleet restart/model, chat oneshot, approval decision) enqueues a row. Studio worker drains it. **Not** a state mirror (unlike `kanban_snapshot` / `cron_health`).

| Column | Notes |
|---|---|
| `kind` | `kanban_task` \| `cron_job` \| `fleet_agent` \| `chat_run` \| `approval` |
| `action` | verb within kind |
| `target_id` | task id / `profile:job_id` / profile slug / approval id |
| `idempotency_key` | optional UNIQUE; double-submit safe |
| `status` | `pending` → `leased` → `applied` \| `failed`; cancel only from `pending` |

## Migration

`backend/supabase/migration_009_mc_commands.sql`

- Table + indexes + RLS (`SELECT` super_admin|store_manager; `INSERT` super_admin only; no auth UPDATE/DELETE)
- `lsh.mc_commands_claim(worker, limit, lease_seconds)` — `FOR UPDATE SKIP LOCKED`
- `lsh.mc_commands_retry(id)` — failed→pending, `retry_count++`, hard-stop at 3
- `lsh.mc_commands_cancel(id)` — pending only

Apply via Management API SQL or `apply_mc_migrations.py` (includes 009).

## Studio worker

| File | Role |
|---|---|
| `backend/scripts/mc_commands_apply.py` | claim + dispatch |
| `backend/scripts/mc_commands_apply.sh` | no_agent cron entry (`--quiet-ok`) |
| `mc_kanban_apply.py/.sh` | **shim** → new apply (old cron name still works) |

Cron (simone profile): **every 1m**, `no_agent`, script `mc_commands_apply.sh` (or keep `mc_kanban_apply.sh` shim). Deliver `local`.

### Dispatch map

| kind | action | primitive |
|---|---|---|
| kanban_task | promote/block/… | `hermes kanban …` |
| cron_job | cron_enable/disable | `hermes -p <p> cron resume\|pause <id>` |
| fleet_agent | restart | `hermes -p <p> gateway restart` (+ launchctl kickstart fallback) |
| fleet_agent | set_model | `hermes -p <p> config set model.default …` |
| fleet_agent | set_fallback_model | write `fallback_providers[0]` in profile config.yaml |
| chat_run | send | `hermes -p <p> -z "<prompt>"` (result merged into payload) |
| approval | approve/reject/edit | best-effort `approval_queue` patch — CONFLICT #2 still open |

## API call sites

- `POST /api/mission-control/board/:id/action` → `lsh.mc_commands` `kind=kanban_task`
- `PATCH /api/agents/cron/:id` (Hermes `profile:job_id`) → `kind=cron_job`

Both require **super_admin** to enqueue (service_role bypasses RLS; route enforces).

Optional body `idempotency_key` string.

## Prove locally

```bash
# after migration
python3 backend/scripts/mc_commands_apply.py   # should print pending=0 or claim lines

# seed a comment on a safe task, then drain
# (use service_role REST insert into lsh.mc_commands)
```

## Supersedes

`lsh.kanban_commands` — leave table in place for residual rows; no new writers. Worker does **not** read it.
