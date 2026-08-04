-- Migration 009: lsh.mc_commands — Unified Mission Control command queue (SPEC 066)
-- Write path only (intent in). Supersedes ad-hoc lsh.kanban_commands (no committed SQL).
-- Studio worker (mc_commands_apply.py, 1m no_agent cron) claims via FOR UPDATE SKIP LOCKED
-- through lsh.mc_commands_claim() and executes real Hermes primitives.
-- Re-runnable (IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE OR REPLACE).
--
-- Apply (prefer Management API SQL when psql password stale):
--   POST https://api.supabase.com/v1/projects/eusjiygcqzsmqonhuxlq/database/query
-- Or:
--   PGPASSWORD=… /opt/homebrew/bin/psql \
--     "host=aws-0-us-west-2.pooler.supabase.com port=5432 dbname=postgres \
--      user=postgres.eusjiygcqzsmqonhuxlq sslmode=require" \
--     -v ON_ERROR_STOP=1 -f backend/supabase/migration_009_mc_commands.sql

CREATE SCHEMA IF NOT EXISTS lsh;

-- ── lsh.mc_commands ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lsh.mc_commands (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- domain + verb
  kind              text          NOT NULL
    CHECK (kind IN ('kanban_task', 'cron_job', 'fleet_agent', 'chat_run', 'approval')),
  action            text          NOT NULL,
  -- kanban_task : promote | block | unblock | complete | archive | schedule | assign | comment
  -- cron_job    : cron_enable | cron_disable
  -- fleet_agent : restart | set_model | set_fallback_model
  -- chat_run    : send
  -- approval    : approve | reject | edit

  -- target shape depends on kind (see SPEC 066 §2)
  target_id         text          NOT NULL,
  payload           jsonb         NOT NULL DEFAULT '{}'::jsonb,

  -- audit
  requested_by      text          NOT NULL,
  origin_surface    text          NOT NULL DEFAULT 'mission_control',

  -- optional caller dedupe key (NULL = fire-and-forget)
  idempotency_key   text          UNIQUE,

  -- lifecycle
  status            text          NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'applied', 'failed', 'cancelled')),
  retry_count       integer       NOT NULL DEFAULT 0,
  error             text,

  -- lease (90s default; stale leased rows re-claimable)
  leased_by         text,
  leased_at         timestamptz,
  lease_expires_at  timestamptz,

  created_at        timestamptz   NOT NULL DEFAULT now(),
  applied_at        timestamptz,
  updated_at        timestamptz   NOT NULL DEFAULT now()
);

