# lsh.kanban_snapshot — row shape for Coder (MC Board API)

**Status:** staged (2026-08-04). Migration + writer ready; **prod apply needs C OK**.

**SoT:** Hermes `~/.hermes/kanban.db` on Mac Studio — never write back from Mission Control.

| Path | Notes |
|---|---|
| `~/.hermes/kanban.db` | Shared fleet board (all profiles) |

Writer: `backend/scripts/kanban_snapshot.py`  
Cron (staged, simone profile): every **5m**, `no_agent=true`, `--apply --quiet-ok`  
Job id: `ffdf27f8536d` (paused/disabled until C OK)  
Migration: `backend/supabase/migration_008_kanban_snapshot.sql`  
Handoff copy: `~/ls-design/handoffs/kanban_snapshot-row-shape.md`

## Table

Schema: **`lsh.kanban_snapshot`**  
PK: **`task_id`**  
RLS: `SELECT` for `lsh.is_super_admin() OR lsh.is_store_manager()`  
Writes: **service_role only** (Studio snapshot)

## Retention (writer)

- All non-`archived` open statuses always included (`triage|todo|scheduled|ready|running|blocked`)
- `done` kept **7 days** after `completed_at`, then dropped from snapshot
- Orphans pruned by `snapshot_at < this_run` on each apply

## Row shape (API contract)

```ts
// GET /api/mission-control/board
//   → { snapshot_at, counts_by_status, tasks: KanbanSnapshotRow[], filters }

type KanbanStatus =
  | "triage" | "todo" | "scheduled" | "ready"
  | "running" | "blocked" | "done";

interface KanbanCommentLite {
  author: string;
  body: string;                 // truncated ≤1500
  created_at: string | null;    // ISO
}

interface KanbanEventLite {
  kind: string;                 // created|claimed|spawned|heartbeat|blocked|completed|…
  created_at: string | null;
  run_id: number | null;
  detail: string | null;        // one-line from payload (reason/error/summary)
}

interface KanbanSnapshotRow {
  task_id: string;              // t_xxxxxxxx
  title: string;
  body: string | null;          // full card body (drawer)
  assignee: string | null;      // profile slug
  status: KanbanStatus | string;
  priority: number;             // higher = more urgent (Hermes int, not 1–5 only)
  created_by: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  consecutive_failures: number; // failure badge if > 0
  last_failure_error: string | null;
  block_kind: string | null;    // needs_input | dependency | capability | transient
  result_summary: string | null;
  parent_ids: string[];
  child_ids: string[];
  comment_count: number;
  latest_comment_at: string | null;
  latest_comment_author: string | null;
  latest_comment_body: string | null;
  recent_comments: KanbanCommentLite[]; // last ≤20, oldest→newest
  event_count: number;
  latest_event_kind: string | null;
  latest_event_at: string | null;
  latest_event_detail: string | null;
  recent_events: KanbanEventLite[];     // last ≤30, oldest→newest (drawer timeline)
  board_slug: string;           // default "default"
  snapshot_at: string;
  created_row_at?: string;
  updated_at?: string;
}
```

## Suggested API

```
GET /api/mission-control/board
  ?assignee=simone
  &status=blocked          # or comma list
  &blockedOnly=1
  &q=SPEC
  &board=default
Auth: super_admin | store_manager (same as MC)

Response 200:
{
  "snapshot_at": "<max snapshot_at across rows>",
  "counts_by_status": { "todo": 1, "running": 2, "blocked": 8, "done": 5, … },
  "failing": 2,
  "tasks": [ KanbanSnapshotRow, … ],
  "filters": { "assignee": null, "status": null, "blockedOnly": false, "q": null }
}

GET /api/mission-control/board/:id
  → single row from same table
  comments = row.recent_comments (or empty)
  events   = row.recent_events
  parents  = row.parent_ids
  children = row.child_ids
```

Supabase client (Edge):

```ts
const { data, error } = await supabase
  .schema("lsh")
  .from("kanban_snapshot")
  .select("*")
  .eq("board_slug", "default")
  .order("priority", { ascending: false })
  .order("created_at", { ascending: true });
```

## UI mapping (SPEC 062)

| UI | Field |
|---|---|
| Card title (2-line clamp) | `title` |
| Mono id | `task_id` |
| Assignee chip / avatar | `assignee` |
| Relative age | `created_at` (or `started_at` when running) via `formatRelative` |
| Column | `status` |
| Rose left rail | `status === "blocked"` |
| Failure ⚠ + footer | `consecutive_failures > 0 \|\| last_failure_error` |
| Blocked-only filter | `status === "blocked"` |
| Drawer body | `body` (`white-space: pre-wrap`) |
| Drawer comments | `recent_comments` (author + time + body) |
| Drawer events | `recent_events` oldest→newest (kind + time + detail) |
| review-required hint | `block_kind === "needs_input"` |
| Parent/child | `parent_ids` / `child_ids` — stub section only if non-empty |

Empty table until migration applied + cron unpaused — honor Lucia empty states.

## Ops

```bash
# Dry-run (prove counts — no Supabase write)
python3 ~/ls-house-app/backend/scripts/kanban_snapshot.py --dry-run

# Apply (after migration + C OK)
python3 ~/ls-house-app/backend/scripts/kanban_snapshot.py --apply --quiet-ok

# Apply migration (C OK)
PGPASSWORD=… /opt/homebrew/bin/psql \
  "host=aws-0-us-west-2.pooler.supabase.com port=5432 dbname=postgres \
   user=postgres.eusjiygcqzsmqonhuxlq sslmode=require" \
  -v ON_ERROR_STOP=1 \
  -f ~/ls-house-app/backend/supabase/migration_008_kanban_snapshot.sql
```

Hermes cron (simone) **`ffdf27f8536d`** is **paused/disabled until C OK** — enabling starts 5m upserts to prod Supabase.

Profile script copies (no_agent path):  
`~/.hermes/profiles/simone/scripts/kanban_snapshot.{sh,py}`

## Dry-run baseline (2026-08-04)

```
kanban_snapshot dry-run: total=16 by_status={'blocked': 8, 'todo': 1, 'done': 6, 'running': 1} failing=2
```

See `docs/ops/kanban_snapshot_dryrun_2026-08-04.txt`.

## Non-goals

- Not a second SoT — no create/complete/comment write from MC in v1
- Not full event/comment history forever — light windows only (20 comments / 30 events)
- Detail beyond the window stays on Studio kanban.db only
