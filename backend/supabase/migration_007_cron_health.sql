-- Migration 007: lsh.cron_health — Hermes fleet cron snapshot (derived, not SoT)
-- Phase 2 Mission Control Crons. Source of truth remains ~/.hermes/**/cron/jobs.json.
-- Studio writer (no_agent cron every 15m) upserts; Vercel Edge reads via service/anon+RLS.
-- Re-runnable (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- Stage only until C OK to apply on prod (project eusjiygcqzsmqonhuxlq).
--
-- Apply (Mac Studio, after DB password verified):
--   PGPASSWORD=… /opt/homebrew/bin/psql \
--     "host=aws-0-us-west-2.pooler.supabase.com port=5432 dbname=postgres \
--      user=postgres.eusjiygcqzsmqonhuxlq sslmode=require" \
--     -v ON_ERROR_STOP=1 -f backend/supabase/migration_007_cron_health.sql

CREATE SCHEMA IF NOT EXISTS lsh;

-- ── lsh.cron_health ──────────────────────────────────────────────────────────
-- One row per (profile, job_id). Upserted wholesale by cron_health_snapshot.py.

CREATE TABLE IF NOT EXISTS lsh.cron_health (
  profile               text        NOT NULL,   -- hermes profile slug; root registry → 'maestro'
  job_id                text        NOT NULL,   -- jobs.json id (12-char hex)
  job_name              text        NOT NULL DEFAULT '',
  enabled               boolean     NOT NULL DEFAULT true,
  health_color          text        NOT NULL
    CHECK (health_color IN ('green', 'amber', 'red')),
  health_reasons        jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- string[]
  last_status           text,                   -- ok | error | null
  last_run_at           timestamptz,
  next_run_at           timestamptz,
  last_error            text,
  last_delivery_error   text,
  schedule_kind         text,                   -- cron | interval | …
  schedule_display      text,
  schedule_expr         text,                   -- cron expr or "every Nm"
  period_seconds        integer,                -- estimated period used for stale calc
  stale                 boolean     NOT NULL DEFAULT false,
  model                 text,
  model_snapshot        text,
  model_drift           boolean     NOT NULL DEFAULT false,
  provider              text,
  provider_snapshot     text,
  paused_at             timestamptz,
  paused_reason         text,
  no_agent              boolean     NOT NULL DEFAULT false,
  skills                jsonb       NOT NULL DEFAULT '[]'::jsonb,
  source_path           text        NOT NULL DEFAULT '',
  snapshot_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile, job_id)
);

CREATE INDEX IF NOT EXISTS lsh_cron_health_color_idx
  ON lsh.cron_health (health_color);

CREATE INDEX IF NOT EXISTS lsh_cron_health_profile_idx
  ON lsh.cron_health (profile);

CREATE INDEX IF NOT EXISTS lsh_cron_health_snapshot_idx
  ON lsh.cron_health (snapshot_at DESC);

CREATE INDEX IF NOT EXISTS lsh_cron_health_last_run_idx
  ON lsh.cron_health (last_run_at DESC NULLS LAST);

-- RLS: Mission Control readers only (same gate as agents / briefs)
ALTER TABLE lsh.cron_health ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cron_health_read" ON lsh.cron_health;
CREATE POLICY "cron_health_read" ON lsh.cron_health
  FOR SELECT
  USING (lsh.is_super_admin() OR lsh.is_store_manager());

-- No authenticated writes — Studio snapshot uses service_role only
DROP POLICY IF EXISTS "cron_health_write" ON lsh.cron_health;

GRANT SELECT ON lsh.cron_health TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON lsh.cron_health TO service_role;

-- updated_at bump on touch
CREATE OR REPLACE FUNCTION lsh.cron_health_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cron_health_touch_updated_at ON lsh.cron_health;
CREATE TRIGGER cron_health_touch_updated_at
  BEFORE UPDATE ON lsh.cron_health
  FOR EACH ROW
  EXECUTE FUNCTION lsh.cron_health_touch_updated_at();

COMMENT ON TABLE lsh.cron_health IS
  'Derived snapshot of Hermes cron fleet health. SoT = ~/.hermes/profiles/*/cron/jobs.json + ~/.hermes/cron/jobs.json. Written by Studio cron_health_snapshot.py every 15m.';
