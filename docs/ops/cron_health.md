# lsh.cron_health — row shape for Coder (MC Crons API)

**Status:** staged (2026-08-04). Migration + writer ready; **prod apply needs C OK**.

**SoT:** Hermes `jobs.json` on Mac Studio — never write back from Mission Control.

| Path | Profile slug in table |
|---|---|
| `~/.hermes/cron/jobs.json` | `maestro` |
| `~/.hermes/profiles/<slug>/cron/jobs.json` | `<slug>` |

Writer: `backend/scripts/cron_health_snapshot.py`  
Cron (staged, simone profile): every 15m, `no_agent=true`, `--apply --quiet-ok`  
Migration: `backend/supabase/migration_007_cron_health.sql`

## Table

Schema: **`lsh.cron_health`**  
PK: **`(profile, job_id)`**  
RLS: `SELECT` for `lsh.is_super_admin() OR lsh.is_store_manager()`  
Writes: **service_role only** (Studio snapshot)

## Row shape (API contract)

```ts
// GET /api/mission-control/crons  →  { crons: CronHealthRow[], counts: {...}, snapshot_at }
type HealthColor = "green" | "amber" | "red";

interface CronHealthRow {
  profile: string;              // agent slug (maestro, mia, simone, …)
  job_id: string;               // hermes job id
  job_name: string;
  enabled: boolean;
  health_color: HealthColor;
  health_reasons: string[];     // e.g. ["stale_age=…","paused","model_drift","last_error"]
  last_status: string | null;   // typically "ok" | "error" | null
  last_run_at: string | null;   // ISO timestamptz
  next_run_at: string | null;
  last_error: string | null;
  last_delivery_error: string | null;
  schedule_kind: string | null; // "cron" | "interval"
  schedule_display: string | null;
  schedule_expr: string | null;
  period_seconds: number | null;
  stale: boolean;
  model: string | null;
  model_snapshot: string | null;
  model_drift: boolean;         // model && model_snapshot && model !== model_snapshot
  provider: string | null;
  provider_snapshot: string | null;
  paused_at: string | null;
  paused_reason: string | null;
  no_agent: boolean;
  skills: string[];
  source_path: string;
  snapshot_at: string;          // when this row was last written
  created_at?: string;
  updated_at?: string;
}
```

## Color rules (writer)

1. **red** — `last_status` not ok/success **or** non-empty `last_error`
2. **amber** — paused, disabled, stale (`last_run` older than **2×** estimated schedule period), `model_drift`, or `last_delivery_error` only
3. **green** — enabled, fresh ok run, no errors/drift/pause

## Suggested API

```
GET /api/mission-control/crons
  ?profile=mia
  &color=red
  &q=leave
Auth: super_admin | store_manager (same as MC)

Response 200:
{
  "snapshot_at": "<max snapshot_at across rows>",
  "counts": { "green": 40, "amber": 16, "red": 1, "total": 57 },
  "crons": [ CronHealthRow, ... ]
}
```

Supabase client (Edge):

```ts
const { data, error } = await supabase
  .schema("lsh")
  .from("cron_health")
  .select("*")
  .order("health_color") // optional: sort reds first in app
  .order("profile");
```

UI notes (SPEC 063): emerald/amber/rose pills; show `model_drift` badge; truncate `last_error` + expand.

## Ops

```bash
# Dry-run (prove counts — no Supabase write)
python3 ~/ls-house-app/backend/scripts/cron_health_snapshot.py --dry-run

# Apply (after migration + C OK)
python3 ~/ls-house-app/backend/scripts/cron_health_snapshot.py --apply --quiet-ok

# Apply migration (C OK)
PGPASSWORD=… /opt/homebrew/bin/psql \
  "host=aws-0-us-west-2.pooler.supabase.com port=5432 dbname=postgres \
   user=postgres.eusjiygcqzsmqonhuxlq sslmode=require" \
  -v ON_ERROR_STOP=1 \
  -f ~/ls-house-app/backend/scripts/../supabase/migration_007_cron_health.sql
```

Hermes cron job (simone) is **created paused/disabled until C OK** — enabling it starts 15m upserts to prod Supabase.

## Non-goals

- Not a second SoT — do not edit job config from MC in v1
- Does not replace ERP `LSH Cron Job` doctype immediately; MC Crons tab should prefer this table