-- Forward-compatible if an earlier draft existed without some columns
ALTER TABLE lsh.mc_commands ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE lsh.mc_commands ADD COLUMN IF NOT EXISTS target_id text;
ALTER TABLE lsh.mc_commands ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE lsh.mc_commands ADD COLUMN IF NOT EXISTS requested_by text;
ALTER TABLE lsh.mc_commands ADD COLUMN IF NOT EXISTS origin_surface text NOT NULL DEFAULT 'mission_control';
ALTER TABLE lsh.mc_commands ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE lsh.mc_commands ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE lsh.mc_commands ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE lsh.mc_commands ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE lsh.mc_commands ADD COLUMN IF NOT EXISTS leased_by text;
ALTER TABLE lsh.mc_commands ADD COLUMN IF NOT EXISTS leased_at timestamptz;
ALTER TABLE lsh.mc_commands ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE lsh.mc_commands ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE lsh.mc_commands ADD COLUMN IF NOT EXISTS applied_at timestamptz;
ALTER TABLE lsh.mc_commands ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Unique idempotency (nullable unique allows many NULLs in Postgres)
CREATE UNIQUE INDEX IF NOT EXISTS lsh_mc_commands_idempotency_uidx
  ON lsh.mc_commands (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS lsh_mc_commands_status_idx
  ON lsh.mc_commands (status, created_at);

CREATE INDEX IF NOT EXISTS lsh_mc_commands_kind_idx
  ON lsh.mc_commands (kind);

CREATE INDEX IF NOT EXISTS lsh_mc_commands_target_idx
  ON lsh.mc_commands (target_id);

CREATE INDEX IF NOT EXISTS lsh_mc_commands_pending_lease_idx
  ON lsh.mc_commands (status, lease_expires_at)
  WHERE status IN ('pending', 'leased');

-- ── Claim RPC (FOR UPDATE SKIP LOCKED) ───────────────────────────────────────
-- Atomic claim for Studio worker. Two overlapping ticks never double-claim.

CREATE OR REPLACE FUNCTION lsh.mc_commands_claim(
  p_worker text,
  p_limit  integer DEFAULT 30,
  p_lease_seconds integer DEFAULT 90
)
RETURNS SETOF lsh.mc_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'lsh', 'public'
AS $$
BEGIN
  IF p_worker IS NULL OR length(trim(p_worker)) = 0 THEN
    RAISE EXCEPTION 'p_worker required';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 THEN
    p_limit := 30;
  END IF;
  IF p_limit > 100 THEN
    p_limit := 100;
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 15 THEN
    p_lease_seconds := 90;
  END IF;

  RETURN QUERY
  UPDATE lsh.mc_commands c
  SET status = 'leased',
      leased_by = p_worker,
      leased_at = now(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  WHERE c.id IN (
    SELECT id FROM lsh.mc_commands
    WHERE (
        status = 'pending'
        OR (status = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at < now())
      )
      -- hard cap: do not auto-loop past 3 retries (retry resets failed→pending elsewhere)
      AND COALESCE(retry_count, 0) <= 3
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING c.*;
END;
$$;

-- Explicit UI retry: failed → pending, increment retry_count, refuse past 3
CREATE OR REPLACE FUNCTION lsh.mc_commands_retry(p_id uuid)
RETURNS lsh.mc_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'lsh', 'public'
AS $$
DECLARE
  r lsh.mc_commands;
BEGIN
  UPDATE lsh.mc_commands
  SET retry_count = retry_count + 1,
      status = 'pending',
      error = NULL,
      leased_by = NULL,
      leased_at = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE id = p_id
    AND status = 'failed'
    AND retry_count < 3
  RETURNING * INTO r;

  IF r.id IS NULL THEN
    RAISE EXCEPTION 'retry refused: not failed, missing, or retry_count>=3';
  END IF;
  RETURN r;
END;
$$;

-- Cancel only while still pending (v1)
CREATE OR REPLACE FUNCTION lsh.mc_commands_cancel(p_id uuid)
RETURNS lsh.mc_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'lsh', 'public'
AS $$
DECLARE
  r lsh.mc_commands;
BEGIN
  UPDATE lsh.mc_commands
  SET status = 'cancelled',
      updated_at = now()
  WHERE id = p_id
    AND status = 'pending'
  RETURNING * INTO r;

  IF r.id IS NULL THEN
    RAISE EXCEPTION 'cancel refused: not pending or missing';
  END IF;
  RETURN r;
END;
$$;

GRANT EXECUTE ON FUNCTION lsh.mc_commands_claim(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION lsh.mc_commands_retry(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION lsh.mc_commands_cancel(uuid) TO service_role;
-- PostgREST RPC is typically exposed; keep authenticated from calling claim
REVOKE ALL ON FUNCTION lsh.mc_commands_claim(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lsh.mc_commands_retry(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lsh.mc_commands_cancel(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lsh.mc_commands_claim(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION lsh.mc_commands_retry(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION lsh.mc_commands_cancel(uuid) TO service_role;

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE lsh.mc_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mc_commands_read" ON lsh.mc_commands;
CREATE POLICY "mc_commands_read" ON lsh.mc_commands
  FOR SELECT
  USING (lsh.is_super_admin() OR lsh.is_store_manager());

DROP POLICY IF EXISTS "mc_commands_insert" ON lsh.mc_commands;
CREATE POLICY "mc_commands_insert" ON lsh.mc_commands
  FOR INSERT
  WITH CHECK (lsh.is_super_admin());

-- No authenticated UPDATE/DELETE — worker uses service_role only
DROP POLICY IF EXISTS "mc_commands_update" ON lsh.mc_commands;
DROP POLICY IF EXISTS "mc_commands_delete" ON lsh.mc_commands;
DROP POLICY IF EXISTS "mc_commands_write" ON lsh.mc_commands;

GRANT SELECT, INSERT ON lsh.mc_commands TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON lsh.mc_commands TO service_role;

-- ── updated_at touch ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION lsh.mc_commands_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mc_commands_touch_updated_at ON lsh.mc_commands;
CREATE TRIGGER mc_commands_touch_updated_at
  BEFORE UPDATE ON lsh.mc_commands
  FOR EACH ROW
  EXECUTE FUNCTION lsh.mc_commands_touch_updated_at();

COMMENT ON TABLE lsh.mc_commands IS
  'Unified Mission Control command queue (SPEC 066). Write path only — never a mirror of state. kind classifies domain (kanban_task/cron_job/fleet_agent/chat_run/approval); action is the verb. Supersedes lsh.kanban_commands. Studio worker mc_commands_apply.py (1m) claims via lsh.mc_commands_claim (FOR UPDATE SKIP LOCKED).';

COMMENT ON FUNCTION lsh.mc_commands_claim(text, integer, integer) IS
  'Atomically claim up to N pending/stale-leased mc_commands rows for a Studio worker (FOR UPDATE SKIP LOCKED).';
