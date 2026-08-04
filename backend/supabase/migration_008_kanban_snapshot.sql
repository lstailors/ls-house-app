-- Migration 008: lsh.kanban_snapshot — Hermes Kanban board snapshot (derived, not SoT)
-- Phase 1 Mission Control Board. Source of truth remains ~/.hermes/kanban.db.
-- Studio writer (no_agent cron every 5m) upserts; Vercel Edge reads via service/anon+RLS.
-- Re-runnable (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- Stage only until C OK to apply on prod (project eusjiygcqzsmqonhuxlq).
--
-- Apply (Mac Studio, after DB password verified):
--   PGPASSWORD=… /opt/homebrew/bin/psql \
--     "host=aws-0-us-west-2.pooler.supabase.com port=5432 dbname=postgres \
--      user=postgres.eusjiygcqzsmqonhuxlq sslmode=require" \
--     -v ON_ERROR_STOP=1 -f backend/supabase/migration_008_kanban_snapshot.sql

CREATE SCHEMA IF NOT EXISTS lsh;

-- ── lsh.kanban_snapshot ─────────────────────────────────────────────────────
-- One row per kanban task id (non-archived + recent done). Upserted by kanban_snapshot.py.
-- Light comment/event payloads for Board cards + drawer (SPEC 062); not full SoT.

CREATE TABLE IF NOT EXISTS lsh.kanban_snapshot (
  task_id                 text        PRIMARY KEY,  -- t_xxxxxxxx
  title                   text        NOT NULL DEFAULT '',
  body                    text,
  assignee                text,
  status                  text        NOT NULL DEFAULT 'todo',
  priority                integer     NOT NULL DEFAULT 0,
  created_by              text,
  created_at              timestamptz,
  started_at              timestamptz,
  completed_at            timestamptz,
  consecutive_failures    integer     NOT NULL DEFAULT 0,
  last_failure_error      text,
  block_kind              text,
  result_summary          text,       -- tasks.result (completion summary)
  parent_ids              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  child_ids               jsonb       NOT NULL DEFAULT '[]'::jsonb,
  comment_count           integer     NOT NULL DEFAULT 0,
  latest_comment_at       timestamptz,
  latest_comment_author   text,
  latest_comment_body     text,
  -- Light drawer payloads (SPEC 062). Arrays oldest→newest.
  -- recent_comments: [{author, body, created_at}]  (last ≤20)
  recent_comments         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  event_count             integer     NOT NULL DEFAULT 0,
  latest_event_kind       text,
  latest_event_at         timestamptz,
  latest_event_detail     text,
  -- recent_events: [{kind, created_at, run_id, detail}]  (last ≤30)
  recent_events           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  board_slug              text        NOT NULL DEFAULT 'default',
  snapshot_at             timestamptz NOT NULL DEFAULT now(),
  created_row_at          timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Forward-compatible: add columns if table already existed from earlier draft
ALTER TABLE lsh.kanban_snapshot
  ADD COLUMN IF NOT EXISTS recent_comments jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE lsh.kanban_snapshot
  ADD COLUMN IF NOT EXISTS event_count integer NOT NULL DEFAULT 0;
ALTER TABLE lsh.kanban_snapshot
  ADD COLUMN IF NOT EXISTS latest_event_kind text;
ALTER TABLE lsh.kanban_snapshot
  ADD COLUMN IF NOT EXISTS latest_event_at timestamptz;
ALTER TABLE lsh.kanban_snapshot
  ADD COLUMN IF NOT EXISTS latest_event_detail text;
ALTER TABLE lsh.kanban_snapshot
  ADD COLUMN IF NOT EXISTS recent_events jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS lsh_kanban_snapshot_status_idx
  ON lsh.kanban_snapshot (status);

CREATE INDEX IF NOT EXISTS lsh_kanban_snapshot_assignee_idx
  ON lsh.kanban_snapshot (assignee);

CREATE INDEX IF NOT EXISTS lsh_kanban_snapshot_snapshot_idx
  ON lsh.kanban_snapshot (snapshot_at DESC);

CREATE INDEX IF NOT EXISTS lsh_kanban_snapshot_priority_idx
  ON lsh.kanban_snapshot (priority DESC);

CREATE INDEX IF NOT EXISTS lsh_kanban_snapshot_board_status_idx
  ON lsh.kanban_snapshot (board_slug, status);

-- RLS: Mission Control readers only
ALTER TABLE lsh.kanban_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kanban_snapshot_read" ON lsh.kanban_snapshot;
CREATE POLICY "kanban_snapshot_read" ON lsh.kanban_snapshot
  FOR SELECT
  USING (lsh.is_super_admin() OR lsh.is_store_manager());

DROP POLICY IF EXISTS "kanban_snapshot_write" ON lsh.kanban_snapshot;

GRANT SELECT ON lsh.kanban_snapshot TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON lsh.kanban_snapshot TO service_role;

CREATE OR REPLACE FUNCTION lsh.kanban_snapshot_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kanban_snapshot_touch_updated_at ON lsh.kanban_snapshot;
CREATE TRIGGER kanban_snapshot_touch_updated_at
  BEFORE UPDATE ON lsh.kanban_snapshot
  FOR EACH ROW
  EXECUTE FUNCTION lsh.kanban_snapshot_touch_updated_at();

COMMENT ON TABLE lsh.kanban_snapshot IS
  'Derived snapshot of Hermes Kanban tasks for Mission Control Board. SoT = ~/.hermes/kanban.db. Written by Studio kanban_snapshot.py every 5m. Includes light recent_comments/recent_events for drawer.';
