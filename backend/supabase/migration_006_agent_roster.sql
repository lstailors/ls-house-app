-- Migration 006: Full Agent Roster + Task Delegation
-- Applies to lsh schema. Re-runnable (IF NOT EXISTS throughout).
-- Run against: postgresql://postgres.eusjiygcqzsmqonhuxlq@...

-- ── lsh.agents ───────────────────────────────────────────────────────────────
-- Source of truth for every agent in the L&S House system.

CREATE TABLE IF NOT EXISTS lsh.agents (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                text        UNIQUE NOT NULL,          -- 'maestro','sofia','mia','rocco','melena','filo'
  name                text        NOT NULL,
  role                text        NOT NULL,                 -- one-line department description
  description         text        NOT NULL DEFAULT '',      -- longer description shown on detail page
  status              text        NOT NULL DEFAULT 'offline'
    CHECK (status IN ('active','idle','error','offline','paused')),
  model               text        NOT NULL DEFAULT '',      -- e.g. 'claude-sonnet-4', 'llama3:8b'
  platform            text        NOT NULL DEFAULT '',      -- 'Mac Studio', 'n8n Cloud', etc.
  color               text        NOT NULL DEFAULT 'brass', -- UI accent: 'brass','emerald','rose','amber','blue','purple'
  icon                text        NOT NULL DEFAULT 'Bot',   -- Lucide icon name
  -- Live state
  current_task        text,                                 -- what it's doing RIGHT NOW
  current_task_since  timestamptz,
  last_action_at      timestamptz,
  last_action_summary text,
  last_heartbeat_at   timestamptz,
  health_score        integer     NOT NULL DEFAULT 100 CHECK (health_score BETWEEN 0 AND 100),
  -- Config / settings (editable from the UI)
  settings            jsonb       NOT NULL DEFAULT '{}',
  -- Stats (updated by agents on heartbeat)
  stats               jsonb       NOT NULL DEFAULT '{}',    -- e.g. {"tasks_today":3,"emails_parsed":120}
  enabled             boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lsh_agents_slug_idx    ON lsh.agents(slug);
CREATE INDEX IF NOT EXISTS lsh_agents_status_idx  ON lsh.agents(status);

-- RLS
ALTER TABLE lsh.agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agents_read"   ON lsh.agents;
DROP POLICY IF EXISTS "agents_write"  ON lsh.agents;
CREATE POLICY "agents_read"  ON lsh.agents FOR SELECT USING (lsh.is_super_admin() OR lsh.is_store_manager());
CREATE POLICY "agents_write" ON lsh.agents FOR UPDATE USING (lsh.is_super_admin());
GRANT SELECT ON lsh.agents TO authenticated;
GRANT UPDATE ON lsh.agents TO authenticated;
-- service_role needs full access for agent heartbeats
GRANT SELECT, INSERT, UPDATE ON lsh.agents TO service_role;

-- ── lsh.agent_tasks ──────────────────────────────────────────────────────────
-- C or an agent can delegate a task; the assigned agent picks it up.

CREATE TABLE IF NOT EXISTS lsh.agent_tasks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  assigned_to     text        NOT NULL REFERENCES lsh.agents(slug) ON DELETE CASCADE,
  assigned_by     text        NOT NULL DEFAULT 'c',         -- 'c' or agent slug
  title           text        NOT NULL,
  description     text        NOT NULL DEFAULT '',
  priority        text        NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low','medium','high','urgent')),
  status          text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','completed','blocked','cancelled')),
  due_at          timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  result          text,                                     -- what the agent did / outcome
  result_metadata jsonb       NOT NULL DEFAULT '{}',
  linked_approval_id uuid,                                  -- if task spawned an approval
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lsh_tasks_assigned_idx  ON lsh.agent_tasks(assigned_to, status);
CREATE INDEX IF NOT EXISTS lsh_tasks_status_idx    ON lsh.agent_tasks(status);
CREATE INDEX IF NOT EXISTS lsh_tasks_created_idx   ON lsh.agent_tasks(created_at DESC);

ALTER TABLE lsh.agent_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tasks_read"   ON lsh.agent_tasks;
DROP POLICY IF EXISTS "tasks_write"  ON lsh.agent_tasks;
CREATE POLICY "tasks_read"  ON lsh.agent_tasks FOR SELECT USING (lsh.is_super_admin() OR lsh.is_store_manager());
CREATE POLICY "tasks_write" ON lsh.agent_tasks FOR ALL    USING (lsh.is_super_admin());
GRANT SELECT, INSERT, UPDATE ON lsh.agent_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE ON lsh.agent_tasks TO service_role;

-- ── lsh.agent_events ─────────────────────────────────────────────────────────
-- Append-only event log per agent. Powers the live activity feed on detail page.

CREATE TABLE IF NOT EXISTS lsh.agent_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_slug   text        NOT NULL,
  event_type   text        NOT NULL,  -- 'task_started','task_completed','brief_posted','approval_queued',
                                      --  'heartbeat','error','info','warning'
  title        text        NOT NULL,
  body         text,
  severity     text        NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','error','critical')),
  task_id      uuid        REFERENCES lsh.agent_tasks(id) ON DELETE SET NULL,
  metadata     jsonb       NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lsh_events_agent_idx   ON lsh.agent_events(agent_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS lsh_events_created_idx ON lsh.agent_events(created_at DESC);
CREATE INDEX IF NOT EXISTS lsh_events_type_idx    ON lsh.agent_events(event_type);

ALTER TABLE lsh.agent_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "events_read" ON lsh.agent_events;
CREATE POLICY "events_read" ON lsh.agent_events FOR SELECT USING (lsh.is_super_admin() OR lsh.is_store_manager());
GRANT SELECT, INSERT ON lsh.agent_events TO authenticated;
GRANT SELECT, INSERT ON lsh.agent_events TO service_role;

-- ── Seed: agent roster ───────────────────────────────────────────────────────

INSERT INTO lsh.agents (slug, name, role, description, model, platform, color, icon, enabled) VALUES

('maestro', 'Maestro', 'Orchestrator',
 'Chief of staff. Routes tasks to every agent, holds the thread, surfaces decisions to C. Always on. Never forgets.',
 'claude-sonnet-4', 'Hermes · Mac Studio', 'brass', 'Crown', true),

('sofia', 'Sofia', 'Client Concierge',
 'All client SMS and voice. Books appointments, handles inquiries, routes escalations. Warm, professional, always on brand.',
 'grok-3', 'n8n Cloud · Twilio', 'emerald', 'Phone', true),

('mia', 'Mia', 'Scheduling & Dossiers',
 'Owns every calendar, every fitting slot, every minute of C''s professional time. Generates client dossiers before every consultation.',
 'claude-haiku-3-5', 'Mac Studio · Cal.com', 'blue', 'Calendar', true),

('rocco', 'Rocco', 'Production & Delivery',
 'Owns the floor cradle to delivery. MTMPro orders, alteration tickets, YZ pipeline, factory monitoring. Flags stalled jobs and late deliveries.',
 'claude-sonnet-4', 'Mac Studio · MTMPro · ERPNext', 'amber', 'Factory', true),

('melena', 'Melena', 'Accounting & Books',
 'Owns the money. Billing, invoicing, Square reconciliation across LSTNY, LSTX, and Holdings. Drafts only — never auto-sends. Escalates every discrepancy.',
 'claude-sonnet-4', 'Mac Studio · ERPNext · Square', 'rose', 'DollarSign', true),

('filo', 'Filo', 'Ingestion & Intelligence',
 'Runs locally on the Studio. Watches every inbox, the Downloads folder, all attachments the moment they land. Parses, classifies, extracts, backfills ERPNext and Supabase. Confidence-tiered: auto-commits low-risk data, queues financial fields for Melena.',
 'llama3:8b (local)', 'Mac Studio · Ollama · IMAP', 'purple', 'Brain', true)

ON CONFLICT (slug) DO UPDATE SET
  name        = EXCLUDED.name,
  role        = EXCLUDED.role,
  description = EXCLUDED.description,
  model       = EXCLUDED.model,
  platform    = EXCLUDED.platform,
  color       = EXCLUDED.color,
  icon        = EXCLUDED.icon,
  updated_at  = now();

-- ── Enable Supabase Realtime on agent tables ──────────────────────────────────
-- Allows frontend to subscribe to live agent status changes.
ALTER PUBLICATION supabase_realtime ADD TABLE lsh.agents;
ALTER PUBLICATION supabase_realtime ADD TABLE lsh.agent_events;
ALTER PUBLICATION supabase_realtime ADD TABLE lsh.agent_tasks;
