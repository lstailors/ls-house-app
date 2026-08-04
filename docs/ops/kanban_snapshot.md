# lsh.kanban_snapshot — row shape for Coder

**SoT:** `~/.hermes/kanban.db`  
**Writer:** `backend/scripts/kanban_snapshot.py` (Studio, every 5m, staged)  
**Reader:** `GET /api/mission-control/board` + `/:id`  
**Migration:** `backend/supabase/migration_008_kanban_snapshot.sql` (C OK to apply)

## Columns

| column | type | notes |
|---|---|---|
| task_id | text PK | `t_xxxxxxxx` |
| title | text | |
| body | text | full card body |
| assignee | text | profile slug |
| status | text | triage/todo/scheduled/ready/running/blocked/done |
| priority | int | higher = more urgent |
| created_by | text | |
| created_at / started_at / completed_at | timestamptz | |
| consecutive_failures | int | failure badge if >0 |
| last_failure_error | text | footer note |
| block_kind | text | e.g. needs_input |
| result_summary | text | completion summary |
| parent_ids / child_ids | jsonb string[] | dependency links |
| comment_count | int | |
| latest_comment_* | | author/body/at for drawer preview |
| board_slug | text | default `default` |
| snapshot_at | timestamptz | prune marker |

## Retention

- All non-archived open statuses always included
- `done` kept **7 days** after `completed_at`, then dropped from snapshot

## Dry-run (2026-08-04)

Run: `python3 backend/scripts/kanban_snapshot.py`

## Coder notes

- Empty table until migration applied + cron unpaused — UI must honor Lucia empty states
- Prefer filter `status=in.(todo,ready,running,blocked,done,triage,scheduled)` client-side
- Failure badge: `consecutive_failures > 0 OR last_failure_error not null`
