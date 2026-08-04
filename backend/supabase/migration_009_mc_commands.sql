-- Migration 009: lsh.mc_commands — unified Mission Control command queue (SPEC 066)
-- Write path only (intent in), never a state mirror. Supersedes ad-hoc lsh.kanban_commands.
-- Studio worker (mc_commands_apply.py, 1m cron) claims via FOR UPDATE SKIP LOCKED.
-- Re-runnable. Stage until C OK if co-owned with Command Queue Infra task.
--
-- Apply (Mac Studio):
--   PGPASSWORD=… /opt/homebrew/bin/psql \
--     "host=aws-0-us-west-2.pooler.supabase.com port=5432 dbname=postgres \
--      user=postgres.eusjiygcqzsmqonhuxlq sslmode=require" \
--     -v ON_ERROR_STOP=1 -f backend/supabase/migration_009_mc_commands.sql

CREATE SCHEMA IF NOT EXISTS lsh;

CREATE TABLE IF NOT EXISTS lsh.mc_commands (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),

  kind              text          NOT NULL
    CHECK (kind IN ('kanban_task', 'cron_job', 'fleet_agent', 'chat_run', 'approval')),
  action            text          NOT NULL,

  target_id         text          NOT NULL,
  payload           jsonb         NOT NULL DEFAULT '{}'::jsonb,

  requested_by      text          NOT NULL,
  origin_surface    text          NOT NULL DEFAULT 'mission_control',

  idempotency_key   text          UNIQUE,

  status            text          NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'applied', 'failed', 'cancelled')),
  retry_count       integer       NOT NULL DEFAULT 0,
  error             text,

  leased_by         text,
  leased_at         timestamptz,
  lease_expires_at  timestamptz,

  created_at        timestamptz   NOT NULL DEFAULT now(),
  applied_at        timestamptz,
  updated_at        timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lsh_mc_commands_status_idx
  ON lsh.mc_commands (status, created_at);

CREATE INDEX IF NOT EXISTS lsh_mc_commands_kind_idx
  ON lsh.mc_commands (kind);

CREATE INDEX IF NOT EXISTS lsh_mc_commands_target_idx
  ON lsh.mc_commands (target_id);

CREATE INDEX IF NOT EXISTS lsh_mc_commands_pending_lease_idx
  ON lsh.mc_commands (status, lease_expires_at)
  WHERE status IN ('pending', 'leased');

ALTER TABLE lsh.mc_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mc_commands_read" ON lsh.mc_commands;
CREATE POLICY "mc_commands_read" ON lsh.mc_commands
  FOR SELECT
  USING (lsh.is_super_admin() OR lsh.is_store_manager());

DROP POLICY IF EXISTS "mc_commands_insert" ON lsh.mc_commands;
CREATE POLICY "mc_commands_insert" ON lsh.mc_commands
  FOR INSERT
  WITH CHECK (lsh.is_super_admin());

GRANT SELECT, INSERT ON lsh.mc_commands TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON lsh.mc_commands TO service_role;

CREATE OR REPLACE FUNCTION lsh.mc_commands_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS mc_commands_touch_updated_at ON lsh.mc_commands;
CREATE TRIGGER mc_commands_touch_updated_at
  BEFORE UPDATE ON lsh.mc_commands
  FOR EACH ROW EXECUTE FUNCTION lsh.mc_commands_touch_updated_at();

COMMENT ON TABLE lsh.mc_commands IS
  'Unified Mission Control command queue (SPEC 066). Write path only — never a mirror of state. kind: kanban_task|cron_job|fleet_agent|chat_run|approval. Studio worker mc_commands_apply.py claims via FOR UPDATE SKIP LOCKED.';
